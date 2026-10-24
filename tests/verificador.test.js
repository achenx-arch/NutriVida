// Verificador de importación en dos niveles: integridad histórica estricta + CAMBIO_POSTERIOR_AUDITADO.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { randomUUID } = require('node:crypto');
process.env.JWT_SECRET = 'verificador-sintetico';
process.env.ENCRYPTION_KEY = 'ab'.repeat(32);
const { crearPool } = require('../src/database/pool');
const { migrar } = require('../src/database/migraciones');
const { importarJson, verificarImportacion } = require('../src/database/importacion');
const { crearSistema } = require('../src/services/sistema');
const { Administrador } = require('../src/domain/modelos');
const { asignarRol } = require('../database/scripts/asignar-rol');
const { fuente } = require('./fixtures/fase2');

test('Verificador: integridad histórica estricta y cambios posteriores auditados', async t => {
  const sufijo = randomUUID().replaceAll('-', ''), schema = 'nv_test_' + sufijo, control = 'nv_test_control_' + sufijo;
  const gestor = crearPool({ pruebas: true }); await gestor.query(`CREATE SCHEMA ${schema}`);
  const pool = crearPool({ pruebas: true, schema });
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nv-verif-'));
  t.after(async () => {
    await pool.end();
    try { await gestor.query(`DROP SCHEMA ${schema} CASCADE`); await gestor.query(`DROP SCHEMA IF EXISTS ${control} CASCADE`); } finally { await gestor.end(); }
    fs.rmSync(dir, { recursive: true, force: true });
  });
  await migrar(pool, { esquemaControl: control });
  const datos = fuente(), archivo = path.join(dir, 'db.json');
  fs.writeFileSync(archivo, JSON.stringify(datos)); const bytes = fs.readFileSync(archivo);
  await importarJson(pool, archivo, { backupDir: path.join(dir, 'backup') });
  const sistema = crearSistema({ pool });
  const u = datos.usuarios[0], perfilId = u.perfilSalud.id, conv = datos.consultas[0].id, prod = datos.productos[0].id, aud = datos.auditoria[0].id;
  const conflicto = async (tabla, campo) => {
    let error; await assert.rejects(verificarImportacion(pool, archivo), e => { error = e; return e.codigo === 'IMPORTACION_CONFLICTO'; });
    assert.ok(error.conflictos.some(c => c.tabla === tabla && c.campo === campo), JSON.stringify(error.conflictos));
    assert.doesNotMatch(JSON.stringify(error.conflictos), /\$2[aby]\$|[a-f0-9]{24}:[a-f0-9]{32}:/i, 'sin hashes ni cifrado');
    return error;
  };
  // Modificación directa por SQL (fuera de la aplicación, sin auditoría) y restauración del fixture.
  const alterar = async (sql, args, restaurar, fn) => { await pool.query(sql, args); try { await fn(); } finally { await pool.query(...restaurar); } };

  await t.test('Recién importado: verificada sin cambios posteriores', async () => {
    const r = await verificarImportacion(pool, archivo);
    assert.equal(r.verificada, true); assert.equal(r.integridadHistorica, 'OK'); assert.deepEqual(r.cambiosPosteriores, []);
  });

  await t.test('B. Edición de perfil (caso real de nutrivida_db) → CAMBIO_POSTERIOR_AUDITADO, no conflicto', async () => {
    await sistema.perfil.actualizar(u.id, { objetivoNutricional: 'Objetivo actualizado' });
    const r = await verificarImportacion(pool, archivo);
    const campos = r.cambiosPosteriores.map(c => `${c.tabla}.${c.campo}:${c.evidencia.accion}`).sort();
    assert.deepEqual(campos, ['perfil_cliente.fecha_actualizacion:actualizacion_perfil_salud', 'usuarios.fecha_actualizacion:actualizacion_perfil_salud']);
    assert.ok(r.cambiosPosteriores.every(c => c.clasificacion === 'CAMBIO_POSTERIOR_AUDITADO'));
  });

  await t.test('B. Rol con CAMBIO_ROL auditado → CAMBIO_POSTERIOR_AUDITADO', async () => {
    await asignarRol(pool, [u.correo, 'ADMINISTRADOR']);
    const r = await verificarImportacion(pool, archivo);
    const rol = r.cambiosPosteriores.find(c => c.tabla === 'usuarios' && c.campo === 'id_rol');
    assert.equal(rol.evidencia.accion, 'CAMBIO_ROL');
  });

  await t.test('A. Rol cambiado sin CAMBIO_ROL que lo respalde → IMPORTACION_CONFLICTO', async () => {
    await alterar("UPDATE usuarios SET id_rol=(SELECT id_rol FROM roles WHERE nombre='EMPLEADO') WHERE id_usuario=$1", [u.id],
      ["UPDATE usuarios SET id_rol=(SELECT id_rol FROM roles WHERE nombre='ADMINISTRADOR') WHERE id_usuario=$1", [u.id]],
      () => conflicto('usuarios', 'id_rol'));
  });

  await t.test('A. password_hash, fecha_creacion, correo y datos_legado son críticos', async () => {
    const original = (await pool.query('SELECT password_hash, fecha_creacion, correo, datos_legado FROM usuarios WHERE id_usuario=$1', [u.id])).rows[0];
    const casos = [
      ['password_hash', "UPDATE usuarios SET password_hash='$2a$04$' || repeat('x',53) WHERE id_usuario=$1", 'UPDATE usuarios SET password_hash=$2 WHERE id_usuario=$1', original.password_hash],
      ['fecha_creacion', "UPDATE usuarios SET fecha_creacion=fecha_creacion + interval '1 day' WHERE id_usuario=$1", 'UPDATE usuarios SET fecha_creacion=$2 WHERE id_usuario=$1', original.fecha_creacion],
      ['correo', "UPDATE usuarios SET correo='otro@example.test' WHERE id_usuario=$1", 'UPDATE usuarios SET correo=$2 WHERE id_usuario=$1', original.correo],
      ['datos_legado', `UPDATE usuarios SET datos_legado='{"rol_origen":"ADMINISTRADOR"}' WHERE id_usuario=$1`, 'UPDATE usuarios SET datos_legado=$2 WHERE id_usuario=$1', original.datos_legado],
    ];
    for (const [campo, sql, restaurar, valor] of casos)
      await alterar(sql, [u.id], [restaurar, [u.id, valor]], async () => { const e = await conflicto('usuarios', campo); assert.ok(e.conflictos.find(c => c.campo === campo).critico); });
  });

  await t.test('A. Cifrado heredado del perfil (datos_legado) es crítico', async () => {
    const original = (await pool.query('SELECT datos_legado FROM perfil_cliente WHERE id_perfil=$1', [perfilId])).rows[0].datos_legado;
    await alterar("UPDATE perfil_cliente SET datos_legado=jsonb_set(datos_legado,'{alergias}','\"manipulado\"') WHERE id_perfil=$1", [perfilId],
      ['UPDATE perfil_cliente SET datos_legado=$2 WHERE id_perfil=$1', [perfilId, original]], () => conflicto('perfil_cliente', 'datos_legado'));
  });

  await t.test('A. fecha_actualizacion sin auditoría cercana → conflicto; estado sin auditoría → conflicto', async () => {
    const f = (await pool.query('SELECT fecha_actualizacion FROM usuarios WHERE id_usuario=$1', [u.id])).rows[0].fecha_actualizacion;
    await alterar("UPDATE usuarios SET fecha_actualizacion=fecha_actualizacion + interval '3 days' WHERE id_usuario=$1", [u.id],
      ['UPDATE usuarios SET fecha_actualizacion=$2 WHERE id_usuario=$1', [u.id, f]], () => conflicto('usuarios', 'fecha_actualizacion'));
    await alterar('UPDATE usuarios SET estado=FALSE WHERE id_usuario=$1', [u.id], ['UPDATE usuarios SET estado=TRUE WHERE id_usuario=$1', [u.id]],
      () => conflicto('usuarios', 'estado'));
  });

  await t.test('A. Conversación, mensajes y auditoría importada heredados son estrictos', async () => {
    await alterar("UPDATE conversaciones_ia SET estado='RESPONDIDA' WHERE id_conversacion=$1", [conv],
      ["UPDATE conversaciones_ia SET estado='ERROR' WHERE id_conversacion=$1", [conv]], () => conflicto('conversaciones_ia', 'estado'));
    const msg = (await pool.query('SELECT id_mensaje, contenido FROM mensajes_ia WHERE id_conversacion=$1', [conv])).rows[0];
    await alterar("UPDATE mensajes_ia SET contenido='manipulado' WHERE id_mensaje=$1", [msg.id_mensaje],
      ['UPDATE mensajes_ia SET contenido=$2 WHERE id_mensaje=$1', [msg.id_mensaje, msg.contenido]],
      () => assert.rejects(verificarImportacion(pool, archivo), /IMPORTACION_MENSAJES_CONFLICTO/));
    await alterar("UPDATE auditoria SET accion='otra' WHERE id_auditoria=$1", [aud],
      ['UPDATE auditoria SET accion=$2 WHERE id_auditoria=$1', [aud, datos.auditoria[0].accion]], () => conflicto('auditoria', 'accion'));
  });

  await t.test('B. Producto heredado editado desde el catálogo (auditado) → CAMBIO_POSTERIOR_AUDITADO', async () => {
    const admin = new Administrador({ nombre: 'Admin verificador', correo: 'admin-verif@example.test', passwordHash: 'hash-sintetico' });
    await sistema.repositorios.usuarios.guardar(admin);
    await sistema.catalogoComercial.guardar(admin.id, 'productos', prod, { descripcion: 'Descripción completada por administración' });
    const r = await verificarImportacion(pool, archivo);
    assert.ok(r.cambiosPosteriores.some(c => c.tabla === 'productos' && c.campo === 'descripcion' && c.evidencia));
    assert.ok(!r.cambiosPosteriores.some(c => c.tabla === 'productos' && c.campo === 'datos_legado'));
  });

  await t.test('Conversación heredada "Marcar como revisada" → CAMBIO_POSTERIOR_AUDITADO solo con las 7 condiciones', async st => {
    const { Cliente } = require('../src/domain/modelos');
    // En la aplicación solo ADMINISTRADOR tiene REVISAR_CONSULTAS; el verificador admite EMPLEADO o ADMINISTRADOR.
    const revisor = new Administrador({ nombre: 'Revisor verificador', correo: 'revisor-verif@example.test', passwordHash: 'hash-sintetico' });
    const cliente = new Cliente({ nombre: 'Cliente verificador', correo: 'cliente-verif@example.test', passwordHash: 'hash-sintetico' });
    await sistema.repositorios.usuarios.guardar(revisor); await sistema.repositorios.usuarios.guardar(cliente);
    const previo = (await pool.query('SELECT revisada, fecha_actualizacion, id_interaccion_origen FROM conversaciones_ia WHERE id_conversacion=$1', [conv])).rows[0];
    assert.equal(previo.revisada, false); assert.equal(previo.fecha_actualizacion, null);
    // Caso legítimo: el personal usa la operación real de la aplicación.
    await sistema.consultas.revisar(revisor.id, conv);
    const r = await verificarImportacion(pool, archivo);
    const rev = r.cambiosPosteriores.filter(c => c.tabla === 'conversaciones_ia').map(c => `${c.campo}:${c.evidencia.accion}`).sort();
    assert.deepEqual(rev, ['fecha_actualizacion:revision_consulta', 'revisada:revision_consulta']);
    assert.equal(r.integridadHistorica, 'OK');
    const ev = (await pool.query("SELECT id_auditoria, id_usuario, recurso_accedido, fecha FROM auditoria WHERE accion='revision_consulta' AND recurso_accedido=$1", ['consultas/' + conv])).rows;
    assert.equal(ev.length, 1);
    const evento = ev[0], restaurarEvento = ['UPDATE auditoria SET id_usuario=$2, recurso_accedido=$3, fecha=$4, accion=$5 WHERE id_auditoria=$1',
      [evento.id_auditoria, evento.id_usuario, evento.recurso_accedido, evento.fecha, 'revision_consulta']];
    const conflictoRevision = async (...campos) => { const e = await conflicto('conversaciones_ia', campos[0]);
      for (const c of campos) assert.ok(e.conflictos.some(x => x.tabla === 'conversaciones_ia' && x.campo === c && x.critico), c); };

    await st.test('otro campo modificado (título) → conflicto, también revisada', () =>
      alterar("UPDATE conversaciones_ia SET titulo='manipulado' WHERE id_conversacion=$1", [conv],
        ['UPDATE conversaciones_ia SET titulo=NULL WHERE id_conversacion=$1', [conv]], () => conflictoRevision('titulo', 'revisada', 'fecha_actualizacion')));
    await st.test('estado modificado junto a la revisión → conflicto', () =>
      alterar("UPDATE conversaciones_ia SET estado='RESPONDIDA' WHERE id_conversacion=$1", [conv],
        ["UPDATE conversaciones_ia SET estado='ERROR' WHERE id_conversacion=$1", [conv]], () => conflictoRevision('estado', 'revisada')));
    await st.test('true → false → conflicto', async () => {
      const otro = path.join(dir, 'db-revisada.json'), d2 = fuente(); Object.assign(d2, JSON.parse(JSON.stringify(datos)));
      d2.interacciones[0].revisada = true; fs.writeFileSync(otro, JSON.stringify(d2));
      await pool.query('UPDATE conversaciones_ia SET revisada=FALSE WHERE id_conversacion=$1', [conv]);
      try { let e; await assert.rejects(verificarImportacion(pool, otro), x => { e = x; return x.codigo === 'IMPORTACION_CONFLICTO'; });
        assert.ok(e.conflictos.some(c => c.tabla === 'conversaciones_ia' && c.campo === 'revisada' && c.critico)); }
      finally { await pool.query('UPDATE conversaciones_ia SET revisada=TRUE WHERE id_conversacion=$1', [conv]); }
    });
    await st.test('sin revision_consulta → conflicto', () =>
      alterar("UPDATE auditoria SET accion='consulta_historial_clientes' WHERE id_auditoria=$1", [evento.id_auditoria], restaurarEvento,
        () => conflictoRevision('revisada', 'fecha_actualizacion')));
    await st.test('evento de otra conversación (o recurso que solo la contiene) → conflicto', async () => {
      for (const recurso of ['consultas/' + randomUUID(), `consultas/${conv}/x`, `x/consultas/${conv}`])
        await alterar('UPDATE auditoria SET recurso_accedido=$2 WHERE id_auditoria=$1', [evento.id_auditoria, recurso], restaurarEvento,
          () => conflictoRevision('revisada', 'fecha_actualizacion'));
    });
    await st.test('evento fuera de 5 segundos → conflicto', async () => {
      for (const desfase of ["- interval '6 seconds'", "+ interval '6 seconds'"])
        await alterar(`UPDATE auditoria SET fecha=fecha ${desfase} WHERE id_auditoria=$1`, [evento.id_auditoria], restaurarEvento,
          () => conflictoRevision('revisada', 'fecha_actualizacion'));
    });
    await st.test('revisor CLIENTE → conflicto; revisor propietario de la conversación → conflicto', async () => {
      await alterar('UPDATE auditoria SET id_usuario=$2 WHERE id_auditoria=$1', [evento.id_auditoria, cliente.id], restaurarEvento,
        () => conflictoRevision('revisada', 'fecha_actualizacion'));
      // El propietario (u) es ADMINISTRADOR desde la prueba de CAMBIO_ROL: aun así no puede respaldar su propia conversación.
      await alterar('UPDATE auditoria SET id_usuario=$2 WHERE id_auditoria=$1', [evento.id_auditoria, u.id], restaurarEvento,
        () => conflictoRevision('revisada', 'fecha_actualizacion'));
    });
    await st.test('sin id_interaccion_origen → conflicto', () =>
      alterar('UPDATE conversaciones_ia SET id_interaccion_origen=NULL WHERE id_conversacion=$1', [conv],
        ['UPDATE conversaciones_ia SET id_interaccion_origen=$2 WHERE id_conversacion=$1', [conv, previo.id_interaccion_origen]],
        () => conflictoRevision('id_interaccion_origen', 'revisada')));
    await st.test('mensaje alterado → conflicto aunque la revisión esté auditada', async () => {
      const msg = (await pool.query('SELECT id_mensaje, contenido FROM mensajes_ia WHERE id_conversacion=$1', [conv])).rows[0];
      await alterar("UPDATE mensajes_ia SET contenido='manipulado' WHERE id_mensaje=$1", [msg.id_mensaje],
        ['UPDATE mensajes_ia SET contenido=$2 WHERE id_mensaje=$1', [msg.id_mensaje, msg.contenido]],
        () => assert.rejects(verificarImportacion(pool, archivo), /IMPORTACION_MENSAJES_CONFLICTO/));
    });
    await st.test('restaurado: vuelve a CAMBIO_POSTERIOR_AUDITADO', async () => {
      const r2 = await verificarImportacion(pool, archivo);
      assert.equal(r2.cambiosPosteriores.filter(c => c.tabla === 'conversaciones_ia').length, 2);
    });
  });

  await t.test('Final: todo restaurado verifica; data/db.json sin cambios; las 4 reglas no reescriben nada', async () => {
    const r = await verificarImportacion(pool, archivo);
    assert.equal(r.integridadHistorica, 'OK');
    assert.deepEqual(fs.readFileSync(archivo), bytes);
  });
});
