set client_encoding = 'UTF8';
-- ROLLBACK de 20261122143000_usuarios_reservas_albaranes.sql (tipos de usuario
-- «Reservas» y «Albaranes»). Aplicar a mano SOLO si hay que deshacerlo.
-- Idempotente: se puede aplicar dos veces, y la migración se puede volver a
-- aplicar después.
--
-- Deja como estaba (demo, 10/11/2026):
--   * Crear reservas vuelve a exigir «Editar» en Reservas (solo
--     reservas_insert_seccion); sin el trigger de alta ni las funciones nuevas.
--   * Storage: subir a pendientes/{uid}/ con facturas_puede_subir() («Editar»
--     o «Facturas · Subida»), como en 20261106510000; sin la lectura de las
--     fotos propias por «Solo fotos».
--   * Sin albaranes_mis_subidas().
--
-- NO borra los permisos 'reservas_crear' ni 'facturas_albaranes' de
-- user_permissions (sin la migración no dan nada) ni las reservas o los
-- documentos ya creados. Antes de aplicarlo, volver a desplegar procesar-factura
-- de antes y publicar el panel de antes (el nuevo ofrece «Nueva reserva» y
-- «Subir albaranes» a esos usuarios, que fallarían al guardar).
begin;
set local lock_timeout = '5s';

-- Reservas
drop policy if exists reservas_insert_crear on public.reservas;
drop trigger if exists trg_00_reservas_alta_solo_crear on public.reservas;
drop function if exists public.reservas_alta_solo_crear();
drop function if exists public.reservas_puede_crear();
drop function if exists public.reservas_puede_crear_usuario(uuid);

-- Storage
drop policy if exists facturas_originales_select_albaranes on storage.objects;
drop policy if exists facturas_originales_pendientes_insert on storage.objects;
create policy facturas_originales_pendientes_insert on storage.objects for insert to authenticated
  with check (
    bucket_id = 'facturas-originales'
    and (storage.foldername(name))[1] = 'pendientes'
    and (storage.foldername(name))[2] = (select auth.uid())::text
    and (select public.facturas_puede_subir())
  );

-- Albaranes
drop function if exists public.albaranes_mis_subidas(integer);
drop function if exists public.facturas_puede_subir_fotos();
drop function if exists public.facturas_puede_subir_fotos_usuario(uuid);

notify pgrst, 'reload schema';

commit;

select 'usuarios_reservas_albaranes: deshecha' as resultado;
