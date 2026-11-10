-- Libro de reservas: «Guardar sin interpretar» (10/11/2026, petición del dueño).
-- «Una opción que sea en lugar de interpretar, guardar, y ya luego se interpretan, por si no da
-- tiempo». Se guarda el trazo (PNG en base64) en la hoja de su día como borrador pendiente; más
-- tarde se interpreta, se revisa con el alta manual de siempre y se marca como pasado (con la
-- reserva creada) o se descarta.
--
-- Mismo permiso que crear reservas: `reservas_puede_crear()` (20261122143500).
-- Vuelta atrás: supabase/rollbacks/20261122180000_reservas_borradores_manuscritos_ROLLBACK.sql

create table if not exists public.reservas_borradores_manuscritos (
  id uuid primary key default gen_random_uuid(),
  fecha date not null,
  imagen text not null,
  estado text not null default 'pendiente',
  reserva_id uuid references public.reservas(id) on delete set null,
  creado_por uuid default auth.uid(),
  created_at timestamptz not null default now(),
  resuelto_at timestamptz,
  constraint reservas_borradores_manuscritos_estado_valido check (estado in ('pendiente', 'pasado', 'descartado')),
  -- Un PNG de un renglón ronda 30-300 KB; 3 MB de tope para no llenar la tabla por error.
  constraint reservas_borradores_manuscritos_imagen_png check (imagen like 'data:image/png;base64,%' and length(imagen) <= 3000000)
);

comment on table public.reservas_borradores_manuscritos is
  'Reservas escritas a mano en el libro y guardadas sin interpretar; se pasan a limpio después.';

create index if not exists idx_reservas_borradores_pendientes
  on public.reservas_borradores_manuscritos (fecha)
  where estado = 'pendiente';

alter table public.reservas_borradores_manuscritos enable row level security;

drop policy if exists "borradores_manuscritos_ver" on public.reservas_borradores_manuscritos;
create policy "borradores_manuscritos_ver" on public.reservas_borradores_manuscritos
  for select to authenticated using (public.reservas_puede_crear());

drop policy if exists "borradores_manuscritos_crear" on public.reservas_borradores_manuscritos;
create policy "borradores_manuscritos_crear" on public.reservas_borradores_manuscritos
  for insert to authenticated with check (public.reservas_puede_crear() and estado = 'pendiente');

drop policy if exists "borradores_manuscritos_resolver" on public.reservas_borradores_manuscritos;
create policy "borradores_manuscritos_resolver" on public.reservas_borradores_manuscritos
  for update to authenticated using (public.reservas_puede_crear()) with check (public.reservas_puede_crear());

revoke all on public.reservas_borradores_manuscritos from anon;
grant select, insert, update on public.reservas_borradores_manuscritos to authenticated;
