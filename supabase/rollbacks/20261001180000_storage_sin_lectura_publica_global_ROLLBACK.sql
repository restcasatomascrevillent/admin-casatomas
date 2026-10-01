set client_encoding = 'UTF8';
-- (Primera línea a propósito: recrea una política con tilde en el nombre.)
-- ===========================================================================
-- ROLLBACK de supabase/migrations/20261001180000_storage_sin_lectura_publica_global.sql
-- ===========================================================================
--
-- Este fichero NO es una migración y no debe copiarse a
-- supabase/migrations/ (ver supabase/rollbacks/README.md). Se ejecuta A MANO
-- y solo para deshacer un despliegue que salió mal:
--   npx supabase db query --linked -f supabase/rollbacks/20261001180000_storage_sin_lectura_publica_global_ROLLBACK.sql
--
-- AVISO: ESTO REABRE LA FUGA. Devuelve a CUALQUIERA con la anon key (que va
-- publicada en las webs) LISTAR y DESCARGAR por API los objetos de TODOS los
-- buckets, incluidas las facturas originales del bucket privado
-- `facturas-originales`, y a cualquier autenticado sin la sección facturas
-- lo mismo. Antes de ejecutarlo, piensa si basta con añadir una política
-- SELECT acotada al bucket que se haya roto.
--
-- Recrea EXACTAMENTE la política de producción del 2026-10-01 (sentencia
-- generada desde pg_policies con format(), no reescrita a mano):
--   «Lectura pública de buckets»  PERMISSIVE  FOR SELECT
--     TO anon, authenticated, service_role  USING (true)
-- La migración no tocó nada más, así que no hay nada más que restaurar.
-- No hay datos que perder ni recuperar: ni la migración ni esto tocan
-- objetos ni buckets. No hace falta revertir ningún frontend.
--
-- Idempotente: si la política ya existe (migración no aplicada o rollback
-- ya ejecutado) la borra y la vuelve a crear igual. lock_timeout = 5s: un
-- 55P03 significa que no se ha deshecho nada y se reintenta.
-- ===========================================================================

begin;

set local lock_timeout = '5s';

drop policy if exists "Lectura pública de buckets" on storage.objects;

create policy "Lectura pública de buckets" on storage.objects as PERMISSIVE for SELECT to anon, authenticated, service_role
  using (true);

-- Comprobación: la política está y es exactamente la de antes.
do $$
begin
  if not exists (
    select 1 from pg_policies
     where schemaname = 'storage' and tablename = 'objects'
       and policyname = 'Lectura pública de buckets'
       and permissive = 'PERMISSIVE' and cmd = 'SELECT'
       and roles::text = '{anon,authenticated,service_role}'
       and qual = 'true' and with_check is null
  ) then
    raise exception 'ROLLBACK: la política «Lectura pública de buckets» no ha quedado como estaba (¿encoding del nombre?)';
  end if;
end;
$$;

commit;

-- VERIFICACIÓN:
--   select policyname, cmd, roles::text, qual from pg_policies
--   where schemaname = 'storage' and tablename = 'objects'
--     and policyname = 'Lectura pública de buckets';
--   -- -> 1 fila: SELECT, {anon,authenticated,service_role}, true
--
--   begin; set local role anon;
--   select bucket_id, count(*) from storage.objects group by 1 order by 1;
--   rollback;
--   -- -> vuelve a salir facturas-originales (la fuga, otra vez abierta)
