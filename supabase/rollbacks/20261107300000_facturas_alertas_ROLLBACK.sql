set client_encoding = 'UTF8';
-- Deshace 20261107300000_facturas_alertas. Idempotente.
--   supabase db query --linked -f supabase/rollbacks/20261107300000_facturas_alertas_ROLLBACK.sql
-- Quita el cron, las funciones y los avisos generados (tipos facturas_* de esta migración).
-- Las columnas nuevas (notificaciones_dashboard.clave/caduca_en/datos y
-- configuracion_facturas.alertas) se BORRAN: el panel de esta versión las lee; despliega antes
-- el panel anterior.
begin;
set local lock_timeout = '5s';

select cron.unschedule('facturas-alertas')
 where exists (select 1 from cron.job where jobname = 'facturas-alertas');

delete from public.notificaciones_dashboard
 where tipo in ('facturas_precio_sube', 'facturas_precio_mejor', 'facturas_familia_gasto',
                'facturas_albaran_sin_factura', 'facturas_proveedor_nuevo', 'facturas_importe_inusual',
                'facturas_revision');

drop function if exists public.facturas_alertas_activas(date, date, text);
drop function if exists public.facturas_generar_alertas(date);
drop function if exists public.facturas_alertas_candidatas(date);
drop function if exists public.facturas_alertas_mes(date, boolean);
drop function if exists public.facturas_alertas_num(numeric, int);
drop function if exists public.facturas_alertas_umbrales();

drop index if exists public.notificaciones_dashboard_clave_uq;
drop index if exists public.notificaciones_dashboard_tipo_idx;
alter table public.notificaciones_dashboard
  drop column if exists clave,
  drop column if exists caduca_en,
  drop column if exists datos;

alter table public.configuracion_facturas drop constraint if exists configuracion_facturas_alertas_obj;
alter table public.configuracion_facturas drop column if exists alertas;

commit;

select 'facturas_alertas: deshecha' as resultado;
