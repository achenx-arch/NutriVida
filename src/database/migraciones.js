const fs = require("node:fs");
const path = require("node:path");
const { createHash } = require("node:crypto");
const { transaccion } = require("./transaccion");
const raiz = path.resolve(__dirname, "../../database");
async function migrar(pool, { esquemaControl = "infra" } = {}) {
  if (!/^(infra|nv_test_control_[a-f0-9]+)$/.test(esquemaControl)) throw new Error("ESQUEMA_CONTROL_INVALIDO");
  return transaccion(pool, async (db) => {
    await db.query("SELECT pg_advisory_xact_lock(20660201)");
    await db.query(`CREATE SCHEMA IF NOT EXISTS ${esquemaControl}`);
    await db.query(`CREATE TABLE IF NOT EXISTS ${esquemaControl}.schema_migrations (
      version VARCHAR(100) PRIMARY KEY, checksum CHAR(64) NOT NULL, aplicada_en TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP)`);
    const resultado = [];
    for (const carpeta of ["migrations", "seeds"]) {
      for (const nombre of fs.readdirSync(path.join(raiz, carpeta)).filter(n => n.endsWith(".sql")).sort()) {
        const version = `${carpeta}/${nombre}`;
        const sql = fs.readFileSync(path.join(raiz, carpeta, nombre), "utf8");
        const hash = createHash("sha256").update(sql).digest("hex");
        const anterior = await db.query(`SELECT checksum FROM ${esquemaControl}.schema_migrations WHERE version=$1`, [version]);
        if (anterior.rowCount) {
          if (anterior.rows[0].checksum !== hash) throw new Error("MIGRACION_MODIFICADA: no alterar SQL ya aplicado.");
          resultado.push({ version, estado: "ya_aplicada" });
          continue;
        }
        await db.query(sql); // Solo archivos SQL versionados del proyecto, sin entradas del usuario.
        await db.query(`INSERT INTO ${esquemaControl}.schema_migrations(version,checksum) VALUES($1,$2)`, [version,hash]);
        resultado.push({ version, estado: "aplicada" });
      }
    }
    return resultado;
  });
}
module.exports = { migrar };
