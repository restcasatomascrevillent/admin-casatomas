-- Panel "Stripe" de Cheques: guarda la comisión real que cobra Stripe por cada
-- venta (la rellena el webhook de casa-tomas-story tras el pago; aquí solo se
-- añade la columna) y expone un RPC de métricas con el mismo control de
-- acceso que el resto de RPC de cheques (has_section_permission, 'cheques').
--
-- stripe_fee_eur queda NULL en compras manuales/cortesía (no pasan por
-- Stripe) y en compras anteriores a este cambio, que nunca la registraron.
-- El RPC lo señala con "comision_incompleta" en vez de fingir precisión que
-- no tiene.

alter table public.cheques_regalo
  add column if not exists stripe_fee_eur numeric(10,2);

comment on column public.cheques_regalo.stripe_fee_eur is
  'Comisión real que cobró Stripe por este cobro (balance_transaction.fee / 100), en EUR. NULL si la compra no pasó por Stripe o es anterior a este campo.';

create or replace function public.metricas_cheques_regalo(
  p_desde date default null, p_hasta date default null
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  respuesta jsonb;
begin
  if auth.uid() is null or not coalesce(public.has_section_permission(auth.uid(), 'cheques', 'view'), false) then
    raise exception 'No tienes permiso para consultar los cheques' using errcode = '42501';
  end if;
  if p_desde is not null and p_hasta is not null and p_desde > p_hasta then
    raise exception 'Rango de fechas inválido' using errcode = '22023';
  end if;

  -- Solo pagos de verdad cobrados por Stripe: las compras manuales/cortesía
  -- no tienen comisión y mezclarlas aquí falsearía "cuánto se lleva Stripe".
  with pagos as materialized (
    select c.importe_eur, c.stripe_fee_eur,
      coalesce(to_jsonb(c)->>'creado_en', to_jsonb(c)->>'created_at')::timestamptz as fecha
    from public.cheques_regalo c
    where c.estado = 'pagado' and c.origen is distinct from 'manual' and c.stripe_payment_intent_id is not null
  ), filtrados as materialized (
    select * from pagos
    where (p_desde is null or fecha >= (p_desde::timestamp at time zone 'Europe/Madrid'))
      and (p_hasta is null or fecha < ((p_hasta + 1)::timestamp at time zone 'Europe/Madrid'))
  ), con_estimacion as (
    -- Estimación (1,5% + 0,25€, tarifa estándar EEE) solo para las filas sin
    -- comisión real guardada: no sustituye el dato real cuando existe.
    select *,
      coalesce(stripe_fee_eur, round(importe_eur * 0.015 + 0.25, 2)) as fee_calculo,
      stripe_fee_eur is null as fee_estimada
    from filtrados
  )
  select jsonb_build_object(
    'pagos', (select count(*) from con_estimacion),
    'bruto_eur', (select coalesce(sum(importe_eur), 0) from con_estimacion),
    'comision_eur', (select coalesce(sum(fee_calculo), 0) from con_estimacion),
    'neto_eur', (select coalesce(sum(importe_eur - fee_calculo), 0) from con_estimacion),
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
        select (fecha at time zone 'Europe/Madrid')::date as dia, count(*) as n, sum(importe_eur) as bruto
        from con_estimacion group by 1
      ) d
    )
  ) into respuesta;
  return respuesta;
end;
$$;
revoke all on function public.metricas_cheques_regalo(date, date) from public, anon;
grant execute on function public.metricas_cheques_regalo(date, date) to authenticated;
notify pgrst, 'reload schema';
