set client_encoding = 'UTF8';
-- ============================================================================
-- 20261106300000_facturas_retencion_irpf — Retención de IRPF visible (06/11/2026)
-- ----------------------------------------------------------------------------
-- Decisión del dueño: «en las que haya retención, que se muestre también la
-- retención». Hasta ahora `facturas.total` ya era lo que se paga al proveedor
-- (base + IVA − IRPF) pero la retención no se guardaba: los alquileres de local,
-- la gestoría o el notario salían con aviso `iva_incoherente`.
--
--   1. facturas.retencion_irpf (importe, MISMO SIGNO que la base: positivo en
--      una factura, negativo en un abono; NULL = sin retención, nunca 0) y
--      facturas.retencion_irpf_pct (porcentaje positivo, NULL si no se sabe).
--      Invariante: total = subtotal + iva − retencion_irpf.
--   2. validar_cordura_factura: el cuadre base + IVA = total resta la retención.
--   3. documento_compras (ficha de Compras): devuelve los dos campos.
--   4. Chatbot: documento_compacto_agente lleva retencion_irpf (y el % en el
--      detalle); detalle_documento_agente lo explica en la nota.
--   5. ocr_sustituir_factura / ocr_anadir_pagina guardan la retención que manda
--      procesar-factura en p_cabecera (claves retencion_irpf, retencion_irpf_pct).
--
-- Los datos del histórico se rellenan aparte (no es una migración):
--   supabase/snippets/2026-11-06_retencion_irpf_historico.sql
-- Orden: esta migración ANTES de desplegar procesar-factura e
-- importar-factura-historica (insertan las columnas nuevas).
-- Test: supabase/tests/facturas_retencion_irpf_test.sql
-- Deshacer: supabase/rollbacks/20261106300000_facturas_retencion_irpf_ROLLBACK.sql
-- ============================================================================

alter table public.facturas
  add column if not exists retencion_irpf numeric(12,2),
  add column if not exists retencion_irpf_pct numeric(5,2);

alter table public.facturas drop constraint if exists facturas_retencion_irpf_no_cero;
alter table public.facturas
  add constraint facturas_retencion_irpf_no_cero check (retencion_irpf is null or retencion_irpf <> 0);
alter table public.facturas drop constraint if exists facturas_retencion_irpf_pct_rango;
alter table public.facturas
  add constraint facturas_retencion_irpf_pct_rango
  check (retencion_irpf_pct is null or (retencion_irpf_pct > 0 and retencion_irpf_pct <= 50));

comment on column public.facturas.retencion_irpf is
  'Retención de IRPF impresa (alquileres, gestoría, profesionales). Mismo signo que la base (negativa en un abono); '
  'NULL = sin retención. total = subtotal + iva − retencion_irpf (lo que se paga al proveedor). 20261106300000.';
comment on column public.facturas.retencion_irpf_pct is
  'Porcentaje de la retención de IRPF (19, 15, 7, 1…); NULL si no hay retención o no se sabe. 20261106300000.';

CREATE OR REPLACE FUNCTION public.validar_cordura_factura(p_factura_id bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
-- 20261106300000_facturas_retencion_irpf: el cuadre base + IVA = total resta la retención IRPF.
declare
  f              record;
  alertas        jsonb := '[]'::jsonb;
  v_suma         numeric;
  v_ref          numeric;
  v_tol          numeric;
  v_n_lineas     integer;
  v_n_con_total  integer;
  v_n_con_precio integer;
  v_n_cero       integer;
  v_n_sin_total  integer;
  v_sin_importes boolean;
  r              record;
  v_cif_doc      text;
  v_cif_ficha    text;
begin
  select * into f from facturas where id = p_factura_id;
  if not found then
    return '[]'::jsonb;
  end if;

  select count(*),
         count(*) filter (where pf.total is not null),
         count(*) filter (where pf.precio_unitario is not null and pf.precio_unitario <> 0),
         count(*) filter (where pf.total = 0),
         count(*) filter (where pf.total is null),
         sum(pf.total)
    into v_n_lineas, v_n_con_total, v_n_con_precio, v_n_cero, v_n_sin_total, v_suma
  from productos_factura pf
  where pf.factura_id = p_factura_id;

  -- Albaran de entrega sin precios (Joselito): hay lineas, pero ni una lleva
  -- precio o total, y la cabecera tampoco tiene importes. Es correcto.
  v_sin_importes := v_n_lineas > 0
                    and v_n_con_total = 0
                    and v_n_con_precio = 0
                    and f.subtotal is null
                    and f.iva is null
                    and f.total is null;

  ---------------------------------------------------------------------------
  -- 0) NUEVO · Importes de cabecera que faltan.
  ---------------------------------------------------------------------------
  if f.total is null and not v_sin_importes then
    alertas := alertas || jsonb_build_object(
      'codigo',    'total_ausente',
      'severidad', 'alta',
      'mensaje',   case
                     when v_n_lineas = 0 then
                       'El documento no tiene total ni ninguna linea: no hay ningun importe que se pueda usar. Vuelve a subirlo o completa los datos en "Editar".'
                     else
                       format('El documento no tiene total guardado%s, aunque sus %s lineas suman %s €. Sin total no se puede comprobar que la lectura este completa: mira el original y completa los importes en "Editar".',
                              case when f.subtotal is null then ' (ni base imponible)' else '' end,
                              v_n_lineas, coalesce(round(v_suma, 2), 0))
                   end,
      'detalle',   jsonb_build_object('subtotal', f.subtotal, 'iva', f.iva, 'total', f.total,
                                      'suma_lineas', round(v_suma, 2), 'num_lineas', v_n_lineas)
    );
  elsif f.subtotal is null and v_n_con_total > 0 then
    alertas := alertas || jsonb_build_object(
      'codigo',    'subtotal_ausente',
      'severidad', 'media',
      'mensaje',   format('El documento tiene total (%s €) pero no base imponible, asi que las lineas (que suman %s €) solo se pueden cuadrar contra el total con IVA. Comprueba la base en el original.',
                          f.total, round(v_suma, 2)),
      'detalle',   jsonb_build_object('subtotal', f.subtotal, 'iva', f.iva, 'total', f.total,
                                      'suma_lineas', round(v_suma, 2), 'num_lineas', v_n_lineas)
    );
  end if;

  ---------------------------------------------------------------------------
  -- 1) Descuadre de linea: precio_unitario x cantidad frente al total.
  --
  --    OJO CON LOS FALSOS POSITIVOS: casi todos los proveedores aplican
  --    descuento por linea, asi que `total` < `precio x cantidad` es la norma,
  --    no la excepcion. Verificado con los datos reales: las facturas 35 y 37
  --    llevan un 15 % de descuento en casi todas sus lineas. Una regla de
  --    "difiere mas de un 2 %" marcaria 10 lineas legitimas y el aviso se
  --    volveria ruido que nadie mira.
  --
  --    Por eso se usa la RAZON y no la diferencia, y solo se avisa de lo que un
  --    descuento no puede explicar:
  --      > 1.02  -> cobran MAS de lo que suman las unidades (imposible)
  --      < 0.40  -> mas de un 60 % de descuento, o un x10 de decimales
  --    Las lineas a 0 € (bonificadas) se saltan aqui: su descuadre es el
  --    comportamiento correcto. Siguen contando en el bloque 2.
  ---------------------------------------------------------------------------
  for r in
    select pf.nombre, pf.cantidad, pf.precio_unitario, pf.total,
           round((pf.precio_unitario * pf.cantidad)::numeric, 2) as esperado,
           round((pf.total / (pf.precio_unitario * pf.cantidad))::numeric, 3) as razon
    from productos_factura pf
    where pf.factura_id = p_factura_id
      and pf.precio_unitario > 0
      and pf.cantidad > 0
      and pf.total > 0
      and abs(pf.precio_unitario * pf.cantidad - pf.total) > 0.05
      and (pf.total / (pf.precio_unitario * pf.cantidad) > 1.02
        or pf.total / (pf.precio_unitario * pf.cantidad) < 0.40)
    order by abs(pf.precio_unitario * pf.cantidad - pf.total) desc
    limit 5
  loop
    alertas := alertas || jsonb_build_object(
      'codigo',    'descuadre_linea',
      'severidad', 'media',
      'mensaje',   format('La linea "%s" no cuadra: %s x %s = %s, pero el total leido es %s. La diferencia no se explica por un descuento normal.',
                          left(r.nombre, 60), r.precio_unitario, r.cantidad, r.esperado, r.total),
      'detalle',   jsonb_build_object('producto', r.nombre, 'cantidad', r.cantidad,
                                      'precio_unitario', r.precio_unitario,
                                      'total_leido', r.total, 'total_esperado', r.esperado,
                                      'razon', r.razon)
    );
  end loop;

  ---------------------------------------------------------------------------
  -- 2) Descuadre de cabecera: suma de lineas frente a subtotal (o total).
  --    Se compara contra `subtotal` cuando existe, porque las lineas suelen ir
  --    sin el IVA prorrateado. Tolerancia = `toleranciaCabecera()` de
  --    procesar-factura/esquema.ts: 0,5 % con suelo de 0,50 € y techo de 15 €
  --    (suelo bajado de 2 € en 20261010160000_ocr_calidad_extraccion: el
  --    embalaje de 1,82, los portes de 1,60 y la RGA de 1,97 pasaban sin aviso).
  --    Las lineas a 0 € suman 0 (no se excluyen); las de total NULL no
  --    suman, y si eso abre un hueco, este bloque lo ve.
  ---------------------------------------------------------------------------
  v_ref := coalesce(f.subtotal, f.total);
  if v_suma is not null and v_ref is not null and v_ref <> 0 then
    v_tol := least(15.00, greatest(0.50, abs(v_ref) * 0.005));
    if abs(v_suma - v_ref) > v_tol then
      alertas := alertas || jsonb_build_object(
        'codigo',    'descuadre_cabecera',
        'severidad', 'media',
        'mensaje',   format('Las lineas suman %s pero el documento declara %s (%s %s €, tolerancia %s €). Revisa si falta alguna linea o si el OCR ha leido mal un importe.%s',
                            round(v_suma, 2), round(v_ref, 2),
                            case when v_suma < v_ref then 'faltan' else 'sobran' end,
                            round(abs(v_suma - v_ref), 2), round(v_tol, 2),
                            case
                              when v_n_cero > 0 and v_n_sin_total > 0 then
                                format(' Hay %s linea(s) a 0 € y %s sin importe: si alguna no es una bonificacion, puede ser lo que falta.', v_n_cero, v_n_sin_total)
                              when v_n_cero > 0 then
                                format(' Hay %s linea(s) a 0 €: si alguna no es una bonificacion, puede ser lo que falta.', v_n_cero)
                              when v_n_sin_total > 0 then
                                format(' Hay %s linea(s) sin importe.', v_n_sin_total)
                              else ''
                            end),
        'detalle',   jsonb_build_object('suma_lineas', round(v_suma, 2),
                                        'referencia', round(v_ref, 2),
                                        'campo_referencia', case when f.subtotal is not null then 'subtotal' else 'total' end,
                                        'diferencia', round(v_suma - v_ref, 2),
                                        'tolerancia', round(v_tol, 2),
                                        'num_lineas', v_n_lineas,
                                        'lineas_total_cero', v_n_cero,
                                        'lineas_sin_total', v_n_sin_total)
      );
    end if;
  end if;

  ---------------------------------------------------------------------------
  -- 3) IVA incoherente: subtotal + iva frente al total.
  --    Tolerancia del validador TS: un centimo por linea (el redondeo que de
  --    verdad se acumula), con suelo de 5 centimos.
  ---------------------------------------------------------------------------
  if f.subtotal is not null and f.iva is not null and f.total is not null then
    v_tol := greatest(0.05, greatest(v_n_lineas, 1) * 0.01);
    if abs((f.subtotal + f.iva - coalesce(f.retencion_irpf, 0)) - f.total) > v_tol then
      alertas := alertas || jsonb_build_object(
        'codigo',    'iva_incoherente',
        'severidad', 'media',
        'mensaje',   format('Subtotal (%s) + IVA (%s)%s = %s, que no coincide con el total leido (%s).',
                            f.subtotal, f.iva,
                            case when f.retencion_irpf is not null then format(' - retencion IRPF (%s)', f.retencion_irpf) else '' end,
                            round(f.subtotal + f.iva - coalesce(f.retencion_irpf, 0), 2), f.total),
        'detalle',   jsonb_build_object('subtotal', f.subtotal, 'iva', f.iva, 'total', f.total,
                                        'retencion_irpf', f.retencion_irpf,
                                        'esperado', round(f.subtotal + f.iva - coalesce(f.retencion_irpf, 0), 2),
                                        'diferencia', round((f.subtotal + f.iva - coalesce(f.retencion_irpf, 0)) - f.total, 2),
                                        'tolerancia', round(v_tol, 2))
      );
    end if;
  end if;

  ---------------------------------------------------------------------------
  -- 4) Precio unitario extremo en terminos absolutos.
  --    Es la red que atrapa el caso Joselito: producto NUEVO, sin historico con
  --    el que comparar, a 9.316,67 €/ud.
  ---------------------------------------------------------------------------
  for r in
    select pf.nombre, pf.precio_unitario, pf.cantidad, pf.unidad
    from productos_factura pf
    where pf.factura_id = p_factura_id
      and pf.precio_unitario is not null
      and pf.precio_unitario > 1000
    order by pf.precio_unitario desc
    limit 5
  loop
    alertas := alertas || jsonb_build_object(
      'codigo',    'precio_unitario_extremo',
      'severidad', 'alta',
      'mensaje',   format('Precio unitario muy alto: "%s" a %s €/%s. Comprueba que el OCR no haya desplazado los decimales.',
                          left(r.nombre, 60), r.precio_unitario, coalesce(r.unidad, 'ud')),
      'detalle',   jsonb_build_object('producto', r.nombre, 'precio_unitario', r.precio_unitario,
                                      'cantidad', r.cantidad, 'umbral', 1000)
    );
  end loop;

  ---------------------------------------------------------------------------
  -- 5) Total del documento desproporcionado (demasiado GRANDE).
  ---------------------------------------------------------------------------
  if f.total is not null and f.total > 25000 then
    alertas := alertas || jsonb_build_object(
      'codigo',    'total_documento_extremo',
      'severidad', 'alta',
      'mensaje',   format('El documento suma %s €, muy por encima de lo habitual. Revisa los importes antes de darlo por bueno.', f.total),
      'detalle',   jsonb_build_object('total', f.total, 'umbral', 25000)
    );
  end if;

  ---------------------------------------------------------------------------
  -- 5b) Total del documento sospechosamente PEQUEÑO. Se excluye el 0 exacto:
  --     un documento enteramente bonificado declara total 0 de forma legitima.
  ---------------------------------------------------------------------------
  if f.total is not null and f.total > 0 and f.total < 3 then
    alertas := alertas || jsonb_build_object(
      'codigo',    'total_documento_irrisorio',
      'severidad', 'alta',
      'mensaje',   format('El documento suma solo %s €, muy por debajo de lo habitual para un proveedor. Comprueba que el OCR no haya desplazado los decimales o perdido una cifra (p. ej. un importe real de %s € leido como %s €).', f.total, f.total * 1000, f.total),
      'detalle',   jsonb_build_object('total', f.total, 'umbral', 3)
    );
  end if;

  ---------------------------------------------------------------------------
  -- 6) Precio atipico frente al historico del MISMO producto en OTROS
  --    documentos. Exige al menos 2 observaciones previas para no disparar por
  --    una sola compra anterior. Simetrico (barato Y caro).
  ---------------------------------------------------------------------------
  for r in
    select pf.nombre, pf.precio_unitario, h.media, h.n
    from productos_factura pf
    join lateral (
      select avg(pf2.precio_unitario) as media, count(*) as n
      from productos_factura pf2
      where pf2.factura_id <> p_factura_id
        and pf2.precio_unitario is not null
        and pf2.precio_unitario > 0
        and pf2.nombre_normalizado = pf.nombre_normalizado
    ) h on true
    where pf.factura_id = p_factura_id
      and pf.precio_unitario is not null
      and pf.precio_unitario > 0
      and h.n >= 2
      and (pf.precio_unitario >= h.media * 5 or pf.precio_unitario <= h.media / 5)
    order by abs(pf.precio_unitario - h.media) desc
    limit 5
  loop
    alertas := alertas || jsonb_build_object(
      'codigo',    'precio_atipico_historico',
      'severidad', 'alta',
      'mensaje',   format('"%s" a %s €, cuando el precio medio historico de este producto es %s € (%s compras previas).',
                          left(r.nombre, 60), r.precio_unitario, round(r.media, 4), r.n),
      'detalle',   jsonb_build_object('producto', r.nombre, 'precio_unitario', r.precio_unitario,
                                      'precio_medio_historico', round(r.media, 4), 'observaciones', r.n)
    );
  end loop;

  ---------------------------------------------------------------------------
  -- 20261010160000_ocr_calidad_extraccion: CIF del documento que no supera
  -- el dígito de control. Si la ficha del proveedor tiene uno válido a ≤ 2
  -- caracteres, se dice cuál se ha usado; si no, que hay que mirarlo.
  ---------------------------------------------------------------------------
  v_cif_doc := normalizar_cif(f.cif);
  if v_cif_doc is not null and not cif_control_valido(v_cif_doc) then
    select p.cif_normalizado into v_cif_ficha from proveedores p where p.id = f.proveedor_id;
    if v_cif_ficha is not null and cif_control_valido(v_cif_ficha)
       and cif_distancia(v_cif_ficha, v_cif_doc) <= 2 then
      alertas := alertas || jsonb_build_object(
        'codigo',    'cif_corregido',
        'severidad', 'media',
        'mensaje',   format('CIF leído %s, corregido a %s: el leído no supera el dígito de control y el de la ficha del proveedor sí.',
                            v_cif_doc, v_cif_ficha),
        'detalle',   jsonb_build_object('cif_leido', v_cif_doc, 'cif_ficha', v_cif_ficha, 'proveedor_id', f.proveedor_id));
    else
      alertas := alertas || jsonb_build_object(
        'codigo',    'cif_invalido',
        'severidad', 'media',
        'mensaje',   format('El CIF leído %s no supera el dígito de control: compruébalo en el papel (suele ser un dígito mal leído o dos traspuestos).',
                            v_cif_doc),
        'detalle',   jsonb_build_object('cif_leido', v_cif_doc, 'cif_ficha', v_cif_ficha, 'proveedor_id', f.proveedor_id));
    end if;
  end if;

  return alertas;
end;
$function$;

CREATE OR REPLACE FUNCTION public.documento_compras(p_id bigint)
 RETURNS json
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  -- 20261106300000_facturas_retencion_irpf: retencion_irpf y retencion_irpf_pct.
  with doc as (
    select f.id, f.tipo, f.numero_documento, f.proveedor, f.proveedor_normalizado, f.proveedor_id, f.cif, f.fecha,
           f.facturado_en_id, f.local, f.subtotal, f.iva, f.total, f.total_origen, f.observaciones, f.drive_url,
           f.archivo_path, f.alertas_validacion, f.procesado_en, f.created_at, f.verificada, f.verificacion_origen,
           f.retencion_irpf, f.retencion_irpf_pct
      from facturas f
     where f.id = p_id
  ),
  referencia as (
    select pf.nombre_busqueda as nom, sum(pf.precio_unitario) as suma, count(*) as n
      from doc
      join facturas f2 on f2.tipo = doc.tipo and f2.proveedor_normalizado = doc.proveedor_normalizado
      join productos_factura pf on pf.factura_id = f2.id
     where coalesce(doc.proveedor_normalizado, '') <> ''
       and pf.precio_unitario > 0
     group by 1
  ),
  lineas as (
    select pf.id, pf.nombre, pf.precio_unitario, pf.cantidad, pf.unidad, pf.total, pf.bultos,
           pf.descuento_pct, pf.importe_bruto, pf.importe_bruto_estimado, pf.producto_id,
           pc.nombre as canonico, c.nombre as categoria, cp.nombre as categoria_padre,
           pf.nombre_busqueda as nom
      from productos_factura pf
      left join productos_catalogo pc on pc.id = pf.producto_id
      left join categorias_producto c on c.id = pc.categoria_id
      left join categorias_producto cp on cp.id = c.padre_id
     where pf.factura_id = p_id
  )
  select json_build_object(
    'id', d.id, 'tipo', d.tipo, 'numero_documento', d.numero_documento, 'proveedor', d.proveedor,
    'proveedor_normalizado', d.proveedor_normalizado, 'proveedor_id', d.proveedor_id, 'cif', d.cif, 'fecha', d.fecha,
    'facturado_en_id', d.facturado_en_id, 'local', d.local, 'subtotal', d.subtotal, 'iva', d.iva, 'total', d.total,
    'total_origen', d.total_origen, 'observaciones', d.observaciones, 'drive_url', d.drive_url,
    'archivo_path', d.archivo_path, 'alertas_validacion', d.alertas_validacion, 'procesado_en', d.procesado_en,
    'created_at', d.created_at, 'verificada', d.verificada, 'verificacion_origen', d.verificacion_origen,
    'retencion_irpf', d.retencion_irpf, 'retencion_irpf_pct', d.retencion_irpf_pct,
    'productos', coalesce((
      select json_agg(json_build_object(
               'id', l.id, 'nombre', l.nombre, 'precio_unitario', l.precio_unitario, 'cantidad', l.cantidad,
               'unidad', l.unidad, 'total', l.total, 'bultos', l.bultos, 'descuento_pct', l.descuento_pct,
               'importe_bruto', l.importe_bruto, 'importe_bruto_estimado', l.importe_bruto_estimado,
               'producto_id', l.producto_id, 'producto_canonico', l.canonico,
               'categoria', case when l.categoria is null then null else json_build_object(
                 'nombre', l.categoria,
                 'ruta', case when l.categoria_padre is null then l.categoria else l.categoria_padre || ' › ' || l.categoria end) end,
               'media_referencia', case
                 when coalesce(d.proveedor_normalizado, '') = '' or public.es_servicio_compras(l.nom) then null
                 else (r.suma - case when l.precio_unitario > 0 then l.precio_unitario else 0 end)
                      / nullif(r.n - case when l.precio_unitario > 0 then 1 else 0 end, 0)
               end
             ) order by l.id)
        from lineas l
        left join referencia r on r.nom = l.nom
    ), '[]'::json)
  )
  from doc d
$function$;

CREATE OR REPLACE FUNCTION public.documento_compacto_agente(p_doc facturas, p_detalle boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  -- 20261106300000_facturas_retencion_irpf: retencion_irpf (el total ya la descuenta).
  select jsonb_strip_nulls(jsonb_build_object(
    'id',           p_doc.id,
    'tipo',         p_doc.tipo,
    'numero',       p_doc.numero_documento,
    'proveedor',    p_doc.proveedor,
    'fecha',        p_doc.fecha,
    'total',        round(p_doc.total::numeric, 2),
    'sin_total',    case when p_doc.total is null then true end,
    -- Solo si el total NO se leyó del documento (calculado desde las líneas).
    'total_origen', case when p_doc.total_origen = 'deducido' then 'deducido' end,
    'iva_conocido', case when p_doc.total_origen = 'deducido' then p_doc.iva is not null end,
    'fecha_dudosa', case when public.fecha_dudosa_agente(p_doc.alertas_validacion) then true end,
    'alertas',      public.alertas_resumen_agente(p_doc.alertas_validacion),
    'base',         case when p_detalle then round(p_doc.subtotal::numeric, 2) end,
    'iva',          case when p_detalle then round(p_doc.iva::numeric, 2) end,
    'retencion_irpf', round(p_doc.retencion_irpf::numeric, 2),
    'retencion_irpf_pct', case when p_detalle then p_doc.retencion_irpf_pct end,
    'cif',          case when p_detalle then p_doc.cif end,
    'verificada',   case when p_detalle then coalesce(p_doc.verificada, false) end,
    'resumen',      case when p_detalle then left(p_doc.resumen, 300) end
  ))
$function$;

CREATE OR REPLACE FUNCTION public.detalle_documento_agente(p_id bigint DEFAULT NULL::bigint, p_numero text DEFAULT NULL::text)
 RETURNS json
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
-- 20261106300000_facturas_retencion_irpf: la nota explica la retención IRPF del documento.
declare
  v_numero text := nullif(trim(coalesce(p_numero, '')), '');
  v_num    text;
  v_ids    bigint[];
  v_id     bigint;
  v_lineas int;
begin
  if p_id is null and v_numero is null then
    return json_build_object('error', 'Falta el parametro: pasa el id o el numero del documento.');
  end if;

  if p_id is not null then
    v_ids := array(select id from facturas where id = p_id);
  else
    v_num := nullif(regexp_replace(regexp_replace(lower(v_numero), '[^a-z0-9]', '', 'g'), '^0+', ''), '');
    v_ids := array(
      select id from facturas
       where lower(trim(numero_documento)) = lower(v_numero)
          or (v_num is not null
              and regexp_replace(regexp_replace(lower(coalesce(numero_documento, '')), '[^a-z0-9]', '', 'g'), '^0+', '') = v_num)
       order by fecha desc, id desc
       limit 6);
    if cardinality(v_ids) = 0 and v_num is not null and length(v_num) >= 4 then
      v_ids := array(
        select id from facturas
         where regexp_replace(regexp_replace(lower(coalesce(numero_documento, '')), '[^a-z0-9]', '', 'g'), '^0+', '')
               like '%' || v_num || '%'
         order by fecha desc, id desc
         limit 6);
    end if;
  end if;

  if cardinality(v_ids) = 0 then
    return json_build_object('encontrado', false,
      'aviso', 'No existe ningun documento con ese numero o id. No busques ni propongas uno parecido.');
  end if;
  if cardinality(v_ids) > 1 then
    return json_build_object('encontrado', false,
      'aviso', 'Varios documentos coinciden: pregunta cual o vuelve a llamar con su id.',
      'candidatos', (select json_agg(documento_compacto_agente(f) order by f.fecha desc, f.id desc)
                       from facturas f where f.id = any(v_ids)));
  end if;

  v_id := v_ids[1];
  select count(*) into v_lineas from productos_factura where factura_id = v_id;

  return (jsonb_build_object(
    'encontrado', true,
    'documento', (select documento_compacto_agente(f, true) from facturas f where f.id = v_id),
    'lineas', (select coalesce(jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
                         'producto', pf.nombre,
                         'cantidad', pf.cantidad,
                         'unidad',   pf.unidad,
                         'precio',   round(pf.precio_unitario::numeric, case when abs(pf.precio_unitario) < 1 then 4 else 2 end),
                         'importe',  round(pf.total::numeric, 2),
                         'servicio', case when es_linea_servicio_agente(coalesce(pf.nombre_normalizado, pf.nombre)) then true end))
                       order by pf.id), '[]'::jsonb)
                 from (select * from productos_factura where factura_id = v_id order by id limit 40) pf),
    'total_lineas', v_lineas,
    'truncado', v_lineas > 40,
    'suma_lineas', (select round(sum(total)::numeric, 2) from productos_factura where factura_id = v_id),
    -- La nota depende de como se obtuvo el total (prueba del 06/10: q20
    -- llamaba «IVA incluido» a un total deducido sin IVA; q21 afirmaba «sin
    -- IVA» de unas lineas de un documento sin total).
    'nota', (select case
               when f.total is null
                 then 'Sin total leido: suma_lineas es orientativa y no consta si las lineas llevan IVA; no digas con ni sin IVA.'
               when f.total_origen = 'deducido' and f.iva is null
                 then 'Total deducido: calculado sumando las lineas, no leido del documento. Es la base SIN IVA; el total real sera mayor. Nunca digas IVA incluido.'
               when f.total_origen = 'deducido'
                 then 'Total deducido: calculado desde las lineas mas su IVA, no leido del documento; dilo. precio e importe de linea SIN IVA.'
               else 'precio, importe y suma_lineas son de linea, SIN IVA; total del documento con IVA' end
             || case when f.retencion_irpf is not null
                     then format('. Lleva retencion IRPF de %s € (%s %%): total = base + IVA - retencion; es lo que se paga al proveedor (la retencion se ingresa a Hacienda). Dila al dar el total.',
                                 round(f.retencion_irpf, 2), coalesce(f.retencion_irpf_pct::text, '?'))
                     else '' end
               from facturas f where f.id = v_id)))::json;
end;
$function$;

CREATE OR REPLACE FUNCTION public.ocr_sustituir_factura(p_factura_id bigint, p_trabajo_id uuid, p_usuario uuid, p_cabecera jsonb, p_lineas jsonb, p_esperado jsonb, p_archivo_path text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
-- 20261106300000_facturas_retencion_irpf: guarda retencion_irpf y retencion_irpf_pct de la cabecera.
declare
  fa public.facturas%rowtype;
  t  public.ocr_trabajos%rowtype;
  v_lineas_antes integer;
  v_hist_borrado integer;
  v_hist_creado integer;
  v_insertadas integer;
  v_sust_id bigint;
begin
  select * into t from public.ocr_trabajos where id = p_trabajo_id for update;
  if not found then raise exception 'SUSTITUCIÓN ABORTADA: no existe el trabajo %', p_trabajo_id; end if;
  if t.estado <> 'duplicado' then
    raise exception 'SUSTITUCIÓN ABORTADA: el trabajo % está «%», no «duplicado».', p_trabajo_id, t.estado;
  end if;
  if jsonb_typeof(t.documento_pendiente->'pagina') = 'object' then
    raise exception 'SUSTITUCIÓN ABORTADA: el documento nuevo es la página % de % de la factura %: se añade como página, no se sustituye.',
      t.documento_pendiente->'pagina'->>'actual', t.documento_pendiente->'pagina'->>'total', p_factura_id;
  end if;

  select * into fa from public.facturas where id = p_factura_id for update;
  if not found then raise exception 'SUSTITUCIÓN ABORTADA: no existe la factura %', p_factura_id; end if;
  if exists (select 1 from public.ocr_trabajos tx
              where tx.id = fa.ocr_trabajo_id and tx.estado not in ('completado', 'duplicado', 'fallido', 'cancelado')) then
    raise exception 'SUSTITUCIÓN ABORTADA: la factura % aún se está leyendo o guardando. Espera a que termine, revisa y confirma de nuevo.', p_factura_id;
  end if;

  select count(*) into v_lineas_antes from public.productos_factura where factura_id = p_factura_id;
  if v_lineas_antes = 0 then
    raise exception 'SUSTITUCIÓN ABORTADA: la factura % no tiene líneas (puede que aún se esté guardando). Revisa y confirma de nuevo.', p_factura_id;
  end if;
  if p_esperado ? 'lineas' and (p_esperado->>'lineas')::int <> v_lineas_antes then
    raise exception 'SUSTITUCIÓN ABORTADA: la factura % ha cambiado desde que la viste (ahora tiene % líneas; tú viste %). Revisa y confirma de nuevo.',
      p_factura_id, v_lineas_antes, p_esperado->>'lineas';
  end if;
  if p_esperado ? 'updated_at' and p_esperado->>'updated_at' is not null
     and fa.updated_at is distinct from (p_esperado->>'updated_at')::timestamp then
    raise exception 'SUSTITUCIÓN ABORTADA: la factura % ha cambiado desde que la viste. Revisa y confirma de nuevo.', p_factura_id;
  end if;
  if jsonb_typeof(p_lineas) <> 'array' then
    raise exception 'SUSTITUCIÓN ABORTADA: p_lineas no es una lista';
  end if;
  if coalesce(p_cabecera->>'numero_documento', '') = '' then
    raise exception 'SUSTITUCIÓN ABORTADA: la cabecera nueva no trae número de documento';
  end if;

  -- 1. Copia de auditoría (sin embeddings: pesan y se regeneran).
  insert into public.facturas_sustituciones
    (factura_id, trabajo_id, sustituida_por, factura_antes, productos_antes, historial_antes, resumen_antes)
  values (
    p_factura_id, p_trabajo_id, p_usuario,
    to_jsonb(fa) - 'embedding' - 'embedding_observaciones',
    coalesce((select jsonb_agg(to_jsonb(p) - 'embedding' order by p.id)
                from public.productos_factura p where p.factura_id = p_factura_id), '[]'::jsonb),
    coalesce((select jsonb_agg(to_jsonb(h) order by h.created_at, h.id)
                from public.historial_precios h where h.factura_id = p_factura_id), '[]'::jsonb),
    jsonb_build_object('total', fa.total, 'lineas', v_lineas_antes, 'alertas', fa.alertas_validacion,
                       'esperado', p_esperado))
  returning id into v_sust_id;

  -- 2. Historial y líneas viejas.
  delete from public.historial_precios where factura_id = p_factura_id;
  get diagnostics v_hist_borrado = row_count;
  delete from public.productos_factura where factura_id = p_factura_id;

  -- 3. Cabecera nueva, mismo id. (Antes que las líneas: el trigger del
  --    historial lee proveedor y fecha de facturas.)
  update public.facturas
     set tipo = p_cabecera->>'tipo',
         proveedor = p_cabecera->>'proveedor',
         cif = p_cabecera->>'cif',
         numero_documento = p_cabecera->>'numero_documento',
         fecha = (p_cabecera->>'fecha')::date,
         subtotal = (p_cabecera->>'subtotal')::numeric,
         iva = (p_cabecera->>'iva')::numeric,
         total = (p_cabecera->>'total')::numeric,
         total_origen = p_cabecera->>'total_origen',
         retencion_irpf = nullif((p_cabecera->>'retencion_irpf')::numeric, 0),
         retencion_irpf_pct = case when nullif((p_cabecera->>'retencion_irpf')::numeric, 0) is not null
                                   then (p_cabecera->>'retencion_irpf_pct')::numeric end,
         observaciones = p_cabecera->>'observaciones',
         resumen = p_cabecera->>'resumen',
         embedding = case when p_cabecera ? 'embedding' and p_cabecera->>'embedding' is not null
                          then (p_cabecera->>'embedding')::vector else null end,
         alertas_validacion = null,
         verificada = false,
         procesado_en = now(),
         paginas = coalesce((p_cabecera->>'paginas')::smallint, 1),
         ocr_trabajo_id = p_trabajo_id,
         archivo_path = coalesce(p_archivo_path, archivo_path),
         drive_url = case when p_archivo_path is not null then null else drive_url end
   where id = p_factura_id;

  -- 4. Líneas nuevas.
  insert into public.productos_factura
    (factura_id, nombre, cantidad, unidad, precio_unitario, total, embedding, pagina, orden, albaran_ref,
     bultos,                                                     -- 20261005150000
     iva_pct)                                                    -- 20261006105000
  select p_factura_id,
         l->>'nombre',
         coalesce((l->>'cantidad')::numeric, 1),
         coalesce(l->>'unidad', 'unidades'),
         (l->>'precio_unitario')::numeric,
         (l->>'total')::numeric,
         case when l->>'embedding' is not null then (l->>'embedding')::vector end,
         coalesce((l->>'pagina')::smallint, 1),
         coalesce((l->>'orden')::int, (ord - 1)::int),
         nullif(left(l->>'albaran_ref', 100), ''),
         (l->>'bultos')::numeric,                                -- 20261005150000
         (l->>'iva_pct')::numeric                                -- 20261006105000
    from jsonb_array_elements(p_lineas) with ordinality as x(l, ord);
  get diagnostics v_insertadas = row_count;
  select count(*) into v_hist_creado from public.historial_precios where factura_id = p_factura_id;

  -- 5. Trabajo cerrado.
  update public.ocr_trabajos
     set estado = 'completado', factura_id = p_factura_id, terminado_at = now(), documento_pendiente = null
   where id = p_trabajo_id;

  update public.facturas_sustituciones
     set resumen_despues = jsonb_build_object('total', p_cabecera->'total', 'lineas', v_insertadas,
                                              'historial_borrado', v_hist_borrado, 'historial_creado', v_hist_creado)
   where id = v_sust_id;

  return jsonb_build_object('factura_id', p_factura_id, 'sustitucion_id', v_sust_id,
                            'lineas_antes', v_lineas_antes, 'lineas', v_insertadas,
                            'historial_borrado', v_hist_borrado, 'historial_creado', v_hist_creado);
end;
$function$;

CREATE OR REPLACE FUNCTION public.ocr_anadir_pagina(p_factura_id bigint, p_trabajo_id uuid, p_usuario uuid, p_pagina integer, p_paginas_total integer, p_cabecera jsonb, p_lineas jsonb, p_esperado jsonb, p_archivo_path text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
-- 20261106300000_facturas_retencion_irpf: la retención IRPF sigue al pie impreso, como el total.
declare
  fa public.facturas%rowtype;
  t  public.ocr_trabajos%rowtype;
  v_lineas_antes integer;
  v_orden integer;
  v_insertadas integer;
  v_sust_id bigint;
  v_total numeric := (p_cabecera->>'total')::numeric;
  v_origen text := nullif(p_cabecera->>'total_origen', '');
  v_impreso boolean;
  v_existente_impreso boolean;
  v_usar_nuevo boolean;
  v_sumar boolean;
  fb public.facturas%rowtype;
begin
  if p_pagina is null or p_paginas_total is null or p_paginas_total < 2 or p_paginas_total > 20
     or p_pagina < 1 or p_pagina > p_paginas_total then
    raise exception 'AÑADIDO ABORTADO: página % de % no válida', p_pagina, p_paginas_total;
  end if;
  select * into t from public.ocr_trabajos where id = p_trabajo_id for update;
  if not found then raise exception 'AÑADIDO ABORTADO: no existe el trabajo %', p_trabajo_id; end if;
  if t.estado <> 'duplicado' then
    raise exception 'AÑADIDO ABORTADO: ese documento ya no está pendiente (está «%»).', t.estado;
  end if;

  select * into fa from public.facturas where id = p_factura_id for update;
  if not found then raise exception 'AÑADIDO ABORTADO: no existe la factura %', p_factura_id; end if;
  if exists (select 1 from public.ocr_trabajos tx
              where tx.id = fa.ocr_trabajo_id and tx.estado not in ('completado', 'duplicado', 'fallido', 'cancelado')) then
    raise exception 'AÑADIDO ABORTADO: la factura % aún se está leyendo o guardando. Espera a que termine, revisa y confirma de nuevo.', p_factura_id;
  end if;

  select count(*), coalesce(max(orden), -1) into v_lineas_antes, v_orden
    from public.productos_factura where factura_id = p_factura_id;
  if p_esperado ? 'lineas' and (p_esperado->>'lineas')::int <> v_lineas_antes then
    raise exception 'AÑADIDO ABORTADO: la factura % ha cambiado desde que la viste (ahora tiene % líneas; tú viste %). Revisa y confirma de nuevo.',
      p_factura_id, v_lineas_antes, p_esperado->>'lineas';
  end if;
  if p_esperado ? 'updated_at' and p_esperado->>'updated_at' is not null
     and fa.updated_at is distinct from (p_esperado->>'updated_at')::timestamp then
    raise exception 'AÑADIDO ABORTADO: la factura % ha cambiado desde que la viste. Revisa y confirma de nuevo.', p_factura_id;
  end if;
  if jsonb_typeof(p_lineas) <> 'array' then
    raise exception 'AÑADIDO ABORTADO: p_lineas no es una lista';
  end if;

  -- 1. Copia de auditoría (las líneas de antes no se tocan, pero la cabecera sí).
  insert into public.facturas_sustituciones
    (factura_id, trabajo_id, sustituida_por, factura_antes, productos_antes, historial_antes, resumen_antes)
  values (
    p_factura_id, p_trabajo_id, p_usuario,
    to_jsonb(fa) - 'embedding' - 'embedding_observaciones',
    coalesce((select jsonb_agg(to_jsonb(p) - 'embedding' order by p.id)
                from public.productos_factura p where p.factura_id = p_factura_id), '[]'::jsonb),
    '[]'::jsonb,
    jsonb_build_object('operacion', 'anadir_pagina', 'pagina', p_pagina, 'paginas_total', p_paginas_total,
                       'total', fa.total, 'total_origen', fa.total_origen, 'lineas', v_lineas_antes,
                       'alertas', fa.alertas_validacion, 'esperado', p_esperado, 'archivo_pagina', p_archivo_path))
  returning id into v_sust_id;

  -- 2. Cabecera. El pie IMPRESO manda: el de la página nueva si la existente
  --    no lo tiene o si la nueva es la última; dos totales deducidos se suman
  --    (cada uno es la suma de sus líneas); sin total en la existente, el nuevo.
  v_impreso := v_total is not null and coalesce(v_origen, '') <> 'deducido';
  v_existente_impreso := fa.total is not null and coalesce(fa.total_origen, '') <> 'deducido';
  v_usar_nuevo := v_total is not null
                  and (fa.total is null or (v_impreso and (not v_existente_impreso or p_pagina = p_paginas_total)));
  v_sumar := not v_usar_nuevo and v_total is not null and not v_impreso and not v_existente_impreso;
  update public.facturas
     set subtotal = case when v_usar_nuevo then (p_cabecera->>'subtotal')::numeric
                         when v_sumar and (subtotal is not null or p_cabecera->>'subtotal' is not null)
                           then coalesce(subtotal, 0) + coalesce((p_cabecera->>'subtotal')::numeric, 0)
                         else subtotal end,
         iva = case when v_usar_nuevo then (p_cabecera->>'iva')::numeric
                    when v_sumar and (iva is not null or p_cabecera->>'iva' is not null)
                      then coalesce(iva, 0) + coalesce((p_cabecera->>'iva')::numeric, 0)
                    else iva end,
         total = case when v_usar_nuevo then v_total when v_sumar then total + v_total else total end,
         total_origen = case when v_usar_nuevo then v_origen when v_sumar then 'deducido' else total_origen end,
         retencion_irpf = case when v_usar_nuevo and p_cabecera ? 'retencion_irpf'
                                 then nullif((p_cabecera->>'retencion_irpf')::numeric, 0)
                               else coalesce(retencion_irpf, nullif((p_cabecera->>'retencion_irpf')::numeric, 0)) end,
         retencion_irpf_pct = case when v_usar_nuevo and p_cabecera ? 'retencion_irpf'
                                     then case when nullif((p_cabecera->>'retencion_irpf')::numeric, 0) is not null
                                               then (p_cabecera->>'retencion_irpf_pct')::numeric end
                                   when retencion_irpf is not null then retencion_irpf_pct
                                   when nullif((p_cabecera->>'retencion_irpf')::numeric, 0) is not null
                                     then (p_cabecera->>'retencion_irpf_pct')::numeric
                                   else retencion_irpf_pct end,
         fecha = coalesce(fecha, (p_cabecera->>'fecha')::date),
         cif = coalesce(nullif(cif, ''), p_cabecera->>'cif'),
         proveedor = coalesce(nullif(proveedor, ''), p_cabecera->>'proveedor'),
         paginas = greatest(coalesce(paginas, 1), p_paginas_total)::smallint,
         archivo_path = coalesce(archivo_path, p_archivo_path),
         verificada = false,
         procesado_en = now()
   where id = p_factura_id;

  -- 3. Líneas de la página, a continuación de las que ya hay.
  insert into public.productos_factura
    (factura_id, nombre, cantidad, unidad, precio_unitario, total, embedding, pagina, orden, albaran_ref, bultos, iva_pct)
  select p_factura_id,
         l->>'nombre',
         coalesce((l->>'cantidad')::numeric, 1),
         coalesce(l->>'unidad', 'unidades'),
         (l->>'precio_unitario')::numeric,
         (l->>'total')::numeric,
         case when l->>'embedding' is not null then (l->>'embedding')::vector end,
         p_pagina::smallint,
         v_orden + ord::int,
         nullif(left(l->>'albaran_ref', 100), ''),
         (l->>'bultos')::numeric,
         (l->>'iva_pct')::numeric
    from jsonb_array_elements(p_lineas) with ordinality as x(l, ord);
  get diagnostics v_insertadas = row_count;

  -- 4. Trabajo cerrado: su documento ya está dentro de la factura.
  update public.ocr_trabajos
     set estado = 'completado', factura_id = p_factura_id, terminado_at = now(), documento_pendiente = null
   where id = p_trabajo_id;

  select * into fb from public.facturas where id = p_factura_id;
  update public.facturas_sustituciones
     set resumen_despues = jsonb_build_object('total', fb.total, 'total_origen', fb.total_origen,
                                              'lineas', v_lineas_antes + v_insertadas, 'lineas_anadidas', v_insertadas)
   where id = v_sust_id;

  return jsonb_build_object(
    'factura_id', p_factura_id, 'sustitucion_id', v_sust_id,
    'lineas_antes', v_lineas_antes, 'lineas_anadidas', v_insertadas, 'lineas', v_lineas_antes + v_insertadas,
    'total', fb.total, 'total_origen', fb.total_origen, 'paginas', fb.paginas,
    'paginas_lineas', coalesce((select jsonb_agg(distinct p.pagina order by p.pagina)
                                  from public.productos_factura p
                                 where p.factura_id = p_factura_id and p.pagina is not null), '[]'::jsonb),
    'alertas_antes', case when jsonb_typeof(fa.alertas_validacion) = 'array' then fa.alertas_validacion else '[]'::jsonb end);
end;
$function$;
