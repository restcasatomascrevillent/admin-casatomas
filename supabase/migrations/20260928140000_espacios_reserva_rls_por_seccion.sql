-- ===========================================================================
-- ##                                                                       ##
-- ##     ESCRITA Y **NO APLICADA**. NO SE HA EJECUTADO EN NINGUN SITIO.     ##
-- ##                                                                       ##
-- ##   Ni en produccion, ni en local (Docker Desktop esta instalado pero    ##
-- ##   APAGADO en esta maquina el 2026-09-28: `supabase db dump` y          ##
-- ##   `supabase start` fallan con "failed to inspect docker image", asi    ##
-- ##   que no hay base local contra la que probarla).                       ##
-- ##                                                                       ##
-- ##   Todo lo que este fichero afirma del estado ACTUAL si esta            ##
-- ##   verificado contra produccion, con SELECT y solo SELECT, via          ##
-- ##   `npx supabase db query --linked -f <fichero> -o csv`.                ##
-- ##                                                                       ##
-- ##   ESPERA EL OK DEL DUENO. Ojo: `supabase db push` YA NO esta           ##
-- ##   bloqueado en este repo (la de ayer, 20260928120000, se aplico asi),  ##
-- ##   de modo que un push la manda A PRODUCCION. Hay ademas una DECISION   ##
-- ##   PENDIENTE marcada mas abajo (OPCION A / B / C).                      ##
-- ##                                                                       ##
-- ===========================================================================
--
-- ENCARGO (dueno, 2026-09-28) -- el agujero hermano del de ayer
--
--   "`espacios_reserva` es el agujero hermano del que se cerro ayer en
--    `mesas`, y esta entrelazado: `mesas.espacio_id` va ON DELETE CASCADE a
--    `espacios_reserva`, asi que quien pueda borrar un espacio se lleva sus
--    mesas y sus asignaciones por delante, saltandose las politicas nuevas."
--
--   Es literal. Ver el apartado del CASCADE mas abajo: la cuenta real es
--   peor que mesas + asignaciones.
--
-- ---------------------------------------------------------------------------
-- ESTADO ACTUAL VERIFICADO (pg_policies, produccion, 2026-09-28) -- 9 POLITICAS
-- ---------------------------------------------------------------------------
--
--   espacios_reserva (9 politicas, TODAS permissive; tres juegos solapados)
--
--     -- juego de 20251114070455 (sin clausula de rol -> roles = {public})
--     Publico puede ver espacios activos                    SELECT public         (activa = true)
--     Solo usuarios autenticados pueden crear espacios      INSERT public         check (auth.uid() IS NOT NULL)
--     Solo usuarios autenticados pueden actualizar espacios UPDATE public         (auth.uid() IS NOT NULL) / idem
--     Solo usuarios autenticados pueden eliminar espacios   DELETE public         (auth.uid() IS NOT NULL)
--
--     -- juego duplicado de 20260208164215 (TO authenticated, true)
--     Authenticated users can read espacios_reserva         SELECT authenticated  true
--     Authenticated users can insert espacios_reserva       INSERT authenticated  check true
--     Authenticated users can update espacios_reserva       UPDATE authenticated  true / true
--     Authenticated users can delete espacios_reserva       DELETE authenticated  true
--
--     -- suelta, de 20260228173300
--     Only authenticated can read espacios                  SELECT authenticated  true
--
--   Ninguna comprueba seccion: 0 de las 9 llaman a can_read_section /
--   can_write_section / is_super_admin.
--
--   OJO CON EL OR: las politicas PERMISSIVE se combinan con OR. Anadir una
--   politica estricta NO cierra nada mientras siga viva una que dice `true`.
--   Por eso este fichero BORRA LAS 9 antes de crear las nuevas.
--
--   El nombre real de la primera lleva tilde en produccion
--   ("Publico" con acento en la u). Los DROP de abajo la escriben CON tilde a
--   proposito: sin ella no borrarian nada y el `if exists` lo taparia en
--   silencio, que es el peor final posible para este fichero.
--
-- ---------------------------------------------------------------------------
-- GRANTS ACTUALES VERIFICADOS (role_table_grants, produccion, 2026-09-28)
-- ---------------------------------------------------------------------------
--
--   espacios_reserva  anon           REFERENCES, SELECT, TRIGGER
--   espacios_reserva  authenticated  DELETE, INSERT, REFERENCES, SELECT,
--                                    TRIGGER, TRUNCATE, UPDATE
--   espacios_reserva  service_role   todo   (y ademas rolbypassrls = true)
--   espacios_reserva  postgres       todo   (rolbypassrls = true, es el owner)
--
--   TRUNCATE ES EL QUE DE VERDAD IMPORTA. **TRUNCATE no pasa por las
--   politicas RLS**: con ese privilegio, cualquier autenticado vacia la tabla
--   de golpe y todo lo de arriba es decorativo. Y hay un agravante propio de
--   esta tabla: `TRUNCATE ... CASCADE` NO respeta el `ON DELETE` de las FK --
--   arrastra TODA tabla que la referencie, incluida `reservas` (376 filas
--   hoy), pase lo que pase en su clausula. Hoy ese CASCADE se atasca de pura
--   suerte, porque ayer se revoco TRUNCATE sobre `mesas` y
--   `asignaciones_mesa` y PostgreSQL exige TRUNCATE en TODAS las tablas que
--   caen. Depender de eso no es un plan. Se revoca.
--
--   `anon` con REFERENCES y TRIGGER no pinta nada y se revoca. **SU SELECT SE
--   QUEDA** (ver el apartado siguiente).
--
-- ---------------------------------------------------------------------------
-- LA LECTURA ANONIMA SE CONSERVA -- ESTO NO ES COMO `mesas`
-- ---------------------------------------------------------------------------
--
--   A `mesas` y `asignaciones_mesa` se les revoco TODO a `anon` ayer. AQUI NO.
--   `espacios_reserva` mantiene la lectura anonima de los espacios ACTIVOS.
--
--   Que se comprobo antes de recortar (no se dedujo):
--
--     * Las dos webs publicas (`casa-tomas-story`, `touza-restaurant-website`)
--       arrancan su cliente con la PUBLISHABLE KEY -> rol `anon`. Se busco
--       `espacios_reserva` en el `src/` de las dos: **no aparece en ninguna
--       consulta**, solo en `src/integrations/supabase/types.ts`, que es el
--       fichero de tipos generado y no ejecuta nada. Las tarjetas de
--       "Espacios" de casa-tomas-story son texto estatico
--       (`EspaciosSection.tsx` -> `t.espacios.cards`), no filas de esta tabla.
--     * Quien SI la lee de verdad lo hace con SERVICE ROLE, que se salta la
--       RLS entera: `restaurante-phone/api/vapi-webhook.js` y `el-webhook.js`
--       (SUPABASE_SERVICE_ROLE_KEY), y las Edge Functions `reservas-web`,
--       `emails-reserva` y `_shared/disponibilidad.ts`.
--     * El unico consumidor con ANON KEY que la toca es el panel viejo de
--       `restaurante-phone/src/features/phone-system/` (`supabaseClient.js`
--       -> `createClient(url, anonKey)`), que hace
--       `.from('reservas').select('*, espacios_reserva(nombre)')`. PostgREST
--       exige SELECT sobre la tabla incrustada para resolver ese join, asi
--       que **si se revocase el SELECT de `anon` ese join pasaria de
--       devolver 0 filas a devolver un 403**.
--
--   Columnas y filas que necesita ese camino: `nombre` de los espacios
--   ACTIVOS. La tabla tiene 8 columnas (id, nombre, descripcion,
--   capacidad_maxima, activa, caracteristicas, created_at, updated_at), 7
--   filas y las 7 activas: nombres de sala, aforo y la marca del negocio en
--   `caracteristicas->>'marca'`. NO hay dato personal ni secreto aqui, asi
--   que NO se hace recorte por columnas: se deja el SELECT de tabla entera y
--   se acota por FILAS con la politica (`activa = true`), exactamente el
--   alcance que ya tiene hoy "Publico puede ver espacios activos". Un espacio
--   desactivado deja de verse desde fuera, hoy y despues.
--
--   (`activa` es `boolean DEFAULT true` pero NULLABLE. `activa = true` deja
--   fuera las filas con NULL, porque una politica solo deja pasar lo que
--   evalua a TRUE. Es el comportamiento de hoy y se conserva tal cual.)
--
-- ---------------------------------------------------------------------------
-- EL CASCADE -- LA VIA INDIRECTA, Y POR QUE ES PEOR DE LO QUE PARECIA
-- ---------------------------------------------------------------------------
--
--   FKs que apuntan a espacios_reserva (pg_constraint, produccion, verificado):
--
--     mesas.espacio_id                            -> ON DELETE CASCADE
--     asignaciones_mesa.espacio_id                -> ON DELETE CASCADE
--     planos_espacio.espacio_id                   -> ON DELETE CASCADE
--     configuracion_turnos.espacio_id             -> ON DELETE CASCADE
--     reservas.espacio_id                         -> ON DELETE SET NULL
--     reservas.espacio_solicitado_id              -> ON DELETE SET NULL
--     solicitudes_pendientes.espacio_propuesto_id -> ON DELETE SET NULL
--
--   El encargo hablaba de mesas y asignaciones. Son CUATRO tablas en cascada,
--   no dos, y ademas tres columnas que se quedan en NULL sin avisar.
--   `reservas.espacio_id` ES NULLABLE (verificado), asi que el SET NULL
--   **no** protege nada: no falla, se limita a desenganchar las reservas de
--   su sala. Hoy: 7 espacios, 20 mesas, 3 planos, 2 turnos, 376 reservas.
--
--   POR QUE LA RLS DE AYER NO LO PARA: las acciones referenciales (el CASCADE
--   y el SET NULL) las ejecutan los triggers internos de integridad, que
--   corren con los derechos del propietario de la tabla hija -- `postgres` --
--   y NO aplican RLS ni comprueban GRANTs. Es decir: las 12 politicas nuevas
--   de `mesas` / `asignaciones_mesa` no se miran siquiera. La UNICA puerta es
--   el DELETE sobre `espacios_reserva`, y hoy esa puerta la abre cualquier
--   autenticado (dos politicas distintas se lo permiten).
--
--   Encima el panel ya borra a mano: `useEliminarEspacio`
--   (src/hooks/useEspaciosReserva.ts:87) borra PRIMERO las mesas por
--   `espacio_id`, luego el plano, y solo al final el espacio. Con la RLS de
--   ayer ese primer paso ya no lo puede dar quien no tenga la seccion
--   `reservas`... pero da igual: si llega al tercer paso, el CASCADE hace el
--   trabajo por el.
--
--   CONCLUSION, PARA QUE CONSTE: **cerrar el DELETE de `espacios_reserva` es
--   suficiente para tapar la via indirecta.** No hace falta tocar `mesas` ni
--   `asignaciones_mesa` otra vez, ni cambiar ninguna FK, ni anadir triggers.
--   Lo que si queda fuera de este encargo y sigue abierto se enumera al
--   final, en "LO QUE ESTE FICHERO NO TAPA".
--
-- ---------------------------------------------------------------------------
-- POR QUE LA SECCION ES `reservas` -- COMPROBADO, NO SUPUESTO
-- ---------------------------------------------------------------------------
--
--   1. Mismo motivo que ayer: las secciones vivas del panel estan en
--      src/hooks/useUserRole.tsx (dashboard, reservas, gestor_carta,
--      gestion_web, marketing, facturas, usuarios). `espacios` sobrevive como
--      section_key en `user_permissions` pero la tiene UN solo usuario
--      (pablitocandela15@gmail.com, que ademas es super admin), asi que
--      colgar de ella la lectura dejaria al resto sin ver las salas.
--      Verificado hoy, no heredado.
--
--   2. `espacios_reserva` la lee MEDIO PANEL, y todo desde reservas:
--      useDisponibilidad, useOcupacionHoy, useOcupacionSalasDia,
--      useConfiguracionTurnos, useDashboardStats y el widget ReservasHoy.
--      Con `can_read_section('reservas')` los cuatro usuarios reales siguen
--      viendolo todo (los 4 tienen la seccion).
--
--      AVISO HONESTO: el widget del Dashboard tambien pasa por aqui. Un
--      futuro usuario con `dashboard` pero SIN `reservas` veria ese widget
--      vacio. Hoy no existe ese usuario. Se deja en una sola seccion a
--      proposito, para no escribir un OR que nadie podria explicar dentro de
--      seis meses.
--
--   3. El patron es el de `reservas` (20260918120000) y el de `mesas`
--      (20260928120000, aplicada ayer). Mismos nombres, mismo estilo.
--
-- ---------------------------------------------------------------------------
-- DECISION PENDIENTE -- OPCION A (escrita) / OPCION B / OPCION C
-- ---------------------------------------------------------------------------
--
--   Ayer, en `mesas`, el dueno eligio "seccion, no super admin", con este
--   criterio: "super admin es solo para mi y para mi companero,
--   desarrolladores que vemos mas cosas; el resto si que puede entrar
--   cualquier usuario autenticado con permisos de secciones". Es decir: super
--   admin = rol de DESARROLLO; operacion del restaurante = secciones.
--
--   Ese criterio, aplicado AQUI, no da la misma respuesta para los tres
--   verbos de escritura, y conviene verlo antes de firmar:
--
--     * Gestionar mesas es OPERACION y su UI vive en /reservas -> seccion.
--     * Gestionar ESPACIOS es CONFIGURACION y su UI **ya es exclusiva del
--       Super Admin desde el 2026-09-25**, por decision del propio dueno
--       (20260925100000_espacios_al_super_admin.sql: "pasa a gestionarse
--       exclusivamente desde el Super Admin"). Verificado en el codigo de
--       hoy: `src/pages/Espacios.tsx` se monta en `/super-admin/espacios` via
--       `paginaSuperAdmin()` -> `SuperAdminRoute` (src/App.tsx:97),
--       `EspacioForm` (crear/editar) NO se importa desde ningun otro sitio, y
--       `useEliminarEspacio` solo lo llama esa pagina.
--
--   Consecuencia practica: poner los tres verbos en `is_super_admin()` NO
--   rompe ni un boton del panel, porque quien no es super admin ni siquiera
--   puede abrir la pantalla.
--
--   LO ESCRITO ABAJO (OPCION A), que es el reparto intermedio:
--     SELECT  authenticated -> can_read_section('reservas')
--     SELECT  anon          -> activa = true
--     INSERT  authenticated -> can_write_section('reservas')    (seccion)
--     UPDATE  authenticated -> can_write_section('reservas')    (seccion)
--     DELETE  authenticated -> is_super_admin(auth.uid())       (SOLO super admin)
--
--   Se aparta UNICAMENTE el DELETE, que es el verbo que dispara el CASCADE y
--   el unico irreversible. INSERT y UPDATE se quedan en la seccion porque son
--   recuperables (crear una sala de mas, renombrar, cambiar aforo o
--   desactivar) y porque asi la regla general sigue siendo la de ayer: la
--   puerta es la seccion.
--
--   OPCION B, si el dueno prefiere coherencia total con la UI: subir tambien
--   INSERT y UPDATE a super admin. Son DOS sitios, marcados "<<< OPCION".
--   No rompe nada hoy (ver arriba). El precio es que si manana alguien saca
--   la gestion de espacios del Super Admin, habra que volver aqui.
--
--   OPCION C, si el dueno quiere la fotocopia exacta de ayer: bajar tambien
--   el DELETE a `can_write_section('reservas')`. Esta marcada igual. AVISO:
--   eso deja a camarero1@staff.local (can_edit = false, el "solo consulta"
--   del encargo de ayer) pudiendo borrar una sala y llevarse por delante sus
--   mesas, sus asignaciones, su plano y sus turnos, y dejar sus reservas sin
--   sala. Es exactamente el agujero que este fichero viene a cerrar.
--
-- ---------------------------------------------------------------------------
-- QUIEN SE QUEDA DENTRO Y QUIEN FUERA (auth.users + user_permissions +
-- super_admins, leido en produccion hoy con SELECT)
-- ---------------------------------------------------------------------------
--
--   Hay 4 usuarios. Ni uno pierde lo que hace hoy:
--
--   email                       super  reservas       lee  escribe  borra
--   --------------------------  -----  -------------  ---  -------  -----
--   miguelbenito2003@gmail.com  SI     (sin filas)    SI   SI       SI
--   pablitocandela15@gmail.com  SI     view=t edit=f  SI   SI       SI
--   admin@staff.local           no     view=t edit=f  SI   SI       NO
--   camarero1@staff.local       no     view=t edit=f  SI   SI       NO
--
--   * El dueno (miguelbenito2003) NO tiene ni una fila en `user_permissions`.
--     Entra por `super_admins`, porque `has_section_permission` devuelve true
--     de entrada si `is_super_admin(_user_id)`. `super_admins` tiene 2 filas
--     (el y pablitocandela15), verificado. La constante SUPER_ADMIN_EMAILS
--     vacia NO pinta nada en la base: vive solo en src/config/permissions.ts.
--     `is_super_admin()` lee la TABLA.
--   * Los 4 dan `has_section_permission(id,'reservas','view') = true`
--     (comprobado uno a uno con la funcion, que es SECURITY DEFINER y acepta
--     _user_id, asi que no hace falta iniciar sesion como cada uno).
--   * `can_read_section` y `can_write_section` son las DOS SECURITY DEFINER y
--     las DOS miran 'view', no 'edit' (cuerpo leido hoy en pg_proc; en
--     can_write_section esta ademas comentado que es a proposito). Ninguna
--     fila de user_permissions tiene can_edit = true. De ahi que los 4
--     escriban.
--   * Quien queda fuera: cualquier autenticado SIN la seccion `reservas` y
--     sin super admin -- hoy, nadie -- y, para BORRAR espacios, los dos
--     usuarios de staff. Que no pueden hacerlo desde el panel de todas
--     formas: la pantalla es de Super Admin.
--
-- ---------------------------------------------------------------------------
-- LO QUE NO SE ROMPE (comprobado uno a uno en produccion, no deducido)
-- ---------------------------------------------------------------------------
--
--   * `validar_capacidad_reserva` es SECURITY **INVOKER** (prosecdef = false)
--     y LEE `espacios_reserva` para el aforo al insertar/actualizar una
--     reserva. Con RLS nueva la lee con los permisos de quien llama, asi que
--     si esa persona no viera la tabla el aforo se calcularia mal Y EN
--     SILENCIO. No pasa: el mismo predicado ('reservas'/'view') abre las dos
--     tablas, de modo que quien puede escribir una reserva puede leer su
--     espacio. Las reservas de la web no van por ahi: entran por la Edge
--     Function `reservas-web` con service_role, que se salta la RLS.
--   * `fn_capacidad_efectiva_marca` es SECURITY DEFINER: no le afecta.
--   * `fn_aceptar_propuesta_solicitud` es SECURITY INVOKER y lee
--     `espacios_reserva`; la usa el panel desde Solicitudes (seccion
--     reservas) -> mismo predicado, sigue funcionando.
--   * `vista_asignacion_dia` y `vista_capacidad_espacios` son
--     security_invoker = on: pasan a respetar la RLS nueva. Los 4 usuarios
--     tienen la seccion, asi que siguen devolviendo todo.
--   * El trigger `update_espacios_reserva_updated_at` es SECURITY DEFINER y
--     es de `postgres`, el propietario de la tabla: sigue escribiendo.
--     relrowsecurity = true y relforcerowsecurity = **FALSE** (verificado).
--     ESTE FICHERO NO ACTIVA FORCE ROW LEVEL SECURITY.
--   * Ninguna politica de ninguna otra tabla menciona `espacios_reserva`
--     (0 filas en pg_policies), asi que cerrarla no rompe la RLS de nadie.
--   * `alter function ... set search_path`: NO HACE FALTA NINGUNO. Las tres
--     funciones que leen la tabla y las cuatro de permisos tienen ya
--     proconfig = {search_path=public}. No se toca ninguna.
--   * service_role tiene rolbypassrls = true, asi que las Edge Functions y
--     los webhooks de VAPI no dependen de nada de esto. Aun asi se crea la
--     politica `*_service_role` explicita, como en `reservas` y en `mesas`.
--
-- ===========================================================================

begin;

-- ---------------------------------------------------------------------------
-- 1) BORRAR LAS 9 POLITICAS VIEJAS
--    Por nombre exacto tal y como salen hoy de pg_policies -- con tilde en
--    "Publico". El `if exists` es por si alguien se adelanta a mano.
-- ---------------------------------------------------------------------------

-- juego de 20251114070455 (rol public)
drop policy if exists "Público puede ver espacios activos"                    on public.espacios_reserva;
drop policy if exists "Solo usuarios autenticados pueden crear espacios"      on public.espacios_reserva;
drop policy if exists "Solo usuarios autenticados pueden actualizar espacios" on public.espacios_reserva;
drop policy if exists "Solo usuarios autenticados pueden eliminar espacios"   on public.espacios_reserva;

-- juego duplicado de 20260208164215 (TO authenticated, true)
drop policy if exists "Authenticated users can read espacios_reserva"   on public.espacios_reserva;
drop policy if exists "Authenticated users can insert espacios_reserva" on public.espacios_reserva;
drop policy if exists "Authenticated users can update espacios_reserva" on public.espacios_reserva;
drop policy if exists "Authenticated users can delete espacios_reserva" on public.espacios_reserva;

-- suelta, de 20260228173300
drop policy if exists "Only authenticated can read espacios" on public.espacios_reserva;

-- Por si la de 20251114070455 se hubiera creado alguna vez sin tilde en otra
-- base (local, branch, db reset). En produccion no existe: no borra nada.
drop policy if exists "Publico puede ver espacios activos" on public.espacios_reserva;

-- ---------------------------------------------------------------------------
-- 2) LECTURA
-- ---------------------------------------------------------------------------

-- 2a) ANONIMA. Se conserva a proposito: la necesitan los consumidores con
--     anon key (ver cabecera). Mismo alcance que hoy: solo espacios activos.
--     NO es `TO public`: `public` incluye a todos los roles y ya no hace
--     falta, porque los autenticados tienen su propia politica aqui debajo.
create policy espacios_reserva_select_anon_activos
  on public.espacios_reserva for select to anon
  using ( activa = true );

-- 2b) AUTENTICADA, por seccion. La lee medio panel (disponibilidad,
--     ocupacion, turnos, dashboard), siempre desde reservas.
create policy espacios_reserva_select_seccion
  on public.espacios_reserva for select to authenticated
  using ( (select public.can_read_section('reservas')) );

-- ---------------------------------------------------------------------------
-- 3) ESCRITURA
-- ---------------------------------------------------------------------------

create policy espacios_reserva_insert_seccion
  on public.espacios_reserva for insert to authenticated
  -- <<< OPCION A (escrita). Para la OPCION B, sustituir por:
  --     with check ( (select public.is_super_admin((select auth.uid()))) );
  with check ( (select public.can_write_section('reservas')) );

create policy espacios_reserva_update_seccion
  on public.espacios_reserva for update to authenticated
  -- <<< OPCION A (escrita). Para la OPCION B, sustituir LAS DOS lineas por:
  --     using      ( (select public.is_super_admin((select auth.uid()))) )
  --     with check ( (select public.is_super_admin((select auth.uid()))) );
  using      ( (select public.can_write_section('reservas')) )
  with check ( (select public.can_write_section('reservas')) );

-- EL DELETE ES EL DEL ENCARGO. Es el que dispara el CASCADE sobre `mesas`,
-- `asignaciones_mesa`, `planos_espacio` y `configuracion_turnos`, y el SET
-- NULL sobre `reservas`. Es el unico verbo irreversible de esta tabla.
create policy espacios_reserva_delete_super_admin
  on public.espacios_reserva for delete to authenticated
  -- <<< OPCION A (escrita). Para la OPCION C -- fotocopia de `mesas` --
  --     sustituir por:
  --       using ( (select public.can_write_section('reservas')) );
  --     y renombrar la politica a espacios_reserva_delete_seccion (hay que
  --     tocar tambien T1 y T7/T8 de supabase/tests/espacios_rls_test.sql).
  --     Leer antes el AVISO de la OPCION C en la cabecera.
  using ( (select public.is_super_admin((select auth.uid()))) );

create policy espacios_reserva_service_role
  on public.espacios_reserva for all to service_role
  using (true) with check (true);

-- ---------------------------------------------------------------------------
-- 4) LOS GRANTS -- LO QUE LA RLS NO CUBRE
-- ---------------------------------------------------------------------------

-- 4a) TRUNCATE no pasa por las politicas. Sin esta linea, todo lo de arriba
--     es decorativo para quien sepa mandar un TRUNCATE. Y con CASCADE se
--     lleva tambien `reservas`, que el ON DELETE SET NULL no protege porque
--     TRUNCATE ignora la clausula ON DELETE.
revoke truncate on public.espacios_reserva from authenticated;

-- 4b) `anon`: fuera REFERENCES y TRIGGER, que no usa nadie...
revoke all on public.espacios_reserva from anon;
--     ...y DENTRO otra vez el SELECT, que SI se usa. Las dos lineas van
--     juntas y en este orden a proposito: asi el estado final es explicito y
--     no depende de lo que hubiera antes. Fuera de la transaccion nadie ve el
--     hueco entre una y otra.
grant select on public.espacios_reserva to anon;

commit;

-- ===========================================================================
-- LO QUE ESTE FICHERO NO TAPA (a proposito -- queda fuera del encargo)
-- ===========================================================================
--
--   1. `planos_espacio`: 5 politicas abiertas de par en par (`true` y
--      `auth.uid() IS NOT NULL`), `anon` con SELECT y `authenticated` con
--      TRUNCATE. Es el mismo patron, y `useEliminarEspacio` la borra. Cerrar
--      el DELETE de `espacios_reserva` corta la via del CASCADE, pero el
--      borrado DIRECTO de planos sigue abierto a cualquier autenticado.
--      Es el siguiente de la lista.
--   2. `configuracion_turnos`: tambien cuelga por CASCADE; no se han mirado
--      sus politicas en este encargo.
--   3. `reservas`: conserva `anon` SELECT y `authenticated` TRUNCATE (los
--      mismos dos grants). Ya se apunto al cerrar `mesas`. Sigue pendiente.
--   4. `can_write_section` mira 'view' y no 'edit'. Mientras siga asi,
--      camarero1@staff.local (can_edit = false) puede CREAR y EDITAR
--      espacios, aunque ya no borrarlos. Cambiar la funcion a 'edit' HOY
--      dejaria a todo el mundo sin escribir, porque no hay ni una fila con
--      can_edit = true. Orden obligatorio si algun dia se hace: (1) quitar el
--      forzado can_edit:false de useUserRolePresets.ts y useUsersManagement.ts,
--      (2) repartir can_edit, (3) SOLO ENTONCES tocar la funcion.
--
-- ===========================================================================
-- VERIFICACION (ejecutar A MANO DESPUES de aplicar; no forma parte de la
-- migracion). Comprueba el resultado contra el catalogo, no contra este SQL.
-- Para el juego completo: supabase/tests/espacios_rls_test.sql
-- ===========================================================================
--
-- -- 1) Las 6 politicas nuevas y ninguna de las 9 viejas:
-- select policyname, cmd, roles::text,
--        coalesce(qual,'-') as using_expr, coalesce(with_check,'-') as check_expr
-- from pg_policies
-- where schemaname='public' and tablename='espacios_reserva'
-- order by cmd, policyname;
--   -- esperado: 6 filas. Una sola con rol {anon} (la de activa = true),
--   -- cuatro {authenticated}, una {service_role}. NINGUNA con {public}.
--
-- -- 2) Grants: sin TRUNCATE a authenticated; anon SOLO con SELECT:
-- select grantee, string_agg(privilege_type, ',' order by privilege_type)
-- from information_schema.role_table_grants
-- where table_schema='public' and table_name='espacios_reserva'
--   and grantee in ('anon','authenticated','service_role')
-- group by 1 order by 1;
--   -- esperado: anon = SELECT (solo eso);
--   --           authenticated = DELETE,INSERT,REFERENCES,SELECT,TRIGGER,UPDATE
--   --                           (sin TRUNCATE).
--
-- -- 3) FORCE RLS sigue apagado (de el depende el trigger de updated_at):
-- select relrowsecurity, relforcerowsecurity, pg_get_userbyid(relowner)
-- from pg_class where oid = 'public.espacios_reserva'::regclass;
--   -- esperado: true, FALSE, postgres.
--
-- -- 4) Los 4 usuarios reales siguen leyendo y escribiendo:
-- select u.email,
--        public.has_section_permission(u.id,'reservas','view') as lee_y_escribe,
--        public.is_super_admin(u.id) as puede_borrar_espacios
-- from auth.users u order by u.email;
--   -- esperado: 4 filas con lee_y_escribe = true; 2 con
--   -- puede_borrar_espacios = true (el dueno y su companero).
--
-- -- 5) La lectura anonima sigue viva (las 7 filas activas):
-- set local role anon;
-- select count(*) from public.espacios_reserva;   -- esperado: 7
-- reset role;
-- ---------------------------------------------------------------------------
