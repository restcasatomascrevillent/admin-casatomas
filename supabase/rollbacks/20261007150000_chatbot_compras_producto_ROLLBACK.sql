set client_encoding = 'UTF8';
-- ===========================================================================
-- ROLLBACK de supabase/migrations/20261007150000_chatbot_compras_producto.sql
-- ===========================================================================
-- No es una migración (ver supabase/rollbacks/README.md). Se ejecuta A MANO,
-- POR TERMINAL (no en el SQL Editor):
--   npx supabase db query --linked -f supabase/rollbacks/20261007150000_chatbot_compras_producto_ROLLBACK.sql
--
-- ANTES: volver a desplegar la chat-facturas anterior (la nueva llama a
-- compras_producto_agente; sin la función, esa herramienta da error y el
-- chatbot dice que no ha podido consultar los datos).
--
-- Borra compras_producto_agente, raices_producto_agente,
-- raiz_producto_agente y palabras_producto_agente (la migración no tocó
-- ninguna otra función, tabla ni dato). Quita pg_trgm SOLO si nada más
-- depende de ella (el 07/10/2026 no estaba instalada; si algo la usa ya, se
-- queda y lo avisa).
-- Imprime «chatbot_compras_producto: revertida | pg_trgm: …».
-- ===========================================================================

begin;
set local lock_timeout = '5s';

drop function if exists public.compras_producto_agente(text, date, date, text, integer, text, text, vector);
drop function if exists public.raices_producto_agente(text);
drop function if exists public.raiz_producto_agente(text);
drop function if exists public.palabras_producto_agente(text);

do $$
begin
  drop extension if exists pg_trgm;   -- RESTRICT: falla si algo depende de ella
exception when dependent_objects_still_exist then
  raise notice 'pg_trgm se queda instalada: otros objetos dependen de ella.';
end;
$$;

commit;

select 'chatbot_compras_producto: revertida | pg_trgm: '
       || case when exists (select 1 from pg_extension where extname = 'pg_trgm') then 'se queda (en uso)' else 'quitada' end
       || ' | funciones que quedan: '
       || (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public'
              and p.proname in ('compras_producto_agente', 'raices_producto_agente', 'raiz_producto_agente', 'palabras_producto_agente'))
       as resultado;
