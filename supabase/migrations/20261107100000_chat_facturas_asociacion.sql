-- ============================================================================
--  20261107100000_chat_facturas_asociacion
-- ----------------------------------------------------------------------------
--  El chatbot de Facturas no «asociaba las cosas» (pruebas del dueño en la demo
--  v0.332, 06/11/2026):
--    · «comparativa de a cuánto compro el litro de cerveza por proveedor» →
--      «no hay datos de cerveza en litros… solo mostaza de cerveza»: buscó el
--      TEXTO «cerveza» (lineas_producto_agente) en vez de la familia Cervezas
--      (20.520 l en 2026). volumen_comprado_agente no daba €/l.
--    · «cuánto me he gastado en vino en el último mes» → «el vino no está
--      separado». (La parte del modelo va en chat-facturas.)
--
--  Cambios (solo lectura de datos; una tabla de vocabulario nueva):
--    1. Tabla `terminos_agente`: palabra o sinónimo → familia del catálogo
--       (`categoria_clave`), `nivel` ('familia' = la palabra ES la familia:
--       cerveza, birra, marisco; 'producto' = un producto de esa familia: gamba,
--       ginebra, jamón) y `formato` (barril, tercio, quinto, botellín, lata,
--       magnum…). Ampliable sin tocar código.
--    2. `asociar_termino_agente(texto)` → json {tipo familia|producto|texto|
--       ninguno, categoria_id, categoria, familia_id, familia, formato, texto,
--       origen}: términos, nombres de categoría y, si no, el catálogo
--       (productos_catalogo + productos_alias: «cruzcampo» → Cervezas).
--    3. `asociar_pregunta_agente(pregunta)`: lo mismo palabra a palabra sobre
--       la pregunta entera (chat-facturas lo pasa al modelo como pista).
--    4. `categoria_agente` usa la tabla (antes una lista fija dentro de la
--       función; misma semántica: «gamba» → Marisco, «birra» → Cervezas).
--    5. `lineas_producto_agente` (la usan compras_producto, historial_precios,
--       serie_precios, variacion_precios y volumen_comprado): si el texto es
--       una FAMILIA devuelve las líneas de la familia (metodo 'familia'); si es
--       un producto con familia conocida, se queda con las líneas de esa
--       familia raíz y aparta los derivados de otras familias («mostaza de
--       cerveza», «vinagre de vino», «croqueta de gambas») en `subproductos`,
--       salvo que no quede ninguna (entonces lo pedido ERA el derivado).
--       El cuerpo anterior pasa a `lineas_producto_base_agente`.
--    6. `volumen_comprado_agente` (misma firma de 8 parámetros, solo campos
--       nuevos): asocia el texto (familia, producto, formato pedido: «cerveza
--       de barril»), y da PRECIO por litro/kilo (importe base sin IVA ÷ litros,
--       solo líneas convertidas) con mínimo y máximo por compra: total,
--       por_producto, por_envase (formato), por_proveedor, por_mes,
--       por_proveedor_formato y `comparables` (productos de 2+ proveedores con
--       el precio de cada uno). `proveedores` = cuántos. por_mes marca los
--       meses con pocos documentos subidos (`incompleto`).
--
--  Deshacer: supabase/rollbacks/20261107100000_chat_facturas_asociacion_ROLLBACK.sql
--  Test:     supabase/tests/chat_facturas_asociacion_test.sql
--  Aplicar:  supabase db query --linked -f supabase/migrations/20261107100000_chat_facturas_asociacion.sql
--            (después de 20261113100000) y luego desplegar chat-facturas.
-- ============================================================================

set lock_timeout = '5s';

-- ─── 1. Vocabulario ─────────────────────────────────────────────────────────
create table if not exists public.terminos_agente (
  termino         text primary key,
  raices          text[] generated always as (public.raices_producto_agente(termino)) stored,
  categoria_clave text references public.categorias_producto(clave) on update cascade on delete cascade,
  nivel           text not null default 'producto' check (nivel in ('familia', 'producto')),
  formato         text,
  origen          text not null default 'semilla',
  created_at      timestamptz not null default now(),
  check (categoria_clave is not null or formato is not null)
);

comment on table public.terminos_agente is
  '20261107100000_chat_facturas_asociacion: palabra/sinónimo → familia del catálogo (nivel familia o producto) y formato. La usan asociar_termino_agente y categoria_agente.';

create index if not exists terminos_agente_raices_idx on public.terminos_agente using gin (raices);

alter table public.terminos_agente enable row level security;
drop policy if exists terminos_agente_leer on public.terminos_agente;
create policy terminos_agente_leer on public.terminos_agente for select to authenticated using (true);
revoke all on public.terminos_agente from public, anon, authenticated;
grant select on public.terminos_agente to authenticated;
grant all on public.terminos_agente to service_role;

insert into public.terminos_agente (termino, categoria_clave, nivel, formato) values
  -- Bebidas
  ('bebida', 'bebidas', 'familia', null),
  ('cerveza', 'bebidas.cervezas', 'familia', null), ('birra', 'bebidas.cervezas', 'familia', null),
  ('caña', 'bebidas.cervezas', 'familia', 'barril'), ('barril', 'bebidas.cervezas', 'familia', 'barril'),
  ('tercio', 'bebidas.cervezas', 'familia', 'tercio'), ('quinto', 'bebidas.cervezas', 'familia', 'quinto'),
  ('botellin', 'bebidas.cervezas', 'familia', 'botellin'),
  ('vino', 'bebidas.vinos', 'familia', null),
  ('cava', 'bebidas.vinos', 'producto', null), ('champan', 'bebidas.vinos', 'producto', null),
  ('champagne', 'bebidas.vinos', 'producto', null), ('espumoso', 'bebidas.vinos', 'producto', null),
  ('tinto', 'bebidas.vinos', 'producto', null), ('rosado', 'bebidas.vinos', 'producto', null),
  ('verdejo', 'bebidas.vinos', 'producto', null), ('albariño', 'bebidas.vinos', 'producto', null),
  ('magnum', 'bebidas.vinos', 'producto', 'magnum'),
  ('licor', 'bebidas.licores', 'familia', null), ('destilado', 'bebidas.licores', 'familia', null),
  ('alcohol', 'bebidas.licores', 'familia', null), ('copas', 'bebidas.licores', 'familia', null),
  ('ginebra', 'bebidas.licores', 'producto', null), ('gin', 'bebidas.licores', 'producto', null),
  ('ron', 'bebidas.licores', 'producto', null), ('whisky', 'bebidas.licores', 'producto', null),
  ('vodka', 'bebidas.licores', 'producto', null), ('vermut', 'bebidas.licores', 'producto', null),
  ('brandy', 'bebidas.licores', 'producto', null), ('coñac', 'bebidas.licores', 'producto', null),
  ('tequila', 'bebidas.licores', 'producto', null), ('pacharan', 'bebidas.licores', 'producto', null),
  ('orujo', 'bebidas.licores', 'producto', null), ('anis', 'bebidas.licores', 'producto', null),
  ('refresco', 'bebidas.refrescos', 'familia', null),
  ('agua', 'bebidas.refrescos', 'producto', null), ('zumo', 'bebidas.refrescos', 'producto', null),
  ('tonica', 'bebidas.refrescos', 'producto', null), ('cola', 'bebidas.refrescos', 'producto', null),
  ('gaseosa', 'bebidas.refrescos', 'producto', null), ('soda', 'bebidas.refrescos', 'producto', null),
  ('cafe', 'bebidas.cafe', 'familia', null), ('infusion', 'bebidas.cafe', 'familia', null),
  -- Pescado y marisco
  ('pescado marisco', 'pescado_marisco', 'familia', null), ('pescaderia', 'pescado_marisco', 'familia', null),
  ('pescado', 'pescado_marisco.pescado', 'familia', null),
  ('merluza', 'pescado_marisco.pescado', 'producto', null), ('lubina', 'pescado_marisco.pescado', 'producto', null),
  ('dorada', 'pescado_marisco.pescado', 'producto', null), ('rape', 'pescado_marisco.pescado', 'producto', null),
  ('bacalao', 'pescado_marisco.pescado', 'producto', null), ('salmon', 'pescado_marisco.pescado', 'producto', null),
  ('emperador', 'pescado_marisco.pescado', 'producto', null), ('rodaballo', 'pescado_marisco.pescado', 'producto', null),
  ('lenguado', 'pescado_marisco.pescado', 'producto', null), ('sardina', 'pescado_marisco.pescado', 'producto', null),
  ('boqueron', 'pescado_marisco.pescado', 'producto', null), ('salmonete', 'pescado_marisco.pescado', 'producto', null),
  ('atun', 'pescado_marisco.pescado', 'producto', null), ('corvina', 'pescado_marisco.pescado', 'producto', null),
  ('mero', 'pescado_marisco.pescado', 'producto', null),
  ('marisco', 'pescado_marisco.marisco', 'familia', null), ('crustaceo', 'pescado_marisco.marisco', 'familia', null),
  ('molusco', 'pescado_marisco.marisco', 'familia', null),
  ('gamba', 'pescado_marisco.marisco', 'producto', null), ('langostino', 'pescado_marisco.marisco', 'producto', null),
  ('cigala', 'pescado_marisco.marisco', 'producto', null), ('carabinero', 'pescado_marisco.marisco', 'producto', null),
  ('mejillon', 'pescado_marisco.marisco', 'producto', null), ('almeja', 'pescado_marisco.marisco', 'producto', null),
  ('bogavante', 'pescado_marisco.marisco', 'producto', null), ('langosta', 'pescado_marisco.marisco', 'producto', null),
  ('navaja', 'pescado_marisco.marisco', 'producto', null), ('berberecho', 'pescado_marisco.marisco', 'producto', null),
  ('ostra', 'pescado_marisco.marisco', 'producto', null), ('centollo', 'pescado_marisco.marisco', 'producto', null),
  ('necora', 'pescado_marisco.marisco', 'producto', null), ('quisquilla', 'pescado_marisco.marisco', 'producto', null),
  ('conserva', 'pescado_marisco.conservas', 'familia', null), ('salazon', 'pescado_marisco.conservas', 'familia', null),
  -- Carnes y embutidos
  ('carniceria', 'carnes', 'familia', null), ('carne embutido', 'carnes', 'familia', null),
  ('carne', 'carnes.carne', 'familia', null),
  ('ternera', 'carnes.carne', 'producto', null), ('cerdo', 'carnes.carne', 'producto', null),
  ('cordero', 'carnes.carne', 'producto', null), ('pollo', 'carnes.carne', 'producto', null),
  ('chuleta', 'carnes.carne', 'producto', null), ('chuleton', 'carnes.carne', 'producto', null),
  ('solomillo', 'carnes.carne', 'producto', null), ('entrecot', 'carnes.carne', 'producto', null),
  ('cabrito', 'carnes.carne', 'producto', null), ('conejo', 'carnes.carne', 'producto', null),
  ('vaca', 'carnes.carne', 'producto', null), ('buey', 'carnes.carne', 'producto', null),
  ('embutido', 'carnes.embutidos', 'familia', null), ('charcuteria', 'carnes.embutidos', 'familia', null),
  ('iberico', 'carnes.embutidos', 'familia', null),
  ('jamon', 'carnes.embutidos', 'producto', null), ('chorizo', 'carnes.embutidos', 'producto', null),
  ('salchichon', 'carnes.embutidos', 'producto', null), ('morcilla', 'carnes.embutidos', 'producto', null),
  ('cecina', 'carnes.embutidos', 'producto', null), ('sobrasada', 'carnes.embutidos', 'producto', null),
  -- Resto
  ('lacteo', 'lacteos', 'familia', null),
  ('leche', 'lacteos', 'producto', null), ('queso', 'lacteos', 'producto', null), ('huevo', 'lacteos', 'producto', null),
  ('nata', 'lacteos', 'producto', null), ('mantequilla', 'lacteos', 'producto', null), ('yogur', 'lacteos', 'producto', null),
  ('fruta', 'frutas_verduras', 'familia', null), ('verdura', 'frutas_verduras', 'familia', null),
  ('hortaliza', 'frutas_verduras', 'familia', null), ('fruteria', 'frutas_verduras', 'familia', null),
  ('despensa', 'despensa', 'familia', null), ('ultramarino', 'despensa', 'familia', null),
  ('aceite', 'despensa', 'producto', null), ('arroz', 'despensa', 'producto', null),
  ('harina', 'despensa', 'producto', null), ('azucar', 'despensa', 'producto', null),
  ('vinagre', 'despensa', 'producto', null), ('legumbre', 'despensa', 'producto', null),
  ('panaderia', 'panaderia', 'familia', null), ('reposteria', 'panaderia', 'familia', null),
  ('pasteleria', 'panaderia', 'familia', null), ('bolleria', 'panaderia', 'familia', null),
  ('pan', 'panaderia', 'producto', null), ('postre', 'panaderia', 'producto', null), ('helado', 'panaderia', 'producto', null),
  ('congelado', 'congelados', 'familia', null),
  ('limpieza', 'limpieza', 'familia', null), ('desechable', 'limpieza', 'familia', null), ('drogueria', 'limpieza', 'familia', null),
  ('menaje', 'menaje', 'familia', null), ('equipamiento', 'menaje', 'familia', null),
  ('vajilla', 'menaje', 'familia', null), ('maquinaria', 'menaje', 'familia', null),
  ('servicio', 'servicios', 'familia', null), ('porte', 'servicios', 'familia', null),
  ('transporte', 'servicios', 'familia', null), ('reparacion', 'servicios', 'familia', null),
  -- Solo formato (sin familia: «lata» puede ser cerveza, refresco o conserva)
  ('lata', null, 'producto', 'lata'), ('botella', null, 'producto', 'botella')
on conflict (termino) do nothing;


-- ─── 2. Asociar un texto (argumento de una herramienta) ─────────────────────
create or replace function public.asociar_termino_agente(p_texto text)
returns json
language plpgsql
stable
security invoker
set search_path = public
as $$
-- 20261107100000_chat_facturas_asociacion: «cerveza» → familia Cervezas;
-- «cerveza de barril» → familia + formato barril; «gamba roja» → producto de
-- Marisco; «cruzcampo» → producto de Cervezas (por el catálogo); «mostaza de
-- cerveza» → producto de Despensa (el catálogo manda sobre la palabra suelta).
declare
  c_relleno constant text[] := array[
    'de', 'del', 'la', 'las', 'el', 'los', 'lo', 'y', 'e', 'o', 'u', 'con', 'para', 'en', 'al', 'a', 'por', 'un', 'una',
    'unos', 'unas', 'mi', 'mis', 'me', 'te', 'se', 'su', 'sus', 'que', 'cual', 'cuales', 'como', 'donde', 'cuando',
    'cuanto', 'cuanta', 'cuantos', 'cuantas', 'este', 'esta', 'estos', 'estas', 'ese', 'esa', 'he', 'ha', 'hemos', 'han',
    'hay', 'es', 'son', 'estoy', 'estamos', 'tenemos', 'tengo', 'sale', 'salen', 'sali', 'cuesta', 'cuestan',
    'hazme', 'haz', 'dame', 'dime', 'ensename', 'muestrame', 'quiero', 'saber', 'compara', 'comparar', 'comparativa',
    'comparacion', 'frente', 'entre', 'contra', 'versus', 'vs', 'mas', 'menos', 'muy', 'caro', 'cara', 'caros', 'caras',
    'barato', 'barata', 'baratos', 'baratas', 'mejor', 'peor', 'precio', 'precios', 'coste', 'costo', 'importe', 'gasto',
    'gastos', 'gastado', 'gastamos', 'gaste', 'compra', 'compras', 'comprado', 'comprados', 'comprada', 'compradas',
    'compro', 'compramos', 'comprando', 'comprar', 'proveedor', 'proveedores', 'distribuidor', 'litro', 'litros', 'l',
    'lt', 'lts', 'kilo', 'kilos', 'kg', 'kgs', 'g', 'gr', 'gramo', 'gramos', 'ml', 'cl', 'unidad', 'unidades', 'ud', 'uds',
    'caja', 'cajas', 'formato', 'formatos', 'envase', 'envases', 'tipo', 'tipos', 'total', 'medio', 'media', 'cada',
    'todo', 'toda', 'todos', 'todas', 'ultimo', 'ultima', 'ultimos', 'ultimas', 'mes', 'meses', 'ano', 'anos', 'semana',
    'semanas', 'dia', 'dias', 'hoy', 'ayer', 'año', 'años', 'periodo', 'desde', 'hasta', 'euros', 'euro', 'iva', 'factura',
    'facturas', 'albaran', 'albaranes', 'documento', 'documentos', 'categoria', 'categorias', 'familia', 'familias',
    'producto', 'productos', 'marca', 'marcas', 'evolucion', 'variacion', 'subido', 'bajado', 'sin', 'si', 'no', 'y',
    'cuantas', 'vez', 'veces', 'ahora', 'antes', 'despues', 'otro', 'otra', 'otros', 'otras', 'tambien', 'solo'];
  v_pal  text[];
  v_txt  text[] := '{}';
  v_desc text[] := '{}';
  v_fams bigint[] := '{}';
  v_prod bigint[] := '{}';
  v_fmt  text;
  v_fmtc bigint;
  v_cat  bigint;
  v_tipo text;
  v_ori  text;
  w      text;
  t      record;
  k      record;
begin
  v_pal := array(select x from unnest(palabras_producto_agente(p_texto)) x where not (x = any(c_relleno)));
  foreach w in array v_pal loop
    select tt.nivel, tt.formato, c.id as cid into t
      from terminos_agente tt
      left join categorias_producto c on c.clave = tt.categoria_clave and c.activa
     where tt.raices = array[raiz_producto_agente(w)]
     limit 1;
    if found then
      if t.formato is not null then
        v_fmt := coalesce(v_fmt, t.formato);
        if t.cid is null or t.nivel = 'familia' then   -- lata, botella / barril, tercio, caña
          if t.nivel = 'familia' then v_fmtc := coalesce(v_fmtc, t.cid); end if;
          continue;
        end if;
      end if;
      v_txt := v_txt || w;
      if t.nivel = 'familia' then v_fams := v_fams || t.cid; else v_prod := v_prod || t.cid; end if;
      continue;
    end if;
    -- Nombre de una categoría («conservas», «huevos», «embutidos»).
    select c.id into v_cat from categorias_producto c
     where c.activa and length(w) >= 4 and raiz_producto_agente(w) = any(raices_producto_agente(c.nombre))
     order by c.padre_id nulls last, c.id limit 1;
    v_txt := v_txt || w;
    if v_cat is not null then v_fams := v_fams || v_cat; v_cat := null; else v_desc := v_desc || w; end if;
  end loop;

  if cardinality(v_txt) = 0 then
    if v_fmtc is not null then
      v_tipo := 'familia'; v_cat := v_fmtc; v_ori := 'termino';
    else
      return json_build_object('tipo', case when v_fmt is not null then 'formato' else 'ninguno' end, 'formato', v_fmt);
    end if;
  elsif cardinality(v_desc) = 0 and cardinality(v_prod) = 0 then
    -- Solo palabras de familia: una familia, o la familia común («pescado y marisco»).
    select case when count(distinct x) = 1 then min(x) end into v_cat from unnest(v_fams) x;
    if v_cat is null then
      select case when count(distinct coalesce(c.padre_id, c.id)) = 1 then min(coalesce(c.padre_id, c.id)) end into v_cat
        from unnest(v_fams) x join categorias_producto c on c.id = x;
    end if;
    v_tipo := case when v_cat is not null then 'familia' else 'texto' end;
    v_ori := 'termino';
  else
    v_tipo := 'producto';
    -- El catálogo manda: «mostaza de cerveza» es de Despensa aunque diga cerveza.
    -- Sin Servicios: los envases retornables «Heineken» no hacen de Heineken un servicio.
    select z.cat, z.n, z.tot into k
      from (select pc.categoria_id as cat, count(*) as n, sum(count(*)) over () as tot
              from productos_catalogo pc
              join categorias_producto cc on cc.id = pc.categoria_id
             where cc.clave <> 'servicios' and coalesce(cc.padre_id, 0) <> (select id from categorias_producto where clave = 'servicios')
               and (pc.raices_nombre @> raices_producto_agente(array_to_string(v_txt, ' '))
                    or exists (select 1 from productos_alias a where a.producto_id = pc.id
                                  and a.raices_texto @> raices_producto_agente(array_to_string(v_txt, ' '))))
             group by 1) z
     order by z.n desc, z.cat limit 1;
    if k.cat is not null and k.n >= 0.6 * k.tot then
      v_cat := k.cat; v_ori := 'catalogo';
    elsif k.cat is not null then
      -- Varias categorías: la raíz común si la hay.
      select case when count(distinct coalesce(c.padre_id, c.id)) = 1 then min(coalesce(c.padre_id, c.id)) end into v_cat
        from productos_catalogo pc join categorias_producto c on c.id = pc.categoria_id
       where pc.raices_nombre @> raices_producto_agente(array_to_string(v_txt, ' '))
         and c.clave <> 'servicios' and coalesce(c.padre_id, 0) <> (select id from categorias_producto where clave = 'servicios');
      v_ori := case when v_cat is not null then 'catalogo' end;
    end if;
    if v_cat is null then
      v_cat := coalesce(v_prod[1], v_fams[1], v_fmtc);
      v_ori := case when v_cat is not null then 'termino' end;
    end if;
    if v_cat is null then v_tipo := 'texto'; end if;
  end if;

  return (
    select json_build_object(
      'tipo', v_tipo,
      'categoria_id', c.id, 'categoria', c.nombre,
      'familia_id', coalesce(c.padre_id, c.id), 'familia', coalesce(p.nombre, c.nombre),
      'formato', v_fmt,
      'texto', case when v_tipo <> 'familia' then nullif(array_to_string(v_txt, ' '), '') end,
      'origen', v_ori)
      from (select 1) uno
      left join categorias_producto c on c.id = v_cat
      left join categorias_producto p on p.id = c.padre_id);
end;
$$;

comment on function public.asociar_termino_agente(text) is
  '20261107100000_chat_facturas_asociacion: texto → familia/producto/formato (terminos_agente, nombres de categoría y catálogo).';


-- ─── 3. Asociar las palabras de una pregunta (pista para el modelo) ─────────
create or replace function public.asociar_pregunta_agente(p_texto text)
returns json
language sql
stable
security invoker
set search_path = public
as $$
  -- 20261107100000_chat_facturas_asociacion: «cuánto me he gastado en vino» →
  -- [{palabra: vino, tipo: familia, categoria: Vinos}]. Las palabras del
  -- catálogo que no son términos (marcas) solo si tienen 5 letras o más.
  select coalesce(json_agg(json_strip_nulls(json_build_object(
           'palabra', z.w, 'tipo', z.a->>'tipo', 'categoria', z.a->>'categoria', 'formato', z.a->>'formato'))
           order by z.n), '[]'::json)
    from (select w, n, a
            from (select w, min(n) as n
                    from unnest(palabras_producto_agente(left(p_texto, 600))) with ordinality u(w, n)
                   group by w) ws
            cross join lateral (select asociar_termino_agente(ws.w) as a) x
           where a->>'tipo' in ('familia', 'producto', 'formato')
             and (a->>'origen' is distinct from 'catalogo' or length(ws.w) >= 5)
           order by n limit 6) z
$$;

comment on function public.asociar_pregunta_agente(text) is
  '20261107100000_chat_facturas_asociacion: palabras de la pregunta con familia, producto o formato (máx. 6).';

CREATE OR REPLACE FUNCTION public.categoria_agente(p_texto text)
 RETURNS bigint
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
declare
  c_vacias constant text[] := array['de', 'del', 'la', 'las', 'el', 'los', 'lo', 'y', 'e', 'o', 'en', 'a', 'al',
                                    'gasto', 'gastos', 'categoria', 'productos', 'producto', 'compras', 'todo', 'toda'];
  v_t   text := btrim(coalesce(normalizar_texto(p_texto), ''));
  v_r   text[];
  v_id  bigint;
begin
  if v_t = '' then
    return null;
  end if;
  -- 1. Clave escrita como clave («bebidas.vinos», «pescado_marisco»). Una
  --    palabra suelta («carnes») va por nombre y sinónimos: carnes = carne.
  if v_t ~ '[._]' then
    select id into v_id from categorias_producto where activa and clave = v_t;
    if v_id is not null then return v_id; end if;
  end if;
  -- 2. Nombre exacto, sin tildes ni mayúsculas.
  select id into v_id from categorias_producto
   where activa and normalizar_texto(nombre) = v_t
   order by padre_id nulls last, id limit 1;
  if v_id is not null then return v_id; end if;

  v_r := array(select distinct raiz_producto_agente(w) from unnest(palabras_producto_agente(v_t)) w
                where not (w = any(c_vacias)));
  if cardinality(v_r) = 0 then
    return null;
  end if;
  -- 3. Sinónimos (20261107100000: tabla terminos_agente; todas sus raíces en lo
  --    pedido; gana el más largo y, a igualdad, el de familia).
  select c.id into v_id
    from terminos_agente s
    join categorias_producto c on c.clave = s.categoria_clave and c.activa
   where cardinality(s.raices) > 0 and v_r @> s.raices
   order by cardinality(s.raices) desc, (s.nivel = 'familia') desc, c.id
   limit 1;
  if v_id is not null then return v_id; end if;
  -- 4. Raíces del nombre («refrescos» → «Refrescos y aguas»): la más ajustada.
  select id into v_id from categorias_producto
   where activa
     and array(select raiz_producto_agente(w) from unnest(palabras_producto_agente(nombre)) w
                where not (w = any(c_vacias))) @> v_r
   order by cardinality(palabras_producto_agente(nombre)), padre_id nulls last, id
   limit 1;
  if v_id is not null then return v_id; end if;
  -- 5. Último recurso: la clave sin el punto («cervezas», «cafe»).
  select id into v_id from categorias_producto
   where activa and (clave = v_t or split_part(clave, '.', 2) = v_t)
   order by id limit 1;
  return v_id;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.lineas_producto_base_agente(p_texto text, p_excluir text DEFAULT NULL::text)
 RETURNS TABLE(ids bigint[], metodo text, subproductos text[], palabras text[])
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
-- 20261105180000_productos_raices_precalculadas: raíces y palabras precalculadas por línea.
declare
  c_vacias constant text[] := array[
    'de', 'del', 'la', 'las', 'el', 'los', 'lo', 'y', 'e', 'o', 'con', 'para', 'en', 'al', 'a', 'por',
    'un', 'una', 'unos', 'unas', 'mi', 'mis'];
  c_relleno constant text[] := c_vacias || array[
    'kg', 'kgs', 'kilo', 'kilos', 'g', 'gr', 'grs', 'gramo', 'gramos', 'l', 'lt', 'lts', 'litro', 'litros',
    'ml', 'ud', 'uds', 'unidad', 'unidades', 'caja', 'cajas', 'bote', 'botes', 'botella', 'botellas',
    'cubo', 'cubos', 'paquete', 'paquetes', 'saco', 'sacos', 'bolsa', 'bolsas', 'lata', 'latas',
    'pieza', 'piezas', 'precio', 'precios'];
  c_sub constant text[] := array['espin', 'rasp', 'recort', 'retal', 'cabez', 'carcas', 'hues', 'despoj', 'piel', 'cascar'];
  v_todas text[] := palabras_producto_agente(p_texto);
  v_pal   text[];
  v_rai   text[];
  v_excl  text[];
  v_serv  boolean;
  v_sub   boolean;
  v_ids   bigint[];
  v_subs  text[];
  v_met   text;
begin
  v_pal := array(select w from unnest(v_todas) w where not (w = any(c_relleno)));
  if cardinality(v_pal) = 0 then
    v_pal := v_todas;   -- «cajas» a secas: se busca tal cual
  end if;
  if cardinality(v_pal) = 0 then
    return query select null::bigint[], null::text, null::text[], '{}'::text[];
    return;
  end if;
  v_rai  := array(select distinct raiz_producto_agente(w) from unnest(v_pal) w);
  v_excl := array(select distinct raiz_producto_agente(w)
                    from unnest(palabras_producto_agente(p_excluir)) w
                   where not (w = any(c_vacias)));   -- «caja» SÍ se puede excluir
  v_serv := es_linea_servicio_agente(array_to_string(v_pal, ' '));
  v_sub  := v_rai && c_sub;

  -- 1. Texto (exacta o raíz) en la línea, su producto del catálogo o un alias.
  select array_agg(c.id order by c.id) filter (where not c.es_sub),
         (array_agg(distinct c.etq) filter (where c.es_sub))[1:5]
    into v_ids, v_subs
    from (
      select pf.id, coalesce(pc.nombre, pf.nombre::text) as etq,
             not v_sub and es_subproducto_agente(
               case when pf.raices_nombre @> v_rai or pc.nombre is null
                    then pf.nombre::text else pc.nombre end, v_rai) as es_sub
        from productos_factura pf
        left join productos_catalogo pc on pc.id = pf.producto_id
       where (pf.raices_nombre @> v_rai
              or coalesce(pc.raices_nombre, '{}'::text[]) @> v_rai
              or exists (select 1 from productos_alias a
                          where a.producto_id = pf.producto_id
                            and a.raices_texto @> v_rai))
         and not ((pf.raices_nombre || coalesce(pc.raices_nombre, '{}'::text[])) && v_excl)
         and (v_serv or not es_linea_servicio_agente(coalesce(pf.nombre_normalizado, pf.nombre)))
    ) c;
  if v_ids is not null then
    v_met := 'texto';
  end if;

  -- 2. Derivada: cada raíz buscada es la palabra o su aumentativo/diminutivo
  --    (gamba → gambón, cebolla → cebollita). Sin -ino (langosta ≠ langostino)
  --    ni -ete (salmón ≠ salmonete).
  if v_ids is null then
    select array_agg(pf.id order by pf.id) into v_ids
      from productos_factura pf
      left join productos_catalogo pc on pc.id = pf.producto_id
     where not exists (
             select 1 from unnest(v_rai) r
              where not exists (
                select 1 from unnest(pf.palabras_nombre || coalesce(pc.palabras_nombre, '{}'::text[])) nw
                 where raiz_producto_agente(nw) = r
                    or (length(r) >= 4 and nw ~ ('^' || r || '(on|ones|ito|itos|ita|itas|illo|illos|illa|illas)$'))))
       and not ((pf.raices_nombre || coalesce(pc.raices_nombre, '{}'::text[])) && v_excl)
       and (v_serv or not es_linea_servicio_agente(coalesce(pf.nombre_normalizado, pf.nombre)))
       and (v_sub or not es_subproducto_agente(coalesce(pc.nombre, pf.nombre::text), v_rai));
    if v_ids is not null then
      v_met := 'derivada';
    end if;
  end if;

  -- 3. Aproximada (erratas): cada palabra buscada de ≥ 4 letras casa con una
  --    de longitud parecida (±2) y trigram similarity ≥ 0,4; las cortas, por
  --    raíz. La longitud evita que «salmon» caiga en «salmonete».
  if v_ids is null then
    select array_agg(pf.id order by pf.id) into v_ids
      from productos_factura pf
      left join productos_catalogo pc on pc.id = pf.producto_id
     where not exists (
             select 1 from unnest(v_pal) qw
              where not exists (
                select 1 from unnest(pf.palabras_nombre || coalesce(pc.palabras_nombre, '{}'::text[])) nw
                 where raiz_producto_agente(nw) = raiz_producto_agente(qw)
                    or (length(qw) >= 4 and abs(length(nw) - length(qw)) <= 2
                        and extensions.similarity(qw, nw) >= 0.4)))
       and not ((pf.raices_nombre || coalesce(pc.raices_nombre, '{}'::text[])) && v_excl)
       and (v_serv or not es_linea_servicio_agente(coalesce(pf.nombre_normalizado, pf.nombre)))
       and (v_sub or not es_subproducto_agente(coalesce(pc.nombre, pf.nombre::text), v_rai));
    if v_ids is not null then
      v_met := 'aproximada';
    end if;
  end if;

  return query select v_ids, v_met, v_subs, v_pal;
end;
$function$
;


create or replace function public.lineas_producto_agente(p_texto text, p_excluir text default null)
returns table(ids bigint[], metodo text, subproductos text[], palabras text[])
language plpgsql
stable
set search_path = public
as $$
-- 20261107100000_chat_facturas_asociacion: primero se asocia el texto.
--   · Familia («cerveza», «vinos», «marisco»): las líneas de la familia
--     (metodo 'familia'), no las que dicen la palabra.
--   · Producto con familia («gamba», «cruzcampo», «vino tinto»): la búsqueda de
--     siempre (lineas_producto_base_agente) y, si alguna línea es de esa familia
--     raíz, se apartan las de otras familias como derivados en `subproductos`
--     («croqueta de gambas», «vinagre de vino»). Líneas sin categoría se quedan.
declare
  a      json := asociar_termino_agente(p_texto);
  v_cat  bigint;
  v_fam  bigint;
  v_excl text[];
  b      record;
  v_ok   bigint[];
  v_der  text[];
begin
  if a->>'tipo' = 'familia' then
    v_cat := (a->>'categoria_id')::bigint;
    v_excl := array(select distinct raiz_producto_agente(w) from unnest(palabras_producto_agente(p_excluir)) w
                     where not (w = any(array['de', 'del', 'la', 'las', 'el', 'los', 'y', 'o', 'con', 'sin'])));
    select array_agg(pf.id order by pf.id) into v_ok
      from productos_factura pf
      join productos_catalogo pc on pc.id = pf.producto_id
      join categorias_producto c on c.id = pc.categoria_id
     where (c.id = v_cat or c.padre_id = v_cat)
       and not ((pf.raices_nombre || coalesce(pc.raices_nombre, '{}'::text[])) && v_excl);
    if v_ok is not null then
      return query select v_ok, 'familia'::text, null::text[], palabras_producto_agente(p_texto);
      return;
    end if;
  end if;

  select * into b from lineas_producto_base_agente(p_texto, p_excluir);
  v_fam := (a->>'familia_id')::bigint;
  if a->>'tipo' = 'producto' and v_fam is not null and b.ids is not null then
    select array_agg(x.id order by x.id) filter (where x.dentro),
           (array_agg(distinct x.etq) filter (where not x.dentro))[1:5]
      into v_ok, v_der
      from (select pf.id, coalesce(pc.nombre, pf.nombre::text) as etq,
                   c.id is null or coalesce(c.padre_id, c.id) = v_fam as dentro
              from unnest(b.ids) u(id)
              join productos_factura pf on pf.id = u.id
              left join productos_catalogo pc on pc.id = pf.producto_id
              left join categorias_producto c on c.id = pc.categoria_id) x;
    if v_ok is not null and v_der is not null then
      return query select v_ok, b.metodo,
                          (coalesce(b.subproductos, '{}'::text[]) || v_der)[1:5], b.palabras;
      return;
    end if;
  end if;
  return query select b.ids, b.metodo, b.subproductos, b.palabras;
end;
$$;

comment on function public.lineas_producto_agente(text, text) is
  '20261107100000_chat_facturas_asociacion: líneas de un producto o familia; aparta derivados de otras familias.';


-- ─── 6. volumen_comprado_agente: asociación, formato y precio por litro/kilo ─
create or replace function public.volumen_comprado_agente(
  p_texto text default null, p_categoria text default null,
  p_desde date default null, p_hasta date default null,
  p_local text default null, p_medida text default null,
  p_limite integer default null, p_orden text default null)
returns json
language plpgsql
stable
security invoker
set search_path = public
as $$
-- 20261106400000_facturas_volumenes: «¿cuántos litros de cerveza?», «¿cuántos
-- barriles?», «kilos de gamba». Cuenta facturas + albaranes sin factura.
-- 20261113100000_chat_facturas_bebidas: formato con nombre, botellas y cajas por
-- producto, proveedor principal, p_limite (1-40) y p_orden ('envases' | litros).
-- 20261107100000_chat_facturas_asociacion: el texto se asocia (familia, producto,
-- formato pedido) y hay precio por litro/kilo (importe base ÷ litros de las
-- líneas convertidas) con mínimo y máximo por compra, por proveedor, producto,
-- formato, mes, proveedor×formato y productos de 2+ proveedores.
declare
  v_txt    text := nullif(btrim(coalesce(p_texto, '')), '');
  v_cattxt text := nullif(btrim(coalesce(p_categoria, '')), '');
  v_cat    bigint;
  v_catnom text;
  v_ids    bigint[];
  v_met    text;
  v_subs   text[];
  v_fmt    text;
  a        json;
  v_med    text := case lower(btrim(coalesce(p_medida, '')))
                     when 'l' then 'l' when 'litros' then 'l' when 'kg' then 'kg' when 'kilos' then 'kg' end;
  v_loc    text := case when p_local in ('casa_tomas', 'touza') then p_local end;
  v_lim    integer := least(greatest(coalesce(p_limite, 12), 1), 40);
  v_ord    text := case when lower(btrim(coalesce(p_orden, ''))) in ('envases', 'botellas', 'unidades') then 'envases' else 'total' end;
  r        json;
begin
  if p_desde is not null and p_hasta is not null and p_desde > p_hasta then
    return json_build_object('error', format('Rango inválido: desde (%s) es posterior a hasta (%s).', p_desde, p_hasta));
  end if;
  -- Asociación: «cerveza» escrita como producto es la familia; «cerveza de
  -- barril» / «cruzcampo barril» llevan formato (se filtra por tipo de envase).
  if v_cattxt is not null then
    a := asociar_termino_agente(v_cattxt);
    v_fmt := a->>'formato';
  end if;
  if v_txt is not null then
    a := asociar_termino_agente(v_txt);
    v_fmt := coalesce(v_fmt, a->>'formato');
    if v_cattxt is null and a->>'tipo' = 'familia' then
      v_cattxt := a->>'categoria';
      v_txt := null;
    elsif a->>'tipo' = 'formato' then
      v_txt := null;
    elsif a->>'formato' is not null then
      v_txt := coalesce(a->>'texto', v_txt);
    end if;
  end if;
  -- Barril, tercio, lata, magnum… son envases de bebida: litros.
  if v_fmt is not null then v_med := coalesce(v_med, 'l'); end if;
  if v_cattxt is not null then
    v_cat := categoria_agente(v_cattxt);
    if v_cat is null then
      return json_build_object('error', format('No conozco la categoría «%s».', left(v_cattxt, 60)));
    end if;
    select nombre into v_catnom from categorias_producto where id = v_cat;
  end if;
  if v_txt is not null then
    select l.ids, l.metodo, l.subproductos into v_ids, v_met, v_subs from lineas_producto_agente(v_txt, null) l;
    if v_ids is null then
      return json_build_object('sin_datos', true, 'producto', v_txt, 'categoria', v_catnom,
                               'nota', 'Ninguna línea de compra coincide con ese producto.');
    end if;
  end if;
  if v_cat is null and v_ids is null then
    return json_build_object('error', 'Falta producto o categoria (cerveza, vino, agua, aceite, gamba…).');
  end if;

  with
  base as materialized (
    select v.*, pc.envase_origen
      from volumen_lineas v
      left join productos_catalogo pc on pc.id = v.producto_id
     where (p_desde is null or v.fecha >= p_desde)
       and (p_hasta is null or v.fecha <= p_hasta)
       and (v_loc is null or v.loc = v_loc)
       and (v_cat is null or v.categoria_id = v_cat
            or exists (select 1 from categorias_producto c where c.id = v.categoria_id and c.padre_id = v_cat))
  ),
  sel as materialized (
    select * from base b where v_ids is null or b.linea_id = any(v_ids)
  ),
  med as (
    select coalesce(v_med,
                    (select s.medida from sel s where s.medida is not null
                      group by s.medida order by count(*) desc, s.medida limit 1), 'l') as m
  ),
  -- Líneas convertidas con su envase: el del catálogo o, si no lo tiene, el que
  -- sale de la propia línea (litros / envases). pl = precio por litro/kilo de la línea.
  ok0 as materialized (
    select s.*, e.env_n, e.env_c, e.env_u,
           volumen_tipo_envase(e.env_c, e.env_u, s.categoria,
                               coalesce(s.producto, '') || ' ' || coalesce(s.nombre_linea, '') || ' ' || coalesce(s.unidad, '')) as tipo,
           case when s.cantidad <> 0 and e.env_n is not null and s.metodo in ('caja', 'precio')
                then round(e.env_n / s.cantidad) end as n_por,
           case when s.cantidad_base > 0 and s.importe > 0 then s.importe / s.cantidad_base end as pl,
           case when s.importe is not null then s.cantidad_base end as base_con_importe
      from sel s
      cross join med
      cross join lateral (
        select coalesce(s.envases, case when s.metodo = 'envase' then s.cantidad end) as env_n,
               coalesce(s.envase_cantidad,
                        case when coalesce(s.envases, 0) > 0 then round(s.cantidad_base / s.envases, 3) end) as env_c,
               case when s.envase_cantidad is not null then s.envase_unidad
                    when coalesce(s.envases, 0) > 0 then s.medida end as env_u
      ) e
     where s.medida = med.m
  ),
  ok as materialized (
    select * from ok0 o
     where v_fmt is null
        or (v_fmt = 'botellin' and o.tipo ~ '^(tercio|quinto|botellín)')
        or (v_fmt <> 'botellin' and o.tipo like v_fmt || ' %')
  ),
  no as (select s.* from sel s where s.medida is null),
  pu as (
    select coalesce(o.producto, o.nombre_linea) as producto, coalesce(nullif(lower(o.unidad), ''), 'ud') as uni, o.n_por,
           sum(o.cantidad) as cant, sum(o.cantidad_base) as total, sum(o.env_n) as envases,
           max(o.env_c) as env_c, max(o.env_u) as env_u
      from ok o group by 1, 2, 3
  ),
  por_prod as (
    select p.producto, round(sum(p.total), 2) as total, round(sum(p.envases)) as envases,
           volumen_formato(max(p.env_c), max(p.env_u)) as envase,
           string_agg(trim_scale(p.cant)::text || ' ' || p.uni
                      || case when p.n_por > 1 then ' de ' || trim_scale(p.n_por)::text else '' end,
                      ', ' order by p.total desc) filter (where p.cant <> 0) as compra
      from pu p group by 1
  ),
  pprecio as (
    select coalesce(o.producto, o.nombre_linea) as producto,
           round(sum(o.importe) / nullif(sum(o.base_con_importe), 0), 2) as precio,
           round(min(o.pl), 2) as pmin, round(max(o.pl), 2) as pmax
      from ok o group by 1
  ),
  ptipo as (
    select coalesce(o.producto, o.nombre_linea) as producto, string_agg(distinct o.tipo, ', ') as formato
      from ok o group by 1
  ),
  pprov as (
    select z.producto, z.proveedor, z.n
      from (select coalesce(o.producto, o.nombre_linea) as producto, max(o.proveedor_txt) as proveedor,
                   row_number() over (partition by coalesce(o.producto, o.nombre_linea)
                                      order by sum(o.cantidad_base) desc, max(o.proveedor_txt)) as rn,
                   count(*) over (partition by coalesce(o.producto, o.nombre_linea)) as n
              from ok o group by 1, o.prov_k) z
     where z.rn = 1
  ),
  prod_rk as (
    select pp.*, t.formato, pr.precio, pr.pmin, pr.pmax,
           pv.proveedor || case when pv.n > 1 then format(' (+%s)', pv.n - 1) else '' end as proveedor,
           row_number() over (order by case when v_ord = 'envases' then pp.envases else pp.total end desc nulls last,
                                       pp.total desc, pp.producto) as rk
      from por_prod pp
      left join ptipo t on t.producto = pp.producto
      left join pprov pv on pv.producto = pp.producto
      left join pprecio pr on pr.producto = pp.producto
  ),
  por_fmt as (
    select max(volumen_formato(o.env_c, o.env_u)) as envase, o.tipo as formato,
           round(sum(o.env_n)) as envases, round(sum(o.cantidad_base), 2) as total,
           round(sum(o.importe) / nullif(sum(o.base_con_importe), 0), 2) as precio,
           round(min(o.pl), 2) as pmin, round(max(o.pl), 2) as pmax
      from ok o where o.tipo is not null group by o.tipo
  ),
  por_prov as (
    select max(o.proveedor_txt) as proveedor, round(sum(o.cantidad_base), 2) as total,
           round(sum(o.env_n)) as envases, count(distinct coalesce(o.producto, o.nombre_linea)) as productos,
           round(sum(o.importe), 2) as importe,
           round(sum(o.importe) / nullif(sum(o.base_con_importe), 0), 2) as precio,
           round(min(o.pl), 2) as pmin, round(max(o.pl), 2) as pmax
      from ok o group by o.prov_k
  ),
  prov_fmt as (
    select max(o.proveedor_txt) as proveedor, o.tipo as formato, round(sum(o.cantidad_base), 2) as total,
           round(sum(o.importe) / nullif(sum(o.base_con_importe), 0), 2) as precio,
           round(min(o.pl), 2) as pmin, round(max(o.pl), 2) as pmax
      from ok o where o.tipo is not null group by o.prov_k, o.tipo
  ),
  comp as (
    -- Productos comprados a 2+ proveedores: el precio de cada uno.
    -- Como mucho los 6 proveedores con más volumen de cada producto (n = todos).
    select x.producto, sum(x.total) as total, max(x.n) as n,
           json_agg(json_build_object('proveedor', x.proveedor, 'precio', x.precio, 'total', x.total)
                    order by x.precio nulls last) filter (where x.rv <= 6) as proveedores
      from (select coalesce(o.producto, o.nombre_linea) as producto, max(o.proveedor_txt) as proveedor,
                   round(sum(o.cantidad_base), 2) as total,
                   round(sum(o.importe) / nullif(sum(o.base_con_importe), 0), 2) as precio,
                   count(*) over (partition by coalesce(o.producto, o.nombre_linea)) as n,
                   row_number() over (partition by coalesce(o.producto, o.nombre_linea)
                                      order by sum(o.cantidad_base) desc, max(o.proveedor_txt)) as rv
              from ok o group by 1, o.prov_k) x
     where x.n > 1
     group by x.producto
  ),
  incomp as (
    select to_char(i.mes, 'YYYY-MM') as mes from meses_compras_incompletos(v_loc) i
  ),
  por_mes as (
    select to_char(o.fecha, 'YYYY-MM') as mes, round(sum(o.cantidad_base), 2) as total,
           round(sum(o.importe), 2) as importe,
           round(sum(o.importe) / nullif(sum(o.base_con_importe), 0), 2) as precio
      from ok o group by 1
  ),
  otra as (
    select s.medida, round(sum(s.cantidad_base), 2) as total, count(*) as lineas
      from sel s, med where s.medida is not null and s.medida <> med.m group by s.medida
  )
  select json_build_object(
    'periodo', json_build_object('desde', coalesce(p_desde, (select min(fecha) from sel)), 'hasta', coalesce(p_hasta, (select max(fecha) from sel))),
    'categoria', v_catnom, 'producto', v_txt, 'coincidencia', v_met, 'formato_pedido', v_fmt, 'local', v_loc,
    'derivados_excluidos', to_jsonb(v_subs),
    'unidad', (select m from med),
    'total', (select round(coalesce(sum(o.cantidad_base), 0), 2) from ok o),
    'envases', (select round(sum(o.env_n)) from ok o),
    'cajas', (select round(sum(o.cantidad)) from ok o where o.n_por > 1),
    'importe_base', (select round(sum(o.importe), 2) from ok o),
    'precio', (select round(sum(o.importe) / nullif(sum(o.base_con_importe), 0), 2) from ok o),
    'precio_min', (select round(min(o.pl), 2) from ok o),
    'precio_max', (select round(max(o.pl), 2) from ok o),
    'proveedores', (select count(*) from por_prov),
    'lineas_convertidas', (select count(*) from ok),
    'lineas_sin_convertir', (select count(*) from no),
    'sin_datos', not exists (select 1 from sel),
    'envase_supuesto_lineas', (select nullif(count(*), 0) from ok o where o.envase_origen = 'por_defecto'),
    'orden', case v_ord when 'envases' then 'envases' else 'total' end,
    'por_producto', (select json_agg(json_strip_nulls(json_build_object(
                                       'producto', x.producto, 'total', x.total, 'envases', x.envases,
                                       'envase', x.envase, 'formato', x.formato, 'compra', x.compra,
                                       'proveedor', x.proveedor, 'precio', x.precio,
                                       'precio_min', case when x.pmin <> x.pmax then x.pmin end,
                                       'precio_max', case when x.pmin <> x.pmax then x.pmax end))
                                      order by x.rk)
                       from prod_rk x where x.rk <= v_lim),
    'productos', (select count(*) from por_prod),
    'productos_truncado', (select count(*) > v_lim from por_prod),
    'por_envase', (select json_agg(json_build_object('formato', f.formato, 'envase', f.envase, 'envases', f.envases, 'total', f.total,
                                                     'precio', f.precio, 'precio_min', f.pmin, 'precio_max', f.pmax)
                                   order by f.total desc)
                     from (select * from por_fmt order by total desc limit 10) f),
    'por_proveedor', (select json_agg(json_build_object('proveedor', p.proveedor, 'total', p.total, 'envases', p.envases,
                                                         'productos', p.productos, 'importe', p.importe, 'precio', p.precio,
                                                         'precio_min', p.pmin, 'precio_max', p.pmax) order by p.total desc)
                        from (select * from por_prov order by total desc limit 8) p),
    'por_proveedor_formato', (select json_agg(json_build_object('proveedor', q.proveedor, 'formato', q.formato, 'total', q.total,
                                                                 'precio', q.precio, 'precio_min', q.pmin, 'precio_max', q.pmax)
                                              order by q.formato, q.precio)
                                from (select * from prov_fmt order by total desc limit 14) q
                               where (select count(*) from por_prov) > 1),
    'comparables', (select json_agg(json_build_object('producto', c.producto, 'n_proveedores', c.n, 'proveedores', c.proveedores) order by c.total desc)
                      from (select * from comp order by total desc limit 6) c),
    'por_mes', (select json_agg(json_strip_nulls(json_build_object(
                                  'mes', m.mes, 'total', m.total, 'importe', m.importe, 'precio', m.precio,
                                  'incompleto', case when exists (select 1 from incomp i where i.mes = m.mes) then true end))
                                order by m.mes) from por_mes m),
    'otra_unidad', (select json_agg(json_build_object('unidad', o.medida, 'total', o.total, 'lineas', o.lineas)) from otra o),
    'sin_convertir', case when exists (select 1 from no) then json_build_object(
        'importe_base', (select round(sum(n.importe), 2) from no n),
        'motivos', (select json_object_agg(z.metodo, z.n) from (select n.metodo, count(*) as n from no n group by 1) z),
        'ejemplos', (select json_agg(json_build_object('linea', z.nombre_linea, 'unidad', z.unidad, 'cantidad', z.cant,
                                                        'lineas', z.n, 'motivo', z.metodo))
                       from (select n.nombre_linea, n.unidad, n.metodo, trim_scale(sum(n.cantidad)) as cant, count(*) as n
                               from no n group by 1, 2, 3 order by count(*) desc, 1 limit 5) z)) end,
    'resto_categoria', case when v_cat is not null and v_ids is not null then
        (select json_build_object('total', round(sum(b.cantidad_base), 2), 'lineas', count(*))
           from base b, med where b.medida = med.m and not (b.linea_id = any(v_ids))) end,
    'nota', 'total = cantidad x lo que lleva cada unidad facturada (caja 24 x 33 cl = 7,92 l; barril 50 l). '
            || 'envases = botellas, latas o barriles con las cajas ya abiertas (caja de 6 = 6). '
            || 'compra = como se facturo («99 caja de 6» = 99 cajas de 6 botellas). formato = tipo de envase. '
            || 'precio = € por litro/kilo SIN IVA (importe base / litros de las lineas convertidas); precio_min/max = la compra mas barata/cara. '
            || 'Sin convertir = no se sabe cuanto lleva: no suma. Sin Servicios (envases retornables).'
  ) into r;
  return r;
end;
$$;

comment on function public.volumen_comprado_agente(text, text, date, date, text, text, integer, text) is
  '20261107100000_chat_facturas_asociacion: litros/kilos, botellas, formatos, proveedores y precio por litro/kilo de un producto o familia (chatbot de Facturas).';

-- ─── 7. Permisos ─────────────────────────────────────────────────────────────
revoke all on function public.asociar_termino_agente(text) from public, anon;
grant execute on function public.asociar_termino_agente(text) to authenticated, service_role;
revoke all on function public.asociar_pregunta_agente(text) from public, anon;
grant execute on function public.asociar_pregunta_agente(text) to authenticated, service_role;
revoke all on function public.lineas_producto_base_agente(text, text) from public, anon;
grant execute on function public.lineas_producto_base_agente(text, text) to authenticated, service_role;
revoke all on function public.lineas_producto_agente(text, text) from public, anon;
grant execute on function public.lineas_producto_agente(text, text) to authenticated, service_role;
revoke all on function public.categoria_agente(text) from public, anon;
grant execute on function public.categoria_agente(text) to authenticated, service_role;
revoke all on function public.volumen_comprado_agente(text, text, date, date, text, text, integer, text) from public, anon;
grant execute on function public.volumen_comprado_agente(text, text, date, date, text, text, integer, text) to authenticated, service_role;
