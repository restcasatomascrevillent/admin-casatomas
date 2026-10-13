set client_encoding = 'UTF8';
-- ===========================================================================
-- CIERRES DE RESERVAS (encargo del dueño, 2026-10-13)
-- ===========================================================================
-- «Por defecto no se cogen reservas los LUNES (todo el día), los JUEVES (todo
-- el día: es día de tapas) y los DOMINGOS POR LA NOCHE (servicio de cena).
-- Desde el calendario del panel se puede cerrar un día concreto (o un
-- servicio) y volver a abrirlo; también abrir un día que cierra por defecto.»
--
-- MODELO
--   1. Cierre SEMANAL: dos columnas en el singleton `configuracion_reservas`
--        dias_cerrados_comida int[]   (0 = domingo … 6 = sábado, como
--        dias_cerrados_cena   int[]    `extract(dow)` y `Date#getDay`)
--      Por defecto comida {1,4} y cena {0,1,4}.
--   2. EXCEPCIONES por fecha y servicio: tabla `cierres_reserva`.
--        abierto = false -> ese servicio se CIERRA ese día (aunque abra
--                           normalmente);
--        abierto = true  -> ese servicio se ABRE ese día (aunque cierre por
--                           la regla semanal, p. ej. un jueves especial).
--      Un día entero = dos filas (comida y cena).
--   3. `servicios_cerrados_reserva(desde, hasta)`: la ÚNICA regla, la que
--      consultan la web (reservas-web), el bot telefónico y el panel. Devuelve
--      solo los servicios CERRADOS del rango, con su origen.
--
-- Los cierres NO se imponen en un trigger: el personal puede hacer una
-- reserva manual un día cerrado (el panel solo avisa). Quien se niega es cada
-- canal público (web y teléfono).
--
-- Turno: comida = hora < 17:00, cena = resto (mismo corte que
-- `trg_validar_capacidad` y `turnoDeHora` de _shared/disponibilidad.ts).
--
-- APLICAR (desde adminpanelct/):
--   npx supabase db query --linked -f supabase/migrations/20261013120000_cierres_reserva.sql
-- Mientras no esté aplicada, los canales caen a la regla por defecto escrita
-- en código (lunes, jueves y domingo noche) y el panel no puede guardar
-- cierres/aperturas (lo avisa).
-- ===========================================================================
begin;
set local lock_timeout = '5s';

-- 1) Cierre semanal ---------------------------------------------------------
alter table public.configuracion_reservas
  add column if not exists dias_cerrados_comida integer[] not null default '{1,4}',
  add column if not exists dias_cerrados_cena integer[] not null default '{0,1,4}';

comment on column public.configuracion_reservas.dias_cerrados_comida is
  'Días de la semana (0=domingo…6=sábado) sin reservas en el servicio de comida. Excepciones en cierres_reserva.';
comment on column public.configuracion_reservas.dias_cerrados_cena is
  'Días de la semana (0=domingo…6=sábado) sin reservas en el servicio de cena. Excepciones en cierres_reserva.';

alter table public.configuracion_reservas
  drop constraint if exists configuracion_reservas_dias_cerrados_validos;
alter table public.configuracion_reservas
  add constraint configuracion_reservas_dias_cerrados_validos check (
    dias_cerrados_comida <@ array[0,1,2,3,4,5,6]
    and dias_cerrados_cena <@ array[0,1,2,3,4,5,6]
  );

-- 1b) Grupos: hasta 7 automático, 8 o más -> solicitud `grupo_grande`
--     (encargo del dueño 2026-10-13; lo leen reservas-web y el bot, que
--     además nunca pasa de 7). El valor anterior sale en un NOTICE.
do $$
declare v_antes integer;
begin
  select max_comensales_por_reserva into v_antes
  from public.configuracion_reservas order by created_at limit 1;
  raise notice 'max_comensales_por_reserva antes: %', v_antes;
  update public.configuracion_reservas set max_comensales_por_reserva = 7
  where max_comensales_por_reserva is distinct from 7;
end $$;

-- 2) Excepciones por fecha --------------------------------------------------
create table if not exists public.cierres_reserva (
  fecha date not null,
  turno text not null check (turno in ('comida', 'cena')),
  abierto boolean not null default false,
  motivo text check (motivo is null or char_length(motivo) <= 200),
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid(),
  primary key (fecha, turno)
);
comment on table public.cierres_reserva is
  'Excepción de reservas por fecha y servicio: abierto=false cierra, abierto=true abre un servicio que cierra por la regla semanal.';

alter table public.cierres_reserva enable row level security;
drop policy if exists cierres_reserva_select on public.cierres_reserva;
create policy cierres_reserva_select on public.cierres_reserva
  for select using ((select public.can_read_section('reservas'::text)));
drop policy if exists cierres_reserva_insert on public.cierres_reserva;
create policy cierres_reserva_insert on public.cierres_reserva
  for insert with check ((select public.can_write_section('reservas'::text)));
drop policy if exists cierres_reserva_update on public.cierres_reserva;
create policy cierres_reserva_update on public.cierres_reserva
  for update using ((select public.can_write_section('reservas'::text)))
  with check ((select public.can_write_section('reservas'::text)));
drop policy if exists cierres_reserva_delete on public.cierres_reserva;
create policy cierres_reserva_delete on public.cierres_reserva
  for delete using ((select public.can_write_section('reservas'::text)));
grant select, insert, update, delete on public.cierres_reserva to authenticated;
grant all on public.cierres_reserva to service_role;

drop trigger if exists trg_auditoria on public.cierres_reserva;
create trigger trg_auditoria after insert or update or delete on public.cierres_reserva
  for each row execute function public.fn_registrar_auditoria();

-- 3) La regla ---------------------------------------------------------------
-- origen: 'semanal' (cierra por la regla de la semana) | 'manual' (cerrado a
-- mano ese día). Los servicios abiertos no salen. Rango máximo 400 días.
create or replace function public.servicios_cerrados_reserva(p_desde date, p_hasta date)
returns table (fecha date, turno text, origen text, motivo text)
language sql
stable
security definer
set search_path = public
as $$
  with cfg as (
    select coalesce(dias_cerrados_comida, '{1,4}'::int[]) as comida,
           coalesce(dias_cerrados_cena, '{0,1,4}'::int[]) as cena
    from public.configuracion_reservas
    order by created_at
    limit 1
  ),
  cfg_o as (
    -- Sin fila de configuración: la regla por defecto.
    select comida, cena from cfg
    union all
    select '{1,4}'::int[], '{0,1,4}'::int[] where not exists (select 1 from cfg)
  ),
  dias as (
    select d::date as fecha
    from generate_series(p_desde, least(p_hasta, p_desde + 400), interval '1 day') d
    where p_desde is not null and p_hasta is not null and p_hasta >= p_desde
  ),
  servicios as (
    select dias.fecha, t.turno,
           case t.turno
             when 'comida' then extract(dow from dias.fecha)::int = any (cfg_o.comida)
             else extract(dow from dias.fecha)::int = any (cfg_o.cena)
           end as cierra_semanal
    from dias
    cross join cfg_o
    cross join (values ('comida'), ('cena')) as t(turno)
  )
  select s.fecha, s.turno,
         case when c.fecha is not null then 'manual' else 'semanal' end as origen,
         c.motivo
  from servicios s
  left join public.cierres_reserva c on c.fecha = s.fecha and c.turno = s.turno
  where coalesce(not c.abierto, s.cierra_semanal)
  order by s.fecha, s.turno;
$$;

comment on function public.servicios_cerrados_reserva(date, date) is
  'Servicios (fecha, turno) SIN reservas por web/teléfono: regla semanal de configuracion_reservas + excepciones de cierres_reserva.';

revoke all on function public.servicios_cerrados_reserva(date, date) from public;
grant execute on function public.servicios_cerrados_reserva(date, date) to anon, authenticated, service_role;

commit;
