set client_encoding = 'UTF8';
-- ============================================================================
-- 20261222140000_vinos_precio_compra · Carta de vinos (25/11/2026)
-- ----------------------------------------------------------------------------
-- Petición del dueño: «que se cojan todos los precios de vinos de facturas … se guarden en una tabla
-- que se actualice para que no esté constantemente cruzando datos y que aparte del precio en carta
-- aparezca en cada tarjeta el precio de compra con IVA; esto solo lo podrán ver los usuarios que
-- tengan permiso a editar la carta».
--
-- 1. vinos_precio_compra: una fila por vino con compra en facturas. El precio sale del MISMO cruce que
--    «Facturas › Márgenes › Coste vinos» (vinos_coste_carta_datos: enlace vino_producto, última
--    factura de Casa Tomás, botella del formato de la carta, botellas sin cargo), no de otro cálculo.
--    · precio_compra: precio de la botella en la última factura, SIN IVA.
--    · coste_efectivo: total pagado ÷ (pagadas + sin cargo), SIN IVA (el de Márgenes).
--    · iva_pct: el de la línea o de la factura; si no se sabe, 21 % (vino). *_iva: con IVA.
--    · proveedor, factura, línea, fecha, estado y avisos de Márgenes, IVA de venta y multiplicador
--      mínimo de la configuración (para que la tarjeta calcule el multiplicador con el precio vivo).
--    LECTURA: solo quien puede EDITAR la carta (can_write_section('gestor_carta'); el super admin
--    siempre). Nadie escribe desde la API: solo las funciones de abajo. anon no tiene nada.
-- 2. Se mantiene sola, sin cruzar datos al abrir la carta:
--    · Disparadores baratos que solo apuntan «hay que recalcular» en vinos_precio_compra_cola:
--      líneas de factura de un producto enlazado a un vino (alta, cambio o borrado), cambios de una
--      factura con vinos (fecha, total, local, tipo, facturada), enlaces vino↔producto y cambios de
--      nombre, precio o visibilidad de un vino.
--    · Cron «vinos-precio-compra» (cada minuto): si hay algo apuntado y ya no se está cargando (1 min
--      sin apuntes, máx. 10 min de espera), recalcula la tabla entera (~1–2 s) con tope de 30 s.
--    · Cron «vinos-precio-compra-diario» (5:47): recálculo completo de seguridad (envases del
--      catálogo, configuración…).
--    · Rellenado inicial con el histórico al aplicar (último precio de compra de cada vino).
-- Vinos que no están en el análisis de Márgenes (desactivados o fuera de la carta del restaurante):
-- conservan su última fila mientras sigan enlazados al mismo producto; si se desenlazan, se borra.
--
-- La web pública no lee esta tabla ni la necesita. Reaplicable. Sin begin/commit.
-- Vuelta atrás: supabase/rollbacks/20261222140000_vinos_precio_compra_ROLLBACK.sql
-- Pruebas:      npm run test:vinos-precio-compra:db (PGlite)
-- ============================================================================
set lock_timeout = '5s';

do $$
begin
  if to_regprocedure('public.vinos_coste_carta_datos(date,integer,jsonb)') is null then
    raise exception '20261222140000: falta vinos_coste_carta_datos (20261207150000). No se ha cambiado nada.';
  end if;
  if to_regprocedure('public.can_write_section(text)') is null then
    raise exception '20261222140000: falta can_write_section. No se ha cambiado nada.';
  end if;
end;
$$;

-- ─── 1. Tabla ───────────────────────────────────────────────────────────────
create table if not exists public.vinos_precio_compra (
  vino_id            text primary key references public."Vinos"(id) on delete cascade,
  producto_id        bigint,
  producto           text,
  precio_compra      numeric(12,4) not null,
  coste_efectivo     numeric(12,4),
  iva_pct            numeric(5,2) not null,
  iva_origen         text,
  precio_compra_iva  numeric(12,2) generated always as (round(precio_compra * (1 + iva_pct / 100), 2)) stored,
  coste_efectivo_iva numeric(12,2) generated always as (round(coste_efectivo * (1 + iva_pct / 100), 2)) stored,
  botellas_pagadas   numeric(12,2),
  botellas_sin_cargo numeric(12,2),
  proveedor          text,
  proveedor_id       bigint,
  factura_id         bigint,
  linea_id           bigint,
  numero_documento   text,
  tipo_documento     text,
  fecha              date,
  nombre_linea       text,
  estado             text,
  avisos             text[] not null default '{}',
  iva_venta_pct      numeric(5,2),
  multiplicador_min  numeric(5,2),
  actualizado_en     timestamptz not null default now()
);
comment on table public.vinos_precio_compra is
  'Precio de compra de cada vino según su última factura (mismo cruce que Márgenes › Coste vinos). Solo la leen quienes pueden editar la carta. La mantienen los disparadores + cron de 20261222140000; nadie escribe desde la API.';
comment on column public.vinos_precio_compra.precio_compra is 'Precio de la botella (formato de la carta) en la última factura, sin IVA.';
comment on column public.vinos_precio_compra.coste_efectivo is 'Total pagado ÷ (botellas pagadas + sin cargo) de la última factura, sin IVA (el de Márgenes).';
comment on column public.vinos_precio_compra.iva_pct is 'IVA de compra: el de la línea o la factura; 21 % si no se sabe.';
comment on column public.vinos_precio_compra.actualizado_en is 'Última vez que cambió algún dato de la fila.';

alter table public.vinos_precio_compra enable row level security;
revoke all on public.vinos_precio_compra from public, anon, authenticated;
grant select on public.vinos_precio_compra to authenticated;
grant all on public.vinos_precio_compra to service_role;
drop policy if exists vinos_precio_compra_leer_editores_carta on public.vinos_precio_compra;
create policy vinos_precio_compra_leer_editores_carta on public.vinos_precio_compra
  for select to authenticated
  using ((select public.can_write_section('gestor_carta')));

-- Cola de «hay que recalcular» (una fila por sentencia; insertar no bloquea a nadie).
create table if not exists public.vinos_precio_compra_cola (
  id     bigint generated always as identity primary key,
  creado timestamptz not null default now()
);
comment on table public.vinos_precio_compra_cola is
  'Apuntes de los disparadores de 20261222140000: algo ha cambiado y vinos_precio_compra se recalcula en la siguiente vuelta del cron.';
alter table public.vinos_precio_compra_cola enable row level security;
revoke all on public.vinos_precio_compra_cola from public, anon, authenticated;
grant all on public.vinos_precio_compra_cola to service_role;

-- ─── 2. Recalcular ──────────────────────────────────────────────────────────
create or replace function public.vinos_precio_compra_refrescar(p_hoy date default null)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
-- 20261222140000_vinos_precio_compra: vuelca vinos_coste_carta_datos (última factura) en la tabla.
declare
  v_t0   timestamptz := clock_timestamp();
  d      jsonb := public.vinos_coste_carta_datos(coalesce(p_hoy, current_date), null, null);
  v_iva  numeric := coalesce((d #>> '{config,iva_pct}')::numeric, 10);
  v_min  numeric := coalesce((d #>> '{config,multiplicador_min_vino}')::numeric, 2.3);
  v_cambiadas int;
  v_borradas  int;
  v_total     int;
begin
  create temp table if not exists _vinos_precio_compra_nuevo (
    vino_id text primary key, producto_id bigint, producto text, precio_compra numeric, coste_efectivo numeric,
    iva_pct numeric, iva_origen text, botellas_pagadas numeric, botellas_sin_cargo numeric,
    proveedor text, proveedor_id bigint, factura_id bigint, linea_id bigint, numero_documento text,
    tipo_documento text, fecha date, nombre_linea text, estado text, avisos text[]
  ) on commit drop;
  truncate _vinos_precio_compra_nuevo;
  create temp table if not exists _vinos_precio_compra_vistos (vino_id text primary key) on commit drop;
  truncate _vinos_precio_compra_vistos;

  insert into _vinos_precio_compra_vistos
  select distinct e ->> 'id' from jsonb_array_elements(coalesce(d -> 'vinos', '[]'::jsonb)) e where e ->> 'id' is not null;

  insert into _vinos_precio_compra_nuevo
  select e ->> 'id',
         (e ->> 'producto_id')::bigint,
         e ->> 'producto',
         round((e ->> 'coste_factura')::numeric, 4),
         round(coalesce((e ->> 'coste_efectivo')::numeric, (e ->> 'coste_factura')::numeric), 4),
         case when coalesce(e #>> '{factura,iva_origen}', 'supuesto') = 'supuesto' or (e ->> 'iva_compra_pct') is null
              then 21 else round((e ->> 'iva_compra_pct')::numeric, 2) end,
         case when (e ->> 'iva_compra_pct') is null then 'supuesto' else coalesce(e #>> '{factura,iva_origen}', 'supuesto') end,
         round((e ->> 'botellas_pagadas')::numeric, 2),
         round(coalesce((e ->> 'botellas_sin_cargo')::numeric, 0), 2),
         e #>> '{factura,proveedor}',
         (e #>> '{factura,proveedor_id}')::bigint,
         (e #>> '{factura,id}')::bigint,
         (e #>> '{factura,linea_id}')::bigint,
         e #>> '{factura,numero_documento}',
         e #>> '{factura,tipo}',
         (e #>> '{factura,fecha}')::date,
         e #>> '{factura,nombre_linea}',
         e ->> 'estado',
         coalesce(array(select jsonb_array_elements_text(coalesce(e -> 'avisos', '[]'::jsonb))), '{}')
    from jsonb_array_elements(coalesce(d -> 'vinos', '[]'::jsonb)) e
   where (e ->> 'coste_factura')::numeric > 0
     and exists (select 1 from "Vinos" v where v.id = e ->> 'id');

  -- Fuera: los que están en el análisis y ya no tienen compra, y los que no están y ya no siguen
  -- enlazados al mismo producto (desenlazados o enlazados a otro).
  delete from vinos_precio_compra t
   where not exists (select 1 from _vinos_precio_compra_nuevo n where n.vino_id = t.vino_id)
     and (exists (select 1 from _vinos_precio_compra_vistos s where s.vino_id = t.vino_id)
          or not exists (select 1 from vino_producto vp where vp.vino_id = t.vino_id and vp.producto_id = t.producto_id));
  get diagnostics v_borradas = row_count;

  insert into vinos_precio_compra as t (
    vino_id, producto_id, producto, precio_compra, coste_efectivo, iva_pct, iva_origen, botellas_pagadas,
    botellas_sin_cargo, proveedor, proveedor_id, factura_id, linea_id, numero_documento, tipo_documento, fecha,
    nombre_linea, estado, avisos, iva_venta_pct, multiplicador_min, actualizado_en)
  select n.vino_id, n.producto_id, n.producto, n.precio_compra, n.coste_efectivo, n.iva_pct, n.iva_origen,
         n.botellas_pagadas, n.botellas_sin_cargo, n.proveedor, n.proveedor_id, n.factura_id, n.linea_id,
         n.numero_documento, n.tipo_documento, n.fecha, n.nombre_linea, n.estado, n.avisos, v_iva, v_min, now()
    from _vinos_precio_compra_nuevo n
  on conflict (vino_id) do update set
    producto_id = excluded.producto_id, producto = excluded.producto, precio_compra = excluded.precio_compra,
    coste_efectivo = excluded.coste_efectivo, iva_pct = excluded.iva_pct, iva_origen = excluded.iva_origen,
    botellas_pagadas = excluded.botellas_pagadas, botellas_sin_cargo = excluded.botellas_sin_cargo,
    proveedor = excluded.proveedor, proveedor_id = excluded.proveedor_id, factura_id = excluded.factura_id,
    linea_id = excluded.linea_id, numero_documento = excluded.numero_documento,
    tipo_documento = excluded.tipo_documento, fecha = excluded.fecha, nombre_linea = excluded.nombre_linea,
    estado = excluded.estado, avisos = excluded.avisos, iva_venta_pct = excluded.iva_venta_pct,
    multiplicador_min = excluded.multiplicador_min, actualizado_en = now()
  -- Solo se reescribe (y cambia actualizado_en) si cambia algo.
  where (t.producto_id, t.producto, t.precio_compra, t.coste_efectivo, t.iva_pct, t.iva_origen, t.botellas_pagadas,
         t.botellas_sin_cargo, t.proveedor, t.proveedor_id, t.factura_id, t.linea_id, t.numero_documento,
         t.tipo_documento, t.fecha, t.nombre_linea, t.estado, t.avisos, t.iva_venta_pct, t.multiplicador_min)
        is distinct from
        (excluded.producto_id, excluded.producto, excluded.precio_compra, excluded.coste_efectivo, excluded.iva_pct,
         excluded.iva_origen, excluded.botellas_pagadas, excluded.botellas_sin_cargo, excluded.proveedor,
         excluded.proveedor_id, excluded.factura_id, excluded.linea_id, excluded.numero_documento,
         excluded.tipo_documento, excluded.fecha, excluded.nombre_linea, excluded.estado, excluded.avisos,
         excluded.iva_venta_pct, excluded.multiplicador_min);
  get diagnostics v_cambiadas = row_count;

  select count(*) into v_total from vinos_precio_compra;
  return jsonb_build_object('filas', v_total, 'cambiadas', v_cambiadas, 'borradas', v_borradas,
                            'ms', round(extract(epoch from clock_timestamp() - v_t0) * 1000)::int);
end;
$$;
revoke all on function public.vinos_precio_compra_refrescar(date) from public, anon, authenticated;
grant execute on function public.vinos_precio_compra_refrescar(date) to service_role;

-- Lo llama el cron cada minuto: recalcula si hay apuntes y ya no se está cargando.
create or replace function public.vinos_precio_compra_refrescar_pendiente(p_espera interval default interval '1 minute')
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
-- 20261222140000_vinos_precio_compra
declare
  v_ultimo  timestamptz;
  v_primero timestamptz;
  v_lock    text;
  v_res     jsonb;
begin
  if not pg_try_advisory_xact_lock(hashtext('vinos_precio_compra_refrescar')) then
    return jsonb_build_object('hecho', false, 'motivo', 'en_curso');
  end if;
  select max(creado), min(creado) into v_ultimo, v_primero from vinos_precio_compra_cola;
  if v_ultimo is null then
    return jsonb_build_object('hecho', false, 'motivo', 'nada');
  end if;
  -- El OCR mete las líneas poco a poco: se espera a que acabe, pero no más de 10 min.
  if v_ultimo > now() - p_espera and v_primero > now() - interval '10 minutes' then
    return jsonb_build_object('hecho', false, 'motivo', 'esperando');
  end if;
  v_lock := current_setting('lock_timeout', true);
  begin
    perform set_config('lock_timeout', '3s', true);
    delete from vinos_precio_compra_cola where creado <= v_ultimo;
    v_res := public.vinos_precio_compra_refrescar();
    perform set_config('lock_timeout', coalesce(v_lock, '0'), true);
    return jsonb_build_object('hecho', true, 'resultado', v_res);
  exception when lock_not_available or query_canceled or deadlock_detected then
    -- Se deshace el intento (la cola se conserva) y se reintenta en la siguiente vuelta.
    return jsonb_build_object('hecho', false, 'motivo', 'cedido', 'error', left(sqlerrm, 300));
  end;
end;
$$;
revoke all on function public.vinos_precio_compra_refrescar_pendiente(interval) from public, anon, authenticated;
grant execute on function public.vinos_precio_compra_refrescar_pendiente(interval) to service_role;

-- ─── 3. Disparadores: solo apuntan ──────────────────────────────────────────
create or replace function public.vinos_precio_compra_apuntar()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
-- 20261222140000_vinos_precio_compra: enlaces vino↔producto y cambios de los vinos (una fila por sentencia).
begin
  insert into public.vinos_precio_compra_cola default values;
  return null;
end;
$$;
revoke all on function public.vinos_precio_compra_apuntar() from public, anon, authenticated;

-- Líneas de factura: solo si alguna es de un producto enlazado a un vino.
create or replace function public.vinos_precio_compra_apuntar_lineas()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
-- 20261222140000_vinos_precio_compra
declare
  v_toca boolean := false;
begin
  if tg_op = 'INSERT' then
    select exists (select 1 from nuevas n join vino_producto vp on vp.producto_id = n.producto_id) into v_toca;
  elsif tg_op = 'DELETE' then
    select exists (select 1 from viejas o join vino_producto vp on vp.producto_id = o.producto_id) into v_toca;
  else
    select exists (
      select 1 from nuevas n join viejas o on o.id = n.id
       where (n.producto_id, n.factura_id, n.cantidad, n.total, n.importe_neto, n.precio_unitario, n.unidad, n.nombre,
              n.iva_pct, n.contenido_cantidad, n.contenido_unidad)
             is distinct from
             (o.producto_id, o.factura_id, o.cantidad, o.total, o.importe_neto, o.precio_unitario, o.unidad, o.nombre,
              o.iva_pct, o.contenido_cantidad, o.contenido_unidad)
         and exists (select 1 from vino_producto vp where vp.producto_id in (n.producto_id, o.producto_id)))
      into v_toca;
  end if;
  if v_toca then
    insert into public.vinos_precio_compra_cola default values;
  end if;
  return null;
end;
$$;
revoke all on function public.vinos_precio_compra_apuntar_lineas() from public, anon, authenticated;

-- Facturas: cambios que sacan o meten sus líneas en «la última compra», solo si tienen vinos.
create or replace function public.vinos_precio_compra_apuntar_facturas()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
-- 20261222140000_vinos_precio_compra
begin
  if exists (
    select 1 from nuevas n join viejas o on o.id = n.id
     where (n.fecha, n.total, n.local, n.tipo, n.facturado_en_id) is distinct from (o.fecha, o.total, o.local, o.tipo, o.facturado_en_id)
       and exists (select 1 from productos_factura pf join vino_producto vp on vp.producto_id = pf.producto_id
                    where pf.factura_id = n.id)) then
    insert into public.vinos_precio_compra_cola default values;
  end if;
  return null;
end;
$$;
revoke all on function public.vinos_precio_compra_apuntar_facturas() from public, anon, authenticated;

drop trigger if exists trg_vinos_precio_compra_lineas_ins on public.productos_factura;
create trigger trg_vinos_precio_compra_lineas_ins after insert on public.productos_factura
  referencing new table as nuevas for each statement execute function public.vinos_precio_compra_apuntar_lineas();
drop trigger if exists trg_vinos_precio_compra_lineas_upd on public.productos_factura;
create trigger trg_vinos_precio_compra_lineas_upd after update on public.productos_factura
  referencing old table as viejas new table as nuevas for each statement execute function public.vinos_precio_compra_apuntar_lineas();
drop trigger if exists trg_vinos_precio_compra_lineas_del on public.productos_factura;
create trigger trg_vinos_precio_compra_lineas_del after delete on public.productos_factura
  referencing old table as viejas for each statement execute function public.vinos_precio_compra_apuntar_lineas();

drop trigger if exists trg_vinos_precio_compra_facturas_upd on public.facturas;
create trigger trg_vinos_precio_compra_facturas_upd after update on public.facturas
  referencing old table as viejas new table as nuevas for each statement execute function public.vinos_precio_compra_apuntar_facturas();
-- Borrar una factura borra sus líneas (on delete cascade) y eso ya apunta.

drop trigger if exists trg_vinos_precio_compra_enlaces on public.vino_producto;
create trigger trg_vinos_precio_compra_enlaces after insert or update or delete on public.vino_producto
  for each statement execute function public.vinos_precio_compra_apuntar();

-- Nombre (formato: «Magnum»), precio (estado de Márgenes) y visibilidad (entra o sale del análisis).
drop trigger if exists trg_vinos_precio_compra_vinos on public."Vinos";
create trigger trg_vinos_precio_compra_vinos after update of nombre, precio_eur, activado, restaurante on public."Vinos"
  for each statement execute function public.vinos_precio_compra_apuntar();

-- ─── 4. Cron ────────────────────────────────────────────────────────────────
do $$
begin
  if to_regclass('cron.job') is null then
    raise notice '20261222140000: sin pg_cron; la tabla solo se recalcula al aplicar.';
    return;
  end if;
  if exists (select 1 from cron.job where jobname = 'vinos-precio-compra') then
    perform cron.unschedule('vinos-precio-compra');
  end if;
  perform cron.schedule('vinos-precio-compra', '* * * * *',
    $c$set local statement_timeout = '30s'; select public.vinos_precio_compra_refrescar_pendiente();$c$);
  if exists (select 1 from cron.job where jobname = 'vinos-precio-compra-diario') then
    perform cron.unschedule('vinos-precio-compra-diario');
  end if;
  perform cron.schedule('vinos-precio-compra-diario', '47 5 * * *',
    $c$set local statement_timeout = '60s'; select public.vinos_precio_compra_refrescar();$c$);
end;
$$;

-- ─── 5. Rellenado inicial (histórico: última compra de cada vino) ──────────
select public.vinos_precio_compra_refrescar();
