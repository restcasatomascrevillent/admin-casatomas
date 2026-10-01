-- =============================================================================
-- DEMO OCTUBRE 2026 - reservas CONFIRMADAS de demostración, SOLO CASA TOMÁS
-- =============================================================================
-- GENERADO con: node gen_demo_reservas_octubre.js --sin-telefono
-- (supabase/seeds/gen_demo_reservas_octubre.js, semilla 20261001, perfil "seguro").
-- No editar a mano: regenerar.
--
-- QUÉ CREA (solo filas en public.reservas):
--   861 reservas de Casa Tomás, 3959 comensales, del 2026-10-02 (viernes) al 2026-10-31.
--   HOY (2026-10-01) queda fuera a propósito. Touza: ninguna (no admite reservas).
--   Todas con estado 'confirmada', marca 'casa_tomas' y espacio_id NULL (sin sala; la sala y
--   las mesas las asigna el personal), email NULL, telefono NULL,
--   en_blacklist y consentimiento_newsletter false, y sin asignaciones_mesa.
--   Marca: notas_cliente empieza por '[DEMO-SEED][oct-2026]'. Lleva [DEMO-SEED], el marcador que
--   ya excluyen la campana «reserva sin asignar» y el recordatorio T-2.
--
-- EFECTOS AUTOMÁTICOS DE LA BD:
--   · trg_validar_capacidad valida el aforo fila a fila; si algo no cupiera, aborta TODO.
--   · trigger_actualizar_ocupacion recalcula public.ocupacion_diaria (dato derivado).
--   · El cron emails-reserva-detectar-ausencias (04:00 UTC) pasará cada noche a 'no_show'
--     las del día anterior que nadie marque «Llegó». No crea sugerencias de lista negra: sin
--     teléfono ni email se las salta.
--
-- APLICAR (desde adminpanelct/, hoy o como muy tarde el viernes por la mañana):
--   npx supabase db query --linked -f supabase/seeds/20261001_demo_reservas_octubre.sql
--   Es todo o nada. Antes de insertar comprueba en vivo que la marca no está aplicada, que el
--   aforo deja un margen >= 3 %, que octubre queda bajo max_rows (1000)
--   y la fecha. Si algo falla, no escribe nada. Un 55P03 (lock_timeout) tampoco escribe
--   nada: reintentar. La salida es la tabla de verificación.
--
-- LIMPIAR:
--   npx supabase db query --linked -f supabase/seeds/20261001_demo_reservas_octubre_LIMPIEZA.sql
--   OJO: el cleanup_demo_data.sql antiguo (LIKE '[DEMO-SEED]%') TAMBIÉN borraría estas reservas.
--
-- PERFIL COMPLETO DEL ENCARGO: cuando esté desplegada la paginación del calendario
-- (o subido "Max rows" de la API), regenerar con:
--   node gen_demo_reservas_octubre.js --sin-telefono --perfil completo --max-rows 2000
-- =============================================================================

set client_encoding = 'UTF8';
begin;
set local lock_timeout = '5s';

-- 0) Comprobaciones en vivo: si alguna falla, RAISE y no se escribe nada.
do $precheck$
declare
  v_aforo      integer;
  v_conflictos text;
  v_filas_oct  integer;
begin
  if (now() at time zone 'Europe/Madrid')::date > date '2026-10-02' then
    raise exception 'Demo caducada: el viernes 2026-10-02 ya ha pasado. Regenerar con otras fechas.';
  end if;
  if exists (select 1 from public.reservas where notas_cliente like '[DEMO-SEED][oct-2026]%') then
    raise exception 'La demo de octubre YA está aplicada (hay filas con la marca [DEMO-SEED][oct-2026]). Limpia antes con la LIMPIEZA.';
  end if;

  -- Aforo de Casa Tomás: el mismo cálculo que validar_capacidad_reserva (salas activas del negocio).
  select coalesce(sum(capacidad_maxima), 0) into v_aforo
    from public.espacios_reserva
   where activa and coalesce(caracteristicas->>'marca', 'casa_tomas') = 'casa_tomas';

  -- Vivas ahora (pendiente/verificada/confirmada) + demo <= 97 % del aforo en cada turno.
  select string_agg(format('%s %s: %s+%s > %s', d.fecha, d.turno, e.pax, d.pax, floor(v_aforo * 0.97)), '; ')
    into v_conflictos
    from (values
      ('2026-10-02'::date, 'cena', 134),
      ('2026-10-02'::date, 'comida', 144),
      ('2026-10-03'::date, 'cena', 128),
      ('2026-10-03'::date, 'comida', 145),
      ('2026-10-04'::date, 'cena', 29),
      ('2026-10-04'::date, 'comida', 118),
      ('2026-10-05'::date, 'cena', 41),
      ('2026-10-05'::date, 'comida', 41),
      ('2026-10-06'::date, 'cena', 37),
      ('2026-10-06'::date, 'comida', 35),
      ('2026-10-07'::date, 'cena', 38),
      ('2026-10-07'::date, 'comida', 47),
      ('2026-10-08'::date, 'cena', 58),
      ('2026-10-08'::date, 'comida', 45),
      ('2026-10-09'::date, 'cena', 140),
      ('2026-10-09'::date, 'comida', 136),
      ('2026-10-10'::date, 'cena', 158),
      ('2026-10-10'::date, 'comida', 147),
      ('2026-10-11'::date, 'cena', 77),
      ('2026-10-11'::date, 'comida', 144),
      ('2026-10-12'::date, 'cena', 94),
      ('2026-10-12'::date, 'comida', 152),
      ('2026-10-13'::date, 'cena', 23),
      ('2026-10-13'::date, 'comida', 27),
      ('2026-10-14'::date, 'cena', 26),
      ('2026-10-14'::date, 'comida', 26),
      ('2026-10-15'::date, 'cena', 41),
      ('2026-10-15'::date, 'comida', 35),
      ('2026-10-16'::date, 'cena', 133),
      ('2026-10-16'::date, 'comida', 110),
      ('2026-10-17'::date, 'cena', 136),
      ('2026-10-17'::date, 'comida', 119),
      ('2026-10-18'::date, 'cena', 23),
      ('2026-10-18'::date, 'comida', 111),
      ('2026-10-19'::date, 'cena', 14),
      ('2026-10-19'::date, 'comida', 17),
      ('2026-10-20'::date, 'cena', 13),
      ('2026-10-20'::date, 'comida', 17),
      ('2026-10-21'::date, 'cena', 17),
      ('2026-10-21'::date, 'comida', 17),
      ('2026-10-22'::date, 'cena', 24),
      ('2026-10-22'::date, 'comida', 22),
      ('2026-10-23'::date, 'cena', 102),
      ('2026-10-23'::date, 'comida', 85),
      ('2026-10-24'::date, 'cena', 109),
      ('2026-10-24'::date, 'comida', 88),
      ('2026-10-25'::date, 'cena', 17),
      ('2026-10-25'::date, 'comida', 87),
      ('2026-10-26'::date, 'cena', 10),
      ('2026-10-26'::date, 'comida', 12),
      ('2026-10-27'::date, 'cena', 10),
      ('2026-10-27'::date, 'comida', 12),
      ('2026-10-28'::date, 'cena', 12),
      ('2026-10-28'::date, 'comida', 14),
      ('2026-10-29'::date, 'cena', 19),
      ('2026-10-29'::date, 'comida', 15),
      ('2026-10-30'::date, 'cena', 88),
      ('2026-10-30'::date, 'comida', 70),
      ('2026-10-31'::date, 'cena', 95),
      ('2026-10-31'::date, 'comida', 75)
    ) as d(fecha, turno, pax)
    cross join lateral (
      select coalesce(sum(r.numero_comensales), 0) as pax
        from public.reservas r
       where r.fecha = d.fecha
         and coalesce(r.marca, 'casa_tomas') = 'casa_tomas'
         and r.estado in ('pendiente', 'verificada', 'confirmada')
         and ((d.turno = 'comida') = (r.hora < time '17:00'))
    ) e
   where e.pax + d.pax > floor(v_aforo * 0.97);
  if v_conflictos is not null then
    raise exception 'Aforo de Casa Tomás: no cabe con margen del 3 %%: %. Regenerar con la ocupación actual.', v_conflictos;
  end if;

  -- Tope de filas de la API (max_rows = 1000): el calendario pide el mes entero de una vez.
  select count(*) into v_filas_oct
    from public.reservas
   where fecha between date '2026-10-01' and date '2026-10-31' and estado <> 'cancelada';
  if v_filas_oct + 861 > 970 then
    raise exception 'Octubre tendría % filas no canceladas (> %): el calendario truncaría el mes.',
      v_filas_oct + 861, 970;
  end if;
end
$precheck$;

-- 1) Inserciones, un lote por día.

-- 2026-10-02 (viernes): 53 reservas, 278 comensales
insert into public.reservas (fecha, hora, numero_comensales, estado, nombre, telefono, email, canal, marca, espacio_id, importante, en_blacklist, consentimiento_newsletter, notas_cliente) values
  ('2026-10-02', '13:00', 2, 'confirmada', 'Javier Álvarez Hernández', NULL, NULL, 'web', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026]'),
  ('2026-10-02', '13:00', 8, 'confirmada', 'Sara Iglesias', NULL, NULL, 'web', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026]'),
  ('2026-10-02', '13:30', 6, 'confirmada', 'Antonio Pérez', NULL, NULL, 'telefono', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026]'),
  ('2026-10-02', '13:45', 4, 'confirmada', 'Alba Serrano Delgado', NULL, NULL, 'web', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026]'),
  ('2026-10-02', '13:45', 8, 'confirmada', 'Mario Marín', NULL, NULL, 'telefono', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026]'),
  ('2026-10-02', '14:00', 2, 'confirmada', 'Miguel Domínguez', NULL, NULL, 'manual', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026]'),
  ('2026-10-02', '14:00', 2, 'confirmada', 'Ana Rubio', NULL, NULL, 'web', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026]'),
  ('2026-10-02', '14:00', 4, 'confirmada', 'Andrés Santos Cruz', NULL, NULL, 'telefono', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026] Persona en silla de ruedas: mesa accesible'),
  ('2026-10-02', '14:00', 6, 'confirmada', 'Iván Gallego', NULL, NULL, 'web', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026] Alergia a frutos secos'),
  ('2026-10-02', '14:00', 6, 'confirmada', 'Hugo Márquez Marín', NULL, NULL, 'manual', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026]'),
  ('2026-10-02', '14:00', 8, 'confirmada', 'Noelia Santos', NULL, NULL, 'web', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026]'),
  ('2026-10-02', '14:00', 9, 'confirmada', 'Óscar Castro Cruz', NULL, NULL, 'manual', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026] Grupo de senderismo, llegan todos a la vez'),
  ('2026-10-02', '14:00', 12, 'confirmada', 'Raúl Molina', NULL, NULL, 'telefono', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026] Comida familiar, vienen los abuelos'),
  ('2026-10-02', '14:00', 15, 'confirmada', 'Adrián Ruiz', NULL, NULL, 'manual', 'casa_tomas', NULL, true, false, false, '[DEMO-SEED][oct-2026] Reunión de antiguos alumnos'),
  ('2026-10-02', '14:15', 2, 'confirmada', 'Fernando Cortés', NULL, NULL, 'manual', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026]'),
  ('2026-10-02', '14:15', 4, 'confirmada', 'David Calvo', NULL, NULL, 'web', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026] Dos vegetarianos'),
  ('2026-10-02', '14:30', 2, 'confirmada', 'Javier Pérez Vázquez', NULL, NULL, 'telefono', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026]'),
  ('2026-10-02', '14:30', 3, 'confirmada', 'Álvaro Rubio', NULL, NULL, 'web', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026]'),
  ('2026-10-02', '14:30', 4, 'confirmada', 'Javier Martín', NULL, NULL, 'manual', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026]'),
  ('2026-10-02', '14:30', 4, 'confirmada', 'Irene Álvarez', NULL, NULL, 'manual', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026]'),
  ('2026-10-02', '14:45', 2, 'confirmada', 'Begoña Cruz', NULL, NULL, 'web', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026]'),
  ('2026-10-02', '14:45', 4, 'confirmada', 'David Romero', NULL, NULL, 'manual', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026]'),
  ('2026-10-02', '15:00', 2, 'confirmada', 'Mario Morales', NULL, NULL, 'telefono', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026]'),
  ('2026-10-02', '15:00', 2, 'confirmada', 'Lucía Martín', NULL, NULL, 'web', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026]'),
  ('2026-10-02', '15:15', 4, 'confirmada', 'Ainhoa Blanco', NULL, NULL, 'telefono', 'casa_tomas', NULL, true, false, false, '[DEMO-SEED][oct-2026]'),
  ('2026-10-02', '15:30', 3, 'confirmada', 'Ignacio Álvarez', NULL, NULL, 'web', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026]'),
  ('2026-10-02', '15:30', 6, 'confirmada', 'Raquel Jiménez Muñoz', NULL, NULL, 'manual', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026]'),
  ('2026-10-02', '15:45', 2, 'confirmada', 'Javier Hernández', NULL, NULL, 'manual', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026]'),
  ('2026-10-02', '15:45', 8, 'confirmada', 'Javier Medina', NULL, NULL, 'web', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026]'),
  ('2026-10-02', '20:00', 4, 'confirmada', 'Hugo León Alonso', NULL, NULL, 'telefono', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026]'),
  ('2026-10-02', '20:00', 7, 'confirmada', 'Rafael Pérez', NULL, NULL, 'web', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026] Mesa tranquila si es posible'),
  ('2026-10-02', '20:30', 6, 'confirmada', 'Pilar Serrano', NULL, NULL, 'web', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026]'),
  ('2026-10-02', '20:30', 6, 'confirmada', 'Natalia Núñez', NULL, NULL, 'web', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026]'),
  ('2026-10-02', '20:30', 6, 'confirmada', 'Manuel Márquez', NULL, NULL, 'web', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026]'),
  ('2026-10-02', '21:00', 2, 'confirmada', 'Iván Rodríguez', NULL, NULL, 'telefono', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026]'),
  ('2026-10-02', '21:00', 2, 'confirmada', 'Jesús Ramírez', NULL, NULL, 'web', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026]'),
  ('2026-10-02', '21:00', 8, 'confirmada', 'Jorge Sánchez', NULL, NULL, 'web', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026] Intolerancia a la lactosa'),
  ('2026-10-02', '21:00', 10, 'confirmada', 'Javier Marín Cortés', NULL, NULL, 'manual', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026] Celebración de jubilación, menú cerrado'),
  ('2026-10-02', '21:00', 10, 'confirmada', 'Rubén Álvarez Sanz', NULL, NULL, 'telefono', 'casa_tomas', NULL, true, false, false, '[DEMO-SEED][oct-2026] Cena familiar, vienen los abuelos'),
  ('2026-10-02', '21:00', 10, 'confirmada', 'Nuria Vidal', NULL, NULL, 'manual', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026] Despedida de soltero'),
  ('2026-10-02', '21:00', 10, 'confirmada', 'Hugo Cabrera', NULL, NULL, 'telefono', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026] Despedida de soltero'),
  ('2026-10-02', '21:15', 2, 'confirmada', 'Carlos Garrido', NULL, NULL, 'web', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026] Vienen con perro pequeño (terraza)'),
  ('2026-10-02', '21:15', 2, 'confirmada', 'Julia Díaz Guerrero', NULL, NULL, 'telefono', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026]'),
  ('2026-10-02', '21:15', 3, 'confirmada', 'Andrés Marín', NULL, NULL, 'manual', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026]'),
  ('2026-10-02', '21:15', 5, 'confirmada', 'Marta Romero Prieto', NULL, NULL, 'web', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026] Prefieren interior'),
  ('2026-10-02', '21:30', 5, 'confirmada', 'Patricia Gallego Sánchez', NULL, NULL, 'telefono', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026]'),
  ('2026-10-02', '21:30', 16, 'confirmada', 'Teresa Cruz Herrera', NULL, NULL, 'manual', 'casa_tomas', NULL, true, false, false, '[DEMO-SEED][oct-2026] Cena familiar, vienen los abuelos'),
  ('2026-10-02', '21:45', 3, 'confirmada', 'Ana Romero Núñez', NULL, NULL, 'telefono', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026]'),
  ('2026-10-02', '22:00', 2, 'confirmada', 'Óscar Ramos', NULL, NULL, 'manual', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026]'),
  ('2026-10-02', '22:00', 2, 'confirmada', 'Rafael Navarro', NULL, NULL, 'telefono', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026] Intolerancia a la lactosa'),
  ('2026-10-02', '22:00', 6, 'confirmada', 'Álvaro González', NULL, NULL, 'manual', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026]'),
  ('2026-10-02', '22:30', 2, 'confirmada', 'Diego Medina', NULL, NULL, 'telefono', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026]'),
  ('2026-10-02', '22:30', 5, 'confirmada', 'Alba Castro', NULL, NULL, 'web', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026] Embarazada: nada crudo ni poco hecho');

-- 2026-10-03 (sábado): 55 reservas, 273 comensales
insert into public.reservas (fecha, hora, numero_comensales, estado, nombre, telefono, email, canal, marca, espacio_id, importante, en_blacklist, consentimiento_newsletter, notas_cliente) values
  ('2026-10-03', '13:00', 3, 'confirmada', 'Cristina Gómez Peña', NULL, NULL, 'manual', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026] Dos vegetarianos'),
  ('2026-10-03', '13:00', 4, 'confirmada', 'Silvia Jiménez', NULL, NULL, 'telefono', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026]'),
  ('2026-10-03', '13:30', 3, 'confirmada', 'Cristina Ruiz', NULL, NULL, 'telefono', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026] Cumpleaños, una vela en el postre'),
  ('2026-10-03', '13:30', 4, 'confirmada', 'Óscar Molina', NULL, NULL, 'web', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026]'),
  ('2026-10-03', '13:30', 4, 'confirmada', 'José Cortés', NULL, NULL, 'web', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026] Piden mesa redonda'),
  ('2026-10-03', '13:30', 4, 'confirmada', 'Beatriz Ramos', NULL, NULL, 'web', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026]'),
  ('2026-10-03', '13:30', 6, 'confirmada', 'Isabel Calvo', NULL, NULL, 'telefono', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026] Dos tronas, por favor'),
  ('2026-10-03', '13:30', 10, 'confirmada', 'Patricia Calvo', NULL, NULL, 'telefono', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026] Comida familiar, vienen los abuelos'),
  ('2026-10-03', '13:30', 12, 'confirmada', 'Sergio Ramírez', NULL, NULL, 'manual', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026] Celebración de jubilación, menú cerrado'),
  ('2026-10-03', '13:30', 14, 'confirmada', 'Paula Ortega Morales', NULL, NULL, 'manual', 'casa_tomas', NULL, true, false, false, '[DEMO-SEED][oct-2026] Cumpleaños de 40: traen decoración'),
  ('2026-10-03', '14:00', 2, 'confirmada', 'Noelia Martín Navarro', NULL, NULL, 'telefono', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026]'),
  ('2026-10-03', '14:00', 2, 'confirmada', 'Óscar González', NULL, NULL, 'manual', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026]'),
  ('2026-10-03', '14:00', 9, 'confirmada', 'Inés Jiménez Calvo', NULL, NULL, 'telefono', 'casa_tomas', NULL, true, false, false, '[DEMO-SEED][oct-2026] Reunión de antiguos alumnos'),
  ('2026-10-03', '14:00', 12, 'confirmada', 'María Delgado', NULL, NULL, 'manual', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026] Despedida de soltero'),
  ('2026-10-03', '14:15', 2, 'confirmada', 'Francisco Romero', NULL, NULL, 'telefono', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026] Prefieren interior'),
  ('2026-10-03', '14:15', 2, 'confirmada', 'Teresa García', NULL, NULL, 'telefono', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026] Cumpleaños: traen tarta, ¿la guardáis en cámara?'),
  ('2026-10-03', '14:15', 4, 'confirmada', 'Miguel García Santos', NULL, NULL, 'web', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026]'),
  ('2026-10-03', '14:15', 4, 'confirmada', 'Pilar Castillo Lozano', NULL, NULL, 'telefono', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026]'),
  ('2026-10-03', '14:30', 2, 'confirmada', 'Julia Castillo', NULL, NULL, 'web', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026]'),
  ('2026-10-03', '14:30', 4, 'confirmada', 'Cristina González', NULL, NULL, 'web', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026] Celebran una jubilación'),
  ('2026-10-03', '14:30', 5, 'confirmada', 'Francisco Ramos Alonso', NULL, NULL, 'web', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026]'),
  ('2026-10-03', '14:30', 5, 'confirmada', 'Adrián Álvarez', NULL, NULL, 'web', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026]'),
  ('2026-10-03', '14:45', 5, 'confirmada', 'Alba Moreno', NULL, NULL, 'telefono', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026] Intolerancia a la lactosa'),
  ('2026-10-03', '14:45', 8, 'confirmada', 'Irene López', NULL, NULL, 'telefono', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026]'),
  ('2026-10-03', '15:00', 2, 'confirmada', 'Laura Vidal', NULL, NULL, 'telefono', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026]'),
  ('2026-10-03', '15:00', 4, 'confirmada', 'Laura Medina', NULL, NULL, 'web', 'casa_tomas', NULL, true, false, false, '[DEMO-SEED][oct-2026]'),
  ('2026-10-03', '15:00', 4, 'confirmada', 'Víctor Álvarez Serrano', NULL, NULL, 'web', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026]'),
  ('2026-10-03', '15:30', 3, 'confirmada', 'Jesús Torres Delgado', NULL, NULL, 'web', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026]'),
  ('2026-10-03', '15:45', 2, 'confirmada', 'Francisco Rodríguez Martín', NULL, NULL, 'telefono', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026] Piden mesa redonda'),
  ('2026-10-03', '20:00', 4, 'confirmada', 'Pilar Pérez', NULL, NULL, 'telefono', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026] Cumpleaños: traen tarta, ¿la guardáis en cámara?'),
  ('2026-10-03', '20:30', 2, 'confirmada', 'Elena Ortega Ortiz', NULL, NULL, 'manual', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026] Dos vegetarianos'),
  ('2026-10-03', '20:30', 2, 'confirmada', 'Iván Prieto', NULL, NULL, 'web', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026]'),
  ('2026-10-03', '20:30', 5, 'confirmada', 'Alba Márquez Cruz', NULL, NULL, 'web', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026]'),
  ('2026-10-03', '20:45', 2, 'confirmada', 'Daniel Gil', NULL, NULL, 'telefono', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026]'),
  ('2026-10-03', '20:45', 4, 'confirmada', 'Antonio Ruiz', NULL, NULL, 'web', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026]'),
  ('2026-10-03', '20:45', 5, 'confirmada', 'José Martín', NULL, NULL, 'manual', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026]'),
  ('2026-10-03', '20:45', 5, 'confirmada', 'Teresa Jiménez Castro', NULL, NULL, 'web', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026]'),
  ('2026-10-03', '20:45', 7, 'confirmada', 'Patricia Gutiérrez', NULL, NULL, 'telefono', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026]'),
  ('2026-10-03', '20:45', 8, 'confirmada', 'Ana Prieto', NULL, NULL, 'web', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026] Embarazada: nada crudo ni poco hecho'),
  ('2026-10-03', '21:00', 4, 'confirmada', 'Beatriz Calvo', NULL, NULL, 'telefono', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026]'),
  ('2026-10-03', '21:00', 4, 'confirmada', 'Patricia Castillo', NULL, NULL, 'manual', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026]'),
  ('2026-10-03', '21:00', 8, 'confirmada', 'Jorge García', NULL, NULL, 'telefono', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026] Intolerancia a la lactosa'),
  ('2026-10-03', '21:00', 9, 'confirmada', 'Ainhoa Ramírez', NULL, NULL, 'telefono', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026] Despedida de soltero'),
  ('2026-10-03', '21:15', 2, 'confirmada', 'Inés Iglesias Cruz', NULL, NULL, 'telefono', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026]'),
  ('2026-10-03', '21:15', 5, 'confirmada', 'Carmen Castillo', NULL, NULL, 'telefono', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026]'),
  ('2026-10-03', '21:30', 4, 'confirmada', 'Daniel Muñoz', NULL, NULL, 'web', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026]'),
  ('2026-10-03', '21:30', 4, 'confirmada', 'Sara Márquez Fernández', NULL, NULL, 'web', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026]'),
  ('2026-10-03', '21:30', 9, 'confirmada', 'Hugo Marín Cortés', NULL, NULL, 'manual', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026] Celebración de jubilación, menú cerrado'),
  ('2026-10-03', '21:30', 12, 'confirmada', 'Isabel Guerrero', NULL, NULL, 'manual', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026] Cena de peña, quieren menú cerrado'),
  ('2026-10-03', '21:45', 4, 'confirmada', 'Patricia Jiménez', NULL, NULL, 'web', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026]'),
  ('2026-10-03', '22:00', 4, 'confirmada', 'Álvaro Rubio', NULL, NULL, 'telefono', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026] Celebran una jubilación'),
  ('2026-10-03', '22:00', 5, 'confirmada', 'Rafael Hernández', NULL, NULL, 'manual', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026]'),
  ('2026-10-03', '22:00', 6, 'confirmada', 'Begoña Martín Sanz', NULL, NULL, 'web', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026]'),
  ('2026-10-03', '22:15', 2, 'confirmada', 'Antonio Álvarez López', NULL, NULL, 'web', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026]'),
  ('2026-10-03', '22:30', 2, 'confirmada', 'Ainhoa Vázquez López', NULL, NULL, 'telefono', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026]');

-- 2026-10-04 (domingo): 34 reservas, 147 comensales
insert into public.reservas (fecha, hora, numero_comensales, estado, nombre, telefono, email, canal, marca, espacio_id, importante, en_blacklist, consentimiento_newsletter, notas_cliente) values
  ('2026-10-04', '13:00', 4, 'confirmada', 'Carmen Romero', NULL, NULL, 'web', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026]'),
  ('2026-10-04', '13:00', 6, 'confirmada', 'Elena Álvarez Méndez', NULL, NULL, 'manual', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026]'),
  ('2026-10-04', '13:00', 7, 'confirmada', 'Clara Santos', NULL, NULL, 'telefono', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026] Cumpleaños, una vela en el postre'),
  ('2026-10-04', '13:15', 2, 'confirmada', 'Cristina Prieto', NULL, NULL, 'web', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026]'),
  ('2026-10-04', '13:15', 8, 'confirmada', 'Beatriz Calvo', NULL, NULL, 'telefono', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026]'),
  ('2026-10-04', '13:30', 2, 'confirmada', 'Víctor Alonso', NULL, NULL, 'manual', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026] Primera visita, vienen recomendados'),
  ('2026-10-04', '13:30', 3, 'confirmada', 'Gonzalo Márquez', NULL, NULL, 'telefono', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026]'),
  ('2026-10-04', '13:30', 6, 'confirmada', 'Natalia Martínez Gómez', NULL, NULL, 'telefono', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026]'),
  ('2026-10-04', '13:30', 9, 'confirmada', 'Elena Guerrero Martínez', NULL, NULL, 'telefono', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026] Grupo de senderismo, llegan todos a la vez'),
  ('2026-10-04', '13:45', 5, 'confirmada', 'Mario Domínguez Pérez', NULL, NULL, 'web', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026] Mesa junto a la ventana si puede ser'),
  ('2026-10-04', '14:00', 3, 'confirmada', 'Hugo Cortés', NULL, NULL, 'manual', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026] Dos vegetarianos'),
  ('2026-10-04', '14:00', 6, 'confirmada', 'Iván Domínguez Cortés', NULL, NULL, 'telefono', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026]'),
  ('2026-10-04', '14:00', 14, 'confirmada', 'Teresa Molina', NULL, NULL, 'manual', 'casa_tomas', NULL, true, false, false, '[DEMO-SEED][oct-2026] Grupo de senderismo, llegan todos a la vez'),
  ('2026-10-04', '14:15', 3, 'confirmada', 'Teresa Cabrera', NULL, NULL, 'telefono', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026]'),
  ('2026-10-04', '14:15', 4, 'confirmada', 'Isabel Rubio', NULL, NULL, 'manual', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026]'),
  ('2026-10-04', '14:15', 4, 'confirmada', 'Miguel Ramos Núñez', NULL, NULL, 'web', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026]'),
  ('2026-10-04', '14:15', 5, 'confirmada', 'Víctor Álvarez Prieto', NULL, NULL, 'web', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026]'),
  ('2026-10-04', '14:30', 2, 'confirmada', 'Raquel Ramírez Castillo', NULL, NULL, 'manual', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026]'),
  ('2026-10-04', '14:30', 4, 'confirmada', 'Cristina Vidal', NULL, NULL, 'telefono', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026] Vienen con perro pequeño (terraza)'),
  ('2026-10-04', '14:30', 4, 'confirmada', 'Andrés Vázquez', NULL, NULL, 'web', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026]'),
  ('2026-10-04', '14:30', 4, 'confirmada', 'Ainhoa Gil', NULL, NULL, 'manual', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026] Primera visita, vienen recomendados'),
  ('2026-10-04', '14:30', 8, 'confirmada', 'Patricia Iglesias', NULL, NULL, 'web', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026]'),
  ('2026-10-04', '14:45', 3, 'confirmada', 'Lorena Navarro Ortega', NULL, NULL, 'web', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026]'),
  ('2026-10-04', '15:00', 2, 'confirmada', 'Álvaro Cano', NULL, NULL, 'web', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026] Una persona vegana'),
  ('2026-10-04', '20:15', 5, 'confirmada', 'Hugo Delgado', NULL, NULL, 'telefono', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026]'),
  ('2026-10-04', '20:45', 2, 'confirmada', 'Teresa Morales', NULL, NULL, 'telefono', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026]'),
  ('2026-10-04', '20:45', 2, 'confirmada', 'María Herrera', NULL, NULL, 'manual', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026]'),
  ('2026-10-04', '20:45', 4, 'confirmada', 'Óscar Sánchez Torres', NULL, NULL, 'manual', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026]'),
  ('2026-10-04', '21:00', 2, 'confirmada', 'David Gil', NULL, NULL, 'web', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026]'),
  ('2026-10-04', '21:00', 2, 'confirmada', 'Alejandro Santos Núñez', NULL, NULL, 'manual', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026]'),
  ('2026-10-04', '21:30', 2, 'confirmada', 'Ainhoa Martín', NULL, NULL, 'manual', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026] Una persona vegana'),
  ('2026-10-04', '21:30', 2, 'confirmada', 'Sergio Alonso', NULL, NULL, 'manual', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026] Necesitan trona'),
  ('2026-10-04', '22:00', 4, 'confirmada', 'Carmen Gil', NULL, NULL, 'web', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026]'),
  ('2026-10-04', '22:00', 4, 'confirmada', 'Ana Ramírez', NULL, NULL, 'web', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026]');

-- 2026-10-05 (lunes): 24 reservas, 82 comensales
insert into public.reservas (fecha, hora, numero_comensales, estado, nombre, telefono, email, canal, marca, espacio_id, importante, en_blacklist, consentimiento_newsletter, notas_cliente) values
  ('2026-10-05', '13:00', 3, 'confirmada', 'Raúl González', NULL, NULL, 'manual', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026] Sin cebolla ni ajo (alergia)'),
  ('2026-10-05', '13:00', 8, 'confirmada', 'María Delgado Alonso', NULL, NULL, 'telefono', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026] Alergia al marisco'),
  ('2026-10-05', '13:15', 8, 'confirmada', 'Álvaro Delgado Castro', NULL, NULL, 'manual', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026] Comida de trabajo, necesitan factura'),
  ('2026-10-05', '13:30', 2, 'confirmada', 'Carlos Lozano Pérez', NULL, NULL, 'manual', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026]'),
  ('2026-10-05', '14:00', 2, 'confirmada', 'Patricia Gutiérrez Martínez', NULL, NULL, 'web', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026]'),
  ('2026-10-05', '14:00', 2, 'confirmada', 'Cristina Jiménez', NULL, NULL, 'web', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026]'),
  ('2026-10-05', '14:15', 2, 'confirmada', 'Javier Guerrero Ruiz', NULL, NULL, 'telefono', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026]'),
  ('2026-10-05', '14:30', 3, 'confirmada', 'Elena Suárez', NULL, NULL, 'telefono', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026]'),
  ('2026-10-05', '14:30', 4, 'confirmada', 'Alejandro Cruz Fernández', NULL, NULL, 'telefono', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026] Piden mesa redonda'),
  ('2026-10-05', '14:30', 5, 'confirmada', 'Carmen Ruiz Rodríguez', NULL, NULL, 'telefono', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026]'),
  ('2026-10-05', '15:00', 2, 'confirmada', 'Teresa Domínguez', NULL, NULL, 'web', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026]'),
  ('2026-10-05', '20:00', 3, 'confirmada', 'Rafael Castro Méndez', NULL, NULL, 'manual', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026] Celebran una jubilación'),
  ('2026-10-05', '20:15', 2, 'confirmada', 'Isabel Iglesias López', NULL, NULL, 'telefono', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026] Prefieren terraza si hace bueno'),
  ('2026-10-05', '20:45', 2, 'confirmada', 'Fernando Ramírez', NULL, NULL, 'telefono', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026]'),
  ('2026-10-05', '21:00', 2, 'confirmada', 'Carlos Iglesias', NULL, NULL, 'manual', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026]'),
  ('2026-10-05', '21:00', 2, 'confirmada', 'Mario Marín', NULL, NULL, 'web', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026] Cumpleaños, una vela en el postre'),
  ('2026-10-05', '21:00', 6, 'confirmada', 'David Jiménez Álvarez', NULL, NULL, 'web', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026] Alergia a frutos secos'),
  ('2026-10-05', '21:00', 6, 'confirmada', 'Carmen Jiménez Martínez', NULL, NULL, 'web', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026]'),
  ('2026-10-05', '21:15', 2, 'confirmada', 'Miguel Ortiz', NULL, NULL, 'manual', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026]'),
  ('2026-10-05', '21:15', 3, 'confirmada', 'Fernando Santos', NULL, NULL, 'telefono', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026]'),
  ('2026-10-05', '21:30', 3, 'confirmada', 'Sergio López', NULL, NULL, 'telefono', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026]'),
  ('2026-10-05', '21:45', 5, 'confirmada', 'Antonio Díaz', NULL, NULL, 'manual', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026]'),
  ('2026-10-05', '22:00', 2, 'confirmada', 'Fernando Delgado', NULL, NULL, 'telefono', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026]'),
  ('2026-10-05', '22:00', 3, 'confirmada', 'Rocío López', NULL, NULL, 'web', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026] Persona en silla de ruedas: mesa accesible');

-- 2026-10-06 (martes): 20 reservas, 72 comensales
insert into public.reservas (fecha, hora, numero_comensales, estado, nombre, telefono, email, canal, marca, espacio_id, importante, en_blacklist, consentimiento_newsletter, notas_cliente) values
  ('2026-10-06', '13:00', 2, 'confirmada', 'Víctor Blanco Santos', NULL, NULL, 'web', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026] Primera visita, vienen recomendados'),
  ('2026-10-06', '13:45', 4, 'confirmada', 'Alberto Ortega Rodríguez', NULL, NULL, 'manual', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026]'),
  ('2026-10-06', '14:00', 2, 'confirmada', 'Inés Gil', NULL, NULL, 'manual', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026]'),
  ('2026-10-06', '14:00', 3, 'confirmada', 'Montse Martínez', NULL, NULL, 'web', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026]'),
  ('2026-10-06', '14:00', 3, 'confirmada', 'Laura Díaz', NULL, NULL, 'web', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026]'),
  ('2026-10-06', '14:00', 10, 'confirmada', 'Sergio Pérez Calvo', NULL, NULL, 'web', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026] Comida de peña, quieren menú cerrado'),
  ('2026-10-06', '14:15', 4, 'confirmada', 'Jesús Navarro Ortega', NULL, NULL, 'telefono', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026] Aniversario de boda'),
  ('2026-10-06', '14:45', 3, 'confirmada', 'Lucía Guerrero Lozano', NULL, NULL, 'telefono', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026]'),
  ('2026-10-06', '15:00', 2, 'confirmada', 'Jorge Suárez', NULL, NULL, 'web', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026]'),
  ('2026-10-06', '15:15', 2, 'confirmada', 'Natalia Vázquez Medina', NULL, NULL, 'telefono', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026] Prefieren terraza si hace bueno'),
  ('2026-10-06', '21:00', 2, 'confirmada', 'Jorge Fernández Muñoz', NULL, NULL, 'web', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026]'),
  ('2026-10-06', '21:00', 3, 'confirmada', 'Manuel Moreno Ruiz', NULL, NULL, 'web', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026]'),
  ('2026-10-06', '21:00', 4, 'confirmada', 'Pilar Sanz', NULL, NULL, 'telefono', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026]'),
  ('2026-10-06', '21:00', 6, 'confirmada', 'Pablo López', NULL, NULL, 'manual', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026]'),
  ('2026-10-06', '21:00', 6, 'confirmada', 'Begoña Navarro', NULL, NULL, 'web', 'casa_tomas', NULL, true, false, false, '[DEMO-SEED][oct-2026]'),
  ('2026-10-06', '21:30', 4, 'confirmada', 'José Prieto', NULL, NULL, 'manual', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026]'),
  ('2026-10-06', '21:45', 4, 'confirmada', 'Miguel Alonso', NULL, NULL, 'telefono', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026]'),
  ('2026-10-06', '22:00', 2, 'confirmada', 'Fernando Navarro Herrera', NULL, NULL, 'telefono', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026]'),
  ('2026-10-06', '22:00', 3, 'confirmada', 'Isabel Navarro', NULL, NULL, 'web', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026]'),
  ('2026-10-06', '22:45', 3, 'confirmada', 'Alberto Medina', NULL, NULL, 'manual', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026]');

-- 2026-10-07 (miércoles): 26 reservas, 85 comensales
insert into public.reservas (fecha, hora, numero_comensales, estado, nombre, telefono, email, canal, marca, espacio_id, importante, en_blacklist, consentimiento_newsletter, notas_cliente) values
  ('2026-10-07', '13:00', 2, 'confirmada', 'Laura Ruiz', NULL, NULL, 'web', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026]'),
  ('2026-10-07', '14:00', 2, 'confirmada', 'Jorge Castro', NULL, NULL, 'web', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026]'),
  ('2026-10-07', '14:00', 3, 'confirmada', 'Ana Torres', NULL, NULL, 'web', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026]'),
  ('2026-10-07', '14:00', 4, 'confirmada', 'Miguel Gómez', NULL, NULL, 'telefono', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026] Comida de trabajo, necesitan factura'),
  ('2026-10-07', '14:00', 4, 'confirmada', 'Óscar Gil', NULL, NULL, 'manual', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026] Celíaco: todo sin gluten, por favor'),
  ('2026-10-07', '14:00', 5, 'confirmada', 'Lucía Gil', NULL, NULL, 'web', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026]'),
  ('2026-10-07', '14:15', 2, 'confirmada', 'Montse López Castillo', NULL, NULL, 'manual', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026] Llegarán unos 15 minutos tarde'),
  ('2026-10-07', '14:15', 2, 'confirmada', 'Rafael Cabrera', NULL, NULL, 'telefono', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026] Primera visita, vienen recomendados'),
  ('2026-10-07', '14:15', 2, 'confirmada', 'Iván Pérez', NULL, NULL, 'manual', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026]'),
  ('2026-10-07', '14:30', 12, 'confirmada', 'María Lozano Castillo', NULL, NULL, 'telefono', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026] Despedida de soltera'),
  ('2026-10-07', '15:00', 2, 'confirmada', 'Hugo Delgado', NULL, NULL, 'web', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026]'),
  ('2026-10-07', '15:00', 5, 'confirmada', 'Jesús Morales', NULL, NULL, 'web', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026]'),
  ('2026-10-07', '15:30', 2, 'confirmada', 'Carlos Hernández', NULL, NULL, 'telefono', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026] Dos tronas, por favor'),
  ('2026-10-07', '20:45', 2, 'confirmada', 'Jesús Vázquez', NULL, NULL, 'manual', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026] Cumpleaños, una vela en el postre'),
  ('2026-10-07', '21:00', 2, 'confirmada', 'Elena Guerrero', NULL, NULL, 'web', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026]'),
  ('2026-10-07', '21:00', 2, 'confirmada', 'Beatriz Lozano', NULL, NULL, 'telefono', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026]'),
  ('2026-10-07', '21:00', 2, 'confirmada', 'Raúl Pérez Sanz', NULL, NULL, 'web', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026]'),
  ('2026-10-07', '21:00', 4, 'confirmada', 'Álvaro Méndez Morales', NULL, NULL, 'web', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026]'),
  ('2026-10-07', '21:15', 2, 'confirmada', 'Lucía Vázquez', NULL, NULL, 'telefono', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026] Cumpleaños: traen tarta, ¿la guardáis en cámara?'),
  ('2026-10-07', '21:45', 2, 'confirmada', 'Óscar Sánchez', NULL, NULL, 'manual', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026]'),
  ('2026-10-07', '21:45', 2, 'confirmada', 'Patricia Vázquez', NULL, NULL, 'telefono', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026]'),
  ('2026-10-07', '21:45', 4, 'confirmada', 'Noelia Ortiz', NULL, NULL, 'manual', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026]'),
  ('2026-10-07', '22:00', 2, 'confirmada', 'Ana Gómez Jiménez', NULL, NULL, 'web', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026]'),
  ('2026-10-07', '22:00', 4, 'confirmada', 'Laura Morales', NULL, NULL, 'web', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026] Clientes habituales'),
  ('2026-10-07', '22:00', 4, 'confirmada', 'Miguel Medina Torres', NULL, NULL, 'web', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026]'),
  ('2026-10-07', '22:00', 6, 'confirmada', 'Ainhoa Serrano Gallego', NULL, NULL, 'web', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026]');

-- 2026-10-08 (jueves): 27 reservas, 103 comensales
insert into public.reservas (fecha, hora, numero_comensales, estado, nombre, telefono, email, canal, marca, espacio_id, importante, en_blacklist, consentimiento_newsletter, notas_cliente) values
  ('2026-10-08', '13:00', 4, 'confirmada', 'Laura Domínguez', NULL, NULL, 'web', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026]'),
  ('2026-10-08', '13:00', 4, 'confirmada', 'Clara Moreno', NULL, NULL, 'web', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026]'),
  ('2026-10-08', '13:15', 2, 'confirmada', 'Ainhoa Jiménez Castillo', NULL, NULL, 'telefono', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026]'),
  ('2026-10-08', '14:00', 2, 'confirmada', 'Pilar León', NULL, NULL, 'manual', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026]'),
  ('2026-10-08', '14:00', 2, 'confirmada', 'Hugo Domínguez', NULL, NULL, 'web', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026] Celebran una jubilación'),
  ('2026-10-08', '14:00', 4, 'confirmada', 'Lorena Suárez', NULL, NULL, 'web', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026]'),
  ('2026-10-08', '14:15', 2, 'confirmada', 'Sara Domínguez Vidal', NULL, NULL, 'manual', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026] Una persona vegana'),
  ('2026-10-08', '14:30', 10, 'confirmada', 'Marta Gómez', NULL, NULL, 'telefono', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026] Despedida de soltera'),
  ('2026-10-08', '15:00', 2, 'confirmada', 'Ignacio Ortiz', NULL, NULL, 'web', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026] Persona en silla de ruedas: mesa accesible'),
  ('2026-10-08', '15:00', 2, 'confirmada', 'Carmen Romero', NULL, NULL, 'web', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026]'),
  ('2026-10-08', '15:00', 3, 'confirmada', 'Clara Molina Garrido', NULL, NULL, 'manual', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026]'),
  ('2026-10-08', '15:00', 8, 'confirmada', 'Inés Santos', NULL, NULL, 'manual', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026] Comida de trabajo, necesitan factura'),
  ('2026-10-08', '21:00', 2, 'confirmada', 'Begoña Delgado Méndez', NULL, NULL, 'web', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026]'),
  ('2026-10-08', '21:00', 2, 'confirmada', 'Andrés Martínez', NULL, NULL, 'web', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026] Mesa tranquila si es posible'),
  ('2026-10-08', '21:00', 3, 'confirmada', 'Rubén López Hernández', NULL, NULL, 'web', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026]'),
  ('2026-10-08', '21:00', 3, 'confirmada', 'Noelia Suárez', NULL, NULL, 'telefono', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026]'),
  ('2026-10-08', '21:00', 3, 'confirmada', 'Paula Gallego García', NULL, NULL, 'web', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026]'),
  ('2026-10-08', '21:00', 6, 'confirmada', 'Rocío González Ramírez', NULL, NULL, 'telefono', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026]'),
  ('2026-10-08', '21:00', 12, 'confirmada', 'Lorena Ruiz', NULL, NULL, 'web', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026] Cumpleaños de 40: traen decoración'),
  ('2026-10-08', '21:15', 4, 'confirmada', 'Nuria Delgado', NULL, NULL, 'telefono', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026]'),
  ('2026-10-08', '21:30', 2, 'confirmada', 'Ana Márquez', NULL, NULL, 'telefono', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026]'),
  ('2026-10-08', '21:30', 2, 'confirmada', 'Sara Guerrero Molina', NULL, NULL, 'telefono', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026]'),
  ('2026-10-08', '21:45', 2, 'confirmada', 'Miguel Iglesias', NULL, NULL, 'telefono', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026]'),
  ('2026-10-08', '22:00', 3, 'confirmada', 'Iván García Santos', NULL, NULL, 'web', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026] Persona en silla de ruedas: mesa accesible'),
  ('2026-10-08', '22:00', 3, 'confirmada', 'Pilar Núñez', NULL, NULL, 'web', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026]'),
  ('2026-10-08', '22:00', 4, 'confirmada', 'Ana Vidal', NULL, NULL, 'telefono', 'casa_tomas', NULL, true, false, false, '[DEMO-SEED][oct-2026]'),
  ('2026-10-08', '22:00', 7, 'confirmada', 'Irene Fernández', NULL, NULL, 'web', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026]');

-- 2026-10-09 (viernes): 49 reservas, 276 comensales
insert into public.reservas (fecha, hora, numero_comensales, estado, nombre, telefono, email, canal, marca, espacio_id, importante, en_blacklist, consentimiento_newsletter, notas_cliente) values
  ('2026-10-09', '13:00', 7, 'confirmada', 'Laura Torres Medina', NULL, NULL, 'web', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026] Prefieren interior'),
  ('2026-10-09', '13:00', 7, 'confirmada', 'Carmen Romero', NULL, NULL, 'telefono', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026]'),
  ('2026-10-09', '13:30', 4, 'confirmada', 'Rocío Castro', NULL, NULL, 'web', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026]'),
  ('2026-10-09', '13:30', 9, 'confirmada', 'José Domínguez Fernández', NULL, NULL, 'telefono', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026] Comida de empresa, factura a nombre de la empresa'),
  ('2026-10-09', '13:30', 12, 'confirmada', 'Alejandro Gil Álvarez', NULL, NULL, 'manual', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026] Comida de empresa, factura a nombre de la empresa'),
  ('2026-10-09', '13:45', 4, 'confirmada', 'Carmen Martínez López', NULL, NULL, 'manual', 'casa_tomas', NULL, true, false, false, '[DEMO-SEED][oct-2026] Primera visita, vienen recomendados'),
  ('2026-10-09', '13:45', 4, 'confirmada', 'Begoña Núñez', NULL, NULL, 'telefono', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026] Prefieren interior'),
  ('2026-10-09', '13:45', 6, 'confirmada', 'Marta Sánchez Vázquez', NULL, NULL, 'telefono', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026] Mesa junto a la ventana si puede ser'),
  ('2026-10-09', '14:00', 3, 'confirmada', 'Fernando Guerrero', NULL, NULL, 'telefono', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026]'),
  ('2026-10-09', '14:15', 2, 'confirmada', 'María Pérez', NULL, NULL, 'web', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026] Dos vegetarianos'),
  ('2026-10-09', '14:15', 4, 'confirmada', 'Lucía Peña', NULL, NULL, 'web', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026] Cumpleaños: traen tarta, ¿la guardáis en cámara?'),
  ('2026-10-09', '14:30', 4, 'confirmada', 'Inés Medina', NULL, NULL, 'telefono', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026]'),
  ('2026-10-09', '14:30', 4, 'confirmada', 'Francisco Álvarez León', NULL, NULL, 'web', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026] Mesa junto a la ventana si puede ser'),
  ('2026-10-09', '14:30', 8, 'confirmada', 'Hugo Peña', NULL, NULL, 'web', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026]'),
  ('2026-10-09', '14:30', 9, 'confirmada', 'Clara Gutiérrez', NULL, NULL, 'manual', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026] Comida de peña, quieren menú cerrado'),
  ('2026-10-09', '14:30', 18, 'confirmada', 'Natalia Ortiz', NULL, NULL, 'manual', 'casa_tomas', NULL, true, false, false, '[DEMO-SEED][oct-2026] Comida familiar, vienen los abuelos'),
  ('2026-10-09', '14:45', 2, 'confirmada', 'Paula Peña', NULL, NULL, 'web', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026] Persona en silla de ruedas: mesa accesible'),
  ('2026-10-09', '15:00', 2, 'confirmada', 'Carmen Cortés', NULL, NULL, 'manual', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026]'),
  ('2026-10-09', '15:00', 6, 'confirmada', 'Inés Blanco', NULL, NULL, 'web', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026]'),
  ('2026-10-09', '15:15', 2, 'confirmada', 'Jesús Fernández', NULL, NULL, 'manual', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026]'),
  ('2026-10-09', '15:15', 2, 'confirmada', 'Alba López Álvarez', NULL, NULL, 'telefono', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026]'),
  ('2026-10-09', '15:30', 5, 'confirmada', 'Antonio Martín Cruz', NULL, NULL, 'telefono', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026]'),
  ('2026-10-09', '15:30', 6, 'confirmada', 'Óscar Molina', NULL, NULL, 'telefono', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026]'),
  ('2026-10-09', '15:45', 6, 'confirmada', 'Noelia Ortega León', NULL, NULL, 'telefono', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026] Alergia al marisco'),
  ('2026-10-09', '20:15', 3, 'confirmada', 'Jorge Molina Martínez', NULL, NULL, 'web', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026]'),
  ('2026-10-09', '20:30', 4, 'confirmada', 'Víctor Guerrero Calvo', NULL, NULL, 'web', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026]'),
  ('2026-10-09', '20:30', 12, 'confirmada', 'Francisco Marín', NULL, NULL, 'web', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026] Cena de empresa, factura a nombre de la empresa'),
  ('2026-10-09', '20:45', 4, 'confirmada', 'Begoña Castillo', NULL, NULL, 'telefono', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026]'),
  ('2026-10-09', '20:45', 4, 'confirmada', 'Natalia Ramírez Molina', NULL, NULL, 'manual', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026]'),
  ('2026-10-09', '20:45', 4, 'confirmada', 'Sara Cruz', NULL, NULL, 'web', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026]'),
  ('2026-10-09', '20:45', 6, 'confirmada', 'Ainhoa Morales Vázquez', NULL, NULL, 'telefono', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026] Embarazada: nada crudo ni poco hecho'),
  ('2026-10-09', '21:00', 3, 'confirmada', 'Adrián Lozano', NULL, NULL, 'telefono', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026] Necesitan trona'),
  ('2026-10-09', '21:00', 10, 'confirmada', 'Ignacio Méndez Sánchez', NULL, NULL, 'telefono', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026] Despedida de soltera'),
  ('2026-10-09', '21:00', 11, 'confirmada', 'Laura Castillo', NULL, NULL, 'manual', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026] Celebración de jubilación, menú cerrado'),
  ('2026-10-09', '21:00', 16, 'confirmada', 'Carlos Rodríguez', NULL, NULL, 'manual', 'casa_tomas', NULL, true, false, false, '[DEMO-SEED][oct-2026] Cena familiar, vienen los abuelos'),
  ('2026-10-09', '21:15', 2, 'confirmada', 'Montse Cruz', NULL, NULL, 'telefono', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026]'),
  ('2026-10-09', '21:15', 2, 'confirmada', 'Óscar López Gutiérrez', NULL, NULL, 'manual', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026] Aniversario de boda'),
  ('2026-10-09', '21:30', 6, 'confirmada', 'Ana Muñoz Castro', NULL, NULL, 'web', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026]'),
  ('2026-10-09', '21:30', 8, 'confirmada', 'Diego Hernández Fernández', NULL, NULL, 'manual', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026]'),
  ('2026-10-09', '21:30', 8, 'confirmada', 'Manuel Ortega Cortés', NULL, NULL, 'telefono', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026]'),
  ('2026-10-09', '21:30', 12, 'confirmada', 'Javier Ramírez', NULL, NULL, 'manual', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026] Cena de empresa, factura a nombre de la empresa'),
  ('2026-10-09', '21:45', 2, 'confirmada', 'Rubén Núñez Santos', NULL, NULL, 'web', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026]'),
  ('2026-10-09', '21:45', 3, 'confirmada', 'Jorge León Martínez', NULL, NULL, 'manual', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026]'),
  ('2026-10-09', '21:45', 3, 'confirmada', 'Sergio Calvo', NULL, NULL, 'telefono', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026] Mesa tranquila si es posible'),
  ('2026-10-09', '21:45', 4, 'confirmada', 'Daniel Herrera', NULL, NULL, 'telefono', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026]'),
  ('2026-10-09', '22:00', 2, 'confirmada', 'Carlos Díaz', NULL, NULL, 'web', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026]'),
  ('2026-10-09', '22:00', 2, 'confirmada', 'Beatriz Fernández', NULL, NULL, 'web', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026]'),
  ('2026-10-09', '22:00', 3, 'confirmada', 'Clara Hernández', NULL, NULL, 'manual', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026] Mesa tranquila si es posible'),
  ('2026-10-09', '22:45', 6, 'confirmada', 'Miguel Blanco Cano', NULL, NULL, 'telefono', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026] Prefieren interior');

-- 2026-10-10 (sábado): 58 reservas, 305 comensales
insert into public.reservas (fecha, hora, numero_comensales, estado, nombre, telefono, email, canal, marca, espacio_id, importante, en_blacklist, consentimiento_newsletter, notas_cliente) values
  ('2026-10-10', '13:00', 8, 'confirmada', 'Clara Sánchez', NULL, NULL, 'web', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026] Alergia al marisco'),
  ('2026-10-10', '13:15', 8, 'confirmada', 'Javier Ramírez Navarro', NULL, NULL, 'web', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026]'),
  ('2026-10-10', '13:30', 4, 'confirmada', 'Julia Morales', NULL, NULL, 'web', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026] Alergia al marisco'),
  ('2026-10-10', '13:30', 5, 'confirmada', 'Lorena López', NULL, NULL, 'web', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026] Cumpleaños: traen tarta, ¿la guardáis en cámara?'),
  ('2026-10-10', '13:30', 6, 'confirmada', 'Silvia Álvarez Vidal', NULL, NULL, 'web', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026]'),
  ('2026-10-10', '13:30', 10, 'confirmada', 'Adrián Gallego Álvarez', NULL, NULL, 'telefono', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026] Celebración de jubilación, menú cerrado'),
  ('2026-10-10', '13:45', 7, 'confirmada', 'Patricia Peña', NULL, NULL, 'manual', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026]'),
  ('2026-10-10', '14:00', 2, 'confirmada', 'Pilar Medina', NULL, NULL, 'telefono', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026] Aniversario de boda'),
  ('2026-10-10', '14:00', 3, 'confirmada', 'Raquel Cruz Prieto', NULL, NULL, 'web', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026]'),
  ('2026-10-10', '14:00', 4, 'confirmada', 'Isabel Sanz', NULL, NULL, 'manual', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026]'),
  ('2026-10-10', '14:00', 6, 'confirmada', 'Óscar Muñoz', NULL, NULL, 'telefono', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026]'),
  ('2026-10-10', '14:00', 6, 'confirmada', 'Natalia García', NULL, NULL, 'web', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026] Una persona vegana'),
  ('2026-10-10', '14:15', 2, 'confirmada', 'Francisco León', NULL, NULL, 'web', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026]'),
  ('2026-10-10', '14:15', 4, 'confirmada', 'Fernando Vázquez', NULL, NULL, 'web', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026] Necesitan trona'),
  ('2026-10-10', '14:15', 4, 'confirmada', 'Lorena Torres Alonso', NULL, NULL, 'web', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026] Vienen con perro pequeño (terraza)'),
  ('2026-10-10', '14:15', 8, 'confirmada', 'Alba Martín', NULL, NULL, 'telefono', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026]'),
  ('2026-10-10', '14:30', 2, 'confirmada', 'Julia Ramírez', NULL, NULL, 'web', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026]'),
  ('2026-10-10', '14:30', 4, 'confirmada', 'Montse Medina', NULL, NULL, 'web', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026] Clientes habituales'),
  ('2026-10-10', '14:30', 4, 'confirmada', 'Montse Ruiz', NULL, NULL, 'manual', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026] Persona en silla de ruedas: mesa accesible'),
  ('2026-10-10', '14:30', 4, 'confirmada', 'Jesús Cabrera', NULL, NULL, 'telefono', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026]'),
  ('2026-10-10', '14:30', 5, 'confirmada', 'Andrés Serrano', NULL, NULL, 'telefono', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026]'),
  ('2026-10-10', '14:30', 6, 'confirmada', 'Ainhoa Prieto', NULL, NULL, 'web', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026]'),
  ('2026-10-10', '14:30', 8, 'confirmada', 'María Díaz', NULL, NULL, 'telefono', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026]'),
  ('2026-10-10', '14:30', 8, 'confirmada', 'María Alonso', NULL, NULL, 'telefono', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026] Comida de trabajo, necesitan factura'),
  ('2026-10-10', '14:45', 5, 'confirmada', 'Noelia Peña Ramírez', NULL, NULL, 'web', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026]'),
  ('2026-10-10', '15:00', 6, 'confirmada', 'Javier Jiménez Calvo', NULL, NULL, 'telefono', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026]'),
  ('2026-10-10', '15:00', 8, 'confirmada', 'Rafael Díaz', NULL, NULL, 'web', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026]'),
  ('2026-10-10', '20:30', 5, 'confirmada', 'Alejandro Suárez', NULL, NULL, 'web', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026]'),
  ('2026-10-10', '20:30', 11, 'confirmada', 'Manuel Medina', NULL, NULL, 'telefono', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026] Despedida de soltera'),
  ('2026-10-10', '20:45', 2, 'confirmada', 'Clara Moreno', NULL, NULL, 'telefono', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026] Embarazada: nada crudo ni poco hecho'),
  ('2026-10-10', '20:45', 3, 'confirmada', 'José García', NULL, NULL, 'web', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026] Llegarán unos 15 minutos tarde'),
  ('2026-10-10', '20:45', 3, 'confirmada', 'Andrés López', NULL, NULL, 'manual', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026] Dos tronas, por favor'),
  ('2026-10-10', '20:45', 4, 'confirmada', 'Javier Gutiérrez', NULL, NULL, 'web', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026] Embarazada: nada crudo ni poco hecho'),
  ('2026-10-10', '21:00', 4, 'confirmada', 'Andrés Álvarez', NULL, NULL, 'web', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026] Piden mesa redonda'),
  ('2026-10-10', '21:00', 4, 'confirmada', 'Pilar Cano Ortiz', NULL, NULL, 'web', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026] Clientes habituales'),
  ('2026-10-10', '21:00', 4, 'confirmada', 'Sara Guerrero', NULL, NULL, 'web', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026] Mesa junto a la ventana si puede ser'),
  ('2026-10-10', '21:00', 6, 'confirmada', 'Alejandro Ramírez', NULL, NULL, 'manual', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026] Primera visita, vienen recomendados'),
  ('2026-10-10', '21:15', 2, 'confirmada', 'Miguel Ortiz', NULL, NULL, 'manual', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026] Vienen con carrito de bebé'),
  ('2026-10-10', '21:15', 2, 'confirmada', 'Elena Ortega', NULL, NULL, 'web', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026]'),
  ('2026-10-10', '21:15', 7, 'confirmada', 'Hugo Márquez', NULL, NULL, 'telefono', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026] Mesa tranquila si es posible'),
  ('2026-10-10', '21:30', 2, 'confirmada', 'Andrés Ortega', NULL, NULL, 'web', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026] Embarazada: nada crudo ni poco hecho'),
  ('2026-10-10', '21:30', 3, 'confirmada', 'Beatriz Gil Romero', NULL, NULL, 'web', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026]'),
  ('2026-10-10', '21:30', 4, 'confirmada', 'Sergio Rodríguez', NULL, NULL, 'telefono', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026] Una persona vegana'),
  ('2026-10-10', '21:30', 4, 'confirmada', 'Mario Sanz', NULL, NULL, 'manual', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026]'),
  ('2026-10-10', '21:30', 4, 'confirmada', 'Pilar Vidal Lozano', NULL, NULL, 'web', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026]'),
  ('2026-10-10', '21:30', 7, 'confirmada', 'Jesús Molina', NULL, NULL, 'telefono', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026] Cumpleaños: traen tarta, ¿la guardáis en cámara?'),
  ('2026-10-10', '21:30', 9, 'confirmada', 'Julia Méndez Serrano', NULL, NULL, 'manual', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026] Celebración de jubilación, menú cerrado'),
  ('2026-10-10', '21:30', 18, 'confirmada', 'Elena Pérez Molina', NULL, NULL, 'manual', 'casa_tomas', NULL, true, false, false, '[DEMO-SEED][oct-2026] Cena de peña, quieren menú cerrado'),
  ('2026-10-10', '21:45', 2, 'confirmada', 'Silvia Herrera', NULL, NULL, 'telefono', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026]'),
  ('2026-10-10', '21:45', 3, 'confirmada', 'Begoña Muñoz', NULL, NULL, 'manual', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026]'),
  ('2026-10-10', '21:45', 7, 'confirmada', 'Inés Sánchez', NULL, NULL, 'telefono', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026]'),
  ('2026-10-10', '21:45', 8, 'confirmada', 'Ana Serrano Fernández', NULL, NULL, 'telefono', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026] Cena de trabajo, necesitan factura'),
  ('2026-10-10', '22:00', 6, 'confirmada', 'Rubén Lozano Cortés', NULL, NULL, 'web', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026] Vienen con perro pequeño (terraza)'),
  ('2026-10-10', '22:00', 8, 'confirmada', 'Irene Prieto', NULL, NULL, 'telefono', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026]'),
  ('2026-10-10', '22:15', 2, 'confirmada', 'Raquel Ortiz', NULL, NULL, 'web', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026]'),
  ('2026-10-10', '22:15', 2, 'confirmada', 'Alberto Ramírez Cortés', NULL, NULL, 'web', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026] Clientes habituales'),
  ('2026-10-10', '22:15', 4, 'confirmada', 'Inés Moreno', NULL, NULL, 'manual', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026]'),
  ('2026-10-10', '22:30', 8, 'confirmada', 'Cristina Moreno', NULL, NULL, 'web', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026]');

-- 2026-10-11 (domingo): 42 reservas, 221 comensales
insert into public.reservas (fecha, hora, numero_comensales, estado, nombre, telefono, email, canal, marca, espacio_id, importante, en_blacklist, consentimiento_newsletter, notas_cliente) values
  ('2026-10-11', '13:30', 4, 'confirmada', 'José Gallego', NULL, NULL, 'web', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026] Primera visita, vienen recomendados'),
  ('2026-10-11', '13:30', 5, 'confirmada', 'Irene Herrera Rubio', NULL, NULL, 'telefono', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026] Celebran una jubilación'),
  ('2026-10-11', '13:30', 6, 'confirmada', 'Miguel Prieto', NULL, NULL, 'web', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026]'),
  ('2026-10-11', '13:30', 8, 'confirmada', 'Marta Vázquez', NULL, NULL, 'web', 'casa_tomas', NULL, true, false, false, '[DEMO-SEED][oct-2026]'),
  ('2026-10-11', '13:30', 10, 'confirmada', 'Diego Muñoz Cortés', NULL, NULL, 'manual', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026] Despedida de soltero'),
  ('2026-10-11', '13:45', 6, 'confirmada', 'Andrés Cortés Lozano', NULL, NULL, 'web', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026]'),
  ('2026-10-11', '14:15', 2, 'confirmada', 'Gonzalo Álvarez Castro', NULL, NULL, 'manual', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026]'),
  ('2026-10-11', '14:15', 2, 'confirmada', 'Óscar Romero', NULL, NULL, 'telefono', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026] Celebran una jubilación'),
  ('2026-10-11', '14:15', 4, 'confirmada', 'Jorge Hernández Gil', NULL, NULL, 'telefono', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026]'),
  ('2026-10-11', '14:15', 4, 'confirmada', 'Isabel Méndez', NULL, NULL, 'web', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026]'),
  ('2026-10-11', '14:15', 7, 'confirmada', 'Diego Cabrera', NULL, NULL, 'telefono', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026] Mesa tranquila si es posible'),
  ('2026-10-11', '14:30', 2, 'confirmada', 'Hugo Hernández', NULL, NULL, 'telefono', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026] Embarazada: nada crudo ni poco hecho'),
  ('2026-10-11', '14:30', 2, 'confirmada', 'Julia Alonso', NULL, NULL, 'web', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026]'),
  ('2026-10-11', '14:30', 4, 'confirmada', 'Julia Serrano', NULL, NULL, 'telefono', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026]'),
  ('2026-10-11', '14:30', 4, 'confirmada', 'Inés Rubio Herrera', NULL, NULL, 'web', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026] Piden mesa redonda'),
  ('2026-10-11', '14:30', 6, 'confirmada', 'Fernando Rodríguez Ortega', NULL, NULL, 'web', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026]'),
  ('2026-10-11', '14:30', 8, 'confirmada', 'Francisco Ortiz', NULL, NULL, 'web', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026]'),
  ('2026-10-11', '14:30', 10, 'confirmada', 'David Ramos', NULL, NULL, 'telefono', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026] Comida de peña, quieren menú cerrado'),
  ('2026-10-11', '14:30', 10, 'confirmada', 'Álvaro Romero Rodríguez', NULL, NULL, 'manual', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026] Celebración de jubilación, menú cerrado'),
  ('2026-10-11', '14:30', 12, 'confirmada', 'Pablo Domínguez Álvarez', NULL, NULL, 'telefono', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026] Cumpleaños de 40: traen decoración'),
  ('2026-10-11', '14:30', 12, 'confirmada', 'Antonio Torres', NULL, NULL, 'telefono', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026] Celebración de jubilación, menú cerrado'),
  ('2026-10-11', '14:45', 2, 'confirmada', 'Óscar Moreno Blanco', NULL, NULL, 'manual', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026]'),
  ('2026-10-11', '14:45', 2, 'confirmada', 'Iván Ruiz', NULL, NULL, 'web', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026]'),
  ('2026-10-11', '15:00', 4, 'confirmada', 'Rafael Serrano Ortiz', NULL, NULL, 'manual', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026] Piden mesa redonda'),
  ('2026-10-11', '15:45', 8, 'confirmada', 'Miguel Ramírez Blanco', NULL, NULL, 'telefono', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026]'),
  ('2026-10-11', '20:00', 2, 'confirmada', 'Cristina Lozano Prieto', NULL, NULL, 'web', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026]'),
  ('2026-10-11', '20:00', 2, 'confirmada', 'Francisco Blanco Jiménez', NULL, NULL, 'web', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026]'),
  ('2026-10-11', '20:00', 4, 'confirmada', 'Paula Torres Romero', NULL, NULL, 'telefono', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026]'),
  ('2026-10-11', '20:00', 4, 'confirmada', 'Lorena Vázquez', NULL, NULL, 'web', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026] Clientes habituales'),
  ('2026-10-11', '20:00', 4, 'confirmada', 'Álvaro Gil Moreno', NULL, NULL, 'web', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026]'),
  ('2026-10-11', '20:30', 4, 'confirmada', 'Mario Méndez', NULL, NULL, 'telefono', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026]'),
  ('2026-10-11', '20:30', 10, 'confirmada', 'Raquel Alonso Calvo', NULL, NULL, 'telefono', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026] Despedida de soltero'),
  ('2026-10-11', '21:00', 2, 'confirmada', 'Beatriz García', NULL, NULL, 'web', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026]'),
  ('2026-10-11', '21:00', 4, 'confirmada', 'Diego Muñoz Peña', NULL, NULL, 'web', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026]'),
  ('2026-10-11', '21:15', 4, 'confirmada', 'Manuel Méndez Márquez', NULL, NULL, 'telefono', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026] Embarazada: nada crudo ni poco hecho'),
  ('2026-10-11', '21:30', 3, 'confirmada', 'Sergio Gil', NULL, NULL, 'telefono', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026]'),
  ('2026-10-11', '21:30', 4, 'confirmada', 'Begoña Peña Muñoz', NULL, NULL, 'telefono', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026] Sin cebolla ni ajo (alergia)'),
  ('2026-10-11', '22:00', 5, 'confirmada', 'David López', NULL, NULL, 'web', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026]'),
  ('2026-10-11', '22:00', 8, 'confirmada', 'Rubén Vázquez Cruz', NULL, NULL, 'web', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026]'),
  ('2026-10-11', '22:00', 8, 'confirmada', 'Rafael Sanz', NULL, NULL, 'telefono', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026]'),
  ('2026-10-11', '22:15', 4, 'confirmada', 'Julia Ramos', NULL, NULL, 'telefono', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026]'),
  ('2026-10-11', '22:30', 5, 'confirmada', 'Patricia Delgado López', NULL, NULL, 'telefono', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026] Aniversario de boda');

-- 2026-10-12 (lunes): 53 reservas, 246 comensales
insert into public.reservas (fecha, hora, numero_comensales, estado, nombre, telefono, email, canal, marca, espacio_id, importante, en_blacklist, consentimiento_newsletter, notas_cliente) values
  ('2026-10-12', '13:00', 4, 'confirmada', 'Cristina Marín', NULL, NULL, 'telefono', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026] Prefieren terraza si hace bueno'),
  ('2026-10-12', '13:00', 6, 'confirmada', 'Lorena Rubio', NULL, NULL, 'web', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026] Necesitan trona'),
  ('2026-10-12', '13:30', 4, 'confirmada', 'Fernando Díaz Martínez', NULL, NULL, 'manual', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026]'),
  ('2026-10-12', '13:30', 6, 'confirmada', 'Rocío Romero', NULL, NULL, 'web', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026]'),
  ('2026-10-12', '13:30', 15, 'confirmada', 'Clara Santos Vidal', NULL, NULL, 'manual', 'casa_tomas', NULL, true, false, false, '[DEMO-SEED][oct-2026] Comida familiar, vienen los abuelos'),
  ('2026-10-12', '13:45', 5, 'confirmada', 'Ignacio Lozano', NULL, NULL, 'web', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026]'),
  ('2026-10-12', '14:00', 2, 'confirmada', 'Cristina Serrano Gómez', NULL, NULL, 'telefono', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026]'),
  ('2026-10-12', '14:00', 2, 'confirmada', 'Cristina Alonso Delgado', NULL, NULL, 'manual', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026] Festivo: vienen con los abuelos'),
  ('2026-10-12', '14:00', 3, 'confirmada', 'Clara Moreno Ortiz', NULL, NULL, 'manual', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026]'),
  ('2026-10-12', '14:00', 4, 'confirmada', 'Sergio Ortiz', NULL, NULL, 'web', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026]'),
  ('2026-10-12', '14:00', 6, 'confirmada', 'Sara Lozano', NULL, NULL, 'telefono', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026] Prefieren terraza si hace bueno'),
  ('2026-10-12', '14:00', 8, 'confirmada', 'Óscar Serrano González', NULL, NULL, 'manual', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026]'),
  ('2026-10-12', '14:00', 9, 'confirmada', 'Manuel Rubio', NULL, NULL, 'manual', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026] Despedida de soltera'),
  ('2026-10-12', '14:15', 4, 'confirmada', 'Ana Prieto', NULL, NULL, 'web', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026] Comida familiar por el día del Pilar'),
  ('2026-10-12', '14:15', 4, 'confirmada', 'José Cabrera', NULL, NULL, 'web', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026]'),
  ('2026-10-12', '14:15', 4, 'confirmada', 'Rocío Hernández', NULL, NULL, 'web', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026]'),
  ('2026-10-12', '14:15', 6, 'confirmada', 'María González', NULL, NULL, 'telefono', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026]'),
  ('2026-10-12', '14:30', 2, 'confirmada', 'Alba Rodríguez Núñez', NULL, NULL, 'web', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026]'),
  ('2026-10-12', '14:30', 3, 'confirmada', 'Begoña Martínez', NULL, NULL, 'manual', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026]'),
  ('2026-10-12', '14:30', 4, 'confirmada', 'Diego Santos Álvarez', NULL, NULL, 'web', 'casa_tomas', NULL, true, false, false, '[DEMO-SEED][oct-2026]'),
  ('2026-10-12', '14:30', 4, 'confirmada', 'Elena Prieto Méndez', NULL, NULL, 'web', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026] Necesitan trona'),
  ('2026-10-12', '14:30', 8, 'confirmada', 'Ignacio Álvarez', NULL, NULL, 'web', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026] Prefieren interior'),
  ('2026-10-12', '14:45', 4, 'confirmada', 'Clara Hernández', NULL, NULL, 'manual', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026] Embarazada: nada crudo ni poco hecho'),
  ('2026-10-12', '14:45', 4, 'confirmada', 'Noelia Serrano', NULL, NULL, 'web', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026] Persona en silla de ruedas: mesa accesible'),
  ('2026-10-12', '14:45', 8, 'confirmada', 'David Márquez', NULL, NULL, 'web', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026]'),
  ('2026-10-12', '15:00', 4, 'confirmada', 'Laura Herrera Lozano', NULL, NULL, 'web', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026] Celíaco: todo sin gluten, por favor'),
  ('2026-10-12', '15:00', 4, 'confirmada', 'Cristina García', NULL, NULL, 'web', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026] Cumpleaños, una vela en el postre'),
  ('2026-10-12', '15:00', 8, 'confirmada', 'Montse Morales', NULL, NULL, 'web', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026] Una persona vegana'),
  ('2026-10-12', '15:15', 3, 'confirmada', 'Lorena Méndez Suárez', NULL, NULL, 'web', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026]'),
  ('2026-10-12', '15:15', 4, 'confirmada', 'Rafael Lozano', NULL, NULL, 'telefono', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026]'),
  ('2026-10-12', '20:30', 4, 'confirmada', 'Ana Vidal', NULL, NULL, 'telefono', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026] Mesa tranquila si es posible'),
  ('2026-10-12', '20:30', 10, 'confirmada', 'Natalia Rubio', NULL, NULL, 'telefono', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026] Cena familiar, vienen los abuelos'),
  ('2026-10-12', '20:45', 2, 'confirmada', 'Inés González Ortega', NULL, NULL, 'telefono', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026]'),
  ('2026-10-12', '21:00', 2, 'confirmada', 'Alberto Rodríguez', NULL, NULL, 'web', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026]'),
  ('2026-10-12', '21:00', 2, 'confirmada', 'David Pérez', NULL, NULL, 'web', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026]'),
  ('2026-10-12', '21:00', 2, 'confirmada', 'Elena Ruiz', NULL, NULL, 'manual', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026]'),
  ('2026-10-12', '21:00', 2, 'confirmada', 'Víctor Fernández Prieto', NULL, NULL, 'web', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026] Llegarán unos 15 minutos tarde'),
  ('2026-10-12', '21:00', 4, 'confirmada', 'Sara Jiménez', NULL, NULL, 'web', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026]'),
  ('2026-10-12', '21:00', 4, 'confirmada', 'Daniel Herrera', NULL, NULL, 'web', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026] Festivo: cena familiar'),
  ('2026-10-12', '21:00', 4, 'confirmada', 'Miguel Cano Alonso', NULL, NULL, 'telefono', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026] Festivo: cena familiar'),
  ('2026-10-12', '21:00', 5, 'confirmada', 'Rocío Castillo Navarro', NULL, NULL, 'web', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026] Alergia al marisco'),
  ('2026-10-12', '21:00', 8, 'confirmada', 'Isabel Cruz Suárez', NULL, NULL, 'web', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026] Piden mesa redonda'),
  ('2026-10-12', '21:15', 2, 'confirmada', 'Jorge Morales Garrido', NULL, NULL, 'telefono', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026]'),
  ('2026-10-12', '21:15', 4, 'confirmada', 'Alba Márquez', NULL, NULL, 'manual', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026] Clientes habituales'),
  ('2026-10-12', '21:15', 5, 'confirmada', 'Teresa Alonso', NULL, NULL, 'manual', 'casa_tomas', NULL, true, false, false, '[DEMO-SEED][oct-2026]'),
  ('2026-10-12', '21:30', 12, 'confirmada', 'Raúl García', NULL, NULL, 'manual', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026] Cumpleaños de 40: traen decoración'),
  ('2026-10-12', '22:00', 2, 'confirmada', 'Alejandro Delgado', NULL, NULL, 'web', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026] Festivo: cena familiar'),
  ('2026-10-12', '22:00', 2, 'confirmada', 'Irene Méndez', NULL, NULL, 'web', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026]'),
  ('2026-10-12', '22:00', 2, 'confirmada', 'Rocío Delgado González', NULL, NULL, 'web', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026] Alergia al marisco'),
  ('2026-10-12', '22:00', 4, 'confirmada', 'Teresa Márquez Blanco', NULL, NULL, 'web', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026]'),
  ('2026-10-12', '22:00', 6, 'confirmada', 'Jesús Suárez', NULL, NULL, 'manual', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026]'),
  ('2026-10-12', '22:15', 2, 'confirmada', 'Elena Gómez', NULL, NULL, 'telefono', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026] Alergia al marisco'),
  ('2026-10-12', '22:15', 4, 'confirmada', 'David Cabrera', NULL, NULL, 'manual', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026] Festivo: cena familiar');

-- 2026-10-13 (martes): 16 reservas, 50 comensales
insert into public.reservas (fecha, hora, numero_comensales, estado, nombre, telefono, email, canal, marca, espacio_id, importante, en_blacklist, consentimiento_newsletter, notas_cliente) values
  ('2026-10-13', '13:00', 2, 'confirmada', 'Rafael Muñoz', NULL, NULL, 'web', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026]'),
  ('2026-10-13', '14:00', 2, 'confirmada', 'Pilar Hernández', NULL, NULL, 'web', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026] Mesa junto a la ventana si puede ser'),
  ('2026-10-13', '14:00', 2, 'confirmada', 'Beatriz Cabrera Márquez', NULL, NULL, 'web', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026] Vienen con perro pequeño (terraza)'),
  ('2026-10-13', '14:00', 2, 'confirmada', 'Diego Vázquez Molina', NULL, NULL, 'web', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026] Comida de trabajo, necesitan factura'),
  ('2026-10-13', '14:00', 5, 'confirmada', 'Mario Lozano García', NULL, NULL, 'web', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026]'),
  ('2026-10-13', '14:45', 6, 'confirmada', 'Ana León', NULL, NULL, 'telefono', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026] Cumpleaños: traen tarta, ¿la guardáis en cámara?'),
  ('2026-10-13', '15:00', 2, 'confirmada', 'Francisco Méndez', NULL, NULL, 'telefono', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026]'),
  ('2026-10-13', '15:00', 2, 'confirmada', 'Begoña Martínez', NULL, NULL, 'web', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026] Prefieren interior'),
  ('2026-10-13', '15:00', 4, 'confirmada', 'Raquel Molina Rubio', NULL, NULL, 'web', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026] Intolerancia a la lactosa'),
  ('2026-10-13', '20:00', 2, 'confirmada', 'Jesús Gil', NULL, NULL, 'web', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026]'),
  ('2026-10-13', '20:00', 2, 'confirmada', 'Jesús Martín', NULL, NULL, 'web', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026]'),
  ('2026-10-13', '21:00', 4, 'confirmada', 'Miguel Martín Romero', NULL, NULL, 'web', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026] Cumpleaños: traen tarta, ¿la guardáis en cámara?'),
  ('2026-10-13', '21:00', 6, 'confirmada', 'Marta Medina', NULL, NULL, 'web', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026]'),
  ('2026-10-13', '21:45', 4, 'confirmada', 'Sara Jiménez', NULL, NULL, 'manual', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026]'),
  ('2026-10-13', '22:00', 2, 'confirmada', 'Mario Romero Domínguez', NULL, NULL, 'web', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026] Alergia al marisco'),
  ('2026-10-13', '22:00', 3, 'confirmada', 'Antonio Jiménez', NULL, NULL, 'manual', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026] Alergia al marisco');

-- 2026-10-14 (miércoles): 14 reservas, 52 comensales
insert into public.reservas (fecha, hora, numero_comensales, estado, nombre, telefono, email, canal, marca, espacio_id, importante, en_blacklist, consentimiento_newsletter, notas_cliente) values
  ('2026-10-14', '14:00', 4, 'confirmada', 'Ignacio Morales Calvo', NULL, NULL, 'web', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026]'),
  ('2026-10-14', '14:45', 6, 'confirmada', 'Begoña González', NULL, NULL, 'telefono', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026] Vienen con carrito de bebé'),
  ('2026-10-14', '15:00', 2, 'confirmada', 'Miguel Gómez Herrera', NULL, NULL, 'web', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026]'),
  ('2026-10-14', '15:00', 2, 'confirmada', 'Miguel Alonso', NULL, NULL, 'web', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026]'),
  ('2026-10-14', '15:00', 2, 'confirmada', 'Diego Méndez León', NULL, NULL, 'telefono', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026]'),
  ('2026-10-14', '15:00', 4, 'confirmada', 'Francisco Hernández Morales', NULL, NULL, 'web', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026] Aniversario de boda'),
  ('2026-10-14', '15:00', 6, 'confirmada', 'Rubén Moreno Rodríguez', NULL, NULL, 'web', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026] Cumpleaños: traen tarta, ¿la guardáis en cámara?'),
  ('2026-10-14', '20:00', 2, 'confirmada', 'Begoña Peña Gallego', NULL, NULL, 'web', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026] Cena de trabajo, necesitan factura'),
  ('2026-10-14', '21:00', 5, 'confirmada', 'Óscar Torres', NULL, NULL, 'web', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026]'),
  ('2026-10-14', '21:00', 6, 'confirmada', 'Andrés Santos', NULL, NULL, 'web', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026]'),
  ('2026-10-14', '21:00', 7, 'confirmada', 'Lucía Domínguez Jiménez', NULL, NULL, 'web', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026]'),
  ('2026-10-14', '21:30', 2, 'confirmada', 'Iván Navarro', NULL, NULL, 'telefono', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026]'),
  ('2026-10-14', '22:00', 2, 'confirmada', 'Begoña Suárez Castro', NULL, NULL, 'web', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026]'),
  ('2026-10-14', '22:00', 2, 'confirmada', 'Alba Ortiz', NULL, NULL, 'web', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026] Una persona vegana');

-- 2026-10-15 (jueves): 25 reservas, 76 comensales
insert into public.reservas (fecha, hora, numero_comensales, estado, nombre, telefono, email, canal, marca, espacio_id, importante, en_blacklist, consentimiento_newsletter, notas_cliente) values
  ('2026-10-15', '13:00', 4, 'confirmada', 'Rocío López Vidal', NULL, NULL, 'web', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026]'),
  ('2026-10-15', '13:15', 2, 'confirmada', 'Jesús González Gil', NULL, NULL, 'telefono', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026]'),
  ('2026-10-15', '13:15', 2, 'confirmada', 'Alba Cabrera', NULL, NULL, 'telefono', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026]'),
  ('2026-10-15', '13:15', 2, 'confirmada', 'Lorena Martínez', NULL, NULL, 'telefono', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026]'),
  ('2026-10-15', '14:00', 2, 'confirmada', 'Víctor Calvo', NULL, NULL, 'web', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026]'),
  ('2026-10-15', '14:00', 2, 'confirmada', 'Alberto Delgado Prieto', NULL, NULL, 'web', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026]'),
  ('2026-10-15', '14:00', 2, 'confirmada', 'Laura Gutiérrez', NULL, NULL, 'telefono', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026]'),
  ('2026-10-15', '14:00', 3, 'confirmada', 'Silvia Vidal', NULL, NULL, 'web', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026]'),
  ('2026-10-15', '14:15', 4, 'confirmada', 'Hugo Gil', NULL, NULL, 'manual', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026] Comida de trabajo, necesitan factura'),
  ('2026-10-15', '14:30', 4, 'confirmada', 'Alba Pérez Rubio', NULL, NULL, 'manual', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026]'),
  ('2026-10-15', '15:15', 6, 'confirmada', 'Lorena Herrera', NULL, NULL, 'telefono', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026]'),
  ('2026-10-15', '15:45', 2, 'confirmada', 'Silvia Sanz García', NULL, NULL, 'telefono', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026]'),
  ('2026-10-15', '20:00', 2, 'confirmada', 'Ainhoa García', NULL, NULL, 'telefono', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026]'),
  ('2026-10-15', '20:00', 3, 'confirmada', 'Hugo Ramírez Ortiz', NULL, NULL, 'web', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026]'),
  ('2026-10-15', '20:30', 2, 'confirmada', 'Óscar Castillo Muñoz', NULL, NULL, 'manual', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026]'),
  ('2026-10-15', '21:00', 2, 'confirmada', 'Patricia Jiménez Díaz', NULL, NULL, 'web', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026]'),
  ('2026-10-15', '21:00', 2, 'confirmada', 'Manuel Garrido', NULL, NULL, 'telefono', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026]'),
  ('2026-10-15', '21:30', 3, 'confirmada', 'Sergio Romero', NULL, NULL, 'telefono', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026]'),
  ('2026-10-15', '21:30', 4, 'confirmada', 'Hugo Morales', NULL, NULL, 'manual', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026]'),
  ('2026-10-15', '21:30', 6, 'confirmada', 'Rocío Martín', NULL, NULL, 'telefono', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026]'),
  ('2026-10-15', '22:00', 2, 'confirmada', 'Iván Alonso Ruiz', NULL, NULL, 'web', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026]'),
  ('2026-10-15', '22:00', 3, 'confirmada', 'Víctor Gallego', NULL, NULL, 'web', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026] Piden mesa redonda'),
  ('2026-10-15', '22:00', 4, 'confirmada', 'Rubén Gil Moreno', NULL, NULL, 'web', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026] Dos tronas, por favor'),
  ('2026-10-15', '22:00', 4, 'confirmada', 'Silvia Muñoz Molina', NULL, NULL, 'web', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026] Intolerancia a la lactosa'),
  ('2026-10-15', '22:00', 4, 'confirmada', 'Jesús García Suárez', NULL, NULL, 'web', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026]');

-- 2026-10-16 (viernes): 50 reservas, 243 comensales
insert into public.reservas (fecha, hora, numero_comensales, estado, nombre, telefono, email, canal, marca, espacio_id, importante, en_blacklist, consentimiento_newsletter, notas_cliente) values
  ('2026-10-16', '13:00', 2, 'confirmada', 'Cristina Navarro', NULL, NULL, 'web', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026] Dos tronas, por favor'),
  ('2026-10-16', '13:00', 2, 'confirmada', 'Paula Méndez', NULL, NULL, 'web', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026] Comida de trabajo, necesitan factura'),
  ('2026-10-16', '13:30', 6, 'confirmada', 'David Ruiz', NULL, NULL, 'manual', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026]'),
  ('2026-10-16', '13:30', 10, 'confirmada', 'Silvia Peña', NULL, NULL, 'web', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026] Comida de empresa, factura a nombre de la empresa'),
  ('2026-10-16', '13:45', 3, 'confirmada', 'Paula Martínez', NULL, NULL, 'telefono', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026]'),
  ('2026-10-16', '13:45', 4, 'confirmada', 'Andrés Díaz Serrano', NULL, NULL, 'telefono', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026] Celebran una jubilación'),
  ('2026-10-16', '14:00', 2, 'confirmada', 'Silvia Garrido', NULL, NULL, 'web', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026]'),
  ('2026-10-16', '14:00', 2, 'confirmada', 'Adrián Díaz', NULL, NULL, 'web', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026]'),
  ('2026-10-16', '14:00', 3, 'confirmada', 'Carlos Herrera Ramírez', NULL, NULL, 'web', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026]'),
  ('2026-10-16', '14:00', 4, 'confirmada', 'Begoña Ramírez', NULL, NULL, 'web', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026] Comida de trabajo, necesitan factura'),
  ('2026-10-16', '14:00', 4, 'confirmada', 'Manuel Prieto Santos', NULL, NULL, 'web', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026]'),
  ('2026-10-16', '14:00', 4, 'confirmada', 'Beatriz Ramos', NULL, NULL, 'telefono', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026]'),
  ('2026-10-16', '14:00', 4, 'confirmada', 'Andrés Vázquez Suárez', NULL, NULL, 'web', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026] Una persona vegana'),
  ('2026-10-16', '14:00', 4, 'confirmada', 'Carmen Ramírez', NULL, NULL, 'web', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026]'),
  ('2026-10-16', '14:00', 6, 'confirmada', 'Carlos Rubio', NULL, NULL, 'telefono', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026]'),
  ('2026-10-16', '14:00', 9, 'confirmada', 'Lucía Gallego Cortés', NULL, NULL, 'telefono', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026] Comida de empresa, factura a nombre de la empresa'),
  ('2026-10-16', '14:15', 2, 'confirmada', 'Raúl Cano', NULL, NULL, 'telefono', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026]'),
  ('2026-10-16', '14:15', 2, 'confirmada', 'Marta González Rodríguez', NULL, NULL, 'manual', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026]'),
  ('2026-10-16', '14:15', 6, 'confirmada', 'Lucía Blanco', NULL, NULL, 'manual', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026] Piden mesa redonda'),
  ('2026-10-16', '14:30', 2, 'confirmada', 'Cristina Marín', NULL, NULL, 'telefono', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026]'),
  ('2026-10-16', '14:30', 8, 'confirmada', 'Marta Ruiz', NULL, NULL, 'telefono', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026]'),
  ('2026-10-16', '14:45', 5, 'confirmada', 'Julia Vidal', NULL, NULL, 'telefono', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026]'),
  ('2026-10-16', '14:45', 6, 'confirmada', 'Silvia González', NULL, NULL, 'telefono', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026]'),
  ('2026-10-16', '15:00', 4, 'confirmada', 'Ainhoa Blanco', NULL, NULL, 'web', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026]'),
  ('2026-10-16', '15:00', 6, 'confirmada', 'Mario Ruiz Peña', NULL, NULL, 'web', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026]'),
  ('2026-10-16', '20:00', 8, 'confirmada', 'Jesús Sanz', NULL, NULL, 'manual', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026] Llegarán unos 15 minutos tarde'),
  ('2026-10-16', '20:30', 3, 'confirmada', 'Inés Cortés', NULL, NULL, 'web', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026]'),
  ('2026-10-16', '20:30', 4, 'confirmada', 'Rocío Medina', NULL, NULL, 'web', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026]'),
  ('2026-10-16', '20:30', 5, 'confirmada', 'Lucía Navarro', NULL, NULL, 'telefono', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026]'),
  ('2026-10-16', '20:30', 9, 'confirmada', 'Gonzalo Calvo Herrera', NULL, NULL, 'manual', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026] Cena familiar, vienen los abuelos'),
  ('2026-10-16', '20:45', 4, 'confirmada', 'Teresa Álvarez Serrano', NULL, NULL, 'telefono', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026] Una persona vegana'),
  ('2026-10-16', '20:45', 6, 'confirmada', 'Silvia Delgado Martín', NULL, NULL, 'manual', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026]'),
  ('2026-10-16', '21:00', 3, 'confirmada', 'Álvaro Serrano', NULL, NULL, 'telefono', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026]'),
  ('2026-10-16', '21:00', 4, 'confirmada', 'Carlos Suárez', NULL, NULL, 'web', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026] Cena de trabajo, necesitan factura'),
  ('2026-10-16', '21:00', 12, 'confirmada', 'Irene Martín López', NULL, NULL, 'manual', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026] Reunión de antiguos alumnos'),
  ('2026-10-16', '21:15', 2, 'confirmada', 'Lorena León Vidal', NULL, NULL, 'telefono', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026] Persona en silla de ruedas: mesa accesible'),
  ('2026-10-16', '21:15', 2, 'confirmada', 'Carmen Martínez', NULL, NULL, 'telefono', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026] Sin cebolla ni ajo (alergia)'),
  ('2026-10-16', '21:30', 4, 'confirmada', 'Alberto García Alonso', NULL, NULL, 'web', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026] Prefieren interior'),
  ('2026-10-16', '21:30', 4, 'confirmada', 'María Vázquez', NULL, NULL, 'web', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026]'),
  ('2026-10-16', '21:30', 4, 'confirmada', 'Diego Díaz Moreno', NULL, NULL, 'manual', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026] Celíaco: todo sin gluten, por favor'),
  ('2026-10-16', '21:30', 4, 'confirmada', 'Pablo León', NULL, NULL, 'web', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026]'),
  ('2026-10-16', '21:30', 4, 'confirmada', 'María Delgado', NULL, NULL, 'telefono', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026]'),
  ('2026-10-16', '21:30', 4, 'confirmada', 'Ignacio Cabrera Pérez', NULL, NULL, 'web', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026]'),
  ('2026-10-16', '21:30', 5, 'confirmada', 'Víctor Rodríguez Gómez', NULL, NULL, 'manual', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026]'),
  ('2026-10-16', '21:30', 8, 'confirmada', 'José García', NULL, NULL, 'web', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026]'),
  ('2026-10-16', '21:30', 10, 'confirmada', 'Nuria Blanco', NULL, NULL, 'telefono', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026] Cena familiar, vienen los abuelos'),
  ('2026-10-16', '22:00', 4, 'confirmada', 'Montse Díaz', NULL, NULL, 'web', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026] Necesitan trona'),
  ('2026-10-16', '22:00', 8, 'confirmada', 'Carmen Gutiérrez', NULL, NULL, 'web', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026]'),
  ('2026-10-16', '22:00', 8, 'confirmada', 'María Blanco Vidal', NULL, NULL, 'manual', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026]'),
  ('2026-10-16', '22:30', 4, 'confirmada', 'Alberto González', NULL, NULL, 'web', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026]');

-- 2026-10-17 (sábado): 49 reservas, 255 comensales
insert into public.reservas (fecha, hora, numero_comensales, estado, nombre, telefono, email, canal, marca, espacio_id, importante, en_blacklist, consentimiento_newsletter, notas_cliente) values
  ('2026-10-17', '13:00', 2, 'confirmada', 'Silvia Vidal', NULL, NULL, 'web', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026] Una persona vegana'),
  ('2026-10-17', '13:30', 6, 'confirmada', 'Alberto Núñez', NULL, NULL, 'web', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026] Sin cebolla ni ajo (alergia)'),
  ('2026-10-17', '13:30', 6, 'confirmada', 'Sergio Hernández Gutiérrez', NULL, NULL, 'web', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026] Mesa junto a la ventana si puede ser'),
  ('2026-10-17', '13:30', 6, 'confirmada', 'Jesús Delgado', NULL, NULL, 'telefono', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026]'),
  ('2026-10-17', '13:30', 6, 'confirmada', 'Natalia Gómez', NULL, NULL, 'manual', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026]'),
  ('2026-10-17', '13:30', 8, 'confirmada', 'Ignacio Gutiérrez', NULL, NULL, 'manual', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026] Piden mesa redonda'),
  ('2026-10-17', '14:00', 2, 'confirmada', 'Ignacio Romero García', NULL, NULL, 'telefono', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026]'),
  ('2026-10-17', '14:00', 4, 'confirmada', 'Iván Muñoz', NULL, NULL, 'manual', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026] Celebran una jubilación'),
  ('2026-10-17', '14:00', 6, 'confirmada', 'Irene Fernández', NULL, NULL, 'web', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026]'),
  ('2026-10-17', '14:15', 4, 'confirmada', 'Sara Domínguez Delgado', NULL, NULL, 'telefono', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026]'),
  ('2026-10-17', '14:30', 3, 'confirmada', 'Elena Prieto', NULL, NULL, 'web', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026]'),
  ('2026-10-17', '14:30', 4, 'confirmada', 'Diego Herrera Gómez', NULL, NULL, 'telefono', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026]'),
  ('2026-10-17', '14:30', 4, 'confirmada', 'Sergio Marín Lozano', NULL, NULL, 'web', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026]'),
  ('2026-10-17', '14:30', 7, 'confirmada', 'Carlos Sanz', NULL, NULL, 'web', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026]'),
  ('2026-10-17', '14:30', 12, 'confirmada', 'Nuria Gil', NULL, NULL, 'telefono', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026] Comida familiar, vienen los abuelos'),
  ('2026-10-17', '14:45', 4, 'confirmada', 'David Sanz', NULL, NULL, 'telefono', 'casa_tomas', NULL, true, false, false, '[DEMO-SEED][oct-2026]'),
  ('2026-10-17', '14:45', 6, 'confirmada', 'María Garrido Cabrera', NULL, NULL, 'manual', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026]'),
  ('2026-10-17', '15:00', 4, 'confirmada', 'Ana Morales', NULL, NULL, 'telefono', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026]'),
  ('2026-10-17', '15:00', 4, 'confirmada', 'Pablo Álvarez', NULL, NULL, 'telefono', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026]'),
  ('2026-10-17', '15:00', 4, 'confirmada', 'Silvia Gutiérrez Ramos', NULL, NULL, 'web', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026]'),
  ('2026-10-17', '15:00', 5, 'confirmada', 'Jorge Gallego Ramos', NULL, NULL, 'web', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026]'),
  ('2026-10-17', '15:30', 3, 'confirmada', 'Hugo Ramos Navarro', NULL, NULL, 'web', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026]'),
  ('2026-10-17', '15:30', 4, 'confirmada', 'Sara Márquez', NULL, NULL, 'web', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026]'),
  ('2026-10-17', '15:30', 5, 'confirmada', 'Andrés Pérez', NULL, NULL, 'web', 'casa_tomas', NULL, true, false, false, '[DEMO-SEED][oct-2026]'),
  ('2026-10-17', '20:30', 4, 'confirmada', 'Montse León', NULL, NULL, 'manual', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026] Mesa junto a la ventana si puede ser'),
  ('2026-10-17', '20:30', 6, 'confirmada', 'Víctor Martínez', NULL, NULL, 'manual', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026]'),
  ('2026-10-17', '20:30', 16, 'confirmada', 'Gonzalo Gómez', NULL, NULL, 'manual', 'casa_tomas', NULL, true, false, false, '[DEMO-SEED][oct-2026] Reunión de antiguos alumnos'),
  ('2026-10-17', '21:00', 2, 'confirmada', 'Ignacio Ortega Cabrera', NULL, NULL, 'telefono', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026] Mesa tranquila si es posible'),
  ('2026-10-17', '21:00', 3, 'confirmada', 'Clara Fernández', NULL, NULL, 'web', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026]'),
  ('2026-10-17', '21:00', 4, 'confirmada', 'Daniel León Cruz', NULL, NULL, 'web', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026]'),
  ('2026-10-17', '21:00', 4, 'confirmada', 'Rafael León', NULL, NULL, 'web', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026] Cumpleaños, una vela en el postre'),
  ('2026-10-17', '21:00', 9, 'confirmada', 'José Muñoz Ruiz', NULL, NULL, 'telefono', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026] Reunión de antiguos alumnos'),
  ('2026-10-17', '21:15', 5, 'confirmada', 'María Iglesias', NULL, NULL, 'telefono', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026]'),
  ('2026-10-17', '21:30', 2, 'confirmada', 'Lorena Garrido', NULL, NULL, 'web', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026]'),
  ('2026-10-17', '21:30', 4, 'confirmada', 'Montse Díaz Romero', NULL, NULL, 'web', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026]'),
  ('2026-10-17', '21:30', 4, 'confirmada', 'Carlos Prieto', NULL, NULL, 'web', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026]'),
  ('2026-10-17', '21:30', 6, 'confirmada', 'Raúl Torres', NULL, NULL, 'web', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026] Mesa junto a la ventana si puede ser'),
  ('2026-10-17', '21:30', 6, 'confirmada', 'Jesús Gómez Navarro', NULL, NULL, 'web', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026]'),
  ('2026-10-17', '21:30', 6, 'confirmada', 'Diego Rodríguez', NULL, NULL, 'telefono', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026]'),
  ('2026-10-17', '21:30', 8, 'confirmada', 'David Ramos Ruiz', NULL, NULL, 'web', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026]'),
  ('2026-10-17', '21:45', 5, 'confirmada', 'Marta López', NULL, NULL, 'telefono', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026] Prefieren interior'),
  ('2026-10-17', '21:45', 6, 'confirmada', 'Gonzalo Navarro', NULL, NULL, 'manual', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026] Vienen con carrito de bebé'),
  ('2026-10-17', '22:00', 4, 'confirmada', 'Lorena Romero', NULL, NULL, 'web', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026]'),
  ('2026-10-17', '22:00', 4, 'confirmada', 'Ana Gallego', NULL, NULL, 'web', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026]'),
  ('2026-10-17', '22:00', 4, 'confirmada', 'Silvia Santos', NULL, NULL, 'web', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026]'),
  ('2026-10-17', '22:00', 4, 'confirmada', 'Paula Blanco', NULL, NULL, 'telefono', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026]'),
  ('2026-10-17', '22:00', 6, 'confirmada', 'Antonio Medina', NULL, NULL, 'manual', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026] Llegarán unos 15 minutos tarde'),
  ('2026-10-17', '22:00', 6, 'confirmada', 'Natalia Romero Medina', NULL, NULL, 'web', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026] Mesa junto a la ventana si puede ser'),
  ('2026-10-17', '22:00', 8, 'confirmada', 'Antonio Rodríguez', NULL, NULL, 'web', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026]');

-- 2026-10-18 (domingo): 29 reservas, 134 comensales
insert into public.reservas (fecha, hora, numero_comensales, estado, nombre, telefono, email, canal, marca, espacio_id, importante, en_blacklist, consentimiento_newsletter, notas_cliente) values
  ('2026-10-18', '13:00', 2, 'confirmada', 'Alba León Rubio', NULL, NULL, 'web', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026] Piden mesa redonda'),
  ('2026-10-18', '13:00', 2, 'confirmada', 'Cristina López', NULL, NULL, 'web', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026]'),
  ('2026-10-18', '13:00', 4, 'confirmada', 'Alba Cano', NULL, NULL, 'manual', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026]'),
  ('2026-10-18', '13:15', 2, 'confirmada', 'David García', NULL, NULL, 'telefono', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026]'),
  ('2026-10-18', '13:15', 4, 'confirmada', 'Marta Guerrero', NULL, NULL, 'telefono', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026]'),
  ('2026-10-18', '13:30', 8, 'confirmada', 'Paula Sánchez', NULL, NULL, 'telefono', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026]'),
  ('2026-10-18', '13:30', 12, 'confirmada', 'Carmen Rubio Delgado', NULL, NULL, 'telefono', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026] Comida de peña, quieren menú cerrado'),
  ('2026-10-18', '13:45', 8, 'confirmada', 'Víctor Medina Ortega', NULL, NULL, 'telefono', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026] Mesa junto a la ventana si puede ser'),
  ('2026-10-18', '14:00', 2, 'confirmada', 'Marta Alonso', NULL, NULL, 'web', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026]'),
  ('2026-10-18', '14:00', 4, 'confirmada', 'Jesús Ortiz', NULL, NULL, 'web', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026]'),
  ('2026-10-18', '14:00', 4, 'confirmada', 'Sergio Pérez Ortiz', NULL, NULL, 'manual', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026] Aniversario de boda'),
  ('2026-10-18', '14:00', 4, 'confirmada', 'Julia Muñoz', NULL, NULL, 'web', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026] Cumpleaños, una vela en el postre'),
  ('2026-10-18', '14:00', 4, 'confirmada', 'Paula León', NULL, NULL, 'web', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026]'),
  ('2026-10-18', '14:00', 6, 'confirmada', 'Elena Gutiérrez Delgado', NULL, NULL, 'web', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026]'),
  ('2026-10-18', '14:00', 9, 'confirmada', 'Sergio Iglesias', NULL, NULL, 'manual', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026] Bautizo: varios niños, necesitan 2 tronas'),
  ('2026-10-18', '14:15', 5, 'confirmada', 'Alejandro Jiménez Herrera', NULL, NULL, 'telefono', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026]'),
  ('2026-10-18', '14:30', 6, 'confirmada', 'Ignacio Díaz Ruiz', NULL, NULL, 'manual', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026] Dos tronas, por favor'),
  ('2026-10-18', '14:30', 7, 'confirmada', 'Teresa Lozano', NULL, NULL, 'telefono', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026]'),
  ('2026-10-18', '15:00', 2, 'confirmada', 'José Serrano Peña', NULL, NULL, 'web', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026]'),
  ('2026-10-18', '15:00', 4, 'confirmada', 'Begoña León González', NULL, NULL, 'manual', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026]'),
  ('2026-10-18', '15:00', 6, 'confirmada', 'Julia Navarro Gil', NULL, NULL, 'telefono', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026]'),
  ('2026-10-18', '15:30', 6, 'confirmada', 'Mario Serrano Molina', NULL, NULL, 'telefono', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026]'),
  ('2026-10-18', '20:00', 2, 'confirmada', 'Silvia García', NULL, NULL, 'web', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026] Aniversario de boda'),
  ('2026-10-18', '20:30', 3, 'confirmada', 'Carmen Castillo', NULL, NULL, 'telefono', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026]'),
  ('2026-10-18', '21:00', 2, 'confirmada', 'Julia Calvo Molina', NULL, NULL, 'web', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026] Prefieren interior'),
  ('2026-10-18', '21:00', 4, 'confirmada', 'Daniel Vázquez Ramírez', NULL, NULL, 'telefono', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026]'),
  ('2026-10-18', '21:00', 5, 'confirmada', 'Montse Ruiz García', NULL, NULL, 'manual', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026]'),
  ('2026-10-18', '22:00', 3, 'confirmada', 'Alberto Lozano', NULL, NULL, 'telefono', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026] Mesa junto a la ventana si puede ser'),
  ('2026-10-18', '22:00', 4, 'confirmada', 'Lorena Alonso', NULL, NULL, 'web', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026]');

-- 2026-10-19 (lunes): 12 reservas, 31 comensales
insert into public.reservas (fecha, hora, numero_comensales, estado, nombre, telefono, email, canal, marca, espacio_id, importante, en_blacklist, consentimiento_newsletter, notas_cliente) values
  ('2026-10-19', '13:15', 2, 'confirmada', 'Andrés Cortés', NULL, NULL, 'manual', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026]'),
  ('2026-10-19', '14:00', 2, 'confirmada', 'Montse Castillo', NULL, NULL, 'web', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026]'),
  ('2026-10-19', '14:00', 3, 'confirmada', 'Óscar Hernández', NULL, NULL, 'telefono', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026]'),
  ('2026-10-19', '14:00', 6, 'confirmada', 'Víctor García Gutiérrez', NULL, NULL, 'web', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026]'),
  ('2026-10-19', '14:45', 2, 'confirmada', 'Rubén Ruiz', NULL, NULL, 'manual', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026] Aniversario de boda'),
  ('2026-10-19', '15:00', 2, 'confirmada', 'Miguel Domínguez', NULL, NULL, 'web', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026]'),
  ('2026-10-19', '20:30', 2, 'confirmada', 'Fernando Martínez Gil', NULL, NULL, 'telefono', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026]'),
  ('2026-10-19', '20:45', 3, 'confirmada', 'Alba Garrido', NULL, NULL, 'telefono', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026]'),
  ('2026-10-19', '21:00', 2, 'confirmada', 'Noelia García', NULL, NULL, 'web', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026] Intolerancia a la lactosa'),
  ('2026-10-19', '21:30', 2, 'confirmada', 'Clara López Sanz', NULL, NULL, 'manual', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026]'),
  ('2026-10-19', '21:30', 3, 'confirmada', 'Carlos López', NULL, NULL, 'telefono', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026]'),
  ('2026-10-19', '22:00', 2, 'confirmada', 'José Romero', NULL, NULL, 'web', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026] Prefieren interior');

-- 2026-10-20 (martes): 10 reservas, 30 comensales
insert into public.reservas (fecha, hora, numero_comensales, estado, nombre, telefono, email, canal, marca, espacio_id, importante, en_blacklist, consentimiento_newsletter, notas_cliente) values
  ('2026-10-20', '14:00', 3, 'confirmada', 'Diego Calvo', NULL, NULL, 'telefono', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026]'),
  ('2026-10-20', '15:00', 2, 'confirmada', 'Elena Ruiz', NULL, NULL, 'manual', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026] Sin cebolla ni ajo (alergia)'),
  ('2026-10-20', '15:00', 3, 'confirmada', 'María Iglesias', NULL, NULL, 'web', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026] Embarazada: nada crudo ni poco hecho'),
  ('2026-10-20', '15:00', 3, 'confirmada', 'Montse Prieto', NULL, NULL, 'web', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026]'),
  ('2026-10-20', '15:00', 4, 'confirmada', 'Gonzalo Ortiz', NULL, NULL, 'manual', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026] Intolerancia a la lactosa'),
  ('2026-10-20', '15:30', 2, 'confirmada', 'Jorge Cruz Peña', NULL, NULL, 'telefono', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026] Intolerancia a la lactosa'),
  ('2026-10-20', '21:00', 2, 'confirmada', 'Daniel Gil Moreno', NULL, NULL, 'web', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026] Clientes habituales'),
  ('2026-10-20', '21:00', 2, 'confirmada', 'Pablo Ramos', NULL, NULL, 'web', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026]'),
  ('2026-10-20', '21:00', 4, 'confirmada', 'Begoña Iglesias', NULL, NULL, 'web', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026]'),
  ('2026-10-20', '21:00', 5, 'confirmada', 'Manuel Domínguez', NULL, NULL, 'web', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026] Mesa tranquila si es posible');

-- 2026-10-21 (miércoles): 8 reservas, 34 comensales
insert into public.reservas (fecha, hora, numero_comensales, estado, nombre, telefono, email, canal, marca, espacio_id, importante, en_blacklist, consentimiento_newsletter, notas_cliente) values
  ('2026-10-21', '14:00', 3, 'confirmada', 'Jorge González', NULL, NULL, 'web', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026]'),
  ('2026-10-21', '14:30', 6, 'confirmada', 'Fernando González González', NULL, NULL, 'telefono', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026] Prefieren terraza si hace bueno'),
  ('2026-10-21', '15:00', 8, 'confirmada', 'Paula Pérez Gallego', NULL, NULL, 'manual', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026]'),
  ('2026-10-21', '20:45', 2, 'confirmada', 'Rocío González', NULL, NULL, 'manual', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026]'),
  ('2026-10-21', '21:30', 5, 'confirmada', 'David Suárez', NULL, NULL, 'manual', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026]'),
  ('2026-10-21', '22:00', 2, 'confirmada', 'Diego González González', NULL, NULL, 'web', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026]'),
  ('2026-10-21', '22:15', 4, 'confirmada', 'Pablo González', NULL, NULL, 'manual', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026]'),
  ('2026-10-21', '22:30', 4, 'confirmada', 'Nuria Suárez Iglesias', NULL, NULL, 'telefono', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026] Una persona vegana');

-- 2026-10-22 (jueves): 10 reservas, 46 comensales
insert into public.reservas (fecha, hora, numero_comensales, estado, nombre, telefono, email, canal, marca, espacio_id, importante, en_blacklist, consentimiento_newsletter, notas_cliente) values
  ('2026-10-22', '14:00', 10, 'confirmada', 'Paula Sánchez', NULL, NULL, 'web', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026] Cumpleaños de 40: traen decoración'),
  ('2026-10-22', '14:30', 4, 'confirmada', 'Montse Morales', NULL, NULL, 'telefono', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026]'),
  ('2026-10-22', '14:45', 4, 'confirmada', 'Ainhoa García Marín', NULL, NULL, 'telefono', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026]'),
  ('2026-10-22', '15:00', 4, 'confirmada', 'Julia Vázquez', NULL, NULL, 'web', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026]'),
  ('2026-10-22', '20:45', 2, 'confirmada', 'Iván Gil', NULL, NULL, 'manual', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026]'),
  ('2026-10-22', '21:00', 2, 'confirmada', 'Raúl León Vidal', NULL, NULL, 'web', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026]'),
  ('2026-10-22', '21:00', 4, 'confirmada', 'Paula Delgado Hernández', NULL, NULL, 'web', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026]'),
  ('2026-10-22', '21:00', 4, 'confirmada', 'Inés Martín', NULL, NULL, 'web', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026]'),
  ('2026-10-22', '21:00', 4, 'confirmada', 'Rubén Molina', NULL, NULL, 'manual', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026]'),
  ('2026-10-22', '22:00', 8, 'confirmada', 'Carmen Moreno', NULL, NULL, 'web', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026] Mesa junto a la ventana si puede ser');

-- 2026-10-23 (viernes): 42 reservas, 187 comensales
insert into public.reservas (fecha, hora, numero_comensales, estado, nombre, telefono, email, canal, marca, espacio_id, importante, en_blacklist, consentimiento_newsletter, notas_cliente) values
  ('2026-10-23', '13:00', 2, 'confirmada', 'José Calvo Cortés', NULL, NULL, 'web', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026]'),
  ('2026-10-23', '13:00', 4, 'confirmada', 'Rocío Ortega Iglesias', NULL, NULL, 'web', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026]'),
  ('2026-10-23', '13:00', 6, 'confirmada', 'Sara Cortés', NULL, NULL, 'manual', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026]'),
  ('2026-10-23', '13:30', 10, 'confirmada', 'Raúl Méndez Pérez', NULL, NULL, 'manual', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026] Despedida de soltera'),
  ('2026-10-23', '13:45', 2, 'confirmada', 'Begoña Díaz Cabrera', NULL, NULL, 'telefono', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026] Piden mesa redonda'),
  ('2026-10-23', '13:45', 4, 'confirmada', 'José García', NULL, NULL, 'manual', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026]'),
  ('2026-10-23', '14:00', 2, 'confirmada', 'José Calvo', NULL, NULL, 'web', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026]'),
  ('2026-10-23', '14:00', 2, 'confirmada', 'Nuria Fernández', NULL, NULL, 'web', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026]'),
  ('2026-10-23', '14:00', 4, 'confirmada', 'Lucía Sanz Cortés', NULL, NULL, 'web', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026]'),
  ('2026-10-23', '14:00', 5, 'confirmada', 'Víctor Romero Medina', NULL, NULL, 'web', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026]'),
  ('2026-10-23', '14:00', 6, 'confirmada', 'Raquel Lozano', NULL, NULL, 'web', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026]'),
  ('2026-10-23', '14:00', 6, 'confirmada', 'Adrián González Álvarez', NULL, NULL, 'web', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026]'),
  ('2026-10-23', '14:00', 9, 'confirmada', 'Alberto Ruiz Iglesias', NULL, NULL, 'telefono', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026] Celebración de jubilación, menú cerrado'),
  ('2026-10-23', '14:15', 6, 'confirmada', 'Lucía León Jiménez', NULL, NULL, 'telefono', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026]'),
  ('2026-10-23', '14:30', 10, 'confirmada', 'Isabel Torres', NULL, NULL, 'manual', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026] Celebración de jubilación, menú cerrado'),
  ('2026-10-23', '15:00', 2, 'confirmada', 'Lucía González Blanco', NULL, NULL, 'web', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026]'),
  ('2026-10-23', '15:00', 5, 'confirmada', 'Patricia Ramos Romero', NULL, NULL, 'web', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026]'),
  ('2026-10-23', '20:00', 2, 'confirmada', 'Noelia Vidal', NULL, NULL, 'web', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026] Cumpleaños: traen tarta, ¿la guardáis en cámara?'),
  ('2026-10-23', '20:00', 2, 'confirmada', 'Alba Marín', NULL, NULL, 'web', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026]'),
  ('2026-10-23', '20:00', 3, 'confirmada', 'Natalia Díaz', NULL, NULL, 'web', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026] Piden mesa redonda'),
  ('2026-10-23', '20:30', 2, 'confirmada', 'Laura Torres Prieto', NULL, NULL, 'telefono', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026] Mesa junto a la ventana si puede ser'),
  ('2026-10-23', '20:30', 2, 'confirmada', 'Sara Pérez', NULL, NULL, 'telefono', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026]'),
  ('2026-10-23', '20:30', 9, 'confirmada', 'Alejandro Morales', NULL, NULL, 'telefono', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026] Despedida de soltero'),
  ('2026-10-23', '21:00', 3, 'confirmada', 'Mario Hernández', NULL, NULL, 'web', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026]'),
  ('2026-10-23', '21:00', 4, 'confirmada', 'Patricia García', NULL, NULL, 'web', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026]'),
  ('2026-10-23', '21:00', 5, 'confirmada', 'Lorena Gutiérrez', NULL, NULL, 'web', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026]'),
  ('2026-10-23', '21:00', 6, 'confirmada', 'Pilar Gil Torres', NULL, NULL, 'web', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026] Cumpleaños: traen tarta, ¿la guardáis en cámara?'),
  ('2026-10-23', '21:00', 6, 'confirmada', 'Raúl Núñez', NULL, NULL, 'web', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026]'),
  ('2026-10-23', '21:00', 6, 'confirmada', 'Jesús Garrido Cabrera', NULL, NULL, 'web', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026] Dos vegetarianos'),
  ('2026-10-23', '21:00', 10, 'confirmada', 'Andrés Castillo Domínguez', NULL, NULL, 'manual', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026] Cena de peña, quieren menú cerrado'),
  ('2026-10-23', '21:15', 2, 'confirmada', 'Sergio Marín', NULL, NULL, 'telefono', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026]'),
  ('2026-10-23', '21:30', 2, 'confirmada', 'Rocío Ramos', NULL, NULL, 'manual', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026] Alergia al marisco'),
  ('2026-10-23', '21:30', 7, 'confirmada', 'Marta Lozano', NULL, NULL, 'telefono', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026]'),
  ('2026-10-23', '21:45', 2, 'confirmada', 'Begoña Cano', NULL, NULL, 'telefono', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026]'),
  ('2026-10-23', '21:45', 2, 'confirmada', 'Adrián Cruz', NULL, NULL, 'telefono', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026]'),
  ('2026-10-23', '22:00', 2, 'confirmada', 'Marta Marín Iglesias', NULL, NULL, 'web', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026]'),
  ('2026-10-23', '22:00', 2, 'confirmada', 'Inés Hernández', NULL, NULL, 'web', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026]'),
  ('2026-10-23', '22:00', 3, 'confirmada', 'Lorena Suárez', NULL, NULL, 'web', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026]'),
  ('2026-10-23', '22:00', 4, 'confirmada', 'Rafael Gil', NULL, NULL, 'web', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026]'),
  ('2026-10-23', '22:00', 4, 'confirmada', 'Raquel Gutiérrez', NULL, NULL, 'web', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026] Una persona vegana'),
  ('2026-10-23', '22:00', 4, 'confirmada', 'Silvia Domínguez', NULL, NULL, 'web', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026] Cumpleaños: traen tarta, ¿la guardáis en cámara?'),
  ('2026-10-23', '22:00', 8, 'confirmada', 'Lucía Morales', NULL, NULL, 'web', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026] Piden mesa redonda');

-- 2026-10-24 (sábado): 38 reservas, 197 comensales
insert into public.reservas (fecha, hora, numero_comensales, estado, nombre, telefono, email, canal, marca, espacio_id, importante, en_blacklist, consentimiento_newsletter, notas_cliente) values
  ('2026-10-24', '13:00', 3, 'confirmada', 'Antonio Marín', NULL, NULL, 'web', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026]'),
  ('2026-10-24', '13:15', 2, 'confirmada', 'Begoña Torres Márquez', NULL, NULL, 'manual', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026]'),
  ('2026-10-24', '14:00', 2, 'confirmada', 'Víctor Ortiz Álvarez', NULL, NULL, 'web', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026]'),
  ('2026-10-24', '14:00', 4, 'confirmada', 'Alejandro González', NULL, NULL, 'web', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026]'),
  ('2026-10-24', '14:00', 10, 'confirmada', 'Rubén Gómez', NULL, NULL, 'manual', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026] Despedida de soltero'),
  ('2026-10-24', '14:00', 10, 'confirmada', 'Marta Herrera Cabrera', NULL, NULL, 'telefono', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026] Despedida de soltera'),
  ('2026-10-24', '14:00', 10, 'confirmada', 'Isabel Sánchez', NULL, NULL, 'manual', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026] Celebración de jubilación, menú cerrado'),
  ('2026-10-24', '14:00', 11, 'confirmada', 'Montse Garrido Martín', NULL, NULL, 'manual', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026] Despedida de soltero'),
  ('2026-10-24', '14:30', 3, 'confirmada', 'Patricia Prieto Vázquez', NULL, NULL, 'telefono', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026]'),
  ('2026-10-24', '14:30', 11, 'confirmada', 'Antonio Fernández', NULL, NULL, 'web', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026] Celebración de jubilación, menú cerrado'),
  ('2026-10-24', '14:30', 11, 'confirmada', 'Iván Lozano', NULL, NULL, 'manual', 'casa_tomas', NULL, true, false, false, '[DEMO-SEED][oct-2026] Grupo de senderismo, llegan todos a la vez'),
  ('2026-10-24', '15:00', 4, 'confirmada', 'Rafael Márquez', NULL, NULL, 'web', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026]'),
  ('2026-10-24', '15:15', 4, 'confirmada', 'Inés Gómez', NULL, NULL, 'telefono', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026] Piden mesa redonda'),
  ('2026-10-24', '15:45', 3, 'confirmada', 'Diego Medina', NULL, NULL, 'manual', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026] Una persona vegana'),
  ('2026-10-24', '20:15', 4, 'confirmada', 'Carlos Álvarez', NULL, NULL, 'manual', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026] Cena de trabajo, necesitan factura'),
  ('2026-10-24', '21:00', 2, 'confirmada', 'Paula Navarro Cano', NULL, NULL, 'telefono', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026] Celíaco: todo sin gluten, por favor'),
  ('2026-10-24', '21:00', 2, 'confirmada', 'Pablo Marín', NULL, NULL, 'web', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026]'),
  ('2026-10-24', '21:00', 3, 'confirmada', 'Sara Alonso', NULL, NULL, 'web', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026]'),
  ('2026-10-24', '21:00', 4, 'confirmada', 'Irene Molina', NULL, NULL, 'web', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026]'),
  ('2026-10-24', '21:00', 5, 'confirmada', 'Ana Herrera Gómez', NULL, NULL, 'web', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026] Persona en silla de ruedas: mesa accesible'),
  ('2026-10-24', '21:00', 5, 'confirmada', 'Mario León', NULL, NULL, 'web', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026] Celebran una jubilación'),
  ('2026-10-24', '21:00', 6, 'confirmada', 'Rafael Vázquez', NULL, NULL, 'web', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026]'),
  ('2026-10-24', '21:00', 6, 'confirmada', 'Clara Ruiz Vázquez', NULL, NULL, 'telefono', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026]'),
  ('2026-10-24', '21:00', 6, 'confirmada', 'Rafael Ortiz', NULL, NULL, 'telefono', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026]'),
  ('2026-10-24', '21:30', 10, 'confirmada', 'Ana Méndez', NULL, NULL, 'telefono', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026] Cena de empresa, factura a nombre de la empresa'),
  ('2026-10-24', '21:30', 12, 'confirmada', 'Diego Ramos', NULL, NULL, 'web', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026] Despedida de soltera'),
  ('2026-10-24', '21:45', 5, 'confirmada', 'Hugo Domínguez', NULL, NULL, 'telefono', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026]'),
  ('2026-10-24', '21:45', 6, 'confirmada', 'Alejandro Cano', NULL, NULL, 'manual', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026] Alergia a frutos secos'),
  ('2026-10-24', '22:00', 2, 'confirmada', 'Nuria Suárez Jiménez', NULL, NULL, 'web', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026] Mesa junto a la ventana si puede ser'),
  ('2026-10-24', '22:00', 2, 'confirmada', 'Irene Molina', NULL, NULL, 'telefono', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026]'),
  ('2026-10-24', '22:00', 2, 'confirmada', 'Teresa Molina', NULL, NULL, 'web', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026] Intolerancia a la lactosa'),
  ('2026-10-24', '22:00', 4, 'confirmada', 'Clara Díaz', NULL, NULL, 'web', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026]'),
  ('2026-10-24', '22:00', 4, 'confirmada', 'Sergio Ortega López', NULL, NULL, 'web', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026]'),
  ('2026-10-24', '22:00', 4, 'confirmada', 'Cristina Moreno', NULL, NULL, 'telefono', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026] Primera visita, vienen recomendados'),
  ('2026-10-24', '22:30', 2, 'confirmada', 'María Ramírez', NULL, NULL, 'manual', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026]'),
  ('2026-10-24', '22:30', 2, 'confirmada', 'Noelia Garrido Vázquez', NULL, NULL, 'telefono', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026] Prefieren terraza si hace bueno'),
  ('2026-10-24', '22:30', 5, 'confirmada', 'Miguel Calvo', NULL, NULL, 'manual', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026] Piden mesa redonda'),
  ('2026-10-24', '22:30', 6, 'confirmada', 'Óscar Fernández', NULL, NULL, 'manual', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026]');

-- 2026-10-25 (domingo): 21 reservas, 104 comensales
insert into public.reservas (fecha, hora, numero_comensales, estado, nombre, telefono, email, canal, marca, espacio_id, importante, en_blacklist, consentimiento_newsletter, notas_cliente) values
  ('2026-10-25', '13:00', 2, 'confirmada', 'Montse Blanco Domínguez', NULL, NULL, 'web', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026] Cambio de hora: confirman que vienen a la hora nueva'),
  ('2026-10-25', '13:15', 6, 'confirmada', 'Diego Santos Rubio', NULL, NULL, 'telefono', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026]'),
  ('2026-10-25', '13:30', 2, 'confirmada', 'Andrés Moreno Lozano', NULL, NULL, 'telefono', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026]'),
  ('2026-10-25', '13:30', 8, 'confirmada', 'Clara Jiménez', NULL, NULL, 'telefono', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026] Vienen con carrito de bebé'),
  ('2026-10-25', '13:30', 10, 'confirmada', 'Daniel Ramírez', NULL, NULL, 'telefono', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026] Despedida de soltera'),
  ('2026-10-25', '13:30', 12, 'confirmada', 'Diego Guerrero', NULL, NULL, 'web', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026] Comida de empresa, factura a nombre de la empresa'),
  ('2026-10-25', '14:00', 2, 'confirmada', 'Fernando Herrera Blanco', NULL, NULL, 'web', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026] Vienen con perro pequeño (terraza)'),
  ('2026-10-25', '14:00', 2, 'confirmada', 'Cristina Cano', NULL, NULL, 'web', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026]'),
  ('2026-10-25', '14:00', 2, 'confirmada', 'Francisco Ramírez', NULL, NULL, 'web', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026] Piden mesa redonda'),
  ('2026-10-25', '14:00', 3, 'confirmada', 'Natalia Morales', NULL, NULL, 'web', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026] Cambio de hora: confirman que vienen a la hora nueva'),
  ('2026-10-25', '14:00', 6, 'confirmada', 'Pilar Marín', NULL, NULL, 'telefono', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026] Prefieren terraza si hace bueno'),
  ('2026-10-25', '14:30', 11, 'confirmada', 'Fernando Martínez', NULL, NULL, 'manual', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026] Despedida de soltera'),
  ('2026-10-25', '14:30', 11, 'confirmada', 'Fernando Suárez', NULL, NULL, 'telefono', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026] Comida de empresa, factura a nombre de la empresa'),
  ('2026-10-25', '15:00', 4, 'confirmada', 'Pilar Guerrero Castillo', NULL, NULL, 'web', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026] Mesa junto a la ventana si puede ser'),
  ('2026-10-25', '15:00', 4, 'confirmada', 'José Marín', NULL, NULL, 'web', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026] Cambio de hora: confirman que vienen a la hora nueva'),
  ('2026-10-25', '15:15', 2, 'confirmada', 'Natalia Rubio', NULL, NULL, 'manual', 'casa_tomas', NULL, true, false, false, '[DEMO-SEED][oct-2026]'),
  ('2026-10-25', '20:00', 2, 'confirmada', 'Montse Castillo Rubio', NULL, NULL, 'web', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026]'),
  ('2026-10-25', '20:00', 2, 'confirmada', 'Rubén Marín', NULL, NULL, 'web', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026]'),
  ('2026-10-25', '20:00', 4, 'confirmada', 'Elena Ortega', NULL, NULL, 'web', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026]'),
  ('2026-10-25', '21:00', 3, 'confirmada', 'Rocío León', NULL, NULL, 'web', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026]'),
  ('2026-10-25', '22:00', 6, 'confirmada', 'Fernando Álvarez', NULL, NULL, 'web', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026] Cambio de hora: confirman que vienen a la hora nueva');

-- 2026-10-26 (lunes): 5 reservas, 22 comensales
insert into public.reservas (fecha, hora, numero_comensales, estado, nombre, telefono, email, canal, marca, espacio_id, importante, en_blacklist, consentimiento_newsletter, notas_cliente) values
  ('2026-10-26', '14:00', 6, 'confirmada', 'Carlos Ramírez', NULL, NULL, 'web', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026] Comida de trabajo, necesitan factura'),
  ('2026-10-26', '14:45', 3, 'confirmada', 'Álvaro León Serrano', NULL, NULL, 'manual', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026]'),
  ('2026-10-26', '15:00', 3, 'confirmada', 'Cristina Sánchez Medina', NULL, NULL, 'web', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026] Prefieren interior'),
  ('2026-10-26', '21:00', 2, 'confirmada', 'Begoña Blanco', NULL, NULL, 'web', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026] Clientes habituales'),
  ('2026-10-26', '22:00', 8, 'confirmada', 'Raúl González', NULL, NULL, 'web', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026]');

-- 2026-10-27 (martes): 5 reservas, 22 comensales
insert into public.reservas (fecha, hora, numero_comensales, estado, nombre, telefono, email, canal, marca, espacio_id, importante, en_blacklist, consentimiento_newsletter, notas_cliente) values
  ('2026-10-27', '14:00', 4, 'confirmada', 'Óscar León', NULL, NULL, 'web', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026] Sin cebolla ni ajo (alergia)'),
  ('2026-10-27', '15:00', 8, 'confirmada', 'Manuel Sanz', NULL, NULL, 'telefono', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026]'),
  ('2026-10-27', '21:00', 2, 'confirmada', 'Carlos Gallego', NULL, NULL, 'web', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026] Dos vegetarianos'),
  ('2026-10-27', '21:30', 4, 'confirmada', 'Alberto Medina', NULL, NULL, 'telefono', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026]'),
  ('2026-10-27', '22:30', 4, 'confirmada', 'Clara Rubio', NULL, NULL, 'telefono', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026]');

-- 2026-10-28 (miércoles): 8 reservas, 26 comensales
insert into public.reservas (fecha, hora, numero_comensales, estado, nombre, telefono, email, canal, marca, espacio_id, importante, en_blacklist, consentimiento_newsletter, notas_cliente) values
  ('2026-10-28', '14:00', 2, 'confirmada', 'Cristina Cortés Fernández', NULL, NULL, 'telefono', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026]'),
  ('2026-10-28', '14:00', 4, 'confirmada', 'Rocío Díaz', NULL, NULL, 'telefono', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026]'),
  ('2026-10-28', '14:30', 2, 'confirmada', 'Laura Medina', NULL, NULL, 'manual', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026] Aniversario de boda'),
  ('2026-10-28', '15:00', 2, 'confirmada', 'Teresa Blanco', NULL, NULL, 'web', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026]'),
  ('2026-10-28', '15:00', 4, 'confirmada', 'Álvaro Molina', NULL, NULL, 'web', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026]'),
  ('2026-10-28', '20:30', 4, 'confirmada', 'Raúl Ortiz', NULL, NULL, 'telefono', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026]'),
  ('2026-10-28', '21:00', 2, 'confirmada', 'Jesús Blanco Delgado', NULL, NULL, 'web', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026] Alergia a frutos secos'),
  ('2026-10-28', '21:00', 6, 'confirmada', 'Alejandro Castro Domínguez', NULL, NULL, 'web', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026] Primera visita, vienen recomendados');

-- 2026-10-29 (jueves): 10 reservas, 34 comensales
insert into public.reservas (fecha, hora, numero_comensales, estado, nombre, telefono, email, canal, marca, espacio_id, importante, en_blacklist, consentimiento_newsletter, notas_cliente) values
  ('2026-10-29', '13:00', 4, 'confirmada', 'Julia Pérez Cortés', NULL, NULL, 'web', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026]'),
  ('2026-10-29', '13:30', 4, 'confirmada', 'Mario Fernández Iglesias', NULL, NULL, 'telefono', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026] Sin cebolla ni ajo (alergia)'),
  ('2026-10-29', '14:30', 3, 'confirmada', 'Alberto Jiménez Castro', NULL, NULL, 'telefono', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026]'),
  ('2026-10-29', '15:00', 4, 'confirmada', 'Marta Guerrero', NULL, NULL, 'web', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026] Necesitan trona'),
  ('2026-10-29', '20:00', 2, 'confirmada', 'Alejandro Rubio', NULL, NULL, 'web', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026]'),
  ('2026-10-29', '21:00', 2, 'confirmada', 'Gonzalo García', NULL, NULL, 'web', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026] Embarazada: nada crudo ni poco hecho'),
  ('2026-10-29', '21:00', 4, 'confirmada', 'María Cabrera Iglesias', NULL, NULL, 'web', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026]'),
  ('2026-10-29', '21:00', 4, 'confirmada', 'Irene Serrano', NULL, NULL, 'web', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026] Prefieren terraza si hace bueno'),
  ('2026-10-29', '21:15', 3, 'confirmada', 'Antonio Garrido Ortiz', NULL, NULL, 'telefono', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026]'),
  ('2026-10-29', '21:30', 4, 'confirmada', 'Inés Garrido', NULL, NULL, 'manual', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026]');

-- 2026-10-30 (viernes): 32 reservas, 158 comensales
insert into public.reservas (fecha, hora, numero_comensales, estado, nombre, telefono, email, canal, marca, espacio_id, importante, en_blacklist, consentimiento_newsletter, notas_cliente) values
  ('2026-10-30', '13:00', 3, 'confirmada', 'Noelia Prieto', NULL, NULL, 'web', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026] Intolerancia a la lactosa'),
  ('2026-10-30', '13:15', 2, 'confirmada', 'Jorge Ruiz', NULL, NULL, 'telefono', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026]'),
  ('2026-10-30', '13:30', 7, 'confirmada', 'Antonio Herrera', NULL, NULL, 'manual', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026]'),
  ('2026-10-30', '14:00', 2, 'confirmada', 'José Castro', NULL, NULL, 'telefono', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026]'),
  ('2026-10-30', '14:00', 2, 'confirmada', 'Diego Santos', NULL, NULL, 'web', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026] Dos tronas, por favor'),
  ('2026-10-30', '14:00', 4, 'confirmada', 'Elena Prieto', NULL, NULL, 'web', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026]'),
  ('2026-10-30', '14:30', 2, 'confirmada', 'Nuria Rubio', NULL, NULL, 'telefono', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026] Intolerancia a la lactosa'),
  ('2026-10-30', '14:30', 9, 'confirmada', 'Andrés Martín', NULL, NULL, 'telefono', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026] Grupo de senderismo, llegan todos a la vez'),
  ('2026-10-30', '14:30', 10, 'confirmada', 'Álvaro Vidal Castillo', NULL, NULL, 'web', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026] Comida de empresa, factura a nombre de la empresa'),
  ('2026-10-30', '14:45', 6, 'confirmada', 'Lucía García', NULL, NULL, 'telefono', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026] Necesitan trona'),
  ('2026-10-30', '15:00', 2, 'confirmada', 'Óscar Guerrero', NULL, NULL, 'web', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026]'),
  ('2026-10-30', '15:00', 2, 'confirmada', 'Irene Gutiérrez', NULL, NULL, 'web', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026]'),
  ('2026-10-30', '15:00', 4, 'confirmada', 'Adrián Medina Romero', NULL, NULL, 'web', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026]'),
  ('2026-10-30', '15:00', 7, 'confirmada', 'Irene Rubio', NULL, NULL, 'web', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026]'),
  ('2026-10-30', '15:00', 8, 'confirmada', 'Nuria Ortega Molina', NULL, NULL, 'web', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026]'),
  ('2026-10-30', '21:00', 2, 'confirmada', 'Laura Martínez Márquez', NULL, NULL, 'web', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026] Cena de trabajo, necesitan factura'),
  ('2026-10-30', '21:00', 3, 'confirmada', 'Ainhoa Ortiz', NULL, NULL, 'web', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026] Aniversario de boda'),
  ('2026-10-30', '21:00', 3, 'confirmada', 'Paula Ortiz Sánchez', NULL, NULL, 'web', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026]'),
  ('2026-10-30', '21:00', 4, 'confirmada', 'Miguel Martín', NULL, NULL, 'manual', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026] Llegarán unos 15 minutos tarde'),
  ('2026-10-30', '21:00', 6, 'confirmada', 'Ana Alonso', NULL, NULL, 'web', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026]'),
  ('2026-10-30', '21:00', 10, 'confirmada', 'Adrián Ortiz', NULL, NULL, 'telefono', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026] Despedida de soltera'),
  ('2026-10-30', '21:00', 12, 'confirmada', 'Noelia Cortés López', NULL, NULL, 'manual', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026] Cena de empresa, factura a nombre de la empresa'),
  ('2026-10-30', '21:15', 2, 'confirmada', 'Iván Morales', NULL, NULL, 'telefono', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026]'),
  ('2026-10-30', '21:15', 4, 'confirmada', 'Marta Iglesias', NULL, NULL, 'manual', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026] Clientes habituales'),
  ('2026-10-30', '21:30', 4, 'confirmada', 'Óscar Serrano', NULL, NULL, 'telefono', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026] Aniversario de boda'),
  ('2026-10-30', '21:30', 12, 'confirmada', 'Irene Santos', NULL, NULL, 'telefono', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026] Cena familiar, vienen los abuelos'),
  ('2026-10-30', '21:45', 5, 'confirmada', 'Cristina García Torres', NULL, NULL, 'telefono', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026]'),
  ('2026-10-30', '22:00', 3, 'confirmada', 'Rubén Álvarez Rubio', NULL, NULL, 'web', 'casa_tomas', NULL, true, false, false, '[DEMO-SEED][oct-2026]'),
  ('2026-10-30', '22:00', 4, 'confirmada', 'Clara Suárez Díaz', NULL, NULL, 'web', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026]'),
  ('2026-10-30', '22:00', 6, 'confirmada', 'Carmen Navarro', NULL, NULL, 'web', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026]'),
  ('2026-10-30', '22:00', 6, 'confirmada', 'Carlos Delgado', NULL, NULL, 'web', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026]'),
  ('2026-10-30', '22:15', 2, 'confirmada', 'Julia Iglesias', NULL, NULL, 'manual', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026] Dos tronas, por favor');

-- 2026-10-31 (sábado): 36 reservas, 170 comensales
insert into public.reservas (fecha, hora, numero_comensales, estado, nombre, telefono, email, canal, marca, espacio_id, importante, en_blacklist, consentimiento_newsletter, notas_cliente) values
  ('2026-10-31', '13:00', 2, 'confirmada', 'Raúl Guerrero Gil', NULL, NULL, 'manual', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026]'),
  ('2026-10-31', '13:30', 9, 'confirmada', 'Carlos Gómez', NULL, NULL, 'web', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026] Comida familiar, vienen los abuelos'),
  ('2026-10-31', '14:00', 2, 'confirmada', 'Pilar Medina', NULL, NULL, 'web', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026]'),
  ('2026-10-31', '14:00', 3, 'confirmada', 'Álvaro Cortés', NULL, NULL, 'web', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026]'),
  ('2026-10-31', '14:00', 4, 'confirmada', 'Natalia Jiménez', NULL, NULL, 'web', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026] Una persona vegana'),
  ('2026-10-31', '14:00', 5, 'confirmada', 'Lucía Cabrera Méndez', NULL, NULL, 'telefono', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026]'),
  ('2026-10-31', '14:00', 6, 'confirmada', 'Fernando Núñez Martínez', NULL, NULL, 'web', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026]'),
  ('2026-10-31', '14:00', 7, 'confirmada', 'Diego Méndez', NULL, NULL, 'web', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026] Llegarán unos 15 minutos tarde'),
  ('2026-10-31', '14:15', 2, 'confirmada', 'Raquel Santos', NULL, NULL, 'manual', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026]'),
  ('2026-10-31', '14:30', 3, 'confirmada', 'Nuria León', NULL, NULL, 'telefono', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026] Alergia a frutos secos'),
  ('2026-10-31', '14:30', 4, 'confirmada', 'Óscar Domínguez', NULL, NULL, 'manual', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026]'),
  ('2026-10-31', '14:30', 6, 'confirmada', 'Francisco Moreno Pérez', NULL, NULL, 'telefono', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026]'),
  ('2026-10-31', '14:30', 7, 'confirmada', 'Carlos Martín', NULL, NULL, 'telefono', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026]'),
  ('2026-10-31', '14:45', 4, 'confirmada', 'Elena Ruiz', NULL, NULL, 'manual', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026] Cumpleaños: traen tarta, ¿la guardáis en cámara?'),
  ('2026-10-31', '15:00', 5, 'confirmada', 'Ana Fernández', NULL, NULL, 'web', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026]'),
  ('2026-10-31', '15:15', 4, 'confirmada', 'Ignacio Prieto', NULL, NULL, 'manual', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026] Prefieren terraza si hace bueno'),
  ('2026-10-31', '15:45', 2, 'confirmada', 'Rafael Alonso Medina', NULL, NULL, 'telefono', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026]'),
  ('2026-10-31', '20:45', 4, 'confirmada', 'David Calvo', NULL, NULL, 'manual', 'casa_tomas', NULL, true, false, false, '[DEMO-SEED][oct-2026] Intolerancia a la lactosa'),
  ('2026-10-31', '20:45', 4, 'confirmada', 'Carlos Vázquez', NULL, NULL, 'telefono', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026]'),
  ('2026-10-31', '21:00', 2, 'confirmada', 'Teresa Cabrera Lozano', NULL, NULL, 'telefono', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026] Cena de Halloween, vienen disfrazados'),
  ('2026-10-31', '21:00', 2, 'confirmada', 'Natalia Gutiérrez', NULL, NULL, 'web', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026] Cena de Halloween, vienen disfrazados'),
  ('2026-10-31', '21:00', 2, 'confirmada', 'Ainhoa Rubio', NULL, NULL, 'web', 'casa_tomas', NULL, true, false, false, '[DEMO-SEED][oct-2026] Cena de Halloween, vienen disfrazados'),
  ('2026-10-31', '21:00', 4, 'confirmada', 'Miguel Ramírez López', NULL, NULL, 'web', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026] Vienen con carrito de bebé'),
  ('2026-10-31', '21:00', 5, 'confirmada', 'Elena Jiménez Blanco', NULL, NULL, 'web', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026] Cena de Halloween, vienen disfrazados'),
  ('2026-10-31', '21:00', 5, 'confirmada', 'Jorge Domínguez', NULL, NULL, 'manual', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026] Cena de Halloween, vienen disfrazados'),
  ('2026-10-31', '21:00', 6, 'confirmada', 'Andrés Vidal Díaz', NULL, NULL, 'web', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026]'),
  ('2026-10-31', '21:00', 7, 'confirmada', 'Silvia Suárez Cano', NULL, NULL, 'web', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026] Aniversario de boda'),
  ('2026-10-31', '21:00', 10, 'confirmada', 'Patricia Rodríguez', NULL, NULL, 'telefono', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026] Cena familiar, vienen los abuelos'),
  ('2026-10-31', '21:30', 3, 'confirmada', 'Elena Vidal', NULL, NULL, 'telefono', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026]'),
  ('2026-10-31', '21:30', 5, 'confirmada', 'Rocío Marín', NULL, NULL, 'telefono', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026]'),
  ('2026-10-31', '21:30', 9, 'confirmada', 'Jorge Cortés', NULL, NULL, 'telefono', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026] Cena de empresa, factura a nombre de la empresa'),
  ('2026-10-31', '21:30', 10, 'confirmada', 'Rubén Gómez', NULL, NULL, 'telefono', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026] Despedida de soltera'),
  ('2026-10-31', '22:00', 2, 'confirmada', 'Lorena Suárez', NULL, NULL, 'web', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026]'),
  ('2026-10-31', '22:00', 3, 'confirmada', 'Nuria López Ramos', NULL, NULL, 'web', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026] Cumpleaños: traen tarta, ¿la guardáis en cámara?'),
  ('2026-10-31', '22:00', 4, 'confirmada', 'Víctor Moreno Hernández', NULL, NULL, 'web', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026] Dos tronas, por favor'),
  ('2026-10-31', '22:00', 8, 'confirmada', 'Cristina Torres Fernández', NULL, NULL, 'telefono', 'casa_tomas', NULL, false, false, false, '[DEMO-SEED][oct-2026] Primera visita, vienen recomendados');

commit;

-- 2) Verificación (solo lectura; es lo que imprime la CLI). Por día y turno de Casa Tomás:
--    reservas demo, comensales VIVOS en total (demo + existentes) y % del aforo actual.
--    Columnas de control: demo_fuera_de_norma (marca <> casa_tomas, con sala, con email,
--    con teléfono, estado <> confirmada o fuera de 02-31/10; debe ser 0). Última fila: TOTAL.
with aforo as (
  select coalesce(sum(capacidad_maxima), 0) as ct from public.espacios_reserva
   where activa and coalesce(caracteristicas->>'marca', 'casa_tomas') = 'casa_tomas'
), demo as (
  select * from public.reservas where notas_cliente like '[DEMO-SEED][oct-2026]%'
), r as (
  select fecha, hora < time '17:00' as comida, numero_comensales as pax,
         estado in ('pendiente', 'verificada', 'confirmada') as viva,
         notas_cliente like '[DEMO-SEED][oct-2026]%' as es_demo
    from public.reservas
   where fecha between date '2026-10-02' and date '2026-10-31'
     and coalesce(marca, 'casa_tomas') = 'casa_tomas'
), dia as (
  select g.fecha::date as fecha,
    count(r.*) filter (where es_demo and comida)       as comida_demo,
    sum(pax) filter (where viva and comida)            as comida_pax,
    count(r.*) filter (where es_demo and not comida)   as cena_demo,
    sum(pax) filter (where viva and not comida)        as cena_pax,
    sum(pax) filter (where es_demo)                    as demo_comensales
  from generate_series(date '2026-10-02', date '2026-10-31', interval '1 day') as g(fecha)
  left join r on r.fecha = g.fecha::date
  group by g.fecha
)
select * from (
  select d.fecha::text as fecha,
    (array['dom','lun','mar','mié','jue','vie','sáb'])[extract(dow from d.fecha)::int + 1] as dia,
    d.comida_demo, coalesce(d.comida_pax, 0) as comida_pax, round(100.0 * coalesce(d.comida_pax, 0) / a.ct) as comida_pct,
    d.cena_demo,   coalesce(d.cena_pax, 0)   as cena_pax,   round(100.0 * coalesce(d.cena_pax, 0) / a.ct)   as cena_pct,
    coalesce(d.demo_comensales, 0) as demo_comensales, null::bigint as demo_fuera_de_norma
  from dia d cross join aforo a
  union all
  select 'TOTAL', '', sum(comida_demo), sum(coalesce(comida_pax, 0)), null, sum(cena_demo), sum(coalesce(cena_pax, 0)), null,
         sum(coalesce(demo_comensales, 0)),
         (select count(*) from demo
           where marca <> 'casa_tomas' or espacio_id is not null or email is not null or telefono is not null
              or estado <> 'confirmada' or fecha not between date '2026-10-02' and date '2026-10-31')
  from dia
) v
order by v.fecha;
