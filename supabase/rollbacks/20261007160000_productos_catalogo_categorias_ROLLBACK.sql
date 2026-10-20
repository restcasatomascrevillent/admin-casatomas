set client_encoding = 'UTF8';
-- ===========================================================================
-- ROLLBACK de supabase/migrations/20261007160000_productos_catalogo_categorias.sql
-- ===========================================================================
-- No es una migración (ver supabase/rollbacks/README.md). Se ejecuta A MANO,
-- POR TERMINAL:
--   npx supabase db query --linked -f supabase/rollbacks/20261007160000_productos_catalogo_categorias_ROLLBACK.sql
--
-- ANTES:
--   · Publicar el panel SIN la pestaña Facturas › Productos (la pestaña llama a
--     productos_resumen/productos_gasto_por_categoria: sin ellas enseña un
--     error, no rompe el resto de Facturas; el listado de facturas cae solo a
--     la consulta sin categorías).
--   · Opcional: `npx supabase functions delete clasificar-productos` (sin el
--     cron nadie la llama; si se queda, el botón del panel ya no existe).
--   procesar-factura y ocr-trabajo NO hay que tocarlos: nunca mandan
--   producto_id (la asignación la hacía el trigger que se borra aquí).
--
-- Qué hace (en este orden):
--   1. COPIA la clasificación a dos tablas que se quedan
--      (public.productos_clasificacion_respaldo: línea → producto y categoría
--      por NOMBRE; public.productos_alias_respaldo: texto → producto), para
--      poder rehacerla si se vuelve a aplicar la migración.
--   2. Quita el cron «clasificar-productos» y la fila de ia_funciones.
--   3. Borra las RPC, el trigger de asignación y sus funciones.
--   4. Quita productos_factura.producto_id (FK e índices).
--   5. Borra productos_alias, productos_catalogo (SOLO la nueva: la reconoce por
--      nombre_normalizado) y categorias_producto. Sin CASCADE, a propósito.
--   6. Devuelve la tabla ANTIGUA productos_catalogo_antigua a su nombre
--      (productos_catalogo), con su clave, su FK, su secuencia y su comentario.
--   Imprime «productos_catalogo_categorias: revertida | <líneas respaldadas>».
--   Se puede ejecutar dos veces. lock_timeout = 5s: un 55P03 no ha deshecho nada.
-- ===========================================================================

begin;
set local lock_timeout = '5s';

-- ─── 1. Copia de la clasificación ───────────────────────────────────────────
create table if not exists public.productos_clasificacion_respaldo (
  linea_id    bigint primary key,
  factura_id  bigint not null,
  texto_linea text,
  producto    text not null,
  categoria   text,
  origen      text,
  copiado_at  timestamptz not null default now()
);
create table if not exists public.productos_alias_respaldo (
  texto_normalizado text primary key,
  producto          text not null,
  categoria         text,
  origen            text,
  copiado_at        timestamptz not null default now()
);
comment on table public.productos_clasificacion_respaldo is
  'Clasificación de líneas (producto y categoría por nombre) guardada al revertir 20261007160000, para poder rehacerla.';
comment on table public.productos_alias_respaldo is
  'Alias texto normalizado → producto guardados al revertir 20261007160000, para poder rehacerlos.';
alter table public.productos_clasificacion_respaldo enable row level security;
alter table public.productos_alias_respaldo enable row level security;
revoke all on public.productos_clasificacion_respaldo, public.productos_alias_respaldo from public, anon, authenticated;

do $$
begin
  if exists (select 1 from information_schema.columns
              where table_schema = 'public' and table_name = 'productos_factura' and column_name = 'producto_id')
     and exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'productos_catalogo' and column_name = 'nombre_normalizado') then
    execute $q$
      insert into public.productos_clasificacion_respaldo (linea_id, factura_id, texto_linea, producto, categoria, origen)
      select pf.id, pf.factura_id, pf.nombre, p.nombre,
             case when c.id is null then null when pc.id is null then c.nombre else pc.nombre || ' › ' || c.nombre end,
             p.origen
        from public.productos_factura pf
        join public.productos_catalogo p on p.id = pf.producto_id
        left join public.categorias_producto c on c.id = p.categoria_id
        left join public.categorias_producto pc on pc.id = c.padre_id
      on conflict (linea_id) do update
        set producto = excluded.producto, categoria = excluded.categoria, origen = excluded.origen,
            texto_linea = excluded.texto_linea, copiado_at = now()
    $q$;
    execute $q$
      insert into public.productos_alias_respaldo (texto_normalizado, producto, categoria, origen)
      select a.texto_normalizado, p.nombre,
             case when c.id is null then null when pc.id is null then c.nombre else pc.nombre || ' › ' || c.nombre end,
             a.origen
        from public.productos_alias a
        join public.productos_catalogo p on p.id = a.producto_id
        left join public.categorias_producto c on c.id = p.categoria_id
        left join public.categorias_producto pc on pc.id = c.padre_id
      on conflict (texto_normalizado) do update
        set producto = excluded.producto, categoria = excluded.categoria, origen = excluded.origen, copiado_at = now()
    $q$;
  end if;
end;
$$;

-- ─── 2. Cron y registro de IA ───────────────────────────────────────────────
select cron.unschedule('clasificar-productos')
 where exists (select 1 from cron.job where jobname = 'clasificar-productos');
do $$
begin
  if to_regclass('public.ia_funciones') is not null then
    delete from public.ia_funciones where funcion = 'clasificar-productos';
  end if;
end;
$$;

-- ─── 3. Funciones y trigger ─────────────────────────────────────────────────
drop function if exists public.productos_despachar_clasificacion();
drop function if exists public.productos_gasto_por_categoria(date, date, text);
drop function if exists public.productos_resumen(date, date, text);
drop function if exists public.productos_aplicar_clasificacion_ia(jsonb);
drop function if exists public.productos_borrar(bigint);
drop function if exists public.productos_asignar_lineas(bigint[], bigint, text, bigint);
drop function if exists public.productos_fusionar(bigint[], bigint);
drop function if exists public.productos_recategorizar(bigint[], bigint);
drop function if exists public.productos_renombrar(bigint, text);
drop function if exists public.productos_puede_editar();
drop trigger if exists trg_productos_factura_asignar_producto on public.productos_factura;
drop function if exists public.productos_factura_asignar_producto();

-- ─── 4. Columna de las líneas ───────────────────────────────────────────────
alter table public.productos_factura drop constraint if exists productos_factura_producto_id_fkey;
drop index if exists public.idx_productos_factura_producto;
drop index if exists public.idx_productos_factura_sin_producto;
alter table public.productos_factura drop column if exists producto_id;

-- ─── 5. Tablas nuevas (sin CASCADE: si algo depende de ellas, que falle) ────
drop table if exists public.productos_alias;
do $$
begin
  if exists (select 1 from information_schema.columns
              where table_schema = 'public' and table_name = 'productos_catalogo' and column_name = 'nombre_normalizado') then
    drop table public.productos_catalogo;
  end if;
end;
$$;
drop function if exists public.productos_tocar_updated_at();
drop table if exists public.categorias_producto;
drop function if exists public.categorias_producto_validar();

-- ─── 6. La tabla antigua vuelve a su nombre ─────────────────────────────────
do $$
begin
  if to_regclass('public.productos_catalogo_antigua') is not null and to_regclass('public.productos_catalogo') is null then
    alter table public.productos_catalogo_antigua rename to productos_catalogo;
    if exists (select 1 from pg_constraint where conrelid = 'public.productos_catalogo'::regclass
                  and conname = 'productos_catalogo_antigua_pkey') then
      alter table public.productos_catalogo rename constraint productos_catalogo_antigua_pkey to productos_catalogo_pkey;
    end if;
    if exists (select 1 from pg_constraint where conrelid = 'public.productos_catalogo'::regclass
                  and conname = 'productos_catalogo_antigua_proveedor_habitual_id_fkey') then
      alter table public.productos_catalogo
        rename constraint productos_catalogo_antigua_proveedor_habitual_id_fkey to productos_catalogo_proveedor_habitual_id_fkey;
    end if;
    if to_regclass('public.productos_catalogo_antigua_id_seq') is not null then
      alter sequence public.productos_catalogo_antigua_id_seq rename to productos_catalogo_id_seq;
    end if;
    comment on table public.productos_catalogo is 'Catálogo de productos con precios actuales';
  end if;
end;
$$;

-- ─── 7. Comprobación ────────────────────────────────────────────────────────
do $$
begin
  if exists (select 1 from information_schema.columns
              where table_schema = 'public' and table_name = 'productos_factura' and column_name = 'producto_id') then
    raise exception 'ROLLBACK ABORTADO: productos_factura.producto_id sigue ahí. Se deshace todo.';
  end if;
  if to_regclass('public.categorias_producto') is not null or to_regclass('public.productos_alias') is not null then
    raise exception 'ROLLBACK ABORTADO: siguen categorias_producto o productos_alias. Se deshace todo.';
  end if;
  if exists (select 1 from cron.job where jobname = 'clasificar-productos') then
    raise exception 'ROLLBACK ABORTADO: sigue el cron clasificar-productos. Se deshace todo.';
  end if;
end;
$$;

notify pgrst, 'reload schema';

commit;

select format('productos_catalogo_categorias: revertida | %s líneas respaldadas',
              (select count(*) from public.productos_clasificacion_respaldo)) as resultado;
