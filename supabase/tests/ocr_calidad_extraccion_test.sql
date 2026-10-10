set client_encoding = 'UTF8';
-- ===========================================================================
-- Test de 20261010160000_ocr_calidad_extraccion. BEGIN … ROLLBACK: no deja
-- nada escrito. Tiene que acabar en «ocr_calidad_extraccion_test: OK».
-- Uso: npx supabase db query --linked -f supabase/tests/ocr_calidad_extraccion_test.sql
-- ===========================================================================
begin;

do $$
declare
  v_id   bigint;
  v_otro bigint;
  v_cif  text;
  r      record;
begin
  -- 1) Dígito de control: casos reales de la revisión del 10/10/2026.
  for r in select * from (values
      ('B06805246', true),  ('B08605246', false), ('B06050246', false), ('B06505246', false), ('B06B05246', false),
      ('F54450895', true),  ('F54650895', false), ('B53363974', true),  ('B55363974', false),
      ('29016276M', true),  ('33288687M', true),  ('323288687M', false), ('46914230-A', true),
      ('B-03191350', true), ('X1234567L', true),  ('X1234567A', false), (null, false)
    ) as t(cif, ok)
  loop
    if public.cif_control_valido(r.cif) is distinct from r.ok then
      raise exception 'cif_control_valido(%) = %, se esperaba %', r.cif, public.cif_control_valido(r.cif), r.ok;
    end if;
  end loop;

  -- 2) Distancia.
  if public.cif_distancia('B06805246', 'B08605246') <> 2 or public.cif_distancia('F54450895', 'F54650895') <> 1
     or public.cif_distancia('B06805246', 'B06805246') <> 0 then
    raise exception 'cif_distancia no da lo esperado';
  end if;

  -- 3) Clave de nombre.
  if public.proveedor_clave('Beneoliva, S. Coop. V.L.') is distinct from public.proveedor_clave('BENEOLIVA, S.COOP. V.L.')
     or public.proveedor_clave('Equipalia Suministros Hosteleros') is distinct from public.proveedor_clave('Suministros Hosteleros Equipalia, S.L.')
     or public.proveedor_clave('SUMINISTROS HOSTELEROS ALTAMIRA, S. L.') is distinct from public.proveedor_clave('Suministros Hosteleros Altamira SL')
     or public.proveedor_clave('Hermanos Narejos') = public.proveedor_clave('Hermanos Pinto') then
    raise exception 'proveedor_clave no da lo esperado';
  end if;

  -- 4) Contenido por envase.
  for r in select * from (values
      ('LEJIA 5L c/3u', 5::numeric, 'l'), ('FREGASUELOS 5 L C/3U', 5, 'l'), ('BOLLO 1/2 KG', 0.5, 'kg'),
      ('TRUFA NEGRA +15 GRS', null, null), ('LANGOSTINO CALIBRE 20/30', null, null),
      ('CEPILLO C/12U', 12, 'ud'), ('cerveza 24x33cl', 7.92, 'l'), ('caja 10 kg', 10, 'kg'), ('ATUN RO-900 1 KG', 1, 'kg')
    ) as t(txt, cant, uni)
  loop
    select e.cantidad, e.unidad into v_otro, v_cif from public.extraer_contenido(r.txt) e;
    if (select e.cantidad from public.extraer_contenido(r.txt) e) is distinct from r.cant
       or (select e.unidad from public.extraer_contenido(r.txt) e) is distinct from r.uni then
      raise exception 'extraer_contenido(%) = (%, %), se esperaba (%, %)', r.txt,
        (select e.cantidad from public.extraer_contenido(r.txt) e), (select e.unidad from public.extraer_contenido(r.txt) e), r.cant, r.uni;
    end if;
  end loop;

  -- 5) proveedor_resolver con fichas de prueba (prefijo a2, se deshacen).
  --    B12345674 es válido; B12354674 (dos cifras traspuestas) no.
  insert into public.proveedores (nombre, cif, origen) values ('A2 Prueba Conservas, S.R.L.', 'B12354674', 'manual')
  returning id into v_id;
  -- Lectura con CIF inválido a distancia 1 de la ficha → la misma ficha, sin tocarla.
  if public.proveedor_resolver('Lo que sea', 'B12354664', false) is distinct from v_id then
    raise exception 'resolver: un CIF inválido a 1 carácter no casa con la ficha';
  end if;
  -- Por clave de nombre, sin CIF.
  if public.proveedor_resolver('A2 PRUEBA CONSERVAS SL', null, false) is distinct from v_id
     or public.proveedor_resolver('Conservas Prueba A2', null, false) is distinct from v_id then
    raise exception 'resolver: no casa por proveedor_clave';
  end if;
  -- Lectura VÁLIDA a 2 caracteres → corrige la ficha y deja el viejo como alias.
  if public.proveedor_resolver('A2 Prueba Conservas', 'B12345674', true) is distinct from v_id then
    raise exception 'resolver: el CIF válido no casa con la ficha de CIF inválido';
  end if;
  select cif_normalizado into v_cif from public.proveedores where id = v_id;
  if v_cif is distinct from 'B12345674' then
    raise exception 'resolver: no corrigió el CIF de la ficha (%)', v_cif;
  end if;
  if public.proveedor_resolver('Otro nombre', 'B12354674', false) is distinct from v_id then
    raise exception 'resolver: el CIF viejo no quedó como alias';
  end if;
  -- Dos CIF VÁLIDOS distintos (B12345674 y B12345682? → el que toque) nunca se casan:
  -- B12345666 no es válido; buscamos uno válido a distancia ≤ 2.
  if public.cif_control_valido('B12345682') and public.proveedor_resolver('Empresa Distinta A2', 'B12345682', false) = v_id then
    raise exception 'resolver: casó dos CIF válidos distintos';
  end if;
  -- Ficha nueva con CIF inválido y lejano → se crea SIN CIF.
  v_otro := public.proveedor_resolver('A2 Empresa Nueva Inventada', 'B11111111', true);
  if v_otro is null or v_otro = v_id
     or (select cif from public.proveedores where id = v_otro) is not null then
    raise exception 'resolver: creó la ficha con un CIF que no supera el control';
  end if;

  -- 6) validar_cordura_factura: el suelo de 0,50 y los avisos de CIF.
  if position('greatest(0.50' in (select prosrc from pg_proc where oid = to_regprocedure('public.validar_cordura_factura(bigint)'))) = 0 then
    raise exception 'validar_cordura_factura sin el suelo de 0,50';
  end if;
  -- Factura real 385 (N. y Valero, líneas 316,23 frente a base 318,05): ahora avisa, si sigue igual.
  if exists (select 1 from public.facturas f where f.id = 385 and f.subtotal = 318.05
              and (select sum(total) from public.productos_factura where factura_id = 385) = 316.23)
     and not exists (select 1 from jsonb_array_elements(public.validar_cordura_factura(385)) a
                      where a ->> 'codigo' = 'descuadre_cabecera') then
    raise exception 'validar_cordura_factura(385) no avisa del embalaje de 1,82';
  end if;
  -- Factura real 389 (CIF B06505246, no supera el control): aviso de CIF.
  if exists (select 1 from public.facturas where id = 389 and public.normalizar_cif(cif) = 'B06505246')
     and not exists (select 1 from jsonb_array_elements(public.validar_cordura_factura(389)) a
                      where a ->> 'codigo' in ('cif_corregido', 'cif_invalido')) then
    raise exception 'validar_cordura_factura(389) no avisa del CIF inválido';
  end if;
end;
$$;

-- 7) Trigger de contenido: «C/15UD» con 15 ud no es contenido; con 1 caja sí.
do $$
declare
  v_f  bigint;
  v_c1 numeric;
  v_c2 numeric;
begin
  select id into v_f from public.facturas order by id desc limit 1;
  if v_f is null then
    return;
  end if;
  insert into public.productos_factura (factura_id, nombre, cantidad, unidad, precio_unitario, total)
  values (v_f, 'A2 CROQUETA C/15UD', 15, 'ud', 0.5, 7.5) returning contenido_cantidad into v_c1;
  insert into public.productos_factura (factura_id, nombre, cantidad, unidad, precio_unitario, total)
  values (v_f, 'A2 HUEVOS CAJA 180U', 1, 'ud', 30, 30) returning contenido_cantidad into v_c2;
  if v_c1 is not null or v_c2 is distinct from 180 then
    raise exception 'trigger de contenido: C/15UD con 15 ud = %, caja 180u con 1 ud = %', v_c1, v_c2;
  end if;
end;
$$;

rollback;

select 'ocr_calidad_extraccion_test: OK' as resultado;
