set client_encoding = 'UTF8';
-- ============================================================================
-- 20261125110000_avisos_margen_bajo — Avisos explicados de forma sencilla
-- (11/11/2026, decisiones del dueño). Requiere 20261125100000_margenes_sin_iva_tienda.
-- ----------------------------------------------------------------------------
-- 1. AVISO NUEVO «margen bajo» (tipo facturas_margen_bajo, en Avisos › Facturas):
--    salta el día en que un artículo CRUZA su límite, no cada día que sigue por
--    debajo. Canales:
--      · vino    — multiplicador del restaurante (sin IVA) < multiplicador_min_vino
--      · tienda  — multiplicador de la tienda < multiplicador_min_tienda (solo si la
--                  tienda está activa; desactivada se sigue el estado sin avisar)
--      · peso    — artículos al peso: multiplicador < multiplicador_min_peso
--      · plato   — platos del borrador YA REVISADOS: % de coste > coste_max_plato_pct
--                  (los gramos estimados sin revisar no son fiables: no avisan)
--    Estado de cada artículo en margenes_avisos_estado (por debajo o no, cifra y
--    coste del último cálculo). Hay aviso solo si ayer estaba bien, hoy está por
--    debajo Y el coste ha subido (si cruza porque se baja el precio de la carta o
--    se cambia un límite, no avisa: eso lo ha hecho alguien a propósito).
--    Al aplicar la migración se guarda el estado actual SIN avisar: lo que ya está
--    en rojo se ve en Facturas › Márgenes y no inunda Avisos.
--    Cuando el artículo vuelve a estar bien, su aviso caduca.
--    Texto: «El vino «Ribera X» ha bajado a 2,1× (límite 2,3×): la botella te
--    cuesta ahora 14,20 € (antes 12,10 €), según la factura de Catral del 03/11.»
--    / «El coste del plato «Chuletón» es ya el 41 % del precio (límite 35 %): sube
--    Carne de vaca de 18,50 a 21,00 € el kilo, según la factura de … del …».
--    Enlace (datos.enlace) a esa factura en Facturas › Compras.
-- 2. Aviso de subida de precio (facturas_precio_sube): MISMA lógica de cuándo
--    salta; solo cambia el texto: cuánto ha subido, en qué factura, frente a qué
--    compras anteriores y qué platos o vinos de la carta usan ese producto.
-- 3. datos.texto_telegram (texto plano, una o dos frases) en los dos tipos, para
--    enviarlo más adelante. Telegram NO se implementa aquí.
-- 4. Se generan en el cron diario existente (facturas_generar_alertas, 06:15 UTC):
--    al final llama a margenes_generar_avisos(hoy) dentro de un bloque con su
--    propia excepción (un fallo de márgenes no tumba las alertas de Facturas).
--
-- facturas_generar_alertas: cuerpo de PRODUCCIÓN (pg_get_functiondef, 11/11/2026)
-- con dos añadidos marcados «20261125110000».
-- Rollback: supabase/rollbacks/20261125110000_avisos_margen_bajo_ROLLBACK.sql
-- Test:     supabase/tests/avisos_margen_bajo_test.sql
-- ============================================================================
set lock_timeout = '5s';

-- ─── Estado de cada artículo (para avisar solo al cruzar) ───────────────────
create table if not exists public.margenes_avisos_estado (
  canal text not null check (canal in ('vino', 'tienda', 'peso', 'plato')),
  articulo_id text not null,
  bajo boolean not null,
  valor numeric,
  coste numeric,
  detalle jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  primary key (canal, articulo_id)
);
comment on table public.margenes_avisos_estado is
  'Último cálculo de margen por artículo y canal (20261125110000): el aviso facturas_margen_bajo solo salta al pasar de bien a por debajo.';
alter table public.margenes_avisos_estado enable row level security;
revoke all on public.margenes_avisos_estado from public, anon, authenticated;
grant all on public.margenes_avisos_estado to service_role;

-- ─── Formato: «2,27», «2,3», «2» ─────────────────────────────────────────────
create or replace function public.margenes_num(p numeric, p_dec integer default 2)
returns text
language sql
immutable
set search_path = public
as $$
  -- 20261125110000_avisos_margen_bajo: facturas_alertas_num sin ceros a la derecha.
  select case when p is null then '—'
              else regexp_replace(regexp_replace(facturas_alertas_num(p, p_dec), '(,[0-9]*?)0+$', '\1'), ',$', '') end
$$;
revoke all on function public.margenes_num(numeric, integer) from public, anon;
grant execute on function public.margenes_num(numeric, integer) to authenticated, service_role;

-- ─── Aviso de margen bajo ───────────────────────────────────────────────────
create or replace function public.margenes_generar_avisos(p_hoy date default current_date, p_solo_estado boolean default false)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
-- 20261125110000_avisos_margen_bajo. Ver la cabecera de la migración.
declare
  v_hoy     date := coalesce(p_hoy, current_date);
  m         jsonb := public.margenes_carta_datos(v_hoy);
  cf        jsonb := m -> 'config';
  v_tienda  boolean := coalesce((m -> 'tienda' ->> 'activa')::boolean, false);
  r         record;
  v_prod    bigint;
  v_prod_n  text;
  v_eur     numeric;
  v_eur_a   numeric;
  v_med     text;
  v_fac     bigint;
  v_fecha   date;
  v_prov    text;
  v_txt     text;
  v_tg      text;
  v_tit     text;
  v_fuente  text;
  v_nuevos  int := 0;
  v_cad     int := 0;
  v_n       int := 0;
begin
  create temp table if not exists _margenes_hoy (
    canal text, articulo_id text, nombre text, bajo boolean, valor numeric, limite numeric,
    coste numeric, producto_id bigint, producto text, detalle jsonb
  ) on commit drop;
  truncate _margenes_hoy;

  insert into _margenes_hoy
  select 'vino', e ->> 'id', e ->> 'nombre', e -> 'banderas' ? 'multiplicador_bajo',
         (e ->> 'multiplicador')::numeric, (cf ->> 'multiplicador_min_vino')::numeric,
         (e ->> 'coste')::numeric, (e ->> 'producto_id')::bigint, e ->> 'producto', '{}'::jsonb
    from jsonb_array_elements(m -> 'vinos') e
   where e ->> 'multiplicador' is not null
  union all
  select 'tienda', e ->> 'id', e ->> 'nombre', e -> 'banderas' ? 'tienda_bajo',
         (e ->> 'multiplicador_tienda')::numeric, (cf ->> 'multiplicador_min_tienda')::numeric,
         (e ->> 'coste')::numeric, (e ->> 'producto_id')::bigint, e ->> 'producto', '{}'::jsonb
    from jsonb_array_elements(m -> 'vinos') e
   where e ->> 'multiplicador_tienda' is not null and (e ->> 'en_tienda')::boolean
  union all
  select 'peso', e ->> 'id', e ->> 'nombre', e -> 'banderas' ? 'multiplicador_bajo',
         (e ->> 'multiplicador')::numeric, (cf ->> 'multiplicador_min_peso')::numeric,
         (e ->> 'compra_kg')::numeric, (e ->> 'producto_id')::bigint, e ->> 'producto', '{}'::jsonb
    from jsonb_array_elements(m -> 'peso') e
   where e ->> 'multiplicador' is not null
  union all
  -- Platos del borrador (no al peso), solo los revisados. detalle: coste de cada ingrediente.
  select 'plato', e ->> 'id', e ->> 'nombre', e -> 'banderas' ? 'coste_alto',
         (e ->> 'pct')::numeric, (cf ->> 'coste_max_plato_pct')::numeric,
         (e ->> 'coste')::numeric, null, null,
         coalesce((select jsonb_object_agg(i ->> 'producto_id', jsonb_build_object(
                     'producto', i ->> 'producto', 'eur', i -> 'eur', 'coste', i -> 'coste',
                     'medida', case when i ->> 'unidad' = 'ud' then coalesce(i ->> 'unidad_compra', 'ud') else i ->> 'medida' end))
                     from jsonb_array_elements(e -> 'ingredientes') i
                    where i ->> 'coste' is not null), '{}'::jsonb)
    from jsonb_array_elements(m -> 'platos') e
   where e ->> 'pct' is not null and (e ->> 'revisado')::boolean and e ->> 'gramos_venta' is null;

  if not p_solo_estado then
    for r in
      select h.*, s.coste as coste_antes, s.detalle as detalle_antes
        from _margenes_hoy h
        join margenes_avisos_estado s on s.canal = h.canal and s.articulo_id = h.articulo_id
       where h.bajo and not s.bajo
         and h.coste > s.coste
         and (h.canal <> 'tienda' or v_tienda)
    loop
      v_prod := r.producto_id; v_prod_n := r.producto; v_eur := r.coste; v_eur_a := r.coste_antes; v_med := null;
      if r.canal = 'plato' then
        -- El ingrediente cuyo coste más ha subido desde el último cálculo.
        select d.key::bigint, d.value ->> 'producto', (d.value ->> 'eur')::numeric, (a.value ->> 'eur')::numeric, d.value ->> 'medida'
          into v_prod, v_prod_n, v_eur, v_eur_a, v_med
          from jsonb_each(r.detalle) d
          left join jsonb_each(r.detalle_antes) a on a.key = d.key
         where (d.value ->> 'coste')::numeric > coalesce((a.value ->> 'coste')::numeric, 0)
           and a.key is not null
         order by (d.value ->> 'coste')::numeric - (a.value ->> 'coste')::numeric desc
         limit 1;
        if not found then v_prod := null; end if;
      end if;

      v_fac := null; v_fecha := null; v_prov := null;
      if v_prod is not null then
        select fa.id, fa.fecha, coalesce(pr.nombre, fa.proveedor::text)
          into v_fac, v_fecha, v_prov
          from productos_factura pf
          join facturas fa on fa.id = pf.factura_id
          left join proveedores pr on pr.id = fa.proveedor_id
         where pf.producto_id = v_prod
           and fa.fecha is not null and fa.fecha <= v_hoy
           and fa.local is distinct from 'touza'
           and not (fa.tipo = 'albaran' and fa.facturado_en_id is not null)
           and coalesce(fa.total, 0) >= 0
           and pf.total > 0 and pf.cantidad > 0
         order by fa.fecha desc, pf.id desc
         limit 1;
      end if;
      v_fuente := case when v_fac is not null
                       then format(', según la factura de %s del %s', coalesce(v_prov, 'proveedor sin nombre'), to_char(v_fecha, 'DD/MM'))
                       else '' end;

      if r.canal = 'plato' then
        v_tit := left(format('Margen bajo: %s (%s %% de coste)', r.nombre, margenes_num(r.valor, 0)), 120);
        v_txt := format('El coste del plato «%s» es ya el %s %% del precio (límite %s %%)',
                        r.nombre, margenes_num(r.valor, 0), margenes_num(r.limite, 0))
                 || case when v_prod is not null and v_eur_a is not null
                         then format(': sube %s de %s a %s € %s%s', v_prod_n, facturas_alertas_num(v_eur_a, 2), facturas_alertas_num(v_eur, 2),
                                     case v_med when 'kg' then 'el kilo' when 'l' then 'el litro' when 'ud' then 'la unidad'
                                                when null then 'la unidad' else 'la ' || v_med end,
                                     v_fuente)
                         else '' end || '.';
        v_tg := v_txt;
      else
        v_tit := left(format('Margen bajo: %s%s (%s×)', r.nombre, case r.canal when 'tienda' then ' en la tienda' else '' end,
                             margenes_num(r.valor, 2)), 120);
        v_txt := format('%s ha bajado a %s× (límite %s×): %s te cuesta ahora %s € (antes %s €)%s.',
                        case r.canal
                          when 'vino' then format('El vino «%s»', r.nombre)
                          when 'tienda' then format('En la tienda, el vino «%s»', r.nombre)
                          else format('«%s» (al peso)', r.nombre) end,
                        margenes_num(r.valor, 2), margenes_num(r.limite, 2),
                        case when r.canal = 'peso' then format('el kilo de %s', coalesce(r.producto, 'compra')) else 'la botella' end,
                        facturas_alertas_num(r.coste, 2), facturas_alertas_num(r.coste_antes, 2), v_fuente);
        v_tg := v_txt;
      end if;

      insert into notificaciones_dashboard (tipo, titulo, mensaje, referencia_tipo, prioridad, clave, caduca_en, datos, leida)
      values ('facturas_margen_bajo', v_tit, v_txt || ' Precios sin IVA.', 'facturas_alerta', 'alta',
              format('margen_bajo:%s:%s:%s', r.canal, r.articulo_id, v_hoy), (v_hoy + 30)::timestamptz,
              jsonb_build_object(
                'enlace', case when v_fac is not null then '?tab=compras&modo=documentos&doc=' || v_fac
                               else '?tab=margenes&articulo=' || case when r.canal in ('vino', 'tienda') then 'vino' else 'plato' end
                                    || ':' || r.articulo_id end,
                'enlace_margenes', '?tab=margenes&articulo=' || case when r.canal in ('vino', 'tienda') then 'vino' else 'plato' end
                                   || ':' || r.articulo_id,
                'canal', r.canal, 'articulo_id', r.articulo_id, 'nombre', r.nombre,
                'valor', r.valor, 'limite', r.limite, 'coste', r.coste, 'coste_antes', r.coste_antes,
                'producto_id', v_prod, 'producto', v_prod_n, 'eur', v_eur, 'eur_antes', v_eur_a,
                'factura_id', v_fac, 'fecha', v_fecha, 'proveedor', v_prov,
                'desde', v_hoy, 'hasta', v_hoy, 'mes', to_char(v_hoy, 'YYYY-MM'), 'local', 'casa_tomas',
                'campana', true, 'texto_telegram', v_tg),
              false)
      on conflict (clave) where clave is not null do nothing;
      get diagnostics v_n = row_count;
      v_nuevos := v_nuevos + v_n;
    end loop;

    -- Ya no está por debajo: su aviso caduca (y queda leído).
    update notificaciones_dashboard n
       set caduca_en = now(), leida = true
     where n.tipo = 'facturas_margen_bajo'
       and (n.caduca_en is null or n.caduca_en > now())
       and exists (select 1 from _margenes_hoy h
                    where h.canal = n.datos ->> 'canal' and h.articulo_id = n.datos ->> 'articulo_id' and not h.bajo);
    get diagnostics v_cad = row_count;
    delete from notificaciones_dashboard n
     where n.tipo = 'facturas_margen_bajo' and n.caduca_en < now() - interval '90 days';
  end if;

  insert into margenes_avisos_estado (canal, articulo_id, bajo, valor, coste, detalle, updated_at)
  select canal, articulo_id, bajo, valor, coste, detalle, now() from _margenes_hoy
  on conflict (canal, articulo_id) do update
     set bajo = excluded.bajo, valor = excluded.valor, coste = excluded.coste,
         detalle = excluded.detalle, updated_at = excluded.updated_at;
  delete from margenes_avisos_estado where updated_at < now() - interval '180 days';

  return jsonb_build_object('articulos', (select count(*) from _margenes_hoy),
                            'por_debajo', (select count(*) from _margenes_hoy where bajo),
                            'nuevos', v_nuevos, 'caducados', v_cad, 'solo_estado', p_solo_estado);
end;
$$;
revoke all on function public.margenes_generar_avisos(date, boolean) from public, anon, authenticated;
grant execute on function public.margenes_generar_avisos(date, boolean) to service_role;

-- ─── Texto sencillo del aviso de subida de precio ───────────────────────────
-- Recibe los datos de la alerta (facturas_alertas_candidatas + impacto_mes) y
-- devuelve {titulo, mensaje, datos} con datos = {texto_telegram, compra_anterior, usos_carta}.
create or replace function public.facturas_alerta_subida_texto(p jsonb)
returns jsonb
language plpgsql
stable
set search_path = public
as $$
-- 20261125110000_avisos_margen_bajo
declare
  v_nombre  text;
  v_prov    text := coalesce(p ->> 'proveedor', 'su proveedor');
  v_med     text := coalesce(p ->> 'medida', 'ud');
  v_uni     text := lower(coalesce(p ->> 'unidad', 'ud'));
  v_precio  numeric := (p ->> 'precio')::numeric;
  v_ref     numeric := (p ->> 'precio_ref')::numeric;
  v_fecha   date := (p ->> 'fecha')::date;
  v_var     numeric := (p ->> 'variacion_pct')::numeric;
  v_imp     numeric := (p ->> 'impacto_mes')::numeric;
  v_n_ref   int := coalesce((p ->> 'compras_ref')::int, 0);
  v_factor  numeric;
  v_ant     record;
  v_ant_p   numeric;
  v_usos    text[];
  v_n_usos  int;
  v_lista   text;
  v_unidad  text;
  v_msg     text;
  v_tg      text;
begin
  if v_precio is null or v_ref is null or v_fecha is null then
    return null;
  end if;
  select pc.nombre::text into v_nombre from productos_catalogo pc where pc.id = (p ->> 'producto_id')::bigint;
  v_nombre := coalesce(v_nombre, initcap(p ->> 'producto'), 'El producto');
  v_unidad := case v_med when 'kg' then '€/kg' when 'l' then '€/l' else '€/' || v_med end;
  v_factor := case when v_med = v_uni then 1
                   when (p ->> 'precio_ud')::numeric > 0 and v_precio > 0 then (p ->> 'precio_ud')::numeric / v_precio end;

  -- La compra anterior a esta (mismo proveedor y producto).
  select fa.id, fa.fecha, pf.precio_unitario, lower(coalesce(nullif(btrim(pf.unidad::text), ''), 'ud')) as uni
    into v_ant
    from productos_factura pf
    join facturas fa on fa.id = pf.factura_id
   where fa.proveedor_id = (p ->> 'proveedor_id')::bigint
     and coalesce(nullif(pf.nombre_normalizado::text, ''), lower(pf.nombre::text)) = p ->> 'nombre_normalizado'
     and fa.id <> (p ->> 'factura_id')::bigint
     and fa.fecha <= v_fecha
     and not (fa.tipo = 'albaran' and fa.facturado_en_id is not null)
     and fa.total > 0 and pf.precio_unitario > 0 and pf.cantidad > 0
   order by fa.fecha desc, fa.id desc
   limit 1;
  if v_ant.id is not null and v_ant.uni = v_uni and v_factor > 0 then
    v_ant_p := v_ant.precio_unitario / v_factor;
  end if;

  -- Qué platos y vinos de la carta usan ese producto.
  select array_agg(x.nombre order by x.nombre), count(*)
    into v_usos, v_n_usos
    from (select distinct p2.nombre::text as nombre
            from escandallo_platos e join "Platos" p2 on p2.id = e.plato_id
           where e.producto_id = (p ->> 'producto_id')::bigint and p2.activado and p2.restaurante
          union
          select distinct v.nombre::text
            from vino_producto vp join "Vinos" v on v.id = vp.vino_id
           where vp.producto_id = (p ->> 'producto_id')::bigint and v.activado and v.restaurante) x;
  if coalesce(v_n_usos, 0) > 0 then
    v_lista := array_to_string(v_usos[1:4], ', ')
               || case when v_n_usos > 4 then format(' y %s más', v_n_usos - 4) else '' end;
  end if;

  v_msg := format('%s de %s ha subido un %s %%: en la factura del %s lo pagas a %s %s y antes te costaba %s %s',
                  v_nombre, v_prov, facturas_alertas_num(v_var, 0), to_char(v_fecha, 'DD/MM'),
                  facturas_alertas_num(v_precio, 2), v_unidad, facturas_alertas_num(v_ref, 2), v_unidad)
           || case when v_n_ref > 0 then format(' (lo normal en tus %s compras anteriores', v_n_ref)
                     || case when v_ant.id is not null
                             then format('; la última, el %s%s', to_char(v_ant.fecha, 'DD/MM'),
                                         case when v_ant_p is not null then format(', a %s %s', facturas_alertas_num(v_ant_p, 2), v_unidad) else '' end)
                             else '' end || ')'
                   else '' end || '.'
           || case when v_imp >= 1 then format(' Con lo que compras, son unos %s € más al mes.', facturas_alertas_num(v_imp, 0)) else '' end
           || case when v_lista is not null then format(' Lo usa la carta en: %s.', v_lista) else '' end
           || ' Precios sin IVA.';
  v_tg := format('%s (%s) ha subido un %s %%: %s %s en la factura del %s, antes %s %s.',
                 v_nombre, v_prov, facturas_alertas_num(v_var, 0), facturas_alertas_num(v_precio, 2), v_unidad,
                 to_char(v_fecha, 'DD/MM'), facturas_alertas_num(v_ref, 2), v_unidad)
          || case when v_lista is not null then format(' Lo usan: %s.', v_lista) else '' end;

  return jsonb_build_object(
    'titulo', left(format('%s sube un %s %% en %s', v_nombre, facturas_alertas_num(v_var, 0), v_prov), 120),
    'mensaje', v_msg,
    'datos', jsonb_build_object(
      'texto_telegram', v_tg,
      'compra_anterior', case when v_ant.id is not null then jsonb_build_object(
          'factura_id', v_ant.id, 'fecha', v_ant.fecha, 'precio', round(v_ant_p, 4)) end,
      'usos_carta', to_jsonb(coalesce(v_usos, '{}'::text[]))));
end;
$$;
revoke all on function public.facturas_alerta_subida_texto(jsonb) from public, anon, authenticated;
grant execute on function public.facturas_alerta_subida_texto(jsonb) to service_role;

-- ─── Cron diario: textos nuevos + aviso de margen bajo ──────────────────────
CREATE OR REPLACE FUNCTION public.facturas_generar_alertas(p_hoy date DEFAULT CURRENT_DATE)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
-- 20261107300000_facturas_alertas · 20261115100000_facturas_decision (impacto, campana,
-- proveedor, bajadas, pactados, silencios) · 20261125110000_avisos_margen_bajo (texto de
-- las subidas y aviso de margen bajo)
declare
  u         jsonb := public.facturas_alertas_umbrales();
  v_hoy     date := coalesce(p_hoy, current_date);
  v_min     numeric := (u ->> 'campana_impacto_min_eur')::numeric;
  v_prov_n  int := (u ->> 'proveedor_subidas_min')::int;
  v_prov_d  int := (u ->> 'proveedor_dias')::int;
  v_tipos   text[] := array['facturas_precio_sube', 'facturas_precio_mejor', 'facturas_familia_gasto',
                            'facturas_albaran_sin_factura', 'facturas_proveedor_nuevo', 'facturas_importe_inusual',
                            'facturas_revision', 'facturas_precio_baja', 'facturas_precio_proveedor',
                            'facturas_precio_pactado'];
  v_nuevas  int;
  v_act     int;
  v_cad     int;
  v_borr    int;
  v_sil     int;
  v_total   int;
  v_por     jsonb;
  v_margen  jsonb;
begin
  create temp table if not exists _alertas_hoy (
    tipo text, prioridad text, titulo text, mensaje text, clave text, caduca_en timestamptz, datos jsonb
  ) on commit drop;
  truncate _alertas_hoy;
  insert into _alertas_hoy select * from public.facturas_alertas_candidatas(v_hoy);
  insert into _alertas_hoy select * from public.facturas_alertas_candidatas_extra(v_hoy);
  -- Una clave, una fila (por si dos reglas dieran la misma).
  delete from _alertas_hoy a using _alertas_hoy b where a.clave = b.clave and a.ctid > b.ctid;

  -- € al mes que cuesta la subida: (precio − ref) / precio × lo comprado en 90 días / 3.
  update _alertas_hoy a
     set datos = a.datos || jsonb_build_object('impacto_mes',
           round(((a.datos ->> 'precio')::numeric - (a.datos ->> 'precio_ref')::numeric)
                 / nullif((a.datos ->> 'precio')::numeric, 0)
                 * coalesce((a.datos ->> 'importe_90')::numeric, 0) / 3, 2))
   where a.tipo = 'facturas_precio_sube';

  -- 20261125110000: texto sencillo de las subidas (cuánto, en qué factura, frente a qué
  -- compras y qué platos o vinos lo usan) + datos.texto_telegram. No cambia cuándo saltan.
  update _alertas_hoy a
     set titulo = s.t ->> 'titulo', mensaje = s.t ->> 'mensaje', datos = a.datos || (s.t -> 'datos')
    from (select x.clave, public.facturas_alerta_subida_texto(x.datos) as t
            from _alertas_hoy x where x.tipo = 'facturas_precio_sube') s
   where a.clave = s.clave and s.t is not null;

  -- Silencios: «Visto» (esa clave) y «Es normal» (ese tipo y objeto hasta su fecha).
  delete from _alertas_hoy a
   where exists (select 1 from facturas_alertas_silencios s
                  where (s.clave is not null and s.clave = a.clave)
                     or (s.objeto is not null and s.tipo = a.tipo
                         and s.objeto = public.facturas_alerta_objeto(a.tipo, a.datos)
                         and (s.hasta is null or s.hasta >= v_hoy)));
  get diagnostics v_sil = row_count;

  -- Un proveedor que sube varias cosas a la vez: un solo aviso.
  insert into _alertas_hoy
  select 'facturas_precio_proveedor',
         case when g.impacto >= v_min * 3 then 'alta' else 'normal' end,
         left(format('%s ha subido %s %s esta semana (+%s %% de media)', g.proveedor, g.n,
                     case when g.n_fam = 1 and g.familia is not null then lower(g.familia) else 'productos' end,
                     facturas_alertas_num(g.media, 0)), 120),
         format('%s: %s. Te cuestan unos %s € más al mes con lo que compras. Precios sin IVA.',
                g.proveedor, g.lista, facturas_alertas_num(g.impacto, 0)),
         format('precio_proveedor:%s:%s', g.proveedor_id, g.semana),
         (v_hoy + 30)::timestamptz,
         jsonb_build_object(
           'enlace', '?tab=compras&modo=proveedores&prov=' || g.proveedor_id,
           'proveedor_id', g.proveedor_id, 'proveedor', g.proveedor, 'local', g.loc,
           'desde', g.desde, 'hasta', g.hasta, 'mes', to_char(g.hasta, 'YYYY-MM'),
           'familia_id', case when g.n_fam = 1 then g.fam end, 'familia', case when g.n_fam = 1 then g.familia end,
           'productos', g.n, 'variacion_pct', round(g.media, 1), 'impacto_mes', round(g.impacto, 2),
           'claves', g.claves, 'factura_id', g.factura_id)
    from (
      select (a.datos ->> 'proveedor_id')::bigint as proveedor_id,
             max(a.datos ->> 'proveedor') as proveedor,
             case when count(distinct a.datos ->> 'local') = 1 then max(a.datos ->> 'local') end as loc,
             count(*) as n,
             count(distinct a.datos ->> 'familia_id') as n_fam,
             max((a.datos ->> 'familia_id')::bigint) as fam,
             max(cp.nombre::text) as familia,
             avg((a.datos ->> 'variacion_pct')::numeric) as media,
             sum(greatest(coalesce((a.datos ->> 'impacto_mes')::numeric, 0), 0)) as impacto,
             min((a.datos ->> 'fecha')::date) as desde, max((a.datos ->> 'fecha')::date) as hasta,
             to_char(max((a.datos ->> 'fecha')::date), 'IYYY-IW') as semana,
             max((a.datos ->> 'factura_id')::bigint) as factura_id,
             string_agg(format('%s +%s %%', a.datos ->> 'producto', facturas_alertas_num((a.datos ->> 'variacion_pct')::numeric, 0)),
                        ', ' order by (a.datos ->> 'variacion_pct')::numeric desc) as lista,
             jsonb_agg(a.clave) as claves
        from _alertas_hoy a
        left join categorias_producto cp on cp.id = (a.datos ->> 'familia_id')::bigint
       where a.tipo = 'facturas_precio_sube'
         and (a.datos ->> 'fecha')::date > v_hoy - v_prov_d
         and a.datos ->> 'proveedor_id' is not null
       group by 1
      having count(*) >= v_prov_n) g
   where not exists (select 1 from facturas_alertas_silencios s
                      where s.tipo = 'facturas_precio_proveedor' and s.objeto = 'prov:' || g.proveedor_id
                        and (s.hasta is null or s.hasta >= v_hoy))
     and not exists (select 1 from facturas_alertas_silencios s
                      where s.clave = format('precio_proveedor:%s:%s', g.proveedor_id, g.semana));

  -- A la campana, solo lo que pesa: las subidas agrupadas por proveedor van en su aviso,
  -- y las subidas o bajadas de menos de campana_impacto_min_eur al mes se quedan en Análisis.
  update _alertas_hoy a
     set datos = a.datos || jsonb_build_object('campana', false, 'agrupada', true)
   where a.tipo = 'facturas_precio_sube'
     and exists (select 1 from _alertas_hoy g where g.tipo = 'facturas_precio_proveedor' and g.datos -> 'claves' ? a.clave);
  update _alertas_hoy a
     set datos = a.datos || jsonb_build_object('campana', false)
   where a.tipo in ('facturas_precio_sube', 'facturas_precio_baja')
     and coalesce((a.datos ->> 'impacto_mes')::numeric, 0) < v_min
     and not (a.datos ? 'campana');
  -- 20261121100000: «proveedor nuevo» no suena en la campana (petición del dueño, 09/11/2026);
  -- sigue en Análisis › Por revisar.
  update _alertas_hoy a
     set datos = a.datos || jsonb_build_object('campana', false)
   where a.tipo = 'facturas_proveedor_nuevo'
     and not (a.datos ? 'campana');
  update _alertas_hoy a
     set datos = a.datos || jsonb_build_object('campana', true)
   where not (a.datos ? 'campana');

  -- Lo que sigue vigente: texto y cifras al día; «leída» no se toca (salvo que deje de ir
  -- a la campana: entonces queda leída, para que no cuente en el número rojo).
  update notificaciones_dashboard n
     set titulo = a.titulo, mensaje = a.mensaje, prioridad = a.prioridad, datos = a.datos, caduca_en = a.caduca_en,
         leida = n.leida or (a.datos ->> 'campana') = 'false'
    from _alertas_hoy a
   where n.clave = a.clave
     and (n.titulo, n.mensaje, n.prioridad, n.datos, n.caduca_en, n.leida or (a.datos ->> 'campana') = 'false')
         is distinct from (a.titulo, a.mensaje, a.prioridad, a.datos, a.caduca_en, n.leida);
  get diagnostics v_act = row_count;

  -- Las que no van a la campana entran ya leídas (no suman en el número rojo).
  insert into notificaciones_dashboard (tipo, titulo, mensaje, referencia_tipo, prioridad, clave, caduca_en, datos, leida)
  select a.tipo, a.titulo, a.mensaje, 'facturas_alerta', a.prioridad, a.clave, a.caduca_en, a.datos,
         (a.datos ->> 'campana') = 'false'
    from _alertas_hoy a
   where not exists (select 1 from notificaciones_dashboard n where n.clave = a.clave)
  on conflict (clave) where clave is not null do nothing;
  get diagnostics v_nuevas = row_count;

  -- Lo que ya no se cumple (o se ha silenciado) caduca ya, y queda leído.
  update notificaciones_dashboard n
     set caduca_en = now(), leida = true
   where n.tipo = any(v_tipos) and n.clave is not null
     and (n.caduca_en is null or n.caduca_en > now())
     and not exists (select 1 from _alertas_hoy a where a.clave = n.clave);
  get diagnostics v_cad = row_count;
  update notificaciones_dashboard n
     set leida = true
   where n.tipo = any(v_tipos) and n.caduca_en <= now() and not n.leida;

  delete from notificaciones_dashboard n
   where n.tipo = any(v_tipos) and n.caduca_en < now() - interval '90 days';
  get diagnostics v_borr = row_count;
  -- Los «Es normal» vencidos ya no sirven.
  delete from facturas_alertas_silencios s where s.hasta is not null and s.hasta < v_hoy - 30;

  select coalesce(jsonb_object_agg(t.tipo, t.n), '{}'::jsonb)
    into v_por
    from (select a.tipo, count(*) as n from _alertas_hoy a group by a.tipo) t;
  v_total := (select count(*) from _alertas_hoy);

  -- 20261125110000: aviso de margen bajo (solo al cruzar el límite). Un fallo aquí no
  -- deshace las alertas de Facturas.
  begin
    v_margen := public.margenes_generar_avisos(v_hoy);
  exception when others then
    v_margen := jsonb_build_object('error', sqlerrm);
    raise warning 'facturas_generar_alertas: margenes_generar_avisos falló: %', sqlerrm;
  end;

  return jsonb_build_object('vigentes', v_total, 'nuevas', v_nuevas, 'actualizadas', v_act,
                            'caducadas', v_cad, 'borradas', v_borr, 'silenciadas', v_sil,
                            'campana', (select count(*) from _alertas_hoy a where a.datos ->> 'campana' = 'true'),
                            'por_tipo', v_por, 'margenes', v_margen);
end;
$function$;
revoke all on function public.facturas_generar_alertas(date) from public, anon, authenticated;
grant execute on function public.facturas_generar_alertas(date) to service_role;

-- ─── Estado inicial, sin avisar ─────────────────────────────────────────────
select public.margenes_generar_avisos(current_date, true);
