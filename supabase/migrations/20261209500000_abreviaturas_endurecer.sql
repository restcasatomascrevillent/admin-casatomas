-- ============================================================================
-- Abreviaturas: reglas más estrictas, lista de exclusión y «No es»  ·  20261209500000
--   (depende de 20261209300000 y 20261209310000)
-- ----------------------------------------------------------------------------
-- PROBLEMA (revisión del 17/11/2026, B2)
--   abreviaturas_recalcular() sobre producción aprendía 2 falsas de 11:
--     cs = «Cs-Salchichon»      (sale de un alias: «cs-salchichon pieza…»)
--     sm = «Smoothie de mango,» (el nombre entero de un producto, con la coma)
--   y no había forma de quitarlas sin SQL como service_role.
--
-- QUÉ HACE (idempotente)
--   1. abreviaturas_expansion_valida(texto): la expansión tiene que parecer una MARCA o un
--      nombre propio: solo letras, espacio, guion, «&» y apóstrofo (sin comas, números ni
--      puntos), de 1 a 2 palabras y cada trozo con 3 letras o más y sin palabras de familia
--      o envase («Whisky», «Reserva»…). «Laurent Perrier», «Fever-Tree», «Juve&Camps»,
--      «Dom Pérignon» pasan; «Cs-Salchichon», «Smoothie de mango,» no.
--   2. abreviaturas_excluidas: lista EDITABLE de lo que no se debe aprender (por proveedor o
--      para todos, con una expansión concreta o con cualquiera). Se llena con «No es» y por
--      SQL (service_role). abreviaturas_excluida() la consulta.
--   3. abreviaturas_observar_linea y abreviaturas_proponer pasan por las dos cosas.
--   4. abreviaturas_listar() y abreviaturas_quitar(id): para el botón «No es» del panel
--      (Facturas › Cargar › Abreviaturas aprendidas). Quitar borra la fila y la añade a la lista
--      de exclusión, así abreviaturas_recalcular() no la vuelve a aprender. Exige permiso de
--      EDICIÓN en Facturas.
--
-- No cambia lo ya aprendido: para limpiar lo existente, `select public.abreviaturas_recalcular();`.
--
-- APLICAR (una a una, nunca `db push`): demo primero (sfonaclosuafvlhutkon); producción solo
-- tras aceptar el PR de la release y con el «sí» del dueño. Termina en «abreviaturas_endurecer: aplicada».
-- Deshacer: supabase/rollbacks/20261209500000_abreviaturas_endurecer_ROLLBACK.sql
-- Pruebas: npm run test:abreviaturas-endurecer:db (PGlite).
-- ============================================================================

do $$
declare
  v_faltan text[] := '{}';
begin
  if to_regclass('public.abreviaturas_proveedor') is null then v_faltan := v_faltan || 'public.abreviaturas_proveedor (20261209300000)'::text; end if;
  if to_regprocedure('public.abreviaturas_observar_linea(text,bigint,bigint,integer)') is null then v_faltan := v_faltan || 'abreviaturas_observar_linea (20261209300000)'::text; end if;
  if to_regprocedure('public.abreviaturas_proponer(jsonb)') is null then v_faltan := v_faltan || 'abreviaturas_proponer (20261209310000)'::text; end if;
  if to_regprocedure('public.productos_puede_editar()') is null then v_faltan := v_faltan || 'public.productos_puede_editar (20261007160000)'::text; end if;
  if cardinality(v_faltan) > 0 then
    raise exception 'abreviaturas_endurecer: faltan %', array_to_string(v_faltan, ', ');
  end if;
end $$;

-- ─── 1. Clave de expansión y validación ─────────────────────────────────────
create or replace function public.abreviaturas_clave(p text)
returns text
language sql
immutable
set search_path = public
as $$
  select btrim(regexp_replace(lower(translate(coalesce(p, ''), 'áéíóúüñÁÉÍÓÚÜÑ', 'aeiouunaeiouun')), '[^a-z0-9]+', ' ', 'g'))
$$;

create or replace function public.abreviaturas_expansion_valida(p text)
returns boolean
language plpgsql
stable
set search_path = public
as $$
declare
  v_trozo text;
  v_n     integer := 0;
begin
  if p is null or length(btrim(p)) not between 3 and 80 then return false; end if;
  -- Solo letras, espacio, guion, «&» y apóstrofo: nada de comas, números ni puntos.
  if p !~ '^[[:alpha:]][[:alpha:] ''&-]*[[:alpha:]]$' then return false; end if;
  -- Como mucho 2 palabras (el guion une: «Fever-Tree» es una; «&» no cuenta).
  for v_trozo in select x from regexp_split_to_table(btrim(p), '\s+') x where x <> '&' loop
    v_n := v_n + 1;
  end loop;
  if v_n > 2 then return false; end if;
  -- Cada trozo, 3 letras o más y que no sea de familia o envase («Cs-Salchichon», «Whisky Macallan»).
  for v_trozo in select x from regexp_split_to_table(p, '[ &-]+') x where x <> '' loop
    v_trozo := regexp_replace(v_trozo, '[^[:alpha:]]', '', 'g');
    if length(v_trozo) < 3 then return false; end if;
    if public.abreviaturas_token_generico(public.normalizar_texto(v_trozo)) then return false; end if;
  end loop;
  return true;
end;
$$;
comment on function public.abreviaturas_expansion_valida(text) is
  'La expansión de una abreviatura tiene que ser una marca o un nombre propio: 1-2 palabras, solo letras, trozos de 3+ letras, sin palabras de familia o envase.';

-- ─── 2. Lista de exclusión (editable) ───────────────────────────────────────
create table if not exists public.abreviaturas_excluidas (
  id              bigint generated always as identity primary key,
  proveedor_id    bigint references public.proveedores(id) on delete cascade,   -- null = para todos los proveedores
  abreviatura     text not null check (abreviatura ~ '^[a-z0-9]{2,8}$'),
  expansion_clave text,                                                           -- null = cualquier expansión
  motivo          text,
  created_at      timestamptz not null default now()
);
create unique index if not exists uq_abreviaturas_excluidas
  on public.abreviaturas_excluidas (coalesce(proveedor_id, 0), abreviatura, coalesce(expansion_clave, ''));
comment on table public.abreviaturas_excluidas is
  'Abreviaturas que NO hay que aprender ni proponer. proveedor_id null = todos; expansion_clave null = cualquier expansión. Se llena con «No es» y por SQL (service_role).';
alter table public.abreviaturas_excluidas enable row level security;
revoke all on public.abreviaturas_excluidas from public, anon, authenticated;
grant select on public.abreviaturas_excluidas to authenticated;
grant all on public.abreviaturas_excluidas to service_role;
drop policy if exists abreviaturas_excluidas_select_seccion on public.abreviaturas_excluidas;
create policy abreviaturas_excluidas_select_seccion on public.abreviaturas_excluidas
  for select to authenticated using (public.can_read_section('facturas'));
drop policy if exists abreviaturas_excluidas_service_role on public.abreviaturas_excluidas;
create policy abreviaturas_excluidas_service_role on public.abreviaturas_excluidas
  for all to service_role using (true) with check (true);

insert into public.abreviaturas_excluidas (proveedor_id, abreviatura, expansion_clave, motivo)
select null, x.a, x.e, x.m from (values
  ('cs', 'cs salchichon', 'Falsa aprendida de un alias (revisión 17/11/2026): CS es Casa Sendra, no «Cs-Salchichon»'),
  ('sm', 'smoothie de mango', 'Falsa aprendida: el nombre entero de un producto, no una marca (revisión 17/11/2026)')
) x(a, e, m)
where not exists (select 1 from public.abreviaturas_excluidas z
                   where z.proveedor_id is null and z.abreviatura = x.a and z.expansion_clave = x.e);

create or replace function public.abreviaturas_excluida(p_proveedor_id bigint, p_abreviatura text, p_expansion text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.abreviaturas_excluidas e
     where e.abreviatura = lower(p_abreviatura)
       and (e.proveedor_id is null or e.proveedor_id = p_proveedor_id)
       and (e.expansion_clave is null or e.expansion_clave = public.abreviaturas_clave(p_expansion)))
$$;
revoke all on function public.abreviaturas_excluida(bigint, text, text) from public, anon, authenticated;
grant execute on function public.abreviaturas_excluida(bigint, text, text) to service_role;
revoke all on function public.abreviaturas_expansion_valida(text) from public, anon, authenticated;
grant execute on function public.abreviaturas_expansion_valida(text) to service_role;
revoke all on function public.abreviaturas_clave(text) from public, anon, authenticated;
grant execute on function public.abreviaturas_clave(text) to service_role;

-- ─── 3. El aprendizaje y las propuestas pasan por las dos comprobaciones ────
create or replace function public.abreviaturas_observar_linea(
  p_texto        text,
  p_proveedor_id bigint,
  p_producto_id  bigint,
  p_veces        integer default 1
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_toks     text[];
  v_n        integer;
  v_i        integer := 1;
  v_t        text;
  v_rest     text[];
  v_fuente   record;
  v_ws       text[];
  v_j        integer;
  v_ini      text;
  v_part     text;
  v_part_n   text;
  v_exp      text;
  v_resto    text[];
  v_w        text;
  v_bebida   boolean;
  v_particulas constant text[] := array['de','del','la','el','los','las','y','e','i','the','le','les','du','des','da','do','di','von','van','of'];
begin
  if p_texto is null or p_proveedor_id is null or p_producto_id is null then return false; end if;
  v_toks := array(select x from regexp_split_to_table(public.normalizar_texto(p_texto), '[^a-z0-9]+') x where x <> '');
  v_n := coalesce(cardinality(v_toks), 0);
  -- Salta los tokens de envase/familia del principio («bot», «c/6b», «cha»…).
  while v_i <= v_n and public.abreviaturas_token_generico(v_toks[v_i]) loop v_i := v_i + 1; end loop;
  if v_i >= v_n then return false; end if;            -- sin token candidato o sin nada detrás
  v_t := v_toks[v_i];
  if v_t !~ '^[a-z]{2,6}$' then return false; end if;  -- una marca entera (tanqueray) no es abreviatura
  v_rest := v_toks[v_i + 1 : v_n];
  -- El comienzo truncado («coca» por «Coca-Cola») solo se aprende en bebidas: en alimentación
  -- sería «alcac» por «alcachofa», una palabra corriente y no una marca.
  select exists (
    select 1 from public.productos_catalogo c
      join public.categorias_producto k on k.id = c.categoria_id
      left join public.categorias_producto kp on kp.id = k.padre_id
     where c.id = p_producto_id and (k.nombre = 'Bebidas' or kp.nombre = 'Bebidas')) into v_bebida;

  -- Fuentes de la expansión: el nombre del producto y, si no basta, sus alias.
  for v_fuente in
    select c.nombre as txt, true as es_nombre, 0 as orden
      from public.productos_catalogo c where c.id = p_producto_id
    union all
    (select initcap(a.texto_normalizado), false, 1
       from public.productos_alias a
      where a.producto_id = p_producto_id and a.texto_normalizado <> public.normalizar_texto(p_texto)
      order by length(a.texto_normalizado) limit 6)
    order by orden
  loop
    v_ws := regexp_split_to_array(btrim(v_fuente.txt), '\s+');
    v_ini := '';
    for v_j in 1 .. least(cardinality(v_ws), 4) loop
      for v_part in select x from regexp_split_to_table(v_ws[v_j], '-') x loop
        v_part_n := public.normalizar_texto(regexp_replace(v_part, '[^[:alpha:]]', '', 'g'));
        if length(v_part_n) >= 2 and not (v_part_n = any (v_particulas)) then
          -- Una marca no lleva palabras de familia o envase («Whisky Macallan» no es una marca).
          if public.abreviaturas_token_generico(v_part_n) then v_ini := null; exit; end if;
          v_ini := v_ini || left(v_part_n, 1);
        end if;
      end loop;
      exit when v_ini is null;
      exit when length(v_ini) > length(v_t);
      -- Una palabra que es partícula no cierra la marca («Marqués de» no vale).
      continue when public.normalizar_texto(v_ws[v_j]) = any (v_particulas);
      if length(v_t) between 2 and 4 and v_ini = v_t then
        v_exp := array_to_string(v_ws[1 : v_j], ' ');
        v_resto := array(select x from regexp_split_to_table(
                           public.normalizar_texto(coalesce(array_to_string(v_ws[v_j + 1 : cardinality(v_ws)], ' '), '')), '[^a-z0-9]+') x
                         where length(x) >= 3 and x ~ '^[a-z]+$' and not public.abreviaturas_token_generico(x));
        if exists (select 1 from unnest(v_resto) w where w = any (v_rest))
           and public.abreviaturas_expansion_valida(left(v_exp, 80))
           and not public.abreviaturas_excluida(p_proveedor_id, v_t, left(v_exp, 80)) then
          insert into public.abreviaturas_proveedor (proveedor_id, abreviatura, expansion, origen, veces, en_nombre)
          values (p_proveedor_id, v_t, left(v_exp, 80), 'aprendida', greatest(1, coalesce(p_veces, 1)), true)
          on conflict (proveedor_id, abreviatura, expansion_clave) do update
            set veces = public.abreviaturas_proveedor.veces + excluded.veces,
                en_nombre = true,
                expansion = case when v_fuente.es_nombre then excluded.expansion else public.abreviaturas_proveedor.expansion end,
                ultima_vez = now();
          return true;
        end if;
      end if;
    end loop;
    -- Comienzo truncado de la primera palabra («baro» por «Barón»): solo cuenta si se repite.
    v_w := public.normalizar_texto(regexp_replace(v_ws[1], '[^[:alpha:]]', '', 'g'));
    if v_bebida and length(v_t) between 3 and 6 and length(v_w) >= 6 and length(v_t) <= length(v_w) - 2
       and left(v_w, length(v_t)) = v_t and not (v_w = any (v_particulas)) then
      v_resto := array(select x from regexp_split_to_table(
                         public.normalizar_texto(coalesce(array_to_string(v_ws[2 : cardinality(v_ws)], ' '), '')), '[^a-z0-9]+') x
                       where length(x) >= 3 and x ~ '^[a-z]+$' and not public.abreviaturas_token_generico(x));
      if exists (select 1 from unnest(v_resto) w where w = any (v_rest))
         and public.abreviaturas_expansion_valida(left(v_ws[1], 80))
         and not public.abreviaturas_excluida(p_proveedor_id, v_t, left(v_ws[1], 80)) then
        insert into public.abreviaturas_proveedor (proveedor_id, abreviatura, expansion, origen, veces, en_nombre)
        values (p_proveedor_id, v_t, left(v_ws[1], 80), 'aprendida', greatest(1, coalesce(p_veces, 1)), false)
        on conflict (proveedor_id, abreviatura, expansion_clave) do update
          set veces = public.abreviaturas_proveedor.veces + excluded.veces, ultima_vez = now();
        return true;
      end if;
    end if;
  end loop;
  return false;
end;
$$;
comment on function public.abreviaturas_observar_linea(text, bigint, bigint, integer) is
  'Aprende «ABREV = Expansión» de un proveedor a partir de una línea ya enlazada con un producto. La expansión tiene que ser una marca (abreviaturas_expansion_valida) y no estar excluida. Solo service_role y el trigger.';
revoke all on function public.abreviaturas_observar_linea(text, bigint, bigint, integer) from public, anon, authenticated;
grant execute on function public.abreviaturas_observar_linea(text, bigint, bigint, integer) to service_role;

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
       or public.abreviaturas_excluida(v_prov, v_ab, v_prop)
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

-- ─── 4. Para el panel: listar y «No es» ─────────────────────────────────────
create or replace function public.abreviaturas_listar()
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
             'id', a.id, 'proveedor_id', a.proveedor_id, 'proveedor', p.nombre, 'abreviatura', a.abreviatura,
             'expansion', a.expansion, 'origen', a.origen, 'veces', a.veces,
             'usable', (a.origen = 'manual' or a.en_nombre or a.veces >= 2))
           order by p.nombre, a.abreviatura)
      from (select * from public.abreviaturas_proveedor order by proveedor_id, abreviatura limit 500) a
      join public.proveedores p on p.id = a.proveedor_id), '[]'::jsonb);
end;
$$;
revoke all on function public.abreviaturas_listar() from public, anon;
grant execute on function public.abreviaturas_listar() to authenticated, service_role;

create or replace function public.abreviaturas_quitar(p_id bigint)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_a public.abreviaturas_proveedor%rowtype;
begin
  if not public.productos_puede_editar() then
    raise exception 'Quitar abreviaturas exige permiso de edición en Facturas' using errcode = '42501';
  end if;
  select * into v_a from public.abreviaturas_proveedor where id = p_id for update;
  if not found then return jsonb_build_object('quitada', false); end if;
  if not exists (select 1 from public.abreviaturas_excluidas z
                  where z.proveedor_id = v_a.proveedor_id and z.abreviatura = v_a.abreviatura
                    and z.expansion_clave = v_a.expansion_clave) then
    insert into public.abreviaturas_excluidas (proveedor_id, abreviatura, expansion_clave, motivo)
    values (v_a.proveedor_id, v_a.abreviatura, v_a.expansion_clave, 'No es (panel)');
  end if;
  delete from public.abreviaturas_proveedor where id = p_id;
  return jsonb_build_object('quitada', true, 'abreviatura', v_a.abreviatura, 'expansion', v_a.expansion);
end;
$$;
revoke all on function public.abreviaturas_quitar(bigint) from public, anon;
grant execute on function public.abreviaturas_quitar(bigint) to authenticated, service_role;

do $$ begin raise notice 'abreviaturas_endurecer: aplicada'; end $$;
