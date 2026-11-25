set client_encoding = 'UTF8';
-- ROLLBACK de 20261223100000_whatsapp_resenas_y_coste.sql: quita el cron de
-- reseñas, sus funciones, las dos tablas (¡se pierde el registro de WhatsApp
-- enviados y de reseñas pedidas!) y la fila de WhatsApp de Servicios (con sus
-- lecturas guardadas).
-- Antes, volver a desplegar la versión anterior de `whatsapp-reservas` y de
-- `servicios-uso` (la nueva escribe en estas tablas: sin ellas solo avisa en
-- el log, pero /resenas fallaría). Opcional: borrar el secreto de Vault
-- 'whatsapp_resenas_cron_secret'.
begin;

do $$
begin
  if exists (select 1 from pg_namespace where nspname = 'cron') then
    perform cron.unschedule('whatsapp-resenas') where exists (select 1 from cron.job where jobname = 'whatsapp-resenas');
  end if;
end;
$$;

drop function if exists public.whatsapp_resenas_disparar();
drop function if exists public.whatsapp_resenas_hay_trabajo();
drop function if exists public.whatsapp_resena_momento(date, time);
drop table if exists public.whatsapp_resenas;
drop table if exists public.whatsapp_mensajes;

do $$
begin
  if to_regclass('public.servicios_uso') is not null then
    delete from public.servicios_uso where proveedor = 'whatsapp';
  end if;
  if to_regclass('public.servicios_contratados') is not null then
    delete from public.servicios_contratados where proveedor = 'whatsapp';
  end if;
end;
$$;

commit;
