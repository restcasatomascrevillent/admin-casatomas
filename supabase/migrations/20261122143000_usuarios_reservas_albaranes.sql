set client_encoding = 'UTF8';
-- ===========================================================================
-- 20261122143000_usuarios_reservas_albaranes — Dos tipos de usuario nuevos:
-- «Reservas» (ver y crear reservas) y «Albaranes» (solo subir fotos)
-- (10/11/2026)
-- ===========================================================================
-- Petición del dueño: «Crear usuarios de Reservas (solo crear y ver reservas)
-- usuario albaranes solo subida fotos».
--
-- Se hace con DOS PERMISOS NUEVOS (claves de sección; no hay lista ni CHECK de
-- claves en la BD, has_section_permission vale para cualquiera), de un solo
-- interruptor cada uno (guardado en can_view; se acepta también can_edit):
--
--   'reservas_crear'      «Reservas · Crear» → «Puede crear». Con «Ver» en
--                         Reservas, deja CREAR reservas nuevas sin tener
--                         «Editar» (que sigue siendo modificar, aceptar,
--                         cancelar, llegadas, mesas, cierres, lista negra…).
--   'facturas_albaranes'  «Facturas · Solo fotos (albaranes)» → «Puede subir
--                         fotos». Subir fotos/PDF de albaranes y facturas a la
--                         lectura automática, y nada más: ni Análisis, ni
--                         Compras, ni Cargar, ni importes, ni lo que se leyó.
--
-- El panel ofrece dos «tipos de usuario» que rellenan los permisos:
--   Reservas  = «Ver» en Reservas + «Reservas · Crear».
--   Albaranes = solo «Facturas · Solo fotos (albaranes)».
--
-- QUÉ HACE (idempotente; se puede aplicar dos veces)
--   1. reservas_puede_crear() / reservas_puede_crear_usuario(uuid): «Editar» en
--      Reservas, o «Ver» en Reservas + 'reservas_crear'.
--   2. Política nueva reservas_insert_crear (INSERT en reservas con
--      reservas_puede_crear()). Las de SELECT/UPDATE/DELETE no cambian: con
--      solo crear se ve (como con «Ver») pero no se modifica ni se borra.
--   3. Trigger trg_00_reservas_alta_solo_crear (BEFORE INSERT): a quien NO
--      tiene «Editar» solo le deja dar de alta como el formulario del panel:
--      estado 'pendiente' o 'verificada' (nunca 'confirmada' ni otro), canal
--      manual / telefono / presencial (nunca 'web'), sin solicitud del bot
--      (convertir solicitudes es gestionar, «Editar»), sin llegada ni salida,
--      sin «importante», sin mesa fijada y sin email verificado. La service
--      role, las funciones SECURITY DEFINER y otros triggers pasan.
--      DECISIÓN: con solo crear NO se cambia el estado (ni «Ha llegado», ni
--      confirmar, ni cancelar): eso es modificar y sigue exigiendo «Editar».
--      Tampoco se asigna mesa ni se cierra la sala para un evento
--      (asignaciones_mesa y salas_cerradas_servicio siguen con
--      can_write_section('reservas')).
--   4. facturas_puede_subir_fotos() / facturas_puede_subir_fotos_usuario(uuid):
--      lo de antes (facturas_puede_subir_usuario: «Editar» o «Facturas ·
--      Subida») o 'facturas_albaranes'.
--   5. Storage (facturas-originales):
--        facturas_originales_pendientes_insert pasa de facturas_puede_subir()
--        a facturas_puede_subir_fotos() (misma carpeta, pendientes/{su uid}/).
--        facturas_originales_select_albaranes (nueva): con 'facturas_albaranes'
--        se leen SOLO las fotos propias de pendientes/{su uid}/ (lo que acaba
--        de subir; Storage lo relee al subir). Nada de facturas/… ni de otros.
--   6. albaranes_mis_subidas(p_limite): lo único que ve el usuario de
--      albaranes de lo que ha subido (últimos 14 días): id, nombre del
--      fichero, estado, páginas y fechas. Ni resultado, ni factura, ni
--      importes, ni error interno. SECURITY DEFINER, solo lo propio, con sesión
--      de panel viva (private.sesion_panel_permitida, si existe).
--
-- LO QUE NO SE TOCA (y por eso el usuario de albaranes no ve importes)
--   * facturas, productos_factura, ocr_trabajos, ocr_trabajo_paginas,
--     historial_precios, chat de la IA, ocr_resumen_factura, proveedores…:
--     siguen con «Ver»/«Editar» de Facturas o con facturas_puede_subir()
--     («Facturas · Subida»). facturas_puede_subir() NO cambia: el usuario de
--     albaranes no lee ni corrige lo leído, tampoco lo suyo.
--   * La función procesar-factura (repo) acepta 'facturas_albaranes' SOLO para
--     crear el trabajo de lectura (modo «iniciar», que no devuelve datos).
--     Sustituir, añadir página y el camino síncrono (que devuelve lo leído)
--     siguen exigiendo «Facturas · Subida» o «Editar».
--   * La política restrictiva «acceso_panel_no_bloqueado» sigue en todas.
--
-- APLICAR (una a una, nunca `db push`): demo primero (sfonaclosuafvlhutkon);
-- producción (haqmmdfdzzatdnrrcgez) solo tras aceptar el PR de la release y con
-- el «sí» del dueño, A LA VEZ que se despliega procesar-factura y se publica el
-- panel:
--   supabase db query --linked -f supabase/migrations/20261122143000_usuarios_reservas_albaranes.sql
-- Tiene que terminar en «usuarios_reservas_albaranes: aplicada | …».
-- Requiere 20261106510000_permisos_facturas_subida (lo comprueba).
-- Deshacer: supabase/rollbacks/20261122143000_usuarios_reservas_albaranes_ROLLBACK.sql
-- Pruebas (PGlite): npm run test:usuarios-reservas-albaranes:db
-- ===========================================================================

begin;
set local lock_timeout = '5s';

-- ─── 0. Comprobaciones previas (no cambian nada) ────────────────────────────
do $$
declare
  v_faltan text[] := '{}';
  v_col text;
begin
  if to_regclass('public.reservas') is null then
    v_faltan := v_faltan || 'public.reservas'::text;
  else
    foreach v_col in array array['estado', 'canal', 'solicitud_id', 'llegada_at', 'salida_at', 'importante', 'mesa_fijada',
                                 'email_verificado_at'] loop
      if not exists (select 1 from pg_attribute
                      where attrelid = 'public.reservas'::regclass and attname = v_col and attnum > 0 and not attisdropped) then
        v_faltan := v_faltan || format('public.reservas.%s', v_col);
      end if;
    end loop;
  end if;
  if to_regclass('public.ocr_trabajos') is null then v_faltan := v_faltan || 'public.ocr_trabajos'::text; end if;
  if to_regclass('storage.objects') is null then v_faltan := v_faltan || 'storage.objects'::text; end if;
  if to_regprocedure('public.has_section_permission(uuid, text, text)') is null then
    v_faltan := v_faltan || 'has_section_permission(uuid, text, text)'::text;
  end if;
  if to_regprocedure('public.can_edit_section(text)') is null then
    v_faltan := v_faltan || 'can_edit_section(text)'::text;
  end if;
  if to_regprocedure('public.facturas_puede_subir_usuario(uuid)') is null then
    v_faltan := v_faltan || 'facturas_puede_subir_usuario(uuid) (migración 20261106510000)'::text;
  end if;
  -- La política de INSERT que hoy deja crear tiene que ser la de «Editar»: si
  -- hubiera otra (p. ej. con «Ver»), crear ya estaría abierto y esto no
  -- cerraría nada.
  if exists (select 1 from pg_policies
              where schemaname = 'public' and tablename = 'reservas' and cmd in ('INSERT', 'ALL')
                and permissive = 'PERMISSIVE' and roles && array['authenticated', 'public', 'anon']::name[]
                and policyname not in ('reservas_insert_seccion', 'reservas_insert_crear')) then
    v_faltan := v_faltan || 'que en reservas solo haya la política de alta reservas_insert_seccion (hay otra que ya deja crear)'::text;
  end if;
  if cardinality(v_faltan) > 0 then
    raise exception 'usuarios_reservas_albaranes: MIGRACIÓN ABORTADA, falta %. No se ha cambiado nada.', array_to_string(v_faltan, ', ');
  end if;
end;
$$;

-- ─── 1. ¿Puede crear reservas? ──────────────────────────────────────────────
create or replace function public.reservas_puede_crear_usuario(_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  -- 20261122143000_usuarios_reservas_albaranes. Super admin: has_section_permission ya da true.
  select _user_id is not null and (
       coalesce(public.has_section_permission(_user_id, 'reservas', 'edit'), false)
    or (coalesce(public.has_section_permission(_user_id, 'reservas', 'view'), false)
        and (coalesce(public.has_section_permission(_user_id, 'reservas_crear', 'view'), false)
             or coalesce(public.has_section_permission(_user_id, 'reservas_crear', 'edit'), false))))
$$;
comment on function public.reservas_puede_crear_usuario(uuid) is
  'Puede dar de alta reservas: «Editar» en Reservas, o «Ver» en Reservas + «Reservas · Crear» (reservas_crear). 20261122143000.';

create or replace function public.reservas_puede_crear()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.reservas_puede_crear_usuario((select auth.uid()))
$$;
comment on function public.reservas_puede_crear() is
  'RLS: el usuario actual puede dar de alta reservas (reservas_puede_crear_usuario). 20261122143000.';

revoke all on function public.reservas_puede_crear_usuario(uuid) from public, anon;
revoke all on function public.reservas_puede_crear() from public, anon;
grant execute on function public.reservas_puede_crear_usuario(uuid) to authenticated, service_role;
grant execute on function public.reservas_puede_crear() to authenticated, service_role;

-- ─── 2. Alta con solo «Reservas · Crear»: como el formulario del panel ──────
-- SECURITY INVOKER a propósito: current_user es quien escribe. La service role
-- (web, bot, funciones), las funciones SECURITY DEFINER y otros triggers pasan;
-- quien tiene «Editar» en Reservas, también.
create or replace function public.reservas_alta_solo_crear()
returns trigger
language plpgsql
set search_path = public
as $$
-- 20261122143000_usuarios_reservas_albaranes
begin
  if pg_trigger_depth() > 1 or current_user not in ('authenticated', 'anon') then
    return new;
  end if;
  -- can_edit_section (la de las políticas de reservas): has_section_permission no se concede a authenticated.
  if coalesce(public.can_edit_section('reservas'), false) then
    return new;
  end if;
  if coalesce(new.estado::text, '') not in ('pendiente', 'verificada') then
    raise exception 'Con «Reservas · Crear» la reserva nace pendiente o verificada (el cliente la confirma por correo). Confirmarla, cancelarla o cerrarla exige «Editar» en Reservas.'
      using errcode = '42501';
  end if;
  if coalesce(new.canal, '') not in ('manual', 'telefono', 'presencial') then
    raise exception 'Con «Reservas · Crear» solo se dan de alta reservas del personal (canal manual, teléfono o presencial).'
      using errcode = '42501';
  end if;
  if new.solicitud_id is not null then
    raise exception 'Convertir una solicitud del asistente en reserva exige «Editar» en Reservas.' using errcode = '42501';
  end if;
  if new.llegada_at is not null or new.salida_at is not null or coalesce(new.importante, false)
     or coalesce(new.mesa_fijada, false) or new.email_verificado_at is not null then
    raise exception 'Con «Reservas · Crear» solo se crea la reserva: llegadas, mesa fijada, «importante» y lo demás exigen «Editar» en Reservas.'
      using errcode = '42501';
  end if;
  return new;
end;
$$;
revoke all on function public.reservas_alta_solo_crear() from public, anon;

-- «trg_00_…»: los BEFORE van por orden alfabético; este va el primero.
drop trigger if exists trg_00_reservas_alta_solo_crear on public.reservas;
create trigger trg_00_reservas_alta_solo_crear
  before insert on public.reservas
  for each row execute function public.reservas_alta_solo_crear();

drop policy if exists reservas_insert_crear on public.reservas;
create policy reservas_insert_crear on public.reservas for insert to authenticated
  with check ((select public.reservas_puede_crear()));

-- ─── 3. ¿Puede subir fotos de albaranes? ────────────────────────────────────
create or replace function public.facturas_puede_subir_fotos_usuario(_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  -- 20261122143000_usuarios_reservas_albaranes. Lo de antes («Editar» o «Facturas · Subida») o «Solo fotos».
  select _user_id is not null and (
       coalesce(public.facturas_puede_subir_usuario(_user_id), false)
    or coalesce(public.has_section_permission(_user_id, 'facturas_albaranes', 'view'), false)
    or coalesce(public.has_section_permission(_user_id, 'facturas_albaranes', 'edit'), false))
$$;
comment on function public.facturas_puede_subir_fotos_usuario(uuid) is
  'Puede subir fotos de albaranes y facturas a la lectura: facturas_puede_subir_usuario o «Facturas · Solo fotos (albaranes)» (facturas_albaranes). 20261122143000.';

create or replace function public.facturas_puede_subir_fotos()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.facturas_puede_subir_fotos_usuario((select auth.uid()))
$$;
comment on function public.facturas_puede_subir_fotos() is
  'RLS: el usuario actual puede subir fotos a facturas-originales/pendientes/{uid}/ (facturas_puede_subir_fotos_usuario). 20261122143000.';

revoke all on function public.facturas_puede_subir_fotos_usuario(uuid) from public, anon;
revoke all on function public.facturas_puede_subir_fotos() from public, anon;
grant execute on function public.facturas_puede_subir_fotos_usuario(uuid) to authenticated, service_role;
grant execute on function public.facturas_puede_subir_fotos() to authenticated, service_role;

-- ─── 4. Storage: subir a pendientes/{uid}/ y releer solo eso ────────────────
drop policy if exists facturas_originales_pendientes_insert on storage.objects;
create policy facturas_originales_pendientes_insert on storage.objects for insert to authenticated
  with check (
    bucket_id = 'facturas-originales'
    and (storage.foldername(name))[1] = 'pendientes'
    and (storage.foldername(name))[2] = (select auth.uid())::text
    and (select public.facturas_puede_subir_fotos())
  );

drop policy if exists facturas_originales_select_albaranes on storage.objects;
create policy facturas_originales_select_albaranes on storage.objects for select to authenticated
  using (
    bucket_id = 'facturas-originales'
    and (storage.foldername(name))[1] = 'pendientes'
    and (storage.foldername(name))[2] = (select auth.uid())::text
    and (select public.facturas_puede_subir_fotos())
  );

-- ─── 5. Lo que ve el usuario de albaranes de sus subidas ────────────────────
create or replace function public.albaranes_mis_subidas(p_limite integer default 30)
returns table (
  id uuid,
  nombre_original text,
  estado text,
  num_paginas smallint,
  created_at timestamptz,
  terminado_at timestamptz
)
language plpgsql
stable
security definer
set search_path = public
as $$
-- 20261122143000_usuarios_reservas_albaranes. SOLO estado: nada de lo leído.
declare
  v_uid uuid := (select auth.uid());
  v_sesion_ok boolean := true;
begin
  if v_uid is null or not coalesce(public.facturas_puede_subir_fotos_usuario(v_uid), false) then
    raise exception 'Sin permiso para subir fotos de albaranes' using errcode = '42501';
  end if;
  -- Misma barrera que la política restrictiva de las tablas (usuario bloqueado o sesión cerrada).
  if to_regprocedure('private.sesion_panel_permitida()') is not null then
    execute 'select private.sesion_panel_permitida()' into v_sesion_ok;
    if not coalesce(v_sesion_ok, false) then
      raise exception 'Sesión del panel no válida' using errcode = '42501';
    end if;
  end if;
  return query
    select t.id, t.nombre_original, t.estado, t.num_paginas, t.created_at, t.terminado_at
      from public.ocr_trabajos t
     where t.creado_por = v_uid
       and t.created_at >= now() - interval '14 days'
     order by t.created_at desc
     limit greatest(1, least(coalesce(p_limite, 30), 100));
end;
$$;
comment on function public.albaranes_mis_subidas(integer) is
  'Panel › Subir albaranes: estado de lo que ha subido el usuario (14 días), sin resultado ni importes. 20261122143000.';
revoke all on function public.albaranes_mis_subidas(integer) from public, anon;
grant execute on function public.albaranes_mis_subidas(integer) to authenticated, service_role;

-- ─── 6. Comprobación final ──────────────────────────────────────────────────
do $$
declare
  v_malos text[] := '{}';
  v_pol record;
begin
  -- Nada más reabre la escritura en reservas por OR.
  for v_pol in
    select policyname, cmd from pg_policies
     where schemaname = 'public' and tablename = 'reservas' and permissive = 'PERMISSIVE'
       and roles && array['authenticated', 'public', 'anon']::name[] and cmd <> 'SELECT'
       and policyname <> all (array['reservas_insert_seccion', 'reservas_insert_crear', 'reservas_update_seccion', 'reservas_delete_seccion'])
  loop
    v_malos := v_malos || format('política que sobra en reservas: %s (%s)', v_pol.policyname, v_pol.cmd);
  end loop;
  -- facturas_puede_subir() (lectura de lo subido) no puede haber cambiado: el usuario de albaranes no lee lo leído.
  if (select prosrc from pg_proc where oid = 'public.facturas_puede_subir_usuario(uuid)'::regprocedure) like '%facturas_albaranes%' then
    v_malos := v_malos || 'facturas_puede_subir_usuario incluye facturas_albaranes (daría a leer lo subido)'::text;
  end if;
  if exists (select 1 from pg_roles where rolname = 'anon') then
    if has_function_privilege('anon', 'public.reservas_puede_crear()', 'EXECUTE') then
      v_malos := v_malos || 'anon puede ejecutar reservas_puede_crear()'::text;
    end if;
    if has_function_privilege('anon', 'public.albaranes_mis_subidas(integer)', 'EXECUTE') then
      v_malos := v_malos || 'anon puede ejecutar albaranes_mis_subidas()'::text;
    end if;
  end if;
  if cardinality(v_malos) > 0 then
    raise exception 'usuarios_reservas_albaranes: comprobación final fallida (%). No se ha aplicado nada.', array_to_string(v_malos, '; ');
  end if;
end;
$$;

notify pgrst, 'reload schema';

commit;

select 'usuarios_reservas_albaranes: aplicada'
       || ' | usuarios con «Reservas · Crear» ' || (select count(*) from public.user_permissions
                                                    where section_key = 'reservas_crear' and (can_view or can_edit))
       || ' | usuarios con «Facturas · Solo fotos» ' || (select count(*) from public.user_permissions
                                                         where section_key = 'facturas_albaranes' and (can_view or can_edit))
       as resultado;
