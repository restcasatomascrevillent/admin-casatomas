set client_encoding = 'UTF8';
-- ===========================================================================
-- 20261106500000_permisos_carta_newsletter — «Editar» para escribir en la
-- CARTA (gestor_carta) y en el NEWSLETTER (marketing). Con solo «Ver», se
-- consulta. Decisión del dueño del 06/11/2026.
-- ===========================================================================
--
-- QUÉ CAMBIA (sin tocar ninguna migración ya aplicada; solo políticas y
-- funciones, ni una fila):
--
--   1. Carta. Toda política de public y de storage.objects que hoy escribe (o
--      lee lo que solo usa quien escribe) con can_write_section('gestor_carta')
--      pasa a can_edit_section('gestor_carta') (20261001170000). Hoy, en la
--      demo, son:
--        · Platos, Vinos, Bebidas, Cocteles: insert / update / delete;
--        · historial_ajustes_precios: insert / update / delete (la lectura
--          sigue con can_read_section);
--        · configuracion_web: update (fotos de platos y votación del vino; el
--          menú y las tapas del Gestor Web van por RPC con gestion_web y NO
--          cambian);
--        · trabajos_recorte, trabajos_video: select / insert / delete (la cola
--          de recortes y vídeos solo la usa quien edita la carta);
--        · votos_vino_favorito: select / delete (nombre y contacto de los
--          participantes: solo para quien edita la carta);
--        · storage.objects: carta_imagenes_insert / update / delete (cubos
--          platos, plato, vinos, bebidas, cocteles, carta).
--      Y las funciones que comprueban el permiso ellas mismas (SECURITY
--      DEFINER, saltan la RLS): trabajos_recorte_permiso, trabajos_video_permiso
--      y recorte_servidor_reservar.
--   2. Newsletter. Toda política de public con can_write_section('marketing')
--      FUERA de Instagram pasa a can_edit_section('marketing'): hoy
--      newsletter_envios, campanas_marketing y email_eventos (insert / update /
--      delete). newsletter_suscriptores y newsletter_sincronizaciones_resend no
--      tienen escritura para authenticated: las escriben enviar-newsletter,
--      newsletter-sync-resend, newsletter-baja y resend-webhook con service
--      role. Las del panel (enviar-newsletter, newsletter-sync-resend) piden
--      can_edit_section en su nueva versión.
--      Instagram (tablas instagram_*, marketing_fechas, cubos instagram*,
--      funciones instagram_*) NO se toca: ya va con can_edit_section desde
--      20261111000000.
--   LEER no cambia: can_read_section («Ver») en todo lo que ya lo usaba; la
--   lectura anónima de la carta (webs) tampoco.
--
-- POR QUÉ ASÍ Y NO CAMBIANDO can_write_section()
--   En el repo, can_write_section mira «Ver» (20260918120000) y la usan todas
--   las secciones. En la demo (comprobado el 06/11/2026, solo SELECT) ya mira
--   «Editar»: la cambió una migración aplicada a mano que NO está en el repo
--   (supabase_migrations: 20261002164236 fix_can_write_section_requires_edit_
--   permission). Producción no se ha podido comprobar desde aquí. Cambiar solo
--   las políticas de estas dos secciones (como hizo Instagram) deja la carta y
--   el newsletter con «Editar» sea cual sea la definición de can_write_section,
--   y no toca a nadie más (Gestor Web, Reservas, Facturas…).
--   Se cambia la EXPRESIÓN guardada de cada política (ALTER POLICY) y el texto
--   de cada función (su propia definición, pg_get_functiondef, con la función
--   cambiada): mismos nombres, roles, condiciones, propietario y permisos. Si
--   demo y producción no tienen exactamente el mismo texto, da igual.
--
-- QUIÉN PIERDE QUÉ (demo, 06/11/2026): gestor_carta 4 filas, 3 con «Editar»,
--   ninguna con solo «Ver» → nadie pierde nada en la carta. marketing 2 filas,
--   1 con solo «Ver» y ninguna con «Editar» → en la demo solo los super admins
--   podrán enviar el newsletter. ANTES DE APLICARLA EN PRODUCCIÓN: dar
--   «Editar» en «Gestor Web · Carta» a quien cambia la carta y en «Newsletter»
--   a quien envía newsletters (Usuarios › Permisos). Consulta para verlo:
--     select section_key, user_id, can_view, can_edit from public.user_permissions
--      where section_key in ('gestor_carta', 'marketing') order by 1, 2;
--
-- APLICAR (una a una, nunca `db push`), demo primero (sfonaclosuafvlhutkon);
-- producción (haqmmdfdzzatdnrrcgez) solo tras aceptar el PR y con el «sí»
-- del dueño, y en el mismo momento que las Edge Functions de esta versión
-- (enviar-newsletter, newsletter-sync-resend, extraer-vino-foto,
-- traducir-contenido, notificar-video):
--   npx supabase db query --linked -f supabase/migrations/20261106500000_permisos_carta_newsletter.sql
-- Necesita can_edit_section (20261001170000). Idempotente: aplicarla dos
-- veces no cambia nada. Tiene que terminar en «permisos_carta_newsletter:
-- aplicada». Si la comprobación final falla, no se ha aplicado nada.
-- CANDADOS: ALTER POLICY pide ACCESS EXCLUSIVE durante milisegundos sobre
-- cada tabla y sobre storage.objects; lock_timeout 5 s (si algo largo lo
-- bloquea, falla sin aplicar nada y se reintenta).
-- Deshacer: supabase/rollbacks/20261106500000_permisos_carta_newsletter_ROLLBACK.sql
-- Pruebas: npm run test:permisos-carta-newsletter:db (PGlite).
-- ===========================================================================

begin;
set local lock_timeout = '5s';

-- ─── 0. Comprobaciones previas (no cambian nada) ────────────────────────────
do $$
begin
  if to_regprocedure('public.can_edit_section(text)') is null then
    raise exception 'permisos_carta_newsletter: falta public.can_edit_section(text) (aplica antes 20261001170000_rls_reservas_exige_edicion.sql). No se ha cambiado nada.';
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated')
     and not has_function_privilege('authenticated', 'public.can_edit_section(text)', 'execute') then
    raise exception 'permisos_carta_newsletter: authenticated no puede ejecutar can_edit_section(text). No se ha cambiado nada.';
  end if;
end;
$$;

-- ─── 1. Políticas: can_write_section → can_edit_section ─────────────────────
-- Carta: public y storage, cualquier tabla. Newsletter: solo public y fuera de
-- Instagram. Se cambia SOLO la llamada (y el alias que le pone Postgres al
-- volcarla, para que pg_policies se lea bien).
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
           (p.schemaname = 'public' and p.tablename not like 'instagram\_%' and p.tablename <> 'marketing_fechas') as newsletter
      from pg_policies p
     where p.schemaname in ('public', 'storage')
  loop
    v_qual := r.qual;
    v_check := r.with_check;
    foreach v_seccion in array array['gestor_carta', 'marketing'] loop
      continue when v_seccion = 'marketing' and not r.newsletter;
      v_qual := replace(v_qual, format('can_write_section(%L', v_seccion), format('can_edit_section(%L', v_seccion));
      v_check := replace(v_check, format('can_write_section(%L', v_seccion), format('can_edit_section(%L', v_seccion));
      v_qual := regexp_replace(v_qual, format('(can_edit_section\(%L::text\)) AS can_write_section', v_seccion), '\1 AS can_edit_section', 'g');
      v_check := regexp_replace(v_check, format('(can_edit_section\(%L::text\)) AS can_write_section', v_seccion), '\1 AS can_edit_section', 'g');
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
  raise notice 'permisos_carta_newsletter: % políticas a «Editar»: %', cardinality(v_cambiadas), coalesce(array_to_string(v_cambiadas, ', '), '');
end;
$$;

-- ─── 2. Funciones que comprueban el permiso ellas mismas ────────────────────
-- (trabajos_recorte_permiso, trabajos_video_permiso, recorte_servidor_reservar
-- hoy). Se vuelve a crear cada una con su propia definición y la llamada
-- cambiada: CREATE OR REPLACE conserva propietario, permisos y comentario.
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
       and (strpos(p.prosrc, 'can_write_section(''gestor_carta'')') > 0
            or strpos(p.prosrc, 'can_write_section(''marketing'')') > 0)
  loop
    v_def := pg_get_functiondef(r.oid);
    v_def := replace(v_def, 'can_write_section(''gestor_carta'')', 'can_edit_section(''gestor_carta'')');
    v_def := replace(v_def, 'can_write_section(''marketing'')', 'can_edit_section(''marketing'')');
    execute v_def;
    v_cambiadas := v_cambiadas || r.proname::text;
  end loop;
  raise notice 'permisos_carta_newsletter: % funciones a «Editar»: %', cardinality(v_cambiadas), coalesce(array_to_string(v_cambiadas, ', '), '');
end;
$$;

-- ─── 3. Comprobación final (si algo no ha quedado así, no se aplica nada) ───
do $$
declare
  v_malos text[] := '{}';
  v_lista text;
begin
  select string_agg(format('%s.%s «%s»', schemaname, tablename, policyname), ', ') into v_lista
    from pg_policies
   where schemaname in ('public', 'storage')
     and strpos(coalesce(qual, '') || coalesce(with_check, ''), 'can_write_section(''gestor_carta''') > 0;
  if v_lista is not null then
    v_malos := v_malos || format('políticas de la carta con can_write_section: %s', v_lista);
  end if;

  select string_agg(format('%s.%s «%s»', schemaname, tablename, policyname), ', ') into v_lista
    from pg_policies
   where schemaname = 'public'
     and tablename not like 'instagram\_%' and tablename <> 'marketing_fechas'
     and strpos(coalesce(qual, '') || coalesce(with_check, ''), 'can_write_section(''marketing''') > 0;
  if v_lista is not null then
    v_malos := v_malos || format('políticas del newsletter con can_write_section: %s', v_lista);
  end if;

  select string_agg(p.proname::text, ', ') into v_lista
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname not like 'instagram\_%'
     and (strpos(p.prosrc, 'can_write_section(''gestor_carta'')') > 0 or strpos(p.prosrc, 'can_write_section(''marketing'')') > 0);
  if v_lista is not null then
    v_malos := v_malos || format('funciones con can_write_section: %s', v_lista);
  end if;

  -- Lo que se espera ver, si la tabla existe (en la demo existen todas).
  select string_agg(format('%s «%s»', e.tabla, e.politica), ', ') into v_lista
    from (values
      ('public', 'Platos', 'platos_update_seccion'),
      ('public', 'Vinos', 'vinos_update_seccion'),
      ('public', 'Bebidas', 'bebidas_update_seccion'),
      ('public', 'Cocteles', 'cocteles_update_seccion'),
      ('public', 'newsletter_envios', 'newsletter_envios_insert_seccion'),
      ('storage', 'objects', 'carta_imagenes_insert_seccion')
    ) as e(esquema, tabla, politica)
   where exists (select 1 from pg_policies p where p.schemaname = e.esquema and p.tablename = e.tabla and p.policyname = e.politica)
     and not exists (
       select 1 from pg_policies p
        where p.schemaname = e.esquema and p.tablename = e.tabla and p.policyname = e.politica
          and strpos(coalesce(p.qual, '') || coalesce(p.with_check, ''), 'can_edit_section(') > 0);
  if v_lista is not null then
    v_malos := v_malos || format('políticas sin can_edit_section: %s', v_lista);
  end if;

  if cardinality(v_malos) > 0 then
    raise exception 'permisos_carta_newsletter: comprobación final fallida (%). No se ha aplicado nada.', array_to_string(v_malos, '; ');
  end if;
  raise notice 'permisos_carta_newsletter: aplicada';
end;
$$;

commit;

-- VERIFICACIÓN (solo lectura):
--   select schemaname, tablename, policyname, cmd from pg_policies
--    where coalesce(qual, '') || coalesce(with_check, '') ~ 'can_(write|edit)_section\(''(gestor_carta|marketing)'''
--      and tablename not like 'instagram%' and policyname not like 'ig\_%' and policyname not like 'instagram\_%'
--    order by 1, 2, 3;
--   -- → todas con can_edit_section; ninguna con can_write_section.
--   select proname from pg_proc where prosrc like '%can_edit_section(''gestor_carta'')%' order by 1;
--   -- → recorte_servidor_reservar, trabajos_recorte_permiso, trabajos_video_permiso
