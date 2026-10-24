// Listado de SOLO LECTURA: ID corto, nombre, correo, rol y estado. Sin hashes, perfiles ni datos cifrados.
//   npm run usuario:listar
async function listarUsuarios(pool) {
  const cliente = await pool.connect();
  try {
    await cliente.query("BEGIN READ ONLY");
    const filas = (await cliente.query(
      `SELECT left(u.id_usuario::text, 8) AS id, u.nombre, u.correo, r.nombre AS rol, u.estado AS activo
       FROM usuarios u JOIN roles r USING(id_rol) ORDER BY u.fecha_creacion NULLS FIRST, u.id_usuario`)).rows;
    await cliente.query("COMMIT");
    return filas.map(f => ({ id: f.id, nombre: f.nombre, correo: f.correo, rol: f.rol, activo: f.activo === true ? "sí" : "no" }));
  } catch (e) { await cliente.query("ROLLBACK").catch(() => {}); throw e; }
  finally { cliente.release(); }
}
module.exports = { listarUsuarios };
if (require.main === module) {
  const { crearPool } = require("../../src/database/pool");
  const pool = crearPool();
  listarUsuarios(pool).then(f => { console.table(f); console.log(`${f.length} usuarios`); })
    .catch(e => { console.error(e.codigo || e.code || "OPERACION_DB_FALLIDA"); process.exitCode = 1; })
    .finally(() => pool.end());
}
