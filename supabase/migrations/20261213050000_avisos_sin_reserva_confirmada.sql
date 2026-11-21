set client_encoding = 'UTF8';
-- ===========================================================================
-- 20261213050000_avisos_sin_reserva_confirmada — avisos de Reservas: solo por verificar y canceladas (20/11/2026)
-- ===========================================================================
-- Petición (CAS-24, Pablo, 20/11/2026): «Quitar avisos reservas confirmadas, que cuando un usuario
-- confirme la reserva, que no llegue a avisos de reservas, ahí solo tienen que llegar para verificar y
-- las canceladas». Deshace la parte verde de 20261212720000 (18/11/2026), que creaba el aviso
-- `reserva_confirmada` («Confirmada por el cliente») cuando el cliente confirmaba con el enlace del correo.
--
-- QUÉ HACE
--   1. `fn_aviso_reserva_nueva_cancelada` deja de crear `reserva_confirmada`. El resto es idéntico a
--      20261212720000: «Reserva nueva» al entrar una reserva web/teléfono, «Reserva cancelada» al
--      cancelarla, y la «Reserva nueva» sin revisar se da por revisada cuando la reserva deja de estar
--      pendiente (verificada, confirmada, cancelada…).
--   2. Los avisos «Confirmada por el cliente» que quedaban sin revisar pasan a revisados (una vez). No se
--      borran: siguen en el historial de la campana.
--   `seccion_aviso('reserva_confirmada')` sigue diciendo 'reservas' (para los avisos viejos).
--
-- TRIGGERS Y PERMISOS: los mismos (la función sigue SECURITY DEFINER sin EXECUTE para nadie).
-- ORDEN DE DESPLIEGUE: da igual. El panel nuevo ya no enseña «Confirmadas por el cliente» en Reservas ›
-- Avisos; el viejo, sin avisos verdes nuevos, simplemente no tiene ninguno que enseñar.
--
-- APLICAR (nunca `db push`): demo primero (sfonaclosuafvlhutkon), producción (haqmmdfdzzatdnrrcgez)
-- solo con el «sí» del dueño. Idempotente. Tiene que terminar en «avisos_sin_reserva_confirmada: aplicada».
-- Deshacer: supabase/rollbacks/20261213050000_avisos_sin_reserva_confirmada_ROLLBACK.sql
-- Pruebas: npm run test:avisos-sin-confirmada:db (PGlite).
-- ===========================================================================
begin;
set local lock_timeout = '5s';

do $$
begin
  if to_regprocedure('public.fn_aviso_reserva_nueva_cancelada()') is null then
    raise exception 'avisos_sin_reserva_confirmada: falta 20261122160000_avisos_reservas_nuevas_canceladas.sql. No se ha cambiado nada.';
  end if;
end;
$$;

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
    -- 20/11/2026 (CAS-24): ya no hay aviso «Confirmada por el cliente». En avisos de reservas solo las
    -- que hay que verificar (azul) y las canceladas (rojo).
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

-- Los verdes que quedaban sin revisar: revisados (no se borran).
update public.notificaciones_dashboard
   set leida = true
 where tipo = 'reserva_confirmada'
   and leida = false;

do $$ begin raise notice 'avisos_sin_reserva_confirmada: aplicada'; end $$;

commit;
