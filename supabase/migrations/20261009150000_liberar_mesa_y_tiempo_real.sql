set client_encoding = 'UTF8';
-- ===========================================================================
-- ##   NO APLICADA: la aplica el dueño a mano                              ##
-- ##   1) «Liberar mesa»: una mesa liberada (o de un «No vino») se puede   ##
-- ##      volver a asignar en el mismo servicio.                           ##
-- ##   2) Tiempo real de ajustes_mesa_servicio y salas_cerradas_servicio.  ##
-- ===========================================================================
-- 1) Liberar una mesa pone `reservas.salida_at` (la columna del modo servicio,
--    que ya existía): no se borra la asignación ni cambia el estado «Llegó».
--    Hasta hoy el trigger de asignaciones seguía viendo la mesa ocupada toda la
--    franja de la reserva que se fue, así que no se podía sentar a nadie más.
--    Se recrea `asignaciones_mesa_denormalizar` IGUAL que en producción
--    (copiada con pg_get_functiondef el 09/10/2026) con una sola diferencia en
--    la consulta del choque: ignora las reservas «No vino»/canceladas y las
--    liberadas antes de que empiece la franja de la nueva (+15 min de margen).
--    Mientras no se aplique, el panel ofrece la mesa como libre pero la base de
--    datos la rechaza con «Mesa ocupada» y se avisa.
-- 2) La publicación `supabase_realtime` ya tiene `reservas` y `asignaciones_mesa`;
--    se añaden las dos tablas nuevas para que los cambios de piezas y de
--    «Terraza cerrada» lleguen al momento a los móviles (hoy van por sondeo).
--
-- PASOS (desde adminpanelct/)
--   npx supabase db query --linked -f supabase/migrations/20261009150000_liberar_mesa_y_tiempo_real.sql
-- ===========================================================================
begin;
set local lock_timeout = '5s';

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
    --  20261009150000: una mesa LIBERADA (la reserva se fue: `salida_at`) o de
    --  una reserva «No vino» se puede volver a dar. La liberada deja de contar
    --  desde su hora de salida (15 min de margen: «Sin reserva» guarda la hora
    --  en minutos y la salida lleva segundos).
    and r.estado::text not in ('no_show', 'cancelada')
    and (r.salida_at is null
         or (r.salida_at at time zone 'Europe/Madrid') > lower(v_franja) + interval '15 minutes')
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
$function$
;

do $$
begin
  if not exists (select 1 from pg_publication_tables
                  where pubname = 'supabase_realtime' and tablename = 'ajustes_mesa_servicio') then
    alter publication supabase_realtime add table public.ajustes_mesa_servicio;
  end if;
  if not exists (select 1 from pg_publication_tables
                  where pubname = 'supabase_realtime' and tablename = 'salas_cerradas_servicio') then
    alter publication supabase_realtime add table public.salas_cerradas_servicio;
  end if;
end;
$$;

commit;
