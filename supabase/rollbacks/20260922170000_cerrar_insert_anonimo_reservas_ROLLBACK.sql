-- =====================================================================
-- ROLLBACK de 20260922170000_cerrar_insert_anonimo_reservas.sql
-- Restaura el estado EXACTO anterior a la migracion.
-- ATENCION: ejecutar esto REABRE el INSERT anonimo sin validar contenido
-- sobre `reservas` (cualquiera con la anon key podria volver a crear
-- reservas directamente, sin pasar por la Edge Function `reservas-web` ni
-- por sus comprobaciones de blacklist/escalera/frecuencia). Usar solo si
-- el cierre rompio algo en produccion y hay que volver atras con prisa.
--
-- No recrea la politica "Público puede crear reservas" (TO public): esa
-- politica ya estaba borrada -- sustituida por
-- "reservas_insert_anon_formulario_web" -- desde antes de que la migracion
-- que este fichero revierte se escribiera (ver "CORRECCION SOBRE EL
-- ENCARGO ORIGINAL" en la cabecera de la migracion). Recrearla aqui
-- reintroduciria ademas el INSERT para `authenticated` sin permiso de
-- seccion, que es un problema distinto y ya resuelto por
-- 20260918120000_rls_por_permisos_de_seccion.sql. Este rollback solo
-- deshace lo que la migracion 20260922170000 hizo de verdad.
-- =====================================================================

begin;

-- Inverso de "revoke insert on public.\"reservas\" from anon;"
grant insert on public."reservas" to anon;

-- Inverso de "drop policy ... reservas_insert_anon_formulario_web ..."
-- Definicion identica a la de 20260918120000_rls_por_permisos_de_seccion.sql
-- (linea 176).
create policy "reservas_insert_anon_formulario_web" on public."reservas"
  for insert to anon
  with check (true);

commit;
