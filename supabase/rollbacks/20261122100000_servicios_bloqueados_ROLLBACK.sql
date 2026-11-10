set client_encoding = 'UTF8';
-- ROLLBACK de 20261122100000_servicios_bloqueados.sql: quita la tabla
-- `servicios_bloqueados` (y con ella su sitio en supabase_realtime, sus
-- políticas y su trigger de auditoría) y la columna `reservas.menu_del_dia`.
-- OJO: se pierden los bloqueos guardados y la marca de menú del día de las
-- reservas. Antes, volver a desplegar la versión anterior de `reservas-web`
-- (la nueva no se cae sin la tabla, pero sí al guardar menu_del_dia = true).
begin;
set local lock_timeout = '5s';

do $$
begin
  if exists (select 1 from pg_publication_tables
              where pubname = 'supabase_realtime' and schemaname = 'public'
                and tablename = 'servicios_bloqueados') then
    alter publication supabase_realtime drop table public.servicios_bloqueados;
  end if;
end;
$$;

drop table if exists public.servicios_bloqueados;
alter table public.reservas drop column if exists menu_del_dia;

commit;
