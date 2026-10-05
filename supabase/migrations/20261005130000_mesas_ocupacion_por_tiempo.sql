set client_encoding = 'UTF8';
-- (Primera línea a propósito: comentarios y mensajes con tilde; psql en una
-- consola de Windows puede arrancar en WIN1252.)
-- ===========================================================================
-- ##                                                                       ##
-- ##          NO APLICADA: la aplica el dueño a mano (ver pasos)           ##
-- ##                                                                       ##
-- ##   Mesas: una mesa se puede dar a VARIAS reservas del mismo día si    ##
-- ##   sus horas no se pisan. Ocupación = [hora, hora + tiempo de          ##
-- ##   ocupación de mesa), sea el mismo turno o no.                        ##
-- ##                                                                       ##
-- ===========================================================================
--
-- POR QUÉ (petición del dueño, 05/10/2026)
--   «No me deja sentarlos en la misma mesa; hay que tener en cuenta que no son
--   en el mismo turno, y que para eso en configuración tiene que haber el
--   tiempo de ocupación de mesa». Hasta hoy la exclusividad de una mesa era
--   POR TURNO: índice único uq_asignaciones_mesa_mesa_fecha_turno
--   (mesa_id, fecha, turno). Eso impedía repetir mesa dentro de un turno
--   (13:00 y 15:30 en la misma mesa) aunque no se pisaran, y el panel
--   (vista «Todo el día») además lo bloqueaba entre turnos.
--
-- EL AJUSTE (ya existía, se REUTILIZA; no se añade ninguna columna)
--   configuracion_reservas.estancia_comida_minutos (105) y
--   configuracion_reservas.estancia_cena_minutos   (120), con CHECK 15..480
--   desde 20260926150000_modo_servicio_config_y_salida.sql. Hasta ahora solo
--   los usaba el modo servicio («por liberar»); en el panel pasan a llamarse
--   «Tiempo de ocupación de mesa» (Reservas → Configuración) y deciden también
--   cuándo se puede volver a dar una mesa. El minutaje es el del turno de la
--   PROPIA reserva (corte 17:00, la misma regla que el aforo).
--
-- QUÉ CAMBIA
--   1. Funciones nuevas (STABLE): fn_minutos_ocupacion_mesa(time) y
--      fn_franja_ocupacion_mesa(date, time) → tsrange [inicio, fin).
--   2. asignaciones_mesa_denormalizar() (trigger BEFORE INSERT/UPDATE de
--      asignaciones_mesa): además de lo que ya validaba, coge un candado por
--      sala+día y rechaza si otra reserva tiene esa mesa en una franja que se
--      solapa (mira el día anterior y el siguiente por las cenas que pasan de
--      medianoche). Error: 23514 «MESA_OCUPADA: La mesa 3 está ocupada de
--      14:00 a 16:00 por Oscar» — mismo prefijo de siempre, el panel ya lo
--      traduce.
--   3. reservas_sincronizar_asignaciones() (trigger AFTER UPDATE de reservas):
--      ahora revalida las mesas en CUALQUIER cambio de día u hora (antes solo
--      si cambiaba el turno). Si la nueva franja choca, la regla de siempre:
--      el UPDATE de la reserva NO falla, la mesa se descarta a
--      asignaciones_mesa_descartadas (motivo «conflicto_franja: MESA_OCUPADA…»)
--      y la reserva queda pendiente de mesa. El formulario de edición ya avisa
--      de esto antes de guardar.
--   4. Fuera el índice único uq_asignaciones_mesa_mesa_fecha_turno; en su
--      lugar idx_asignaciones_mesa_mesa_fecha (mesa_id, fecha), no único, para
--      la búsqueda de solapes.
--   NO cambia: asignar_mesas_reserva() (su MESA_OCUPADA ahora llega del
--   trigger; el manejador de unique_violation queda inerte), la vista
--   vista_asignacion_dia, fn_asignaciones_futuras_de_mesas,
--   mesas_auditar_asignaciones ni asignaciones_mesa_descartadas (ninguna
--   asume unicidad por turno). La sala privada (Reservado) mantiene «una
--   reserva por sala y turno» por su propia regla en validar_capacidad_reserva
--   (23514 «Sala privada ocupada»), que no depende de este índice.
--
-- POR QUÉ UN TRIGGER CON CANDADO Y NO «EXCLUDE USING gist»
--   · La duración sale de la configuración y se puede cambiar: una franja
--     guardada en la fila se quedaría vieja al cambiar el ajuste (habría que
--     recalcular todas y podría fallar). Calculada al validar, el ajuste nuevo
--     vale desde ese momento.
--   · btree_gist no está instalada en producción (disponible 1.7, sin
--     instalar; comprobado el 05/10/2026).
--   · El trigger cubre TODOS los caminos de escritura (RPC, INSERT directo,
--     el UPDATE del trigger de reservas), igual que hacía el índice.
--
-- ESTADO VERIFICADO EN PRODUCCIÓN (05/10/2026, solo SELECT)
--   · md5(pg_get_functiondef): asignaciones_mesa_denormalizar 1c45a0f8…,
--     reservas_sincronizar_asignaciones aa570ceb…, asignar_mesas_reserva
--     741791ea… (no se toca).
--   · Índice uq_asignaciones_mesa_mesa_fecha_turno presente.
--   · configuracion_reservas: 1 fila, estancia comida 105 / cena 120.
--   · asignaciones_mesa: 7 filas (1 de hoy en adelante) y 0 pares que se
--     solapen con 105/120. Si al aplicar hubiera solapes (datos de antes), la
--     migración NO falla: los lista con NOTICE (siguen como están; solo se
--     valida lo que se escriba a partir de ahora).
--   · Postgres 17.6.
--
-- PASOS (desde adminpanelct/)
--   1. npx supabase db query --linked -f supabase/migrations/20261005130000_mesas_ocupacion_por_tiempo.sql
--      Tiene que imprimir «mesas_ocupacion_por_tiempo: aplicada | 105 | 120».
--   2. npx supabase db query --linked -f supabase/tests/mesas_ocupacion_por_tiempo_test.sql
--      (todo dentro de BEGIN … ROLLBACK; si no da ERROR, ha pasado).
--   3. El panel se publica solo al subir a main (Vercel).
--   Deshacer: supabase/rollbacks/20261005130000_mesas_ocupacion_por_tiempo_ROLLBACK.sql
-- ===========================================================================

begin;
set local lock_timeout = '5s';

-- ---------------------------------------------------------------------------
-- 0. Comprobaciones: el estado tiene que ser el verificado (o esta misma
--    migración ya aplicada, y entonces todo lo de abajo es idempotente).
-- ---------------------------------------------------------------------------
do $$
declare
  v_md5   text;
  v_src   text;
  n       integer;
  r       record;
begin
  select md5(pg_get_functiondef('public.asignaciones_mesa_denormalizar()'::regprocedure)),
         p.prosrc
    into v_md5, v_src
  from pg_proc p where p.oid = 'public.asignaciones_mesa_denormalizar()'::regprocedure;
  if v_md5 <> '1c45a0f8797a46a59ebd1422714778fd' and position('fn_franja_ocupacion_mesa' in v_src) = 0 then
    raise exception 'MIGRACIÓN ABORTADA: asignaciones_mesa_denormalizar() no es la verificada el 05/10/2026 (md5 %). No se ha cambiado nada.', v_md5;
  end if;

  select md5(pg_get_functiondef('public.reservas_sincronizar_asignaciones()'::regprocedure)),
         p.prosrc
    into v_md5, v_src
  from pg_proc p where p.oid = 'public.reservas_sincronizar_asignaciones()'::regprocedure;
  if v_md5 <> 'aa570ceb08f0736e6880e12adabba717' and position('conflicto_franja' in v_src) = 0 then
    raise exception 'MIGRACIÓN ABORTADA: reservas_sincronizar_asignaciones() no es la verificada el 05/10/2026 (md5 %). No se ha cambiado nada.', v_md5;
  end if;

  select count(*) into n from public.configuracion_reservas;
  if n <> 1 then
    raise exception 'MIGRACIÓN ABORTADA: configuracion_reservas tiene % filas (esperaba 1). No se ha cambiado nada.', n;
  end if;

  select count(*) into n
  from information_schema.columns
  where table_schema = 'public' and table_name = 'configuracion_reservas'
    and column_name in ('estancia_comida_minutos', 'estancia_cena_minutos');
  if n <> 2 then
    raise exception 'MIGRACIÓN ABORTADA: faltan las columnas estancia_comida_minutos / estancia_cena_minutos (migración 20260926150000). No se ha cambiado nada.';
  end if;

  select count(*) into n
  from pg_trigger t
  where t.tgrelid = 'public.asignaciones_mesa'::regclass
    and t.tgname = 'trg_asignaciones_mesa_denormalizar' and not t.tgisinternal;
  if n <> 1 then
    raise exception 'MIGRACIÓN ABORTADA: falta el trigger trg_asignaciones_mesa_denormalizar. No se ha cambiado nada.';
  end if;

  select count(*) into n
  from pg_trigger t
  where t.tgrelid = 'public.reservas'::regclass
    and t.tgname = 'trg_reservas_sincronizar_asignaciones' and not t.tgisinternal
    and pg_get_triggerdef(t.oid) like '%AFTER UPDATE OF estado, espacio_id, fecha, hora ON public.reservas%';
  if n <> 1 then
    raise exception 'MIGRACIÓN ABORTADA: el trigger trg_reservas_sincronizar_asignaciones no es el esperado (debe saltar con fecha y hora). No se ha cambiado nada.';
  end if;

  -- Solapes que ya existan con el ajuste actual: se AVISA, no se aborta (no
  -- hay restricción que los rompa; solo se valida lo que se escriba).
  n := 0;
  for r in
    with c as (
      select coalesce(estancia_comida_minutos, 105) as com, coalesce(estancia_cena_minutos, 120) as cen
      from public.configuracion_reservas limit 1
    ), f as (
      select a.mesa_id, a.reserva_id, rs.nombre::text as nombre, rs.fecha, rs.hora,
             tsrange(rs.fecha + rs.hora,
                     rs.fecha + rs.hora + make_interval(mins => case when rs.hora < '17:00:00'::time then c.com else c.cen end),
                     '[)') as franja
      from public.asignaciones_mesa a
      join public.reservas rs on rs.id = a.reserva_id
      cross join c
    )
    select m.nombre::text as mesa, x.fecha, x.hora as hora_a, x.nombre as nombre_a, y.hora as hora_b, y.nombre as nombre_b
    from f x
    join f y on y.mesa_id = x.mesa_id and x.reserva_id < y.reserva_id and x.franja && y.franja
    join public.mesas m on m.id = x.mesa_id
    order by x.fecha, m.nombre
  loop
    n := n + 1;
    raise notice 'Solape previo (se deja como está): mesa % el % — % % y % %', r.mesa, r.fecha, r.hora_a, r.nombre_a, r.hora_b, r.nombre_b;
  end loop;
  if n > 0 then
    raise notice 'Hay % pares de asignaciones que ya se solapan con el tiempo de ocupación actual. No se tocan: revísalos en el plano.', n;
  end if;
end
$$;

-- ---------------------------------------------------------------------------
-- 1. Cuánto ocupa una reserva su mesa (minutos) y su franja [inicio, fin)
-- ---------------------------------------------------------------------------
create or replace function public.fn_minutos_ocupacion_mesa(p_hora time)
returns integer
language sql
stable
set search_path = public
as $$
  --  Tiempo de ocupación de mesa del turno de esa hora (corte 17:00, la misma
  --  regla que validar_capacidad_reserva). Sin fila de configuración (no
  --  debería pasar: es un singleton), los valores por defecto 105 / 120.
  select case
           when p_hora < '17:00:00'::time
             then coalesce((select c.estancia_comida_minutos from public.configuracion_reservas c order by c.created_at limit 1), 105)
           else coalesce((select c.estancia_cena_minutos from public.configuracion_reservas c order by c.created_at limit 1), 120)
         end;
$$;

comment on function public.fn_minutos_ocupacion_mesa(time) is
  'Minutos que una reserva a esa hora ocupa su mesa: configuracion_reservas.estancia_comida_minutos (hora < 17:00) o estancia_cena_minutos. Migración 20261005130000_mesas_ocupacion_por_tiempo.';

create or replace function public.fn_franja_ocupacion_mesa(p_fecha date, p_hora time)
returns tsrange
language sql
stable
set search_path = public
as $$
  select tsrange(p_fecha + p_hora,
                 p_fecha + p_hora + make_interval(mins => public.fn_minutos_ocupacion_mesa(p_hora)),
                 '[)');
$$;

comment on function public.fn_franja_ocupacion_mesa(date, time) is
  'Franja [inicio, fin) en la que una reserva ocupa su mesa: de su hora a hora + fn_minutos_ocupacion_mesa. Dos reservas pueden compartir mesa si sus franjas no se solapan. Migración 20261005130000_mesas_ocupacion_por_tiempo.';

revoke all on function public.fn_minutos_ocupacion_mesa(time) from public, anon;
revoke all on function public.fn_franja_ocupacion_mesa(date, time) from public, anon;
grant execute on function public.fn_minutos_ocupacion_mesa(time) to authenticated, service_role;
grant execute on function public.fn_franja_ocupacion_mesa(date, time) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 2. Trigger de asignaciones_mesa: + candado y comprobación de solape
--    (todo lo anterior, igual)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.asignaciones_mesa_denormalizar()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_res_fecha    date;
  v_res_hora     time;
  v_res_estado   text;
  v_res_espacio  uuid;
  v_mesa_espacio uuid;
  v_mesa_nombre  text;
  v_mesa_activa  boolean;
  v_franja       tsrange;
  v_otra_nombre  text;
  v_otra_franja  tsrange;
  v_otra_fecha   date;
begin
  select r.fecha, r.hora, r.estado, r.espacio_id
    into v_res_fecha, v_res_hora, v_res_estado, v_res_espacio
  from public.reservas r
  where r.id = new.reserva_id;

  if not found then
    -- Inalcanzable: la FK asignaciones_mesa_reserva_id_fkey lo impide.
    -- NO es un prefijo del contrato (ver cabecera).
    raise exception 'RESERVA_INEXISTENTE: la reserva % no existe', new.reserva_id
      using errcode = 'check_violation';
  end if;

  if v_res_espacio is null then
    raise exception 'RESERVA_SIN_SALA: la reserva % no tiene sala asignada; primero la sala, luego la mesa', new.reserva_id
      using errcode = 'check_violation';
  end if;

  if v_res_estado = 'cancelada' then
    raise exception 'RESERVA_CANCELADA: la reserva % está cancelada y no puede tener mesa', new.reserva_id
      using errcode = 'check_violation';
  end if;

  select m.espacio_id, m.nombre::text, m.activa
    into v_mesa_espacio, v_mesa_nombre, v_mesa_activa
  from public.mesas m
  where m.id = new.mesa_id;

  if not found then
    -- Inalcanzable: FK asignaciones_mesa_mesa_id_fkey. Ver cabecera.
    raise exception 'MESA_INEXISTENTE: la mesa % no existe', new.mesa_id
      using errcode = 'check_violation';
  end if;

  --  `activa is false` y no `not activa`: `mesas.activa` es nullable
  --  (boolean DEFAULT true, sin NOT NULL), y una mesa con `activa IS NULL`
  --  NO está desactivada — nadie la desactivó. Mismo criterio que el
  --  `activa is not false` de 20260926120000_capacidad_efectiva_mesas.sql.
  if v_mesa_activa is false then
    raise exception 'MESA_INACTIVA: la mesa % está marcada como inactiva', v_mesa_nombre
      using errcode = 'check_violation';
  end if;

  if v_mesa_espacio <> v_res_espacio then
    raise exception 'MESA_OTRA_SALA: la mesa % pertenece a otra sala que la reserva', v_mesa_nombre
      using errcode = 'check_violation';
  end if;

  --  OCUPACIÓN POR TIEMPO (20261005130000_mesas_ocupacion_por_tiempo): la
  --  mesa no puede tenerla otra reserva cuya franja [hora, hora + tiempo de
  --  ocupación) se solape con la de ésta, sea del turno que sea.
  --
  --  Candado por SALA + DÍA (una sola clave por transacción y sala: dar varias
  --  mesas de golpe no coge candados en orden distinto y no puede
  --  interbloquearse). Forma de UNA clave bigint: no comparte espacio con las
  --  de DOS claves (hashtext(fecha), 1|2) de validar_capacidad_reserva y
  --  asignar_mesas_reserva. Con él, dos pantallas que dan la misma mesa a la
  --  vez se ordenan y la segunda ve la fila de la primera.
  perform pg_advisory_xact_lock(
    hashtextextended('asignaciones_mesa|' || v_mesa_espacio::text || '|' || v_res_fecha::text, 0)
  );

  v_franja := public.fn_franja_ocupacion_mesa(v_res_fecha, v_res_hora);

  --  ±1 día: una cena de las 23:30 sigue ocupando la mesa pasada la
  --  medianoche. `reserva_id <>`: las mesas juntas de una misma reserva no
  --  chocan entre sí (y en un UPDATE la propia fila tampoco).
  select r.nombre::text, x.franja, r.fecha
    into v_otra_nombre, v_otra_franja, v_otra_fecha
  from public.asignaciones_mesa a
  join public.reservas r on r.id = a.reserva_id
  cross join lateral (select public.fn_franja_ocupacion_mesa(r.fecha, r.hora) as franja) x
  where a.mesa_id = new.mesa_id
    and a.reserva_id <> new.reserva_id
    and a.fecha between v_res_fecha - 1 and v_res_fecha + 1
    and x.franja && v_franja
  order by lower(x.franja)
  limit 1;

  if found then
    raise exception 'MESA_OCUPADA: La mesa % está ocupada de % a % por %',
      v_mesa_nombre,
      to_char(lower(v_otra_franja), 'HH24:MI'),
      to_char(upper(v_otra_franja), 'HH24:MI'),
      coalesce(nullif(btrim(v_otra_nombre), ''), 'otra reserva')
        || case when v_otra_fecha is distinct from v_res_fecha
                then ' (el ' || to_char(v_otra_fecha, 'DD/MM') || ')'
                else '' end
      using errcode = 'check_violation';
  end if;

  new.fecha      := v_res_fecha;
  new.turno      := case when v_res_hora < '17:00:00'::time then 'comida' else 'cena' end;
  new.espacio_id := v_mesa_espacio;

  --  Autoría solo en el INSERT, y solo si hay sesión:
  --    - En UPDATE no se toca: el UPDATE típico lo hace
  --      reservas_sincronizar_asignaciones() al mover la reserva de día, y
  --      quien mueve la reserva no es quien asignó la mesa.
  --    - `coalesce(auth.uid(), new.asignada_por)`: con sesión manda la
  --      sesión (el cliente no puede atribuir la asignación a otro); sin
  --      sesión (service_role: bot de teléfono, Edge Functions) se respeta
  --      lo que venga, que puede ser NULL.
  if tg_op = 'INSERT' then
    new.asignada_por := coalesce(auth.uid(), new.asignada_por);
  end if;

  return new;
end;
$function$;

-- ---------------------------------------------------------------------------
-- 3. Trigger de reservas: revalidar en cualquier cambio de día u hora
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.reservas_sincronizar_asignaciones()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_turno_nue text;
  v_asig      record;
  v_motivo    text;
begin
  -- (1) CANCELADA -> liberar las mesas. Solo 'cancelada': 'completada' y
  --     'no_show' conservan la mesa (ver CORRECCIÓN 1 de la cabecera de
  --     20260926140000). Va primero: si el mismo UPDATE cancela Y mueve,
  --     cancelar gana.
  if new.estado = 'cancelada' and old.estado is distinct from 'cancelada' then
    delete from public.asignaciones_mesa where reserva_id = new.id;
    return null;
  end if;

  -- (2) CAMBIO DE SALA -> liberar las mesas. No se bloquea el movimiento,
  --     para no romper el kanban de salas.
  if new.espacio_id is distinct from old.espacio_id then
    delete from public.asignaciones_mesa where reserva_id = new.id;
    return null;
  end if;

  -- (3) CAMBIO DE DÍA O DE HORA -> revalidar (y mover) las asignaciones.
  --     Desde 20261005130000 la mesa se ocupa por FRANJA de tiempo, así que
  --     también un cambio de hora dentro del mismo turno (19:00 -> 20:30)
  --     puede hacerla chocar con otra reserva de esa mesa.
  if new.fecha is not distinct from old.fecha and new.hora is not distinct from old.hora then
    return null;
  end if;

  v_turno_nue := case when new.hora < '17:00:00'::time then 'comida' else 'cena' end;

  for v_asig in
    select a.id, a.mesa_id, a.espacio_id, m.nombre::text as mesa_nombre
    from public.asignaciones_mesa a
    left join public.mesas m on m.id = a.mesa_id
    where a.reserva_id = new.id
  loop
    begin
      --  El UPDATE dispara trg_asignaciones_mesa_denormalizar, que vuelve a
      --  leer la reserva (ya actualizada: estamos en un AFTER), recalcula
      --  fecha/turno y comprueba la franja nueva contra el resto de reservas
      --  de esa mesa.
      update public.asignaciones_mesa
         set fecha = new.fecha,
             turno = v_turno_nue
       where id = v_asig.id;
    exception
      when unique_violation then
        --  Solo posible con el índice antiguo (mesa, fecha, turno); se deja
        --  por si se vuelve atrás con el rollback.
        insert into public.asignaciones_mesa_descartadas
          (reserva_id, mesa_id, mesa_nombre, espacio_id, fecha, turno, motivo)
        values
          (new.id, v_asig.mesa_id, v_asig.mesa_nombre, v_asig.espacio_id,
           new.fecha, v_turno_nue, 'conflicto_turno');

        delete from public.asignaciones_mesa where id = v_asig.id;

      when others then
        --  La regla es dura: **el UPDATE de la reserva no puede fallar** (lo
        --  hacen también el bot y la web, que no saben de mesas). La mesa se
        --  DESCARTA, queda auditada con el mensaje, y la reserva se queda
        --  pendiente de mesa. Choque de franja (MESA_OCUPADA) →
        --  `conflicto_franja: MESA_OCUPADA: La mesa 3 está ocupada de …`;
        --  cualquier otro motivo (MESA_INACTIVA, MESA_OTRA_SALA…) →
        --  `revalidacion_fallida:<SQLSTATE> <mensaje>`, como antes.
        v_motivo := case
                      when coalesce(sqlerrm, '') like 'MESA_OCUPADA:%'
                        then 'conflicto_franja: ' || left(sqlerrm, 200)
                      else 'revalidacion_fallida:' || sqlstate || ' ' || left(coalesce(sqlerrm, ''), 200)
                    end;

        insert into public.asignaciones_mesa_descartadas
          (reserva_id, mesa_id, mesa_nombre, espacio_id, fecha, turno, motivo)
        values
          (new.id, v_asig.mesa_id, v_asig.mesa_nombre, v_asig.espacio_id,
           new.fecha, v_turno_nue, v_motivo);

        delete from public.asignaciones_mesa where id = v_asig.id;
    end;
  end loop;

  return null;
end;
$function$;

-- ---------------------------------------------------------------------------
-- 4. Índices: fuera la exclusividad por turno, dentro el de búsqueda
-- ---------------------------------------------------------------------------
drop index if exists public.uq_asignaciones_mesa_mesa_fecha_turno;

create index if not exists idx_asignaciones_mesa_mesa_fecha
  on public.asignaciones_mesa (mesa_id, fecha);

comment on column public.configuracion_reservas.estancia_comida_minutos is
  'Tiempo de ocupación de mesa en el turno de COMIDA (hora < 17:00), en minutos. Una reserva ocupa su mesa de su hora a hora + este tiempo: otra reserva puede usar la misma mesa si no se solapan (trigger asignaciones_mesa_denormalizar, migración 20261005130000). También lo usa el modo servicio: pasado este tiempo desde reservas.llegada_at la mesa sale «por liberar». Configurable en Reservas > Configuración > Tiempo de ocupación de mesa.';

comment on column public.configuracion_reservas.estancia_cena_minutos is
  'Tiempo de ocupación de mesa en el turno de CENA (hora >= 17:00), en minutos. Una reserva ocupa su mesa de su hora a hora + este tiempo: otra reserva puede usar la misma mesa si no se solapan (trigger asignaciones_mesa_denormalizar, migración 20261005130000). También lo usa el modo servicio: pasado este tiempo desde reservas.llegada_at la mesa sale «por liberar». Configurable en Reservas > Configuración > Tiempo de ocupación de mesa.';

-- ---------------------------------------------------------------------------
-- 5. Comprobación final (aborta si algo no ha quedado como debe)
-- ---------------------------------------------------------------------------
do $$
begin
  if to_regclass('public.uq_asignaciones_mesa_mesa_fecha_turno') is not null then
    raise exception 'MIGRACIÓN ABORTADA: el índice uq_asignaciones_mesa_mesa_fecha_turno sigue existiendo.';
  end if;
  if to_regclass('public.idx_asignaciones_mesa_mesa_fecha') is null then
    raise exception 'MIGRACIÓN ABORTADA: falta idx_asignaciones_mesa_mesa_fecha.';
  end if;
  if position('fn_franja_ocupacion_mesa' in (select prosrc from pg_proc where oid = 'public.asignaciones_mesa_denormalizar()'::regprocedure)) = 0 then
    raise exception 'MIGRACIÓN ABORTADA: asignaciones_mesa_denormalizar() no ha quedado con la comprobación de franja.';
  end if;
  if public.fn_franja_ocupacion_mesa(date '2099-01-01', time '14:00')
     <> tsrange(timestamp '2099-01-01 14:00', timestamp '2099-01-01 14:00' + make_interval(mins => public.fn_minutos_ocupacion_mesa(time '14:00')), '[)') then
    raise exception 'MIGRACIÓN ABORTADA: fn_franja_ocupacion_mesa no da la franja esperada.';
  end if;
end
$$;

commit;

-- Verificación (solo lectura): tiene que salir «aplicada | 105 | 120» (o los
-- minutos que tenga puestos la configuración).
select 'mesas_ocupacion_por_tiempo: aplicada' as resultado,
       public.fn_minutos_ocupacion_mesa(time '14:00') as minutos_comida,
       public.fn_minutos_ocupacion_mesa(time '21:00') as minutos_cena;
