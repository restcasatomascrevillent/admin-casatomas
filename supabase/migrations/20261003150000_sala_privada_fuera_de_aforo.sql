set client_encoding = 'UTF8';
-- (Primera línea a propósito: psql lanzado desde PowerShell/cmd arranca en
-- WIN1252 y dejaría los mensajes del RAISE como «OcupaciÃ³n actual».)
-- ===========================================================================
-- ##                                                                       ##
-- ##              NO APLICADA: la aplica el dueño a mano                   ##
-- ##                                                                       ##
-- ##   Escrita el 2026-10-03 contra la definición VIVA de producción       ##
-- ##   (pg_get_functiondef / pg_get_viewdef, solo lectura). No se ha       ##
-- ##   ejecutado en producción; se probó solo en un simulacro dentro de    ##
-- ##   una transacción con ROLLBACK (más el test supabase/tests/           ##
-- ##   sala_privada_fuera_de_aforo_test.sql). Pasos del dueño al final de  ##
-- ##   esta cabecera (PASOS DEL DUEÑO).                                    ##
-- ##                                                                       ##
-- ===========================================================================
--
-- LA REGLA DE NEGOCIO (dueño, 2026-10-03, por la tarde; SUSTITUYE a la de la
-- mañana de 20261003130000). Literal: «el Reservado no quiero que se tenga en
-- cuenta en los aforos porque no es accesible, es para gente especial y está
-- fuera del sistema de reservas, pero que sepamos que está»
--
--   R1. Una sala PRIVADA (`espacios_reserva.caracteristicas.privada = true`;
--       hoy solo «Reservado» de Casa Tomás, 20 plazas) NO suma su capacidad al
--       aforo de la marca: Casa Tomás pasa de 170 a 150 (Comedor + Salón +
--       Terraza).
--   R2. Una reserva en una sala privada NO consume aforo (ni la capacidad de
--       la sala ni sus comensales). Nunca llena ni bloquea un turno del
--       restaurante, esté como esté de lleno.
--   R3. SE MANTIENE la exclusividad: una sola reserva viva (pendiente,
--       verificada, confirmada o completada) por sala privada, día y turno;
--       cancelada y «No vino» liberan. Error 23514 «Sala privada ocupada…»
--       exactamente como en 20261003130000.
--   R4. Solo se reserva desde el panel (la web y el bot no ofrecen ni asignan
--       sala privada: hoy ya es así; esta migración no lo cambia).
--   R5. Que el personal la VEA (avisos, etiquetas «Fuera de aforo», icono en
--       el calendario): es del panel, no de esta migración.
--
-- CÓMO ESTABA (producción, 2026-10-03, tras 20261003130000)
--
--   · `validar_capacidad_reserva()` (md5 8b9f3ab2…): capacidad = suma de
--     `capacidad_maxima` de las salas activas del negocio (170 = 50+50+50+20);
--     una reserva en sala privada pesaba GREATEST(capacidad_maxima,
--     comensales) en el aforo (ocupaba "20" aunque fueran 5); más la
--     exclusividad de sala privada.
--   · `fn_capacidad_efectiva_marca(text)` (md5 cb3d4d66…, SECURITY DEFINER,
--     informativa: el trigger NO la llama): suma las plazas de las mesas de
--     las salas activas de la marca, o sea también la mesa única de 20 plazas
--     del Reservado.
--   · `vista_ocupacion_hoy` (security_invoker): suma las reservas de hoy
--     incluidas las del Reservado.
--
-- QUÉ CAMBIA
--
--   1. `validar_capacidad_reserva()` (misma firma, RETURNS trigger, SECURITY
--      INVOKER, `SET search_path TO 'public'`, VOLATILE; propietario y
--      permisos no cambian: CREATE OR REPLACE los conserva):
--        ANTES  capacidad = Σ capacidad_maxima (activas, de la marca)
--               ocupación = Σ GREATEST(capacidad_maxima, comensales) en sala
--                           privada, comensales en las demás
--        AHORA  capacidad = Σ capacidad_maxima (activas, de la marca, SIN
--                           salas privadas)              → 150
--               ocupación = Σ comensales de las vivas que NO están en una sala
--                           privada activa
--               una reserva EN sala privada: solo se comprueba la
--               exclusividad (R3) y se sale; no se mira el aforo (R2)
--      Se conserva todo lo demás: el candado advisory por día+turno, el
--      mensaje y el ERRCODE de «Aforo superado» (los traducen el panel y las
--      Edge Functions) y de «Sala privada ocupada», el paso 0b (un UPDATE que
--      no añade ocupación pasa aunque el turno esté pasado de aforo), el trato
--      de las completadas («Llegó»: no cuentan en el aforo, sí ocupan la sala).
--      Un cambio NECESARIO en el paso 0b: SALIR de una sala privada a una
--      normal ahora SÍ añade ocupación (antes, con el peso GREATEST, salir
--      siempre bajaba el peso). Sin esto, mover la reserva del Reservado al
--      Comedor colaría 20 comensales por encima del aforo sin comprobar nada.
--      El mensaje de «Aforo superado» pierde el sufijo «(… es sala privada…)»
--      de 20261003130000: ya no hay peso de sala que explicar.
--   2. `fn_capacidad_efectiva_marca(text)`: ahora excluye las salas privadas
--      (la mesa del Reservado no es aforo). Sigue siendo informativa.
--   3. `vista_ocupacion_hoy`: excluye las reservas que están en una sala
--      privada activa (mismas columnas, mismo orden y tipos; sigue
--      `security_invoker = on` y con el mismo comentario y permisos).
--   El trigger `trg_validar_capacidad` NO se toca (ya salta con `espacio_id`
--   desde 20261003130000).
--
-- QUÉ NO CAMBIA (revisado)
--
--   · `ocupacion_diaria` / `vista_ocupacion` (la mantiene un trigger, cuenta
--     reservas por fecha y hora, sin aforo; ya no la lee nadie: ver la
--     cabecera de `src/hooks/useDisponibilidad.ts`).
--   · `vista_capacidad_espacios` y `fn_capacidad_efectiva_espacio(uuid)`: son
--     por SALA, no suman un aforo de marca; el Reservado sigue cuadrando
--     (20 declaradas = 20 de su mesa única, 20261003110000).
--   · La mesa única «Reservado» de 20 plazas y su exclusividad de mesa (índice
--     único de `asignaciones_mesa`, 20261003110000) se quedan.
--
-- DATOS EXISTENTES (verificado en producción el 2026-10-03, solo SELECT)
--
--   · Casa Tomás: Comedor 50, Salón 50, Terraza 50 y Reservado 20 (privada,
--     activa). No hay salas de otra marca (20261003120000 está aplicada).
--   · NO se toca ninguna fila. Las reservas del Reservado (hoy, una `no_show`
--     del 29/09) siguen donde están; simplemente dejan de contar en el aforo.
--   · Efecto inmediato en cifras: el aforo de un turno baja de 170 a 150. Si
--     algún turno futuro estuviera entre 151 y 170 comensales, quedaría por
--     encima del aforo (los UPDATE que no suben comensales siguen pasando por
--     el paso 0b; las altas nuevas se rechazan). El aviso de la comprobación
--     previa lo cuenta; no aborta.
--
-- CÓMO SE EJECUTA
--
--   Lleva su propio BEGIN/COMMIT (a diferencia del resto de
--   supabase/migrations/, porque se aplica a mano): es atómica se lance como se
--   lance —`npx supabase db query --linked -f`, `psql -f` o pegada entera en
--   el SQL editor—. Si algo falla, no se aplica nada.
--   `lock_timeout = '5s'`: `CREATE OR REPLACE VIEW` pide un candado sobre
--   `vista_ocupacion_hoy` y la función se reemplaza en el catálogo; si no los
--   consigue en 5 s falla con 55P03 (lock_not_available), no deja nada
--   aplicado y basta con reintentar.
--   Idempotente: todo va con CREATE OR REPLACE; si ya está aplicada, vuelve a
--   dejarla igual.
--   `supabase db query -f` NO imprime nada si el fichero no acaba en una
--   SELECT: por eso este acaba en una SELECT de verificación (la fila
--   «sala_privada_fuera_de_aforo: aplicada» es la señal de que ha ido bien).
--   NO con `supabase db push` ni `migration repair` (el historial remoto no
--   está al día; ver 20260930212000).
--
-- PASOS DEL DUEÑO (en este orden)
--
--   (0) Después de 20261003130000 (ya aplicada). Esta migración la parte y
--       aborta si la función no es la de 20261003130000.
--   (1) Antes, solo lectura:
--         select md5(replace(prosrc, E'\r', '')) = '8b9f3ab23e9d8b5e26e2f328f2d196f9' as sin_tocar
--         from pg_proc where oid = 'public.validar_capacidad_reserva()'::regprocedure;
--         -- -> true. Si da false, alguien ha cambiado la función: parar.
--         select pid, usename, state, now() - xact_start as abierta_desde,
--                left(query, 60) as consulta
--         from pg_stat_activity
--         where xact_start < now() - interval '1 minute' and pid <> pg_backend_pid()
--         order by xact_start;
--         -- -> ninguna fila.
--   (2) Aplicar:
--         npx supabase db query --linked -f supabase/migrations/20261003150000_sala_privada_fuera_de_aforo.sql
--       Debe terminar imprimiendo UNA fila «sala_privada_fuera_de_aforo:
--       aplicada» con funcion_ok, capacidad_ok y vista_ok a true y
--       aforo_casa_tomas = 150. Si falla con 55P03, reintentar.
--   (3) Probar: npx supabase db query --linked -f supabase/tests/sala_privada_fuera_de_aforo_test.sql
--       (todo dentro de BEGIN … ROLLBACK; no deja nada). Acaba con una fila de
--       limpieza: 0 | 0 | 0 | <md5> | 1.
--   (4) Desplegar el panel (aforo 150, avisos y etiquetas «Fuera de aforo»),
--       después reservas-web (Edge Function: excluye las salas privadas de la
--       capacidad) y, por último, el bot telefónico (restaurante-phone).
--       Hasta entonces web y bot siguen contando 170 y pueden ofrecer una hora
--       que el trigger (150) rechazará con 23514 «Aforo superado» (lo
--       traducen); solo se nota en un turno casi lleno.
--   (5) Revertir si hiciera falta:
--       supabase/rollbacks/20261003150000_sala_privada_fuera_de_aforo_ROLLBACK.sql
-- ===========================================================================

begin;

set local lock_timeout = '5s';

-- 0) No pisar un cambio de terceros ni empezar sobre datos que no se esperan.
do $previa$
declare
  v_md5_fn   text;
  v_md5_cap  text;
  v_md5_vista text;
  n          integer;
begin
  select md5(replace(p.prosrc, E'\r', '')) into v_md5_fn
  from pg_proc p
  where p.oid = 'public.validar_capacidad_reserva()'::regprocedure;

  if v_md5_fn is null or v_md5_fn not in ('8b9f3ab23e9d8b5e26e2f328f2d196f9',   -- la de 20261003130000 (producción)
                                          '996f159e2b477fa47cb25fa8ef3ae430') then                    -- ya aplicada (re-ejecución)
    raise exception 'MIGRACIÓN ABORTADA: validar_capacidad_reserva() no es ni la de 20261003130000 ni la de esta migración (md5 %): alguien la ha cambiado. No se ha tocado nada.', v_md5_fn;
  end if;

  select md5(replace(p.prosrc, E'\r', '')) into v_md5_cap
  from pg_proc p
  where p.oid = 'public.fn_capacidad_efectiva_marca(text)'::regprocedure;

  if v_md5_cap is null or v_md5_cap not in ('cb3d4d66a60044740c96dba10c1a6d35',  -- la de producción
                                            'fe95fcf2e03330ecbf20b92d424e653b') then                   -- ya aplicada
    raise exception 'MIGRACIÓN ABORTADA: fn_capacidad_efectiva_marca(text) no es la esperada (md5 %). No se ha tocado nada.', v_md5_cap;
  end if;

  select md5(pg_get_viewdef('public.vista_ocupacion_hoy'::regclass)) into v_md5_vista;

  if v_md5_vista is null or v_md5_vista not in ('f5f905125a75b1791197cbf72e7ab237',  -- la de producción
                                                'fc6bb54bce202fc44c755ed038915908') then                 -- ya aplicada
    raise exception 'MIGRACIÓN ABORTADA: vista_ocupacion_hoy no es la esperada (md5 %). No se ha tocado nada.', v_md5_vista;
  end if;

  -- Turnos futuros que, con el aforo nuevo (sin salas privadas), quedarían por
  -- encima: solo se avisa. No se tocan filas.
  select count(*) into n from (
    select r.fecha, (r.hora >= '17:00:00'::time) as cena
    from public.reservas r
    where r.fecha >= current_date
      and r.estado in ('pendiente', 'verificada', 'confirmada')
      and coalesce(r.marca, 'casa_tomas') = 'casa_tomas'
      and not exists (select 1 from public.espacios_reserva e
                      where e.id = r.espacio_id and e.activa = true
                        and e.caracteristicas->>'privada' = 'true')
    group by 1, 2
    having sum(r.numero_comensales) > (
      select coalesce(sum(e.capacidad_maxima), 0)
      from public.espacios_reserva e
      where e.activa = true
        and coalesce(e.caracteristicas->>'marca', 'casa_tomas') = 'casa_tomas'
        and (e.caracteristicas->>'privada') is distinct from 'true')
  ) x;
  if n > 0 then
    raise warning 'Hay % turno(s) futuro(s) de Casa Tomás por encima del aforo sin salas privadas. No se tocan; solo dejan de admitir altas nuevas.', n;
  end if;
end
$previa$;

-- 1) El trigger de aforo.
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
  v_vieja_privada BOOLEAN := false;
  v_solo_sala BOOLEAN := false;
  v_sala_nombre TEXT;
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
  --     `caracteristicas.privada = true`. 20261003150000: está FUERA DE AFORO
  --     (no suma capacidad y sus reservas no consumen aforo), pero una sola
  --     reserva viva por día y turno.
  IF NEW.espacio_id IS NOT NULL THEN
    SELECT e.nombre
    INTO v_sala_nombre
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

  -- 0c. SALIR de una sala privada (20261003150000). Su reserva no consumía
  --     aforo; en una sala normal sí. Por eso un UPDATE que la saca de una
  --     sala privada SÍ añade ocupación al turno, aunque no suba comensales,
  --     y no puede pasar por el paso 0b.
  IF TG_OP = 'UPDATE' AND OLD.espacio_id IS NOT NULL
     AND OLD.espacio_id IS DISTINCT FROM NEW.espacio_id THEN
    SELECT EXISTS (
      SELECT 1
      FROM espacios_reserva e
      WHERE e.id = OLD.espacio_id
        AND e.activa = true
        AND e.caracteristicas->>'privada' = 'true'
    ) INTO v_vieja_privada;
  END IF;

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
  --     tampoco es «no añadir» (hay que comprobar la exclusividad); quedarse
  --     en la misma sigue pasando.
  --     20261003150000: SALIR de una sala privada a una normal tampoco lo es
  --     (v_vieja_privada, paso 0c): empieza a consumir aforo.
  --     No toma el candado del paso 3: no añade ocupación, así que no puede
  --     provocar la carrera que el candado evita.
  IF TG_OP = 'UPDATE' AND NOT v_solo_sala THEN
    IF COALESCE(
         OLD.estado IN ('pendiente', 'verificada', 'confirmada')
         AND COALESCE(OLD.marca, 'casa_tomas') = v_marca
         AND OLD.fecha = NEW.fecha
         AND (OLD.hora < '17:00:00'::time) = (NEW.hora < '17:00:00'::time)
         AND NEW.numero_comensales <= OLD.numero_comensales
         AND (NOT v_privada OR OLD.espacio_id IS NOT DISTINCT FROM NEW.espacio_id)
         AND NOT v_vieja_privada,
         false
       ) THEN
      RETURN NEW;
    END IF;
  END IF;

  -- 1. Calcular capacidad total SOLO de los espacios activos DEL MISMO
  --    NEGOCIO que esta reserva (antes sumaba TODOS los espacios activos
  --    sin mirar la marca — ver 20260922190000). Un espacio sin
  --    `caracteristicas.marca` cuenta como 'casa_tomas', igual que
  --    una reserva sin marca en el paso 0: ninguno de los dos lados
  --    desaparece del aforo por accidente.
  --    20261003150000: las salas PRIVADAS no suman (fuera de aforo): Casa
  --    Tomás = Comedor + Salón + Terraza = 150. Una reserva en sala privada
  --    ni siquiera llega aquí (v_privada: se sale tras la exclusividad).
  IF NOT v_solo_sala AND NOT v_privada THEN
    SELECT COALESCE(SUM(capacidad_maxima), 0)
    INTO v_capacidad_total
    FROM espacios_reserva
    WHERE activa = true
      AND COALESCE(caracteristicas->>'marca', 'casa_tomas') = v_marca
      AND (caracteristicas->>'privada') IS DISTINCT FROM 'true';
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
  --     marca: la sala es la sala. La propia fila no choca consigo misma.
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

  -- 3c. (20261003150000) La sala privada está FUERA DE AFORO: superada la
  --     exclusividad no se mira el aforo. Una reserva en ella no consume
  --     aforo (ni capacidad ni comensales) y, por tanto, nunca llena ni
  --     bloquea un turno del restaurante, esté como esté de lleno.
  --     Las completadas («Llegó») también terminan aquí: solo les importaba la sala.
  IF v_solo_sala OR v_privada THEN
    RETURN NEW;
  END IF;

  -- 4. Calcular ocupación actual del MISMO turno en esa fecha, SOLO de
  --    reservas DEL MISMO NEGOCIO (mismo motivo que el paso 1: si esto
  --    sumara las dos marcas, una reserva de Touza restaría aforo al
  --    restaurante y viceversa — el bug no se arregla, se traslada aquí).
  --    20261003150000: las reservas que están en una sala privada activa NO
  --    cuentan (fuera de aforo).
  SELECT COALESCE(SUM(r.numero_comensales), 0)
  INTO v_ocupacion_turno
  FROM reservas r
  WHERE r.fecha = NEW.fecha
    -- Excluir la propia reserva si es un UPDATE
    AND (TG_OP = 'INSERT' OR r.id != NEW.id)
    AND r.estado IN ('pendiente', 'verificada', 'confirmada')
    AND COALESCE(r.marca, 'casa_tomas') = v_marca
    AND (
      (v_es_comida AND r.hora < '17:00:00'::time) OR
      (NOT v_es_comida AND r.hora >= '17:00:00'::time)
    )
    AND NOT EXISTS (
      SELECT 1
      FROM espacios_reserva e
      WHERE e.id = r.espacio_id
        AND e.activa = true
        AND e.caracteristicas->>'privada' = 'true'
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

-- 2) Aforo efectivo por mesas de una marca (informativa): sin salas privadas.
CREATE OR REPLACE FUNCTION public.fn_capacidad_efectiva_marca(p_marca text)
 RETURNS integer
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select coalesce(sum(m.capacidad), 0)::integer
  from public.espacios_reserva e
  join public.mesas m on m.espacio_id = e.id
  where e.activa = true
    and coalesce(e.caracteristicas->>'marca', 'casa_tomas') = coalesce(p_marca, 'casa_tomas')
    and (e.caracteristicas->>'privada') is distinct from 'true'
    and m.activa is not false
    and coalesce(m.is_merged, false) = false;
$function$;

-- 3) Resumen de hoy sin las reservas de salas privadas. Mismas columnas, tipos
--    y orden; `security_invoker = on` explícito (sin él se perdería: ver
--    20260919130000). El comentario y los permisos se conservan.
CREATE OR REPLACE VIEW public.vista_ocupacion_hoy
WITH (security_invoker = on)
AS
SELECT
  COALESCE(count(*), 0::bigint)::integer AS total_reservas,
  COALESCE(sum(numero_comensales), 0::bigint)::integer AS total_comensales,
  count(*) FILTER (WHERE estado::text = 'confirmada'::text)::integer AS reservas_confirmadas,
  count(*) FILTER (WHERE estado::text = 'pendiente'::text)::integer AS reservas_pendientes,
  count(*) FILTER (WHERE estado::text = 'cancelada'::text)::integer AS reservas_canceladas,
  COALESCE(sum(numero_comensales) FILTER (WHERE estado::text = 'confirmada'::text), 0::bigint)::integer AS comensales_confirmados,
  count(*) FILTER (WHERE estado::text = 'verificada'::text)::integer AS reservas_verificadas,
  count(*) FILTER (WHERE estado::text = 'completada'::text)::integer AS reservas_completadas,
  count(*) FILTER (WHERE estado::text = 'no_show'::text)::integer AS reservas_no_show,
  count(*) FILTER (
    WHERE estado::text = ANY (ARRAY['pendiente'::text, 'verificada'::text, 'confirmada'::text])
  )::integer AS reservas_activas,
  COALESCE(
    sum(numero_comensales) FILTER (
      WHERE estado::text = ANY (ARRAY['pendiente'::text, 'verificada'::text, 'confirmada'::text])
    ),
    0::bigint
  )::integer AS comensales_activos
FROM public.reservas r
WHERE r.fecha = CURRENT_DATE
  -- Fuera de aforo (2026-10-03): las reservas de una sala privada activa no cuentan.
  AND NOT EXISTS (
    SELECT 1
    FROM public.espacios_reserva e
    WHERE e.id = r.espacio_id
      AND e.activa = true
      AND e.caracteristicas->>'privada' = 'true'
  );

-- 4) Comprobación antes del COMMIT: si algo no ha quedado como se espera,
--    se aborta la transacción entera y no se aplica nada.
do $comprobacion$
declare
  v_md5     text;
  v_secdef  boolean;
  v_config  text[];
  v_trigger text;
  v_cap     text;
  v_vista   text;
  v_opts    text[];
  v_acl     text;
  v_aforo   integer;
begin
  select md5(replace(p.prosrc, E'\r', '')), p.prosecdef, p.proconfig
    into v_md5, v_secdef, v_config
  from pg_proc p
  where p.oid = 'public.validar_capacidad_reserva()'::regprocedure;

  if v_md5 is distinct from '996f159e2b477fa47cb25fa8ef3ae430' then
    raise exception 'MIGRACIÓN ABORTADA: el cuerpo de validar_capacidad_reserva() no es el de esta migración (md5 %). No se ha aplicado nada.', v_md5;
  end if;
  if v_secdef is distinct from false or v_config is distinct from array['search_path=public'] then
    raise exception 'MIGRACIÓN ABORTADA: la función no ha quedado SECURITY INVOKER con search_path=public (prosecdef %, proconfig %). No se ha aplicado nada.', v_secdef, v_config;
  end if;

  select pg_get_triggerdef(t.oid) into v_trigger
  from pg_trigger t
  where t.tgrelid = 'public.reservas'::regclass and t.tgname = 'trg_validar_capacidad';

  if v_trigger is null or v_trigger not like
     'CREATE TRIGGER trg_validar_capacidad BEFORE INSERT OR UPDATE OF fecha, hora, numero_comensales, estado, marca, espacio_id ON public.reservas FOR EACH ROW EXECUTE FUNCTION %validar_capacidad_reserva()' then
    raise exception 'MIGRACIÓN ABORTADA: el trigger no está como se esperaba: %. No se ha aplicado nada.', v_trigger;
  end if;

  select md5(replace(p.prosrc, E'\r', '')), p.prosecdef
    into v_cap, v_secdef
  from pg_proc p
  where p.oid = 'public.fn_capacidad_efectiva_marca(text)'::regprocedure;
  if v_cap is distinct from 'fe95fcf2e03330ecbf20b92d424e653b' or v_secdef is distinct from true then
    raise exception 'MIGRACIÓN ABORTADA: fn_capacidad_efectiva_marca(text) no ha quedado como se esperaba (md5 %, prosecdef %). No se ha aplicado nada.', v_cap, v_secdef;
  end if;

  select md5(pg_get_viewdef('public.vista_ocupacion_hoy'::regclass)), c.reloptions, c.relacl::text
    into v_vista, v_opts, v_acl
  from pg_class c
  where c.oid = 'public.vista_ocupacion_hoy'::regclass;
  if v_vista is distinct from 'fc6bb54bce202fc44c755ed038915908' then
    raise exception 'MIGRACIÓN ABORTADA: vista_ocupacion_hoy no ha quedado como se esperaba (md5 %). No se ha aplicado nada.', v_vista;
  end if;
  if v_opts is distinct from array['security_invoker=on'] then
    raise exception 'MIGRACIÓN ABORTADA: vista_ocupacion_hoy ha perdido security_invoker (reloptions %). No se ha aplicado nada.', v_opts;
  end if;
  if v_acl is distinct from '{postgres=arwdDxtm/postgres,authenticated=arwdDxtm/postgres,service_role=arwdDxtm/postgres}' then
    raise exception 'MIGRACIÓN ABORTADA: vista_ocupacion_hoy ha cambiado de permisos (%). No se ha aplicado nada.', v_acl;
  end if;

  -- El aforo de Casa Tomás, tal como lo suma ahora el trigger.
  select coalesce(sum(capacidad_maxima), 0)::integer into v_aforo
  from public.espacios_reserva
  where activa = true
    and coalesce(caracteristicas->>'marca', 'casa_tomas') = 'casa_tomas'
    and (caracteristicas->>'privada') is distinct from 'true';
  if v_aforo <= 0 then
    raise exception 'MIGRACIÓN ABORTADA: el aforo de Casa Tomás sin salas privadas daría % (bloquearía todas las reservas). No se ha aplicado nada.', v_aforo;
  end if;
  raise notice 'Aforo de Casa Tomás (sin salas privadas): %', v_aforo;
end
$comprobacion$;

commit;

-- 5) Verificación (solo lectura; es lo que imprime `db query -f`). Una fila.
select 'sala_privada_fuera_de_aforo: aplicada' as resultado,
       (select md5(replace(p.prosrc, E'\r', '')) = '996f159e2b477fa47cb25fa8ef3ae430'
          from pg_proc p where p.oid = 'public.validar_capacidad_reserva()'::regprocedure) as funcion_ok,
       (select md5(replace(p.prosrc, E'\r', '')) = 'fe95fcf2e03330ecbf20b92d424e653b'
          from pg_proc p where p.oid = 'public.fn_capacidad_efectiva_marca(text)'::regprocedure) as capacidad_ok,
       (select md5(pg_get_viewdef('public.vista_ocupacion_hoy'::regclass)) = 'fc6bb54bce202fc44c755ed038915908') as vista_ok,
       (select coalesce(sum(capacidad_maxima), 0)::integer
          from public.espacios_reserva
          where activa = true
            and coalesce(caracteristicas->>'marca', 'casa_tomas') = 'casa_tomas'
            and (caracteristicas->>'privada') is distinct from 'true') as aforo_casa_tomas,
       (select count(*) from pg_trigger
          where tgrelid = 'public.reservas'::regclass and tgname = 'trg_validar_capacidad' and tgenabled = 'O') as trigger_activo;
-- -> aplicada | true | true | true | 150 | 1

-- ===========================================================================
-- VERIFICACIÓN extra tras aplicarla (solo lectura)
-- ===========================================================================
--   -- Función: INVOKER, search_path=public, propietario postgres.
--   select p.prosecdef, p.proconfig, pg_get_userbyid(p.proowner) as propietario
--   from pg_proc p where p.oid = 'public.validar_capacidad_reserva()'::regprocedure;
--   -- -> false | {search_path=public} | postgres
--
--   -- Reservas vivas hoy y futuras que están en una sala privada (fuera de aforo):
--   select r.fecha, r.hora, r.nombre, r.numero_comensales, r.estado, e.nombre as sala
--   from public.reservas r
--   join public.espacios_reserva e on e.id = r.espacio_id
--   where e.activa = true and e.caracteristicas->>'privada' = 'true'
--     and r.fecha >= current_date
--     and r.estado in ('pendiente', 'verificada', 'confirmada', 'completada')
--   order by r.fecha, r.hora;
--
--   -- Pruebas con escritura y ROLLBACK:
--   --    supabase/tests/sala_privada_fuera_de_aforo_test.sql
-- ===========================================================================
