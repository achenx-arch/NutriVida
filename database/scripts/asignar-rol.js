// Asignación EXPLÍCITA de rol desde terminal (desarrollo/administración).
//   npm run usuario:asignar-rol -- <correo> <CLIENTE|EMPLEADO|ADMINISTRADOR>
// No crea usuarios ni contraseñas; solo cambia usuarios.id_rol y fecha_actualizacion,
// y registra CAMBIO_ROL en auditoria dentro de la misma transacción.
const { randomUUID } = require("node:crypto");
const { RolUsuario } = require("../../src/domain/roles");
const { transaccion } = require("../../src/database/transaccion");

const ROLES_ASIGNABLES = Object.freeze([RolUsuario.CLIENTE, RolUsuario.EMPLEADO, RolUsuario.ADMINISTRADOR]);
const CORREO = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
class ErrorRol extends Error { constructor(codigo) { super(codigo); this.codigo = codigo; } }

// Validación sin base de datos: se ejecuta antes de abrir cualquier conexión.
function validarArgumentos(args) {
  if (!Array.isArray(args) || args.length !== 2) throw new ErrorRol("USO: npm run usuario:asignar-rol -- <correo> <CLIENTE|EMPLEADO|ADMINISTRADOR>");
  const [correoCrudo, rol] = args;
  const correo = typeof correoCrudo === "string" ? correoCrudo.trim().toLowerCase() : "";
  if (!correo || correo.length > 150 || !CORREO.test(correo)) throw new ErrorRol("CORREO_INVALIDO");
  if (typeof rol !== "string" || !ROLES_ASIGNABLES.includes(rol)) throw new ErrorRol("ROL_INVALIDO");
  return { correo, rol };
}

async function asignarRol(pool, args) {
  const { correo, rol } = validarArgumentos(args);
  return transaccion(pool, async db => {
    const destino = (await db.query("SELECT id_rol FROM roles WHERE nombre=$1", [rol])).rows[0];
    if (!destino) throw new ErrorRol("ROL_NO_EXISTE_EN_POSTGRESQL");
    const u = (await db.query(
      `SELECT u.id_usuario, u.estado, u.id_rol, r.nombre AS rol FROM usuarios u JOIN roles r USING(id_rol)
       WHERE lower(btrim(u.correo)) = lower(btrim($1)) FOR UPDATE OF u`, [correo])).rows[0];
    if (!u) throw new ErrorRol("USUARIO_NO_ENCONTRADO");
    if (u.estado !== true) throw new ErrorRol("USUARIO_INACTIVO");
    const id = String(u.id_usuario).slice(0, 8);
    if (u.rol === rol) return { cambiado: false, id, rolAnterior: u.rol, rolNuevo: rol };
    const r = await db.query("UPDATE usuarios SET id_rol=$2, fecha_actualizacion=CURRENT_TIMESTAMP WHERE id_usuario=$1", [u.id_usuario, destino.id_rol]);
    if (r.rowCount !== 1) throw new ErrorRol("ACTUALIZACION_INESPERADA");
    // Sin correo, hash, tokens ni datos cifrados.
    await db.query(`INSERT INTO auditoria(id_auditoria,id_usuario,accion,entidad,id_entidad,recurso_accedido,datos_anteriores,datos_nuevos,fecha)
      VALUES($1,$2,'CAMBIO_ROL','usuarios',$3,'cli:usuario:asignar-rol',$4,$5,clock_timestamp())`,
      [randomUUID(), u.id_usuario, String(u.id_usuario), { rol: u.rol }, { rol }]);
    return { cambiado: true, id, rolAnterior: u.rol, rolNuevo: rol };
  });
}

module.exports = { asignarRol, validarArgumentos, ROLES_ASIGNABLES, ErrorRol };

if (require.main === module) {
  let args;
  try { args = validarArgumentos(process.argv.slice(2)); } // antes de conectar
  catch (e) { console.error(e.codigo); process.exitCode = 1; return; }
  const { crearPool } = require("../../src/database/pool");
  const pool = crearPool();
  asignarRol(pool, [args.correo, args.rol])
    .then(r => console.log(r.cambiado ? `Rol actualizado: usuario ${r.id}… ${r.rolAnterior} → ${r.rolNuevo}. La sesión debe iniciarse de nuevo para ver el menú.`
      : `Sin cambios: usuario ${r.id}… ya tiene el rol ${r.rolNuevo}.`))
    .catch(e => { console.error(e instanceof ErrorRol ? e.codigo : (e.codigo || "OPERACION_DB_FALLIDA")); process.exitCode = 1; })
    .finally(() => pool.end());
}
