-- Vuelta atrás de 20261212100000_audit_log_indice_personas (no toca datos).
-- Sin el índice, la lista de Super Admin › Auditoría vuelve a recorrer los registros de procesos y puede volver a
-- dar «statement timeout». Sin transacción: `drop index concurrently` no bloquea las escrituras en audit_log.
drop index concurrently if exists public.idx_audit_log_personas;
