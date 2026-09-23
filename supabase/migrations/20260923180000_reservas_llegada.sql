-- ============================================================================
-- PENDIENTE DE APLICAR — hora de llegada del cliente (`reservas.llegada_at`)
-- ============================================================================
-- Escrita el 2026-09-23 junto con la pestaña unificada de Reservas y el
-- Gestor de reservas (Kanban). NO se ha aplicado contra Supabase.
--
-- QUÉ YA EXISTÍA (y se reutiliza, sin tocarlo)
--   El CHECK `reservas_estado_check` ya admite 'completada' y 'no_show'. El
--   panel registra la llegada pasando la reserva a 'completada' ("Ha llegado")
--   y la ausencia a 'no_show' ("No se presentó"). Es el mismo significado que
--   ya usa emails-reserva (ausencias.ts: una 'confirmada' pasada +3 h sin
--   marcar 'completada' se convierte en 'no_show' y propone lista negra), así
--   que marcar la llegada protege al cliente de ese cron. Ninguno de los dos
--   estados envía correo (tipoEmailParaEstado → null).
--
-- QUÉ AÑADE ESTA MIGRACIÓN
--   Solo la HORA a la que llegó el cliente, para pintarla en la tarjeta
--   ("Llegó 21:05") y poder medir retrasos más adelante. El frontend ya la
--   escribe si la columna existe y, si no, reintenta sin ella
--   (src/hooks/useAccionesServicioReserva.ts), así que aplicar esto no exige
--   desplegar nada a la vez.
--
--   · `llegada_at timestamptz NULL`: ADD COLUMN nullable sin DEFAULT es un
--     cambio solo de catálogo en Postgres ≥11 (no reescribe la tabla; lock
--     ACCESS EXCLUSIVE de milisegundos). Sin backfill: las 'completada'
--     históricas no tienen hora real de llegada y inventarla sería peor.
--   · Trigger BEFORE UPDATE que pone `llegada_at` a NULL si la reserva deja
--     de estar 'completada' (p. ej. se cancela desde la lista, que no sabe
--     nada de esta columna). Se prefiere a un CHECK (llegada_at IS NULL OR
--     estado = 'completada') porque un CHECK haría FALLAR esos UPDATE de
--     otros sitios (lista, bot, cron) en vez de mantener el dato coherente.
--   · Sin índice: solo se lee junto con la fila (listas del día ya filtradas
--     por fecha); no hay consultas por llegada_at.
--
-- RLS: no cambia. Las políticas de `reservas` son por fila, no por columna
-- (20260918120000_rls_por_permisos_de_seccion.sql): quien puede actualizar
-- una reserva puede escribir esta columna, y nadie más.
--
-- AFORO Y 'completada' (decidido por el dueño, 2026-09-23: sin cambios)
--   El trigger de aforo `validar_capacidad_reserva` solo cuenta pendiente/
--   verificada/confirmada; una mesa que ya llegó ('completada') deja de
--   contar en SU turno. No importa: todo se reserva con antelación y el día
--   se bloquea la víspera. Ver docs/funcionalidades/01-reservas.md §4.
--
-- Idempotente: se puede re-ejecutar.
-- ============================================================================

begin;

alter table public.reservas
  add column if not exists llegada_at timestamptz null;

comment on column public.reservas.llegada_at is
  'Momento en que el personal registró la llegada del cliente desde el panel ("Ha llegado" → estado completada). NULL si no ha llegado, si se deshizo, o si es una completada anterior a esta columna. Se limpia sola al salir de completada (trg_reservas_limpiar_llegada).';

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

commit;

-- ----------------------------------------------------------------------------
-- VERIFICACIÓN (a mano, tras aplicar)
-- ----------------------------------------------------------------------------
--   select column_name, data_type, is_nullable
--   from information_schema.columns
--   where table_schema = 'public' and table_name = 'reservas' and column_name = 'llegada_at';
--   -> llegada_at | timestamp with time zone | YES
--
--   Después, recargar el panel: marcar "Ha llegado" en una reserva de hoy
--   debe mostrar "Llegó HH:MM" (antes de aplicar mostraba solo "Llegó").
--
-- ROLLBACK
--   drop trigger if exists trg_reservas_limpiar_llegada on public.reservas;
--   drop function if exists public.fn_reservas_limpiar_llegada();
--   alter table public.reservas drop column if exists llegada_at;
-- ----------------------------------------------------------------------------
