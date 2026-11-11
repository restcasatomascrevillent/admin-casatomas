-- Vuelta atrás de supabase/migrations/20261124130000_usuarios_pestana_inicial.sql
--
-- AVISO: revertir el panel PRIMERO o a la vez. Sin la tabla, el panel nuevo sigue funcionando (la lista de
-- usuarios y la entrada ignoran el error de lectura y entran como siempre), pero «Pestaña al iniciar sesión»
-- no se podría guardar.
--
-- Se pierden las pestañas elegidas (no hay más datos que esos). La auditoría ya registrada se conserva.

begin;
drop table if exists public.user_pestana_inicial;
drop function if exists public.user_pestana_inicial_fijar_autor();
commit;
