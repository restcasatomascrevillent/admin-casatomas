-- ===========================================================================
-- ROLLBACK de supabase/migrations/20260926150000_modo_servicio_config_y_salida.sql
-- ===========================================================================
--
-- Este fichero NO es una migracion y no debe copiarse a
-- supabase/migrations/ (ver supabase/rollbacks/README.md). Se ejecuta A MANO
-- (psql / SQL editor) y solo para deshacer un despliegue que salio mal.
--
-- ---------------------------------------------------------------------------
-- QUE REVIERTE
-- ---------------------------------------------------------------------------
--   1. Devuelve `fn_reservas_limpiar_llegada()` a la version de
--      `20260923180000_reservas_llegada.sql` (solo limpia `llegada_at`) y el
--      trigger a `BEFORE UPDATE OF (estado, llegada_at)` (sin `salida_at`).
--   2. Borra las tres columnas de `configuracion_reservas`
--      (`estancia_comida_minutos`, `estancia_cena_minutos`,
--      `retraso_gracia_minutos`) y sus CHECK.
--   3. Borra `reservas.salida_at`.
--
-- Se hace EN ESE ORDEN (trigger primero) para no dejar, ni un instante, un
-- trigger que referencie una columna que ya no existe.
--
-- ---------------------------------------------------------------------------
-- QUE SE PIERDE
-- ---------------------------------------------------------------------------
--   Cualquier `salida_at` guardado (qué mesas se habían liberado durante el
--   servicio) y cualquier ajuste que el dueño hubiera hecho a los tres
--   umbrales de tiempo (vuelven a no existir, no a su default: la columna
--   desaparece). `asignaciones_mesa` NO se toca aquí (la migración tampoco la
--   tocó): el historial de qué mesa tuvo cada reserva se conserva intacto.
--
-- ---------------------------------------------------------------------------
-- CUANDO USAR ESTO
-- ---------------------------------------------------------------------------
--   Si el modo servicio (Fase 4) se abandona o hay que deshacer su
--   despliegue. A fecha 2026-09-26 la migración que revierte está PENDIENTE
--   (no aplicada): si nunca se aplica, este script es un no-op inofensivo
--   (todo con `if exists`).
-- ---------------------------------------------------------------------------

begin;

-- 1) Trigger y función: primero, para no dejar una ventana con el trigger
--    apuntando a una columna que se va a borrar.
create or replace function public.fn_reservas_limpiar_llegada()
returns trigger
language plpgsql
set search_path to 'public'
as $$
begin
  if new.estado is distinct from 'completada' and new.llegada_at is not null then
    new.llegada_at := null;
  end if;
  return new;
end;
$$;

comment on function public.fn_reservas_limpiar_llegada() is
  'BEFORE UPDATE en reservas: si la reserva deja de estar completada, borra llegada_at para que no quede una hora de llegada en una reserva cancelada/confirmada/no_show.';

drop trigger if exists trg_reservas_limpiar_llegada on public.reservas;
create trigger trg_reservas_limpiar_llegada
  before update of estado, llegada_at on public.reservas
  for each row
  execute function public.fn_reservas_limpiar_llegada();

-- 2) Umbrales de configuracion_reservas.
alter table public.configuracion_reservas
  drop constraint if exists configuracion_reservas_estancia_comida_rango;
alter table public.configuracion_reservas
  drop constraint if exists configuracion_reservas_estancia_cena_rango;
alter table public.configuracion_reservas
  drop constraint if exists configuracion_reservas_retraso_gracia_rango;

alter table public.configuracion_reservas drop column if exists estancia_comida_minutos;
alter table public.configuracion_reservas drop column if exists estancia_cena_minutos;
alter table public.configuracion_reservas drop column if exists retraso_gracia_minutos;

-- 3) `reservas.salida_at`.
alter table public.reservas drop column if exists salida_at;

commit;

-- ---------------------------------------------------------------------------
-- VERIFICACION POSTERIOR (solo lectura)
-- ---------------------------------------------------------------------------
--   select column_name from information_schema.columns
--   where table_schema = 'public' and table_name = 'reservas' and column_name = 'salida_at';
--   -- esperado: 0 filas
--
--   select column_name from information_schema.columns
--   where table_schema = 'public' and table_name = 'configuracion_reservas'
--     and column_name in ('estancia_comida_minutos','estancia_cena_minutos','retraso_gracia_minutos');
--   -- esperado: 0 filas
--
--   select pg_get_functiondef('public.fn_reservas_limpiar_llegada()'::regprocedure) as def;
--   -- esperado: NO contiene 'salida_at'
-- ---------------------------------------------------------------------------
