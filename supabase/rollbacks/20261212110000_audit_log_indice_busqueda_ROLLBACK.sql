-- Vuelta atrás de 20261212110000_audit_log_indice_busqueda (no toca datos).
-- Lanza ANTES el rollback de 20261212120000 si quieres volver también al `concat_ws` de la vista (sin el índice la
-- búsqueda funciona igual, solo vuelve a ser lenta). Sin transacción: no bloquea las escrituras en audit_log.
drop index concurrently if exists public.idx_audit_log_busqueda;
