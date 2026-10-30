set client_encoding = 'UTF8';
-- (Primera línea a propósito: psql en una consola de Windows puede arrancar
-- en WIN1252 y leer mal las tildes de los mensajes.)
-- ===========================================================================
-- ROLLBACK de supabase/migrations/20261030210000_rls_espacios_reserva_por_seccion.sql
-- ===========================================================================
-- SE EJECUTA A MANO (psql / SQL editor) y solo para deshacer un despliegue que
-- salió mal. NO es una migración: no copiar a supabase/migrations/.
--
-- EFECTO: REABRE espacios_reserva al estado EXACTO previo a la migración
-- (en la demo: las 9 políticas sin sección, con el DELETE abierto a cualquier
-- cuenta). Lo lee de la foto private.rem_t7_espacios_reserva_previo que guardó
-- la migración: políticas (nombre, permisiva/restrictiva, roles, USING, CHECK),
-- RLS y GRANT de anon/authenticated. Después borra la foto.
--
-- Aborta sin tocar nada si no hay foto (la migración no se aplicó aquí, o ya
-- se revirtió). Orden si se revierten varias: esta primero (es la última).
-- ===========================================================================

begin;
set local lock_timeout = '5s';

do $rb$
declare
  v_rel regclass := to_regclass('public.espacios_reserva');
  v_foto record;
  p jsonb;
  v_sql text;
  v_priv text;
  v_rol text;
begin
  if v_rel is null then
    raise exception 'ROLLBACK ABORTADO (T7-ESPACIOS): no existe public.espacios_reserva. No se ha tocado nada.';
  end if;
  if to_regclass('private.rem_t7_espacios_reserva_previo') is null then
    raise exception 'ROLLBACK ABORTADO (T7-ESPACIOS): no existe la foto private.rem_t7_espacios_reserva_previo (¿no se aplicó la migración o ya se revirtió?). No se ha tocado nada.';
  end if;
  select * into v_foto from private.rem_t7_espacios_reserva_previo where id = 1;
  if not found then
    raise exception 'ROLLBACK ABORTADO (T7-ESPACIOS): la foto está vacía. No se ha tocado nada.';
  end if;

  -- políticas: fuera todas las actuales, dentro las de la foto
  for v_sql in select format('drop policy %I on public.espacios_reserva', polname) from pg_policy where polrelid = v_rel loop
    execute v_sql;
  end loop;
  for p in select x from jsonb_array_elements(v_foto.politicas) x loop
    v_sql := format('create policy %I on public.espacios_reserva as %s for %s to %s',
      p->>'n', lower(p->>'permissive'), p->>'cmd',
      (select string_agg(case when r = 'public' then 'public' else quote_ident(r) end, ', ')
         from jsonb_array_elements_text(p->'roles') r));
    if p->>'qual' is not null then v_sql := v_sql || format(' using (%s)', p->>'qual'); end if;
    if p->>'check' is not null then v_sql := v_sql || format(' with check (%s)', p->>'check'); end if;
    execute v_sql;
  end loop;

  -- RLS
  if v_foto.rls then
    execute 'alter table public.espacios_reserva enable row level security';
  else
    execute 'alter table public.espacios_reserva disable row level security';
  end if;

  -- GRANT de anon y authenticated (service_role y el owner no se tocaron)
  foreach v_rol in array array['anon', 'authenticated'] loop
    execute format('revoke all on public.espacios_reserva from %I', v_rol);
    for v_priv in select jsonb_array_elements_text(coalesce(v_foto.grants->v_rol, '[]'::jsonb)) loop
      execute format('grant %s on public.espacios_reserva to %I', v_priv, v_rol);
    end loop;
  end loop;

  drop table private.rem_t7_espacios_reserva_previo;
end
$rb$;

commit;
