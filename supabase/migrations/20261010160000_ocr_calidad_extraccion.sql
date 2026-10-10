set client_encoding = 'UTF8';
-- ===========================================================================
-- 20261010160000_ocr_calidad_extraccion
-- ===========================================================================
-- ##   NO APLICADA: la aplica el dueño a mano (ver PASOS)                  ##
-- ===========================================================================
-- Revisión foto a foto de 48 documentos de octubre (10/10/2026): la parte de
-- los arreglos que vive en SQL. La de código va en procesar-factura
-- (calidad.ts, esquema.ts, prompts.ts) y se despliega aparte.
--
-- QUÉ CAMBIA
--   1. Nuevas (IMMUTABLE): cif_control_valido(text) (dígito de control de
--      CIF/NIF/NIE), cif_distancia(text, text) (Levenshtein, sin extensiones)
--      y proveedor_clave(text) (nombre sin «S.R.L.», «S. Coop. V.L.», «SRL»,
--      puntos, tildes ni orden de palabras).
--   2. proveedor_resolver: un CIF que no supera el control casa con la ficha
--      cuyo CIF está a ≤ 2 caracteres (Nicolás y Valero leído B08605246 /
--      B06050246 / B06505246, real B06805246; Beneoliva F54650895 →
--      F54450895); dos CIF válidos distintos nunca se casan. Si la lectura es
--      válida y la ficha no, la ficha se corrige y el CIF viejo queda como
--      alias. Por nombre, además del alias exacto, casa por proveedor_clave
--      (284/288/293, 281/294 y 219/295 eran duplicados por eso). Nunca crea
--      una ficha con un CIF que no supera el control (la crea sin CIF).
--   3. validar_cordura_factura: suelo de la tolerancia de «suma de líneas =
--      base» de 2 € a 0,50 € (el embalaje de 1,82, los portes de 1,60 y la
--      RGA de 1,97 pasaban sin aviso; mismo cambio en esquema.ts), y avisos
--      «cif_corregido» / «cif_invalido» si el CIF del documento no supera el
--      dígito de control.
--   4. extraer_contenido: «1/2 KG» = 0,5 kg; «+15 GRS» y «calibre 20» no son
--      contenido; «5L c/3u» = 5 l. trg_productos_factura_rellenar_contenido:
--      «C/15UD» / «C/12U» no es contenido si la línea ya cuenta unidades y la
--      cantidad es múltiplo (15, 30…).
--
-- NO TOCA DATOS: ni fusiona los proveedores duplicados que ya existen (eso
-- lo hace el dueño con proveedores_fusionar, ver el informe de la revisión),
-- ni corrige CIF guardados, ni recalcula el contenido de las líneas ya
-- guardadas (se recalcula al editar la línea). normalizar_proveedor_base NO se
-- toca: sus valores están guardados en columnas generadas e índices.
-- Comprueba el md5 (sin CR) de las 4 funciones que reescribe: si alguien las
-- ha cambiado, no cambia nada. Idempotente (se puede ejecutar dos veces).
--
-- PASOS (desde adminpanelct/, POR TERMINAL; no en el SQL Editor)
--   1. npx supabase db query --linked -f supabase/migrations/20261010160000_ocr_calidad_extraccion.sql
--      Tiene que imprimir «ocr_calidad_extraccion: aplicada».
--   2. npx supabase db query --linked -f supabase/tests/ocr_calidad_extraccion_test.sql
--      (BEGIN … ROLLBACK). Tiene que acabar en «ocr_calidad_extraccion_test: OK».
--   3. Desplegar procesar-factura y ocr-trabajo (el orden da igual).
--   Deshacer: supabase/rollbacks/20261010160000_ocr_calidad_extraccion_ROLLBACK.sql
-- ===========================================================================

begin;
set local lock_timeout = '5s';

do $$
declare
  v_f text; v_esperado text; v_md5 text; v_src text;
begin
  if to_regclass('public.proveedores_alias') is null
     or to_regprocedure('public.normalizar_cif(text)') is null
     or to_regprocedure('public.normalizar_proveedor_base(text)') is null
     or to_regprocedure('public.proveedor_es_cliente(text,text)') is null
     or to_regprocedure('public.unaccent(text)') is null then
    raise exception 'ocr_calidad_extraccion: falta 20261007180000_proveedores_unificados o unaccent. No se ha cambiado nada.';
  end if;
  for v_f, v_esperado in
    select * from (values
    ('public.proveedor_resolver(text,text,boolean)', '8eb8d5f587fc95b86e889ef8aed6b615'),
    ('public.validar_cordura_factura(bigint)', 'd15033d50ee8fd7530fcb8b1c1915711'),
    ('public.extraer_contenido(text)', '6095d6a581027b3b7d206148ab8ca19c'),
    ('public.trg_productos_factura_rellenar_contenido()', '8af8e2059b4c2b34b3837309b570640c')
    ) as t(f, m)
  loop
    select md5(replace(pg_get_functiondef(p.oid), chr(13), '')), p.prosrc into v_md5, v_src
      from pg_proc p where p.oid = to_regprocedure(v_f);
    if v_md5 is null then
      raise exception 'ocr_calidad_extraccion: no existe %. No se ha cambiado nada.', v_f;
    end if;
    if position('20261010160000_ocr_calidad_extraccion' in v_src) = 0 and v_md5 <> v_esperado then
      raise exception 'ocr_calidad_extraccion: % tiene un md5 inesperado (%), distinto de %. Alguien la ha cambiado: revisar antes de reescribirla. No se ha cambiado nada.', v_f, v_md5, v_esperado;
    end if;
  end loop;
end;
$$;

-- ─── 1. CIF/NIF/NIE: dígito de control ──────────────────────────────────────
create or replace function public.cif_control_valido(p_cif text)
returns boolean
language plpgsql
immutable parallel safe
set search_path = ''
as $$
-- 20261010160000_ocr_calidad_extraccion: CIF (letra + 7 cifras + control),
-- NIF (8 cifras + letra) y NIE (X/Y/Z + 7 cifras + letra). Misma regla que
-- cifControlValido (procesar-factura/calidad.ts).
declare
  c      text := public.normalizar_cif(p_cif);
  letras constant text := 'TRWAGMYFPDXBNJZSQVHLCKE';
  s      int := 0;
  d      int;
  i      int;
  ctl    int;
begin
  if c is null then
    return false;
  end if;
  if c ~ '^[0-9]{8}[A-Z]$' then
    return substr(letras, (substr(c, 1, 8)::bigint % 23)::int + 1, 1) = substr(c, 9, 1);
  end if;
  if c ~ '^[XYZ][0-9]{7}[A-Z]$' then
    return substr(letras, (((strpos('XYZ', substr(c, 1, 1)) - 1)::text || substr(c, 2, 7))::bigint % 23)::int + 1, 1)
           = substr(c, 9, 1);
  end if;
  if c !~ '^[ABCDEFGHJKLMNPQRSUVW][0-9]{7}[0-9A-J]$' then
    return false;
  end if;
  for i in 1..7 loop
    d := substr(c, i + 1, 1)::int;
    if i % 2 = 0 then
      s := s + d;
    else
      d := d * 2;
      s := s + d / 10 + d % 10;
    end if;
  end loop;
  ctl := (10 - s % 10) % 10;
  if substr(c, 1, 1) in ('P', 'Q', 'R', 'S', 'N', 'W', 'K', 'L', 'M') then
    return substr(c, 9, 1) = substr('JABCDEFGHI', ctl + 1, 1);
  elsif substr(c, 1, 1) in ('A', 'B', 'E', 'H') then
    return substr(c, 9, 1) = ctl::text;
  end if;
  return substr(c, 9, 1) in (ctl::text, substr('JABCDEFGHI', ctl + 1, 1));
end;
$$;

-- ─── 2. Distancia de edición entre dos CIF (Levenshtein, sin extensiones) ───
create or replace function public.cif_distancia(a text, b text)
returns integer
language plpgsql
immutable parallel safe
set search_path = ''
as $$
-- 20261010160000_ocr_calidad_extraccion: «B06805246» frente a «B08605246»
-- (dos cifras traspuestas) = 2. Solo para textos cortos (CIF).
declare
  la   int := length(a);
  lb   int := length(b);
  prev int[];
  cur  int[];
  i    int;
  j    int;
begin
  if a is null or b is null then
    return null;
  end if;
  if la = 0 then return lb; end if;
  if lb = 0 then return la; end if;
  prev := array(select generate_series(0, lb));
  for i in 1..la loop
    cur := array[i];
    for j in 1..lb loop
      cur := cur || least(prev[j + 1] + 1, cur[j] + 1,
                          prev[j] + case when substr(a, i, 1) = substr(b, j, 1) then 0 else 1 end);
    end loop;
    prev := cur;
  end loop;
  return prev[lb + 1];
end;
$$;

-- ─── 3. Clave de nombre: sin formas legales, puntos, tildes ni orden ────────
create or replace function public.proveedor_clave(p_nombre text)
returns text
language sql
immutable parallel safe
set search_path = 'public'
as $$
  -- 20261010160000_ocr_calidad_extraccion: «DISTRIBUCIONES GASTRONÓMICAS
  -- NICOLÁS Y VALERO SRL» = «Distribuciones Gastronómicas Nicolás y Valero,
  -- S.R.L.»; «Beneoliva, S. Coop. V.L.» = «BENEOLIVA, S.COOP. V.L.»;
  -- «Equipalia Suministros Hosteleros» = «Suministros Hosteleros Equipalia,
  -- S.L.» (palabras ordenadas). normalizar_proveedor_base NO se toca: sus
  -- valores están guardados en columnas e índices.
  select nullif(array_to_string(array(
           select distinct w
             from regexp_split_to_table(
                    regexp_replace(
                      replace(lower(public.unaccent(regexp_replace(coalesce(p_nombre, ''), '\([^)]*\)', ' ', 'g'))), '.', ''),
                      '[^a-z0-9]+', ' ', 'g'),
                    ' ') as w
            where length(w) >= 2
              and w not in ('sl', 'slu', 'sa', 'sau', 'srl', 'sll', 'scoop', 'coop', 'vl', 'cb', 'sc', 'scl', 'scp',
                            'sociedad', 'limitada', 'anonima', 'unipersonal', 'cooperativa', 'valenciana',
                            'de', 'del', 'la', 'las', 'los', 'el', 'en')
            order by w), ' '), '')
$$;

-- ─── 4. proveedor_resolver ──────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.proveedor_resolver(p_nombre text, p_cif text, p_crear boolean DEFAULT false)
 RETURNS bigint
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
-- 20261010160000_ocr_calidad_extraccion. Sobre la de 20261007180000:
--  · un CIF que no supera el dígito de control casa con la ficha cuyo CIF
--    está a ≤ 2 caracteres (B08605246 ~ B06805246); dos CIF VÁLIDOS distintos
--    nunca se casan (son dos empresas). Si la lectura es válida y la ficha no,
--    la ficha se corrige y el CIF viejo queda como alias;
--  · por nombre, además del alias exacto, la clave proveedor_clave (sin
--    «S.R.L.», «S. Coop. V.L.», puntos, tildes ni orden de palabras);
--  · nunca se crea una ficha con un CIF que no supera el control (se crea
--    sin CIF).
declare
  v_base      text := nullif(public.normalizar_proveedor_base(coalesce(p_nombre, '')), '');
  v_clave     text := public.proveedor_clave(p_nombre);
  v_cif       text := public.normalizar_cif(p_cif);
  v_cif_ok    boolean;
  v_nombre    text := left(btrim(regexp_replace(coalesce(p_nombre, ''), '\s+', ' ', 'g')), 255);
  v_id        bigint;
  v_cif_ficha text;
begin
  if public.proveedor_es_cliente(v_base, null) then
    return null;                       -- el cliente no es proveedor
  end if;
  if v_cif = 'B54583356' then
    v_cif := null;                     -- el CIF del cliente no identifica al proveedor
  end if;
  v_cif_ok := public.cif_control_valido(v_cif);

  -- 1) CIF exacto (ficha o alias de CIF).
  if v_cif is not null then
    select id into v_id from public.proveedores where cif_normalizado = v_cif;
    if v_id is null then
      select proveedor_id into v_id from public.proveedores_alias where cif_normalizado = v_cif;
    end if;
  end if;

  -- 2) CIF a ≤ 2 caracteres, si uno de los dos no supera el control.
  if v_id is null and v_cif is not null then
    select p.id, p.cif_normalizado into v_id, v_cif_ficha
      from public.proveedores p
     where p.cif_normalizado is not null
       and abs(length(p.cif_normalizado) - length(v_cif)) <= 2
       and public.cif_distancia(p.cif_normalizado, v_cif) <= 2
       and not (v_cif_ok and public.cif_control_valido(p.cif_normalizado))
     order by (v_clave is not null and public.proveedor_clave(p.nombre) = v_clave) desc,
              public.cif_control_valido(p.cif_normalizado) desc,
              public.cif_distancia(p.cif_normalizado, v_cif),
              (select count(*) from public.facturas f where f.proveedor_id = p.id) desc,
              p.id
     limit 1;
    if v_id is not null and p_crear and v_cif_ok and not public.cif_control_valido(v_cif_ficha) then
      update public.proveedores set cif = v_cif where id = v_id;
      insert into public.proveedores_alias (proveedor_id, cif_normalizado, texto_original, origen)
      values (v_id, v_cif_ficha, 'CIF mal leído (corregido a ' || v_cif || ')', 'automatico')
      on conflict do nothing;
    end if;
  end if;

  if v_id is not null and p_crear and v_base is not null then
    insert into public.proveedores_alias (proveedor_id, alias_normalizado, texto_original, origen)
    values (v_id, v_base, v_nombre, 'automatico')
    on conflict do nothing;
  end if;

  -- 3) Por nombre: alias exacto y, si no, la clave.
  if v_id is null and v_base is not null then
    select proveedor_id into v_id from public.proveedores_alias where alias_normalizado = v_base;
    if v_id is null and v_clave is not null then
      select p.id into v_id
        from public.proveedores p
       where public.proveedor_clave(p.nombre) = v_clave
          or public.proveedor_clave(p.nombre_comercial) = v_clave
          or exists (select 1 from public.proveedores_alias a
                      where a.proveedor_id = p.id and public.proveedor_clave(a.texto_original) = v_clave)
       order by (select count(*) from public.facturas f where f.proveedor_id = p.id) desc, p.id
       limit 1;
      if v_id is not null and p_crear then
        insert into public.proveedores_alias (proveedor_id, alias_normalizado, texto_original, origen)
        values (v_id, v_base, v_nombre, 'automatico')
        on conflict do nothing;
      end if;
    end if;
    -- Una lectura VÁLIDA completa la ficha sin CIF o corrige una con CIF que
    -- no supera el control (el viejo queda como alias).
    if v_id is not null and p_crear and v_cif_ok
       and not exists (select 1 from public.proveedores_alias where cif_normalizado = v_cif)
       and not exists (select 1 from public.proveedores where cif_normalizado = v_cif) then
      select cif_normalizado into v_cif_ficha from public.proveedores where id = v_id;
      if v_cif_ficha is null or not public.cif_control_valido(v_cif_ficha) then
        update public.proveedores set cif = v_cif where id = v_id;
        if v_cif_ficha is not null then
          insert into public.proveedores_alias (proveedor_id, cif_normalizado, texto_original, origen)
          values (v_id, v_cif_ficha, 'CIF mal leído (corregido a ' || v_cif || ')', 'automatico')
          on conflict do nothing;
        end if;
      end if;
    end if;
  end if;

  -- 4) Ficha nueva, con CIF solo si supera el control.
  if v_id is null and p_crear and v_base is not null then
    insert into public.proveedores (nombre, cif, origen)
    values (v_nombre, case when v_cif_ok then v_cif end, 'automatico')
    on conflict do nothing
    returning id into v_id;
    if v_id is null then               -- otro lo acaba de crear, o ya había uno con ese nombre exacto
      select proveedor_id into v_id from public.proveedores_alias where alias_normalizado = v_base;
      if v_id is null then
        select id into v_id from public.proveedores where nombre = v_nombre;
      end if;
    end if;
  end if;
  return v_id;
end;
$function$;

-- ─── 5. validar_cordura_factura ─────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.validar_cordura_factura(p_factura_id bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
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

-- ─── 6. Contenido por envase ────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.extraer_contenido(p_texto text)
 RETURNS TABLE(cantidad numeric, unidad text)
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
-- 20261008140000_productos_contenido_unidad: contenido de un envase leído del
-- texto de la línea, SIN IA (solo regex). Devuelve (cantidad, unidad) con
-- unidad kg, l o ud ya convertida (750 ml → 0,75 l; 500 g → 0,5 kg), o nada si
-- no hay o es ambiguo (rangos «5-6 kg», varias cifras distintas, «1.000 g»).
-- Orden: 1) multiplicado «24x33cl»; 2) con marcador de envase «caja 10 kg»,
-- «C/2K», «B/5 K», «cubo 5 L», «Tarro/400g», «Pzas. 3 K»; 3) rango → nada;
-- 4) una única cifra con unidad suelta («5KG», «2 L», «70 CL.», «45U»).
-- 20261010160000_ocr_calidad_extraccion: «1/2 KG» = 0,5 kg; «+15 GRS» y
-- «calibre 20» son calibres, no contenido; «5L c/3u» = 5 l (las 3 u son las
-- piezas de la caja, no el contenido de cada una).
declare
  c_num  constant text := '(\d{1,4}(?:[.,]\d{1,3})?)';
  c_uni  constant text := '(kilogramos?|kilos?|kgs?|gramos?|grs?|g|litros?|lts?|ltos?|lt|l|cl|ml|uds?|unidades?|unid|botellas?|latas?|botes?|tarros?|bolsas?|paquetes?|piezas?|pzas?|sobres?|u|k)';
  c_peso constant text := '(kilogramos?|kilos?|kgs?|gramos?|grs?|g|litros?|lts?|ltos?|lt|l|cl|ml|k)';
  c_marc constant text := '(?:\m[cbt]\s*\.?\s*/\s*(?:c\s*)?|\m(?:caja|cubo|bote|tarro|saco|bolsa|lata|paquete|pack|pzas?|pieza|botella|malla|bandeja|barqueta|garrafa|bidon)\s*\.?\s*(?:/|de)?\s*)';
  t      text := lower(regexp_replace(coalesce(p_texto, ''), '\s+', ' ', 'g'));
  m      text[];
  v_txt  text;
  v_u    text;
  v_mult numeric := 1;
  v_cnt  int;
  v_qty  numeric;
begin
  if t = '' then
    return;
  end if;
  t := regexp_replace(t, '\m1\s*/\s*2\s*(?=(kgs?|k|kilos?|l|lts?|litros?)\y)', '0,5 ', 'g');
  t := regexp_replace(t, '\m1\s*/\s*4\s*(?=(kgs?|k|kilos?|l|lts?|litros?)\y)', '0,25 ', 'g');
  t := regexp_replace(t, '\m3\s*/\s*4\s*(?=(kgs?|k|kilos?|l|lts?|litros?)\y)', '0,75 ', 'g');
  t := regexp_replace(t, '[+]\s*\d{1,4}(?:[.,]\d{1,3})?\s*(?:grs?|gramos?|g|kgs?|k)\y', ' ', 'g');
  t := regexp_replace(t, '\mcal(?:ibre)?\.?\s*\d+(?:\s*/\s*\d+)?', ' ', 'g');

  m := regexp_match(t, '\m(\d{1,3})\s*[x×]\s*' || c_num || '\s*(cl|ml|lts?|litros?|l|grs?|gramos?|g|kgs?|kilos?)\y');
  if m is not null then                                  -- 1) «24x33cl»
    v_mult := m[1]::numeric; v_txt := m[2]; v_u := m[3];
  else
    if t ~ '\mc\s*/\s*\d{1,3}\s*(?:u|uds?|unidades?|unid)\y' then
      -- «5L c/3u»: 3 piezas de 5 l → si hay UNA cifra de peso/volumen, manda.
      select count(distinct x.g[1] || x.g[2]), min(x.g[1]), min(x.g[2])
        into v_cnt, v_txt, v_u
        from regexp_matches(t, '\m' || c_num || '\s*' || c_peso || '\y', 'g') as x(g);
      if coalesce(v_cnt, 0) <> 1 then
        v_txt := null;
        v_u := null;
      end if;
    end if;
    m := case when v_txt is null then regexp_match(t, c_marc || c_num || '\s*' || c_uni || '\y') end;
    if v_txt is not null then
      null;                                              -- ya resuelto («5L c/3u»)
    elsif m is not null then                             -- 2) con marcador de envase
      v_txt := m[1]; v_u := m[2];
    else
      if t ~ ('\d\s*(?:-|–|\ma\M)\s*' || c_num || '\s*' || c_uni || '\y') then
        return;                                          -- 3) rango: ambiguo
      end if;
      select count(distinct x.q || x.k), min(x.txt), min(x.u)   -- 4) cifra única con unidad
        into v_cnt, v_txt, v_u
        from (
          select g[1] as txt, g[2] as u,
                 replace(g[1], ',', '.')::numeric
                   * case when g[2] = 'ml' then 0.001 when g[2] = 'cl' then 0.01
                          when g[2] ~ '^(g|grs?|gramos?)$' then 0.001 else 1 end as q,
                 case when g[2] ~ '^(kgs?|k|kilos?|kilogramos?|g|grs?|gramos?)$' then 'kg'
                      when g[2] ~ '^(l|lts?|ltos?|lt|litros?|cl|ml)$' then 'l'
                      else 'ud' end as k
            from regexp_matches(t, '\m' || c_num || '\s*' || c_uni || '\y', 'g') as r(g)
        ) x;
      if coalesce(v_cnt, 0) <> 1 then
        return;
      end if;
    end if;
  end if;

  if v_txt ~ '^\d+\.\d{3}$' then
    return;                                              -- «1.000 g»: miles o decimales, ambiguo
  end if;
  v_qty := replace(v_txt, ',', '.')::numeric * v_mult
           * case when v_u = 'ml' then 0.001 when v_u = 'cl' then 0.01
                  when v_u ~ '^(g|grs?|gramos?)$' then 0.001 else 1 end;
  if v_qty > 0 and v_qty <= 1000 then
    cantidad := round(v_qty, 4);
    unidad := case when v_u ~ '^(kgs?|k|kilos?|kilogramos?|g|grs?|gramos?)$' then 'kg'
                   when v_u ~ '^(l|lts?|ltos?|lt|litros?|cl|ml)$' then 'l'
                   else 'ud' end;
    return next;
  end if;
  return;
end;
$function$;

CREATE OR REPLACE FUNCTION public.trg_productos_factura_rellenar_contenido()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
-- 20261008140000_productos_contenido_unidad: rellena contenido_* leyendo el
-- nombre (y, si no, la unidad) de la línea. Lo puesto a mano no se pisa; un
-- valor escrito a propósito (alta con contenido, o cambio de contenido sin
-- tocar el origen) pasa a ser 'manual'.
-- 20261010160000_ocr_calidad_extraccion: un contenido en UNIDADES («C/15UD»,
-- «C/12U») no es contenido si la línea ya cuenta unidades y la cantidad es
-- múltiplo de él (15, 30…): el precio ya es por unidad.
declare
  v_c numeric;
  v_u text;
begin
  if tg_op = 'INSERT' then
    if new.contenido_cantidad is not null and new.contenido_origen is null then
      new.contenido_origen := 'manual';
    end if;
  elsif new.contenido_cantidad is not null
        and (new.contenido_cantidad, new.contenido_unidad) is distinct from (old.contenido_cantidad, old.contenido_unidad)
        and new.contenido_origen is not distinct from old.contenido_origen then
    new.contenido_origen := 'manual';
  end if;
  if new.contenido_origen = 'manual' and new.contenido_cantidad is not null then
    return new;
  end if;

  select e.cantidad, e.unidad into v_c, v_u from extraer_contenido(new.nombre::text) e;
  if v_c is null then
    select e.cantidad, e.unidad into v_c, v_u from extraer_contenido(new.unidad::text) e;
  end if;
  if v_u = 'ud' and v_c >= 1 and new.cantidad > 0
     and coalesce(lower(btrim(new.unidad::text)), '') ~ '^(|u|ud|uds|unidad|unidades|unid)$'
     and mod(new.cantidad, v_c) = 0 then
    v_c := null;
    v_u := null;
  end if;
  new.contenido_cantidad := v_c;
  new.contenido_unidad := v_u;
  new.contenido_origen := case when v_c is not null then 'texto' end;
  return new;
end;
$function$;

-- ─── Comprobaciones ─────────────────────────────────────────────────────────
do $$
begin
  if not public.cif_control_valido('B06805246') or public.cif_control_valido('B08605246')
     or not public.cif_control_valido('29016276M') or public.cif_control_valido('323288687M') then
    raise exception 'ocr_calidad_extraccion: cif_control_valido no da lo esperado';
  end if;
  if public.proveedor_clave('DISTRIBUCIONES GASTRONÓMICAS NICOLÁS Y VALERO SRL')
     is distinct from public.proveedor_clave('Distribuciones Gastronómicas Nicolás y Valero, S.R.L.') then
    raise exception 'ocr_calidad_extraccion: proveedor_clave no unifica Nicolás y Valero';
  end if;
  if (select e.cantidad from public.extraer_contenido('LEJIA 5L c/3u') e) is distinct from 5 then
    raise exception 'ocr_calidad_extraccion: extraer_contenido(«5L c/3u») no da 5';
  end if;
  if position('20261010160000_ocr_calidad_extraccion' in
              (select prosrc from pg_proc where oid = to_regprocedure('public.validar_cordura_factura(bigint)'))) = 0 then
    raise exception 'ocr_calidad_extraccion: validar_cordura_factura no quedó reescrita';
  end if;
end;
$$;

commit;

select 'ocr_calidad_extraccion: aplicada' as resultado;
