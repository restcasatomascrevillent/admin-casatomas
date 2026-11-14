-- Vuelta atrás de 20261127100000_instagram_ajustes_estilo_feed.sql
-- Quita los ajustes de Instagram (estilo del feed). El panel vuelve a usar el
-- de por defecto («Solo foto»). No toca piezas ni programaciones.
drop trigger if exists instagram_ajustes_tocar on public.instagram_ajustes;
drop table if exists public.instagram_ajustes;
drop function if exists public.instagram_ajustes_tocar();
select 'instagram_ajustes: retirada' as resultado;
