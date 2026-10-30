set client_encoding = 'UTF8';
-- (Primera línea a propósito: psql en una consola de Windows puede arrancar
-- en WIN1252 y leer mal las tildes de los mensajes.)
-- ===========================================================================
-- ROLLBACK de supabase/migrations/20261030100000_gdpr_limpieza_solo_servicio.sql
-- ===========================================================================
-- SE EJECUTA A MANO (psql / SQL editor) y solo para deshacer un despliegue que
-- salió mal. NO es una migración: no copiar a supabase/migrations/.
--
-- EFECTO: REABRE CT-REM-DB-01. Cualquier autenticado vuelve a poder ejecutar
-- ejecutar_limpieza_gdpr(), cambiar gdpr_config y borrar gdpr_audit_log.
--
-- Estado al que vuelve: el de Git a0b8d3a reconstruido en el laboratorio PGlite
-- (políticas y GRANT copiados de remediacion-2026-10-30/evidencias/lab-bd,
-- fixture generado por gen-fixture-t4a.mjs). Orden si se revierten varias:
-- 140000 -> 130000 -> 120000 -> 110000 -> 100000.
-- ===========================================================================

begin;
set local lock_timeout = '5s';

grant execute on function public.ejecutar_limpieza_gdpr() to authenticated;

-- gdpr_config
do $r$ begin
  if to_regclass('public.gdpr_config') is null then raise notice 'rollback: gdpr_config no existe'; return; end if;
  execute $q$drop policy if exists gdpr_config_superadmin on public.gdpr_config$q$;
  execute $q$drop policy if exists "Auth can manage gdpr_config" on public.gdpr_config$q$;
  execute $q$create policy "Auth can manage gdpr_config" on public.gdpr_config as permissive for all to authenticated using (true) with check (true)$q$;
  execute $q$drop policy if exists "Admins can manage gdpr_config" on public.gdpr_config$q$;
  execute $q$create policy "Admins can manage gdpr_config" on public.gdpr_config as permissive for all to public using (is_admin(auth.uid()))$q$;
  execute $q$grant select on public.gdpr_config to anon$q$;
  execute $q$grant truncate on public.gdpr_config to authenticated$q$;
end $r$;
-- gdpr_audit_log
do $r$ begin
  if to_regclass('public.gdpr_audit_log') is null then raise notice 'rollback: gdpr_audit_log no existe'; return; end if;
  execute $q$drop policy if exists gdpr_audit_log_select_superadmin on public.gdpr_audit_log$q$;
  execute $q$drop policy if exists "Auth can manage gdpr_audit_log" on public.gdpr_audit_log$q$;
  execute $q$create policy "Auth can manage gdpr_audit_log" on public.gdpr_audit_log as permissive for all to authenticated using (true) with check (true)$q$;
  execute $q$drop policy if exists "Admins can view gdpr_audit_log" on public.gdpr_audit_log$q$;
  execute $q$create policy "Admins can view gdpr_audit_log" on public.gdpr_audit_log as permissive for select to public using (is_admin(auth.uid()))$q$;
  execute $q$grant select on public.gdpr_audit_log to anon$q$;
  execute $q$grant insert, update, delete, truncate on public.gdpr_audit_log to authenticated$q$;
end $r$;

commit;
