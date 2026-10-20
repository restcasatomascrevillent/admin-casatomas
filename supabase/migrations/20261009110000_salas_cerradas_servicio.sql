set client_encoding = 'UTF8';
-- ===========================================================================
-- ##   NO APLICADA: la aplica el dueño a mano                              ##
-- ##   Salas cerradas por servicio («Terraza cerrada» de Organizar).       ##
-- ===========================================================================
-- Una fila = esa sala está cerrada ese día en ese turno: «Organizar servicio»
-- no le asigna nada y recoloca lo que tuviera. Mientras no se aplique, el
-- panel guarda el interruptor solo en este navegador y lo avisa
-- (`src/hooks/useSalaCerradaServicio.ts`).
--
-- PASOS (desde adminpanelct/)
--   npx supabase db query --linked -f supabase/migrations/20261009110000_salas_cerradas_servicio.sql
-- ===========================================================================
begin;
set local lock_timeout = '5s';

create table if not exists public.salas_cerradas_servicio (
  espacio_id uuid not null references public.espacios_reserva(id) on delete cascade,
  fecha date not null,
  turno text not null check (turno in ('comida', 'cena')),
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid(),
  primary key (espacio_id, fecha, turno)
);
comment on table public.salas_cerradas_servicio is
  'Sala cerrada en un servicio (fecha + turno): Organizar servicio no le asigna reservas.';

alter table public.salas_cerradas_servicio enable row level security;
drop policy if exists salas_cerradas_select on public.salas_cerradas_servicio;
create policy salas_cerradas_select on public.salas_cerradas_servicio
  for select using ((select public.can_read_section('reservas'::text)));
drop policy if exists salas_cerradas_insert on public.salas_cerradas_servicio;
create policy salas_cerradas_insert on public.salas_cerradas_servicio
  for insert with check ((select public.can_write_section('reservas'::text)));
drop policy if exists salas_cerradas_delete on public.salas_cerradas_servicio;
create policy salas_cerradas_delete on public.salas_cerradas_servicio
  for delete using ((select public.can_write_section('reservas'::text)));
grant select, insert, delete on public.salas_cerradas_servicio to authenticated;

drop trigger if exists trg_auditoria on public.salas_cerradas_servicio;
create trigger trg_auditoria after insert or update or delete on public.salas_cerradas_servicio
  for each row execute function public.fn_registrar_auditoria();
commit;
