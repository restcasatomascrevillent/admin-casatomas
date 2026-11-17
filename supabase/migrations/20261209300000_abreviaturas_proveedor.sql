-- ============================================================================
-- Abreviaturas por proveedor (se aprenden solas)  ·  20261209300000
-- ----------------------------------------------------------------------------
-- PROBLEMA
--   Los proveedores escriben las líneas con sus propias abreviaturas («LP LA
--   CUVEE», «CHA.LAURENT PERRIER», «T. LAUR. HERMITAGE»). clasificar-productos
--   (IA) enlaza cada línea con un producto de productos_catalogo, pero no sabía
--   que «LP» de Gambín es Laurent-Perrier, así que el producto nuevo salía sin
--   marca («La Cuvée 75 cl») y buscar por marca en el chat fallaba.
--
-- QUÉ HACE (idempotente)
--   1. Tabla abreviaturas_proveedor (proveedor_id, abreviatura, expansion,
--      origen 'aprendida' | 'manual', veces, en_nombre, ultima_vez). RLS como
--      productos_alias: lectura con can_read_section('facturas'); escribe solo
--      service_role (el aprendizaje y las altas a mano por SQL).
--   2. abreviaturas_token_generico(): lista de tokens que NO son marca (BOT,
--      CHA, C/6B, CAJA, UD, GIN, RON, W, LC…). Los packs ya los trata la
--      normalización (20261207300000); aquí solo se ignoran.
--   3. abreviaturas_observar_linea(texto, proveedor, producto, veces): mira el
--      primer token «de marca» de la línea. Si son las INICIALES de las primeras
--      palabras del nombre del producto (o de uno de sus alias) y el resto de la
--      línea trae palabras del producto, apunta «LP = Laurent-Perrier» para ese
--      proveedor (en_nombre = true: vale con una coincidencia). Si solo es el
--      comienzo truncado de la primera palabra («coca» por «Coca-Cola»; solo en
--      bebidas), apunta en_nombre = false: solo vale cuando se repite (veces >= 2).
--   4. Triggers AFTER INSERT / AFTER UPDATE OF producto_id en productos_factura:
--      al enlazar una línea con un producto (alias automático, IA o corrección a
--      mano) llaman a la función anterior. Nunca fallan: un error aquí no puede
--      impedir guardar una factura.
--   5. abreviaturas_recalcular(proveedor): reconstruye lo aprendido con todas
--      las líneas ya enlazadas (para cargar el histórico). Solo service_role.
--
-- No cambia datos existentes. NO audita la tabla (es un diccionario que crece
-- sola; el rastro es `veces` y `ultima_vez`).
--
-- APLICAR (una a una, nunca `db push`): demo primero (sfonaclosuafvlhutkon);
-- producción (haqmmdfdzzatdnrrcgez) solo tras aceptar el PR de la release y con
-- el «sí» del dueño:
--   supabase db query --linked -f supabase/migrations/20261209300000_abreviaturas_proveedor.sql
-- Tiene que terminar en «abreviaturas_proveedor: aplicada». Después, desplegar
-- clasificar-productos y (opcional) cargar el histórico:
--   select public.abreviaturas_recalcular();
-- Deshacer: supabase/rollbacks/20261209300000_abreviaturas_proveedor_ROLLBACK.sql
-- Pruebas: npm run test:abreviaturas:db (PGlite, sin tocar Supabase).
-- ============================================================================

do $$
declare
  v_faltan text[] := '{}';
begin
  if to_regclass('public.productos_factura') is null then v_faltan := v_faltan || 'public.productos_factura'::text; end if;
  if to_regclass('public.facturas') is null then v_faltan := v_faltan || 'public.facturas'::text; end if;
  if to_regclass('public.proveedores') is null then v_faltan := v_faltan || 'public.proveedores'::text; end if;
  if to_regclass('public.productos_alias') is null then v_faltan := v_faltan || 'public.productos_alias (20261007160000)'::text; end if;
  if to_regclass('public.categorias_producto') is null then v_faltan := v_faltan || 'public.categorias_producto (20261007160000)'::text; end if;
  if to_regclass('public.productos_catalogo') is null then v_faltan := v_faltan || 'public.productos_catalogo (20261007160000)'::text; end if;
  if to_regprocedure('public.normalizar_texto(text)') is null then v_faltan := v_faltan || 'public.normalizar_texto(text)'::text; end if;
  if to_regprocedure('public.can_read_section(text)') is null then v_faltan := v_faltan || 'public.can_read_section(text)'::text; end if;
  if to_regprocedure('public.productos_tocar_updated_at()') is null then v_faltan := v_faltan || 'public.productos_tocar_updated_at() (20261007160000)'::text; end if;
  if cardinality(v_faltan) > 0 then
    raise exception 'abreviaturas_proveedor: faltan %', array_to_string(v_faltan, ', ');
  end if;
end $$;

-- ─── 1. Tabla ───────────────────────────────────────────────────────────────
create table if not exists public.abreviaturas_proveedor (
  id              bigint generated always as identity primary key,
  proveedor_id    bigint not null references public.proveedores(id) on delete cascade,
  abreviatura     text not null check (abreviatura ~ '^[a-z0-9]{2,8}$'),
  expansion       text not null check (length(expansion) between 3 and 80),
  -- Misma expansión escrita con o sin guion/tildes = la misma fila.
  expansion_clave text generated always as (
    btrim(regexp_replace(lower(translate(expansion, 'áéíóúüñÁÉÍÓÚÜÑ', 'aeiouunaeiouun')), '[^a-z0-9]+', ' ', 'g'))
  ) stored,
  origen          text not null default 'aprendida' check (origen in ('aprendida', 'manual')),
  veces           integer not null default 1 check (veces >= 1),
  en_nombre       boolean not null default false,
  ultima_vez      timestamptz not null default now(),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (proveedor_id, abreviatura, expansion_clave)
);
create index if not exists idx_abreviaturas_proveedor_prov on public.abreviaturas_proveedor (proveedor_id);
comment on table public.abreviaturas_proveedor is
  'Diccionario de abreviaturas por proveedor («LP» = Laurent-Perrier para Gambín). Se aprende solo al enlazar líneas con productos '
  '(trigger en productos_factura). Se usa si origen = manual, en_nombre o veces >= 2. clasificar-productos se lo pasa a la IA.';
comment on column public.abreviaturas_proveedor.en_nombre is
  'true = la expansión son las iniciales de las primeras palabras del nombre (o alias) del producto: vale con una coincidencia. '
  'false = solo comienzo truncado: vale con veces >= 2.';

drop trigger if exists trg_abreviaturas_proveedor_updated_at on public.abreviaturas_proveedor;
create trigger trg_abreviaturas_proveedor_updated_at
  before update on public.abreviaturas_proveedor
  for each row execute function public.productos_tocar_updated_at();

alter table public.abreviaturas_proveedor enable row level security;
revoke all on public.abreviaturas_proveedor from public, anon, authenticated;
grant select on public.abreviaturas_proveedor to authenticated;
grant all on public.abreviaturas_proveedor to service_role;
drop policy if exists abreviaturas_proveedor_select_seccion on public.abreviaturas_proveedor;
create policy abreviaturas_proveedor_select_seccion on public.abreviaturas_proveedor
  for select to authenticated using (public.can_read_section('facturas'));
drop policy if exists abreviaturas_proveedor_service_role on public.abreviaturas_proveedor;
create policy abreviaturas_proveedor_service_role on public.abreviaturas_proveedor
  for all to service_role using (true) with check (true);

-- ─── 2. Tokens que NO son marca ─────────────────────────────────────────────
create or replace function public.abreviaturas_token_generico(p text)
returns boolean
language sql
immutable
set search_path = public
as $$
  select p is null
      or length(p) < 2
      or p ~ '^[0-9]'
      or p = any (array[
        -- envase, pack y unidad
        'bot','bota','botella','botellas','bt','btl','caja','cajas','cja','cza','cb','ud','uds','und','unid','un','pack','pk',
        'kg','kgs','gr','grs','lt','lts','litro','litros','cl','ml','mg','mag','magnum','sin','cargo','ret','retornable','bandeja',
        -- familia del producto (Gambín: «W.», «LC.», «CHA.», «R.»…)
        'cha','champagne','champan','cava','vino','vinos','tinto','tto','blanco','bco','rosado','licor','lc','gin','ginebra','ron',
        'whisky','whiskey','vodka','tequila','brandy','cognac','anis','cerveza','refresco','infusion','agua','mezcal',
        -- calidad y crianza
        'rva','rv','reserva','crianza','cr','gran','extra','ex','brut','nature','rose','mm',
        -- partículas
        'de','del','la','el','los','las','le','les','du','des','the','and','con','por','varios'
      ]);
$$;

-- ─── 3. Observar una línea enlazada ─────────────────────────────────────────
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
        if exists (select 1 from unnest(v_resto) w where w = any (v_rest)) then
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
      if exists (select 1 from unnest(v_resto) w where w = any (v_rest)) then
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
  'Aprende «ABREV = Expansión» de un proveedor a partir de una línea ya enlazada con un producto. Solo service_role y el trigger.';
revoke all on function public.abreviaturas_observar_linea(text, bigint, bigint, integer) from public, anon, authenticated;
grant execute on function public.abreviaturas_observar_linea(text, bigint, bigint, integer) to service_role;
revoke all on function public.abreviaturas_token_generico(text) from public, anon, authenticated;
grant execute on function public.abreviaturas_token_generico(text) to service_role;

-- ─── 4. Triggers en productos_factura ───────────────────────────────────────
create or replace function public.productos_factura_aprender_abreviatura()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_prov bigint;
begin
  begin
    select f.proveedor_id into v_prov from public.facturas f where f.id = new.factura_id;
    if v_prov is not null then
      perform public.abreviaturas_observar_linea(coalesce(new.nombre_normalizado, new.nombre), v_prov, new.producto_id, 1);
    end if;
  exception when others then
    null;  -- aprender nunca puede impedir guardar una factura
  end;
  return null;
end;
$$;
revoke all on function public.productos_factura_aprender_abreviatura() from public, anon, authenticated;

drop trigger if exists trg_productos_factura_abreviaturas_ins on public.productos_factura;
create trigger trg_productos_factura_abreviaturas_ins
  after insert on public.productos_factura
  for each row when (new.producto_id is not null)
  execute function public.productos_factura_aprender_abreviatura();
drop trigger if exists trg_productos_factura_abreviaturas_upd on public.productos_factura;
create trigger trg_productos_factura_abreviaturas_upd
  after update of producto_id on public.productos_factura
  for each row when (new.producto_id is not null and old.producto_id is distinct from new.producto_id)
  execute function public.productos_factura_aprender_abreviatura();

-- ─── 5. Reconstruir con el histórico ────────────────────────────────────────
create or replace function public.abreviaturas_recalcular(p_proveedor_id bigint default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  r        record;
  v_vistos integer := 0;
  v_ok     integer := 0;
begin
  delete from public.abreviaturas_proveedor
   where origen = 'aprendida' and (p_proveedor_id is null or proveedor_id = p_proveedor_id);
  for r in
    select f.proveedor_id, pf.nombre_normalizado as texto, pf.producto_id, count(*)::integer as n
      from public.productos_factura pf
      join public.facturas f on f.id = pf.factura_id
     where pf.producto_id is not null and f.proveedor_id is not null and pf.nombre_normalizado is not null
       and (p_proveedor_id is null or f.proveedor_id = p_proveedor_id)
     group by f.proveedor_id, pf.nombre_normalizado, pf.producto_id
  loop
    v_vistos := v_vistos + 1;
    if public.abreviaturas_observar_linea(r.texto, r.proveedor_id, r.producto_id, r.n) then v_ok := v_ok + 1; end if;
  end loop;
  return jsonb_build_object('textos_vistos', v_vistos, 'textos_con_abreviatura', v_ok,
    'abreviaturas', (select count(*) from public.abreviaturas_proveedor
                      where p_proveedor_id is null or proveedor_id = p_proveedor_id));
end;
$$;
revoke all on function public.abreviaturas_recalcular(bigint) from public, anon, authenticated;
grant execute on function public.abreviaturas_recalcular(bigint) to service_role;

do $$ begin raise notice 'abreviaturas_proveedor: aplicada'; end $$;
