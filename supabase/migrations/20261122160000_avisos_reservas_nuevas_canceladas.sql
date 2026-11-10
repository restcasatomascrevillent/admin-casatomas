-- Avisos de Reservas: reservas nuevas y canceladas (10/11/2026, petición del dueño).
-- «Lo de avisos quiero que salgan ahí las reservas nuevas y las canceladas; el sistema de avisos
-- tiene que ser ese». Hasta ahora ningún disparador creaba avisos `reserva_nueva`, y no existía
-- `reserva_cancelada`.
--
-- - Reserva nueva: al INSERTAR una reserva hecha por el cliente (canal web o teléfono). Las que
--   apunta el propio equipo (manual, presencial) no avisan: ya las sabe quien las crea.
-- - Reserva cancelada: cuando `estado` pasa a 'cancelada', venga de donde venga.
--
-- Vuelta atrás: supabase/rollbacks/20261122160000_avisos_reservas_nuevas_canceladas_ROLLBACK.sql

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

drop trigger if exists trg_aviso_reserva_nueva on public.reservas;
create trigger trg_aviso_reserva_nueva
  after insert on public.reservas
  for each row execute function public.fn_aviso_reserva_nueva_cancelada();

drop trigger if exists trg_aviso_reserva_cancelada on public.reservas;
create trigger trg_aviso_reserva_cancelada
  after update of estado on public.reservas
  for each row execute function public.fn_aviso_reserva_nueva_cancelada();
