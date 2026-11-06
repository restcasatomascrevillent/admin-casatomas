set client_encoding = 'UTF8';
-- ===========================================================================
-- ROLLBACK de 20261106500000_permisos_carta_newsletter — la carta y el
-- newsletter vuelven a escribir con can_write_section (lo que había):
--   · toda política de public y storage.objects con
--     can_edit_section('gestor_carta') vuelve a can_write_section('gestor_carta')
--     (antes de la migración ninguna usaba can_edit_section('gestor_carta'):
--     comprobado en la demo el 06/11/2026);
--   · las del newsletter (newsletter_*, campanas_marketing, email_eventos) con
--     can_edit_section('marketing') vuelven a can_write_section('marketing').
--     Instagram (instagram_*, marketing_fechas, cubos instagram*) NO se toca:
--     su can_edit_section es de 20261111000000 y se queda;
--   · las funciones públicas que no son de Instagram con
--     can_edit_section('gestor_carta' | 'marketing') (trabajos_recorte_permiso,
--     trabajos_video_permiso, recorte_servidor_reservar) vuelven a
--     can_write_section, con su propia definición (propietario y permisos igual).
-- OJO: lo que hagan después depende de can_write_section, que en el repo mira
-- «Ver» y en la demo «Editar» (ver la cabecera de la migración).
-- Las Edge Functions de esta versión (enviar-newsletter, newsletter-sync-resend,
-- extraer-vino-foto, traducir-contenido, notificar-video) siguen pidiendo
-- «Editar»: si se deshace esto, vuelve a desplegar las anteriores.
--
--   npx supabase db query --linked -f supabase/rollbacks/20261106500000_permisos_carta_newsletter_ROLLBACK.sql
-- Idempotente (sin la migración aplicada no cambia nada). Tiene que terminar
-- en «permisos_carta_newsletter: deshecha». lock_timeout 5 s.
-- ===========================================================================

begin;
set local lock_timeout = '5s';

-- ─── 1. Políticas: can_edit_section → can_write_section ─────────────────────
do $$
declare
  r record;
  v_seccion text;
  v_qual text;
  v_check text;
  v_sql text;
  v_cambiadas text[] := '{}';
begin
  for r in
    select p.schemaname, p.tablename, p.policyname, p.qual, p.with_check,
           (p.schemaname = 'public'
            and (p.tablename like 'newsletter\_%' or p.tablename in ('campanas_marketing', 'email_eventos'))) as newsletter
      from pg_policies p
     where p.schemaname in ('public', 'storage')
  loop
    v_qual := r.qual;
    v_check := r.with_check;
    foreach v_seccion in array array['gestor_carta', 'marketing'] loop
      continue when v_seccion = 'marketing' and not r.newsletter;
      v_qual := replace(v_qual, format('can_edit_section(%L', v_seccion), format('can_write_section(%L', v_seccion));
      v_check := replace(v_check, format('can_edit_section(%L', v_seccion), format('can_write_section(%L', v_seccion));
      v_qual := regexp_replace(v_qual, format('(can_write_section\(%L::text\)) AS can_edit_section', v_seccion), '\1 AS can_write_section', 'g');
      v_check := regexp_replace(v_check, format('(can_write_section\(%L::text\)) AS can_edit_section', v_seccion), '\1 AS can_write_section', 'g');
    end loop;
    continue when v_qual is not distinct from r.qual and v_check is not distinct from r.with_check;
    v_sql := format('alter policy %I on %I.%I', r.policyname, r.schemaname, r.tablename);
    if v_qual is not null then
      v_sql := v_sql || ' using (' || v_qual || ')';
    end if;
    if v_check is not null then
      v_sql := v_sql || ' with check (' || v_check || ')';
    end if;
    execute v_sql;
    v_cambiadas := v_cambiadas || format('%s.%s «%s»', r.schemaname, r.tablename, r.policyname);
  end loop;
  raise notice 'permisos_carta_newsletter (rollback): % políticas a can_write_section: %', cardinality(v_cambiadas), coalesce(array_to_string(v_cambiadas, ', '), '');
end;
$$;

-- ─── 2. Funciones ───────────────────────────────────────────────────────────
do $$
declare
  r record;
  v_def text;
  v_cambiadas text[] := '{}';
begin
  for r in
    select p.oid, p.proname
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.prokind = 'f'
       and p.proname not like 'instagram\_%'
       and (strpos(p.prosrc, 'can_edit_section(''gestor_carta'')') > 0
            or strpos(p.prosrc, 'can_edit_section(''marketing'')') > 0)
  loop
    v_def := pg_get_functiondef(r.oid);
    v_def := replace(v_def, 'can_edit_section(''gestor_carta'')', 'can_write_section(''gestor_carta'')');
    v_def := replace(v_def, 'can_edit_section(''marketing'')', 'can_write_section(''marketing'')');
    execute v_def;
    v_cambiadas := v_cambiadas || r.proname::text;
  end loop;
  raise notice 'permisos_carta_newsletter (rollback): % funciones a can_write_section: %', cardinality(v_cambiadas), coalesce(array_to_string(v_cambiadas, ', '), '');
end;
$$;

-- ─── 3. Comprobación ────────────────────────────────────────────────────────
do $$
declare
  v_lista text;
begin
  select string_agg(format('%s.%s «%s»', schemaname, tablename, policyname), ', ') into v_lista
    from pg_policies
   where schemaname in ('public', 'storage')
     and (strpos(coalesce(qual, '') || coalesce(with_check, ''), 'can_edit_section(''gestor_carta''') > 0
          or (schemaname = 'public' and (tablename like 'newsletter\_%' or tablename in ('campanas_marketing', 'email_eventos'))
              and strpos(coalesce(qual, '') || coalesce(with_check, ''), 'can_edit_section(''marketing''') > 0));
  if v_lista is not null then
    raise exception 'permisos_carta_newsletter (rollback): siguen con can_edit_section: %. No se ha deshecho nada.', v_lista;
  end if;
  raise notice 'permisos_carta_newsletter: deshecha';
end;
$$;

commit;
