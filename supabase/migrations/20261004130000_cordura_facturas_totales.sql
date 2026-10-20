-- ============================================================================
--  Facturas y albaranes · validar_cordura_factura() — totales que faltan y
--  tolerancias alineadas con el validador de TypeScript
-- ----------------------------------------------------------------------------
--  CONTEXTO: auditoria de datos del OCR de 2026-10-04 (engram
--  `facturas/auditoria-datos-ocr`). La funcion devolvia `[]` para los 19
--  documentos de la base, y al menos tres tenian algo que decir:
--
--    · Factura 39 (F/25011959, Salazones Garre) y factura 54 (ML/101511, Luga
--      Sabores): `total`, `subtotal` e `iva` a NULL con lineas que suman
--      436,92 € y 295,11 €. La funcion no miraba si faltaba el total: todos
--      sus bloques empiezan por `f.total is not null`, asi que un documento
--      SIN importes de cabecera pasaba como "sin anomalias" — justo el
--      documento que menos se puede dar por bueno.
--    · Albaran 46 (AL2025/0009781, Bodega Campoluz): las lineas suman
--      2.450,43 € y la base imponible es 2.488,11 €. Faltan 37,68 € (una
--      botella de BRUGAL 1888 leida como 1 x 34,05 en vez de 2, mas el canon
--      de punto verde). La tolerancia SQL era `greatest(1, 2 %)` = 49,76 €:
--      la botella cabia entera.
--
--  QUE CAMBIA (y nada mas):
--
--   0) NUEVO · `total_ausente` (alta): el documento no tiene `total`. Se
--      excluye a proposito el albaran de entrega SIN PRECIOS (Joselito,
--      albaran 38: lineas con cantidad pero sin precio ni total, y cabecera
--      vacia). Ese documento es correcto tal cual y `procesar-factura` lo
--      trata igual (`sin_importes`: "no debe salir ni un aviso"). Un
--      documento sin total y SIN lineas si avisa: no hay nada utilizable.
--      NUEVO · `subtotal_ausente` (media): hay total y lineas con importe,
--      pero no base imponible. Las lineas casi siempre van sin IVA, asi que
--      sin base no hay contra que cuadrarlas de verdad.
--
--   2) `descuadre_cabecera`: misma tolerancia que `toleranciaCabecera()` de
--      `procesar-factura/esquema.ts` — 0,5 % con SUELO de 2 € y TECHO de
--      15 €. Medida alli sobre los 19 documentos reales: absorbe el canon de
--      punto verde legitimo (6,00 € en el 46 sin la botella; 0,72 € en el 48)
--      y caza los 37,68 € del 46. El `detalle` conserva sus claves y anade
--      `tolerancia`, `num_lineas`, `lineas_total_cero` y `lineas_sin_total`.
--      Las lineas a 0 € SIGUEN SUMANDO (como 0): no se descartan, asi que no
--      pueden tapar un hueco. Tampoco se marcan como error por si mismas —
--      una bonificacion (Campoluz regala 4 TANQUERAY) es legitima —, pero si
--      hay descuadre el mensaje recuerda cuantas hay, porque una de ellas
--      puede ser el importe que falta.
--
--   3) `iva_incoherente`: misma tolerancia que el validador TS — un centimo
--      por linea con suelo de 5 centimos. El 1 % relativo de antes admitia
--      50 € de error en una factura de 5.000 €. `detalle` conserva
--      subtotal/iva/total y anade esperado, diferencia y tolerancia.
--
--  Bloques 1, 4, 5, 5b y 6 (descuadre_linea, precio_unitario_extremo,
--  total_documento_extremo, total_documento_irrisorio,
--  precio_atipico_historico) SIN CAMBIOS: se reproducen porque CREATE OR
--  REPLACE sustituye la funcion entera. Misma firma, mismo tipo de retorno y
--  mismo formato de cada alerta ({codigo, severidad, mensaje, detalle}): el
--  panel (`EstadoDocumento.tsx`), `procesar-factura` (que mezcla estas
--  alertas con las suyas sin duplicar por `codigo`) y las RPC `*_agente`
--  siguen funcionando igual.
--
--  NO toca datos. `facturas.alertas_validacion` solo lo escribe
--  `procesar-factura` al cargar un documento; para recalcular lo guardado:
--    update facturas set alertas_validacion = validar_cordura_factura(id);
--  (ojo: eso pisaria las alertas que solo produce el validador TS, como
--  `total_deducido` o `lineas_incompletas`).
--
--  Aplicar con `supabase db query --linked -f <este fichero>` (nunca db push).
--  Idempotente: un unico CREATE OR REPLACE FUNCTION.
-- ============================================================================

create or replace function public.validar_cordura_factura(p_factura_id bigint)
returns jsonb
language plpgsql
stable
set search_path to 'public'
as $function$
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
  --    procesar-factura/esquema.ts: 0,5 % con suelo de 2 € y techo de 15 €.
  --    Las lineas a 0 € suman 0 (no se excluyen); las de total NULL no
  --    suman, y si eso abre un hueco, este bloque lo ve.
  ---------------------------------------------------------------------------
  v_ref := coalesce(f.subtotal, f.total);
  if v_suma is not null and v_ref is not null and v_ref <> 0 then
    v_tol := least(15.00, greatest(2.00, abs(v_ref) * 0.005));
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
    if abs((f.subtotal + f.iva) - f.total) > v_tol then
      alertas := alertas || jsonb_build_object(
        'codigo',    'iva_incoherente',
        'severidad', 'media',
        'mensaje',   format('Subtotal (%s) + IVA (%s) = %s, que no coincide con el total leido (%s).',
                            f.subtotal, f.iva, round(f.subtotal + f.iva, 2), f.total),
        'detalle',   jsonb_build_object('subtotal', f.subtotal, 'iva', f.iva, 'total', f.total,
                                        'esperado', round(f.subtotal + f.iva, 2),
                                        'diferencia', round((f.subtotal + f.iva) - f.total, 2),
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

  return alertas;
end;
$function$;

comment on function public.validar_cordura_factura(bigint) is
  'Comprueba la cordura de los importes de un documento (totales ausentes, descuadres de linea/cabecera/IVA con las mismas tolerancias que procesar-factura/esquema.ts, precios extremos en ambos sentidos y desviaciones frente al historico) y devuelve un array JSON de alertas {codigo, severidad, mensaje, detalle}. No corrige ni bloquea nada: marca para revision humana. El albaran de entrega sin precios no genera avisos.';

revoke all on function public.validar_cordura_factura(bigint) from public, anon;
grant execute on function public.validar_cordura_factura(bigint) to authenticated, service_role;
