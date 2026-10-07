set client_encoding = 'UTF8';
-- ===========================================================================
-- ROLLBACK de supabase/migrations/20261007180000_proveedores_unificados.sql
-- ===========================================================================
-- No es una migración (ver supabase/rollbacks/README.md). Se ejecuta A MANO,
-- POR TERMINAL:
--   npx supabase db query --linked -f supabase/rollbacks/20261007180000_proveedores_unificados_ROLLBACK.sql
--
-- ANTES: publicar el panel sin el botón «Proveedores» (si no, el diálogo
-- avisa de que falta la migración; el filtro por proveedor vuelve solo a
-- agrupar por el texto del documento). procesar-factura, ocr-trabajo y el
-- chatbot NO hay que tocarlos: nunca mandan proveedor_id ni
-- proveedor_normalizado.
--
-- Qué hace (en este orden):
--   1. COPIA los proveedores con sus alias, CIF extra y documentos a
--      public.proveedores_unificados_respaldo (se queda), para poder rehacer
--      las fusiones y renombres si se vuelve a aplicar.
--   2. Quita los triggers de asignación y de alias.
--   3. Devuelve normalizar_proveedor EXACTA (IMMUTABLE, md5 comprobado sin
--      retornos de carro) y recalcula facturas.proveedor_normalizado con ella.
--      OJO: la columna NO vuelve a ser GENERADA (habría que borrarla y con ella
--      las 5 vistas vista_* que la leen); la mantiene un trigger que hace lo
--      mismo que la expresión generada: normalizar_proveedor(proveedor).
--   4. Quita facturas.proveedor_id (FK e índice), las RPC proveedores_*,
--      proveedor_resolver y proveedores_alias.
--   5. Borra de proveedores las filas que creó la migración o el trigger
--      (origen no nulo), quita las columnas y CHECK nuevos y devuelve la fila
--      «Proveedor Ejemplo» (id 1) si no está.
--   6. Borra normalizar_proveedor_base, normalizar_cif, proveedor_cif_valido
--      y proveedor_es_cliente.
--   Imprime «proveedores_unificados: revertida | <proveedores respaldados>».
--   Se puede ejecutar dos veces. lock_timeout = 5s: un 55P03 no ha deshecho nada.
-- ===========================================================================

begin;
set local lock_timeout = '5s';

-- ─── 1. Copia ───────────────────────────────────────────────────────────────
create table if not exists public.proveedores_unificados_respaldo (
  proveedor_id     bigint not null,
  nombre           text not null,
  nombre_comercial text,
  cif              text,
  origen           text,
  alias            text[],
  cifs_extra       text[],
  facturas         bigint[],
  copiado_at       timestamptz not null default now()
);
comment on table public.proveedores_unificados_respaldo is
  'Proveedores unificados (nombre, CIF, alias, documentos) guardados al revertir 20261007180000, para poder rehacer fusiones y renombres.';
alter table public.proveedores_unificados_respaldo enable row level security;
revoke all on public.proveedores_unificados_respaldo from public, anon, authenticated;

do $$
begin
  if to_regclass('public.proveedores_alias') is not null
     and exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'proveedores' and column_name = 'origen') then
    execute $q$
      insert into public.proveedores_unificados_respaldo (proveedor_id, nombre, nombre_comercial, cif, origen, alias, cifs_extra, facturas)
      select p.id, p.nombre, p.nombre_comercial, p.cif, p.origen,
             (select array_agg(a.alias_normalizado order by a.alias_normalizado) from public.proveedores_alias a
               where a.proveedor_id = p.id and a.alias_normalizado is not null),
             (select array_agg(a.cif_normalizado order by a.cif_normalizado) from public.proveedores_alias a
               where a.proveedor_id = p.id and a.cif_normalizado is not null),
             (select array_agg(f.id order by f.id) from public.facturas f where f.proveedor_id = p.id)
        from public.proveedores p
       where p.origen is not null
    $q$;
  end if;
end;
$$;

-- ─── 2. Triggers ────────────────────────────────────────────────────────────
drop trigger if exists trg_facturas_asignar_proveedor on public.facturas;
drop trigger if exists trg_proveedores_mantener_alias on public.proveedores;

-- ─── 3. normalizar_proveedor exacta y proveedor_normalizado ─────────────────
CREATE OR REPLACE FUNCTION public.normalizar_proveedor(p_proveedor text)
 RETURNS text
 LANGUAGE plpgsql
 IMMUTABLE STRICT
 SET search_path TO 'public'
AS $function$
DECLARE
  v_texto TEXT;
BEGIN
  -- Normalizar: trim + lowercase + quitar acentos
  v_texto := trim(lower(unaccent(p_proveedor)));
  
  -- PASO 1: Eliminar alias/apodos entre paréntesis "(nombre comercial)"
  v_texto := regexp_replace(v_texto, '\s*\([^)]*\)', '', 'g');
  
  -- PASO 2: Eliminar sufijos legales al FINAL del string
  -- Ordenados de más largo a más corto para evitar match parcial
  -- Usamos $ para anclar al final, con posible puntuación antes
  v_texto := regexp_replace(v_texto,
    '[,\s]+(sociedad\s+limitada\s+unipersonal|sociedad\s+anonima\s+unipersonal|sociedad\s+cooperativa|sociedad\s+limitada|sociedad\s+anonima|s\.l\.u\.|s\.a\.u\.|s\.l\.|s\.a\.|s\.c\.p\.|s\.c\.l\.|s\.c\.|s\.coop\.?|slu|sau|sl|sa|cb|sc)\s*$',
    '', 'gi');
  
  -- PASO 3: Limpiar comas, puntos y espacios sobrantes al final
  v_texto := regexp_replace(v_texto, '[,.\s]+$', '');
  
  -- PASO 4: Colapsar espacios múltiples
  v_texto := regexp_replace(trim(v_texto), '\s+', ' ', 'g');
  
  RETURN v_texto;
END;
$function$;
comment on function public.normalizar_proveedor(text) is null;

-- Hace lo que hacía la expresión generada (la columna ya no puede volver a serlo).
create or replace function public.facturas_proveedor_normalizado_compat()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.proveedor_normalizado := public.normalizar_proveedor(new.proveedor);
  return new;
end;
$$;
revoke all on function public.facturas_proveedor_normalizado_compat() from public, anon, authenticated;

do $$
begin
  -- Solo si la columna ya no es generada (si lo es, la migración no se aplicó).
  if (select attgenerated from pg_attribute where attrelid = 'public.facturas'::regclass
         and attname = 'proveedor_normalizado' and not attisdropped) = '' then
    drop trigger if exists trg_facturas_proveedor_normalizado_compat on public.facturas;
    create trigger trg_facturas_proveedor_normalizado_compat
      before insert or update on public.facturas
      for each row execute function public.facturas_proveedor_normalizado_compat();
    alter table public.facturas disable trigger trigger_facturas_updated;
    update public.facturas set proveedor_normalizado = public.normalizar_proveedor(proveedor)
     where proveedor_normalizado is distinct from public.normalizar_proveedor(proveedor);
    alter table public.facturas enable trigger trigger_facturas_updated;
    comment on column public.facturas.proveedor_normalizado is
      'normalizar_proveedor(proveedor). Era columna generada; desde el rollback de 20261007180000 la mantiene trg_facturas_proveedor_normalizado_compat.';
  end if;
end;
$$;
-- ─── 4. facturas.proveedor_id, RPC y alias ──────────────────────────────────
alter table public.facturas drop constraint if exists facturas_proveedor_id_fkey;
drop index if exists public.idx_facturas_proveedor_id;
alter table public.facturas drop column if exists proveedor_id;

drop function if exists public.proveedores_listado();
drop function if exists public.proveedores_editar(bigint, text, text, text);
drop function if exists public.proveedores_fusionar(bigint[], bigint);
drop function if exists public.proveedores_puede_editar();
drop function if exists public.facturas_asignar_proveedor();
drop function if exists public.proveedores_mantener_alias();
drop function if exists public.proveedor_resolver(text, text, boolean);
drop table if exists public.proveedores_alias;

-- ─── 5. proveedores como estaba ─────────────────────────────────────────────
do $$
begin
  if exists (select 1 from information_schema.columns
              where table_schema = 'public' and table_name = 'proveedores' and column_name = 'origen') then
    execute 'delete from public.proveedores where origen is not null';
  end if;
end;
$$;
alter table public.proveedores drop constraint if exists proveedores_no_es_cliente;
alter table public.proveedores drop constraint if exists proveedores_nombre_util;
alter table public.proveedores drop constraint if exists proveedores_origen_check;
drop index if exists public.uq_proveedores_cif_normalizado;
alter table public.proveedores drop column if exists nombre_normalizado;
alter table public.proveedores drop column if exists cif_normalizado;
alter table public.proveedores drop column if exists origen;
alter table public.proveedores drop column if exists nombre_comercial;
insert into public.proveedores (id, nombre, cif, direccion, telefono, email, categoria, notas, activo, created_at, updated_at)
select 1, 'Proveedor Ejemplo', null, null, null, null, 'Alimentación', null, true,
       timestamp '2026-01-31 16:28:55.125132', timestamp '2026-01-31 16:28:55.125132'
 where not exists (select 1 from public.proveedores where id = 1 or nombre = 'Proveedor Ejemplo');
update public.proveedores set activo = true where id = 1 and nombre = 'Proveedor Ejemplo' and activo is distinct from true;

-- ─── 6. Funciones nuevas ────────────────────────────────────────────────────
drop function if exists public.normalizar_proveedor_base(text);
drop function if exists public.normalizar_cif(text);
drop function if exists public.proveedor_cif_valido(text);
drop function if exists public.proveedor_es_cliente(text, text);

-- ─── Comprobación ───────────────────────────────────────────────────────────
do $$
declare
  v_md5 text;
begin
  select md5(replace(pg_get_functiondef('public.normalizar_proveedor(text)'::regprocedure), chr(13), '')) into v_md5;
  if v_md5 <> '759f97052c4ac7abae6f5796046a42fc' then
    raise exception 'ROLLBACK ABORTADO: normalizar_proveedor no ha quedado como la original (md5 %). No se ha cambiado nada.', v_md5;
  end if;
  if exists (select 1 from public.facturas where proveedor_normalizado is distinct from public.normalizar_proveedor(proveedor)) then
    raise exception 'ROLLBACK ABORTADO: proveedor_normalizado no cuadra con normalizar_proveedor. No se ha cambiado nada.';
  end if;
  if to_regclass('public.proveedores_alias') is not null
     or exists (select 1 from information_schema.columns where table_schema = 'public'
                   and ((table_name = 'facturas' and column_name = 'proveedor_id')
                     or (table_name = 'proveedores' and column_name in ('origen', 'nombre_comercial', 'cif_normalizado', 'nombre_normalizado')))) then
    raise exception 'ROLLBACK ABORTADO: quedan tablas o columnas de 20261007180000. No se ha cambiado nada.';
  end if;
end;
$$;

notify pgrst, 'reload schema';

commit;

select format('proveedores_unificados: revertida | %s', (select count(*) from public.proveedores_unificados_respaldo)) as resultado;
