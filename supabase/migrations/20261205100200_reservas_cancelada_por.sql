set client_encoding = 'UTF8';
-- ===========================================================================
-- 20261205100200_reservas_cancelada_por — quién canceló cada reserva (16/11/2026)
-- ===========================================================================
-- Petición: «que se muestre quién ha cancelado cada reserva (cliente o
-- restaurante) y que las canceladas aparezcan en el panel de Reservas».
-- Hasta ahora cancelar solo ponía estado = 'cancelada': no quedaba ni quién
-- ni cuándo.
--
-- QUÉ HACE
--   reservas.cancelada_por  text  NULL | 'cliente' | 'restaurante'
--   reservas.cancelada_at   timestamptz NULL
--   Trigger BEFORE INSERT OR UPDATE `trg_reservas_cancelada_por`: lo rellena la
--   BASE DE DATOS, no quien escribe, para que valga en TODOS los caminos que
--   cancelan (Lista, ficha, «Rechazar» una solicitud, enlace de cancelar de la
--   web, «No me va bien» del correo de contraoferta, bot telefónico):
--     · al pasar a 'cancelada' apunta la hora y:
--         - con usuario del panel (auth.uid() no nulo) → 'restaurante', SIEMPRE
--           (no se puede falsear desde el panel);
--         - sin usuario y con la clave de servicio (auth.role() =
--           'service_role': reservas-web, emails-reserva y el bot telefónico,
--           que solo cancelan a petición del cliente) → 'cliente', salvo que
--           quien escribe diga otra cosa. Por eso las Edge Functions NO
--           cambian ni hay que volver a desplegarlas;
--         - cualquier otro caso (SQL a mano, un cron) → NULL: «no consta».
--     · al salir de 'cancelada' (se recupera la reserva) borra los dos datos;
--     · mientras sigue cancelada, un usuario del panel no puede cambiarlos.
--   El aviso «Reserva cancelada» del panel (fn_aviso_reserva_nueva_cancelada,
--   20261122160000) añade al final «· la canceló el cliente / el restaurante».
--   El resto de la función es idéntico.
--
-- LO QUE YA ESTABA CANCELADO se queda con los dos datos en NULL: no hay de
-- dónde sacarlo (la auditoría de `reservas` no deja rastro utilizable del paso
-- a 'cancelada': comprobado en la demo, 2 de 32). El panel lo enseña como
-- «Cancelada» sin autor.
--
-- PERMISOS: no cambian (GRANT de tabla y RLS `reservas_update_seccion`).
--
-- ORDEN DE DESPLIEGUE: da igual. El panel aguanta sin ella (lee sin las
-- columnas si no existen), pero hasta aplicarla no sabe quién canceló.
--
-- APLICAR (nunca `db push`): demo primero (sfonaclosuafvlhutkon), producción
-- (haqmmdfdzzatdnrrcgez) solo con el «sí» del dueño. Idempotente.
-- Deshacer: supabase/rollbacks/20261205100200_reservas_cancelada_por_ROLLBACK.sql
-- Pruebas: npm run test:cancelada-por:db (PGlite).
-- ===========================================================================
begin;
set local lock_timeout = '5s';

alter table public.reservas
  add column if not exists cancelada_por text,
  add column if not exists cancelada_at timestamptz;

alter table public.reservas drop constraint if exists reservas_cancelada_por_check;
alter table public.reservas
  add constraint reservas_cancelada_por_check
  check (cancelada_por is null or cancelada_por in ('cliente', 'restaurante'));

comment on column public.reservas.cancelada_por is
  'Quién canceló la reserva (16/11/2026): ''cliente'' (enlace de la web o del correo, bot telefónico) o ''restaurante'' (un usuario del panel). NULL si no está cancelada o no consta (canceladas antes de esta columna). Lo escribe el trigger trg_reservas_cancelada_por.';
comment on column public.reservas.cancelada_at is
  'Cuándo se canceló la reserva (16/11/2026). NULL si no está cancelada o se canceló antes de existir la columna. Lo escribe el trigger trg_reservas_cancelada_por.';

create or replace function public.fn_reservas_cancelada_por()
returns trigger
language plpgsql
set search_path to 'public'
as $f$
begin
  if new.estado is distinct from 'cancelada' then
    -- No está cancelada (o se ha recuperado): no hay autor ni hora.
    new.cancelada_por := null;
    new.cancelada_at := null;
  elsif tg_op = 'INSERT' or old.estado is distinct from 'cancelada' then
    -- Se cancela ahora.
    new.cancelada_at := now();
    if auth.uid() is not null then
      new.cancelada_por := 'restaurante';
    elsif new.cancelada_por is null and auth.role() = 'service_role' then
      new.cancelada_por := 'cliente';
    end if;
  elsif auth.uid() is not null then
    -- Ya estaba cancelada: desde el panel no se reescribe quién ni cuándo.
    new.cancelada_por := old.cancelada_por;
    new.cancelada_at := old.cancelada_at;
  end if;
  return new;
end;
$f$;

drop trigger if exists trg_reservas_cancelada_por on public.reservas;
create trigger trg_reservas_cancelada_por
  before insert or update on public.reservas
  for each row execute function public.fn_reservas_cancelada_por();

-- El aviso «Reserva cancelada» dice quién la canceló. Copia de 20261122160000 con ese añadido.
create or replace function public.fn_aviso_reserva_nueva_cancelada()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tipo text;
  v_titulo text;
  v_detalle text;
begin
  if tg_op = 'INSERT' then
    if coalesce(new.canal, '') not in ('web', 'telefono') then
      return new;
    end if;
    if new.estado = 'cancelada' then
      return new;
    end if;
    v_tipo := 'reserva_nueva';
    v_titulo := 'Reserva nueva';
  elsif tg_op = 'UPDATE' then
    if new.estado is distinct from 'cancelada' or old.estado = 'cancelada' then
      return new;
    end if;
    v_tipo := 'reserva_cancelada';
    v_titulo := 'Reserva cancelada';
  else
    return new;
  end if;

  v_detalle := coalesce(nullif(btrim(new.nombre), ''), 'Cliente') || ' · ' ||
    to_char(new.fecha, 'DD/MM') || ' ' || to_char(new.hora, 'HH24:MI') || ' · ' ||
    new.numero_comensales || ' pers.' ||
    case new.canal
      when 'web' then ' · web'
      when 'telefono' then ' · teléfono'
      when 'manual' then ' · manual'
      when 'presencial' then ' · en local'
      else ''
    end ||
    -- 16/11/2026: quién la canceló (lo acaba de apuntar trg_reservas_cancelada_por, que es BEFORE).
    case
      when v_tipo = 'reserva_cancelada' and new.cancelada_por = 'cliente' then ' · la canceló el cliente'
      when v_tipo = 'reserva_cancelada' and new.cancelada_por = 'restaurante' then ' · la canceló el restaurante'
      else ''
    end;

  -- Un aviso nunca debe impedir guardar la reserva.
  begin
    insert into public.notificaciones_dashboard (tipo, titulo, mensaje, referencia_id, referencia_tipo, prioridad)
    values (v_tipo, v_titulo, v_detalle, new.id, 'reserva', 'normal');
  exception when others then
    raise warning 'fn_aviso_reserva_nueva_cancelada: no se pudo crear el aviso (%)', sqlerrm;
  end;
  return new;
end;
$$;

revoke all on function public.fn_aviso_reserva_nueva_cancelada() from public, anon, authenticated;

notify pgrst, 'reload schema';
commit;
