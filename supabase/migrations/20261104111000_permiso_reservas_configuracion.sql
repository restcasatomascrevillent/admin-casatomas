set client_encoding = 'UTF8';
-- ===========================================================================
-- 20261104111000_permiso_reservas_configuracion — Permiso propio para
-- Reservas › Configuración (04/11/2026)
-- ===========================================================================
-- Petición del dueño: «que haya un permiso para esa pestaña configurable tal
-- y como se hace en gestor web». La pestaña Configuración de Reservas (chips
-- «General» —reglas, mesas y turnos— y «Plantillas email») deja de ser «solo
-- rol admin» y pasa a la sección de permisos 'reservas_configuracion'
-- («Reservas · Configuración» en Usuarios): con «Ver» se consulta y con
-- «Puede editar» se cambia. El super admin, siempre (has_section_permission).
-- Ser admin ya no da nada por sí solo, igual que en las pestañas del Gestor
-- Web (gestor_carta, gestion_web).
--
-- No hay lista ni CHECK de claves de sección en la BD: has_section_permission,
-- can_read_section y can_write_section valen para cualquier clave, y
-- admin-create-user solo exige el formato [a-z_]{1,64}.
--
-- QUÉ CAMBIA (escritura de lo que se edita en la pestaña)
--   * configuracion_reservas: UPDATE con can_write_section('reservas_configuracion').
--     Se borra «Admins can manage configuracion_reservas» (FOR ALL con
--     is_admin). Sin INSERT ni DELETE para authenticated: la fila es única y el
--     panel solo la actualiza.
--   * configuracion_turnos: INSERT, UPDATE y DELETE con
--     can_write_section('reservas_configuracion'). Antes, can_write_section('reservas')
--     y además las tres «Admins pueden … configuración de turnos» (is_admin),
--     que se borran.
--   * plantillas_email_reserva: SELECT con can_read_section('reservas_configuracion');
--     INSERT, UPDATE y DELETE con can_write_section('reservas_configuracion')
--     (antes, 'reservas'). Solo las lee el editor de plantillas; los correos
--     los manda emails-reserva con la service role.
--   * fn_restaurar_version_plantilla: comprueba can_write_section('reservas_configuracion').
--     El envío de prueba (POST /emails-reserva/enviar-prueba) pide lo mismo:
--     hay que desplegar emails-reserva junto con esta migración.
--
-- LO QUE NO SE TOCA (Reservas lo necesita para funcionar)
--   * Lectura de configuracion_reservas y configuracion_turnos: sigue con
--     «Ver» en Reservas o en Dashboard (disponibilidad, alta de reservas,
--     ocupación, plano del servicio). La web pública no las lee con anon.
--   * mesas y espacios_reserva: las comparten el plano, unir mesas y el
--     servicio, y siguen con la sección 'reservas'. Cambiar el número de una
--     mesa desde Configuración pide en el panel las dos ediciones.
--   * envios_email_reserva (historial de envíos): sigue con 'reservas'.
--   * La política restrictiva «acceso_panel_no_bloqueado» (sesión de panel
--     viva) sigue en todas.
--
-- NADIE PIERDE LA PESTAÑA (semilla, solo la primera vez)
--   Hasta hoy la veía quien tenía el rol admin y podía entrar en Reservas
--   («Ver» en 'reservas'), y como admin escribía configuracion_reservas y
--   configuracion_turnos (is_admin). A esos usuarios (salvo super admins, que
--   ya entran siempre) se les da 'reservas_configuracion' con «Ver» y «Puede
--   editar». Lo único que ganan es editar las plantillas si no tenían «Puede
--   editar» en Reservas. Los roles preconfigurados con rol base admin y «Ver»
--   en Reservas reciben la misma entrada, para que las altas nuevas sigan
--   igual. Si ya hay algún permiso de esta sección (la migración se aplica
--   otra vez), no se siembra nada: no pisa lo que haya cambiado el dueño.
--
-- AUDITORÍA: las cuatro tablas ya llevan trg_auditoria; las filas sembradas
-- quedan en el registro sin actor (como cualquier migración).
--
-- APLICAR (una a una, nunca `db push`): demo primero (sfonaclosuafvlhutkon),
-- producción (haqmmdfdzzatdnrrcgez) solo tras aceptar el PR y con el «sí» del
-- dueño. Idempotente. Tiene que terminar en
-- «permiso_reservas_configuracion: aplicada».
-- Deshacer: supabase/rollbacks/20261104111000_permiso_reservas_configuracion_ROLLBACK.sql
-- Pruebas: npm run test:reservas-configuracion:db (PGlite).
-- ===========================================================================

begin;
set local lock_timeout = '5s';

-- ─── 0. Comprobaciones previas (no cambian nada) ────────────────────────────
do $$
declare
  v_faltan text[] := '{}';
  v_t text;
  v_f text;
begin
  foreach v_t in array array['public.configuracion_reservas', 'public.configuracion_turnos',
                             'public.plantillas_email_reserva', 'public.user_permissions', 'public.user_roles'] loop
    if to_regclass(v_t) is null then
      v_faltan := v_faltan || v_t;
    end if;
  end loop;
  foreach v_f in array array['public.can_read_section(text)', 'public.can_write_section(text)',
                             'public.is_super_admin(uuid)',
                             'public.fn_restaurar_version_plantilla(text, integer, uuid)'] loop
    if to_regprocedure(v_f) is null then
      v_faltan := v_faltan || v_f;
    end if;
  end loop;
  if cardinality(v_faltan) > 0 then
    raise exception 'permiso_reservas_configuracion: falta %. No se ha cambiado nada.', array_to_string(v_faltan, ', ');
  end if;
end;
$$;

-- ─── 1. Semilla: quien hoy ve la pestaña la conserva ────────────────────────
do $$
declare
  v_n integer := 0;
begin
  if exists (select 1 from public.user_permissions where section_key = 'reservas_configuracion') then
    raise notice 'permiso_reservas_configuracion: la sección ya tiene permisos; no se siembra otra vez';
    return;
  end if;

  insert into public.user_permissions (user_id, section_key, can_view, can_edit)
  select distinct r.user_id, 'reservas_configuracion', true, true
    from public.user_roles r
    join public.user_permissions p
      on p.user_id = r.user_id and p.section_key = 'reservas' and p.can_view
   where r.role::text = 'admin'
     and not public.is_super_admin(r.user_id)
  on conflict (user_id, section_key) do nothing;
  get diagnostics v_n = row_count;
  raise notice 'permiso_reservas_configuracion: % admin(s) conservan la pestaña Configuración', v_n;

  if to_regclass('public.user_role_presets') is not null then
    update public.user_role_presets
       set permissions = permissions || jsonb_build_array(jsonb_build_object(
             'section_key', 'reservas_configuracion', 'can_view', true, 'can_edit', true))
     where base_role::text = 'admin'
       and jsonb_typeof(permissions) = 'array'
       and exists (select 1 from jsonb_array_elements(permissions) e
                    where e ->> 'section_key' = 'reservas' and coalesce((e ->> 'can_view')::boolean, false))
       and not exists (select 1 from jsonb_array_elements(permissions) e
                        where e ->> 'section_key' = 'reservas_configuracion');
    get diagnostics v_n = row_count;
    raise notice 'permiso_reservas_configuracion: % rol(es) preconfigurado(s) con la sección', v_n;
  end if;
end;
$$;

-- ─── 2. configuracion_reservas: guardar las reglas ──────────────────────────
drop policy if exists "Admins can manage configuracion_reservas" on public.configuracion_reservas;
drop policy if exists configuracion_reservas_update_seccion on public.configuracion_reservas;
create policy configuracion_reservas_update_seccion
  on public.configuracion_reservas for update to authenticated
  using ((select public.can_write_section('reservas_configuracion')))
  with check ((select public.can_write_section('reservas_configuracion')));

-- ─── 3. configuracion_turnos: crear, cambiar y borrar periodos ──────────────
drop policy if exists "Admins pueden actualizar configuración de turnos" on public.configuracion_turnos;
drop policy if exists "Admins pueden crear configuración de turnos" on public.configuracion_turnos;
drop policy if exists "Admins pueden eliminar configuración de turnos" on public.configuracion_turnos;
drop policy if exists configuracion_turnos_insert_seccion on public.configuracion_turnos;
create policy configuracion_turnos_insert_seccion
  on public.configuracion_turnos for insert to authenticated
  with check ((select public.can_write_section('reservas_configuracion')));
drop policy if exists configuracion_turnos_update_seccion on public.configuracion_turnos;
create policy configuracion_turnos_update_seccion
  on public.configuracion_turnos for update to authenticated
  using ((select public.can_write_section('reservas_configuracion')))
  with check ((select public.can_write_section('reservas_configuracion')));
drop policy if exists configuracion_turnos_delete_seccion on public.configuracion_turnos;
create policy configuracion_turnos_delete_seccion
  on public.configuracion_turnos for delete to authenticated
  using ((select public.can_write_section('reservas_configuracion')));

-- ─── 4. plantillas_email_reserva: ver y editar las plantillas ───────────────
drop policy if exists plantillas_email_reserva_select_seccion on public.plantillas_email_reserva;
create policy plantillas_email_reserva_select_seccion
  on public.plantillas_email_reserva for select to authenticated
  using ((select public.can_read_section('reservas_configuracion')));
drop policy if exists plantillas_email_reserva_insert_seccion on public.plantillas_email_reserva;
create policy plantillas_email_reserva_insert_seccion
  on public.plantillas_email_reserva for insert to authenticated
  with check ((select public.can_write_section('reservas_configuracion')));
drop policy if exists plantillas_email_reserva_update_seccion on public.plantillas_email_reserva;
create policy plantillas_email_reserva_update_seccion
  on public.plantillas_email_reserva for update to authenticated
  using ((select public.can_write_section('reservas_configuracion')))
  with check ((select public.can_write_section('reservas_configuracion')));
drop policy if exists plantillas_email_reserva_delete_seccion on public.plantillas_email_reserva;
create policy plantillas_email_reserva_delete_seccion
  on public.plantillas_email_reserva for delete to authenticated
  using ((select public.can_write_section('reservas_configuracion')));

-- ─── 5. «Volver a una versión» de una plantilla ─────────────────────────────
-- Idéntica a la de 20260920010000 salvo la sección que comprueba.
create or replace function public.fn_restaurar_version_plantilla(
  p_tipo text,
  p_version_a_restaurar integer,
  p_actor uuid default auth.uid()
)
returns public.plantillas_email_reserva
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_origen public.plantillas_email_reserva;
  v_siguiente integer;
  v_nueva public.plantillas_email_reserva;
begin
  -- SECURITY DEFINER salta la RLS de la tabla: se repite aquí la comprobación
  -- de la sección (Reservas › Configuración desde el 04/11/2026).
  if not public.can_write_section('reservas_configuracion') then
    raise exception 'No tienes permiso de escritura en la sección reservas_configuracion';
  end if;

  select * into v_origen
    from public.plantillas_email_reserva
    where tipo = p_tipo and version = p_version_a_restaurar;

  if not found then
    raise exception 'No existe la version % de la plantilla %', p_version_a_restaurar, p_tipo;
  end if;

  select coalesce(max(version), 0) + 1 into v_siguiente
    from public.plantillas_email_reserva
    where tipo = p_tipo;

  update public.plantillas_email_reserva set es_actual = false where tipo = p_tipo and es_actual;

  insert into public.plantillas_email_reserva (
    tipo, version, es_actual, asunto, saludo, cuerpo, texto_boton_principal,
    texto_boton_secundario, pie, color_acento, color_oscuro, logo_url, bloques,
    nota_version, creado_por
  ) values (
    v_origen.tipo, v_siguiente, true, v_origen.asunto, v_origen.saludo, v_origen.cuerpo,
    v_origen.texto_boton_principal, v_origen.texto_boton_secundario, v_origen.pie,
    v_origen.color_acento, v_origen.color_oscuro, v_origen.logo_url, v_origen.bloques,
    'Restaurada desde la version ' || p_version_a_restaurar, p_actor
  )
  returning * into v_nueva;

  return v_nueva;
end;
$$;
comment on function public.fn_restaurar_version_plantilla(text, integer, uuid) is
  'Contrato para el panel: "volver atrás" = duplicar el contenido de una version antigua como version nueva y marcarla actual. Nunca reescribe una version ya guardada. Exige can_write_section(''reservas_configuracion'').';
revoke all on function public.fn_restaurar_version_plantilla(text, integer, uuid) from public, anon;
grant execute on function public.fn_restaurar_version_plantilla(text, integer, uuid) to authenticated, service_role;

-- ─── 6. Comprobación final ──────────────────────────────────────────────────
do $$
declare
  v_malos text[] := '{}';
  v_pol record;
  v_esperadas text[] := array[
    'configuracion_reservas.configuracion_reservas_update_seccion',
    'configuracion_turnos.configuracion_turnos_insert_seccion',
    'configuracion_turnos.configuracion_turnos_update_seccion',
    'configuracion_turnos.configuracion_turnos_delete_seccion',
    'plantillas_email_reserva.plantillas_email_reserva_select_seccion',
    'plantillas_email_reserva.plantillas_email_reserva_insert_seccion',
    'plantillas_email_reserva.plantillas_email_reserva_update_seccion',
    'plantillas_email_reserva.plantillas_email_reserva_delete_seccion'];
  v_e text;
begin
  foreach v_e in array v_esperadas loop
    if not exists (select 1 from pg_policies
                    where schemaname = 'public' and tablename || '.' || policyname = v_e
                      and coalesce(qual, '') || coalesce(with_check, '') like '%reservas_configuracion%') then
      v_malos := v_malos || format('falta la política %s con la sección reservas_configuracion', v_e);
    end if;
  end loop;

  -- Ninguna otra política permisiva de authenticated (o de public) que deje
  -- escribir, o leer plantillas, por la vía vieja: rol admin o sección
  -- 'reservas'. Si hubiera alguna desconocida, se para: reabriría por OR.
  for v_pol in
    select tablename, policyname, cmd, coalesce(qual, '') || ' ' || coalesce(with_check, '') as expr
      from pg_policies
     where schemaname = 'public'
       and tablename in ('configuracion_reservas', 'configuracion_turnos', 'plantillas_email_reserva')
       and permissive = 'PERMISSIVE'
       and roles && array['authenticated', 'public']::name[]
       and (cmd <> 'SELECT' or tablename = 'plantillas_email_reserva')
       and policyname <> all (array['configuracion_reservas_update_seccion',
                                     'configuracion_turnos_insert_seccion', 'configuracion_turnos_update_seccion',
                                     'configuracion_turnos_delete_seccion',
                                     'plantillas_email_reserva_select_seccion', 'plantillas_email_reserva_insert_seccion',
                                     'plantillas_email_reserva_update_seccion', 'plantillas_email_reserva_delete_seccion'])
  loop
    v_malos := v_malos || format('política que sobra en %s: %s (%s)', v_pol.tablename, v_pol.policyname, v_pol.cmd);
  end loop;

  if (select prosrc from pg_proc where oid = 'public.fn_restaurar_version_plantilla(text, integer, uuid)'::regprocedure)
       not like '%can_write_section(''reservas_configuracion'')%' then
    v_malos := v_malos || 'fn_restaurar_version_plantilla no comprueba reservas_configuracion'::text;
  end if;
  if exists (select 1 from pg_roles where rolname = 'anon')
     and has_function_privilege('anon', 'public.fn_restaurar_version_plantilla(text, integer, uuid)', 'EXECUTE') then
    v_malos := v_malos || 'anon puede restaurar plantillas'::text;
  end if;

  if cardinality(v_malos) > 0 then
    raise exception 'permiso_reservas_configuracion: comprobación final fallida (%). No se ha aplicado nada.', array_to_string(v_malos, '; ');
  end if;
  raise notice 'permiso_reservas_configuracion: aplicada';
end;
$$;

commit;
