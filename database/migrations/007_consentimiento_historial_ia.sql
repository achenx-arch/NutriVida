-- FASE 9A: consentimiento INDEPENDIENTE para usar el historial de compras entregadas en NutriVida AI.
-- perfil_cliente.autoriza_contexto_ia se conserva como consentimiento del PERFIL (sin cambios).
-- La columna nueva nace NULL para todos (NULL/FALSE = no autorizado). No modifica datos existentes.
-- Idempotente; el mecanismo de migraciones además la registra una sola vez (checksum).
-- Reversión (manual, solo con aprobación): ALTER TABLE perfil_cliente DROP COLUMN IF EXISTS autoriza_historial_ia;
ALTER TABLE perfil_cliente ADD COLUMN IF NOT EXISTS autoriza_historial_ia BOOLEAN;
