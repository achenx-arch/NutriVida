const { ErrorAplicacion } = require('../errors/ErrorAplicacion');
const { normalizarRol } = require('../domain/roles');

// RBAC de pedidos (FASE 6). Primero se autoriza el rol; después el repositorio
// valida la transición con la máquina de estados dentro de la transacción.
const ESTADOS_OPERATIVOS = Object.freeze(['CONFIRMADO', 'EN_PREPARACION', 'LISTO', 'ENTREGADO']);
const ESTADOS_PERMITIDOS_POR_ROL = Object.freeze({
  CLIENTE: Object.freeze(['CANCELADO']), // solo su propio pedido; la propiedad se comprueba con FOR UPDATE
  // El personal gestiona pedidos; cualquier estado que solicite pasa después por la
  // máquina de estados (p. ej. volver a PENDIENTE responde 409, no se concede).
  EMPLEADO: Object.freeze(['PENDIENTE', ...ESTADOS_OPERATIVOS, 'CANCELADO']),
  ADMINISTRADOR: Object.freeze(['PENDIENTE', ...ESTADOS_OPERATIVOS, 'CANCELADO']),
});

function autorizarCambioEstado(usuario, nuevoEstado) {
  const rol = normalizarRol(usuario?.rol);
  const permitidos = ESTADOS_PERMITIDOS_POR_ROL[rol];
  if (!permitidos || !permitidos.includes(nuevoEstado)) {
    throw new ErrorAplicacion('No tienes permiso para esta operación de pedido.', 403, 'ACCESO_DENEGADO');
  }
  return rol;
}

class ServicioPedidos {
  constructor(repositorioPedidos, repositorioInventario) {
    this.repositorio = repositorioPedidos;
    this.inventario = repositorioInventario;
  }

  async crearPedido(usuario, items) {
    if (!usuario || !usuario.id) throw new ErrorAplicacion('Usuario no autenticado.', 401);
    return this.repositorio.crear(usuario.id, items);
  }

  async obtenerPedido(usuario, idPedido) {
    if (!usuario || !usuario.id) throw new ErrorAplicacion('Usuario no autenticado.', 401);
    return this.repositorio.obtenerPorId(idPedido, usuario.id, normalizarRol(usuario.rol));
  }

  async listarPedidos(usuario, filtros) {
    if (!usuario || !usuario.id) throw new ErrorAplicacion('Usuario no autenticado.', 401);
    return this.repositorio.listar(filtros, usuario.id, normalizarRol(usuario.rol));
  }

  async cambiarEstado(usuario, idPedido, nuevoEstado) {
    if (!usuario || !usuario.id) throw new ErrorAplicacion('Usuario no autenticado.', 401);
    const rol = autorizarCambioEstado(usuario, nuevoEstado);
    // El repositorio repite la comprobación (defensa en profundidad) y valida la transición.
    return this.repositorio.transicionarEstado(idPedido, nuevoEstado, usuario.id, rol, this.inventario);
  }
}

module.exports = { ServicioPedidos, autorizarCambioEstado, ESTADOS_PERMITIDOS_POR_ROL };
