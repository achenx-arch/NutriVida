// FASE 9B-1 — Evaluador DETERMINISTA de restricciones alimentarias (funciones puras: sin PostgreSQL ni Ollama).
// 1) prepararConsulta(texto): detecta restricciones DECLARADAS en la consulta actual (no las simples menciones ni
//    preguntas), marca alergias ambiguas y devuelve el texto para relevancia sin los términos de la restricción.
// 2) evaluarProducto(producto, restricciones): INCOMPATIBLE | NO_VERIFICABLE | SIN_CONFLICTO_DETECTADO + motivos.
//    SIN_CONFLICTO_DETECTADO NUNCA es una garantía: el catálogo no declara trazas ni certificaciones.
// 3) filtrarProductos(productos, restricciones): política de 9B-1 → solo pasan SIN_CONFLICTO_DETECTADO.
// Ollama NUNCA decide compatibilidad: recibe únicamente productos que ya pasaron este filtro.
const { RESTRICCIONES, NUTRIENTES, GENERICOS_UNIVERSALES, VERSION_DICCIONARIO } = require("./catalogoRestricciones");

const ESTADOS = Object.freeze({ INCOMPATIBLE: "INCOMPATIBLE", NO_VERIFICABLE: "NO_VERIFICABLE", SIN_CONFLICTO: "SIN_CONFLICTO_DETECTADO" });
const GRAVEDAD = { SIN_CONFLICTO_DETECTADO: 0, NO_VERIFICABLE: 1, INCOMPATIBLE: 2 };
const normalizar = s => String(s ?? "").toLowerCase().normalize("NFD").replace(/\p{M}/gu, "").replace(/\s+/g, " ").trim();
const escapar = s => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const patron = termino => new RegExp(`(?<![a-z0-9])${escapar(termino)}(?:s|es)?(?![a-z0-9])`, "g");
const quitarFrases = (texto, frases = []) => frases.reduce((t, f) => t.replace(patron(f), " "), texto);
const primeraCoincidencia = (texto, terminos = []) => {
  for (const t of [...terminos].sort((a, b) => b.length - a.length)) { const m = patron(t).exec(texto); if (m) return { termino: t, indice: m.index }; }
  return null;
};
// Un término precedido por "sin", "libre de", "bajo en"… en nombre/descripción es una DECLARACIÓN comercial, no un
// ingrediente ni una certificación: no se toma como conflicto ni como prueba de ausencia.
const CALIFICADOR_PREVIO = /(?:sin|libre de|libres de|bajo en|baja en|bajos en|bajas en|reducido en|reducida en|cero|0 ?%)\s+(?:[a-z]+\s+)?$/;
const ALTERNATIVA = /(?<![a-z0-9])(?:o|u|y\/o)(?![a-z0-9])|\//;

// ------------------------------------------------------------------ Detección en la consulta
const CONECTORES = new Set(["a", "al", "la", "las", "los", "el", "de", "del", "con", "y", "e", "ni", "o", "u", "un", "una", "alimentaria", "alimentarias",
  "alimenticia", "alimenticias", "severa", "leve", "grave", "fuerte", "mucha", "mucho", "que", "contenga", "contengan", "tenga", "tengan", "lleve", "lleven"]);
const CORTES = new Set(["pero", "para", "porque", "quiero", "quisiera", "busco", "buscar", "me", "recomienda", "recomiendas", "recomiendame", "dame",
  "necesito", "tienen", "tiene", "hay", "algo", "producto", "productos", "opcion", "opciones", "snack", "snacks", "bebida", "bebidas", "desayuno", "por", "favor"]);
const PALABRAS_ALERGIA = new Set(["alergico", "alergica", "alergicos", "alergicas", "alergia", "alergias", "intolerante", "intolerantes", "intolerancia", "intolerancias"]);
const PREVIAS_ALERGIA = new Set(["soy", "estoy", "sea", "ser", "tengo", "padezco", "sufro", "con", "una", "alguna", "algunas", "unas", "de"]);
const SIN_FALSOS = new Set(["embargo", "importar", "problema", "problemas", "prisa", "duda", "dudas", "mas"]);
const CALIFICADORES = new Set(["bajo", "baja", "bajos", "bajas", "reducido", "reducida", "alto", "alta", "altos", "altas", "rico", "rica", "ricos", "ricas"]);
const DIETAS = { vegano: "VEGANO", vegana: "VEGANO", veganos: "VEGANO", veganas: "VEGANO", vegetariano: "VEGETARIANO", vegetariana: "VEGETARIANO", vegetarianos: "VEGETARIANO", vegetarianas: "VEGETARIANO" };
const CELIACOS = new Set(["celiaco", "celiaca", "celiacos", "celiacas", "celiaquia"]);

// Mapea los tokens de un tramo a códigos del diccionario (frases de varias palabras primero).
function codigosEnTramo(tokens) {
  const texto = " " + tokens.join(" ") + " ", encontrados = [];
  for (const [codigo, def] of Object.entries(RESTRICCIONES))
    if (def.clase === "ALERGENO" && def.menciones.some(m => patron(m).test(texto))) encontrados.push(codigo);
  if (patron("lactosa").test(texto)) encontrados.push("LACTOSA");
  return [...new Set(encontrados)];
}
// Código final según la forma de la declaración: "sin lácteos"/"no puedo consumir lácteos" = dieta SIN_LACTEOS;
// "alérgico a la leche" = alérgeno LACTEOS; "intolerante a la lactosa" / "sin lactosa" = SIN_LACTOSA.
function resolverCodigo(codigo, estricta) {
  if (codigo === "LACTOSA") return "SIN_LACTOSA";
  if (estricta && codigo === "LACTEOS") return "SIN_LACTEOS";
  if (estricta && codigo === "GLUTEN") return "SIN_GLUTEN";
  return codigo;
}
function leerTramo(tokens, desde, max = 6) {
  const contenido = []; let j = desde;
  while (j < tokens.length && contenido.length < max) {
    const t = tokens[j];
    if (CORTES.has(t)) break;
    if (!CONECTORES.has(t)) contenido.push(t);
    j++;
  }
  return { contenido, fin: j - 1 };
}
function prepararConsulta(textoOriginal = "") {
  const restricciones = [], consumidos = [], negadas = []; let ambigua = false;
  const agregar = r => {
    const previa = restricciones.find(x => x.codigo === r.codigo && (r.codigo !== "PERSONALIZADA" || x.termino === r.termino) && x.calificador === r.calificador);
    if (!previa) restricciones.push(r); else if (r.severidad === "ALERGIA") previa.severidad = "ALERGIA";
  };
  const segmentos = normalizar(textoOriginal).split(/[,.;:!?¡¿()\n]+/).map(s => s.split(/[^a-z0-9%]+/).filter(Boolean));
  segmentos.forEach((tokens, s) => {
    const usados = new Set();
    const consumir = (a, b) => { for (let k = a; k <= b; k++) usados.add(k); };
    for (let i = 0; i < tokens.length; i++) {
      const t = tokens[i];
      const negada = [tokens[i - 1], tokens[i - 2], tokens[i - 3]].includes("no") && !(t === "sin");
      // a) Alergias / intolerancias: "soy alérgico al maní", "tengo alergia a la soya", "intolerante a la lactosa".
      if (PALABRAS_ALERGIA.has(t)) {
        let ini = i; while (ini > 0 && (PREVIAS_ALERGIA.has(tokens[ini - 1]) || tokens[ini - 1] === "no")) ini--;
        const { contenido, fin } = leerTramo(tokens, i + 1);
        consumir(ini, Math.max(i, fin));
        // "no soy alérgico al maní", "no tengo alergias": no declara restricción. FASE 9B-2 (aditivo): se informan los
        // códigos negados para detectar contradicciones con lo guardado en el perfil (no cambia la detección de 9B-1).
        if (negada) { negadas.push(...codigosEnTramo(contenido).map(c => resolverCodigo(c, false))); continue; }
        const codigos = codigosEnTramo(contenido);
        if (codigos.length) codigos.forEach(c => agregar({ codigo: resolverCodigo(c, false), severidad: "ALERGIA", origen: "ALERGIA_DECLARADA" }));
        else if (contenido.length) contenido.forEach(term => agregar({ codigo: "PERSONALIZADA", termino: term, severidad: "ALERGIA", origen: "ALERGIA_DECLARADA" }));
        else ambigua = true;
        i = Math.max(i, fin); continue;
      }
      // b) Celiaquía declarada.
      if (CELIACOS.has(t)) { consumir(i > 0 && ["soy", "es"].includes(tokens[i - 1]) ? i - 1 : i, i); if (!negada) agregar({ codigo: "GLUTEN", severidad: "ALERGIA", origen: "CELIAQUIA_DECLARADA" }); else negadas.push("GLUTEN"); continue; }
      // c) Dietas: "soy vegano", "productos veganos".
      if (DIETAS[t]) { consumir(i > 0 && ["soy", "es"].includes(tokens[i - 1]) ? i - 1 : i, i); if (!negada) agregar({ codigo: DIETAS[t], severidad: "ESTRICTA", origen: "DIETA_DECLARADA" }); else negadas.push(DIETAS[t]); continue; }
      // d) Calificadores nutricionales que LIMITAN un nutriente: "bajo en azúcar", "reducido en sodio" (requieren
      //    información nutricional). "Alto/rico en proteína" es un criterio de búsqueda, no una restricción: se deja
      //    a la relevancia (sin cambio respecto a la versión anterior).
      if (CALIFICADORES.has(t) && (t.startsWith("baj") || t.startsWith("reduc")) && tokens[i + 1] === "en" && NUTRIENTES[tokens[i + 2]]) {
        consumir(i, i + 2);
        agregar({ codigo: "NUTRICIONAL", nutriente: NUTRIENTES[tokens[i + 2]], calificador: "BAJO", severidad: "ESTRICTA", origen: "CALIFICADOR_NUTRICIONAL" });
        i += 2; continue;
      }
      // e) "sin X", "libre de X", "que no contenga X", "no puedo comer X", "no consumo X", "evito X".
      let desde = -1, ini = i;
      if (t === "sin" && !SIN_FALSOS.has(tokens[i + 1])) desde = i + 1;
      else if ((t === "libre" || t === "libres") && tokens[i + 1] === "de") desde = i + 2;
      else if (t === "no" && ["contenga", "contengan", "tenga", "tengan", "lleve", "lleven"].includes(tokens[i + 1])) desde = i + 2;
      else if (t === "no" && ["puedo", "debo"].includes(tokens[i + 1]) && ["comer", "tomar", "consumir", "ingerir", "beber"].includes(tokens[i + 2])) desde = i + 3;
      else if (t === "no" && ["como", "tomo", "consumo", "ingiero", "bebo"].includes(tokens[i + 1])) desde = i + 2;
      else if (["evito", "evitar", "evitando", "evite"].includes(t)) desde = i + 1;
      if (desde < 0) continue;
      if (tokens[ini - 1] === "que" && t === "no") ini--;
      const { contenido, fin } = leerTramo(tokens, desde, 4);
      if (!contenido.length) continue;
      consumir(ini, fin);
      const frase = contenido.join(" ");
      if (/^azucar(?:es)? (?:anadid|agregad|adicionad)/.test(frase)) agregar({ codigo: "SIN_AZUCAR_ANADIDO", severidad: "ESTRICTA", origen: "SIN_DECLARADO" });
      else if (/^azucar/.test(frase)) agregar({ codigo: "SIN_AZUCAR", severidad: "ESTRICTA", origen: "SIN_DECLARADO" });
      else if (NUTRIENTES[contenido[0]] && !["gluten"].includes(contenido[0]) && !codigosEnTramo([contenido[0]]).length)
        agregar({ codigo: "NUTRICIONAL", nutriente: NUTRIENTES[contenido[0]], calificador: "SIN", severidad: "ESTRICTA", origen: "SIN_DECLARADO" });
      else {
        const codigos = codigosEnTramo(contenido);
        if (codigos.length) codigos.forEach(c => agregar({ codigo: resolverCodigo(c, true), severidad: "ESTRICTA", origen: "SIN_DECLARADO" }));
        else contenido.slice(0, 2).forEach(term => agregar({ codigo: "PERSONALIZADA", termino: term, severidad: "ESTRICTA", origen: "SIN_DECLARADO" }));
      }
      i = fin;
    }
    segmentos[s] = tokens.filter((_, k) => !usados.has(k));
    consumidos.push(...tokens.filter((_, k) => usados.has(k)));
  });
  const especificas = restricciones.length > 0;
  return { restricciones, negadas: [...new Set(negadas)], ambigua: ambigua && !especificas, consultaRelevancia: segmentos.map(t => t.join(" ")).filter(Boolean).join(", "),
    terminosRestriccion: consumidos, versionDiccionario: VERSION_DICCIONARIO };
}

// ------------------------------------------------------------------ Evaluación de un producto
function listaIngredientes(producto) {
  if (Array.isArray(producto.ingredientesLista)) return producto.ingredientesLista.map(String).filter(x => x.trim());
  // Texto "a, b (c, d), e o f": separa por comas que no estén dentro de paréntesis.
  return String(producto.ingredientes || "").split(/,(?![^(]*\))/).map(x => x.trim()).filter(Boolean);
}
function definicion(r) {
  if (r.codigo === "PERSONALIZADA") {
    const t = r.termino, variantes = [t, t.replace(/es$/, ""), t.replace(/s$/, "")].filter(v => v.length >= 3);
    return { clase: "PERSONALIZADA", incompatibles: [...new Set(variantes)], genericos: GENERICOS_UNIVERSALES };
  }
  if (r.codigo === "NUTRICIONAL") {
    const incompatibles = r.calificador === "SIN" ? (r.nutriente === "sal" ? ["sal"] : []) : [];
    return { clase: "NUTRICIONAL", incompatibles, genericos: [], nutricional: true, soloDeclarativo: r.calificador !== "SIN" };
  }
  return RESTRICCIONES[r.codigo];
}
function evaluarRestriccion(producto, r) {
  const def = definicion(r); if (!def) return { estado: ESTADOS.NO_VERIFICABLE, motivos: [{ codigo: r.codigo, regla: "RESTRICCION_DESCONOCIDA" }] };
  const motivos = [], codigo = r.codigo === "PERSONALIZADA" ? `PERSONALIZADA:${r.termino}` : r.codigo === "NUTRICIONAL" ? `NUTRICIONAL:${r.calificador}:${r.nutriente}` : r.codigo;
  const ingredientes = listaIngredientes(producto);
  // Ingredientes declarados.
  for (const original of ingredientes) {
    const texto = quitarFrases(normalizar(original), def.excepciones);
    const inc = primeraCoincidencia(texto, def.incompatibles);
    if (inc) { motivos.push({ codigo, ingrediente: original, termino: inc.termino, regla: ALTERNATIVA.test(texto) ? "ALTERNATIVA_CON_INGREDIENTE_INCOMPATIBLE" : (r.severidad === "ALERGIA" ? "ALERGENO_DECLARADO" : "INGREDIENTE_INCOMPATIBLE"),
      estado: ALTERNATIVA.test(texto) ? ESTADOS.NO_VERIFICABLE : ESTADOS.INCOMPATIBLE }); continue; }
    const gen = primeraCoincidencia(quitarFrases(texto, def.excepcionesGenericos), def.genericos);
    if (gen) motivos.push({ codigo, ingrediente: original, termino: gen.termino, regla: "INGREDIENTE_GENERICO", estado: ESTADOS.NO_VERIFICABLE });
  }
  if (!ingredientes.length) motivos.push({ codigo, regla: "SIN_INGREDIENTES_DECLARADOS", estado: ESTADOS.NO_VERIFICABLE });
  // Nombre y descripción comercial: menciones del término (no declaraciones "sin…/bajo en…", que no se verifican).
  for (const [campo, valor] of [["nombre", producto.nombre], ["descripcion", producto.descripcion]]) {
    const texto = quitarFrases(normalizar(valor), def.excepciones);
    for (const t of def.incompatibles) {
      const re = patron(t); let m;
      while ((m = re.exec(texto))) {
        const declarativo = CALIFICADOR_PREVIO.test(texto.slice(0, m.index));
        motivos.push({ codigo, campo, termino: t, regla: declarativo ? "DECLARACION_NO_VERIFICADA" : `MENCION_EN_${campo.toUpperCase()}`,
          estado: declarativo ? ESTADOS.NO_VERIFICABLE : ESTADOS.INCOMPATIBLE });
      }
    }
  }
  // Requisitos que dependen de información nutricional (no interpretable de forma fiable en el catálogo actual).
  if (def.nutricional && !motivos.some(x => x.estado === ESTADOS.INCOMPATIBLE))
    motivos.push({ codigo, regla: String(producto.valoresNutricionales || "").trim() ? "INFORMACION_NUTRICIONAL_NO_VERIFICABLE" : "SIN_INFORMACION_NUTRICIONAL", estado: ESTADOS.NO_VERIFICABLE });
  const estado = motivos.reduce((e, x) => GRAVEDAD[x.estado] > GRAVEDAD[e] ? x.estado : e, ESTADOS.SIN_CONFLICTO);
  return { estado, motivos, trazasVerificadas: false };
}
// Varias restricciones: TODAS deben cumplirse; gana el estado más grave.
function evaluarProducto(producto, restricciones = []) {
  const detalle = restricciones.map(r => ({ restriccion: r, ...evaluarRestriccion(producto, r) }));
  const estado = detalle.reduce((e, d) => GRAVEDAD[d.estado] > GRAVEDAD[e] ? d.estado : e, ESTADOS.SIN_CONFLICTO);
  return { estado, motivos: detalle.flatMap(d => d.motivos), trazasVerificadas: false };
}
// Política FASE 9B-1 (alergias y restricciones estrictas): INCOMPATIBLE y NO_VERIFICABLE se EXCLUYEN.
function filtrarProductos(productos = [], restricciones = []) {
  if (!restricciones.length) return { permitidos: productos, excluidos: [] };
  const permitidos = [], excluidos = [];
  for (const p of productos) {
    const ev = evaluarProducto(p, restricciones);
    (ev.estado === ESTADOS.SIN_CONFLICTO ? permitidos : excluidos).push(ev.estado === ESTADOS.SIN_CONFLICTO ? p : { producto: p, ...ev });
  }
  return { permitidos, excluidos };
}
const hayAlergia = restricciones => restricciones.some(r => r.severidad === "ALERGIA");
// Aviso de alérgenos y trazas: con cualquier restricción salvo las dietas por convicción o los límites de azúcar/
// nutrientes ("sin gluten" o "no puedo comer cacahuate" también lo reciben aunque no digan "alérgico").
const SOLO_DIETA = new Set(["VEGANO", "VEGETARIANO", "SIN_AZUCAR", "SIN_AZUCAR_ANADIDO", "NUTRICIONAL"]);
const requiereAvisoAlergenos = restricciones => hayAlergia(restricciones) || restricciones.some(r => !SOLO_DIETA.has(r.codigo));

// ------------------------------------------------------------------ FASE 9B-2 (aditivo): restricciones del perfil
// Unión conservadora: TODAS las restricciones de la consulta y del perfil autorizado se aplican; un mismo código no se
// duplica y conserva la severidad más alta (ALERGIA > ESTRICTA). Una nunca anula a la otra.
const clave = r => r.codigo + (r.termino ? ":" + r.termino : "") + (r.calificador ? ":" + r.calificador + ":" + r.nutriente : "");
function combinarRestricciones(deConsulta = [], dePerfil = []) {
  const mapa = new Map();
  for (const r of [...deConsulta, ...dePerfil]) {
    const previa = mapa.get(clave(r));
    if (!previa) mapa.set(clave(r), { ...r });
    else { if (r.severidad === "ALERGIA") previa.severidad = "ALERGIA"; if (previa.origen !== r.origen) previa.origenes = [...new Set([previa.origen, r.origen, ...(previa.origenes || [])])]; }
  }
  return [...mapa.values()];
}
// Contradicción: la consulta NIEGA algo guardado en el perfil ("No soy alérgico al maní" con MANI guardado).
const FAMILIA = { GLUTEN: "GLUTEN", SIN_GLUTEN: "GLUTEN", LACTEOS: "LACTEOS", SIN_LACTEOS: "LACTEOS" };
const familia = c => FAMILIA[c] || c;
function contradicciones(negadas = [], dePerfil = []) {
  const guardadas = new Set(dePerfil.map(r => familia(r.codigo)));
  return [...new Set(negadas.map(familia).filter(c => guardadas.has(c)))];
}

module.exports = { combinarRestricciones, contradicciones, ESTADOS, normalizar, prepararConsulta, evaluarProducto, evaluarRestriccion, filtrarProductos, hayAlergia, requiereAvisoAlergenos, listaIngredientes };
