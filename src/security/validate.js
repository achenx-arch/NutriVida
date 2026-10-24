// Validación y saneamiento de entradas del usuario (RF-11).
// Se aplica SIEMPRE antes de: (a) persistir un dato, y (b) enviarlo a la API de IA.

const LONGITUD_MAXIMA_CONSULTA = 500;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const { ErrorAplicacion } = require("../errors/ErrorAplicacion");

class ErrorValidacion extends ErrorAplicacion {
  constructor(mensaje) {
    super(mensaje, 400);
    this.name = "ErrorValidacion";
    this.status = 400;
  }
}

/**
 * Elimina caracteres de control y espacios redundantes.
 * No intenta "interpretar" el texto, solo limpiarlo.
 */
function sanearTexto(texto) {
  if (typeof texto !== "string") return "";
  return texto
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "") // caracteres de control
    .trim()
    .replace(/\s{2,}/g, " ");
}

function validarConsulta(textoOriginal) {
  const texto = sanearTexto(textoOriginal);

  if (!texto) {
    throw new ErrorValidacion("La consulta no puede estar vacía.");
  }
  if (texto.length > LONGITUD_MAXIMA_CONSULTA) {
    throw new ErrorValidacion(
      `La consulta supera el máximo permitido de ${LONGITUD_MAXIMA_CONSULTA} caracteres.`
    );
  }

  // Mitigación básica de intentos de "prompt injection": el sistema NUNCA
  // trata este texto como instrucciones del sistema, solo como el contenido
  // de la consulta del cliente (ver services/iaService.js, que separa
  // claramente las instrucciones del sistema del texto del usuario).
  return texto;
}

function validarRegistro({ nombre, correo, password }) {
  const errores = [];
  if (!nombre || (sanearTexto(nombre).length < 2 || sanearTexto(nombre).length > 80)) {
    errores.push("El nombre debe tener al menos 2 caracteres.");
  }
  if (typeof correo !== "string" || (correo.trim().length > 150 || !EMAIL_REGEX.test(correo.trim()))) {
    errores.push("El correo electrónico no es válido.");
  }
  if (typeof password !== "string" || password.length < 8 || (typeof password === "string" && Buffer.byteLength(password,"utf8") > 72)) {
    errores.push("La contraseña debe tener al menos 8 caracteres y como máximo 72 bytes UTF-8.");
  }
  if (errores.length > 0) {
    throw new ErrorValidacion(errores.join(" "));
  }
  return {
    nombre: sanearTexto(nombre),
    correo: sanearTexto(correo).toLowerCase(),
    password,
  };
}

function validarPerfilSalud({ condicionesMedicas, alergias, objetivoNutricional }) {
  return {
    condicionesMedicas: sanearTexto(condicionesMedicas || ""),
    alergias: sanearTexto(alergias || ""),
    objetivoNutricional: sanearTexto(objetivoNutricional || ""),
  };
}

function validarProducto({ nombre, ingredientes, valoresNutricionales, categoria }) {
  if (!nombre || sanearTexto(nombre).length < 2) {
    throw new ErrorValidacion("El nombre del producto no es válido.");
  }
  return {
    nombre: sanearTexto(nombre),
    ingredientes: sanearTexto(ingredientes || ""),
    valoresNutricionales: sanearTexto(valoresNutricionales || ""),
    categoria: sanearTexto(categoria || "General"),
  };
}

module.exports = {
  UUID,
  ErrorValidacion,
  sanearTexto,
  validarConsulta,
  validarRegistro,
  validarPerfilSalud,
  validarProducto,
  LONGITUD_MAXIMA_CONSULTA,
};
