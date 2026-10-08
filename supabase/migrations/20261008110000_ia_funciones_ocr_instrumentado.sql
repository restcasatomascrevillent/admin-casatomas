set client_encoding = 'UTF8';
-- ===========================================================================
-- 20261008110000_ia_funciones_ocr_instrumentado
-- ===========================================================================
-- ENCARGO (dueño, 08/10/2026): ver lo gastado en IA en el último mes, en
-- euros y por proceso, dentro de Facturas (pestañas «IA» y «Cargar»), sin
-- claves de OpenAI separadas: se usa `ia_uso`.
--
-- QUÉ HACE
--   1. `ia_funciones`: procesar-factura pasa a instrumentada = true y se da de
--      alta ocr-trabajo (instrumentada = true, unidad 'documento'). Desde este
--      despliegue las dos registran CADA llamada a OpenAI (visión, texto y
--      embeddings) en `ia_uso` con disparador '<documento>#<etapa>':
--      `trabajo:<uuid>#lectura`, `subida:<uuid>#relectura`, `#pie`,
--      `#contador`, `#embeddings` (procesar-factura/registroUso.ts).
--   2. RPC `gasto_ia_resumen(p_funciones text[], p_dias int)`: SOLO agregados
--      (coste en USD, filas, llamadas, unidades, documentos OCR) de las cuatro
--      funciones de Facturas (chat-facturas, procesar-factura, ocr-trabajo,
--      clasificar-productos). SECURITY DEFINER porque `ia_uso` solo la lee el
--      super admin; aquí basta con poder VER Facturas (can_read_section). No
--      devuelve disparadores, modelos ni nada por usuario.
--
-- ORDEN: primero desplegar ocr-trabajo y procesar-factura (si se aplica antes,
-- la pantalla de Costes avisaría de «instrumentada y sin filas» hasta que se
-- desplieguen; no rompe nada).
--
-- PASOS (desde adminpanelct/, POR TERMINAL; no en el SQL Editor)
--   1. npx supabase db query --linked -f supabase/migrations/20261008110000_ia_funciones_ocr_instrumentado.sql
--      Tiene que imprimir «ia_funciones_ocr_instrumentado: aplicada».
--   2. npx supabase db query --linked -f supabase/tests/ia_funciones_ocr_instrumentado_test.sql
--      (BEGIN … ROLLBACK). Tiene que acabar en «ia_funciones_ocr_instrumentado_test: OK».
--   Deshacer: supabase/rollbacks/20261008110000_ia_funciones_ocr_instrumentado_ROLLBACK.sql
--   Idempotente.
-- ===========================================================================

begin;
set local lock_timeout = '5s';

do $$
begin
  if to_regclass('public.ia_uso') is null or to_regclass('public.ia_funciones') is null
     or to_regprocedure('public.can_read_section(text)') is null
     or to_regprocedure('public.is_super_admin(uuid)') is null then
    raise exception 'ia_funciones_ocr_instrumentado: faltan ia_uso / ia_funciones / can_read_section / is_super_admin. No se ha cambiado nada.';
  end if;
end;
$$;

-- ─── 1. Catálogo de funciones ───────────────────────────────────────────────
update public.ia_funciones
   set instrumentada = true,
       descripcion = 'OCR de una factura o albarán por el camino síncrono (una página) y al sustituir un duplicado. '
                     'Registra cada llamada (lectura, relectura, pie, contador, embeddings) en ia_uso desde el 08/10/2026.'
 where funcion = 'procesar-factura';

insert into public.ia_funciones (funcion, descripcion, instrumentada, unidad, orden, activo)
values ('ocr-trabajo',
        'OCR en segundo plano (piezas de documentos largos, pieza única, consolidación con embeddings). '
        'Registra cada llamada en ia_uso con disparador trabajo:<uuid>#<etapa> desde el 08/10/2026.',
        true, 'documento', 25, true)
on conflict (funcion) do update
  set instrumentada = true,
      descripcion   = excluded.descripcion,
      unidad        = excluded.unidad;

-- ─── 2. Resumen agregado para Facturas ──────────────────────────────────────
create or replace function public.gasto_ia_resumen(
  p_funciones text[] default null,
  p_dias      integer default 30
)
returns table (
  funcion          text,
  coste_usd        numeric,
  filas            bigint,
  llamadas         bigint,
  unidades         bigint,
  filas_sin_tarifa bigint,
  documentos_ocr   bigint,
  ultima           timestamptz
)
language plpgsql
stable
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  v_dias integer := least(greatest(coalesce(p_dias, 30), 1), 90);
  v_permitidas constant text[] := array['chat-facturas', 'procesar-factura', 'ocr-trabajo', 'clasificar-productos'];
begin
  if not (public.can_read_section('facturas') or coalesce(public.is_super_admin(auth.uid()), false)) then
    raise exception 'gasto_ia_resumen: sin permiso para ver Facturas' using errcode = '42501';
  end if;

  return query
  with base as (
    select u.funcion, u.operacion, u.coste_usd, u.llamadas, u.created_at,
           nullif(split_part(coalesce(u.disparador, ''), '#', 1), '') as documento
      from public.ia_uso u
     where u.created_at >= now() - make_interval(days => v_dias)
       and u.funcion = any (v_permitidas)
       and (p_funciones is null or u.funcion = any (p_funciones))
  ),
  docs as (
    -- Documentos distintos entre procesar-factura y ocr-trabajo a la vez: un
    -- trabajo que se lee en ocr-trabajo y se sustituye en procesar-factura
    -- cuenta UNA vez.
    select count(distinct b.documento) as n
      from base b
     where b.funcion in ('procesar-factura', 'ocr-trabajo')
  )
  select b.funcion,
         sum(b.coste_usd)::numeric,
         count(*)::bigint,
         coalesce(sum(b.llamadas), 0)::bigint,
         case when b.funcion in ('procesar-factura', 'ocr-trabajo')
              then count(distinct b.documento)
              else count(*) filter (where b.operacion <> 'embedding')
         end::bigint,
         count(*) filter (where b.coste_usd is null)::bigint,
         (select d.n from docs d)::bigint,
         max(b.created_at)
    from base b
   group by b.funcion
   order by b.funcion;
end;
$$;

comment on function public.gasto_ia_resumen(text[], integer) is
  'Monitor de gasto de IA de Facturas: agregados de ia_uso (USD) de chat-facturas, procesar-factura, ocr-trabajo '
  'y clasificar-productos en los últimos p_dias (1-90). unidades = preguntas/tandas (filas que no son embeddings) '
  'o documentos distintos (OCR); documentos_ocr = documentos distintos entre los dos OCR. Exige poder ver Facturas.';

revoke all on function public.gasto_ia_resumen(text[], integer) from public, anon;
grant execute on function public.gasto_ia_resumen(text[], integer) to authenticated, service_role;

commit;

select 'ia_funciones_ocr_instrumentado: aplicada' as resultado,
       (select string_agg(funcion || '=' || instrumentada, ', ' order by orden)
          from public.ia_funciones where funcion in ('procesar-factura', 'ocr-trabajo')) as ocr;
