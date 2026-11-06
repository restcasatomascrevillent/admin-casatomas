set client_encoding = 'UTF8';
-- ===========================================================================
-- 20261108000000_instagram_ia — IA de textos de Instagram, fase 1 (08/11/2026)
-- ===========================================================================
-- Diseño: instagram-studio/propuesta/PROPUESTA.md, apartados 3.1-3.6 y fila
-- «1» del apartado 7. Documentación: docs/instagram-ia.md.
--
-- QUÉ CREA
--   * public.instagram_guias_marca: la guía de tono de cada marca (una fila
--     por marca, «casa-tomas» y «touza»), con su versión, los hashtags base y
--     la lista CERRADA de CTA. La lee la Edge Function instagram-ia (con el JWT
--     del usuario) y se la pasa al modelo como datos. Se siembra con
--     instagram-studio/propuesta/marca-base (readme.md, CONTENT FUNDAMENTALS,
--     y guidelines/brand-voice.html). La siembra NO pisa una guía ya editada
--     (on conflict do nothing). Al cambiar la guía, los hashtags o las CTA
--     sube la versión y se anota quién y cuándo (trigger).
--   * public.instagram_sugerencias_ia: registro de cada petición a la IA
--     (entrada SIN datos personales, salida ya validada, modelo, tokens y si
--     se eligió alguna variante). Sirve para auditar y para medir qué
--     propuestas se usan. Lo escribe la función con el JWT del usuario.
--   * Alta de «instagram-ia» en public.ia_funciones (si existe) con
--     instrumentada = false: se pone a true el MISMO día que se despliegue la
--     función (ver supabase/functions/_shared/ENGANCHE-REGISTRO-IA.md).
--
--   RLS (sección «marketing», como instagram_piezas):
--     guías        · LEER can_read_section('marketing'); CAMBIAR (solo UPDATE
--                    de guia, hashtags_base y ctas) can_write_section('marketing').
--                    Insertar y borrar marcas, solo service_role (son dos filas fijas).
--     sugerencias  · LEER can_read_section('marketing'); INSERTAR
--                    can_write_section('marketing') (creado_por lo pone el
--                    servidor); MARCAR la elegida (UPDATE de aceptada y
--                    variante_elegida) solo quien la pidió; borrar, nadie del
--                    panel (rastro de auditoría).
--     Las dos, además, con la política restrictiva acceso_panel_no_bloqueado
--     (sesión de panel viva) si existe private.sesion_panel_permitida(). anon nada.
--
-- APLICAR (una a una, nunca `db push`): demo primero (sfonaclosuafvlhutkon),
-- producción (haqmmdfdzzatdnrrcgez) solo tras aceptar el PR y con el «sí» del
-- dueño. Necesita antes 20261105090000_instagram.sql.
--   npx supabase db query --linked -f supabase/migrations/20261108000000_instagram_ia.sql
-- Idempotente. Tiene que terminar en «instagram_ia: aplicada».
-- Deshacer: supabase/rollbacks/20261108000000_instagram_ia_ROLLBACK.sql
-- Pruebas: node scripts/test-instagram-ia.mjs (PGlite).
-- ===========================================================================

begin;
set local lock_timeout = '5s';

-- ─── 0. Comprobaciones previas (no cambian nada) ────────────────────────────
do $$
declare
  v_faltan text[] := '{}';
begin
  if to_regprocedure('public.can_read_section(text)') is null then
    v_faltan := v_faltan || 'public.can_read_section(text)'::text;
  end if;
  if to_regprocedure('public.can_write_section(text)') is null then
    v_faltan := v_faltan || 'public.can_write_section(text)'::text;
  end if;
  if to_regclass('public.instagram_piezas') is null then
    v_faltan := v_faltan || 'public.instagram_piezas (aplica antes 20261105090000_instagram.sql)'::text;
  end if;
  if cardinality(v_faltan) > 0 then
    raise exception 'instagram_ia: falta %. No se ha cambiado nada.', array_to_string(v_faltan, ', ');
  end if;
end;
$$;

-- ─── 1. Guía de tono por marca ──────────────────────────────────────────────
create table if not exists public.instagram_guias_marca (
  marca            text primary key,
  version          integer not null default 1,
  guia             text not null,
  hashtags_base    text[] not null default '{}',
  ctas             text[] not null default '{}',
  actualizado_por  uuid references auth.users (id) on delete set null,
  updated_at       timestamptz not null default now(),
  constraint instagram_guias_marca_marca_chk    check (marca in ('casa-tomas', 'touza')),
  constraint instagram_guias_marca_version_chk  check (version >= 1),
  constraint instagram_guias_marca_guia_chk     check (char_length(btrim(guia)) between 1 and 8000),
  constraint instagram_guias_marca_hashtags_chk check (
    cardinality(hashtags_base) <= 30 and pg_column_size(hashtags_base) <= 4096),
  constraint instagram_guias_marca_ctas_chk     check (cardinality(ctas) <= 20 and pg_column_size(ctas) <= 4096)
);
comment on table public.instagram_guias_marca is
  'Guía de tono de cada marca para la IA de textos de Instagram (Edge Function instagram-ia). '
  'Sembrada con marca-base (readme.md, CONTENT FUNDAMENTALS y brand-voice). La edita quien tenga Marketing (edición). Ver docs/instagram-ia.md.';
comment on column public.instagram_guias_marca.version is 'Sube sola al cambiar guia, hashtags_base o ctas.';
comment on column public.instagram_guias_marca.guia is 'Texto de la guía (voz, tono, reglas). Se pasa al modelo como datos.';
comment on column public.instagram_guias_marca.hashtags_base is 'Hashtags de la marca. La IA elige de aquí y añade como mucho 4 nuevos.';
comment on column public.instagram_guias_marca.ctas is 'Lista CERRADA de llamadas a la acción. La función quita de los rótulos cualquier CTA que no esté aquí.';

create or replace function public.instagram_guias_marca_al_editar()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' then
    new.marca := old.marca;
    if new.guia is distinct from old.guia
       or new.hashtags_base is distinct from old.hashtags_base
       or new.ctas is distinct from old.ctas then
      new.version := old.version + 1;
    else
      new.version := old.version;
    end if;
  end if;
  new.actualizado_por := auth.uid();
  new.updated_at := now();
  return new;
end;
$$;
revoke all on function public.instagram_guias_marca_al_editar() from public;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on function public.instagram_guias_marca_al_editar() from anon, authenticated';
  end if;
end;
$$;
drop trigger if exists instagram_guias_marca_al_editar on public.instagram_guias_marca;
create trigger instagram_guias_marca_al_editar
  before insert or update on public.instagram_guias_marca
  for each row execute function public.instagram_guias_marca_al_editar();

-- ─── 2. Registro de sugerencias de la IA ────────────────────────────────────
create table if not exists public.instagram_sugerencias_ia (
  id                uuid primary key default gen_random_uuid(),
  tipo              text not null,
  marca             text not null,
  pieza_id          uuid references public.instagram_piezas (id) on delete set null,
  entrada           jsonb not null default '{}'::jsonb,
  salida            jsonb not null default '{}'::jsonb,
  modelo            text not null,
  version_guia      integer,
  variantes         smallint not null default 0,
  descartadas       smallint not null default 0,
  tokens_entrada    integer,
  tokens_salida     integer,
  aceptada          boolean,
  variante_elegida  smallint,
  creado_por        uuid default auth.uid() references auth.users (id) on delete set null,
  created_at        timestamptz not null default now(),
  constraint instagram_sugerencias_ia_tipo_chk      check (tipo in ('sugerir_texto', 'sugerir_rotulos')),
  constraint instagram_sugerencias_ia_marca_chk     check (marca in ('casa-tomas', 'touza')),
  constraint instagram_sugerencias_ia_modelo_chk    check (modelo ~ '^[A-Za-z0-9._:-]{1,80}$'),
  constraint instagram_sugerencias_ia_json_chk      check (
    jsonb_typeof(entrada) = 'object' and jsonb_typeof(salida) = 'object'
    and pg_column_size(entrada) <= 16384 and pg_column_size(salida) <= 65536),
  constraint instagram_sugerencias_ia_cuentas_chk   check (
    variantes between 0 and 10 and descartadas between 0 and 10
    and coalesce(tokens_entrada, 0) >= 0 and coalesce(tokens_salida, 0) >= 0),
  constraint instagram_sugerencias_ia_elegida_chk   check (
    variante_elegida is null or (variante_elegida between 0 and 9 and aceptada is true))
);
comment on table public.instagram_sugerencias_ia is
  'Cada petición a la IA de textos de Instagram (instagram-ia): entrada sin datos personales, salida validada, '
  'modelo y tokens, y si se eligió una variante. Nunca publica nada. Ver docs/instagram-ia.md.';
comment on column public.instagram_sugerencias_ia.entrada is 'Lo que se pidió (marca, plantilla, plato, tono, indicaciones ya sin correos ni teléfonos). Nunca datos de clientes.';
comment on column public.instagram_sugerencias_ia.salida is 'Variantes que pasaron los validadores y motivos de las descartadas.';
comment on column public.instagram_sugerencias_ia.aceptada is 'true cuando alguien elige una variante en el panel (la elección la hace una persona).';
comment on column public.instagram_sugerencias_ia.creado_por is 'Quién la pidió: lo pone el servidor (auth.uid()), no el cliente.';

create index if not exists instagram_sugerencias_ia_usuario_fecha_idx
  on public.instagram_sugerencias_ia (creado_por, created_at desc);
create index if not exists instagram_sugerencias_ia_pieza_idx
  on public.instagram_sugerencias_ia (pieza_id) where pieza_id is not null;

-- creado_por y created_at los pone el servidor; al marcar la elegida no se
-- puede tocar nada más (además de los permisos por columna de abajo).
create or replace function public.instagram_sugerencias_ia_al_editar()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    new.creado_por := coalesce(auth.uid(), new.creado_por);
    new.created_at := now();
    new.aceptada := null;
    new.variante_elegida := null;
  else
    new.id := old.id;
    new.tipo := old.tipo;
    new.marca := old.marca;
    -- pieza_id solo puede quedar a NULL (on delete set null al borrar la pieza).
    new.pieza_id := case when new.pieza_id is null then null else old.pieza_id end;
    new.entrada := old.entrada;
    new.salida := old.salida;
    new.modelo := old.modelo;
    new.version_guia := old.version_guia;
    new.variantes := old.variantes;
    new.descartadas := old.descartadas;
    new.tokens_entrada := old.tokens_entrada;
    new.tokens_salida := old.tokens_salida;
    new.creado_por := old.creado_por;
    new.created_at := old.created_at;
    if new.variante_elegida is not null and new.variante_elegida >= old.variantes then
      raise exception 'instagram_sugerencias_ia: la variante % no existe (hay %)', new.variante_elegida, old.variantes
        using errcode = '22023';
    end if;
  end if;
  return new;
end;
$$;
revoke all on function public.instagram_sugerencias_ia_al_editar() from public;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on function public.instagram_sugerencias_ia_al_editar() from anon, authenticated';
  end if;
end;
$$;
drop trigger if exists instagram_sugerencias_ia_al_editar on public.instagram_sugerencias_ia;
create trigger instagram_sugerencias_ia_al_editar
  before insert or update on public.instagram_sugerencias_ia
  for each row execute function public.instagram_sugerencias_ia_al_editar();

-- ─── 3. Auditoría (mismo trigger que instala instalar_auditoria_panel()) ────
do $$
declare
  v_tabla text;
begin
  if to_regprocedure('public.fn_registrar_auditoria()') is null then
    return;
  end if;
  foreach v_tabla in array array['instagram_guias_marca', 'instagram_sugerencias_ia'] loop
    if not exists (select 1 from pg_trigger
                    where tgrelid = format('public.%I', v_tabla)::regclass
                      and tgfoid = 'public.fn_registrar_auditoria()'::regprocedure
                      and not tgisinternal) then
      execute format('drop trigger if exists trg_auditoria on public.%I', v_tabla);
      execute format('create trigger trg_auditoria after insert or update or delete on public.%I
                      for each row execute function public.fn_registrar_auditoria()', v_tabla);
    end if;
  end loop;
end;
$$;

-- ─── 4. Permisos y RLS ──────────────────────────────────────────────────────
alter table public.instagram_guias_marca enable row level security;
alter table public.instagram_sugerencias_ia enable row level security;
revoke all on public.instagram_guias_marca from public;
revoke all on public.instagram_sugerencias_ia from public;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on public.instagram_guias_marca, public.instagram_sugerencias_ia from anon, authenticated';
    execute 'grant select on public.instagram_guias_marca to authenticated';
    execute 'grant update (guia, hashtags_base, ctas) on public.instagram_guias_marca to authenticated';
    execute 'grant select, insert on public.instagram_sugerencias_ia to authenticated';
    execute 'grant update (aceptada, variante_elegida) on public.instagram_sugerencias_ia to authenticated';
    execute 'grant all on public.instagram_guias_marca, public.instagram_sugerencias_ia to service_role';
  end if;
end;
$$;

drop policy if exists instagram_guias_marca_select_seccion on public.instagram_guias_marca;
create policy instagram_guias_marca_select_seccion on public.instagram_guias_marca
  for select to authenticated using ((select public.can_read_section('marketing')));
drop policy if exists instagram_guias_marca_update_seccion on public.instagram_guias_marca;
create policy instagram_guias_marca_update_seccion on public.instagram_guias_marca
  for update to authenticated
  using ((select public.can_write_section('marketing')))
  with check ((select public.can_write_section('marketing')));
drop policy if exists instagram_guias_marca_service_role on public.instagram_guias_marca;
create policy instagram_guias_marca_service_role on public.instagram_guias_marca
  for all to service_role using (true) with check (true);

drop policy if exists instagram_sugerencias_ia_select_seccion on public.instagram_sugerencias_ia;
create policy instagram_sugerencias_ia_select_seccion on public.instagram_sugerencias_ia
  for select to authenticated using ((select public.can_read_section('marketing')));
drop policy if exists instagram_sugerencias_ia_insert_seccion on public.instagram_sugerencias_ia;
create policy instagram_sugerencias_ia_insert_seccion on public.instagram_sugerencias_ia
  for insert to authenticated with check ((select public.can_write_section('marketing')));
drop policy if exists instagram_sugerencias_ia_update_propia on public.instagram_sugerencias_ia;
create policy instagram_sugerencias_ia_update_propia on public.instagram_sugerencias_ia
  for update to authenticated
  using ((select public.can_write_section('marketing')) and creado_por = (select auth.uid()))
  with check ((select public.can_write_section('marketing')) and creado_por = (select auth.uid()));
drop policy if exists instagram_sugerencias_ia_service_role on public.instagram_sugerencias_ia;
create policy instagram_sugerencias_ia_service_role on public.instagram_sugerencias_ia
  for all to service_role using (true) with check (true);

do $$
declare
  v_tabla text;
begin
  if to_regprocedure('private.sesion_panel_permitida()') is null then
    return;
  end if;
  foreach v_tabla in array array['instagram_guias_marca', 'instagram_sugerencias_ia'] loop
    execute format('drop policy if exists "acceso_panel_no_bloqueado" on public.%I', v_tabla);
    execute format('create policy "acceso_panel_no_bloqueado" on public.%I as restrictive for all to authenticated
      using ((select private.sesion_panel_permitida())) with check ((select private.sesion_panel_permitida()))', v_tabla);
  end loop;
end;
$$;

-- ─── 5. Siembra de las guías (marca-base, 05/11/2026) ───────────────────────
-- No pisa una guía ya editada en el panel: on conflict do nothing.
insert into public.instagram_guias_marca (marca, guia, hashtags_base, ctas)
values
(
  'casa-tomas',
  $guia$Restaurante Casa Tomás (Crevillent, Alicante). Cocina tradicional con alma gallega: un restaurante familiar y de barrio desde 1998, con producto del mar (mariscos, pescados, salazones) y carnes.

Voz
- Hablamos en «nosotros» y tratamos al cliente de «tú» («Disfruta», «Te esperamos», «Sorprende a alguien especial»).
- Tono cálido, familiar y honesto. Frases completas, sin exageración ni superlativos vacíos.
- Palabras clave: tradición, producto, familia, barrio, «volver a casa».
- Frase de marca: «Que cada visita se sienta como volver a casa.»
- El gallego solo como firma emocional, en la apertura o el cierre, sobre todo con el lema: «Nunca é longo o camiño que conduce á casa dun amigo.» Nunca en lo informativo.

Reglas
- Sin emoji, nunca.
- Titulares en tipo frase, de 6 palabras como mucho.
- Precios con el formato «22,5 €» y solo si vienen de la carta: nunca inventar precios.
- Los alérgenos se indican siempre y solo los oficiales: nunca afirmar «sin gluten», «apto para celíacos» ni parecidos si la carta no lo dice.
- Solo platos que estén en la carta. Nada de horarios, fechas ni aperturas que no se hayan dado.
- El nombre del pueblo se escribe «Crevillent».
- CTA solo de la lista cerrada.$guia$,
  array['#CasaTomás', '#Crevillent', '#CocinaGallega', '#RestauranteAlicante', '#ProductoGallego'],
  array['Reservar mesa', 'Ver carta', 'Ver la carta completa', 'Regala una experiencia', 'Comprar cheque regalo', 'Llamar']
),
(
  'touza',
  $guia$TOUZA Cocktail Bar (Crevillent), coctelería premium desde 2023, «Parte de Restaurante Casa Tomás». Mezcla las raíces gallegas con el Mediterráneo.

Voz
- Hablamos en «nosotros» y tratamos al cliente de «tú».
- Tono evocador y seguro. Frases cortas, con contundencia.
- Palabras clave: alquimia, excelencia, intimidad, «declaración de intenciones».
- Frase de marca: «Touza no es solo un bar; es una declaración de intenciones.»
- El gallego solo como firma emocional, en la apertura o el cierre. Nunca en lo informativo.

Reglas
- «TOUZA» siempre en mayúsculas.
- Sin emoji, nunca.
- TOUZA no admite reservas: nunca escribir «reservar», «reserva» ni nada parecido.
- Alcohol con responsabilidad: no asociarlo a conducir, a menores, a la salud, al rendimiento ni al éxito social o sexual; invitar al consumo responsable.
- Precios con el formato «22,5 €» y solo si vienen de la carta: nunca inventar precios.
- Los alérgenos se indican siempre y solo los oficiales: nunca afirmar «sin gluten» ni parecidos si la carta no lo dice.
- Solo lo que esté en la carta. Nada de horarios, fechas ni aperturas que no se hayan dado.
- CTA solo de la lista cerrada.$guia$,
  array['#TOUZA', '#TouzaCocktailBar', '#Crevillent', '#Coctelería', '#CóctelesDeAutor'],
  array['Ver carta', 'Nuestra Carta', 'Regala una experiencia']
)
on conflict (marca) do nothing;

-- ─── 6. Catálogo de funciones de IA (pantalla /super-admin/costes) ──────────
-- instrumentada = false hasta el día del despliegue (ENGANCHE-REGISTRO-IA.md):
--   update public.ia_funciones set instrumentada = true where funcion = 'instagram-ia';
-- La tarifa de gpt-5.6-luna ya está en ia_precios (20260928193000_costes_sistema.sql).
do $$
begin
  if to_regclass('public.ia_funciones') is not null then
    insert into public.ia_funciones (funcion, descripcion, instrumentada, unidad, orden)
    values ('instagram-ia',
            'Marketing › Instagram: propone textos (3 variantes con caption, hashtags y texto alternativo) y rótulos para una pieza. '
            'Clave general OPENAI_API_KEY; disparador pieza:<uuid> o usuario:<uuid>.',
            false, 'petición', 95)
    on conflict (funcion) do nothing;
  end if;
end;
$$;

-- ─── 7. Comprobación final ──────────────────────────────────────────────────
do $$
declare
  v_malos text[] := '{}';
  v_tabla text;
begin
  foreach v_tabla in array array['instagram_guias_marca', 'instagram_sugerencias_ia'] loop
    if not (select relrowsecurity from pg_class where oid = format('public.%I', v_tabla)::regclass) then
      v_malos := v_malos || format('RLS apagada en %s', v_tabla);
    end if;
    if exists (select 1 from pg_roles where rolname = 'anon') then
      if has_table_privilege('anon', format('public.%I', v_tabla), 'SELECT')
         or has_table_privilege('anon', format('public.%I', v_tabla), 'INSERT')
         or has_table_privilege('anon', format('public.%I', v_tabla), 'UPDATE')
         or has_table_privilege('anon', format('public.%I', v_tabla), 'DELETE') then
        v_malos := v_malos || format('anon tiene acceso a %s', v_tabla);
      end if;
      if has_table_privilege('authenticated', format('public.%I', v_tabla), 'DELETE')
         or has_table_privilege('authenticated', format('public.%I', v_tabla), 'TRUNCATE') then
        v_malos := v_malos || format('authenticated puede borrar en %s', v_tabla);
      end if;
    end if;
  end loop;
  if (select count(*) from public.instagram_guias_marca) < 2 then
    v_malos := v_malos || 'faltan las guías sembradas'::text;
  end if;
  if cardinality(v_malos) > 0 then
    raise exception 'instagram_ia: comprobación final fallida (%). No se ha aplicado nada.', array_to_string(v_malos, '; ');
  end if;
  raise notice 'instagram_ia: aplicada';
end;
$$;

commit;

-- VERIFICACIÓN:
--   select marca, version, cardinality(hashtags_base), ctas from public.instagram_guias_marca order by 1;
--   select policyname, cmd, roles from pg_policies where tablename in ('instagram_guias_marca', 'instagram_sugerencias_ia') order by 1;
--   select funcion, instrumentada from public.ia_funciones where funcion = 'instagram-ia';
