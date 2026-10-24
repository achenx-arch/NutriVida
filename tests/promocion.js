// Evidencia de la promoción de rol (SOLO LECTURA). Huellas SHA-256: nunca muestra hashes ni datos cifrados.
//   node tests/promocion.js instantanea <correo>      > antes.json / despues.json
//   node tests/promocion.js comparar antes.json despues.json
const { createHash } = require('node:crypto');
const fs = require('node:fs');
const sha = v => 'sha256:' + createHash('sha256').update(JSON.stringify(v)).digest('hex').slice(0, 16);
async function instantanea(correo) {
  const { crearPool } = require('../src/database/pool');
  const pool = crearPool(), db = await pool.connect();
  try {
    await db.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    const q = async (sql, a = []) => (await db.query(sql, a)).rows;
    const u = (await q(`SELECT u.*, r.nombre rol FROM usuarios u JOIN roles r USING(id_rol) WHERE lower(btrim(correo))=lower(btrim($1))`, [correo]))[0];
    const out = { correo, existe: !!u,
      usuarios: (await q('SELECT left(u.id_usuario::text,8) id, u.correo, r.nombre rol FROM usuarios u JOIN roles r USING(id_rol) ORDER BY u.id_usuario')) };
    if (u) {
      const id = u.id_usuario;
      const { id_rol, rol, fecha_actualizacion, password_hash, ...resto } = u;
      Object.assign(out, { id: String(id).slice(0, 8), activo: u.estado === true, rol, fechaActualizacion: fecha_actualizacion,
        passwordHash: sha(password_hash), usuarioSinRolNiFecha: sha(resto),
        perfil: sha(await q('SELECT * FROM perfil_cliente WHERE id_usuario=$1', [id])),
        preferencias: sha(await q('SELECT * FROM preferencias_cliente WHERE id_usuario=$1 ORDER BY id_preferencia', [id])),
        pedidos: sha(await q('SELECT p.*, d.* FROM pedidos p LEFT JOIN detalle_pedido d USING(id_pedido) WHERE p.id_cliente=$1 ORDER BY p.id_pedido, d.id_detalle', [id])),
        conversaciones: sha(await q('SELECT c.*, m.id_mensaje, m.tipo, m.contenido, m.fecha mfecha FROM conversaciones_ia c LEFT JOIN mensajes_ia m USING(id_conversacion) WHERE c.id_usuario=$1 ORDER BY c.id_conversacion, m.id_mensaje', [id])),
        inventario: sha(await q('SELECT * FROM inventario ORDER BY id_producto')),
        cambiosRol: (await q("SELECT datos_anteriores, datos_nuevos, recurso_accedido, entidad, id_entidad, fecha, id_usuario FROM auditoria WHERE accion='CAMBIO_ROL' AND id_entidad=$1 ORDER BY fecha", [String(id)]))
          .map(a => ({ ...a, contieneSecretos: /\$2[aby]\$|eyJ|password|@/i.test(JSON.stringify({ a: a.datos_anteriores, n: a.datos_nuevos, r: a.recurso_accedido })) })) });
    }
    await db.query('ROLLBACK');
    return out;
  } finally { db.release(); await pool.end(); }
}
function comparar(a, d) {
  const ok = [], fallos = [];
  const chk = (c, m) => (c ? ok : fallos).push(m);
  chk(a.existe && a.activo, 'La cuenta existe y está activa antes del cambio');
  chk(a.rol === 'CLIENTE', `Rol anterior = CLIENTE (era ${a.rol})`);
  chk(d.rol === 'ADMINISTRADOR', `Rol nuevo = ADMINISTRADOR (es ${d.rol})`);
  chk(d.fechaActualizacion && d.fechaActualizacion !== a.fechaActualizacion, 'fecha_actualizacion actualizada');
  for (const k of ['passwordHash', 'usuarioSinRolNiFecha', 'perfil', 'preferencias', 'pedidos', 'conversaciones', 'inventario'])
    chk(a[k] === d[k], `${k} intacto`);
  const nuevos = d.cambiosRol.slice(a.cambiosRol.length);
  chk(nuevos.length === 1, `Exactamente un CAMBIO_ROL nuevo (hay ${nuevos.length})`);
  const e = nuevos[0] || {};
  chk(e.datos_anteriores?.rol === 'CLIENTE' && e.datos_nuevos?.rol === 'ADMINISTRADOR', 'datos_anteriores=CLIENTE, datos_nuevos=ADMINISTRADOR');
  chk(e.recurso_accedido === 'cli:usuario:asignar-rol' && e.entidad === 'usuarios', 'recurso cli:usuario:asignar-rol, entidad usuarios');
  chk(e.contieneSecretos === false, 'La auditoría no contiene contraseñas, JWT ni correo');
  const otrosA = a.usuarios.filter(u => u.id !== a.id), otrosD = d.usuarios.filter(u => u.id !== d.id);
  chk(JSON.stringify(otrosA) === JSON.stringify(otrosD), 'El resto de usuarios conserva su rol');
  chk(a.usuarios.length === d.usuarios.length, 'No se crearon ni eliminaron usuarios');
  return { cuenta: `${d.id}… (${d.correo})`, rolAnterior: a.rol, rolNuevo: d.rol, cambioRol: e.datos_anteriores ? { datos_anteriores: e.datos_anteriores, datos_nuevos: e.datos_nuevos, fecha: e.fecha } : null,
    usuarios: d.usuarios, aprobadas: ok, fallidas: fallos, resultado: fallos.length ? 'FALLÓ' : 'OK' };
}
const [modo, x, y] = process.argv.slice(2);
if (modo === 'instantanea') instantanea(x).then(r => console.log(JSON.stringify(r, null, 1))).catch(e => { console.error(e.codigo || e.message); process.exitCode = 1; });
else if (modo === 'comparar') { const r = comparar(JSON.parse(fs.readFileSync(x, 'utf8')), JSON.parse(fs.readFileSync(y, 'utf8'))); console.log(JSON.stringify(r, null, 1)); if (r.fallidas.length) process.exitCode = 1; }
else { console.error('USO: instantanea <correo> | comparar <antes.json> <despues.json>'); process.exitCode = 1; }
