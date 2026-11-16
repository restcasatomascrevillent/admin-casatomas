set client_encoding = 'UTF8';
-- Deshace 20261203110000_quitar_embedding_lineas.sql: vuelve a crear
-- productos_factura.embedding vector(1536) y la rellena con el vector de su
-- nombre (productos_nombre_embedding, precisión halfvec), y su índice HNSW.
-- Las líneas cuyo nombre aún no tiene vector quedan con NULL. Se puede aplicar
-- dos veces. Después, si se quiere, 20261203100000_embeddings_por_nombre_ROLLBACK.sql.
begin;
set local lock_timeout = '10s';

alter table public.productos_factura add column if not exists embedding vector(1536);

update public.productos_factura pf
   set embedding = e.embedding::vector(1536)
  from public.productos_nombre_embedding e
 where e.nombre = pf.nombre::text
   and e.embedding is not null
   and pf.embedding is null;

create index if not exists idx_productos_embedding
  on public.productos_factura using hnsw (embedding vector_cosine_ops);

do $$
begin
  raise notice 'quitar_embedding_lineas: rollback aplicado (embedding por línea de nuevo)';
end;
$$;
commit;
