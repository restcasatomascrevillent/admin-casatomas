set client_encoding = 'UTF8';
-- (Primera línea a propósito: psql en una consola de Windows puede arrancar
-- en WIN1252 y leer mal las tildes del cuerpo de la función.)
-- ===========================================================================
-- ROLLBACK de supabase/migrations/20261003130000_sala_privada_ocupa_turno.sql
-- ===========================================================================
--
-- Este fichero NO es una migración y no debe copiarse a
-- supabase/migrations/ (ver supabase/rollbacks/README.md). Se ejecuta A MANO
-- (psql / SQL editor), entero: lleva su propio begin/commit.
--
-- Qué revierte:
--   · validar_capacidad_reserva() vuelve EXACTAMENTE a la definición de
--     producción anterior (la de 20260930212000, leída de producción el
--     2026-10-03: md5(prosrc) = f554d721e6e2e20944a3aea397e88500): SECURITY
--     INVOKER, SET search_path TO 'public'. Propietario (postgres) y permisos
--     no cambian: CREATE OR REPLACE los conserva.
--   · trg_validar_capacidad vuelve a BEFORE INSERT OR UPDATE OF fecha, hora,
--     numero_comensales, estado, marca (sin `espacio_id`).
--
-- Efecto de ejecutarlo: se pierde la regla del Reservado. Una reserva en una
-- sala privada vuelve a contar por sus comensales (no por la sala entera) y
-- ya no se rechaza una segunda reserva en la misma sala y turno. Mover una
-- reserva de sala vuelve a no comprobar nada.
--
-- Qué se pierde: nada guardado. Ni la migración ni este rollback tocan filas.
-- Si hubiera dos reservas vivas en el Reservado en el mismo turno (cosa que
-- la regla impedía), siguen ahí: habría que resolverlas a mano.
--
-- Si la migración NO llegó a aplicarse, ejecutar esto no cambia nada:
-- reescribe la función y el trigger con lo que ya tienen.
--
-- Antes de tocar nada comprueba que la función es la de la migración
-- (md5 8b9f3ab23e9d8b5e26e2f328f2d196f9) o la de antes (f554d721…), normalizando los \r por si se
-- aplicó desde un checkout con CRLF. Si es otra cosa, alguien la ha cambiado
-- después: aborta sin pisarla.
--
-- Se lanza como la migración: `npx supabase db query --linked -f <este
-- fichero>`, `psql "$DB_URL" -v ON_ERROR_STOP=1 -f <este fichero>` o pegado
-- entero en el SQL editor. Lleva `lock_timeout = '5s'` (el CREATE OR REPLACE
-- TRIGGER espera a las transacciones abiertas que escribieron en `reservas`
-- y, mientras, pone en cola todas las escrituras; si falla con 55P03,
-- reintentar al rato: no se ha aplicado nada).
--
-- Por qué la función va dentro de un EXECUTE con replace(): este repo tiene
-- core.autocrlf=true, y un \r dentro del cuerpo lo haría distinto byte a byte
-- del original (misma lógica, distinto md5). Al final, dentro de la misma
-- transacción, se comprueba que ha quedado exacto; si no, se aborta.
--
-- El panel no hace falta revertirlo: sin la regla de la BD, su traducción del
-- error y su bloqueo previo del kanban (un Reservado ocupado) simplemente no
-- se disparan por el lado de la BD.
-- ===========================================================================

begin;

set local lock_timeout = '5s';

-- 0) No pisar un cambio de terceros: la función tiene que ser la de
--    20261003130000 o la de antes. Si no, se aborta aquí y no se toca nada.
do $previa$
declare
  v_md5 text;
begin
  select md5(replace(p.prosrc, E'\r', '')) into v_md5
  from pg_proc p
  where p.oid = 'public.validar_capacidad_reserva()'::regprocedure;

  if v_md5 is null or v_md5 not in ('8b9f3ab23e9d8b5e26e2f328f2d196f9',   -- la de la migración
                                    'f554d721e6e2e20944a3aea397e88500') then -- la de antes
    raise exception 'ROLLBACK ABORTADO: validar_capacidad_reserva() no es ni la de 20261003130000 ni la de antes (md5 %): alguien la ha cambiado después. No se ha tocado nada; revísalo antes de revertir.', v_md5;
  end if;
end
$previa$;

-- 1) La función: la de 20260930212000, literal (es la que había en producción
--    el 2026-10-03: pg_get_functiondef con SECURITY INVOKER explícito).
do $rollback$
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
  --     No lee tablas ni toma el candado del paso 3: no añade ocupación, así
  --     que no puede provocar la carrera que el candado evita.
  IF TG_OP = 'UPDATE' THEN
    IF COALESCE(
         OLD.estado IN ('pendiente', 'verificada', 'confirmada')
         AND COALESCE(OLD.marca, 'casa_tomas') = v_marca
         AND OLD.fecha = NEW.fecha
         AND (OLD.hora < '17:00:00'::time) = (NEW.hora < '17:00:00'::time)
         AND NEW.numero_comensales <= OLD.numero_comensales,
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
$function$
$definicion$, E'\r', '');
end
$rollback$;

-- 2) El trigger, como estaba (sin `espacio_id`).
CREATE OR REPLACE TRIGGER trg_validar_capacidad BEFORE INSERT OR UPDATE OF fecha, hora, numero_comensales, estado, marca ON public.reservas FOR EACH ROW EXECUTE FUNCTION public.validar_capacidad_reserva();

-- 3) Comprobación antes del COMMIT: si algo no ha quedado EXACTAMENTE como
--    estaba, se aborta la transacción entera y no se aplica nada.
do $comprobacion$
declare
  v_md5       text;
  v_secdef    boolean;
  v_config    text[];
  v_trigger   text;
begin
  select md5(replace(p.prosrc, E'\r', '')), p.prosecdef, p.proconfig
    into v_md5, v_secdef, v_config
  from pg_proc p
  where p.oid = 'public.validar_capacidad_reserva()'::regprocedure;

  if v_md5 is distinct from 'f554d721e6e2e20944a3aea397e88500' then
    raise exception 'ROLLBACK ABORTADO: el cuerpo restaurado no es byte a byte el de 20260930212000 (md5 %). ¿Se ha editado el texto entre $definicion$? No se ha aplicado nada.', v_md5;
  end if;
  if v_secdef is distinct from false or v_config is distinct from array['search_path=public'] then
    raise exception 'ROLLBACK ABORTADO: la función no ha quedado SECURITY INVOKER con search_path=public (prosecdef %, proconfig %). No se ha aplicado nada.', v_secdef, v_config;
  end if;

  select pg_get_triggerdef(t.oid) into v_trigger
  from pg_trigger t
  where t.tgrelid = 'public.reservas'::regclass and t.tgname = 'trg_validar_capacidad';

  if v_trigger is null or v_trigger not like
     'CREATE TRIGGER trg_validar_capacidad BEFORE INSERT OR UPDATE OF fecha, hora, numero_comensales, estado, marca ON public.reservas FOR EACH ROW EXECUTE FUNCTION %validar_capacidad_reserva()' then
    raise exception 'ROLLBACK ABORTADO: el trigger no ha quedado como estaba: %. No se ha aplicado nada.', v_trigger;
  end if;
end
$comprobacion$;

commit;
