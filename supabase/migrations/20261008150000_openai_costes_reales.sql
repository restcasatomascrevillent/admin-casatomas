set client_encoding = 'UTF8';
-- ===========================================================================
-- 20261008150000_openai_costes_reales
-- ===========================================================================
-- ##   NO APLICADA: la aplica el dueño a mano (ver PASOS)                  ##
-- ===========================================================================
-- ENCARGO (dueño, 08/10/2026): ver el gasto REAL de OpenAI (lo que factura),
-- no el estimado de `ia_uso`, separado por proceso:
--     ocr   = carga de datos (procesar-factura, ocr-trabajo, clasificar-productos)
--     chat  = chatbot de facturas (chat-facturas)
--     otros = el resto (chat-web, traducir-contenido, format-novedad…)
--
-- CÓMO: OpenAI factura por PROYECTO. Cada proceso usa la clave de su propio
-- proyecto (OPENAI_API_KEY_OCR / OPENAI_API_KEY_CHAT / OPENAI_API_KEY; ver
-- functions/_shared/clave-openai.ts) y la Edge Function
-- `sincronizar-costes-openai` (cron cada 6 h) trae de OpenAI los costes diarios
-- por proyecto y concepto con una Admin key de solo lectura.
--
-- QUÉ CREA
--   1. `openai_costes_diarios(fecha, project_id, line_item, usd, actualizado_en)`
--      PK (fecha, project_id, line_item). '' = sin proyecto / sin concepto.
--   2. `openai_proyectos(project_id, proceso, nombre)`: mapea proyecto → proceso
--      ('ocr' | 'chat' | 'otros'). La función da de alta los proyectos nuevos con
--      proceso NULL; el dueño los asigna (ver PASOS, paso 5). Un coste de un
--      proyecto sin proceso aparece como «sin_asignar», nunca se pierde ni se
--      reparte al azar.
--   3. `tipo_cambio_usd_eur(fecha, eur_por_usd, fuente, actualizado_en)`: la
--      misma función guarda el cambio del BCE (sin clave) en vez del 0,92 fijo.
--      RPC `tipo_cambio_usd_eur_actual()` devuelve el último (0,92 «por_defecto»
--      mientras no haya ninguno).
--   4. RLS: lectura SOLO super admin; escritura service_role.
--   5. Cron `sincronizar-costes-openai` (pg_cron, cada 6 h, minuto 7) → pg_net →
--      Edge Function, con el secreto de Vault «ocr_trabajos_secret» (el de
--      ocr-trabajo / clasificar-productos: no hay secreto nuevo en Vault).
--      Mudo si el secreto no existe.
--   6. RPC `gasto_ia_real_resumen(p_dias int)` SECURITY DEFINER, exige poder VER
--      Facturas. Por proceso: usd_real (OpenAI, hasta el último día CERRADO),
--      ultimo_dia_real (fecha UTC) y usd_estimado_hoy (`ia_uso` desde el día
--      siguiente, lo que OpenAI aún no ha publicado).
--
-- AUDITORÍA: `openai_costes_diarios` y `tipo_cambio_usd_eur` son datos derivados
-- que escribe un cron cada 6 h; se les QUITA el trigger de auditoría que
-- instala solo el event trigger (mismo criterio que ia_uso, excluida en
-- 20261007220000). `openai_proyectos` (mapeo que toca el dueño) SÍ se audita.
--
-- ORDEN: ver PASOS. La migración no rompe nada si se aplica antes de crear las
-- claves: el cron no hará nada útil hasta que exista OPENAI_ADMIN_KEY.
--
-- PASOS (desde adminpanelct/, POR TERMINAL; no en el SQL Editor)
--   1. npx supabase db query --linked -f supabase/migrations/20261008150000_openai_costes_reales.sql
--      Tiene que imprimir «openai_costes_reales: aplicada».
--   2. npx supabase db query --linked -f supabase/tests/openai_costes_reales_test.sql
--      (BEGIN … ROLLBACK). Tiene que acabar en «openai_costes_reales_test: OK».
--   Deshacer: supabase/rollbacks/20261008150000_openai_costes_reales_ROLLBACK.sql
--   Idempotente.
-- ===========================================================================

begin;
set local lock_timeout = '5s';

do $$
begin
  if to_regclass('public.ia_uso') is null
     or to_regprocedure('public.can_read_section(text)') is null
     or to_regprocedure('public.is_super_admin(uuid)') is null then
    raise exception 'openai_costes_reales: faltan ia_uso / can_read_section / is_super_admin. No se ha cambiado nada.';
  end if;
  if not exists (select 1 from pg_extension where extname = 'pg_cron') then
    raise exception 'openai_costes_reales: falta la extensión pg_cron. No se ha cambiado nada.';
  end if;
  if not exists (select 1 from pg_extension where extname = 'pg_net') then
    raise exception 'openai_costes_reales: falta la extensión pg_net. No se ha cambiado nada.';
  end if;
  if not exists (select 1 from pg_extension where extname = 'supabase_vault') then
    raise exception 'openai_costes_reales: falta la extensión supabase_vault. No se ha cambiado nada.';
  end if;
end;
$$;

-- ─── 1. Tablas ──────────────────────────────────────────────────────────────
create table if not exists public.openai_proyectos (
  project_id text primary key check (length(project_id) between 1 and 120),
  proceso    text check (proceso is null or proceso in ('ocr', 'chat', 'otros')),
  nombre     text check (nombre is null or length(nombre) <= 200),
  creado_en  timestamptz not null default now()
);
comment on table public.openai_proyectos is
  'Proyectos de OpenAI y el proceso al que pertenecen (ocr = carga de datos, chat = chatbot de facturas, '
  'otros = resto). La Edge Function sincronizar-costes-openai los da de alta con proceso NULL (y actualiza '
  'el nombre); el proceso lo asigna el dueño. Sin proceso, el coste sale como sin_asignar.';

create table if not exists public.openai_costes_diarios (
  fecha         date          not null,
  project_id    text          not null default '' check (length(project_id) <= 120),
  line_item     text          not null default '' check (length(line_item) <= 300),
  usd           numeric(16,6) not null,
  actualizado_en timestamptz  not null default now(),
  primary key (fecha, project_id, line_item)
);
comment on table public.openai_costes_diarios is
  'Gasto REAL facturado por OpenAI (GET /v1/organization/costs), por día UTC, proyecto y concepto. '
  '"" en project_id/line_item = sin proyecto/concepto. Lo escribe solo sincronizar-costes-openai (service_role). '
  'El día en curso es parcial; las RPC usan solo días cerrados.';

create table if not exists public.tipo_cambio_usd_eur (
  fecha          date          primary key,
  eur_por_usd    numeric(12,6) not null check (eur_por_usd > 0.2 and eur_por_usd < 5),
  fuente         text          not null default 'bce' check (length(fuente) <= 40),
  actualizado_en timestamptz   not null default now()
);
comment on table public.tipo_cambio_usd_eur is
  'Euros por 1 dólar (referencia del BCE, sin clave) que guarda sincronizar-costes-openai. '
  'Sustituye al 0,92 fijo del panel; ver tipo_cambio_usd_eur_actual().';

create index if not exists idx_openai_costes_diarios_proyecto
  on public.openai_costes_diarios (project_id, fecha desc);

-- ─── 2. Auditoría: solo el mapeo del dueño (los datos derivados no) ─────────
drop trigger if exists trg_auditoria on public.openai_costes_diarios;
drop trigger if exists trg_auditoria on public.tipo_cambio_usd_eur;

-- ─── 3. RLS ─────────────────────────────────────────────────────────────────
alter table public.openai_proyectos      enable row level security;
alter table public.openai_costes_diarios enable row level security;
alter table public.tipo_cambio_usd_eur   enable row level security;

revoke all on public.openai_proyectos      from anon, authenticated;
revoke all on public.openai_costes_diarios from anon, authenticated;
revoke all on public.tipo_cambio_usd_eur   from anon, authenticated;
grant select on public.openai_proyectos      to authenticated;
grant select on public.openai_costes_diarios to authenticated;
grant select on public.tipo_cambio_usd_eur   to authenticated;
grant all on public.openai_proyectos      to service_role;
grant all on public.openai_costes_diarios to service_role;
grant all on public.tipo_cambio_usd_eur   to service_role;
revoke truncate on public.openai_proyectos      from authenticated;
revoke truncate on public.openai_costes_diarios from authenticated;
revoke truncate on public.tipo_cambio_usd_eur   from authenticated;

drop policy if exists openai_proyectos_select_super_admin on public.openai_proyectos;
create policy openai_proyectos_select_super_admin
  on public.openai_proyectos for select to authenticated
  using ( (select public.is_super_admin((select auth.uid()))) );
drop policy if exists openai_proyectos_service_role on public.openai_proyectos;
create policy openai_proyectos_service_role
  on public.openai_proyectos for all to service_role using (true) with check (true);

drop policy if exists openai_costes_diarios_select_super_admin on public.openai_costes_diarios;
create policy openai_costes_diarios_select_super_admin
  on public.openai_costes_diarios for select to authenticated
  using ( (select public.is_super_admin((select auth.uid()))) );
drop policy if exists openai_costes_diarios_service_role on public.openai_costes_diarios;
create policy openai_costes_diarios_service_role
  on public.openai_costes_diarios for all to service_role using (true) with check (true);

drop policy if exists tipo_cambio_usd_eur_select_super_admin on public.tipo_cambio_usd_eur;
create policy tipo_cambio_usd_eur_select_super_admin
  on public.tipo_cambio_usd_eur for select to authenticated
  using ( (select public.is_super_admin((select auth.uid()))) );
drop policy if exists tipo_cambio_usd_eur_service_role on public.tipo_cambio_usd_eur;
create policy tipo_cambio_usd_eur_service_role
  on public.tipo_cambio_usd_eur for all to service_role using (true) with check (true);

-- ─── 4. Proceso de cada función de ia_uso ───────────────────────────────────
create or replace function public.ia_proceso_de_funcion(p_funcion text)
returns text
language sql
immutable
set search_path = public
as $$
  select case
    when p_funcion in ('procesar-factura', 'ocr-trabajo', 'clasificar-productos') then 'ocr'
    when p_funcion = 'chat-facturas' then 'chat'
    else 'otros'
  end;
$$;
comment on function public.ia_proceso_de_funcion(text) is
  'Proceso de gasto de una función de ia_uso: ocr (procesar-factura, ocr-trabajo, clasificar-productos), '
  'chat (chat-facturas) u otros. Debe coincidir con la clave que usa cada Edge Function (_shared/clave-openai.ts).';
revoke all on function public.ia_proceso_de_funcion(text) from public, anon;
grant execute on function public.ia_proceso_de_funcion(text) to authenticated, service_role;

-- ─── 5. Resumen del gasto real por proceso ──────────────────────────────────
create or replace function public.gasto_ia_real_resumen(p_dias integer default 30)
returns table (
  proceso          text,
  usd_real         numeric,
  ultimo_dia_real  date,
  usd_estimado_hoy numeric
)
language plpgsql
stable
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  v_dias  integer := least(greatest(coalesce(p_dias, 30), 1), 90);
  v_hoy   date    := (now() at time zone 'utc')::date;
  v_corte date;
  v_desde date;
  v_desde_est timestamptz;
begin
  if not (public.can_read_section('facturas') or coalesce(public.is_super_admin(auth.uid()), false)) then
    raise exception 'gasto_ia_real_resumen: sin permiso para ver Facturas' using errcode = '42501';
  end if;

  -- Último día CERRADO con datos de OpenAI (el de hoy es parcial y a veces aún
  -- no está publicado). Es único para todos los procesos: así lo real y lo
  -- estimado no se solapan ni dejan huecos.
  select max(c.fecha) into v_corte
    from public.openai_costes_diarios c
   where c.fecha < v_hoy;

  if v_corte is null then
    -- Sin datos reales todavía: todo es estimación sobre la ventana pedida.
    v_desde := null;
    v_desde_est := now() - make_interval(days => v_dias);
  else
    v_desde := v_corte - (v_dias - 1);
    v_desde_est := ((v_corte + 1)::timestamp at time zone 'utc');
  end if;

  return query
  with reales as (
    select coalesce(p.proceso, 'sin_asignar') as proceso,
           sum(c.usd) as usd
      from public.openai_costes_diarios c
      left join public.openai_proyectos p on p.project_id = c.project_id
     where v_corte is not null and c.fecha between v_desde and v_corte
     group by 1
  ),
  est as (
    select public.ia_proceso_de_funcion(u.funcion) as proceso,
           sum(u.coste_usd) as usd
      from public.ia_uso u
     where u.created_at >= v_desde_est
     group by 1
  ),
  procesos as (
    select unnest(array['ocr', 'chat', 'otros']) as proceso
    union select r.proceso from reales r where r.proceso = 'sin_asignar'
  )
  select pr.proceso,
         coalesce(r.usd, 0)::numeric,
         v_corte,
         coalesce(e.usd, 0)::numeric
    from procesos pr
    left join reales r on r.proceso = pr.proceso
    left join est  e on e.proceso = pr.proceso
   order by case pr.proceso when 'ocr' then 1 when 'chat' then 2 when 'otros' then 3 else 4 end;
end;
$$;

comment on function public.gasto_ia_real_resumen(integer) is
  'Gasto de OpenAI por proceso (ocr, chat, otros y sin_asignar si hay proyectos sin proceso): usd_real = lo facturado '
  '(openai_costes_diarios) en los últimos p_dias (1-90) hasta ultimo_dia_real, el último día UTC cerrado; '
  'usd_estimado_hoy = ia_uso (estimación) desde el día siguiente, lo que OpenAI aún no ha publicado. Sin datos reales '
  'ultimo_dia_real es NULL y todo el gasto va como estimado de la ventana. Exige poder ver Facturas.';

revoke all on function public.gasto_ia_real_resumen(integer) from public, anon;
grant execute on function public.gasto_ia_real_resumen(integer) to authenticated, service_role;

-- ─── 6. Tipo de cambio vigente ──────────────────────────────────────────────
create or replace function public.tipo_cambio_usd_eur_actual()
returns table (eur_por_usd numeric, fecha date, fuente text)
language plpgsql
stable
security definer
set search_path = public
as $$
#variable_conflict use_column
begin
  if not (public.can_read_section('facturas') or coalesce(public.is_super_admin(auth.uid()), false)) then
    raise exception 'tipo_cambio_usd_eur_actual: sin permiso para ver Facturas' using errcode = '42501';
  end if;

  return query
  select t.eur_por_usd::numeric, t.fecha, t.fuente
    from public.tipo_cambio_usd_eur t
   order by t.fecha desc
   limit 1;
  if not found then
    return query select 0.92::numeric, null::date, 'por_defecto'::text;
  end if;
end;
$$;
comment on function public.tipo_cambio_usd_eur_actual() is
  'Último tipo de cambio guardado (euros por dólar, BCE). Si todavía no hay ninguno devuelve 0,92 con fuente por_defecto.';
revoke all on function public.tipo_cambio_usd_eur_actual() from public, anon;
grant execute on function public.tipo_cambio_usd_eur_actual() to authenticated, service_role;

-- ─── 7. Cron: sincronizar cada 6 h ──────────────────────────────────────────
create or replace function public.openai_despachar_sincronizacion_costes()
returns integer
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  c_url     constant text := 'https://jeamoczmbfsnwkfjxcyo.supabase.co/functions/v1/sincronizar-costes-openai';
  v_secreto text;
begin
  select s.decrypted_secret into v_secreto
    from vault.decrypted_secrets s where s.name = 'ocr_trabajos_secret' limit 1;
  if v_secreto is null or v_secreto = '' then
    return 0;
  end if;
  perform net.http_post(
    url := c_url,
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-ocr-secret', v_secreto),
    body := jsonb_build_object('modo', 'cron'),
    timeout_milliseconds := 10000);
  return 1;
end;
$$;
comment on function public.openai_despachar_sincronizacion_costes() is
  'Lanza sincronizar-costes-openai por pg_net con el secreto de Vault ocr_trabajos_secret. La llama el cron cada 6 h; '
  'también se puede lanzar a mano: select public.openai_despachar_sincronizacion_costes();';
revoke all on function public.openai_despachar_sincronizacion_costes() from public, anon, authenticated;
grant execute on function public.openai_despachar_sincronizacion_costes() to service_role;

select cron.unschedule('sincronizar-costes-openai')
 where exists (select 1 from cron.job where jobname = 'sincronizar-costes-openai');
select cron.schedule('sincronizar-costes-openai', '7 */6 * * *',
                     $cron$ select public.openai_despachar_sincronizacion_costes(); $cron$);

commit;

select 'openai_costes_reales: aplicada' as resultado,
       exists (select 1 from cron.job where jobname = 'sincronizar-costes-openai') as cron_creado,
       exists (select 1 from vault.secrets where name = 'ocr_trabajos_secret') as secreto_vault_existe;
