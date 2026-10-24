-- FASE 3: eventos previos a una identidad autenticada. Conserva FK y filas existentes.
ALTER TABLE auditoria ALTER COLUMN id_usuario DROP NOT NULL;

-- Consulta de revocaciones sin recorrer toda la bitácora. No guarda JWT completos.
CREATE INDEX auditoria_logout_recurso_idx ON auditoria(recurso_accedido) WHERE accion='LOGOUT';
