set client_encoding = 'UTF8';
-- (Primera línea a propósito: los DROP de abajo llevan nombres con tilde
-- —«Público», «imágenes»— y psql en una consola de Windows puede arrancar en
-- WIN1252. Si aun así algún DROP no casara, el bloque 5 aborta la transacción.)
-- ===========================================================================
-- ##                                                                       ##
-- ##          NO APLICADA: la aplica el dueño a mano (ver pasos)           ##
-- ##                                                                       ##
-- ##   Cierra la ESCRITURA de la carta (Platos, Vinos, Cocteles, Bebidas)  ##
-- ##   y de sus fotos en Storage a quien no tenga la sección gestor_carta. ##
-- ##   La LECTURA no cambia: ni la anónima de las webs ni la del panel.    ##
-- ##   Solo políticas y privilegios: no toca ni una fila.                  ##
-- ##                                                                       ##
-- ===========================================================================
--
-- PROBLEMA (diagnóstico del 2026-10-01)
--   La Fase 2 (20260918120000_rls_por_permisos_de_seccion) dejó fuera a
--   propósito la carta porque las webs la leen como `anon`, y nadie volvió a
--   por la escritura. Hoy CUALQUIER usuario autenticado —tenga o no la
--   sección, incluso un `sub` que no exista en auth.users— puede crear,
--   editar, despublicar y borrar platos, vinos, cócteles y bebidas, y subir,
--   sobrescribir o borrar sus fotos. Y además puede hacer TRUNCATE, que NO
--   pasa por la RLS.
--
-- ---------------------------------------------------------------------------
-- ESTADO ACTUAL VERIFICADO (producción, 2026-10-01, solo SELECT)
-- ---------------------------------------------------------------------------
--   RLS encendida en las 4, FORCE apagado, propietario postgres.
--   Ninguna política llama a can_*_section / is_super_admin. Dos juegos
--   solapados (las PERMISSIVE se suman con OR: una sola `true` basta):
--
--   Platos / Vinos / Bebidas (9 políticas cada una, mismos nombres salvo
--   el de la tabla):
--     SELECT  public         "Público puede ver <x> activos"        (activado = true)   <- SE QUEDA
--     SELECT  public         "Usuarios autenticados pueden ver todos/todas los/las <x>"
--                                                                   (auth.uid() IS NOT NULL) <- SE QUEDA
--     SELECT  authenticated  "Authenticated users can read <X>"     true                <- SE QUEDA
--     INSERT  public         "Usuarios autenticados pueden crear <x>"      check (auth.uid() IS NOT NULL)
--     UPDATE  public         "Usuarios autenticados pueden actualizar <x>" (auth.uid() IS NOT NULL) / idem
--     DELETE  public         "Usuarios autenticados pueden eliminar <x>"   (auth.uid() IS NOT NULL)
--     INSERT  authenticated  "Authenticated users can insert <X>"   check true
--     UPDATE  authenticated  "Authenticated users can update <X>"   true / true
--     DELETE  authenticated  "Authenticated users can delete <X>"   true
--   Cocteles (5):
--     SELECT  public         "Público puede ver cocteles activos"   (activado = true)   <- SE QUEDA
--     SELECT  authenticated  "Usuarios autenticados pueden ver todos los cocteles" true <- SE QUEDA
--     INSERT  authenticated  "Usuarios autenticados pueden crear cocteles"      check true
--     UPDATE  authenticated  "Usuarios autenticados pueden actualizar cocteles" true (sin check)
--     DELETE  authenticated  "Usuarios autenticados pueden eliminar cocteles"   true
--
--   Grants (las 4 igual):
--     anon           REFERENCES, SELECT, TRIGGER
--     authenticated  DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE
--     service_role   todo (y rolbypassrls = true)
--
--   Storage (storage.objects), 18 políticas de escritura sobre los buckets de
--   la carta, todas sin sección:
--     platos/plato  6  (3 con rol public + auth.uid() IS NOT NULL, 3 TO authenticated)
--     vinos         3  (rol public + auth.role() = 'authenticated')
--     bebidas       3  (ídem)
--     cocteles      3  (TO authenticated, solo bucket_id)
--     carta         3  (TO authenticated; el bucket `carta` NO EXISTE hoy:
--                       son huérfanas, pero se abrirían solas el día que
--                       alguien lo cree)
--   Objetos hoy: platos 105, el resto vacíos. Lectura: buckets públicos +
--   «Lectura pública de buckets» (SELECT true) — NO se toca aquí.
--
-- ---------------------------------------------------------------------------
-- QUÉ SECCIÓN Y POR QUÉ (comprobado en el código del panel)
-- ---------------------------------------------------------------------------
--   `gestor_carta`. La carta solo se edita desde Gestor Web → pestaña Carta
--   (src/components/gestion-web/pestanasGestorWeb.ts: carta → gestor_carta;
--   /gestor-carta redirige a /gestion-web?tab=carta). TabCarta monta
--   ListaPlatos/ListaVinos/ListaCocteles/ListaBebidas y AjustePreciosModal,
--   y TODAS las escrituras pasan por usePlatos/useVinos/useCocteles/
--   useBebidas: crear (insert + .select()), editar y retraducir, ajuste y
--   restauración de precios (actualizarX en bucle), activar/despublicar,
--   expanded, restaurante/touza, borrar, y las fotos (upload con
--   upsert:true + remove en los buckets platos/vinos/cocteles/bebidas).
--   Mismo predicado que ya usan historial_ajustes_precios (Fase 2) y
--   configuracion_web (20261001113700), que viven en la misma pestaña.
--
--   Lectores autenticados FUERA de gestor_carta, por eso el SELECT de
--   authenticated NO se toca: Menús diarios (gestion_web) lee Platos con
--   usePlatosParaMenu, y /super-admin/bot-web lee Platos y Vinos.
--
-- QUIÉN SE QUEDA DENTRO (auth.users + user_permissions + super_admins, hoy):
--   4 usuarios. has_section_permission(id,'gestor_carta','view'):
--     14e53985…  super admin, sin filas        -> SÍ
--     46a07ab7…  super admin, 13 secciones     -> SÍ
--     a5729ae9…  admin (no super), gestor_carta -> SÍ
--     bf08f748…  staff, dashboard + reservas   -> NO (no ve la pestaña Carta
--                                                  en el panel de todas formas)
--   Nadie pierde nada que pueda hacer hoy desde la UI. OJO: has_section_
--   permission mira super_admins, NO user_roles.role = 'admin'; un futuro
--   «admin» sin la fila gestor_carta no podrá escribir la carta (igual que
--   ya le pasa con todas las tablas de la Fase 2).
--   can_write_section mira 'view' (no 'edit') a propósito: ver Fase 2.
--
-- ESCRITORES FUERA DEL PANEL (grep en los 4 repos) — NO SE ROMPEN:
--   · Edge Function traducir-contenido/bulk.ts: escribe las 4 tablas con
--     SERVICE_ROLE_KEY. chat-web y rebuild-webs: service role, solo leen.
--   · restaurante-phone (vapi-webhook.js, el-webhook.js): SERVICE_ROLE_KEY,
--     solo SELECT de Platos/Vinos/Bebidas.
--   · casa-tomas-story y touza-restaurant-website (src + scripts/carta-ssg*,
--     report-duplicates.mjs): anon key, solo SELECT. Sin escrituras.
--   · traducir-carta / traducir-carta-auto: reenvían a un webhook n8n y no
--     tocan la BD; el panel ya no los invoca. Si ese n8n escribiera en la
--     carta, solo podría hacerlo con service_role (anon ya no tiene grants
--     de escritura desde la Fase 1), así que tampoco le afecta.
--   service_role tiene rolbypassrls = true; aun así recibe política
--   explícita, como en el resto de la Fase 2.
--
-- LO QUE NO CAMBIA
--   · Las 11 políticas SELECT de las 4 tablas, intactas (ni se borran ni se
--     recrean): la lectura anónima (`activado = true`) y la del panel son
--     exactamente las de hoy.
--   · Triggers: update_cocteles_updated_at (SECURITY DEFINER) y
--     trg_vinos_exclusion_sulfitos (solo toca NEW): no leen otras tablas.
--   · FKs entrantes: novedades.{plato,vino,bebida}_id ON DELETE SET NULL;
--     la acción referencial corre como propietario y no mira RLS.
--   · Políticas SELECT de Storage y las de service_role en Storage.
--
-- ---------------------------------------------------------------------------
-- CÓMO SE APLICA (lo hace el dueño, a mano, desde adminpanelct/).
-- NO con `supabase db push` ni `migration repair`.
--   1. Que no haya transacciones largas abiertas (debe salir vacío):
--        npx supabase db query --linked "select pid, state, now() - xact_start as dura, left(query, 60) as consulta from pg_stat_activity where xact_start < now() - interval '1 minute' and pid <> pg_backend_pid();"
--   2. Aplicarla:
--        npx supabase db query --linked -f supabase/migrations/20261001150000_carta_escritura_por_seccion.sql
--      Si falla con 55P03 (lock_not_available), NO se ha aplicado nada (todo
--      va en una transacción): reintentar desde el paso 1. Si falla en el
--      bloque 5 («sobrevive una política vieja»), tampoco se ha aplicado
--      nada: algún nombre no casó (tildes/encoding); revisar y reintentar.
--   3. Probarla (todo dentro de BEGIN … ROLLBACK, no deja nada escrito):
--        npx supabase db query --linked -f supabase/tests/carta_escritura_por_seccion_test.sql
--      y las consultas de VERIFICACIÓN del pie de este fichero.
--   4. Humo en el panel con un usuario con gestor_carta (no super admin si
--      se puede, p. ej. a5729ae9…): cambiar un precio, despublicar y volver
--      a publicar un plato, y subir/cambiar una foto. No hay que desplegar
--      nada: ni panel ni webs cambian.
--
-- CANDADOS: DROP/CREATE POLICY piden ACCESS EXCLUSIVE sobre las 4 tablas y
-- sobre storage.objects durante milisegundos (las webs y la carga de fotos
-- esperan ese instante). `lock_timeout = 5s` para no quedarse en cola detrás
-- de algo largo.
--
-- Rollback: supabase/rollbacks/20261001150000_carta_escritura_por_seccion_ROLLBACK.sql
-- ===========================================================================

begin;

set local lock_timeout = '5s';

-- ---------------------------------------------------------------------------
-- 1. BORRAR LAS 21 POLÍTICAS DE ESCRITURA VIEJAS DE LAS 4 TABLAS
--    (las SELECT no se tocan). Nombres exactos de pg_policies.
-- ---------------------------------------------------------------------------

-- Platos
drop policy if exists "Usuarios autenticados pueden crear platos"      on public."Platos";
drop policy if exists "Usuarios autenticados pueden actualizar platos" on public."Platos";
drop policy if exists "Usuarios autenticados pueden eliminar platos"   on public."Platos";
drop policy if exists "Authenticated users can insert Platos"          on public."Platos";
drop policy if exists "Authenticated users can update Platos"          on public."Platos";
drop policy if exists "Authenticated users can delete Platos"          on public."Platos";

-- Vinos
drop policy if exists "Usuarios autenticados pueden crear vinos"      on public."Vinos";
drop policy if exists "Usuarios autenticados pueden actualizar vinos" on public."Vinos";
drop policy if exists "Usuarios autenticados pueden eliminar vinos"   on public."Vinos";
drop policy if exists "Authenticated users can insert Vinos"          on public."Vinos";
drop policy if exists "Authenticated users can update Vinos"          on public."Vinos";
drop policy if exists "Authenticated users can delete Vinos"          on public."Vinos";

-- Bebidas
drop policy if exists "Usuarios autenticados pueden crear bebidas"      on public."Bebidas";
drop policy if exists "Usuarios autenticados pueden actualizar bebidas" on public."Bebidas";
drop policy if exists "Usuarios autenticados pueden eliminar bebidas"   on public."Bebidas";
drop policy if exists "Authenticated users can insert Bebidas"          on public."Bebidas";
drop policy if exists "Authenticated users can update Bebidas"          on public."Bebidas";
drop policy if exists "Authenticated users can delete Bebidas"          on public."Bebidas";

-- Cocteles
drop policy if exists "Usuarios autenticados pueden crear cocteles"      on public."Cocteles";
drop policy if exists "Usuarios autenticados pueden actualizar cocteles" on public."Cocteles";
drop policy if exists "Usuarios autenticados pueden eliminar cocteles"   on public."Cocteles";

-- ---------------------------------------------------------------------------
-- 2. POLÍTICAS NUEVAS DE ESCRITURA (idempotentes: drop if exists + create)
--    `(select …)` para que se evalúe una vez por consulta (InitPlan).
-- ---------------------------------------------------------------------------

-- Platos
drop policy if exists platos_insert_seccion on public."Platos";
create policy platos_insert_seccion on public."Platos"
  for insert to authenticated
  with check ( (select public.can_write_section('gestor_carta')) );
drop policy if exists platos_update_seccion on public."Platos";
create policy platos_update_seccion on public."Platos"
  for update to authenticated
  using      ( (select public.can_write_section('gestor_carta')) )
  with check ( (select public.can_write_section('gestor_carta')) );
drop policy if exists platos_delete_seccion on public."Platos";
create policy platos_delete_seccion on public."Platos"
  for delete to authenticated
  using ( (select public.can_write_section('gestor_carta')) );
drop policy if exists platos_service_role on public."Platos";
create policy platos_service_role on public."Platos"
  for all to service_role using (true) with check (true);

-- Vinos
drop policy if exists vinos_insert_seccion on public."Vinos";
create policy vinos_insert_seccion on public."Vinos"
  for insert to authenticated
  with check ( (select public.can_write_section('gestor_carta')) );
drop policy if exists vinos_update_seccion on public."Vinos";
create policy vinos_update_seccion on public."Vinos"
  for update to authenticated
  using      ( (select public.can_write_section('gestor_carta')) )
  with check ( (select public.can_write_section('gestor_carta')) );
drop policy if exists vinos_delete_seccion on public."Vinos";
create policy vinos_delete_seccion on public."Vinos"
  for delete to authenticated
  using ( (select public.can_write_section('gestor_carta')) );
drop policy if exists vinos_service_role on public."Vinos";
create policy vinos_service_role on public."Vinos"
  for all to service_role using (true) with check (true);

-- Bebidas
drop policy if exists bebidas_insert_seccion on public."Bebidas";
create policy bebidas_insert_seccion on public."Bebidas"
  for insert to authenticated
  with check ( (select public.can_write_section('gestor_carta')) );
drop policy if exists bebidas_update_seccion on public."Bebidas";
create policy bebidas_update_seccion on public."Bebidas"
  for update to authenticated
  using      ( (select public.can_write_section('gestor_carta')) )
  with check ( (select public.can_write_section('gestor_carta')) );
drop policy if exists bebidas_delete_seccion on public."Bebidas";
create policy bebidas_delete_seccion on public."Bebidas"
  for delete to authenticated
  using ( (select public.can_write_section('gestor_carta')) );
drop policy if exists bebidas_service_role on public."Bebidas";
create policy bebidas_service_role on public."Bebidas"
  for all to service_role using (true) with check (true);

-- Cocteles
drop policy if exists cocteles_insert_seccion on public."Cocteles";
create policy cocteles_insert_seccion on public."Cocteles"
  for insert to authenticated
  with check ( (select public.can_write_section('gestor_carta')) );
drop policy if exists cocteles_update_seccion on public."Cocteles";
create policy cocteles_update_seccion on public."Cocteles"
  for update to authenticated
  using      ( (select public.can_write_section('gestor_carta')) )
  with check ( (select public.can_write_section('gestor_carta')) );
drop policy if exists cocteles_delete_seccion on public."Cocteles";
create policy cocteles_delete_seccion on public."Cocteles"
  for delete to authenticated
  using ( (select public.can_write_section('gestor_carta')) );
drop policy if exists cocteles_service_role on public."Cocteles";
create policy cocteles_service_role on public."Cocteles"
  for all to service_role using (true) with check (true);

-- ---------------------------------------------------------------------------
-- 3. GRANTS — lo que la RLS no cubre
-- ---------------------------------------------------------------------------
-- 3a) TRUNCATE no pasa por las políticas: sin esto, todo lo de arriba es
--     decorativo para quien sepa mandar un TRUNCATE. El panel no lo usa.
revoke truncate on public."Platos"   from authenticated;
revoke truncate on public."Vinos"    from authenticated;
revoke truncate on public."Bebidas"  from authenticated;
revoke truncate on public."Cocteles" from authenticated;

-- 3b) anon: SOLO SELECT. Fuera REFERENCES y TRIGGER (la escritura ya se la
--     quitó la Fase 1). Las dos líneas van juntas y en este orden: el estado
--     final es explícito y no depende de lo que hubiera antes. El SELECT es
--     el mismo privilegio de siempre: las webs siguen leyendo igual.
revoke all on public."Platos"   from anon;
revoke all on public."Vinos"    from anon;
revoke all on public."Bebidas"  from anon;
revoke all on public."Cocteles" from anon;
grant select on public."Platos"   to anon;
grant select on public."Vinos"    to anon;
grant select on public."Bebidas"  to anon;
grant select on public."Cocteles" to anon;

-- ---------------------------------------------------------------------------
-- 4. STORAGE — fotos de la carta
--    Se sustituyen las 18 políticas de escritura de los buckets de la carta
--    por 3 atadas a gestor_carta. El SELECT (lectura pública) no se toca.
--    upload({upsert:true}) = INSERT … ON CONFLICT DO UPDATE: necesita
--    INSERT + UPDATE (y SELECT, que ya da la lectura pública); remove()
--    necesita DELETE. Las tres van aquí.
-- ---------------------------------------------------------------------------

-- platos / plato
drop policy if exists "Authenticated users can upload platos images"              on storage.objects;
drop policy if exists "Authenticated users can update platos images"              on storage.objects;
drop policy if exists "Authenticated users can delete platos images"              on storage.objects;
drop policy if exists "Usuarios autenticados pueden subir imágenes de platos"      on storage.objects;
drop policy if exists "Usuarios autenticados pueden actualizar imágenes de platos" on storage.objects;
drop policy if exists "Usuarios autenticados pueden eliminar imágenes de platos"   on storage.objects;
-- vinos
drop policy if exists "Allow authenticated upload vinos" on storage.objects;
drop policy if exists "Allow authenticated update vinos" on storage.objects;
drop policy if exists "Allow authenticated delete vinos" on storage.objects;
-- bebidas
drop policy if exists "Allow authenticated upload bebidas" on storage.objects;
drop policy if exists "Allow authenticated update bebidas" on storage.objects;
drop policy if exists "Allow authenticated delete bebidas" on storage.objects;
-- cocteles
drop policy if exists "Autenticados pueden subir imágenes cocteles"      on storage.objects;
drop policy if exists "Autenticados pueden actualizar imágenes cocteles" on storage.objects;
drop policy if exists "Autenticados pueden eliminar imágenes cocteles"   on storage.objects;
-- carta (bucket inexistente hoy; políticas huérfanas)
drop policy if exists "Usuarios autenticados pueden subir a carta"       on storage.objects;
drop policy if exists "Usuarios autenticados pueden actualizar en carta" on storage.objects;
drop policy if exists "Usuarios autenticados pueden eliminar de carta"   on storage.objects;

drop policy if exists carta_imagenes_insert_seccion on storage.objects;
create policy carta_imagenes_insert_seccion on storage.objects
  for insert to authenticated
  with check (
    bucket_id = any (array['platos', 'plato', 'vinos', 'bebidas', 'cocteles', 'carta'])
    and (select public.can_write_section('gestor_carta'))
  );

drop policy if exists carta_imagenes_update_seccion on storage.objects;
create policy carta_imagenes_update_seccion on storage.objects
  for update to authenticated
  using (
    bucket_id = any (array['platos', 'plato', 'vinos', 'bebidas', 'cocteles', 'carta'])
    and (select public.can_write_section('gestor_carta'))
  )
  with check (
    bucket_id = any (array['platos', 'plato', 'vinos', 'bebidas', 'cocteles', 'carta'])
    and (select public.can_write_section('gestor_carta'))
  );

drop policy if exists carta_imagenes_delete_seccion on storage.objects;
create policy carta_imagenes_delete_seccion on storage.objects
  for delete to authenticated
  using (
    bucket_id = any (array['platos', 'plato', 'vinos', 'bebidas', 'cocteles', 'carta'])
    and (select public.can_write_section('gestor_carta'))
  );

-- ---------------------------------------------------------------------------
-- 5. RED DE SEGURIDAD: si algún DROP no casó (tilde, encoding, alguien la
--    renombró), `if exists` lo habría tapado en silencio y la política vieja
--    seguiría abriendo la puerta por OR. Aquí se comprueba contra el
--    catálogo y, si sobrevive alguna, se aborta TODO.
-- ---------------------------------------------------------------------------
do $$
declare sobrantes text;
begin
  select string_agg(format('%s.%s «%s» (%s)', schemaname, tablename, policyname, cmd), '; ')
    into sobrantes
    from pg_policies
   where schemaname = 'public'
     and tablename in ('Platos', 'Vinos', 'Bebidas', 'Cocteles')
     and cmd <> 'SELECT'
     and policyname not in (
       'platos_insert_seccion',   'platos_update_seccion',   'platos_delete_seccion',   'platos_service_role',
       'vinos_insert_seccion',    'vinos_update_seccion',    'vinos_delete_seccion',    'vinos_service_role',
       'bebidas_insert_seccion',  'bebidas_update_seccion',  'bebidas_delete_seccion',  'bebidas_service_role',
       'cocteles_insert_seccion', 'cocteles_update_seccion', 'cocteles_delete_seccion', 'cocteles_service_role');
  if sobrantes is not null then
    raise exception 'Sobrevive una política de escritura vieja en la carta: %', sobrantes;
  end if;

  select string_agg(format('«%s» (%s)', policyname, cmd), '; ')
    into sobrantes
    from pg_policies
   where schemaname = 'storage' and tablename = 'objects'
     and cmd in ('INSERT', 'UPDATE', 'DELETE', 'ALL')
     and policyname not like 'carta\_imagenes\_%'
     and (coalesce(qual, '') ~ '''(platos|plato|vinos|bebidas|cocteles|carta)'''
          or coalesce(with_check, '') ~ '''(platos|plato|vinos|bebidas|cocteles|carta)''');
  if sobrantes is not null then
    raise exception 'Sobrevive una política de escritura vieja en los buckets de la carta: %', sobrantes;
  end if;
end;
$$;

commit;

-- ===========================================================================
-- LO QUE ESTE FICHERO NO TAPA (fuera del encargo, visto al diagnosticar)
-- ===========================================================================
--   1. GRAVE — Storage: la política «Lectura pública de buckets» (SELECT
--      USING (true) TO anon, authenticated, service_role) deja a anon LISTAR
--      y DESCARGAR cualquier objeto de cualquier bucket, también de los
--      PRIVADOS: comprobado con `set role anon` → ve los 14 objetos de
--      `facturas-originales`. Anula la política facturas_originales_select.
--      No está en ninguna migración del repo (creada a mano). Pide su propia
--      migración: quitarla y dejar lectura pública solo por bucket público.
--   2. Las políticas SELECT duplicadas de las 4 tablas (3 por tabla, dos con
--      rol public) se dejan tal cual para no mover ni un milímetro la lectura
--      anónima. Se pueden consolidar más adelante (TO anon activado = true +
--      TO authenticated true) sin cambiar comportamiento.
--   3. can_write_section sigue mirando 'view' (ver Fase 2): cualquiera con
--      la sección gestor_carta escribe, aunque tenga can_edit = false.
--
-- ===========================================================================
-- VERIFICACIÓN tras aplicar (el juego completo: supabase/tests/carta_escritura_por_seccion_test.sql)
-- ===========================================================================
--   select tablename, policyname, cmd, roles::text
--   from pg_policies
--   where schemaname = 'public' and tablename in ('Platos','Vinos','Bebidas','Cocteles')
--   order by tablename, cmd, policyname;
--   -- -> por tabla: las SELECT de siempre (3; Cocteles 2) + <x>_insert/update/delete_seccion
--   --    {authenticated} + <x>_service_role (ALL, {service_role}). Ninguna escritura {public}.
--
--   select table_name, grantee, string_agg(privilege_type, ',' order by privilege_type)
--   from information_schema.role_table_grants
--   where table_schema = 'public' and table_name in ('Platos','Vinos','Bebidas','Cocteles')
--     and grantee in ('anon','authenticated')
--   group by 1, 2 order by 1, 2;
--   -- -> anon: SELECT · authenticated: DELETE,INSERT,REFERENCES,SELECT,TRIGGER,UPDATE (sin TRUNCATE)
--
--   select policyname, cmd from pg_policies
--   where schemaname = 'storage' and tablename = 'objects' and policyname like 'carta\_imagenes\_%';
--   -- -> 3 filas: insert, update, delete
--
--   La lectura anónima, igual que antes (debe coincidir con el recuento de activados):
--   set role anon; select count(*) from public."Platos"; reset role;
--   select count(*) from public."Platos" where activado;   -- hoy 128 / 128
-- ===========================================================================
