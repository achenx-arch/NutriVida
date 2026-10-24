// SOLO LECTURA. Instantánea y verificación de la carga del catálogo del PDF.
//   node database/scripts/catalogo-pdf-estado.js instantanea                > antes.json
//   node database/scripts/catalogo-pdf-estado.js verificar antes.json
const fs = require("node:fs"), path = require("node:path"), { createHash } = require("node:crypto");
const { prepararPlan, CATEGORIAS } = require("./cargar-catalogo-pdf");
const sha = v => createHash("sha256").update(JSON.stringify(v)).digest("hex").slice(0, 16);
const LEGADOS = () => JSON.parse(fs.readFileSync(path.join(__dirname, "../../data/db.json"), "utf8")).productos.map(p => p.id);

async function instantanea(pool) {
  const db = await pool.connect();
  try {
    await db.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    const q = async (s, a = []) => (await db.query(s, a)).rows;
    const legados = [];
    for (const id of LEGADOS()) {
      const fila = (await q("SELECT * FROM productos WHERE id_producto=$1", [id]))[0] || null;
      legados.push({ id: id.slice(0, 8), nombre: fila?.nombre ?? null, huella: sha({ fila, rel: await q("SELECT * FROM producto_ingrediente WHERE id_producto=$1 ORDER BY id_ingrediente", [id]),
        inv: await q("SELECT * FROM inventario WHERE id_producto=$1", [id]), cat: fila ? await q("SELECT * FROM categorias WHERE id_categoria=$1", [fila.id_categoria]) : null }) });
    }
    const n = async t => (await q(`SELECT count(*)::int n FROM ${t}`))[0].n;
    const r = { productos: await n("productos"), categorias: await n("categorias"), ingredientes: await n("ingredientes"), productoIngrediente: await n("producto_ingrediente"),
      inventario: await n("inventario"), movimientos: await n("movimientos_inventario"), pedidos: await n("pedidos"),
      productosConPrecio: (await q("SELECT count(*)::int n FROM productos WHERE precio IS NOT NULL"))[0].n,
      productosActivos: (await q("SELECT count(*)::int n FROM productos WHERE estado"))[0].n,
      categoriasExistentes: (await q("SELECT nombre, estado FROM categorias ORDER BY nombre")), legados };
    await db.query("ROLLBACK");
    return r;
  } finally { db.release(); }
}

async function verificar(pool, antes) {
  const plan = prepararPlan(), despues = await instantanea(pool), ok = [], fallas = [];
  const chk = (c, m) => (c ? ok : fallas).push(m);
  const db = await pool.connect();
  try {
    await db.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    const q = async (s, a = []) => (await db.query(s, a)).rows;
    const ids = plan.productos.map(p => p.id);
    const filas = await q(`SELECT p.*, c.nombre categoria FROM productos p JOIN categorias c USING(id_categoria) WHERE id_producto=ANY($1::uuid[])`, [ids]);
    chk(filas.length === 20, `20 productos del PDF presentes (${filas.length})`);
    if (antes) chk(despues.productos - antes.productos === 20 || despues.productos === antes.productos, `Productos nuevos: ${despues.productos - antes.productos} (20 en la primera carga, 0 si ya estaba cargado)`);
    for (const p of plan.productos) {
      const f = filas.find(x => x.id_producto === p.id); if (!f) { fallas.push(`Falta ${p.numero}. ${p.nombre}`); continue; }
      const errores = [];
      if (f.nombre !== p.nombre) errores.push("nombre"); if (f.categoria !== p.categoria) errores.push("categoría"); if (f.descripcion !== p.descripcion) errores.push("descripción");
      if (f.imagen_url !== p.imagenUrl) errores.push("imagen"); if (f.precio !== null) errores.push("precio NO NULL"); if (f.estado !== false) errores.push("ACTIVO");
      if (f.stock_minimo !== null) errores.push("stock mínimo"); if (f.valores_nutricionales !== null) errores.push("valores nutricionales");
      const rel = await q("SELECT i.nombre, pi.cantidad_descriptiva FROM producto_ingrediente pi JOIN ingredientes i USING(id_ingrediente) WHERE pi.id_producto=$1", [p.id]);
      const norm = s => s.trim().replace(/\s+/g, " ").toLowerCase();
      if (JSON.stringify(rel.map(x => norm(x.nombre)).sort()) !== JSON.stringify(p.ingredientes.map(norm).sort()) || rel.some(x => x.cantidad_descriptiva !== null)) errores.push("ingredientes");
      chk(!errores.length, `${p.numero}. ${p.nombre}${errores.length ? " → " + errores.join(", ") : ""}`);
    }
    const cats = await q("SELECT nombre, estado FROM categorias WHERE nombre=ANY($1::text[])", [CATEGORIAS]);
    chk(cats.length === 8, `8 categorías del sistema presentes (${cats.length})`);
    chk((await q("SELECT count(*)::int n FROM inventario WHERE id_producto=ANY($1::uuid[])", [ids]))[0].n === 0, "Ningún inventario para los 20 productos");
    chk((await q("SELECT count(*)::int n FROM movimientos_inventario WHERE id_producto=ANY($1::uuid[])", [ids]))[0].n === 0, "Ningún movimiento de inventario para los 20 productos");
    const audit = await q("SELECT accion, count(*)::int n FROM auditoria WHERE recurso_accedido='cli:catalogo:cargar-pdf' GROUP BY accion");
    const a = Object.fromEntries(audit.map(x => [x.accion, x.n]));
    chk(a.CREAR_PRODUCTO === 20 && a.ASOCIAR_INGREDIENTE_PRODUCTO === 20 && a.CARGA_CATALOGO_PDF === 1, `Auditoría de la carga: ${JSON.stringify(a)}`);
    if (antes) {
      chk(JSON.stringify(antes.legados) === JSON.stringify(despues.legados), "5 productos heredados intactos (fila, categoría, ingredientes e inventario)");
      chk(despues.inventario === antes.inventario && despues.movimientos === antes.movimientos, "Inventario y movimientos sin cambios");
      chk(despues.productosConPrecio === antes.productosConPrecio && despues.productosActivos === antes.productosActivos, "Ningún precio ni activación nuevos");
      chk(despues.pedidos === antes.pedidos, "Pedidos sin cambios");
    }
    ok.push("Imágenes principales en public/images/productos/ con SHA-256 del manifiesto");
    await db.query("ROLLBACK");
  } finally { db.release(); }
  return { resultado: fallas.length ? "FALLÓ" : "OK", aprobadas: ok, fallidas: fallas, despues };
}
module.exports = { instantanea, verificar };
if (require.main === module) {
  const [modo, archivo] = process.argv.slice(2);
  const { crearPool } = require("../../src/database/pool"); const pool = crearPool();
  (modo === "verificar" ? verificar(pool, archivo ? JSON.parse(fs.readFileSync(archivo, "utf8")) : null) : instantanea(pool))
    .then(r => { console.log(JSON.stringify(r, null, 1)); if (r.resultado === "FALLÓ") process.exitCode = 1; })
    .catch(e => { console.error(e.codigo || e.code || e.message); process.exitCode = 1; }).finally(() => pool.end());
}
