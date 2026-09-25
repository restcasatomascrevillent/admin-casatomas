-- ===========================================================================
-- ##                                                                       ##
-- ##                          NO APLICADA                                  ##
-- ##                                                                       ##
-- ##   Este fichero NO se ha ejecutado contra ninguna base de datos.       ##
-- ##   Verificado contra produccion (proyecto jeamoczmbfsnwkfjxcyo) el     ##
-- ##   2026-09-25 via el endpoint de solo lectura database/query: la       ##
-- ##   version '20260925130000' NO aparece en                             ##
-- ##   supabase_migrations.schema_migrations. Queda preparado para que el  ##
-- ##   dueno lo revise y decida.                                          ##
-- ##                                                                       ##
-- ===========================================================================
--
-- El trigger de ocupacion deja filas huerfanas en `ocupacion_diaria`
-- (sesion 2026-09-25, proyecto jeamoczmbfsnwkfjxcyo)
-- ---------------------------------------------------------------------------
--
-- QUE HABIA Y POR QUE (verificado en vivo, no de oidas)
--   La funcion `actualizar_ocupacion_diaria_espacios()` esta vigente hoy con
--   este cuerpo (capturado con pg_get_functiondef; es el que dejo
--   20260216064149_2ffdf62a-d630-456a-8093-6ba747c257e1.sql):
--
--     INSERT INTO public.ocupacion_diaria (fecha, hora, ...)
--     SELECT r.fecha, r.hora, COALESCE(SUM(r.numero_comensales), 0), COUNT(*), ...
--     FROM public.reservas r WHERE r.fecha = v_fecha AND r.hora = v_hora
--     GROUP BY r.fecha, r.hora
--     ON CONFLICT (fecha, hora) DO UPDATE SET ...;
--
--     DELETE FROM public.ocupacion_diaria
--     WHERE fecha = v_fecha AND hora = v_hora AND total_reservas = 0;
--
--   El bug esta en la combinacion de esas dos sentencias, no en el trigger
--   que la invoca (ver mas abajo). Cuando se borra la ULTIMA reserva de un
--   (fecha, hora):
--     1) El INSERT ... SELECT ... GROUP BY parte de un WHERE que ya no
--        encuentra ninguna fila en `reservas`. Un GROUP BY sobre un
--        conjunto vacio no produce NINGUNA fila (no produce una fila con
--        COUNT=0: no produce fila alguna). Por tanto el INSERT no inserta
--        nada y el ON CONFLICT DO UPDATE no llega a dispararse -- la fila
--        vieja de `ocupacion_diaria` no se toca.
--     2) La red de seguridad `DELETE ... WHERE total_reservas = 0` lee la
--        columna `total_reservas` que la fila YA TENIA -- y que el paso 1
--        nunca actualizo. Para la fila que de verdad se quedo sin
--        reservas, esa columna nunca llega a valer 0 (se queda en el
--        ultimo valor real, p.ej. 1), asi que esta condicion jamas
--        coincide para el caso que se supone iba a limpiar. Es codigo
--        muerto: solo podria borrar una fila cuyo total_reservas YA fuera
--        0 en la tabla, algo que este mismo trigger jamas deja escrito.
--   Resultado: la fila de `ocupacion_diaria` sobrevive para siempre a la
--   eliminacion de la reserva que la origino.
--
-- SI HACIA FALTA UN TRIGGER DISTINTO -- verificado, la respuesta es NO
--   El encargo pedia pensar si el trigger que dispara la funcion necesitaba
--   ser de otro tipo para cubrir el borrado. Se ha comprobado en vivo con
--   pg_get_triggerdef:
--
--     CREATE TRIGGER trigger_actualizar_ocupacion
--     AFTER INSERT OR DELETE OR UPDATE ON public.reservas
--     FOR EACH ROW EXECUTE FUNCTION actualizar_ocupacion_diaria_espacios()
--
--   DELETE ya esta en la lista de eventos (lo anadio
--   20251130154507_0daaad9c-1a41-43ad-a43f-5bb16af50a5d.sql al unificar tres
--   triggers duplicados en uno solo) y es FOR EACH ROW, que es lo que hace
--   falta para tener OLD.fecha/OLD.hora disponibles fila a fila. Un trigger
--   FOR EACH STATEMENT no serviria sin tablas de transicion (mucho mas
--   complejo y sin necesidad aqui). Este fichero por tanto NO toca la
--   sentencia CREATE TRIGGER -- el trigger ya es el correcto. Todo el
--   arreglo vive dentro del cuerpo de la funcion.
--
-- EL ARREGLO
--   Se sustituye el patron "INSERT...SELECT...GROUP BY...ON CONFLICT" por:
--     1. Un SELECT de agregados SIN GROUP BY sobre el mismo WHERE. Una
--        consulta de agregados sin GROUP BY SIEMPRE devuelve exactamente
--        una fila -- COUNT(*)=0 y SUM(...)=NULL (por eso se envuelve en
--        COALESCE) cuando no hay ninguna reserva -- a diferencia de
--        GROUP BY, que devuelve cero filas en ese caso. Este es el cambio
--        que corrige el bug de raiz.
--     2. Una rama explicita: si el recuento da 0, se borra la fila de
--        `ocupacion_diaria` (ya no queda ninguna reserva que agrupar, asi
--        que no debe quedar fila); si no, se hace el mismo UPSERT de
--        siempre.
--   Para INSERT/UPDATE el resultado numerico es IDENTICO al de hoy: el
--   WHERE ya fija r.fecha = v_fecha AND r.hora = v_hora, asi que agregar
--   con o sin "GROUP BY r.fecha, r.hora" da los mismos numeros cuando hay
--   al menos una fila -- solo cambia que ahora tambien se obtiene una fila
--   (con ceros) cuando no hay ninguna. dia_semana/turno se calculan igual,
--   a partir de v_fecha/v_hora en vez de r.fecha/r.hora del grupo -- son el
--   mismo valor porque el WHERE los iguala. Por eso "no rompe el camino de
--   alta y modificacion": no cambia ni una cifra de lo que ya funciona, solo
--   anade el caso que faltaba.
--
-- UN HUECO EMPARENTADO QUE ESTE FICHERO NO TOCA (documentado, no corregido)
--   Leyendo la funcion completa se observa OTRA via -- distinta de la
--   pedida -- por la que una fila de `ocupacion_diaria` puede quedar
--   desincronizada: en UPDATE, v_fecha/v_hora se toman SOLO de NEW. Si una
--   reserva cambia de fecha/hora (no solo de estado), el trigger recalcula
--   la fila NUEVA pero nunca vuelve a tocar la fila VIEJA -- que se queda
--   con una reserva que ya no le pertenece. Esto es preexistente desde la
--   primera version de la funcion (2025-11-23), no es nuevo de este
--   fichero, y no tiene evidencia citada en el encargo (que habla
--   especificamente de borrado). Se documenta aqui para que quede
--   localizable, pero se deja fuera de alcance a proposito: el encargo pide
--   cubrir el borrado y no romper alta/modificacion, y tocar la rama UPDATE
--   mas de lo necesario es visitar codigo que hoy "funciona" segun el
--   propio encargo. Candidato a revision aparte si se confirma que la app
--   permite editar fecha/hora de una reserva existente (no verificado en
--   esta sesion).
--
-- HUERFANAS EXISTENTES -- verificado en vivo, no solo la muestra del encargo
--   El encargo citaba 5 filas huerfanas confirmadas del 2026-10-08. Se
--   confirman esas 5 exactas (14:00, 14:30, 14:45, 15:30, 15:45; las 5 con
--   total_reservas=1 y created_at = updated_at, es decir: se escribieron
--   una vez al crear la reserva y nunca se volvieron a tocar pese a que esa
--   reserva ya no existe -- la firma exacta de este bug).
--
--   Pero el mismo criterio que usa el propio trigger (no existe ninguna
--   fila en `reservas` con ese fecha+hora) aplicado a TODA la tabla
--   encuentra 738 filas huerfanas de 1008 totales, repartidas en dos
--   tandas bien diferenciadas por created_at/updated_at:
--     - ~724 filas de 2025-11-14 a 2026-01-31 (algunas hasta 2026-02-27):
--       created_at 2026-01-16 17:20:11 (la carga historica de
--       `recalcular_ocupacion_historica()` en
--       20260116172011_52b5ccaf-4b11-4020-9e83-9878b6996334.sql, PASO 10) y
--       updated_at agrupado en 2026-02-16 06:5x -- consistente con un ciclo
--       de datos de prueba/demo creado y luego borrado esa madrugada.
--     - 14 filas del 2026-10-08 al 2026-10-20 (incluye las 5 de la fecha
--       citada en el encargo), creadas y actualizadas el 2026-09-23 --
--       consistente con otro ciclo de pruebas reciente.
--   Confirmado tambien de forma INDEPENDIENTE por el propio codigo de la
--   app: `src/hooks/useDisponibilidad.ts` (lineas 76-78) ya documentaba
--   "724 de sus 784 filas estan huerfanas" como motivo para que el motor de
--   disponibilidad NUNCA lea `ocupacion_diaria` ni `vista_ocupacion` y
--   calcule siempre desde `reservas`. La tabla crecio de 784 a 1008 filas
--   (738 huerfanas) entre que se escribio ese comentario y esta sesion --
--   el problema sigue vivo y sigue creciendo con cada reserva que se borra.
--   No se ha tocado `reservas` para llegar a estos numeros: la deteccion es
--   un SELECT/COUNT de solo lectura (ver CONSULTA DE VERIFICACION).
--
--   Sin FK apuntando a `ocupacion_diaria` (verificado con pg_constraint) y
--   sin ninguna vista/consulta que dependa de que estas filas existan --
--   `vista_ocupacion_hoy` calcula desde `reservas` directamente desde
--   20260216064149, no desde esta tabla. Borrarlas no rompe nada; al
--   contrario, hoy inflan `vista_estadisticas_semanales`/`_mensuales` con
--   reservas que ya no existen.
--
--   Las 265 reservas [DEMO-SEED] que el dueno esta usando ahora mismo NO se
--   tocan: esta migracion no modifica `reservas` en ningun momento, y el
--   criterio de borrado exige que NO exista ninguna reserva para ese
--   fecha+hora -- cualquier fila de `ocupacion_diaria` respaldada por una
--   reserva [DEMO-SEED] viva queda excluida por definicion.
--
-- RIESGO DE DESPLIEGUE -- bajo, sin orden obligatorio
--   A diferencia de 20260922170000 (reservas), nada del lado publico llama
--   a esta funcion directamente ni depende de que se aplique en un momento
--   concreto: es un trigger interno sobre `reservas`, y las unicas vistas
--   que leen `ocupacion_diaria` (`vista_ocupacion`,
--   `vista_estadisticas_semanales`, `vista_estadisticas_mensuales`) son de
--   uso interno/admin. Se puede aplicar en cualquier momento.
--
-- SI ALGO SE ROMPE
--   Ejecutar a mano
--   `supabase/rollbacks/20260925130000_ocupacion_diaria_sin_huerfanas_ROLLBACK.sql`.
--   Restaura el cuerpo anterior de la funcion. NO restaura las 738 filas
--   borradas -- ver la cabecera de ese fichero para el porque.
-- ===========================================================================

begin;

-- PASO 1 -- arreglo de raiz: mismo contrato (misma firma, mismo trigger que
-- la invoca), cuerpo reescrito para no depender de que GROUP BY produzca
-- una fila cuando el grupo esta vacio.
CREATE OR REPLACE FUNCTION public.actualizar_ocupacion_diaria_espacios()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_fecha date;
  v_hora time;
  v_total_comensales integer;
  v_total_reservas integer;
  v_reservas_confirmadas integer;
  v_reservas_canceladas integer;
  v_reservas_no_show integer;
  v_comensales_confirmados integer;
BEGIN
  IF TG_OP = 'DELETE' THEN
    v_fecha := OLD.fecha;
    v_hora := OLD.hora;
  ELSE
    v_fecha := NEW.fecha;
    v_hora := NEW.hora;
  END IF;

  -- Agregado SIN GROUP BY: a diferencia de "GROUP BY r.fecha, r.hora",
  -- esta forma SIEMPRE devuelve una fila (COUNT=0, SUM=NULL via COALESCE)
  -- aunque no quede ninguna reserva para v_fecha/v_hora. Es el cambio que
  -- corrige el bug: ya no depende de que exista al menos una fila para
  -- recalcular.
  SELECT
    COALESCE(SUM(r.numero_comensales), 0),
    COUNT(*),
    COUNT(*) FILTER (WHERE r.estado = 'confirmada'),
    COUNT(*) FILTER (WHERE r.estado = 'cancelada'),
    COUNT(*) FILTER (WHERE r.estado = 'no_show'),
    COALESCE(SUM(r.numero_comensales) FILTER (WHERE r.estado = 'confirmada'), 0)
  INTO
    v_total_comensales,
    v_total_reservas,
    v_reservas_confirmadas,
    v_reservas_canceladas,
    v_reservas_no_show,
    v_comensales_confirmados
  FROM public.reservas r
  WHERE r.fecha = v_fecha
    AND r.hora = v_hora;

  IF v_total_reservas = 0 THEN
    -- Ya no queda ninguna reserva para esa fecha/hora (caso tipico: se
    -- acaba de borrar la ultima). Se borra la fila en vez de dejarla
    -- huerfana con su ultimo valor conocido.
    DELETE FROM public.ocupacion_diaria
    WHERE fecha = v_fecha
      AND hora = v_hora;
  ELSE
    INSERT INTO public.ocupacion_diaria (
      fecha, hora, total_comensales, total_reservas,
      reservas_confirmadas, reservas_canceladas, reservas_no_show,
      comensales_confirmados, dia_semana, turno
    )
    VALUES (
      v_fecha, v_hora, v_total_comensales, v_total_reservas,
      v_reservas_confirmadas, v_reservas_canceladas, v_reservas_no_show,
      v_comensales_confirmados,
      EXTRACT(DOW FROM v_fecha)::integer,
      CASE WHEN v_hora < '16:00' THEN 'comida' ELSE 'cena' END
    )
    ON CONFLICT (fecha, hora) DO UPDATE SET
      total_comensales = EXCLUDED.total_comensales,
      total_reservas = EXCLUDED.total_reservas,
      reservas_confirmadas = EXCLUDED.reservas_confirmadas,
      reservas_canceladas = EXCLUDED.reservas_canceladas,
      reservas_no_show = EXCLUDED.reservas_no_show,
      comensales_confirmados = EXCLUDED.comensales_confirmados,
      dia_semana = EXCLUDED.dia_semana,
      turno = EXCLUDED.turno,
      updated_at = now();
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$function$;

-- El trigger que la invoca NO se toca -- ya esta correcto (ver "SI HACIA
-- FALTA UN TRIGGER DISTINTO" arriba). Queda constancia de su forma vigente
-- para quien revise esto, no se ejecuta nada aqui:
--   trigger_actualizar_ocupacion AFTER INSERT OR DELETE OR UPDATE
--   ON public.reservas FOR EACH ROW
--   EXECUTE FUNCTION actualizar_ocupacion_diaria_espacios()

-- PASO 2 -- limpieza de las huerfanas existentes, con el mismo criterio que
-- usa la funcion de arriba: ninguna reserva viva para ese fecha+hora. Solo
-- toca `ocupacion_diaria`; no borra ni modifica ninguna fila de `reservas`
-- (las 265 [DEMO-SEED] incluidas).
DELETE FROM public.ocupacion_diaria od
WHERE NOT EXISTS (
  SELECT 1 FROM public.reservas r
  WHERE r.fecha = od.fecha
    AND r.hora = od.hora
);

commit;

-- ---------------------------------------------------------------------------
-- CONSULTA DE VERIFICACION -- ejecutar ANTES y DESPUES de aplicar esta
-- migracion. Solo lee, no escribe nada.
-- ---------------------------------------------------------------------------
--
-- -- 1) Cuantas filas huerfanas quedan:
-- select count(*) as huerfanas
-- from ocupacion_diaria od
-- where not exists (
--   select 1 from reservas r where r.fecha = od.fecha and r.hora = od.hora
-- );
--
-- -- 2) Cuerpo vigente de la funcion:
-- select pg_get_functiondef(p.oid)
-- from pg_proc p join pg_namespace n on n.oid = p.pronamespace
-- where n.nspname = 'public' and p.proname = 'actualizar_ocupacion_diaria_espacios';
--
-- ANTES de esta migracion debe devolver:
--   (1) 738 (verificado 2026-09-25; puede ser mayor si se borraron mas
--       reservas desde entonces -- el bug sigue activo hasta aplicar esto)
--   (2) el cuerpo con "GROUP BY r.fecha, r.hora" y el DELETE final
--       "WHERE ... AND total_reservas = 0"
--
-- DESPUES de esta migracion debe devolver:
--   (1) 0
--   (2) el cuerpo con el SELECT ... INTO sin GROUP BY y la rama IF
--       v_total_reservas = 0
--
-- -- 3) Prueba de humo sugerida (no ejecutada en esta sesion: el acceso de
-- --    esta tarea era de solo lectura). Desde el panel o con INSERT/DELETE
-- --    manuales fuera de esta migracion: crear una reserva de prueba en una
-- --    fecha/hora sin ninguna otra reserva, confirmar que aparece una fila
-- --    en ocupacion_diaria, borrar esa reserva, confirmar que la fila
-- --    desaparece (antes del fix se habria quedado con total_reservas=1).
-- ---------------------------------------------------------------------------
