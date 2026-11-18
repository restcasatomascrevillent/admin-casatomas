-- ===========================================================================
-- 20261212105000_audit_log_indice_personas — la lista de Auditoría daba «statement timeout» (18/11/2026)
-- ===========================================================================
-- Super Admin › Auditoría abre la lista sin procesos del servidor
-- (`actor_origin in ('usuario','intento','historico')`), ordenada por fecha y de
-- 25 en 25, con el total de registros. En la demo (131.591 filas, 199 MB) las
-- 82.948 filas más recientes eran de procesos (`servicio`, `base_de_datos`) y
-- solo unas 50 de personas: para encontrar los 25 primeros visibles Postgres
-- recorría por fecha las 82.000 de procesos (7,6 s) y, para el total, la tabla
-- entera (1,8 s). Juntas pasan de los 8 s de una petición del panel y la lista
-- salía con «canceling statement due to statement timeout» (unas veces sí y
-- otras no). En producción aún entraba, pero iba a más con cada proceso.
--
-- Este índice solo guarda la actividad de personas, intentos e histórico, ya en
-- el orden de la lista (fecha y desempate por id), y lleva acción y sección para
-- poder contar el total sin abrir la tabla. Así la lista salta directamente a lo
-- que enseña. También sirve a «Por día» / «Por mes» y a las categorías rápidas
-- (todas filtran el mismo origen). Con «Procesos» o «Todos (incluye servidor)»
-- no se usa, ni hace falta: ahí las filas que se buscan son las abundantes.
--
-- SIN transacción a propósito: `create index concurrently` no bloquea las
-- escrituras (cada cambio del panel escribe en audit_log) y no puede ir dentro
-- de una. Por eso el fichero lleva UNA sola sentencia (sin `set client_encoding`):
-- `supabase db query -f` manda el fichero entero junto y con dos sentencias
-- fallaría con «cannot run inside a transaction block». Si se corta a medias deja
-- un índice inválido: bórralo con el rollback y vuelve a lanzar este fichero.
-- Vuelta atrás: supabase/rollbacks/20261212105000_audit_log_indice_personas_ROLLBACK.sql.
create index concurrently if not exists idx_audit_log_personas
  on public.audit_log (created_at desc, id desc)
  include (accion, tabla)
  where actor_origin in ('usuario', 'intento', 'historico');
