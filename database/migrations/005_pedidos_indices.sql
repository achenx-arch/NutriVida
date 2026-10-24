-- FASE 6: Índices de rendimiento y ordenación para pedidos
CREATE INDEX IF NOT EXISTS pedidos_fecha_idx ON pedidos(fecha_pedido DESC, id_pedido DESC);
CREATE INDEX IF NOT EXISTS pedidos_estado_fecha_idx ON pedidos(estado, fecha_pedido DESC, id_pedido DESC);
