set client_encoding = 'UTF8';
-- ============================================================================
-- ROLLBACK de 20261217100000_telegram_reservas_estado
-- ----------------------------------------------------------------------------
-- Quita los pasos de reserva para Telegram (tabla, trigger y reclamo) y deja avisos_telegram_hay_pendientes como
-- en 20261216100000 (las reservas vuelven a salir de los avisos «Reserva nueva» y «Reserva cancelada» del panel).
-- Antes de aplicarlo, vuelve a desplegar la función avisos-telegram anterior (la nueva lee la tabla).
-- Idempotente. Tiene que terminar en «telegram_reservas_estado ROLLBACK: aplicado».
-- ============================================================================
begin;
set local lock_timeout = '5s';

drop trigger if exists trg_avisos_telegram_reservas on public.reservas;
drop function if exists public.avisos_telegram_reservas_evento();
drop function if exists public.avisos_telegram_reservas_reclamar(integer);

create or replace function public.avisos_telegram_hay_pendientes()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
      from public.notificaciones_dashboard n
      join public.avisos_telegram_config c on c.id
      left join public.reservas r
        on r.id = n.referencia_id and n.referencia_tipo = 'reserva' and n.tipo in ('reserva_nueva', 'reserva_cancelada')
     where (
             n.tipo = any(c.tipos_al_momento)
             or (c.reservas_al_momento
                 and n.tipo in ('reserva_nueva', 'reserva_cancelada')
                 and r.fecha between (now() at time zone 'Europe/Madrid')::date and (now() at time zone 'Europe/Madrid')::date + 1)
           )
       -- 20261216100000: el canal del aviso tiene que tener chat (el suyo o, si no, el general).
       and (case public.avisos_telegram_canal(n.tipo)
              when 'reservas' then coalesce(c.chat_reservas, c.chat_id)
              else coalesce(c.chat_facturas, c.chat_id)
            end) is not null
       and n.created_at > greatest(now() - interval '24 hours', coalesce(c.activo_desde, now()))
       and (n.caduca_en is null or n.caduca_en > now())
       and n.tipo <> 'reserva_sin_asignar'
       and n.tipo not like 'ia\_modelo%'
       and coalesce(n.datos ->> 'campana', 'true') <> 'false'
       and (n.tipo not in ('reserva_nueva', 'reserva_cancelada')
            or (n.tipo = 'reserva_nueva' and r.id is not null and r.estado not in ('pendiente', 'cancelada', 'no_show'))
            or (n.tipo = 'reserva_cancelada' and coalesce(r.cancelada_por, '') <> 'restaurante'))
       and not exists (select 1 from public.avisos_telegram_envios e where e.aviso_id = n.id and e.ok)
       and (select count(*) from public.avisos_telegram_envios e where e.aviso_id = n.id and not e.ok) < 3
  );
$$;
revoke all on function public.avisos_telegram_hay_pendientes() from public, anon, authenticated;
grant execute on function public.avisos_telegram_hay_pendientes() to service_role;

drop table if exists public.avisos_telegram_reservas;

delete from public.avisos_telegram_envios where tipo = 'reserva';
alter table public.avisos_telegram_envios drop constraint if exists avisos_telegram_envios_tipo_check;
alter table public.avisos_telegram_envios add constraint avisos_telegram_envios_tipo_check
  check (tipo in ('aviso', 'resumen', 'prueba', 'pendientes', 'fallo', 'semanal'));

do $$ begin raise notice 'telegram_reservas_estado ROLLBACK: aplicado'; end $$;

commit;
