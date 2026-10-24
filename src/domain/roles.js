const RolUsuario = Object.freeze({
  CLIENTE: "CLIENTE", EMPLEADO: "EMPLEADO", ADMINISTRADOR: "ADMINISTRADOR",
  PERSONAL_NUTRIVIDA: "PERSONAL_NUTRIVIDA", // Alias legado; no usar para cuentas nuevas.
});
const Permiso = Object.freeze({ GESTIONAR_INVENTARIO: "GESTIONAR_INVENTARIO", GESTIONAR_CATALOGO: "GESTIONAR_CATALOGO", REVISAR_CONSULTAS: "REVISAR_CONSULTAS" });
function normalizarRol(rol) { return rol === RolUsuario.PERSONAL_NUTRIVIDA ? RolUsuario.EMPLEADO : rol; }
function permisosDe(usuario) {
  // FASE 2: el origen PERSONAL_NUTRIVIDA es solo trazabilidad, sin privilegios.
  return normalizarRol(usuario.rol) === RolUsuario.ADMINISTRADOR ? Object.values(Permiso) : normalizarRol(usuario.rol) === RolUsuario.EMPLEADO ? [Permiso.GESTIONAR_INVENTARIO] : [];
}
function tienePermiso(usuario, permiso) { return !!usuario && permisosDe(usuario).includes(permiso); }
module.exports = { RolUsuario, Permiso, normalizarRol, permisosDe, tienePermiso };
