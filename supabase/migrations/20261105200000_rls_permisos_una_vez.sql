set client_encoding = 'UTF8';
-- ===========================================================================
-- 20261105200000_rls_permisos_una_vez — permisos comprobados UNA vez por consulta
-- ===========================================================================
-- PROBLEMA
--   Las políticas RLS del tipo `USING (can_read_section('facturas'))` (también
--   can_write_section / can_edit_section) llaman a la función FILA A FILA. Con
--   el histórico importado (~1.900 facturas, ~12.500 líneas) el tablero de
--   Análisis y la lista de Compras pasaban del statement_timeout de 8 s como
--   usuario del panel («canceling statement due to statement timeout»), aunque
--   como postgres tardaban 1-2 s.
--
-- QUÉ HACE
--   Reescribe cada política del esquema public cuya condición es EXACTAMENTE
--   una llamada `can_(read|write|edit)_section(...)` como
--   `(SELECT can_..._section(...))`: Postgres la evalúa una vez por consulta
--   (InitPlan) en vez de una por fila. Es el patrón recomendado por Supabase.
--   Mismo resultado: la función no depende de la fila (solo del usuario y de la
--   sección), así que quién ve qué no cambia.
--   Solo toca USING / WITH CHECK que sean esa llamada sola; las condiciones
--   compuestas se quedan como están. Idempotente (las ya envueltas no casan).
-- ===========================================================================

set lock_timeout = '10s';

do $$
declare
  p record;
  n int := 0;
  v_using text;
  v_check text;
  sql text;
begin
  for p in
    select schemaname, tablename, policyname, qual, with_check
      from pg_policies
     where schemaname = 'public'
       and (qual ~ '^can_(read|write|edit)_section\([^()]*\)$'
            or with_check ~ '^can_(read|write|edit)_section\([^()]*\)$')
  loop
    v_using := case when p.qual ~ '^can_(read|write|edit)_section\([^()]*\)$'
                    then '(select ' || p.qual || ')' end;
    v_check := case when p.with_check ~ '^can_(read|write|edit)_section\([^()]*\)$'
                    then '(select ' || p.with_check || ')' end;
    sql := format('alter policy %I on %I.%I', p.policyname, p.schemaname, p.tablename);
    if v_using is not null then sql := sql || ' using (' || v_using || ')'; end if;
    if v_check is not null then sql := sql || ' with check (' || v_check || ')'; end if;
    execute sql;
    n := n + 1;
  end loop;
  raise notice 'rls_permisos_una_vez: % políticas reescritas', n;
end $$;

select 'rls_permisos_una_vez: aplicada | quedan sin envolver ' ||
       (select count(*) from pg_policies
         where schemaname = 'public'
           and (qual ~ '^can_(read|write|edit)_section\([^()]*\)$'
                or with_check ~ '^can_(read|write|edit)_section\([^()]*\)$')) as resultado;
