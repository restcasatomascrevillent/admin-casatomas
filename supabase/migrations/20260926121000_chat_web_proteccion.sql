-- ===========================================================================
-- ##                          NO APLICADA                                  ##
-- ##   Escrita el 2026-09-26, sin ejecutar contra ningún proyecto.         ##
-- ##   Requiere (ya en el repo, deben estar aplicadas antes):              ##
-- ##     - 20260919150000_chat_web_memoria.sql (chat_web_mensajes)         ##
-- ##     - 20260924100000_super_admin_panel.sql (public.is_super_admin)    ##
-- ##     - 20260923120000_origen_prioridad_notificaciones.sql (prioridad)  ##
-- ===========================================================================
--
--  chat-web — protección de coste del chatbot público
--
--  NOTA DE NOMBRE: el encargo pedía 20260926120000_chat_web_proteccion.sql,
--  pero esa versión ya la ocupa 20260926120000_capacidad_efectiva_mesas.sql
--  (supabase db push trata el prefijo como clave única de versión), así que
--  esta va en 20260926121000.
--
--  Qué crea:
--   1. chat_web_config   — fila única con los topes (activo, turnos, chars,
--                          tokens de salida, límites por IP/sesión/día,
--                          presupuesto diario en USD, teléfono, URL reservas).
--   2. chat_web_uso      — una fila por petición: se RESERVA antes de llamar
--                          a OpenAI y se CIERRA con los tokens/coste reales.
--   3. chat_web_uso_diario (vista, security_invoker) — agregado por día Madrid.
--   4. chat_web_reservar_cupo(...) — RPC atómica (advisory lock) que decide
--                          si una petición puede gastar OpenAI.
--   5. chat_web_cerrar_uso(...)    — RPC que cierra la fila, avisa en la
--                          campana al cruzar alerta_pct y apaga el bot al 100%.
--   6. Limpieza de IPs en claro en chat_web_mensajes.ip (ahora solo hashes).
--   7. Job pg_cron de retención (90 días) para chat_web_uso.
--
--  Idempotente: create ... if not exists / create or replace / drop policy if
--  exists / cron.unschedule previo. Se puede re-ejecutar sin romper nada.
-- ===========================================================================

begin;

-- ---------------------------------------------------------------------------
-- 1. chat_web_config (singleton)
-- ---------------------------------------------------------------------------
create table if not exists public.chat_web_config (
  id                  boolean primary key default true check (id),
  activo              boolean       not null default true,
  max_turnos          int           not null default 12  check (max_turnos > 0),
  max_chars           int           not null default 500 check (max_chars between 1 and 4000),
  max_output_tokens   int           not null default 300 check (max_output_tokens between 16 and 4000),
  max_req_ip_hora     int           not null default 20  check (max_req_ip_hora > 0),
  max_req_sesion_hora int           not null default 30  check (max_req_sesion_hora > 0),
  max_req_dia         int           not null default 3000 check (max_req_dia > 0),
  presupuesto_dia_usd numeric(8,2)  not null default 3   check (presupuesto_dia_usd >= 0),
  alerta_pct          int           not null default 80  check (alerta_pct between 1 and 100),
  duracion_max_min    int           not null default 30  check (duracion_max_min > 0),
  telefono            text          not null default '+34 966 10 78 87',
  url_reservas        text          null,
  updated_at          timestamptz   not null default now()
);

comment on table public.chat_web_config is
  'Fila única (id=true) con los topes de coste/abuso del chatbot público chat-web. '
  'Editable solo por super admins. activo=false apaga el bot (lo pone también '
  'chat_web_cerrar_uso al agotar el presupuesto diario; hay que reactivarlo a mano).';

insert into public.chat_web_config (id) values (true)
on conflict (id) do nothing;

create or replace function public.chat_web_config_touch()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists trg_chat_web_config_touch on public.chat_web_config;
create trigger trg_chat_web_config_touch
  before update on public.chat_web_config
  for each row execute function public.chat_web_config_touch();

alter table public.chat_web_config enable row level security;

drop policy if exists "Super admins leen chat_web_config" on public.chat_web_config;
create policy "Super admins leen chat_web_config"
  on public.chat_web_config for select
  to authenticated
  using ((select public.is_super_admin((select auth.uid()))));

drop policy if exists "Super admins actualizan chat_web_config" on public.chat_web_config;
create policy "Super admins actualizan chat_web_config"
  on public.chat_web_config for update
  to authenticated
  using ((select public.is_super_admin((select auth.uid()))))
  with check ((select public.is_super_admin((select auth.uid()))));

revoke all on public.chat_web_config from anon;
revoke insert, delete, truncate on public.chat_web_config from authenticated;
grant select, update on public.chat_web_config to authenticated;

-- ---------------------------------------------------------------------------
-- 2. chat_web_uso (una fila por petición)
-- ---------------------------------------------------------------------------
create table if not exists public.chat_web_uso (
  id                uuid primary key default gen_random_uuid(),
  session_id        text          not null,
  conversacion_id   text          null,
  ip_hash           text          null,  -- HMAC-SHA256 hex de la IP; NUNCA la IP en claro
  estado            text          not null check (estado in ('reservado','ok','error','rechazado')),
  motivo            text          null,
  prompt_tokens     int           not null default 0,
  cached_tokens     int           not null default 0,
  completion_tokens int           not null default 0,
  llamadas_openai   int           not null default 0,
  modelo            text          null,
  coste_usd         numeric(10,6) not null default 0,
  created_at        timestamptz   not null default now()
);

comment on table public.chat_web_uso is
  'Contabilidad por petición de chat-web. reservado = cupo concedido y OpenAI '
  'en curso (si se queda así, la función murió a mitad); ok/error = cerrada '
  'por chat_web_cerrar_uso; rechazado = chat_web_reservar_cupo la denegó (motivo).';

create index if not exists idx_chat_web_uso_ip_creado
  on public.chat_web_uso (ip_hash, created_at);
create index if not exists idx_chat_web_uso_sesion_creado
  on public.chat_web_uso (session_id, created_at);
create index if not exists idx_chat_web_uso_creado
  on public.chat_web_uso (created_at);

alter table public.chat_web_uso enable row level security;

drop policy if exists "Super admins leen chat_web_uso" on public.chat_web_uso;
create policy "Super admins leen chat_web_uso"
  on public.chat_web_uso for select
  to authenticated
  using ((select public.is_super_admin((select auth.uid()))));

revoke all on public.chat_web_uso from anon;
revoke insert, update, delete, truncate on public.chat_web_uso from authenticated;
grant select on public.chat_web_uso to authenticated;

-- ---------------------------------------------------------------------------
-- 3. Vista diaria (día natural de Madrid). security_invoker: aplica la RLS de
--    chat_web_uso del que consulta (solo super admins ven filas).
-- ---------------------------------------------------------------------------
create or replace view public.chat_web_uso_diario
with (security_invoker = true) as
select
  (u.created_at at time zone 'Europe/Madrid')::date                        as dia,
  count(*) filter (where u.estado in ('ok','error'))::bigint               as peticiones,
  count(distinct u.session_id)::bigint                                     as conversaciones,
  count(*) filter (where u.estado = 'rechazado')::bigint                   as rechazadas,
  coalesce(sum(u.prompt_tokens), 0)::bigint                                as prompt_tokens,
  coalesce(sum(u.cached_tokens), 0)::bigint                                as cached_tokens,
  coalesce(sum(u.completion_tokens), 0)::bigint                            as completion_tokens,
  coalesce(sum(u.coste_usd), 0)::numeric                                   as coste_usd
from public.chat_web_uso u
group by 1;

revoke all on public.chat_web_uso_diario from anon;
grant select on public.chat_web_uso_diario to authenticated;

-- ---------------------------------------------------------------------------
-- 4. chat_web_reservar_cupo
-- ---------------------------------------------------------------------------
--  Contrato (jsonb):
--    permitido  -> {permitido:true,  uso_id, config:{max_chars,max_output_tokens,telefono,url_reservas}}
--    denegado   -> {permitido:false, motivo, config:{telefono,url_reservas}}
--  motivos: inactivo | max_req_dia | presupuesto | max_req_ip | max_req_sesion
--           | max_turnos | duracion_max
--
--  Serializado con un advisory lock de transacción GLOBAL (una sola clave):
--  los topes diario/presupuesto son globales, así que un lock por IP/sesión no
--  bastaría. El volumen de un chatbot de restaurante hace irrelevante la
--  contención; a cambio, una ráfaga concurrente no puede colarse entre el
--  conteo y el insert. Las filas 'reservado' cuentan en todos los topes.
create or replace function public.chat_web_reservar_cupo(
  p_session_id text,
  p_ip_hash    text,
  p_turno      int
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_cfg         public.chat_web_config%rowtype;
  v_inicio_dia  timestamptz;
  v_hace_1h     timestamptz := now() - interval '1 hour';
  v_motivo      text;
  v_n           bigint;
  v_coste       numeric;
  v_primera     timestamptz;
  v_uso_id      uuid;
begin
  if p_session_id is null or length(p_session_id) = 0 then
    raise exception 'p_session_id obligatorio';
  end if;

  perform pg_advisory_xact_lock(hashtext('chat_web_reservar_cupo'));

  select * into v_cfg from public.chat_web_config where id;
  if not found then
    -- Sin fila de config = sin topes conocidos -> fail closed.
    return jsonb_build_object(
      'permitido', false, 'motivo', 'inactivo',
      'config', jsonb_build_object('telefono', '+34 966 10 78 87', 'url_reservas', null));
  end if;

  -- Medianoche de hoy en Madrid, como timestamptz (sargable sobre created_at).
  v_inicio_dia := date_trunc('day', now() at time zone 'Europe/Madrid') at time zone 'Europe/Madrid';

  if not v_cfg.activo then
    v_motivo := 'inactivo';
  end if;

  if v_motivo is null then
    select count(*) into v_n
    from public.chat_web_uso
    where created_at >= v_inicio_dia and estado <> 'rechazado';
    if v_n >= v_cfg.max_req_dia then v_motivo := 'max_req_dia'; end if;
  end if;

  if v_motivo is null then
    select coalesce(sum(coste_usd), 0) into v_coste
    from public.chat_web_uso
    where created_at >= v_inicio_dia;
    if v_coste >= v_cfg.presupuesto_dia_usd then v_motivo := 'presupuesto'; end if;
  end if;

  if v_motivo is null and p_ip_hash is not null then
    select count(*) into v_n
    from public.chat_web_uso
    where ip_hash = p_ip_hash and created_at >= v_hace_1h and estado <> 'rechazado';
    if v_n >= v_cfg.max_req_ip_hora then v_motivo := 'max_req_ip'; end if;
  end if;

  if v_motivo is null then
    select count(*) into v_n
    from public.chat_web_uso
    where session_id = p_session_id and created_at >= v_hace_1h and estado <> 'rechazado';
    if v_n >= v_cfg.max_req_sesion_hora then v_motivo := 'max_req_sesion'; end if;
  end if;

  if v_motivo is null and coalesce(p_turno, 1) > v_cfg.max_turnos then
    v_motivo := 'max_turnos';
  end if;

  if v_motivo is null then
    -- Duración de la conversación: desde la primera petición no rechazada de
    -- esta sesión (acotado a las últimas 24h para usar el índice sin barrer
    -- historia antigua; una sesión de ayer cuenta como conversación nueva).
    select min(created_at) into v_primera
    from public.chat_web_uso
    where session_id = p_session_id
      and created_at >= now() - interval '24 hours'
      and estado <> 'rechazado';
    if v_primera is not null
       and v_primera < now() - make_interval(mins => v_cfg.duracion_max_min) then
      v_motivo := 'duracion_max';
    end if;
  end if;

  if v_motivo is not null then
    insert into public.chat_web_uso (session_id, ip_hash, estado, motivo)
    values (p_session_id, p_ip_hash, 'rechazado', v_motivo);
    return jsonb_build_object(
      'permitido', false,
      'motivo', v_motivo,
      'config', jsonb_build_object('telefono', v_cfg.telefono, 'url_reservas', v_cfg.url_reservas));
  end if;

  insert into public.chat_web_uso (session_id, ip_hash, estado)
  values (p_session_id, p_ip_hash, 'reservado')
  returning id into v_uso_id;

  return jsonb_build_object(
    'permitido', true,
    'uso_id', v_uso_id,
    'config', jsonb_build_object(
      'max_chars', v_cfg.max_chars,
      'max_output_tokens', v_cfg.max_output_tokens,
      'telefono', v_cfg.telefono,
      'url_reservas', v_cfg.url_reservas));
end;
$$;

revoke all on function public.chat_web_reservar_cupo(text, text, int) from public, anon, authenticated;
grant execute on function public.chat_web_reservar_cupo(text, text, int) to service_role;

-- ---------------------------------------------------------------------------
-- 5. chat_web_cerrar_uso
-- ---------------------------------------------------------------------------
--  Cierra una fila 'reservado' (idempotente: una fila ya cerrada no se vuelve
--  a tocar). Tras cerrar, mira el coste del día:
--   - >= alerta_pct% del presupuesto -> 1 aviso/día en notificaciones_dashboard
--   - >= 100%                        -> activo=false + 1 aviso/día (bloqueo)
--  Avisos: tipo='sistema' (valor ya contemplado por la campana, icono Info;
--  `tipo` no tiene CHECK), origen NULL (su CHECK solo admite reservas_web/
--  emails_reserva/resend_webhook y NULL), prioridad 'alta', y
--  referencia_tipo = 'chat_web_alerta' | 'chat_web_bloqueo' como clave de
--  deduplicación diaria. Mismo advisory lock que reservar_cupo para que dos
--  cierres simultáneos no dupliquen el aviso.
create or replace function public.chat_web_cerrar_uso(
  p_uso_id     uuid,
  p_estado     text,
  p_prompt     int,
  p_cached     int,
  p_completion int,
  p_llamadas   int,
  p_modelo     text,
  p_coste      numeric
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_cfg        public.chat_web_config%rowtype;
  v_inicio_dia timestamptz;
  v_coste_dia  numeric;
  v_umbral     numeric;
begin
  if p_estado not in ('ok', 'error') then
    raise exception 'p_estado inválido: % (solo ok|error)', p_estado;
  end if;

  perform pg_advisory_xact_lock(hashtext('chat_web_reservar_cupo'));

  update public.chat_web_uso
     set estado            = p_estado,
         prompt_tokens     = greatest(coalesce(p_prompt, 0), 0),
         cached_tokens     = greatest(coalesce(p_cached, 0), 0),
         completion_tokens = greatest(coalesce(p_completion, 0), 0),
         llamadas_openai   = greatest(coalesce(p_llamadas, 0), 0),
         modelo            = p_modelo,
         coste_usd         = greatest(coalesce(p_coste, 0), 0)
   where id = p_uso_id
     and estado = 'reservado';

  if not found then
    return; -- id desconocido o ya cerrada: nada que hacer
  end if;

  select * into v_cfg from public.chat_web_config where id;
  if not found or v_cfg.presupuesto_dia_usd <= 0 then
    return;
  end if;

  v_inicio_dia := date_trunc('day', now() at time zone 'Europe/Madrid') at time zone 'Europe/Madrid';

  select coalesce(sum(coste_usd), 0) into v_coste_dia
  from public.chat_web_uso
  where created_at >= v_inicio_dia;

  v_umbral := v_cfg.presupuesto_dia_usd * v_cfg.alerta_pct / 100.0;

  if v_coste_dia >= v_cfg.presupuesto_dia_usd then
    if v_cfg.activo then
      update public.chat_web_config set activo = false where id;
    end if;
    if not exists (
      select 1 from public.notificaciones_dashboard
      where referencia_tipo = 'chat_web_bloqueo' and created_at >= v_inicio_dia
    ) then
      insert into public.notificaciones_dashboard (tipo, titulo, mensaje, referencia_tipo, prioridad)
      values (
        'sistema',
        'Chatbot web desactivado: presupuesto diario agotado',
        format('El chatbot de la web ha gastado %s USD hoy (presupuesto %s USD) y se ha desactivado. '
               'Para reactivarlo, pon activo = true en chat_web_config cuando lo revises.',
               round(v_coste_dia, 4), v_cfg.presupuesto_dia_usd),
        'chat_web_bloqueo',
        'alta');
    end if;
  elsif v_coste_dia >= v_umbral then
    if not exists (
      select 1 from public.notificaciones_dashboard
      where referencia_tipo = 'chat_web_alerta' and created_at >= v_inicio_dia
    ) then
      insert into public.notificaciones_dashboard (tipo, titulo, mensaje, referencia_tipo, prioridad)
      values (
        'sistema',
        format('Chatbot web: %s%% del presupuesto diario', v_cfg.alerta_pct),
        format('Gasto de hoy: %s USD de %s USD. Al llegar al 100%% el chatbot se desactivará solo.',
               round(v_coste_dia, 4), v_cfg.presupuesto_dia_usd),
        'chat_web_alerta',
        'alta');
    end if;
  end if;
end;
$$;

revoke all on function public.chat_web_cerrar_uso(uuid, text, int, int, int, int, text, numeric) from public, anon, authenticated;
grant execute on function public.chat_web_cerrar_uso(uuid, text, int, int, int, int, text, numeric) to service_role;

-- La función de trigger no necesita ser invocable por nadie.
revoke all on function public.chat_web_config_touch() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 6. RGPD: chat_web_mensajes.ip pasa a guardar SOLO el HMAC hex (64 chars)
--    que calcula chat-web. Cualquier valor previo que no tenga esa forma es
--    una IP en claro de la versión anterior: se borra.
-- ---------------------------------------------------------------------------
update public.chat_web_mensajes
   set ip = null
 where ip is not null
   and ip !~ '^[0-9a-f]{64}$';

comment on column public.chat_web_mensajes.ip is
  'HMAC-SHA256 hex de la IP del visitante (nunca la IP en claro). Solo para rate limiting.';

commit;

-- ---------------------------------------------------------------------------
-- 7. Retención: borrar chat_web_uso de más de 90 días (diario 03:15 UTC).
--    pg_cron ya se usa en el proyecto (20260228151635, 20260923200000...).
--    Fuera de la transacción, mismo patrón unschedule+schedule idempotente.
-- ---------------------------------------------------------------------------
create extension if not exists pg_cron;

select cron.unschedule('chat-web-uso-retencion') where exists (
  select 1 from cron.job where jobname = 'chat-web-uso-retencion'
);

select cron.schedule(
  'chat-web-uso-retencion',
  '15 3 * * *',
  $$ delete from public.chat_web_uso where created_at < now() - interval '90 days'; $$
);

-- ---------------------------------------------------------------------------
-- COMPROBACIÓN POST-MIGRACIÓN (manual, no la ejecuta esta migración)
-- ---------------------------------------------------------------------------
-- select * from public.chat_web_config;
-- -- como service_role:
-- select public.chat_web_reservar_cupo('test_es', null, 1);
-- select public.chat_web_cerrar_uso('<uso_id>', 'ok', 1000, 0, 100, 1, 'gpt-5.6-luna', 0.00032);
-- select * from public.chat_web_uso_diario order by dia desc limit 7;
-- delete from public.chat_web_uso where session_id = 'test_es';
