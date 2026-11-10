set client_encoding = 'UTF8';
-- ===========================================================================
-- 20261122153000_servicios_costes_mes — Super Admin › Servicios: costes de
-- cada mes, costes que faltan por meter, informe mensual y lectura de Mapbox
-- ===========================================================================
-- Dueño (10/11/2026): «En la sección de servicios […] añadir los controles de
-- Drive y mapbox […], controlar los costes faltantes por meter y un generador
-- de informes mensuales».
--
-- QUÉ HACE
--   1. `servicios_costes_mes`: lo que de verdad se pagó (o se pagará) por un
--      servicio en un mes, metido a mano desde Servicios › Costes (factura,
--      cargo en la tarjeta…). Una fila por servicio y mes (día 1). Solo un
--      super admin con sesión de panel viva la lee y la escribe; se audita.
--      Al borrar un servicio se borran sus costes (on delete cascade).
--   2. `servicios_resumen_mes(p_mes)` (security invoker: la RLS decide): para
--      cada servicio, lo metido a mano ese mes y el coste por uso de la última
--      lectura de ese mes (servicios_uso.coste_variable). Lo usa el informe.
--   3. `servicios_cargas_mapa_vinos(p_desde)` (solo service_role): cargas del
--      mapa de vinos de la web desde esa fecha, contadas como sesiones
--      distintas con el evento `mapa_vinos` en producción (web_eventos, logs
--      de la web). Es un MÍNIMO: solo cuenta a quien aceptó las cookies de
--      análisis. Sin la tabla de logs (20261118100000) devuelve null. La usa
--      servicios-uso para la tarjeta de Mapbox.
--   4. Notas de Google Drive y Mapbox: ya tienen lectura automática.
--
-- APLICAR (una a una, nunca `db push`): demo primero (sfonaclosuafvlhutkon),
-- producción (haqmmdfdzzatdnrrcgez) solo tras aceptar el PR de la release y
-- con el «sí» del dueño. Idempotente. Después, desplegar `servicios-uso`.
-- Deshacer: supabase/rollbacks/20261122153000_servicios_costes_mes_ROLLBACK.sql
-- Pruebas: npm run test:servicios:db (PGlite).
-- ===========================================================================

begin;

do $$
begin
  if to_regclass('public.servicios_contratados') is null
     or not exists (select 1 from information_schema.columns
                     where table_schema = 'public' and table_name = 'servicios_uso' and column_name = 'coste_variable') then
    raise exception 'servicios_costes_mes: falta 20261103160000_servicios_planes_costes. No se ha cambiado nada.';
  end if;
end;
$$;

-- ─── 1. Costes de cada mes, metidos a mano ──────────────────────────────────
create table if not exists public.servicios_costes_mes (
  proveedor        text not null references public.servicios_contratados (proveedor) on delete cascade,
  mes              date not null,
  importe          numeric(12,2) not null,
  moneda           text not null default 'EUR',
  nota             text,
  actualizado_en   timestamptz not null default now(),
  actualizado_por  uuid default auth.uid(),
  primary key (proveedor, mes),
  constraint servicios_costes_mes_mes_chk check (mes = date_trunc('month', mes)::date and mes >= date '2020-01-01'),
  constraint servicios_costes_mes_importe_chk check (importe >= 0 and importe < 1000000),
  constraint servicios_costes_mes_moneda_chk check (moneda in ('EUR', 'USD', 'GBP')),
  constraint servicios_costes_mes_nota_chk check (nota is null or length(nota) <= 300)
);
comment on table public.servicios_costes_mes is
  'Coste real de un servicio en un mes (día 1), metido a mano por el super admin en Servicios › Costes. Manda sobre la estimación (cuota + uso) en el informe mensual.';

create or replace function public.servicios_costes_mes_al_editar()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.actualizado_en := now();
  new.actualizado_por := coalesce(auth.uid(), case when tg_op = 'UPDATE' then old.actualizado_por end);
  return new;
end;
$$;
revoke all on function public.servicios_costes_mes_al_editar() from public, anon, authenticated;
drop trigger if exists servicios_costes_mes_al_editar on public.servicios_costes_mes;
create trigger servicios_costes_mes_al_editar
  before insert or update on public.servicios_costes_mes
  for each row execute function public.servicios_costes_mes_al_editar();

-- Auditada como servicios_contratados (sin fiarse del event trigger: la demo no lo tiene).
do $$
begin
  if to_regprocedure('public.fn_registrar_auditoria()') is not null
     and not exists (select 1 from pg_trigger
                      where tgrelid = 'public.servicios_costes_mes'::regclass
                        and tgfoid = 'public.fn_registrar_auditoria()'::regprocedure
                        and not tgisinternal) then
    execute 'drop trigger if exists trg_auditoria on public.servicios_costes_mes';
    execute 'create trigger trg_auditoria after insert or update or delete on public.servicios_costes_mes
             for each row execute function public.fn_registrar_auditoria()';
  end if;
end;
$$;

alter table public.servicios_costes_mes enable row level security;
revoke all on public.servicios_costes_mes from anon, authenticated;
grant select, insert, delete on public.servicios_costes_mes to authenticated;
grant update (importe, moneda, nota) on public.servicios_costes_mes to authenticated;
grant all on public.servicios_costes_mes to service_role;

drop policy if exists servicios_costes_mes_super_admin on public.servicios_costes_mes;
create policy servicios_costes_mes_super_admin
  on public.servicios_costes_mes for all to authenticated
  using ( (select public.is_super_admin((select auth.uid()))) )
  with check ( (select public.is_super_admin((select auth.uid()))) );
drop policy if exists servicios_costes_mes_service_role on public.servicios_costes_mes;
create policy servicios_costes_mes_service_role
  on public.servicios_costes_mes for all to service_role using (true) with check (true);

do $$
begin
  if to_regprocedure('private.sesion_panel_permitida()') is not null then
    execute 'drop policy if exists "acceso_panel_no_bloqueado" on public.servicios_costes_mes';
    execute 'create policy "acceso_panel_no_bloqueado" on public.servicios_costes_mes as restrictive for all to authenticated
      using ((select private.sesion_panel_permitida())) with check ((select private.sesion_panel_permitida()))';
  end if;
end;
$$;

-- ─── 2. Resumen de un mes (para el informe) ─────────────────────────────────
create or replace function public.servicios_resumen_mes(p_mes date)
returns table (
  proveedor        text,
  manual_importe   numeric,
  manual_moneda    text,
  manual_nota      text,
  coste_variable   jsonb,
  ultima_lectura   timestamptz,
  lecturas         integer
)
language sql
stable
security invoker
set search_path = ''
as $$
  with mes as (
    select date_trunc('month', p_mes)::date as d
  ), lect as (
    select u.proveedor,
           count(*)::int as lecturas,
           max(u.tomado_en) as ultima,
           (array_agg(u.coste_variable order by u.tomado_en desc) filter (where u.coste_variable is not null))[1] as coste
      from public.servicios_uso u, mes
     where u.tomado_en >= mes.d::timestamp at time zone 'UTC'
       and u.tomado_en < (mes.d + interval '1 month')::timestamp at time zone 'UTC'
     group by u.proveedor
  )
  select s.proveedor, c.importe, c.moneda, c.nota, l.coste, l.ultima, coalesce(l.lecturas, 0)
    from public.servicios_contratados s
    cross join mes
    left join public.servicios_costes_mes c on c.proveedor = s.proveedor and c.mes = mes.d
    left join lect l on l.proveedor = s.proveedor;
$$;
revoke all on function public.servicios_resumen_mes(date) from public, anon;
grant execute on function public.servicios_resumen_mes(date) to authenticated, service_role;

-- ─── 3. Cargas del mapa de vinos (Mapbox), desde los logs de la web ────────
create or replace function public.servicios_cargas_mapa_vinos(p_desde timestamptz)
returns integer
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v integer;
begin
  if to_regclass('public.web_eventos') is null then
    return null;
  end if;
  execute $q$
    select count(distinct coalesce(sesion_id::text, evento_id::text))::int
      from public.web_eventos
     where tipo = 'mapa_vinos' and entorno = 'produccion'
       and not es_bot and not es_prueba and not es_interno
       and ocurrido_en >= $1
  $q$ into v using p_desde;
  return v;
end;
$$;
revoke all on function public.servicios_cargas_mapa_vinos(timestamptz) from public, anon, authenticated;
grant execute on function public.servicios_cargas_mapa_vinos(timestamptz) to service_role;

-- ─── 4. Notas de Drive y Mapbox (solo si siguen como las dejó la semilla) ──
update public.servicios_contratados
   set limites = jsonb_set(limites, '{cargas_mapa_web,nota}', to_jsonb(
         'Después, 5 US$ cada 1.000 cargas. Lectura automática: sesiones de la web que abren el mapa (solo quien acepta las cookies de análisis, así que es un mínimo). La cifra exacta, en su panel (Statistics).'::text))
 where proveedor = 'mapbox'
   and limites -> 'cargas_mapa_web' ->> 'nota' like '%Sin lectura automática%';

update public.servicios_contratados
   set limites = jsonb_set(limites, '{almacenamiento,nota}', to_jsonb(
         'Compartido con Gmail y Google Fotos de esa cuenta. Lectura automática con la misma cuenta de Google que guarda las copias de las facturas.'::text))
 where proveedor = 'google_drive'
   and limites -> 'almacenamiento' ->> 'nota' like '%Sin lectura automática%';

commit;
