-- =====================================================================
-- Casa Tomas / Touza - borrado de los datos de DEMOSTRACION del panel admin
--
-- Borra EXCLUSIVAMENTE las filas creadas por seed_demo_data.sql, identificadas
-- por el marcador '[DEMO-SEED]' al principio de un campo de texto libre en
-- cada tabla (notas_cliente en reservas, notas en trabajadores/turnos/registro_horas).
-- Ese marcador no puede aparecer nunca en un dato real: no es un valor que un
-- cliente o un empleado real escribirian ni que la aplicacion genere por si sola.
--
-- Orden de borrado: primero las tablas "hijas" de trabajadores (registro_horas,
-- turnos) y despues trabajadores. En realidad hay FKs ON DELETE CASCADE desde
-- turnos.trabajador_id y registro_horas.trabajador_id hacia trabajadores.id, asi
-- que borrar trabajadores ya arrastraria sus turnos/registro_horas -- pero aqui
-- se hace explicito, fila a fila por marcador, para que este script sea
-- autocontenido y no dependa silenciosamente de esa cascada si el esquema cambia.
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
-- pudo tocar el seed (2026-08-24 a 2026-10-07) para no rozar nada fuera de ese
-- rango.
--
-- NUNCA ejecutar este script (ni seed_demo_data.sql) contra una base con datos
-- reales de clientes o personal. Ver README.md de esta carpeta.
-- =====================================================================

BEGIN;

DELETE FROM public.registro_horas WHERE notas LIKE '[DEMO-SEED]%';
DELETE FROM public.turnos          WHERE notas LIKE '[DEMO-SEED]%';
DELETE FROM public.trabajadores    WHERE notas LIKE '[DEMO-SEED]%';
DELETE FROM public.reservas        WHERE notas_cliente LIKE '[DEMO-SEED]%';

-- Parche del bug de autolimpieza descrito arriba: borra las filas de
-- ocupacion_diaria que el trigger dejo huerfanas, solo dentro del rango de
-- fechas del seed y solo si de verdad no queda ninguna reserva para ese
-- (fecha,hora) -- reales o de demo, da igual el origen.
DELETE FROM public.ocupacion_diaria od
WHERE od.fecha BETWEEN '2026-08-24' AND '2026-10-07'
  AND NOT EXISTS (
    SELECT 1 FROM public.reservas r WHERE r.fecha = od.fecha AND r.hora = od.hora
  );

COMMIT;

-- Verificacion rapida (deberia devolver 0 filas en las cinco):
-- SELECT 'reservas' t, count(*) FROM public.reservas WHERE notas_cliente LIKE '[DEMO-SEED]%'
-- UNION ALL SELECT 'trabajadores', count(*) FROM public.trabajadores WHERE notas LIKE '[DEMO-SEED]%'
-- UNION ALL SELECT 'turnos', count(*) FROM public.turnos WHERE notas LIKE '[DEMO-SEED]%'
-- UNION ALL SELECT 'registro_horas', count(*) FROM public.registro_horas WHERE notas LIKE '[DEMO-SEED]%'
-- UNION ALL SELECT 'ocupacion_diaria_huerfana', count(*) FROM public.ocupacion_diaria od
--   WHERE od.fecha BETWEEN '2026-08-24' AND '2026-10-07'
--   AND NOT EXISTS (SELECT 1 FROM public.reservas r WHERE r.fecha=od.fecha AND r.hora=od.hora);
