set client_encoding = 'UTF8';
-- (Primera línea a propósito: psql en una consola de Windows puede arrancar
-- en WIN1252 y leer mal las tildes del cuerpo de la función.)
-- ===========================================================================
-- ROLLBACK de supabase/migrations/20260930212000_aforo_permite_ediciones_sin_subir_ocupacion.sql
-- ===========================================================================
--
-- Este fichero NO es una migración y no debe copiarse a
-- supabase/migrations/ (ver supabase/rollbacks/README.md). Se ejecuta A MANO
-- (psql / SQL editor), entero: lleva su propio begin/commit.
--
-- Qué revierte:
--   · validar_capacidad_reserva() vuelve EXACTAMENTE a la definición de
--     producción del 2026-09-30, copiada literal de pg_get_functiondef
--     (md5(prosrc) = f85c8255e89afa44d1fee887c6166cbb, 2919 caracteres):
--     SECURITY INVOKER (implícito, como estaba), SET search_path TO 'public'.
--     Propietario (postgres) y permisos no cambian: CREATE OR REPLACE los
--     conserva.
--   · trg_validar_capacidad vuelve a BEFORE INSERT OR UPDATE OF fecha, hora,
--     numero_comensales, estado (sin `marca`), como lo daba
--     pg_get_triggerdef.
--
-- Efecto de ejecutarlo: VUELVE EL DEFECTO. En un turno que ya supera el
-- aforo vuelven a fallar con 23514 «Aforo superado» reducir comensales,
-- mover la hora dentro del turno y verificar o confirmar una reserva viva
-- (también desde el enlace del correo o al aceptar una contraoferta). Y un
-- UPDATE que solo cambie `marca` vuelve a no comprobar el aforo del negocio
-- de destino.
--
-- Qué se pierde: nada guardado. Ni la migración ni este rollback tocan filas.
--
-- Si la migración NO llegó a aplicarse, ejecutar esto no cambia nada:
-- reescribe la función y el trigger con lo que ya tienen.
--
-- Antes de tocar nada comprueba que la función es la de la migración
-- (md5 f554d721e6e2e20944a3aea397e88500) o la de antes (f85c8255…),
-- normalizando los \r por si la migración se aplicó desde un checkout con
-- CRLF. Si es otra cosa, alguien la ha cambiado después: aborta sin pisarla.
--
-- Se lanza como la migración: `npx supabase db query --linked -f <este
-- fichero>`, `psql "$DB_URL" -v ON_ERROR_STOP=1 -f <este fichero>` o pegado
-- entero en el SQL editor. Lleva `lock_timeout = '5s'`: el CREATE OR REPLACE
-- TRIGGER espera a las transacciones abiertas que escribieron en `reservas`
-- y, mientras, pone en cola todas las escrituras. Si falla con 55P03
-- (lock_not_available), no se ha aplicado nada: reintentar al rato.
--
-- Por qué la función va dentro de un EXECUTE: este repo tiene
-- core.autocrlf=true, así que en Windows el fichero puede salir del checkout
-- con finales CRLF, y un \r dentro del cuerpo lo haría distinto byte a byte
-- del original (misma lógica, distinto md5). El replace() los quita: el
-- texto de dentro es la salida de pg_get_functiondef sin tocar una coma.
-- Al final, dentro de la misma transacción, se comprueba que ha quedado
-- exacto; si no, se aborta y no se aplica nada.
--
-- El panel no hace falta revertirlo: `verificarAforoTurno` con la reserva
-- anterior solo daría un aviso previo más optimista que la BD (al editar, el
-- aviso no bloquea el botón de guardar) y la BD sigue teniendo la última
-- palabra. Si el rollback es para largo, conviene volver a pasarle solo el id
-- en FormularioReserva.tsx.
-- ===========================================================================

begin;

set local lock_timeout = '5s';

-- 0) No pisar un cambio de terceros: la función tiene que ser la de
--    20260930212000 o la de antes. Si no, se aborta aquí y no se toca nada.
do $previa$
declare
  v_md5 text;
begin
  select md5(replace(p.prosrc, E'\r', '')) into v_md5
  from pg_proc p
  where p.oid = 'public.validar_capacidad_reserva()'::regprocedure;

  if v_md5 is null or v_md5 not in ('f554d721e6e2e20944a3aea397e88500',   -- la de la migración
                                    'f85c8255e89afa44d1fee887c6166cbb') then -- la de antes
    raise exception 'ROLLBACK ABORTADO: validar_capacidad_reserva() no es ni la de 20260930212000 ni la de antes (md5 %): alguien la ha cambiado después. No se ha tocado nada; revísalo antes de revertir.', v_md5;
  end if;
end
$previa$;

-- 1) La función: salida LITERAL de
--    pg_get_functiondef('public.validar_capacidad_reserva()'::regprocedure)
--    leída en producción el 2026-09-30.
do $rollback$
begin
  execute replace($definicion$CREATE OR REPLACE FUNCTION public.validar_capacidad_reserva()
 RETURNS trigger
 LANGUAGE plpgsql
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

-- 2) El trigger, como lo daba pg_get_triggerdef el 2026-09-30 (sin `marca`;
--    la función, cualificada con su esquema: es la misma).
CREATE OR REPLACE TRIGGER trg_validar_capacidad BEFORE INSERT OR UPDATE OF fecha, hora, numero_comensales, estado ON public.reservas FOR EACH ROW EXECUTE FUNCTION public.validar_capacidad_reserva();

-- 3) Comprobación antes del COMMIT: si algo no ha quedado EXACTAMENTE como
--    estaba, se aborta la transacción entera y no se aplica nada.
do $comprobacion$
declare
  v_md5       text;
  v_secdef    boolean;
  v_config    text[];
  v_trigger   text;
begin
  select md5(p.prosrc), p.prosecdef, p.proconfig
    into v_md5, v_secdef, v_config
  from pg_proc p
  where p.oid = 'public.validar_capacidad_reserva()'::regprocedure;

  if v_md5 is distinct from 'f85c8255e89afa44d1fee887c6166cbb' then
    raise exception 'ROLLBACK ABORTADO: el cuerpo restaurado no es byte a byte el del 2026-09-30 (md5 %). ¿Se ha editado el texto entre $definicion$? No se ha aplicado nada.', v_md5;
  end if;
  if v_secdef is distinct from false or v_config is distinct from array['search_path=public'] then
    raise exception 'ROLLBACK ABORTADO: la función no ha quedado SECURITY INVOKER con search_path=public (prosecdef %, proconfig %). No se ha aplicado nada.', v_secdef, v_config;
  end if;

  select pg_get_triggerdef(t.oid) into v_trigger
  from pg_trigger t
  where t.tgrelid = 'public.reservas'::regclass and t.tgname = 'trg_validar_capacidad';

  if v_trigger is null or v_trigger not like
     'CREATE TRIGGER trg_validar_capacidad BEFORE INSERT OR UPDATE OF fecha, hora, numero_comensales, estado ON public.reservas FOR EACH ROW EXECUTE FUNCTION %validar_capacidad_reserva()' then
    raise exception 'ROLLBACK ABORTADO: el trigger no ha quedado como estaba: %. No se ha aplicado nada.', v_trigger;
  end if;
end
$comprobacion$;

commit;

-- ===========================================================================
-- VERIFICACIÓN después (solo lectura)
-- ===========================================================================
--   select md5(prosrc), length(prosrc), prosecdef, proconfig,
--          pg_get_userbyid(proowner) as propietario
--   from pg_proc where oid = 'public.validar_capacidad_reserva()'::regprocedure;
--   -- -> f85c8255e89afa44d1fee887c6166cbb | 2919 | false | {search_path=public} | postgres
--
--   select pg_get_triggerdef(oid) from pg_trigger
--   where tgrelid = 'public.reservas'::regclass and tgname = 'trg_validar_capacidad';
--   -- -> CREATE TRIGGER trg_validar_capacidad BEFORE INSERT OR UPDATE OF fecha,
--   --    hora, numero_comensales, estado ON public.reservas FOR EACH ROW
--   --    EXECUTE FUNCTION validar_capacidad_reserva()
-- ===========================================================================
