-- FASE 7: Vista de historial de consumo derivado exclusivamente de pedidos ENTREGADOS
CREATE OR REPLACE VIEW v_historial_consumo AS
SELECT
  p.id_cliente AS id_usuario,
  d.id_producto,
  pr.nombre AS producto,
  c.nombre AS categoria,
  SUM(d.cantidad)::bigint AS cantidad_total,
  COUNT(DISTINCT p.id_pedido)::bigint AS numero_compras,
  MAX(p.fecha_pedido) AS ultima_fecha,
  ROUND(AVG(d.precio_unitario), 2) AS precio_promedio
FROM pedidos p
JOIN detalle_pedido d USING(id_pedido)
JOIN productos pr USING(id_producto)
JOIN categorias c USING(id_categoria)
WHERE p.estado = 'ENTREGADO'
GROUP BY p.id_cliente, d.id_producto, pr.nombre, c.nombre;
