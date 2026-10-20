set client_encoding = 'UTF8';
-- (Primera línea a propósito: psql en una consola de Windows puede arrancar
-- en WIN1252 y leer mal las tildes del cuerpo de la función.)
-- ===========================================================================
-- ROLLBACK de supabase/migrations/20261003150000_sala_privada_fuera_de_aforo.sql
-- ===========================================================================
--
-- Este fichero NO es una migración y no debe copiarse a
-- supabase/migrations/ (ver supabase/rollbacks/README.md). Se ejecuta A MANO
-- (psql / SQL editor), entero: lleva su propio begin/commit.
--
-- Qué revierte (todo EXACTO a lo que había en producción el 2026-10-03):
--   · validar_capacidad_reserva() vuelve a la definición de 20261003130000
--     (md5(prosrc) = 8b9f3ab23e9d8b5e26e2f328f2d196f9): SECURITY INVOKER,
--     SET search_path TO 'public'. Propietario y permisos no cambian.
--   · fn_capacidad_efectiva_marca(text) vuelve a sumar las mesas de todas las
--     salas activas de la marca, privadas incluidas (md5 cb3d4d66…).
--   · vista_ocupacion_hoy vuelve a contar todas las reservas de hoy, también
--     las de salas privadas (security_invoker = on; md5 de pg_get_viewdef
--     f5f90512…).
--   El trigger trg_validar_capacidad no se toca (la migración tampoco).
--
-- Efecto de ejecutarlo: el Reservado vuelve a sumar 20 al aforo de Casa Tomás
-- (170) y una reserva suya vuelve a pesar la sala entera (20) en el turno
-- (la regla de 20261003130000). El panel nuevo calcula el aforo por su cuenta
-- (150, sin salas privadas): si se revierte la BD conviene revertir también el
-- panel, o las dos cifras no coincidirán.
--
-- Qué se pierde: nada guardado. Ni la migración ni este rollback tocan filas.
-- Si hay turnos que con aforo 170 y el Reservado pesando 20 quedan pasados de
-- aforo, siguen ahí (los UPDATE que no suben comensales siguen pasando).
--
-- Si la migración NO llegó a aplicarse, ejecutar esto no cambia nada:
-- reescribe las tres piezas con lo que ya tienen.
--
-- Antes de tocar nada comprueba que cada pieza es la de la migración o la de
-- antes, normalizando los \r por si se aplicó desde un checkout con CRLF. Si
-- es otra cosa, alguien la ha cambiado después: aborta sin pisarla.
--
-- Se lanza como la migración: `npx supabase db query --linked -f <este
-- fichero>`, `psql "$DB_URL" -v ON_ERROR_STOP=1 -f <este fichero>` o pegado
-- entero en el SQL editor. Lleva `lock_timeout = '5s'`; si falla con 55P03,
-- reintentar al rato: no se ha aplicado nada. Acaba con una SELECT que
-- imprime «sala_privada_fuera_de_aforo: revertida».
--
-- Por qué las funciones van dentro de un EXECUTE con replace(): este repo tiene
-- core.autocrlf=true, y un \r dentro del cuerpo lo haría distinto byte a byte
-- del original (misma lógica, distinto md5). Al final, dentro de la misma
-- transacción, se comprueba que han quedado exactas; si no, se aborta.
-- ===========================================================================

begin;

set local lock_timeout = '5s';

-- 0) No pisar un cambio de terceros.
do $previa$
declare
  v_fn    text;
  v_cap   text;
  v_vista text;
begin
  select md5(replace(p.prosrc, E'\r', '')) into v_fn
  from pg_proc p where p.oid = 'public.validar_capacidad_reserva()'::regprocedure;
  if v_fn is null or v_fn not in ('996f159e2b477fa47cb25fa8ef3ae430',     -- la de la migración
                                  '8b9f3ab23e9d8b5e26e2f328f2d196f9') then -- la de antes
    raise exception 'ROLLBACK ABORTADO: validar_capacidad_reserva() no es ni la de 20261003150000 ni la de antes (md5 %): alguien la ha cambiado después. No se ha tocado nada.', v_fn;
  end if;

  select md5(replace(p.prosrc, E'\r', '')) into v_cap
  from pg_proc p where p.oid = 'public.fn_capacidad_efectiva_marca(text)'::regprocedure;
  if v_cap is null or v_cap not in ('fe95fcf2e03330ecbf20b92d424e653b',   -- la de la migración
                                    'cb3d4d66a60044740c96dba10c1a6d35') then -- la de antes
    raise exception 'ROLLBACK ABORTADO: fn_capacidad_efectiva_marca(text) no es ni la de 20261003150000 ni la de antes (md5 %). No se ha tocado nada.', v_cap;
  end if;

  select md5(pg_get_viewdef('public.vista_ocupacion_hoy'::regclass)) into v_vista;
  if v_vista is null or v_vista not in ('fc6bb54bce202fc44c755ed038915908',   -- la de la migración
                                        'f5f905125a75b1791197cbf72e7ab237') then -- la de antes
    raise exception 'ROLLBACK ABORTADO: vista_ocupacion_hoy no es ni la de 20261003150000 ni la de antes (md5 %). No se ha tocado nada.', v_vista;
  end if;
end
$previa$;

-- 1) validar_capacidad_reserva(): la de 20261003130000, literal.
do $rollback_fn$
begin
  execute replace($definicion$CREATE OR REPLACE FUNCTION public.validar_capacidad_reserva()
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
$function$;$definicion$, E'\r', '');
end
$rollback_fn$;

-- 2) fn_capacidad_efectiva_marca(text): la de producción anterior, literal.
do $rollback_cap$
begin
  execute replace($definicion$CREATE OR REPLACE FUNCTION public.fn_capacidad_efectiva_marca(p_marca text)
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
    and m.activa is not false
    and coalesce(m.is_merged, false) = false;
$function$;$definicion$, E'\r', '');
end
$rollback_cap$;

-- 3) vista_ocupacion_hoy: la de 20260919130000, con security_invoker. El
--    comentario y los permisos se conservan (CREATE OR REPLACE VIEW).
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
FROM public.reservas
WHERE fecha = CURRENT_DATE;

-- 4) Comprobación antes del COMMIT.
do $comprobacion$
declare
  v_md5     text;
  v_secdef  boolean;
  v_config  text[];
  v_cap     text;
  v_vista   text;
  v_opts    text[];
begin
  select md5(replace(p.prosrc, E'\r', '')), p.prosecdef, p.proconfig
    into v_md5, v_secdef, v_config
  from pg_proc p where p.oid = 'public.validar_capacidad_reserva()'::regprocedure;
  if v_md5 is distinct from '8b9f3ab23e9d8b5e26e2f328f2d196f9' then
    raise exception 'ROLLBACK ABORTADO: validar_capacidad_reserva() no ha quedado exacta (md5 %). No se ha revertido nada.', v_md5;
  end if;
  if v_secdef is distinct from false or v_config is distinct from array['search_path=public'] then
    raise exception 'ROLLBACK ABORTADO: la función no ha quedado SECURITY INVOKER con search_path=public. No se ha revertido nada.';
  end if;

  select md5(replace(p.prosrc, E'\r', '')), p.prosecdef
    into v_cap, v_secdef
  from pg_proc p where p.oid = 'public.fn_capacidad_efectiva_marca(text)'::regprocedure;
  if v_cap is distinct from 'cb3d4d66a60044740c96dba10c1a6d35' or v_secdef is distinct from true then
    raise exception 'ROLLBACK ABORTADO: fn_capacidad_efectiva_marca(text) no ha quedado exacta (md5 %). No se ha revertido nada.', v_cap;
  end if;

  select md5(pg_get_viewdef('public.vista_ocupacion_hoy'::regclass)), c.reloptions
    into v_vista, v_opts
  from pg_class c where c.oid = 'public.vista_ocupacion_hoy'::regclass;
  if v_vista is distinct from 'f5f905125a75b1791197cbf72e7ab237' or v_opts is distinct from array['security_invoker=on'] then
    raise exception 'ROLLBACK ABORTADO: vista_ocupacion_hoy no ha quedado exacta (md5 %, opciones %). No se ha revertido nada.', v_vista, v_opts;
  end if;
end
$comprobacion$;

commit;

-- 5) Verificación (solo lectura; es lo que imprime `db query -f`). Una fila.
select 'sala_privada_fuera_de_aforo: revertida' as resultado,
       (select md5(replace(p.prosrc, E'\r', '')) = '8b9f3ab23e9d8b5e26e2f328f2d196f9'
          from pg_proc p where p.oid = 'public.validar_capacidad_reserva()'::regprocedure) as funcion_ok,
       (select md5(replace(p.prosrc, E'\r', '')) = 'cb3d4d66a60044740c96dba10c1a6d35'
          from pg_proc p where p.oid = 'public.fn_capacidad_efectiva_marca(text)'::regprocedure) as capacidad_ok,
       (select md5(pg_get_viewdef('public.vista_ocupacion_hoy'::regclass)) = 'f5f905125a75b1791197cbf72e7ab237') as vista_ok,
       (select coalesce(sum(capacidad_maxima), 0)::integer
          from public.espacios_reserva
          where activa = true
            and coalesce(caracteristicas->>'marca', 'casa_tomas') = 'casa_tomas') as aforo_casa_tomas_con_privadas;
-- -> revertida | true | true | true | 170
