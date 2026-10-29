set client_encoding = 'UTF8';
-- ===========================================================================
-- BOTONES DE ACCIÓN EN LAS TARJETAS DE NOVEDADES (historia 4073221d, 2026-10-28)
-- ===========================================================================
-- «Llamar», «Ver menú» y «Échale un vistazo» al pie de cada novedad, elegidos
-- desde el gestor web del panel y pintados por la web (web-casatomas).
--
-- QUÉ AÑADE (aditiva: el panel y la web de hoy siguen funcionando igual)
--   1. novedades.botones jsonb NOT NULL DEFAULT '[]'
--        Array ordenado de 0 a 2 tipos distintos de
--        {"llamar", "ver_menu", "ver_plato"}. El orden es el de la pantalla.
--        Las filas existentes quedan con '[]' (sin botones, como hoy).
--   2. novedades.menu jsonb (NULL si la novedad no tiene «Ver menú»)
--        { "version": 1, "incluye_bebidas": bool,
--          "secciones": { "primero": [...], "segundo": [...],
--                         "postre": [...], "bebidas": [...] } }
--        Cada línea es el ItemMenu v2 del menú del día (src/lib/menu-dia.ts)
--        más `traducciones` {en, fr}. La BBDD solo comprueba la forma
--        exterior; el contenido de las secciones lo valida el panel.
--   3. Tres CHECK:
--        novedades_botones_validos    tipos, máximo 2 y sin repetir.
--        novedades_menu_forma         objeto con `secciones` objeto e
--                                     `incluye_bebidas` booleano.
--        novedades_ver_menu_con_menu  «Ver menú» exige `menu`.
--   4. Asegura que la FK novedades.plato_id → Platos(id) es ON DELETE SET NULL
--      (así está desde 20260114180149; si en algún entorno no lo estuviera,
--      la recrea y lo dice con un NOTICE).
--
-- DECISIONES
--   · CASE y no un AND suelto: Postgres no garantiza el orden de evaluación y
--     jsonb_array_length() lanza error si `botones` no es un array. Además,
--     `'"llamar"'::jsonb <@ '[...]'` es true (un escalar «cabe» en un array):
--     sin comprobar antes que es un array, una cadena suelta pasaría.
--   · coalesce(…, false) en cada comparación: un CHECK que da NULL se da por
--     bueno, y `menu->'incluye_bebidas'` ausente da NULL.
--   · NINGÚN CHECK mira plato_id. «Échale un vistazo ⇒ plato enlazado» lo
--     valida el panel al guardar. Con ON DELETE SET NULL, un CHECK así haría
--     fallar el borrado del plato en la carta; con la FK, la novedad sigue
--     siendo válida, la web oculta el botón y el panel avisa.
--   · RLS: no se crea ni se cambia ninguna política. «Público puede ver
--     novedades activas vigentes» y las de authenticated son por fila y cubren
--     las columnas nuevas; no hay GRANT por columnas en novedades.
--   · Sin índices nuevos: la tabla tiene menos de 200 filas y nadie filtra por
--     botones ni por menu.
--   · Auditoría (revertir_cambio_auditoria): no se toca. Los eventos
--     «eliminar» anteriores se siguen pudiendo restaurar (las columnas nuevas
--     toman su valor por defecto). Los «crear» y «actualizar» anteriores
--     pasan a dar «Hay cambios posteriores»: la fila actual tiene dos claves
--     que su instantánea no tiene. Es el mismo efecto que cualquier columna
--     nueva en una tabla auditada y falla del lado seguro (no sobrescribe).
--
-- COMPATIBILIDAD DURANTE EL DESPLIEGUE
--   La versión de PROD del panel guarda novedades sin enviar botones ni menu:
--   toman '[]' y NULL y pasan los CHECK. La web de PROD hace select("*") y
--   ignora las columnas nuevas. Por eso la migración puede ir antes que el
--   código. Al revés no: el panel nuevo solo envía estas claves cuando la
--   novedad tiene botones (plan del CTO, 2.4).
--
-- CANDADOS: ADD COLUMN con DEFAULT constante no reescribe la tabla. ADD
-- CONSTRAINT recorre las filas (menos de 200) con ACCESS EXCLUSIVE sobre
-- novedades durante milisegundos. Solo si hay que recrear la FK se toma
-- SHARE ROW EXCLUSIVE sobre Platos (las lecturas de la carta no esperan).
-- `lock_timeout = 5s` para no quedarse en cola detrás de algo largo.
--
-- ---------------------------------------------------------------------------
-- CÓMO SE APLICA (fase 2, no en desarrollo)
--   1. Primero en la DEMO, sfonaclosuafvlhutkon. Va entera en una
--      transacción: si falla, no se ha aplicado nada.
--   2. Comprobarla con las consultas de VERIFICACIÓN del pie (solo lectura).
--   3. En PRODUCCIÓN, haqmmdfdzzatdnrrcgez, SOLO después de que el dueño
--      acepte el PR staging → main del panel y lo pida explícitamente, y
--      justo después de aceptarlo. El proyecto viejo jeamoczmbfsnwkfjxcyo no
--      se toca.
--   Prueba local, sin Supabase: npm run test:novedades:db
--
-- Deshacer: bloque REVERSIÓN comentado al final de este fichero.
-- ===========================================================================

begin;

set local lock_timeout = '5s';

-- ---------------------------------------------------------------------------
-- 1. COLUMNAS
-- ---------------------------------------------------------------------------
alter table public.novedades
  add column if not exists botones jsonb not null default '[]'::jsonb,
  add column if not exists menu jsonb;

comment on column public.novedades.botones is
  'Botones de la tarjeta en la web, en orden: array de 0 a 2 tipos distintos de llamar, ver_menu y ver_plato. '
  'Las etiquetas salen del i18n de la web. ver_plato usa plato_id (lo valida el panel, no la BBDD).';
comment on column public.novedades.menu is
  'Menú de «Ver menú»: {version, incluye_bebidas, secciones: {primero, segundo, postre, bebidas}} con líneas ItemMenu v2 '
  'más traducciones {en, fr}. Copiado al componer, no enlazado a Platos. NULL si la novedad no tiene ver_menu.';

-- ---------------------------------------------------------------------------
-- 2. CHECK (se borran y se vuelven a crear para que la migración sea
--    reejecutable y deje siempre esta definición)
-- ---------------------------------------------------------------------------
alter table public.novedades
  drop constraint if exists novedades_ver_menu_con_menu,
  drop constraint if exists novedades_menu_forma,
  drop constraint if exists novedades_botones_validos;

alter table public.novedades
  add constraint novedades_botones_validos check (
    case when jsonb_typeof(botones) = 'array' then
      coalesce(
        jsonb_array_length(botones) <= 2
        and botones <@ '["llamar", "ver_menu", "ver_plato"]'::jsonb
        and (jsonb_array_length(botones) < 2 or botones->0 <> botones->1),
        false)
    else false end
  ),
  add constraint novedades_menu_forma check (
    menu is null or (
      case when jsonb_typeof(menu) = 'object' then
        coalesce(jsonb_typeof(menu->'secciones') = 'object', false)
        and coalesce(jsonb_typeof(menu->'incluye_bebidas') = 'boolean', false)
      else false end
    )
  ),
  add constraint novedades_ver_menu_con_menu check (
    not coalesce(botones ? 'ver_menu', false) or menu is not null
  );

-- ---------------------------------------------------------------------------
-- 3. FK plato_id → Platos(id) ON DELETE SET NULL
--    Se busca por columna y tabla, no por nombre. Se quitan las que no sean
--    SET NULL (una sola con NO ACTION/RESTRICT/CASCADE bastaría para que borrar
--    un plato fallara o se llevara la novedad) y, si no queda ninguna, se
--    crea. Si hubiera que crearla y existieran plato_id huérfanos, se ponen
--    a NULL antes: es lo que habría hecho la propia FK.
-- ---------------------------------------------------------------------------
do $$
declare
  v_fk record;
  v_set_null boolean := false;
  v_huerfanas integer;
begin
  for v_fk in
    select c.conname, c.confdeltype
    from pg_catalog.pg_constraint c
    join pg_catalog.pg_attribute a
      on a.attrelid = c.conrelid and a.attnum = c.conkey[1]
    where c.contype = 'f'
      and c.conrelid = 'public.novedades'::regclass
      and c.confrelid = 'public."Platos"'::regclass
      and cardinality(c.conkey) = 1
      and a.attname = 'plato_id'
  loop
    if v_fk.confdeltype = 'n' then
      v_set_null := true;
    else
      execute format('alter table public.novedades drop constraint %I', v_fk.conname);
      raise notice 'novedades.plato_id: quitada la FK % (confdeltype %), no era ON DELETE SET NULL',
        v_fk.conname, v_fk.confdeltype;
    end if;
  end loop;

  if v_set_null then
    raise notice 'novedades.plato_id: la FK ya es ON DELETE SET NULL, sin cambios';
    return;
  end if;

  update public.novedades n
     set plato_id = null
   where n.plato_id is not null
     and not exists (select 1 from public."Platos" p where p.id = n.plato_id);
  get diagnostics v_huerfanas = row_count;
  if v_huerfanas > 0 then
    raise notice 'novedades.plato_id: % fila(s) apuntaban a un plato inexistente, puestas a NULL', v_huerfanas;
  end if;

  alter table public.novedades
    add constraint novedades_plato_id_fkey
    foreign key (plato_id) references public."Platos"(id) on delete set null;
  raise notice 'novedades.plato_id: creada novedades_plato_id_fkey ON DELETE SET NULL';
end $$;

-- ---------------------------------------------------------------------------
-- 4. COMPROBACIÓN FINAL: si algo no quedó como debe, se deshace todo
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'novedades' and column_name = 'botones'
      and data_type = 'jsonb' and is_nullable = 'NO' and column_default like '''[]''::jsonb%'
  ) then
    raise exception 'novedades.botones no ha quedado como jsonb NOT NULL DEFAULT ''[]''';
  end if;
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'novedades' and column_name = 'menu'
      and data_type = 'jsonb' and is_nullable = 'YES'
  ) then
    raise exception 'novedades.menu no ha quedado como jsonb que admite NULL';
  end if;
  if (select count(*) from pg_catalog.pg_constraint
      where conrelid = 'public.novedades'::regclass and contype = 'c'
        and conname in ('novedades_botones_validos', 'novedades_menu_forma', 'novedades_ver_menu_con_menu')) <> 3 then
    raise exception 'Faltan CHECK de novedades';
  end if;
  if exists (
    select 1 from pg_catalog.pg_constraint c
    join pg_catalog.pg_attribute a on a.attrelid = c.conrelid and a.attnum = c.conkey[1]
    where c.contype = 'f' and c.conrelid = 'public.novedades'::regclass
      and a.attname = 'plato_id' and c.confdeltype <> 'n'
  ) or not exists (
    select 1 from pg_catalog.pg_constraint c
    join pg_catalog.pg_attribute a on a.attrelid = c.conrelid and a.attnum = c.conkey[1]
    where c.contype = 'f' and c.conrelid = 'public.novedades'::regclass
      and a.attname = 'plato_id' and c.confdeltype = 'n'
  ) then
    raise exception 'La FK de novedades.plato_id no es ON DELETE SET NULL';
  end if;
end $$;

commit;

-- ===========================================================================
-- VERIFICACIÓN (solo lectura, tras aplicarla en cada entorno)
--   -- columnas nuevas
--   select column_name, data_type, is_nullable, column_default
--     from information_schema.columns
--    where table_schema = 'public' and table_name = 'novedades'
--      and column_name in ('botones', 'menu');
--   -- CHECK y FK
--   select conname, contype, confdeltype, pg_get_constraintdef(oid)
--     from pg_constraint
--    where conrelid = 'public.novedades'::regclass
--      and (conname like 'novedades_botones%' or conname like 'novedades_menu%'
--           or conname like 'novedades_ver_menu%' or conname = 'novedades_plato_id_fkey');
--   -- ninguna novedad ha cambiado: todas sin botones y sin menú
--   select count(*) filter (where botones <> '[]'::jsonb or menu is not null) as con_botones,
--          count(*) as total
--     from public.novedades;
--   -- políticas sin cambios (las mismas que antes de aplicarla)
--   select policyname, roles, cmd from pg_policies
--    where schemaname = 'public' and tablename = 'novedades' order by policyname;
--   Y la lectura anónima por PostgREST con la anon key:
--   GET /rest/v1/novedades?select=id,botones,menu&limit=1
-- ===========================================================================

-- ===========================================================================
-- REVERSIÓN (comentada: no se ejecuta con la migración)
--   · Antes, volver a la versión anterior del panel y de la web: el panel
--     nuevo envía botones y menu y fallaría sin las columnas.
--   · Pierde los botones y menús configurados después de aplicarla. Si hay
--     alguno, guardarlo antes:
--       select id, titulo, botones, menu, plato_id from public.novedades
--        where botones <> '[]'::jsonb or menu is not null;
--   · La FK de plato_id no se toca: ON DELETE SET NULL es su definición
--     original (20260114180149).
--   · La prueba local la ejecuta tal cual (npm run test:novedades:db): cada
--     línea entre los dos marcadores es SQL con «-- » delante.
-- >>> REVERSIÓN
-- begin;
-- set local lock_timeout = '5s';
-- alter table public.novedades
--   drop constraint if exists novedades_ver_menu_con_menu,
--   drop constraint if exists novedades_menu_forma,
--   drop constraint if exists novedades_botones_validos;
-- alter table public.novedades
--   drop column if exists menu,
--   drop column if exists botones;
-- commit;
-- <<< FIN REVERSIÓN
-- ===========================================================================
