set client_encoding = 'UTF8';
-- (Primera línea a propósito: comentarios con tilde; psql en una consola de
-- Windows puede arrancar en WIN1252.)
-- ===========================================================================
-- ##                                                                       ##
-- ##          NO APLICADA: la aplica el dueño a mano (ver pasos)           ##
-- ##                                                                       ##
-- ##   Facturas · catálogo de productos con categorías: «¿cuánto me        ##
-- ##   gasto en vinos, en marisco…?»                                       ##
-- ##                                                                       ##
-- ===========================================================================
--
-- POR QUÉ (07/10/2026, encargo del dueño)
--   Las líneas de facturas y albaranes (productos_factura) son texto libre del
--   OCR: el mismo producto llega escrito de cinco maneras («NATOP (20% nata
--   animal…» / «NATOP (20%nata…») y nada dice si es vino, marisco o una
--   reparación. Sin eso no se puede sumar el gasto por tipo de producto.
--
-- QUÉ CAMBIA
--   1. categorias_producto: taxonomía de DOS niveles (categoría › subcategoría
--      opcional), editable desde el panel. Semilla del dueño: Bebidas (Vinos,
--      Cervezas, Licores y destilados, Refrescos y aguas, Café e infusiones) ·
--      Pescado y marisco (Pescado, Marisco) · Carnes y embutidos (Carne,
--      Embutidos e ibéricos) · Lácteos y huevos · Frutas y verduras · Despensa ·
--      Panadería y repostería · Congelados · Limpieza y desechables · Menaje y
--      equipamiento · Servicios. `clave` estable (bebidas.vinos…) para el
--      chatbot y para esta carga; las que se creen en el panel van sin clave.
--   2. productos_catalogo: un producto CANÓNICO por cosa que se compra
--      (nombre único sin tildes ni mayúsculas, categoría, unidad habitual,
--      origen 'ia' | 'manual').
--   3. productos_alias: texto normalizado de línea (= productos_factura.
--      nombre_normalizado, normalizar_nombre_producto) → producto. Lo alimentan
--      esta carga, las correcciones del panel y la clasificación con IA.
--      (La tabla ANTIGUA productos_catalogo, vacía y sin uso, se renombra a
--      productos_catalogo_antigua; aborta si tuviera filas.)
--   4. productos_factura.producto_id (FK, ON DELETE SET NULL) + índices.
--   5. Trigger BEFORE INSERT/UPDATE OF nombre en productos_factura: si la
--      línea llega sin producto y su texto normalizado está en productos_alias,
--      se asigna SOLA (sin IA). Vale para los dos caminos de guardado
--      (procesar-factura/guardado.ts y ocr_sustituir_factura) sin tocarlos.
--   6. RPC SECURITY DEFINER con permiso de EDICIÓN de facturas comprobado
--      dentro (can_write_section('facturas'), el mismo de las políticas de
--      facturas/productos_factura): productos_renombrar, productos_recategorizar,
--      productos_fusionar (mueve líneas y alias al que queda y borra los demás),
--      productos_asignar_lineas (líneas → producto existente o nuevo),
--      productos_borrar (solo sin líneas). productos_aplicar_clasificacion_ia
--      solo para service_role (la llama la función clasificar-productos).
--   7. Lectura (SECURITY INVOKER, pasa por la RLS): productos_resumen (por
--      producto: compras, cantidades por unidad, gasto, último precio,
--      proveedores) y productos_gasto_por_categoria (por categoría, con «Sin
--      categoría» y «Sin clasificar»), ambas con periodo y tipo opcionales.
--      Gasto = suma de los importes de línea = BASE sin IVA.
--   8. RLS: lectura con can_read_section('facturas'); categorias_producto se
--      puede crear/editar con can_write_section('facturas') (no se borra: se
--      desactiva); catálogo y alias solo se escriben por las RPC.
--   9. Lo NUEVO: pg_cron «clasificar-productos» cada 5 min. Si hay líneas de
--      los últimos 7 días sin producto (de hace más de 1 min), llama por pg_net
--      a la función clasificar-productos con el secreto de Vault
--      «ocr_trabajos_secret» (el de ocr-trabajo: no hay secreto nuevo). Mudo si
--      no hay nada que clasificar o no existe el secreto. ia_funciones +
--      'clasificar-productos'.
--  10. CARGA INICIAL (datos explícitos, revisados a mano el 07/10/2026 sobre
--      la propuesta de gpt-5.6-luna): 116 productos, 130 alias y las 165 líneas
--      que había, por id. Solo se hace si el catálogo está vacío.
--
-- PASOS (desde adminpanelct/, POR TERMINAL; no en el SQL Editor)
--   1. npx supabase db query --linked -f supabase/migrations/20261007160000_productos_catalogo_categorias.sql
--      Tiene que imprimir «productos_catalogo_categorias: aplicada | 20 | 116 | 165/165»
--      (o más líneas si se ha subido algo después; las que coincidan con un
--      alias salen ya clasificadas).
--   2. npx supabase db query --linked -f supabase/tests/productos_catalogo_categorias_test.sql
--      (BEGIN … ROLLBACK: no deja nada escrito). Tiene que acabar en
--      «productos_catalogo_categorias_test: OK».
--   3. npx supabase functions deploy clasificar-productos
--      (verify_jwt = false en config.toml: el cron no lleva JWT; la función
--      comprueba el secreto o el usuario con permiso de edición).
--   4. Publicar el panel (pestaña Facturas › Productos).
--   Deshacer: supabase/rollbacks/20261007160000_productos_catalogo_categorias_ROLLBACK.sql
--   Idempotente: se puede ejecutar dos veces (la carga inicial no se repite).
-- ===========================================================================

begin;
set local lock_timeout = '5s';

-- ─── 0. Comprobación previa (aborta sin tocar nada) ─────────────────────────
do $$
begin
  if to_regprocedure('public.normalizar_nombre_producto(text)') is null
     or to_regprocedure('public.normalizar_texto(text)') is null then
    raise exception 'productos_catalogo_categorias: faltan normalizar_nombre_producto/normalizar_texto. No se ha cambiado nada.';
  end if;
  if to_regprocedure('public.can_read_section(text)') is null
     or to_regprocedure('public.can_write_section(text)') is null then
    raise exception 'productos_catalogo_categorias: faltan can_read_section/can_write_section. No se ha cambiado nada.';
  end if;
  if not exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'productos_factura'
                    and column_name = 'nombre_normalizado') then
    raise exception 'productos_catalogo_categorias: falta productos_factura.nombre_normalizado. No se ha cambiado nada.';
  end if;
  if exists (select 1 from information_schema.columns
              where table_schema = 'public' and table_name = 'productos_factura'
                and column_name = 'producto_id' and data_type <> 'bigint') then
    raise exception 'productos_catalogo_categorias: productos_factura.producto_id ya existe con otro tipo. No se ha cambiado nada.';
  end if;
  if not exists (select 1 from pg_extension where extname = 'pg_cron')
     or not exists (select 1 from pg_extension where extname = 'pg_net') then
    raise exception 'productos_catalogo_categorias: faltan pg_cron/pg_net. No se ha cambiado nada.';
  end if;
end;
$$;

-- ─── 1. Categorías ──────────────────────────────────────────────────────────
create table if not exists public.categorias_producto (
  id          bigint generated always as identity primary key,
  clave       text unique check (clave is null or clave ~ '^[a-z0-9_]+(\.[a-z0-9_]+)?$'),
  nombre      text not null check (length(btrim(nombre)) between 1 and 80),
  descripcion text check (descripcion is null or length(descripcion) <= 300),
  padre_id    bigint references public.categorias_producto(id) on delete restrict,
  orden       integer not null default 0,
  activa      boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint categorias_producto_no_es_su_padre check (padre_id is null or padre_id <> id)
);
create unique index if not exists uq_categorias_producto_nombre
  on public.categorias_producto (coalesce(padre_id, 0), lower(btrim(nombre)));
create index if not exists idx_categorias_producto_padre on public.categorias_producto (padre_id);
comment on table public.categorias_producto is
  'Taxonomía de productos de compra (facturas/albaranes): categoría › subcategoría opcional (dos niveles). '
  'clave estable para las de la semilla (bebidas.vinos…); las creadas en el panel van sin clave. No se borran: activa = false.';

-- Dos niveles como mucho, nombre sin espacios sobrantes y updated_at.
create or replace function public.categorias_producto_validar()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  new.nombre := btrim(regexp_replace(new.nombre, '\s+', ' ', 'g'));
  if new.padre_id is not null then
    if exists (select 1 from public.categorias_producto where id = new.padre_id and padre_id is not null) then
      raise exception 'Solo hay dos niveles: la categoría madre ya es una subcategoría' using errcode = '22023';
    end if;
    if tg_op = 'UPDATE' and exists (select 1 from public.categorias_producto where padre_id = new.id) then
      raise exception '«%» tiene subcategorías: no puede pasar a ser subcategoría', new.nombre using errcode = '22023';
    end if;
  end if;
  new.updated_at := now();
  return new;
end;
$$;
drop trigger if exists trg_categorias_producto_validar on public.categorias_producto;
create trigger trg_categorias_producto_validar
  before insert or update on public.categorias_producto
  for each row execute function public.categorias_producto_validar();

-- Semilla (no pisa lo que el dueño haya cambiado: on conflict do nothing).
insert into public.categorias_producto (clave, nombre, descripcion, orden) values
  ('bebidas',         'Bebidas',                null, 10),
  ('pescado_marisco', 'Pescado y marisco',      'Fresco, salazones y ahumados; también surimi.', 20),
  ('carnes',          'Carnes y embutidos',     null, 30),
  ('lacteos',         'Lácteos y huevos',       'Leche, nata, mantequilla, quesos, yogures y huevos.', 40),
  ('frutas_verduras', 'Frutas y verduras',      'Fruta, verdura, hortalizas, setas y hierbas frescas.', 50),
  ('despensa',        'Despensa',               'Aceites, vinagres, harinas, arroces, legumbres, conservas, salsas, especias, azúcar, fondos y espesantes.', 60),
  ('panaderia',       'Panadería y repostería', 'Pan, bollería, masas, postres, tartas, helados y chocolate de pastelería.', 70),
  ('congelados',      'Congelados',             'Congelados que no son ni pescado ni carne (patatas, verduras, masas…).', 80),
  ('limpieza',        'Limpieza y desechables', 'Productos de limpieza, papel, film, envases y desechables.', 90),
  ('menaje',          'Menaje y equipamiento',  'Vajilla, cristalería, utensilios, maquinaria, repuestos y material eléctrico o de fontanería.', 100),
  ('servicios',       'Servicios',              'Portes, mano de obra, reparaciones, guardias, gestión y logística, rappels y otros cargos sin producto.', 110)
on conflict (clave) do nothing;

insert into public.categorias_producto (clave, nombre, padre_id, orden, descripcion)
select v.clave, v.nombre, p.id, v.orden, v.descripcion
  from (values
    ('bebidas.vinos',            'bebidas',         'Vinos',                 10, 'Vino, cava y champán, también en Magnum.'),
    ('bebidas.cervezas',         'bebidas',         'Cervezas',              20, null),
    ('bebidas.licores',          'bebidas',         'Licores y destilados',  30, 'Ginebra, ron, whisky, vodka, tequila, licores y vermut.'),
    ('bebidas.refrescos',        'bebidas',         'Refrescos y aguas',     40, 'Refrescos, tónicas, zumos y aguas.'),
    ('bebidas.cafe',             'bebidas',         'Café e infusiones',     50, null),
    ('pescado_marisco.pescado',  'pescado_marisco', 'Pescado',               10, null),
    ('pescado_marisco.marisco',  'pescado_marisco', 'Marisco',               20, 'Crustáceos y moluscos.'),
    ('carnes.carne',             'carnes',          'Carne',                 10, null),
    ('carnes.embutidos',         'carnes',          'Embutidos e ibéricos',  20, 'Jamón, paleta, embutidos, panceta y cajas de ibéricos.')
  ) as v(clave, padre, nombre, orden, descripcion)
  join public.categorias_producto p on p.clave = v.padre
on conflict (clave) do nothing;

-- ─── 2. Catálogo de productos canónicos ─────────────────────────────────────
-- En producción ya existe una tabla `productos_catalogo` ANTIGUA (de antes del
-- repo: nombre, categoria varchar, unidad_medida, precio_actual,
-- proveedor_habitual_id, notas, activo), VACÍA y sin uso en ningún código (solo
-- en types.ts). Se aparta con otro nombre —sin borrar nada— para dejar sitio a
-- la nueva. Si tuviera filas, ABORTA sin tocar nada.
do $$
begin
  if to_regclass('public.productos_catalogo') is not null
     and not exists (select 1 from information_schema.columns
                      where table_schema = 'public' and table_name = 'productos_catalogo'
                        and column_name = 'nombre_normalizado') then
    if exists (select 1 from public.productos_catalogo) then
      raise exception 'productos_catalogo_categorias: la tabla ANTIGUA productos_catalogo tiene filas; revisa antes de aplicar. No se ha cambiado nada.';
    end if;
    if to_regclass('public.productos_catalogo_antigua') is not null then
      raise exception 'productos_catalogo_categorias: ya existe productos_catalogo_antigua. No se ha cambiado nada.';
    end if;
    alter table public.productos_catalogo rename to productos_catalogo_antigua;
    if exists (select 1 from pg_constraint where conrelid = 'public.productos_catalogo_antigua'::regclass
                  and conname = 'productos_catalogo_pkey') then
      alter table public.productos_catalogo_antigua rename constraint productos_catalogo_pkey to productos_catalogo_antigua_pkey;
    end if;
    if exists (select 1 from pg_constraint where conrelid = 'public.productos_catalogo_antigua'::regclass
                  and conname = 'productos_catalogo_proveedor_habitual_id_fkey') then
      alter table public.productos_catalogo_antigua
        rename constraint productos_catalogo_proveedor_habitual_id_fkey to productos_catalogo_antigua_proveedor_habitual_id_fkey;
    end if;
    if to_regclass('public.productos_catalogo_id_seq') is not null then
      alter sequence public.productos_catalogo_id_seq rename to productos_catalogo_antigua_id_seq;
    end if;
    comment on table public.productos_catalogo_antigua is
      'Tabla ANTIGUA, vacía y sin uso, apartada el 07/10/2026 por 20261007160000_productos_catalogo_categorias '
      '(el catálogo nuevo es productos_catalogo). Se puede borrar cuando se quiera.';
    raise notice 'productos_catalogo_categorias: la tabla antigua productos_catalogo (vacía) pasa a llamarse productos_catalogo_antigua.';
  end if;
end;
$$;

create table if not exists public.productos_catalogo (
  id                 bigint generated always as identity primary key,
  nombre             text not null check (length(btrim(nombre)) between 1 and 200),
  nombre_normalizado text generated always as (public.normalizar_texto(nombre)) stored,
  categoria_id       bigint references public.categorias_producto(id) on delete set null,
  unidad_habitual    text check (unidad_habitual is null or length(unidad_habitual) <= 20),
  origen             text not null default 'manual' check (origen in ('ia', 'manual')),
  creado_por         uuid,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
create unique index if not exists uq_productos_catalogo_nombre_normalizado
  on public.productos_catalogo (nombre_normalizado);
create index if not exists idx_productos_catalogo_categoria on public.productos_catalogo (categoria_id);
comment on table public.productos_catalogo is
  'Producto canónico de compra: varias líneas de factura con distinto texto (erratas del OCR, formatos) apuntan al mismo. '
  'origen ia = lo propuso la IA y nadie lo ha tocado; manual = creado o corregido por una persona.';

-- ─── 3. Alias: texto normalizado de línea → producto ────────────────────────
create table if not exists public.productos_alias (
  texto_normalizado text primary key check (length(texto_normalizado) between 1 and 500),
  producto_id       bigint not null references public.productos_catalogo(id) on delete cascade,
  origen            text not null default 'manual' check (origen in ('ia', 'manual')),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create index if not exists idx_productos_alias_producto on public.productos_alias (producto_id);
comment on table public.productos_alias is
  'Texto de línea normalizado (= productos_factura.nombre_normalizado, normalizar_nombre_producto) → producto canónico. '
  'Una línea nueva con ese texto se asigna sola (trigger trg_productos_factura_asignar_producto).';

create or replace function public.productos_tocar_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;
drop trigger if exists trg_productos_catalogo_updated_at on public.productos_catalogo;
create trigger trg_productos_catalogo_updated_at
  before update on public.productos_catalogo
  for each row execute function public.productos_tocar_updated_at();
drop trigger if exists trg_productos_alias_updated_at on public.productos_alias;
create trigger trg_productos_alias_updated_at
  before update on public.productos_alias
  for each row execute function public.productos_tocar_updated_at();

-- ─── 4. productos_factura.producto_id ───────────────────────────────────────
alter table public.productos_factura add column if not exists producto_id bigint;
do $$
begin
  if not exists (select 1 from pg_constraint
                  where conrelid = 'public.productos_factura'::regclass
                    and conname = 'productos_factura_producto_id_fkey') then
    alter table public.productos_factura
      add constraint productos_factura_producto_id_fkey
      foreign key (producto_id) references public.productos_catalogo(id) on delete set null;
  end if;
end;
$$;
create index if not exists idx_productos_factura_producto on public.productos_factura (producto_id);
create index if not exists idx_productos_factura_sin_producto
  on public.productos_factura (created_at) where producto_id is null;
comment on column public.productos_factura.producto_id is
  'Producto canónico (productos_catalogo). NULL = sin clasificar. Se asigna solo si el texto está en productos_alias; '
  'si no, lo propone la IA (función clasificar-productos, cron cada 5 min) o se corrige en Facturas › Productos.';

-- ─── 5. Asignación automática por alias (sin IA) ────────────────────────────
create or replace function public.productos_factura_asignar_producto()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.producto_id is null and new.nombre is not null then
    select a.producto_id into new.producto_id
      from public.productos_alias a
     where a.texto_normalizado = public.normalizar_nombre_producto(new.nombre);
  end if;
  return new;
end;
$$;
drop trigger if exists trg_productos_factura_asignar_producto on public.productos_factura;
create trigger trg_productos_factura_asignar_producto
  before insert or update of nombre on public.productos_factura
  for each row execute function public.productos_factura_asignar_producto();

-- ─── 6. RLS y privilegios ───────────────────────────────────────────────────
alter table public.categorias_producto enable row level security;
alter table public.productos_catalogo  enable row level security;
alter table public.productos_alias     enable row level security;

revoke all on public.categorias_producto, public.productos_catalogo, public.productos_alias from public, anon, authenticated;
grant select, insert, update on public.categorias_producto to authenticated;
grant select on public.productos_catalogo, public.productos_alias to authenticated;
grant all on public.categorias_producto, public.productos_catalogo, public.productos_alias to service_role;

drop policy if exists categorias_producto_select_seccion on public.categorias_producto;
create policy categorias_producto_select_seccion on public.categorias_producto
  for select to authenticated using (public.can_read_section('facturas'));
drop policy if exists categorias_producto_insert_seccion on public.categorias_producto;
create policy categorias_producto_insert_seccion on public.categorias_producto
  for insert to authenticated with check (public.can_write_section('facturas'));
drop policy if exists categorias_producto_update_seccion on public.categorias_producto;
create policy categorias_producto_update_seccion on public.categorias_producto
  for update to authenticated using (public.can_write_section('facturas')) with check (public.can_write_section('facturas'));
drop policy if exists categorias_producto_service_role on public.categorias_producto;
create policy categorias_producto_service_role on public.categorias_producto
  for all to service_role using (true) with check (true);

drop policy if exists productos_catalogo_select_seccion on public.productos_catalogo;
create policy productos_catalogo_select_seccion on public.productos_catalogo
  for select to authenticated using (public.can_read_section('facturas'));
drop policy if exists productos_catalogo_service_role on public.productos_catalogo;
create policy productos_catalogo_service_role on public.productos_catalogo
  for all to service_role using (true) with check (true);

drop policy if exists productos_alias_select_seccion on public.productos_alias;
create policy productos_alias_select_seccion on public.productos_alias
  for select to authenticated using (public.can_read_section('facturas'));
drop policy if exists productos_alias_service_role on public.productos_alias;
create policy productos_alias_service_role on public.productos_alias
  for all to service_role using (true) with check (true);

-- ─── 7. RPC de escritura (permiso comprobado dentro) ────────────────────────
create or replace function public.productos_puede_editar()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((select auth.role()) = 'service_role', false)
      or coalesce(public.can_write_section('facturas'), false)
$$;

create or replace function public.productos_renombrar(p_producto_id bigint, p_nombre text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_nombre text := btrim(regexp_replace(coalesce(p_nombre, ''), '\s+', ' ', 'g'));
  v_otro   public.productos_catalogo%rowtype;
  v_prod   public.productos_catalogo%rowtype;
  v_alias  text;
begin
  if not public.productos_puede_editar() then
    raise exception 'Cambiar productos exige permiso de edición en Facturas' using errcode = '42501';
  end if;
  if length(v_nombre) not between 1 and 200 then
    raise exception 'El nombre tiene que tener entre 1 y 200 caracteres' using errcode = '22023';
  end if;
  select * into v_prod from public.productos_catalogo where id = p_producto_id for update;
  if not found then
    raise exception 'No existe el producto %', p_producto_id using errcode = 'P0002';
  end if;
  select * into v_otro from public.productos_catalogo
   where nombre_normalizado = public.normalizar_texto(v_nombre) and id <> p_producto_id;
  if found then
    raise exception 'Ya existe «%» (producto %). Si son el mismo, fusiónalos.', v_otro.nombre, v_otro.id using errcode = '23505';
  end if;
  update public.productos_catalogo set nombre = v_nombre, origen = 'manual'
   where id = p_producto_id returning * into v_prod;
  v_alias := public.normalizar_nombre_producto(v_nombre);
  if length(coalesce(v_alias, '')) between 1 and 500 then
    insert into public.productos_alias (texto_normalizado, producto_id, origen)
    values (v_alias, p_producto_id, 'manual')
    on conflict (texto_normalizado) do nothing;
  end if;
  return to_jsonb(v_prod);
end;
$$;

create or replace function public.productos_recategorizar(p_producto_ids bigint[], p_categoria_id bigint)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  n integer;
begin
  if not public.productos_puede_editar() then
    raise exception 'Cambiar productos exige permiso de edición en Facturas' using errcode = '42501';
  end if;
  if p_categoria_id is not null
     and not exists (select 1 from public.categorias_producto where id = p_categoria_id and activa) then
    raise exception 'No existe la categoría % (o está desactivada)', p_categoria_id using errcode = 'P0002';
  end if;
  update public.productos_catalogo
     set categoria_id = p_categoria_id, origen = 'manual'
   where id = any(coalesce(p_producto_ids, '{}'));
  get diagnostics n = row_count;
  return n;
end;
$$;

create or replace function public.productos_fusionar(p_origen_ids bigint[], p_destino_id bigint)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_dest     public.productos_catalogo%rowtype;
  v_origen   bigint[];
  v_lineas   integer;
  v_alias    integer;
  v_borrados integer;
begin
  if not public.productos_puede_editar() then
    raise exception 'Fusionar productos exige permiso de edición en Facturas' using errcode = '42501';
  end if;
  select * into v_dest from public.productos_catalogo where id = p_destino_id for update;
  if not found then
    raise exception 'No existe el producto %', p_destino_id using errcode = 'P0002';
  end if;
  v_origen := array(select distinct x from unnest(coalesce(p_origen_ids, '{}')) as x
                     where x is not null and x <> p_destino_id order by x);
  if cardinality(v_origen) = 0 then
    raise exception 'Elige al menos otro producto que fusionar con «%»', v_dest.nombre using errcode = '22023';
  end if;
  perform 1 from public.productos_catalogo where id = any(v_origen) order by id for update;
  if (select count(*) from public.productos_catalogo where id = any(v_origen)) <> cardinality(v_origen) then
    raise exception 'Alguno de los productos que se iban a fusionar ya no existe. Recarga y vuelve a intentarlo.' using errcode = 'P0002';
  end if;

  update public.productos_factura set producto_id = p_destino_id where producto_id = any(v_origen);
  get diagnostics v_lineas = row_count;
  update public.productos_alias set producto_id = p_destino_id, origen = 'manual' where producto_id = any(v_origen);
  get diagnostics v_alias = row_count;
  -- El nombre de los fusionados sigue sirviendo para reconocer líneas.
  insert into public.productos_alias (texto_normalizado, producto_id, origen)
  select distinct public.normalizar_nombre_producto(nombre), p_destino_id, 'manual'
    from public.productos_catalogo
   where id = any(v_origen) and length(coalesce(public.normalizar_nombre_producto(nombre), '')) between 1 and 500
  on conflict (texto_normalizado) do nothing;
  -- Si el que queda no tenía categoría, hereda la del primero que la tenga.
  if v_dest.categoria_id is null then
    update public.productos_catalogo
       set categoria_id = (select categoria_id from public.productos_catalogo
                            where id = any(v_origen) and categoria_id is not null
                            order by array_position(p_origen_ids, id) limit 1)
     where id = p_destino_id;
  end if;
  delete from public.productos_catalogo where id = any(v_origen);
  get diagnostics v_borrados = row_count;
  update public.productos_catalogo set origen = 'manual' where id = p_destino_id;
  return jsonb_build_object('producto_id', p_destino_id, 'lineas_movidas', v_lineas,
                            'alias_movidos', v_alias, 'productos_borrados', v_borrados);
end;
$$;

create or replace function public.productos_asignar_lineas(
  p_linea_ids bigint[], p_producto_id bigint default null, p_nombre_nuevo text default null,
  p_categoria_id bigint default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ids     bigint[] := array(select distinct x from unnest(coalesce(p_linea_ids, '{}')) as x where x is not null);
  v_nombre  text := btrim(regexp_replace(coalesce(p_nombre_nuevo, ''), '\s+', ' ', 'g'));
  v_destino bigint;
  v_creado  boolean := false;
  v_unidad  text;
  v_lineas  integer;
  v_alias   integer;
begin
  if not public.productos_puede_editar() then
    raise exception 'Clasificar líneas exige permiso de edición en Facturas' using errcode = '42501';
  end if;
  if cardinality(v_ids) = 0 then
    raise exception 'No hay líneas que asignar' using errcode = '22023';
  end if;
  if (p_producto_id is null) = (v_nombre = '') then
    raise exception 'Indica un producto existente o el nombre de uno nuevo (solo una de las dos cosas)' using errcode = '22023';
  end if;
  if (select count(*) from public.productos_factura where id = any(v_ids)) <> cardinality(v_ids) then
    raise exception 'Alguna de las líneas ya no existe. Recarga y vuelve a intentarlo.' using errcode = 'P0002';
  end if;

  if p_producto_id is not null then
    select id into v_destino from public.productos_catalogo where id = p_producto_id;
    if v_destino is null then
      raise exception 'No existe el producto %', p_producto_id using errcode = 'P0002';
    end if;
  else
    if length(v_nombre) > 200 then
      raise exception 'El nombre tiene que tener entre 1 y 200 caracteres' using errcode = '22023';
    end if;
    if p_categoria_id is not null
       and not exists (select 1 from public.categorias_producto where id = p_categoria_id and activa) then
      raise exception 'No existe la categoría % (o está desactivada)', p_categoria_id using errcode = 'P0002';
    end if;
    select id into v_destino from public.productos_catalogo where nombre_normalizado = public.normalizar_texto(v_nombre);
    if v_destino is null then
      select unidad into v_unidad from public.productos_factura
       where id = any(v_ids) and unidad is not null
       group by unidad order by count(*) desc, unidad limit 1;
      insert into public.productos_catalogo (nombre, categoria_id, unidad_habitual, origen, creado_por)
      values (v_nombre, p_categoria_id, v_unidad, 'manual', auth.uid())
      returning id into v_destino;
      v_creado := true;
    end if;
  end if;

  update public.productos_factura set producto_id = v_destino where id = any(v_ids);
  get diagnostics v_lineas = row_count;
  -- Lo que corrige una persona manda: el texto de esas líneas pasa a ser de
  -- este producto también para lo que llegue después.
  insert into public.productos_alias (texto_normalizado, producto_id, origen)
  select distinct pf.nombre_normalizado, v_destino, 'manual'
    from public.productos_factura pf
   where pf.id = any(v_ids) and length(coalesce(pf.nombre_normalizado, '')) between 1 and 500
  on conflict (texto_normalizado) do update set producto_id = excluded.producto_id, origen = 'manual';
  get diagnostics v_alias = row_count;
  return jsonb_build_object('producto_id', v_destino, 'creado', v_creado, 'lineas', v_lineas, 'alias', v_alias);
end;
$$;

create or replace function public.productos_borrar(p_producto_id bigint)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  n integer;
begin
  if not public.productos_puede_editar() then
    raise exception 'Borrar productos exige permiso de edición en Facturas' using errcode = '42501';
  end if;
  select count(*) into n from public.productos_factura where producto_id = p_producto_id;
  if n > 0 then
    raise exception 'El producto tiene % línea(s): fusiónalo con otro o mueve sus líneas antes de borrarlo', n using errcode = '23503';
  end if;
  delete from public.productos_catalogo where id = p_producto_id;
  if not found then
    raise exception 'No existe el producto %', p_producto_id using errcode = 'P0002';
  end if;
end;
$$;

-- La llama SOLO la función clasificar-productos (service_role). Cada elemento:
-- {"textos":[texto normalizado…], "producto_id": n | null, "nombre": "…" | null,
--  "categoria_id": n | null, "unidad": "ud" | null}. Un alias que ya exista
-- manda sobre la propuesta (on conflict do nothing) y solo se tocan líneas
-- SIN producto: nunca pisa lo que haya corregido una persona.
create or replace function public.productos_aplicar_clasificacion_ia(p_items jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  it        jsonb;
  v_textos  text[];
  v_dest    bigint;
  v_cat     bigint;
  v_nombre  text;
  v_creados integer := 0;
  v_alias   integer := 0;
  v_lineas  integer := 0;
  n         integer;
begin
  if jsonb_typeof(p_items) is distinct from 'array' then
    raise exception 'p_items tiene que ser una lista' using errcode = '22023';
  end if;
  for it in select value from jsonb_array_elements(p_items) loop
    v_textos := array(select distinct t from jsonb_array_elements_text(
                        case when jsonb_typeof(it->'textos') = 'array' then it->'textos' else '[]'::jsonb end) as t
                       where length(t) between 1 and 500
                         and not exists (select 1 from public.productos_alias a where a.texto_normalizado = t));
    -- Textos que ya tienen alias: manda el alias (no se crea nada).
    continue when cardinality(v_textos) = 0;
    v_dest := null;
    if jsonb_typeof(it->'producto_id') = 'number' then
      select id into v_dest from public.productos_catalogo where id = (it->>'producto_id')::bigint;
    end if;
    if v_dest is null then
      v_nombre := btrim(regexp_replace(coalesce(it->>'nombre', ''), '\s+', ' ', 'g'));
      continue when length(v_nombre) not between 1 and 200;
      select id into v_dest from public.productos_catalogo where nombre_normalizado = public.normalizar_texto(v_nombre);
      if v_dest is null then
        v_cat := null;
        if jsonb_typeof(it->'categoria_id') = 'number' then
          select id into v_cat from public.categorias_producto where id = (it->>'categoria_id')::bigint and activa;
        end if;
        insert into public.productos_catalogo (nombre, categoria_id, unidad_habitual, origen)
        values (v_nombre, v_cat, nullif(left(btrim(coalesce(it->>'unidad', '')), 20), ''), 'ia')
        returning id into v_dest;
        v_creados := v_creados + 1;
      end if;
    end if;
    insert into public.productos_alias (texto_normalizado, producto_id, origen)
    select t, v_dest, 'ia' from unnest(v_textos) as t
    on conflict (texto_normalizado) do nothing;
    get diagnostics n = row_count;
    v_alias := v_alias + n;
  end loop;
  update public.productos_factura pf
     set producto_id = a.producto_id
    from public.productos_alias a
   where pf.producto_id is null and a.texto_normalizado = pf.nombre_normalizado;
  get diagnostics v_lineas = row_count;
  return jsonb_build_object('productos_creados', v_creados, 'alias_creados', v_alias, 'lineas_asignadas', v_lineas);
end;
$$;

-- ─── 8. Lectura para la pantalla y el chatbot (pasan por la RLS) ────────────
create or replace function public.productos_resumen(
  p_desde date default null, p_hasta date default null, p_tipo text default null)
returns table (
  producto_id        bigint,
  nombre             text,
  categoria_id       bigint,
  origen             text,
  unidad_habitual    text,
  compras            integer,
  documentos         integer,
  cantidades         jsonb,
  gasto              numeric,
  lineas_sin_importe integer,
  ultimo_precio      numeric,
  ultima_fecha       date,
  proveedores        text[])
language sql
stable
security invoker
set search_path = public
as $$
  with l as (
    select pf.id, pf.producto_id, pf.factura_id, pf.cantidad, coalesce(nullif(btrim(pf.unidad), ''), '') as unidad,
           pf.total, pf.precio_unitario, f.fecha, f.proveedor
      from public.productos_factura pf
      join public.facturas f on f.id = pf.factura_id
     where pf.producto_id is not null
       and (p_desde is null or f.fecha >= p_desde)
       and (p_hasta is null or f.fecha <= p_hasta)
       and (p_tipo is null or f.tipo = p_tipo)
  ),
  cant as (
    select x.producto_id, jsonb_object_agg(x.unidad, x.suma order by x.unidad) as c
      from (select producto_id, unidad, round(sum(cantidad), 3) as suma from l group by producto_id, unidad) as x
     group by x.producto_id
  ),
  ult as (
    select distinct on (producto_id) producto_id, precio_unitario, fecha
      from l where precio_unitario is not null
     order by producto_id, fecha desc nulls last, id desc
  )
  select p.id, p.nombre, p.categoria_id, p.origen, p.unidad_habitual,
         count(l.id)::integer,
         count(distinct l.factura_id)::integer,
         coalesce(cant.c, '{}'::jsonb),
         round(coalesce(sum(l.total), 0), 2),
         (count(l.id) filter (where l.total is null))::integer,
         ult.precio_unitario,
         max(l.fecha),
         coalesce(array_agg(distinct l.proveedor) filter (where l.proveedor is not null), '{}'::text[])
    from public.productos_catalogo p
    left join l    on l.producto_id = p.id
    left join cant on cant.producto_id = p.id
    left join ult  on ult.producto_id = p.id
   group by p.id, cant.c, ult.precio_unitario
   order by round(coalesce(sum(l.total), 0), 2) desc, p.nombre;
$$;

create or replace function public.productos_gasto_por_categoria(
  p_desde date default null, p_hasta date default null, p_tipo text default null)
returns table (
  categoria_id       bigint,
  categoria          text,
  padre_id           bigint,
  padre              text,
  sin_clasificar     boolean,
  gasto              numeric,
  lineas             integer,
  productos          integer,
  lineas_sin_importe integer)
language sql
stable
security invoker
set search_path = public
as $$
  select c.id,
         coalesce(c.nombre, case when pf.producto_id is null then 'Sin clasificar' else 'Sin categoría' end),
         c.padre_id,
         pc.nombre,
         pf.producto_id is null,
         round(coalesce(sum(pf.total), 0), 2),
         count(*)::integer,
         count(distinct pf.producto_id)::integer,
         (count(*) filter (where pf.total is null))::integer
    from public.productos_factura pf
    join public.facturas f on f.id = pf.factura_id
    left join public.productos_catalogo p   on p.id = pf.producto_id
    left join public.categorias_producto c  on c.id = p.categoria_id
    left join public.categorias_producto pc on pc.id = c.padre_id
   where (p_desde is null or f.fecha >= p_desde)
     and (p_hasta is null or f.fecha <= p_hasta)
     and (p_tipo is null or f.tipo = p_tipo)
   group by c.id, c.nombre, c.padre_id, pc.nombre, pf.producto_id is null
   order by round(coalesce(sum(pf.total), 0), 2) desc;
$$;

-- ─── 9. Clasificación de lo nuevo: cron → clasificar-productos ──────────────
create or replace function public.productos_despachar_clasificacion()
returns integer
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  c_url     constant text := 'https://jeamoczmbfsnwkfjxcyo.supabase.co/functions/v1/clasificar-productos';
  v_secreto text;
begin
  if not exists (select 1 from public.productos_factura
                  where producto_id is null
                    and created_at > now() - interval '7 days'
                    and created_at < now() - interval '1 minute') then
    return 0;
  end if;
  select s.decrypted_secret into v_secreto
    from vault.decrypted_secrets s where s.name = 'ocr_trabajos_secret' limit 1;
  if v_secreto is null or v_secreto = '' then
    return 0;
  end if;
  perform net.http_post(
    url := c_url,
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-ocr-secret', v_secreto),
    body := jsonb_build_object('modo', 'cron'),
    timeout_milliseconds := 10000);
  return 1;
end;
$$;

select cron.unschedule('clasificar-productos')
 where exists (select 1 from cron.job where jobname = 'clasificar-productos');
select cron.schedule('clasificar-productos', '*/5 * * * *',
                     $cron$ select public.productos_despachar_clasificacion(); $cron$);

do $$
begin
  if to_regclass('public.ia_funciones') is not null then
    insert into public.ia_funciones (funcion, descripcion, instrumentada, unidad, orden, activo)
    values ('clasificar-productos',
            'Clasifica las líneas de factura nuevas sin producto (catálogo y categoría). Una llamada barata por tanda; '
            'la lanza el cron clasificar-productos cada 5 min si hay líneas recientes sin clasificar, o el botón de Facturas › Productos.',
            true, 'tanda', 80, true)
    on conflict (funcion) do nothing;
  end if;
end;
$$;

-- ─── 10. Privilegios de las funciones ───────────────────────────────────────
revoke all on function public.categorias_producto_validar() from public, anon, authenticated;
revoke all on function public.productos_tocar_updated_at() from public, anon, authenticated;
revoke all on function public.productos_factura_asignar_producto() from public, anon, authenticated;
revoke all on function public.productos_puede_editar() from public, anon;
grant execute on function public.productos_puede_editar() to authenticated, service_role;
revoke all on function public.productos_renombrar(bigint, text) from public, anon;
grant execute on function public.productos_renombrar(bigint, text) to authenticated, service_role;
revoke all on function public.productos_recategorizar(bigint[], bigint) from public, anon;
grant execute on function public.productos_recategorizar(bigint[], bigint) to authenticated, service_role;
revoke all on function public.productos_fusionar(bigint[], bigint) from public, anon;
grant execute on function public.productos_fusionar(bigint[], bigint) to authenticated, service_role;
revoke all on function public.productos_asignar_lineas(bigint[], bigint, text, bigint) from public, anon;
grant execute on function public.productos_asignar_lineas(bigint[], bigint, text, bigint) to authenticated, service_role;
revoke all on function public.productos_borrar(bigint) from public, anon;
grant execute on function public.productos_borrar(bigint) to authenticated, service_role;
revoke all on function public.productos_aplicar_clasificacion_ia(jsonb) from public, anon, authenticated;
grant execute on function public.productos_aplicar_clasificacion_ia(jsonb) to service_role;
revoke all on function public.productos_resumen(date, date, text) from public, anon;
grant execute on function public.productos_resumen(date, date, text) to authenticated, service_role;
revoke all on function public.productos_gasto_por_categoria(date, date, text) from public, anon;
grant execute on function public.productos_gasto_por_categoria(date, date, text) to authenticated, service_role;
revoke all on function public.productos_despachar_clasificacion() from public, anon, authenticated;
grant execute on function public.productos_despachar_clasificacion() to service_role;

-- ─── 11. Carga inicial (07/10/2026): solo con el catálogo vacío ─────────────
-- Propuesta de gpt-5.6-luna sobre los 130 textos distintos de las 165 líneas,
-- revisada a mano: fusionadas erratas del OCR («Rústico romodico» → pomodoro,
-- picos «Orondo» → Obando, crujiente de wasabi «4 u» → el de 48 u, mismo
-- precio), helados del obrador (Racionalismo Dulce) en Panadería y repostería,
-- caja regalo de jamón Joselito (4 × 450 €) en Embutidos e ibéricos, caja con
-- asa (envase, 0 €) en Limpieza y desechables, surimi Krissia en Pescado.
do $carga$
declare
  n_prod   integer;
  n_alias  integer;
  n_sin    integer;
  n_lineas integer;
begin
  if exists (select 1 from public.productos_catalogo) then
    raise notice 'productos_catalogo_categorias: el catálogo ya tiene productos; no se repite la carga inicial.';
    return;
  end if;

  insert into public.productos_catalogo (nombre, categoria_id, unidad_habitual, origen)
  select v.nombre, c.id, v.unidad, 'ia'
    from (values
    ('Absolut Vodka 70 cl',                               'bebidas.licores',           'ud'),
    ('Amaretto Disaronno 70 cl',                          'bebidas.licores',           'ud'),
    ('Barceló Añejo 70 cl',                               'bebidas.licores',           'ud'),
    ('Beefeater 70 cl',                                   'bebidas.licores',           'ud'),
    ('Brugal 1888 70 cl',                                 'bebidas.licores',           'ud'),
    ('Brugal Añejo 70 cl',                                'bebidas.licores',           'ud'),
    ('Cuervo Especial Reposado 70 cl',                    'bebidas.licores',           'ud'),
    ('Jack Daniel''s 70 cl',                              'bebidas.licores',           'ud'),
    ('Johnnie Walker Black 70 cl',                        'bebidas.licores',           'ud'),
    ('Johnnie Walker Red 70 cl',                          'bebidas.licores',           'ud'),
    ('Larios 12 Premium 70 cl',                           'bebidas.licores',           'ud'),
    ('Larios Rosé 70 cl',                                 'bebidas.licores',           'ud'),
    ('Ricard 1 L',                                        'bebidas.licores',           'ud'),
    ('Tanqueray 70 cl',                                   'bebidas.licores',           'ud'),
    ('Almirez',                                           'bebidas.vinos',             'ud'),
    ('Almirez Magnum',                                    'bebidas.vinos',             'ud'),
    ('Alter Ego',                                         'bebidas.vinos',             'ud'),
    ('Château Cheval Blanc',                              'bebidas.vinos',             'ud'),
    ('Château Climens',                                   'bebidas.vinos',             'ud'),
    ('Château Lafite Rothschild',                         'bebidas.vinos',             'ud'),
    ('Château Palmer',                                    'bebidas.vinos',             'ud'),
    ('Corullón Magnum',                                   'bebidas.vinos',             'ud'),
    ('Dofí',                                              'bebidas.vinos',             'ud'),
    ('El Puntido',                                        'bebidas.vinos',             'ud'),
    ('El Tamboril Tinto',                                 'bebidas.vinos',             'ud'),
    ('Flor de Pingus',                                    'bebidas.vinos',             'ud'),
    ('Flor de Pingus Magnum',                             'bebidas.vinos',             'ud'),
    ('Gratallops',                                        'bebidas.vinos',             'ud'),
    ('La Cueva del Contador',                             'bebidas.vinos',             'ud'),
    ('Las Llamas',                                        'bebidas.vinos',             'ud'),
    ('Las Umbrías',                                       'bebidas.vinos',             'ud'),
    ('Moncerbal',                                         'bebidas.vinos',             'ud'),
    ('PSI',                                               'bebidas.vinos',             'ud'),
    ('PSI Magnum',                                        'bebidas.vinos',             'ud'),
    ('Quiñón de Valmira',                                 'bebidas.vinos',             'ud'),
    ('Tardieu-Laurent Hermitage tinto',                   'bebidas.vinos',             'ud'),
    ('Tumba del Rey Moro',                                'bebidas.vinos',             'ud'),
    ('Vino Gran Reserva 75 cl (Guillén)',                 'bebidas.vinos',             'ud'),
    ('Costilla confitada en su jugo Buenapinta',          'carnes.carne',              'kg'),
    ('Caja regalo de jamón (Navidad)',                    'carnes.embutidos',          'ud'),
    ('Jamón 5J bellota 100 % ibérico',                    'carnes.embutidos',          'ca'),
    ('Jamón de cebo de campo Lisardo Castro',             'carnes.embutidos',          'kg'),
    ('Jamón Joselito Gran Reserva',                       'carnes.embutidos',          'ud'),
    ('Paleta 5J bellota 100 % ibérica',                   'carnes.embutidos',          'ca'),
    ('Panceta ibérica de bellota 3 kg',                   'carnes.embutidos',          'kg'),
    ('Crujiente de wasabi Didess',                        'despensa',                  'ud'),
    ('Maizena Express clara bote 1 kg',                   'despensa',                  'ud'),
    ('Maizena Express oscura bote 1 kg',                  'despensa',                  'ud'),
    ('Mayonesa Hellmann''s cubo 5 L',                     'despensa',                  'ud'),
    ('Mermelada chutney de manzana Can Bech',             'despensa',                  'ud'),
    ('Mix de flores secas Sosa 50 g',                     'despensa',                  'ud'),
    ('Mostaza de cerveza Rooftop 150 g',                  'despensa',                  'ud'),
    ('Perdiz deshuesada en escabeche Candida',            'despensa',                  'ud'),
    ('Roux claro Knorr 1 kg',                             'despensa',                  'ud'),
    ('Salsa pomodoro Knorr 875 g',                        'despensa',                  'ud'),
    ('Alcachofa',                                         'frutas_verduras',           'kg'),
    ('Calabacín',                                         'frutas_verduras',           'kg'),
    ('Limón fino',                                        'frutas_verduras',           'kg'),
    ('Patata mini',                                       'frutas_verduras',           'kg'),
    ('Tomate Daniela',                                    'frutas_verduras',           'kg'),
    ('Tomate Raf',                                        'frutas_verduras',           'kg'),
    ('Nata Natop Debic 2 L',                              'lacteos',                   'kg'),
    ('Caja con asa para jamón',                           'limpieza',                  'ud'),
    ('Base de tapa ciega Efapel',                         'menaje',                    'ud'),
    ('Cable libre de halógenos 1,5',                      'menaje',                    'm'),
    ('Cable libre de halógenos 1x16',                     'menaje',                    'm'),
    ('Contactor 220 V 40 A',                              'menaje',                    'ud'),
    ('Diferencial 4P 63 A AEG 605770',                    'menaje',                    'ud'),
    ('Fichas de carril automáticos D UT 13',              'menaje',                    'ud'),
    ('Fuente oval Stolt 26,5x13 cm',                      'menaje',                    'ud'),
    ('Interruptor diferencial 10 A 1P+N 30 mA',           'menaje',                    'ud'),
    ('Interruptor diferencial 16 A 1P+N 30 mA',           'menaje',                    'ud'),
    ('Marco de 1 elemento Efapel 90810 TBR blanco',       'menaje',                    'ud'),
    ('Material de fontanería',                            'menaje',                    'ud'),
    ('Plato llano Stolt 16,5 cm',                         'menaje',                    'ud'),
    ('Plato Quadro azul suave 14x14 cm',                  'menaje',                    'ud'),
    ('Punteras aisladas TE-16 marfil',                    'menaje',                    'ud'),
    ('Punteras aisladas TE-2,5 gris',                     'menaje',                    'ud'),
    ('Tapa ciega blanca Efapel 90677 TBR',                'menaje',                    'ud'),
    ('Terminales CUT T-16/8',                             'menaje',                    'ud'),
    ('Tirador de puerta Liebherr',                        'menaje',                    'ud'),
    ('Tope de borna para fichas de carril',               'menaje',                    'ud'),
    ('Ventilador 5 W 220 V multianclaje',                 'menaje',                    'ud'),
    ('Helado de chocolate negro 70 %',                    'panaderia',                 'ud'),
    ('Helado de frambuesa',                               'panaderia',                 'ud'),
    ('Helado de limón del limonero',                      'panaderia',                 'ud'),
    ('Helado de turrón Jijona',                           'panaderia',                 'ud'),
    ('Helado de vainilla bourbon',                        'panaderia',                 'ud'),
    ('Helado de yema quemada',                            'panaderia',                 'ud'),
    ('Helado de yogur',                                   'panaderia',                 'ud'),
    ('Láminas de hojaldre invertido caramelizado',        'panaderia',                 'ud'),
    ('Picos sin gluten Obando 25 ud',                     'panaderia',                 'ud'),
    ('Rosquilla natural caja 2 kg',                       'panaderia',                 'ud'),
    ('Rústico pomodoro y oliva Laduc 3 kg',               'panaderia',                 'kg'),
    ('Tarta de caramelo salado y queso manchego',         'panaderia',                 'ud'),
    ('Almeja fina',                                       'pescado_marisco.marisco',   'ud'),
    ('Berberecho',                                        'pescado_marisco.marisco',   'ud'),
    ('Buey de mar gallego hembra 1-1,5 kg',               'pescado_marisco.marisco',   'kg'),
    ('Centolla hembra 1-1,5 kg',                          'pescado_marisco.marisco',   'kg'),
    ('Gambón zarado XXL Gegarri',                         'pescado_marisco.marisco',   'kg'),
    ('Navaja',                                            'pescado_marisco.marisco',   'ud'),
    ('Nécora gallega hembra M',                           'pescado_marisco.marisco',   'kg'),
    ('Bonito limpio en lomos',                            'pescado_marisco.pescado',   'kg'),
    ('Espinas de salmonete Maritimus',                    'pescado_marisco.pescado',   'kg'),
    ('Huevas de maruca',                                  'pescado_marisco.pescado',   'kg'),
    ('Huevas de mújol',                                   'pescado_marisco.pescado',   'kg'),
    ('Lubina gallega de anzuelo 1-1,5 kg',                'pescado_marisco.pescado',   'kg'),
    ('Merluza M-5',                                       'pescado_marisco.pescado',   'kg'),
    ('Rape G 3-4 kg',                                     'pescado_marisco.pescado',   'kg'),
    ('Surimi Krissia puntas y recortes 5 kg',             'pescado_marisco.pescado',   'kg'),
    ('Gestión y logística',                               'servicios',                 'ud'),
    ('Mano de obra oficial',                              'servicios',                 'ud'),
    ('Portes',                                            'servicios',                 'ud'),
    ('Rappel por marketing y escaparate',                 'servicios',                 'ud'),
    ('Servicio de guardia',                               'servicios',                 'ud'),
    ('Trabajos',                                          'servicios',                 'ud')
    ) as v(nombre, clave, unidad)
    join public.categorias_producto c on c.clave = v.clave;
  get diagnostics n_prod = row_count;
  if n_prod <> 116 then
    raise exception 'productos_catalogo_categorias: se esperaban 116 productos y se han creado % (¿falta una categoría de la semilla?)', n_prod;
  end if;

  with v(texto, producto) as (values
    ('vodka absolut 70 cl.',                                                'Absolut Vodka 70 cl'),
    ('amaretto disaronno 70 cl.',                                           'Amaretto Disaronno 70 cl'),
    ('barcelo anejo 70 cl.',                                                'Barceló Añejo 70 cl'),
    ('beefeater 70 cl.',                                                    'Beefeater 70 cl'),
    ('brugal 1888 70 cl.',                                                  'Brugal 1888 70 cl'),
    ('brugal anejo 70 cl.',                                                 'Brugal Añejo 70 cl'),
    ('cuervo especial reposado 70 cl.',                                     'Cuervo Especial Reposado 70 cl'),
    ('jack daniels 70 cl.',                                                 'Jack Daniel''s 70 cl'),
    ('johnnie walker black 70 cl.',                                         'Johnnie Walker Black 70 cl'),
    ('johnnie walker red 70 cl.',                                           'Johnnie Walker Red 70 cl'),
    ('gin larios 12 premium 70 cl.',                                        'Larios 12 Premium 70 cl'),
    ('gin larios rose 70 cl.',                                              'Larios Rosé 70 cl'),
    ('ricard 1 lto.',                                                       'Ricard 1 L'),
    ('tanqueray 70 cl.',                                                    'Tanqueray 70 cl'),
    ('almirez 2023 (premier)',                                              'Almirez'),
    ('almirez magnum 2023 (premier)',                                       'Almirez Magnum'),
    ('alter ego 2023 (premier)',                                            'Alter Ego'),
    ('chat. cheval blanc 2023 (premier)',                                   'Château Cheval Blanc'),
    ('chat. climens 2023 (premier)',                                        'Château Climens'),
    ('chat. lafite rothsch. 2023 (premier)',                                'Château Lafite Rothschild'),
    ('chat. palmer 2023 (premier)',                                         'Château Palmer'),
    ('corullon magnum 2023 (premier)',                                      'Corullón Magnum'),
    ('dofi 2023 (premier)',                                                 'Dofí'),
    ('el puntido 2022 (premier)',                                           'El Puntido'),
    ('el tamboril tinto 2023 (premier)',                                    'El Tamboril Tinto'),
    ('flor de pingus 2023 (premier)',                                       'Flor de Pingus'),
    ('flor de pingus magnum 2023 (premier)',                                'Flor de Pingus Magnum'),
    ('gratallops 2023 (premier)',                                           'Gratallops'),
    ('la cueva del contador 2023 (premier)',                                'La Cueva del Contador'),
    ('las llamas 2023 (premier)',                                           'Las Llamas'),
    ('las umbrias 2023 (premier)',                                          'Las Umbrías'),
    ('moncerbal 2023 (premier)',                                            'Moncerbal'),
    ('psi 2023 (premier)',                                                  'PSI'),
    ('psi mgn. 2023 (premier)',                                             'PSI Magnum'),
    ('quinon de valmira 2023 (premier)',                                    'Quiñón de Valmira'),
    ('t. laur. hermitage tinto 2023 (premier)',                             'Tardieu-Laurent Hermitage tinto'),
    ('tumba del rey moro 2023 (premier)',                                   'Tumba del Rey Moro'),
    ('gran reserva 75cl',                                                   'Vino Gran Reserva 75 cl (Guillén)'),
    ('fr.costilla confitada en su jugo (350/450) -buenapinta-',             'Costilla confitada en su jugo Buenapinta'),
    ('caja regalo jamon navidad',                                           'Caja regalo de jamón (Navidad)'),
    ('jamon bellota 100% iberico 5,0-10 kg n24',                            'Jamón 5J bellota 100 % ibérico'),
    ('jamon (cebo campo 50 kilos) -lisardo castro-',                        'Jamón de cebo de campo Lisardo Castro'),
    ('jamon joselito g.r.',                                                 'Jamón Joselito Gran Reserva'),
    ('jamon joselito g.r. (2)',                                             'Jamón Joselito Gran Reserva'),
    ('paleta bellota 100% iberica 5j 5-6 kg extraclaridad n24',             'Paleta 5J bellota 100 % ibérica'),
    ('panceta iberica bellota (pzas. 3 k aprox) -s.m-',                     'Panceta ibérica de bellota 3 kg'),
    ('crujiente de wasabi (c/ 4 u) didess',                                 'Crujiente de wasabi Didess'),
    ('crujiente de wasabi (c/ 48 u) didess',                                'Crujiente de wasabi Didess'),
    ('maizena express clara (bote 1k)',                                     'Maizena Express clara bote 1 kg'),
    ('maizena express oscura (bote 1k)',                                    'Maizena Express oscura bote 1 kg'),
    ('mayonesa original (cubo 5l) -hellmanns-',                             'Mayonesa Hellmann''s cubo 5 L'),
    ('mermelada-chutney- manzana (t/260g) can bech',                        'Mermelada chutney de manzana Can Bech'),
    ('mermelada-chutney- manzana (t/260g)can bech',                         'Mermelada chutney de manzana Can Bech'),
    ('ss.mix flores secas (50g) -sosa-',                                    'Mix de flores secas Sosa 50 g'),
    ('mostaza de cerveza 150g -rooftop-',                                   'Mostaza de cerveza Rooftop 150 g'),
    ('mostaza de cerveza 150g -rootop-',                                    'Mostaza de cerveza Rooftop 150 g'),
    ('perdiz (deshuesada) escabeche (tarro/400g)-candida',                  'Perdiz deshuesada en escabeche Candida'),
    ('roux claro (bote 1k) -knorr-',                                        'Roux claro Knorr 1 kg'),
    ('salsa pomodoro (bote 875g) -knorr-',                                  'Salsa pomodoro Knorr 875 g'),
    ('alcachofa d.',                                                        'Alcachofa'),
    ('calabacin',                                                           'Calabacín'),
    ('limon fino',                                                          'Limón fino'),
    ('patatas mini',                                                        'Patata mini'),
    ('tomate daniela i m',                                                  'Tomate Daniela'),
    ('tomate raf',                                                          'Tomate Raf'),
    ('natop (20% nata animal de 35mg) 2 l -debic-',                         'Nata Natop Debic 2 L'),
    ('natop (20%nata animal de 35mg) 2 l -debic-',                          'Nata Natop Debic 2 L'),
    ('caja con asa para jamon',                                             'Caja con asa para jamón'),
    ('base de tapa ciega efapel',                                           'Base de tapa ciega Efapel'),
    ('metros de cable libre de halogeno 1,5',                               'Cable libre de halógenos 1,5'),
    ('metros de cable libre de halogeno 1x16',                              'Cable libre de halógenos 1x16'),
    ('contactor 220v 40a',                                                  'Contactor 220 V 40 A'),
    ('diferencial 4p 63a aeg 605770',                                       'Diferencial 4P 63 A AEG 605770'),
    ('fichas de carril automaticos d ut 13',                                'Fichas de carril automáticos D UT 13'),
    ('fuente oval stolt o 26,5x13 cm (12) vitroporcelana',                  'Fuente oval Stolt 26,5x13 cm'),
    ('inte/dif 6ka 30ma 1p+n 10a opw1n10c030a',                             'Interruptor diferencial 10 A 1P+N 30 mA'),
    ('inte/dif 6ka 30ma 1p+n 16a opw1n16c030a',                             'Interruptor diferencial 16 A 1P+N 30 mA'),
    ('marcos de 1 efapel 90810tbr bl',                                      'Marco de 1 elemento Efapel 90810 TBR blanco'),
    ('material fontaneria',                                                 'Material de fontanería'),
    ('plato llano stolt o 16,50 cm (12) vitroporcelana',                    'Plato llano Stolt 16,5 cm'),
    ('plato quadro azul suave 14x14 cm',                                    'Plato Quadro azul suave 14x14 cm'),
    ('punteras asisladas marfil te-16',                                     'Punteras aisladas TE-16 marfil'),
    ('punteras aisladas te-2,5 gris',                                       'Punteras aisladas TE-2,5 gris'),
    ('tapa ciega blanco 90677 tbr efapel',                                  'Tapa ciega blanca Efapel 90677 TBR'),
    ('terminales cut t-16/8',                                               'Terminales CUT T-16/8'),
    ('tirador / puerta original liebherr',                                  'Tirador de puerta Liebherr'),
    ('tope borna fichas de carril',                                         'Tope de borna para fichas de carril'),
    ('ventilador 5w 220v multianclaje',                                     'Ventilador 5 W 220 V multianclaje'),
    ('cobertura negra 70%',                                                 'Helado de chocolate negro 70 %'),
    ('frambuesa',                                                           'Helado de frambuesa'),
    ('limon del limonero',                                                  'Helado de limón del limonero'),
    ('turron jijona artesana',                                              'Helado de turrón Jijona'),
    ('vainilla bourbon',                                                    'Helado de vainilla bourbon'),
    ('yema quemada',                                                        'Helado de yema quemada'),
    ('yogourt',                                                             'Helado de yogur'),
    ('laminas (c/ 72 rac.) hojaldre invertido caramelizado',                'Láminas de hojaldre invertido caramelizado'),
    ('laminas (c/ 72 rac.) hojaldre invertido caramelozado',                'Láminas de hojaldre invertido caramelizado'),
    ('laminas (c/72 rac.) hojaldre invertido caramelizado',                 'Láminas de hojaldre invertido caramelizado'),
    ('picos sin gluten (c/ 25 u) (individual 20g) obando',                  'Picos sin gluten Obando 25 ud'),
    ('picos sin gluten (c/25 u)(individual 20g) obando',                    'Picos sin gluten Obando 25 ud'),
    ('picos sin gluten c/c 25 u (individual 20g) orondo',                   'Picos sin gluten Obando 25 ud'),
    ('roskilla natural (c/ 2 k) individuales',                              'Rosquilla natural caja 2 kg'),
    ('rosquilla natural (c/ 2 k) individuales',                             'Rosquilla natural caja 2 kg'),
    ('rustico pomodoro y oliva 10g (c / 3kg)-laduc-',                       'Rústico pomodoro y oliva Laduc 3 kg'),
    ('rustico pomodoro y oliva 10g (c/ 3kg)-laduc-',                        'Rústico pomodoro y oliva Laduc 3 kg'),
    ('rustico romodico y oliva 10g (c/ 3kg)-laduc-',                        'Rústico pomodoro y oliva Laduc 3 kg'),
    ('tarta caramelo salado / queso manchego (1.5 k) -candida',             'Tarta de caramelo salado y queso manchego'),
    ('almeja fina',                                                         'Almeja fina'),
    ('berberecho',                                                          'Berberecho'),
    ('buey de mar gallego hembra 1-1.5 kg',                                 'Buey de mar gallego hembra 1-1,5 kg'),
    ('centolla hembra 1-1.5 kg',                                            'Centolla hembra 1-1,5 kg'),
    ('gambon zarado xxl (c/2k- 45u aprox) -gegarri-',                       'Gambón zarado XXL Gegarri'),
    ('navaja',                                                              'Navaja'),
    ('necora galega hembra m',                                              'Nécora gallega hembra M'),
    ('bonito entero, partidos en lomos y limpio',                           'Bonito limpio en lomos'),
    ('espinas pescado salmonete (b/ 2k) -maritimus-',                       'Espinas de salmonete Maritimus'),
    ('espinas pescado salmonete (b/2k) -maritimus-',                        'Espinas de salmonete Maritimus'),
    ('huevas de maruca calidad',                                            'Huevas de maruca'),
    ('huevas de mujol seleccion extra malla',                               'Huevas de mújol'),
    ('lubina galega anzuelo 1-1.5 kg',                                      'Lubina gallega de anzuelo 1-1,5 kg'),
    ('merluza m-5 pesca cisne',                                             'Merluza M-5'),
    ('rape g 3 a 4 kg',                                                     'Rape G 3-4 kg'),
    ('cg. (industrial) puntas y recorte krissia (b/5 k)',                   'Surimi Krissia puntas y recortes 5 kg'),
    ('cg.(industrial) puntas y recorte krissia (b/ 5 k)',                   'Surimi Krissia puntas y recortes 5 kg'),
    ('gestion y logistica',                                                 'Gestión y logística'),
    ('mano de obra oficial',                                                'Mano de obra oficial'),
    ('portes',                                                              'Portes'),
    ('rappel por marketing y escaparate',                                   'Rappel por marketing y escaparate'),
    ('servicio de guardia',                                                 'Servicio de guardia'),
    ('trabajos',                                                            'Trabajos')
  ),
  m as (
    select v.texto, p.id as pid
      from v left join public.productos_catalogo p on p.nombre_normalizado = public.normalizar_texto(v.producto)
  ),
  ins as (
    insert into public.productos_alias (texto_normalizado, producto_id, origen)
    select texto, pid, 'ia' from m where pid is not null
    on conflict (texto_normalizado) do nothing
    returning 1
  )
  select (select count(*) from m where pid is null), (select count(*) from ins) into n_sin, n_alias;
  if n_sin > 0 or n_alias <> 130 then
    raise exception 'productos_catalogo_categorias: alias sin producto %, alias creados % de 130', n_sin, n_alias;
  end if;

  with v(linea_id, producto) as (values
    (362,   'Contactor 220 V 40 A'),
    (363,   'Servicio de guardia'),
    (364,   'Mano de obra oficial'),
    (365,   'Tirador de puerta Liebherr'),
    (366,   'Mano de obra oficial'),
    (367,   'Ventilador 5 W 220 V multianclaje'),
    (368,   'Mano de obra oficial'),
    (369,   'Material de fontanería'),
    (370,   'Mano de obra oficial'),
    (371,   'Vino Gran Reserva 75 cl (Guillén)'),
    (372,   'Tope de borna para fichas de carril'),
    (373,   'Fichas de carril automáticos D UT 13'),
    (374,   'Punteras aisladas TE-2,5 gris'),
    (375,   'Diferencial 4P 63 A AEG 605770'),
    (376,   'Punteras aisladas TE-16 marfil'),
    (377,   'Interruptor diferencial 10 A 1P+N 30 mA'),
    (378,   'Interruptor diferencial 16 A 1P+N 30 mA'),
    (379,   'Terminales CUT T-16/8'),
    (380,   'Cable libre de halógenos 1x16'),
    (381,   'Cable libre de halógenos 1,5'),
    (382,   'Base de tapa ciega Efapel'),
    (383,   'Tapa ciega blanca Efapel 90677 TBR'),
    (384,   'Marco de 1 elemento Efapel 90810 TBR blanco'),
    (385,   'Trabajos'),
    (386,   'Jamón Joselito Gran Reserva'),
    (387,   'Jamón Joselito Gran Reserva'),
    (388,   'Rappel por marketing y escaparate'),
    (392,   'Helado de vainilla bourbon'),
    (393,   'Helado de frambuesa'),
    (394,   'Helado de limón del limonero'),
    (395,   'Helado de chocolate negro 70 %'),
    (396,   'Jamón 5J bellota 100 % ibérico'),
    (397,   'Paleta 5J bellota 100 % ibérica'),
    (398,   'Jamón Joselito Gran Reserva'),
    (399,   'Caja con asa para jamón'),
    (400,   'Caja regalo de jamón (Navidad)'),
    (401,   'Buey de mar gallego hembra 1-1,5 kg'),
    (402,   'Nécora gallega hembra M'),
    (403,   'Centolla hembra 1-1,5 kg'),
    (404,   'Lubina gallega de anzuelo 1-1,5 kg'),
    (405,   'Portes'),
    (406,   'Tanqueray 70 cl'),
    (407,   'Tanqueray 70 cl'),
    (408,   'Brugal Añejo 70 cl'),
    (409,   'Johnnie Walker Red 70 cl'),
    (410,   'Johnnie Walker Black 70 cl'),
    (411,   'Larios 12 Premium 70 cl'),
    (412,   'Larios Rosé 70 cl'),
    (413,   'Barceló Añejo 70 cl'),
    (414,   'Jack Daniel''s 70 cl'),
    (415,   'Jack Daniel''s 70 cl'),
    (416,   'Amaretto Disaronno 70 cl'),
    (417,   'Amaretto Disaronno 70 cl'),
    (418,   'Brugal 1888 70 cl'),
    (419,   'Ricard 1 L'),
    (420,   'Beefeater 70 cl'),
    (421,   'Gestión y logística'),
    (422,   'Johnnie Walker Red 70 cl'),
    (423,   'Barceló Añejo 70 cl'),
    (424,   'Johnnie Walker Black 70 cl'),
    (425,   'Navaja'),
    (426,   'Almeja fina'),
    (427,   'Berberecho'),
    (428,   'Portes'),
    (429,   'Cuervo Especial Reposado 70 cl'),
    (430,   'Absolut Vodka 70 cl'),
    (431,   'Cuervo Especial Reposado 70 cl'),
    (432,   'Gestión y logística'),
    (433,   'Limón fino'),
    (434,   'Calabacín'),
    (435,   'Tomate Daniela'),
    (436,   'Patata mini'),
    (437,   'Alcachofa'),
    (438,   'Tomate Raf'),
    (439,   'Plato llano Stolt 16,5 cm'),
    (440,   'Fuente oval Stolt 26,5x13 cm'),
    (441,   'Plato Quadro azul suave 14x14 cm'),
    (442,   'Merluza M-5'),
    (443,   'Flor de Pingus'),
    (444,   'Flor de Pingus Magnum'),
    (445,   'PSI'),
    (446,   'PSI Magnum'),
    (447,   'El Puntido'),
    (448,   'Almirez'),
    (449,   'Almirez Magnum'),
    (450,   'La Cueva del Contador'),
    (451,   'Quiñón de Valmira'),
    (452,   'Corullón Magnum'),
    (453,   'Moncerbal'),
    (454,   'Las Llamas'),
    (455,   'Gratallops'),
    (456,   'Dofí'),
    (457,   'Tardieu-Laurent Hermitage tinto'),
    (458,   'Alter Ego'),
    (459,   'Château Lafite Rothschild'),
    (460,   'Château Palmer'),
    (461,   'Château Cheval Blanc'),
    (462,   'Château Climens'),
    (463,   'Las Umbrías'),
    (464,   'El Tamboril Tinto'),
    (465,   'Tumba del Rey Moro'),
    (466,   'Rape G 3-4 kg'),
    (997,   'Picos sin gluten Obando 25 ud'),
    (998,   'Espinas de salmonete Maritimus'),
    (999,   'Nata Natop Debic 2 L'),
    (1000,  'Roux claro Knorr 1 kg'),
    (1001,  'Láminas de hojaldre invertido caramelizado'),
    (1002,  'Rústico pomodoro y oliva Laduc 3 kg'),
    (1003,  'Mix de flores secas Sosa 50 g'),
    (1004,  'Costilla confitada en su jugo Buenapinta'),
    (1005,  'Mayonesa Hellmann''s cubo 5 L'),
    (1006,  'Espinas de salmonete Maritimus'),
    (1007,  'Tarta de caramelo salado y queso manchego'),
    (1008,  'Perdiz deshuesada en escabeche Candida'),
    (1009,  'Nata Natop Debic 2 L'),
    (1010,  'Láminas de hojaldre invertido caramelizado'),
    (1011,  'Rosquilla natural caja 2 kg'),
    (1012,  'Mix de flores secas Sosa 50 g'),
    (1013,  'Gambón zarado XXL Gegarri'),
    (1014,  'Surimi Krissia puntas y recortes 5 kg'),
    (1015,  'Mayonesa Hellmann''s cubo 5 L'),
    (1016,  'Mermelada chutney de manzana Can Bech'),
    (1017,  'Crujiente de wasabi Didess'),
    (1018,  'Mostaza de cerveza Rooftop 150 g'),
    (1019,  'Crujiente de wasabi Didess'),
    (1020,  'Espinas de salmonete Maritimus'),
    (1021,  'Perdiz deshuesada en escabeche Candida'),
    (1022,  'Nata Natop Debic 2 L'),
    (1023,  'Maizena Express clara bote 1 kg'),
    (1024,  'Maizena Express oscura bote 1 kg'),
    (1025,  'Láminas de hojaldre invertido caramelizado'),
    (1026,  'Rústico pomodoro y oliva Laduc 3 kg'),
    (1027,  'Mermelada chutney de manzana Can Bech'),
    (1028,  'Panceta ibérica de bellota 3 kg'),
    (1029,  'Salsa pomodoro Knorr 875 g'),
    (1030,  'Mayonesa Hellmann''s cubo 5 L'),
    (1031,  'Mostaza de cerveza Rooftop 150 g'),
    (1032,  'Picos sin gluten Obando 25 ud'),
    (1033,  'Espinas de salmonete Maritimus'),
    (1034,  'Perdiz deshuesada en escabeche Candida'),
    (1035,  'Nata Natop Debic 2 L'),
    (1036,  'Maizena Express oscura bote 1 kg'),
    (1037,  'Láminas de hojaldre invertido caramelizado'),
    (1038,  'Surimi Krissia puntas y recortes 5 kg'),
    (1039,  'Mayonesa Hellmann''s cubo 5 L'),
    (1040,  'Rosquilla natural caja 2 kg'),
    (1041,  'Jamón de cebo de campo Lisardo Castro'),
    (1042,  'Picos sin gluten Obando 25 ud'),
    (1043,  'Espinas de salmonete Maritimus'),
    (1044,  'Nata Natop Debic 2 L'),
    (1045,  'Maizena Express oscura bote 1 kg'),
    (1046,  'Maizena Express clara bote 1 kg'),
    (1047,  'Láminas de hojaldre invertido caramelizado'),
    (1048,  'Rústico pomodoro y oliva Laduc 3 kg'),
    (1049,  'Mermelada chutney de manzana Can Bech'),
    (1050,  'Mayonesa Hellmann''s cubo 5 L'),
    (1324,  'Huevas de maruca'),
    (1325,  'Huevas de mújol'),
    (1326,  'Bonito limpio en lomos'),
    (1501,  'Helado de limón del limonero'),
    (1502,  'Helado de frambuesa'),
    (1503,  'Helado de vainilla bourbon'),
    (1504,  'Helado de yema quemada'),
    (1505,  'Helado de turrón Jijona'),
    (1506,  'Helado de yogur')
  ),
  m as (
    select v.linea_id, p.id as pid
      from v left join public.productos_catalogo p on p.nombre_normalizado = public.normalizar_texto(v.producto)
  ),
  upd as (
    update public.productos_factura pf
       set producto_id = m.pid
      from m
     where pf.id = m.linea_id and pf.producto_id is null and m.pid is not null
    returning 1
  )
  select (select count(*) from m where pid is null), (select count(*) from upd) into n_sin, n_lineas;
  if n_sin > 0 then
    raise exception 'productos_catalogo_categorias: % líneas de la carga apuntan a un producto que no existe', n_sin;
  end if;
  raise notice 'productos_catalogo_categorias: carga inicial · % productos · % alias · % líneas por id', n_prod, n_alias, n_lineas;
end;
$carga$;

-- Lo que haya llegado después con un texto ya conocido (sin IA).
update public.productos_factura pf
   set producto_id = a.producto_id
  from public.productos_alias a
 where pf.producto_id is null and a.texto_normalizado = pf.nombre_normalizado;

-- ─── 12. Comprobación final ─────────────────────────────────────────────────
do $$
begin
  if (select count(*) from public.categorias_producto where clave is not null) < 20 then
    raise exception 'productos_catalogo_categorias: la semilla de categorías no está completa (% de 20)',
      (select count(*) from public.categorias_producto where clave is not null);
  end if;
  if exists (select 1 from public.productos_factura pf
               join public.productos_alias a on a.texto_normalizado = pf.nombre_normalizado
              where pf.producto_id is null) then
    raise exception 'productos_catalogo_categorias: quedan líneas sin producto con un alias conocido';
  end if;
  if not exists (select 1 from pg_trigger where tgrelid = 'public.productos_factura'::regclass
                    and tgname = 'trg_productos_factura_asignar_producto' and not tgisinternal) then
    raise exception 'productos_catalogo_categorias: falta el trigger de asignación por alias';
  end if;
  if has_function_privilege('authenticated', 'public.productos_aplicar_clasificacion_ia(jsonb)', 'execute') then
    raise exception 'productos_catalogo_categorias: authenticated no debería poder ejecutar productos_aplicar_clasificacion_ia';
  end if;
  if has_table_privilege('anon', 'public.productos_catalogo', 'select') then
    raise exception 'productos_catalogo_categorias: anon no debería leer productos_catalogo';
  end if;
  if (select count(*) from cron.job where jobname = 'clasificar-productos') <> 1 then
    raise exception 'productos_catalogo_categorias: el cron clasificar-productos no quedó instalado una vez';
  end if;
end;
$$;

notify pgrst, 'reload schema';

commit;

-- Verificación (solo lectura): «productos_catalogo_categorias: aplicada | 20 | 116 | 165/165».
select format('productos_catalogo_categorias: aplicada | %s | %s | %s/%s',
              (select count(*) from public.categorias_producto),
              (select count(*) from public.productos_catalogo),
              (select count(*) from public.productos_factura where producto_id is not null),
              (select count(*) from public.productos_factura)) as resultado;
