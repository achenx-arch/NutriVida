// FASE 9B-1 — Diccionario CERRADO y documentado de restricciones alimentarias (versión 1).
// Solo términos explícitos y sinónimos conocidos (normalizados: minúsculas, sin tildes, ñ→n). No contiene
// certificaciones ni equivalencias inseguras: "sin lactosa" ≠ "sin lácteos", vegetariano ≠ vegano,
// "sin azúcar" ≠ "sin azúcar añadido" ≠ "bajo en azúcar", "sin gluten" ≠ "bajo en gluten".
//
// Por código:
//   menciones       → palabras con las que el CLIENTE nombra la restricción en su consulta.
//   incompatibles   → si aparecen en un ingrediente / nombre / descripción del producto ⇒ evidencia de conflicto.
//   excepciones     → frases que contienen un término incompatible pero NO lo son (p. ej. "leche vegetal").
//   genericos       → ingredientes genéricos que podrían contenerlo ⇒ NO_VERIFICABLE.
//   nutricional     → requiere información nutricional verificable (el catálogo actual no la tiene).
const VERSION_DICCIONARIO = 1;
const LECHES_VEGETALES = ["leche vegetal", "leches vegetales", "leche de almendra", "leche de avena", "leche de coco", "leche de soya",
  "leche de soja", "leche de arroz", "mantequilla de mani", "mantequilla de almendra", "mantequillas de frutos secos", "crema de cacahuate", "crema de mani", "leche de coco"];
const LACTEOS = ["leche", "lacteo", "queso", "yogur", "yogurt", "mantequilla", "crema de leche", "suero de leche", "lactosa", "caseina", "nata", "requeson"];
const CARNES = ["carne", "pollo", "res", "cerdo", "jamon", "tocino", "chorizo", "embutido", "gelatina", "manteca de cerdo", "caldo de pollo", "caldo de res"];
const PESCADOS = ["pescado", "atun", "salmon", "sardina", "anchoa", "bacalao", "tilapia"];
const MARISCOS = ["marisco", "camaron", "langosta", "cangrejo", "calamar", "pulpo", "mejillon", "almeja", "ostra", "crustaceo"];
const AZUCARES = ["azucar", "miel", "jarabe", "sirope", "panela", "melaza", "glucosa", "fructosa", "dextrosa", "maltodextrina", "piloncillo"];
const GLUTEN = ["gluten", "trigo", "cebada", "centeno", "espelta", "malta", "seitan", "semola"];
const FRUTOS_SECOS = ["almendra", "nuez", "nueces", "avellana", "anacardo", "maranon", "pistacho", "pecana", "macadamia", "castana", "frutos secos", "fruto seco"];

const RESTRICCIONES = Object.freeze({
  // ---------------- Alérgenos (por defecto: ALERGIA si se declara como alergia/intolerancia) ----------------
  MANI: { nombre: "maní", clase: "ALERGENO", menciones: ["mani", "cacahuate", "cacahuete", "cacahuates", "manies"],
    incompatibles: ["mani", "cacahuate", "cacahuete"], genericos: ["frutos secos", "fruto seco", "aceite vegetal", "aceite", "semillas", "granola", "mezcla de"] },
  FRUTOS_SECOS: { nombre: "frutos secos", clase: "ALERGENO", menciones: FRUTOS_SECOS,
    incompatibles: FRUTOS_SECOS, genericos: ["semillas", "aceite vegetal", "aceite", "granola", "mezcla de"] },
  GLUTEN: { nombre: "gluten", clase: "ALERGENO", menciones: ["gluten", "trigo", "cebada", "centeno", "celiaco", "celiaca", "celiacos", "celiaquia"],
    incompatibles: GLUTEN, genericos: ["avena", "harina", "harina integral", "cereal", "cereales", "granos", "galleta", "pan", "rebozado", "empanizado"] },
  LACTEOS: { nombre: "lácteos", clase: "ALERGENO", menciones: ["lacteo", "lacteos", "leche", "queso", "yogur", "yogurt", "proteina de leche"],
    incompatibles: LACTEOS, excepciones: LECHES_VEGETALES, genericos: ["crema", "cremas"] },
  HUEVO: { nombre: "huevo", clase: "ALERGENO", menciones: ["huevo", "huevos", "clara de huevo", "albumina"],
    incompatibles: ["huevo", "clara de huevo", "yema", "albumina", "mayonesa", "merengue"], genericos: [] },
  SOYA: { nombre: "soya", clase: "ALERGENO", menciones: ["soya", "soja"],
    incompatibles: ["soya", "soja", "tofu", "lecitina de soya", "lecitina de soja"], genericos: ["aceite vegetal", "aceite", "lecitina", "proteina vegetal"] },
  SESAMO: { nombre: "sésamo", clase: "ALERGENO", menciones: ["sesamo", "ajonjoli"],
    incompatibles: ["sesamo", "ajonjoli", "tahini", "tahin"], genericos: ["semillas", "aceite vegetal", "aceite"] },
  PESCADO: { nombre: "pescado", clase: "ALERGENO", menciones: ["pescado", "pescados"], incompatibles: PESCADOS, genericos: [] },
  MARISCOS: { nombre: "mariscos", clase: "ALERGENO", menciones: ["marisco", "mariscos", "camaron", "camarones", "crustaceo", "crustaceos"],
    incompatibles: MARISCOS, genericos: [] },
  // ---------------- Restricciones dietéticas (siempre estrictas) ----------------
  VEGANO: { nombre: "vegana", clase: "DIETA", menciones: ["vegano", "vegana", "veganos", "veganas"],
    incompatibles: [...LACTEOS, ...CARNES, ...PESCADOS, ...MARISCOS, "huevo", "miel", "colageno", "cera de abeja", "jalea real"],
    excepciones: LECHES_VEGETALES, genericos: ["grasa", "manteca"] },
  VEGETARIANO: { nombre: "vegetariana", clase: "DIETA", menciones: ["vegetariano", "vegetariana", "vegetarianos", "vegetarianas"],
    incompatibles: [...CARNES, ...PESCADOS, ...MARISCOS], genericos: ["manteca", "caldo"] },
  SIN_LACTEOS: { nombre: "sin lácteos", clase: "DIETA", menciones: [], incompatibles: LACTEOS, excepciones: LECHES_VEGETALES, genericos: ["crema", "cremas"] },
  // Sin lactosa ≠ sin lácteos: un lácteo puede ser deslactosado; sin ese dato declarado es NO_VERIFICABLE.
  SIN_LACTOSA: { nombre: "sin lactosa", clase: "DIETA", menciones: ["lactosa"], incompatibles: ["lactosa"],
    genericos: LACTEOS.filter(t => t !== "lactosa"), excepcionesGenericos: LECHES_VEGETALES },
  SIN_GLUTEN: { nombre: "sin gluten", clase: "DIETA", menciones: [], incompatibles: GLUTEN,
    genericos: ["avena", "harina", "harina integral", "cereal", "cereales", "granos", "galleta", "pan", "rebozado", "empanizado"] },
  SIN_AZUCAR_ANADIDO: { nombre: "sin azúcar añadido", clase: "DIETA", menciones: [], incompatibles: AZUCARES,
    genericos: ["endulzante", "endulzantes", "edulcorante", "edulcorantes", "saborizante", "saborizantes"] },
  // "Sin azúcar" (total) incluye azúcares naturales: sin información nutricional verificable nunca se puede comprobar.
  SIN_AZUCAR: { nombre: "sin azúcar", clase: "DIETA", menciones: [], incompatibles: AZUCARES,
    genericos: ["endulzante", "endulzantes", "edulcorante", "edulcorantes", "fruta", "frutas"], nutricional: true },
});
// Nutrientes reconocidos en "bajo en X" / "sin X" (restricciones que requieren información nutricional verificable).
// "Alto/rico en X" NO es restricción: es un criterio de búsqueda que se deja a la relevancia.
const NUTRIENTES = Object.freeze({ azucar: "azúcar", azucares: "azúcar", grasa: "grasa", grasas: "grasa", sodio: "sodio", sal: "sal",
  caloria: "calorías", calorias: "calorías", colesterol: "colesterol", carbohidrato: "carbohidratos", carbohidratos: "carbohidratos",
  proteina: "proteína", proteinas: "proteína", fibra: "fibra", gluten: "gluten" });
// Ingredientes genéricos para restricciones NO catalogadas (p. ej. "alérgico a la fresa"): podrían contener cualquier cosa.
const GENERICOS_UNIVERSALES = Object.freeze(["fruta", "frutas", "vegetales", "verduras", "semillas", "frutos secos", "aceite vegetal", "aceite",
  "endulzantes", "endulzante", "harina", "cereales", "especias", "condimentos", "saborizantes", "saborizante", "aditivos", "mezcla de"]);

module.exports = { VERSION_DICCIONARIO, RESTRICCIONES, NUTRIENTES, GENERICOS_UNIVERSALES };
