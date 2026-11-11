-- Usuarios: sección que se abre al iniciar sesión (11/11/2026, petición del dueño: «Que en
-- Usuarios se pueda poner qué pestaña se le va a abrir por defecto cuando inician sesión»).
--
-- Columna `user_roles.seccion_inicio`: la entrada del menú lateral que el panel abre al entrar,
-- con las claves de src/lib/seccionInicio.ts ('reservas', 'facturas', 'gestion_web'…). NULL = lo
-- de siempre (el Dashboard o, sin él, la primera sección que puede ver). El permiso no se
-- comprueba aquí: si el usuario ya no puede ver esa sección, el panel hace lo de siempre.
--
-- Va en `user_roles` porque su RLS ya es la que hace falta, la misma que la del rol: cada usuario
-- lee su fila («Usuarios pueden ver su propio rol»), quien ve la sección Usuarios la consulta y
-- solo un super admin la escribe. No se añaden ni cambian políticas.
--
-- Vuelta atrás: supabase/rollbacks/20261124134500_usuarios_seccion_inicio_ROLLBACK.sql

alter table public.user_roles
  add column if not exists seccion_inicio text;

-- Solo una clave corta (no rutas ni texto libre); cuáles valen lo decide el panel.
alter table public.user_roles drop constraint if exists user_roles_seccion_inicio_formato;
alter table public.user_roles
  add constraint user_roles_seccion_inicio_formato
  check (seccion_inicio is null or seccion_inicio ~ '^[a-z][a-z_]{0,39}$');

comment on column public.user_roles.seccion_inicio is
  'Sección del menú que el panel abre al iniciar sesión (clave de src/lib/seccionInicio.ts). NULL = lo de siempre. La elige un super admin en Usuarios › Permisos.';
