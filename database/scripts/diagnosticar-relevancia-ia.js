// DIAGNÓSTICO DE SOLO LECTURA de la relevancia de candidatos para NutriVida AI (algoritmo implementado).
//   node database/scripts/diagnosticar-relevancia-ia.js            → informe legible
//   node database/scripts/diagnosticar-relevancia-ia.js --json     → mismo informe en JSON
// Transacción READ ONLY: solo SELECT. No modifica productos, inventario, auditoría, conversaciones ni data/db.json.
// No llama a Ollama. Muestra la puntuación y los candidatos que el backend enviaría a Ollama.
const { crearPool } = require("../../src/database/pool");
const { RepositorioProductos } = require("../../src/repositories/postgres/productos");
const { esConsultaMedica } = require("../../src/services/iaService");

// Usa EXACTAMENTE el algoritmo implementado (src/services/relevanciaIA.js) vía el repositorio.
const { MAX_CANDIDATOS, PESOS } = require("../../src/services/relevanciaIA");
const CONSULTAS = ["Busco un snack", "busco de snak", "Quiero algo para desayunar", "¿Qué bebidas tienen?",
  "Quiero algo alto en proteína", "¿Qué productos tienen?", "Quiero algo con avena", "Algo con miel"];
const TIPOS = { ESPECIFICA: "ESPECÍFICA", SIN_COINCIDENCIAS: "ESPECÍFICA SIN COINCIDENCIAS (no se llama a Ollama)",
  GENERAL: "GENERAL (muestra representativa determinista por categorías)", SIN_PRODUCTOS: "CATÁLOGO SIN PRODUCTOS ELEGIBLES (no se llama a Ollama)" };

(async () => {
  const pool = crearPool(), db = await pool.connect(), informe = { soloLectura: true, maxCandidatos: MAX_CANDIDATOS, pesos: PESOS };
  try {
    await db.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    const todos = (await db.query(`SELECT p.id_producto id, p.nombre, c.nombre categoria, p.descripcion, p.valores_nutricionales,
        p.estado activo, c.estado categoria_activa, p.precio, inv.cantidad,
        COALESCE((SELECT string_agg(i.nombre, ', ' ORDER BY i.nombre) FROM producto_ingrediente pi JOIN ingredientes i USING(id_ingrediente)
                  WHERE pi.id_producto=p.id_producto), '') ingredientes
      FROM productos p JOIN categorias c USING(id_categoria) LEFT JOIN inventario inv USING(id_producto)
      ORDER BY p.nombre, p.id_producto`)).rows;
    const motivo = p => [!p.activo && "inactivo", !p.categoria_activa && "categoría inactiva", !(Number(p.precio) > 0) && "sin precio > 0",
      p.cantidad == null ? "inventario sin configurar" : !(p.cantidad > 0) && "sin existencia"].filter(Boolean);
    const elegibles = todos.filter(p => !motivo(p).length).map(p => ({ id: p.id, nombre: p.nombre, categoria: p.categoria,
      descripcion: p.descripcion || "", ingredientes: p.ingredientes, valoresNutricionales: p.valores_nutricionales || "" }));
    informe.totalProductos = todos.length;
    informe.noElegibles = todos.filter(p => motivo(p).length).length;
    informe.noElegiblesPorMotivo = {};
    for (const p of todos) { const m = motivo(p).join(", "); if (m) informe.noElegiblesPorMotivo[m] = (informe.noElegiblesPorMotivo[m] || 0) + 1; }
    informe.elegibles = elegibles.map(p => ({ ...p, id: p.id.slice(0, 8) }));
    const repo = new RepositorioProductos(db);
    informe.consultas = [];
    for (const consulta of CONSULTAS) {
      const sel = await repo.seleccionarCandidatosIA(consulta), enviados = new Set(sel.candidatos.map(p => p.id));
      const r = { consulta, medica: esConsultaMedica(consulta), tipo: TIPOS[sel.tipo], terminos: sel.terminos, categorias: sel.categorias };
      if (sel.tipo === "GENERAL") {
        r.candidatos = sel.candidatos.map((p, i) => ({ orden: i + 1, nombre: p.nombre, categoria: p.categoria, criterio: "muestra por categorías" }));
        r.descartados = elegibles.filter(p => !enviados.has(p.id)).map(p => ({ nombre: p.nombre, categoria: p.categoria, motivo: `límite de ${MAX_CANDIDATOS} (fuera de la muestra por categorías)` }));
      } else {
        r.puntuaciones = sel.puntuaciones.map((x, i) => ({ orden: i + 1, nombre: x.producto.nombre, categoria: x.producto.categoria, puntos: x.puntos,
          coincidencias: x.coincidencias.map(c => ({ ...c, tipo: c.tipo === "APROXIMADA" ? `APROXIMADA (≈ ${c.parecidoA})` : c.tipo })) }));
        r.candidatos = sel.puntuaciones.filter(x => enviados.has(x.producto.id)).map((x, i) => ({ orden: i + 1, nombre: x.producto.nombre, categoria: x.producto.categoria, puntos: x.puntos }));
        r.descartados = sel.puntuaciones.filter(x => !enviados.has(x.producto.id)).map(x => ({ nombre: x.producto.nombre, categoria: x.producto.categoria, puntos: x.puntos,
          motivo: x.puntos > 0 ? `límite de ${MAX_CANDIDATOS} (menor puntuación)` : "sin coincidencias con la consulta" }));
      }
      informe.consultas.push(r);
    }
    await db.query("ROLLBACK");
  } finally { db.release(); await pool.end(); }

  if (process.argv.includes("--json")) return console.log(JSON.stringify(informe, null, 1));
  const L = [];
  L.push("DIAGNÓSTICO DE RELEVANCIA NutriVida AI — SOLO LECTURA (no se modificó ningún dato; no se llamó a Ollama)");
  L.push(`Productos totales: ${informe.totalProductos} | no elegibles: ${informe.noElegibles} | elegibles: ${informe.elegibles.length} | máximo de candidatos: ${MAX_CANDIDATOS}`);
  L.push(`No elegibles por motivo (nunca se envían a Ollama): ${Object.entries(informe.noElegiblesPorMotivo).map(([m, n]) => `${m}: ${n}`).join(" | ") || "ninguno"}`);
  L.push(`Pesos: ${Object.entries(PESOS).map(([k, v]) => `${k}=${v}`).join(", ")} (aproximada = mitad)`);
  L.push("", "=== PRODUCTOS ELEGIBLES Y DATOS USADOS PARA RELEVANCIA ===");
  for (const p of informe.elegibles) {
    L.push(`- ${p.nombre}  [${p.categoria}]  id ${p.id}`);
    L.push(`    descripción: ${p.descripcion || "(vacía)"}`);
    L.push(`    ingredientes: ${p.ingredientes || "(ninguno)"}`);
    L.push(`    información nutricional declarada: ${p.valoresNutricionales || "(vacía)"}`);
  }
  for (const r of informe.consultas) {
    L.push("", `=== "${r.consulta}" ===`);
    L.push(`Tipo: ${r.tipo}${r.medica ? " | ATENCIÓN: el detector médico la respondería antes" : ""}`);
    L.push(`Términos normalizados: ${r.terminos.length ? r.terminos.join(", ") : "(ninguno: solo palabras vacías/genéricas)"}`);
    if (r.puntuaciones) {
      L.push("Puntuación (orden final):");
      for (const x of r.puntuaciones) {
        L.push(`  ${x.orden}. ${x.nombre} [${x.categoria}] → ${x.puntos} pts`);
        for (const c of x.coincidencias) L.push(`       · "${c.termino}" en ${c.campo}: ${c.tipo} (+${c.puntos})`);
      }
    }
    L.push("Candidatos que se envían a Ollama:");
    if (!r.candidatos.length) L.push("  (ninguno: respuesta determinista del backend, sin llamar al modelo)");
    for (const c of r.candidatos) L.push(`  ${c.orden}. ${c.nombre} [${c.categoria}]${c.puntos != null ? ` — ${c.puntos} pts` : ` — ${c.criterio}`}`);
    L.push("Descartados:");
    if (!r.descartados.length) L.push("  (ninguno)");
    for (const d of r.descartados) L.push(`  - ${d.nombre} [${d.categoria}]: ${d.motivo}`);
  }
  console.log(L.join("\n"));
})().catch(e => { console.error(e.codigo || e.code || e.message); process.exitCode = 1; });
