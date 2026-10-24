// Carga y valida las variables de entorno una sola vez, al iniciar el servidor.
// Ningun otro archivo del proyecto debe leer process.env directamente:
// todos importan la configuracion desde aqui (RNF-01).
require("dotenv").config();

function requerido(nombre) {
  const valor = process.env[nombre];
  if (!valor) {
    throw new Error(
      `Falta la variable de entorno "${nombre}". Revisa tu archivo .env (usa .env.example como referencia).`
    );
  }
  return valor;
}

const env = {
  port: process.env.PORT || 3000,
  produccion: process.env.NODE_ENV === "production",
  corsOrigins: (process.env.CORS_ORIGINS || "").split(",").map(x=>x.trim()).filter(Boolean),
  persistencia: process.env.PERSISTENCE_DRIVER || "json",
  db: {
    host: process.env.DB_HOST || "", port: Number(process.env.DB_PORT || 0),
    database: process.env.DB_NAME || "", user: process.env.DB_USER || "",
    password: process.env.DB_PASSWORD || "", testDatabase: process.env.DB_TEST_NAME || "",
  },

  ollamaBaseUrl: process.env.OLLAMA_BASE_URL?.trim() || "http://localhost:11434",
  ollamaModel: process.env.OLLAMA_MODEL?.trim() || "",
  ollamaTimeoutMs: Number(process.env.OLLAMA_TIMEOUT_MS || 15000),
  // Directorio de imágenes de productos (servido como /images/productos/). Solo se cambia en pruebas.
  imagenesProductosDir: process.env.IMAGENES_PRODUCTOS_DIR || require("path").join(__dirname, "..", "..", "public", "images", "productos"),

  jwtSecret: requerido("JWT_SECRET"),
  encryptionKey: requerido("ENCRYPTION_KEY"),
};

if (!Number.isFinite(env.ollamaTimeoutMs) || env.ollamaTimeoutMs <= 0) {
  env.ollamaTimeoutMs = 15000;
}

if (!/^[0-9a-fA-F]{64}$/.test(env.encryptionKey)) {
  throw new Error(
    "ENCRYPTION_KEY debe tener exactamente 64 caracteres hexadecimales (32 bytes). " +
      "Generala con: node -e \"console.log(require('crypto').randomBytes(32).toString('hex'))\""
  );
}

module.exports = env;
