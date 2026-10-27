-- Gastos de gestión de la compra online de cheques regalo.
--
-- La web (casa-tomas-story, función `cheques-regalo-web`) los suma al cobro
-- como una línea aparte en Stripe, calculados para que al restaurante le
-- quede el valor íntegro del cheque con la tarifa configurada aquí:
--   total = (importe + fijo) / (1 − porcentaje / 100)
--
-- APAGADOS por defecto. En España el comercio no puede cobrar un recargo por
-- usar un medio de pago concreto (art. 35.2 del RDL 19/2018): son iguales para
-- cualquier forma de pago, se enseñan antes de pagar y se activan desde la
-- pestaña Configuración de Cheques cuando la gestoría dé el visto bueno.
--
-- Además, las métricas de la pestaña Stripe pasan a separar el valor de los
-- cheques, los gastos de gestión cobrados y la comisión real de Stripe.

alter table public.plantilla_cheques_regalo
  add column if not exists gastos_gestion_activos boolean not null default false,
  add column if not exists gastos_gestion_porcentaje numeric(5,2) not null default 1.5
    constraint plantilla_cheques_gastos_porcentaje check (gastos_gestion_porcentaje >= 0 and gastos_gestion_porcentaje < 10),
  add column if not exists gastos_gestion_fijo_eur numeric(6,2) not null default 0.25
    constraint plantilla_cheques_gastos_fijo check (gastos_gestion_fijo_eur >= 0 and gastos_gestion_fijo_eur <= 5);

comment on column public.plantilla_cheques_regalo.gastos_gestion_activos is
  'Si la compra online suma gastos de gestión al cobro. Apagado por defecto.';
comment on column public.plantilla_cheques_regalo.gastos_gestion_porcentaje is
  'Parte proporcional de la tarifa que se quiere cubrir, en %. Por defecto la estándar de Stripe para tarjetas del EEE (1,5).';
comment on column public.plantilla_cheques_regalo.gastos_gestion_fijo_eur is
  'Parte fija por cobro que se quiere cubrir, en EUR. Por defecto la de Stripe (0,25).';

-- Lo cobrado de verdad en cada cheque es importe_eur + gastos_gestion_eur.
alter table public.cheques_regalo
  add column if not exists gastos_gestion_eur numeric(10,2) not null default 0
    constraint cheques_regalo_gastos_gestion check (gastos_gestion_eur >= 0);
comment on column public.cheques_regalo.gastos_gestion_eur is
  'Gastos de gestión cobrados además del valor del cheque, en EUR. 0 en compras manuales y anteriores a este campo.';

-- La factura los recoge en su propia línea y suma ambos en el total pagado.
alter table public.facturas_cheques
  add column if not exists gastos_gestion_eur numeric(10,2) not null default 0
    constraint facturas_cheques_gastos_gestion check (gastos_gestion_eur >= 0);

create or replace function public.emitir_factura_cheque(p_cheque_id uuid)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare c public.cheques_regalo; p public.plantilla_factura_cheques; f public.facturas_cheques;
begin
  select * into c from public.cheques_regalo where id = p_cheque_id for update;
  if not found or c.estado <> 'pagado' then raise exception 'Cheque no pagado'; end if;
  if not c.solicita_factura then return null; end if;
  select * into f from public.facturas_cheques where cheque_id = c.id;
  if found then return to_jsonb(f); end if;
  select * into p from public.plantilla_factura_cheques where id = true;
  if not found or p.emisor_nombre = '' or p.emisor_nif = '' or p.emisor_direccion = '' then
    raise exception 'Configura los datos fiscales del emisor en la plantilla de factura';
  end if;
  if c.datos_factura is null or coalesce(c.datos_factura->>'nombre','') = ''
    or coalesce(c.datos_factura->>'nif','') = '' or coalesce(c.datos_factura->>'direccion','') = '' then
    raise exception 'Faltan los datos fiscales del comprador';
  end if;
  insert into public.facturas_cheques(cheque_id, emisor, cliente, importe_eur, gastos_gestion_eur, iva_porcentaje)
    values (c.id, to_jsonb(p), c.datos_factura || jsonb_build_object('email', c.comprador_email),
      c.importe_eur, c.gastos_gestion_eur, p.iva_porcentaje) returning * into f;
  return to_jsonb(f);
end $$;

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
revoke all on function public.metricas_cheques_regalo(date, date) from public, anon;
grant execute on function public.metricas_cheques_regalo(date, date) to authenticated;
notify pgrst, 'reload schema';
