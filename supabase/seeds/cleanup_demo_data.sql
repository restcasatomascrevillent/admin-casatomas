-- =====================================================================
-- Casa Tomas / Touza - borrado de los datos de DEMOSTRACION del panel admin
--
-- Borra EXCLUSIVAMENTE las filas creadas por seed_demo_data.sql, identificadas
-- por el marcador '[DEMO-SEED]' al principio de reservas.notas_cliente.
-- Ese marcador no puede aparecer nunca en un dato real: no es un valor que un
-- cliente real escribiria ni que la aplicacion genere por si sola.
--
-- Este script YA NO toca trabajadores, turnos (los de personal) ni
-- registro_horas: la seccion Personal se retiro del panel (commit a24b5b5) y
-- seed_demo_data.sql dejo de crear personal ficticio para alimentarla. Ver
-- README.md de esta carpeta, seccion "Que ya no crea (y por que)". Esto NO
-- afecta a configuracion_turnos (la escalera comida/cena de las reservas):
-- ese sistema es independiente y este script nunca lo ha tocado.
--
-- OJO - ocupacion_diaria SI necesita limpieza aparte (bug real, descubierto al
-- probar este script, no provocado por nosotros):
-- El trigger trigger_actualizar_ocupacion (AFTER INSERT/UPDATE/DELETE FOR EACH ROW
-- en reservas, funcion actualizar_ocupacion_diaria_espacios()) recalcula la fila
-- de ocupacion_diaria para (fecha,hora) releyendo reservas y luego intenta borrar
-- esa fila "SI total_reservas=0". Pero los triggers AFTER ROW en Postgres se
-- disparan al final de la sentencia, cuando TODAS las filas ya se han borrado de
-- la tabla -- asi que su propio SELECT...GROUP BY ya no encuentra ninguna fila,
-- el INSERT...SELECT no inserta ni actualiza nada (un GROUP BY sobre cero filas
-- no genera una fila con total_reservas=0, simplemente no genera fila), y el
-- DELETE ... WHERE total_reservas=0 nunca encuentra esa condicion porque la fila
-- existente se queda con su total_reservas ANTERIOR (nunca se pone a 0). Resultado:
-- borrar reservas de golpe (o incluso una a una) deja basura en ocupacion_diaria.
-- Esto es un bug preexistente del trigger, no algo introducido por este seed, y
-- NO se toca aqui la funcion/trigger (fuera de nuestro territorio: solo ficheros
-- nuevos en supabase/seeds/, cero migraciones). En su lugar, este script limpia
-- el resultado a mano: borra de ocupacion_diaria cualquier fila cuyo (fecha,hora)
-- ya no tenga NINGUNA reserva real (huerfana), acotado al rango de fechas que
-- pudo tocar el seed (2026-08-26 a 2026-10-09) para no rozar nada fuera de ese
-- rango.
--
-- OJO -- este rango es literal, igual que TODAY lo era en gen_seed.js antes de este
-- cambio: hay que volver a actualizarlo a mano (aqui y en la "Verificacion rapida" de
-- mas abajo) cada vez que se regenere el seed con otro "hoy", copiando fecha_min/
-- fecha_max del resumen que imprime "node gen_seed.js" por stdout. No se ha
-- automatizado en este cambio (no formaba parte del encargo y tocar la logica de
-- borrado de produccion sin poder probarla a fondo pareció mas riesgo que beneficio);
-- queda anotado como posible mejora futura.
--
-- NUNCA ejecutar este script (ni seed_demo_data.sql) contra una base con datos
-- reales de clientes. Ver README.md de esta carpeta.
-- =====================================================================

BEGIN;

DELETE FROM public.reservas        WHERE notas_cliente LIKE '[DEMO-SEED]%';

-- Parche del bug de autolimpieza descrito arriba: borra las filas de
-- ocupacion_diaria que el trigger dejo huerfanas, solo dentro del rango de
-- fechas del seed y solo si de verdad no queda ninguna reserva para ese
-- (fecha,hora) -- reales o de demo, da igual el origen.
DELETE FROM public.ocupacion_diaria od
WHERE od.fecha BETWEEN '2026-08-26' AND '2026-10-09'  -- ver aviso arriba: actualizar en cada regeneracion del seed
  AND NOT EXISTS (
    SELECT 1 FROM public.reservas r WHERE r.fecha = od.fecha AND r.hora = od.hora
  );

COMMIT;

-- Verificacion rapida (deberia devolver 0 filas en las dos):
-- SELECT 'reservas' t, count(*) FROM public.reservas WHERE notas_cliente LIKE '[DEMO-SEED]%'
-- UNION ALL SELECT 'ocupacion_diaria_huerfana', count(*) FROM public.ocupacion_diaria od
--   WHERE od.fecha BETWEEN '2026-08-26' AND '2026-10-09'
--   AND NOT EXISTS (SELECT 1 FROM public.reservas r WHERE r.fecha=od.fecha AND r.hora=od.hora);
