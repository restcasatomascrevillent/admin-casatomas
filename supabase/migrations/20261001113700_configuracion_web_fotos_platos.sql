-- ===========================================================================
-- ##                                                                       ##
-- ##          NO APLICADA: la aplica el dueño a mano (ver pasos)           ##
-- ##                                                                       ##
-- ##   Interruptor «Fotos de platos» por web. Aplicar ANTES de publicar    ##
-- ##   el panel y las dos webs. Idempotente. Puramente aditiva: crea UNA   ##
-- ##   tabla nueva y no toca Platos, ni la carta, ni ninguna otra tabla.   ##
-- ##                                                                       ##
-- ===========================================================================
--
-- Encargo del dueño (2026-10-01): en Gestor Web → Carta → Platos, dos
-- interruptores, «Fotos de platos en Casa Tomás» y «Fotos de platos en
-- Touza». Apagado = esa web no enseña NINGUNA foto de plato (ni el hueco ni
-- el placeholder). Encendido = lo de siempre. Por defecto, los dos encendidos:
-- aplicar esta migración no cambia nada de lo que se ve hoy.
--
-- POR QUÉ UNA TABLA NUEVA Y NO UNA QUE YA EXISTA
--   Revisadas las de configuración: chat_web_config (solo super admins, sin
--   lectura anónima: el chatbot la lee con service_role), configBotWeb (textos
--   del bot), configuracion_reservas (reservas), config_google_places y
--   config_redes_sociales (tokens: jamás deben ser legibles por anon). Ninguna
--   es «ajustes públicos de las webs», y meter aquí un permiso de lectura anónima
--   en cualquiera de ellas abriría columnas que no deben salir. De ahí
--   `configuracion_web`: singleton (id = true, como chat_web_config) pensado
--   para crecer con más ajustes públicos de las webs. REGLA para quien añada
--   columnas: TODO lo que viva aquí es legible por cualquiera con la anon key
--   (lo leen las webs). Nada secreto en esta tabla.
--
-- PERMISOS (mismo patrón que la Fase 2, 20260918120000_rls_por_permisos_de_seccion)
--   SELECT  anon + authenticated, sin condición: las webs la leen sin sesión
--           (en build, scripts/carta-ssg*.mjs, y otra vez en el navegador al
--           cargar la página: rebuild-webs hoy no llega a lanzar deploys).
--   UPDATE  authenticated con can_write_section('gestor_carta') — la pestaña
--           Carta del Gestor Web cuelga de esa sección (pestanasGestorWeb.ts).
--           has_section_permission() devuelve true a los super admins.
--   service_role: política explícita, como el resto de tablas de la Fase 2.
--   INSERT / DELETE / TRUNCATE: nadie salvo service_role/postgres. La fila
--   única la crea esta migración; borrarla dejaría a las webs en su
--   comportamiento por defecto (fotos visibles), pero no hay motivo para
--   permitirlo desde el panel.
--   Se hace `revoke all` antes de los `grant` para no depender de los
--   privilegios por defecto que Supabase da a anon/authenticated en tablas
--   nuevas (anon NO debe poder escribir aunque la RLS ya lo impida).
--
-- LO QUE PASA SI NO SE APLICA (falla abierto = fotos visibles, lo de hoy)
--   · Panel: los interruptores salen deshabilitados con un aviso discreto
--     («falta aplicar la migración»), sin toasts rojos.
--   · Webs: la lectura falla (PGRST205/404) y se publican las fotos como hoy.
--
-- CÓMO SE APLICA (lo hace el dueño, a mano, desde adminpanelct/).
-- NO con `supabase db push` ni `migration repair`: el historial remoto no
-- está al día y se llevaría las demás migraciones pendientes.
--   1. Que no haya transacciones largas abiertas (debe salir vacío):
--        npx supabase db query --linked "select pid, state, now() - xact_start as dura, left(query, 60) as consulta from pg_stat_activity where xact_start < now() - interval '1 minute' and pid <> pg_backend_pid();"
--   2. Aplicarla:
--        npx supabase db query --linked -f supabase/migrations/20261001113700_configuracion_web_fotos_platos.sql
--      Si falla con 55P03 (lock_not_available), NO se ha aplicado nada (todo
--      va en una transacción): reintentar desde el paso 1.
--   3. Probarla (todo dentro de BEGIN … ROLLBACK, no deja nada escrito):
--        npx supabase db query --linked -f supabase/tests/configuracion_web_test.sql
--      y las consultas de VERIFICACIÓN del pie de este fichero.
--   4. Publicar el panel (interruptores en Gestor Web → Carta → Platos).
--   5. Publicar casa-tomas-story y touza-restaurant-website (su código nuevo
--      lee el interruptor). Después, tocar el interruptor se nota al recargar
--      la web, sin deploy; el JSON-LD (fotos en datos estructurados) se
--      actualiza en el siguiente deploy.
--
-- CANDADOS: solo crea objetos nuevos; el único candado es sobre la tabla
-- nueva. `lock_timeout = 5s` por coherencia con el resto de migraciones.
--
-- Rollback: supabase/rollbacks/20261001113700_configuracion_web_fotos_platos_ROLLBACK.sql
-- (revertir ANTES el panel; las webs no hace falta: sin la tabla caen solas
-- a «fotos visibles»).
-- ===========================================================================

begin;

set local lock_timeout = '5s';

-- ---------------------------------------------------------------------------
-- 1. Tabla singleton
-- ---------------------------------------------------------------------------
create table if not exists public.configuracion_web (
  id                               boolean     primary key default true check (id),
  mostrar_fotos_platos_casa_tomas  boolean     not null default true,
  mostrar_fotos_platos_touza       boolean     not null default true,
  updated_at                       timestamptz not null default now(),
  updated_by                       uuid        null
);

comment on table public.configuracion_web is
  'Fila única (id=true) con ajustes PÚBLICOS de las webs (casa-tomas-story y touza). '
  'Legible por anon: no guardar aquí nada secreto. Escribe quien tenga la sección gestor_carta.';
comment on column public.configuracion_web.mostrar_fotos_platos_casa_tomas is
  'false = casa-tomas-story no enseña ninguna foto de plato (ni placeholder). El navegador lo lee al cargar; el JSON-LD lo toma del último build.';
comment on column public.configuracion_web.mostrar_fotos_platos_touza is
  'false = touza no enseña ninguna foto de plato (ni placeholder). El navegador lo lee al cargar; el JSON-LD lo toma del último build.';
comment on column public.configuracion_web.updated_by is
  'auth.uid() de quien hizo el último cambio (lo pone el trigger; NULL si fue SQL directo).';

insert into public.configuracion_web (id) values (true)
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- 2. updated_at / updated_by automáticos
-- ---------------------------------------------------------------------------
create or replace function public.configuracion_web_touch()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  new.updated_by := auth.uid();
  return new;
end;
$$;

revoke all on function public.configuracion_web_touch() from public, anon, authenticated;

drop trigger if exists trg_configuracion_web_touch on public.configuracion_web;
create trigger trg_configuracion_web_touch
  before update on public.configuracion_web
  for each row execute function public.configuracion_web_touch();

-- ---------------------------------------------------------------------------
-- 3. RLS
-- ---------------------------------------------------------------------------
alter table public.configuracion_web enable row level security;

drop policy if exists "configuracion_web_select_publico" on public.configuracion_web;
create policy "configuracion_web_select_publico" on public.configuracion_web
  for select to anon, authenticated
  using (true);

drop policy if exists "configuracion_web_update_seccion" on public.configuracion_web;
create policy "configuracion_web_update_seccion" on public.configuracion_web
  for update to authenticated
  using (public.can_write_section('gestor_carta'))
  with check (public.can_write_section('gestor_carta'));

drop policy if exists "configuracion_web_service_role" on public.configuracion_web;
create policy "configuracion_web_service_role" on public.configuracion_web
  for all to service_role using (true) with check (true);

-- ---------------------------------------------------------------------------
-- 4. Privilegios (sin depender de los default privileges de Supabase)
-- ---------------------------------------------------------------------------
revoke all on public.configuracion_web from public, anon, authenticated;
grant select on public.configuracion_web to anon;
grant select, update on public.configuracion_web to authenticated;
grant all on public.configuracion_web to service_role;

commit;

-- ===========================================================================
-- VERIFICACIÓN tras aplicar
-- ===========================================================================
--   select * from public.configuracion_web;
--   -- -> 1 fila: true | true | true | <ahora> | NULL
--
--   select policyname, cmd, roles::text from pg_policies
--   where schemaname = 'public' and tablename = 'configuracion_web' order by policyname;
--   -- -> service_role (ALL, {service_role}), select_publico (SELECT, {anon,authenticated}),
--   --    update_seccion (UPDATE, {authenticated})
--
--   select grantee, string_agg(privilege_type, ',' order by privilege_type)
--   from information_schema.role_table_grants
--   where table_schema = 'public' and table_name = 'configuracion_web'
--     and grantee in ('anon', 'authenticated') group by grantee;
--   -- -> anon: SELECT · authenticated: SELECT,UPDATE
--
--   Lo mismo que leen las webs (anon key), desde fuera:
--   curl "$VITE_SUPABASE_URL/rest/v1/configuracion_web?select=*" -H "apikey: $ANON" -H "Authorization: Bearer $ANON"
--   -- -> [{"id":true,"mostrar_fotos_platos_casa_tomas":true,...}]
-- ===========================================================================
