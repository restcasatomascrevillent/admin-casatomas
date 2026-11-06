set client_encoding = 'UTF8';
-- ===========================================================================
-- 20261106510000_permisos_facturas_subida — Facturas: «Ver» solo consulta y
-- permiso nuevo «Facturas · Subida» (06/11/2026)
-- ===========================================================================
-- Decisiones del dueño (06/11/2026):
--   1. «Ver» en Facturas = solo CONSULTAR Análisis y Compras. Ni subir, ni
--      corregir, ni clasificar, ni la IA. Todo eso, con «Editar».
--   2. Permiso nuevo 'facturas_subida' («Facturas · Subida» en Usuarios, un
--      solo interruptor: «Puede subir», guardado en can_view). Va por libre
--      (no necesita «Ver»): subir facturas y albaranes, ver su progreso,
--      decidir sobre los duplicados y CORREGIR LOS DATOS LEÍDOS DE LO QUE HA
--      SUBIDO ÉL (no lo de otros).
--   3. El servidor lo hace cumplir. Escribir en las tablas de Facturas, solo
--      con «Editar» (can_write_section('facturas'), que ya mira can_edit desde
--      20261002164236), salvo lo de la subida, que también se permite con
--      'facturas_subida' y solo sobre lo propio.
--
-- No hay lista ni CHECK de claves de sección en la BD: has_section_permission
-- vale para cualquier clave. El super admin, siempre.
--
-- QUÉ HACE (idempotente; se puede aplicar dos veces)
--   * facturas_puede_subir() / facturas_puede_subir_usuario(uuid): «Editar»
--     en Facturas, o 'facturas_subida' (can_view o can_edit).
--   * facturas.subido_por (uuid, default auth.uid(), FK a auth.users ON DELETE
--     SET NULL): quién subió el documento. Las Edge Functions insertan con la
--     service role (auth.uid() nulo), así que un trigger BEFORE INSERT lo toma
--     de ocr_trabajos.creado_por (facturas.ocr_trabajo_id). Se rellena lo que
--     ya hay con el mismo criterio (solo las que tienen trabajo de OCR; las
--     históricas quedan sin dueño = solo las corrige quien tiene «Editar»).
--   * RLS, lo nuevo (lo que había para «Ver» y «Editar» no cambia):
--       facturas            SELECT y UPDATE de las suyas con 'subida'.
--       productos_factura   SELECT, UPDATE e INSERT en líneas de las suyas.
--                           Sin DELETE (no hay botón de borrar líneas).
--       ocr_trabajos        SELECT de sus trabajos (la cola de «Cargar»).
--       ocr_trabajo_paginas SELECT de las páginas de sus trabajos.
--     Y un trigger que, a quien NO tiene «Editar», solo le deja cambiar los
--     datos leídos: en la cabecera proveedor, CIF, número, fecha, importes,
--     retención y observaciones; en las líneas nombre, cantidad, unidad,
--     precios, total, bultos, IVA y descuento. Ni verificar, ni clasificar
--     (producto_id), ni mover líneas, ni cambiar subido_por.
--   * Storage (facturas-originales):
--       pendientes/{uid}/  INSERT con facturas_puede_subir() (antes, «Ver»).
--       SELECT de lo suyo (sus pendientes y el original de sus documentos)
--       con 'subida'. «Ver» sigue leyendo todos los originales.
--   * IA de Facturas solo con «Editar»: la lectura del historial del chat
--     (conversaciones, mensajes_chat, n8n_chat_histories) pasa de «Ver» a
--     «Editar»; escribir ya lo exigía. chat-facturas exige «Editar».
--   * ocr_resumen_factura(id): con «Ver», o con 'subida' si el documento es
--     suyo (lo relee «Cargar» al decidir sobre un duplicado).
--
-- LO QUE NO SE TOCA
--   * ocr_descartar_trabajo y ocr_reintentar_trabajo: ya dejan al dueño del
--     trabajo (creado_por) y a quien tiene «Editar». Sin cambios.
--   * Proveedores, productos, categorías, configuración, avisos de precio y el
--     resto de RPC de escritura: ya exigen «Editar» (can_write_section o
--     productos_puede_editar / proveedores_puede_editar). Sin cambios.
--   * Las fijadas del tablero y «Personalizar» se guardan por usuario
--     (localStorage y dashboard_config, RLS «cada uno la suya»): no son datos
--     compartidos y se permiten con «Ver».
--   * La política restrictiva «acceso_panel_no_bloqueado» sigue en todas.
--
-- QUIEN HOY SUBE CON SOLO «VER» DEJA DE PODER SUBIR (decisión 1). No se le da
-- 'facturas_subida' de oficio: hay que dárselo en Usuarios a quien lo necesite.
--
-- APLICAR (una a una, nunca `db push`): demo primero (sfonaclosuafvlhutkon);
-- producción (haqmmdfdzzatdnrrcgez) solo tras aceptar el PR y con el «sí» del
-- dueño, A LA VEZ que se despliegan procesar-factura, chat-facturas y
-- buscar-precios-mercado y se publica el panel:
--   supabase db query --linked -f supabase/migrations/20261106510000_permisos_facturas_subida.sql
-- Tiene que terminar en «permisos_facturas_subida: aplicada | …».
-- Deshacer: supabase/rollbacks/20261106510000_permisos_facturas_subida_ROLLBACK.sql
-- Pruebas (PGlite): npm run test:permisos-facturas-subida:db
-- ===========================================================================

begin;
set local lock_timeout = '5s';

-- ─── 0. Comprobaciones previas (no cambian nada) ────────────────────────────
do $$
declare
  v_faltan text[] := '{}';
begin
  if to_regclass('public.facturas') is null then v_faltan := v_faltan || 'public.facturas'::text; end if;
  if to_regclass('public.productos_factura') is null then v_faltan := v_faltan || 'public.productos_factura'::text; end if;
  if to_regclass('public.ocr_trabajos') is null then v_faltan := v_faltan || 'public.ocr_trabajos'::text; end if;
  if to_regclass('public.ocr_trabajo_paginas') is null then v_faltan := v_faltan || 'public.ocr_trabajo_paginas'::text; end if;
  if to_regclass('storage.objects') is null then v_faltan := v_faltan || 'storage.objects'::text; end if;
  if to_regprocedure('public.has_section_permission(uuid, text, text)') is null then
    v_faltan := v_faltan || 'has_section_permission(uuid, text, text)'::text;
  end if;
  if to_regprocedure('public.can_read_section(text)') is null then v_faltan := v_faltan || 'can_read_section(text)'::text; end if;
  if to_regprocedure('public.can_write_section(text)') is null then v_faltan := v_faltan || 'can_write_section(text)'::text; end if;
  if to_regprocedure('public.ocr_resumen_factura_datos(bigint)') is null then
    v_faltan := v_faltan || 'ocr_resumen_factura_datos(bigint) (migración 20261010150000)'::text;
  end if;
  if not exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'facturas' and column_name = 'ocr_trabajo_id') then
    v_faltan := v_faltan || 'facturas.ocr_trabajo_id (migración 20261005120000)'::text;
  end if;
  if not exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'ocr_trabajos' and column_name = 'creado_por') then
    v_faltan := v_faltan || 'ocr_trabajos.creado_por'::text;
  end if;
  -- can_write_section tiene que mirar can_edit (20261002164236): si mirase
  -- can_view, «Ver» seguiría escribiendo en todo Facturas.
  if to_regprocedure('public.can_write_section(text)') is not null
     and (select prosrc from pg_proc where oid = 'public.can_write_section(text)'::regprocedure) not like '%''edit''%' then
    v_faltan := v_faltan || 'can_write_section que exija «Editar» (20261002164236)'::text;
  end if;
  if cardinality(v_faltan) > 0 then
    raise exception 'permisos_facturas_subida: MIGRACIÓN ABORTADA, falta %. No se ha cambiado nada.', array_to_string(v_faltan, ', ');
  end if;
end;
$$;

-- ─── 1. ¿Puede subir? ───────────────────────────────────────────────────────
create or replace function public.facturas_puede_subir_usuario(_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  -- 20261106510000_permisos_facturas_subida. Super admin: has_section_permission ya da true.
  select _user_id is not null and (
       coalesce(public.has_section_permission(_user_id, 'facturas', 'edit'), false)
    or coalesce(public.has_section_permission(_user_id, 'facturas_subida', 'view'), false)
    or coalesce(public.has_section_permission(_user_id, 'facturas_subida', 'edit'), false))
$$;
comment on function public.facturas_puede_subir_usuario(uuid) is
  'Puede subir facturas y albaranes: «Editar» en Facturas o el permiso «Facturas · Subida» (facturas_subida). 20261106510000.';

create or replace function public.facturas_puede_subir()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.facturas_puede_subir_usuario((select auth.uid()))
$$;
comment on function public.facturas_puede_subir() is
  'RLS: el usuario actual puede subir facturas (facturas_puede_subir_usuario). 20261106510000.';

revoke all on function public.facturas_puede_subir_usuario(uuid) from public, anon;
revoke all on function public.facturas_puede_subir() from public, anon;
grant execute on function public.facturas_puede_subir_usuario(uuid) to authenticated, service_role;
grant execute on function public.facturas_puede_subir() to authenticated, service_role;

-- ─── 2. Quién subió cada documento ──────────────────────────────────────────
alter table public.facturas add column if not exists subido_por uuid default auth.uid();
alter table public.facturas alter column subido_por set default auth.uid();
comment on column public.facturas.subido_por is
  'Quién subió el documento (auth.users). Con «Facturas · Subida» solo se corrige lo propio. 20261106510000.';

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'facturas_subido_por_fkey' and conrelid = 'public.facturas'::regclass) then
    alter table public.facturas
      add constraint facturas_subido_por_fkey foreign key (subido_por) references auth.users(id) on delete set null;
  end if;
end;
$$;
create index if not exists idx_facturas_subido_por on public.facturas (subido_por) where subido_por is not null;

-- Las Edge Functions insertan con la service role: el dueño es el del trabajo de OCR.
create or replace function public.facturas_rellenar_subido_por()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
-- 20261106510000_permisos_facturas_subida
begin
  if new.subido_por is null and new.ocr_trabajo_id is not null then
    select t.creado_por into new.subido_por from public.ocr_trabajos t where t.id = new.ocr_trabajo_id;
  end if;
  return new;
end;
$$;
revoke all on function public.facturas_rellenar_subido_por() from public, anon, authenticated;

drop trigger if exists trg_00_facturas_subido_por on public.facturas;
create trigger trg_00_facturas_subido_por
  before insert on public.facturas
  for each row execute function public.facturas_rellenar_subido_por();

-- Lo que ya hay: el creador del trabajo de OCR que lo guardó.
update public.facturas f
   set subido_por = t.creado_por
  from public.ocr_trabajos t
 where t.id = f.ocr_trabajo_id
   and f.subido_por is null
   and t.creado_por is not null
   and exists (select 1 from auth.users u where u.id = t.creado_por);

-- ─── 3. Ayudas para la RLS (una fila; SECURITY DEFINER para no anidar RLS) ──
create or replace function public.factura_subida_por_mi(p_factura_id bigint)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select (select auth.uid()) is not null and exists (
    select 1 from public.facturas f where f.id = p_factura_id and f.subido_por = (select auth.uid()))
$$;

create or replace function public.ocr_trabajo_es_mio(p_trabajo_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select (select auth.uid()) is not null and exists (
    select 1 from public.ocr_trabajos t where t.id = p_trabajo_id and t.creado_por = (select auth.uid()))
$$;

-- Un objeto de facturas-originales es «mío»: bajo pendientes/{mi uid}/ o el original de un documento que subí.
create or replace function public.factura_original_es_mio(p_nombre text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select (select auth.uid()) is not null and p_nombre is not null and (
       p_nombre like 'pendientes/' || (select auth.uid())::text || '/%'
    or exists (select 1 from public.facturas f where f.archivo_path = p_nombre and f.subido_por = (select auth.uid())))
$$;

revoke all on function public.factura_subida_por_mi(bigint) from public, anon;
revoke all on function public.ocr_trabajo_es_mio(uuid) from public, anon;
revoke all on function public.factura_original_es_mio(text) from public, anon;
grant execute on function public.factura_subida_por_mi(bigint) to authenticated, service_role;
grant execute on function public.ocr_trabajo_es_mio(uuid) to authenticated, service_role;
grant execute on function public.factura_original_es_mio(text) to authenticated, service_role;

-- ─── 4. Quien no tiene «Editar»: solo los datos leídos ──────────────────────
-- SECURITY INVOKER a propósito: current_user es quien escribe. La service role
-- (Edge Functions), las funciones SECURITY DEFINER (con sus propias
-- comprobaciones) y lo que escriben otros triggers (pg_trigger_depth() > 1:
-- alertas, autoverificación) pasan; quien tiene «Editar», también.
create or replace function public.facturas_subida_solo_lo_leido()
returns trigger
language plpgsql
set search_path = public
as $$
-- 20261106510000_permisos_facturas_subida
declare
  c_cabecera constant text[] := array['proveedor', 'cif', 'numero_documento', 'fecha', 'subtotal', 'iva', 'total',
                                       'total_origen', 'observaciones', 'retencion_irpf', 'retencion_irpf_pct', 'updated_at'];
  c_lineas constant text[] := array['nombre', 'cantidad', 'unidad', 'precio_unitario', 'total', 'bultos', 'iva_pct',
                                     'descuento_pct'];
  v_libres text[];
  v_generadas text[];
begin
  if pg_trigger_depth() > 1 or current_user not in ('authenticated', 'anon') then
    return new;
  end if;
  if coalesce(public.can_write_section('facturas'), false) then
    return new;
  end if;

  if tg_op = 'INSERT' then
    -- Añadir una línea a un documento propio (la RLS ya mira que sea suyo):
    -- sin clasificarla, eso es de «Editar» (el producto lo asigna el trigger).
    if tg_table_name = 'productos_factura' and (to_jsonb(new) ->> 'producto_id') is not null then
      raise exception 'Clasificar una línea exige «Editar» en Facturas.' using errcode = '42501';
    end if;
    return new;
  end if;

  v_libres := case when tg_table_name = 'facturas' then c_cabecera else c_lineas end;
  -- Las columnas generadas no se comparan: en un BEFORE aún no están calculadas.
  select coalesce(array_agg(a.attname::text), '{}') into v_generadas
    from pg_attribute a
   where a.attrelid = tg_relid and a.attnum > 0 and not a.attisdropped and a.attgenerated <> '';

  if (to_jsonb(new) - v_libres - v_generadas) is distinct from (to_jsonb(old) - v_libres - v_generadas) then
    raise exception 'Con «Facturas · Subida» solo puedes corregir los datos leídos (proveedor, número, fecha, importes y líneas) de lo que has subido tú. Verificar, clasificar y lo demás exige «Editar» en Facturas.'
      using errcode = '42501';
  end if;
  return new;
end;
$$;
revoke all on function public.facturas_subida_solo_lo_leido() from public, anon;

-- «trg_00_…»: los BEFORE van por orden alfabético; este va antes que los que
-- recalculan columnas (asignar proveedor/producto, unidad, contenido, updated_at).
drop trigger if exists trg_00_facturas_subida_solo_lo_leido on public.facturas;
create trigger trg_00_facturas_subida_solo_lo_leido
  before update on public.facturas
  for each row execute function public.facturas_subida_solo_lo_leido();

drop trigger if exists trg_00_productos_factura_subida_solo_lo_leido on public.productos_factura;
create trigger trg_00_productos_factura_subida_solo_lo_leido
  before insert or update on public.productos_factura
  for each row execute function public.facturas_subida_solo_lo_leido();

-- ─── 5. RLS: lo propio con «Facturas · Subida» ──────────────────────────────
drop policy if exists facturas_select_subida on public.facturas;
create policy facturas_select_subida on public.facturas for select to authenticated
  using ((select public.facturas_puede_subir()) and subido_por = (select auth.uid()));

drop policy if exists facturas_update_subida on public.facturas;
create policy facturas_update_subida on public.facturas for update to authenticated
  using ((select public.facturas_puede_subir()) and subido_por = (select auth.uid()))
  with check ((select public.facturas_puede_subir()) and subido_por = (select auth.uid()));

drop policy if exists productos_factura_select_subida on public.productos_factura;
create policy productos_factura_select_subida on public.productos_factura for select to authenticated
  using ((select public.facturas_puede_subir()) and public.factura_subida_por_mi(factura_id));

drop policy if exists productos_factura_update_subida on public.productos_factura;
create policy productos_factura_update_subida on public.productos_factura for update to authenticated
  using ((select public.facturas_puede_subir()) and public.factura_subida_por_mi(factura_id))
  with check ((select public.facturas_puede_subir()) and public.factura_subida_por_mi(factura_id));

drop policy if exists productos_factura_insert_subida on public.productos_factura;
create policy productos_factura_insert_subida on public.productos_factura for insert to authenticated
  with check ((select public.facturas_puede_subir()) and public.factura_subida_por_mi(factura_id));

drop policy if exists ocr_trabajos_select_subida on public.ocr_trabajos;
create policy ocr_trabajos_select_subida on public.ocr_trabajos for select to authenticated
  using ((select public.facturas_puede_subir()) and creado_por = (select auth.uid()));

drop policy if exists ocr_paginas_select_subida on public.ocr_trabajo_paginas;
create policy ocr_paginas_select_subida on public.ocr_trabajo_paginas for select to authenticated
  using ((select public.facturas_puede_subir()) and public.ocr_trabajo_es_mio(trabajo_id));

-- ─── 6. Storage: subir exige poder subir; lo propio se lee con «Subida» ─────
drop policy if exists facturas_originales_pendientes_insert on storage.objects;
create policy facturas_originales_pendientes_insert on storage.objects for insert to authenticated
  with check (
    bucket_id = 'facturas-originales'
    and (storage.foldername(name))[1] = 'pendientes'
    and (storage.foldername(name))[2] = (select auth.uid())::text
    and (select public.facturas_puede_subir())
  );

drop policy if exists facturas_originales_select_subida on storage.objects;
create policy facturas_originales_select_subida on storage.objects for select to authenticated
  using (
    bucket_id = 'facturas-originales'
    and (select public.facturas_puede_subir())
    and public.factura_original_es_mio(name)
  );

-- ─── 7. IA de Facturas solo con «Editar»: el historial del chat ─────────────
do $$
declare
  v record;
begin
  for v in
    select * from (values
      ('conversaciones', 'conversaciones_select_seccion'),
      ('mensajes_chat', 'mensajes_chat_select_seccion'),
      ('n8n_chat_histories', 'n8n_chat_histories_select_seccion')) as x(tabla, politica)
  loop
    if to_regclass('public.' || v.tabla) is not null then
      execute format('drop policy if exists %I on public.%I', v.politica, v.tabla);
      execute format('create policy %I on public.%I for select to authenticated using ((select public.can_write_section(''facturas'')))',
                     v.politica, v.tabla);
    end if;
  end loop;
end;
$$;

-- ─── 8. ocr_resumen_factura: también lo propio con «Subida» ─────────────────
create or replace function public.ocr_resumen_factura(p_factura_id bigint)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
-- 20261010150000_ocr_paginas_duplicados: lo que relee el panel al abrir
-- «Sustituir la existente» / «Añadir como página» (no la foto vieja).
-- 20261106510000_permisos_facturas_subida: con «Ver», o con «Facturas · Subida»
-- si el documento es suyo.
begin
  if not (coalesce(public.can_read_section('facturas'), false)
          or (coalesce(public.facturas_puede_subir(), false) and public.factura_subida_por_mi(p_factura_id))) then
    raise exception 'Sin permiso para ver facturas' using errcode = '42501';
  end if;
  return public.ocr_resumen_factura_datos(p_factura_id) - 'totales_lineas';
end;
$function$;
comment on function public.ocr_resumen_factura(bigint) is
  'Estado ACTUAL de una factura para el diálogo de «Sustituir» / «Añadir como página». Con «Ver» en Facturas, o con '
  '«Facturas · Subida» si el documento es suyo. 20261106510000.';
revoke all on function public.ocr_resumen_factura(bigint) from public, anon;
grant execute on function public.ocr_resumen_factura(bigint) to authenticated, service_role;

-- ─── 9. Comprobación final: nada reabre la escritura por OR ─────────────────
do $$
declare
  v_malos text[] := '{}';
  v_pol record;
begin
  for v_pol in
    select tablename, policyname, cmd
      from pg_policies
     where schemaname = 'public'
       and tablename in ('facturas', 'productos_factura')
       and permissive = 'PERMISSIVE'
       and roles && array['authenticated', 'public', 'anon']::name[]
       and cmd <> 'SELECT'
       and policyname <> all (array['facturas_insert_seccion', 'facturas_update_seccion', 'facturas_delete_seccion',
                                     'facturas_update_subida',
                                     'productos_factura_insert_seccion', 'productos_factura_update_seccion',
                                     'productos_factura_delete_seccion',
                                     'productos_factura_update_subida', 'productos_factura_insert_subida'])
  loop
    v_malos := v_malos || format('política que sobra en %s: %s (%s)', v_pol.tablename, v_pol.policyname, v_pol.cmd);
  end loop;
  if exists (select 1 from pg_roles where rolname = 'anon')
     and has_function_privilege('anon', 'public.facturas_puede_subir()', 'EXECUTE') then
    v_malos := v_malos || 'anon puede ejecutar facturas_puede_subir()'::text;
  end if;
  if cardinality(v_malos) > 0 then
    raise exception 'permisos_facturas_subida: comprobación final fallida (%). No se ha aplicado nada.', array_to_string(v_malos, '; ');
  end if;
end;
$$;

commit;

select 'permisos_facturas_subida: aplicada'
       || ' | documentos con dueño ' || (select count(*) from public.facturas where subido_por is not null)
       || ' de ' || (select count(*) from public.facturas)
       || ' | usuarios con «Facturas · Subida» ' || (select count(*) from public.user_permissions
                                                     where section_key = 'facturas_subida' and (can_view or can_edit))
       as resultado;
