-- ===========================================================================
-- ##                                                                       ##
-- ##                          NO APLICADA                                  ##
-- ##                                                                       ##
-- ##   Este fichero NO se ha ejecutado contra ninguna base de datos.        ##
-- ##   Queda preparado para que el dueño lo revise y decida.                ##
-- ##   Es aditiva (un unico INSERT, protegido con WHERE NOT EXISTS) y no    ##
-- ##   reescribe ninguna fila existente, pero aun asi debe aplicarse de     ##
-- ##   forma consciente.                                                   ##
-- ##                                                                       ##
-- ===========================================================================
--
-- CONTEXTO (tarea: "El Reservado pasa a ser solicitud+contraoferta, no
-- insert directo" — sesion sobre touza-restaurant-website)
--
-- `espacios_reserva` (adminpanelct/supabase/migrations/20251114070455_...sql)
-- modela los espacios del RESTAURANTE Casa Tomas: 'Salon' (50), 'Comedor'
-- (40), 'Terraza' (30) — ver 20251120060028_...sql. "El Reservado", el
-- espacio privado de TOUZA (hasta 20 personas, src/pages/Reservado.tsx),
-- nunca tuvo fila aqui: su formulario web siempre insento directamente en
-- `reservas` sin `espacio_id` (columna NULL). Verificado por grep de
-- "Reservado"/"espacios_reserva" en las migraciones y en
-- touza-restaurant-website/src — ninguna referencia previa.
--
-- Consecuencia practica: la Edge Function `reservas-web` (`/crear`, ver
-- adminpanelct/supabase/functions/reservas-web/index.ts:1094,1302-1307) SI
-- acepta pedir un espacio concreto por `espacio_id` o por nombre (`sala`),
-- pero para "El Reservado" esos campos no tenian ninguna fila real a la que
-- apuntar — usarlos antes de esta migracion habria devuelto
-- `{error:"espacio_invalido"}` (400) en vez de identificar el espacio.
--
-- QUE HACE ESTA MIGRACION Y QUE NO
--   SI: da de alta la fila 'El Reservado' en `espacios_reserva`, para que
--       algo pueda referenciarla por id.
--   NO: no toca RLS ni permisos — `espacios_reserva` ya es de lectura
--       publica (`espacios_reserva ACTIVE... auth.uid() IS NOT NULL` solo
--       para escritura, ver 20251114070455_...sql) y esto es una fila mas.
--   NO: no modifica reservas-web/index.ts para que Reservado.tsx EMPIECE a
--       enviar `espacio_id`/`sala` — el frontend reescrito en esta sesion
--       sigue sin enviarlo, A PROPOSITO: acoplar el codigo del formulario a
--       que esta migracion ya este aplicada habria roto en produccion toda
--       solicitud de El Reservado con 12 personas o menos (las de mas de
--       12 no llegan a mirar `espacio_id`: la funcion las corta antes, en
--       el motivo `grupo_grande`) si el dueno tarda en aplicarla. En su
--       lugar, Reservado.tsx marca el espacio pedido en `notas_cliente`
--       (texto libre), que no depende de nada de esto.
--
-- SI EL DUEÑO QUIERE APROVECHAR ESTA FILA DE VERDAD, falta ademas (fuera
-- del alcance de esta sesion, decision de producto, no solo de codigo):
--   1. Que Reservado.tsx empiece a mandar `sala: "El Reservado"` (o el id
--      de abajo) en el POST a `/crear`.
--   2. Decidir que pasa con la validacion de hora del motor de
--      disponibilidad para una solicitud de El Reservado de 12 personas o
--      menos (no corta por `grupo_grande`): hoy exige que la hora
--      coincida con un hueco YA CALCULADO por `calcularDisponibilidad`
--      (pensado para mesas normales), lo que podria rechazar una hora de
--      evento perfectamente razonable con "sin_disponibilidad". Ver
--      informe de la tarea, seccion "que quedo sin hacer".
--   3. Las 4 plantillas de correo de reservas-web (tplSolicitudRecibida y
--      las otras 3, mismo fichero) estan literalmente escritas con la
--      marca "Casa Tomas" (nombre, direccion, telefono). Un cliente de
--      Touza que reserve El Reservado hoy recibe -y seguira recibiendo
--      tras esta migracion, que no toca esto- un correo con la marca
--      equivocada. Esta fila no resuelve eso: la funcion no tiene ningun
--      concepto de "marca" por el que ramificar que plantilla usar.
-- ===========================================================================

insert into public.espacios_reserva (nombre, descripcion, capacidad_maxima, activa, caracteristicas)
select
  'El Reservado',
  'Espacio privado de Touza (Crevillente) para eventos: cumpleaños, cenas y reuniones. Hasta 20 personas.',
  20,
  true,
  '{"privada": true, "marca": "touza"}'::jsonb
where not exists (
  select 1 from public.espacios_reserva where nombre = 'El Reservado'
);
