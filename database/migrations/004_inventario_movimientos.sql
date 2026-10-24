-- FASE 5 aprobada: no reconstruir existencias históricas desconocidas.
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM movimientos_inventario) THEN
  RAISE EXCEPTION 'FASE5: existen movimientos previos; se requiere revisión antes de ampliar la trazabilidad';
 END IF;
END $$;
ALTER TABLE movimientos_inventario
 ADD COLUMN existencia_anterior INTEGER,
 ADD COLUMN existencia_nueva INTEGER NOT NULL,
 DROP CONSTRAINT movimientos_inventario_cantidad_check,
 ALTER COLUMN motivo SET NOT NULL,
 ALTER COLUMN fecha SET NOT NULL,
 ALTER COLUMN fecha SET DEFAULT CURRENT_TIMESTAMP,
 ADD CONSTRAINT movimientos_motivo_check CHECK(length(btrim(motivo))>0),
 ADD CONSTRAINT movimientos_existencias_check CHECK
  ((existencia_anterior IS NULL OR existencia_anterior>=0) AND existencia_nueva>=0),
 ADD CONSTRAINT movimientos_operacion_check CHECK (
  (tipo='AJUSTE' AND cantidad>=0 AND existencia_nueva=cantidad
   AND (existencia_anterior IS NULL OR existencia_anterior<>existencia_nueva)) OR
  (tipo='ENTRADA' AND cantidad>0 AND existencia_anterior IS NOT NULL
   AND existencia_nueva::bigint=existencia_anterior::bigint+cantidad::bigint) OR
  (tipo='SALIDA' AND cantidad>0 AND existencia_anterior IS NOT NULL
   AND existencia_nueva::bigint=existencia_anterior::bigint-cantidad::bigint)
 );
CREATE UNIQUE INDEX movimientos_configuracion_unica
 ON movimientos_inventario(id_producto) WHERE existencia_anterior IS NULL;
CREATE INDEX movimientos_fecha_idx ON movimientos_inventario(fecha DESC,id_movimiento DESC);
CREATE INDEX movimientos_producto_fecha_idx ON movimientos_inventario(id_producto,fecha DESC,id_movimiento DESC);
CREATE INDEX movimientos_usuario_fecha_idx ON movimientos_inventario(id_usuario,fecha DESC,id_movimiento DESC);
CREATE INDEX movimientos_tipo_fecha_idx ON movimientos_inventario(tipo,fecha DESC,id_movimiento DESC);
