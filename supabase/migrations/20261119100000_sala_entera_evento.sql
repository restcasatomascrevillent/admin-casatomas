set client_encoding = 'UTF8';
-- ===========================================================================
-- 20261119100000_sala_entera_evento — «Evento: sala entera» (09/11/2026)
-- ===========================================================================
-- APLICADA en la demo (sfonaclosuafvlhutkon) el 09/11/2026.
-- PENDIENTE en producción (haqmmdfdzzatdnrrcgez): solo tras aceptar el PR de
-- la release y con el «sí» del dueño.
--
-- Una reserva puede quedarse una sala ENTERA para un evento ese día y turno.
-- Se guarda en `salas_cerradas_servicio` (la tabla del interruptor «Sala
-- cerrada» de Organizar, 20261009110000) con dos columnas nuevas:
--   reserva_id  la reserva del evento (borrar la reserva borra el cierre)
--   motivo      texto para el panel («Evento: <nombre>»)
-- Una fila CON reserva_id:
--   1. resta la capacidad de esa sala del aforo de ese día y turno
--      (Casa Tomás: 150 - 50 = 100 con el Salón cerrado);
--   2. el evento no consume aforo;
--   3. ninguna otra reserva puede entrar en esa sala ese turno
--      («La sala X está cerrada por un evento ese día»).
-- Una fila SIN reserva_id sigue igual: solo Organizar la mira, no cambia el aforo.
--
-- El cierre sigue a su reserva (trigger en reservas): si se cancela o pasa a
-- «No vino», o se le quita la sala, el cierre se borra; si cambia de día,
-- hora (turno) o sala, el cierre se mueve con ella. Al poner o mover un cierre
-- de evento se comprueba que la sala no tenga otras reservas ese turno y que
-- el resto del restaurante quepa en las salas que quedan.
--
-- `validar_capacidad_reserva` es la de 20261003150000 (la que hay en la demo)
-- con los cambios marcados «20261119100000»; el resto, idéntico.
-- La web y el bot (supabase/functions/_shared/disponibilidad.ts) restan igual.
--
-- APLICAR (una a una, nunca `db push`), desde admin-casatomas/:
--   npx supabase db query --linked -f supabase/migrations/20261119100000_sala_entera_evento.sql
-- Idempotente. Deshacer: supabase/rollbacks/20261119100000_sala_entera_evento_ROLLBACK.sql
-- ===========================================================================
begin;
set local lock_timeout = '5s';

-- 1. Columnas ---------------------------------------------------------------
alter table public.salas_cerradas_servicio
  add column if not exists reserva_id uuid references public.reservas(id) on delete cascade,
  add column if not exists motivo text;
comment on column public.salas_cerradas_servicio.reserva_id is
  'Reserva del EVENTO que ocupa la sala entera ese día y turno. NULL = cierre de Organizar (no cambia el aforo).';
comment on column public.salas_cerradas_servicio.motivo is
  'Texto del cierre, p. ej. el nombre de la reserva del evento.';
-- Un evento cierra una sola sala en un solo turno.
create unique index if not exists salas_cerradas_servicio_reserva_uidx
  on public.salas_cerradas_servicio (reserva_id) where reserva_id is not null;

-- Para poner un evento en una sala que ya estaba cerrada desde Organizar
-- (upsert sobre la misma fila) hace falta UPDATE.
drop policy if exists salas_cerradas_update on public.salas_cerradas_servicio;
create policy salas_cerradas_update on public.salas_cerradas_servicio
  for update using ((select public.can_write_section('reservas'::text)))
  with check ((select public.can_write_section('reservas'::text)));
grant update on public.salas_cerradas_servicio to authenticated;

-- 2. Aforo: validar_capacidad_reserva ---------------------------------------
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
  v_turno TEXT;
  v_es_evento BOOLEAN := false;
  v_sala_evento TEXT;
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

  -- 00b. EVENTO con la sala entera (20261119100000). Una fila de
  --      `salas_cerradas_servicio` con `reserva_id` cierra esa sala ese día y
  --      turno para ese evento:
  --      - NINGUNA OTRA reserva puede ENTRAR en ella (alta, cambio de sala,
  --        día o turno, o volver a un estado vivo). Las que ya estaban se
  --        quedan: el cierre no se deja poner con otras reservas dentro.
  --      - El propio evento no consume aforo: se sale aquí, sin mirar más.
  --      Los cierres SIN `reserva_id` (interruptor «Sala cerrada» de
  --      Organizar) no cuentan aquí: solo afectan a Organizar.
  v_turno := CASE WHEN v_es_comida THEN 'comida' ELSE 'cena' END;
  SELECT EXISTS (
    SELECT 1 FROM salas_cerradas_servicio c WHERE c.reserva_id = NEW.id
  ) INTO v_es_evento;

  IF NEW.espacio_id IS NOT NULL AND (
       TG_OP = 'INSERT'
       OR OLD.espacio_id IS DISTINCT FROM NEW.espacio_id
       OR OLD.fecha IS DISTINCT FROM NEW.fecha
       OR (OLD.hora < '17:00:00'::time) IS DISTINCT FROM v_es_comida
       OR OLD.estado NOT IN ('pendiente', 'verificada', 'confirmada', 'completada')
     ) THEN
    SELECT e.nombre
    INTO v_sala_evento
    FROM salas_cerradas_servicio c
    JOIN espacios_reserva e ON e.id = c.espacio_id
    WHERE c.espacio_id = NEW.espacio_id
      AND c.fecha = NEW.fecha
      AND c.turno = v_turno
      AND c.reserva_id IS NOT NULL
      AND c.reserva_id <> NEW.id
    LIMIT 1;
    IF FOUND THEN
      RAISE EXCEPTION 'La sala % está cerrada por un evento ese día (%, turno de %).',
        v_sala_evento, to_char(NEW.fecha, 'DD/MM/YYYY'), v_turno
        USING ERRCODE = 'check_violation',
              HINT = 'Elige otra sala u otro turno, o quita el evento de esa sala.';
    END IF;
  END IF;

  IF v_es_evento THEN
    RETURN NEW;
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
      AND (caracteristicas->>'privada') IS DISTINCT FROM 'true'
      -- 20261119100000: las salas cerradas por un EVENTO ese día y turno
      -- no suman (el evento tiene la sala entera).
      AND NOT EXISTS (
        SELECT 1
        FROM salas_cerradas_servicio c
        WHERE c.espacio_id = espacios_reserva.id
          AND c.fecha = NEW.fecha
          AND c.turno = v_turno
          AND c.reserva_id IS NOT NULL
      );
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
    )
    -- 20261119100000: los EVENTOS con la sala entera no consumen aforo.
    AND NOT EXISTS (
      SELECT 1 FROM salas_cerradas_servicio c WHERE c.reserva_id = r.id
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

-- 3. Al poner o mover un cierre de EVENTO ------------------------------------
-- SECURITY DEFINER: tiene que ver TODAS las reservas del turno para contar
-- bien (también cuando lo dispara el trigger de abajo). Solo lee.
create or replace function public.validar_sala_cerrada_evento()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_res record;
  v_sala record;
  v_es_comida boolean := NEW.turno = 'comida';
  v_marca text;
  v_otras int;
  v_capacidad int;
  v_ocupacion int;
begin
  if NEW.reserva_id is null then
    return NEW;
  end if;

  -- Una sala solo puede tener UN evento por turno.
  if TG_OP = 'UPDATE' and OLD.reserva_id is not null and OLD.reserva_id <> NEW.reserva_id then
    raise exception 'Esa sala ya está cerrada por otro evento ese turno.'
      using errcode = 'unique_violation';
  end if;

  select r.id, r.nombre, r.fecha, r.hora, r.espacio_id, r.estado, r.marca
  into v_res
  from reservas r
  where r.id = NEW.reserva_id;
  if not found then
    raise exception 'La reserva del evento no existe.' using errcode = 'foreign_key_violation';
  end if;
  if v_res.estado not in ('pendiente', 'verificada', 'confirmada', 'completada') then
    raise exception 'Una reserva cancelada o «No vino» no puede cerrar la sala.'
      using errcode = 'check_violation';
  end if;
  if v_res.espacio_id is distinct from NEW.espacio_id
     or v_res.fecha <> NEW.fecha
     or (v_res.hora < '17:00:00'::time) <> v_es_comida then
    raise exception 'El cierre por evento tiene que ser en la sala, el día y el turno de su reserva.'
      using errcode = 'check_violation';
  end if;
  if NEW.motivo is null or btrim(NEW.motivo) = '' then
    NEW.motivo := v_res.nombre;
  end if;

  -- Sin cambios de sala, día, turno ni evento: no hay nada más que comprobar.
  if TG_OP = 'UPDATE'
     and OLD.reserva_id is not distinct from NEW.reserva_id
     and OLD.espacio_id = NEW.espacio_id and OLD.fecha = NEW.fecha and OLD.turno = NEW.turno then
    return NEW;
  end if;

  -- Mismo candado que validar_capacidad_reserva: se serializa con las altas.
  perform pg_advisory_xact_lock(hashtext(NEW.fecha::text), case when v_es_comida then 1 else 2 end);

  select e.nombre, e.capacidad_maxima, e.activa, e.caracteristicas
  into v_sala
  from espacios_reserva e
  where e.id = NEW.espacio_id;

  -- a) Nadie más en la sala ese turno (vivas y ya sentadas).
  select count(*)
  into v_otras
  from reservas r
  where r.fecha = NEW.fecha
    and r.espacio_id = NEW.espacio_id
    and r.id <> NEW.reserva_id
    and r.estado in ('pendiente', 'verificada', 'confirmada', 'completada')
    and (r.hora < '17:00:00'::time) = v_es_comida;
  if v_otras > 0 then
    raise exception 'La sala % tiene % reserva(s) más ese turno: muévelas a otra sala antes de cerrarla para el evento.',
      coalesce(v_sala.nombre, '?'), v_otras
      using errcode = 'check_violation';
  end if;

  -- b) El resto del restaurante cabe en las salas que quedan. Una sala
  --    privada o inactiva no suma aforo: cerrarla no lo cambia.
  if coalesce(v_sala.activa, false) and (v_sala.caracteristicas->>'privada') is distinct from 'true' then
    v_marca := coalesce(v_res.marca, 'casa_tomas');

    select coalesce(sum(e.capacidad_maxima), 0)
    into v_capacidad
    from espacios_reserva e
    where e.activa = true
      and coalesce(e.caracteristicas->>'marca', 'casa_tomas') = v_marca
      and (e.caracteristicas->>'privada') is distinct from 'true'
      and e.id <> NEW.espacio_id
      and not exists (
        select 1
        from salas_cerradas_servicio c
        where c.espacio_id = e.id
          and c.fecha = NEW.fecha
          and c.turno = NEW.turno
          and c.reserva_id is not null
          and c.reserva_id <> NEW.reserva_id
      );

    select coalesce(sum(r.numero_comensales), 0)
    into v_ocupacion
    from reservas r
    where r.fecha = NEW.fecha
      and r.id <> NEW.reserva_id
      and r.estado in ('pendiente', 'verificada', 'confirmada')
      and coalesce(r.marca, 'casa_tomas') = v_marca
      and (r.hora < '17:00:00'::time) = v_es_comida
      and not exists (
        select 1 from espacios_reserva e
        where e.id = r.espacio_id and e.activa = true and e.caracteristicas->>'privada' = 'true'
      )
      and not exists (
        select 1 from salas_cerradas_servicio c where c.reserva_id = r.id
      );

    if v_ocupacion > v_capacidad then
      raise exception 'Aforo superado si se cierra la sala % para el evento: quedan % plazas en las demás salas y hay % comensales.',
        coalesce(v_sala.nombre, '?'), v_capacidad, v_ocupacion
        using errcode = 'check_violation';
    end if;
  end if;

  return NEW;
end;
$fn$;
revoke all on function public.validar_sala_cerrada_evento() from public, anon;

drop trigger if exists trg_validar_sala_cerrada_evento on public.salas_cerradas_servicio;
create trigger trg_validar_sala_cerrada_evento
  before insert or update on public.salas_cerradas_servicio
  for each row execute function public.validar_sala_cerrada_evento();

-- 4. El cierre sigue a su reserva -------------------------------------------
-- SECURITY DEFINER: lo dispara cualquiera que pueda cambiar la reserva (panel,
-- web o bot con service role) y el cierre tiene que seguirla siempre. Solo
-- toca las filas de ESA reserva (y un cierre de Organizar que estorbe).
create or replace function public.reservas_sincronizar_sala_evento()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_turno text;
begin
  if not exists (select 1 from salas_cerradas_servicio where reserva_id = NEW.id) then
    return null;
  end if;

  -- Cancelada, «No vino» o sin sala: la sala vuelve a abrirse.
  if NEW.estado not in ('pendiente', 'verificada', 'confirmada', 'completada') or NEW.espacio_id is null then
    delete from salas_cerradas_servicio where reserva_id = NEW.id;
    return null;
  end if;

  v_turno := case when NEW.hora < '17:00:00'::time then 'comida' else 'cena' end;
  if exists (
    select 1 from salas_cerradas_servicio
    where reserva_id = NEW.id
      and (espacio_id, fecha, turno) is distinct from (NEW.espacio_id, NEW.fecha, v_turno)
  ) then
    -- Un cierre de Organizar (sin evento) en el destino estorbaría a la clave
    -- primaria: la sala queda cerrada igualmente, ahora por el evento.
    delete from salas_cerradas_servicio
    where espacio_id = NEW.espacio_id and fecha = NEW.fecha and turno = v_turno and reserva_id is null;
    update salas_cerradas_servicio
    set espacio_id = NEW.espacio_id, fecha = NEW.fecha, turno = v_turno
    where reserva_id = NEW.id;
  end if;
  return null;
end;
$fn$;
revoke all on function public.reservas_sincronizar_sala_evento() from public, anon;

drop trigger if exists trg_reservas_sincronizar_sala_evento on public.reservas;
create trigger trg_reservas_sincronizar_sala_evento
  after update of estado, espacio_id, fecha, hora on public.reservas
  for each row execute function public.reservas_sincronizar_sala_evento();
-- Borrar la reserva: lo hace la FK (on delete cascade).

commit;
