set client_encoding = 'UTF8';
-- ===========================================================================
-- CT-REM-DB-02 · Mínimo privilegio en las tablas abiertas a cualquier cuenta
-- (remediación 2026-10-30, tarea T4a-DB-AUTHZ, perfil rem-05; decisión D-005)
-- ===========================================================================
--
-- PROBLEMA: las políticas «complete admin access» de 02/2026 (20260208163917,
-- …164112, …164215, …164243) y las de 2025 con `auth.uid() IS NOT NULL` dan a
-- CUALQUIER cuenta con sesión (el mínimo real: staff + dashboard/view que da
-- el trigger de alta) lectura y escritura de ~30 tablas: contenido de la web
-- pública (novedades, menús, tapas, reseñas), PII (sell_users), logs
-- (security_log, rate_limit_log), datos de facturas (consultas_chatbot) y
-- configuración. Lab, persona STAFF: T3b/T3f-T3k/T3p OK (salida t4a-antes.*).
--
-- REGLA (D-005): lectura can_read_section(<sección>), escritura
-- can_write_section(<sección>) (= 'view' hoy; endurecer a 'edit' es DB-03 y lo
-- decide el dueño). Pantallas que solo existen bajo /super-admin/* (App.tsx
-- 107-118, SuperAdminRoute): is_super_admin(). Logs/telemetría sin escritura
-- cliente (ningún consumidor del cliente escribe; las Edge Functions usan
-- service role). Tabla tabla→sección→consumidores: T4a-db-resultado.md.
--
-- LECTURA ANÓNIMA QUE SE CONSERVA (web-casatomas/Touza, grep 30/10):
--   novedades vigentes, menus_diarios, tapas, reseñas publicadas, salas
--   activas; Platos/Vinos/Bebidas/Cocteles, configuracion_web y configBotWeb
--   no se tocan.
--
-- NO SE TOCAN (lectura «abierta» deliberada, sin dato sensible y con
-- consumidores en varias secciones): carta (Platos, Vinos, Bebidas,
-- Cocteles), admin_feature_toggles (menú lateral de todos), configuracion_web,
-- configBotWeb (ya legible por anon vía la migración de web-casatomas).
--
-- HUELLA: aborta si falta alguna política que se espera borrar o si al final
-- queda en una tabla alguna política desconocida (ver el motor). Tablas que
-- types.ts no lista (noticias_hosteleria, chatbot_config, salas) son
-- opcionales: si no existen, se omiten.
--
-- Orden: después de 20261030120000 (DB-04, que activa la RLS de salas/bew) y
-- antes de 20261030140000 (DB-05, que exige que ninguna política TO public
-- use is_admin/is_super_admin: aquí se pasan a TO authenticated las de
-- configuracion_turnos y configuracion_reservas y se borra la de
-- ocupacion_diaria).
--
-- Bloqueos: ACCESS EXCLUSIVE breve (DROP/CREATE POLICY) tabla a tabla dentro
-- de UNA transacción; ninguna reescribe datos. Las más usadas por el panel:
-- novedades, menus_diarios, tapas, planos_espacio, configuracion_turnos,
-- configuracion_reservas. lock_timeout 5 s: si una lectura larga bloquea,
-- falla sin aplicar nada y se reintenta fuera de servicio. Rollback:
-- supabase/rollbacks/20261030130000_rls_minimo_privilegio_tablas_abiertas_ROLLBACK.sql.
-- ===========================================================================

begin;
set local lock_timeout = '5s';

-- ---------------------------------------------------------------------------
-- Motor de políticas (idéntico en las migraciones 20261030100000…140000).
-- Vive en pg_temp: desaparece al cerrar la sesión y no deja nada en el esquema.
-- spec: [{tabla, opcional?, rls?, restrictiva?, borrar[], conservar[],
--         a_authenticated[], crear[{n, cmd, to, using?, check?}], revocar{rol: privs}}]
create or replace function pg_temp.t4a_politicas(p_spec jsonb, p_etiqueta text)
returns void language plpgsql as $motor$
declare
  e jsonb; c jsonb; v_t text; v_rel regclass; v_crear text[]; v_borrar text[]; v_ya boolean;
  v_n text; v_sql text; v_faltan text[] := '{}'; v_sobran text[]; v_permitidas text[];
  v_rol text; v_priv text; v_malos text[] := '{}';
begin
  -- 1) huella previa
  for e in select x from jsonb_array_elements(p_spec) as x loop
    v_t := e->>'tabla';
    v_rel := to_regclass(format('public.%I', v_t));
    if v_rel is null then
      if coalesce((e->>'opcional')::boolean, false) then
        raise notice '% · public.% no existe: se omite', p_etiqueta, v_t; continue;
      end if;
      raise exception 'MIGRACIÓN ABORTADA (%): no existe public.%. No se ha tocado nada.', p_etiqueta, v_t;
    end if;
    select coalesce(array_agg(x->>'n'), '{}') into v_crear from jsonb_array_elements(coalesce(e->'crear', '[]')) x;
    select coalesce(array_agg(x), '{}') into v_borrar from jsonb_array_elements_text(coalesce(e->'borrar', '[]')) x;
    if cardinality(v_crear) > 0 then
      v_ya := not exists (select 1 from unnest(v_crear) n
                           where not exists (select 1 from pg_policy p where p.polrelid = v_rel and p.polname = n));
    else
      v_ya := not exists (select 1 from unnest(v_borrar) n
                           where exists (select 1 from pg_policy p where p.polrelid = v_rel and p.polname = n));
    end if;
    if not v_ya then
      foreach v_n in array v_borrar loop
        if not exists (select 1 from pg_policy p where p.polrelid = v_rel and p.polname = v_n) then
          v_faltan := v_faltan || format('%s: «%s»', v_t, v_n);
        end if;
      end loop;
    end if;
  end loop;
  if cardinality(v_faltan) > 0 then
    raise exception 'MIGRACIÓN ABORTADA (%): faltan políticas que se esperaba encontrar (el estado no es el de Git a0b8d3a; revisar a mano). No se ha tocado nada. Faltan: %',
      p_etiqueta, array_to_string(v_faltan, '; ');
  end if;

  -- 2) aplicar
  for e in select x from jsonb_array_elements(p_spec) as x loop
    v_t := e->>'tabla';
    v_rel := to_regclass(format('public.%I', v_t));
    continue when v_rel is null;
    if coalesce((e->>'rls')::boolean, false) then
      execute format('alter table public.%I enable row level security', v_t);
    end if;
    for v_n in select jsonb_array_elements_text(coalesce(e->'borrar', '[]')) loop
      execute format('drop policy if exists %I on public.%I', v_n, v_t);
    end loop;
    for c in select x from jsonb_array_elements(coalesce(e->'crear', '[]')) as x loop
      execute format('drop policy if exists %I on public.%I', c->>'n', v_t);
      v_sql := format('create policy %I on public.%I as permissive for %s to %s', c->>'n', v_t, c->>'cmd', c->>'to');
      if c ? 'using' then v_sql := v_sql || format(' using (%s)', c->>'using'); end if;
      if c ? 'check' then v_sql := v_sql || format(' with check (%s)', c->>'check'); end if;
      execute v_sql;
    end loop;
    for v_n in select jsonb_array_elements_text(coalesce(e->'a_authenticated', '[]')) loop
      if exists (select 1 from pg_policy p where p.polrelid = v_rel and p.polname = v_n) then
        execute format('alter policy %I on public.%I to authenticated', v_n, v_t);
      end if;
    end loop;
    for v_rol, v_priv in select key, value from jsonb_each_text(coalesce(e->'revocar', '{}')) loop
      execute format('revoke %s on public.%I from %I', v_priv, v_t, v_rol);
    end loop;
    if coalesce((e->>'restrictiva')::boolean, false)
       and to_regprocedure('private.sesion_panel_permitida()') is not null
       and not exists (select 1 from pg_policy p where p.polrelid = v_rel and p.polname = 'acceso_panel_no_bloqueado') then
      execute format('create policy acceso_panel_no_bloqueado on public.%I as restrictive for all to authenticated using ((select private.sesion_panel_permitida())) with check ((select private.sesion_panel_permitida()))', v_t);
    end if;
  end loop;

  -- 3) huella final: en cada tabla solo quedan las políticas conocidas
  for e in select x from jsonb_array_elements(p_spec) as x loop
    v_t := e->>'tabla';
    v_rel := to_regclass(format('public.%I', v_t));
    continue when v_rel is null;
    select coalesce(array_agg(x), '{}') into v_permitidas from (
      select jsonb_array_elements_text(coalesce(e->'conservar', '[]')) x
      union all select jsonb_array_elements_text(coalesce(e->'a_authenticated', '[]'))
      union all select y->>'n' from jsonb_array_elements(coalesce(e->'crear', '[]')) y
      union all select 'acceso_panel_no_bloqueado') s;
    select array_agg(p.polname order by p.polname) into v_sobran
      from pg_policy p where p.polrelid = v_rel and p.polname <> all (v_permitidas);
    if v_sobran is not null then
      v_malos := v_malos || format('%s: %s', v_t, array_to_string(v_sobran, ', '));
    end if;
    if exists (select 1 from pg_policy p
                where p.polrelid = v_rel
                  and p.polname in (select jsonb_array_elements_text(coalesce(e->'a_authenticated', '[]')))
                  and p.polroles <> array['authenticated'::regrole::oid]) then
      v_malos := v_malos || format('%s: política sin pasar a TO authenticated', v_t);
    end if;
    if coalesce((e->>'rls')::boolean, false)
       and not (select relrowsecurity from pg_class where oid = v_rel) then
      v_malos := v_malos || format('%s: RLS apagada', v_t);
    end if;
  end loop;
  if cardinality(v_malos) > 0 then
    raise exception 'MIGRACIÓN ABORTADA al final (%): quedan políticas que esta migración no conoce (una permisiva desconocida reabre el acceso por OR). No se ha aplicado nada. Detalle: %',
      p_etiqueta, array_to_string(v_malos, '; ');
  end if;
end
$motor$;

select pg_temp.t4a_politicas($spec$[
  {"tabla": "novedades",
   "borrar": ["Authenticated users can delete novedades", "Authenticated users can insert novedades",
              "Authenticated users can read novedades", "Authenticated users can update novedades",
              "Usuarios autenticados pueden actualizar novedades", "Usuarios autenticados pueden crear novedades",
              "Usuarios autenticados pueden eliminar novedades", "Usuarios autenticados pueden ver novedades"],
   "conservar": ["Público puede ver novedades activas vigentes"],
   "crear": [
     {"n": "novedades_select_seccion", "cmd": "select", "to": "authenticated", "using": "(select public.can_read_section('gestion_web'))"},
     {"n": "novedades_insert_seccion", "cmd": "insert", "to": "authenticated", "check": "(select public.can_write_section('gestion_web'))"},
     {"n": "novedades_update_seccion", "cmd": "update", "to": "authenticated", "using": "(select public.can_write_section('gestion_web'))", "check": "(select public.can_write_section('gestion_web'))"},
     {"n": "novedades_delete_seccion", "cmd": "delete", "to": "authenticated", "using": "(select public.can_write_section('gestion_web'))"}],
   "revocar": {"anon": "insert, update, delete, truncate", "authenticated": "truncate"}},

  {"tabla": "menus_diarios",
   "borrar": ["Authenticated gestiona menus_diarios"],
   "conservar": ["Lectura publica de menus_diarios"],
   "crear": [
     {"n": "menus_diarios_insert_seccion", "cmd": "insert", "to": "authenticated", "check": "(select public.can_write_section('gestion_web'))"},
     {"n": "menus_diarios_update_seccion", "cmd": "update", "to": "authenticated", "using": "(select public.can_write_section('gestion_web'))", "check": "(select public.can_write_section('gestion_web'))"},
     {"n": "menus_diarios_delete_seccion", "cmd": "delete", "to": "authenticated", "using": "(select public.can_write_section('gestion_web'))"}],
   "revocar": {"anon": "insert, update, delete, truncate", "authenticated": "truncate"}},

  {"tabla": "tapas",
   "borrar": ["Authenticated gestiona tapas"],
   "conservar": ["Lectura publica de tapas"],
   "crear": [
     {"n": "tapas_insert_seccion", "cmd": "insert", "to": "authenticated", "check": "(select public.can_write_section('gestion_web'))"},
     {"n": "tapas_update_seccion", "cmd": "update", "to": "authenticated", "using": "(select public.can_write_section('gestion_web'))", "check": "(select public.can_write_section('gestion_web'))"},
     {"n": "tapas_delete_seccion", "cmd": "delete", "to": "authenticated", "using": "(select public.can_write_section('gestion_web'))"}],
   "revocar": {"anon": "insert, update, delete, truncate", "authenticated": "truncate"}},

  {"tabla": "imagenes_base64",
   "borrar": ["Auth can manage imagenes_base64", "Usuarios autenticados pueden actualizar imágenes",
              "Usuarios autenticados pueden crear imágenes", "Usuarios autenticados pueden eliminar imágenes",
              "Usuarios autenticados pueden ver imágenes"],
   "crear": [
     {"n": "imagenes_base64_select_seccion", "cmd": "select", "to": "authenticated", "using": "(select public.can_read_section('gestion_web'))"},
     {"n": "imagenes_base64_insert_seccion", "cmd": "insert", "to": "authenticated", "check": "(select public.can_write_section('gestion_web'))"},
     {"n": "imagenes_base64_update_seccion", "cmd": "update", "to": "authenticated", "using": "(select public.can_write_section('gestion_web'))", "check": "(select public.can_write_section('gestion_web'))"},
     {"n": "imagenes_base64_delete_seccion", "cmd": "delete", "to": "authenticated", "using": "(select public.can_write_section('gestion_web'))"}],
   "revocar": {"anon": "all", "authenticated": "truncate"}},

  {"tabla": "resenas",
   "borrar": ["Auth can manage resenas", "Usuarios autenticados pueden actualizar reseñas",
              "Usuarios autenticados pueden crear reseñas", "Usuarios autenticados pueden eliminar reseñas",
              "Usuarios autenticados pueden ver reseñas"],
   "conservar": ["Público puede ver reseñas publicadas"],
   "crear": [
     {"n": "resenas_superadmin", "cmd": "all", "to": "authenticated", "using": "(select public.is_super_admin((select auth.uid())))", "check": "(select public.is_super_admin((select auth.uid())))"}],
   "revocar": {"anon": "insert, update, delete, truncate", "authenticated": "truncate"}},

  {"tabla": "config_google_places",
   "borrar": ["Auth can manage config_google_places", "Usuarios autenticados pueden actualizar configuración Google",
              "Usuarios autenticados pueden crear configuración Google", "Usuarios autenticados pueden ver configuración Google"],
   "crear": [
     {"n": "config_google_places_superadmin", "cmd": "all", "to": "authenticated", "using": "(select public.is_super_admin((select auth.uid())))", "check": "(select public.is_super_admin((select auth.uid())))"}],
   "revocar": {"anon": "all", "authenticated": "truncate"}},

  {"tabla": "sell_users",
   "borrar": ["Auth can manage sell_users"],
   "conservar": ["Los usuarios pueden actualizar su propio perfil", "Los usuarios pueden crear su propio perfil", "Los usuarios pueden ver su propio perfil"],
   "crear": [
     {"n": "sell_users_select_superadmin", "cmd": "select", "to": "authenticated", "using": "(select public.is_super_admin((select auth.uid())))"}],
   "revocar": {"anon": "all", "authenticated": "truncate"}},

  {"tabla": "config_redes_sociales", "borrar": ["Auth can manage config_redes_sociales"],
   "conservar": ["Los usuarios pueden actualizar su propia configuración", "Los usuarios pueden eliminar su propia configuración",
                 "Los usuarios pueden insertar su propia configuración", "Los usuarios pueden ver su propia configuración"],
   "revocar": {"anon": "all", "authenticated": "truncate"}},
  {"tabla": "dashboard_config", "borrar": ["Auth can manage dashboard_config"],
   "conservar": ["Usuarios pueden actualizar su propia configuración", "Usuarios pueden crear su propia configuración",
                 "Usuarios pueden eliminar su propia configuración", "Usuarios pueden ver su propia configuración"],
   "revocar": {"anon": "all", "authenticated": "truncate"}},
  {"tabla": "publicaciones_redes", "borrar": ["Auth can manage publicaciones_redes"],
   "conservar": ["Los usuarios pueden actualizar sus propias publicaciones", "Los usuarios pueden crear sus propias publicaciones",
                 "Los usuarios pueden eliminar sus propias publicaciones", "Los usuarios pueden ver sus propias publicaciones"],
   "revocar": {"anon": "all", "authenticated": "truncate"}},
  {"tabla": "estadisticas_redes", "borrar": ["Auth can manage estadisticas_redes"],
   "conservar": ["Los usuarios pueden insertar sus propias estadísticas", "Los usuarios pueden ver sus propias estadísticas"],
   "revocar": {"anon": "all", "authenticated": "truncate"}},
  {"tabla": "favoritos", "borrar": ["Auth can manage favoritos"],
   "conservar": ["Usuarios pueden añadir a favoritos", "Usuarios pueden eliminar de favoritos", "Usuarios pueden ver sus propios favoritos"],
   "revocar": {"anon": "all", "authenticated": "truncate"}},
  {"tabla": "carrito", "borrar": ["Auth can manage carrito"],
   "conservar": ["Usuarios pueden actualizar su carrito", "Usuarios pueden añadir a su carrito",
                 "Usuarios pueden eliminar de su carrito", "Usuarios pueden ver su propio carrito"],
   "revocar": {"anon": "all", "authenticated": "truncate"}},
  {"tabla": "noticias_hosteleria", "opcional": true, "borrar": ["Auth can manage noticias_hosteleria"],
   "conservar": ["Usuarios autenticados pueden ver noticias"],
   "revocar": {"anon": "insert, update, delete, truncate", "authenticated": "insert, update, delete, truncate"}},

  {"tabla": "alertas_stock", "borrar": ["Auth can manage alertas_stock"],
   "conservar": ["Admins pueden gestionar alertas stock", "Admins pueden ver alertas stock"],
   "crear": [{"n": "alertas_stock_superadmin", "cmd": "all", "to": "authenticated", "using": "(select public.is_super_admin((select auth.uid())))", "check": "(select public.is_super_admin((select auth.uid())))"}],
   "revocar": {"anon": "all", "authenticated": "truncate"}},
  {"tabla": "lineas_pedido", "borrar": ["Auth can manage lineas_pedido"],
   "conservar": ["Admins pueden gestionar lineas pedido", "Admins pueden ver lineas pedido"],
   "crear": [{"n": "lineas_pedido_superadmin", "cmd": "all", "to": "authenticated", "using": "(select public.is_super_admin((select auth.uid())))", "check": "(select public.is_super_admin((select auth.uid())))"}],
   "revocar": {"anon": "all", "authenticated": "truncate"}},
  {"tabla": "movimientos_stock", "borrar": ["Auth can manage movimientos_stock"],
   "conservar": ["Admins pueden gestionar movimientos stock", "Admins pueden ver movimientos stock"],
   "crear": [{"n": "movimientos_stock_superadmin", "cmd": "all", "to": "authenticated", "using": "(select public.is_super_admin((select auth.uid())))", "check": "(select public.is_super_admin((select auth.uid())))"}],
   "revocar": {"anon": "all", "authenticated": "truncate"}},
  {"tabla": "BebidasVENTA",
   "borrar": ["Usuarios autenticados pueden actualizar", "Usuarios autenticados pueden eliminar",
              "Usuarios autenticados pueden insertar", "Usuarios autenticados ven todo"],
   "crear": [{"n": "bebidas_venta_superadmin", "cmd": "all", "to": "authenticated", "using": "(select public.is_super_admin((select auth.uid())))", "check": "(select public.is_super_admin((select auth.uid())))"}],
   "revocar": {"anon": "all", "authenticated": "truncate"}},
  {"tabla": "ComidaVENTA",
   "borrar": ["Usuarios autenticados pueden actualizar", "Usuarios autenticados pueden eliminar",
              "Usuarios autenticados pueden insertar", "Usuarios autenticados ven todo"],
   "crear": [{"n": "comida_venta_superadmin", "cmd": "all", "to": "authenticated", "using": "(select public.is_super_admin((select auth.uid())))", "check": "(select public.is_super_admin((select auth.uid())))"}],
   "revocar": {"anon": "all", "authenticated": "truncate"}},

  {"tabla": "bew", "opcional": true, "rls": true, "restrictiva": true,
   "borrar": ["Authenticated users can delete bew", "Authenticated users can insert bew",
              "Authenticated users can read bew", "Authenticated users can update bew"],
   "crear": [
     {"n": "bew_superadmin", "cmd": "all", "to": "authenticated", "using": "(select public.is_super_admin((select auth.uid())))", "check": "(select public.is_super_admin((select auth.uid())))"},
     {"n": "bew_service_role", "cmd": "all", "to": "service_role", "using": "true", "check": "true"}],
   "revocar": {"anon": "all", "authenticated": "truncate"}},
  {"tabla": "salas", "opcional": true, "rls": true, "restrictiva": true,
   "borrar": ["Solo usuarios autenticados pueden actualizar salas", "Solo usuarios autenticados pueden crear salas",
              "Solo usuarios autenticados pueden eliminar salas"],
   "conservar": ["Público puede ver salas activas"],
   "crear": [
     {"n": "salas_select_seccion", "cmd": "select", "to": "authenticated", "using": "(select public.can_read_section('reservas'))"},
     {"n": "salas_insert_seccion", "cmd": "insert", "to": "authenticated", "check": "(select public.can_write_section('reservas'))"},
     {"n": "salas_update_seccion", "cmd": "update", "to": "authenticated", "using": "(select public.can_write_section('reservas'))", "check": "(select public.can_write_section('reservas'))"},
     {"n": "salas_delete_seccion", "cmd": "delete", "to": "authenticated", "using": "(select public.can_write_section('reservas'))"},
     {"n": "salas_service_role", "cmd": "all", "to": "service_role", "using": "true", "check": "true"}],
   "revocar": {"anon": "insert, update, delete, truncate", "authenticated": "truncate"}},

  {"tabla": "ocupacion_diaria",
   "borrar": ["Auth can manage ocupacion_diaria", "Authenticated users can read ocupacion_diaria",
              "Solo usuarios autenticados pueden modificar ocupación", "System can manage ocupacion_diaria"],
   "crear": [{"n": "ocupacion_diaria_select_seccion", "cmd": "select", "to": "authenticated", "using": "(select public.can_read_section('reservas'))"}],
   "revocar": {"anon": "all", "authenticated": "insert, update, delete, truncate"}},
  {"tabla": "planos_espacio",
   "borrar": ["Auth can manage planos_espacio", "Usuarios autenticados pueden actualizar planos",
              "Usuarios autenticados pueden crear planos", "Usuarios autenticados pueden eliminar planos",
              "Usuarios autenticados pueden ver planos"],
   "crear": [
     {"n": "planos_espacio_select_seccion", "cmd": "select", "to": "authenticated", "using": "(select public.can_read_section('reservas'))"},
     {"n": "planos_espacio_insert_seccion", "cmd": "insert", "to": "authenticated", "check": "(select public.can_write_section('reservas'))"},
     {"n": "planos_espacio_update_seccion", "cmd": "update", "to": "authenticated", "using": "(select public.can_write_section('reservas'))", "check": "(select public.can_write_section('reservas'))"},
     {"n": "planos_espacio_delete_seccion", "cmd": "delete", "to": "authenticated", "using": "(select public.can_write_section('reservas'))"}],
   "revocar": {"anon": "all", "authenticated": "truncate"}},
  {"tabla": "configuracion_turnos",
   "borrar": ["Auth can manage configuracion_turnos", "Usuarios autenticados pueden ver configuración de turnos"],
   "a_authenticated": ["Admins pueden actualizar configuración de turnos", "Admins pueden crear configuración de turnos",
                       "Admins pueden eliminar configuración de turnos"],
   "crear": [
     {"n": "configuracion_turnos_select_seccion", "cmd": "select", "to": "authenticated", "using": "((select public.can_read_section('reservas')) or (select public.can_read_section('dashboard')))"},
     {"n": "configuracion_turnos_insert_seccion", "cmd": "insert", "to": "authenticated", "check": "(select public.can_write_section('reservas'))"},
     {"n": "configuracion_turnos_update_seccion", "cmd": "update", "to": "authenticated", "using": "(select public.can_write_section('reservas'))", "check": "(select public.can_write_section('reservas'))"},
     {"n": "configuracion_turnos_delete_seccion", "cmd": "delete", "to": "authenticated", "using": "(select public.can_write_section('reservas'))"}],
   "revocar": {"anon": "all", "authenticated": "truncate"}},
  {"tabla": "configuracion_reservas",
   "borrar": ["Authenticated users can read configuracion_reservas", "Only authenticated can read config"],
   "a_authenticated": ["Admins can manage configuracion_reservas"],
   "crear": [
     {"n": "configuracion_reservas_select_seccion", "cmd": "select", "to": "authenticated", "using": "((select public.can_read_section('reservas')) or (select public.can_read_section('dashboard')))"}],
   "revocar": {"anon": "all", "authenticated": "truncate"}},
  {"tabla": "chatbot_config", "opcional": true,
   "borrar": ["Authenticated users can view chatbot config"],
   "conservar": ["Admins can manage chatbot config"],
   "revocar": {"anon": "all", "authenticated": "truncate"}},

  {"tabla": "security_log",
   "borrar": ["Authenticated users can delete security logs", "Authenticated users can insert security logs",
              "Authenticated users can read security logs", "Authenticated users can update security logs"],
   "conservar": ["Service role can insert security logs"],
   "crear": [{"n": "security_log_select_superadmin", "cmd": "select", "to": "authenticated", "using": "(select public.is_super_admin((select auth.uid())))"}],
   "revocar": {"anon": "all", "authenticated": "insert, update, delete, truncate"}},
  {"tabla": "rate_limit_log",
   "borrar": ["Authenticated users can delete rate limits", "Authenticated users can insert rate limits",
              "Authenticated users can read rate limits", "Authenticated users can update rate limits"],
   "conservar": ["Service role can manage rate limits"],
   "crear": [{"n": "rate_limit_log_select_superadmin", "cmd": "select", "to": "authenticated", "using": "(select public.is_super_admin((select auth.uid())))"}],
   "revocar": {"anon": "all", "authenticated": "insert, update, delete, truncate"}},
  {"tabla": "consultas_chatbot",
   "borrar": ["Authenticated users can delete consultas_chatbot", "Authenticated users can insert consultas_chatbot",
              "Authenticated users can read consultas_chatbot", "Authenticated users can update consultas_chatbot"],
   "crear": [{"n": "consultas_chatbot_select_seccion", "cmd": "select", "to": "authenticated", "using": "(select public.can_read_section('facturas'))"}],
   "revocar": {"anon": "all", "authenticated": "insert, update, delete, truncate"}},
  {"tabla": "usage_events",
   "borrar": ["Authenticated users can read usage_events"],
   "conservar": ["Service role can manage usage_events"],
   "crear": [{"n": "usage_events_select_superadmin", "cmd": "select", "to": "authenticated", "using": "(select public.is_super_admin((select auth.uid())))"}],
   "revocar": {"anon": "all", "authenticated": "insert, update, delete, truncate"}},
  {"tabla": "scope_prices",
   "borrar": ["Authenticated users can read scope_prices"],
   "conservar": ["Service role can manage scope_prices"],
   "crear": [{"n": "scope_prices_select_superadmin", "cmd": "select", "to": "authenticated", "using": "(select public.is_super_admin((select auth.uid())))"}],
   "revocar": {"anon": "all", "authenticated": "insert, update, delete, truncate"}},
  {"tabla": "visitas_producto",
   "borrar": ["Autenticados pueden registrar visitas"],
   "conservar": ["Admins pueden ver visitas"],
   "revocar": {"anon": "all", "authenticated": "insert, update, delete, truncate"}}
]$spec$::jsonb, 'DB-02');

drop function pg_temp.t4a_politicas(jsonb, text);
commit;
