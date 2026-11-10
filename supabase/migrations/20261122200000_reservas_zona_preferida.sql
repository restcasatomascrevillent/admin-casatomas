set client_encoding = 'UTF8';
-- 20261122200000_reservas_zona_preferida — «¿Dentro o fuera?» de la reserva (10/11/2026)
--
-- Petición del dueño: «ponme también un seleccionable antes de asignación de mesas de dentro y fuera» y
-- «es como no poner nada dentro o fuera, y si es dentro que se pueda elegir comedor o salón».
--
--   · `reservas.zona_preferida` text NULL, CHECK in ('dentro','fuera'). NULL = no se ha dicho nada.
--     Sin DEFAULT: solo catálogo, no reescribe la tabla.
--
-- Qué sala es «de fuera»: NO hace falta columna nueva en espacios_reserva. Ya existe
-- `caracteristicas.exterior` (la Terraza lo tiene a true); si una sala no trae esa clave, el panel la deduce
-- por el nombre («Terraza…» = fuera). Ver src/lib/reservas/zonaPreferida.ts.
--
-- NO es «Sentar fuera» (20261122171500, columnas fuera_*: dónde se sentó al llegar, Touza…).
--
-- Idempotente. Vuelta atrás: supabase/rollbacks/20261122200000_reservas_zona_preferida_ROLLBACK.sql
-- Aplicar (una a una, nunca `db push`): demo primero; producción solo tras aceptar el PR de la release y
-- con el «sí» del dueño. El panel aguanta sin la columna (Hoy relee sin ella; el alta la omite y avisa).
begin;
set local lock_timeout = '5s';

alter table public.reservas
  add column if not exists zona_preferida text;

alter table public.reservas drop constraint if exists reservas_zona_preferida_valida;
alter table public.reservas
  add constraint reservas_zona_preferida_valida check (zona_preferida is null or zona_preferida in ('dentro', 'fuera'));

comment on column public.reservas.zona_preferida is
  '«¿Dentro o fuera?» (20261122200000): lo que pidió el cliente. dentro = salas interiores (Comedor, Salón…); fuera = exteriores (Terraza, espacios_reserva.caracteristicas.exterior). NULL = no se dijo. Organizar servicio lo respeta. NO es fuera_lugar («Sentar fuera»).';

notify pgrst, 'reload schema';

commit;

select 'reservas_zona_preferida: aplicada' as resultado;
