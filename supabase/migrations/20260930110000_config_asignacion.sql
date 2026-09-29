-- ===========================================================================
-- ##                                                                       ##
-- ##                          PENDIENTE DE APLICAR                         ##
-- ##                                                                       ##
-- ##   Fase B de reservas-sin-salas. Aplicar ANTES de desplegar el panel    ##
-- ##   con la pestaña "Asignación". Idempotente. Puramente aditiva.         ##
-- ##                                                                       ##
-- ===========================================================================
--
-- reservas-sin-salas (Fase B1): configuración de la asignación interna de
-- sala y mesas.
--
-- Decisión del dueño (2026-09-29, engram sdd/reservas-sin-salas/decisiones):
-- la ventana de N horas SOLO RESALTA, no bloquea; se puede asignar sala y
-- mesas en cualquier momento. La configuración vive en
-- configuracion_reservas (singleton). No hay interruptor para el panel.
--
-- Columnas nuevas (todas con DEFAULT: no rompen el singleton existente):
--   · asignacion_ventana_horas      int  NOT NULL DEFAULT 48, CHECK 1..168
--       Horas de antelación en las que el panel pone arriba las reservas y
--       en las que salta el aviso de "sin asignar". 168 = una semana.
--   · asignacion_aviso_activo       bool NOT NULL DEFAULT true
--       Campana del panel para reservas sin sala/mesa dentro de la ventana
--       (lo usa fn_avisar_reservas_sin_asignar, 20260930120000).
--   · asignacion_espacios_excluidos uuid[] NOT NULL DEFAULT '{}'
--   · asignacion_mesas_excluidas    uuid[] NOT NULL DEFAULT '{}'
--       Salas y mesas que el panel NO ofrece al asignar. Listas de EXCLUSIÓN
--       a propósito: una sala o mesa nueva es utilizable por defecto. NO
--       cambian el aforo (el trigger validar_capacidad_reserva no las lee) y
--       no tocan asignaciones existentes: una reserva ya asignada a una sala
--       excluida la conserva (el panel la señala).
--
-- Sin FK sobre los uuid[] (Postgres no las admite en arrays): un uuid de una
-- sala o mesa borrada se queda como dato muerto inofensivo; el panel lo
-- ignora al cruzar con espacios_reserva / mesas.
--
-- NO toca reservas, espacio_id ni asignaciones_mesa.
-- Rollback: supabase/rollbacks/20260930110000_config_asignacion_ROLLBACK.sql
-- (revertir ANTES el frontend que lee estas columnas).
-- ===========================================================================

alter table public.configuracion_reservas
  add column if not exists asignacion_ventana_horas integer not null default 48,
  add column if not exists asignacion_aviso_activo boolean not null default true,
  add column if not exists asignacion_espacios_excluidos uuid[] not null default '{}'::uuid[],
  add column if not exists asignacion_mesas_excluidas uuid[] not null default '{}'::uuid[];

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'configuracion_reservas_asignacion_ventana_rango'
      and conrelid = 'public.configuracion_reservas'::regclass
  ) then
    alter table public.configuracion_reservas
      add constraint configuracion_reservas_asignacion_ventana_rango
      check (asignacion_ventana_horas between 1 and 168);
  end if;
end;
$$;

comment on column public.configuracion_reservas.asignacion_ventana_horas is
  'Horas (1-168) antes del servicio en las que el panel de asignación pone arriba las reservas y avisa de las que no tienen sala/mesa. Solo resalta: no bloquea asignar antes ni después.';
comment on column public.configuracion_reservas.asignacion_aviso_activo is
  'Si true, fn_avisar_reservas_sin_asignar (pg_cron cada 15 min) crea una notificación por reserva sin sala/mesa dentro de la ventana, una sola vez por reserva.';
comment on column public.configuracion_reservas.asignacion_espacios_excluidos is
  'Salas (espacios_reserva.id) que el panel no ofrece al asignar. No cambia el aforo ni las asignaciones existentes.';
comment on column public.configuracion_reservas.asignacion_mesas_excluidas is
  'Mesas (mesas.id) que el panel no ofrece al asignar. No cambia el aforo ni las asignaciones existentes.';

-- ===========================================================================
-- VERIFICACIÓN tras aplicar
-- ===========================================================================
--   select column_name, data_type, column_default, is_nullable
--   from information_schema.columns
--   where table_schema = 'public' and table_name = 'configuracion_reservas'
--     and column_name like 'asignacion_%';
--   -- -> 4 filas, NOT NULL, defaults 48 / true / '{}' / '{}'
--
--   select asignacion_ventana_horas, asignacion_aviso_activo,
--          asignacion_espacios_excluidos, asignacion_mesas_excluidas
--   from public.configuracion_reservas;
--   -- -> 48 | true | {} | {}
--
--   -- El CHECK rechaza 0 y 169 (sin rastro):
--   begin; update public.configuracion_reservas set asignacion_ventana_horas = 0;   rollback;  -- ERROR 23514
--   begin; update public.configuracion_reservas set asignacion_ventana_horas = 169; rollback;  -- ERROR 23514
-- ===========================================================================
