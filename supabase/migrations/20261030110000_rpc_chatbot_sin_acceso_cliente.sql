set client_encoding = 'UTF8';
-- ===========================================================================
-- CT-REM-IA-01 · RPC heredadas del chatbot n8n: sin EXECUTE para clientes
-- (remediación 2026-10-30, tarea T4a-DB-AUTHZ, perfil rem-05)
-- ===========================================================================
--
-- PROBLEMA: 20260918084909:214-223 dejó concedidas a `authenticated`:
--   * public.ejecutar_consulta_chatbot(query_sql text): SECURITY DEFINER que
--     ejecuta SQL arbitrario como `postgres` (la propia migración lo dice).
--     Su definición NO está en Git: existe (o no) en demo/prod fuera del repo.
--   * public.buscar_contexto_chatbot(vector): devuelve filas completas de
--     facturas sin comprobar sección.
--   * public.verificar_duplicado_factura(varchar,varchar,date,numeric):
--     SECURITY DEFINER, sin control de rol, devuelve row_to_json(facturas).
--
-- CONSUMIDORES (grep 30/10 en admin-casatomas/src, supabase/functions,
-- web-casatomas/src y restaurante-phone): ningún cliente las llama. Solo
-- procesar-factura/guardado.ts usa verificar_duplicado_factura, con
-- SERVICE ROLE (procesar-factura/index.ts:74). types.ts las sigue listando.
--
-- CAMBIO (defensivo, NO drop: el drop lo decide el dueño):
--   * ejecutar_consulta_chatbot: TODAS las firmas que existan (pg_proc por
--     nombre) -> revoke EXECUTE a public, anon, authenticated. service_role
--     conserva lo que tuviera.
--   * buscar_contexto_chatbot y verificar_duplicado_factura: igual, pero SOLO
--     si son SECURITY DEFINER, authenticated puede ejecutarlas y su cuerpo no
--     comprueba rol/sección. A verificar_duplicado_factura se le garantiza
--     EXECUTE a service_role (lo usa procesar-factura).
--   Si no existe ninguna, la migración no hace nada (NOTICE).
--
-- Bloqueos: ninguno sobre tablas (solo GRANT/REVOKE de funciones; lock de
-- catálogo instantáneo). Rollback: supabase/rollbacks/
-- 20261030110000_rpc_chatbot_sin_acceso_cliente_ROLLBACK.sql.
-- ===========================================================================

begin;
set local lock_timeout = '5s';

do $ia01$
declare
  r record;
  v_n int := 0;
  v_control constant text := '(is_super_admin|is_admin|has_section_permission|can_read_section|can_write_section|can_edit_section|_puede_)';
begin
  for r in
    select p.oid::regprocedure as fn, p.proname, p.prosecdef, p.prosrc
      from pg_proc p
     where p.pronamespace = 'public'::regnamespace
       and p.proname in ('ejecutar_consulta_chatbot', 'buscar_contexto_chatbot', 'verificar_duplicado_factura')
     order by p.proname, p.oid
  loop
    if r.proname = 'ejecutar_consulta_chatbot'
       or (r.prosecdef
           and has_function_privilege('authenticated', r.fn, 'EXECUTE')
           and r.prosrc !~* v_control) then
      execute format('revoke all on function %s from public, anon, authenticated', r.fn);
      if r.proname = 'verificar_duplicado_factura' then
        execute format('grant execute on function %s to service_role', r.fn);
      end if;
      v_n := v_n + 1;
      raise notice 'IA-01 · sin EXECUTE para clientes: %', r.fn;
    else
      raise notice 'IA-01 · se deja como está (no es DEFINER abierto sin control de rol): %', r.fn;
    end if;
  end loop;
  if v_n = 0 then
    raise notice 'IA-01 · no hay funciones que cerrar en esta base';
  end if;

  -- Comprobación final: ninguna ejecutar_consulta_chatbot ejecutable por clientes
  if exists (select 1 from pg_proc p
              where p.pronamespace = 'public'::regnamespace
                and p.proname = 'ejecutar_consulta_chatbot'
                and (has_function_privilege('anon', p.oid, 'EXECUTE')
                     or has_function_privilege('authenticated', p.oid, 'EXECUTE'))) then
    raise exception 'MIGRACIÓN ABORTADA al final (IA-01): ejecutar_consulta_chatbot sigue ejecutable por anon/authenticated. No se ha aplicado nada.';
  end if;
end
$ia01$;

commit;
