-- Informe de cheques regalo (Cheques › Stripe › «Generar informe», y el módulo
-- «Informes» del Super Admin): devuelve, SIN DATOS PERSONALES, los cheques que
-- hacen falta para calcular un periodo y compararlo con el anterior. Las cifras
-- (ventas, canjes, pendientes, comisión…) se calculan en el panel
-- (src/lib/informes/cheques), igual que el informe de tráfico web.
--
-- Entran:
--   · los cobrados (estado 'pagado') y los reembolsados (cancelados que
--     llegaron a tener pago: stripe_payment_intent_id no nulo);
--   · creados entre p_desde y p_hasta (días de Madrid, ambos incluidos);
--   · y los anteriores que a p_desde seguían vivos (sin canjear ni caducar),
--     para saber cuánto queda pendiente de canjear al cierre.
-- No salen ni código, ni nombres, ni correos, ni teléfonos.
--
-- Mismo permiso que el resto de RPC de cheques: «Ver» en Cheques.

create or replace function public.informe_cheques_regalo(p_desde date, p_hasta date)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  respuesta jsonb;
begin
  if auth.uid() is null or not coalesce(public.has_section_permission(auth.uid(), 'cheques', 'view'), false) then
    raise exception 'No tienes permiso para consultar los cheques' using errcode = '42501';
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
revoke all on function public.informe_cheques_regalo(date, date) from public, anon;
grant execute on function public.informe_cheques_regalo(date, date) to authenticated;
comment on function public.informe_cheques_regalo(date, date) is
  'Cheques (sin datos personales) para el informe de cheques regalo de un periodo y su comparación. Permiso: Cheques · Ver.';
notify pgrst, 'reload schema';
