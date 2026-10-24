// Selección de candidatos para NutriVida AI por RELEVANCIA (funciones puras, sin E/S).
// Usa SOLO datos reales del producto (nombre, categoría, ingredientes, descripción e información nutricional
// declarada). No infiere propiedades, beneficios ni asociaciones que no estén escritas en el producto.
// La elegibilidad (activo, categoría activa, precio > 0, existencia > 0) la decide antes el repositorio.
const MAX_CANDIDATOS = 5;
const { filtrarProductos } = require("./evaluadorAlimentario");
const { bonoPreferencias } = require("./catalogoAlimentacion");
const { bonoHistorial } = require("./historialIA");
// Pesos por campo; una coincidencia aproximada (errores sencillos) vale la mitad.
const PESOS = Object.freeze({ nombre: 3, categoria: 2, ingredientes: 2, descripcion: 1, valoresNutricionales: 1 });
// Palabras vacías y calificadores: no describen un producto por sí solas.
const VACIAS = new Set(("a al algo alguna alguno algun ante como cual cuales de del el en es esta este esto la las le lo los me mi mis muy " +
  "no o para por que quiero quisiera busco buscar buscando dame tienen tienes tiene hay un una unos unas y ya su sus te tu tus yo ver " +
  "favor puedes podrias necesito gustaria quisieras pero soy tengo estoy " +
  "alto alta altos altas bajo baja bajos bajas rico rica ricos ricas con sin mas menos").split(" "));
// Palabras genéricas o de cortesía: si la consulta SOLO contiene estas, es una consulta GENERAL.
const GENERICAS = new Set(("producto productos catalogo opcion opciones disponible disponibles cosa cosas recomiendas recomienda " +
  "recomendar recomiendame recomendacion recomendaciones ofrecen venden vendes sugerencia sugerencias sugieres sugiere " +
  "varias varios variedad hola buenas buenos dias tardes noches saludos gracias nutrivida tienda semana hoy").split(" "));
const SUFIJOS = ["aciones", "acion", "mente", "ables", "able", "ales", "es", "os", "as", "ar", "er", "ir", "o", "a", "s"];

const normalizar = s => String(s ?? "").toLowerCase().normalize("NFD").replace(/\p{M}/gu, "");
const palabras = s => normalizar(s).match(/[a-z0-9]+/g) || [];
// Reducción simple de plurales/conjugaciones (bebidas→bebid, desayunar/desayuno→desayun); raíz mínima de 4 letras.
const raiz = w => { for (const s of SUFIJOS) if (w.endsWith(s) && w.length - s.length >= 4) return w.slice(0, -s.length); return w; };
// Distancia de Damerau-Levenshtein; solo interesa saber si es ≤ 1.
function distancia(a, b) {
  if (Math.abs(a.length - b.length) > 1) return 2;
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) {
    d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] !== b[j - 1]));
    if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
  }
  return d[a.length][b.length];
}
// Términos útiles de la consulta (normalizados, sin vacías ni genéricas, reducidos a raíz). Máximo 12.
function terminosConsulta(consulta) {
  return [...new Set(palabras(consulta).filter(w => w.length >= 3 && !VACIAS.has(w) && !GENERICAS.has(w)).map(raiz))].slice(0, 12);
}
function puntuar(producto, terminos) {
  let puntos = 0; const coincidencias = [];
  for (const [campo, peso] of Object.entries(PESOS)) {
    const vocab = [...new Set(palabras(producto[campo]).filter(w => w.length >= 3).map(raiz))];
    for (const t of terminos) {
      if (vocab.includes(t)) { puntos += peso; coincidencias.push({ termino: t, campo, tipo: "EXACTA", puntos: peso }); continue; }
      const aprox = t.length >= 4 && vocab.find(v => v.length >= 4 && distancia(t, v) <= 1);
      if (aprox) { puntos += peso / 2; coincidencias.push({ termino: t, campo, tipo: "APROXIMADA", parecidoA: aprox, puntos: peso / 2 }); }
    }
  }
  return { puntos, coincidencias };
}
const total = x => x.puntos + (x.bonoPreferencias || 0) + (x.bonoHistorial || 0);
const porNombre = (a, b) => a.nombre.localeCompare(b.nombre, "es") || String(a.id).localeCompare(String(b.id));
// Consulta GENERAL: muestra representativa DETERMINISTA. Categorías por nombre; dentro de cada una, productos
// por nombre (e id); un producto por categoría en cada ronda hasta MAX_CANDIDATOS. Mismo catálogo ⇒ mismos candidatos.
// FASE 9B-2: con preferencias AUTORIZADAS, dentro de cada categoría van primero los productos preferidos (mismo número de
// candidatos y misma rotación por categorías; sin preferencias el orden es idéntico al anterior).
// FASE 9C: con historial AUTORIZADO, el bono de historial se suma al de preferencias solo para ordenar dentro de la categoría.
function muestraGeneral(elegibles, max = MAX_CANDIDATOS, preferencias = [], historial = null) {
  const grupos = new Map(), bono = p => (preferencias.length ? bonoPreferencias(p, preferencias).bono : 0) + (historial ? bonoHistorial(p, historial).bono : 0);
  for (const p of [...elegibles].sort((a, b) => String(a.categoria).localeCompare(String(b.categoria), "es") || bono(b) - bono(a) || porNombre(a, b))) {
    if (!grupos.has(p.categoria)) grupos.set(p.categoria, []);
    grupos.get(p.categoria).push(p);
  }
  const colas = [...grupos.values()], salida = [];
  for (let r = 0; salida.length < max && colas.some(c => c[r]); r++)
    for (const c of colas) if (c[r] && salida.length < max) salida.push(c[r]);
  return salida;
}
const categoriasDe = elegibles => [...new Set(elegibles.map(p => p.categoria).filter(Boolean))].sort((a, b) => a.localeCompare(b, "es"));
// Resultado:
//   SIN_PRODUCTOS      → no hay ningún producto elegible (catálogo vacío para la IA)
//   GENERAL            → consulta sin términos útiles: muestra determinista por categorías
//   ESPECIFICA         → solo productos con puntuación > 0 (máx. 5), sin completar con irrelevantes
//   SIN_COINCIDENCIAS  → consulta específica sin ninguna coincidencia: no se llama al modelo
// FASE 9B-1 (opcion restricciones): ANTES de puntuar se aplica el evaluador alimentario; la relevancia, la muestra
// general, el respaldo y los candidatos para Ollama trabajan SOLO con productos permitidos (SIN_CONFLICTO_DETECTADO).
//   SIN_CANDIDATOS_RESTRICCION → ningún producto elegible pasa el evaluador (no se llama al modelo)
//   SOLICITUD_EXCLUIDA         → lo pedido solo coincide con productos excluidos (no se llama al modelo)
// FASE 9B-2 (opción preferencias, solo con consentimiento de perfil): bono +0,5 por preferencia que coincide, máx. +1, SOLO
// para productos permitidos que ya coinciden con la consulta (puntos > 0). Nunca agrega productos ni rescata excluidos;
// `puntos` conserva la puntuación base (pesos sin cambios) y `bonoPreferencias` queda aparte para auditoría.
// FASE 9C (opción historial, solo con autoriza_historial_ia === true): bono secundario por compras ENTREGADAS (máx. +0,5),
// con las MISMAS condiciones que el de preferencias: solo permitidos y con puntos > 0; queda aparte en `bonoHistorial`.
function seleccionarCandidatos(elegibles = [], consulta = "", max = MAX_CANDIDATOS, { restricciones = [], preferencias = [], historial = null } = {}) {
  const terminos = terminosConsulta(consulta);
  if (!elegibles.length) return { tipo: "SIN_PRODUCTOS", terminos, candidatos: [], puntuaciones: [], categorias: [], restricciones, excluidos: [] };
  const { permitidos, excluidos } = filtrarProductos(elegibles, restricciones);
  const categorias = categoriasDe(permitidos), base = { terminos, restricciones, excluidos };
  const motivoExclusion = lista => lista.some(x => x.estado === "NO_VERIFICABLE") ? "NO_VERIFICABLE" : "INCOMPATIBLE";
  if (!permitidos.length) return { ...base, tipo: "SIN_CANDIDATOS_RESTRICCION", motivo: motivoExclusion(excluidos), candidatos: [], puntuaciones: [], categorias };
  if (!terminos.length) return { ...base, tipo: "GENERAL", candidatos: muestraGeneral(permitidos, max, preferencias, historial), puntuaciones: [], categorias };
  const puntuaciones = permitidos.map(p => { const r = { producto: p, ...puntuar(p, terminos) };
      if (preferencias.length && r.puntos > 0) { const b = bonoPreferencias(p, preferencias); r.bonoPreferencias = b.bono; r.preferenciasCoincidentes = b.coincidencias; }
      if (historial && r.puntos > 0) { const h = bonoHistorial(p, historial); if (h.bono) { r.bonoHistorial = h.bono; r.motivosHistorial = h.motivos; } }
      return r; })
    .sort((a, b) => total(b) - total(a) || porNombre(a.producto, b.producto));
  const candidatos = puntuaciones.filter(x => x.puntos > 0).slice(0, max).map(x => x.producto);
  if (!candidatos.length && excluidos.length) {
    // ¿El cliente pidió justamente un producto excluido? (p. ej. "las barras" siendo alérgico al maní)
    // Se toman los excluidos con la MAYOR puntuación (lo que el cliente nombró). Motivo INCOMPATIBLE solo si todos
    // ellos declaran el ingrediente; si alguno es no verificable, se informa falta de información.
    const conPuntos = excluidos.map(x => ({ x, puntos: puntuar(x.producto, terminos).puntos })).filter(y => y.puntos > 0);
    const maxima = Math.max(0, ...conPuntos.map(y => y.puntos)), pedidos = conPuntos.filter(y => y.puntos === maxima).map(y => y.x);
    if (pedidos.length) return { ...base, tipo: "SOLICITUD_EXCLUIDA", motivo: motivoExclusion(pedidos), candidatos: [], puntuaciones, categorias };
  }
  return { ...base, tipo: candidatos.length ? "ESPECIFICA" : "SIN_COINCIDENCIAS", candidatos, puntuaciones, categorias };
}
// Restricciones expresadas en la consulta (alergias, intolerancias, "sin …", dietas) que el backend NO puede
// comprobar contra los datos declarados del producto: en ese caso el respaldo automático se abstiene.
const PATRON_RESTRICCION = /(?:^|[^a-z0-9])(?:sin|libre de|alergi[a-z]*|alergic[a-z]*|intoleran[a-z]*|celiac[a-z]*|evit[a-z]*|vegan[a-z]*|vegetarian[a-z]*|no (?:puedo|debo|quiero) (?:comer|tomar|consumir))(?![a-z0-9])/;
const hayRestricciones = consulta => PATRON_RESTRICCION.test(normalizar(consulta));
const texto = v => typeof v === "string" ? v.trim() : "";
// Respaldo del backend para consultas ESPECÍFICAS: candidatos que cubren la mayor cantidad de términos distintos
// de la consulta, en orden de puntuación, máx. 5. Solo IDs ya seleccionados por relevancia (nunca otros).
function respaldoEspecifico(seleccion, max = MAX_CANDIDATOS) {
  if (!seleccion || seleccion.tipo !== "ESPECIFICA" || !seleccion.candidatos?.length) return [];
  const ids = new Set(seleccion.candidatos.map(p => p.id));
  const cubiertos = (seleccion.puntuaciones || []).filter(x => ids.has(x.producto.id) && x.puntos > 0)
    .map(x => ({ producto: x.producto, cobertura: new Set(x.coincidencias.map(c => c.termino)).size }));
  const maxima = Math.max(0, ...cubiertos.map(x => x.cobertura));
  return cubiertos.filter(x => x.cobertura === maxima && maxima > 0).slice(0, max).map(x => x.producto);
}
// Opciones para ServicioIA a partir de la selección (mismas reglas en la API y en las verificaciones reales):
//   sinCoincidencias → no se llama al modelo;
//   respaldo         → IDs de respaldo SOLO si la consulta es específica y no hay restricciones declaradas
//                      (consulta o perfil autorizado con alergias/condiciones) que impidan comprobar compatibilidad.
//   respuestaFija     → FASE 9B-1: alergia ambigua, ningún candidato permitido o producto pedido excluido (sin modelo).
const origenRestricciones = rs => {
  const origenes = new Set((rs || []).flatMap(r => r.origenes || [r.origen]));
  return origenes.has("PERFIL") ? { perfil: true, consulta: [...origenes].some(o => o !== "PERFIL") } : {};
};
function opcionesSeleccion(seleccion, { consulta = "", perfil = null } = {}) {
  if (seleccion?.tipo === "RESTRICCION_AMBIGUA") return { respuestaFija: { tipo: "RESTRICCION_AMBIGUA" } };
  if (seleccion?.tipo === "CONTRADICCION_PERFIL") return { respuestaFija: { tipo: "CONTRADICCION_PERFIL" } };
  if (seleccion?.tipo === "SIN_CANDIDATOS_RESTRICCION" || seleccion?.tipo === "SOLICITUD_EXCLUIDA")
    return { respuestaFija: { tipo: seleccion.tipo, motivo: seleccion.motivo } };
  if (seleccion?.tipo === "SIN_COINCIDENCIAS") return { sinCoincidencias: { categorias: seleccion.categorias || [] } };
  // Restricción declarada con candidatos permitidos (GENERAL o ESPECIFICA): si el modelo no elige ninguno, la
  // respuesta debe explicar el filtrado (conteos y categorías reales), no el texto general del catálogo.
  const restriccionAplicada = (seleccion?.restricciones || []).length && ["GENERAL", "ESPECIFICA"].includes(seleccion?.tipo)
    ? { restriccionAplicada: { incompatibles: (seleccion.excluidos || []).filter(x => x.estado === "INCOMPATIBLE").length,
      noVerificables: (seleccion.excluidos || []).filter(x => x.estado === "NO_VERIFICABLE").length, categorias: seleccion.categorias || [],
      // FASE 9B-2: origen de las restricciones (solo para redactar el mensaje; nunca se envía a Ollama).
      ...origenRestricciones(seleccion.restricciones) } } : {};
  if (seleccion?.tipo !== "ESPECIFICA") return restriccionAplicada;
  // Con cualquier restricción (detectada por el evaluador o por el patrón amplio) el respaldo automático se abstiene.
  const restringida = (seleccion.restricciones || []).length > 0 || hayRestricciones(consulta) || !!(perfil && (texto(perfil.alergias) || texto(perfil.condicionesMedicas)));
  if (restringida) return { respaldoOmitido: "RESTRICCIONES", ...restriccionAplicada };
  const respaldo = respaldoEspecifico(seleccion).map(p => p.id);
  return respaldo.length ? { respaldo } : {};
}
module.exports = { MAX_CANDIDATOS, hayRestricciones, respaldoEspecifico, opcionesSeleccion, PESOS, VACIAS, GENERICAS, normalizar, raiz, distancia, terminosConsulta, puntuar, muestraGeneral, seleccionarCandidatos };
