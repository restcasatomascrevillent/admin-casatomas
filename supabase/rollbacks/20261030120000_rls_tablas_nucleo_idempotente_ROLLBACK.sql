set client_encoding = 'UTF8';
-- (Primera línea a propósito: psql en una consola de Windows puede arrancar
-- en WIN1252 y leer mal las tildes de los mensajes.)
-- ===========================================================================
-- ROLLBACK de supabase/migrations/20261030120000_rls_tablas_nucleo_idempotente.sql
-- ===========================================================================
-- SE EJECUTA A MANO (psql / SQL editor) y solo para deshacer un despliegue que
-- salió mal. NO es una migración: no copiar a supabase/migrations/.
--
-- EFECTO: devuelve SELECT de reservas a anon (con la RLS activa sigue viendo 0
-- filas; sin ella, todas), quita las políticas de sección de salas/bew y
-- vuelve a APAGAR su RLS (estado de Git). No apaga la RLS de las demás tablas
-- núcleo: si la migración la encendió en alguna (NOTICE «RLS activada ahora
-- en: …»), apagarla es una decisión aparte.
--
-- Estado al que vuelve: el de Git a0b8d3a reconstruido en el laboratorio PGlite
-- (políticas y GRANT copiados de remediacion-2026-10-30/evidencias/lab-bd,
-- fixture generado por gen-fixture-t4a.mjs). Orden si se revierten varias:
-- 140000 -> 130000 -> 120000 -> 110000 -> 100000.
-- ===========================================================================

begin;
set local lock_timeout = '5s';

do $r$ begin
  if to_regclass('public.reservas') is not null then
    grant select on public.reservas to anon;
  end if;
end $r$;

-- salas
do $r$ begin
  if to_regclass('public.salas') is null then raise notice 'rollback: salas no existe'; return; end if;
  execute $q$drop policy if exists salas_select_seccion on public.salas$q$;
  execute $q$drop policy if exists salas_insert_seccion on public.salas$q$;
  execute $q$drop policy if exists salas_update_seccion on public.salas$q$;
  execute $q$drop policy if exists salas_delete_seccion on public.salas$q$;
  execute $q$drop policy if exists salas_service_role on public.salas$q$;
  execute $q$drop policy if exists acceso_panel_no_bloqueado on public.salas$q$;
  execute $q$grant truncate on public.salas to authenticated$q$;
  execute $q$alter table public.salas disable row level security$q$;
end $r$;
-- bew
do $r$ begin
  if to_regclass('public.bew') is null then raise notice 'rollback: bew no existe'; return; end if;
  execute $q$drop policy if exists bew_superadmin on public.bew$q$;
  execute $q$drop policy if exists bew_service_role on public.bew$q$;
  execute $q$drop policy if exists acceso_panel_no_bloqueado on public.bew$q$;
  execute $q$grant select on public.bew to anon$q$;
  execute $q$grant truncate on public.bew to authenticated$q$;
  execute $q$alter table public.bew disable row level security$q$;
end $r$;

commit;
