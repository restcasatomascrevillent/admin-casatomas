set client_encoding = 'UTF8';
-- ===========================================================================
-- 20261205100000_audit_log_indice_informe — índice para el informe mensual de auditoría (16/11/2026)
-- ===========================================================================
-- El «Informe mensual de auditoría» daba «canceling statement due to statement
-- timeout»: recorría entera la tabla audit_log del mes (más de 100 MB con el
-- detalle de cada evento) y no cabe en los 8 s que tiene una petición del panel.
-- Este índice lleva dentro lo poco que necesita el resumen (quién, qué, dónde,
-- cuándo), así el informe lo saca del índice sin abrir la tabla.
--
-- SIN transacción a propósito: `create index concurrently` no bloquea las
-- escrituras (cada cambio del panel escribe en audit_log) y no puede ir dentro
-- de una. Si se corta a medias deja un índice inválido: bórralo con el rollback
-- y vuelve a lanzar este fichero.
-- Vuelta atrás: supabase/rollbacks/20261205100000_audit_log_indice_informe_ROLLBACK.sql.
create index concurrently if not exists idx_audit_log_informe_mensual
  on public.audit_log (created_at) include (actor_origin, accion, tabla, actor_label, id);

-- La tabla casi solo recibe altas. Con el ajuste por defecto el autovacuum pasa
-- cada +20 % de filas y, hasta entonces, las filas nuevas obligan a abrir la
-- tabla aunque el dato esté en el índice. Así pasa cada 5.000 altas.
alter table public.audit_log set (autovacuum_vacuum_insert_scale_factor = 0, autovacuum_vacuum_insert_threshold = 5000);
