set client_encoding = 'UTF8';
-- ROLLBACK de 20261205100200_reservas_cancelada_por.sql. Aplicar a mano SOLO si
-- hay que deshacerlo.
--
-- BORRA DATOS: se pierde quién y cuándo canceló cada reserva (el estado
-- 'cancelada' no se toca). El panel y las Edge Functions siguen funcionando
-- sin las columnas (el panel deja de decir quién canceló).
begin;
set local lock_timeout = '5s';

-- El aviso «Reserva cancelada», como en 20261122160000 (sin quién canceló).
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

drop trigger if exists trg_reservas_cancelada_por on public.reservas;
drop function if exists public.fn_reservas_cancelada_por();
alter table public.reservas drop constraint if exists reservas_cancelada_por_check;
alter table public.reservas
  drop column if exists cancelada_por,
  drop column if exists cancelada_at;

notify pgrst, 'reload schema';
commit;
