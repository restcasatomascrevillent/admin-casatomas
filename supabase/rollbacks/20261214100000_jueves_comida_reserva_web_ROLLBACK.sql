set client_encoding = 'UTF8';
-- ===========================================================================
-- VUELTA ATRÁS de 20261214100000_jueves_comida_reserva_web.sql
-- ===========================================================================
-- Vuelve a dejar las comidas del jueves sin reserva web (el jueves otra vez en
-- `configuracion_reservas.dias_cerrados_comida`). Las aperturas a mano de
-- `cierres_reserva` (p. ej. 7 y 14/01/2027) siguen mandando, como antes.
-- Las reservas que ya se hayan hecho por la web un jueves a mediodía NO se
-- tocan. Idempotente.
-- ===========================================================================
begin;
set local lock_timeout = '5s';

update public.configuracion_reservas
   set dias_cerrados_comida = (
         select array_agg(d order by d)
           from unnest(array_append(dias_cerrados_comida, 4)) as d
       )
 where not (4 = any (dias_cerrados_comida));

commit;
