// ETAPA B: carga CONTROLADA de los 20 productos oficiales de NutriVida(1).pdf.
//   node database/scripts/cargar-catalogo-pdf.js --admin <correo-ADMINISTRADOR>             (simulación: ROLLBACK)
//   node database/scripts/cargar-catalogo-pdf.js --admin <correo-ADMINISTRADOR> --confirmar (COMMIT)
// Una sola transacción; cualquier error → ROLLBACK completo. Idempotente: IDs deterministas por producto.
// Nunca: precio, inventario, stock mínimo, valores nutricionales, cantidades ni activación.
const fs = require("node:fs"), path = require("node:path"), { createHash, randomUUID } = require("node:crypto");
const { transaccion } = require("../../src/database/transaccion");

const BASE = path.join(__dirname, "../../docs/fuentes/catalogo-pdf");
const RUTA_IMG = /^\/images\/productos\/([a-z0-9]+(?:-[a-z0-9]+)*\.webp)$/;
const CATEGORIAS = ["Barras y Snacks", "Bebidas", "Suplementos", "Orgánicos y Naturales", "Panadería y Cereales", "Comidas Preparadas", "Lácteos y Alternativas", "Untables y Postres"];
const sha = b => createHash("sha256").update(b).digest("hex");
const norm = s => s.trim().replace(/\s+/g, " ").toLowerCase();
class ErrorCarga extends Error { constructor(codigo, detalle) { super(codigo); this.codigo = codigo; this.detalle = detalle; } }
const fallo = (c, d) => { throw new ErrorCarga(c, d); };
// UUID determinista (formato v5) por número de producto del PDF → idempotencia sin depender del nombre.
function idProducto(shaDoc, numero) {
  const h = createHash("sha1").update(`nutrivida-pdf:${shaDoc}:${numero}`).digest();
  h[6] = (h[6] & 0x0f) | 0x50; h[8] = (h[8] & 0x3f) | 0x80;
  const x = h.subarray(0, 16).toString("hex");
  return `${x.slice(0, 8)}-${x.slice(8, 12)}-${x.slice(12, 16)}-${x.slice(16, 20)}-${x.slice(20)}`;
}

// Validación completa ANTES de abrir la transacción (archivos, SHA-256, reglas de no invención).
function prepararPlan({ base = BASE, dirImagenes = path.join(__dirname, "../../public/images/productos") } = {}) {
  const bytesProp = fs.readFileSync(path.join(base, "propuesta-carga.json")), bytesMan = fs.readFileSync(path.join(base, "manifiesto-productos.json"));
  const prop = JSON.parse(bytesProp), man = JSON.parse(bytesMan);
  if (prop.sha256Documento !== man.sha256Documento) fallo("PROPUESTA_Y_MANIFIESTO_NO_COINCIDEN");
  if (!Array.isArray(prop.productos) || prop.productos.length !== 20) fallo("SE_ESPERAN_20_PRODUCTOS");
  if (JSON.stringify(prop.categoriasSistema) !== JSON.stringify(CATEGORIAS)) fallo("CATEGORIAS_NO_APROBADAS");
  const nombres = new Set();
  const productos = prop.productos.map((p, i) => {
    const m = man.productos.find(x => x.numero === p.numero);
    if (!m || p.numero !== i + 1 || m.nombre !== p.nombre) fallo("PRODUCTO_NO_COINCIDE_CON_MANIFIESTO", p.numero);
    if (p.precio !== null || p.stockMinimo !== null || p.valoresNutricionales !== null || p.stock !== "SIN_CONFIGURAR" || p.estado !== "INACTIVO") fallo("DATO_NO_DOCUMENTADO", p.numero);
    if (!CATEGORIAS.includes(p.categoriaSistema)) fallo("CATEGORIA_INVALIDA", p.numero);
    if (p.origenDescripcion === "LITERAL_PDF" ? p.descripcionCatalogo !== m.descripcion : !(p.origenDescripcion === "NEUTRALIZADA" && p.descripcionOriginalPdf === m.descripcion && p.motivoNeutralizacion)) fallo("DESCRIPCION_SIN_TRAZABILIDAD", p.numero);
    if (JSON.stringify(p.ingredientes) !== JSON.stringify(m.ingredientes.map(x => x.nombre)) || m.ingredientes.some(x => x.cantidadDescriptiva !== null)) fallo("INGREDIENTES_NO_COINCIDEN", p.numero);
    if (p.ingredientes.some(x => !x || x.length > 100) || new Set(p.ingredientes.map(norm)).size !== p.ingredientes.length) fallo("INGREDIENTE_INVALIDO", p.numero);
    const r = RUTA_IMG.exec(p.imagenUrl); if (!r || p.imagenUrl !== m.imagen.rutaPropuesta || p.imagenSha256 !== m.imagen.sha256) fallo("IMAGEN_NO_APROBADA", p.numero);
    const archivo = path.join(dirImagenes, r[1]);
    let b; try { if (!fs.lstatSync(archivo).isFile()) throw 0; b = fs.readFileSync(archivo); } catch { fallo("IMAGEN_NO_COPIADA", r[1]); }
    if (sha(b) !== p.imagenSha256) fallo("IMAGEN_SHA256_DISTINTO", r[1]);
    if (p.nombre.length > 120 || nombres.has(norm(p.nombre))) fallo("NOMBRE_INVALIDO", p.numero); nombres.add(norm(p.nombre));
    return { id: idProducto(prop.sha256Documento, p.numero), numero: p.numero, nombre: p.nombre, categoria: p.categoriaSistema,
      descripcion: p.descripcionCatalogo, ingredientes: p.ingredientes, imagenUrl: p.imagenUrl };
  });
  return { productos, shaDocumento: prop.sha256Documento, shaPropuesta: sha(bytesProp), shaManifiesto: sha(bytesMan) };
}

async function cargarCatalogo(pool, { adminCorreo, confirmar = false, ...opciones } = {}) {
  const plan = prepararPlan(opciones);
  if (typeof adminCorreo !== "string" || !adminCorreo.trim()) fallo("USO: --admin <correo de un ADMINISTRADOR activo>");
  const SIMULACION = Symbol("simulacion");
  let resumen;
  try {
    await transaccion(pool, async db => {
      await db.query("SELECT pg_advisory_xact_lock(20660401)"); // mismo bloqueo que el catálogo
      const admin = (await db.query(`SELECT u.id_usuario FROM usuarios u JOIN roles r USING(id_rol)
        WHERE lower(btrim(u.correo))=lower(btrim($1)) AND u.estado=TRUE AND r.nombre='ADMINISTRADOR'`, [adminCorreo])).rows[0];
      if (!admin) fallo("ADMINISTRADOR_NO_ENCONTRADO");
      const evento = (accion, entidad, id, nuevos = null) => db.query(`INSERT INTO auditoria(id_auditoria,id_usuario,accion,entidad,id_entidad,recurso_accedido,datos_nuevos,fecha)
        VALUES($1,$2,$3,$4,$5,$6,$7,clock_timestamp())`, [randomUUID(), admin.id_usuario, accion, entidad, String(id), "cli:catalogo:cargar-pdf", nuevos]);
      const r = { categoriasCreadas: [], categoriasReutilizadas: [], ingredientesCreados: 0, ingredientesReutilizados: 0, productosCreados: 0, productosYaCargados: 0 };
      const cat = new Map();
      for (const nombre of CATEGORIAS) {
        let c = (await db.query("SELECT id_categoria,estado FROM categorias WHERE lower(regexp_replace(btrim(nombre),'[[:space:]]+',' ','g'))=$1 FOR SHARE", [norm(nombre)])).rows[0];
        if (c) r.categoriasReutilizadas.push(nombre); // se reutiliza sin modificarla
        else { c = (await db.query("INSERT INTO categorias(nombre,descripcion,estado,fecha_creacion) VALUES($1,NULL,TRUE,CURRENT_TIMESTAMP) RETURNING id_categoria,estado", [nombre])).rows[0];
          await evento("CREAR_CATEGORIA", "categorias", c.id_categoria); r.categoriasCreadas.push(nombre); }
        cat.set(nombre, String(c.id_categoria));
      }
      const ing = new Map();
      for (const nombre of [...new Set(plan.productos.flatMap(p => p.ingredientes))]) {
        let i = (await db.query("SELECT id_ingrediente FROM ingredientes WHERE lower(regexp_replace(btrim(nombre),'[[:space:]]+',' ','g'))=$1 FOR SHARE", [norm(nombre)])).rows[0];
        if (i) r.ingredientesReutilizados++;
        else { i = (await db.query("INSERT INTO ingredientes(nombre,descripcion) VALUES($1,NULL) RETURNING id_ingrediente", [nombre])).rows[0];
          await evento("CREAR_INGREDIENTE", "ingredientes", i.id_ingrediente); r.ingredientesCreados++; }
        ing.set(norm(nombre), String(i.id_ingrediente));
      }
      for (const p of plan.productos) {
        const ingIds = p.ingredientes.map(n => ing.get(norm(n))).sort();
        const existente = (await db.query("SELECT * FROM productos WHERE id_producto=$1 FOR UPDATE", [p.id])).rows[0];
        if (existente) { // idempotencia: debe coincidir EXACTAMENTE; nunca se sobrescribe
          const rel = (await db.query("SELECT id_ingrediente::text id, cantidad_descriptiva FROM producto_ingrediente WHERE id_producto=$1 ORDER BY 1", [p.id])).rows;
          const igual = existente.nombre === p.nombre && String(existente.id_categoria) === cat.get(p.categoria) && existente.descripcion === p.descripcion
            && existente.imagen_url === p.imagenUrl && existente.precio === null && existente.estado === false && existente.stock_minimo === null
            && existente.valores_nutricionales === null && JSON.stringify(rel.map(x => x.id).sort()) === JSON.stringify(ingIds) && rel.every(x => x.cantidad_descriptiva === null);
          if (!igual) fallo("PRODUCTO_YA_CARGADO_DIFIERE", `${p.numero}. ${p.nombre}`);
          r.productosYaCargados++; continue;
        }
        const homonimo = (await db.query("SELECT id_producto FROM productos WHERE lower(regexp_replace(btrim(nombre),'[[:space:]]+',' ','g'))=$1", [norm(p.nombre)])).rows[0];
        if (homonimo) fallo("NOMBRE_YA_EXISTE_EN_OTRO_PRODUCTO", `${p.numero}. ${p.nombre}`); // nunca fusionar
        await db.query(`INSERT INTO productos(id_producto,id_categoria,nombre,descripcion,precio,imagen_url,estado,valores_nutricionales,stock_minimo,fecha_creacion,fecha_actualizacion)
          VALUES($1,$2,$3,$4,NULL,$5,FALSE,NULL,NULL,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)`, [p.id, cat.get(p.categoria), p.nombre, p.descripcion, p.imagenUrl]);
        for (const id of ingIds) await db.query("INSERT INTO producto_ingrediente(id_producto,id_ingrediente,cantidad_descriptiva) VALUES($1,$2,NULL)", [p.id, id]);
        await evento("ASOCIAR_INGREDIENTE_PRODUCTO", "productos", p.id);
        await evento("CREAR_PRODUCTO", "productos", p.id, { origen: "NutriVida(1).pdf", numeroEnDocumento: p.numero });
        r.productosCreados++;
      }
      if (r.productosCreados) await evento("CARGA_CATALOGO_PDF", "productos", "catalogo-pdf", { sha256Documento: plan.shaDocumento,
        sha256Propuesta: plan.shaPropuesta, sha256Manifiesto: plan.shaManifiesto, productosCreados: r.productosCreados });
      const inv = (await db.query("SELECT count(*)::int n FROM inventario WHERE id_producto=ANY($1::uuid[])", [plan.productos.map(p => p.id)])).rows[0].n;
      if (inv !== 0) fallo("INVENTARIO_INESPERADO");
      resumen = { ...r, ids: plan.productos.map(p => ({ numero: p.numero, id: p.id })), confirmado: confirmar };
      if (!confirmar) throw SIMULACION; // simulación: todo se revierte
    });
  } catch (e) { if (e !== SIMULACION) throw e; }
  return resumen;
}
module.exports = { cargarCatalogo, prepararPlan, idProducto, CATEGORIAS, ErrorCarga };

if (require.main === module) {
  const a = process.argv.slice(2), i = a.indexOf("--admin");
  const { crearPool } = require("../../src/database/pool");
  const pool = crearPool();
  cargarCatalogo(pool, { adminCorreo: i >= 0 ? a[i + 1] : "", confirmar: a.includes("--confirmar") })
    .then(r => { const { ids, ...res } = r; console.log(JSON.stringify(res, null, 1));
      console.log(r.confirmado ? "CARGA CONFIRMADA (COMMIT)." : "SIMULACIÓN: no se guardó nada (ROLLBACK). Usa --confirmar para cargar."); })
    .catch(e => { console.error(e.codigo || e.code || "OPERACION_DB_FALLIDA", e.detalle ?? ""); process.exitCode = 1; })
    .finally(() => pool.end());
}
