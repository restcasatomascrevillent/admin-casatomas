-- Vuelta atrás de 20261205100000_audit_log_indice_informe (no toca datos).
-- Lanza ANTES el rollback de 20261205100100 (la función nueva sin el índice vuelve a ser lenta).
drop index concurrently if exists public.idx_audit_log_informe_mensual;
alter table public.audit_log reset (autovacuum_vacuum_insert_scale_factor, autovacuum_vacuum_insert_threshold);
