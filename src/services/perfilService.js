const { ErrorAplicacion } = require("../errors/ErrorAplicacion");
const { opciones: opcionesAlimentacion } = require("./catalogoAlimentacion");
function errorHttp(mensaje, status) { return new ErrorAplicacion(mensaje, status); }

class ModuloPerfilCliente {
  constructor(repositorios, auditoria) { this.repos = repositorios; this.auditoria = auditoria; }
  async obtener(id) {
    const usuario = await this.repos.usuarios.buscarPorId(id);
    if (!usuario) throw errorHttp("Usuario no encontrado.", 404);
    await this.auditoria.registrarAcceso(usuario, "consulta_perfil_propio", `usuarios/${id}`);
    return usuario.perfilSalud;
  }
  // FASE 9A: consentimientos independientes (perfil / historial de compras). Solo el propio CLIENTE (JWT).
  async consentimientos(id) {
    const usuario = await this.repos.usuarios.buscarPorId(id);
    if (!usuario) throw errorHttp("Usuario no encontrado.", 404);
    return { autorizaContextoIA: usuario.autorizaContextoIA === true, autorizaHistorialIA: usuario.autorizaHistorialIA === true };
  }
  async actualizarConsentimientos(id, cambios) {
    const usuario = await this.repos.usuarios.buscarPorId(id);
    if (!usuario) throw errorHttp("Usuario no encontrado.", 404);
    if (!this.repos.usuarios.actualizarConsentimientos)
      throw new ErrorAplicacion("La gestión de consentimientos requiere PostgreSQL.", 503, "CONSENTIMIENTO_NO_DISPONIBLE");
    // La auditoría de cada cambio efectivo se registra en la misma transacción del repositorio.
    return (await this.repos.usuarios.actualizarConsentimientos(usuario.id, cambios)).consentimientos;
  }
  // FASE 9B-2: datos alimentarios estructurados del propio CLIENTE (JWT). Administrarlos NO activa ni requiere el
  // consentimiento de perfil; su uso en recomendaciones depende SOLO de autoriza_contexto_ia === true (consultasService).
  async alimentacion(id) {
    const usuario = await this.repos.usuarios.buscarPorId(id);
    if (!usuario) throw errorHttp("Usuario no encontrado.", 404);
    if (!this.repos.usuarios.obtenerAlimentacion)
      throw new ErrorAplicacion("La gestión de alimentación requiere PostgreSQL.", 503, "ALIMENTACION_NO_DISPONIBLE");
    const alimentacion = await this.repos.usuarios.obtenerAlimentacion(usuario.id);
    await this.auditoria.registrarAcceso(usuario, "consulta_alimentacion_propia", `usuarios/${id}`);
    return { alimentacion, opciones: opcionesAlimentacion(),
      consentimientos: { autorizaContextoIA: usuario.autorizaContextoIA === true, autorizaHistorialIA: usuario.autorizaHistorialIA === true } };
  }
  async actualizarAlimentacion(id, cambios) {
    const usuario = await this.repos.usuarios.buscarPorId(id);
    if (!usuario) throw errorHttp("Usuario no encontrado.", 404);
    if (!this.repos.usuarios.actualizarAlimentacion)
      throw new ErrorAplicacion("La gestión de alimentación requiere PostgreSQL.", 503, "ALIMENTACION_NO_DISPONIBLE");
    // La auditoría (solo nombres de grupos) se registra en la misma transacción del repositorio.
    const alimentacion = await this.repos.usuarios.actualizarAlimentacion(usuario.id, cambios);
    return { alimentacion, consentimientos: { autorizaContextoIA: usuario.autorizaContextoIA === true, autorizaHistorialIA: usuario.autorizaHistorialIA === true } };
  }
  async actualizar(id, datos) {
    const usuario = await this.repos.usuarios.buscarPorId(id);
    if (!usuario) throw errorHttp("Usuario no encontrado.", 404);
    usuario.actualizarPerfil(datos);
    await this.repos.usuarios.guardar(usuario);
    await this.auditoria.registrarAcceso(usuario, "actualizacion_perfil_salud", `usuarios/${id}`);
    return usuario.perfilSalud;
  }
}

const ModuloPerfilSalud = ModuloPerfilCliente;
module.exports = { ModuloPerfilCliente, ModuloPerfilSalud };
