-- ROLLBACK de 20261103120000_servicios_contratados.sql (Super Admin › Servicios).
-- Aplicar a mano SOLO si hay que deshacerlo. Borra la configuración de los
-- servicios (plan, precio, límites editados por el dueño) y todo el histórico
-- de lecturas de consumo. No toca ningún secreto ni ninguna otra tabla.
-- La lista de exclusión de auditoría conserva 'servicios_uso' (inofensivo: la
-- tabla ya no existe). Antes, borrar la Edge Function `servicios-uso` o dejarla:
-- sin las tablas responde 503 «sin_migracion» y la pantalla lo explica.
begin;
drop function if exists public.servicios_metricas_supabase();
drop function if exists public.servicios_uso_ultimas();
drop table if exists public.servicios_uso;
drop table if exists public.servicios_contratados;
drop function if exists public.servicios_contratados_al_editar();
drop function if exists public.servicios_limites_validos(jsonb);
commit;
