set client_encoding = 'UTF8';
-- ===========================================================================
-- 20261120110000_servicios_estado_detalle — Super Admin › Servicios: más datos
-- de Supabase y Vercel, y GitHub sin el aviso repetido (09/11/2026)
-- ===========================================================================
-- Dueño (09/11/2026): «Arregla servicios, no funciona bien del todo […] añade
-- diferentes circulitos por proveedor que haga falta, por ejemplo en Vercel CDN
-- requests, en Supabase algo más de info».
--
-- QUÉ HACE
--   1. `servicios_metricas_bd_extra()` (solo service_role): conexiones abiertas
--      a la base de datos frente al máximo del servidor (`max_connections`) y
--      las 5 tablas que más ocupan (con índices y TOAST). La lee la función
--      servicios-uso para la tarjeta de Supabase; sin ella, esas cifras no
--      salen y lo demás sigue igual.
--   2. GitHub: «Pruebas automáticas (GitHub Actions)» deja de tener límite
--      propio (12 US$). Era el mismo dato que «Minutos de Actions» (2.000 min
--      × 0,006 US$) y cada exceso salía dos veces en «Qué mirar». Queda como
--      dato informativo; el límite de verdad es el de los minutos, que pasa a
--      llamarse «Minutos de Actions en repositorios privados»: los de
--      repositorios públicos (hoy web, admin y touza) ni cuentan ni se pagan.
--      Solo si siguen como los dejó la semilla (no pisa lo editado).
--   3. Vercel: límite editable de «Memoria de las funciones» (360 GB-hora del
--      plan Hobby). Solo si no existe.
--
-- APLICAR (una a una, nunca `db push`): demo primero (sfonaclosuafvlhutkon),
-- producción (haqmmdfdzzatdnrrcgez) solo tras aceptar el PR de la release y
-- con el «sí» del dueño. Idempotente.
-- Deshacer: supabase/rollbacks/20261120110000_servicios_estado_detalle_ROLLBACK.sql
-- Pruebas: npm run test:servicios:db (PGlite).
-- ===========================================================================

begin;

do $$
begin
  if to_regclass('public.servicios_contratados') is null then
    raise exception 'servicios_estado_detalle: falta 20261103120000_servicios_contratados. No se ha cambiado nada.';
  end if;
end;
$$;

-- ─── 1. Conexiones y tablas que más ocupan ──────────────────────────────────
create or replace function public.servicios_metricas_bd_extra()
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
declare
  v_tablas jsonb;
begin
  select coalesce(jsonb_agg(jsonb_build_object('tabla', t.nombre, 'bytes', t.bytes) order by t.bytes desc), '[]'::jsonb)
    into v_tablas
    from (
      select case when n.nspname = 'public' then c.relname else n.nspname || '.' || c.relname end as nombre,
             pg_total_relation_size(c.oid) as bytes
        from pg_class c
        join pg_namespace n on n.oid = c.relnamespace
       where c.relkind in ('r', 'm', 'p')
         and n.nspname not in ('pg_catalog', 'information_schema', 'pg_toast')
       order by pg_total_relation_size(c.oid) desc
       limit 5
    ) t;
  return jsonb_build_object(
    'conexiones', (select count(*) from pg_stat_activity where backend_type = 'client backend'),
    'conexiones_max', current_setting('max_connections')::int,
    'tablas_mayores', v_tablas
  );
end;
$$;
revoke all on function public.servicios_metricas_bd_extra() from public, anon, authenticated;
grant execute on function public.servicios_metricas_bd_extra() to service_role;

-- ─── 2. GitHub: un solo límite (los minutos) ────────────────────────────────
update public.servicios_contratados
   set limites = jsonb_set(
         limites,
         '{actions_computo}',
         (limites -> 'actions_computo') - 'limite' || jsonb_build_object(
           'nota', 'Precio de lista de los minutos de repositorios privados, antes de descontar lo incluido. Informativo: el límite es el de los minutos.'
         ))
 where proveedor = 'github'
   and limites ? 'actions_computo'
   and (limites -> 'actions_computo' ->> 'limite')::numeric = 12
   and limites -> 'actions_computo' ->> 'unidad' = 'USD';

update public.servicios_contratados
   set limites = jsonb_set(limites, '{actions_minutos,etiqueta}', to_jsonb('Minutos de Actions en repositorios privados'::text))
 where proveedor = 'github'
   and limites -> 'actions_minutos' ->> 'etiqueta' = 'Minutos de Actions';

-- ─── 3. Vercel: memoria de las funciones ────────────────────────────────────
update public.servicios_contratados
   set limites = coalesce(limites, '{}'::jsonb) || jsonb_build_object('memoria_funciones', jsonb_build_object(
         'orden', 5,
         'etiqueta', 'Memoria de las funciones',
         'limite', 360,
         'unidad', 'GB-hora',
         'periodo', 'últimos 30 días',
         'fuente', 'https://vercel.com/docs/plans/hobby'
       ))
 where proveedor = 'vercel'
   and not (coalesce(limites, '{}'::jsonb) ? 'memoria_funciones');

commit;
