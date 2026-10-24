// DIAGNÓSTICO DE SOLO LECTURA (FASE 9B-2, incidencia TIMEOUT de R10): repetición aislada y SECUENCIAL con Ollama REAL.
//   node tests/diagnosticar-timeout-ia.js [--repeticiones 10] [--repeticiones-r11 3] [--limite 180000]
// 1) Lee el catálogo real de nutrivida_db en una transacción READ ONLY, construye las solicitudes y CIERRA la transacción
//    (ROLLBACK) y LIBERA la conexión ANTES de llamar a Ollama. No escribe consultas, conversaciones, auditoría ni datos.
// 2) Envía directamente a Ollama EXACTAMENTE la misma solicitud que ServicioIA (modelo, prompt, system, JSON Schema,
//    temperatura 0.2), una a la vez, con un límite de DIAGNÓSTICO de 180 s solo para observar cuánto tarda de verdad.
//    La aplicación NO cambia: su límite sigue siendo OLLAMA_TIMEOUT_MS (60000 en .env).
// 3) Registra por intento: duración, estado HTTP, motivo de fin, tokens del prompt y generados, tiempos de carga, de
//    procesamiento del prompt y de generación, validez del JSON, IDs dentro de los candidatos y si superó el límite de la app.
// Importante: que todas las repeticiones terminen bien NO descarta futuros bloqueos intermitentes; solo indica que no se
// reprodujeron en esta muestra y en estas condiciones del equipo.
const env = require("../src/config/env");
const { crearPool } = require("../src/database/pool");
const { RepositorioProductos } = require("../src/repositories/postgres/productos");
const { crearContextoIA } = require("../src/services/contextoIA");
const { prepararConsulta } = require("../src/services/evaluadorAlimentario");
const { SYSTEM, construirEsquemaRespuesta } = require("../src/services/iaService");
const arg = (n, d) => { const i = process.argv.indexOf(n); const v = i > 0 ? Number(process.argv[i + 1]) : d; return Number.isFinite(v) && v > 0 ? v : d; };
const REPETICIONES = arg("--repeticiones", 10), REPETICIONES_R11 = arg("--repeticiones-r11", 3), LIMITE = arg("--limite", 180000);
const LIMITE_APP = env.ollamaTimeoutMs, base = env.ollamaBaseUrl.replace(/\/+$/, "");
const ms = ns => (typeof ns === "number" ? Math.round(ns / 1e6) : null);

async function solicitud(repo, consulta) {
  const pc = prepararConsulta(consulta);
  const sel = await repo.seleccionarCandidatosIA(pc.consultaRelevancia, { restricciones: pc.restricciones });
  const contexto = crearContextoIA({ consulta, perfil: null, productos: sel.candidatos });
  return { consulta, seleccion: sel.tipo, candidatos: sel.candidatos.map(p => p.id), nombres: sel.candidatos.map(p => p.nombre),
    body: { model: env.ollamaModel, prompt: JSON.stringify(contexto), system: SYSTEM, format: construirEsquemaRespuesta(sel.candidatos), stream: false, options: { temperature: 0.2 } } };
}
async function modelosCargados() {
  try { const d = await (await fetch(base + "/api/ps", { signal: AbortSignal.timeout(3000) })).json(); return (d.models || []).map(m => m.name); }
  catch { return "no disponible"; }
}
async function intento(etiqueta, s) {
  const cargadosAntes = await modelosCargados(), inicio = new Date(), t0 = Date.now();
  let http = null;
  try {
    const res = await fetch(base + "/api/generate", { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(s.body), signal: AbortSignal.timeout(LIMITE) });
    http = res.status;
    const d = await res.json(), dur = Date.now() - t0, texto = String(d.response || "");
    let json = null; try { json = JSON.parse(texto); } catch {}
    const ids = Array.isArray(json?.productos) ? json.productos.map(p => p?.id) : null;
    return { etiqueta, inicio: inicio.toISOString(), ms: dur, superaLimiteApp: dur > LIMITE_APP, http, error: res.ok ? null : (d.error || "HTTP " + http),
      done_reason: d.done_reason ?? null, tokensPrompt: d.prompt_eval_count ?? null, tokensGenerados: d.eval_count ?? null,
      cargaModeloMs: ms(d.load_duration), promptMs: ms(d.prompt_eval_duration), generacionMs: ms(d.eval_duration), totalOllamaMs: ms(d.total_duration),
      esperaFueraDeOllamaMs: typeof d.total_duration === "number" ? dur - ms(d.total_duration) : null,
      largoRespuesta: texto.length, espaciosFinales: texto.length - texto.trimEnd().length, jsonValido: !!json, tipo: json?.tipo ?? null,
      productos: ids ? ids.length : null, idsDentroDeCandidatos: ids ? ids.every(id => s.candidatos.includes(id)) : null, modelosCargadosAntes: cargadosAntes };
  } catch (e) {
    const dur = Date.now() - t0;
    return { etiqueta, inicio: inicio.toISOString(), ms: dur, superaLimiteApp: dur > LIMITE_APP, http,
      error: e.name === "TimeoutError" ? `SIN RESPUESTA EN ${LIMITE} ms (límite de diagnóstico)` : (e.cause?.code || e.message), modelosCargadosAntes: cargadosAntes };
  }
}
const resumen = lista => {
  const d = lista.map(x => x.ms).sort((a, b) => a - b);
  return { intentos: lista.length, exitosos: lista.filter(x => !x.error && x.jsonValido && x.idsDentroDeCandidatos !== false).length,
    minimoMs: d[0] ?? null, medianaMs: d[Math.floor(d.length / 2)] ?? null, maximoMs: d.at(-1) ?? null,
    superanLimiteApp60s: lista.filter(x => x.superaLimiteApp).length, sinRespuestaEnLimiteDiagnostico: lista.filter(x => String(x.error).startsWith("SIN RESPUESTA")).length,
    erroresHttpOConexion: lista.filter(x => x.error && !String(x.error).startsWith("SIN RESPUESTA")).length,
    jsonInvalido: lista.filter(x => !x.error && !x.jsonValido).length, idsFueraDeCandidatos: lista.filter(x => x.idsDentroDeCandidatos === false).length,
    conCargaDeModelo: lista.filter(x => x.cargaModeloMs > 1000).length, maxTokensGenerados: Math.max(0, ...lista.map(x => x.tokensGenerados || 0)) };
};

(async () => {
  const salida = { soloLectura: true, modelo: env.ollamaModel, ollama: base, limiteAppMs: LIMITE_APP, limiteDiagnosticoMs: LIMITE,
    secuencial: true, repeticiones: { R10: REPETICIONES, R11: REPETICIONES_R11 }, intentos: [] };
  let r10, r11;
  // Fase 1: lectura del catálogo real (READ ONLY). Se cierra y libera ANTES de llamar a Ollama.
  const pool = crearPool();
  try {
    const db = await pool.connect();
    try {
      await db.query("BEGIN READ ONLY");
      const repo = new RepositorioProductos(db);
      r10 = await solicitud(repo, "Busco bebidas"); r11 = await solicitud(repo, "Muéstrame las bebidas disponibles");
      await db.query("ROLLBACK");
    } finally { db.release(); }
  } catch (e) { salida.error = "LECTURA_CATALOGO: " + (e.codigo || e.code || e.message); }
  finally { await pool.end(); }
  salida.conexionPostgresCerradaAntesDeOllama = true;
  if (salida.error) { console.log(JSON.stringify(salida, null, 1)); process.exitCode = 1; return; }
  salida.candidatos = { R10: { seleccion: r10.seleccion, nombres: r10.nombres }, R11: { seleccion: r11.seleccion, nombres: r11.nombres } };
  salida.mismoEsquemaR10R11 = JSON.stringify(r10.body.format) === JSON.stringify(r11.body.format);
  // Fase 2: solicitudes SECUENCIALES (una a la vez). R11 se intercala en las primeras repeticiones.
  for (let i = 1; i <= Math.max(REPETICIONES, REPETICIONES_R11); i++) {
    const turno = [...(i <= REPETICIONES ? [[`R10#${i}`, r10]] : []), ...(i <= REPETICIONES_R11 ? [[`R11#${i}`, r11]] : [])];
    for (const [etiqueta, s] of turno) {
      const r = await intento(etiqueta, s); salida.intentos.push(r);
      console.error(`${etiqueta.padEnd(6)} ${String(r.ms).padStart(7)} ms  HTTP=${r.http ?? "-"}  ` + (r.error ? `ERROR: ${r.error}`
        : `${r.done_reason} tokens=${r.tokensPrompt}/${r.tokensGenerados} carga=${r.cargaModeloMs}ms prompt=${r.promptMs}ms gen=${r.generacionMs}ms json=${r.jsonValido} ids=${r.idsDentroDeCandidatos}`));
    }
  }
  salida.resumen = { R10: resumen(salida.intentos.filter(x => x.etiqueta.startsWith("R10"))), R11: resumen(salida.intentos.filter(x => x.etiqueta.startsWith("R11"))) };
  salida.nota = "Una muestra sin bloqueos no descarta futuros bloqueos intermitentes de Ollama: solo indica que no se reprodujeron en estas repeticiones y condiciones del equipo.";
  console.log(JSON.stringify(salida, null, 1));
  if (salida.intentos.some(x => x.error || x.superaLimiteApp)) process.exitCode = 2; // 2 = se observó al menos un bloqueo/error
})();
