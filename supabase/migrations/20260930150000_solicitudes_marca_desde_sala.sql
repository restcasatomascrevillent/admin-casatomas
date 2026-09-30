-- ===========================================================================
-- reservas-sin-salas (parche de A1): la solicitud del bot VIEJO hereda la
-- marca de su sala.
-- ===========================================================================
--
-- *** TEMPORAL *** hasta que los bots de restaurante-phone se actualicen
-- (restaurante-phone PR #2). Cuando los bots manden `marca`, este trigger
-- queda INOFENSIVO: una fila que ya llega con 'touza' no se toca, y una que
-- llega con 'casa_tomas' solo sube a 'touza' si lleva una señal de Touza (la
-- misma que ya habría llevado a esa marca). Se puede quitar entonces con el
-- rollback de abajo, sin prisa.
--
-- Por qué: 20260930100000_solicitudes_marca.sql (A1, ya aplicada) añadió
-- solicitudes_pendientes.marca con DEFAULT 'casa_tomas', y
-- fn_aceptar_propuesta_solicitud lee ahora s.marca en vez de deducirla de la
-- sala. Los bots viejos siguen en producción e insertan SIN `marca`, así que
-- cada solicitud suya sale 'casa_tomas', también las de "El Reservado" de
-- Touza; aceptarla crearía una reserva de Casa Tomás.
--
-- Qué hace (sin begin/commit propio: la CLI envuelve cada migración):
--   fn_solicitudes_marca_desde_sala() + trigger BEFORE INSERT
--   trg_solicitudes_marca_desde_sala. Misma regla que el backfill de A1
--   (sección 3), que es la regla vieja de 20260924090000:
--     - la sala propuesta (espacio_propuesto_id; no existe otra columna de
--       sala en la tabla, verificado el 2026-09-30) es de Touza según
--       espacios_reserva.caracteristicas->>'marca', o
--     - notas_cliente empieza por "Solicitud de El Reservado"
--   => NEW.marca := 'touza'.
--   Solo se aplica si NEW.marca es 'casa_tomas' (o NULL): solo SUBE
--   casa_tomas -> touza, nunca baja. Una marca explícita 'touza' de los bots
--   nuevos, reservas-web o el panel no se toca.
--
-- Límite conocido (aceptado): el trigger no distingue el DEFAULT de un
-- 'casa_tomas' explícito. Una solicitud que alguien marque a propósito como
-- Casa Tomás pero con sala de Touza o con el marcador de El Reservado se
-- guardaría como Touza. Es la misma regla que ya regía hasta A1.
--
-- SECURITY INVOKER (por defecto): solo lee espacios_reserva, que los que
-- insertan (service_role de bots y reservas-web; authenticated del panel)
-- pueden leer. Si RLS ocultara la sala, el EXISTS da false y la fila se queda
-- en casa_tomas: nunca falla el insert.
--
-- Solo INSERT: un UPDATE de marca desde el panel es una decisión explícita.
-- No toca filas existentes (el backfill de A1 ya las corrigió), ni reservas,
-- ni fn_aceptar_propuesta_solicitud, ni trg_notificar_solicitud (AFTER).
-- Rollback: supabase/rollbacks/20260930150000_solicitudes_marca_desde_sala_ROLLBACK.sql
-- ===========================================================================

create or replace function public.fn_solicitudes_marca_desde_sala()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  if coalesce(new.marca, 'casa_tomas') = 'casa_tomas'
     and (
       exists (
         select 1 from public.espacios_reserva e
         where e.id = new.espacio_propuesto_id
           and btrim(e.caracteristicas->>'marca') = 'touza'
       )
       or ltrim(coalesce(new.notas_cliente, '')) like 'Solicitud de El Reservado%'
     )
  then
    new.marca := 'touza';
  end if;
  return new;
end;
$$;

comment on function public.fn_solicitudes_marca_desde_sala() is
  'TEMPORAL (hasta restaurante-phone PR #2). BEFORE INSERT en solicitudes_pendientes: si la fila llega con marca casa_tomas (el DEFAULT de los bots viejos) y la sala propuesta es de Touza o las notas empiezan por "Solicitud de El Reservado", la sube a touza. Nunca baja una marca. Misma regla que el backfill de 20260930100000.';

-- Función de trigger: nadie la llama directamente.
revoke all on function public.fn_solicitudes_marca_desde_sala() from public, anon, authenticated;

drop trigger if exists trg_solicitudes_marca_desde_sala on public.solicitudes_pendientes;
create trigger trg_solicitudes_marca_desde_sala
  before insert on public.solicitudes_pendientes
  for each row
  execute function public.fn_solicitudes_marca_desde_sala();

-- ===========================================================================
-- VERIFICACIÓN tras aplicar (solo lectura / sin rastro)
-- ===========================================================================
--   select tgname, pg_get_triggerdef(oid) from pg_trigger
--   where tgrelid = 'public.solicitudes_pendientes'::regclass and not tgisinternal;
--   -- -> trg_solicitudes_marca_desde_sala BEFORE INSERT ... y trg_notificar_solicitud AFTER INSERT
--
--   -- Prueba sin rastro (rollback; el AFTER de notificaciones también se deshace):
--   begin;
--   insert into public.solicitudes_pendientes (nombre, motivo_rechazo, espacio_propuesto_id)
--   values ('zz prueba sala', 'grupo_grande',
--           (select id from public.espacios_reserva where nombre = 'El Reservado'
--              and caracteristicas->>'marca' = 'touza' limit 1))
--   returning marca;                                   -- -> touza
--   insert into public.solicitudes_pendientes (nombre, motivo_rechazo, notas_cliente)
--   values ('zz prueba notas', 'grupo_grande', 'Solicitud de El Reservado: 30 pers.')
--   returning marca;                                   -- -> touza
--   insert into public.solicitudes_pendientes (nombre, motivo_rechazo)
--   values ('zz prueba ct', 'grupo_grande')
--   returning marca;                                   -- -> casa_tomas
--   insert into public.solicitudes_pendientes (nombre, motivo_rechazo, marca)
--   values ('zz prueba explícita', 'grupo_grande', 'touza')
--   returning marca;                                   -- -> touza (no se toca)
--   rollback;
--
--   -- Tras unas horas con los bots viejos: ninguna de El Reservado en casa_tomas
--   select count(*) from public.solicitudes_pendientes s
--   where s.marca = 'casa_tomas'
--     and (exists (select 1 from public.espacios_reserva e
--                  where e.id = s.espacio_propuesto_id
--                    and btrim(e.caracteristicas->>'marca') = 'touza')
--          or ltrim(coalesce(s.notas_cliente, '')) like 'Solicitud de El Reservado%');
--   -- -> 0
-- ===========================================================================
