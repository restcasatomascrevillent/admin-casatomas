-- ===========================================================================
-- 20261212110000_audit_log_indice_busqueda — buscar en Auditoría sin «statement timeout» (18/11/2026)
-- ===========================================================================
-- El buscador de Super Admin › Auditoría filtra `texto_busqueda ilike '%…%'`
-- (persona, sección, pregunta y respuesta de la IA, nombre y contenido de lo
-- cambiado). Para cada fila había que abrir el detalle (`detalles`, en TOAST):
-- en la demo, contar los resultados de «arroz» entre la actividad de personas
-- tardaba 5,4 s y la página otro tanto si había pocos aciertos. Juntas pasan de
-- los 8 s de una petición del panel.
--
-- Índice de trigramas (pg_trgm, ya instalado en `extensions`) sobre ese texto,
-- solo para la actividad de personas, intentos e histórico (lo que enseña la
-- lista por defecto; 3,2 MB de texto en la demo). Con él Postgres va directo a
-- las filas que contienen lo buscado. La expresión tiene que ser IDÉNTICA a la
-- de `texto_busqueda` en la vista `audit_log_visible`
-- (20261212120000_audit_log_texto_busqueda_indexable): si se cambia una, hay
-- que cambiar la otra o el índice deja de usarse. Va con `||` y `coalesce` y no
-- con `concat_ws` porque `concat_ws` no es IMMUTABLE y no se puede indexar.
--
-- SIN transacción y en UNA sentencia, como 20261212100000 (`concurrently` no
-- bloquea las escrituras ni puede ir dentro de una transacción). Si se corta a
-- medias deja un índice inválido: bórralo con el rollback y vuelve a lanzarlo.
-- Vuelta atrás: supabase/rollbacks/20261212110000_audit_log_indice_busqueda_ROLLBACK.sql.
create index concurrently if not exists idx_audit_log_busqueda
  on public.audit_log using gin ((
    coalesce(actor_label, '') || ' '
    || coalesce(tabla, '') || ' '
    || coalesce(detalles ->> 'pregunta', '') || ' '
    || coalesce(detalles ->> 'respuesta', '') || ' '
    || coalesce(detalles -> 'despues' ->> 'nombre', '') || ' '
    || coalesce(detalles -> 'antes' ->> 'nombre', '') || ' '
    || coalesce(detalles -> 'despues' ->> 'contenido', '') || ' '
    || coalesce(detalles -> 'antes' ->> 'contenido', '') || ' '
    || coalesce(detalles -> 'despues' ->> 'content', '') || ' '
    || coalesce(detalles -> 'antes' ->> 'content', '') || ' '
    || coalesce(detalles ->> 'operacion', '')
  ) extensions.gin_trgm_ops)
  where actor_origin in ('usuario', 'intento', 'historico');
