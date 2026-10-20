-- ===========================================================================
-- ##                                                                       ##
-- ##                            APLICADA                                   ##
-- ##                                                                       ##
-- ##   Corregido 2026-09-23: SI esta aplicado (confirmado contra            ##
-- ##   supabase_migrations.schema_migrations, API de Supabase, solo         ##
-- ##   lectura). El ORDEN DE DESPLIEGUE de mas abajo documenta el proceso.  ##
-- ##                                                                       ##
-- ===========================================================================
--
-- Endurece funciones SECURITY DEFINER expuestas a `anon` y fija el
-- search_path mutable de 21 funciones
-- (auditoría de seguridad, sesión 2026-09-22, proyecto jeamoczmbfsnwkfjxcyo)
-- ---------------------------------------------------------------------------
--
-- ORIGEN (dos avisos independientes de /advisors/security, ambos releídos
--   con GET .../advisors/security el mismo día que este fichero, no de
--   memoria ni del encargo a ciegas)
--
--   (a) 11 funciones SECURITY DEFINER con EXECUTE concedido a `anon`:
--       actualizar_ocupacion_diaria_espacios, calcular_horas_trabajadas,
--       fn_notificar_solicitud, get_user_role, handle_new_sell_user,
--       handle_new_user_inventory, handle_new_user_role,
--       has_section_permission, is_admin, update_sell_users_updated_at,
--       update_updated_at_column.
--
--   (b) 22 funciones con `function_search_path_mutable`:
--       touch_conversacion_updated_at, fn_snapshot_solicitud_original,
--       withdraw_stock_inventory, validate_tipo_venta,
--       handle_new_user_inventory, set_mensajes_chat_conversacion_id,
--       buscar_producto, gastos_periodo, actualizar_historial_precios,
--       validar_capacidad_reserva, fn_notificar_solicitud,
--       buscar_productos_similares, buscar_facturas_por_contexto,
--       buscar_contexto_chatbot, ejecutar_consulta_chatbot,
--       update_conversacion_timestamp, normalizar_texto,
--       normalizar_nombre_producto, normalizar_proveedor,
--       vinos_actualizar_exclusion_sulfitos, set_user_role_presets_updated_at,
--       verificar_duplicado_factura.
--
--   `validar_capacidad_reserva` queda FUERA de (b) a propósito: otro agente
--   la está tocando ahora mismo en 20260922190000_aforo_por_marca.sql. No se
--   ha leído su definición ni se ha escrito ninguna línea relacionada con
--   ella en este fichero. Por eso este fichero fija 21 de las 22, no 22.
--
-- MÉTODO -- todo lo que sigue se verificó contra producción con el endpoint
--   de solo lectura (pg_proc, pg_trigger, pg_policies de TODOS los esquemas,
--   pg_constraint, pg_views, pg_extension, has_table_privilege) y con un
--   grep de los 4 repos (incluidas las Edge Functions de adminpanelct).
--   Nada de la clasificación de abajo se da por bueno solo porque el
--   encargo o una migración anterior lo dijera; donde una fuente anterior
--   decía algo distinto, se cita y se explica la discrepancia.
--
-- ===========================================================================
-- CLASIFICACIÓN DE LAS 11 FUNCIONES DE (a)
-- ===========================================================================
--
-- GRUPO 1 -- funciones de trigger puras (8). RETURNS trigger confirmado por
--   pg_proc en las 8, y las 8 están enganchadas HOY a un trigger real
--   (pg_trigger, ver tabla): nadie tiene motivo para invocarlas por
--   /rest/v1/rpc/<nombre>, solo el motor de triggers las ejecuta, y el motor
--   de triggers NO comprueba el EXECUTE del rol que dispara la sentencia.
--   Revocar EXECUTE a anon/authenticated no afecta a que seguirán
--   disparándose con total normalidad.
--
--     update_updated_at_column        -- 37 triggers "update_*_updated_at"
--                                         sobre tablas de public Y sobre
--                                         storage.objects.
--     handle_new_sell_user            -- trigger on_auth_user_created_sell
--                                         en auth.users.
--     handle_new_user_inventory       -- trigger on_auth_user_created_inventory
--                                         en auth.users. (Ojo: TAMBIÉN está
--                                         en la lista (b), ver BLOQUE 4.)
--     handle_new_user_role            -- trigger on_auth_user_created en
--                                         auth.users.
--     fn_notificar_solicitud          -- trigger trg_notificar_solicitud en
--                                         public.solicitudes_pendientes.
--                                         (También en (b), ver BLOQUE 4.)
--     actualizar_ocupacion_diaria_espacios -- trigger trigger_actualizar_ocupacion
--                                         en public.reservas.
--     update_sell_users_updated_at    -- trigger update_sell_users_updated_at
--                                         en public.sell_users.
--     calcular_horas_trabajadas       -- trigger trigger_calcular_horas en
--                                         public.registro_horas. El encargo
--                                         pedía comprobar si "algo la usa
--                                         hoy" (origen gestor_trabajadores):
--                                         SÍ, está viva -- confirmado por
--                                         pg_trigger, no solo por estar
--                                         definida. RETURNS trigger igual
--                                         que las otras 7: mismo tratamiento,
--                                         no es un caso aparte.
--
-- GRUPO 2 -- apoyo a RLS, SÍ se revocan tras verificar que nada directo las
--   necesita (2 funciones).
--
--     has_section_permission(_user_id uuid, _section text, _permission text)
--       - pg_policies (los 3 esquemas, no solo public): CERO políticas la
--         invocan directamente. Solo la invocan can_read_section(_section)
--         y can_write_section(_section) -- y ambas son SECURITY DEFINER
--         (confirmado en pg_proc), así que la llamada interna corre con los
--         privilegios de su propietario, no con los del rol que disparó la
--         política. El EXECUTE de anon/authenticated sobre
--         has_section_permission no es necesario para que las políticas
--         funcionen.
--       - can_read_section/can_write_section YA tienen su propio ACL sin
--         anon ni PUBLIC hoy: {postgres=X,authenticated=X,service_role=X}
--         (fijado en 20260918120000). Revocar has_section_permission de
--         anon/authenticated iguala su exposición a la de estas dos, no
--         introduce un patrón nuevo.
--       - Se llama DIRECTO por rpc() desde 6 Edge Functions (chat-facturas,
--         format-novedad, notify-reservation-change,
--         procesar-dibujo-perimetro, procesar-factura, rebuild-webs). Se ha
--         abierto cada una: las 6 hacen la llamada `.rpc("has_section_permission"...)`
--         sobre el cliente creado con SUPABASE_SERVICE_ROLE_KEY
--         (`supabaseAdmin` / `supabase`), nunca sobre el cliente que
--         reenvía el JWT del usuario (`supabaseUser`). service_role no se
--         toca en este fichero, así que ninguna de las 6 se ve afectada.
--       - pg_constraint y pg_views: cero referencias.
--
--     get_user_role(_user_id uuid)
--       - pg_policies (los 3 esquemas): cero políticas la invocan.
--       - pg_proc.prosrc de TODO public: ninguna otra función la llama.
--       - grep de los 4 repos + Edge Functions: cero llamadas `.rpc("get_user_role"...)`.
--         Solo aparece en los `integrations/supabase/types.ts` autogenerados
--         (tipos TypeScript, no código que se ejecute). El hook real
--         (`adminpanelct/src/hooks/useUserRole.ts`) lee el rol con
--         `supabase.from("user_roles").select("role")...`, no con esta RPC.
--       - Hoy es código muerto desde el punto de vista de quién la llama.
--         No se toca la función en sí (podría tener un consumidor futuro),
--         solo se le retira el EXECUTE que no usa nadie ahora mismo.
--
--   DIVERGENCIA CON 20260918084909 -- esa migración (BLOQUE 7) dice
--   textualmente: "NOTA: NO se tocan is_admin(), get_user_role() ni
--   has_section_permission(): las invocan las propias politicas RLS y
--   quitarles permisos podria romper la evaluacion de las politicas." Esa
--   nota es correcta para is_admin (ver GRUPO 3) pero, verificado ahora con
--   pg_policies fila a fila, ninguna política invoca get_user_role ni
--   has_section_permission directamente -- la nota de 20260918084909 las
--   metió en el mismo saco que is_admin sin distinguir la invocación directa
--   (is_admin) de la indirecta a través de un wrapper SECURITY DEFINER
--   (has_section_permission, vía can_read_section/can_write_section) o de
--   la ausencia total de invocación (get_user_role). Mismo espíritu que la
--   corrección hecha en 20260922170000 ("CORRECCIÓN SOBRE EL ENCARGO
--   ORIGINAL"): se verifica en vez de repetir la nota anterior sin
--   comprobarla. Si algún consumidor de has_section_permission/get_user_role
--   aparece que no se haya encontrado aquí, el ROLLBACK de este fichero
--   restaura el EXECUTE exactamente como estaba.
--
-- GRUPO 3 -- apoyo a RLS, NO se toca (1 función).
--
--     is_admin(_user_id uuid)
--       - Aparece LITERAL como `is_admin(auth.uid())` en el qual/with_check
--         de ~30 políticas de pg_policies sobre public (alertas_stock,
--         configBotWeb, configuracion_reservas, configuracion_turnos,
--         gdpr_audit_log, gdpr_config, lineas_pedido, movimientos_stock,
--         ocupacion_diaria, pedidos_ecommerce, user_permissions,
--         user_role_presets, user_roles, visitas_producto...). Se invoca
--         DIRECTO desde la política, sin wrapper SECURITY DEFINER de por
--         medio: el rol que dispara la consulta necesita el EXECUTE sí o sí.
--       - 7 de esas políticas son `TO public` (no solo `TO authenticated`),
--         lo que en Postgres incluye a `anon`. Comprobado con
--         has_table_privilege: `anon` tiene SELECT de tabla HOY sobre
--         `configuracion_turnos`, `gdpr_audit_log` y `gdpr_config` -- es
--         decir, esas políticas `TO public` que llaman a is_admin() SÍ se
--         evalúan para `anon` en la práctica, no es una posibilidad teórica.
--         Revocar el EXECUTE a anon rompería con "permission denied for
--         function is_admin" CUALQUIER SELECT anónimo sobre esas 3 tablas,
--         no solo el acceso de administrador.
--       - También se llama por rpc() directo desde 4 Edge Functions más
--         (admin-create-user, admin-delete-user, admin-update-user-password,
--         list-users) -- las 4 sobre el cliente service_role, así que esto
--         no cambia la conclusión, pero confirma que is_admin es la única
--         de las tres con un llamador que la necesita `TO public`.
--       - CERO cambios en este fichero para is_admin: ni EXECUTE ni
--         search_path (su search_path ya está fijo en 'public' desde
--         20251226144838, no aparece en la lista de 22 mutables).
--
-- NOTA APARTE (no se toca, fuera de alcance): las 7 políticas `TO public`
--   de GRUPO 3 que alcanzan a `anon` son en sí mismas una superficie ancha
--   para tablas de configuración interna (gdpr_config, configuracion_turnos,
--   configuracion_reservas...) -- podrían acotarse a `TO authenticated`. Es
--   un cambio de política, no de función ni de search_path, y tocar
--   políticas está fuera del territorio de este fichero. Anotado en el
--   informe de la sesión para quien quiera revisarlo aparte.
--
-- ===========================================================================
-- LOS 22 DE search_path MUTABLE -- CRITERIO '' vs 'public'
-- ===========================================================================
--
-- Un search_path mutable dentro de una función SECURITY DEFINER es un
-- vector real de escalada: el rol que llama controla su propio search_path
-- de sesión, y una función SECURITY DEFINER sin `SET search_path` fijo
-- hereda ese search_path mutable mientras corre con los privilegios de su
-- propietario (normalmente el dueño de las migraciones). Fijarlo en la
-- propia función (proconfig) ignora lo que el llamador haya puesto.
--
-- Se ha leído el prosrc completo de las 21 (todas, no una muestra) para
-- decidir entre '' y 'public':
--
--   '' (cadena vacía) -- SOLO cuando el cuerpo no depende de ninguna
--   resolución implícita: o no toca ninguna tabla/función de otro esquema,
--   o ya usa el esquema explícito en cada referencia (auth.uid(),
--   inventory.profiles, public.notificaciones_dashboard...). 7 funciones:
--
--     fn_notificar_solicitud            -- solo public.notificaciones_dashboard,
--                                           ya cualificado.
--     fn_snapshot_solicitud_original     -- solo NEW/OLD, sin SQL a tablas.
--     handle_new_user_inventory          -- solo inventory.profiles, ya
--                                           cualificado.
--     set_user_role_presets_updated_at   -- solo NEW.updated_at = now().
--     validate_tipo_venta                -- solo valida NEW.tipo_venta, sin
--                                           tablas.
--     vinos_actualizar_exclusion_sulfitos -- solo compara OLD/NEW en jsonb.
--     withdraw_stock_inventory           -- inventory.products,
--                                           inventory.transactions, auth.uid():
--                                           todo cualificado.
--
--   'public' -- cuando el cuerpo referencia tablas o funciones SIN
--   cualificar (p.ej. `FROM facturas` en vez de `FROM public.facturas`).
--   Reescribir esos cuerpos para cualificar cada referencia queda fuera de
--   alcance de este encargo (es tocar lógica, no permisos/config); fijar
--   'public' cierra el aviso `function_search_path_mutable` igual que ''
--   (dejar de ser mutable es lo que pide el advisor) pero mantiene el
--   comportamiento actual sin reescribir nada. 14 funciones:
--
--     actualizar_historial_precios, buscar_contexto_chatbot,
--     buscar_facturas_por_contexto, buscar_producto,
--     buscar_productos_similares, ejecutar_consulta_chatbot, gastos_periodo,
--     normalizar_nombre_producto (llama a normalizar_texto() sin cualificar),
--     normalizar_proveedor (llama a unaccent() sin cualificar),
--     normalizar_texto (llama a unaccent() sin cualificar),
--     set_mensajes_chat_conversacion_id, touch_conversacion_updated_at,
--     update_conversacion_timestamp, verificar_duplicado_factura.
--
--     (unaccent y vector viven en el esquema public -- comprobado con
--     pg_extension -- así que 'public' basta para resolverlos; no hace
--     falta añadir 'extensions' al search_path de estas funciones.)
--
--   RIESGO RESIDUAL QUE 'public' NO CIERRA (decirlo, como pide el encargo):
--   pg_temp se busca de forma implícita para NOMBRES DE TABLA sin
--   cualificar en Postgres, delante incluso de un search_path fijo a
--   'public' (no de funciones/operadores, solo de tablas). Cualquier rol
--   con conexión a la base puede crear una tabla temporal con el mismo
--   nombre que, por ejemplo, `facturas`, y una sesión que luego llame a una
--   de estas 14 funciones dentro de la MISMA conexión vería su tabla
--   temporal en vez de `public.facturas`. Fijar 'public' cierra el aviso
--   del advisor (deja de ser mutable) pero NO cierra por completo esta
--   variante -- solo cualificar cada referencia (`public.facturas`) lo
--   haría, y eso es la reescritura que este fichero no hace. Para las 7 de
--   arriba con '' este riesgo no existe: todo lo que tocan ya está
--   cualificado.
--
-- ===========================================================================
-- QUÉ SE ROMPERÍA SI ESTO SE APLICA MAL
-- ===========================================================================
--
--   - Revocar is_admin por error (no ocurre en este fichero, pero si se
--     edita a mano): deja SIN ACCESO el panel entero para `authenticated` y
--     rompe con error (no con lista vacía) cualquier SELECT anónimo sobre
--     configuracion_turnos, gdpr_audit_log y gdpr_config.
--   - Revocar has_section_permission/get_user_role SIN el análisis de
--     arriba: si apareciera un llamador directo con el JWT del usuario (no
--     encontrado en esta sesión), esa llamada empezaría a fallar con
--     "permission denied for function". El ROLLBACK lo revierte.
--   - Poner search_path = '' en una de las 14 de GRUPO 'public': la función
--     dejaría de encontrar sus propias tablas (`relation "facturas" does
--     not exist`) en el primer uso real, no en el despliegue.
--   - Tocar validar_capacidad_reserva desde este fichero: colisión directa
--     con el trabajo en curso de 20260922190000_aforo_por_marca.sql. Por
--     eso no está aquí.
--
-- ===========================================================================
-- ORDEN DE DESPLIEGUE
-- ===========================================================================
--   1. Ejecutar la CONSULTA DE VERIFICACIÓN de más abajo y guardar el
--      resultado "ANTES".
--   2. Aplicar esta migración (`supabase db push` o pegarla en el SQL
--      editor) SOLO cuando 20260922190000_aforo_por_marca.sql ya haya
--      aterrizado (para evitar tocar validar_capacidad_reserva a medio
--      camino de ese otro trabajo).
--   3. Repetir la CONSULTA DE VERIFICACIÓN y comparar con "ANTES".
--   4. Smoke test mínimo (nada de esto debería cambiar por una revocación
--      de EXECUTE, pero es la asunción central de GRUPO 1 y merece
--      confirmarse una vez): crear una reserva desde el panel (dispara
--      update_updated_at_column y actualizar_ocupacion_diaria_espacios),
--      crear un usuario nuevo desde Usuarios (dispara los 3 handle_new_*
--      sobre auth.users), y dejar que una solicitud caiga a
--      solicitudes_pendientes (dispara fn_notificar_solicitud). Los cuatro
--      deben seguir funcionando exactamente igual.
--   5. Si algo se rompe: ejecutar a mano
--      `supabase/rollbacks/20260922200000_endurecer_funciones_ROLLBACK.sql`.
-- ===========================================================================

begin;

-- ---------------------------------------------------------------------
-- BLOQUE 1 -- Funciones de trigger puras: sin motivo para ser invocables
-- directamente. Revoca EXECUTE a PUBLIC/anon/authenticated; no se toca
-- service_role (el patrón de 20260918084909 BLOQUE 7 tampoco lo toca) ni
-- postgres (dueño, siempre tiene EXECUTE implícito). No afecta a que los
-- triggers sigan disparándose: el motor de triggers no comprueba EXECUTE
-- del rol que dispara la sentencia DML.
-- ---------------------------------------------------------------------

-- 37 triggers "update_*_updated_at" sobre tablas de public y storage.objects.
revoke all on function public.update_updated_at_column() from public, anon, authenticated;

-- Trigger on_auth_user_created_sell en auth.users.
revoke all on function public.handle_new_sell_user() from public, anon, authenticated;

-- Trigger on_auth_user_created_inventory en auth.users. También en BLOQUE 4
-- (search_path mutable) -- las dos revocaciones son independientes.
revoke all on function public.handle_new_user_inventory() from public, anon, authenticated;

-- Trigger on_auth_user_created en auth.users.
revoke all on function public.handle_new_user_role() from public, anon, authenticated;

-- Trigger trg_notificar_solicitud en public.solicitudes_pendientes. También
-- en BLOQUE 4 (search_path mutable).
revoke all on function public.fn_notificar_solicitud() from public, anon, authenticated;

-- Trigger trigger_actualizar_ocupacion en public.reservas.
revoke all on function public.actualizar_ocupacion_diaria_espacios() from public, anon, authenticated;

-- Trigger update_sell_users_updated_at en public.sell_users.
revoke all on function public.update_sell_users_updated_at() from public, anon, authenticated;

-- Trigger trigger_calcular_horas en public.registro_horas -- confirmado
-- vivo (no huérfana): origen gestor_trabajadores, sigue en uso hoy.
revoke all on function public.calcular_horas_trabajadas() from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- BLOQUE 2 -- has_section_permission / get_user_role: apoyo a RLS que, tras
-- verificar pg_policies de los 3 esquemas + pg_proc.prosrc completo + las 6
-- Edge Functions que las llaman directo, no necesitan EXECUTE de
-- anon/authenticated hoy. Diverge de la nota de 20260918084909 (que las
-- metía junto a is_admin sin distinguir invocación directa de indirecta) --
-- ver "DIVERGENCIA" en la cabecera. is_admin, la tercera del mismo grupo
-- original, se deja intacta en BLOQUE 3: sí tiene un llamador directo que
-- la necesita.
-- ---------------------------------------------------------------------

-- Sin invocador directo: solo la llaman can_read_section/can_write_section,
-- ambas SECURITY DEFINER (privilegios de su dueño, no del rol que disparó
-- la política). Las 6 Edge Functions que la llaman por rpc() usan el
-- cliente service_role, no el que reenvía el JWT del usuario.
revoke all on function public.has_section_permission(_user_id uuid, _section text, _permission text) from public, anon, authenticated;

-- Sin invocador de ningún tipo hoy (ni política, ni función, ni RPC desde
-- ningún repo): el panel lee el rol con una consulta directa a user_roles,
-- no con esta RPC.
revoke all on function public.get_user_role(_user_id uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- BLOQUE 3 -- is_admin: NO SE TOCA.
--
-- Invocada directa (sin wrapper) desde ~30 políticas RLS, 7 de ellas
-- `TO public` (alcanza a anon) y confirmado que anon tiene SELECT de tabla
-- HOY sobre 3 de esas tablas (configuracion_turnos, gdpr_audit_log,
-- gdpr_config). Revocar EXECUTE aquí, a cualquiera de los dos roles, rompe
-- con error esas consultas -- no las deja vacías, las rompe. Su
-- search_path ya está fijo en 'public' desde 20251226144838 (no está en la
-- lista de 22 mutables). Cero sentencias para is_admin en este fichero,
-- a propósito.
-- ---------------------------------------------------------------------

-- ---------------------------------------------------------------------
-- BLOQUE 4 -- search_path = '' : el cuerpo no depende de resolución
-- implícita (o no toca tablas, o ya usa esquema explícito en cada
-- referencia). Es el ajuste más estricto posible sin reescribir nada.
-- ---------------------------------------------------------------------

alter function public.fn_notificar_solicitud() set search_path = '';
alter function public.fn_snapshot_solicitud_original() set search_path = '';
alter function public.handle_new_user_inventory() set search_path = '';
alter function public.set_user_role_presets_updated_at() set search_path = '';
alter function public.validate_tipo_venta() set search_path = '';
alter function public.vinos_actualizar_exclusion_sulfitos() set search_path = '';
alter function public.withdraw_stock_inventory(p_product_id uuid, p_quantity integer) set search_path = '';

-- ---------------------------------------------------------------------
-- BLOQUE 5 -- search_path = 'public' : el cuerpo referencia tablas o
-- funciones de public SIN cualificar. Reescribir cada referencia queda
-- fuera de alcance (lógica, no permisos/config); fijar 'public' cierra el
-- aviso function_search_path_mutable igual que '' lo haría, sin cambiar el
-- comportamiento actual. Deja abierto el vector de pg_temp para nombres de
-- tabla sin cualificar -- ver "RIESGO RESIDUAL" en la cabecera.
-- ---------------------------------------------------------------------

alter function public.actualizar_historial_precios() set search_path = 'public';
alter function public.buscar_contexto_chatbot(embedding_query vector) set search_path = 'public';
alter function public.buscar_facturas_por_contexto(query_embedding vector, limite integer) set search_path = 'public';
alter function public.buscar_producto(termino text) set search_path = 'public';
alter function public.buscar_productos_similares(query_embedding vector, limite integer) set search_path = 'public';
alter function public.ejecutar_consulta_chatbot(query_sql text) set search_path = 'public';
alter function public.gastos_periodo(fecha_inicio date, fecha_fin date) set search_path = 'public';
-- Llama a normalizar_texto() sin cualificar.
alter function public.normalizar_nombre_producto(p_nombre text) set search_path = 'public';
-- Llama a unaccent() sin cualificar (extensión unaccent vive en public).
alter function public.normalizar_proveedor(p_proveedor text) set search_path = 'public';
-- Llama a unaccent() sin cualificar (extensión unaccent vive en public).
alter function public.normalizar_texto(p_texto text) set search_path = 'public';
alter function public.set_mensajes_chat_conversacion_id() set search_path = 'public';
alter function public.touch_conversacion_updated_at() set search_path = 'public';
alter function public.update_conversacion_timestamp() set search_path = 'public';
alter function public.verificar_duplicado_factura(p_numero_documento character varying, p_proveedor character varying, p_fecha date, p_total numeric) set search_path = 'public';

commit;

-- ---------------------------------------------------------------------------
-- CONSULTA DE VERIFICACIÓN -- ejecutar ANTES y DESPUÉS de aplicar esta
-- migración. Solo lee, no escribe nada.
-- ---------------------------------------------------------------------------
--
-- -- 1) EXECUTE de anon/authenticated/service_role sobre las 10 funciones
-- --    que este fichero revoca, más is_admin y validar_capacidad_reserva
-- --    como control (no deben cambiar):
-- select p.proname,
--        has_function_privilege('anon', p.oid, 'EXECUTE') as anon_puede,
--        has_function_privilege('authenticated', p.oid, 'EXECUTE') as authenticated_puede,
--        has_function_privilege('service_role', p.oid, 'EXECUTE') as service_role_puede
-- from pg_proc p
-- where p.pronamespace = 'public'::regnamespace
--   and p.proname in (
--     'actualizar_ocupacion_diaria_espacios','calcular_horas_trabajadas',
--     'fn_notificar_solicitud','handle_new_sell_user','handle_new_user_inventory',
--     'handle_new_user_role','update_sell_users_updated_at','update_updated_at_column',
--     'has_section_permission','get_user_role',
--     'is_admin'
--   )
-- order by p.proname;
--
-- -- ANTES: anon_puede=true y authenticated_puede=true en las 10 primeras
-- --   filas; service_role_puede=true en las 11. is_admin con anon_puede=true
-- --   y authenticated_puede=true.
-- -- DESPUÉS: anon_puede=false y authenticated_puede=false en las 10
-- --   primeras; service_role_puede=true SIN CAMBIOS en las 11. is_admin
-- --   IGUAL que antes (true/true) -- si is_admin cambia, algo fue mal y hay
-- --   que revertir.
--
-- -- 2) search_path de las 21 funciones que este fichero fija, más
-- --    validar_capacidad_reserva como control (no se toca aquí):
-- select proname, proconfig
-- from pg_proc
-- where pronamespace = 'public'::regnamespace
--   and proname in (
--     'fn_notificar_solicitud','fn_snapshot_solicitud_original',
--     'handle_new_user_inventory','set_user_role_presets_updated_at',
--     'validate_tipo_venta','vinos_actualizar_exclusion_sulfitos',
--     'withdraw_stock_inventory',
--     'actualizar_historial_precios','buscar_contexto_chatbot',
--     'buscar_facturas_por_contexto','buscar_producto',
--     'buscar_productos_similares','ejecutar_consulta_chatbot',
--     'gastos_periodo','normalizar_nombre_producto','normalizar_proveedor',
--     'normalizar_texto','set_mensajes_chat_conversacion_id',
--     'touch_conversacion_updated_at','update_conversacion_timestamp',
--     'verificar_duplicado_factura',
--     'validar_capacidad_reserva'
--   )
-- order by proname;
--
-- -- ANTES: proconfig NULL en las 21 (y también en validar_capacidad_reserva).
-- -- DESPUÉS: proconfig con search_path fijado a cadena vacía en las 7 del
-- --   BLOQUE 4, a 'public' en las 14 del BLOQUE 5, y validar_capacidad_reserva
-- --   SIGUE EN NULL (no la toca este fichero).
-- ---------------------------------------------------------------------------
