set client_encoding = 'UTF8';
-- ===========================================================================
-- 20261106520000_permisos_reservas_cheques_tienda — Quien solo tiene «Ver»
-- (06/11/2026)
-- ===========================================================================
-- Decisiones del dueño para los usuarios con «Ver» y sin «Editar»:
--   1. Reservas: solo consultar. Sin cambios en la BD: toda la escritura ya
--      exige edición (reservas con can_edit_section('reservas');
--      asignaciones_mesa, mesas, espacios_reserva, ajustes_mesa_servicio,
--      cierres_reserva, salas_cerradas_servicio, blacklist,
--      sugerencias_blacklist y solicitudes_pendientes con
--      can_write_section('reservas'); comprobado en la demo el 06/11/2026).
--      El panel oculta los botones.
--   2. Reservas · Configuración: con solo «Ver» no se ve la pestaña (panel).
--      Sin cambios en la BD: escribir ya exige can_write_section(
--      'reservas_configuracion') (20261104111000).
--   3. Cheques regalo: con solo «Ver» se consulta Y SE CANJEA. ESTO es lo que
--      cambia aquí: canjear_cheque_regalo(text) pasa a pedir el permiso de
--      VISTA de 'cheques' (antes, 'edit'). El resto sigue con 'edit': la
--      plantilla de factura y la del cheque (RLS), crear_cheque_manual(_v2),
--      y en la función cheques-regalo-admin (repo web) crear_manual,
--      enviar_manual y eliminar. La validez se sigue comprobando dentro del
--      UPDATE (pagado, sin usar, sin caducar) y el trigger
--      cheques_controlar_caducidad sigue protegiendo cualquier otro camino.
--      Queda registrado quién canjea (canjeado_por) y cuándo.
--   4. Tienda: con solo «Ver» se ve la lista, sin Ajustes ni interruptores.
--      Sin cambios en la BD: configuracion_tienda solo se actualiza con
--      can_write_section('tienda') y tienda_marcar_vinos es SECURITY INVOKER
--      (decide esa RLS) (20261103150000; comprobado en la demo).
--
-- El cuerpo de la función es el de 20261008161255_caducidad_cheques_regalo
-- con 'view' en lugar de 'edit'. Mismos GRANT (authenticated) y sin anon.
--
-- APLICAR (una a una, nunca `db push`): demo primero (sfonaclosuafvlhutkon),
-- producción (haqmmdfdzzatdnrrcgez) solo tras aceptar el PR y con el «sí» del
-- dueño. Idempotente. Tiene que terminar en
-- «permisos_reservas_cheques_tienda: aplicada».
-- Deshacer: supabase/rollbacks/20261106520000_permisos_reservas_cheques_tienda_ROLLBACK.sql
-- Pruebas: npm run test:permisos-solo-ver:db y npm run test:cheques:db (PGlite).
-- ===========================================================================

begin;
set local lock_timeout = '5s';

-- ─── 0. Comprobaciones previas (no cambian nada) ────────────────────────────
do $$
declare
  v_faltan text[] := '{}';
  v_col text;
begin
  if to_regclass('public.cheques_regalo') is null then
    v_faltan := v_faltan || 'public.cheques_regalo'::text;
  else
    foreach v_col in array array['codigo', 'estado', 'usado', 'canjeado_en', 'canjeado_por', 'caduca_el'] loop
      if not exists (select 1 from pg_attribute
                      where attrelid = 'public.cheques_regalo'::regclass and attname = v_col and attnum > 0 and not attisdropped) then
        v_faltan := v_faltan || format('public.cheques_regalo.%s', v_col);
      end if;
    end loop;
  end if;
  if to_regprocedure('public.has_section_permission(uuid, text, text)') is null then
    v_faltan := v_faltan || 'public.has_section_permission(uuid, text, text)'::text;
  end if;
  if to_regprocedure('public.verificar_cheque_regalo(text)') is null then
    v_faltan := v_faltan || 'public.verificar_cheque_regalo(text)'::text;
  end if;
  if to_regprocedure('public.canjear_cheque_regalo(text)') is null then
    v_faltan := v_faltan || 'public.canjear_cheque_regalo(text)'::text;
  end if;
  if cardinality(v_faltan) > 0 then
    raise exception 'permisos_reservas_cheques_tienda: falta %. No se ha aplicado nada.', array_to_string(v_faltan, ', ');
  end if;
end;
$$;

-- ─── 1. Canjear un cheque con el permiso de VISTA de Cheques ────────────────
create or replace function public.canjear_cheque_regalo(p_codigo text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare c public.cheques_regalo;
begin
  -- 06/11/2026: basta con «Ver» en Cheques (decisión del dueño). Sin sesión o sin la sección, no.
  if auth.uid() is null or not coalesce(public.has_section_permission(auth.uid(), 'cheques', 'view'), false) then
    raise exception 'No tienes permiso para canjear cheques' using errcode = '42501';
  end if;
  -- La validez se comprueba dentro del UPDATE: una verificación antigua no autoriza el canje.
  update public.cheques_regalo set usado = true, canjeado_en = clock_timestamp(), canjeado_por = auth.uid()
    where codigo = upper(trim(p_codigo)) and estado = 'pagado' and not coalesce(usado, false)
      and caduca_el >= (clock_timestamp() at time zone 'Europe/Madrid')::date
    returning * into c;
  if not found then
    if exists (select 1 from public.cheques_regalo where codigo = upper(trim(p_codigo))
      and caduca_el < (clock_timestamp() at time zone 'Europe/Madrid')::date) then
      raise exception 'El cheque está caducado y no puede canjearse';
    end if;
    raise exception 'El cheque no es válido o ya ha sido canjeado';
  end if;
  return public.verificar_cheque_regalo(c.codigo);
end $$;

comment on function public.canjear_cheque_regalo(text) is
  'Panel › Cheques › Verificar: canjea un cheque pagado, sin usar y sin caducar. Basta con «Ver» en Cheques (06/11/2026).';
revoke all on function public.canjear_cheque_regalo(text) from public, anon;
grant execute on function public.canjear_cheque_regalo(text) to authenticated;

-- ─── 2. Comprobación final ──────────────────────────────────────────────────
do $$
declare
  v_malos text[] := '{}';
  v_src text := (select prosrc from pg_proc where oid = 'public.canjear_cheque_regalo(text)'::regprocedure);
begin
  if v_src not like '%has_section_permission(auth.uid(), ''cheques'', ''view'')%' then
    v_malos := v_malos || 'canjear_cheque_regalo no pide la vista de cheques'::text;
  end if;
  if v_src like '%''cheques'', ''edit''%' then
    v_malos := v_malos || 'canjear_cheque_regalo sigue pidiendo la edición'::text;
  end if;
  if v_src not like '%auth.uid() is null%' then
    v_malos := v_malos || 'canjear_cheque_regalo no rechaza a quien no tiene sesión'::text;
  end if;
  if exists (select 1 from pg_roles where rolname = 'anon')
     and has_function_privilege('anon', 'public.canjear_cheque_regalo(text)', 'EXECUTE') then
    v_malos := v_malos || 'anon puede canjear cheques'::text;
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated')
     and not has_function_privilege('authenticated', 'public.canjear_cheque_regalo(text)', 'EXECUTE') then
    v_malos := v_malos || 'authenticated no puede ejecutar canjear_cheque_regalo'::text;
  end if;
  if cardinality(v_malos) > 0 then
    raise exception 'permisos_reservas_cheques_tienda: comprobación final fallida (%). No se ha aplicado nada.', array_to_string(v_malos, '; ');
  end if;
  raise notice 'permisos_reservas_cheques_tienda: aplicada';
end;
$$;

notify pgrst, 'reload schema';

commit;
