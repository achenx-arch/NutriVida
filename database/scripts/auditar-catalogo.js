// Auditoría de SOLO LECTURA del catálogo real (cierre ETAPA B). No modifica datos.
//   node database/scripts/auditar-catalogo.js
// Clasifica: A) heredados (data/db.json), B) cargados del PDF (IDs deterministas), C) productos PDF
// configurados después desde administración (con su evidencia de auditoría), y otros creados manualmente.
const fs = require("node:fs"), path = require("node:path"), { createHash } = require("node:crypto");
const { prepararPlan } = require("./cargar-catalogo-pdf");
const { crearPool } = require("../../src/database/pool");
const { RepositorioProductos } = require("../../src/repositories/postgres/productos");
const { verificarImportacion } = require("../../src/database/importacion");
const PUBLICO = path.join(__dirname, "../../public");
const norm = s => String(s).trim().replace(/\s+/g, " ").toLowerCase();

(async () => {
  const pool = crearPool(), db = await pool.connect(), plan = prepararPlan();
  const legados = new Set(JSON.parse(fs.readFileSync(path.join(__dirname, "../../data/db.json"), "utf8")).productos.map(p => p.id));
  const pdf = new Map(plan.productos.map(p => [p.id, p]));
  const salida = {};
  try {
    await db.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    const q = async (s, a = []) => (await db.query(s, a)).rows;
    const filas = await q(`SELECT p.id_producto id, p.nombre, p.estado, p.precio, p.stock_minimo, p.imagen_url, p.descripcion, p.valores_nutricionales,
      c.nombre categoria, c.estado categoria_activa, inv.cantidad existencia,
      (SELECT array_agg(i.nombre ORDER BY i.nombre) FROM producto_ingrediente pi JOIN ingredientes i USING(id_ingrediente) WHERE pi.id_producto=p.id_producto) ingredientes,
      (SELECT count(*)::int FROM movimientos_inventario m WHERE m.id_producto=p.id_producto) movimientos
      FROM productos p JOIN categorias c USING(id_categoria) LEFT JOIN inventario inv USING(id_producto) ORDER BY p.nombre`);
    const auditoria = async id => (await q(`SELECT accion, entidad, fecha, recurso_accedido FROM auditoria
      WHERE (entidad='productos' AND id_entidad=$1) OR (entidad='inventario' AND id_entidad=$1) ORDER BY fecha`, [id]))
      .map(a => ({ accion: a.accion, fecha: a.fecha.toISOString(), via: a.recurso_accedido === "cli:catalogo:cargar-pdf" ? "carga-pdf" : "administración" }));
    const productos = [];
    for (const f of filas) {
      const origen = legados.has(f.id) ? "A_HEREDADO" : pdf.has(f.id) ? "B_PDF" : "OTRO_MANUAL";
      const p = { id: f.id.slice(0, 8), nombre: f.nombre, origen, categoria: f.categoria, estado: f.estado ? "ACTIVO" : "INACTIVO",
        precio: f.precio, existencia: f.existencia ?? "SIN_CONFIGURAR", stockMinimo: f.stock_minimo, movimientos: f.movimientos,
        imagen: f.imagen_url, ingredientes: (f.ingredientes || []).length };
      // Imagen: archivo local existente y, para PDF, SHA-256 aprobado.
      if (f.imagen_url) { const ruta = path.join(PUBLICO, f.imagen_url); p.imagenArchivo = fs.existsSync(ruta) ? "OK" : "FALTA";
        const plan_ = pdf.get(f.id); if (plan_ && p.imagenArchivo === "OK" && f.imagen_url === plan_.imagenUrl)
          p.imagenSha256 = createHash("sha256").update(fs.readFileSync(ruta)).digest("hex") === JSON.parse(fs.readFileSync(path.join(__dirname, "../../docs/fuentes/catalogo-pdf/propuesta-carga.json"), "utf8")).productos[plan_.numero - 1].imagenSha256 ? "OK" : "DISTINTO"; }
      if (origen === "B_PDF") { // Cambios posteriores a la carga y su respaldo en auditoría.
        const b = pdf.get(f.id), cambios = [];
        if (f.precio !== null) cambios.push("precio"); if (f.estado) cambios.push("estado→ACTIVO"); if (f.stock_minimo !== null) cambios.push("stock mínimo");
        if (f.existencia !== null && f.existencia !== undefined) cambios.push("inventario"); if (f.descripcion !== b.descripcion) cambios.push("descripción");
        if (f.imagen_url !== b.imagenUrl) cambios.push("imagen"); if (f.categoria !== b.categoria) cambios.push("categoría"); if (f.valores_nutricionales !== null) cambios.push("valores nutricionales");
        if (JSON.stringify((f.ingredientes || []).map(norm).sort()) !== JSON.stringify(b.ingredientes.map(norm).sort())) cambios.push("ingredientes");
        const ev = await auditoria(f.id), posteriores = ev.filter(e => e.via === "administración");
        p.cambiosPosteriores = cambios;
        p.evidenciaAuditoria = posteriores.map(e => `${e.accion} ${e.fecha}`);
        p.clasificacion = cambios.length ? (posteriores.length ? "C_CONFIGURADO_DESPUES_AUDITADO" : "C_SIN_AUDITORIA_REVISAR") : "B_SIN_CAMBIOS";
      }
      // Regla de candidatos IA (misma que RepositorioProductos.listarDisponiblesIA).
      const motivos = [];
      if (!f.estado) motivos.push("inactivo"); if (!f.categoria_activa) motivos.push("categoría inactiva");
      if (!(Number(f.precio) > 0)) motivos.push("sin precio"); if (!(f.existencia > 0)) motivos.push(f.existencia === 0 ? "sin existencia" : "inventario sin configurar");
      p.candidatoIA = motivos.length ? "No" : "Sí"; p.motivo = motivos.join(", ") || "activo, categoría activa, precio > 0 y existencia > 0";
      productos.push(p);
    }
    const repo = new RepositorioProductos(db);
    const muestras = {};
    for (const consulta of ["", "¿Qué snack me recomiendas?", "Quiero algo para desayunar.", "¿Qué productos tienen disponibles?", "Busco algo práctico para llevar.", "¿Qué bebidas tienen?"])
      muestras[consulta || "(vacía)"] = (await repo.listarDisponiblesIA(consulta)).map(x => x.nombre);
    const n = async s => (await q(s))[0].n;
    salida.resumen = {
      totalProductos: filas.length,
      heredados: productos.filter(p => p.origen === "A_HEREDADO").length,
      pdf: productos.filter(p => p.origen === "B_PDF").length,
      pdfConfiguradosDespues: productos.filter(p => String(p.clasificacion).startsWith("C_")).length,
      pdfCambiosSinAuditoria: productos.filter(p => p.clasificacion === "C_SIN_AUDITORIA_REVISAR").map(p => p.nombre),
      otrosManuales: productos.filter(p => p.origen === "OTRO_MANUAL").map(p => p.nombre),
      activos: productos.filter(p => p.estado === "ACTIVO").length,
      candidatosIA: productos.filter(p => p.candidatoIA === "Sí").length,
      categoriasUsadas: [...new Set(productos.map(p => p.categoria))].sort(),
      ingredientes: await n("SELECT count(*)::int n FROM ingredientes"), relacionesProductoIngrediente: await n("SELECT count(*)::int n FROM producto_ingrediente"),
      inventarios: await n("SELECT count(*)::int n FROM inventario"), movimientos: await n("SELECT count(*)::int n FROM movimientos_inventario"),
      movimientosPorTipo: await q("SELECT tipo, count(*)::int n FROM movimientos_inventario GROUP BY tipo ORDER BY tipo"),
      imagenesFaltantes: productos.filter(p => p.imagenArchivo === "FALTA").map(p => p.nombre),
      imagenesShaDistinto: productos.filter(p => p.imagenSha256 === "DISTINTO").map(p => p.nombre),
      limiteCandidatosPorConsulta: 5,
    };
    salida.candidatosPorConsulta = muestras;
    salida.productos = productos;
    await db.query("ROLLBACK");
  } finally { db.release(); }
  try { const v = await verificarImportacion(pool, path.join(__dirname, "../../data/db.json"));
    salida.integridadHistorica = { resultado: v.integridadHistorica, cambiosPosteriores: v.cambiosPosteriores.map(c => `${c.tabla}.${c.campo} ← ${c.evidencia.accion}`) }; }
  catch (e) { salida.integridadHistorica = { resultado: e.codigo || "ERROR", conflictos: e.conflictos }; process.exitCode = 1; }
  await pool.end();
  console.log(JSON.stringify(salida, null, 1));
})().catch(e => { console.error(e.codigo || e.code || e.message); process.exitCode = 1; });
