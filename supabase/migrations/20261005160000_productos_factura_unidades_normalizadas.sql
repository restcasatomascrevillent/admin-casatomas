set client_encoding = 'UTF8';
-- (Primera línea a propósito: comentarios con tilde; psql en una consola de
-- Windows puede arrancar en WIN1252.)
-- ===========================================================================
-- ##                                                                       ##
-- ##          NO APLICADA: la aplica el dueño a mano (ver pasos)           ##
-- ##                                                                       ##
-- ##   Facturas · unidad de productos_factura unificada a 'ud'|'kg'|'l'    ##
-- ##   (el mismo mapa que el OCR nuevo): líneas antiguas + trigger y       ##
-- ##   DEFAULT para que no reaparezcan variantes.                          ##
-- ##                                                                       ##
-- ===========================================================================
--
-- POR QUÉ (dueño, 05/10/2026)
--   El OCR nuevo (supabase/functions/procesar-factura/magnitudes.ts,
--   normalizarUnidad) guarda la unidad como 'ud' | 'kg' | 'l'. Las líneas
--   antiguas podían traer «uds», «unidades», «kgs», «kilos», «lt», nulls…
--   y el chatbot agrupa el ranking por cantidad POR unidad (ranking_agente,
--   consulta_flexible_agente), así que «uds» y «ud» salían como dos filas.
--
-- ESTADO VERIFICADO EN PRODUCCIÓN (05/10/2026, antes de escribir esto)
--   select unidad, count(*) from productos_factura group by 1:
--     ud 120 (13 facturas) · kg 35 (7) · ca 2 (facturas 42 y 43, Osborne,
--     jamón/paleta «5-10 kg») · m 2 (factura 37, metros de cable).
--   159 líneas; ninguna 'uds'/'unidades'/null: lo antiguo ya estaba en el
--   mapa (el OCR nuevo, la migración de Luga 54 y la edición del panel lo
--   dejaron así). HOY EL UPDATE NO CAMBIA NINGUNA FILA. Lo que SÍ cambia es
--   que las variantes ya no pueden volver a entrar: la columna tenía DEFAULT
--   'unidades', ocr_sustituir_factura escribe 'unidades' si falta la unidad
--   (coalesce(l->>'unidad','unidades')) y el panel (FilaProducto.tsx) deja
--   escribir texto libre. Se cierran los tres a la vez con un DEFAULT 'ud' y
--   un trigger, sin editar esas funciones (ver QUÉ CAMBIA 5 y 6).
--   'ca' y 'm' NO están en el mapa (caja/ca y metros no equivalen a 'ud'): se
--   dejan tal cual, igual que normalizarUnidad() devuelve las desconocidas.
--
-- EL MAPA (copia EXACTA de magnitudes.ts · SINONIMOS + normalizarUnidad)
--   Se quita lo que sobra (espacios de los bordes, minúsculas), se comparan
--   sin tildes, sin puntos y sin espacios, y:
--     ^(u|un|ud|uds|und|unds|uni|unid|unids|unidad|unidades)$   → 'ud'
--     ^(kg|kgs|kgr|kgrs|kilo|kilos|kilogramo|kilogramos)$         → 'kg'
--     ^(l|lt|lts|ltr|ltrs|litro|litros)$                          → 'l'
--     vacío o NULL                                                → 'ud'
--     cualquier otra (caja, ca, m, docena…)  → se deja la ORIGINAL en
--                                              minúsculas y sin espacios de
--                                              los bordes (no se inventa).
--   Va en public.normalizar_unidad_factura(text) (IMMUTABLE, sin acceso a
--   tablas): la usan el UPDATE y el test, y sirve para un futuro trigger.
--
-- QUÉ CAMBIA
--   1. Crea public.normalizar_unidad_factura(text).
--   2. Crea public.productos_factura_unidades_respaldo (RLS sin políticas,
--      sin permisos para anon/authenticated) y copia ahí (id de línea, unidad
--      antes, unidad después) de cada fila que va a cambiar. Se usa una tabla
--      propia y no facturas_sustituciones porque esa guarda la factura entera
--      (cabecera + todas las líneas + historial en jsonb, un registro por
--      factura): para tocar UNA columna en muchas facturas pesa de más y el
--      rollback tendría que desmontar jsonb; aquí es (id, unidad) y un UPDATE.
--   3. UPDATE de unidad (solo esa columna) donde la normalizada difiere.
--   4. Comprobaciones: no queda ninguna variante; número de filas, suma de
--      cantidad, precio_unitario, total y bultos IGUALES antes y después;
--      filas copiadas = filas cambiadas. Si algo falla, se deshace todo.
--   5. DEFAULT de productos_factura.unidad: 'unidades' → 'ud'.
--   6. Trigger trg_productos_factura_normalizar_unidad, BEFORE INSERT OR
--      UPDATE OF unidad, FOR EACH ROW: new.unidad := normalizar_unidad_factura(
--      new.unidad). Cubre el OCR, ocr_sustituir_factura (su coalesce
--      'unidades' llega como 'unidades' y sale 'ud'), la edición del panel y
--      cualquier otro camino. Un NULL o vacío explícito pasa a 'ud' (el mapa).
--      No interfiere con trigger_historial_precios (AFTER INSERT: ve la fila
--      ya normalizada y solo lee nombre, precio y factura), ni con los bultos
--      (solo toca `unidad`), ni con ocr_sustituir_factura (el test simula una
--      sustitución con unidad NULL, ausente, 'unidades' y 'Kilos'). Un UPDATE
--      de otras columnas no lo dispara. La función del trigger es SECURITY
--      DEFINER con search_path vacío y sin EXECUTE para nadie: así funciona
--      con cualquier rol que escriba (authenticated del panel, service_role de
--      las Edge Functions) sin darle acceso a la función normalizadora.
--   NO toca cantidad, precio_unitario, total, bultos ni nombres. El UPDATE no
--   dispara nada ajeno: el único trigger previo de productos_factura es
--   trigger_historial_precios, AFTER INSERT (no salta en un UPDATE); la tabla
--   no tiene updated_at ni trigger de embeddings. NO detecta kilos en otras
--   facturas (la conversión a kg de Luga 54 ya está hecha en 20261005151000).
--
-- PASOS (desde adminpanelct/)
--   1. npx supabase db query --linked -f supabase/migrations/20261005160000_productos_factura_unidades_normalizadas.sql
--      Tiene que imprimir «productos_factura_unidades_normalizadas: aplicada | 0 | 4»
--      (0 filas cambiadas hoy; 4 valores distintos: ud, kg, ca, m).
--      Orden: panel y migración son independientes (el panel normaliza por su
--      cuenta al guardar y, con el trigger, también lo haría la base).
--   2. npx supabase db query --linked -f supabase/tests/productos_factura_unidades_normalizadas_test.sql
--      (BEGIN … ROLLBACK).
--   Deshacer: supabase/rollbacks/20261005160000_productos_factura_unidades_normalizadas_ROLLBACK.sql
--   Idempotente: se puede ejecutar otra vez cuando reaparezcan variantes;
--   si no hay nada que cambiar no escribe nada.
-- ===========================================================================

begin;
set local lock_timeout = '5s';

-- ─── 1. La función: el mapa de magnitudes.ts ────────────────────────────────
create or replace function public.normalizar_unidad_factura(u text)
returns text
language sql
immutable
parallel safe
set search_path = ''
as $$
  select case
           when t.s = '' then 'ud'
           when t.s ~ '^(u|un|ud|uds|und|unds|uni|unid|unids|unidad|unidades)$' then 'ud'
           when t.s ~ '^(kg|kgs|kgr|kgrs|kilo|kilos|kilogramo|kilogramos)$' then 'kg'
           when t.s ~ '^(l|lt|lts|ltr|ltrs|litro|litros)$' then 'l'
           else t.o
         end
    from (
      select a.o,
             regexp_replace(
               translate(a.o, 'áàäâãéèëêíìïîóòöôõúùüûñçÁÀÄÂÃÉÈËÊÍÌÏÎÓÒÖÔÕÚÙÜÛÑÇ',
                              'aaaaaeeeeiiiiooooouuuuncAAAAAEEEEIIIIOOOOOUUUUNC'),
               '[.[:space:]]', '', 'g') as s
        from (select lower(regexp_replace(translate(coalesce(u, ''), chr(160), ' '),
                                          '^[[:space:]]+|[[:space:]]+$', '', 'g')) as o) a
    ) t
$$;
comment on function public.normalizar_unidad_factura(text) is
  'Unidad de una línea de factura: uds/unidades/ud/u/un → ud; kg/kgs/kilos → kg; l/lt/litros → l; vacío → ud; otra se deja en minúsculas. Mismo mapa que supabase/functions/procesar-factura/magnitudes.ts (normalizarUnidad).';
revoke all on function public.normalizar_unidad_factura(text) from public, anon;
grant execute on function public.normalizar_unidad_factura(text) to authenticated, service_role;

-- ─── 2. Respaldo (id de línea, unidad antes y después) ──────────────────────
create table if not exists public.productos_factura_unidades_respaldo (
  respaldo_id    bigint generated always as identity primary key,
  producto_id    bigint not null,
  factura_id     bigint not null,
  unidad_antes   text,
  unidad_despues text not null,
  migracion      text not null default '20261005160000',
  copiado_at     timestamptz not null default now(),
  revertida_at   timestamptz
);
comment on table public.productos_factura_unidades_respaldo is
  'productos_factura.unidad antes/después de 20261005160000 (unidades normalizadas); el rollback lo usa para restaurar. Sin FK a propósito: sobrevive a un borrado de la factura.';
create index if not exists idx_pf_unidades_respaldo_producto
  on public.productos_factura_unidades_respaldo (producto_id);
alter table public.productos_factura_unidades_respaldo enable row level security;
revoke all on public.productos_factura_unidades_respaldo from anon, authenticated;

-- ─── 3. Fotografía de las sumas (para comprobar que solo cambia la unidad) ──
create temp table _pf_unidades_antes on commit drop as
select count(*)::bigint                        as filas,
       coalesce(sum(cantidad), 0)              as s_cantidad,
       coalesce(sum(precio_unitario), 0)       as s_precio,
       coalesce(sum(total), 0)                 as s_total,
       coalesce(sum(bultos), 0)                as s_bultos,
       count(*) filter (where unidad is distinct from public.normalizar_unidad_factura(unidad))::bigint as a_cambiar
  from public.productos_factura;

-- ─── 4. Copia previa y UPDATE (solo la columna unidad) ──────────────────────
insert into public.productos_factura_unidades_respaldo (producto_id, factura_id, unidad_antes, unidad_despues)
select p.id, p.factura_id, p.unidad, public.normalizar_unidad_factura(p.unidad)
  from public.productos_factura p
 where p.unidad is distinct from public.normalizar_unidad_factura(p.unidad);

update public.productos_factura p
   set unidad = public.normalizar_unidad_factura(p.unidad)
 where p.unidad is distinct from public.normalizar_unidad_factura(p.unidad);

-- ─── 5. DEFAULT 'ud' y trigger que normaliza en cada escritura ──────────────
alter table public.productos_factura alter column unidad set default 'ud';

create or replace function public.trg_productos_factura_normalizar_unidad()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.unidad := public.normalizar_unidad_factura(new.unidad);
  return new;
end;
$$;
comment on function public.trg_productos_factura_normalizar_unidad() is
  'BEFORE INSERT OR UPDATE OF unidad en productos_factura: deja la unidad como ud/kg/l (mapa de magnitudes.ts). Migración 20261005160000.';
revoke all on function public.trg_productos_factura_normalizar_unidad() from public, anon, authenticated;

drop trigger if exists trg_productos_factura_normalizar_unidad on public.productos_factura;
create trigger trg_productos_factura_normalizar_unidad
  before insert or update of unidad on public.productos_factura
  for each row execute function public.trg_productos_factura_normalizar_unidad();

-- ─── 6. Comprobación final (si falla, se deshace todo) ──────────────────────
do $$
declare
  a record;
  d record;
  n_copiadas bigint;
begin
  select * into a from _pf_unidades_antes;
  select count(*)::bigint                  as filas,
         coalesce(sum(cantidad), 0)        as s_cantidad,
         coalesce(sum(precio_unitario), 0) as s_precio,
         coalesce(sum(total), 0)           as s_total,
         coalesce(sum(bultos), 0)          as s_bultos
    into d
    from public.productos_factura;

  if exists (select 1 from public.productos_factura
              where unidad is distinct from public.normalizar_unidad_factura(unidad)) then
    raise exception 'productos_factura_unidades_normalizadas: siguen quedando variantes. Se deshace todo.';
  end if;
  if d.filas <> a.filas or d.s_cantidad <> a.s_cantidad or d.s_precio <> a.s_precio
     or d.s_total <> a.s_total or d.s_bultos <> a.s_bultos then
    raise exception 'productos_factura_unidades_normalizadas: han cambiado filas o sumas de cantidad/precio/total/bultos (% → % filas). Se deshace todo.',
      a.filas, d.filas;
  end if;
  select count(*) into n_copiadas
    from public.productos_factura_unidades_respaldo r
   where r.migracion = '20261005160000' and r.revertida_at is null
     and r.copiado_at = transaction_timestamp();
  if n_copiadas <> a.a_cambiar then
    raise exception 'productos_factura_unidades_normalizadas: % filas copiadas al respaldo y % a cambiar. Se deshace todo.',
      n_copiadas, a.a_cambiar;
  end if;
  if not exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'productos_factura' and column_name = 'unidad'
                    and column_default like '''ud''%') then
    raise exception 'productos_factura_unidades_normalizadas: el DEFAULT de unidad no es ''ud''. Se deshace todo.';
  end if;
  if not exists (select 1 from pg_trigger
                  where tgrelid = 'public.productos_factura'::regclass
                    and tgname = 'trg_productos_factura_normalizar_unidad' and not tgisinternal) then
    raise exception 'productos_factura_unidades_normalizadas: falta el trigger de normalización. Se deshace todo.';
  end if;
  raise notice 'productos_factura_unidades_normalizadas: % filas cambiadas, % líneas en total', a.a_cambiar, d.filas;
end;
$$;

commit;

-- Verificación (solo lectura): «productos_factura_unidades_normalizadas: aplicada | <filas cambiadas por esta migración, sin contar las revertidas> | <valores distintos que quedan>».
select 'productos_factura_unidades_normalizadas: aplicada' as resultado,
       (select count(*) from public.productos_factura_unidades_respaldo
         where migracion = '20261005160000' and revertida_at is null) as filas_cambiadas,
       (select count(distinct unidad) from public.productos_factura) as valores_distintos;
