const { Pool } = require("pg");
const env = require("../config/env");
const { ErrorAplicacion } = require("../errors/ErrorAplicacion");
function crearPool({ pruebas = false, schema } = {}) {
  const db = env.db;
  const database = pruebas ? db.testDatabase : db.database;
  if (![db.host, db.port, database, db.user, db.password].every(Boolean)) {
    throw new ErrorAplicacion("Configura DB_HOST, DB_PORT, DB_NAME, DB_USER y DB_PASSWORD en .env; para pruebas, DB_TEST_NAME.", 503, "DB_NO_CONFIGURADA");
  }
  if (pruebas && database === db.database) throw new ErrorAplicacion("DB_TEST_NAME debe ser distinta de DB_NAME.", 503, "DB_PRUEBA_INVALIDA");
  if (schema && (!pruebas || !/^nv_test_[a-f0-9]+$/.test(schema))) throw new Error("ESQUEMA_PRUEBA_INVALIDO");
  const pool = new Pool({ host: db.host, port: db.port, database, user: db.user, password: db.password,
    options: `-c search_path=${schema || "public"}`,
    max: 5, connectionTimeoutMillis: 5000, idleTimeoutMillis: 10000, statement_timeout: 15000 });
  pool.on("error", () => console.error("DB_NO_DISPONIBLE: conexión inactiva interrumpida."));
  return pool;
}
module.exports = { crearPool };
