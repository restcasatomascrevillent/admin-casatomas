set client_encoding = 'UTF8';
-- ===========================================================================
-- ##   NO APLICADA: la aplica el dueño a mano (primero en la demo)          ##
-- ##   Bloquear un servicio entero (comida o cena) para la web y el bot,    ##
-- ##   y marcar las reservas de «menú del día».                             ##
-- ===========================================================================
-- 1) `servicios_bloqueados`: una fila = ese día, ese turno, la web y el bot NO
--    admiten reservas («Ese servicio ya no admite reservas online»). Lo lee
--    `reservas-web` (no ofrece horas de ese turno y rechaza /crear con
--    SERVICIO_BLOQUEADO). NO entra en el trigger de aforo a propósito: el
--    panel SÍ puede seguir dando de alta reservas manuales en ese turno.
--    Turno con el mismo criterio que `validar_capacidad_reserva`:
--    comida = hora < 17:00, cena = el resto.
--    RLS y permisos copiados de `salas_cerradas_servicio`: leer con permiso de
--    vista de Reservas, crear/borrar con permiso de edición; anon sin acceso
--    (la web lo consulta a través de la Edge Function con service role).
-- 2) `reservas.menu_del_dia`: la reserva es para el menú del día (martes a
--    jueves, comida, Comedor o Terraza; lo valida `reservas-web`).
--
-- PASOS (desde admin-casatomas/)
--   npx supabase db query --linked -f supabase/migrations/20261122100000_servicios_bloqueados.sql
-- Vuelta atrás: supabase/rollbacks/20261122100000_servicios_bloqueados_ROLLBACK.sql
-- Idempotente: se puede aplicar dos veces.
-- ===========================================================================
begin;
set local lock_timeout = '5s';

create table if not exists public.servicios_bloqueados (
  fecha date not null,
  turno text not null check (turno in ('comida', 'cena')),
  motivo text,
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid(),
  primary key (fecha, turno)
);
comment on table public.servicios_bloqueados is
  'Servicio (fecha + turno) que ya no admite reservas online (web y bot). Las reservas manuales del panel siguen permitidas.';

alter table public.servicios_bloqueados enable row level security;
drop policy if exists servicios_bloqueados_select on public.servicios_bloqueados;
create policy servicios_bloqueados_select on public.servicios_bloqueados
  for select using ((select public.can_read_section('reservas'::text)));
drop policy if exists servicios_bloqueados_insert on public.servicios_bloqueados;
create policy servicios_bloqueados_insert on public.servicios_bloqueados
  for insert with check ((select public.can_write_section('reservas'::text)));
drop policy if exists servicios_bloqueados_delete on public.servicios_bloqueados;
create policy servicios_bloqueados_delete on public.servicios_bloqueados
  for delete using ((select public.can_write_section('reservas'::text)));
revoke all on public.servicios_bloqueados from anon;
grant select, insert, delete on public.servicios_bloqueados to authenticated;

drop trigger if exists trg_auditoria on public.servicios_bloqueados;
create trigger trg_auditoria after insert or update or delete on public.servicios_bloqueados
  for each row execute function public.fn_registrar_auditoria();

-- Tiempo real (el panel ve al momento lo que bloquea otro dispositivo).
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (select 1 from pg_publication_tables
                      where pubname = 'supabase_realtime' and schemaname = 'public'
                        and tablename = 'servicios_bloqueados') then
    alter publication supabase_realtime add table public.servicios_bloqueados;
  end if;
end;
$$;

alter table public.reservas
  add column if not exists menu_del_dia boolean not null default false;
comment on column public.reservas.menu_del_dia is
  'Reserva para el menú del día (martes a jueves, comida, Comedor o Terraza). Lo valida reservas-web.';

commit;
