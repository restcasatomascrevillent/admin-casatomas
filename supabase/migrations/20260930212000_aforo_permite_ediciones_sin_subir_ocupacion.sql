set client_encoding = 'UTF8';
-- (Primera línea a propósito: psql lanzado desde PowerShell/cmd arranca en
-- WIN1252 y dejaría el mensaje del RAISE como «OcupaciÃ³n actual».)
-- ===========================================================================
-- ##                                                                       ##
-- ##              NO APLICADA: la aplica el dueño a mano                   ##
-- ##                                                                       ##
-- ##   Escrita el 2026-09-30 contra la definición VIVA de producción       ##
-- ##   (pg_get_functiondef / pg_get_triggerdef, solo lectura). No se ha    ##
-- ##   ejecutado en ningún sitio. Los pasos del dueño, en orden: al        ##
-- ##   final de esta cabecera (PASOS DEL DUEÑO).                           ##
-- ##                                                                       ##
-- ===========================================================================
--
-- EL DEFECTO
--
--   Desde 4db5b19 las reservas se editan siempre desde el panel, mandando
--   solo las columnas que cambian. Pero `validar_capacidad_reserva()` (la
--   función del trigger `trg_validar_capacidad`, BEFORE INSERT OR UPDATE OF
--   fecha, hora, numero_comensales, estado) trataba cualquier UPDATE que
--   tocase esas columnas como un alta: sumaba la ocupación del turno sin la
--   propia reserva y rechazaba si «ocupación + comensales nuevos» pasaba del
--   aforo. En un turno que YA está por encima del aforo (p. ej. después de
--   desactivar una sala, que baja la capacidad del negocio) eso rechaza con
--   23514 «Aforo superado» cambios que NO añaden a nadie:
--     · reducir comensales;
--     · mover la hora dentro del mismo turno;
--     · verificar o confirmar una reserva viva (también el «Confirmar» del
--       correo y la aceptación de una contraoferta: verificada → confirmada);
--     · un UPDATE que reenvía esas columnas con el mismo valor.
--   Ejemplo: Casa Tomás con 170 plazas y la cena llena (170). Se desactiva
--   una sala de 50 → aforo 120. Bajar una reserva de 6 a 4 comensales
--   comprobaba 164 + 4 > 120 y fallaba, aunque el turno pasa de 170 a 168.
--   (A 2026-09-30 ningún turno futuro está por encima del aforo: el defecto
--   está latente hasta que se desactive o encoja una sala.)
--
-- LA REGLA NUEVA (solo UPDATE; el INSERT no cambia)
--
--   Un UPDATE se rechaza solo si AÑADE ocupación a un turno que queda por
--   encima del aforo.
--
--   Se permite aunque el turno esté pasado de aforo (paso 0b): la reserva
--   YA ocupaba plaza (pendiente, verificada o confirmada), sigue ocupándola
--   y se queda en el MISMO turno sin subir de comensales:
--     · reducir o mantener comensales;
--     · mover la hora dentro del mismo turno sin subir comensales;
--     · pasar entre estados vivos (pendiente → verificada → confirmada);
--     · reenviar columnas sin cambiarlas.
--   Y, como hasta ahora:
--     · cualquier cambio que no toque día, hora, comensales, negocio ni
--       estado (el trigger ni se dispara: nombre, teléfono, notas, sala,
--       importante...);
--     · dejar la reserva en un estado que no ocupa plaza (cancelada,
--       completada, no_show), o editar una que ya estaba así.
--
--   Se sigue comprobando el aforo como en un alta (pasos 1-5), y se rechaza
--   si no cabe:
--     · subir comensales en un turno que quedaría por encima;
--     · mover a otro turno u otro día que quedaría por encima;
--     · cambiar de negocio (`marca`) a un turno lleno;
--     · pasar de un estado no vivo a uno vivo (eso es añadir ocupación).
--
-- «MISMO TURNO»: la definición que ya usaba el trigger, sin inventar otra
--
--   mismo negocio : COALESCE(marca, 'casa_tomas') igual antes y después (paso 0);
--   mismo día     : OLD.fecha = NEW.fecha;
--   mismo turno   : el mismo lado del corte de las 17:00 (`hora <
--                   '17:00:00'` = comida, si no cena; pasos 2 y 4). Es
--                   también el criterio con el que
--                   `reservas_sincronizar_asignaciones` decide si mueve mesas.
--
--   Decisiones (ante la duda, se comprueba el aforo, que es lo conservador):
--     · Justo en el corte: 17:00:00 ya es cena, como siempre. 16:59 → 17:00
--       es CAMBIO de turno y se comprueba la cena; 17:00 → 17:30 es el
--       mismo turno.
--     · Horas fuera de `configuracion_turnos`: el trigger nunca ha leído esa
--       tabla; clasifica cualquier hora por el corte fijo de las 17:00, esté
--       o no dentro de un periodo configurado (un 23:30 es cena, un 10:00
--       comida). No aparece ninguna ambigüedad nueva.
--     · Un NULL en cualquiera de las comparaciones NO cuenta como mismo turno
--       (COALESCE(..., false)): se comprueba el aforo. Hoy no puede pasar:
--       fecha, hora, numero_comensales, estado y marca son NOT NULL.
--     · La sala (`espacio_id`) no interviene: el aforo es por negocio, no por
--       sala (igual que antes). Mover de sala sin cambiar `marca` no toca el
--       aforo y no dispara el trigger.
--     · El paso 0b solo mira la fila (OLD/NEW): no lee tablas ni toma el
--       candado del paso 3. No hace falta: no añade ocupación, así que no
--       puede provocar la carrera que el candado evita.
--
-- QUÉ CAMBIA
--
--   1. `validar_capacidad_reserva()`: un paso nuevo, el 0b, entre la marca
--      (paso 0) y la capacidad (paso 1). El resto del cuerpo es, byte a
--      byte, el de producción del 2026-09-30. Misma firma (sin argumentos,
--      RETURNS trigger), SECURITY INVOKER (prosecdef = false, como hoy),
--      `SET search_path TO 'public'`, VOLATILE. El propietario (postgres) y
--      los permisos no cambian: CREATE OR REPLACE los conserva.
--   2. `trg_validar_capacidad` se dispara también al cambiar `marca`:
--      BEFORE INSERT OR UPDATE OF fecha, hora, numero_comensales, estado,
--      marca. Sin esto, un UPDATE que solo cambiase `marca` (pasar una
--      reserva de Casa Tomás a Touza o al revés) seguiría sin comprobar el
--      aforo del negocio de destino. Hoy nadie escribe `marca` en un UPDATE
--      (revisado en el panel, reservas-web, emails-reserva, los dos webhooks
--      de restaurante-phone y las funciones SQL; el formulario no deja
--      cambiar el negocio al editar), así que solo afecta a correcciones a
--      mano como la que sugiere 20260924090000 («revisa antes el aforo de
--      Touza»): ahora lo revisa la BD. Con el paso 0b, un UPDATE que mande
--      `marca` sin cambiarla pasa sin comprobar nada.
--
-- QUÉ NO CAMBIA
--
--   · El INSERT: mismo camino, misma cuenta, mismo candado.
--   · Cuando sí se comprueba (pasos 1-5): la cuenta, el mensaje y el
--     ERRCODE `check_violation` (23514), de los que dependen
--     reservas-web/index.ts, emails-reserva/enlaces-web.ts y
--     mensajeErrorEdicion() del panel.
--   · El motor de disponibilidad de las reservas NUEVAS
--     (supabase/functions/_shared/disponibilidad.ts: web y bots).
--   · OJO: la comprobación PREVIA del bot telefónico al modificar
--     (restaurante-phone, `cabeElGrupo` en modify_reservation) sigue con la
--     regla vieja: en un turno pasado de aforo el bot seguirá diciendo que no
--     a una reducción antes de llegar a la BD. Es otro repo; no se toca aquí.
--   · El aviso previo del panel (`verificarAforoTurno`, en
--     src/hooks/useDisponibilidad.ts) aplica esta misma regla cuando recibe
--     la reserva anterior en vez de solo su id.
--
-- CÓMO SE EJECUTA
--
--   Lleva su propio BEGIN/COMMIT (a diferencia del resto de
--   supabase/migrations/, porque se aplica a mano): es atómica se lance como
--   se lance —`npx supabase db query --linked -f`, `psql -f` o pegada entera
--   en el SQL editor—. Si algo falla, no se aplica nada.
--   Dentro, `lock_timeout = '5s'`: CREATE OR REPLACE TRIGGER necesita un
--   candado SHARE ROW EXCLUSIVE sobre `reservas`, que espera a cualquier
--   transacción abierta que haya escrito en la tabla, y mientras espera pone
--   en cola TODAS las escrituras (web, bots, panel). En producción postgres
--   tiene lock_timeout = 0 y statement_timeout = 120 s: sin este límite, esa
--   cola podría durar hasta dos minutos. Con él, si no consigue el candado en
--   5 s falla con 55P03 (lock_not_available), no deja nada aplicado y basta
--   con reintentar al rato.
--   Idempotente: función y trigger van con CREATE OR REPLACE.
--   NO con `supabase db push`: a 2026-09-30 el historial remoto
--   (supabase_migrations.schema_migrations) termina en 20260928120000; las de
--   20260928190000 en adelante están aplicadas pero sin registrar y
--   20260928140000 sigue sin aplicar, así que un push intentaría ejecutarlas
--   todas.
--
-- PASOS DEL DUEÑO (en este orden)
--
--   (1) Antes, solo lectura:
--         select md5(prosrc) = 'f85c8255e89afa44d1fee887c6166cbb' as sin_tocar
--         from pg_proc where oid = 'public.validar_capacidad_reserva()'::regprocedure;
--         -- -> true. Si da false, alguien ha cambiado la función desde el
--         --    2026-09-30: parar y revisar (esta migración lo pisaría).
--         select pid, usename, state, now() - xact_start as abierta_desde,
--                left(query, 60) as consulta
--         from pg_stat_activity
--         where xact_start < now() - interval '1 minute' and pid <> pg_backend_pid()
--         order by xact_start;
--         -- -> ninguna fila. Si hay alguna transacción de más de un minuto,
--         --    esperar a que acabe (si escribió en `reservas`, el trigger
--         --    tendría que esperarla y saltaría el lock_timeout).
--   (2) Aplicar:
--         npx supabase db query --linked -f supabase/migrations/20260930212000_aforo_permite_ediciones_sin_subir_ocupacion.sql
--       (o `psql "$DB_URL" -v ON_ERROR_STOP=1 -f <el mismo fichero>`, o
--       pegarla entera en el SQL editor). Si falla con 55P03, reintentar.
--   (3) Verificar con las consultas del pie de este fichero (VERIFICACIÓN).
--   (4) Probar con supabase/tests/aforo_ediciones.sql (todo dentro de
--       BEGIN … ROLLBACK; al final comprueba que no queda nada de la prueba).
--   (5) Desplegar el panel DESPUÉS de esta migración (el cambio de
--       src/hooks/useDisponibilidad.ts y, cuando se haga, el de
--       FormularioReserva.tsx que le pasa la reserva anterior). Si el panel
--       va antes, su aviso previo diría «se puede guardar» a una reducción en
--       un turno pasado de aforo y la BD, todavía con la regla vieja, la
--       rechazaría.
--   (6) Si hiciera falta, revertir con
--       supabase/rollbacks/20260930212000_aforo_permite_ediciones_sin_subir_ocupacion_ROLLBACK.sql
--       (devuelve la función y el trigger EXACTAMENTE a la definición
--       anterior; aborta sin tocar nada si la función ya no es ni esta ni la
--       de antes).
-- ===========================================================================

begin;

set local lock_timeout = '5s';

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
$function$;

-- El trigger, también con `marca` (ver QUÉ CAMBIA, punto 2). Mismo nombre,
-- misma tabla, mismo momento (BEFORE, FOR EACH ROW) y misma función; solo
-- se añade una columna a la lista del UPDATE.
CREATE OR REPLACE TRIGGER trg_validar_capacidad
  BEFORE INSERT OR UPDATE OF fecha, hora, numero_comensales, estado, marca
  ON public.reservas
  FOR EACH ROW
  EXECUTE FUNCTION public.validar_capacidad_reserva();

commit;

-- ===========================================================================
-- VERIFICACIÓN tras aplicarla (solo lectura)
-- ===========================================================================
--   -- 1) Función: es EXACTAMENTE la de este fichero (md5 del cuerpo con
--   --    finales LF; el replace() quita los \r por si se aplicó desde un
--   --    checkout con CRLF), sigue INVOKER, con su search_path y su
--   --    propietario.
--   select md5(replace(p.prosrc, E'\r', '')) = 'f554d721e6e2e20944a3aea397e88500' as cuerpo_nuevo,
--          p.prosecdef, p.proconfig, pg_get_userbyid(p.proowner) as propietario
--   from pg_proc p
--   where p.oid = 'public.validar_capacidad_reserva()'::regprocedure;
--   -- -> true | false | {search_path=public} | postgres
--
--   -- 2) Trigger: salta también con marca.
--   select pg_get_triggerdef(oid) from pg_trigger
--   where tgrelid = 'public.reservas'::regclass and tgname = 'trg_validar_capacidad';
--   -- -> CREATE TRIGGER trg_validar_capacidad BEFORE INSERT OR UPDATE OF fecha,
--   --    hora, numero_comensales, estado, marca ON public.reservas FOR EACH ROW
--   --    EXECUTE FUNCTION validar_capacidad_reserva()
--
--   -- 3) Turnos futuros que hoy están por encima del aforo (los que se
--   --    benefician; el 2026-09-30 no había ninguno):
--   with capacidad as (
--     select coalesce(caracteristicas->>'marca', 'casa_tomas') as marca,
--            sum(capacidad_maxima) as aforo
--     from public.espacios_reserva where activa = true group by 1
--   )
--   select r.fecha, coalesce(r.marca, 'casa_tomas') as marca,
--          case when r.hora < '17:00:00'::time then 'comida' else 'cena' end as turno,
--          sum(r.numero_comensales) as ocupacion, coalesce(max(c.aforo), 0) as aforo
--   from public.reservas r
--   left join capacidad c on c.marca = coalesce(r.marca, 'casa_tomas')
--   where r.fecha >= current_date
--     and r.estado in ('pendiente', 'verificada', 'confirmada')
--   group by 1, 2, 3
--   having sum(r.numero_comensales) > coalesce(max(c.aforo), 0)
--   order by 1, 2, 3;
--
--   -- 4) Pruebas con escritura y ROLLBACK: supabase/tests/aforo_ediciones.sql
-- ===========================================================================
