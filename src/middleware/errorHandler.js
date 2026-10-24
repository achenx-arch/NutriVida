const { ErrorAplicacion } = require("../errors/ErrorAplicacion");

function errorHandler(err, req, res, next) {
  if (res.headersSent) return next(err);
  let status = 500;
  let mensaje = "Ocurrió un error inesperado. Intenta de nuevo más tarde.";
  let codigo;
  if (err instanceof ErrorAplicacion) {
    status = err.status;
    mensaje = err.message;
    codigo = err.codigo;
  } else if (err.type === "entity.parse.failed") {
    status = 400;
    mensaje = "El cuerpo de la solicitud debe ser JSON válido.";
  } else if (err.type === "entity.too.large") {
    status = 413;
    mensaje = "La solicitud supera el tamaño permitido.";
  }
  // No registrar perfiles, consultas, tokens ni mensajes privados del proveedor.
  console.error(`[${new Date().toISOString()}] HTTP ${status}; código: ${codigo || "ERROR_SOLICITUD"}`);
  res.status(status).json({ error: mensaje, codigo });
}
function rutaNoEncontrada(req, res) {
  res.status(404).json({ error: "Recurso no encontrado." });
}
module.exports = { errorHandler, rutaNoEncontrada };
