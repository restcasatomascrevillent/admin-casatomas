set client_encoding = 'UTF8';
-- ===========================================================================
-- COMIDAS DE LOS JUEVES CON RESERVA WEB (dueño, 21/11/2026)
-- ===========================================================================
-- Petición: «Abre todas las comidas de los jueves para que puedan reservar por
-- web […] y a partir de hoy también; las cenas se quedan como están».
--
-- QUÉ HACE
--   · Regla semanal `configuracion_reservas.dias_cerrados_comida`: quita el
--     jueves (4). Desde que se aplica, la web y el bot telefónico ofrecen las
--     comidas del jueves (periodo «Comida» de `configuracion_turnos`, que ya
--     incluía el jueves) con la misma regla que el resto de días: aforo,
--     menú del día de martes a jueves, grupos de 8 o más por teléfono…
--   · NO toca `dias_cerrados_cena`: la cena del jueves de tapas (turnos fijos
--     20:30 y 22:00, 20261122200100) sigue sin reserva web.
--   · NO toca `dias_abiertos_sin_reserva_online` ({4}): el panel sigue diciendo
--     «Sin reservas web (el restaurante abre)» en la cena del jueves.
--   · NO toca `cierres_reserva`: un jueves cerrado a mano sigue cerrado, y las
--     aperturas que ya había (7 y 14/01/2027) se quedan (ya no hacen falta,
--     pero no estorban y la vuelta atrás las necesita).
--   · Ni código ni funciones: la regla la lee la RPC `servicios_cerrados_reserva`,
--     la misma para la web (reservas-web), el bot y el panel. La regla POR
--     DEFECTO escrita en código (`_shared/cierres.ts`, web y bot) solo es el
--     respaldo si la base de datos no responde y se queda como estaba (más
--     prudente: sin reservas).
--
-- Idempotente (si el jueves ya no está, no hace nada). Vuelta atrás:
--   supabase/rollbacks/20261214100000_jueves_comida_reserva_web_ROLLBACK.sql
-- Prueba (PGlite): npm run test:jueves-comida-web:db
-- ===========================================================================
begin;
set local lock_timeout = '5s';

do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'configuracion_reservas'
      and column_name = 'dias_cerrados_comida'
  ) then
    raise exception 'Falta la migración 20261013120000_cierres_reserva.sql (dias_cerrados_comida no existe): aplíquela antes.';
  end if;
end $$;

update public.configuracion_reservas
   set dias_cerrados_comida = array_remove(dias_cerrados_comida, 4)
 where 4 = any (dias_cerrados_comida);

commit;
