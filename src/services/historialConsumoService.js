const { ErrorAplicacion } = require('../errors/ErrorAplicacion');

class HistorialConsumoService {
  constructor(repositorioHistorialConsumo) {
    this.repositorio = repositorioHistorialConsumo;
  }

  async obtenerHistorialConsumo(usuario, filtros = {}) {
    if (!usuario || !usuario.id) {
      throw new ErrorAplicacion('Usuario no autenticado.', 401);
    }
    // Derivar identidad estrictamente desde autenticación JWT
    return this.repositorio.obtenerHistorial(usuario.id, filtros);
  }
}

module.exports = { HistorialConsumoService };
