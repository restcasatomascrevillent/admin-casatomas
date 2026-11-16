set client_encoding = 'UTF8';
-- ============================================================================
--  20261203110000 · quitar el embedding de cada línea de factura
-- ----------------------------------------------------------------------------
--  Requiere 20261203100000_embeddings_por_nombre.sql (las RPC ya no leen
--  pf.embedding y procesar-factura ya no lo escribe). Aplicar SOLO después de
--  comprobar que el chatbot da lo mismo con la tabla por nombre.
--
--  Antes: productos_factura.embedding vector(1536) por línea + idx_productos_embedding (HNSW).
--  Ahora: sin columna ni índice; el vector está en productos_nombre_embedding.
--
--  OJO PRODUCCIÓN: DROP COLUMN no devuelve el espacio (la columna queda como
--  «muerta» en las filas). Para que el plan gratis vea los MB libres hace falta,
--  después y en un momento tranquilo:
--      VACUUM FULL public.productos_factura;
--  que reescribe la tabla y la BLOQUEA (lecturas y escrituras) mientras dura
--  (segundos con ~18.000 líneas). VACUUM FULL no puede ir dentro de una
--  transacción: lanzarlo suelto, no en esta migración. El índice sí se libera
--  al momento.
--  Vuelta atrás: supabase/rollbacks/20261203110000_quitar_embedding_lineas_ROLLBACK.sql
-- ============================================================================
begin;
set local lock_timeout = '10s';

do $$
begin
  if to_regclass('public.productos_nombre_embedding') is null then
    raise exception 'Falta productos_nombre_embedding: aplica antes 20261203100000_embeddings_por_nombre.sql';
  end if;
  if exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
              where n.nspname = 'public' and p.prosrc ~* '(pf|p)\.embedding\s*<=>') then
    raise exception 'Aún hay funciones que leen productos_factura.embedding: revisa 20261203100000';
  end if;
end;
$$;

drop index if exists public.idx_productos_embedding;
alter table public.productos_factura drop column if exists embedding;

do $$
begin
  raise notice 'quitar_embedding_lineas: columna quitada. En producción: VACUUM FULL public.productos_factura; para liberar el espacio.';
end;
$$;
commit;
