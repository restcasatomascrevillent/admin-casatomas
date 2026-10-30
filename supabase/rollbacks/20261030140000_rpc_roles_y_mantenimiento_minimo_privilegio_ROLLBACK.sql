set client_encoding = 'UTF8';
-- (Primera línea a propósito: psql en una consola de Windows puede arrancar
-- en WIN1252 y leer mal las tildes de los mensajes.)
-- ===========================================================================
-- ROLLBACK de supabase/migrations/20261030140000_rpc_roles_y_mantenimiento_minimo_privilegio.sql
-- ===========================================================================
-- SE EJECUTA A MANO (psql / SQL editor) y solo para deshacer un despliegue que
-- salió mal. NO es una migración: no copiar a supabase/migrations/.
--
-- EFECTO: REABRE CT-REM-DB-05. anon vuelve a ejecutar is_admin/is_super_admin
-- (oráculo) y authenticated las 3 RPC de mantenimiento. Las 3 políticas de
-- escritura de user_permissions vuelven a TO public.
--
-- Estado al que vuelve: el de Git a0b8d3a reconstruido en el laboratorio PGlite
-- (políticas y GRANT copiados de remediacion-2026-10-30/evidencias/lab-bd,
-- fixture generado por gen-fixture-t4a.mjs). Orden si se revierten varias:
-- 140000 -> 130000 -> 120000 -> 110000 -> 100000.
-- ===========================================================================

begin;
set local lock_timeout = '5s';

grant execute on function public.is_admin(uuid) to public, anon;
grant execute on function public.is_super_admin(uuid) to public, anon;
do $r$
declare v_fn text;
begin
  foreach v_fn in array array['public.append_tool_call_log(text,jsonb)',
                              'public.cleanup_old_security_logs()',
                              'public.recalcular_ocupacion_historica(date,date)'] loop
    if to_regprocedure(v_fn) is not null then
      execute format('grant execute on function %s to authenticated', v_fn);
    end if;
  end loop;
end
$r$;

-- user_permissions
do $r$ begin
  if to_regclass('public.user_permissions') is null then raise notice 'rollback: user_permissions no existe'; return; end if;
  execute $q$alter policy "Super admins pueden actualizar permisos" on public.user_permissions to public$q$;
  execute $q$alter policy "Super admins pueden crear permisos" on public.user_permissions to public$q$;
  execute $q$alter policy "Super admins pueden eliminar permisos" on public.user_permissions to public$q$;
end $r$;

commit;
