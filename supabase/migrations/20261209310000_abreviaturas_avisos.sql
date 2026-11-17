-- ============================================================================
-- Avisos de abreviaturas nuevas  ·  20261209310000  (depende de 20261209300000)
-- ----------------------------------------------------------------------------
-- Decisión del dueño: cuando una línea trae una abreviatura que NO está en
-- abreviaturas_proveedor de ese proveedor, el modelo propone a qué corresponde
-- («LP» → Laurent-Perrier) y se pide confirmarla en DOS sitios:
--   a) en la pantalla de subida de Facturas («LP parece Laurent-Perrier.
--      ¿Confirmar?», con Confirmar / Corregir / No es una abreviatura);
--   b) en la campana (notificaciones_dashboard, tipo facturas_abreviatura).
-- Al confirmar o corregir se guarda en abreviaturas_proveedor con origen
-- 'manual' (vale desde ya, sin esperar repeticiones) y se pone al producto
-- enlazado su nombre completo (con la marca delante, vía productos_renombrar).
--
-- 1. abreviaturas_avisos: un aviso por (proveedor, abreviatura), para siempre:
--    confirmado, corregido o descartado no vuelve a avisar.
-- 2. abreviaturas_proponer(items): solo service_role (clasificar-productos).
--    Conservador: ignora tokens genéricos (BOT, CHA, C/6B, CAJA, UD…), las que
--    ya están en el diccionario del proveedor, las que ya tuvieron aviso y las
--    expansiones que no encajan con la abreviatura (iniciales o comienzo).
-- 3. abreviaturas_avisos_pendientes(): los pendientes, con proveedor y producto.
-- 4. abreviaturas_resolver(aviso, accion, expansion): 'confirmar' | 'corregir' |
--    'descartar'. Exige permiso de EDICIÓN en Facturas.
--
-- APLICAR (una a una, nunca `db push`): demo primero (sfonaclosuafvlhutkon);
-- producción solo tras aceptar el PR de la release y con el «sí» del dueño.
-- Tiene que terminar en «abreviaturas_avisos: aplicada».
-- Deshacer: supabase/rollbacks/20261209310000_abreviaturas_avisos_ROLLBACK.sql
-- Pruebas: npm run test:abreviaturas:db (PGlite).
-- ============================================================================

do $$
declare
  v_faltan text[] := '{}';
begin
  if to_regclass('public.abreviaturas_proveedor') is null then v_faltan := v_faltan || 'public.abreviaturas_proveedor (20261209300000)'::text; end if;
  if to_regprocedure('public.abreviaturas_token_generico(text)') is null then v_faltan := v_faltan || 'abreviaturas_token_generico (20261209300000)'::text; end if;
  if to_regclass('public.notificaciones_dashboard') is null then v_faltan := v_faltan || 'public.notificaciones_dashboard'::text; end if;
  if to_regprocedure('public.productos_renombrar(bigint,text)') is null then v_faltan := v_faltan || 'public.productos_renombrar (20261007160000)'::text; end if;
  if to_regprocedure('public.productos_puede_editar()') is null then v_faltan := v_faltan || 'public.productos_puede_editar (20261007160000)'::text; end if;
  if cardinality(v_faltan) > 0 then
    raise exception 'abreviaturas_avisos: faltan %', array_to_string(v_faltan, ', ');
  end if;
end $$;

-- ─── 1. Tabla ───────────────────────────────────────────────────────────────
create table if not exists public.abreviaturas_avisos (
  id               uuid primary key default gen_random_uuid(),
  proveedor_id     bigint not null references public.proveedores(id) on delete cascade,
  abreviatura      text not null check (abreviatura ~ '^[a-z0-9]{2,8}$'),
  propuesta        text not null check (length(propuesta) between 3 and 80),
  texto_linea      text,
  factura_id       bigint,
  producto_id      bigint references public.productos_catalogo(id) on delete set null,
  estado           text not null default 'pendiente' check (estado in ('pendiente', 'confirmada', 'corregida', 'descartada')),
  expansion_final  text,
  notificacion_id  uuid,
  resuelto_por     uuid,
  resuelto_en      timestamptz,
  created_at       timestamptz not null default now(),
  unique (proveedor_id, abreviatura)
);
create index if not exists idx_abreviaturas_avisos_pendientes on public.abreviaturas_avisos (created_at desc) where estado = 'pendiente';
comment on table public.abreviaturas_avisos is
  'Abreviatura nueva de un proveedor propuesta por la IA y pendiente de confirmar (pantalla de subida de Facturas y campana). Un aviso por proveedor y abreviatura.';

alter table public.abreviaturas_avisos enable row level security;
revoke all on public.abreviaturas_avisos from public, anon, authenticated;
grant select on public.abreviaturas_avisos to authenticated;
grant all on public.abreviaturas_avisos to service_role;
drop policy if exists abreviaturas_avisos_select_seccion on public.abreviaturas_avisos;
create policy abreviaturas_avisos_select_seccion on public.abreviaturas_avisos
  for select to authenticated using (public.can_read_section('facturas'));
drop policy if exists abreviaturas_avisos_service_role on public.abreviaturas_avisos;
create policy abreviaturas_avisos_service_role on public.abreviaturas_avisos
  for all to service_role using (true) with check (true);

-- ─── 2. ¿Encaja la expansión con la abreviatura? ────────────────────────────
-- Iniciales de las palabras (sin partículas) o comienzo de la primera palabra (3+ letras).
create or replace function public.abreviaturas_es_plausible(p_abreviatura text, p_expansion text)
returns boolean
language plpgsql
immutable
set search_path = public
as $$
declare
  v_ini  text := '';
  v_p    text;
  v_pn   text;
  v_first text;
  v_part constant text[] := array['de','del','la','el','los','las','y','e','i','the','le','les','du','des','da','do','di','von','van','of'];
begin
  if p_abreviatura is null or p_expansion is null then return false; end if;
  for v_p in select x from regexp_split_to_table(btrim(p_expansion), '[\s\-]+') x loop
    v_pn := lower(translate(regexp_replace(v_p, '[^[:alpha:]]', '', 'g'), 'áéíóúüñÁÉÍÓÚÜÑ', 'aeiouunaeiouun'));
    if length(v_pn) < 2 or v_pn = any (v_part) then continue; end if;
    if v_first is null then v_first := v_pn; end if;
    v_ini := v_ini || left(v_pn, 1);
  end loop;
  return v_ini = p_abreviatura
      or (length(p_abreviatura) >= 3 and v_first is not null and left(v_first, length(p_abreviatura)) = p_abreviatura
          and length(v_first) > length(p_abreviatura));
end;
$$;

-- ─── 3. Proponer (clasificar-productos) ─────────────────────────────────────
create or replace function public.abreviaturas_proponer(p_items jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  it        jsonb;
  v_prov    bigint;
  v_ab      text;
  v_prop    text;
  v_texto   text;
  v_prod    bigint;
  v_fact    bigint;
  v_id      uuid;
  v_notif   uuid;
  v_nprov   text;
  v_creados integer := 0;
  v_ign     integer := 0;
begin
  if jsonb_typeof(p_items) is distinct from 'array' then
    raise exception 'p_items tiene que ser una lista' using errcode = '22023';
  end if;
  for it in select value from jsonb_array_elements(p_items) loop
    v_prov := case when jsonb_typeof(it->'proveedor_id') = 'number' then (it->>'proveedor_id')::bigint end;
    v_ab := lower(btrim(coalesce(it->>'abreviatura', '')));
    v_prop := btrim(regexp_replace(coalesce(it->>'propuesta', ''), '\s+', ' ', 'g'));
    v_texto := left(it->>'texto', 500);
    if v_prov is null or v_ab !~ '^[a-z]{2,6}$' or public.abreviaturas_token_generico(v_ab)
       or length(v_prop) not between 3 and 80 or not public.abreviaturas_es_plausible(v_ab, v_prop)
       or not exists (select 1 from public.proveedores where id = v_prov)
       or exists (select 1 from public.abreviaturas_proveedor a where a.proveedor_id = v_prov and a.abreviatura = v_ab)
       or exists (select 1 from public.abreviaturas_avisos x where x.proveedor_id = v_prov and x.abreviatura = v_ab) then
      v_ign := v_ign + 1;
      continue;
    end if;
    select a.producto_id into v_prod from public.productos_alias a where a.texto_normalizado = v_texto;
    select pf.factura_id into v_fact
      from public.productos_factura pf join public.facturas f on f.id = pf.factura_id
     where f.proveedor_id = v_prov and pf.nombre_normalizado = v_texto
     order by pf.id desc limit 1;
    insert into public.abreviaturas_avisos (proveedor_id, abreviatura, propuesta, texto_linea, factura_id, producto_id)
    values (v_prov, v_ab, v_prop, v_texto, v_fact, v_prod)
    on conflict (proveedor_id, abreviatura) do nothing
    returning id into v_id;
    if v_id is null then v_ign := v_ign + 1; continue; end if;
    v_creados := v_creados + 1;
    begin
      select nombre into v_nprov from public.proveedores where id = v_prov;
      insert into public.notificaciones_dashboard (tipo, titulo, mensaje, referencia_id, referencia_tipo, prioridad, clave, datos)
      values (
        'facturas_abreviatura',
        left('«' || upper(v_ab) || '» parece ' || v_prop || '. ¿Confirmar?', 200),
        left(coalesce(v_nprov, 'Proveedor') || ' · línea «' || coalesce(v_texto, '') || '». Confírmala o corrígela en Facturas › Cargar.', 300),
        v_id, 'facturas_cargar', 'normal', 'abreviatura:' || v_prov || ':' || v_ab,
        jsonb_build_object('enlace', '/facturas?tab=cargar', 'aviso_id', v_id, 'proveedor_id', v_prov, 'abreviatura', v_ab, 'propuesta', v_prop)
      ) returning id into v_notif;
      update public.abreviaturas_avisos set notificacion_id = v_notif where id = v_id;
    exception when others then
      raise warning 'abreviaturas_proponer: aviso en la campana no creado (%)', sqlerrm;
    end;
    v_id := null;
  end loop;
  return jsonb_build_object('avisos_creados', v_creados, 'ignoradas', v_ign);
end;
$$;
revoke all on function public.abreviaturas_proponer(jsonb) from public, anon, authenticated;
grant execute on function public.abreviaturas_proponer(jsonb) to service_role;

-- ─── 4. Pendientes para la pantalla de subida ───────────────────────────────
create or replace function public.abreviaturas_avisos_pendientes()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not coalesce(public.can_read_section('facturas'), false) then
    raise exception 'sin_permiso' using errcode = '42501';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'id', x.id, 'proveedor_id', x.proveedor_id, 'proveedor', p.nombre, 'abreviatura', x.abreviatura,
             'propuesta', x.propuesta, 'texto_linea', x.texto_linea, 'producto_id', x.producto_id,
             'producto', c.nombre, 'created_at', x.created_at) order by x.created_at desc)
      from (select * from public.abreviaturas_avisos where estado = 'pendiente' order by created_at desc limit 50) x
      join public.proveedores p on p.id = x.proveedor_id
      left join public.productos_catalogo c on c.id = x.producto_id), '[]'::jsonb);
end;
$$;
revoke all on function public.abreviaturas_avisos_pendientes() from public, anon;
grant execute on function public.abreviaturas_avisos_pendientes() to authenticated, service_role;

-- ─── 5. Resolver: confirmar / corregir / descartar ──────────────────────────
create or replace function public.abreviaturas_resolver(p_aviso uuid, p_accion text, p_expansion text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_av      public.abreviaturas_avisos%rowtype;
  v_exp     text;
  v_estado  text;
  v_nombre  text;
  v_nuevo   text;
  v_toks    text[];
  v_renombrado boolean := false;
  v_motivo  text;
begin
  if not public.productos_puede_editar() then
    raise exception 'Resolver abreviaturas exige permiso de edición en Facturas' using errcode = '42501';
  end if;
  if p_accion not in ('confirmar', 'corregir', 'descartar') then
    raise exception 'acción no válida: %', p_accion using errcode = '22023';
  end if;
  select * into v_av from public.abreviaturas_avisos where id = p_aviso for update;
  if not found then raise exception 'No existe el aviso' using errcode = 'P0002'; end if;
  if v_av.estado <> 'pendiente' then
    return jsonb_build_object('ya_resuelto', true, 'estado', v_av.estado, 'expansion', v_av.expansion_final);
  end if;

  if p_accion = 'descartar' then
    v_estado := 'descartada';
  else
    v_exp := case p_accion when 'confirmar' then v_av.propuesta else btrim(regexp_replace(coalesce(p_expansion, ''), '\s+', ' ', 'g')) end;
    if length(v_exp) not between 3 and 80 then
      raise exception 'La expansión tiene que tener entre 3 y 80 caracteres' using errcode = '22023';
    end if;
    v_estado := case p_accion when 'confirmar' then 'confirmada' else 'corregida' end;
    insert into public.abreviaturas_proveedor (proveedor_id, abreviatura, expansion, origen, veces, en_nombre)
    values (v_av.proveedor_id, v_av.abreviatura, v_exp, 'manual', 1, false)
    on conflict (proveedor_id, abreviatura, expansion_clave) do update
      set origen = 'manual', expansion = excluded.expansion, ultima_vez = now();

    -- El producto enlazado pasa a llevar la marca completa (nunca la abreviatura).
    if v_av.producto_id is not null then
      select nombre into v_nombre from public.productos_catalogo where id = v_av.producto_id;
      if v_nombre is not null then
        v_toks := regexp_split_to_array(public.normalizar_texto(v_nombre), '[^a-z0-9]+');
        if v_toks[1] = v_av.abreviatura then
          v_nuevo := v_exp || ' ' || btrim(regexp_replace(v_nombre, '^\s*[^\s]+\s*', ''));
        elsif position(' ' || btrim(regexp_replace(public.normalizar_texto(v_exp), '[^a-z0-9]+', ' ', 'g')) || ' '
                       in ' ' || btrim(regexp_replace(public.normalizar_texto(v_nombre), '[^a-z0-9]+', ' ', 'g')) || ' ') > 0 then
          v_nuevo := v_nombre;          -- ya lleva la marca
        else
          v_nuevo := v_exp || ' ' || v_nombre;
        end if;
        v_nuevo := left(btrim(v_nuevo), 200);
        if v_nuevo <> v_nombre then
          begin
            perform public.productos_renombrar(v_av.producto_id, v_nuevo);
            v_renombrado := true;
          exception when others then
            v_motivo := sqlerrm;        -- p. ej. ya existe un producto con ese nombre
          end;
        end if;
      end if;
    end if;
  end if;

  update public.abreviaturas_avisos
     set estado = v_estado, expansion_final = v_exp, resuelto_por = (select auth.uid()), resuelto_en = now()
   where id = p_aviso;
  if v_av.notificacion_id is not null then
    update public.notificaciones_dashboard set leida = true, caduca_en = least(coalesce(caduca_en, now()), now())
     where id = v_av.notificacion_id;
  end if;
  return jsonb_build_object('estado', v_estado, 'expansion', v_exp, 'producto_id', v_av.producto_id,
                            'producto_renombrado', v_renombrado, 'nombre_producto', coalesce(v_nuevo, v_nombre), 'motivo', v_motivo);
end;
$$;
revoke all on function public.abreviaturas_resolver(uuid, text, text) from public, anon;
grant execute on function public.abreviaturas_resolver(uuid, text, text) to authenticated, service_role;

do $$ begin raise notice 'abreviaturas_avisos: aplicada'; end $$;
