set client_encoding = 'UTF8';
-- ===========================================================================
-- 20261122164100_cheques_stripe_solo_editar — Cheques › Stripe solo para «Editar» (10/11/2026)
-- ===========================================================================
-- Petición del dueño: «si no es editor en cheques no se puede ver lo de
-- Stripe». La pestaña Stripe (métricas de cobros y comisiones, estado de la
-- cuenta y «Generar informe») y el «Informe de cheques regalo» del Super Admin
-- pasan a exigir «Editar» en Cheques (o super admin, que has_section_permission
-- ya deja pasar). El resto de Cheques con «Ver» sigue igual: listar, verificar
-- y canjear códigos.
--
-- Cambia SOLO la comprobación de permiso de las dos RPC que usa esa pestaña
-- (cuerpos idénticos a 20261027090000 y 20261122093700):
--   · metricas_cheques_regalo  (PanelStripe)
--   · informe_cheques_regalo   (Generar informe / Super Admin › Informes)
-- La Edge Function stripe-estado-cuenta se cambia aparte en el código
-- (supabase/functions/stripe-estado-cuenta): pide can_edit_section('cheques').
-- Vuelta atrás: supabase/rollbacks/20261122164100_cheques_stripe_solo_editar_ROLLBACK.sql.
begin;

create or replace function public.metricas_cheques_regalo(
  p_desde date default null, p_hasta date default null
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  respuesta jsonb;
begin
  if auth.uid() is null or not coalesce(public.has_section_permission(auth.uid(), 'cheques', 'edit'), false) then
    raise exception 'No tienes permiso para consultar Stripe ni el informe de cheques: hace falta «Editar» en Cheques' using errcode = '42501';
  end if;
  if p_desde is not null and p_hasta is not null and p_desde > p_hasta then
    raise exception 'Rango de fechas inválido' using errcode = '22023';
  end if;

  -- Solo pagos de verdad cobrados por Stripe: las compras manuales/cortesía
  -- no tienen comisión y mezclarlas aquí falsearía "cuánto se lleva Stripe".
  with pagos as materialized (
    select c.importe_eur, coalesce(c.gastos_gestion_eur, 0) as gastos_eur, c.stripe_fee_eur,
      coalesce(to_jsonb(c)->>'creado_en', to_jsonb(c)->>'created_at')::timestamptz as fecha
    from public.cheques_regalo c
    where c.estado = 'pagado' and c.origen is distinct from 'manual' and c.stripe_payment_intent_id is not null
  ), filtrados as materialized (
    select * from pagos
    where (p_desde is null or fecha >= (p_desde::timestamp at time zone 'Europe/Madrid'))
      and (p_hasta is null or fecha < ((p_hasta + 1)::timestamp at time zone 'Europe/Madrid'))
  ), con_estimacion as (
    -- Estimación (1,5% + 0,25€ sobre lo cobrado, tarifa estándar EEE) solo para
    -- las filas sin comisión real guardada: no sustituye el dato real cuando existe.
    select *, importe_eur + gastos_eur as cobrado_eur,
      coalesce(stripe_fee_eur, round((importe_eur + gastos_eur) * 0.015 + 0.25, 2)) as fee_calculo,
      stripe_fee_eur is null as fee_estimada
    from filtrados
  )
  select jsonb_build_object(
    'pagos', (select count(*) from con_estimacion),
    -- Lo cobrado al comprador: valor de los cheques + gastos de gestión.
    'bruto_eur', (select coalesce(sum(cobrado_eur), 0) from con_estimacion),
    'valor_cheques_eur', (select coalesce(sum(importe_eur), 0) from con_estimacion),
    'gastos_gestion_eur', (select coalesce(sum(gastos_eur), 0) from con_estimacion),
    'pagos_con_gastos', (select count(*) from con_estimacion where gastos_eur > 0),
    'comision_eur', (select coalesce(sum(fee_calculo), 0) from con_estimacion),
    -- Lo que le queda al restaurante después de pagar a Stripe.
    'neto_eur', (select coalesce(sum(cobrado_eur - fee_calculo), 0) from con_estimacion),
    'comision_incompleta', (select coalesce(bool_or(fee_estimada), false) from con_estimacion),
    'por_hora', (
      select coalesce(jsonb_agg(jsonb_build_object('hora', hora, 'pagos', n) order by hora), '[]'::jsonb)
      from (
        select extract(hour from fecha at time zone 'Europe/Madrid')::int as hora, count(*) as n
        from con_estimacion group by 1
      ) h
    ),
    'por_dia', (
      select coalesce(jsonb_agg(jsonb_build_object('dia', dia, 'pagos', n, 'bruto_eur', bruto) order by dia), '[]'::jsonb)
      from (
        select (fecha at time zone 'Europe/Madrid')::date as dia, count(*) as n, sum(cobrado_eur) as bruto
        from con_estimacion group by 1
      ) d
    )
  ) into respuesta;
  return respuesta;
end;
$$;

create or replace function public.informe_cheques_regalo(p_desde date, p_hasta date)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  respuesta jsonb;
begin
  if auth.uid() is null or not coalesce(public.has_section_permission(auth.uid(), 'cheques', 'edit'), false) then
    raise exception 'No tienes permiso para consultar Stripe ni el informe de cheques: hace falta «Editar» en Cheques' using errcode = '42501';
  end if;
  if p_desde is null or p_hasta is null or p_desde > p_hasta or p_hasta - p_desde > 800 then
    raise exception 'Rango de fechas inválido' using errcode = '22023';
  end if;

  with base as materialized (
    select c.importe_eur, coalesce(c.gastos_gestion_eur, 0) as gastos_eur, c.stripe_fee_eur,
      c.origen, c.pago_manual_metodo, c.estado, c.caduca_el,
      (coalesce(to_jsonb(c)->>'creado_en', to_jsonb(c)->>'created_at')::timestamptz at time zone 'Europe/Madrid') as creado,
      case when coalesce(c.usado, false) or c.canjeado_en is not null
        then (coalesce(c.canjeado_en, (to_jsonb(c)->>'usado_en')::timestamptz, coalesce(to_jsonb(c)->>'creado_en', to_jsonb(c)->>'created_at')::timestamptz) at time zone 'Europe/Madrid')
      end as canjeado
    from public.cheques_regalo c
    where c.estado = 'pagado' or (c.estado = 'cancelado' and c.stripe_payment_intent_id is not null)
  ), elegidos as (
    select * from base
    where creado < (p_hasta + 1)::timestamp
      and (creado >= p_desde::timestamp
        or ((canjeado is null or canjeado >= p_desde::timestamp) and (caduca_el is null or caduca_el >= p_desde)))
  )
  select jsonb_build_object(
    'desde', p_desde,
    'hasta', p_hasta,
    'hoy', (clock_timestamp() at time zone 'Europe/Madrid')::date,
    'cheques', coalesce((
      select jsonb_agg(jsonb_build_object(
        'creado', to_char(creado, 'YYYY-MM-DD"T"HH24:MI:SS'),
        'importe_eur', importe_eur,
        'gastos_gestion_eur', gastos_eur,
        'stripe_fee_eur', stripe_fee_eur,
        'canal', case when origen = 'manual' then case when pago_manual_metodo = 'cortesia' then 'cortesia' else 'manual' end else 'web' end,
        'estado', case when estado = 'pagado' then 'pagado' else 'reembolsado' end,
        'canjeado', to_char(canjeado, 'YYYY-MM-DD"T"HH24:MI:SS'),
        'caduca_el', caduca_el
      ) order by creado)
      from elegidos
    ), '[]'::jsonb)
  ) into respuesta;
  return respuesta;
end;
$$;

revoke all on function public.metricas_cheques_regalo(date, date) from public, anon;
grant execute on function public.metricas_cheques_regalo(date, date) to authenticated;
revoke all on function public.informe_cheques_regalo(date, date) from public, anon;
grant execute on function public.informe_cheques_regalo(date, date) to authenticated;
comment on function public.metricas_cheques_regalo(date, date) is
  'Métricas de cobros de Stripe de la pestaña Cheques › Stripe. Permiso: Cheques · Editar.';
comment on function public.informe_cheques_regalo(date, date) is
  'Cheques (sin datos personales) para el informe de cheques regalo de un periodo y su comparación. Permiso: Cheques · Editar.';

commit;
notify pgrst, 'reload schema';
