// Mecanismo administrativo de roles (usuario:listar / usuario:asignar-rol). Esquema temporal nv_test_*.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { spawnSync } = require('node:child_process');
const path = require('node:path');
process.env.JWT_SECRET = 'roles-sintetico';
process.env.ENCRYPTION_KEY = 'ef'.repeat(32);

const { crearPool } = require('../src/database/pool');
const { migrar } = require('../src/database/migraciones');
const { crearSistema } = require('../src/services/sistema');
const { crearApp } = require('../src/app');
const { Administrador } = require('../src/domain/modelos');
const { generarToken } = require('../src/security/auth');
const { asignarRol, validarArgumentos } = require('../database/scripts/asignar-rol');
const { listarUsuarios } = require('../database/scripts/listar-usuarios');

test('Roles: validación de argumentos ANTES de conectarse a PostgreSQL', () => {
  // 4. Roles inválidos y argumentos malformados se rechazan sin base de datos.
  for (const rol of ['PERSONAL_NUTRIVIDA', 'admin', 'Administrador', '', ' ADMINISTRADOR', "ADMINISTRADOR'; DROP TABLE usuarios;--", null])
    assert.throws(() => validarArgumentos(['cliente@example.test', rol]), e => e.codigo === 'ROL_INVALIDO');
  for (const args of [[], ['solo@example.test'], ['a@example.test', 'CLIENTE', 'extra'], null])
    assert.throws(() => validarArgumentos(args), e => /^USO/.test(e.codigo));
  for (const correo of ['', 'sin-arroba', 'x'.repeat(151) + '@example.test'])
    assert.throws(() => validarArgumentos([correo, 'CLIENTE']), e => e.codigo === 'CORREO_INVALIDO');
  assert.deepEqual(validarArgumentos(['  Cliente@Example.TEST ', 'ADMINISTRADOR']), { correo: 'cliente@example.test', rol: 'ADMINISTRADOR' });
  // El proceso CLI falla con rol inválido sin intentar conectar (DB_* vacíos).
  const r = spawnSync(process.execPath, [path.join(__dirname, '../database/scripts/asignar-rol.js'), 'a@example.test', 'PERSONAL_NUTRIVIDA'],
    { encoding: 'utf8', env: { PATH: process.env.PATH, JWT_SECRET: 'x', ENCRYPTION_KEY: 'ab'.repeat(32), DB_HOST: '', DB_NAME: '' }, cwd: require('node:os').tmpdir() });
  assert.equal(r.status, 1); assert.match(r.stderr, /ROL_INVALIDO/); assert.doesNotMatch(r.stderr, /DB_NO_CONFIGURADA/);
});

test('Roles: asignar-rol en PostgreSQL real (transacción, auditoría y aislamiento de datos)', async t => {
  const id = randomUUID().replaceAll('-', ''), schema = 'nv_test_' + id, control = 'nv_test_control_' + id;
  const gestor = crearPool({ pruebas: true }); await gestor.query(`CREATE SCHEMA ${schema}`);
  const pool = crearPool({ pruebas: true, schema }); let server;
  t.after(async () => {
    if (server) await new Promise(r => server.close(r));
    await pool.end();
    try { await gestor.query(`DROP SCHEMA ${schema} CASCADE`); await gestor.query(`DROP SCHEMA IF EXISTS ${control} CASCADE`); } finally { await gestor.end(); }
  });
  await migrar(pool, { esquemaControl: control });
  const sistema = crearSistema({ pool, ia: { async generarRecomendacion() { return 'Respuesta sintética'; } } });
  const admin = new Administrador({ nombre: 'Admin sintético', correo: 'admin-roles@example.test', passwordHash: 'hash-sintetico' });
  await sistema.repositorios.usuarios.guardar(admin);
  const cliente = await sistema.registrar({ nombre: 'Cliente Roles', correo: 'cliente.roles@example.test', password: 'Clave12345' });
  const inactivo = await sistema.registrar({ nombre: 'Cliente Inactivo', correo: 'inactivo@example.test', password: 'Clave12345' });
  await pool.query('UPDATE usuarios SET estado=FALSE WHERE id_usuario=$1', [inactivo.id]); // fixture sintético
  // Datos asociados que NO deben cambiar.
  await sistema.perfil.actualizar(cliente.id, { alergias: 'Alergia sintética', objetivoNutricional: 'Objetivo sintético' });
  await sistema.consultas.enviar(cliente.id, 'Consulta sintética');
  const cat = await sistema.catalogoComercial.guardar(admin.id, 'categorias', null, { nombre: 'Roles cat' });
  const prod = await sistema.catalogoComercial.guardar(admin.id, 'productos', null, { nombre: 'Producto roles', categoriaId: cat.id, estado: true, precio: '5.00' });
  await sistema.inventario.registrar(admin.id, { productoId: prod.id, tipo: 'AJUSTE', cantidad: 5, motivo: 'Fixture roles' });
  await sistema.pedidos.crearPedido({ id: cliente.id, rol: 'CLIENTE' }, [{ productoId: prod.id, cantidad: 1 }]);

  const instantanea = async uid => ({
    usuario: (await pool.query('SELECT id_usuario,nombre,apellido,correo,password_hash,estado,fecha_creacion,datos_legado FROM usuarios WHERE id_usuario=$1', [uid])).rows,
    perfil: (await pool.query('SELECT * FROM perfil_cliente WHERE id_usuario=$1', [uid])).rows,
    preferencias: (await pool.query('SELECT * FROM preferencias_cliente WHERE id_usuario=$1 ORDER BY id_preferencia', [uid])).rows,
    pedidos: (await pool.query('SELECT p.*, d.id_detalle, d.cantidad, d.precio_unitario FROM pedidos p JOIN detalle_pedido d USING(id_pedido) WHERE id_cliente=$1 ORDER BY id_detalle', [uid])).rows,
    conversaciones: (await pool.query('SELECT c.*, m.id_mensaje, m.tipo, m.contenido FROM conversaciones_ia c JOIN mensajes_ia m USING(id_conversacion) WHERE c.id_usuario=$1 ORDER BY m.id_mensaje', [uid])).rows,
    inventario: (await pool.query('SELECT * FROM inventario ORDER BY id_producto')).rows,
  });
  const rolDe = async uid => (await pool.query('SELECT r.nombre FROM usuarios u JOIN roles r USING(id_rol) WHERE id_usuario=$1', [uid])).rows[0].nombre;
  const auditorias = async uid => (await pool.query("SELECT * FROM auditoria WHERE accion='CAMBIO_ROL' AND id_entidad=$1 ORDER BY fecha", [String(uid)])).rows;
  const totalUsuarios = async () => (await pool.query('SELECT count(*)::int n FROM usuarios')).rows[0].n;

  server = crearApp(sistema).listen(0, '127.0.0.1'); await new Promise(r => server.once('listening', r));
  const api = async (method, url, body, token) => {
    const r = await fetch(`http://127.0.0.1:${server.address().port}/api${url}`, { method,
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: r.status, data: await r.json() };
  };
  const tokenCliente = generarToken(cliente);

  await t.test('usuario:listar es de solo lectura y no expone hashes ni datos cifrados', async () => {
    const filas = await listarUsuarios(pool);
    assert.deepEqual(Object.keys(filas[0]).sort(), ['activo', 'correo', 'id', 'nombre', 'rol']);
    assert.ok(filas.some(f => f.correo === 'cliente.roles@example.test' && f.rol === 'CLIENTE' && f.activo === 'sí'));
    assert.ok(filas.some(f => f.correo === 'inactivo@example.test' && f.activo === 'no'));
    assert.doesNotMatch(JSON.stringify(filas), /\$2[aby]\$|hash-sintetico|Alergia/);
    assert.ok(filas.every(f => f.id.length === 8));
  });

  await t.test('9 (antes). El mismo JWT de CLIENTE no accede a administración', async () => {
    assert.equal((await api('GET', '/inventario', undefined, tokenCliente)).status, 403);
  });

  await t.test('1-2. Promover CLIENTE → ADMINISTRADOR cambia solo id_rol/fecha_actualizacion y audita CAMBIO_ROL una vez', async () => {
    const antes = await instantanea(cliente.id), n = await totalUsuarios();
    const r = await asignarRol(pool, ['cliente.roles@example.test', 'ADMINISTRADOR']);
    assert.deepEqual(r, { cambiado: true, id: cliente.id.slice(0, 8), rolAnterior: 'CLIENTE', rolNuevo: 'ADMINISTRADOR' });
    assert.equal(await rolDe(cliente.id), 'ADMINISTRADOR');
    assert.deepEqual(await instantanea(cliente.id), antes, 'hash, perfil, preferencias, pedidos, conversaciones e inventario intactos');
    assert.ok((await pool.query('SELECT fecha_actualizacion FROM usuarios WHERE id_usuario=$1', [cliente.id])).rows[0].fecha_actualizacion);
    assert.equal(await totalUsuarios(), n, 'no crea usuarios');
    const a = await auditorias(cliente.id);
    assert.equal(a.length, 1);
    assert.equal(a[0].entidad, 'usuarios'); assert.equal(a[0].recurso_accedido, 'cli:usuario:asignar-rol');
    assert.deepEqual(a[0].datos_anteriores, { rol: 'CLIENTE' }); assert.deepEqual(a[0].datos_nuevos, { rol: 'ADMINISTRADOR' });
    assert.doesNotMatch(JSON.stringify(a[0]), /cliente\.roles@example\.test|\$2[aby]\$|Bearer|eyJ/);
  });

  await t.test('9 (después). El mismo JWT obtiene permisos de administrador: el rol se resuelve desde PostgreSQL', async () => {
    assert.equal((await api('GET', '/inventario', undefined, tokenCliente)).status, 200);
    assert.equal((await api('POST', '/categorias', { nombre: 'Categoría creada tras promoción' }, tokenCliente)).status, 201);
  });

  await t.test('6. Mismo rol: sin cambios ni auditoría duplicada', async () => {
    const fecha = (await pool.query('SELECT fecha_actualizacion FROM usuarios WHERE id_usuario=$1', [cliente.id])).rows[0].fecha_actualizacion;
    const r = await asignarRol(pool, ['cliente.roles@example.test', 'ADMINISTRADOR']);
    assert.equal(r.cambiado, false);
    assert.equal((await auditorias(cliente.id)).length, 1);
    assert.deepEqual((await pool.query('SELECT fecha_actualizacion FROM usuarios WHERE id_usuario=$1', [cliente.id])).rows[0].fecha_actualizacion, fecha);
  });

  await t.test('8. Correo con mayúsculas y espacios localiza la misma cuenta', async () => {
    const r = await asignarRol(pool, ['  CLIENTE.Roles@Example.TEST ', 'EMPLEADO']);
    assert.equal(r.cambiado, true); assert.equal(r.rolAnterior, 'ADMINISTRADOR');
    assert.equal(await rolDe(cliente.id), 'EMPLEADO');
    assert.equal((await auditorias(cliente.id)).length, 2);
  });

  await t.test('3. Correo inexistente: error, sin crear usuario, sin cambios ni auditoría', async () => {
    const n = await totalUsuarios(), na = (await pool.query("SELECT count(*)::int n FROM auditoria WHERE accion='CAMBIO_ROL'")).rows[0].n;
    await assert.rejects(asignarRol(pool, ['no.existe@example.test', 'ADMINISTRADOR']), e => e.codigo === 'USUARIO_NO_ENCONTRADO');
    assert.equal(await totalUsuarios(), n);
    assert.equal((await pool.query("SELECT count(*)::int n FROM auditoria WHERE accion='CAMBIO_ROL'")).rows[0].n, na);
  });

  await t.test('4. Rol inválido rechazado antes de tocar la base', async () => {
    let conexiones = 0;
    const espia = { connect: () => { conexiones++; return pool.connect(); } };
    for (const rol of ['PERSONAL_NUTRIVIDA', 'root', "x'); UPDATE usuarios SET id_rol=3;--"])
      await assert.rejects(asignarRol(espia, ['cliente.roles@example.test', rol]), e => e.codigo === 'ROL_INVALIDO');
    assert.equal(conexiones, 0);
    assert.equal(await rolDe(cliente.id), 'EMPLEADO');
  });

  await t.test('5. Cuenta inactiva rechazada sin cambios', async () => {
    await assert.rejects(asignarRol(pool, ['inactivo@example.test', 'ADMINISTRADOR']), e => e.codigo === 'USUARIO_INACTIVO');
    assert.equal(await rolDe(inactivo.id), 'CLIENTE');
    assert.equal((await auditorias(inactivo.id)).length, 0);
  });

  await t.test('7. Si la auditoría falla, ROLLBACK completo: el rol no cambia', async () => {
    const fallaAuditoria = { connect: async () => {
      const c = await pool.connect(), q = c.query.bind(c);
      c.query = (sql, ...r) => typeof sql === 'string' && sql.includes('INSERT INTO auditoria') ? Promise.reject(Object.assign(new Error('fallo inducido'), { code: '23514' })) : q(sql, ...r);
      const liberar = c.release.bind(c); // restaurar el cliente antes de devolverlo al pool
      c.release = (...a) => { c.query = q; c.release = liberar; return liberar(...a); };
      return c; } };
    await assert.rejects(asignarRol(fallaAuditoria, ['cliente.roles@example.test', 'ADMINISTRADOR']));
    assert.equal(await rolDe(cliente.id), 'EMPLEADO');
    assert.equal((await auditorias(cliente.id)).length, 2);
  });

  await t.test('10. Registro público: rol ADMINISTRADOR → 400; registro normal sigue creando CLIENTE', async () => {
    const n = await totalUsuarios();
    for (const rol of ['ADMINISTRADOR', 'EMPLEADO', 'CLIENTE'])
      assert.equal((await api('POST', '/auth/register', { nombre: 'Intruso', correo: `intruso-${rol}@example.test`, password: 'Clave12345', rol })).status, 400);
    assert.equal((await api('POST', '/auth/register', { nombre: 'Intruso', correo: 'intruso2@example.test', password: 'Clave12345', id_rol: 3 })).status, 400);
    assert.equal(await totalUsuarios(), n);
    const ok = await api('POST', '/auth/register', { nombre: 'Normal', correo: 'normal@example.test', password: 'Clave12345' });
    assert.equal(ok.status, 201); assert.equal(ok.data.usuario.rol, 'CLIENTE');
    assert.equal((await pool.query("SELECT r.nombre FROM usuarios u JOIN roles r USING(id_rol) WHERE correo='normal@example.test'")).rows[0].nombre, 'CLIENTE');
    assert.ok(!(await auditorias(ok.data.usuario.id)).length);
  });
});
