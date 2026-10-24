// Solo estos errores contienen mensajes preparados para mostrarse al cliente.
class ErrorAplicacion extends Error {
  constructor(mensaje, status = 400, codigo) {
    super(mensaje);
    this.name = this.constructor.name;
    this.status = status;
    this.codigo = codigo;
  }
}

module.exports = { ErrorAplicacion };
