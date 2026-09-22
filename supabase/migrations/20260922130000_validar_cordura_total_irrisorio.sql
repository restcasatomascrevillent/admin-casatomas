-- ============================================================================
--  ⚠️⚠️⚠️  MIGRACIÓN NO APLICADA — ESCRITA PARA REVISIÓN  ⚠️⚠️⚠️
-- ----------------------------------------------------------------------------
--  NO se ha ejecutado ni probado contra la base de datos real: el acceso a
--  Supabase (MCP) devuelve Unauthorized en el momento de escribir esto, así
--  que no hay forma de comprobarla aquí. Revisar con cuidado antes de
--  aplicarla (`supabase db push` o pegarla en el SQL editor). No se toca
--  ningún dato ni ninguna tabla: es un único `CREATE OR REPLACE FUNCTION`.
-- ============================================================================
--
--  Facturas y albaranes · validar_cordura_factura() — importe de documento
--  sospechosamente PEQUEÑO (T5, complemento)
-- ----------------------------------------------------------------------------
--  CONTEXTO: revisión técnica de 2026-09-22 sobre `procesar-factura/index.ts`.
--  `toNumber()` tenía un bug (`String.replace(",", ".")` solo sustituye la
--  PRIMERA coma) que convertía un importe español como "1.200,50" en
--  "1.200.50" -> `parseFloat` se detenía en el primer punto sobrante -> 1.2.
--  El importe se dividía por mil EN SILENCIO: `validar_cordura_factura` (esta
--  función, migración 20260919110000) solo comprueba importes demasiado
--  GRANDES (`precio_unitario_extremo` > 1.000 €, `total_documento_extremo`
--  > 25.000 €), así que ninguna alerta saltaba.
--
--  El arreglo real de esa causa va en `procesar-factura/normalizacion.ts`
--  (fuera del alcance de esta migración: es TypeScript, no SQL). Esta
--  migración es la pregunta de seguimiento que se hace el propio encargo:
--  "arreglado `toNumber`, ¿queda alguna otra vía por la que un importe pueda
--  acabar sospechosamente pequeño?" Sí, al menos dos, y ninguna la tapa un
--  arreglo en TypeScript:
--    1. El modelo de Vision puede simplemente LEER MAL el documento (un cero
--       de menos, una coma que no estaba) y devolver un importe pequeño ya
--       de por sí, sin pasar por ningún parseo nuestro.
--    2. Un error de escala UNIFORME (p. ej. si el modelo dividiera él mismo
--       subtotal, iva Y total por el mismo factor) pasaría los tres chequeos
--       de consistencia interna (descuadre_linea, descuadre_cabecera,
--       iva_incoherente) SIN disparar ninguno: esos chequeos comparan los
--       importes entre sí, no contra una magnitud absoluta, y una escala
--       uniforme mantiene las proporciones intactas.
--
--  QUÉ SE AÑADE Y QUÉ NO, Y POR QUÉ:
--   - SÍ: un suelo absoluto sobre `total_documento` (bloque 5b, junto al
--     techo `total_documento_extremo` del bloque 5). Un documento real de un
--     proveedor mayorista de un restaurante prácticamente nunca es por menos
--     de unos pocos euros; un total positivo pero ínfimo es mucho más
--     probable que sea un fallo de escala que un pedido real.
--   - NO: un suelo por LÍNEA (`precio_unitario`) simétrico al techo de
--     `precio_unitario_extremo`. Un restaurante compra líneas legítimamente
--     baratas todo el tiempo (una sal, una guarnición, un paquete de
--     servilletas), así que un suelo absoluto por línea sería sobre todo
--     ruido. El bloque 6 (`precio_atipico_historico`) YA cubre el caso
--     simétrico para productos recurrentes -- su condición
--     `pf.precio_unitario <= h.media / 5` dispara igual de fuerte para un
--     precio demasiado BAJO que para uno demasiado alto frente al histórico
--     del mismo producto. El hueco real que queda (un producto nuevo, sin
--     todavía 2 compras previas con las que comparar) no tiene forma fiable
--     de resolverse con un umbral absoluto sin datos reales con los que
--     calibrarlo -- y ese acceso no está disponible ahora mismo.
--   - El umbral de 3 € de `total_documento_irrisorio` es una estimación
--     deliberadamente conservadora (para minimizar falsos positivos), sin
--     poder contrastarla contra el histórico real de documentos. Revisar y
--     ajustar en cuanto se pueda consultar la base de datos.
--   - Se excluye explícitamente `total = 0`: un documento con TODAS sus
--     líneas bonificadas (descuento 100 %, ver `VISION_SYSTEM_PROMPT` en
--     `procesar-factura/index.ts`) declara total 0 de forma legítima. Eso no
--     es lo mismo que un total positivo pero ínfimo, que es lo que esta
--     regla marca.
--
--  Severidad 'alta', igual que `total_documento_extremo`: un total dividido
--  por mil es un problema de la misma magnitud que uno multiplicado por diez
--  (el caso real que motivó T5), solo que en el sentido contrario.
--
--  DE REGALO, SIN NADA MÁS QUE HACER: como esta alerta usa severidad 'alta',
--  las RPC `*_agente` de la migración 20260922120000 (`alertas_pendientes` /
--  `alertas_severidad_alta`, que cuentan y agregan sobre
--  `facturas.alertas_validacion` genéricamente) la recogen automáticamente
--  en cuanto esta función se aplique. No hace falta tocar esas RPC de nuevo.
--
--  Reproduce el CUERPO COMPLETO de `validar_cordura_factura` tal y como está
--  en 20260919110000_facturas_archivo_original_y_validacion.sql (bloques 1-4
--  y 6 sin ningún cambio) porque `CREATE OR REPLACE FUNCTION` sustituye la
--  función entera: no hay forma de "parchear" solo un bloque. El único
--  cambio de comportamiento real es el bloque 5b, nuevo.
--  Idempotente (mismo patrón que sus migraciones hermanas de T5).
-- ============================================================================

create or replace function public.validar_cordura_factura(p_factura_id bigint)
returns jsonb
language plpgsql
stable
security invoker
set search_path to 'public'
as $function$
declare
  f       record;
  alertas jsonb := '[]'::jsonb;
  v_suma  numeric;
  v_ref   numeric;
  v_tol   numeric;
  r       record;
begin
  select * into f from facturas where id = p_factura_id;
  if not found then
    return '[]'::jsonb;
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
  --    sin el IVA prorrateado.
  ---------------------------------------------------------------------------
  select sum(total) into v_suma from productos_factura where factura_id = p_factura_id;
  v_ref := coalesce(f.subtotal, f.total);
  if v_suma is not null and v_ref is not null and v_ref <> 0 then
    v_tol := greatest(1.00, abs(v_ref) * 0.02);
    if abs(v_suma - v_ref) > v_tol then
      alertas := alertas || jsonb_build_object(
        'codigo',    'descuadre_cabecera',
        'severidad', 'media',
        'mensaje',   format('Las lineas suman %s pero el documento declara %s. Revisa si falta alguna linea o si el OCR ha leido mal un importe.',
                            round(v_suma, 2), round(v_ref, 2)),
        'detalle',   jsonb_build_object('suma_lineas', round(v_suma, 2),
                                        'referencia', round(v_ref, 2),
                                        'campo_referencia', case when f.subtotal is not null then 'subtotal' else 'total' end,
                                        'diferencia', round(v_suma - v_ref, 2))
      );
    end if;
  end if;

  ---------------------------------------------------------------------------
  -- 3) IVA incoherente: subtotal + iva frente al total.
  ---------------------------------------------------------------------------
  if f.subtotal is not null and f.iva is not null and f.total is not null
     and abs((f.subtotal + f.iva) - f.total) > greatest(0.05, abs(f.total) * 0.01) then
    alertas := alertas || jsonb_build_object(
      'codigo',    'iva_incoherente',
      'severidad', 'media',
      'mensaje',   format('Subtotal (%s) + IVA (%s) = %s, que no coincide con el total leido (%s).',
                          f.subtotal, f.iva, round(f.subtotal + f.iva, 2), f.total),
      'detalle',   jsonb_build_object('subtotal', f.subtotal, 'iva', f.iva, 'total', f.total)
    );
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
  -- 5b) NUEVO · Total del documento sospechosamente PEQUEÑO.
  --     Complemento simetrico del bloque 5. Se excluye el 0 exacto a
  --     proposito: un documento enteramente bonificado (descuento 100 % en
  --     todas sus lineas) declara total 0 de forma legitima -- eso no es la
  --     señal que se busca aqui. Umbral conservador (3 €) sin poder
  --     contrastarlo contra el historico real: revisar en cuanto haya acceso
  --     a la base de datos para calibrarlo con documentos reales.
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
  --    una sola compra anterior. Ya es simetrico (barato Y caro): ver
  --    `h.media / 5` mas abajo.
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
  'Comprueba la cordura de los importes de un documento recien cargado (descuadres, precios extremos en ambos sentidos y desviaciones frente al historico) y devuelve un array JSON de alertas. No corrige ni bloquea nada: marca para revision humana. total_documento_irrisorio (bloque 5b) es el complemento simetrico de total_documento_extremo para importes sospechosamente pequeños (p.ej. un error de escala que un fallo de parseo o el propio OCR puedan introducir).';

revoke all on function public.validar_cordura_factura(bigint) from public, anon;
grant execute on function public.validar_cordura_factura(bigint) to authenticated, service_role;

-- ============================================================================
--  Recordatorio: esta migracion NO se ha aplicado. Revisarla y aplicarla a
--  mano (`supabase db push` o pegarla en el SQL editor) cuando se decida.
-- ============================================================================
