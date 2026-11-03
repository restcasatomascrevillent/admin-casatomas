set client_encoding = 'UTF8';
-- ===========================================================================
-- 20261103120000_servicios_contratados — Super Admin › Servicios (03/11/2026)
-- ===========================================================================
-- Pantalla que reúne los servicios contratados (Vercel, Supabase, GitHub,
-- Resend y Stripe) con el PLAN de cada uno y su CONSUMO frente al límite del
-- plan, para vigilar cuándo nos acercamos a un tope.
--
-- QUÉ CREA
--   1. `servicios_contratados`: una fila por proveedor (plan, precio, ciclo,
--      renovación, cuenta, enlace al panel, LÍMITES del plan y notas). La lee y
--      la edita SOLO un super admin (RLS); proveedor (clave) no se cambia y las
--      altas/bajas son solo de service_role. SE AUDITA (lo toca el dueño).
--      `limites` = { "<métrica>": { etiqueta, limite, unidad, periodo, fuente,
--      nota, orden } }; `limite` null = «sin dato». Formato validado por
--      `servicios_limites_validos()`.
--   2. `servicios_uso`: lecturas de consumo que hace la Edge Function
--      `servicios-uso` (histórico y caché de 15 min para no llamar a las APIs
--      en cada visita). `metricas` = { "<métrica>": { etiqueta, valor, unidad,
--      limite, unidad_limite, periodo, nota, orden } }; `error` = código
--      ('falta_secreto', 'credencial_rechazada', 'error_api'…) y `detalles`
--      (p. ej. { "secreto": "SERVICIOS_VERCEL_TOKEN" }). NUNCA guarda una clave.
--      Solo la escribe service_role; la lee un super admin. DATO DERIVADO: sin
--      trigger de auditoría (entra en la lista de exclusión, como ia_uso).
--   3. `servicios_uso_ultimas()`: la última lectura de cada proveedor
--      (SECURITY INVOKER: la RLS decide quién la ve).
--   4. `servicios_metricas_supabase()`: lo que la función mide sin token de
--      gestión, con la clave de servicio: tamaño de la BD, archivos de Storage,
--      usuarios activos del mes y correos/contactos de nuestras tablas (para
--      estimar Resend). SOLO service_role.
--   5. Semilla con lo que sabemos de cada proveedor (on conflict do nothing:
--      no pisa lo que el dueño haya editado). Límites sacados de la
--      documentación oficial el 03/11/2026 (URL en `fuente`).
--
-- AUDITORÍA: `servicios_contratados` recibe `trg_auditoria` (el event trigger
-- `audit_panel_nuevas_tablas` o, si no existe, esta migración: la demo no lo
-- tiene); actualizado_en está entre los tiempos que el trigger ignora. `servicios_uso` se AÑADE a la lista de exclusión de
-- `instalar_auditoria_panel()` y `fn_audit_nueva_tabla()` (se reescriben desde
-- su definición actual, sin copiar el cuerpo, como 20261009100000) y se le
-- quita el trigger si lo tuviera.
--
-- APLICAR (una a una, nunca `db push`): demo primero (sfonaclosuafvlhutkon),
-- producción (haqmmdfdzzatdnrrcgez) solo tras aceptar el PR y con el «sí» del
-- dueño. Idempotente. Tiene que terminar en «servicios_contratados: aplicada».
-- Deshacer: supabase/rollbacks/20261103120000_servicios_contratados_ROLLBACK.sql
-- Pruebas: npm run test:servicios:db (PGlite).
-- ===========================================================================

begin;
set local lock_timeout = '5s';

do $$
begin
  if to_regprocedure('public.is_super_admin(uuid)') is null then
    raise exception 'servicios_contratados: falta public.is_super_admin(uuid). No se ha cambiado nada.';
  end if;
end;
$$;

-- ─── 0. Auditoría: servicios_uso entra en la lista de exclusión ─────────────
do $$
declare
  v_def text;
begin
  for v_def in
    select pg_get_functiondef(p.oid)
      from pg_proc p
     where p.pronamespace = 'public'::regnamespace
       and p.proname in ('instalar_auditoria_panel', 'fn_audit_nueva_tabla')
  loop
    if position('''ia_uso'',' in v_def) > 0 and position('''servicios_uso''' in v_def) = 0 then
      execute replace(v_def, '''ia_uso'',', '''ia_uso'',''servicios_uso'',');
    end if;
  end loop;
end;
$$;

-- ─── 1. Validación del JSON de límites ──────────────────────────────────────
create or replace function public.servicios_limites_validos(p jsonb)
returns boolean
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_clave text;
  v_valor jsonb;
  v_n integer := 0;
begin
  if p is null or jsonb_typeof(p) <> 'object' then
    return false;
  end if;
  for v_clave, v_valor in select key, value from jsonb_each(p) loop
    v_n := v_n + 1;
    if v_n > 40 or v_clave !~ '^[a-z0-9_]{1,60}$' or jsonb_typeof(v_valor) <> 'object' then
      return false;
    end if;
    -- limite: número >= 0 o null/ausente (= «sin dato»).
    if v_valor ? 'limite' and jsonb_typeof(v_valor -> 'limite') not in ('number', 'null') then
      return false;
    end if;
    if jsonb_typeof(v_valor -> 'limite') = 'number' and (v_valor ->> 'limite')::numeric < 0 then
      return false;
    end if;
    if v_valor ? 'orden' and jsonb_typeof(v_valor -> 'orden') not in ('number', 'null') then
      return false;
    end if;
    -- Textos cortos; la fuente, solo https.
    if length(coalesce(v_valor ->> 'etiqueta', '')) > 120
       or length(coalesce(v_valor ->> 'unidad', '')) > 30
       or length(coalesce(v_valor ->> 'periodo', '')) > 60
       or length(coalesce(v_valor ->> 'nota', '')) > 500
       or length(coalesce(v_valor ->> 'fuente', '')) > 500 then
      return false;
    end if;
    if nullif(v_valor ->> 'fuente', '') is not null and (v_valor ->> 'fuente') !~ '^https://[^\s]+$' then
      return false;
    end if;
  end loop;
  return true;
end;
$$;

-- ─── 2. Tablas ──────────────────────────────────────────────────────────────
create table if not exists public.servicios_contratados (
  proveedor       text primary key,
  nombre          text not null,
  plan            text,
  precio_mensual  numeric(10, 2),
  moneda          text not null default 'USD',
  ciclo           text not null default 'mensual',
  renovacion      date,
  cuenta          text,
  panel_url       text,
  limites         jsonb not null default '{}'::jsonb,
  notas           text,
  actualizado_en  timestamptz not null default now(),
  actualizado_por uuid default auth.uid() references auth.users(id) on delete set null,
  constraint servicios_contratados_proveedor_chk check (proveedor ~ '^[a-z0-9_-]{2,40}$'),
  constraint servicios_contratados_nombre_chk check (length(btrim(nombre)) between 1 and 80),
  constraint servicios_contratados_plan_chk check (plan is null or length(plan) <= 80),
  constraint servicios_contratados_precio_chk check (precio_mensual is null or (precio_mensual >= 0 and precio_mensual <= 100000)),
  constraint servicios_contratados_moneda_chk check (moneda ~ '^[A-Z]{3}$'),
  constraint servicios_contratados_ciclo_chk check (ciclo in ('mensual', 'anual', 'gratuito', 'por_uso')),
  constraint servicios_contratados_cuenta_chk check (cuenta is null or length(cuenta) <= 300),
  constraint servicios_contratados_panel_chk check (panel_url is null or (panel_url ~ '^https://[^\s]+$' and length(panel_url) <= 500)),
  constraint servicios_contratados_notas_chk check (notas is null or length(notas) <= 2000),
  constraint servicios_contratados_limites_chk check (public.servicios_limites_validos(limites))
);
comment on table public.servicios_contratados is
  'Servicios contratados (Super Admin › Servicios): plan, precio, renovación, cuenta, enlace al panel y LÍMITES del plan '
  '({ métrica: { etiqueta, limite, unidad, periodo, fuente, nota, orden } }; limite null = sin dato). Solo super admin. '
  'El consumo lo lee la Edge Function servicios-uso y lo guarda en servicios_uso.';

create table if not exists public.servicios_uso (
  id         uuid primary key default gen_random_uuid(),
  proveedor  text not null,
  tomado_en  timestamptz not null default now(),
  metricas   jsonb not null default '{}'::jsonb,
  error      text,
  detalles   jsonb not null default '{}'::jsonb,
  constraint servicios_uso_proveedor_chk check (proveedor ~ '^[a-z0-9_-]{2,40}$'),
  constraint servicios_uso_metricas_chk check (jsonb_typeof(metricas) = 'object' and length(metricas::text) <= 20000),
  constraint servicios_uso_detalles_chk check (jsonb_typeof(detalles) = 'object' and length(detalles::text) <= 4000),
  constraint servicios_uso_error_chk check (error is null or error ~ '^[a-z_]{1,40}$')
);
comment on table public.servicios_uso is
  'Lecturas de consumo de cada servicio contratado (Edge Function servicios-uso): histórico y caché de 15 min. '
  'metricas = { métrica: { etiqueta, valor, unidad, limite, unidad_limite, periodo, nota, orden } }; '
  'error = código (falta_secreto, credencial_rechazada, error_api…); detalles nunca lleva claves. Dato derivado: no se audita.';
create index if not exists servicios_uso_proveedor_tomado_idx on public.servicios_uso (proveedor, tomado_en desc);

-- Datos derivados: sin trigger de auditoría (el event trigger puede habérselo
-- puesto si la lista de exclusión no tenía el patrón esperado).
drop trigger if exists trg_auditoria on public.servicios_uso;

-- La configuración SÍ se audita. No se confía solo en el event trigger
-- `audit_panel_nuevas_tablas`: la demo (copia de producción del 20/10/2026) no
-- lo tiene, y sin él la tabla nacería sin auditar. Mismo trigger y misma
-- función que instala `instalar_auditoria_panel()`.
do $$
begin
  if to_regprocedure('public.fn_registrar_auditoria()') is not null
     and not exists (select 1 from pg_trigger
                      where tgrelid = 'public.servicios_contratados'::regclass
                        and tgfoid = 'public.fn_registrar_auditoria()'::regprocedure
                        and not tgisinternal) then
    execute 'drop trigger if exists trg_auditoria on public.servicios_contratados';
    execute 'create trigger trg_auditoria after insert or update or delete on public.servicios_contratados
             for each row execute function public.fn_registrar_auditoria()';
  end if;
end;
$$;

-- Quién y cuándo editó por última vez (el proveedor no se cambia nunca).
create or replace function public.servicios_contratados_al_editar()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.proveedor is distinct from old.proveedor then
    raise exception 'El proveedor de un servicio no se puede cambiar' using errcode = '23514';
  end if;
  new.actualizado_en := now();
  new.actualizado_por := coalesce(auth.uid(), old.actualizado_por);
  return new;
end;
$$;
revoke all on function public.servicios_contratados_al_editar() from public, anon, authenticated;
drop trigger if exists servicios_contratados_al_editar on public.servicios_contratados;
create trigger servicios_contratados_al_editar
  before update on public.servicios_contratados
  for each row execute function public.servicios_contratados_al_editar();

-- ─── 3. RLS: solo super admin; las lecturas, solo service_role las escribe ──
alter table public.servicios_contratados enable row level security;
alter table public.servicios_uso         enable row level security;

revoke all on public.servicios_contratados from anon, authenticated;
revoke all on public.servicios_uso         from anon, authenticated;
grant select on public.servicios_contratados to authenticated;
grant update (nombre, plan, precio_mensual, moneda, ciclo, renovacion, cuenta, panel_url, limites, notas)
  on public.servicios_contratados to authenticated;
grant select on public.servicios_uso to authenticated;
grant all on public.servicios_contratados to service_role;
grant all on public.servicios_uso         to service_role;

drop policy if exists servicios_contratados_select_super_admin on public.servicios_contratados;
create policy servicios_contratados_select_super_admin
  on public.servicios_contratados for select to authenticated
  using ( (select public.is_super_admin((select auth.uid()))) );
drop policy if exists servicios_contratados_update_super_admin on public.servicios_contratados;
create policy servicios_contratados_update_super_admin
  on public.servicios_contratados for update to authenticated
  using ( (select public.is_super_admin((select auth.uid()))) )
  with check ( (select public.is_super_admin((select auth.uid()))) );
drop policy if exists servicios_contratados_service_role on public.servicios_contratados;
create policy servicios_contratados_service_role
  on public.servicios_contratados for all to service_role using (true) with check (true);

drop policy if exists servicios_uso_select_super_admin on public.servicios_uso;
create policy servicios_uso_select_super_admin
  on public.servicios_uso for select to authenticated
  using ( (select public.is_super_admin((select auth.uid()))) );
drop policy if exists servicios_uso_service_role on public.servicios_uso;
create policy servicios_uso_service_role
  on public.servicios_uso for all to service_role using (true) with check (true);

-- Sesión de panel viva y usuario no bloqueado (si existe el control).
do $$
begin
  if to_regprocedure('private.sesion_panel_permitida()') is not null then
    execute 'drop policy if exists "acceso_panel_no_bloqueado" on public.servicios_contratados';
    execute 'create policy "acceso_panel_no_bloqueado" on public.servicios_contratados as restrictive for all to authenticated
      using ((select private.sesion_panel_permitida())) with check ((select private.sesion_panel_permitida()))';
    execute 'drop policy if exists "acceso_panel_no_bloqueado" on public.servicios_uso';
    execute 'create policy "acceso_panel_no_bloqueado" on public.servicios_uso as restrictive for all to authenticated
      using ((select private.sesion_panel_permitida())) with check ((select private.sesion_panel_permitida()))';
  end if;
end;
$$;

-- ─── 4. Última lectura de cada proveedor (la RLS decide) ────────────────────
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

-- ─── 5. Métricas de Supabase sin token de gestión (solo service_role) ───────
-- Tamaño de la BD, Storage, usuarios activos del mes (inicio de sesión o
-- sesión renovada este mes, como cuenta Supabase los MAU) y, para estimar
-- Resend cuando su API no da el dato, los correos y contactos de nuestras
-- tablas. Cada bloque comprueba que su tabla existe: nunca falla por eso.
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
  v jsonb := jsonb_build_object(
    'bd_bytes', pg_database_size(current_database()),
    'mes_desde', v_mes,
    'dia_desde', v_dia
  );
  v_a bigint;
  v_b bigint;
begin
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

  return v;
end;
$$;
revoke all on function public.servicios_metricas_supabase() from public, anon, authenticated;
grant execute on function public.servicios_metricas_supabase() to service_role;

-- ─── 6. Semilla (no pisa lo editado) ────────────────────────────────────────
insert into public.servicios_contratados
  (proveedor, nombre, plan, precio_mensual, moneda, ciclo, renovacion, cuenta, panel_url, limites, notas, actualizado_por)
values
  ('vercel', 'Vercel', 'Hobby', 0, 'USD', 'gratuito', null,
   'Equipo «Casa tomas» (casa-tomas, team_18KKVg7ueSX0PL4Ycy1QakZj) · proyectos web-casatomas y admin-casatomas',
   'https://vercel.com/casa-tomas/~/usage',
   $j${
     "peticiones_cdn": {"orden": 1, "etiqueta": "Visitas a las webs (peticiones al CDN)", "limite": 1000000, "unidad": "peticiones", "periodo": "últimos 30 días", "fuente": "https://vercel.com/docs/plans/hobby"},
     "transferencia_rapida": {"orden": 2, "etiqueta": "Datos servidos a los visitantes (Fast Data Transfer)", "limite": 100, "unidad": "GB", "periodo": "últimos 30 días", "fuente": "https://vercel.com/docs/plans/hobby"},
     "transferencia_origen": {"orden": 3, "etiqueta": "Datos desde el servidor (Fast Origin Transfer)", "limite": 10, "unidad": "GB", "periodo": "últimos 30 días", "fuente": "https://vercel.com/docs/plans/hobby"},
     "invocaciones_funciones": {"orden": 4, "etiqueta": "Ejecuciones de funciones", "limite": 1000000, "unidad": "invocaciones", "periodo": "últimos 30 días", "fuente": "https://vercel.com/docs/plans/hobby"},
     "cpu_activa": {"orden": 5, "etiqueta": "Tiempo de CPU de las funciones", "limite": 4, "unidad": "horas", "periodo": "últimos 30 días", "fuente": "https://vercel.com/docs/plans/hobby"},
     "transformaciones_imagen": {"orden": 6, "etiqueta": "Imágenes optimizadas", "limite": 5000, "unidad": "transformaciones", "periodo": "últimos 30 días", "fuente": "https://vercel.com/docs/plans/hobby"},
     "despliegues_24h": {"orden": 7, "etiqueta": "Publicaciones (despliegues)", "limite": 100, "unidad": "despliegues", "periodo": "últimas 24 h", "fuente": "https://vercel.com/docs/plans/hobby"}
   }$j$::jsonb,
   'Plan gratuito. Si se pasa de un límite, Vercel pausa ese recurso hasta que pasen 30 días. El plan Hobby es para uso no comercial (Pro: 20 USD por persona y mes).',
   null),
  ('supabase', 'Supabase', 'Free', 0, 'USD', 'gratuito', null,
   'Organización «Casa Tomas» · proyectos casatomas-prod (haqmmdfdzzatdnrrcgez) y casatomas-staging (sfonaclosuafvlhutkon)',
   'https://supabase.com/dashboard/org/_/usage',
   $j${
     "bd_tamano": {"orden": 1, "etiqueta": "Tamaño de la base de datos", "limite": 500, "unidad": "MB", "periodo": "ahora", "fuente": "https://supabase.com/docs/guides/platform/billing-on-supabase", "nota": "Límite por proyecto."},
     "almacenamiento": {"orden": 2, "etiqueta": "Fotos y archivos guardados (Storage)", "limite": 1, "unidad": "GB", "periodo": "ahora", "fuente": "https://supabase.com/docs/guides/platform/billing-on-supabase", "nota": "Se mide solo este proyecto; el límite es para toda la organización."},
     "usuarios_activos_mes": {"orden": 3, "etiqueta": "Usuarios activos este mes", "limite": 50000, "unidad": "usuarios", "periodo": "mes en curso", "fuente": "https://supabase.com/docs/guides/platform/billing-on-supabase"},
     "invocaciones_funciones_mes": {"orden": 4, "etiqueta": "Ejecuciones de funciones este mes", "limite": 500000, "unidad": "invocaciones", "periodo": "mes en curso", "fuente": "https://supabase.com/docs/guides/platform/billing-on-supabase", "nota": "En el plan Free, Supabase no da el total del mes por API: aquí sale el de las últimas 24 h y el del mes está en su panel (Usage)."},
     "egreso": {"orden": 5, "etiqueta": "Datos servidos (egress)", "limite": 5, "unidad": "GB", "periodo": "mes en curso", "fuente": "https://supabase.com/docs/guides/platform/billing-on-supabase", "nota": "Supabase no da este dato por API en el plan Free: míralo en su panel (Usage)."}
   }$j$::jsonb,
   'Plan gratuito. Un proyecto Free se pausa tras una semana sin actividad.',
   null),
  ('github', 'GitHub', 'Free', 0, 'USD', 'gratuito', null,
   'Cuenta restcasatomascrevillent · repositorios web-casatomas y admin-casatomas',
   'https://github.com/settings/billing/usage',
   $j${
     "actions_computo": {"orden": 1, "etiqueta": "Pruebas automáticas (GitHub Actions)", "limite": 12, "unidad": "USD", "periodo": "mes en curso", "fuente": "https://docs.github.com/en/billing/concepts/product-billing/github-actions", "nota": "El plan gratuito incluye 12 USD de cómputo al mes en repositorios privados (unos 2.000 minutos de Linux)."},
     "almacenamiento_artefactos": {"orden": 2, "etiqueta": "Almacenamiento de artefactos y paquetes", "limite": 500, "unidad": "MB", "periodo": "media del mes", "fuente": "https://docs.github.com/en/billing/concepts/product-billing/github-actions"}
   }$j$::jsonb,
   'Plan gratuito. Los repositorios privados del plan Free no admiten reglas de protección de ramas (ver docs/PROCESO-DE-CAMBIOS.md).',
   null),
  ('resend', 'Resend', 'Free (por confirmar)', 0, 'USD', 'gratuito', null,
   'Correos de reservas y newsletter',
   'https://resend.com/settings/usage',
   $j${
     "correos_mes": {"orden": 1, "etiqueta": "Correos enviados este mes", "limite": 3000, "unidad": "correos", "periodo": "mes en curso", "fuente": "https://resend.com/docs/knowledge-base/account-quotas-and-limits"},
     "correos_hoy": {"orden": 2, "etiqueta": "Correos enviados hoy", "limite": 100, "unidad": "correos", "periodo": "hoy (UTC)", "fuente": "https://resend.com/docs/knowledge-base/account-quotas-and-limits", "nota": "Solo el plan gratuito tiene tope diario."},
     "contactos_marketing": {"orden": 3, "etiqueta": "Contactos de la newsletter", "limite": 1000, "unidad": "contactos", "periodo": "ahora", "fuente": "https://resend.com/docs/knowledge-base/account-quotas-and-limits"},
     "dominios": {"orden": 4, "etiqueta": "Dominios de envío", "limite": 3, "unidad": "dominios", "periodo": "ahora", "fuente": "https://resend.com/pricing"}
   }$j$::jsonb,
   'Plan por confirmar: si la API devuelve el tope diario, la cuenta es Free (solo se manda al plan gratuito). Límites del plan Free; si el plan es otro, cámbialos aquí (Pro: 20 USD/mes y 50.000 correos/mes).',
   null),
  ('stripe', 'Stripe', 'Sin cuota (comisión por cobro)', null, 'EUR', 'por_uso', null,
   'Cuenta en MODO PRUEBA (todavía no cobra de verdad)',
   'https://dashboard.stripe.com/',
   '{}'::jsonb,
   'Sin cuota fija ni límite de uso: Stripe cobra una comisión por cada pago (1,5 % + 0,25 € con tarjetas estándar del Espacio Económico Europeo, según https://stripe.com/es/pricing).',
   null)
on conflict (proveedor) do nothing;

do $$
begin
  raise notice 'servicios_contratados: aplicada';
end;
$$;

commit;
