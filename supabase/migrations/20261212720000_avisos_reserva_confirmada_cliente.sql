set client_encoding = 'UTF8';
-- ===========================================================================
-- 20261212720000_avisos_reserva_confirmada_cliente — avisos de Reservas: solo lo que hay que mirar (18/11/2026)
-- ===========================================================================
-- Petición del dueño: «En avisos solo tienen que salir las canceladas (rojo), las nuevas para
-- verificar (azul) y las que confirme luego el cliente (verdes)».
--
-- QUÉ HACE
--   1. Aviso nuevo `reserva_confirmada` («Confirmada por el cliente»): cuando el CLIENTE confirma
--      su reserva con el enlace del correo (reservas-web › confirmar: verificada → confirmada con la
--      clave de servicio). Misma regla que `cancelada_por` (20261205100200): sin usuario del panel
--      (auth.uid() nulo) y con la clave de servicio (auth.role() = 'service_role'). Confirmarla desde
--      el panel o con SQL a mano NO avisa (no hay nada que contar al personal).
--   2. «Reserva nueva» = reserva por verificar: en cuanto la reserva deja de estar 'pendiente'
--      (verificada, confirmada, cancelada… desde donde sea: ficha, Lista, bot, SQL), sus avisos
--      «Reserva nueva» sin revisar pasan a revisados. Así en «Sin revisar» solo quedan en azul las que
--      de verdad hay que verificar.
--   3. Las «Reserva nueva» que ya estaban sin revisar con la reserva fuera de 'pendiente' (o borrada)
--      se dan por revisadas ahora (una vez).
--   4. `seccion_aviso` lleva `reserva_confirmada` a la sección Reservas (quién lo ve y quién lo puede
--      marcar como revisado, igual que los demás avisos de reservas). Parte de la versión de
--      20261212100000_avisos_solo_su_seccion (#293: cada aviso solo para quien ve su sección; lo que no
--      tiene sección, solo el super admin) y solo añade `reserva_confirmada`. Por eso va DESPUÉS de
--      ella: con la lista anterior (resto → 'dashboard') desharía ese arreglo.
--   El resto de `fn_aviso_reserva_nueva_cancelada` es idéntico a 20261205100200.
--
-- TRIGGERS: los mismos de 20261122160000 (`trg_aviso_reserva_nueva` AFTER INSERT y
-- `trg_aviso_reserva_cancelada` AFTER UPDATE OF estado), que ya llaman a esta función.
--
-- PERMISOS: no cambian. La función sigue siendo SECURITY DEFINER sin EXECUTE para nadie.
--
-- ORDEN DE DESPLIEGUE: da igual. El panel sin ella no recibe avisos verdes y oculta él mismo las
-- «Reserva nueva» que ya no están pendientes; sin el panel nuevo, los avisos verdes salen en la
-- campana y el Dashboard pero no en Reservas › Avisos.
--
-- APLICAR (nunca `db push`): demo primero (sfonaclosuafvlhutkon), producción (haqmmdfdzzatdnrrcgez)
-- solo con el «sí» del dueño. Idempotente.
-- Deshacer: supabase/rollbacks/20261212720000_avisos_reserva_confirmada_cliente_ROLLBACK.sql
-- Pruebas: npm run test:avisos-confirmada:db (PGlite).
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

-- «Confirmada por el cliente» es un aviso de Reservas (copia de 20261129100000 con ese tipo añadido).
create or replace function public.seccion_aviso(p_tipo text)
returns text
language sql
immutable
set search_path = public
as $$
  select case
    when p_tipo in (
      'reserva_nueva', 'reserva_cancelada', 'reserva_confirmada', 'reserva_sin_asignar', 'solicitud_pendiente',
      'propuesta_aceptada', 'propuesta_rechazada', 'propuesta_fallida',
      'email_fallido', 'mesa_borrada_con_asignaciones'
    ) then 'reservas'
    when p_tipo like 'facturas\_%' or p_tipo in ('subida_precio', 'original_sin_drive') then 'facturas'
    when p_tipo like 'instagram\_%' then 'marketing'
    else 'solo_super_admin'
  end
$$;
revoke all on function public.seccion_aviso(text) from public, anon;
grant execute on function public.seccion_aviso(text) to authenticated, service_role;

-- Las «Reserva nueva» sin revisar cuya reserva ya no está pendiente (o ya no existe): revisadas.
update public.notificaciones_dashboard n
   set leida = true
 where n.tipo = 'reserva_nueva'
   and n.referencia_tipo = 'reserva'
   and n.leida = false
   and not exists (
     select 1 from public.reservas r where r.id = n.referencia_id and r.estado = 'pendiente'
   );

notify pgrst, 'reload schema';
commit;

-- Comprobar (en la demo, después):
--   select tipo, count(*) from notificaciones_dashboard where not leida and tipo like 'reserva\_%' group by 1;
--   select public.seccion_aviso('reserva_confirmada');  -- reservas
