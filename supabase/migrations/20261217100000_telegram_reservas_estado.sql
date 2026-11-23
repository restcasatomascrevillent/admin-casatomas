set client_encoding = 'UTF8';
-- ============================================================================
-- 20261217100000_telegram_reservas_estado — Telegram › Reservas: cada paso de la reserva (23/11/2026)
-- ----------------------------------------------------------------------------
-- Dueño: «En Telegram solo me ha salido reserva nueva, tiene que salir más información: si es petición, si ya
-- ha sido aceptada, si el usuario la ha confirmado…». Hasta ahora Telegram leía los avisos «Reserva nueva» y
-- «Reserva cancelada» del panel, y la nueva esperaba a que la reserva dejara de estar pendiente: las peticiones
-- por aceptar (justo las que hay que atender) no salían nunca.
--
-- Ahora cada paso de una reserva queda en avisos_telegram_reservas y el grupo de Reservas recibe uno por paso:
--   nueva       al entrar una reserva web o por teléfono (petición, si está pendiente de aceptar)
--   aceptada    pendiente → verificada/confirmada (el restaurante la acepta)
--   confirmada  verificada → confirmada (quien: 'cliente' si es con el enlace del correo o WhatsApp, es decir,
--               sin usuario del panel y con la clave de servicio, igual que 20261212720000; si no, 'restaurante')
--   cancelada   → cancelada (quien: reservas.cancelada_por, que pone trg_reservas_cancelada_por antes)
-- Solo con Telegram activo (no acumula filas si está apagado). La función avisos-telegram los reclama
-- (avisos_telegram_reservas_reclamar, sin duplicados) y los manda con el estado actual de la reserva, sin
-- nombre ni teléfono del cliente.
--
-- 1. Tabla avisos_telegram_reservas (solo service_role; el super admin puede leerla).
-- 2. Trigger trg_avisos_telegram_reservas (AFTER INSERT OR UPDATE OF estado ON reservas). Nunca impide guardar.
-- 3. avisos_telegram_reservas_reclamar(limite): reclama los pendientes (máx. 3 intentos, reclamo de 2 min),
--    solo lo posterior a la activación y de las últimas 24 h; borra lo de más de 90 días.
-- 4. avisos_telegram_hay_pendientes(): los avisos de reserva del panel ya no cuentan (van por la tabla nueva);
--    cuenta los pasos de reserva pendientes si reservas_al_momento y hay chat de Reservas.
-- 5. avisos_telegram_envios.tipo admite 'reserva'.
--
-- APLICAR (nunca `db push`): demo primero (sfonaclosuafvlhutkon), producción (haqmmdfdzzatdnrrcgez) solo con el
-- «sí» del dueño, ANTES de desplegar la función avisos-telegram nueva. Idempotente.
-- Tiene que terminar en «telegram_reservas_estado: aplicada».
-- Deshacer: supabase/rollbacks/20261217100000_telegram_reservas_estado_ROLLBACK.sql
-- Pruebas:  npm run test:telegram-reservas:db (PGlite)
-- ============================================================================
begin;
set local lock_timeout = '5s';

do $$
begin
  if to_regprocedure('public.avisos_telegram_canal(text)') is null then
    raise exception 'telegram_reservas_estado: falta 20261216100000_telegram_canales. No se ha cambiado nada.';
  end if;
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'reservas' and column_name = 'cancelada_por') then
    raise exception 'telegram_reservas_estado: falta reservas.cancelada_por (20261205100200). No se ha cambiado nada.';
  end if;
end;
$$;

-- ─── 1. Pasos de reserva para Telegram ──────────────────────────────────────
create table if not exists public.avisos_telegram_reservas (
  id            bigint generated always as identity primary key,
  reserva_id    uuid not null,
  evento        text not null check (evento in ('nueva', 'aceptada', 'confirmada', 'cancelada')),
  quien         text check (quien is null or quien in ('cliente', 'restaurante')),
  estado        text,
  created_at    timestamptz not null default now(),
  intentos      smallint not null default 0,
  reclamado_en  timestamptz,
  enviado_en    timestamptz,
  ultimo_error  text
);
comment on table public.avisos_telegram_reservas is
  'Pasos de cada reserva para el grupo de Reservas de Telegram (20261217100000): nueva, aceptada, confirmada (por el cliente o el restaurante) y cancelada. Los escribe trg_avisos_telegram_reservas; los manda la función avisos-telegram.';

create index if not exists avisos_telegram_reservas_pendientes_idx on public.avisos_telegram_reservas (created_at) where enviado_en is null;
create index if not exists avisos_telegram_reservas_reserva_idx on public.avisos_telegram_reservas (reserva_id);

alter table public.avisos_telegram_reservas enable row level security;
revoke all on public.avisos_telegram_reservas from public, anon, authenticated;
grant select on public.avisos_telegram_reservas to authenticated;
grant all on public.avisos_telegram_reservas to service_role;

drop policy if exists avisos_telegram_reservas_select on public.avisos_telegram_reservas;
create policy avisos_telegram_reservas_select on public.avisos_telegram_reservas for select to authenticated
  using ( (select public.is_super_admin((select auth.uid()))) );
drop policy if exists avisos_telegram_reservas_service on public.avisos_telegram_reservas;
create policy avisos_telegram_reservas_service on public.avisos_telegram_reservas for all to service_role using (true) with check (true);

-- ─── 2. Trigger: un paso por cambio de estado ───────────────────────────────
create or replace function public.avisos_telegram_reservas_evento()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_evento   text;
  v_quien    text;
  v_uid      uuid;
  v_servicio boolean;
begin
  begin
    -- Con Telegram apagado no se apunta nada (no se acumulan filas que nunca se van a mandar).
    if not exists (select 1 from public.avisos_telegram_config c where c.id and c.activo) then
      return null;
    end if;
    v_uid := (select auth.uid());
    v_servicio := coalesce((select auth.role()), '') = 'service_role';
    if tg_op = 'INSERT' then
      -- Las que entran solas (web, teléfono). Las del panel (manual, presencial) las ha puesto alguien del equipo.
      if coalesce(new.canal, '') not in ('web', 'telefono') or new.estado = 'cancelada' then
        return null;
      end if;
      v_evento := 'nueva';
    elsif new.estado is distinct from old.estado then
      if new.estado = 'cancelada' then
        v_evento := 'cancelada';
        v_quien := new.cancelada_por;
      elsif old.estado = 'pendiente' and new.estado in ('verificada', 'confirmada') then
        v_evento := 'aceptada';
        v_quien := case when v_uid is not null then 'restaurante' end;
      elsif old.estado = 'verificada' and new.estado = 'confirmada' then
        v_evento := 'confirmada';
        -- Misma regla que «Confirmada por el cliente» (20261212720000): sin usuario del panel y con la clave de servicio.
        v_quien := case when v_uid is null and v_servicio then 'cliente' else 'restaurante' end;
      else
        return null;
      end if;
    else
      return null;
    end if;
    insert into public.avisos_telegram_reservas (reserva_id, evento, quien, estado)
    values (new.id, v_evento, v_quien, new.estado);
  exception when others then
    -- Un aviso nunca debe impedir guardar la reserva.
    raise warning 'avisos_telegram_reservas_evento: %', sqlerrm;
  end;
  return null;
end;
$$;
revoke all on function public.avisos_telegram_reservas_evento() from public, anon, authenticated;

drop trigger if exists trg_avisos_telegram_reservas on public.reservas;
create trigger trg_avisos_telegram_reservas after insert or update of estado on public.reservas
  for each row execute function public.avisos_telegram_reservas_evento();

-- ─── 3. Reclamo sin duplicados (como fallos_internos_reclamar) ──────────────
create or replace function public.avisos_telegram_reservas_reclamar(p_limite integer default 30)
returns setof public.avisos_telegram_reservas
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from public.avisos_telegram_reservas where created_at < now() - interval '90 days';
  return query
  update public.avisos_telegram_reservas e
     set intentos = e.intentos + 1, reclamado_en = now()
   where e.id in (
     select x.id
       from public.avisos_telegram_reservas x
       join public.avisos_telegram_config c on c.id
      where x.enviado_en is null and x.intentos < 3
        and x.created_at >= greatest(coalesce(c.activo_desde, now()), now() - interval '1 day')
        and (x.reclamado_en is null or x.reclamado_en < now() - interval '2 minutes')
      order by x.created_at, x.id
      limit greatest(1, least(p_limite, 100))
      for update of x skip locked)
  returning e.*;
end;
$$;
revoke all on function public.avisos_telegram_reservas_reclamar(integer) from public, anon, authenticated;
grant execute on function public.avisos_telegram_reservas_reclamar(integer) to service_role;

-- ─── 4. ¿Hay algo por mandar al momento? ────────────────────────────────────
create or replace function public.avisos_telegram_hay_pendientes()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    -- Avisos del panel marcados «al momento» (Facturas y márgenes). Los de reservas ya no: van por avisos_telegram_reservas.
    select 1
      from public.notificaciones_dashboard n
      join public.avisos_telegram_config c on c.id
     where n.tipo = any(c.tipos_al_momento)
       and n.tipo not like 'reserva\_%'
       and (case public.avisos_telegram_canal(n.tipo)
              when 'reservas' then coalesce(c.chat_reservas, c.chat_id)
              else coalesce(c.chat_facturas, c.chat_id)
            end) is not null
       and n.created_at > greatest(now() - interval '24 hours', coalesce(c.activo_desde, now()))
       and (n.caduca_en is null or n.caduca_en > now())
       and n.tipo not like 'ia\_modelo%'
       and coalesce(n.datos ->> 'campana', 'true') <> 'false'
       and not exists (select 1 from public.avisos_telegram_envios e where e.aviso_id = n.id and e.ok)
       and (select count(*) from public.avisos_telegram_envios e where e.aviso_id = n.id and not e.ok) < 3
  ) or exists (
    -- Pasos de reserva por mandar (misma regla que avisos_telegram_reservas_reclamar).
    select 1
      from public.avisos_telegram_reservas x
      join public.avisos_telegram_config c on c.id
     where c.reservas_al_momento
       and coalesce(c.chat_reservas, c.chat_id) is not null
       and x.enviado_en is null and x.intentos < 3
       and x.created_at >= greatest(coalesce(c.activo_desde, now()), now() - interval '1 day')
       and (x.reclamado_en is null or x.reclamado_en < now() - interval '2 minutes')
  );
$$;
revoke all on function public.avisos_telegram_hay_pendientes() from public, anon, authenticated;
grant execute on function public.avisos_telegram_hay_pendientes() to service_role;

-- ─── 5. Registro de envíos: tipo 'reserva' ──────────────────────────────────
alter table public.avisos_telegram_envios drop constraint if exists avisos_telegram_envios_tipo_check;
alter table public.avisos_telegram_envios add constraint avisos_telegram_envios_tipo_check
  check (tipo in ('aviso', 'resumen', 'prueba', 'pendientes', 'fallo', 'semanal', 'reserva'));

do $$ begin raise notice 'telegram_reservas_estado: aplicada'; end $$;

commit;
