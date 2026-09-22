-- ===========================================================================
-- ##                                                                       ##
-- ##                          NO APLICADA                                  ##
-- ##                                                                       ##
-- ##   Este fichero NO se ha ejecutado contra ninguna base de datos.        ##
-- ##   Queda preparado para que el dueño lo revise y decida.                ##
-- ##   Es un CREATE OR REPLACE FUNCTION sobre una función YA EXISTENTE      ##
-- ##   (`validar_capacidad_reserva`, el trigger `trg_validar_capacidad`     ##
-- ##   sigue apuntando a la misma función con el mismo nombre — no hace     ##
-- ##   falta volver a crear el trigger). No toca datos ni tablas.           ##
-- ##                                                                       ##
-- ===========================================================================
--
-- CONTEXTO (bug detectado y verificado en producción el 2026-09-22, tras
-- aplicar `20260922150000_espacio_el_reservado_touza.sql`)
--
--   Ese fichero da de alta "El Reservado" (espacio privado del BAR Touza,
--   capacidad 20) en `espacios_reserva`. Efecto secundario NO previsto:
--   el aforo del RESTAURANTE pasó de 150 a 170. Verificado llamando a
--   `reservas-web/disponibilidad` en producción (devolvía
--   `capacidad_maxima: 170` por turno) y confirmado por consulta directa:
--
--     nombre        | capacidad_maxima | activa | caracteristicas->>'marca'
--     Comedor       | 50                | true   | casa_tomas
--     Salón         | 50                | true   | casa_tomas
--     Terraza       | 50                | true   | casa_tomas
--     El Reservado  | 20                | true   | touza
--
--   Causa: el cuerpo REAL de `validar_capacidad_reserva()` en producción
--   (recuperado con `pg_get_functiondef`, no reconstruido de memoria ni
--   del repo — coincide con `20260305175122_trigger_concurrencia_
--   reservas.sql`, así que aquí el repo sí iba sincronizado) suma la
--   capacidad de TODOS los espacios activos sin mirar de qué negocio son:
--
--     SELECT COALESCE(SUM(capacidad_maxima), 0)
--     INTO v_capacidad_total
--     FROM espacios_reserva
--     WHERE activa = true;
--
--   Consecuencia: el restaurante aceptaría 170 comensales en un servicio
--   cuando solo sienta a 150 (contando una sala que es del bar) y, al
--   revés, una solicitud de El Reservado se validaría contra 170 en vez
--   de sus 20 reales.
--
-- QUÉ CAMBIA (y qué NO)
--
--   `reservas.marca` ya existe (`20260922180000_marca_negocio_en_reservas
--   .sql`: columna `text NOT NULL DEFAULT 'casa_tomas'`, CHECK en
--   `('casa_tomas','touza')`) y `espacios_reserva.caracteristicas->>
--   'marca'` ya etiqueta los 4 espacios (tabla de arriba). Este fichero
--   solo reescribe `validar_capacidad_reserva()` para que la capacidad
--   se calcule SOLO sobre los espacios del negocio al que pertenece la
--   reserva — usando `NEW.marca` y `caracteristicas->>'marca'`, con
--   `COALESCE(..., 'casa_tomas')` en AMBOS lados de la comparación (ni un
--   espacio sin etiquetar ni una reserva antigua/de un camino que no
--   conozca `marca` quedan fuera del aforo por accidente: los dos caen en
--   'casa_tomas', el negocio mayoritario e histórico — mismo valor que
--   `NEGOCIO_POR_DEFECTO` en `reservas-web/plantillas.ts`).
--
--   Se ha ampliado el fix a un segundo punto que el encargo no citaba
--   textualmente pero que es la otra mitad de la MISMA cuenta: el paso 4
--   del trigger, `v_ocupacion_turno` (cuánto hay YA reservado ese turno),
--   sumaba tal cual `reservas.numero_comensales` de TODAS las reservas de
--   la fecha+turno, también sin mirar la marca. Si solo se filtrara el
--   paso 1 (capacidad) y se dejara el paso 4 (ocupación) sin filtrar, el
--   bug no se arregla: se DESPLAZA y además se invierte. Ejemplo con los
--   datos de la tabla de arriba: un día con el restaurante en 145/150 y
--   El Reservado en 18/20 (cada uno dentro de SU aforo), una reserva
--   nueva de 5 personas para el restaurante comprobaría
--   `v_ocupacion_turno (145+18=163) + 5 > v_capacidad_total (150)` y se
--   RECHAZARÍA aunque al restaurante le sobren 5 plazas — porque la
--   ocupación de Touza, de otro negocio, estaría comiéndose aforo que no
--   es el suyo. Por eso el paso 4 lleva el mismo
--   `COALESCE(marca, 'casa_tomas') = v_marca` que el paso 1: es necesario
--   para que "capacidad" y "ocupación" midan lo mismo (el mismo negocio),
--   no solo para que la palabra "capacidad" del encargo quede cubierta.
--
--   Todo lo demás del cuerpo queda INTACTO: el turno (`v_es_comida`,
--   corte 17:00), el candado de concurrencia (`pg_advisory_xact_lock`,
--   sigue por fecha+turno, sin marca — dos negocios pidiendo el MISMO
--   turno de la MISMA fecha siguen serializándose entre sí, que es lo
--   correcto: dos transacciones que van a leer/escribir el mismo par
--   (fecha, turno) no deben carrera aunque una sea de un negocio y otra
--   del otro, y el lock no cuesta nada extra por compartirse), la
--   exclusión de la propia fila en UPDATE (`TG_OP = 'INSERT' OR id !=
--   NEW.id`), el mensaje y el ERRCODE de la excepción (`check_violation`
--   — de eso depende `reservas-web/index.ts`, que hace
--   `insertError.code === "23514"` para distinguir un rechazo de aforo de
--   un error interno).
--
-- COHERENCIA CON EL MOTOR DE DISPONIBILIDAD (supabase/functions/_shared/
-- disponibilidad.ts + quien lo llama en reservas-web/index.ts y
-- src/hooks/useDisponibilidad.ts)
--
--   El motor es la ESTIMACIÓN que ve el cliente antes de reservar; este
--   trigger es la AUTORIDAD final. Si filtran distinto, el cliente ve un
--   hueco que el servidor luego rechaza (o al revés). Misma sesión: el
--   motor gana un helper `sumarCapacidadPorMarca`/`filtrarEspaciosPorMarca`
--   con el MISMO criterio exacto que este trigger
--   (`COALESCE(marca_de_cada_lado, 'casa_tomas')` comparado por igualdad),
--   y las consultas que antes sumaban `capacidad_maxima`/`numero_comensales`
--   de TODOS los espacios/reservas activos ahora filtran por marca en la
--   propia consulta a Supabase, igual que aquí. Ver el informe de la
--   tarea para la prueba número a número de que ambos caminos coinciden.
--
-- POR QUÉ NO SE USA UN `IN ('casa_tomas', 'touza')` NI UN CASE/switch
--
--   Comparar por IGUALDAD (`= v_marca`) contra el valor ya resuelto de
--   `NEW.marca`, en vez de enumerar las marcas conocidas, es lo que hace
--   que esta función NO necesite tocarse el día que el grupo abra un
--   tercer negocio: basta con que sus espacios traigan
--   `caracteristicas.marca` con el valor nuevo y que sus reservas traigan
--   ese mismo valor en la columna `marca` (el CHECK de
--   `reservas_marca_valida` sí habría que ampliarlo entonces, pero eso
--   vive en la migración de la columna, no aquí).
-- ===========================================================================

CREATE OR REPLACE FUNCTION public.validar_capacidad_reserva()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
DECLARE
  v_capacidad_total INT;
  v_ocupacion_turno INT := 0;
  v_es_comida BOOLEAN;
  v_marca TEXT;
BEGIN
  -- Solo validar si está en un estado que ocupa lugar
  IF NEW.estado NOT IN ('pendiente', 'verificada', 'confirmada') THEN
    RETURN NEW;
  END IF;

  -- 0. Marca (negocio) de ESTA reserva. `reservas.marca` es NOT NULL con
  --    DEFAULT 'casa_tomas' (20260922180000_marca_negocio_en_reservas.sql),
  --    así que en la práctica nunca es NULL — el COALESCE es una red de
  --    seguridad, no una rama que se espere alcanzar hoy.
  v_marca := COALESCE(NEW.marca, 'casa_tomas');

  -- 1. Calcular capacidad total SOLO de los espacios activos DEL MISMO
  --    NEGOCIO que esta reserva (antes sumaba TODOS los espacios activos
  --    sin mirar la marca — ver cabecera de esta migración). Un espacio
  --    sin `caracteristicas.marca` cuenta como 'casa_tomas', igual que
  --    una reserva sin marca en el paso 0: ninguno de los dos lados
  --    desaparece del aforo por accidente.
  SELECT COALESCE(SUM(capacidad_maxima), 0)
  INTO v_capacidad_total
  FROM espacios_reserva
  WHERE activa = true
    AND COALESCE(caracteristicas->>'marca', 'casa_tomas') = v_marca;

  -- 2. Determinar turno (comida < 17:00, cena >= 17:00)
  v_es_comida := NEW.hora < '17:00:00'::time;

  -- 3. Bloquear transacciones concurrentes para esta misma fecha y turno
  -- Esto evita race conditions donde dos transacciones leen que hay hueco y luego insertan a la vez.
  -- (Sin filtrar por marca a propósito: dos negocios pidiendo el mismo
  -- fecha+turno siguen sin poder tener una carrera entre sí, y compartir
  -- el candado no penaliza a ninguno de los dos — cada uno solo espera al
  -- que llegó antes, valide o no contra su propio aforo.)
  PERFORM pg_advisory_xact_lock(
    hashtext(NEW.fecha::text),
    CASE WHEN v_es_comida THEN 1 ELSE 2 END
  );

  -- 4. Calcular ocupación actual del MISMO turno en esa fecha, SOLO de
  --    reservas DEL MISMO NEGOCIO (mismo motivo que el paso 1: si esto
  --    sumara las dos marcas, una reserva de Touza restaría aforo al
  --    restaurante y viceversa — el bug no se arregla, se traslada aquí).
  SELECT COALESCE(SUM(numero_comensales), 0)
  INTO v_ocupacion_turno
  FROM reservas
  WHERE fecha = NEW.fecha
    -- Excluir la propia reserva si es un UPDATE
    AND (TG_OP = 'INSERT' OR id != NEW.id)
    AND estado IN ('pendiente', 'verificada', 'confirmada')
    AND COALESCE(marca, 'casa_tomas') = v_marca
    AND (
      (v_es_comida AND hora < '17:00:00'::time) OR
      (NOT v_es_comida AND hora >= '17:00:00'::time)
    );

  -- 5. Validar capacidad
  IF v_ocupacion_turno + NEW.numero_comensales > v_capacidad_total THEN
    RAISE EXCEPTION 'Aforo superado para el turno. Capacidad total: %, Ocupación actual: %, Pedidos: %',
      v_capacidad_total, v_ocupacion_turno, NEW.numero_comensales
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$function$;

-- No hace falta DROP/CREATE TRIGGER: `trg_validar_capacidad` (creado en
-- 20260305175122_trigger_concurrencia_reservas.sql) ya apunta a
-- `EXECUTE FUNCTION validar_capacidad_reserva()` por nombre — un
-- `CREATE OR REPLACE FUNCTION` sobre la misma firma (mismo nombre, mismos
-- argumentos: ninguno) actualiza el cuerpo que el trigger ejecuta sin
-- tocar el trigger en sí.

-- ---------------------------------------------------------------------------
-- CONSULTAS DE VERIFICACIÓN — ejecutar DESPUÉS de aplicar esta migración.
-- Solo leen, no escriben nada.
-- ---------------------------------------------------------------------------
--
-- -- 1) El cuerpo desplegado es este (compárese con el bloque de arriba):
-- select pg_get_functiondef('validar_capacidad_reserva'::regproc) as def;
--
-- -- 2) Aforo por marca, calculado a mano igual que hace ahora el trigger
-- --    (debe dar 150 para casa_tomas y 20 para touza con los datos de
-- --    hoy, NO 170 para ninguna de las dos):
-- select coalesce(caracteristicas->>'marca', 'casa_tomas') as marca,
--        sum(capacidad_maxima) as capacidad_total
-- from espacios_reserva
-- where activa = true
-- group by 1;
--   -- esperado: ('casa_tomas', 150), ('touza', 20)
--
-- -- 3) Prueba de humo del trigger (dentro de una transacción que se
-- --    deshace sola — no deja ninguna fila):
-- begin;
--   -- (a) 151 comensales para casa_tomas debe fallar contra 150 (su aforo
--   --     real). ANTES de este fix, con v_capacidad_total = 170 por el
--   --     bug (150 + los 20 de El Reservado), esta misma fila se habría
--   --     ACEPTADO por error -- es el escenario exacto que motiva esta
--   --     migración:
--   savepoint intento_a;
--   insert into reservas (nombre, fecha, hora, numero_comensales, estado, marca)
--   values ('TEST aforo casa_tomas', current_date + 7, '13:00', 151, 'pendiente', 'casa_tomas');
--   -- esperado (con el fix): ERROR Aforo superado... Capacidad total: 150
--   rollback to savepoint intento_a;
--
--   -- (b) 21 comensales para touza debe fallar contra sus 20, NO contra
--   --     170 (antes del fix, El Reservado nunca podía llenarse: siempre
--   --     comparaba contra el aforo de los TRES negocios juntos):
--   savepoint intento_b;
--   insert into reservas (nombre, fecha, hora, numero_comensales, estado, marca)
--   values ('TEST aforo touza', current_date + 7, '13:00', 21, 'pendiente', 'touza');
--   -- esperado (con el fix): ERROR Aforo superado... Capacidad total: 20 (NO 170)
--   rollback to savepoint intento_b;
-- rollback;
-- ---------------------------------------------------------------------------
