const { cifrar, descifrar } = require("./crypto");
const { validarConsulta } = require("./validate");

class GestorSeguridad {
  cifrarDatoSensible(valor) { return cifrar(valor); }
  descifrarDatoSensible(valor) { return descifrar(valor); }
  validarEntrada(texto) { return validarConsulta(texto); }
}

module.exports = { GestorSeguridad };
