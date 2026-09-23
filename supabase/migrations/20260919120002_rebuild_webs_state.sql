-- =====================================================================
-- Estado de redespliegue de las webs publicas (antirrebote de rebuild-webs)
-- Proyecto Supabase: jeamoczmbfsnwkfjxcyo
-- Generada: 2026-09-19
-- APLICADA -- verificado 2026-09-23 contra supabase_migrations.schema_migrations
-- (API de Supabase, solo lectura). La cabecera decia "NO APLICADA"; ya no es
-- cierto (ver informe de la tarea de traduccion). SQL sin tocar.
--
-- PROBLEMA QUE RESUELVE
--   casa-tomas-story y touza-restaurant-website prerenderizan la carta en
--   tiempo de build (Platos, Vinos, Bebidas, Cocteles). Un cambio de precio
--   en el panel no se ve en la web hasta el siguiente deploy. La Edge
--   Function rebuild-webs (supabase/functions/rebuild-webs/index.ts) dispara
--   un Vercel Deploy Hook tras cada guardado relevante, pero editar la carta
--   implica MUCHOS guardados seguidos: sin control, cada uno lanzaria un
--   build y se agotarian los minutos de Vercel o se encadenarian despliegues.
--
-- MECANISMO (logica completa en rebuild-webs/index.ts)
--   Antirrebote de "flanco de subida + cooldown", SIN pg_cron ni piezas de
--   infraestructura nuevas:
--     - La primera solicitud tras un periodo de silencio dispara el build
--       YA (flanco de subida) y guarda ultimo_disparo = now().
--     - Cualquier solicitud dentro de los COOLDOWN_MINUTES siguientes
--       (10 min, constante en rebuild-webs/index.ts) NO dispara: solo marca
--       pendiente = true y actualiza ultima_solicitud. Asi 20 guardados
--       seguidos durante una sesion de edicion de carta producen 1 build
--       por sitio, no 20.
--     - Autolimpieza: CADA llamada a rebuild-webs (la origine el sitio que
--       sea) revisa de paso si hay OTRO sitio marcado pendiente=true cuyo
--       cooldown ya haya vencido, y lo dispara tambien (funcion
--       flushPendientes). Con el uso normal del panel (varios guardados de
--       carta por sesion, entre platos/bebidas/vinos/cocteles/menus/tapas)
--       esto basta para no dejar nunca un cambio "colgado" sin publicar.
--       Si en el futuro se quiere una garantia estricta para el caso limite
--       de "el ultimo cambio del dia y nadie vuelve a guardar nada mas", la
--       extension natural es un pg_cron cada pocos minutos que invoque la
--       misma Edge Function con un origen especial de "flush" -- no se
--       incluye aqui para no anadir infraestructura que no se pidio.
--
-- QUE SITIOS AFECTA CADA ORIGEN (verificado por grep de `.from(` en los
-- propios repos touza-restaurant-website y casa-tomas-story, no supuesto:
-- el encargo original asumia "platos = solo restaurante", pero el codigo
-- real de touza tambien lee Platos):
--   plato, bebida, vino -> casa-tomas-story Y touza (las dos leen las 3 tablas)
--   coctel              -> solo touza (casa-tomas-story NO lee Cocteles)
--   menu, tapas         -> solo casa-tomas-story (touza no lee esas tablas)
-- =====================================================================
-- Sin `begin;` / `commit;` propios: supabase db push ya aplica cada
-- migracion dentro de su transaccion, y un commit explicito aqui cerraba
-- la transaccion externa antes de tiempo.
-- =====================================================================

create table if not exists public.web_rebuild_state (
  sitio text primary key,
  ultima_solicitud timestamptz,
  ultimo_disparo timestamptz,
  pendiente boolean not null default false,
  ultimo_origen text
);

comment on table public.web_rebuild_state is
  'Antirrebote de la Edge Function rebuild-webs: una fila por sitio publico (casa-tomas-story, touza). Solo la escribe esa funcion, con la service role key.';

alter table public.web_rebuild_state enable row level security;

-- Nadie via API/RLS normal: solo rebuild-webs (service_role, que salta RLS)
-- debe tocar esta tabla. Ni siquiera SELECT para authenticated: hoy no hay
-- ninguna pantalla del panel que necesite mostrar este estado.
-- El drop previo hace la migracion reejecutable: sin el, un reintento tras
-- un push a medias muere con 42710 (policy ... already exists).
drop policy if exists "web_rebuild_state_service_role" on public.web_rebuild_state;

create policy "web_rebuild_state_service_role" on public.web_rebuild_state
  for all to service_role using (true) with check (true);

revoke all on public.web_rebuild_state from anon, authenticated;
