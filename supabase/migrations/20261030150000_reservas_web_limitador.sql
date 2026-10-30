-- ===========================================================================
--  CT-REM-FN-07 · reservas-web/crear: limitador persistente y tope de correos
--  de rechazo.
--
--  Sin aplicar: la aplica el dueño (demo primero). Debe aplicarse ANTES de
--  desplegar reservas-web con el limitador: la función falla en cerrado
--  (503) si la RPC no existe.
--
--  Qué crea:
--   1. Dos columnas de configuración en public.configuracion_reservas
--      (fila única que ya usa reservas-web):
--        limite_web_crear_ip_hora (10) — solicitudes /crear por IP y hora.
--        limite_web_crear_dia     (300) — solicitudes /crear en todo el día
--                                         (día natural de Madrid).
--   2. public.reservas_web_intentos — una fila por solicitud ADMITIDA por el
--      limitador. Solo guarda el HMAC de la IP (lo calcula la función con
--      una sal secreta), nunca la IP en claro. Retención: 2 días (la limpia
--      la propia RPC).
--   3. public.reservas_web_reservar_cupo(p_ip_hash) — RPC atómica: un
--      advisory lock de transacción GLOBAL (el cupo diario es global, un lock
--      por IP no bastaría) serializa conteo + insert, así que una ráfaga
--      concurrente no puede superar el cupo. Una solicitud rechazada NO deja
--      fila (no hace crecer la tabla ni consume cupo).
--   4. public.reservas_web_correos_rechazo + reservas_web_reservar_correo_rechazo(p_email)
--      — como mucho 1 correo de rechazo por dirección cada 24 h. Guarda el
--      SHA-256 de la dirección normalizada, no la dirección. Atómico por
--      INSERT … ON CONFLICT DO UPDATE … WHERE.
--
--  Ambas RPC: SECURITY DEFINER, search_path vacío, EXECUTE solo service_role.
--  Patrón de chat_web_reservar_cupo (20260926121000_chat_web_proteccion.sql).
--  Idempotente.
-- ===========================================================================

begin;

-- 1. Umbrales configurables (fila única existente) ---------------------------
alter table public.configuracion_reservas
  add column if not exists limite_web_crear_ip_hora integer not null default 10,
  add column if not exists limite_web_crear_dia     integer not null default 300;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'configuracion_reservas_limite_web_crear_ip_hora_check') then
    alter table public.configuracion_reservas
      add constraint configuracion_reservas_limite_web_crear_ip_hora_check check (limite_web_crear_ip_hora > 0);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'configuracion_reservas_limite_web_crear_dia_check') then
    alter table public.configuracion_reservas
      add constraint configuracion_reservas_limite_web_crear_dia_check check (limite_web_crear_dia > 0);
  end if;
end $$;

comment on column public.configuracion_reservas.limite_web_crear_ip_hora is
  'Máximo de solicitudes POST /reservas-web/crear por IP (HMAC) en la última hora. CT-REM-FN-07.';
comment on column public.configuracion_reservas.limite_web_crear_dia is
  'Máximo de solicitudes POST /reservas-web/crear en el día natural de Madrid, todas las IP. CT-REM-FN-07.';

-- 2. Registro de solicitudes admitidas --------------------------------------
create table if not exists public.reservas_web_intentos (
  id         bigint generated always as identity primary key,
  ip_hash    text        not null check (ip_hash ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default now()
);

comment on table public.reservas_web_intentos is
  'Solicitudes de /reservas-web/crear admitidas por reservas_web_reservar_cupo. ip_hash = HMAC-SHA256 hex de la IP (nunca la IP). Retención 2 días.';

create index if not exists idx_reservas_web_intentos_ip_creado
  on public.reservas_web_intentos (ip_hash, created_at);
create index if not exists idx_reservas_web_intentos_creado
  on public.reservas_web_intentos (created_at);

alter table public.reservas_web_intentos enable row level security;
revoke all on public.reservas_web_intentos from public, anon, authenticated;

-- 3. Tope de correos de rechazo por dirección --------------------------------
create table if not exists public.reservas_web_correos_rechazo (
  email_hash   text        primary key check (email_hash ~ '^[0-9a-f]{64}$'),
  ultimo_envio timestamptz not null default now(),
  envios       integer     not null default 1
);

comment on table public.reservas_web_correos_rechazo is
  'Último correo «Estado de reserva» (rechazo) enviado por reservas-web a cada dirección. email_hash = SHA-256 hex de lower(trim(email)). Máx. 1 cada 24 h. CT-REM-FN-07.';

alter table public.reservas_web_correos_rechazo enable row level security;
revoke all on public.reservas_web_correos_rechazo from public, anon, authenticated;

-- 4. RPC del cupo -------------------------------------------------------------
--  Contrato (jsonb):
--    {permitido: true}
--    {permitido: false, motivo: 'max_ip_hora' | 'max_dia'}
create or replace function public.reservas_web_reservar_cupo(p_ip_hash text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_max_ip     integer;
  v_max_dia    integer;
  v_inicio_dia timestamptz;
  v_n          bigint;
begin
  if p_ip_hash is null or p_ip_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'p_ip_hash debe ser un HMAC-SHA256 en hex' using errcode = '22023';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('reservas_web_reservar_cupo', 0));

  -- Retención (barata: índice por created_at, como mucho 2 días de filas).
  delete from public.reservas_web_intentos where created_at < now() - interval '2 days';
  delete from public.reservas_web_correos_rechazo where ultimo_envio < now() - interval '2 days';

  select c.limite_web_crear_ip_hora, c.limite_web_crear_dia
    into v_max_ip, v_max_dia
  from public.configuracion_reservas c
  limit 1;
  -- Sin fila de configuración: los valores por defecto documentados.
  v_max_ip  := coalesce(v_max_ip, 10);
  v_max_dia := coalesce(v_max_dia, 300);

  v_inicio_dia := date_trunc('day', now() at time zone 'Europe/Madrid') at time zone 'Europe/Madrid';

  select count(*) into v_n from public.reservas_web_intentos where created_at >= v_inicio_dia;
  if v_n >= v_max_dia then
    return jsonb_build_object('permitido', false, 'motivo', 'max_dia');
  end if;

  select count(*) into v_n
  from public.reservas_web_intentos
  where ip_hash = p_ip_hash and created_at >= now() - interval '1 hour';
  if v_n >= v_max_ip then
    return jsonb_build_object('permitido', false, 'motivo', 'max_ip_hora');
  end if;

  insert into public.reservas_web_intentos (ip_hash) values (p_ip_hash);
  return jsonb_build_object('permitido', true);
end;
$$;

revoke all on function public.reservas_web_reservar_cupo(text) from public, anon, authenticated;
grant execute on function public.reservas_web_reservar_cupo(text) to service_role;

-- 5. RPC del correo de rechazo -------------------------------------------------
--  true  -> se puede enviar (y queda apuntado ahora)
--  false -> ya se envió uno a esa dirección en las últimas 24 h: no enviar
create or replace function public.reservas_web_reservar_correo_rechazo(p_email text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_hash text;
  v_ok   boolean;
begin
  if p_email is null or pg_catalog.btrim(p_email) = '' then
    return false;
  end if;
  v_hash := pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(pg_catalog.lower(pg_catalog.btrim(p_email)), 'UTF8')), 'hex');

  insert into public.reservas_web_correos_rechazo as t (email_hash, ultimo_envio, envios)
  values (v_hash, now(), 1)
  on conflict (email_hash) do update
    set ultimo_envio = excluded.ultimo_envio,
        envios       = t.envios + 1
    where t.ultimo_envio <= now() - interval '24 hours'
  returning true into v_ok;

  return coalesce(v_ok, false);
end;
$$;

revoke all on function public.reservas_web_reservar_correo_rechazo(text) from public, anon, authenticated;
grant execute on function public.reservas_web_reservar_correo_rechazo(text) to service_role;

commit;

-- COMPROBACIÓN POST-MIGRACIÓN (manual)
-- select limite_web_crear_ip_hora, limite_web_crear_dia from public.configuracion_reservas;
-- -- como service_role:
-- select public.reservas_web_reservar_cupo(repeat('a', 64));
-- delete from public.reservas_web_intentos where ip_hash = repeat('a', 64);
