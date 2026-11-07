set client_encoding = 'UTF8';
-- ===========================================================================
-- ROLLBACK de 20261107500000_ia_modelos_centro (Centro de modelos de IA)
-- ===========================================================================
-- Borra el cron, las funciones, la política restrictiva de avisos y las tres
-- tablas. SE PIERDE: el modelo elegido por función y su historial, y la lista
-- de modelos vista (se reconstruye sola con la Edge Function, pero se pierde
-- «primera vez visto»). Copia antes si hace falta:
--   create table public.zz_backup_ia_modelo_funcion as select * from public.ia_modelo_funcion;
--   create table public.zz_backup_ia_modelo_funcion_historial as select * from public.ia_modelo_funcion_historial;
--
-- AVISO: revertir ANTES el código. Las Edge Functions (chat-facturas,
-- clasificar-productos, procesar-factura, ocr-trabajo, chat-web) leen
-- ia_modelo_funcion con _shared/modelo-funcion.ts: sin la tabla NO fallan (usan
-- el secreto o el valor por defecto, con un console.error), pero la pantalla
-- Super Admin › Servicios › Modelos sí (PGRST202). Quitar también la Edge
-- Function ia-modelos-openai.
-- No toca ia_precios (los precios añadidos se quedan) ni los avisos ya creados
-- (hay un delete comentado al final). No toca ia_funciones salvo la fila de
-- ia-modelos-openai, que solo se borra si no tiene uso registrado.
-- ===========================================================================
begin;
set local lock_timeout = '5s';

do $$
begin
  if exists (select 1 from pg_namespace where nspname = 'cron')
     and exists (select 1 from cron.job where jobname = 'ia-modelos-openai') then
    perform cron.unschedule('ia-modelos-openai');
  end if;
end;
$$;

drop function if exists public.ia_modelos_disparar();
drop function if exists public.ia_modelos_centro(integer);
drop function if exists public.ia_modelos_registrar(jsonb);
drop policy if exists notificaciones_ia_modelos_solo_super_admin on public.notificaciones_dashboard;

drop table if exists public.ia_modelo_funcion_historial;
drop table if exists public.ia_modelo_funcion;
drop table if exists public.ia_modelos_disponibles;
drop function if exists public.ia_modelo_funcion_antes();
drop function if exists public.ia_modelo_funcion_historiar();

delete from public.ia_funciones f
 where f.funcion = 'ia-modelos-openai'
   and not exists (select 1 from public.ia_uso u where u.funcion = f.funcion);

-- delete from public.notificaciones_dashboard where tipo like 'ia\_modelo%';

commit;
