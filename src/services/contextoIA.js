// DTO explícito: nunca pasar el usuario completo ni registros de persistencia.
// El llamador incluye perfil únicamente con consentimiento de PERFIL TRUE. Sin historial ni conversaciones.
// FASE 9A — contrato de datos PERMITIDOS hacia Ollama (lista blanca). Nunca: condiciones médicas, alergias en texto
// libre, correo, nombre, IDs de usuario o pedidos, tokens, contraseñas ni datos cifrados. El consentimiento de
// historial (FASE 9C) solo habilita un bono de relevancia en el backend: las compras NUNCA forman parte de este contexto.
const CAMPOS_PERFIL_PERMITIDOS = Object.freeze(["objetivoNutricional"]);
const MAX_TEXTO_PERFIL = 200;
const { ErrorValidacion } = require("../security/validate");
const { MAX_CANDIDATOS } = require("./relevanciaIA");
const texto = (valor) => typeof valor === "string" ? valor : "";
const esObjeto = (valor) => valor !== null && typeof valor === "object" && !Array.isArray(valor);
function crearContextoIA(datos = {}) {
  if (!esObjeto(datos)) throw new ErrorValidacion("El contexto de IA debe ser un objeto válido.");
  const { consulta, perfil, productos = [] } = datos;
  if (perfil != null && !esObjeto(perfil)) {
    throw new ErrorValidacion("El perfil del contexto de IA no es válido.");
  }
  if (!Array.isArray(productos) || productos.some((producto) => !esObjeto(producto))) {
    throw new ErrorValidacion("Los productos del contexto de IA no son válidos.");
  }
  return {
    consulta: texto(consulta),
    perfil: perfil ? Object.fromEntries(CAMPOS_PERFIL_PERMITIDOS.map(c => [c, texto(perfil[c]).slice(0, MAX_TEXTO_PERFIL)])) : null,
    productos: productos.slice(0, MAX_CANDIDATOS).map((p) => ({
      id: texto(p.id), precio: p.precio == null ? null : String(p.precio),
      nombre: texto(p.nombre), categoria: texto(p.categoria),
      // Descripción real del producto (PostgreSQL), recortada; nunca generada.
      descripcion: texto(p.descripcion).slice(0, 300),
      ingredientes: texto(p.ingredientes), valoresNutricionales: texto(p.valoresNutricionales),
    })),
  };
}
module.exports = { crearContextoIA, CAMPOS_PERFIL_PERMITIDOS };
