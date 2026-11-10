-- Vuelta atrás de 20261122160000_avisos_reservas_nuevas_canceladas.sql
drop trigger if exists trg_aviso_reserva_nueva on public.reservas;
drop trigger if exists trg_aviso_reserva_cancelada on public.reservas;
drop function if exists public.fn_aviso_reserva_nueva_cancelada();
-- Los avisos ya creados se quedan (son historial); para borrarlos:
-- delete from public.notificaciones_dashboard where tipo in ('reserva_nueva', 'reserva_cancelada') and referencia_tipo = 'reserva';
