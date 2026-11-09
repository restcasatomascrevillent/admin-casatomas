set client_encoding = 'UTF8';
-- ROLLBACK de 20261119100000_sala_entera_evento.sql. Aplicar a mano SOLO si
-- hay que deshacerlo, desde admin-casatomas/:
--   npx supabase db query --linked -f supabase/rollbacks/20261119100000_sala_entera_evento_ROLLBACK.sql
--
-- Borra los cierres por EVENTO (si no, quedarían como «Sala cerrada» de
-- Organizar), quita los triggers y funciones nuevos, las columnas reserva_id
-- y motivo y el permiso de UPDATE, y deja validar_capacidad_reserva como en
-- 20261003150000. Los cierres de Organizar se quedan. Se puede aplicar dos veces.
begin;
set local lock_timeout = '5s';

drop trigger if exists trg_reservas_sincronizar_sala_evento on public.reservas;
drop function if exists public.reservas_sincronizar_sala_evento();
drop trigger if exists trg_validar_sala_cerrada_evento on public.salas_cerradas_servicio;
drop function if exists public.validar_sala_cerrada_evento();

do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'salas_cerradas_servicio' and column_name = 'reserva_id'
  ) then
    execute 'delete from public.salas_cerradas_servicio where reserva_id is not null';
  end if;
end $$;

-- validar_capacidad_reserva como en 20261003150000 (antes de quitar las columnas).
CREATE OR REPLACE FUNCTION public.validar_capacidad_reserva()
 RETURNS trigger
 LANGUAGE plpgsql
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

drop index if exists public.salas_cerradas_servicio_reserva_uidx;
alter table public.salas_cerradas_servicio drop column if exists reserva_id, drop column if exists motivo;
drop policy if exists salas_cerradas_update on public.salas_cerradas_servicio;
revoke update on public.salas_cerradas_servicio from authenticated;

commit;
