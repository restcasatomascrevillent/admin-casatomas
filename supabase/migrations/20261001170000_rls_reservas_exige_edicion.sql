set client_encoding = 'UTF8';
-- (Primera línea a propósito: psql lanzado desde PowerShell/cmd arranca en
-- WIN1252 y leería mal las tildes de los mensajes.)
-- ===========================================================================
-- ##                                                                       ##
-- ##              NO APLICADA: la aplica el dueño a mano                   ##
-- ##                                                                       ##
-- ##   Escrita el 2026-10-01 contra la definición VIVA de producción       ##
-- ##   (pg_policies, pg_get_functiondef, user_permissions; solo lectura).  ##
-- ##   No se ha ejecutado en ningún sitio. Los pasos del dueño, en orden:  ##
-- ##   al final de esta cabecera (PASOS DEL DUEÑO).                        ##
-- ##   Requisito previo: desplegar ANTES admin-create-user (paso 1).       ##
-- ##                                                                       ##
-- ===========================================================================
--
-- EL PROBLEMA
--
--   Las tres políticas de escritura de `reservas` (reservas_insert_seccion,
--   reservas_update_seccion, reservas_delete_seccion) exigen
--   can_write_section('reservas'), y can_write_section() mira el permiso de
--   VER la sección (has_section_permission(..., 'view')), no el de EDITAR.
--   Por la API, con el JWT de un usuario del panel, quien solo puede ver
--   reservas puede crearlas, cambiarlas y borrarlas. El panel lo bloquea
--   (kanban, «Editar», llegada, Aceptar/Confirmar/Cancelar… exigen
--   can_edit); la base de datos no.
--
-- POR QUÉ ESTABA ASÍ (era a propósito, y el motivo sigue vivo en parte)
--
--   20260918120000_rls_por_permisos_de_seccion.sql, bloques «DECISION SOBRE
--   can_edit» y «PENDIENTE PARA UNA FASE POSTERIOR»: la escritura se ató a
--   'view' porque las 26 filas de user_permissions tenían can_edit = false,
--   el panel escribía `can_edit: false` a pelo en 16 sitios de 5 ficheros
--   (imposible concederlo desde la interfaz) y ningún componente miraba
--   can_edit. Exigir 'edit' habría dejado sin guardar nada a todo no-admin:
--   una caída, no una mejora. El plan escrito: pasar a 'edit' JUNTO con el
--   arreglo del frontend, nunca por separado.
--
--   Estado el 2026-10-01 (medido en producción, solo lectura; puesto al
--   día esa misma noche):
--     · YA se cumple: el panel de reservas exige can_edit para escribir
--       (useCanAccessSection('reservas', 'edit')), salvo «Nueva Reserva»
--       (ver la NOTA al final de PASOS DEL DUEÑO).
--     · YA se cumple también: la pantalla Usuarios enseña «Ver» y «Puede
--       editar» por sección (en Permisos, en el alta y en Configurar roles)
--       y CONSERVA can_edit al guardar; antes lo forzaba a false. Commit
--       «feat(usuarios): conceder y conservar el permiso de edicion por
--       seccion» (be8616e en origin/main), ya en producción de Vercel.
--       Solo un super admin puede cambiar permisos (la RLS de
--       user_permissions solo deja escribir a super admins).
--     · can_edit en `reservas`: al escribir esta migración había 0 filas
--       con can_edit = true (en las 13 secciones); el mismo 2026-10-01 se
--       les dio a los dos usuarios que no son super admin (el `admin` y el
--       `staff`). El paso (2) comprueba que lo siguen teniendo.
--     · admin-create-user: el arreglo que solo deja a un super admin crear
--       usuarios con can_edit (403 a cualquier otro) está en origin/main
--       (5ddff1d), que se commiteó SIN desplegar: paso (1).
--     · Cambió después: el acceso incondicional ya no es el rol `admin`
--       sino la tabla super_admins (20260926060716). Un `admin` que no es
--       super admin se rige por sus filas de user_permissions.
--
-- QUÉ CAMBIA
--
--   1. Función nueva public.can_edit_section(text): la hermana de
--      can_write_section() con 'edit' en vez de 'view'. SECURITY DEFINER,
--      STABLE, search_path vacío, EXECUTE solo para authenticated y
--      service_role (como can_write_section).
--   2. Las tres políticas de escritura de `reservas`, con el MISMO nombre,
--      el mismo rol (`authenticated`) y PERMISSIVE, pasan de
--      can_write_section('reservas') a can_edit_section('reservas'):
--      INSERT en WITH CHECK, UPDATE en USING y WITH CHECK, DELETE en USING.
--
-- QUÉ NO CAMBIA
--
--   · reservas_select_seccion (leer sigue pidiendo 'view') y
--     reservas_service_role.
--   · can_write_section() y can_read_section(): las usan 82 políticas de 29
--     tablas; cambiar la función habría endurecido todas a la vez. Las otras
--     tablas de la sección (solicitudes_pendientes, blacklist, mesas,
--     asignaciones_mesa, asignaciones_mesa_descartadas) siguen con 'view'.
--   · Ni filas, ni grants de la tabla, ni triggers, ni otras funciones.
--   · Las Edge Functions que autorizan con el JWT del usuario y luego
--     escriben con la service role siguen pidiendo 'view':
--     notify-reservation-change (has_section_permission 'view') y
--     emails-reserva /notificar-modificacion (can_write_section). Alinearlas
--     con can_edit_section es un cambio aparte (desplegar funciones).
--
-- A QUIÉN AFECTA (4 usuarios en auth.users el 2026-10-01)
--
--   · 2 super admins: siguen escribiendo (has_section_permission devuelve
--     true para super_admins sin mirar can_edit).
--   · Los otros 2, el `admin` que no es super admin y el `staff`, tenían
--     can_view sin can_edit al escribir esto y habrían PERDIDO la
--     escritura. Desde el 2026-10-01 tienen can_edit en `reservas`: si lo
--     conservan (paso 2), siguen escribiendo. En general, pierde la
--     escritura en `reservas` (y sigue leyendo) quien tenga can_view sin
--     can_edit el día que se aplique.
--   · En el panel, para quien no tenga can_edit casi todo ya sale
--     deshabilitado. Al escribir esta migración, lo que escribía en
--     `reservas` SIN mirar can_edit era:
--       - «Nueva Reserva» (src/pages/Reservas.tsx). Arreglado el
--         2026-10-01 en el commit del panel (llega a producción con el
--         despliegue de Vercel): sin can_edit el botón sale deshabilitado
--         y explica por qué. «Convertir en reserva» ya lo miraba
--         (deshabilitado en la fila de la Lista; oculto en la tarjeta de
--         móvil y en «Gestionar»). Si aun así la RLS rechaza un alta
--         (42501), el panel dice «No tienes permiso para crear reservas.
--         Pide a un super admin que te dé «Puede editar» en Reservas.».
--       - La estrella de la Lista, hasta 8c8ace2 (refactor de la Lista).
--         8c8ace2 ya está desplegado: sale deshabilitada sin permiso,
--         igual que «Verificar» y «Lista negra».
--     «Lista negra» escribe en `blacklist`, no en `reservas`: no cambia.
--   · fn_aceptar_propuesta_solicitud (SECURITY INVOKER) inserta en
--     `reservas` con los permisos de quien la llama: desde el panel
--     («Registrar que aceptó por teléfono», que ya exige can_edit) pasa a
--     exigir edición; desde emails-reserva (service role), igual que antes.
--
-- A QUIÉN NO AFECTA
--
--   Todo lo que escribe con la service role (rolbypassrls): reservas-web,
--   emails-reserva, notify-reservation-change y los webhooks de
--   restaurante-phone (vapi-webhook.js, el-webhook.js). Los 8 jobs de
--   pg_cron (corren como postgres). Los triggers SECURITY DEFINER de
--   `reservas` (trigger_actualizar_ocupacion,
--   trg_reservas_sincronizar_asignaciones,
--   agregar_suscriptor_al_reservar_consentida, update_reservas_updated_at)
--   y ejecutar_limpieza_gdpr().
--
-- RIESGO
--
--   Las altas con «Nueva Reserva» (48 altas `manual` en los últimos 30
--   días; la tabla no guarda quién las hizo) pasan a exigir can_edit en
--   `reservas`: quien no lo tenga deja de poder darlas. Guardar permisos
--   desde Usuarios ya NO borra can_edit (be8616e), pero un super admin
--   puede quitar «Puede editar» (o «Ver», que lo apaga) desde ahí: por eso
--   el paso (2) va justo antes de aplicar.
--   Y si se aplica sin el paso (1), un `admin` que no es super admin
--   podría, por API directa, crear con la versión vieja de
--   admin-create-user un usuario con can_edit y escribir con él en
--   `reservas`.
--
-- PASOS DEL DUEÑO (en este orden; desde la carpeta adminpanelct y una orden
-- por línea: PowerShell no admite `&&`)
--
--   (1) ANTES de nada, desplegar la Edge Function admin-create-user con el
--       commit «fix(seguridad): admin-create-user solo deja a un super admin
--       conceder edicion» (5ddff1d en origin/main): si algún permiso del
--       alta pide can_edit y quien crea no es super admin, responde 403 sin
--       crear nada. Sin ella, la separación ver/editar de esta migración se
--       salta por API directa (ver RIESGO). Volver a desplegarla, si ya lo
--       estaba, no hace daño:
--         npx supabase functions deploy admin-create-user
--   (2) Comprobar (solo lectura) que quien deba escribir en `reservas` tiene
--       can_edit. El 2026-10-01 ya se les dio a los dos usuarios que no son
--       super admin (`admin` y `staff`): aquí solo se mira que lo conservan.
--         select u.email, ur.role,
--                public.has_section_permission(u.id, 'reservas', 'view') as ve,
--                public.has_section_permission(u.id, 'reservas', 'edit') as edita
--         from auth.users u left join public.user_roles ur on ur.user_id = u.id
--         order by 1;
--         -- ve = true y edita = false -> la pierde (y sigue viendo).
--         -- El 2026-10-01 por la noche salían los 4 con edita = true.
--       Si alguien que deba seguir escribiendo sale con edita = false
--       (decisión del dueño): un super admin le marca «Puede editar» en
--       Reservas desde la pantalla Usuarios (ya se conserva al guardar) y
--       se repite el SELECT hasta que salga con edita = true.
--   (3) Aplicar. Antes, ninguna transacción larga abierta (las políticas
--       toman un candado exclusivo sobre `reservas` hasta el commit):
--         select pid, usename, state, now() - xact_start as abierta_desde
--         from pg_stat_activity
--         where xact_start < now() - interval '1 minute' and pid <> pg_backend_pid();
--         -- -> ninguna fila.
--       Después, a mano y sin registrarla en el historial:
--         npx supabase db query --linked -f supabase/migrations/20261001170000_rls_reservas_exige_edicion.sql
--       NUNCA `supabase db push` (el historial remoto no está al día:
--       volvería a ejecutar las migraciones aplicadas a mano) ni
--       `supabase migration repair` (registrarla suelta lo desordena).
--       Si falla con 55P03 (lock_not_available), no se ha aplicado nada:
--       reintentar al rato. Si aborta con «MIGRACIÓN ABORTADA», alguien ha
--       cambiado las políticas o la función desde el 01/10: no forzar,
--       revisar. Si termina bien, verificar con las consultas del pie
--       (VERIFICACIÓN).
--   (4) Probar (todo dentro de BEGIN … ROLLBACK; no deja nada):
--         npx supabase db query --linked -f supabase/tests/rls_reservas_edicion.sql
--   (5) Si hiciera falta, revertir (deja las políticas exactamente como
--       estaban; aborta sin tocar nada si ya no son ni estas ni las de
--       antes):
--         npx supabase db query --linked -f supabase/rollbacks/20261001170000_rls_reservas_exige_edicion_ROLLBACK.sql
--
--   NOTA, panel (no bloquea esta migración): desde el 2026-10-01 «Nueva
--   Reserva» (src/pages/Reservas.tsx) también exige can_edit: sin él el
--   botón sale deshabilitado y lo explica, y un alta rechazada por la RLS
--   dice «No tienes permiso para crear reservas. Pide a un super admin…».
--   Va en el commit del panel de ese día y llega con el despliegue de
--   Vercel; mientras no esté desplegado, el botón sigue activo y el alta
--   de quien no tenga can_edit falla con «No tienes permiso para crear
--   reservas.».
-- ===========================================================================

begin;

set local lock_timeout = '5s';

-- ---------------------------------------------------------------------------
-- 0) No pisar cambios de terceros. Las cinco políticas de `reservas` tienen
--    que ser las de antes (escritura con can_write_section) o ya las de esta
--    migración (re-ejecución: idempotente). Si existe ya una
--    can_edit_section(text), tiene que ser esta. Si no, se aborta aquí y no
--    se toca nada.
--    Huella: nombre|cmd|permissive|roles|USING|WITH CHECK por política, sin
--    espacios ni «public.» (pg_get_expr lo omite o no según search_path).
-- ---------------------------------------------------------------------------
do $guarda$
declare
  v_huella text;
  v_antes constant text :=
       $h$reservas_delete_seccion|d|permissive|authenticated|can_write_section('reservas'::text)|-$h$
    || ';' || $h$reservas_insert_seccion|a|permissive|authenticated|-|can_write_section('reservas'::text)$h$
    || ';' || $h$reservas_select_seccion|r|permissive|authenticated|can_read_section('reservas'::text)|-$h$
    || ';' || $h$reservas_service_role|*|permissive|service_role|true|true$h$
    || ';' || $h$reservas_update_seccion|w|permissive|authenticated|can_write_section('reservas'::text)|can_write_section('reservas'::text)$h$;
  v_despues constant text :=
       $h$reservas_delete_seccion|d|permissive|authenticated|can_edit_section('reservas'::text)|-$h$
    || ';' || $h$reservas_insert_seccion|a|permissive|authenticated|-|can_edit_section('reservas'::text)$h$
    || ';' || $h$reservas_select_seccion|r|permissive|authenticated|can_read_section('reservas'::text)|-$h$
    || ';' || $h$reservas_service_role|*|permissive|service_role|true|true$h$
    || ';' || $h$reservas_update_seccion|w|permissive|authenticated|can_edit_section('reservas'::text)|can_edit_section('reservas'::text)$h$;
  v_cuerpo text;
begin
  select string_agg(
           p.polname || '|' || p.polcmd::text || '|'
           || case when p.polpermissive then 'permissive' else 'restrictive' end || '|'
           || coalesce((select string_agg(x.rol, ',' order by x.rol collate "C")
                          from (select case when r = 0 then 'public' else r::regrole::text end as rol
                                  from unnest(p.polroles) as r) as x), '') || '|'
           || coalesce(regexp_replace(pg_get_expr(p.polqual, p.polrelid), '\s+|public\.', '', 'g'), '-') || '|'
           || coalesce(regexp_replace(pg_get_expr(p.polwithcheck, p.polrelid), '\s+|public\.', '', 'g'), '-'),
           ';' order by p.polname collate "C")
    into v_huella
    from pg_policy p
   where p.polrelid = 'public.reservas'::regclass;

  if v_huella is distinct from v_antes and v_huella is distinct from v_despues then
    raise exception 'MIGRACIÓN ABORTADA: las políticas de reservas no son ni las del 2026-10-01 ni las de esta migración: alguien las ha cambiado después. No se ha tocado nada. Huella actual: %', v_huella;
  end if;

  if to_regprocedure('public.has_section_permission(uuid,text,text)') is null then
    raise exception 'MIGRACIÓN ABORTADA: no existe public.has_section_permission(uuid, text, text). No se ha tocado nada.';
  end if;

  select btrim(regexp_replace(pr.prosrc, '\s+', ' ', 'g'))
    into v_cuerpo
    from pg_proc pr
   where pr.oid = to_regprocedure('public.can_edit_section(text)');
  if v_cuerpo is not null
     and v_cuerpo <> $c$select public.has_section_permission((select auth.uid()), _section, 'edit')$c$ then
    raise exception 'MIGRACIÓN ABORTADA: ya existe public.can_edit_section(text) con otro cuerpo (%). No se ha tocado nada.', v_cuerpo;
  end if;

  if not (select c.relrowsecurity from pg_class c where c.oid = 'public.reservas'::regclass) then
    raise exception 'MIGRACIÓN ABORTADA: la RLS de public.reservas está apagada; las políticas no servirían de nada. No se ha tocado nada.';
  end if;
end
$guarda$;

-- ---------------------------------------------------------------------------
-- 1) can_edit_section(text): la hermana de can_write_section() con 'edit'.
--    SECURITY DEFINER porque `authenticated` no puede ejecutar
--    has_section_permission() (y no debe: recibe un _user_id cualquiera).
--    Solo mira al usuario actual: (select auth.uid()).
-- ---------------------------------------------------------------------------
create or replace function public.can_edit_section(_section text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.has_section_permission((select auth.uid()), _section, 'edit')
$$;

comment on function public.can_edit_section(text) is
  'RLS: true si el usuario actual puede EDITAR esa sección del panel (can_edit en user_permissions) o es super admin. Hermana de can_write_section(), que sigue mirando can_view. 20261001170000.';

-- Supabase da EXECUTE a anon y a PUBLIC por defecto en las funciones nuevas.
revoke all on function public.can_edit_section(text) from public, anon;
grant execute on function public.can_edit_section(text) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 2) Las tres políticas de escritura de `reservas`, con el mismo nombre.
--    Solo cambia la función: can_write_section -> can_edit_section.
-- ---------------------------------------------------------------------------
drop policy if exists "reservas_insert_seccion" on public.reservas;
create policy "reservas_insert_seccion" on public.reservas
  as permissive
  for insert
  to authenticated
  with check (public.can_edit_section('reservas'));

drop policy if exists "reservas_update_seccion" on public.reservas;
create policy "reservas_update_seccion" on public.reservas
  as permissive
  for update
  to authenticated
  using (public.can_edit_section('reservas'))
  with check (public.can_edit_section('reservas'));

drop policy if exists "reservas_delete_seccion" on public.reservas;
create policy "reservas_delete_seccion" on public.reservas
  as permissive
  for delete
  to authenticated
  using (public.can_edit_section('reservas'));

-- ---------------------------------------------------------------------------
-- 3) Comprobación final, dentro de la misma transacción: si algo no ha
--    quedado exactamente así, se aborta y no queda nada aplicado.
-- ---------------------------------------------------------------------------
do $final$
declare
  v_huella text;
  v_despues constant text :=
       $h$reservas_delete_seccion|d|permissive|authenticated|can_edit_section('reservas'::text)|-$h$
    || ';' || $h$reservas_insert_seccion|a|permissive|authenticated|-|can_edit_section('reservas'::text)$h$
    || ';' || $h$reservas_select_seccion|r|permissive|authenticated|can_read_section('reservas'::text)|-$h$
    || ';' || $h$reservas_service_role|*|permissive|service_role|true|true$h$
    || ';' || $h$reservas_update_seccion|w|permissive|authenticated|can_edit_section('reservas'::text)|can_edit_section('reservas'::text)$h$;
  v_fn constant regprocedure := 'public.can_edit_section(text)'::regprocedure;
  v_def boolean;
  v_vol "char";
  v_owner name;
  v_conf text[];
begin
  select string_agg(
           p.polname || '|' || p.polcmd::text || '|'
           || case when p.polpermissive then 'permissive' else 'restrictive' end || '|'
           || coalesce((select string_agg(x.rol, ',' order by x.rol collate "C")
                          from (select case when r = 0 then 'public' else r::regrole::text end as rol
                                  from unnest(p.polroles) as r) as x), '') || '|'
           || coalesce(regexp_replace(pg_get_expr(p.polqual, p.polrelid), '\s+|public\.', '', 'g'), '-') || '|'
           || coalesce(regexp_replace(pg_get_expr(p.polwithcheck, p.polrelid), '\s+|public\.', '', 'g'), '-'),
           ';' order by p.polname collate "C")
    into v_huella
    from pg_policy p
   where p.polrelid = 'public.reservas'::regclass;

  if v_huella is distinct from v_despues then
    raise exception 'MIGRACIÓN ABORTADA al final: las políticas de reservas no han quedado como se esperaba. No se ha aplicado nada. Huella: %', v_huella;
  end if;

  select pr.prosecdef, pr.provolatile, pg_get_userbyid(pr.proowner), pr.proconfig
    into v_def, v_vol, v_owner, v_conf
    from pg_proc pr
   where pr.oid = v_fn;
  if not v_def or v_vol <> 's' or v_owner <> 'postgres'
     or not exists (select 1 from unnest(v_conf) as c(ajuste) where c.ajuste like 'search_path=%') then
    raise exception 'MIGRACIÓN ABORTADA al final: can_edit_section(text) no ha quedado SECURITY DEFINER + STABLE + search_path fijo con propietario postgres (definer=%, volatilidad=%, propietario=%, config=%). No se ha aplicado nada.', v_def, v_vol, v_owner, v_conf;
  end if;

  if has_function_privilege('anon', v_fn, 'EXECUTE')
     or not has_function_privilege('authenticated', v_fn, 'EXECUTE')
     or not has_function_privilege('service_role', v_fn, 'EXECUTE')
     or not has_function_privilege(v_owner, 'public.has_section_permission(uuid,text,text)'::regprocedure, 'EXECUTE') then
    raise exception 'MIGRACIÓN ABORTADA al final: permisos de can_edit_section(text) inesperados (anon no debe poder ejecutarla; authenticated y service_role sí; su propietario tiene que poder ejecutar has_section_permission). No se ha aplicado nada.';
  end if;
end
$final$;

commit;

-- ===========================================================================
-- VERIFICACIÓN (solo lectura, después de aplicar)
--
--   select policyname, cmd, roles, qual, with_check
--   from pg_policies where schemaname = 'public' and tablename = 'reservas'
--   order by cmd, policyname;
--   -- -> 5 filas: DELETE/INSERT/UPDATE con can_edit_section('reservas'::text),
--   --    SELECT con can_read_section('reservas'::text) y ALL de service_role
--   --    con true.
--
--   select p.oid::regprocedure, p.prosecdef, p.provolatile, p.proconfig, p.proacl
--   from pg_proc p where p.proname = 'can_edit_section';
--   -- -> SECURITY DEFINER, 's', {search_path=""}, ACL sin anon ni PUBLIC.
--
--   select count(*) from auth.users u
--   where public.has_section_permission(u.id, 'reservas', 'edit');
--   -- -> quienes pueden escribir reservas desde el panel (el 2026-10-01: 2,
--   --    los super admins, más los que reciban can_edit en el paso 2).
-- ===========================================================================
