// FASE 9B-2 — Catálogo CERRADO de datos alimentarios estructurados del CLIENTE (versión 1).
// Tres grupos independientes, cada uno guardado en UNA fila de preferencias_cliente (tipo fijo) con la lista de códigos
// cifrada (AES-256-GCM, version_cifrado = 2). Sin migración: la tabla ya admite tipos nuevos (VARCHAR(40)).
//
// - preferencias: flexibles. Solo suman un bono moderado de relevancia (nunca prohíben ni permiten nada).
// - restricciones: dietas ESTRICTAS evaluadas por el evaluador de FASE 9B-1 (mismos códigos).
// - alergenos: severidad ALERGIA en el evaluador de FASE 9B-1 (mismos códigos).
// Solo se habilitan los códigos cuya evaluación CONSERVADORA está respaldada por el diccionario de FASE 9B-1:
// el diccionario debe declarar ingredientes GENÉRICOS que, si aparecen, vuelven el producto NO_VERIFICABLE.
// Sin esa cobertura, la ausencia de coincidencias se interpretaría como "sin conflicto", lo que no es aceptable.
const VERSION_CATALOGO = 1;
const TIPOS_ALIMENTACION = Object.freeze({ preferencias: "PREFERENCIA_ALIMENTARIA", restricciones: "RESTRICCION_DIETETICA", alergenos: "ALERGENO_DECLARADO" });
const GRUPOS = Object.freeze(Object.keys(TIPOS_ALIMENTACION));

const n = s => String(s ?? "").toLowerCase().normalize("NFD").replace(/\p{M}/gu, "");
const palabras = s => n(s).match(/[a-z0-9]+/g) || [];
const tiene = (texto, raices) => palabras(texto).some(w => raices.some(r => w === r || w.startsWith(r)));
const ingredientesDe = p => Array.isArray(p.ingredientesLista) ? p.ingredientesLista.join(", ") : String(p.ingredientes || "");

// Preferencias: coincidencia determinista con datos REALES del producto (nombre, categoría, ingredientes, descripción).
const PREFERENCIAS = Object.freeze({
  INTEGRALES: { etiqueta: "Productos integrales", explicacion: "Prioriza productos cuyo nombre o ingredientes declaran «integral».",
    coincide: p => tiene(p.nombre, ["integral"]) || tiene(ingredientesDe(p), ["integral"]) },
  FRUTAS: { etiqueta: "Frutas", explicacion: "Prioriza productos que declaran frutas entre sus ingredientes.",
    coincide: p => tiene(ingredientesDe(p), ["fruta"]) },
  BEBIDAS_NATURALES: { etiqueta: "Bebidas naturales", explicacion: "Prioriza bebidas que se describen como naturales.",
    coincide: p => tiene(p.categoria, ["bebida"]) && (tiene(p.nombre, ["natural"]) || tiene(p.descripcion, ["natural"])) },
  SNACKS_SALUDABLES: { etiqueta: "Snacks saludables", explicacion: "Prioriza productos de la categoría de snacks.",
    coincide: p => tiene(p.categoria, ["snack"]) || tiene(p.nombre, ["snack"]) },
});

const RESTRICCIONES = Object.freeze({
  VEGETARIANO: { etiqueta: "Vegetariano", explicacion: "Excluye productos que declaran carne, pescado o mariscos. No equivale a vegano.", habilitada: true },
  VEGANO: { etiqueta: "Vegano", explicacion: "Excluye ingredientes de origen animal declarados (incluye miel y lácteos). No equivale a sin lactosa.", habilitada: true },
  SIN_LACTEOS: { etiqueta: "Sin lácteos", explicacion: "Excluye leche y derivados declarados. No implica sin gluten.", habilitada: true },
  SIN_LACTOSA: { etiqueta: "Sin lactosa", explicacion: "Excluye lactosa declarada; los lácteos sin dato de deslactosado se consideran no verificables.", habilitada: true },
  SIN_GLUTEN: { etiqueta: "Sin gluten", explicacion: "Excluye trigo, cebada, centeno y derivados; avena y harinas sin especificar se consideran no verificables. No es una certificación para celíacos.", habilitada: true },
  SIN_AZUCAR_ANADIDO: { etiqueta: "Sin azúcar añadido", explicacion: "Excluye azúcares, miel y jarabes declarados. No significa sin azúcar total.", habilitada: true },
  SIN_AZUCAR: { etiqueta: "Sin azúcar total", explicacion: "No disponible: requiere información nutricional verificable que el catálogo no tiene.", habilitada: false },
});

const ALERGENOS = Object.freeze({
  MANI: { etiqueta: "Maní (cacahuate)", habilitada: true },
  FRUTOS_SECOS: { etiqueta: "Frutos secos", habilitada: true },
  GLUTEN: { etiqueta: "Gluten (trigo, cebada, centeno)", habilitada: true },
  LACTEOS: { etiqueta: "Lácteos", habilitada: true },
  SOYA: { etiqueta: "Soya", habilitada: true },
  SESAMO: { etiqueta: "Sésamo (ajonjolí)", habilitada: true },
  // Deshabilitados (condición 5 de la aprobación de FASE 9B-2): el diccionario de FASE 9B-1 no declara ingredientes
  // genéricos para ellos, así que un ingrediente ambiguo ("masa", "caldo", "salsa") no se marcaría como no verificable.
  HUEVO: { etiqueta: "Huevo", habilitada: false, motivo: "No disponible todavía: no podemos detectar de forma conservadora ingredientes genéricos que podrían contener huevo." },
  PESCADO: { etiqueta: "Pescado", habilitada: false, motivo: "No disponible todavía: no podemos detectar de forma conservadora ingredientes genéricos que podrían contener pescado." },
  MARISCOS: { etiqueta: "Mariscos", habilitada: false, motivo: "No disponible todavía: no podemos detectar de forma conservadora ingredientes genéricos que podrían contener mariscos." },
});

const CATALOGO = Object.freeze({ preferencias: PREFERENCIAS, restricciones: RESTRICCIONES, alergenos: ALERGENOS });
const habilitado = (grupo, codigo) => grupo === "preferencias" ? !!PREFERENCIAS[codigo] : CATALOGO[grupo]?.[codigo]?.habilitada === true;
const codigosHabilitados = grupo => Object.keys(CATALOGO[grupo]).filter(c => habilitado(grupo, c));

// Opciones para la interfaz (sin funciones): etiqueta, explicación y si se puede seleccionar.
function opciones() {
  return Object.fromEntries(GRUPOS.map(g => [g, Object.entries(CATALOGO[g]).map(([codigo, d]) => ({ codigo, etiqueta: d.etiqueta,
    explicacion: d.explicacion || d.motivo || "", habilitada: habilitado(g, codigo), ...(d.motivo ? { motivo: d.motivo } : {}) }))]));
}
const vacia = () => ({ preferencias: [], restricciones: [], alergenos: [] });

// Datos guardados → restricciones del evaluador (origen PERFIL). Códigos deshabilitados o desconocidos se ignoran
// (no se inventa compatibilidad); quedan documentados como limitación.
function restriccionesDePerfil(alimentacion = vacia()) {
  return [
    ...(alimentacion.alergenos || []).filter(c => habilitado("alergenos", c)).map(codigo => ({ codigo, severidad: "ALERGIA", origen: "PERFIL" })),
    ...(alimentacion.restricciones || []).filter(c => habilitado("restricciones", c)).map(codigo => ({ codigo, severidad: "ESTRICTA", origen: "PERFIL" })),
  ];
}
// Bono de preferencias: +0,5 por preferencia que coincide, máximo +1 por producto.
const BONO_POR_PREFERENCIA = 0.5, BONO_MAXIMO = 1;
function bonoPreferencias(producto, preferencias = []) {
  const coincidencias = preferencias.filter(c => PREFERENCIAS[c]?.coincide(producto));
  return { bono: Math.min(BONO_MAXIMO, coincidencias.length * BONO_POR_PREFERENCIA), coincidencias };
}

module.exports = { VERSION_CATALOGO, TIPOS_ALIMENTACION, GRUPOS, CATALOGO, PREFERENCIAS, RESTRICCIONES, ALERGENOS, habilitado,
  codigosHabilitados, opciones, vacia, restriccionesDePerfil, bonoPreferencias, BONO_POR_PREFERENCIA, BONO_MAXIMO };
