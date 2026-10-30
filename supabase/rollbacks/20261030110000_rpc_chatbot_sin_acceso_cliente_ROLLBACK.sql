set client_encoding = 'UTF8';
-- (Primera línea a propósito: psql en una consola de Windows puede arrancar
-- en WIN1252 y leer mal las tildes de los mensajes.)
-- ===========================================================================
-- ROLLBACK de supabase/migrations/20261030110000_rpc_chatbot_sin_acceso_cliente.sql
-- ===========================================================================
-- SE EJECUTA A MANO (psql / SQL editor) y solo para deshacer un despliegue que
-- salió mal. NO es una migración: no copiar a supabase/migrations/.
--
-- EFECTO: REABRE CT-REM-IA-01. Devuelve EXECUTE a authenticated en
-- ejecutar_consulta_chatbot (SQL arbitrario como postgres), buscar_contexto_chatbot
-- y verificar_duplicado_factura, si existen (estado de 20260918084909:218-223).
--
-- Estado al que vuelve: el de Git a0b8d3a reconstruido en el laboratorio PGlite
-- (políticas y GRANT copiados de remediacion-2026-10-30/evidencias/lab-bd,
-- fixture generado por gen-fixture-t4a.mjs). Orden si se revierten varias:
-- 140000 -> 130000 -> 120000 -> 110000 -> 100000.
-- ===========================================================================

begin;
set local lock_timeout = '5s';

do $r$
declare r record;
begin
  for r in select p.oid::regprocedure as fn from pg_proc p
            where p.pronamespace = 'public'::regnamespace
              and p.proname in ('ejecutar_consulta_chatbot', 'buscar_contexto_chatbot', 'verificar_duplicado_factura')
  loop
    execute format('grant execute on function %s to authenticated, service_role', r.fn);
  end loop;
end
$r$;

commit;
