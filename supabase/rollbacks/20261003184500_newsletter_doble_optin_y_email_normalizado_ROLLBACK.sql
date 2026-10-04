set client_encoding = 'UTF8';
-- (Primera línea a propósito: psql en una consola de Windows puede arrancar
-- en WIN1252 y leer mal las tildes.)
-- ===========================================================================
-- ROLLBACK de supabase/migrations/20261003184500_newsletter_doble_optin_y_email_normalizado.sql
-- ===========================================================================
--
-- Este fichero NO es una migración y no debe copiarse a supabase/migrations/
-- (ver supabase/rollbacks/README.md). Se ejecuta A MANO, entero: lleva su
-- propio begin/commit. `npx supabase db query --linked -f <este fichero>`,
-- `psql "$DB_URL" -v ON_ERROR_STOP=1 -f <este fichero>` o pegado en el SQL
-- editor.
--
-- Qué revierte:
--   · VUELVE EL ALTA SIN VERIFICAR: se quitan los triggers
--     newsletter_alta_reserva_verificada_ins/_upd y se recrea
--     agregar_suscriptor_al_reservar_consentida (AFTER INSERT, versión de
--     20261003143000): cualquiera que escriba un email ajeno en la web y
--     marque la casilla vuelve a suscribirlo.
--   · El personal vuelve a poder poner/cambiar la casilla y la verificación
--     (se quitan reservas_/solicitudes_proteger_consentimiento_newsletter).
--   · Las reservas que salgan de una solicitud dejan de heredar la casilla.
--   · newsletter_suscriptores_proteger_baja vuelve a la versión de
--     20261003171500 (reactivar no exige email verificado).
--   · Email: se quita el trigger de normalización y el índice ÚNICO sobre
--     lower(email); se recrea el índice NO único de 20261003171500. Los
--     emails ya guardados siguen en minúsculas (no se "desnormalizan").
--   · CHECK de origen_alta a los 3 valores de 20260926062009.
--   · Vuelven las políticas INSERT/UPDATE/DELETE de newsletter_suscriptores
--     para quien tenga escritura en Marketing (20260918120000) y sus
--     privilegios de escritura.
--
-- Qué NO revierte (a propósito):
--   · Columnas nuevas (reservas.email_verificado_at y
--     .consentimiento_newsletter_at, solicitudes_pendientes.consentimiento_newsletter
--     y .condiciones_aceptadas_at, newsletter_suscriptores.fecha_verificacion_email):
--     son constancia RGPD y las leen las Edge Functions desplegadas; sin los
--     triggers no hacen nada. Al final hay un bloque comentado para borrarlas.
--   · newsletter_suscriptores_depurados: guarda las filas que la migración
--     fusionó o retiró. Las filas retiradas NO vuelven solas (ver la consulta
--     comentada al final si hubiera que restaurar las fusionadas).
--
-- ABORTA sin tocar nada si ya hay suscriptores con origen_alta
-- 'reserva_manual' o 'solicitud_web' (el CHECK antiguo no los admite y son
-- constancia del consentimiento: decide a mano qué poner).
--
-- Si la migración no llegó a aplicarse, ejecutar esto deja el estado de
-- 20261003171500 (idempotente).
-- ===========================================================================

begin;
set local lock_timeout = '5s';

do $$
declare
  v_n integer;
begin
  select count(*) into v_n
  from public.newsletter_suscriptores
  where origen_alta in ('reserva_manual', 'solicitud_web');
  if v_n > 0 then
    raise exception 'Hay % suscriptores con origen_alta reserva_manual/solicitud_web; el CHECK antiguo no los admite. Rollback abortado sin cambios.', v_n;
  end if;
end
$$;

-- --- Triggers y funciones del doble opt-in ---
drop trigger if exists newsletter_alta_reserva_verificada_upd on public.reservas;
drop trigger if exists newsletter_alta_reserva_verificada_ins on public.reservas;
drop function if exists public.newsletter_alta_por_reserva_verificada();

drop trigger if exists reservas_proteger_consentimiento_newsletter on public.reservas;
drop function if exists public.reservas_proteger_consentimiento_newsletter();
drop trigger if exists solicitudes_proteger_consentimiento_newsletter on public.solicitudes_pendientes;
drop function if exists public.solicitudes_proteger_consentimiento_newsletter();
drop function if exists public.newsletter_peticion_privilegiada();

-- --- Alta en el INSERT (versión exacta de 20261003143000) ---
create or replace function public.agregar_suscriptor_desde_reserva_consentida()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  insert into public.newsletter_suscriptores (
    email, nombre, activo, origen_alta, fecha_baja, origen_baja,
    fecha_consentimiento, reserva_consentimiento_id
  )
  values (
    new.email,
    new.nombre,
    true,
    case when new.canal = 'telefono' then 'reserva_telefono' else 'reserva_web' end,
    null,
    null,
    coalesce(new.created_at, now()),
    new.id
  )
  on conflict (email) do update set
    nombre = coalesce(excluded.nombre, newsletter_suscriptores.nombre),
    activo = true,
    origen_alta = excluded.origen_alta,
    fecha_baja = null,
    origen_baja = null,
    fecha_consentimiento = excluded.fecha_consentimiento,
    reserva_consentimiento_id = excluded.reserva_consentimiento_id,
    updated_at = now();

  return new;
end;
$$;

drop trigger if exists agregar_suscriptor_al_reservar_consentida on public.reservas;
create trigger agregar_suscriptor_al_reservar_consentida
after insert on public.reservas
for each row
when (new.consentimiento_newsletter = true and new.email is not null and new.email <> '')
execute function public.agregar_suscriptor_desde_reserva_consentida();

comment on column public.reservas.consentimiento_newsletter is
  'Si el cliente marcó la casilla OPCIONAL de consentimiento explícito para el newsletter al reservar (RGPD, Art. 6.1.a). Lo rellena reservas-web/index.ts desde el campo consentimiento_newsletter del body (solo el booleano true cuenta). Prueba de consentimiento de ESTA reserva (fecha = created_at); independiente del estado que tenga luego el email en newsletter_suscriptores. Si es true, el trigger agregar_suscriptor_al_reservar_consentida da de alta o reactiva el email.';

-- --- Protección de la baja: versión de 20261003171500 ---
create or replace function public.newsletter_suscriptores_proteger_baja()
returns trigger
language plpgsql
set search_path to 'public'
as $$
declare
  v_consentimiento_nuevo boolean := false;
begin
  if old.activo and not new.activo then
    new.fecha_baja := coalesce(new.fecha_baja, now());
    new.origen_baja := coalesce(new.origen_baja, 'panel_manual');
    return new;
  end if;

  if not old.activo and not new.activo then
    new.fecha_baja := coalesce(old.fecha_baja, new.fecha_baja);
    new.origen_baja := coalesce(old.origen_baja, new.origen_baja);
    return new;
  end if;

  if not old.activo and new.activo then
    if new.reserva_consentimiento_id is not null
       and new.reserva_consentimiento_id is distinct from old.reserva_consentimiento_id then
      select exists (
        select 1
        from public.reservas r
        where r.id = new.reserva_consentimiento_id
          and r.consentimiento_newsletter = true
          and lower(r.email) = lower(new.email)
          and r.created_at > coalesce(old.fecha_baja, old.updated_at)
      ) into v_consentimiento_nuevo;
    end if;

    if v_consentimiento_nuevo then
      return new;
    end if;

    if pg_trigger_depth() > 1 then
      raise warning 'newsletter: reactivación de % ignorada (sin consentimiento nuevo posterior a la baja)', old.id;
      new.activo := false;
      new.fecha_baja := old.fecha_baja;
      new.origen_baja := old.origen_baja;
      new.fecha_consentimiento := old.fecha_consentimiento;
      new.reserva_consentimiento_id := old.reserva_consentimiento_id;
      return new;
    end if;

    raise exception 'No se puede reactivar a un suscriptor dado de baja sin un consentimiento nuevo (casilla marcada en una reserva posterior a la baja).'
      using errcode = 'check_violation',
            hint = 'La baja del newsletter es definitiva hasta que el cliente vuelva a dar su consentimiento.';
  end if;

  return new;
end;
$$;

comment on function public.newsletter_suscriptores_proteger_baja() is
  'Trigger BEFORE UPDATE de newsletter_suscriptores: completa fecha/origen de la baja, la hace inmutable y solo deja reactivar con un consentimiento nuevo (reserva posterior a la baja con consentimiento_newsletter = true). Migración 20261003171500.';

-- --- Email ---
drop trigger if exists newsletter_suscriptores_normalizar_email on public.newsletter_suscriptores;
drop function if exists public.newsletter_suscriptores_normalizar_email();
drop index if exists public.newsletter_suscriptores_email_lower_key;
create index if not exists newsletter_suscriptores_email_lower_idx
  on public.newsletter_suscriptores (lower(email));

-- --- origen_alta: CHECK de 20260926062009 ---
alter table public.newsletter_suscriptores
  drop constraint if exists newsletter_suscriptores_origen_alta_check;
alter table public.newsletter_suscriptores
  add constraint newsletter_suscriptores_origen_alta_check
  check (origen_alta is null or origen_alta in ('reserva_web', 'reserva_telefono', 'panel_manual'));

comment on column public.newsletter_suscriptores.origen_alta is
  'Cómo se dio de alta: reserva_web (casilla de consentimiento explícita en el formulario de reserva web), reserva_telefono (mismo consentimiento por teléfono, pendiente de implementar en restaurante-phone), panel_manual (alta manual desde el panel). NULL en altas anteriores a este campo.';

-- --- Escritura del personal: políticas de 20260918120000 ---
grant insert, update, delete on public.newsletter_suscriptores to authenticated;
drop policy if exists "newsletter_suscriptores_insert_seccion" on public.newsletter_suscriptores;
create policy "newsletter_suscriptores_insert_seccion" on public.newsletter_suscriptores
  for insert to authenticated
  with check (public.can_write_section('marketing'));
drop policy if exists "newsletter_suscriptores_update_seccion" on public.newsletter_suscriptores;
create policy "newsletter_suscriptores_update_seccion" on public.newsletter_suscriptores
  for update to authenticated
  using (public.can_write_section('marketing'))
  with check (public.can_write_section('marketing'));
drop policy if exists "newsletter_suscriptores_delete_seccion" on public.newsletter_suscriptores;
create policy "newsletter_suscriptores_delete_seccion" on public.newsletter_suscriptores
  for delete to authenticated
  using (public.can_write_section('marketing'));

commit;

-- ---------------------------------------------------------------------------
-- OPCIONAL, aparte y solo si se quiere borrar TODO rastro (se pierde la
-- constancia de verificaciones y de las casillas de las solicitudes; antes
-- hay que desplegar emails-reserva/reservas-web sin el doble opt-in, o sus
-- escrituras de esas columnas fallarán en silencio):
--
-- begin;
-- alter table public.reservas drop column if exists email_verificado_at,
--                             drop column if exists consentimiento_newsletter_at;
-- alter table public.solicitudes_pendientes drop column if exists consentimiento_newsletter,
--                                           drop column if exists condiciones_aceptadas_at;
-- alter table public.newsletter_suscriptores drop column if exists fecha_verificacion_email;
-- commit;
--
-- Restaurar a mano una fila fusionada (si el dueño lo decide; ojo: solo si no
-- choca con el email del superviviente, que es el mismo en minúsculas):
--   select * from public.newsletter_suscriptores_depurados order by depurado_at;
-- ---------------------------------------------------------------------------
