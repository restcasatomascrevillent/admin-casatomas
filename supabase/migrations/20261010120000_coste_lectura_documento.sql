set client_encoding = 'UTF8';
-- ===========================================================================
-- 20261010120000_coste_lectura_documento
-- ===========================================================================
-- ##   NO APLICADA: la aplica el dueño a mano (ver PASOS)                  ##
-- ===========================================================================
-- Coste de LEER cada documento (el EXTRACTOR = procesar-factura + ocr-trabajo,
-- la mayor partida de IA). Hasta ahora el coste solo existía en
-- `ocr_trabajos.coste_usd` (documentos en segundo plano) y en la respuesta del
-- camino síncrono, sin guardarse por documento; `ia_uso` lo tiene por llamada,
-- no por factura.
--
-- QUÉ CAMBIA
--   1. `facturas.coste_lectura_usd` (numeric(10,6), NULL = sin dato),
--      `facturas.lectura_llamadas` (llamadas a OpenAI: visión, relecturas,
--      pie, contador y embeddings) y `facturas.lectura_modelo`. Los rellenan
--      procesar-factura (camino síncrono y «sustituir») y ocr-trabajo (al
--      terminar) con la SUMA de las llamadas que costó leer ESE documento.
--      Las facturas existentes con un trabajo de OCR se rellenan desde
--      `ocr_trabajos.coste_usd` (sin llamadas: NULL). El resto queda en NULL.
--   2. `ocr_trabajos.llamadas` (integer, 0 por defecto) y la RPC
--      `ocr_sumar_gasto(uuid, numeric, integer)` (SOLO service_role): suma
--      llamadas y el coste de los intentos que fallaron a mitad (OpenAI los
--      factura igual, y hasta ahora se perdían al reintentar).
--   3. RPC `estadisticas_lectura(p_dias)` (can_read_section('facturas')):
--      documentos leídos, total, media, mediana, el más caro y el reparto por
--      nº de páginas y de líneas. Ventana: p_dias días naturales (Madrid) con
--      hoy incluido, 1-365.
--
-- No toca ninguna función existente. El backfill desactiva solo
-- `trigger_facturas_updated` (para no cambiar `updated_at`, que la
-- sustitución usa como candado) y lo reactiva. Idempotente.
--
-- ORDEN: aplicar esta migración y después desplegar procesar-factura y
-- ocr-trabajo. Al revés también funciona (las funciones toleran que falten las
-- columnas y solo avisan por log), pero hasta aplicarla no se guarda nada.
--
-- PASOS (desde adminpanelct/, POR TERMINAL; no en el SQL Editor)
--   1. npx supabase db query --linked -f supabase/migrations/20261010120000_coste_lectura_documento.sql
--      Tiene que imprimir «coste_lectura_documento: aplicada».
--   2. npx supabase db query --linked -f supabase/tests/coste_lectura_documento_test.sql
--      (BEGIN … ROLLBACK). Tiene que acabar en «coste_lectura_documento_test: OK».
--   Deshacer: supabase/rollbacks/20261010120000_coste_lectura_documento_ROLLBACK.sql
-- ===========================================================================

begin;
set local lock_timeout = '5s';

do $$
begin
  if to_regclass('public.facturas') is null
     or to_regclass('public.ocr_trabajos') is null
     or to_regclass('public.productos_factura') is null
     or to_regprocedure('public.can_read_section(text)') is null
     or to_regprocedure('public.is_super_admin(uuid)') is null then
    raise exception 'coste_lectura_documento: falta 20261005120000_ocr_trabajos_multipagina o las funciones de permisos. No se ha cambiado nada.';
  end if;
end;
$$;

-- ─── 1. Columnas ────────────────────────────────────────────────────────────
alter table public.facturas
  add column if not exists coste_lectura_usd numeric(10,6)
    constraint facturas_coste_lectura_usd_check check (coste_lectura_usd is null or coste_lectura_usd >= 0),
  add column if not exists lectura_llamadas integer
    constraint facturas_lectura_llamadas_check check (lectura_llamadas is null or lectura_llamadas >= 0),
  add column if not exists lectura_modelo text;
comment on column public.facturas.coste_lectura_usd is
  'USD que costó LEER este documento con IA (suma de todas sus llamadas a OpenAI: visión, relecturas, pie, contador y embeddings), '
  'a la tarifa de ocr_trabajos/modelo.ts. NULL = sin dato (anterior al 10/10/2026 o sin lectura medida).';
comment on column public.facturas.lectura_llamadas is
  'Llamadas a OpenAI que costó leer este documento. NULL = sin dato.';
comment on column public.facturas.lectura_modelo is
  'Modelo de visión con el que se leyó este documento.';

alter table public.ocr_trabajos
  add column if not exists llamadas integer not null default 0
    constraint ocr_trabajos_llamadas_check check (llamadas >= 0);
comment on column public.ocr_trabajos.llamadas is
  'Llamadas a OpenAI de la lectura del trabajo (incluidos los intentos que fallaron). Las suma ocr_sumar_gasto().';

-- ─── 2. Backfill desde ocr_trabajos.coste_usd (sin tocar updated_at) ────────
alter table public.facturas disable trigger trigger_facturas_updated;
update public.facturas f
   set coste_lectura_usd = t.coste_usd,
       lectura_modelo = t.modelo
  from public.ocr_trabajos t
 where t.id = f.ocr_trabajo_id
   and f.coste_lectura_usd is null
   and t.coste_usd > 0;
alter table public.facturas enable trigger trigger_facturas_updated;

-- ─── 3. Sumar gasto de un trabajo (intentos fallidos y nº de llamadas) ──────
create or replace function public.ocr_sumar_gasto(p_trabajo_id uuid, p_coste numeric, p_llamadas integer)
returns void
language sql
volatile
security definer
set search_path = public
as $$
  update public.ocr_trabajos
     set coste_usd = coste_usd + greatest(coalesce(p_coste, 0), 0),
         llamadas = llamadas + greatest(coalesce(p_llamadas, 0), 0)
   where id = p_trabajo_id;
$$;
comment on function public.ocr_sumar_gasto(uuid, numeric, integer) is
  'Suma al trabajo de OCR el coste y las llamadas de una lectura (también de los intentos que fallaron). Solo service_role.';
revoke all on function public.ocr_sumar_gasto(uuid, numeric, integer) from public, anon, authenticated;
grant execute on function public.ocr_sumar_gasto(uuid, numeric, integer) to service_role;

-- ─── 4. Estadísticas de lectura ─────────────────────────────────────────────
create or replace function public.estadisticas_lectura(p_dias integer default 30)
returns table (
  documentos       integer,
  total_usd        numeric,
  media_usd        numeric,
  mediana_usd      numeric,
  llamadas_media   numeric,
  mas_cara_id      bigint,
  mas_cara_proveedor text,
  mas_cara_numero  text,
  mas_cara_usd     numeric,
  por_paginas      jsonb,
  por_lineas       jsonb
)
language plpgsql
stable
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  v_dias  integer := least(greatest(coalesce(p_dias, 30), 1), 365);
  v_desde timestamptz;
begin
  if not (public.can_read_section('facturas') or coalesce(public.is_super_admin(auth.uid()), false)) then
    raise exception 'estadisticas_lectura: sin permiso para ver Facturas' using errcode = '42501';
  end if;
  v_desde := (((now() at time zone 'Europe/Madrid')::date - (v_dias - 1))::timestamp) at time zone 'Europe/Madrid';

  return query
  with base as (
    select f.id, f.proveedor, f.numero_documento, f.paginas, f.coste_lectura_usd as usd, f.lectura_llamadas,
           (select count(*) from public.productos_factura p where p.factura_id = f.id)::integer as lineas
      from public.facturas f
     where f.coste_lectura_usd is not null
       and coalesce(f.procesado_en, f.created_at) >= v_desde
  ),
  resumen as (
    select count(*)::integer as n,
           coalesce(sum(b.usd), 0) as total,
           avg(b.usd) as media,
           (percentile_cont(0.5) within group (order by b.usd))::numeric as mediana,
           avg(b.lectura_llamadas) as llamadas_media
      from base b
  ),
  cara as (
    select b.id, b.proveedor::text as proveedor, b.numero_documento::text as numero_documento, b.usd
      from base b
     order by b.usd desc, b.id desc
     limit 1
  ),
  pag as (
    select coalesce(jsonb_agg(jsonb_build_object(
             'tramo', x.tramo, 'documentos', x.n, 'media_usd', x.media, 'total_usd', x.total) order by x.orden), '[]'::jsonb) as j
      from (
        select least(b.paginas, 3) as orden,
               case when b.paginas >= 3 then '3 o más páginas' when b.paginas = 2 then '2 páginas' else '1 página' end as tramo,
               count(*)::integer as n, avg(b.usd) as media, sum(b.usd) as total
          from base b
         group by 1, 2
      ) x
  ),
  lin as (
    select coalesce(jsonb_agg(jsonb_build_object(
             'tramo', x.tramo, 'documentos', x.n, 'media_usd', x.media, 'total_usd', x.total) order by x.orden), '[]'::jsonb) as j
      from (
        select case when b.lineas <= 10 then 1 when b.lineas <= 25 then 2 when b.lineas <= 50 then 3 else 4 end as orden,
               case when b.lineas <= 10 then '1-10 líneas' when b.lineas <= 25 then '11-25 líneas'
                    when b.lineas <= 50 then '26-50 líneas' else 'más de 50 líneas' end as tramo,
               count(*)::integer as n, avg(b.usd) as media, sum(b.usd) as total
          from base b
         group by 1, 2
      ) x
  )
  select r.n, r.total, r.media, r.mediana, r.llamadas_media,
         c.id, c.proveedor, c.numero_documento, c.usd,
         pag.j, lin.j
    from resumen r
    left join cara c on true
    cross join pag
    cross join lin;
end;
$$;
comment on function public.estadisticas_lectura(integer) is
  'Coste de lectura de documentos (facturas.coste_lectura_usd) en los últimos p_dias días naturales (1-365): documentos, total, media, '
  'mediana, el más caro y el reparto por nº de páginas y de líneas. Una fila; sin documentos, documentos = 0 y el resto NULL. '
  'Exige poder ver Facturas.';
revoke all on function public.estadisticas_lectura(integer) from public, anon;
grant execute on function public.estadisticas_lectura(integer) to authenticated, service_role;

commit;

select 'coste_lectura_documento: aplicada' as resultado;
