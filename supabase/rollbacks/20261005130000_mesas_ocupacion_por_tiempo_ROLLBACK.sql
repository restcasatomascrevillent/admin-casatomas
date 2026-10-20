set client_encoding = 'UTF8';
-- (Primera línea a propósito: comentarios con tilde; psql en una consola de
-- Windows puede arrancar en WIN1252.)
-- ===========================================================================
-- ROLLBACK de 20261005130000_mesas_ocupacion_por_tiempo.sql
-- ---------------------------------------------------------------------------
-- Devuelve la exclusividad de mesa POR TURNO tal como estaba el 05/10/2026:
--   · asignaciones_mesa_denormalizar() y reservas_sincronizar_asignaciones()
--     con su definición EXACTA de antes (pg_get_functiondef leído en
--     producción; md5 1c45a0f8797a46a59ebd1422714778fd y
--     aa570ceb08f0736e6880e12adabba717 — la comprobación final lo verifica);
--   · vuelve el índice único uq_asignaciones_mesa_mesa_fecha_turno
--     (mesa_id, fecha, turno);
--   · fuera idx_asignaciones_mesa_mesa_fecha, fn_franja_ocupacion_mesa y
--     fn_minutos_ocupacion_mesa;
--   · los comentarios de estancia_comida_minutos / estancia_cena_minutos,
--     como estaban. Los VALORES del ajuste no se tocan.
--
-- ANTES DE DESHACER: si mientras estuvo aplicada se dieron dos reservas del
-- MISMO día y turno a la misma mesa (permitido por franjas), el índice único
-- no se puede volver a crear. Este rollback lo comprueba y ABORTA sin tocar
-- nada, listando los casos: hay que quitar a mano una de las dos mesas
-- (plano → «Quitar mesas») y volver a lanzarlo.
--
-- El panel ya publicado sigue funcionando con el rollback: el servidor vuelve
-- a rechazar con MESA_OCUPADA dos reservas del mismo turno en una mesa.
--
--   npx supabase db query --linked -f supabase/rollbacks/20261005130000_mesas_ocupacion_por_tiempo_ROLLBACK.sql
-- Tiene que imprimir «mesas_ocupacion_por_tiempo: deshecha».
-- ===========================================================================

begin;
set local lock_timeout = '5s';

do $$
declare
  n integer := 0;
  r record;
begin
  for r in
    select m.nombre::text as mesa, a.fecha, a.turno, count(*) as cuantas
    from public.asignaciones_mesa a
    join public.mesas m on m.id = a.mesa_id
    group by m.nombre, a.mesa_id, a.fecha, a.turno
    having count(*) > 1
    order by a.fecha, m.nombre
  loop
    n := n + 1;
    raise notice 'Mesa % el % (%): % reservas', r.mesa, r.fecha, r.turno, r.cuantas;
  end loop;
  if n > 0 then
    raise exception 'ROLLBACK ABORTADO: hay % mesas con más de una reserva en el mismo día y turno (ver NOTICE). Quita una de las mesas en el plano y vuelve a lanzarlo. No se ha cambiado nada.', n;
  end if;
end
$$;

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

CREATE OR REPLACE FUNCTION public.reservas_sincronizar_asignaciones()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_turno_ant text;
  v_turno_nue text;
  v_asig      record;
begin
  -- (1) CANCELADA -> liberar las mesas. Solo 'cancelada': 'completada' y
  --     'no_show' conservan la mesa (ver CORRECCIÓN 1 de la cabecera).
  --     Va primero: si el mismo UPDATE cancela Y mueve, cancelar gana.
  if new.estado = 'cancelada' and old.estado is distinct from 'cancelada' then
    delete from public.asignaciones_mesa where reserva_id = new.id;
    return null;
  end if;

  -- (2) CAMBIO DE SALA -> liberar las mesas. No se bloquea el movimiento,
  --     para no romper el kanban de salas (ver cabecera).
  if new.espacio_id is distinct from old.espacio_id then
    delete from public.asignaciones_mesa where reserva_id = new.id;
    return null;
  end if;

  -- (3) CAMBIO DE DÍA O DE TURNO -> mover las asignaciones.
  v_turno_ant := case when old.hora < '17:00:00'::time then 'comida' else 'cena' end;
  v_turno_nue := case when new.hora < '17:00:00'::time then 'comida' else 'cena' end;

  --  Un cambio de hora DENTRO del mismo turno (19:00 -> 20:30) no toca
  --  nada: la asignación sigue siendo válida.
  if new.fecha is not distinct from old.fecha and v_turno_nue = v_turno_ant then
    return null;
  end if;

  for v_asig in
    select a.id, a.mesa_id, a.espacio_id, m.nombre::text as mesa_nombre
    from public.asignaciones_mesa a
    left join public.mesas m on m.id = a.mesa_id
    where a.reserva_id = new.id
  loop
    begin
      --  El UPDATE dispara trg_asignaciones_mesa_denormalizar, que vuelve a
      --  leer la reserva (ya actualizada: estamos en un AFTER) y recalcula
      --  fecha/turno a los mismos valores. Se escriben aquí igualmente para
      --  que la intención quede explícita y el UPDATE tenga algo que cambiar.
      update public.asignaciones_mesa
         set fecha = new.fecha,
             turno = v_turno_nue
       where id = v_asig.id;
    exception
      when unique_violation then
        --  La mesa ya está pillada en el nuevo día+turno. Se DESCARTA la
        --  asignación y la reserva se mueve igual: mover una reserva no
        --  puede fallar por un conflicto de mesas (ver cabecera).
        insert into public.asignaciones_mesa_descartadas
          (reserva_id, mesa_id, mesa_nombre, espacio_id, fecha, turno, motivo)
        values
          (new.id, v_asig.mesa_id, v_asig.mesa_nombre, v_asig.espacio_id,
           new.fecha, v_turno_nue, 'conflicto_turno');

        delete from public.asignaciones_mesa where id = v_asig.id;

      when others then
        --  Misma lógica para el resto de motivos por los que la
        --  revalidación del trigger puede rechazar la asignación movida:
        --  MESA_INACTIVA (alguien desactivó la mesa después de asignarla),
        --  MESA_OTRA_SALA... Capturar `others` es deliberadamente amplio
        --  porque la regla es dura: **el UPDATE de la reserva no puede
        --  fallar**. No es silencioso: el SQLSTATE **y el mensaje** quedan
        --  escritos en el motivo, así que en la auditoría se lee literalmente
        --  `revalidacion_fallida:23514 MESA_INACTIVA: la mesa 4 ...` y el
        --  descarte es diagnosticable sin adivinar. `left(...,200)` para que
        --  un mensaje kilométrico no infle la fila.
        insert into public.asignaciones_mesa_descartadas
          (reserva_id, mesa_id, mesa_nombre, espacio_id, fecha, turno, motivo)
        values
          (new.id, v_asig.mesa_id, v_asig.mesa_nombre, v_asig.espacio_id,
           new.fecha, v_turno_nue,
           'revalidacion_fallida:' || sqlstate || ' ' || left(coalesce(sqlerrm, ''), 200));

        delete from public.asignaciones_mesa where id = v_asig.id;
    end;
  end loop;

  return null;
end;
$function$
;

drop index if exists public.idx_asignaciones_mesa_mesa_fecha;

create unique index if not exists uq_asignaciones_mesa_mesa_fecha_turno
  on public.asignaciones_mesa using btree (mesa_id, fecha, turno);

drop function if exists public.fn_franja_ocupacion_mesa(date, time);
drop function if exists public.fn_minutos_ocupacion_mesa(time);

comment on column public.configuracion_reservas.estancia_comida_minutos is
  'Minutos de estancia estimada en el turno de COMIDA (hora < 17:00). Pasado este tiempo desde reservas.llegada_at, el modo servicio marca la mesa como "por liberar". Configurable desde Configuración de reservas > Modo servicio.';

comment on column public.configuracion_reservas.estancia_cena_minutos is
  'Minutos de estancia estimada en el turno de CENA (hora >= 17:00). Pasado este tiempo desde reservas.llegada_at, el modo servicio marca la mesa como "por liberar". Configurable desde Configuración de reservas > Modo servicio.';

do $$
begin
  if md5(pg_get_functiondef('public.asignaciones_mesa_denormalizar()'::regprocedure)) <> '1c45a0f8797a46a59ebd1422714778fd' then
    raise exception 'ROLLBACK ABORTADO: asignaciones_mesa_denormalizar() no ha quedado igual que antes (md5 distinto).';
  end if;
  if md5(pg_get_functiondef('public.reservas_sincronizar_asignaciones()'::regprocedure)) <> 'aa570ceb08f0736e6880e12adabba717' then
    raise exception 'ROLLBACK ABORTADO: reservas_sincronizar_asignaciones() no ha quedado igual que antes (md5 distinto).';
  end if;
  if to_regclass('public.uq_asignaciones_mesa_mesa_fecha_turno') is null then
    raise exception 'ROLLBACK ABORTADO: no se ha creado uq_asignaciones_mesa_mesa_fecha_turno.';
  end if;
end
$$;

commit;

select 'mesas_ocupacion_por_tiempo: deshecha' as resultado,
       (select indexdef from pg_indexes where indexname = 'uq_asignaciones_mesa_mesa_fecha_turno') as indice;
