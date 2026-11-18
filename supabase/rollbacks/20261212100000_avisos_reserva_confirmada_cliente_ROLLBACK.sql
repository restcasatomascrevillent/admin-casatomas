set client_encoding = 'UTF8';
-- ===========================================================================
-- ROLLBACK de 20261212100000_avisos_reserva_confirmada_cliente
-- ===========================================================================
-- Deja `fn_aviso_reserva_nueva_cancelada` como en 20261205100200 (sin aviso «Confirmada por el
-- cliente» y sin revisar sola la «Reserva nueva» al verificarla) y `seccion_aviso` como en
-- 20261129100000. Los avisos `reserva_confirmada` que ya existan se quedan (pasan a la sección
-- Dashboard). Las «Reserva nueva» que la migración dio por revisadas siguen revisadas: era lo
-- correcto (su reserva ya no estaba pendiente). Idempotente.
-- ===========================================================================
begin;
set local lock_timeout = '5s';

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

create or replace function public.seccion_aviso(p_tipo text)
returns text
language sql
immutable
set search_path = public
as $$
  select case
    when p_tipo in ('reserva_nueva', 'reserva_cancelada', 'reserva_sin_asignar', 'solicitud_pendiente') then 'reservas'
    when p_tipo like 'facturas\_%' or p_tipo in ('subida_precio', 'original_sin_drive') then 'facturas'
    when p_tipo like 'peticion\_%' then 'solo_super_admin'
    else 'dashboard'
  end
$$;
revoke all on function public.seccion_aviso(text) from public, anon;
grant execute on function public.seccion_aviso(text) to authenticated, service_role;

notify pgrst, 'reload schema';
commit;
