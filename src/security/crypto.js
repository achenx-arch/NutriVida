// Cifrado simétrico (AES-256-GCM) para datos sensibles del cliente:
// condiciones médicas y alergias (RNF-02). La llave nunca está en el
// código: se lee desde variables de entorno (ver src/config/env.js).

const crypto = require("crypto");
const env = require("../config/env");

const ALGORITMO = "aes-256-gcm";
const CLAVE = Buffer.from(env.encryptionKey, "hex"); // 32 bytes

function cifrar(textoPlano) {
  if (textoPlano === null || textoPlano === undefined || textoPlano === "") {
    return null;
  }
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGORITMO, CLAVE, iv);
  const cifrado = Buffer.concat([cipher.update(String(textoPlano), "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  // Formato almacenado: iv:authTag:datosCifrados (todo en hexadecimal)
  return `${iv.toString("hex")}:${authTag.toString("hex")}:${cifrado.toString("hex")}`;
}

function descifrar(valorCifrado) {
  if (!valorCifrado) return null;
  const [ivHex, authTagHex, dataHex] = valorCifrado.split(":");
  if (!ivHex || !authTagHex || !dataHex) {
    throw new Error("Formato de dato cifrado inválido.");
  }
  const iv = Buffer.from(ivHex, "hex");
  const authTag = Buffer.from(authTagHex, "hex");
  const datos = Buffer.from(dataHex, "hex");

  const decipher = crypto.createDecipheriv(ALGORITMO, CLAVE, iv);
  decipher.setAuthTag(authTag);
  const descifrado = Buffer.concat([decipher.update(datos), decipher.final()]);
  return descifrado.toString("utf8");
}

module.exports = { cifrar, descifrar };
