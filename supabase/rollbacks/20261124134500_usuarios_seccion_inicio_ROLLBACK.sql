-- Vuelta atrás de supabase/migrations/20261124134500_usuarios_seccion_inicio.sql
--
-- Borra la columna `user_roles.seccion_inicio` (y su CHECK): se pierde la sección de inicio
-- elegida para cada usuario y todos vuelven a entrar como siempre.
--
-- El panel aguanta sin la columna (la lee con respaldo y entra como siempre), pero guardar
-- «Al iniciar sesión, abrir» en Usuarios › Permisos daría error: mejor revertir antes el panel.

alter table public.user_roles drop constraint if exists user_roles_seccion_inicio_formato;
alter table public.user_roles drop column if exists seccion_inicio;
