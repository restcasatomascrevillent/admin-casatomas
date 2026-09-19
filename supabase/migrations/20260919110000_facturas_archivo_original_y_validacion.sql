-- ============================================================================
--  Facturas y albaranes · Archivo del documento original + validacion de OCR
-- ----------------------------------------------------------------------------
--  T4  Fallback a Supabase Storage cuando Google Drive no esta configurado.
--      Hoy los 4 secrets GOOGLE_* NO existen en el proyecto, asi que
--      DRIVE_ENABLED es false y `procesar-factura` descarta el PDF original
--      con un simple console.warn: perdida de datos silenciosa.
--  T5  Columna donde `procesar-factura` deja las alertas de cordura de importes
--      (ej. el albaran 38, 12 jamones a 9.316,67 €/ud por un x10 del OCR).
--
--  Idempotente. NO toca ningun dato de negocio existente.
-- ============================================================================


-- ────────────────────────────────────────────────────────────────────────────
--  BLOQUE 1 · Columnas nuevas en `facturas`
-- ────────────────────────────────────────────────────────────────────────────

-- Ruta del original dentro del bucket privado `facturas-originales`.
-- Convive con `drive_url`: si Drive esta configurado se usa Drive, y si no,
-- Storage. Nunca deberian quedar los dos a null tras un procesado correcto.
alter table public.facturas
  add column if not exists archivo_path text;

comment on column public.facturas.archivo_path is
  'Ruta del PDF/imagen original dentro del bucket privado facturas-originales. Fallback de drive_url mientras Google Drive no este configurado.';

-- Alertas de validacion de importes generadas por el OCR en el momento de la
-- carga. NULL o [] = sin anomalias. Formato:
--   [{ "codigo": "...", "severidad": "alta|media", "mensaje": "...", "detalle": {...} }]
alter table public.facturas
  add column if not exists alertas_validacion jsonb;

comment on column public.facturas.alertas_validacion is
  'Anomalias de importes detectadas por procesar-factura al cargar el documento (descuadres linea/cabecera, precios desproporcionados frente al historico). NULL o [] = sin anomalias. Es un aviso para revision humana, no bloquea el guardado.';

-- Localizar rapido lo que hay pendiente de revisar sin escanear toda la tabla.
create index if not exists idx_facturas_alertas_pendientes
  on public.facturas (fecha desc)
  where alertas_validacion is not null
    and jsonb_array_length(alertas_validacion) > 0;

-- Igual, para encontrar documentos cuyo original se perdio (ni Drive ni Storage).
create index if not exists idx_facturas_sin_original
  on public.facturas (procesado_en desc)
  where drive_url is null and archivo_path is null;


-- ────────────────────────────────────────────────────────────────────────────
--  BLOQUE 2 · T4 — Bucket privado para los originales
-- ────────────────────────────────────────────────────────────────────────────
--  PRIVADO a proposito: son documentos contables del negocio. El panel abre el
--  fichero con una URL firmada de corta duracion, no con un enlace publico.
--  Limite de 10 MB, el mismo que ya valida SubidaFacturas.tsx antes de subir.
-- ────────────────────────────────────────────────────────────────────────────

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'facturas-originales',
  'facturas-originales',
  false,
  10485760,
  array['application/pdf', 'image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update
  set public             = excluded.public,
      file_size_limit    = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;


-- ────────────────────────────────────────────────────────────────────────────
--  BLOQUE 3 · T4 — Politicas del bucket
-- ────────────────────────────────────────────────────────────────────────────
--  Mismo criterio que las tablas `facturas` / `productos_factura`: acceso por
--  permiso de seccion, usando los helpers can_read_section / can_write_section
--  que ya introdujo la migracion 20260918120000_rls_por_permisos_de_seccion.
--  La Edge Function escribe con service_role, que no pasa por RLS.
-- ────────────────────────────────────────────────────────────────────────────

drop policy if exists "facturas_originales_select" on storage.objects;
create policy "facturas_originales_select" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'facturas-originales'
    and public.can_read_section('facturas')
  );

drop policy if exists "facturas_originales_insert" on storage.objects;
create policy "facturas_originales_insert" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'facturas-originales'
    and public.can_write_section('facturas')
  );

drop policy if exists "facturas_originales_update" on storage.objects;
create policy "facturas_originales_update" on storage.objects
  for update to authenticated
  using (
    bucket_id = 'facturas-originales'
    and public.can_write_section('facturas')
  )
  with check (
    bucket_id = 'facturas-originales'
    and public.can_write_section('facturas')
  );

-- Sin politica de DELETE a proposito: el original es la prueba documental del
-- gasto. Borrarlo requiere pasar por el panel de Supabase de forma consciente.


-- ────────────────────────────────────────────────────────────────────────────
--  BLOQUE 4 · T5 — validar_cordura_factura()
-- ────────────────────────────────────────────────────────────────────────────
--  POR QUE: el albaran 38 (Joselito) registra 120.580,00 € — 12 jamones a
--  9.316,67 €/ud. Un Joselito Gran Reserva ronda los 600-1.000 €, asi que es
--  casi seguro un x10 del OCR. El sistema se lo trago sin una sola señal y ese
--  unico documento falsea toda la estadistica de albaranes.
--
--  Esta funcion se ejecuta desde `procesar-factura` justo despues de insertar
--  las lineas y deja el resultado en `facturas.alertas_validacion`. NO corrige
--  nada ni bloquea la carga: solo marca para revision humana.
--
--  Se implementa en SQL (y no en la Edge Function) para poder usar la columna
--  generada `nombre_normalizado`, que es la que permite comparar un producto
--  con su historico sin duplicar la logica de normalizacion en TypeScript.
--
--  Reglas (cada una con su codigo):
--    descuadre_linea            precio_unitario x cantidad != total de linea
--    descuadre_cabecera         suma de lineas != subtotal (o total) del documento
--    iva_incoherente            subtotal + iva != total
--    precio_unitario_extremo    > 1.000 €/unidad
--    total_documento_extremo    documento por encima de 25.000 €
--    precio_atipico_historico   >= 5x (o <= 1/5) del precio medio historico
--                               del mismo producto en OTROS documentos
-- ────────────────────────────────────────────────────────────────────────────

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
  -- 5) Total del documento desproporcionado.
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
  -- 6) Precio atipico frente al historico del MISMO producto en OTROS
  --    documentos. Exige al menos 2 observaciones previas para no disparar por
  --    una sola compra anterior.
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
  'Comprueba la cordura de los importes de un documento recien cargado (descuadres, precios extremos y desviaciones frente al historico) y devuelve un array JSON de alertas. No corrige ni bloquea nada: marca para revision humana.';

revoke all on function public.validar_cordura_factura(bigint) from public, anon;
grant execute on function public.validar_cordura_factura(bigint) to authenticated, service_role;


-- ────────────────────────────────────────────────────────────────────────────
--  BLOQUE 5 · T5 — Marcar los documentos YA cargados
-- ────────────────────────────────────────────────────────────────────────────
--  Pasa el validador por los documentos existentes para que el albaran 38 quede
--  señalado desde el primer momento, sin esperar a una nueva carga. Solo escribe
--  `alertas_validacion` (columna nueva en esta misma migracion): no modifica ni
--  un solo importe. La correccion del dato es decision del dueño.
-- ────────────────────────────────────────────────────────────────────────────

update public.facturas f
set alertas_validacion = public.validar_cordura_factura(f.id)
where f.alertas_validacion is null;
