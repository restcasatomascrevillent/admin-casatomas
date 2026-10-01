set client_encoding = 'UTF8';
-- (Primera línea a propósito: recrea políticas con tilde en el nombre.)
-- ===========================================================================
-- ROLLBACK de supabase/migrations/20261001150000_carta_escritura_por_seccion.sql
-- ===========================================================================
--
-- Este fichero NO es una migración y no debe copiarse a
-- supabase/migrations/ (ver supabase/rollbacks/README.md). Se ejecuta A MANO
-- y solo para deshacer un despliegue que salió mal:
--   npx supabase db query --linked -f supabase/rollbacks/20261001150000_carta_escritura_por_seccion_ROLLBACK.sql
--
-- AVISO: ESTO REABRE EL AGUJERO. Devuelve a CUALQUIER usuario autenticado
-- (con o sin sección, incluso con un `sub` inexistente) crear, editar,
-- despublicar y borrar platos, vinos, cócteles y bebidas, y subir,
-- sobrescribir y borrar sus fotos. Devuelve además TRUNCATE a
-- `authenticated` —que NO pasa por la RLS— y REFERENCES/TRIGGER a `anon`.
--
-- Recrea EXACTAMENTE el estado de producción del 2026-10-01 (sentencias
-- generadas desde pg_policies con format(), no reescritas a mano):
--   · 21 políticas de escritura de Platos/Vinos/Bebidas/Cocteles, duplicados
--     incluidos (el juego con rol public + auth.uid() IS NOT NULL y el juego
--     TO authenticated con true). La de UPDATE de Cocteles NO tiene WITH
--     CHECK: así estaba.
--   · 18 políticas de escritura de storage.objects para los buckets
--     platos/plato, vinos, bebidas, cocteles y carta (este último no existe).
--   · Grants: TRUNCATE a authenticated; REFERENCES y TRIGGER a anon. El
--     SELECT de anon lo tiene antes y después.
-- Las políticas SELECT no se tocan (la migración tampoco las tocó).
-- No hay datos que perder ni recuperar: ni la migración ni esto tocan filas.
-- No hace falta revertir ningún frontend: el panel ni las webs cambiaron.
--
-- Si la migración NO está aplicada, aborta en el primer bloque sin tocar
-- nada. lock_timeout = 5s: un 55P03 significa que no se ha deshecho nada y
-- se reintenta.
-- ===========================================================================

begin;

set local lock_timeout = '5s';

do $$
begin
  if not exists (select 1 from pg_policies
                  where schemaname = 'public' and tablename = 'Platos'
                    and policyname = 'platos_insert_seccion') then
    raise exception 'La migración 20261001150000 no parece aplicada (falta platos_insert_seccion): no hay nada que revertir';
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- 1. Quitar las políticas nuevas
-- ---------------------------------------------------------------------------
drop policy if exists platos_insert_seccion   on public."Platos";
drop policy if exists platos_update_seccion   on public."Platos";
drop policy if exists platos_delete_seccion   on public."Platos";
drop policy if exists platos_service_role     on public."Platos";
drop policy if exists vinos_insert_seccion    on public."Vinos";
drop policy if exists vinos_update_seccion    on public."Vinos";
drop policy if exists vinos_delete_seccion    on public."Vinos";
drop policy if exists vinos_service_role      on public."Vinos";
drop policy if exists bebidas_insert_seccion  on public."Bebidas";
drop policy if exists bebidas_update_seccion  on public."Bebidas";
drop policy if exists bebidas_delete_seccion  on public."Bebidas";
drop policy if exists bebidas_service_role    on public."Bebidas";
drop policy if exists cocteles_insert_seccion on public."Cocteles";
drop policy if exists cocteles_update_seccion on public."Cocteles";
drop policy if exists cocteles_delete_seccion on public."Cocteles";
drop policy if exists cocteles_service_role   on public."Cocteles";

drop policy if exists carta_imagenes_insert_seccion on storage.objects;
drop policy if exists carta_imagenes_update_seccion on storage.objects;
drop policy if exists carta_imagenes_delete_seccion on storage.objects;

-- ---------------------------------------------------------------------------
-- 2. Recrear las 21 políticas de escritura de la carta (tal cual pg_policies)
-- ---------------------------------------------------------------------------

-- Bebidas
create policy "Authenticated users can delete Bebidas" on public."Bebidas" as PERMISSIVE for DELETE to authenticated
  using (true);
create policy "Usuarios autenticados pueden eliminar bebidas" on public."Bebidas" as PERMISSIVE for DELETE to public
  using ((auth.uid() IS NOT NULL));
create policy "Authenticated users can insert Bebidas" on public."Bebidas" as PERMISSIVE for INSERT to authenticated
  with check (true);
create policy "Usuarios autenticados pueden crear bebidas" on public."Bebidas" as PERMISSIVE for INSERT to public
  with check ((auth.uid() IS NOT NULL));
create policy "Authenticated users can update Bebidas" on public."Bebidas" as PERMISSIVE for UPDATE to authenticated
  using (true)
  with check (true);
create policy "Usuarios autenticados pueden actualizar bebidas" on public."Bebidas" as PERMISSIVE for UPDATE to public
  using ((auth.uid() IS NOT NULL))
  with check ((auth.uid() IS NOT NULL));

-- Cocteles
create policy "Usuarios autenticados pueden eliminar cocteles" on public."Cocteles" as PERMISSIVE for DELETE to authenticated
  using (true);
create policy "Usuarios autenticados pueden crear cocteles" on public."Cocteles" as PERMISSIVE for INSERT to authenticated
  with check (true);
create policy "Usuarios autenticados pueden actualizar cocteles" on public."Cocteles" as PERMISSIVE for UPDATE to authenticated
  using (true);

-- Platos
create policy "Authenticated users can delete Platos" on public."Platos" as PERMISSIVE for DELETE to authenticated
  using (true);
create policy "Usuarios autenticados pueden eliminar platos" on public."Platos" as PERMISSIVE for DELETE to public
  using ((auth.uid() IS NOT NULL));
create policy "Authenticated users can insert Platos" on public."Platos" as PERMISSIVE for INSERT to authenticated
  with check (true);
create policy "Usuarios autenticados pueden crear platos" on public."Platos" as PERMISSIVE for INSERT to public
  with check ((auth.uid() IS NOT NULL));
create policy "Authenticated users can update Platos" on public."Platos" as PERMISSIVE for UPDATE to authenticated
  using (true)
  with check (true);
create policy "Usuarios autenticados pueden actualizar platos" on public."Platos" as PERMISSIVE for UPDATE to public
  using ((auth.uid() IS NOT NULL))
  with check ((auth.uid() IS NOT NULL));

-- Vinos
create policy "Authenticated users can delete Vinos" on public."Vinos" as PERMISSIVE for DELETE to authenticated
  using (true);
create policy "Usuarios autenticados pueden eliminar vinos" on public."Vinos" as PERMISSIVE for DELETE to public
  using ((auth.uid() IS NOT NULL));
create policy "Authenticated users can insert Vinos" on public."Vinos" as PERMISSIVE for INSERT to authenticated
  with check (true);
create policy "Usuarios autenticados pueden crear vinos" on public."Vinos" as PERMISSIVE for INSERT to public
  with check ((auth.uid() IS NOT NULL));
create policy "Authenticated users can update Vinos" on public."Vinos" as PERMISSIVE for UPDATE to authenticated
  using (true)
  with check (true);
create policy "Usuarios autenticados pueden actualizar vinos" on public."Vinos" as PERMISSIVE for UPDATE to public
  using ((auth.uid() IS NOT NULL))
  with check ((auth.uid() IS NOT NULL));

-- ---------------------------------------------------------------------------
-- 3. Recrear las 18 políticas de escritura de Storage (tal cual pg_policies)
-- ---------------------------------------------------------------------------
create policy "Allow authenticated delete bebidas" on storage.objects as PERMISSIVE for DELETE to public
  using (((bucket_id = 'bebidas'::text) AND (auth.role() = 'authenticated'::text)));
create policy "Allow authenticated delete vinos" on storage.objects as PERMISSIVE for DELETE to public
  using (((bucket_id = 'vinos'::text) AND (auth.role() = 'authenticated'::text)));
create policy "Autenticados pueden eliminar imágenes cocteles" on storage.objects as PERMISSIVE for DELETE to authenticated
  using ((bucket_id = 'cocteles'::text));
create policy "Authenticated users can delete platos images" on storage.objects as PERMISSIVE for DELETE to public
  using (((bucket_id = ANY (ARRAY['platos'::text, 'plato'::text])) AND (auth.uid() IS NOT NULL)));
create policy "Usuarios autenticados pueden eliminar de carta" on storage.objects as PERMISSIVE for DELETE to authenticated
  using ((bucket_id = 'carta'::text));
create policy "Usuarios autenticados pueden eliminar imágenes de platos" on storage.objects as PERMISSIVE for DELETE to authenticated
  using ((bucket_id = 'platos'::text));
create policy "Allow authenticated upload bebidas" on storage.objects as PERMISSIVE for INSERT to public
  with check (((bucket_id = 'bebidas'::text) AND (auth.role() = 'authenticated'::text)));
create policy "Allow authenticated upload vinos" on storage.objects as PERMISSIVE for INSERT to public
  with check (((bucket_id = 'vinos'::text) AND (auth.role() = 'authenticated'::text)));
create policy "Autenticados pueden subir imágenes cocteles" on storage.objects as PERMISSIVE for INSERT to authenticated
  with check ((bucket_id = 'cocteles'::text));
create policy "Authenticated users can upload platos images" on storage.objects as PERMISSIVE for INSERT to public
  with check (((bucket_id = ANY (ARRAY['platos'::text, 'plato'::text])) AND (auth.uid() IS NOT NULL)));
create policy "Usuarios autenticados pueden subir a carta" on storage.objects as PERMISSIVE for INSERT to authenticated
  with check ((bucket_id = 'carta'::text));
create policy "Usuarios autenticados pueden subir imágenes de platos" on storage.objects as PERMISSIVE for INSERT to authenticated
  with check ((bucket_id = 'platos'::text));
create policy "Allow authenticated update bebidas" on storage.objects as PERMISSIVE for UPDATE to public
  using (((bucket_id = 'bebidas'::text) AND (auth.role() = 'authenticated'::text)));
create policy "Allow authenticated update vinos" on storage.objects as PERMISSIVE for UPDATE to public
  using (((bucket_id = 'vinos'::text) AND (auth.role() = 'authenticated'::text)));
create policy "Autenticados pueden actualizar imágenes cocteles" on storage.objects as PERMISSIVE for UPDATE to authenticated
  using ((bucket_id = 'cocteles'::text));
create policy "Authenticated users can update platos images" on storage.objects as PERMISSIVE for UPDATE to public
  using (((bucket_id = ANY (ARRAY['platos'::text, 'plato'::text])) AND (auth.uid() IS NOT NULL)));
create policy "Usuarios autenticados pueden actualizar en carta" on storage.objects as PERMISSIVE for UPDATE to authenticated
  using ((bucket_id = 'carta'::text))
  with check ((bucket_id = 'carta'::text));
create policy "Usuarios autenticados pueden actualizar imágenes de platos" on storage.objects as PERMISSIVE for UPDATE to authenticated
  using ((bucket_id = 'platos'::text))
  with check ((bucket_id = 'platos'::text));

-- ---------------------------------------------------------------------------
-- 4. Grants de antes
-- ---------------------------------------------------------------------------
grant truncate on public."Platos"   to authenticated;
grant truncate on public."Vinos"    to authenticated;
grant truncate on public."Bebidas"  to authenticated;
grant truncate on public."Cocteles" to authenticated;

grant references, trigger on public."Platos"   to anon;
grant references, trigger on public."Vinos"    to anon;
grant references, trigger on public."Bebidas"  to anon;
grant references, trigger on public."Cocteles" to anon;

commit;

-- VERIFICACIÓN:
--   select tablename, count(*) from pg_policies
--   where schemaname = 'public' and tablename in ('Platos','Vinos','Bebidas','Cocteles')
--   group by 1 order by 1;
--   -- -> Bebidas 9, Cocteles 5, Platos 9, Vinos 9
--
--   select count(*) from pg_policies
--   where schemaname = 'storage' and tablename = 'objects' and cmd <> 'SELECT'
--     and (coalesce(qual,'') ~ '''(platos|plato|vinos|bebidas|cocteles|carta)'''
--          or coalesce(with_check,'') ~ '''(platos|plato|vinos|bebidas|cocteles|carta)''');
--   -- -> 18
--
--   select table_name, grantee, string_agg(privilege_type, ',' order by privilege_type)
--   from information_schema.role_table_grants
--   where table_schema = 'public' and table_name in ('Platos','Vinos','Bebidas','Cocteles')
--     and grantee in ('anon','authenticated') group by 1, 2 order by 1, 2;
--   -- -> anon: REFERENCES,SELECT,TRIGGER
--   --    authenticated: DELETE,INSERT,REFERENCES,SELECT,TRIGGER,TRUNCATE,UPDATE
