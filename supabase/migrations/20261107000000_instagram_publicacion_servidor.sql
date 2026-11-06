set client_encoding = 'UTF8';
-- ===========================================================================
-- 20261107000000_instagram_publicacion_servidor — Estado de publicación solo
-- por el servidor, cerrojo contra la doble publicación y texto alternativo
-- (fase 0 de la propuesta de Instagram, 07/11/2026)
-- ===========================================================================
-- PROBLEMA
--   * Por la RLS de 20261105090000, cualquiera con edición de Marketing podía
--     escribir desde el navegador estado = 'publicada', media_id, permalink o
--     contenedor_id. Las métricas enlazan por media_id y la aprobación humana
--     de la IA dependerá del estado: no puede falsearse desde el cliente.
--   * «Publicar» a mano no miraba si la pieza tenía una programación activa, y
--     dos peticiones a la vez (dos pestañas, una prueba y una publicación, o el
--     programador y una persona) podían publicar dos veces o pisar «publicada»
--     con «prueba_ok».
--   * El texto alternativo (alt_text de la Graph API) no tenía dónde guardarse.
--
-- QUÉ CREA
--   1. instagram_piezas.alt_text (≤ 1000 caracteres, el máximo de Meta).
--   2. Trigger instagram_piezas_proteger_publicacion: un usuario del panel
--      (rol authenticated) SOLO puede
--        - crear piezas en «borrador» o «generada», sin contenedor_id,
--          media_id, permalink ni drive_id;
--        - cambiar el estado a «borrador» o «generada» (lo que hace el render);
--        - poner contenedor_id a null (al regenerar);
--      y NO puede tocar una pieza publicada ni cambiar media_id, permalink o
--      drive_id. Lo demás (estado «prueba_ok», «publicada», «error», ids de
--      Meta y de Drive) lo escriben las Edge Functions con service_role
--      DESPUÉS de autorizar al usuario (instagram-publicar) o desde el cron
--      (instagram-programador). Las funciones SECURITY DEFINER (dueño
--      postgres) tampoco pasan por el filtro.
--   3. public.instagram_publicaciones_en_curso: cerrojo con caducidad por
--      pieza. Sin acceso para el panel (RLS sin políticas; solo service_role).
--   4. RPC (solo service_role):
--        instagram_pieza_reservar_publicacion(pieza, segundos, comprobar_programacion)
--          → { ok:true, bloqueo } o { ok:false, motivo: no_existe | publicada
--            | en_curso | programada, programadaPara?, permalink? }
--          «programada» solo si comprobar_programacion (publicar a mano: hay
--          que cancelar antes la programación; el programador y las pruebas
--          no lo comprueban).
--        instagram_pieza_liberar_publicacion(pieza, bloqueo) → boolean
--
-- COMPATIBLE HACIA ATRÁS: instagram-publicar ya escribe con service_role
-- aunque esta migración no esté aplicada, y sigue sin cerrojo si la RPC no
-- existe. Puede aplicarse antes o después de desplegar las funciones.
--
-- APLICAR (una a una, nunca `db push`), DESPUÉS de 20261106110000_instagram_
-- programacion: demo primero (sfonaclosuafvlhutkon), producción
-- (haqmmdfdzzatdnrrcgez) solo tras aceptar el PR y con el «sí» del dueño:
--   npx supabase db query --linked -f supabase/migrations/20261107000000_instagram_publicacion_servidor.sql
-- Idempotente. Tiene que terminar en «instagram_publicacion_servidor: aplicada».
-- Deshacer: supabase/rollbacks/20261107000000_instagram_publicacion_servidor_ROLLBACK.sql
-- Pruebas: npm run test:instagram-servidor:db (PGlite).
-- ===========================================================================

begin;
set local lock_timeout = '5s';

-- ─── 0. Comprobaciones previas (no cambian nada) ────────────────────────────
do $$
declare
  v_faltan text[] := '{}';
begin
  if to_regclass('public.instagram_piezas') is null then
    v_faltan := v_faltan || 'public.instagram_piezas (aplica antes 20261105090000_instagram.sql)'::text;
  end if;
  if to_regclass('public.instagram_programaciones') is null then
    v_faltan := v_faltan || 'public.instagram_programaciones (aplica antes 20261106110000_instagram_programacion.sql)'::text;
  end if;
  if cardinality(v_faltan) > 0 then
    raise exception 'instagram_publicacion_servidor: falta %. No se ha cambiado nada.', array_to_string(v_faltan, ', ');
  end if;
end;
$$;

-- ─── 1. Texto alternativo ───────────────────────────────────────────────────
alter table public.instagram_piezas add column if not exists alt_text text;
alter table public.instagram_piezas drop constraint if exists instagram_piezas_alt_text_chk;
alter table public.instagram_piezas add constraint instagram_piezas_alt_text_chk
  check (alt_text is null or char_length(alt_text) <= 1000);
comment on column public.instagram_piezas.alt_text is
  'Texto alternativo de la imagen (alt_text de la Graph API, ≤ 1000; solo posts). Lo guarda instagram-publicar al probar o publicar.';

-- ─── 2. Estado de publicación: solo el servidor ─────────────────────────────
create or replace function public.instagram_piezas_proteger_publicacion()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  -- Servidor (service_role, postgres, funciones SECURITY DEFINER): sin filtro.
  if current_user not in ('authenticated', 'anon') then
    return new;
  end if;
  if tg_op = 'INSERT' then
    if new.estado not in ('borrador', 'generada')
       or new.contenedor_id is not null or new.media_id is not null or new.permalink is not null
       or (to_jsonb(new) ->> 'drive_id') is not null then
      raise exception 'Solo el servidor puede crear una pieza con estado de publicación (%)', new.estado
        using errcode = '42501';
    end if;
    return new;
  end if;
  if old.estado = 'publicada' or old.media_id is not null then
    raise exception 'Esa pieza ya está publicada en Instagram: no se puede cambiar desde el panel'
      using errcode = '42501';
  end if;
  if new.estado is distinct from old.estado and new.estado not in ('borrador', 'generada') then
    raise exception 'Solo el servidor puede poner una pieza en «%»', new.estado using errcode = '42501';
  end if;
  if new.media_id is distinct from old.media_id
     or new.permalink is distinct from old.permalink
     or (to_jsonb(new) -> 'drive_id') is distinct from (to_jsonb(old) -> 'drive_id')
     or (new.contenedor_id is distinct from old.contenedor_id and new.contenedor_id is not null) then
    raise exception 'Solo el servidor puede cambiar los datos de publicación de una pieza (contenedor, media_id, permalink, drive_id)'
      using errcode = '42501';
  end if;
  return new;
end;
$$;
revoke all on function public.instagram_piezas_proteger_publicacion() from public;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on function public.instagram_piezas_proteger_publicacion() from anon, authenticated';
  end if;
end;
$$;
drop trigger if exists instagram_piezas_proteger_publicacion on public.instagram_piezas;
create trigger instagram_piezas_proteger_publicacion
  before insert or update on public.instagram_piezas
  for each row execute function public.instagram_piezas_proteger_publicacion();

-- ─── 3. Cerrojo de publicación ──────────────────────────────────────────────
create table if not exists public.instagram_publicaciones_en_curso (
  pieza_id         uuid primary key references public.instagram_piezas (id) on delete cascade,
  bloqueo_id       uuid not null,
  bloqueada_hasta  timestamptz not null,
  created_at       timestamptz not null default now()
);
comment on table public.instagram_publicaciones_en_curso is
  'Cerrojo con caducidad de la publicación (o prueba) de una pieza. Solo lo usan instagram-publicar e instagram-programador (service_role) por RPC.';

alter table public.instagram_publicaciones_en_curso enable row level security;
revoke all on public.instagram_publicaciones_en_curso from public;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on public.instagram_publicaciones_en_curso from anon, authenticated';
    execute 'grant all on public.instagram_publicaciones_en_curso to service_role';
  end if;
end;
$$;
drop policy if exists instagram_publicaciones_en_curso_service_role on public.instagram_publicaciones_en_curso;
create policy instagram_publicaciones_en_curso_service_role on public.instagram_publicaciones_en_curso
  for all to service_role using (true) with check (true);

create or replace function public.instagram_pieza_reservar_publicacion(
  p_pieza_id uuid,
  p_segundos integer default 180,
  p_comprobar_programacion boolean default true
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v public.instagram_piezas;
  v_para timestamptz;
  v_bloqueo uuid := gen_random_uuid();
begin
  -- La fila de la pieza serializa dos reservas a la vez.
  select * into v from public.instagram_piezas where id = p_pieza_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'motivo', 'no_existe');
  end if;
  if v.media_id is not null or v.estado = 'publicada' then
    return jsonb_build_object('ok', false, 'motivo', 'publicada', 'permalink', v.permalink);
  end if;
  if exists (select 1 from public.instagram_publicaciones_en_curso
              where pieza_id = p_pieza_id and bloqueada_hasta > now()) then
    return jsonb_build_object('ok', false, 'motivo', 'en_curso');
  end if;
  if coalesce(p_comprobar_programacion, true) then
    select programada_para into v_para from public.instagram_programaciones
     where pieza_id = p_pieza_id and estado in ('programada', 'publicando')
     order by programada_para limit 1;
    if found then
      return jsonb_build_object('ok', false, 'motivo', 'programada', 'programadaPara', v_para);
    end if;
  end if;
  insert into public.instagram_publicaciones_en_curso (pieza_id, bloqueo_id, bloqueada_hasta)
  values (p_pieza_id, v_bloqueo, now() + make_interval(secs => greatest(30, least(coalesce(p_segundos, 180), 900))))
  on conflict (pieza_id) do update
     set bloqueo_id = excluded.bloqueo_id, bloqueada_hasta = excluded.bloqueada_hasta, created_at = now();
  return jsonb_build_object('ok', true, 'bloqueo', v_bloqueo);
end;
$$;

create or replace function public.instagram_pieza_liberar_publicacion(p_pieza_id uuid, p_bloqueo uuid)
returns boolean
language sql
volatile
security definer
set search_path = ''
as $$
  with b as (
    delete from public.instagram_publicaciones_en_curso
     where pieza_id = p_pieza_id and bloqueo_id = p_bloqueo
    returning 1)
  select exists (select 1 from b);
$$;

revoke all on function public.instagram_pieza_reservar_publicacion(uuid, integer, boolean) from public;
revoke all on function public.instagram_pieza_liberar_publicacion(uuid, uuid) from public;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on function public.instagram_pieza_reservar_publicacion(uuid, integer, boolean) from anon, authenticated';
    execute 'revoke all on function public.instagram_pieza_liberar_publicacion(uuid, uuid) from anon, authenticated';
    execute 'grant execute on function public.instagram_pieza_reservar_publicacion(uuid, integer, boolean) to service_role';
    execute 'grant execute on function public.instagram_pieza_liberar_publicacion(uuid, uuid) to service_role';
  end if;
end;
$$;

-- ─── 4. Comprobación final ──────────────────────────────────────────────────
do $$
declare
  v_malos text[] := '{}';
begin
  if not exists (select 1 from pg_trigger where tgrelid = 'public.instagram_piezas'::regclass
                  and tgname = 'instagram_piezas_proteger_publicacion' and not tgisinternal) then
    v_malos := v_malos || 'falta el trigger instagram_piezas_proteger_publicacion'::text;
  end if;
  if not (select relrowsecurity from pg_class where oid = 'public.instagram_publicaciones_en_curso'::regclass) then
    v_malos := v_malos || 'RLS apagada en instagram_publicaciones_en_curso'::text;
  end if;
  if exists (select 1 from pg_roles where rolname = 'anon') then
    if has_table_privilege('authenticated', 'public.instagram_publicaciones_en_curso', 'SELECT')
       or has_table_privilege('authenticated', 'public.instagram_publicaciones_en_curso', 'INSERT')
       or has_table_privilege('anon', 'public.instagram_publicaciones_en_curso', 'SELECT') then
      v_malos := v_malos || 'el panel tiene acceso a instagram_publicaciones_en_curso'::text;
    end if;
    if has_function_privilege('authenticated', 'public.instagram_pieza_reservar_publicacion(uuid, integer, boolean)', 'execute')
       or has_function_privilege('anon', 'public.instagram_pieza_reservar_publicacion(uuid, integer, boolean)', 'execute')
       or has_function_privilege('authenticated', 'public.instagram_pieza_liberar_publicacion(uuid, uuid)', 'execute') then
      v_malos := v_malos || 'RPC del cerrojo ejecutables fuera de service_role'::text;
    end if;
  end if;
  if cardinality(v_malos) > 0 then
    raise exception 'instagram_publicacion_servidor: comprobación final fallida (%). No se ha aplicado nada.', array_to_string(v_malos, '; ');
  end if;
  raise notice 'instagram_publicacion_servidor: aplicada';
end;
$$;

commit;

-- VERIFICACIÓN (solo lectura):
--   select tgname from pg_trigger where tgrelid = 'public.instagram_piezas'::regclass and not tgisinternal order by 1;
--   select column_name from information_schema.columns where table_name = 'instagram_piezas' and column_name = 'alt_text';
