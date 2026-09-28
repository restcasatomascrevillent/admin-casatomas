-- ===========================================================================
-- ##                                                                       ##
-- ##                          NO APLICADA                                  ##
-- ##                                                                       ##
-- ##   Estado a 2026-09-28: fichero ESCRITO Y LISTO pero SIN APLICAR, a    ##
-- ##   peticion expresa del dueno ("db push ya NO esta bloqueado, pero NO  ##
-- ##   apliques nada sin mi confirmacion"). `supabase db push` funciona:   ##
-- ##   el historial local y el remoto vuelven a coincidir desde el commit  ##
-- ##   e0796e3. Lo que falta es la DECISION del bloque "DECISION           ##
-- ##   PENDIENTE" de mas abajo, no la capacidad de aplicar.                ##
-- ##                                                                       ##
-- ##   TODO lo que se afirma aqui sobre el estado actual SI esta           ##
-- ##   verificado contra produccion (jeamoczmbfsnwkfjxcyo) el 2026-09-28   ##
-- ##   con `supabase db query --linked`: pg_policies, pg_proc,             ##
-- ##   pg_class.relforcerowsecurity, information_schema.role_table_grants, ##
-- ##   super_admins y user_permissions. No hay nada deducido de los        ##
-- ##   ficheros de migrations/.                                            ##
-- ##                                                                       ##
-- ===========================================================================
--
-- ENCARGO (dueno, 2026-09-28)
--
--   "Las tablas `mesas` y `asignaciones_mesa` se quedaron fuera del repaso
--    de permisos por secciones. Cualquier usuario autenticado puede crear,
--    editar y borrar mesas, y asignar mesas a reservas, sin pasar por
--    can_write_section(). En un restaurante eso significa que quien solo
--    deberia consultar puede recolocar el comedor entero."
--
-- ---------------------------------------------------------------------------
-- ESTADO ACTUAL VERIFICADO (pg_policies, 2026-09-28) -- 14 politicas
-- ---------------------------------------------------------------------------
--
--   mesas  (8 politicas: DOS juegos completos y solapados)
--     Authenticated users can read mesas          SELECT authenticated  true
--     Usuarios autenticados pueden ver mesas      SELECT public         auth.uid() IS NOT NULL
--     Authenticated users can insert mesas        INSERT authenticated  true
--     Usuarios autenticados pueden crear mesas    INSERT public         auth.uid() IS NOT NULL
--     Authenticated users can update mesas        UPDATE authenticated  true
--     Usuarios autenticados pueden actualizar...  UPDATE public         auth.uid() IS NOT NULL
--     Authenticated users can delete mesas        DELETE authenticated  true
--     Usuarios autenticados pueden eliminar mesas DELETE public         auth.uid() IS NOT NULL
--
--   asignaciones_mesa  (5 politicas)
--     Auth can manage asignaciones_mesa           ALL    authenticated  true / true
--     Usuarios autenticados pueden ver ...        SELECT public         auth.uid() IS NOT NULL
--     Usuarios autenticados pueden crear ...      INSERT public         auth.uid() IS NOT NULL
--     Usuarios autenticados pueden actualizar ... UPDATE public         auth.uid() IS NOT NULL
--     Usuarios autenticados pueden eliminar ...   DELETE public         auth.uid() IS NOT NULL
--
--   asignaciones_mesa_descartadas  (1 politica)
--     Autenticados leen asignaciones descartadas  SELECT authenticated  true
--
--   El encargo listaba 10 de las 14: faltaban las cuatro de SELECT y UPDATE
--   de `mesas`. Estan incluidas aqui.
--
--   OJO CON EL OR: en PostgreSQL las politicas PERMISSIVE se combinan con OR.
--   Las 14 son permissive (verificado). Anadir una politica estricta NO cierra
--   nada mientras siga viva una que dice `true`. Por eso este fichero las
--   BORRA TODAS antes de crear las nuevas, en vez de taparlas.
--
-- ---------------------------------------------------------------------------
-- POR QUE LA SECCION ES `reservas` -- COMPROBADO, NO SUPUESTO
-- ---------------------------------------------------------------------------
--
--   1. Las secciones vivas del panel estan en src/hooks/useUserRole.tsx:22:
--      dashboard, reservas, gestor_carta, gestion_web, marketing, facturas,
--      usuarios. NO hay seccion `espacios` en el codigo: se retiro al Super
--      Admin (20260925100000_espacios_al_super_admin.sql).
--
--   2. Pero `espacios` SIGUE VIVA como section_key en `user_permissions`
--      (verificado en produccion). La tiene UN solo usuario:
--      pablitocandela15@gmail.com. NO la tienen admin@staff.local ni
--      camarero1@staff.local. Y `can_write_section('espacios')` no lo usa
--      NINGUNA politica hoy (0 de 90 usos de can_*_section en pg_policies).
--      => Colgar el SELECT de `mesas` de `espacios` dejaria a 2 de los 4
--         usuarios sin ver el plano. Descartado.
--
--   3. `espacios_reserva`, la tabla hermana, NO sirve de modelo: esta IGUAL
--      de abierta que `mesas` (9 politicas, `true` y `auth.uid() IS NOT NULL`,
--      con el mismo duplicado de 20260208164215). Es el mismo agujero sin
--      tapar, no un patron. Queda FUERA de este encargo pero conviene
--      apuntarlo: es el siguiente de la lista.
--
--   4. El unico patron bueno es `reservas` (20260918120000):
--        reservas_select_seccion  SELECT authenticated can_read_section('reservas')
--        reservas_insert_seccion  INSERT authenticated can_write_section('reservas')
--        reservas_update_seccion  UPDATE authenticated can_write_section('reservas')
--        reservas_delete_seccion  DELETE authenticated can_write_section('reservas')
--        reservas_service_role    ALL    service_role  true / true
--
--   5. Y es donde vive la UI de verdad: `PlanoEspacio2D.tsx` (asignar mesas Y
--      crear/borrar mesas) se abre desde /reservas, y `GestionMesasEspacios`
--      cuelga de /reservas -> pestana Configuracion.
--
-- ---------------------------------------------------------------------------
-- QUIEN SE QUEDA DENTRO Y QUIEN FUERA (verificado en produccion)
-- ---------------------------------------------------------------------------
--
--   Hay 4 usuarios en auth.users. Los 4 conservan lectura Y escritura:
--
--     miguelbenito2003@gmail.com   super_admins            -> can_*_section = true
--     pablitocandela15@gmail.com   super_admins + reservas -> true
--     admin@staff.local            reservas can_view=true  -> true
--     camarero1@staff.local        reservas can_view=true  -> true
--
--   Usuarios SIN permiso de reservas y sin super_admin: 0. Nadie se queda
--   fuera hoy. El dueno NO se queda bloqueado.
--
--   EL DATO QUE LO EXPLICA -- `can_write_section` MIRA 'view', NO 'edit'.
--   Cuerpo real en produccion:
--
--     can_write_section(_section)
--       -- 'view' A PROPOSITO. Ver el bloque de comentario de arriba.
--       -- Para exigir can_edit: cambiar 'view' por 'edit' aqui, y nada mas.
--       select public.has_section_permission((select auth.uid()), _section, 'view')
--
--   Es deliberado y esta comentado en la propia funcion. Ademas
--   `has_section_permission` devuelve true de entrada si `is_super_admin`.
--
--   CONSECUENCIA INCOMODA QUE HAY QUE DECIR EN VOZ ALTA: con la seccion
--   `reservas`, camarero1@staff.local (rol staff, can_view=true,
--   can_edit=false) SIGUE pudiendo crear y borrar mesas. Es decir, el
--   escenario del encargo -- "quien solo deberia consultar puede recolocar el
--   comedor" -- NO queda cerrado por esta migracion para ese usuario. Lo que
--   si queda cerrado es el acceso de cualquier futuro usuario que no tenga la
--   seccion reservas, y el solape de politicas duplicadas.
--
--   Lo de `SUPER_ADMIN_EMAILS` vacio NO afecta a nada de esto: esa constante
--   solo vive en src/config/permissions.ts (frontend) y es la causa de los 2
--   tests rojos de permissions.test.ts. La ruta de base de datos es
--   `is_super_admin(uuid)`, que lee la TABLA `super_admins` -- y esa tabla
--   TIENE 2 FILAS (verificado). El hook useSuperAdmin.tsx tambien consulta la
--   tabla, no la lista de emails. Los dos caminos que importan funcionan.
--
-- ---------------------------------------------------------------------------
-- DECISION PENDIENTE DEL DUENO -- NO LA TOMA ESTE FICHERO
-- ---------------------------------------------------------------------------
--
--   "Gestionar mesas" (configuracion) y "asignar mesas" (operacion diaria)
--   PODRIAN ir en secciones distintas. Este fichero las pone en la MISMA
--   (`reservas`) porque es la opcion que no rompe nada. La alternativa:
--
--     OPCION A (la que esta escrita abajo): mesas INSERT/DELETE con
--       can_write_section('reservas'). Nadie pierde nada. Pero camarero1
--       conserva crear/borrar mesas (ver arriba).
--
--     OPCION B: mesas INSERT/DELETE solo para super admin, es decir cambiar
--       el predicado de `mesas_insert_seccion` y `mesas_delete_seccion` por
--         (select public.is_super_admin((select auth.uid())))
--       dejando SELECT y UPDATE como estan. Eso SI cierra el escenario del
--       encargo. Precio: `PlanoEspacio2D.tsx` tiene boton "anadir mesa"
--       (linea 2719, `crearMesa.mutateAsync` en 1433) y borrado en 1455, vive
--       en /reservas y NO comprueba permisos -- admin@staff.local y
--       camarero1 verian fallar esos botones. UPDATE se queda en `reservas`
--       a proposito en ambas opciones: renombrar el numero de mesa desde
--       `GestionMesasEspacios` esta deliberadamente FUERA del permiso de
--       super admin (ver su cabecera, lineas 497-505, y sus tests 553-592).
--
--   Cambiar de A a B son DOS lineas, marcadas con "<<< OPCION A/B" abajo.
--
-- ---------------------------------------------------------------------------
-- LO QUE NO SE ROMPE (comprobado uno a uno, no deducido)
-- ---------------------------------------------------------------------------
--
--   * Los 3 triggers SECURITY DEFINER siguen funcionando:
--       trg_asignaciones_mesa_denormalizar  (asignaciones_mesa_denormalizar)
--       trg_reservas_sincronizar_asignaciones
--       trg_mesas_auditar_asignaciones
--     Los 3 son propiedad de `postgres`, que es TAMBIEN el propietario de las
--     tres tablas, y las tres tienen relforcerowsecurity = FALSE (verificado).
--     El propietario de una tabla se salta su RLS mientras no haya FORCE, asi
--     que liberar mesas al cancelar y auditar en `asignaciones_mesa_descartadas`
--     siguen funcionando aunque el que dispara el trigger no tenga permiso.
--     ESTE FICHERO NO ACTIVA FORCE ROW LEVEL SECURITY. Si alguien lo activa
--     algun dia, los tres triggers dejan de escribir EN SILENCIO.
--
--   * La RPC `asignar_mesas_reserva(uuid, uuid[])` es SECURITY INVOKER
--     (prosecdef = false, verificado en pg_proc -- la cabecera de
--     20260926140000 ya lo decia y es cierto). Hace delete+insert sobre
--     `asignaciones_mesa` CON LA RLS DEL QUE LLAMA, asi que depende de
--     `asignaciones_mesa_insert_seccion` y `..._delete_seccion`. Por eso las
--     dos van con can_write_section('reservas'): los 4 usuarios la conservan.
--
--   * Las Edge Functions no tocan estas tablas (se revisaron las 31 de
--     adminpanelct y la de casa-tomas-story). Solo llegan de rebote via
--     UPDATE sobre `reservas` -> trg_reservas_sincronizar_asignaciones, y
--     todas usan SUPABASE_SERVICE_ROLE_KEY (emails-reserva, reservas-web,
--     chat-web). Igual los webhooks de restaurante-phone (el-webhook.js,
--     vapi-webhook.js). Aun asi este fichero crea las politicas
--     `*_service_role` explicitas, como en `reservas`.
--
--   * `vista_asignacion_dia` y `vista_capacidad_espacios` son
--     security_invoker = on (verificado): pasan a respetar la RLS nueva. Los
--     4 usuarios tienen lectura de reservas, asi que siguen devolviendo todo.
--
--   * `alter function ... set search_path`: NO HACE FALTA NINGUNO. Se
--     comprobaron las 6 funciones implicadas (asignar_mesas_reserva,
--     asignaciones_mesa_denormalizar, mesas_auditar_asignaciones,
--     reservas_sincronizar_asignaciones, fn_asignaciones_futuras_de_mesas,
--     update_updated_at_column) y las 4 de permisos (can_read_section,
--     can_write_section, has_section_permission, is_super_admin): las 10
--     tienen ya proconfig = {search_path=public}. No se toca ninguna.
--
-- ---------------------------------------------------------------------------
-- DOS AGUJEROS QUE LA RLS NO TAPA Y QUE ESTA MIGRACION SI CIERRA
-- ---------------------------------------------------------------------------
--
--   1. TRUNCATE. `authenticated` tiene el privilegio TRUNCATE sobre `mesas` y
--      `asignaciones_mesa` (verificado en role_table_grants). TRUNCATE NO
--      pasa por las politicas RLS: por muy cerradas que queden, cualquier
--      autenticado podria vaciar las dos tablas de golpe. Se revoca.
--
--   2. `anon`. `anon` tiene SELECT sobre `mesas` y `asignaciones_mesa`. Hoy no
--      lee nada porque todas las politicas exigen `auth.uid() IS NOT NULL` o
--      son `TO authenticated`, pero el GRANT sigue ahi esperando a la proxima
--      politica descuidada. Ninguna de las webs publicas lee estas tablas
--      (solo aparecen en los types generados). Se revoca, como ya se hizo con
--      `asignaciones_mesa_descartadas` en 20260926140000.
--
--   Nota, fuera de encargo: `reservas` tiene EXACTAMENTE los mismos dos
--   grants (anon SELECT y authenticated TRUNCATE). No se tocan aqui porque
--   `reservas` es de otro encargo y la estan tocando otros agentes.
--
-- ===========================================================================

begin;

-- ---------------------------------------------------------------------------
-- 1) BORRAR LAS 14 POLITICAS VIEJAS
--    Se borran por nombre exacto tal y como salen hoy de pg_policies. El
--    `if exists` es por si alguien se adelanta a mano; no cambia el resultado.
-- ---------------------------------------------------------------------------

-- mesas: juego de 20251207090324 (TO public, auth.uid() IS NOT NULL)
drop policy if exists "Usuarios autenticados pueden ver mesas"        on public.mesas;
drop policy if exists "Usuarios autenticados pueden crear mesas"      on public.mesas;
drop policy if exists "Usuarios autenticados pueden actualizar mesas" on public.mesas;
drop policy if exists "Usuarios autenticados pueden eliminar mesas"   on public.mesas;

-- mesas: juego duplicado de 20260208164215 (TO authenticated, true)
drop policy if exists "Authenticated users can read mesas"   on public.mesas;
drop policy if exists "Authenticated users can insert mesas" on public.mesas;
drop policy if exists "Authenticated users can update mesas" on public.mesas;
drop policy if exists "Authenticated users can delete mesas" on public.mesas;

-- asignaciones_mesa: la abierta del todo (20260208164243) + el juego de 20251207090324
drop policy if exists "Auth can manage asignaciones_mesa"                   on public.asignaciones_mesa;
drop policy if exists "Usuarios autenticados pueden ver asignaciones"       on public.asignaciones_mesa;
drop policy if exists "Usuarios autenticados pueden crear asignaciones"     on public.asignaciones_mesa;
drop policy if exists "Usuarios autenticados pueden actualizar asignaciones" on public.asignaciones_mesa;
drop policy if exists "Usuarios autenticados pueden eliminar asignaciones"  on public.asignaciones_mesa;

-- asignaciones_mesa_descartadas: la lectura abierta de 20260926140000
drop policy if exists "Autenticados leen asignaciones descartadas" on public.asignaciones_mesa_descartadas;

-- ---------------------------------------------------------------------------
-- 2) MESAS -- patron `reservas`
-- ---------------------------------------------------------------------------

create policy mesas_select_seccion
  on public.mesas for select to authenticated
  using ( (select public.can_read_section('reservas')) );

create policy mesas_insert_seccion
  on public.mesas for insert to authenticated
  -- <<< OPCION A. Para la OPCION B, sustituir por:
  --     with check ( (select public.is_super_admin((select auth.uid()))) );
  with check ( (select public.can_write_section('reservas')) );

-- UPDATE se queda en `reservas` en las dos opciones: renombrar el numero de
-- mesa desde GestionMesasEspacios esta fuera del permiso de super admin a
-- proposito (ver su cabecera y sus tests).
create policy mesas_update_seccion
  on public.mesas for update to authenticated
  using      ( (select public.can_write_section('reservas')) )
  with check ( (select public.can_write_section('reservas')) );

create policy mesas_delete_seccion
  on public.mesas for delete to authenticated
  -- <<< OPCION A. Para la OPCION B, sustituir por:
  --     using ( (select public.is_super_admin((select auth.uid()))) );
  using ( (select public.can_write_section('reservas')) );

create policy mesas_service_role
  on public.mesas for all to service_role
  using (true) with check (true);

-- ---------------------------------------------------------------------------
-- 3) ASIGNACIONES_MESA -- patron `reservas`
--    Estas cuatro son las que usa la RPC `asignar_mesas_reserva`, que es
--    SECURITY INVOKER: si se cierran de mas, la asignacion de mesas deja de
--    funcionar para todo el mundo menos service_role.
-- ---------------------------------------------------------------------------

create policy asignaciones_mesa_select_seccion
  on public.asignaciones_mesa for select to authenticated
  using ( (select public.can_read_section('reservas')) );

create policy asignaciones_mesa_insert_seccion
  on public.asignaciones_mesa for insert to authenticated
  with check ( (select public.can_write_section('reservas')) );

create policy asignaciones_mesa_update_seccion
  on public.asignaciones_mesa for update to authenticated
  using      ( (select public.can_write_section('reservas')) )
  with check ( (select public.can_write_section('reservas')) );

create policy asignaciones_mesa_delete_seccion
  on public.asignaciones_mesa for delete to authenticated
  using ( (select public.can_write_section('reservas')) );

create policy asignaciones_mesa_service_role
  on public.asignaciones_mesa for all to service_role
  using (true) with check (true);

-- ---------------------------------------------------------------------------
-- 4) ASIGNACIONES_MESA_DESCARTADAS -- solo lectura por seccion
--    Es una tabla de auditoria: `authenticated` NO tiene (ni debe tener)
--    INSERT/UPDATE/DELETE -- ya se le revocaron en 20260926140000. Quien
--    escribe es `trg_mesas_auditar_asignaciones` /
--    `trg_reservas_sincronizar_asignaciones`, que son SECURITY DEFINER de
--    `postgres` y se saltan la RLS por ser el propietario de la tabla. Por eso
--    aqui NO se crea ninguna politica de escritura para authenticated: seria
--    inutil y confundiria.
-- ---------------------------------------------------------------------------

create policy asignaciones_mesa_descartadas_select_seccion
  on public.asignaciones_mesa_descartadas for select to authenticated
  using ( (select public.can_read_section('reservas')) );

create policy asignaciones_mesa_descartadas_service_role
  on public.asignaciones_mesa_descartadas for all to service_role
  using (true) with check (true);

-- ---------------------------------------------------------------------------
-- 5) LOS DOS AGUJEROS QUE LA RLS NO TAPA (ver cabecera)
-- ---------------------------------------------------------------------------

-- 5a) TRUNCATE no pasa por RLS. Sin esto, todo lo de arriba es decorativo
--     para quien sepa mandar un TRUNCATE.
revoke truncate on public.mesas                         from authenticated;
revoke truncate on public.asignaciones_mesa             from authenticated;
revoke truncate on public.asignaciones_mesa_descartadas from authenticated;

-- 5b) `anon` no pinta nada en estas tablas. Ninguna web publica las lee.
revoke all on public.mesas             from anon;
revoke all on public.asignaciones_mesa from anon;

commit;

-- ===========================================================================
-- VERIFICACION (ejecutar A MANO DESPUES del push; no forma parte de la
-- migracion). Comprueba el resultado contra el catalogo, no contra este SQL.
-- ===========================================================================
--
-- -- 1) Las 12 politicas nuevas y NINGUNA de las 14 viejas:
-- select tablename, policyname, cmd, roles::text,
--        coalesce(qual,'-') as using_expr, coalesce(with_check,'-') as check_expr
-- from pg_policies
-- where schemaname = 'public'
--   and tablename in ('mesas','asignaciones_mesa','asignaciones_mesa_descartadas')
-- order by tablename, cmd, policyname;
--   -- esperado: 12 filas, todas con nombre `*_seccion` o `*_service_role`.
--   --   mesas                         5 (select/insert/update/delete + service_role)
--   --   asignaciones_mesa             5
--   --   asignaciones_mesa_descartadas 2 (select + service_role)
--   -- y NINGUNA con `true` como qual salvo las tres de service_role.
--
-- -- 2) Que no queda ni una politica abierta a `public`/`anon`:
-- select tablename, policyname, roles::text
-- from pg_policies
-- where schemaname = 'public'
--   and tablename in ('mesas','asignaciones_mesa','asignaciones_mesa_descartadas')
--   and (roles::text like '%public%' or roles::text like '%anon%');
--   -- esperado: 0 filas.
--
-- -- 3) Grants: ni TRUNCATE a authenticated ni nada a anon:
-- select table_name, grantee, string_agg(privilege_type, ',' order by privilege_type)
-- from information_schema.role_table_grants
-- where table_schema = 'public'
--   and table_name in ('mesas','asignaciones_mesa','asignaciones_mesa_descartadas')
--   and grantee in ('anon','authenticated','service_role','public')
-- group by 1,2 order by 1,2;
--   -- esperado: cero filas con grantee='anon'; ninguna fila de authenticated
--   -- que contenga TRUNCATE.
--
-- -- 4) Que los tres triggers siguen pudiendo escribir (FORCE sigue apagado):
-- select c.relname, c.relrowsecurity, c.relforcerowsecurity,
--        pg_get_userbyid(c.relowner) as owner
-- from pg_class c join pg_namespace n on n.oid = c.relnamespace
-- where n.nspname = 'public'
--   and c.relname in ('mesas','asignaciones_mesa','asignaciones_mesa_descartadas');
--   -- esperado en las tres: relrowsecurity = true, relforcerowsecurity = FALSE,
--   --                       owner = postgres.
--   -- Si relforcerowsecurity sale true, los triggers SECURITY DEFINER dejan de
--   -- escribir EN SILENCIO. Es el fallo mas caro de este cambio.
--
-- -- 5) Que la RPC sigue siendo SECURITY INVOKER (si alguien la pasa a DEFINER,
-- --    estas politicas dejan de aplicarsele):
-- select proname, prosecdef, array_to_string(proconfig, ',')
-- from pg_proc where oid = 'public.asignar_mesas_reserva(uuid, uuid[])'::regprocedure;
--   -- esperado: prosecdef = false, proconfig = search_path=public
--
-- -- 6) Los 4 usuarios reales conservan lectura y escritura:
-- select u.email,
--        public.has_section_permission(u.id, 'reservas', 'view') as lee,
--        exists (select 1 from public.super_admins s where s.user_id = u.id) as es_super
-- from auth.users u order by u.email;
--   -- esperado: las 4 filas con lee = true.
--   -- (has_section_permission es SECURITY DEFINER y acepta _user_id, asi que
--   --  esto se puede comprobar sin iniciar sesion como cada uno.)
-- ---------------------------------------------------------------------------
