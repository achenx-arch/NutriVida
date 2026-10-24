const { Base, iso } = require('./base');
const { LIMITES_HISTORIAL, normalizarResumen } = require('../../services/historialIA');

const dtoConsumo = r => ({
  productoId: r.id_producto,
  producto: r.producto,
  categoria: r.categoria,
  cantidadTotal: Number(r.cantidad_total),
  numeroCompras: Number(r.numero_compras),
  // MAX(fecha_pedido): el modelo aprobado no almacena fecha real de entrega.
  ultimaFecha: iso(r.ultima_fecha),
  fuenteUltimaFecha: 'FECHA_PEDIDO',
  precioPromedio: Number(r.precio_promedio).toFixed(2),
  precioPromedioFormateado: `Q ${Number(r.precio_promedio).toFixed(2)}`
});

class RepositorioHistorialConsumo extends Base {
  // FASE 9C: resumen LIMITADO para la relevancia de NutriVida AI. SOLO LECTURA (transacción READ ONLY), parametrizado y
  // acotado al cliente autenticado. Solo pedidos ENTREGADO (estado terminal) con productos, dentro de la ventana, los N más
  // recientes. Devuelve conteos por producto y por categoría: sin identificadores de pedido, precios, cantidades ni datos
  // personales. El llamador decide si puede leerse (autoriza_historial_ia === true); aquí no se persiste nada.
  async resumenIA(usuarioId, l = LIMITES_HISTORIAL) {
    return this.tx(async db => {
      await db.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY');
      const filas = (await db.query(
        `WITH recientes AS (
           SELECT p.id_pedido FROM pedidos p
           WHERE p.id_cliente = $1 AND p.estado = 'ENTREGADO' AND p.fecha_pedido IS NOT NULL
             AND p.fecha_pedido >= CURRENT_TIMESTAMP - make_interval(days => $2::int)
             AND EXISTS (SELECT 1 FROM detalle_pedido d WHERE d.id_pedido = p.id_pedido)
           ORDER BY p.fecha_pedido DESC, p.id_pedido DESC
           LIMIT $3::int)
         SELECT d.id_producto, c.nombre AS categoria, d.id_pedido
         FROM recientes r JOIN detalle_pedido d USING (id_pedido)
         JOIN productos pr USING (id_producto) JOIN categorias c USING (id_categoria)`,
        [usuarioId, l.dias, l.pedidos])).rows;
      const pedidos = new Set(filas.map(f => String(f.id_pedido)));
      const contar = clave => {
        const m = new Map();
        for (const f of filas) { const k = f[clave]; if (!m.has(k)) m.set(k, new Set()); m.get(k).add(String(f.id_pedido)); }
        return [...m].map(([k, s]) => [k, s.size]).sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0])));
      };
      return normalizarResumen({ pedidosConsiderados: pedidos.size,
        productos: contar('id_producto').slice(0, l.productos).map(([productoId, n]) => ({ productoId, pedidos: n })),
        categorias: contar('categoria').slice(0, l.categorias).map(([categoria, n]) => ({ categoria, pedidos: n })) });
    });
  }

  async obtenerHistorial(usuarioId, f = {}) {
    return this.tx(async db => {
      await db.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY');

      const args = [usuarioId];
      const conds = ['id_usuario = $1'];

      if (f.categoria) {
        args.push(f.categoria);
        conds.push(`categoria = $${args.length}`);
      }

      if (f.busqueda) {
        args.push(`%${f.busqueda.replace(/[\\%_]/g, '\\$&')}%`);
        conds.push(`producto ILIKE $${args.length}`);
      }

      const where = ' WHERE ' + conds.join(' AND ');
      const from = ' FROM v_historial_consumo';

      const totalRes = await db.query('SELECT count(*) n' + from + where, args);
      const total = Number(totalRes.rows[0].n);

      const limit = Number(f.limit) || 20;
      const page = Number(f.page) || 1;
      const argsPaginados = [...args, limit, (page - 1) * limit];

      const rows = (await db.query(
        `SELECT *` + from + where +
        ` ORDER BY cantidad_total DESC, ultima_fecha DESC
         LIMIT $${argsPaginados.length - 1} OFFSET $${argsPaginados.length}`,
        argsPaginados
      )).rows;

      // Resumen general del cliente
      const stats = (await db.query(
        `SELECT
           COUNT(DISTINCT id_producto)::int AS productos_distintos,
           COALESCE(SUM(cantidad_total), 0)::bigint AS unidades_totales,
           (SELECT COUNT(*) FROM pedidos WHERE id_cliente = $1 AND estado = 'ENTREGADO') AS compras_totales
         FROM v_historial_consumo
         WHERE id_usuario = $1`,
        [usuarioId]
      )).rows[0];

      // Categoría más consumida
      const topCat = (await db.query(
        `SELECT categoria, SUM(cantidad_total) AS total
         FROM v_historial_consumo
         WHERE id_usuario = $1
         GROUP BY categoria
         ORDER BY total DESC
         LIMIT 1`,
        [usuarioId]
      )).rows[0];

      return {
        historial: rows.map(dtoConsumo),
        resumen: {
          totalProductosDistintos: stats.productos_distintos || 0,
          totalUnidadesConsumidas: Number(stats.unidades_totales) || 0,
          totalComprasRealizadas: Number(stats.compras_totales) || 0,
          categoriaMasConsumida: topCat ? topCat.categoria : null
        },
        paginacion: {
          page,
          limit,
          total,
          pages: Math.ceil(total / limit) || 1
        }
      };
    });
  }
}

module.exports = { RepositorioHistorialConsumo };
