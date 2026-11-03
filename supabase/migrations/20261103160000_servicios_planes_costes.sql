set client_encoding = 'UTF8';
-- ===========================================================================
-- 20261103160000_servicios_planes_costes — Super Admin › Servicios: planes,
-- coste y uso de TODOS los servicios (03/11/2026)
-- ===========================================================================
-- Petición del dueño: «Planes + coste + uso (Vercel, Supabase, Hostinger…). En
-- la pantalla de servicios que has creado añade eso». La pantalla pasa a ser el
-- sitio único donde ver, de cada servicio de pago o con límites, qué plan
-- tiene, cuánto cuesta (fijo y variable) y cuánto se está usando.
--
-- QUÉ CAMBIA
--   1. `servicios_contratados` (columnas nuevas, las edita el super admin):
--        categoria      ('alojamiento', 'base_datos', 'codigo', 'correo',
--                        'pagos', 'ia', 'telefonia', 'mapas', 'archivos',
--                        'dominio', 'otros')
--        orden          posición en la pantalla (0–10000)
--        activo         «lo usamos»: si es false no se lee ni suma al coste
--        por_confirmar  plan y precio sin comprobar (se dice en la tarjeta)
--        precio_anual   lo que se paga al año cuando ciclo = 'anual'
--        fuente_precio  página oficial del precio (solo https)
--      Las 5 filas de 20261103120000 reciben su categoría, orden y fuente la
--      PRIMERA vez (marcador: categoria vacía), sin tocar lo que el dueño haya
--      editado.
--   2. `servicios_uso.coste_variable` jsonb: { importe, moneda, periodo,
--      origen ('api' | 'bd' | 'estimado'), nota } — lo gastado este mes por
--      uso (IA, llamadas, comisiones de Stripe…). Lo escribe servicios-uso.
--   3. `servicios_config` (una sola fila): `eur_por_usd`, el tipo de cambio
--      con el que la pantalla pasa a euros los precios en dólares. Lo edita el
--      super admin; nace con el último cambio del BCE de `tipo_cambio_usd_eur`
--      (o 0,92 si no hay). SE AUDITA.
--   4. `servicios_metricas_supabase()` (solo service_role) añade, si existen
--      sus tablas: tipo de cambio (panel y BCE), gasto de IA del mes (real de
--      `openai_costes_diarios` hasta el último día cerrado + estimado de
--      `ia_uso` para lo que OpenAI aún no ha publicado) y el tope de
--      `configuracion_facturas.tope_ia_mes_eur`, cheques regalo cobrados por
--      Stripe este mes con su comisión (la real o la estimada 1,5 % + 0,25 €,
--      como metricas_cheques_regalo) y llamadas del asistente telefónico
--      (`call_logs`: número, segundos y coste).
--   5. Semilla de los proveedores que el código usa de verdad (on conflict do
--      nothing): OpenAI, Vapi, Google Maps Platform (reseñas), Google Drive
--      (copias de facturas), Mapbox (mapa de vinos), Perplexity (sin uso hoy),
--      Hostinger (lo pidió el dueño; por confirmar) y Loading (DNS, correo y
--      web antigua del dominio, comprobado por DNS). Límites de la
--      documentación oficial del 03/11/2026 (URL en `fuente`).
--
-- AUDITORÍA: `servicios_config` recibe `trg_auditoria` (event trigger o, si no
-- existe, esta migración, como 20261103120000). `servicios_uso` sigue fuera.
--
-- APLICAR (una a una, nunca `db push`): DESPUÉS de 20261103120000. Demo primero
-- (sfonaclosuafvlhutkon), producción (haqmmdfdzzatdnrrcgez) solo tras aceptar
-- el PR y con el «sí» del dueño. Idempotente. Termina en
-- «servicios_planes_costes: aplicada».
-- Deshacer: supabase/rollbacks/20261103160000_servicios_planes_costes_ROLLBACK.sql
-- Pruebas: npm run test:servicios:db (PGlite).
-- ===========================================================================

begin;
set local lock_timeout = '5s';

do $$
begin
  if to_regclass('public.servicios_contratados') is null or to_regclass('public.servicios_uso') is null
     or to_regprocedure('public.is_super_admin(uuid)') is null then
    raise exception 'servicios_planes_costes: falta 20261103120000_servicios_contratados. No se ha cambiado nada.';
  end if;
end;
$$;

-- ─── 1. servicios_contratados: categoría, orden, en uso, por confirmar… ─────
alter table public.servicios_contratados
  add column if not exists categoria     text,
  add column if not exists orden         integer,
  add column if not exists activo        boolean not null default true,
  add column if not exists por_confirmar boolean not null default false,
  add column if not exists precio_anual  numeric(10, 2),
  add column if not exists fuente_precio text;

-- Primera vez (categoria vacía): categoría, orden y fuente de las 5 filas de
-- 20261103120000. Vercel: el equipo tiene también el proyecto touza-casatomas
-- (comprobado en Vercel el 03/11/2026); solo se cambia si el texto es el de la
-- semilla. Resend: el plan sigue sin confirmar.
update public.servicios_contratados s
   set categoria     = v.categoria,
       orden         = v.orden,
       fuente_precio = coalesce(s.fuente_precio, v.fuente),
       por_confirmar = v.por_confirmar,
       cuenta        = case
         when s.proveedor = 'vercel'
          and s.cuenta = 'Equipo «Casa tomas» (casa-tomas, team_18KKVg7ueSX0PL4Ycy1QakZj) · proyectos web-casatomas y admin-casatomas'
         then 'Equipo «Casa tomas» (casa-tomas, team_18KKVg7ueSX0PL4Ycy1QakZj) · proyectos web-casatomas, admin-casatomas y touza-casatomas'
         else s.cuenta end
  from (values
    ('vercel',   'alojamiento', 10, 'https://vercel.com/pricing',     false),
    ('supabase', 'base_datos',  20, 'https://supabase.com/pricing',   false),
    ('github',   'codigo',      30, 'https://github.com/pricing',     false),
    ('resend',   'correo',      40, 'https://resend.com/pricing',     true),
    ('stripe',   'pagos',       50, 'https://stripe.com/es/pricing',  false)
  ) as v(proveedor, categoria, orden, fuente, por_confirmar)
 where s.proveedor = v.proveedor
   and s.categoria is null;

update public.servicios_contratados set categoria = 'otros' where categoria is null;
update public.servicios_contratados set orden = 100 where orden is null;
alter table public.servicios_contratados alter column categoria set default 'otros';
alter table public.servicios_contratados alter column categoria set not null;
alter table public.servicios_contratados alter column orden set default 100;
alter table public.servicios_contratados alter column orden set not null;

alter table public.servicios_contratados drop constraint if exists servicios_contratados_categoria_chk;
alter table public.servicios_contratados add constraint servicios_contratados_categoria_chk
  check (categoria in ('alojamiento', 'base_datos', 'codigo', 'correo', 'pagos', 'ia', 'telefonia', 'mapas', 'archivos', 'dominio', 'otros'));
alter table public.servicios_contratados drop constraint if exists servicios_contratados_orden_chk;
alter table public.servicios_contratados add constraint servicios_contratados_orden_chk
  check (orden between 0 and 10000);
alter table public.servicios_contratados drop constraint if exists servicios_contratados_precio_anual_chk;
alter table public.servicios_contratados add constraint servicios_contratados_precio_anual_chk
  check (precio_anual is null or (precio_anual >= 0 and precio_anual <= 1000000));
alter table public.servicios_contratados drop constraint if exists servicios_contratados_fuente_precio_chk;
alter table public.servicios_contratados add constraint servicios_contratados_fuente_precio_chk
  check (fuente_precio is null or (fuente_precio ~ '^https://[^\s]+$' and length(fuente_precio) <= 500));

comment on column public.servicios_contratados.categoria is 'Grupo del servicio en la pantalla (alojamiento, base_datos, codigo, correo, pagos, ia, telefonia, mapas, archivos, dominio, otros).';
comment on column public.servicios_contratados.activo is '«Lo usamos». false = no se lee su consumo ni suma al coste (sale aparte, plegado).';
comment on column public.servicios_contratados.por_confirmar is 'Plan y precio sin comprobar: la pantalla lo dice en la tarjeta y en el resumen de coste.';
comment on column public.servicios_contratados.precio_anual is 'Lo que se paga al año cuando ciclo = anual (coste al mes = precio_anual / 12). Con otros ciclos, null.';
comment on column public.servicios_contratados.fuente_precio is 'Página oficial del precio del plan (solo https).';

grant update (nombre, plan, precio_mensual, moneda, ciclo, renovacion, cuenta, panel_url, limites, notas,
              categoria, orden, activo, por_confirmar, precio_anual, fuente_precio)
  on public.servicios_contratados to authenticated;

-- ─── 2. servicios_uso: coste variable de la lectura ─────────────────────────
alter table public.servicios_uso add column if not exists coste_variable jsonb;
alter table public.servicios_uso drop constraint if exists servicios_uso_coste_chk;
alter table public.servicios_uso add constraint servicios_uso_coste_chk
  check (coste_variable is null or (jsonb_typeof(coste_variable) = 'object' and length(coste_variable::text) <= 2000));
comment on column public.servicios_uso.coste_variable is
  'Lo gastado por uso en el periodo de la lectura: { importe, moneda, periodo, origen (api | bd | estimado), nota }. null = sin coste variable medible.';

-- La fila cambia de forma: se vuelve a crear igual (SECURITY INVOKER).
create or replace function public.servicios_uso_ultimas()
returns setof public.servicios_uso
language sql
stable
security invoker
set search_path = ''
as $$
  select distinct on (u.proveedor) u.*
    from public.servicios_uso u
   order by u.proveedor, u.tomado_en desc;
$$;
revoke all on function public.servicios_uso_ultimas() from public, anon;
grant execute on function public.servicios_uso_ultimas() to authenticated, service_role;

-- ─── 3. servicios_config: tipo de cambio (una sola fila) ────────────────────
create table if not exists public.servicios_config (
  id              boolean primary key default true,
  eur_por_usd     numeric(12, 6) not null default 0.92,
  actualizado_en  timestamptz not null default now(),
  actualizado_por uuid default auth.uid() references auth.users(id) on delete set null,
  constraint servicios_config_unica check (id),
  constraint servicios_config_cambio_chk check (eur_por_usd > 0.2 and eur_por_usd < 5)
);
comment on table public.servicios_config is
  'Configuración de Super Admin › Servicios (una sola fila): eur_por_usd = euros por 1 dólar con los que se pasan a EUR '
  'los precios en USD. La edita el super admin; nace con el último cambio del BCE (tipo_cambio_usd_eur) o 0,92.';

do $$
begin
  if to_regprocedure('public.fn_registrar_auditoria()') is not null
     and not exists (select 1 from pg_trigger
                      where tgrelid = 'public.servicios_config'::regclass
                        and tgfoid = 'public.fn_registrar_auditoria()'::regprocedure
                        and not tgisinternal) then
    execute 'drop trigger if exists trg_auditoria on public.servicios_config';
    execute 'create trigger trg_auditoria after insert or update or delete on public.servicios_config
             for each row execute function public.fn_registrar_auditoria()';
  end if;
end;
$$;

create or replace function public.servicios_config_al_editar()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.actualizado_en := now();
  new.actualizado_por := coalesce(auth.uid(), old.actualizado_por);
  return new;
end;
$$;
revoke all on function public.servicios_config_al_editar() from public, anon, authenticated;
drop trigger if exists servicios_config_al_editar on public.servicios_config;
create trigger servicios_config_al_editar
  before update on public.servicios_config
  for each row execute function public.servicios_config_al_editar();

alter table public.servicios_config enable row level security;
revoke all on public.servicios_config from anon, authenticated;
grant select on public.servicios_config to authenticated;
grant update (eur_por_usd) on public.servicios_config to authenticated;
grant all on public.servicios_config to service_role;

drop policy if exists servicios_config_select_super_admin on public.servicios_config;
create policy servicios_config_select_super_admin
  on public.servicios_config for select to authenticated
  using ( (select public.is_super_admin((select auth.uid()))) );
drop policy if exists servicios_config_update_super_admin on public.servicios_config;
create policy servicios_config_update_super_admin
  on public.servicios_config for update to authenticated
  using ( (select public.is_super_admin((select auth.uid()))) )
  with check ( (select public.is_super_admin((select auth.uid()))) );
drop policy if exists servicios_config_service_role on public.servicios_config;
create policy servicios_config_service_role
  on public.servicios_config for all to service_role using (true) with check (true);

do $$
begin
  if to_regprocedure('private.sesion_panel_permitida()') is not null then
    execute 'drop policy if exists "acceso_panel_no_bloqueado" on public.servicios_config';
    execute 'create policy "acceso_panel_no_bloqueado" on public.servicios_config as restrictive for all to authenticated
      using ((select private.sesion_panel_permitida())) with check ((select private.sesion_panel_permitida()))';
  end if;
end;
$$;

-- La fila: con el último cambio del BCE si lo hay (no pisa una ya guardada).
do $$
declare
  v_cambio numeric;
begin
  if to_regclass('public.tipo_cambio_usd_eur') is not null then
    execute 'select eur_por_usd from public.tipo_cambio_usd_eur order by fecha desc limit 1' into v_cambio;
  end if;
  insert into public.servicios_config (id, eur_por_usd, actualizado_por)
  values (true, coalesce(v_cambio, 0.92), null)
  on conflict (id) do nothing;
end;
$$;

-- ─── 4. Métricas sin token (solo service_role): + cambio, IA, Stripe, llamadas
create or replace function public.servicios_metricas_supabase()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_mes timestamptz := date_trunc('month', now(), 'UTC');
  v_dia timestamptz := date_trunc('day', now(), 'UTC');
  v_mes_fecha date := (date_trunc('month', now(), 'UTC') at time zone 'UTC')::date;
  v_hoy date := (now() at time zone 'UTC')::date;
  v jsonb := jsonb_build_object(
    'bd_bytes', pg_database_size(current_database()),
    'mes_desde', v_mes,
    'dia_desde', v_dia
  );
  v_a bigint;
  v_b bigint;
  v_n1 numeric;
  v_n2 numeric;
  v_f date;
  v_ultimo_real date;
begin
  -- (Igual que en 20261103120000.) Storage, usuarios y correos.
  if to_regclass('storage.objects') is not null then
    execute $q$select coalesce(sum(case when (metadata ->> 'size') ~ '^[0-9]+$' then (metadata ->> 'size')::bigint else 0 end), 0)::bigint,
                      count(*)::bigint
                 from storage.objects$q$ into v_a, v_b;
    v := v || jsonb_build_object('storage_bytes', v_a, 'storage_objetos', v_b);
  end if;

  if to_regclass('auth.users') is not null then
    if to_regclass('auth.sessions') is not null then
      execute $q$select count(*)::bigint from auth.users u
                  where u.last_sign_in_at >= $1
                     or exists (select 1 from auth.sessions s where s.user_id = u.id and s.updated_at >= $1)$q$
        into v_a using v_mes;
    else
      execute $q$select count(*)::bigint from auth.users u where u.last_sign_in_at >= $1$q$ into v_a using v_mes;
    end if;
    execute $q$select count(*)::bigint from auth.users$q$ into v_b;
    v := v || jsonb_build_object('usuarios_activos_mes', v_a, 'usuarios_total', v_b);
  end if;

  if to_regclass('public.envios_email_reserva') is not null then
    execute $q$select count(*) filter (where coalesce(enviado_at, creado_at) >= $1)::bigint,
                      count(*) filter (where coalesce(enviado_at, creado_at) >= $2)::bigint
                 from public.envios_email_reserva
                where resultado = 'enviado'$q$
      into v_a, v_b using v_mes, v_dia;
    v := v || jsonb_build_object('correos_reservas_mes', v_a, 'correos_reservas_hoy', v_b);
  end if;

  if to_regclass('public.newsletter_envios') is not null then
    execute $q$select coalesce(sum(total_destinatarios) filter (where created_at >= $1), 0)::bigint,
                      coalesce(sum(total_destinatarios) filter (where created_at >= $2), 0)::bigint
                 from public.newsletter_envios
                where canal = 'transaccional' and estado in ('completado', 'parcial')$q$
      into v_a, v_b using v_mes, v_dia;
    v := v || jsonb_build_object('correos_newsletter_mes', v_a, 'correos_newsletter_hoy', v_b);
  end if;

  if to_regclass('public.newsletter_suscriptores') is not null then
    execute $q$select count(*)::bigint from public.newsletter_suscriptores where activo$q$ into v_a;
    v := v || jsonb_build_object('contactos_newsletter', v_a);
  end if;

  -- (Nuevo) Tipo de cambio: el de la pantalla y el último del BCE.
  if to_regclass('public.servicios_config') is not null then
    execute $q$select eur_por_usd from public.servicios_config limit 1$q$ into v_n1;
    if v_n1 is not null then
      v := v || jsonb_build_object('eur_por_usd', v_n1);
    end if;
  end if;
  if to_regclass('public.tipo_cambio_usd_eur') is not null then
    execute $q$select eur_por_usd, fecha from public.tipo_cambio_usd_eur order by fecha desc limit 1$q$ into v_n1, v_f;
    if v_n1 is not null then
      v := v || jsonb_build_object('eur_por_usd_bce', v_n1, 'eur_por_usd_bce_fecha', v_f);
    end if;
  end if;

  -- (Nuevo) IA: lo que OpenAI ya ha facturado este mes (días cerrados, UTC) y,
  -- de `ia_uso`, la estimación de lo que aún no ha publicado (desde el día
  -- siguiente al último real), como gasto_ia_real_resumen.
  if to_regclass('public.openai_costes_diarios') is not null then
    execute $q$select coalesce(sum(usd) filter (where fecha >= $1 and fecha < $2), 0),
                      max(fecha) filter (where fecha < $2)
                 from public.openai_costes_diarios$q$
      into v_n1, v_ultimo_real using v_mes_fecha, v_hoy;
    v := v || jsonb_build_object('openai_usd_mes_real', v_n1, 'openai_ultimo_dia_real', v_ultimo_real);
  end if;
  if to_regclass('public.ia_uso') is not null then
    execute $q$select coalesce(sum(coste_usd), 0),
                      coalesce(sum(coste_usd) filter (where created_at >= $2), 0)
                 from public.ia_uso
                where created_at >= $1$q$
      into v_n1, v_n2
      using v_mes, greatest(v_mes, coalesce(((v_ultimo_real + 1)::timestamp at time zone 'UTC'), v_mes));
    v := v || jsonb_build_object('ia_usd_mes_estimado', v_n1, 'ia_usd_estimado_sin_real', v_n2);
  end if;
  if exists (select 1 from pg_attribute
              where attrelid = to_regclass('public.configuracion_facturas')
                and attname = 'tope_ia_mes_eur' and not attisdropped) then
    execute $q$select tope_ia_mes_eur from public.configuracion_facturas limit 1$q$ into v_n1;
    if v_n1 is not null then
      v := v || jsonb_build_object('tope_ia_mes_eur', v_n1);
    end if;
  end if;

  -- (Nuevo) Cheques regalo cobrados por Stripe este mes y su comisión: la real
  -- (stripe_fee_eur) o, si no se guardó, la estimada (1,5 % + 0,25 €), con el
  -- mismo criterio que metricas_cheques_regalo.
  if exists (select 1 from pg_attribute
              where attrelid = to_regclass('public.cheques_regalo')
                and attname = 'stripe_fee_eur' and not attisdropped) then
    execute $q$select count(*)::bigint,
                      coalesce(sum(importe_eur), 0),
                      coalesce(sum(coalesce(stripe_fee_eur, round(importe_eur * 0.015 + 0.25, 2))), 0),
                      count(*) filter (where stripe_fee_eur is null)::bigint
                 from public.cheques_regalo
                where estado = 'pagado' and origen is distinct from 'manual'
                  and stripe_payment_intent_id is not null and created_at >= $1$q$
      into v_a, v_n1, v_n2, v_b using v_mes;
    v := v || jsonb_build_object('cheques_stripe_mes', v_a, 'cheques_stripe_importe_mes', v_n1,
                                 'cheques_stripe_comision_mes', v_n2, 'cheques_stripe_comision_estimadas', v_b);
  end if;

  -- (Nuevo) Llamadas del asistente telefónico (Vapi) este mes, de call_logs.
  if to_regclass('public.call_logs') is not null then
    execute $q$select count(*)::bigint, coalesce(sum(duration_seconds), 0)::bigint
                 from public.call_logs where started_at >= $1$q$
      into v_a, v_b using v_mes;
    v := v || jsonb_build_object('llamadas_mes', v_a, 'llamadas_segundos_mes', v_b);
    if exists (select 1 from pg_attribute
                where attrelid = to_regclass('public.call_logs')
                  and attname = 'cost_total_usd' and not attisdropped) then
      execute $q$select sum(cost_total_usd), sum(cost_total_eur)
                   from public.call_logs where started_at >= $1$q$
        into v_n1, v_n2 using v_mes;
      v := v || jsonb_build_object('llamadas_usd_mes', v_n1, 'llamadas_eur_mes', v_n2);
    end if;
  end if;

  return v;
end;
$$;
revoke all on function public.servicios_metricas_supabase() from public, anon, authenticated;
grant execute on function public.servicios_metricas_supabase() to service_role;

-- ─── 5. Semilla de los demás proveedores (no pisa lo editado) ───────────────
insert into public.servicios_contratados
  (proveedor, nombre, plan, precio_mensual, precio_anual, moneda, ciclo, renovacion, cuenta, panel_url,
   categoria, orden, activo, por_confirmar, fuente_precio, limites, notas, actualizado_por)
values
  ('openai', 'OpenAI', 'Pago por uso', null, null, 'USD', 'por_uso', null,
   'Organización de OpenAI del restaurante · un proyecto por proceso (carga de datos, chatbot de facturas y el resto)',
   'https://platform.openai.com/settings/organization/billing/overview',
   'ia', 60, true, false, 'https://openai.com/api/pricing/',
   $j${
     "gasto_ia_mes": {"orden": 1, "etiqueta": "Gasto de IA este mes", "unidad": "EUR", "periodo": "mes en curso", "limite_desde": "Tope de gasto de IA de Super Admin › Costes", "nota": "Lo facturado por OpenAI hasta el último día cerrado más la estimación de lo que aún no ha publicado."}
   }$j$::jsonb,
   'Sin cuota: OpenAI cobra lo que se usa de cada modelo (ver la fuente del precio), con saldo prepagado. El gasto real lo trae sincronizar-costes-openai cada 6 h (OPENAI_ADMIN_KEY); lo que OpenAI aún no ha publicado sale de la estimación de ia_uso. Los límites de peticiones dependen del nivel (tier) de la cuenta: por confirmar en su panel (Limits).',
   null),
  ('vapi', 'Vapi (asistente telefónico)', 'Pago por uso (sin paquete de soporte)', null, null, 'USD', 'por_uso', null,
   'Asistente de voz que contesta el teléfono del restaurante (call_logs guarda cada llamada y su coste)',
   'https://dashboard.vapi.ai/',
   'telefonia', 70, true, true, 'https://vapi.ai/pricing',
   $j${
     "llamadas_simultaneas": {"orden": 4, "etiqueta": "Llamadas a la vez", "limite": 4, "unidad": "llamadas", "periodo": "a la vez", "fuente": "https://vapi.ai/pricing", "nota": "Sin paquete de soporte, Vapi atiende 4 llamadas a la vez (10 con el paquete Core, 29 US$/mes). Vapi no da este dato por API."}
   }$j$::jsonb,
   'Sin cuota: 0,05 US$ por minuto de Vapi más lo que cobren la voz, la transcripción y el modelo, con saldo prepagado (5 US$ de regalo al empezar). Plan por confirmar en su panel.',
   null),
  ('google', 'Google Maps Platform (reseñas)', 'Pago por uso con uso gratuito al mes', null, null, 'USD', 'por_uso', null,
   'Clave GOOGLE_PLACES_API_KEY: valoración y reseñas de la ficha de Google (función sync-google-reviews)',
   'https://console.cloud.google.com/google/maps-apis/metrics',
   'mapas', 80, true, true, 'https://developers.google.com/maps/billing-and-pricing/pricing',
   $j${
     "consultas_ficha_resenas": {"orden": 1, "etiqueta": "Consultas de la ficha con reseñas (Place Details Enterprise + Atmosphere)", "limite": 1000, "unidad": "consultas", "periodo": "mes natural", "fuente": "https://developers.google.com/maps/billing-and-pricing/pricing", "nota": "Gratis hasta 1.000 al mes; después, 25 US$ cada 1.000. Cada «Sincronizar reseñas» hace una. Sin lectura automática: míralo en su panel (Metrics)."}
   }$j$::jsonb,
   'Google exige una cuenta de facturación con tarjeta aunque no se pase del uso gratuito. Cuenta y plan por confirmar.',
   null),
  ('google_drive', 'Google Drive (copias de facturas)', 'Gratis, 15 GB (por confirmar)', 0, null, 'EUR', 'gratuito', null,
   'Cuenta de Google que autorizó la copia de facturas (secretos GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REFRESH_TOKEN y GOOGLE_DRIVE_PARENT_FOLDER_ID)',
   'https://drive.google.com/settings/storage',
   'archivos', 90, true, true, 'https://support.google.com/googleone/answer/9312312',
   $j${
     "almacenamiento": {"orden": 1, "etiqueta": "Espacio de la cuenta de Google", "limite": 15, "unidad": "GB", "periodo": "ahora", "fuente": "https://support.google.com/googleone/answer/9312312", "nota": "Compartido con Gmail y Google Fotos de esa cuenta. Sin lectura automática: míralo en Drive."}
   }$j$::jsonb,
   'Solo se usa si están esos cuatro secretos en Supabase; si no, las facturas originales se guardan en Supabase Storage y puedes desmarcar «Lo usamos». Si la cuenta tiene Google One, cambia aquí el plan, el precio y el límite.',
   null),
  ('mapbox', 'Mapbox (mapa de vinos)', 'Pago por uso (gratis hasta 50.000 cargas al mes)', null, null, 'USD', 'por_uso', null,
   'Token público VITE_MAPBOX_TOKEN del proyecto web-casatomas en Vercel: mapa del mundo de la carta de vinos',
   'https://console.mapbox.com/',
   'mapas', 85, true, true, 'https://www.mapbox.com/pricing',
   $j${
     "cargas_mapa_web": {"orden": 1, "etiqueta": "Cargas del mapa de vinos (web)", "limite": 50000, "unidad": "cargas", "periodo": "mes natural", "fuente": "https://www.mapbox.com/pricing", "nota": "Después, 5 US$ cada 1.000 cargas. El mapa solo se carga cuando un visitante lo abre. Sin lectura automática: míralo en su panel (Statistics)."}
   }$j$::jsonb,
   'Cuenta y plan por confirmar (el token es el mismo de la web vieja).',
   null),
  ('perplexity', 'Perplexity (precios de mercado)', 'Pago por uso (créditos)', null, null, 'USD', 'por_uso', null,
   'Clave PERPLEXITY_API_KEY (función buscar-precios-mercado)',
   'https://www.perplexity.ai/settings/api',
   'ia', 65, false, true, 'https://docs.perplexity.ai/docs/getting-started/pricing',
   '{}'::jsonb,
   'Hoy no se usa: la función buscar-precios-mercado existe, pero nada del panel la llama (candidata a borrarse). Si se vuelve a usar, marca «Lo usamos»; su gasto queda en ia_uso.',
   null),
  ('hostinger', 'Hostinger', 'Por confirmar', null, null, 'EUR', 'anual', null,
   'Cuenta de Hostinger (por confirmar)',
   'https://hpanel.hostinger.com/',
   'dominio', 95, true, true, 'https://www.hostinger.com/es',
   '{}'::jsonb,
   'Lo indicó el dueño (03/11/2026), pero en el código no aparece Hostinger y el dominio restaurantecasatomascrevillente.es tiene hoy los DNS, el correo y la web antigua en servidores de Grupo Loading (tarjeta «Loading»). Con la clave SERVICIOS_HOSTINGER_TOKEN esta tarjeta lee las suscripciones y los dominios de la cuenta, con su caducidad. Si no se usa, desmarca «Lo usamos».',
   null),
  ('loading', 'Loading (dominio, correo y web antigua)', 'Por confirmar', null, null, 'EUR', 'anual', null,
   'Dominio restaurantecasatomascrevillente.es: DNS ns1–ns3.controldeservidor.com, correo mx1–mx3.controldeservidor.com y web WordPress antigua (185.47.245.223)',
   'https://www.loading.es/clientes/clientarea.php',
   'dominio', 96, true, true, 'https://www.loading.es/hosting/index.html',
   '{}'::jsonb,
   'Comprobado por DNS el 03/11/2026: los servidores de nombres (también ns1–ns3.grupoloading.com) y de correo son de Grupo Loading Systems S.L. (loading.es). Loading no tiene API pública: apunta aquí el plan, lo que se paga al año y la caducidad del dominio (Renovación) para que salga en «Próximas renovaciones». Los .es no tienen whois público.',
   null)
on conflict (proveedor) do nothing;

do $$
begin
  raise notice 'servicios_planes_costes: aplicada';
end;
$$;

commit;
