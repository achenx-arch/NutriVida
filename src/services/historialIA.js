// FASE 9C — Resumen LIMITADO del historial de compras ENTREGADAS para personalizar la relevancia (solo en el backend).
// Se usa ÚNICAMENTE si autoriza_historial_ia === true (consentimiento independiente de FASE 9A). Nunca se envía a Ollama,
// nunca se persiste y nunca aparece en mensajes, registros ni auditoría. No implica seguridad, adecuación ni compatibilidad.
//
// Límites (parámetros fijos y documentados):
//   - ventana de 90 días (sobre pedidos.fecha_pedido: el modelo aprobado no almacena la fecha real de entrega; FASE 7);
//   - como máximo los 20 pedidos ENTREGADO más recientes que tengan productos;
//   - como máximo 5 productos recurrentes y 5 categorías frecuentes, con su número de pedidos.
// Bono (señal SECUNDARIA): solo para productos PERMITIDOS que ya coinciden con la consulta (puntos > 0):
//   +0,5 si el producto aparece en 2 o más pedidos entregados de la ventana;
//   +0,25 si aparece en 1 pedido, o si su categoría aparece en 2 o más pedidos;
//   máximo +0,5 por producto (la mitad de la coincidencia exacta más débil: descripción = 1).
const LIMITES_HISTORIAL = Object.freeze({ dias: 90, pedidos: 20, productos: 5, categorias: 5 });
const BONO_HISTORIAL = Object.freeze({ productoRecurrente: 0.5, productoUnaVez: 0.25, categoriaFrecuente: 0.25, maximo: 0.5, minimoRecurrencia: 2 });

const vacio = () => ({ pedidosConsiderados: 0, productos: [], categorias: [] });
// Normaliza el resumen leído (defensivo: solo campos esperados, sin datos personales ni identificadores de pedido).
function normalizarResumen(r) {
  if (!r || typeof r !== "object") return vacio();
  const entero = v => (Number.isInteger(v) && v > 0 ? v : 0);
  return {
    pedidosConsiderados: entero(r.pedidosConsiderados),
    productos: (Array.isArray(r.productos) ? r.productos : []).filter(p => p && typeof p.productoId === "string" && entero(p.pedidos))
      .slice(0, LIMITES_HISTORIAL.productos).map(p => ({ productoId: p.productoId, pedidos: p.pedidos })),
    categorias: (Array.isArray(r.categorias) ? r.categorias : []).filter(c => c && typeof c.categoria === "string" && entero(c.pedidos))
      .slice(0, LIMITES_HISTORIAL.categorias).map(c => ({ categoria: c.categoria, pedidos: c.pedidos })),
  };
}
function bonoHistorial(producto, resumen) {
  if (!resumen || (!resumen.productos?.length && !resumen.categorias?.length)) return { bono: 0, motivos: [] };
  const motivos = [];
  let bono = 0;
  const p = resumen.productos.find(x => x.productoId === producto.id);
  if (p) {
    const b = p.pedidos >= BONO_HISTORIAL.minimoRecurrencia ? BONO_HISTORIAL.productoRecurrente : BONO_HISTORIAL.productoUnaVez;
    bono += b; motivos.push(p.pedidos >= BONO_HISTORIAL.minimoRecurrencia ? "PRODUCTO_RECURRENTE" : "PRODUCTO_COMPRADO");
  }
  const c = resumen.categorias.find(x => x.categoria === producto.categoria);
  if (c && c.pedidos >= BONO_HISTORIAL.minimoRecurrencia) { bono += BONO_HISTORIAL.categoriaFrecuente; motivos.push("CATEGORIA_FRECUENTE"); }
  return { bono: Math.min(BONO_HISTORIAL.maximo, bono), motivos };
}
module.exports = { LIMITES_HISTORIAL, BONO_HISTORIAL, vacio, normalizarResumen, bonoHistorial };
