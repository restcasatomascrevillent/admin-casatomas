-- ===========================================================================
-- MODO SERVICIO (Fase 4, MVP) — config de tiempos + `reservas.salida_at`
-- ===========================================================================
-- Escrita el 2026-09-26 para la vista "Servicio" del plano (personal viendo
-- el estado de cada mesa en vivo durante el turno). NO SE HA APLICADO contra
-- Supabase: la orquestadora la revisa y la aplica más tarde. Ver también el
-- bloque bloqueado de `supabase db push` que dejaron
-- `20260926120000_capacidad_efectiva_mesas.sql` y
-- `20260926140000_asignaciones_mesa_sin_solapes.sql` — esta migración es
-- independiente de esas dos (no toca mesas, aforo ni asignaciones) pero SÍ
-- depende de que `20260923180000_reservas_llegada.sql` (columna
-- `reservas.llegada_at`) se aplique ANTES o EN EL MISMO push, porque el paso 3
-- de aquí reescribe el trigger que ya usa esa columna y el `CREATE TRIGGER
-- ... BEFORE UPDATE OF (estado, llegada_at, salida_at)` exige que las tres
-- columnas existan en el momento de crear el trigger. El orden de aplicación
-- por timestamp (20260923180000 antes de 20260926150000) ya lo garantiza si
-- se aplican en el mismo `db push`.
--
-- ENCARGO (dueño, vía diseño sdd/plano-espacios/design, 2026-09-26)
--
--   El personal necesita ver el plano EN VIVO durante el servicio: qué mesas
--   están libres, cuáles tienen reserva pendiente de llegar, cuáles llevan
--   retraso, cuáles están ocupadas y cuáles llevan tanto rato sentadas que
--   probablemente ya se puedan liberar para el siguiente turno.
--
--   Dos umbrales, TODOS configurables desde "Configuración de reservas"
--   (decisión explícita del dueño: nada de tiempos fijos en el código):
--     · Estancia estimada (por turno, comida y cena pueden durar distinto):
--       cuándo se considera que una mesa ocupada está "por liberar".
--     · Gracia de retraso: cuántos minutos después de la hora de la reserva
--       se considera que el cliente llega tarde ("retrasada") en vez de
--       simplemente "reservada, todavía dentro de plazo".
--
-- QUÉ HACE ESTA MIGRACIÓN
--
--   1. `public.reservas.salida_at timestamptz NULL` — momento en que se
--      "liberó" la mesa. "Liberar" NO cambia `estado` (sigue en 'completada':
--      el cliente SÍ vino y SÍ se sentó, ver `servicioSala.ts`), solo marca
--      que ya se fue. "Deshacer liberar" es, literalmente,
--      `salida_at = null`. Las filas de `asignaciones_mesa` NO se toca aquí:
--      se conservan como historial de qué mesa ocupó cada reserva (decisión
--      explícita del dueño), coherente con
--      `20260926140000_asignaciones_mesa_sin_solapes.sql`, que YA respeta que
--      'completada' conserva su mesa.
--   2. Tres columnas nuevas en `public.configuracion_reservas`, con DEFAULT
--      (no rompe el singleton existente) y CHECK de rango:
--        · `estancia_comida_minutos`  integer NOT NULL DEFAULT 105 (comida
--          suele ser más rápida: sobremesa corta entre semana).
--        · `estancia_cena_minutos`    integer NOT NULL DEFAULT 120 (cenas se
--          alargan más: sobremesa, copas).
--        · `retraso_gracia_minutos`   integer NOT NULL DEFAULT 15 (margen
--          razonable antes de marcar una reserva como "tarde" en el plano;
--          NO cancela ni toca el estado de la reserva, es solo una etiqueta
--          visual del modo servicio).
--   3. Reescribe `fn_reservas_limpiar_llegada()` (creada en
--      `20260923180000_reservas_llegada.sql`) para que, además de
--      `llegada_at`, limpie TAMBIÉN `salida_at` cuando la reserva deja de
--      estar 'completada' (se cancela, se marca no_show a mano, se deshace la
--      llegada...). Sin esto quedaría una reserva 'confirmada' con
--      `salida_at` puesto, que no significa nada y confundiría al modo
--      servicio (una reserva que nunca llegó no puede haber "salido"). El
--      trigger pasa a dispararse también en UPDATE de `salida_at` (para poder
--      poner/quitar `salida_at` con estado 'completada' sin problema; no hay
--      nada que limpiar en ese caso, así que es un no-op cuando solo cambia
--      `salida_at` y el estado sigue siendo 'completada' — lo hace explícito
--      el primer `if`).
--
-- QUÉ **NO** HACE ESTA MIGRACIÓN
--
--   * NO toca `asignaciones_mesa`, `mesas`, el aforo ni el trigger de
--     capacidad. "Liberar" es un concepto de SERVICIO (¿sigue el cliente
--     sentado?), no de CIERRE DE MESAS (qué mesa tuvo cada reserva).
--   * NO añade turnos nuevos ni tabla de turnos: reutiliza el concepto ya
--     existente en todo el repo (comida si `hora < 17:00`, cena si no —
--     `turnoDeHora`, igual que el aforo y las asignaciones). No hay ninguna
--     fila de "turno" que necesite una FK aquí.
--   * NO cambia RLS de ninguna tabla: las políticas de `reservas` y de
--     `configuracion_reservas` son por fila y ya cubren estas columnas
--     nuevas igual que las existentes.
--
-- Idempotente: se puede re-ejecutar sin romper nada (add column if not
-- exists, create or replace function, drop+create trigger, DO block con
-- IF NOT EXISTS para las dos CHECK nuevas).
-- ===========================================================================

begin;

-- ---------------------------------------------------------------------------
-- 1. `reservas.salida_at` — hora en que se liberó la mesa
-- ---------------------------------------------------------------------------
alter table public.reservas
  add column if not exists salida_at timestamptz null;

comment on column public.reservas.salida_at is
  'Momento en que el personal marcó "Liberar mesa" desde el modo servicio del plano. NO cambia reservas.estado (sigue en completada: el cliente sí vino). NULL = todavía sentado, o nunca llegó, o se deshizo la liberación. Se limpia sola si la reserva deja de estar completada (trg_reservas_limpiar_llegada, extendido en 20260926150000_modo_servicio_config_y_salida.sql). asignaciones_mesa NO se borra al liberar: queda como historial de qué mesa ocupó la reserva.';

-- ---------------------------------------------------------------------------
-- 2. Umbrales de tiempo configurables en `configuracion_reservas`
-- ---------------------------------------------------------------------------
--   NOT NULL + DEFAULT: el singleton existente (1 fila) las recibe pobladas
--   en el mismo ALTER, así que `useConfiguracionReservas` nunca ve NULL y no
--   necesita defaults propios en el cliente (aunque los mantiene, ver
--   servicioSala.ts, por si algún día se lee sin pasar por este hook).
alter table public.configuracion_reservas
  add column if not exists estancia_comida_minutos integer not null default 105;

alter table public.configuracion_reservas
  add column if not exists estancia_cena_minutos integer not null default 120;

alter table public.configuracion_reservas
  add column if not exists retraso_gracia_minutos integer not null default 15;

comment on column public.configuracion_reservas.estancia_comida_minutos is
  'Minutos de estancia estimada en el turno de COMIDA (hora < 17:00). Pasado este tiempo desde reservas.llegada_at, el modo servicio marca la mesa como "por liberar". Configurable desde Configuración de reservas > Modo servicio.';

comment on column public.configuracion_reservas.estancia_cena_minutos is
  'Minutos de estancia estimada en el turno de CENA (hora >= 17:00). Pasado este tiempo desde reservas.llegada_at, el modo servicio marca la mesa como "por liberar". Configurable desde Configuración de reservas > Modo servicio.';

comment on column public.configuracion_reservas.retraso_gracia_minutos is
  'Minutos de margen tras la hora de la reserva antes de que el modo servicio la marque como "retrasada" (el cliente todavía no ha llegado). Solo afecta a cómo se pinta el plano; no cancela ni toca el estado de la reserva.';

do $do$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.configuracion_reservas'::regclass
      and conname = 'configuracion_reservas_estancia_comida_rango'
  ) then
    alter table public.configuracion_reservas
      add constraint configuracion_reservas_estancia_comida_rango
      check (estancia_comida_minutos between 15 and 480);
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.configuracion_reservas'::regclass
      and conname = 'configuracion_reservas_estancia_cena_rango'
  ) then
    alter table public.configuracion_reservas
      add constraint configuracion_reservas_estancia_cena_rango
      check (estancia_cena_minutos between 15 and 480);
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.configuracion_reservas'::regclass
      and conname = 'configuracion_reservas_retraso_gracia_rango'
  ) then
    alter table public.configuracion_reservas
      add constraint configuracion_reservas_retraso_gracia_rango
      check (retraso_gracia_minutos between 0 and 180);
  end if;
end
$do$;

-- ---------------------------------------------------------------------------
-- 3. Extender `fn_reservas_limpiar_llegada()` para limpiar también `salida_at`
-- ---------------------------------------------------------------------------
--   DEPENDE de que `llegada_at` exista ya (20260923180000_reservas_llegada.sql
--   crea esta función). Se reescribe el cuerpo entero con CREATE OR REPLACE
--   (misma firma, mismo nombre): el trigger que la usa no hay que tocarlo,
--   apunta por nombre.
create or replace function public.fn_reservas_limpiar_llegada()
returns trigger
language plpgsql
set search_path to 'public'
as $$
begin
  if new.estado is distinct from 'completada' then
    if new.llegada_at is not null then
      new.llegada_at := null;
    end if;
    if new.salida_at is not null then
      new.salida_at := null;
    end if;
  end if;
  return new;
end;
$$;

comment on function public.fn_reservas_limpiar_llegada() is
  'BEFORE UPDATE en reservas: si la reserva deja de estar completada, borra llegada_at Y salida_at (extendido en 20260926150000_modo_servicio_config_y_salida.sql) para que no quede una hora de llegada/salida en una reserva cancelada/confirmada/no_show. Si la reserva sigue completada, es un no-op (no hay nada que limpiar).';

drop trigger if exists trg_reservas_limpiar_llegada on public.reservas;
create trigger trg_reservas_limpiar_llegada
  before update of estado, llegada_at, salida_at on public.reservas
  for each row
  execute function public.fn_reservas_limpiar_llegada();

commit;

-- ----------------------------------------------------------------------------
-- VERIFICACIÓN (a mano, tras aplicar)
-- ----------------------------------------------------------------------------
--   select column_name, data_type, is_nullable, column_default
--   from information_schema.columns
--   where table_schema = 'public' and table_name = 'reservas' and column_name = 'salida_at';
--   -> salida_at | timestamp with time zone | YES | (sin default)
--
--   select column_name, column_default
--   from information_schema.columns
--   where table_schema = 'public' and table_name = 'configuracion_reservas'
--     and column_name in ('estancia_comida_minutos','estancia_cena_minutos','retraso_gracia_minutos');
--   -> las tres, con sus defaults (105 / 120 / 15).
--
--   -- Comprobar que salir de 'completada' limpia las dos columnas:
--   update reservas set estado = 'completada', llegada_at = now(), salida_at = now() where id = '<alguna reserva de prueba>';
--   update reservas set estado = 'confirmada' where id = '<esa misma reserva>';
--   select llegada_at, salida_at from reservas where id = '<esa misma reserva>';
--   -> NULL, NULL
--
-- ROLLBACK
--   Ver supabase/rollbacks/20260926150000_modo_servicio_config_y_salida_ROLLBACK.sql
-- ----------------------------------------------------------------------------
