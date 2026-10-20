set client_encoding = 'UTF8';
-- (Primera línea a propósito: comentarios con tilde; psql en una consola de
-- Windows puede arrancar en WIN1252.)
-- ===========================================================================
-- ##                                                                       ##
-- ##          NO APLICADA: la aplica el dueño a mano (ver pasos)           ##
-- ##                                                                       ##
-- ##   Facturas · chatbot: gasto por categoría y subidas de precio, con    ##
-- ##   aviso automático en la campana (07/10/2026)                         ##
-- ##                                                                       ##
-- ===========================================================================
--
-- POR QUÉ (encargo del dueño, 07/10/2026): con el catálogo de productos y
-- sus categorías (20261007160000) el chatbot tiene que contestar «¿cuánto
-- gasto en vinos / marisco / limpieza?», «¿qué ha subido de precio?», y el
-- panel avisar solo cuando llega una factura con un producto más caro.
-- Indicación permanente: herramientas SQL precisas y compactas.
--
-- DEPENDE DE (las dos en main, NO aplicadas al escribir esto; se aplican antes):
--   20261007150000_chatbot_compras_producto  (palabras/raiz/raices_producto_agente)
--   20261007160000_productos_catalogo_categorias (categorias_producto, productos_catalogo,
--     productos_alias, productos_factura.producto_id). Si faltan, ABORTA sin tocar nada.
--
-- QUÉ AÑADE (no cambia ninguna función, tabla ni dato existente)
--   1. configuracion_facturas: fila única con umbral_subida_precio_pct
--      (10 por defecto) y avisos_subida_precio (sí). Lectura con la sección
--      facturas; cambiarla, con permiso de edición (se edita en Facturas ›
--      Productos).
--   2. Ayudantes (SECURITY INVOKER, pasan por la RLS):
--      · mismo_proveedor_agente(a, b): mismo proveedor normalizado o uno
--        contiene al otro (el criterio de compras_producto_agente).
--      · categoria_agente(texto) → id de categoría: clave («bebidas.vinos»),
--        nombre exacto sin tildes, sinónimos simples (vino/vinos/cava →
--        Vinos; marisco → Marisco; pescado → Pescado; carne → Carne; licores,
--        ginebra… → Licores; limpieza; jamón/ibéricos → Embutidos…) o las
--        raíces del nombre («refrescos» → «Refrescos y aguas»).
--      · lineas_precio_agente(producto, ids): líneas con producto y precio
--        > 0 (precio_unitario o total/cantidad), unidad normalizada y
--        proveedor normalizado, SIN los albaranes ya facturados (misma regla
--        que compras_producto_agente: línea de factura del mismo proveedor,
--        producto, unidad y cantidad entre 7 días antes y 75 después).
--      · precio_referencia_agente(producto, unidad, fecha, factura): precio
--        de REFERENCIA antes de una compra =
--          media PONDERADA por cantidad de las compras de los 90 días
--          anteriores (metodo media_90_dias) si hay al menos 2 documentos;
--          si no, de las 3 últimas compras anteriores, sean de cuando sean
--          (metodo ultimas_compras). Nunca cuenta la propia compra. Devuelve
--          también nº de compras, fechas, proveedor principal (el de más
--          importe) y los proveedores.
--   3. gasto_categorias_agente(p_categoria, p_desde, p_hasta, p_tipo,
--      p_agrupar) → json compacto. Importe = importe de LÍNEA (base SIN IVA;
--      total o cantidad × precio). Facturas y albaranes juntos por defecto,
--      sin contar el albarán ya facturado (como compras_producto_agente).
--      · sin categoría: reparto de las categorías madre con sus
--        subcategorías, «sin_categoria» y «sin_clasificar».
--      · con categoría: total, % del gasto del periodo, subcategorías, los
--        8 productos de más gasto; si no hay nada en el periodo, la última
--        compra de esa categoría.
--      · p_agrupar 'mes' | 'proveedor': cruce (con categoría: por mes o
--        proveedor; sin ella: categoría madre × mes/proveedor, ≤ 60 filas).
--      · avisos: sin_importe, albaranes_ya_facturados; sin_clasificar
--        (líneas aún sin producto: su gasto no está en ninguna categoría).
--      NO reutiliza productos_gasto_por_categoria: aquella suma albaranes ya
--      facturados y no cruza por mes/proveedor.
--   4. variacion_precios_agente(p_desde, p_hasta, p_umbral_pct, p_categoria,
--      p_producto, p_limite, p_sentido) → json. Por PRODUCTO del catálogo y
--      unidad: último precio (media de la última compra dentro del periodo)
--      frente a su referencia (punto 2), variación %, proveedores de las dos
--      y `cambio_proveedor` si el de la última compra no está entre los de
--      la referencia (no es una subida del mismo proveedor). Sentido
--      'subidas' (defecto, ≥ umbral), 'bajadas' (≤ −umbral) o 'ambas'. Con
--      p_producto se enseñan todas sus unidades sin umbral. Sin servicios
--      (portes…) salvo que se pidan por categoría o producto. Avisos:
--      sin_referencia (una sola compra: no se puede comparar), pocas_compras
--      (referencia de una sola compra), sin_clasificar.
--   5. AVISO AUTOMÁTICO en la campana (notificaciones_dashboard, tipo
--      'subida_precio', referencia_tipo 'facturas_productos'): triggers de
--      SENTENCIA en productos_factura —AFTER INSERT y AFTER UPDATE (cuando
--      producto_id pasa de NULL a un valor: lo asigna después
--      clasificar-productos o una persona)— con tablas de transición. Una
--      notificación por DOCUMENTO: «Subida de precio: Merluza +12,2 %» /
--      «Merluza +12,2 % (11,50 → 12,90 €/kg, Flope) · Factura F-1 del
--      06/10/2026. Precios sin IVA.». Solo si:
--        · la línea es de los últimos 7 días (created_at) y es la compra MÁS
--          RECIENTE de ese producto y unidad (subir una factura vieja no avisa);
--        · el precio supera la referencia en MÁS del umbral (configuración);
--        · no es un servicio, ni un albarán ya facturado, ni la factura de un
--          albarán ya recibido al mismo precio;
--        · no se avisó ya de ese documento, producto y unidad con ese mismo
--          precio (avisos_subida_precio): una sustitución/reproceso con los
--          mismos precios NO repite el aviso.
--      Si ya había un aviso SIN LEER de ese documento, se amplía ese en vez de
--      crear otro. Un fallo del aviso NUNCA impide guardar la factura (se
--      registra como WARNING).
--   Todas las RPC: EXECUTE solo authenticated y service_role (nunca anon).
--
-- PASOS (desde adminpanelct/, POR TERMINAL; NO en el SQL Editor). Antes, las
-- dos migraciones de las que depende, cada una con su test.
--   1. npx supabase db query --linked -f supabase/migrations/20261007170000_chatbot_categorias_precios.sql
--      Tiene que imprimir «chatbot_categorias_precios: aplicada | <gasto en
--      vinos 2025-2026> | <nº productos con subida ≥ 10 %>» (07/10/2026:
--      «… | 13292 | 1»: vinos 13.292 € y el helado de frambuesa +12,5 %).
--   2. npx supabase db query --linked -f supabase/tests/chatbot_categorias_precios_test.sql
--      (BEGIN … ROLLBACK). Tiene que acabar en «chatbot_categorias_precios_test: OK».
--   3. npx supabase functions deploy chat-facturas
--   4. Publicar el panel (umbral en Facturas › Productos; campana).
--   Deshacer: supabase/rollbacks/20261007170000_chatbot_categorias_precios_ROLLBACK.sql
--   (ANTES que el rollback de 20261007160000). Idempotente.
-- ===========================================================================

begin;
set local lock_timeout = '5s';

-- ─── 0. Comprobación previa (aborta sin tocar nada) ─────────────────────────
do $$
begin
  if to_regclass('public.categorias_producto') is null
     or to_regclass('public.productos_catalogo') is null
     or to_regclass('public.productos_alias') is null
     or not exists (select 1 from information_schema.columns
                     where table_schema = 'public' and table_name = 'productos_catalogo'
                       and column_name = 'categoria_id')
     or not exists (select 1 from information_schema.columns
                     where table_schema = 'public' and table_name = 'productos_factura'
                       and column_name = 'producto_id') then
    raise exception 'chatbot_categorias_precios: falta el catálogo de productos (aplica antes 20261007160000_productos_catalogo_categorias). No se ha cambiado nada.';
  end if;
  if to_regprocedure('public.palabras_producto_agente(text)') is null
     or to_regprocedure('public.raiz_producto_agente(text)') is null
     or to_regprocedure('public.raices_producto_agente(text)') is null then
    raise exception 'chatbot_categorias_precios: faltan palabras/raiz/raices_producto_agente (aplica antes 20261007150000_chatbot_compras_producto). No se ha cambiado nada.';
  end if;
  if to_regprocedure('public.normalizar_texto(text)') is null
     or to_regprocedure('public.normalizar_proveedor(text)') is null
     or to_regprocedure('public.can_read_section(text)') is null
     or to_regprocedure('public.can_write_section(text)') is null then
    raise exception 'chatbot_categorias_precios: faltan normalizar_texto/normalizar_proveedor/can_read_section/can_write_section. No se ha cambiado nada.';
  end if;
  if to_regclass('public.notificaciones_dashboard') is null then
    raise exception 'chatbot_categorias_precios: falta notificaciones_dashboard. No se ha cambiado nada.';
  end if;
end;
$$;

-- ─── 1. Configuración de facturas (fila única) ──────────────────────────────
create table if not exists public.configuracion_facturas (
  id                        boolean primary key default true check (id),
  umbral_subida_precio_pct  numeric(6,2) not null default 10
                              check (umbral_subida_precio_pct > 0 and umbral_subida_precio_pct <= 500),
  avisos_subida_precio      boolean not null default true,
  updated_at                timestamptz not null default now(),
  updated_by                uuid
);
comment on table public.configuracion_facturas is
  'Configuración de Facturas (una sola fila, id = true). umbral_subida_precio_pct: aviso en la campana si un producto '
  'llega más de ese % por encima de su precio de referencia (variacion_precios_agente).';
insert into public.configuracion_facturas (id) values (true) on conflict (id) do nothing;

create or replace function public.configuracion_facturas_tocar()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at := now();
  new.updated_by := auth.uid();
  return new;
end;
$$;
drop trigger if exists trg_configuracion_facturas_tocar on public.configuracion_facturas;
create trigger trg_configuracion_facturas_tocar
  before update on public.configuracion_facturas
  for each row execute function public.configuracion_facturas_tocar();

alter table public.configuracion_facturas enable row level security;
revoke all on public.configuracion_facturas from public, anon, authenticated;
grant select on public.configuracion_facturas to authenticated;
grant update (umbral_subida_precio_pct, avisos_subida_precio) on public.configuracion_facturas to authenticated;
grant all on public.configuracion_facturas to service_role;
drop policy if exists configuracion_facturas_select on public.configuracion_facturas;
create policy configuracion_facturas_select on public.configuracion_facturas
  for select to authenticated using (public.can_read_section('facturas'));
drop policy if exists configuracion_facturas_update on public.configuracion_facturas;
create policy configuracion_facturas_update on public.configuracion_facturas
  for update to authenticated using (public.can_write_section('facturas')) with check (public.can_write_section('facturas'));
drop policy if exists configuracion_facturas_service_role on public.configuracion_facturas;
create policy configuracion_facturas_service_role on public.configuracion_facturas
  for all to service_role using (true) with check (true);

-- ─── 2. Avisos ya dados (evita repetirlos en sustituciones) ─────────────────
create table if not exists public.avisos_subida_precio (
  factura_id       bigint not null references public.facturas(id) on delete cascade,
  producto_id      bigint not null references public.productos_catalogo(id) on delete cascade,
  unidad           text   not null,
  precio           numeric not null,
  precio_ref       numeric not null,
  variacion_pct    numeric not null,
  proveedor        text,
  proveedor_ref    text,
  cambio_proveedor boolean not null default false,
  notificacion_id  uuid references public.notificaciones_dashboard(id) on delete set null,
  revisado_en      timestamptz not null default now(),
  created_at       timestamptz not null default now(),
  primary key (factura_id, producto_id, unidad)
);
create index if not exists idx_avisos_subida_precio_producto on public.avisos_subida_precio (producto_id);
create index if not exists idx_avisos_subida_precio_notificacion on public.avisos_subida_precio (notificacion_id);
comment on table public.avisos_subida_precio is
  'Subidas de precio ya avisadas en la campana (documento, producto, unidad, precio). Si el documento se sustituye '
  'con el mismo precio no se repite el aviso. La escribe solo el trigger de productos_factura.';

alter table public.avisos_subida_precio enable row level security;
revoke all on public.avisos_subida_precio from public, anon, authenticated;
grant select on public.avisos_subida_precio to authenticated;
grant all on public.avisos_subida_precio to service_role;
drop policy if exists avisos_subida_precio_select on public.avisos_subida_precio;
create policy avisos_subida_precio_select on public.avisos_subida_precio
  for select to authenticated using (public.can_read_section('facturas'));
drop policy if exists avisos_subida_precio_service_role on public.avisos_subida_precio;
create policy avisos_subida_precio_service_role on public.avisos_subida_precio
  for all to service_role using (true) with check (true);

-- ─── 3. Ayudantes ───────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.mismo_proveedor_agente(a text, b text)
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
  select coalesce(a, '') <> '' and coalesce(b, '') <> ''
     and (a = b or (length(a) >= 4 and length(b) >= 4 and (position(a in b) > 0 or position(b in a) > 0)))
$function$;
comment on function public.mismo_proveedor_agente(text, text) is
  'Facturas: mismo proveedor normalizado, o uno contiene al otro (≥ 4 letras). Criterio de compras_producto_agente.';

-- Texto libre → categoría (activa). Orden: clave, nombre exacto, sinónimos,
-- raíces del nombre. NULL si no hay ninguna.
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
  -- 3. Sinónimos simples (todas sus raíces en lo pedido; gana el más largo).
  select c.id into v_id
    from (values
      ('vino', 'bebidas.vinos'), ('cava', 'bebidas.vinos'), ('champan', 'bebidas.vinos'),
      ('champagne', 'bebidas.vinos'), ('espumoso', 'bebidas.vinos'),
      ('cerveza', 'bebidas.cervezas'),
      ('licor', 'bebidas.licores'), ('destilado', 'bebidas.licores'), ('alcohol', 'bebidas.licores'),
      ('ginebra', 'bebidas.licores'), ('gin', 'bebidas.licores'), ('ron', 'bebidas.licores'),
      ('whisky', 'bebidas.licores'), ('vodka', 'bebidas.licores'), ('vermut', 'bebidas.licores'),
      ('copas', 'bebidas.licores'),
      ('refresco', 'bebidas.refrescos'), ('agua', 'bebidas.refrescos'), ('zumo', 'bebidas.refrescos'),
      ('tonica', 'bebidas.refrescos'),
      ('cafe', 'bebidas.cafe'), ('infusion', 'bebidas.cafe'),
      ('bebida', 'bebidas'),
      ('pescado', 'pescado_marisco.pescado'), ('marisco', 'pescado_marisco.marisco'),
      ('crustaceo', 'pescado_marisco.marisco'), ('molusco', 'pescado_marisco.marisco'),
      ('pescado marisco', 'pescado_marisco'), ('pescaderia', 'pescado_marisco'),
      ('carne', 'carnes.carne'), ('carniceria', 'carnes'), ('carne embutido', 'carnes'),
      ('embutido', 'carnes.embutidos'), ('iberico', 'carnes.embutidos'), ('jamon', 'carnes.embutidos'),
      ('charcuteria', 'carnes.embutidos'),
      ('lacteo', 'lacteos'), ('leche', 'lacteos'), ('queso', 'lacteos'), ('huevo', 'lacteos'),
      ('fruta', 'frutas_verduras'), ('verdura', 'frutas_verduras'), ('hortaliza', 'frutas_verduras'),
      ('fruteria', 'frutas_verduras'),
      ('despensa', 'despensa'), ('ultramarino', 'despensa'), ('conserva', 'despensa'), ('aceite', 'despensa'),
      ('pan', 'panaderia'), ('panaderia', 'panaderia'), ('reposteria', 'panaderia'), ('pasteleria', 'panaderia'),
      ('postre', 'panaderia'), ('helado', 'panaderia'), ('bolleria', 'panaderia'),
      ('congelado', 'congelados'),
      ('limpieza', 'limpieza'), ('desechable', 'limpieza'), ('drogueria', 'limpieza'),
      ('menaje', 'menaje'), ('equipamiento', 'menaje'), ('vajilla', 'menaje'), ('maquinaria', 'menaje'),
      ('servicio', 'servicios'), ('porte', 'servicios'), ('transporte', 'servicios'), ('reparacion', 'servicios')
    ) as s(sinonimo, clave)
    join categorias_producto c on c.clave = s.clave and c.activa
   where v_r @> raices_producto_agente(s.sinonimo)
   order by cardinality(raices_producto_agente(s.sinonimo)) desc, c.id
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
$function$;
comment on function public.categoria_agente(text) is
  'Chatbot de facturas: texto libre → categoría activa (clave, nombre sin tildes, sinónimos como vino→Vinos o '
  'marisco→Marisco, o raíces del nombre). NULL si no hay ninguna.';

-- Líneas con producto y precio, SIN los albaranes ya facturados.
CREATE OR REPLACE FUNCTION public.lineas_precio_agente(p_producto_id bigint DEFAULT NULL, p_ids bigint[] DEFAULT NULL)
 RETURNS TABLE (id bigint, factura_id bigint, producto_id bigint, unidad text, cantidad numeric, precio numeric,
                fecha date, tipo text, numero text, proveedor text, prov_n text, created_at timestamp)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  with l as (
    select pf.id, pf.factura_id, pf.producto_id,
           coalesce(nullif(btrim(pf.unidad::text), ''), 'ud') as unidad,
           pf.cantidad,
           coalesce(pf.precio_unitario, round(pf.total / nullif(pf.cantidad, 0), 4)) as precio,
           f.fecha, f.tipo::text as tipo, f.numero_documento::text as numero, f.proveedor::text as proveedor,
           coalesce(nullif(f.proveedor_normalizado::text, ''), nullif(normalizar_proveedor(f.proveedor), ''), '?') as prov_n,
           pf.created_at
      from productos_factura pf
      join facturas f on f.id = pf.factura_id
     where pf.producto_id is not null
       and (p_producto_id is null or pf.producto_id = p_producto_id)
       and (p_ids is null or pf.id = any(p_ids))
  )
  select l.* from l
   where l.precio > 0
     and not (l.tipo = 'albaran' and exists (
           select 1
             from productos_factura x
             join facturas fx on fx.id = x.factura_id
            where fx.tipo = 'factura'
              and x.producto_id = l.producto_id
              and coalesce(nullif(btrim(x.unidad::text), ''), 'ud') = l.unidad
              and x.cantidad = l.cantidad
              and fx.fecha between l.fecha - 7 and l.fecha + 75
              and mismo_proveedor_agente(
                    coalesce(nullif(fx.proveedor_normalizado::text, ''), nullif(normalizar_proveedor(fx.proveedor), ''), '?'),
                    l.prov_n)))
$function$;
comment on function public.lineas_precio_agente(bigint, bigint[]) is
  'Facturas: líneas con producto del catálogo y precio > 0 (precio_unitario o total/cantidad), unidad y proveedor '
  'normalizados, sin los albaranes ya facturados (misma regla que compras_producto_agente).';

-- Precio de referencia ANTES de una compra (ver cabecera, punto 2).
CREATE OR REPLACE FUNCTION public.precio_referencia_agente(
  p_producto_id bigint, p_unidad text, p_fecha date, p_factura_id bigint)
 RETURNS TABLE (precio numeric, compras integer, desde date, hasta date, proveedor text,
                proveedores_n text[], metodo text)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  with ant as (
    select l.* from lineas_precio_agente(p_producto_id) l
     where l.unidad = p_unidad
       and l.factura_id <> p_factura_id
       and (l.fecha < p_fecha or (l.fecha = p_fecha and l.factura_id < p_factura_id))
  ),
  docs as (
    select a.factura_id, max(a.fecha) as fecha,
           row_number() over (order by max(a.fecha) desc, a.factura_id desc) as rn
      from ant a group by a.factura_id
  ),
  m as (
    select case when (select count(*) from docs where docs.fecha >= p_fecha - 90) >= 2
                then 'media_90_dias' else 'ultimas_compras' end as metodo
  ),
  ref as (
    select a.* from ant a join docs d using (factura_id) cross join m
     where case when m.metodo = 'media_90_dias' then d.fecha >= p_fecha - 90 else d.rn <= 3 end
  )
  select coalesce(sum(r.precio * r.cantidad) filter (where r.cantidad > 0)
                    / nullif(sum(r.cantidad) filter (where r.cantidad > 0), 0),
                  avg(r.precio)),
         count(distinct r.factura_id)::integer,
         min(r.fecha),
         max(r.fecha),
         (select r2.proveedor from ref r2 group by r2.proveedor
           order by sum(r2.precio * coalesce(nullif(r2.cantidad, 0), 1)) desc, r2.proveedor limit 1),
         array_agg(distinct r.prov_n),
         (select m.metodo from m)
    from ref r
  having count(*) > 0
$function$;
comment on function public.precio_referencia_agente(bigint, text, date, bigint) is
  'Facturas: precio de referencia de un producto y unidad ANTES de una compra: media ponderada por cantidad de las '
  'compras de los 90 días anteriores si hay ≥ 2 documentos (media_90_dias); si no, de las 3 últimas compras '
  'anteriores (ultimas_compras). Sin la propia compra ni albaranes ya facturados.';

-- ─── 4. gasto_categorias_agente ─────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.gasto_categorias_agente(
  p_categoria text DEFAULT NULL::text,
  p_desde date DEFAULT NULL::date,
  p_hasta date DEFAULT NULL::date,
  p_tipo text DEFAULT NULL::text,
  p_agrupar text DEFAULT NULL::text)
 RETURNS json
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
declare
  c_top        constant int := 8;
  c_max_cruce  constant int := 60;
  v_tipo   text;
  v_agr    text;
  v_cat    categorias_producto%rowtype;
  v_madre  text;
  resultado jsonb;
begin
  -- ── Argumentos ──
  v_tipo := case
    when nullif(trim(coalesce(p_tipo, '')), '') is null or lower(trim(p_tipo)) in ('ambos', 'todos', 'todo') then null
    when lower(trim(p_tipo)) like 'factura%' then 'factura'
    when lower(trim(p_tipo)) like 'albar%' then 'albaran'
    else '?' end;
  if v_tipo = '?' then
    return json_build_object('error', 'tipo debe ser factura, albaran o null (ambos).');
  end if;
  v_agr := case
    when nullif(trim(coalesce(p_agrupar, '')), '') is null then null
    when lower(trim(p_agrupar)) like 'mes%' then 'mes'
    when lower(trim(p_agrupar)) like 'proveedor%' then 'proveedor'
    else '?' end;
  if v_agr = '?' then
    return json_build_object('error', 'agrupar debe ser mes, proveedor o null.');
  end if;
  if p_desde is not null and p_hasta is not null and p_desde > p_hasta then
    return json_build_object('error', format('Rango invalido: desde (%s) es posterior a hasta (%s).', p_desde, p_hasta));
  end if;
  if nullif(trim(coalesce(p_categoria, '')), '') is not null then
    select * into v_cat from categorias_producto where id = categoria_agente(p_categoria);
    if v_cat.id is null then
      return json_build_object(
        'error', format('No hay ninguna categoria "%s".', p_categoria),
        'categorias', (select json_agg(c.nombre || coalesce(' (' || (
                          select string_agg(s.nombre, ', ' order by s.orden, s.nombre)
                            from categorias_producto s where s.padre_id = c.id and s.activa) || ')', '')
                          order by c.orden, c.nombre)
                         from categorias_producto c where c.padre_id is null and c.activa));
    end if;
    select nombre into v_madre from categorias_producto where id = v_cat.padre_id;
  end if;

  with base as (
    select pf.id, pf.producto_id,
           coalesce(pf.nombre_normalizado::text, lower(pf.nombre)) as nom_n,
           pf.cantidad::numeric as cant,
           coalesce(nullif(btrim(pf.unidad::text), ''), 'ud') as unidad,
           coalesce(pf.total, round(pf.cantidad * pf.precio_unitario, 2))::numeric as imp,
           f.id as doc, f.tipo::text as tipo, f.fecha, f.proveedor::text as proveedor,
           coalesce(nullif(f.proveedor_normalizado::text, ''), nullif(normalizar_proveedor(f.proveedor), ''), '?') as prov_n,
           p.nombre as producto,
           c.id as cat_id,
           coalesce(m.id, c.id) as madre_id,
           coalesce(m.nombre, c.nombre) as madre,
           c.nombre as cat,
           coalesce(m.orden, c.orden) as orden
      from productos_factura pf
      join facturas f on f.id = pf.factura_id
      left join productos_catalogo p   on p.id = pf.producto_id
      left join categorias_producto c  on c.id = p.categoria_id
      left join categorias_producto m  on m.id = c.padre_id
     where (p_desde is null or f.fecha >= p_desde)
       and (p_hasta is null or f.fecha <= p_hasta)
       and (v_tipo is null or f.tipo = v_tipo)
  ),
  -- Albarán cuya línea ya está en una factura del mismo proveedor: no se cuenta.
  ya_facturados as (
    select a.id from base a
     where a.tipo = 'albaran'
       and exists (select 1 from base x
                    where x.tipo = 'factura' and x.unidad = a.unidad and x.cant = a.cant and x.nom_n = a.nom_n
                      and mismo_proveedor_agente(x.prov_n, a.prov_n)
                      and x.fecha between a.fecha - 7 and a.fecha + 75)
  ),
  todo as (select * from base where id not in (select id from ya_facturados)),
  -- Lo que se pregunta: la categoría (con sus subcategorías) o todo.
  l as (
    select * from todo
     where v_cat.id is null or cat_id = v_cat.id or madre_id = v_cat.id
  ),
  -- Fila de reparto: categoría madre y subcategoría (o sin clasificar / sin categoría).
  g as (
    select case when producto_id is null then 'Sin clasificar'
                when cat_id is null then 'Sin categoria'
                else madre end as grupo,
           case when cat_id is not null and cat_id <> madre_id then cat end as sub,
           orden, imp, id, doc,
           -- Clave del cruce y su etiqueta (el proveedor, agrupado por su nombre normalizado).
           case when v_agr = 'mes' then to_char(fecha, 'YYYY-MM') else prov_n end as k,
           case when v_agr = 'mes' then to_char(fecha, 'YYYY-MM') else proveedor end as etq
      from l
  ),
  marco as (
    select count(*) as lineas, count(distinct doc) as docs, count(distinct producto_id) as productos,
           sum(imp) as imp,
           sum(imp) filter (where tipo = 'albaran') as imp_alb,
           count(*) filter (where imp is null) as sin_importe,
           count(*) filter (where tipo = 'albaran') as lin_alb
      from l
  ),
  total_periodo as (select sum(imp) as imp from todo),
  sin_clas as (
    select count(*) as lineas, sum(imp) as imp from todo where producto_id is null
  ),
  reparto as (
    select grupo, min(orden) as orden, sum(imp) as imp, count(*) as lineas,
           (select jsonb_agg(jsonb_build_object('categoria', s.sub, 'importe', trim_scale(round(s.imp, 2)), 'lineas', s.lineas)
                             order by s.imp desc nulls last, s.sub)
              from (select g2.sub, sum(g2.imp) as imp, count(*) as lineas
                      from g g2 where g2.grupo = g.grupo and g2.sub is not null group by g2.sub) s) as subs
      from g group by grupo
  ),
  top as (
    select producto, sum(imp) as imp,
           (select jsonb_object_agg(u.unidad, trim_scale(round(u.cant, 3)))
              from (select l2.unidad, sum(l2.cant) as cant from l l2 where l2.producto = l.producto group by l2.unidad) u) as cant,
           count(*) over () as n
      from l where producto is not null
     group by producto
  ),
  cruce as (
    select case when v_cat.id is null then grupo end as grupo,
           (array_agg(etq order by etq))[1] as clave,
           sum(imp) as imp, count(*) as lineas
      from g
     where v_agr is not null
     group by 1, k
  ),
  cruce_n as (
    select c.*, row_number() over (
             order by case when v_agr = 'mes' then c.clave end,
                      c.imp desc nulls last, c.grupo, c.clave) as rn,
           count(*) over () as n
      from cruce c
  )
  select jsonb_strip_nulls(jsonb_build_object(
    'categoria', case when v_cat.id is not null then v_cat.nombre end,
    'madre',     v_madre,
    'periodo',   case when p_desde is not null or p_hasta is not null
                      then jsonb_build_object('desde', p_desde, 'hasta', p_hasta) end,
    'tipo',      v_tipo,
    'total', (select case when m.lineas > 0 then jsonb_strip_nulls(jsonb_build_object(
                'importe',      trim_scale(round(m.imp, 2)),
                'lineas',       m.lineas,
                'documentos',   m.docs,
                'productos',    case when v_cat.id is not null then m.productos end,
                'pct_del_gasto', case when v_cat.id is not null and tp.imp > 0 then round(100 * m.imp / tp.imp, 1) end,
                'de_albaranes', case when m.lin_alb > 0 then trim_scale(round(m.imp_alb, 2)) end)) end
                from marco m cross join total_periodo tp),
    -- Sin categoría: madres con sus subcategorías. Con una madre: sus subcategorías.
    'categorias', case when v_cat.id is null then (
        select jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
                 'categoria', r.grupo,
                 'importe',   trim_scale(round(r.imp, 2)),
                 'pct',       case when tp.imp > 0 then round(100 * r.imp / tp.imp, 1) end,
                 'lineas',    r.lineas,
                 'sub',       r.subs))
               order by r.imp desc nulls last, r.orden, r.grupo)
          from reparto r cross join total_periodo tp
         where r.grupo not in ('Sin clasificar', 'Sin categoria')) end,
    'subcategorias', case when v_cat.id is not null and v_cat.padre_id is null then (
        select r.subs from reparto r limit 1) end,
    'sin_categoria', case when v_cat.id is null then (
        select jsonb_build_object('importe', trim_scale(round(r.imp, 2)), 'lineas', r.lineas)
          from reparto r where r.grupo = 'Sin categoria') end,
    'top_productos', case when v_cat.id is not null then (
        select jsonb_agg(jsonb_build_object('producto', t.producto, 'importe', trim_scale(round(t.imp, 2)), 'cantidad', t.cant)
                         order by t.imp desc nulls last, t.producto)
          from (select * from top order by imp desc nulls last, producto limit c_top) t) end,
    'productos_total', case when v_cat.id is not null then (select case when max(n) > c_top then max(n) end from top) end,
    'cruce', (
        select jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
                 'categoria', c.grupo,
                 v_agr,        c.clave,
                 'importe',   trim_scale(round(c.imp, 2)),
                 'lineas',    c.lineas))
               order by c.rn)
          from cruce_n c where c.rn <= c_max_cruce),
    'cruce_truncado', (select case when max(n) > c_max_cruce then true end from cruce_n),
    'sin_clasificar', (select case when s.lineas > 0 then jsonb_build_object(
                         'lineas', s.lineas, 'importe', trim_scale(round(s.imp, 2))) end from sin_clas s),
    'incluye_albaranes', (select case when m.lin_alb > 0 then true end from marco m),
    'criterio', (select case when m.lin_alb > 0 or exists (select 1 from ya_facturados) then
        'Suma facturas y albaranes (lo recibido); no cuenta el albaran cuya linea ya esta en una factura del proveedor.' end
        from marco m),
    'avisos', (select nullif(jsonb_strip_nulls(jsonb_build_object(
                 'sin_importe',             nullif(m.sin_importe, 0),
                 'albaranes_ya_facturados', nullif((select count(*) from ya_facturados), 0))), '{}'::jsonb)
                 from marco m),
    'nota', 'Importes de linea: base SIN IVA.',
    'sin_datos', (select case when m.lineas = 0 then true end from marco m),
    'ultima_compra', case when v_cat.id is not null and (select lineas from marco) = 0 then (
        select max(f.fecha)
          from productos_factura pf
          join facturas f on f.id = pf.factura_id
          join productos_catalogo p on p.id = pf.producto_id
          join categorias_producto c on c.id = p.categoria_id
         where c.id = v_cat.id or c.padre_id = v_cat.id) end
  )) into resultado;

  return resultado::json;
end;
$function$;
comment on function public.gasto_categorias_agente(text, date, date, text, text) is
  'Chatbot de facturas: gasto por categoría de producto (base SIN IVA, importes de línea). Sin categoría: reparto de '
  'las madres con subcategorías; con categoría (clave, nombre o sinónimo): total, %, subcategorías y 8 productos. '
  'agrupar mes|proveedor: cruce. Facturas + albaranes salvo el albarán ya facturado; avisa de lo sin clasificar.';

-- ─── 5. variacion_precios_agente ────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.variacion_precios_agente(
  p_desde date DEFAULT NULL::date,
  p_hasta date DEFAULT NULL::date,
  p_umbral_pct numeric DEFAULT 10,
  p_categoria text DEFAULT NULL::text,
  p_producto text DEFAULT NULL::text,
  p_limite integer DEFAULT 10,
  p_sentido text DEFAULT NULL::text)
 RETURNS json
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
declare
  c_vacias constant text[] := array['de', 'del', 'la', 'las', 'el', 'los', 'y', 'e', 'o', 'en', 'kg', 'kilo', 'kilos',
                                    'precio', 'precios'];
  v_lim     int := least(greatest(coalesce(p_limite, 10), 1), 50);
  v_umbral  numeric := coalesce(p_umbral_pct, 10);
  v_sentido text := lower(coalesce(nullif(trim(p_sentido), ''), 'subidas'));
  v_cat     categorias_producto%rowtype;
  v_prods   bigint[];
  v_rai     text[];
  resultado jsonb;
begin
  v_sentido := case when v_sentido like 'sub%' then 'subidas' when v_sentido like 'baj%' then 'bajadas'
                    when v_sentido in ('ambas', 'ambos', 'todas', 'todo') then 'ambas' else '?' end;
  if v_sentido = '?' then
    return json_build_object('error', 'sentido debe ser subidas, bajadas o ambas.');
  end if;
  if v_umbral < 0 or v_umbral > 1000 then
    return json_build_object('error', 'umbral_pct debe estar entre 0 y 1000.');
  end if;
  if p_desde is not null and p_hasta is not null and p_desde > p_hasta then
    return json_build_object('error', format('Rango invalido: desde (%s) es posterior a hasta (%s).', p_desde, p_hasta));
  end if;
  if nullif(trim(coalesce(p_categoria, '')), '') is not null then
    select * into v_cat from categorias_producto where id = categoria_agente(p_categoria);
    if v_cat.id is null then
      return json_build_object('error', format('No hay ninguna categoria "%s".', p_categoria));
    end if;
  end if;
  if nullif(trim(coalesce(p_producto, '')), '') is not null then
    v_rai := array(select distinct raiz_producto_agente(w) from unnest(palabras_producto_agente(p_producto)) w
                    where not (w = any(c_vacias)));
    if cardinality(v_rai) = 0 then
      return json_build_object('error', 'Falta el nombre del producto.');
    end if;
    v_prods := array(
      select p.id from productos_catalogo p where raices_producto_agente(p.nombre) @> v_rai
      union
      select a.producto_id from productos_alias a where raices_producto_agente(a.texto_normalizado) @> v_rai);
    if cardinality(v_prods) = 0 then
      return jsonb_build_object('buscado', p_producto, 'sin_datos', true,
        'nota', 'Ningun producto del catalogo se llama asi: prueba compras_producto o historial_precios.')::json;
    end if;
  end if;

  with l as (
    select x.*, p.nombre as producto
      from lineas_precio_agente() x
      join productos_catalogo p on p.id = x.producto_id
      left join categorias_producto c on c.id = p.categoria_id
      left join categorias_producto m on m.id = c.padre_id
     where (v_prods is null or x.producto_id = any(v_prods))
       and (v_cat.id is null or c.id = v_cat.id or c.padre_id = v_cat.id)
       -- Servicios (portes, reparaciones…) fuera salvo que se pidan.
       and (v_cat.id is not null or v_prods is not null or coalesce(m.clave, c.clave, '') <> 'servicios')
  ),
  -- Última compra de cada producto y unidad dentro del periodo.
  ult_doc as (
    select distinct on (producto_id, unidad) producto_id, unidad, factura_id, fecha, tipo, proveedor, prov_n, producto
      from l
     where (p_desde is null or fecha >= p_desde) and (p_hasta is null or fecha <= p_hasta)
     order by producto_id, unidad, fecha desc, factura_id desc
  ),
  ult as (
    select u.*,
           (select coalesce(sum(l.precio * l.cantidad) filter (where l.cantidad > 0)
                              / nullif(sum(l.cantidad) filter (where l.cantidad > 0), 0), avg(l.precio))
              from l where l.factura_id = u.factura_id and l.producto_id = u.producto_id and l.unidad = u.unidad) as precio
      from ult_doc u
  ),
  cmp as (
    select u.*, r.precio as ref_precio, r.compras as ref_compras, r.desde as ref_desde, r.hasta as ref_hasta,
           r.proveedor as ref_proveedor, r.metodo,
           case when r.precio > 0 then round((u.precio / r.precio - 1) * 100, 1) end as var,
           r.precio is not null and not (u.prov_n = any(r.proveedores_n)) as cambio
      from ult u
      left join lateral precio_referencia_agente(u.producto_id, u.unidad, u.fecha, u.factura_id) r on true
  ),
  sel as (
    select c.*, row_number() over (
             order by case when v_sentido = 'bajadas' then c.var end asc nulls last,
                      case when v_sentido = 'ambas' then abs(c.var) end desc nulls last,
                      c.var desc nulls last, c.producto) as rn,
           count(*) over () as n
      from cmp c
     where c.var is not null
       and (v_prods is not null
            or (v_sentido = 'subidas' and c.var >= v_umbral)
            or (v_sentido = 'bajadas' and c.var <= -v_umbral)
            or (v_sentido = 'ambas' and abs(c.var) >= v_umbral))
  )
  select jsonb_strip_nulls(jsonb_build_object(
    'criterio', 'Por producto y unidad: precio de la ultima compra frente a la media ponderada de las compras de los '
                || '90 dias anteriores (o de las 3 ultimas compras anteriores si en 90 dias hay menos de 2). '
                || 'Precios de linea SIN IVA.'
                || case when v_prods is not null then ' Producto pedido: todas sus unidades, sin umbral.' else '' end,
    'buscado',   p_producto,
    'categoria', v_cat.nombre,
    'periodo',   case when p_desde is not null or p_hasta is not null
                      then jsonb_build_object('desde', p_desde, 'hasta', p_hasta) end,
    'sentido',   case when v_prods is null then v_sentido end,
    'umbral_pct', case when v_prods is null then trim_scale(v_umbral) end,
    'productos', coalesce((
        select jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
                 'producto',       s.producto,
                 'unidad',         s.unidad,
                 'precio',         trim_scale(round(s.precio, 4)),
                 'fecha',          s.fecha,
                 'proveedor',      s.proveedor,
                 'tipo',           case when s.tipo = 'albaran' then 'albaran' end,
                 'variacion_pct',  s.var,
                 'ref_precio',     trim_scale(round(s.ref_precio, 4)),
                 'ref_compras',    s.ref_compras,
                 'ref_desde',      s.ref_desde,
                 'ref_hasta',      case when s.ref_hasta <> s.ref_desde then s.ref_hasta end,
                 'ref_proveedor',  case when s.cambio or s.ref_proveedor is distinct from s.proveedor then s.ref_proveedor end,
                 'cambio_proveedor', case when s.cambio then true end,
                 'pocas_compras',  case when s.ref_compras = 1 then true end,
                 'ref_antigua',    case when s.metodo = 'ultimas_compras' and s.ref_hasta < s.fecha - 90 then true end))
               order by s.rn)
          from sel s where s.rn <= v_lim), '[]'::jsonb),
    'total_productos', (select coalesce(max(n), 0) from sel),
    'truncado',  (select case when max(n) > v_lim then true end from sel),
    'comparados', (select count(*) from cmp where var is not null),
    'avisos', nullif(jsonb_strip_nulls(jsonb_build_object(
        'sin_referencia', nullif((select count(*) from cmp where var is null), 0),
        'pocas_compras',  nullif((select count(*) from sel where ref_compras = 1 and rn <= v_lim), 0),
        'cambio_proveedor', nullif((select count(*) from sel where cambio and rn <= v_lim), 0),
        'sin_clasificar', nullif((select count(*) from productos_factura pf join facturas f on f.id = pf.factura_id
                                   where pf.producto_id is null
                                     and (p_desde is null or f.fecha >= p_desde)
                                     and (p_hasta is null or f.fecha <= p_hasta)), 0))), '{}'::jsonb),
    'sin_datos', (select case when count(*) = 0 then true end from cmp)
  )) into resultado;

  return resultado::json;
end;
$function$;
comment on function public.variacion_precios_agente(date, date, numeric, text, text, integer, text) is
  'Chatbot de facturas: subidas/bajadas de precio por producto del catálogo y unidad: última compra (en el periodo) '
  'frente a la referencia de precio_referencia_agente; marca cambio_proveedor y pocas_compras. Sin servicios salvo que '
  'se pidan. Precios de línea SIN IVA.';

-- ─── 6. Aviso automático de subida de precio ────────────────────────────────
create or replace function public.precio_es_agente(p numeric, p_decimales int default 2)
returns text
language sql
immutable
set search_path = public
as $$
  select replace(case when p_decimales = 1 then trim_scale(round(p, 1))::text
                      else to_char(round(p, p_decimales), 'FM999999990.' || repeat('0', p_decimales)) end, '.', ',')
$$;

CREATE OR REPLACE FUNCTION public.productos_avisar_subidas(p_ids bigint[])
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_umbral  numeric;
  v_activo  boolean;
  v_t       timestamptz := clock_timestamp();
  v_docs    bigint[] := '{}';
  v_doc     bigint;
  v_notif   uuid;
  v_n       int;
  v_titulo  text;
  v_msg     text;
  v_creadas int := 0;
  d         record;
  r         record;
begin
  if p_ids is null or cardinality(p_ids) = 0 then
    return 0;
  end if;
  select umbral_subida_precio_pct, avisos_subida_precio into v_umbral, v_activo
    from configuracion_facturas where id;
  if not found then
    v_umbral := 10;
    v_activo := true;
  end if;
  if not v_activo then
    return 0;
  end if;

  for r in
    with cand as (
      select l.factura_id, l.producto_id, l.unidad, l.fecha, l.tipo, l.proveedor, l.prov_n,
             sum(l.cantidad) as cantidad,
             coalesce(sum(l.precio * l.cantidad) filter (where l.cantidad > 0)
                        / nullif(sum(l.cantidad) filter (where l.cantidad > 0), 0), avg(l.precio)) as precio
        from lineas_precio_agente(null, p_ids) l
       where l.created_at > now() - interval '7 days'
       group by l.factura_id, l.producto_id, l.unidad, l.fecha, l.tipo, l.proveedor, l.prov_n
    )
    select c.*, p.nombre as producto, ref.precio as ref_precio, ref.proveedor as ref_proveedor,
           not (c.prov_n = any(ref.proveedores_n)) as cambio,
           round((c.precio / ref.precio - 1) * 100, 1) as var
      from cand c
      join productos_catalogo p on p.id = c.producto_id
      left join categorias_producto cat on cat.id = p.categoria_id
      left join categorias_producto mad on mad.id = cat.padre_id
      cross join lateral precio_referencia_agente(c.producto_id, c.unidad, c.fecha, c.factura_id) ref
     where coalesce(mad.clave, cat.clave, '') <> 'servicios'
       and ref.precio > 0
       and c.precio > ref.precio * (1 + v_umbral / 100)
       -- Solo la compra MÁS RECIENTE de ese producto y unidad.
       and not exists (
             select 1 from productos_factura x join facturas fx on fx.id = x.factura_id
              where x.producto_id = c.producto_id
                and coalesce(nullif(btrim(x.unidad::text), ''), 'ud') = c.unidad
                and x.factura_id <> c.factura_id
                and (fx.fecha > c.fecha or (fx.fecha = c.fecha and fx.id > c.factura_id)))
       -- La factura de un albarán ya recibido al mismo precio no es una subida nueva.
       and not (c.tipo = 'factura' and exists (
             select 1 from lineas_precio_agente(c.producto_id) a
              where a.tipo = 'albaran' and a.factura_id <> c.factura_id and a.unidad = c.unidad
                and a.cantidad = c.cantidad and abs(a.precio - c.precio) < 0.005
                and c.fecha between a.fecha - 7 and a.fecha + 75
                and mismo_proveedor_agente(a.prov_n, c.prov_n)))
  loop
    insert into avisos_subida_precio as a
           (factura_id, producto_id, unidad, precio, precio_ref, variacion_pct, proveedor, proveedor_ref,
            cambio_proveedor, revisado_en)
    values (r.factura_id, r.producto_id, r.unidad, r.precio, r.ref_precio, r.var, r.proveedor, r.ref_proveedor,
            coalesce(r.cambio, false), v_t)
    on conflict (factura_id, producto_id, unidad) do update
       set precio = excluded.precio, precio_ref = excluded.precio_ref, variacion_pct = excluded.variacion_pct,
           proveedor = excluded.proveedor, proveedor_ref = excluded.proveedor_ref,
           cambio_proveedor = excluded.cambio_proveedor, revisado_en = excluded.revisado_en
     where abs(a.precio - excluded.precio) >= 0.005;   -- mismo precio: ya se avisó
    get diagnostics v_n = row_count;
    if v_n > 0 and not (r.factura_id = any(v_docs)) then
      v_docs := v_docs || r.factura_id;
    end if;
  end loop;

  -- Una notificación por documento (si hay una SIN LEER de ese documento, se amplía).
  foreach v_doc in array v_docs loop
    select a.notificacion_id into v_notif
      from avisos_subida_precio a
      join notificaciones_dashboard n on n.id = a.notificacion_id and not n.leida
     where a.factura_id = v_doc
     order by a.revisado_en desc limit 1;

    select f.tipo, f.numero_documento, f.fecha, f.proveedor into d from facturas f where f.id = v_doc;
    select count(*),
           string_agg(format('%s %s%s %% (%s → %s €/%s, %s%s)',
                        p.nombre, case when a.variacion_pct >= 0 then '+' else '' end,
                        precio_es_agente(a.variacion_pct, 1), precio_es_agente(a.precio_ref), precio_es_agente(a.precio),
                        a.unidad, coalesce(a.proveedor, '?'),
                        case when a.cambio_proveedor then '; antes ' || coalesce(a.proveedor_ref, '?') else '' end),
                      '; ' order by a.variacion_pct desc, p.nombre),
           max(p.nombre || ' +' || precio_es_agente(a.variacion_pct, 1) || ' %')
      into v_n, v_msg, v_titulo
      from avisos_subida_precio a
      join productos_catalogo p on p.id = a.producto_id
     where a.factura_id = v_doc
       and (a.revisado_en = v_t or (v_notif is not null and a.notificacion_id = v_notif));

    v_titulo := left(case when v_n = 1 then 'Subida de precio: ' || v_titulo
                          else format('Subidas de precio: %s productos (%s)', v_n, coalesce(d.proveedor, '?')) end, 150);
    v_msg := v_msg || format(' · %s %s del %s. Precios sin IVA.',
                             case when d.tipo = 'albaran' then 'Albarán' else 'Factura' end,
                             coalesce(d.numero_documento, '?'), to_char(d.fecha, 'DD/MM/YYYY'));

    if v_notif is null then
      insert into notificaciones_dashboard (tipo, titulo, mensaje, referencia_tipo, prioridad)
      values ('subida_precio', v_titulo, v_msg, 'facturas_productos', 'normal')
      returning id into v_notif;
      v_creadas := v_creadas + 1;
    else
      update notificaciones_dashboard set titulo = v_titulo, mensaje = v_msg where id = v_notif;
    end if;
    update avisos_subida_precio set notificacion_id = v_notif
     where factura_id = v_doc and revisado_en = v_t;
  end loop;
  return v_creadas;
end;
$function$;
comment on function public.productos_avisar_subidas(bigint[]) is
  'Facturas: aviso en la campana (tipo subida_precio) si alguna de esas líneas (recientes, última compra del producto) '
  'supera su precio de referencia en más de configuracion_facturas.umbral_subida_precio_pct. Uno por documento; no '
  'repite el mismo precio (avisos_subida_precio). La llaman los triggers de productos_factura.';

CREATE OR REPLACE FUNCTION public.productos_factura_aviso_precio()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_ids bigint[];
begin
  if tg_op = 'INSERT' then
    select array_agg(n.id) into v_ids from nuevas n where n.producto_id is not null;
  else
    select array_agg(n.id) into v_ids
      from nuevas n join viejas o on o.id = n.id
     where o.producto_id is null and n.producto_id is not null;
  end if;
  if v_ids is null then
    return null;
  end if;
  begin
    perform productos_avisar_subidas(v_ids);
  exception when others then
    -- Un fallo del aviso nunca impide guardar la factura.
    raise warning 'productos_factura_aviso_precio: no se pudo comprobar la subida de precio: %', sqlerrm;
  end;
  return null;
end;
$function$;

-- Sin lista de columnas: PostgreSQL no admite tablas de transición con ella.
drop trigger if exists trg_productos_factura_aviso_precio_ins on public.productos_factura;
create trigger trg_productos_factura_aviso_precio_ins
  after insert on public.productos_factura
  referencing new table as nuevas
  for each statement execute function public.productos_factura_aviso_precio();
drop trigger if exists trg_productos_factura_aviso_precio_upd on public.productos_factura;
create trigger trg_productos_factura_aviso_precio_upd
  after update on public.productos_factura
  referencing old table as viejas new table as nuevas
  for each statement execute function public.productos_factura_aviso_precio();

-- ─── 7. Privilegios ─────────────────────────────────────────────────────────
revoke all on function public.configuracion_facturas_tocar() from public, anon, authenticated;
revoke all on function public.productos_factura_aviso_precio() from public, anon, authenticated;
revoke all on function public.productos_avisar_subidas(bigint[]) from public, anon, authenticated;
grant execute on function public.productos_avisar_subidas(bigint[]) to service_role;
revoke all on function public.mismo_proveedor_agente(text, text) from public, anon;
revoke all on function public.precio_es_agente(numeric, integer) from public, anon;
revoke all on function public.categoria_agente(text) from public, anon;
revoke all on function public.lineas_precio_agente(bigint, bigint[]) from public, anon;
revoke all on function public.precio_referencia_agente(bigint, text, date, bigint) from public, anon;
revoke all on function public.gasto_categorias_agente(text, date, date, text, text) from public, anon;
revoke all on function public.variacion_precios_agente(date, date, numeric, text, text, integer, text) from public, anon;
grant execute on function public.mismo_proveedor_agente(text, text) to authenticated, service_role;
grant execute on function public.precio_es_agente(numeric, integer) to authenticated, service_role;
grant execute on function public.categoria_agente(text) to authenticated, service_role;
grant execute on function public.lineas_precio_agente(bigint, bigint[]) to authenticated, service_role;
grant execute on function public.precio_referencia_agente(bigint, text, date, bigint) to authenticated, service_role;
grant execute on function public.gasto_categorias_agente(text, date, date, text, text) to authenticated, service_role;
grant execute on function public.variacion_precios_agente(date, date, numeric, text, text, integer, text) to authenticated, service_role;

-- ─── 8. Comprobaciones finales (si fallan, no se aplica nada) ───────────────
do $$
declare
  j  jsonb;
  n  int;
begin
  if categoria_agente('vinos') is distinct from (select id from categorias_producto where clave = 'bebidas.vinos')
     or categoria_agente('Vino') is distinct from (select id from categorias_producto where clave = 'bebidas.vinos')
     or categoria_agente('marisco') is distinct from (select id from categorias_producto where clave = 'pescado_marisco.marisco')
     or categoria_agente('licores') is distinct from (select id from categorias_producto where clave = 'bebidas.licores')
     or categoria_agente('limpieza') is distinct from (select id from categorias_producto where clave = 'limpieza')
     or categoria_agente('zzqxw') is not null then
    raise exception 'chatbot_categorias_precios: categoria_agente no resuelve las categorías esperadas.';
  end if;
  -- El total de una categoría cuadra con el reparto general.
  j := gasto_categorias_agente();
  if j ? 'error' then
    raise exception 'chatbot_categorias_precios: gasto_categorias_agente(): %', j;
  end if;
  if (gasto_categorias_agente('bebidas')::jsonb #>> '{total,importe}')::numeric
     is distinct from (select (c ->> 'importe')::numeric from jsonb_array_elements(j -> 'categorias') c
                        where c ->> 'categoria' = 'Bebidas') then
    raise exception 'chatbot_categorias_precios: el total de Bebidas no cuadra con el reparto: %', j;
  end if;
  if not variacion_precios_agente(p_sentido => 'arriba')::jsonb ? 'error'
     or not gasto_categorias_agente('vinos', '2026-02-01', '2026-01-01')::jsonb ? 'error'
     or not gasto_categorias_agente(null, null, null, null, 'semana')::jsonb ? 'error' then
    raise exception 'chatbot_categorias_precios: las RPC no validan argumentos.';
  end if;
  select count(*) into n
    from pg_proc p join pg_namespace s on s.oid = p.pronamespace
   where s.nspname = 'public'
     and p.proname in ('categoria_agente', 'lineas_precio_agente', 'precio_referencia_agente', 'gasto_categorias_agente',
                       'variacion_precios_agente', 'mismo_proveedor_agente', 'productos_avisar_subidas', 'precio_es_agente')
     and has_function_privilege('anon', p.oid, 'execute');
  if n <> 0 then
    raise exception 'chatbot_categorias_precios: % funciones ejecutables por anon.', n;
  end if;
  if has_function_privilege('authenticated', 'public.productos_avisar_subidas(bigint[])', 'execute') then
    raise exception 'chatbot_categorias_precios: authenticated no debería ejecutar productos_avisar_subidas.';
  end if;
  if (select count(*) from pg_trigger where tgrelid = 'public.productos_factura'::regclass and not tgisinternal
         and tgname in ('trg_productos_factura_aviso_precio_ins', 'trg_productos_factura_aviso_precio_upd')) <> 2 then
    raise exception 'chatbot_categorias_precios: faltan los triggers de aviso de subida de precio.';
  end if;
end;
$$;

notify pgrst, 'reload schema';

commit;

-- Verificación (solo lectura): «chatbot_categorias_precios: aplicada | <vinos 2025-2026> | <nº subidas ≥ 10 %>».
select format('chatbot_categorias_precios: aplicada | %s | %s',
              coalesce(gasto_categorias_agente('vinos', '2025-01-01', '2026-12-31')::jsonb #>> '{total,importe}', '0'),
              variacion_precios_agente()::jsonb ->> 'total_productos') as resultado;
