set client_encoding = 'UTF8';
-- (Primera línea a propósito: psql lanzado desde PowerShell/cmd arranca en
-- WIN1252 y dejaría los mensajes del RAISE como «OcupaciÃ³n actual».)
-- ===========================================================================
-- ##                                                                       ##
-- ##              NO APLICADA: la aplica el dueño a mano                   ##
-- ##                                                                       ##
-- ##   Escrita el 2026-10-03 contra la definición VIVA de producción       ##
-- ##   (pg_get_functiondef / pg_get_triggerdef, solo lectura). No se ha    ##
-- ##   ejecutado en producción; se probó solo en un simulacro dentro de    ##
-- ##   una transacción con ROLLBACK. Pasos del dueño al final de esta      ##
-- ##   cabecera (PASOS DEL DUEÑO).                                         ##
-- ##                                                                       ##
-- ===========================================================================
--
-- LA REGLA DE NEGOCIO (dueño, 2026-10-03, literal: «nunca van a caer dos
-- reservas, siempre una reserva en el reservado; aunque sea para 5, llena el
-- reservado»)
--
--   Una sala PRIVADA (`espacios_reserva.caracteristicas.privada = true`, hoy
--   solo «Reservado» de Casa Tomás, 20 plazas) la ocupa ENTERA quien la reserva:
--
--   (a) AFORO: una reserva viva en una sala privada consume la
--       `capacidad_maxima` de la sala (20), no sus `numero_comensales` (5).
--       Si la reserva tuviera MÁS comensales que la capacidad de la sala,
--       cuenta con los comensales (GREATEST): nunca se cuenta de menos.
--   (b) EXCLUSIVIDAD: no puede haber una segunda reserva en la misma sala
--       privada, el mismo día y el mismo turno (comida < 17:00 / cena >=
--       17:00). Se rechaza con 23514 y un mensaje en claro.
--
--   Se generaliza por el flag `privada`, no por nombre ni por id: el flag
--   existía como descriptivo y hasta hoy NINGÚN código ni función SQL lo leía.
--   Solo cuenta en salas ACTIVAS (una sala desactivada no admite reservas).
--
-- CÓMO ESTABA LA FUNCIÓN (producción, md5(prosrc) f554d721…, la de
-- 20260930212000)
--
--   · Capacidad = suma de `capacidad_maxima` de las salas activas del negocio.
--   · Ocupación = suma de `numero_comensales` de las reservas vivas
--     (pendiente, verificada, confirmada) del mismo negocio, día y turno.
--   · Rechaza si ocupación + comensales nuevos > capacidad (23514 «Aforo
--     superado…»). NO miraba `espacio_id`: no sabía de salas ni de mesas.
--   · El trigger `trg_validar_capacidad` saltaba con INSERT o con UPDATE OF
--     fecha, hora, numero_comensales, estado, marca. NO con `espacio_id`:
--     mover una reserva de sala (el «Mover a…» del kanban, el panel
--     Asignación, «Verificar» con sala) ni siquiera disparaba la función.
--     Este es el HUECO: el único camino realista a una segunda reserva en el
--     Reservado era moverla allí, y era invisible para el trigger.
--
-- ANTES → DESPUÉS DEL CÁLCULO
--
--   ocupación del turno
--     antes : SUM(numero_comensales)                                  [vivas]
--     después: SUM( CASE WHEN la reserva está en una sala privada activa
--                        THEN GREATEST(capacidad_maxima, numero_comensales)
--                        ELSE numero_comensales END )                 [vivas]
--   peso de la reserva que entra
--     antes : NEW.numero_comensales
--     después: GREATEST(capacidad_maxima, NEW.numero_comensales) si va a una
--              sala privada activa; NEW.numero_comensales si no.
--   exclusividad (NUEVO, antes del aforo): si NEW va a una sala privada
--     activa y existe OTRA reserva en esa sala, ese día y ese turno en estado
--     pendiente / verificada / confirmada / COMPLETADA («Llegó»: ya está
--     sentada ahí; solo cancelada y «No vino» liberan la sala) → 23514
--     «Sala privada ocupada: «Reservado» ya tiene una reserva el DD/MM/AAAA
--     en el turno de comida|cena.» (con DETAIL = id de la otra reserva y HINT).
--     Ese mensaje NO contiene «Aforo» a propósito: los traductores del panel
--     que buscan «Aforo» no lo confunden con un aforo lleno.
--
--   Ejemplo (Casa Tomás, aforo 170): con la cena llena hasta 150 y UNA reserva
--   de 5 en el Reservado, la ocupación pasa de 155 a 170 (150 + 20): caben
--   0 más, no 15.
--
-- QUÉ CAMBIA
--
--   1. `validar_capacidad_reserva()`: lo anterior. Misma firma (sin argumentos,
--      RETURNS trigger), SECURITY INVOKER (prosecdef = false, como hoy),
--      `SET search_path TO 'public'`, VOLATILE. Propietario y permisos no
--      cambian (CREATE OR REPLACE los conserva). Lo de siempre se conserva:
--      el INSERT, el paso 0b de 20260930212000 (un UPDATE que no añade
--      ocupación pasa aunque el turno esté pasado de aforo), el candado
--      advisory por día+turno, el mensaje y el ERRCODE del aforo.
--      El paso 0b ahora mira también el peso: un UPDATE que ENTRA en una sala
--      privada distinta de la que tenía NO se considera «sin añadir
--      ocupación», aunque no suba comensales (pasar de 5 comensales en el
--      Comedor a 20 en el Reservado SÍ añade). Salir de una sala privada, o
--      editar comensales/hora dentro de la MISMA sala privada, sigue pasando.
--   2. `trg_validar_capacidad` salta también al cambiar `espacio_id`:
--      BEFORE INSERT OR UPDATE OF fecha, hora, numero_comensales, estado,
--      marca, espacio_id. Sin esto, mover una reserva al Reservado no
--      comprobaría nada. Un UPDATE que reenvía `espacio_id` SIN cambiarlo
--      (o sin salir de la sala privada) pasa por el 0b sin leer nada más.
--
-- «COMPLETADA» («Llegó») Y LA SALA PRIVADA
--
--   El aforo NO cuenta las reservas completadas (como siempre: no se toca). La
--   exclusividad SÍ las cuenta, porque el cliente que ya llegó está sentado en
--   la sala. Una reserva 'completada' solo se comprueba cuando ENTRA en una
--   sala privada (alta, o cambio de sala, día o turno), nunca por el simple
--   hecho de marcar la llegada: pulsar «Ha llegado» sobre una reserva que ya
--   está en el Reservado no puede fallar.
--
-- DATOS EXISTENTES (verificado en producción el 2026-10-03, solo SELECT)
--
--   · Una sola reserva en el Reservado de Casa Tomás (no_show del 29/09, 3
--     comensales, no ocupa nada). Ningún turno tiene dos reservas vivas en
--     una sala privada activa.
--   · NO se toca ninguna fila. El trigger solo mira las filas que se insertan
--     o se modifican: una duplicada que pudiera existir (aparecería en el
--     aviso de la migración) seguiría ahí, y solo chocaría al cambiarle el
--     día, la hora, la sala o el estado a vivo. La migración avisa con un
--     WARNING si encuentra alguna; no aborta por eso.
--   · Las reservas de la sala privada de Touza («El Reservado», desactivada)
--     no se ven afectadas: la regla exige sala activa.
--
-- QUIÉN PODÍA COLAR UNA SEGUNDA RESERVA (caminos revisados)
--
--   · Mover tarjeta en el kanban / «Mover a…» / panel Asignación / «Verificar»
--     con sala (UPDATE reservas SET espacio_id): COLABA (hueco del trigger).
--     Ahora se comprueba.
--   · Alta manual del panel y edición (FormularioReserva): INSERT/UPDATE con
--     `espacio_id`; el INSERT ya pasaba por el trigger (sin mirar sala), la
--     edición de sala no. Ahora ambos.
--   · fn_aceptar_propuesta_solicitud: INSERT con espacio_propuesto_id; hoy
--     ninguna solicitud propone el Reservado (1 solicitud con sala propuesta,
--     otra sala). Pasa por el trigger; su manejador de check_violation
--     devuelve error `datos_invalidos` con el mensaje de la BD, que el panel
--     enseña tal cual (en español).
--   · reservas-web (Edge Function) y bot telefónico (restaurante-phone): NO
--     eligen sala en Casa Tomás (la web descarta `espacio_id`/`sala`; el bot
--     escribe `espacio_id: null`). No pueden colar nada.
--
-- QUÉ NO CAMBIA
--
--   · El motor de disponibilidad de reservas NUEVAS (web y bots,
--     supabase/functions/_shared/disponibilidad.ts) sigue sumando
--     `numero_comensales`: con el Reservado ocupado puede ofrecer una hora que
--     el trigger rechazará con 23514 «Aforo superado» (ya lo traducen las dos
--     Edge Functions). Solo se nota en un turno casi lleno. Pendiente.
--   · Las mesas: la exclusividad de MESA sigue siendo el índice único de
--     `asignaciones_mesa` (mesa_id, fecha, turno), de la migración
--     20261003110000 (una mesa «Reservado» de 20 plazas). Esta migración es
--     independiente de ella (no la necesita), pero se aplica DESPUÉS.
--
-- CÓMO SE EJECUTA
--
--   Lleva su propio BEGIN/COMMIT (a diferencia del resto de
--   supabase/migrations/, porque se aplica a mano): es atómica se lance como
--   se lance —`npx supabase db query --linked -f`, `psql -f` o pegada entera
--   en el SQL editor—. Si algo falla, no se aplica nada.
--   `lock_timeout = '5s'`: CREATE OR REPLACE TRIGGER necesita un candado SHARE
--   ROW EXCLUSIVE sobre `reservas`, que espera a cualquier transacción abierta
--   que haya escrito en la tabla y, mientras espera, pone en cola TODAS las
--   escrituras. Con el límite, si no lo consigue en 5 s falla con 55P03
--   (lock_not_available), no deja nada aplicado y basta con reintentar.
--   Idempotente: función y trigger van con CREATE OR REPLACE; si ya está
--   aplicada, vuelve a dejarla igual.
--   NO con `supabase db push` ni `migration repair` (el historial remoto no
--   está al día; ver 20260930212000).
--
-- PASOS DEL DUEÑO (en este orden)
--
--   (0) Esta migración va DESPUÉS de 20261003110000_reservado_mesa_unica.sql
--       (y de 20261003120000 si se aplica). No depende de ellas.
--   (1) Antes, solo lectura:
--         select md5(replace(prosrc, E'\r', '')) = 'f554d721e6e2e20944a3aea397e88500' as sin_tocar
--         from pg_proc where oid = 'public.validar_capacidad_reserva()'::regprocedure;
--         -- -> true. Si da false, alguien ha cambiado la función: parar y
--         --    revisar (esta migración la pisaría; ella misma aborta).
--         select pid, usename, state, now() - xact_start as abierta_desde,
--                left(query, 60) as consulta
--         from pg_stat_activity
--         where xact_start < now() - interval '1 minute' and pid <> pg_backend_pid()
--         order by xact_start;
--         -- -> ninguna fila.
--   (2) Aplicar:
--         npx supabase db query --linked -f supabase/migrations/20261003130000_sala_privada_ocupa_turno.sql
--       Si falla con 55P03, reintentar.
--   (3) Verificar con las consultas del pie de este fichero.
--   (4) Probar: npx supabase db query --linked -f supabase/tests/sala_privada_ocupa_turno_test.sql
--       (todo dentro de BEGIN … ROLLBACK; no deja nada).
--   (5) Desplegar el panel DESPUÉS: traduce el error nuevo y bloquea en el
--       kanban el movimiento a un Reservado ocupado. Con el panel antiguo el
--       personal vería el mensaje crudo de la BD (comprensible, pero sin
--       formato) al intentarlo.
--   (6) Revertir si hiciera falta:
--       supabase/rollbacks/20261003130000_sala_privada_ocupa_turno_ROLLBACK.sql
-- ===========================================================================

begin;

set local lock_timeout = '5s';

-- 0) No pisar un cambio de terceros ni empezar sobre datos que no se esperan.
do $previa$
declare
  v_md5 text;
  n     integer;
begin
  select md5(replace(p.prosrc, E'\r', '')) into v_md5
  from pg_proc p
  where p.oid = 'public.validar_capacidad_reserva()'::regprocedure;

  if v_md5 is null or v_md5 not in ('f554d721e6e2e20944a3aea397e88500',   -- la de 20260930212000 (producción)
                                    '8b9f3ab23e9d8b5e26e2f328f2d196f9') then                 -- ya aplicada (re-ejecución)
    raise exception 'MIGRACIÓN ABORTADA: validar_capacidad_reserva() no es ni la de 20260930212000 ni la de esta migración (md5 %): alguien la ha cambiado. No se ha tocado nada.', v_md5;
  end if;

  -- Turnos que YA tienen más de una reserva viva en una sala privada activa:
  -- no se tocan (el trigger solo mira filas nuevas o modificadas) pero se avisa.
  select count(*) into n from (
    select 1
    from public.reservas r
    join public.espacios_reserva e on e.id = r.espacio_id
    where e.activa = true
      and e.caracteristicas->>'privada' = 'true'
      and r.estado in ('pendiente', 'verificada', 'confirmada', 'completada')
    group by r.espacio_id, r.fecha, (r.hora >= '17:00:00'::time)
    having count(*) > 1
  ) x;
  if n > 0 then
    raise warning 'Hay % turno(s) con más de una reserva viva en una sala privada activa. No se tocan; revisarlas a mano (consulta 3 del pie de este fichero).', n;
  end if;
end
$previa$;

CREATE OR REPLACE FUNCTION public.validar_capacidad_reserva()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY INVOKER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_capacidad_total INT;
  v_ocupacion_turno INT := 0;
  v_es_comida BOOLEAN;
  v_marca TEXT;
  v_privada BOOLEAN := false;
  v_solo_sala BOOLEAN := false;
  v_sala_nombre TEXT;
  v_sala_capacidad INT;
  v_peso_nuevo INT;
  v_pedidos_txt TEXT;
  v_otra_reserva UUID;
BEGIN
  -- Solo validar si ocupa sitio: pendiente, verificada y confirmada (aforo y
  -- sala) y completada («Llegó»: ya está sentada, solo cuenta para la sala
  -- privada, ver más abajo).
  IF NEW.estado NOT IN ('pendiente', 'verificada', 'confirmada', 'completada') THEN
    RETURN NEW;
  END IF;

  -- 2. Determinar turno (comida < 17:00, cena >= 17:00)
  v_es_comida := NEW.hora < '17:00:00'::time;

  -- 00. Sala PRIVADA de esta reserva (20261003130000): una sala activa con
  --     `caracteristicas.privada = true` la ocupa entera quien la reserva.
  IF NEW.espacio_id IS NOT NULL THEN
    SELECT e.nombre, e.capacidad_maxima
    INTO v_sala_nombre, v_sala_capacidad
    FROM espacios_reserva e
    WHERE e.id = NEW.espacio_id
      AND e.activa = true
      AND e.caracteristicas->>'privada' = 'true';
    v_privada := FOUND;
  END IF;

  -- 0a. Reserva COMPLETADA: no cuenta para el aforo (como siempre), pero está
  --     sentada: solo importa si ENTRA en una sala privada (alta, o cambio de
  --     sala, día o turno). Marcar la llegada de una que ya estaba allí no
  --     comprueba nada.
  IF NEW.estado = 'completada' THEN
    IF NOT v_privada THEN
      RETURN NEW;
    END IF;
    IF TG_OP = 'UPDATE'
       AND OLD.espacio_id IS NOT DISTINCT FROM NEW.espacio_id
       AND OLD.fecha = NEW.fecha
       AND (OLD.hora < '17:00:00'::time) = v_es_comida THEN
      RETURN NEW;
    END IF;
    v_solo_sala := true;
  END IF;

  -- 0. Marca (negocio) de ESTA reserva. `reservas.marca` es NOT NULL con
  --    DEFAULT 'casa_tomas' (20260922180000_marca_negocio_en_reservas.sql),
  --    así que en la práctica nunca es NULL — el COALESCE es una red de
  --    seguridad, no una rama que se espere alcanzar hoy.
  v_marca := COALESCE(NEW.marca, 'casa_tomas');

  -- 0b. UPDATE que NO AÑADE ocupación (20260930212000). La reserva YA
  --     ocupaba plaza (OLD en un estado vivo) y se queda en el MISMO turno
  --     —mismo negocio, mismo día y mismo lado del corte de las 17:00, la
  --     definición de los pasos 0, 2 y 4— sin subir de comensales: se deja
  --     pasar aunque el turno ya esté por encima del aforo (p. ej. tras
  --     desactivar una sala). Cubre reducir comensales, mover la hora
  --     dentro del turno, pasar entre estados vivos y reenviar columnas sin
  --     cambiarlas. Todo lo demás sigue a los pasos 1-5: subir comensales,
  --     cambiar de turno, de día o de negocio, y pasar de un estado no vivo
  --     a uno vivo (eso es añadir ocupación). Un NULL en cualquier
  --     comparación no cuenta como mismo turno: ante la duda, se comprueba.
  --     20261003130000: ENTRAR en una sala privada distinta de la que tenía
  --     tampoco es «no añadir» (pasa a pesar la sala entera) y se comprueba;
  --     salir de una, o quedarse en la misma, sigue pasando (el peso no sube).
  --     No toma el candado del paso 3: no añade ocupación, así que no puede
  --     provocar la carrera que el candado evita.
  IF TG_OP = 'UPDATE' AND NOT v_solo_sala THEN
    IF COALESCE(
         OLD.estado IN ('pendiente', 'verificada', 'confirmada')
         AND COALESCE(OLD.marca, 'casa_tomas') = v_marca
         AND OLD.fecha = NEW.fecha
         AND (OLD.hora < '17:00:00'::time) = (NEW.hora < '17:00:00'::time)
         AND NEW.numero_comensales <= OLD.numero_comensales
         AND (NOT v_privada OR OLD.espacio_id IS NOT DISTINCT FROM NEW.espacio_id),
         false
       ) THEN
      RETURN NEW;
    END IF;
  END IF;

  -- 1. Calcular capacidad total SOLO de los espacios activos DEL MISMO
  --    NEGOCIO que esta reserva (antes sumaba TODOS los espacios activos
  --    sin mirar la marca — ver cabecera de esta migración). Un espacio
  --    sin `caracteristicas.marca` cuenta como 'casa_tomas', igual que
  --    una reserva sin marca en el paso 0: ninguno de los dos lados
  --    desaparece del aforo por accidente.
  IF NOT v_solo_sala THEN
    SELECT COALESCE(SUM(capacidad_maxima), 0)
    INTO v_capacidad_total
    FROM espacios_reserva
    WHERE activa = true
      AND COALESCE(caracteristicas->>'marca', 'casa_tomas') = v_marca;
  END IF;

  -- 3. Bloquear transacciones concurrentes para esta misma fecha y turno
  -- Esto evita race conditions donde dos transacciones leen que hay hueco y luego insertan a la vez.
  -- (Sin filtrar por marca a propósito: dos negocios pidiendo el mismo
  -- fecha+turno siguen sin poder tener una carrera entre sí, y compartir
  -- el candado no penaliza a ninguno de los dos — cada uno solo espera al
  -- que llegó antes, valide o no contra su propio aforo.)
  -- 20261003130000: el mismo candado protege la exclusividad de la sala
  -- privada: dos altas simultáneas en el Reservado se serializan aquí y la
  -- segunda ve a la primera.
  PERFORM pg_advisory_xact_lock(
    hashtext(NEW.fecha::text),
    CASE WHEN v_es_comida THEN 1 ELSE 2 END
  );

  -- 3b. EXCLUSIVIDAD de la sala privada (20261003130000): una sola reserva
  --     por sala, día y turno. Cuentan las vivas y las completadas (ya
  --     sentadas); solo cancelada y «No vino» liberan. No se filtra por
  --     marca: la sala es la sala. Antes que el aforo para que el mensaje
  --     explique lo que de verdad pasa. La propia fila no choca consigo misma.
  IF v_privada THEN
    SELECT r.id
    INTO v_otra_reserva
    FROM reservas r
    WHERE r.fecha = NEW.fecha
      AND r.espacio_id = NEW.espacio_id
      AND (TG_OP = 'INSERT' OR r.id != NEW.id)
      AND r.estado IN ('pendiente', 'verificada', 'confirmada', 'completada')
      AND (
        (v_es_comida AND r.hora < '17:00:00'::time) OR
        (NOT v_es_comida AND r.hora >= '17:00:00'::time)
      )
    LIMIT 1;

    IF v_otra_reserva IS NOT NULL THEN
      RAISE EXCEPTION 'Sala privada ocupada: «%» ya tiene una reserva el % en el turno de %.',
        v_sala_nombre, to_char(NEW.fecha, 'DD/MM/YYYY'),
        CASE WHEN v_es_comida THEN 'comida' ELSE 'cena' END
        USING ERRCODE = 'check_violation',
              DETAIL = format('Reserva en conflicto: %s', v_otra_reserva),
              HINT = 'Una reserva se queda la sala privada entera en su turno. Elige otro turno u otro día, o cancela la otra reserva.';
    END IF;
  END IF;

  IF v_solo_sala THEN
    RETURN NEW;
  END IF;

  -- 4. Calcular ocupación actual del MISMO turno en esa fecha, SOLO de
  --    reservas DEL MISMO NEGOCIO (mismo motivo que el paso 1: si esto
  --    sumara las dos marcas, una reserva de Touza restaría aforo al
  --    restaurante y viceversa — el bug no se arregla, se traslada aquí).
  --    20261003130000: una reserva en una sala privada activa pesa la sala
  --    entera (GREATEST(capacidad_maxima, comensales)), no sus comensales.
  SELECT COALESCE(SUM(
           CASE WHEN e.id IS NOT NULL
                THEN GREATEST(e.capacidad_maxima, r.numero_comensales)
                ELSE r.numero_comensales
           END), 0)
  INTO v_ocupacion_turno
  FROM reservas r
  LEFT JOIN espacios_reserva e
         ON e.id = r.espacio_id
        AND e.activa = true
        AND e.caracteristicas->>'privada' = 'true'
  WHERE r.fecha = NEW.fecha
    -- Excluir la propia reserva si es un UPDATE
    AND (TG_OP = 'INSERT' OR r.id != NEW.id)
    AND r.estado IN ('pendiente', 'verificada', 'confirmada')
    AND COALESCE(r.marca, 'casa_tomas') = v_marca
    AND (
      (v_es_comida AND r.hora < '17:00:00'::time) OR
      (NOT v_es_comida AND r.hora >= '17:00:00'::time)
    );

  -- 5. Validar capacidad
  v_peso_nuevo := CASE WHEN v_privada
                       THEN GREATEST(v_sala_capacidad, NEW.numero_comensales)
                       ELSE NEW.numero_comensales END;

  IF v_ocupacion_turno + v_peso_nuevo > v_capacidad_total THEN
    -- Mismo mensaje de siempre (el panel y las Edge Functions buscan «Aforo»);
    -- en una sala privada se le añade al final por qué piden tantas plazas.
    v_pedidos_txt := v_peso_nuevo::text ||
      CASE WHEN v_privada
           THEN format(' («%s» es sala privada: una reserva cuenta como la sala entera)', v_sala_nombre)
           ELSE '' END;
    RAISE EXCEPTION 'Aforo superado para el turno. Capacidad total: %, Ocupación actual: %, Pedidos: %',
      v_capacidad_total, v_ocupacion_turno, v_pedidos_txt
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$function$;

-- El trigger, también con `espacio_id` (ver QUÉ CAMBIA, punto 2). Mismo
-- nombre, misma tabla, mismo momento (BEFORE, FOR EACH ROW) y misma función;
-- solo se añade una columna a la lista del UPDATE.
CREATE OR REPLACE TRIGGER trg_validar_capacidad
  BEFORE INSERT OR UPDATE OF fecha, hora, numero_comensales, estado, marca, espacio_id
  ON public.reservas
  FOR EACH ROW
  EXECUTE FUNCTION public.validar_capacidad_reserva();

-- 1) Comprobación antes del COMMIT: si algo no ha quedado como se espera,
--    se aborta la transacción entera y no se aplica nada.
do $comprobacion$
declare
  v_md5     text;
  v_secdef  boolean;
  v_config  text[];
  v_trigger text;
begin
  select md5(replace(p.prosrc, E'\r', '')), p.prosecdef, p.proconfig
    into v_md5, v_secdef, v_config
  from pg_proc p
  where p.oid = 'public.validar_capacidad_reserva()'::regprocedure;

  if v_md5 is distinct from '8b9f3ab23e9d8b5e26e2f328f2d196f9' then
    raise exception 'MIGRACIÓN ABORTADA: el cuerpo instalado no es el de esta migración (md5 %). No se ha aplicado nada.', v_md5;
  end if;
  if v_secdef is distinct from false or v_config is distinct from array['search_path=public'] then
    raise exception 'MIGRACIÓN ABORTADA: la función no ha quedado SECURITY INVOKER con search_path=public (prosecdef %, proconfig %). No se ha aplicado nada.', v_secdef, v_config;
  end if;

  select pg_get_triggerdef(t.oid) into v_trigger
  from pg_trigger t
  where t.tgrelid = 'public.reservas'::regclass and t.tgname = 'trg_validar_capacidad';

  if v_trigger is null or v_trigger not like
     'CREATE TRIGGER trg_validar_capacidad BEFORE INSERT OR UPDATE OF fecha, hora, numero_comensales, estado, marca, espacio_id ON public.reservas FOR EACH ROW EXECUTE FUNCTION %validar_capacidad_reserva()' then
    raise exception 'MIGRACIÓN ABORTADA: el trigger no ha quedado como se esperaba: %. No se ha aplicado nada.', v_trigger;
  end if;
end
$comprobacion$;

commit;

-- ===========================================================================
-- VERIFICACIÓN tras aplicarla (solo lectura)
-- ===========================================================================
--   -- 1) Función: es EXACTAMENTE la de este fichero, sigue INVOKER.
--   select md5(replace(p.prosrc, E'\r', '')) = '8b9f3ab23e9d8b5e26e2f328f2d196f9' as cuerpo_nuevo,
--          p.prosecdef, p.proconfig, pg_get_userbyid(p.proowner) as propietario
--   from pg_proc p
--   where p.oid = 'public.validar_capacidad_reserva()'::regprocedure;
--   -- -> true | false | {search_path=public} | postgres
--
--   -- 2) Trigger: salta también con espacio_id.
--   select pg_get_triggerdef(oid) from pg_trigger
--   where tgrelid = 'public.reservas'::regclass and tgname = 'trg_validar_capacidad';
--   -- -> … BEFORE INSERT OR UPDATE OF fecha, hora, numero_comensales, estado,
--   --    marca, espacio_id ON public.reservas FOR EACH ROW EXECUTE FUNCTION
--   --    validar_capacidad_reserva()
--
--   -- 3) Turnos con más de una reserva viva en una sala privada activa
--   --    (no deberían existir; la migración no los toca):
--   select r.espacio_id, e.nombre, r.fecha,
--          case when r.hora < '17:00:00'::time then 'comida' else 'cena' end as turno,
--          count(*) as reservas, array_agg(r.id) as ids
--   from public.reservas r
--   join public.espacios_reserva e on e.id = r.espacio_id
--   where e.activa = true and e.caracteristicas->>'privada' = 'true'
--     and r.estado in ('pendiente', 'verificada', 'confirmada', 'completada')
--   group by 1, 2, 3, 4
--   having count(*) > 1;
--
--   -- 4) Pruebas con escritura y ROLLBACK:
--   --    supabase/tests/sala_privada_ocupa_turno_test.sql
-- ===========================================================================
