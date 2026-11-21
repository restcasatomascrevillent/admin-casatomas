set client_encoding = 'UTF8';
-- ROLLBACK de 20261213050000_avisos_sin_reserva_confirmada.sql (avisos de Reservas).
-- Aplicar a mano SOLO si hay que deshacerlo. Vuelve a `fn_aviso_reserva_nueva_cancelada` de
-- 20261212720000 (copia literal): el cliente que confirma con el enlace del correo vuelve a crear el
-- aviso verde «Confirmada por el cliente». Los avisos verdes que la migración dio por revisados siguen
-- revisados (no se sabe cuáles estaban sin revisar antes). El panel nuevo no los enseña en Reservas ›
-- Avisos: para verlos ahí, revertir también su cambio.
begin;
set local lock_timeout = '5s';

-- Función de 20261212720000_avisos_reserva_confirmada_cliente.sql (copia literal).
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
    -- 18/11/2026: la «Reserva nueva» es para verificarla. Si deja de estar pendiente, ya no hay nada que
    -- verificar: sus avisos sin revisar quedan revisados. Nunca impide guardar la reserva.
    if old.estado = 'pendiente' and new.estado is distinct from 'pendiente' then
      begin
        update public.notificaciones_dashboard
           set leida = true
         where tipo = 'reserva_nueva'
           and referencia_tipo = 'reserva'
           and referencia_id = new.id
           and leida = false;
      exception when others then
        raise warning 'fn_aviso_reserva_nueva_cancelada: no se pudo revisar el aviso de reserva nueva (%)', sqlerrm;
      end;
    end if;

    if new.estado = 'cancelada' and old.estado is distinct from 'cancelada' then
      v_tipo := 'reserva_cancelada';
      v_titulo := 'Reserva cancelada';
    elsif new.estado = 'confirmada' and old.estado is distinct from 'confirmada'
      and auth.uid() is null and auth.role() = 'service_role' then
      -- 18/11/2026: la ha confirmado el cliente (enlace del correo; misma regla que cancelada_por).
      v_tipo := 'reserva_confirmada';
      v_titulo := 'Confirmada por el cliente';
    else
      return new;
    end if;
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

do $$ begin raise notice 'avisos_sin_reserva_confirmada: deshecha'; end $$;

commit;
