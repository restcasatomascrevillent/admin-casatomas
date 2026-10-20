set client_encoding = 'UTF8';
-- (Primera línea a propósito: comentarios con tilde; psql en una consola de
-- Windows puede arrancar en WIN1252.)
-- ===========================================================================
-- ##                                                                       ##
-- ##          NO APLICADA: la aplica el dueño a mano (ver pasos)           ##
-- ##                                                                       ##
-- ##   Facturas · proveedores unificados: un proveedor = una fila, con     ##
-- ##   todas sus formas de escribirse (punto 11 del dueño, 07/10/2026)     ##
-- ##                                                                       ##
-- ===========================================================================
--
-- POR QUÉ
--   El mismo proveedor llega con nombres distintos según el documento y las
--   sumas por proveedor (chatbot, Productos, vistas) se parten: «JOSELITO
--   (Cárnicas Joselito)» en el albarán y «Cárnicas Joselito S.A.» en la
--   factura salían como dos proveedores; «HEREDEROS ANGEL MARIÑO HERMO C.B.
--   (ANGELMAR)» no casaba con «Angelmar»; el CIF llega con y sin guion
--   (B-32455032 / B32455032).
--
-- CÓMO (sin reescribir ninguna RPC)
--   Todas las RPC del chatbot, las vistas y el panel agrupan por
--   facturas.proveedor_normalizado o llaman a normalizar_proveedor(text).
--   proveedor_normalizado era una columna GENERADA con normalizar_proveedor
--   (IMMUTABLE): no puede leer tablas. Por eso:
--   1. normalizar_proveedor_base(text) IMMUTABLE = el cuerpo EXACTO de la
--      normalizar_proveedor de siempre (md5 comprobado).
--   2. proveedores (la tabla que ya existía, con 1 fila de ejemplo): + CIF
--      normalizado (generado, único si no es null; sin guiones/espacios, en
--      mayúsculas, sin «ES» delante), nombre comercial, nombre normalizado
--      (generado) y origen. Nunca puede ser el cliente (MASIDE 2011 S.L.,
--      B54583356 = Casa Tomás): CHECK.
--   3. proveedores_alias: nombre normalizado → proveedor (o CIF extra →
--      proveedor, p. ej. el de un proveedor fusionado). El nombre canónico y
--      el comercial de cada proveedor son siempre alias suyos (trigger).
--   4. facturas.proveedor_id (FK nullable, ON DELETE SET NULL) + índice.
--   5. facturas.proveedor_normalizado deja de ser generada (DROP EXPRESSION,
--      conserva los valores y el índice) y la mantiene un trigger: el nombre
--      canónico normalizado del proveedor asignado, o lo de siempre
--      (normalizar_proveedor_base) si no hay proveedor.
--   6. normalizar_proveedor(text): MISMA firma, ahora STABLE (ya no la usa
--      ningún índice ni columna generada): si el texto normalizado es un
--      alias, devuelve el nombre canónico normalizado de su proveedor; si
--      no, lo de siempre. SECURITY INVOKER: quien no puede leer Facturas
--      (RLS, o anon sin privilegio) recibe lo de siempre.
--   7. Facturas nuevas (procesar-factura/guardado.ts, ocr_sustituir_factura,
--      el panel…): trigger BEFORE INSERT/UPDATE OF proveedor, cif,
--      proveedor_id, proveedor_normalizado. Busca por CIF normalizado (el del
--      cliente no cuenta), luego por alias; si no existe, CREA el proveedor
--      (con su CIF si tiene forma de CIF/NIF) sin IA. Aprende las variantes:
--      si casa por CIF con otro nombre, ese nombre pasa a ser alias. Si el
--      «proveedor» es el cliente, se queda sin proveedor_id.
--   8. RPC: proveedores_listado() (lectura, pasa por la RLS),
--      proveedores_editar(id, nombre, nombre_comercial, cif) y
--      proveedores_fusionar(origenes[], destino) — SECURITY DEFINER con
--      can_write_section('facturas') o service_role dentro.
--   9. CARGA INICIAL (datos explícitos revisados a mano el 07/10/2026 sobre
--      las 20 facturas/albaranes que había): 15 proveedores, sus alias y
--      facturas.proveedor_id por id. Solo se hace una vez (si no hay ningún
--      proveedor con origen 'carga_inicial'). Lo que haya entrado después se
--      asigna con la misma regla del trigger. Borra la fila «Proveedor
--      Ejemplo» (id 1, sin CIF ni uso).
--
-- NO CAMBIA: facturas.proveedor (el texto del documento se queda tal cual),
--   verificar_duplicado_factura / ocr_factura_existente (comparan
--   numero_documento y el texto del proveedor, no proveedor_normalizado: la
--   detección de duplicados es la misma), el UNIQUE (numero_documento,
--   proveedor), historial_precios (guarda el texto del documento;
--   historial_precios_agente agrupa por proveedor_normalizado → se beneficia).
--   No depende de 20261007150000 ni 20261007160000 (no usa pg_trgm).
--
-- PASOS (desde adminpanelct/, POR TERMINAL; no en el SQL Editor)
--   1. npx supabase db query --linked -f supabase/migrations/20261007180000_proveedores_unificados.sql
--      Tiene que imprimir «proveedores_unificados: aplicada | 15 | 20 | 20/20»
--      (más si han entrado documentos después: los nuevos se asignan solos).
--   2. npx supabase db query --linked -f supabase/tests/proveedores_unificados_test.sql
--      (BEGIN … ROLLBACK: no deja nada escrito). Tiene que acabar en
--      «proveedores_unificados_test: OK».
--   3. Publicar el panel (Facturas › Productos: filtro por proveedor canónico
--      y botón «Proveedores»). Sin la migración, el panel funciona igual que
--      antes y el diálogo avisa de que falta.
--   Orden: independiente de 20261007150000/160000/170000; si se aplican el
--   mismo día, da igual antes o después.
--   Deshacer: supabase/rollbacks/20261007180000_proveedores_unificados_ROLLBACK.sql
--   Idempotente: se puede ejecutar dos veces (la carga inicial no se repite).
--   lock_timeout = 5s: un 55P03 no ha cambiado nada; reintentar.
-- ===========================================================================

begin;
set local lock_timeout = '5s';

-- ─── 0. Comprobación previa (aborta sin tocar nada) ─────────────────────────
do $$
declare
  v_gen text;
begin
  if to_regprocedure('public.normalizar_proveedor(text)') is null
     or to_regprocedure('public.can_read_section(text)') is null
     or to_regprocedure('public.can_write_section(text)') is null
     or to_regclass('public.proveedores') is null
     or to_regclass('public.facturas') is null then
    raise exception 'proveedores_unificados: faltan normalizar_proveedor / can_*_section / proveedores / facturas. No se ha cambiado nada.';
  end if;
  select a.attgenerated into v_gen
    from pg_attribute a
   where a.attrelid = 'public.facturas'::regclass and a.attname = 'proveedor_normalizado' and not a.attisdropped;
  if v_gen is null then
    raise exception 'proveedores_unificados: falta facturas.proveedor_normalizado. No se ha cambiado nada.';
  end if;
  -- Primera vez: la normalizar_proveedor tiene que ser la de siempre.
  if v_gen = 's'
     and md5(replace((select prosrc from pg_proc where oid = 'public.normalizar_proveedor(text)'::regprocedure), chr(13), ''))
         <> 'a4ab6d3511b714766d6f993a399a8d92' then
    raise exception 'proveedores_unificados: normalizar_proveedor no es la esperada (alguien la ha cambiado). No se ha cambiado nada.';
  end if;
  if exists (select 1 from information_schema.columns
              where table_schema = 'public' and table_name = 'facturas'
                and column_name = 'proveedor_id' and data_type <> 'bigint') then
    raise exception 'proveedores_unificados: facturas.proveedor_id ya existe con otro tipo. No se ha cambiado nada.';
  end if;
end;
$$;

-- ─── 1. Funciones puras ─────────────────────────────────────────────────────
-- La normalización de siempre (cuerpo idéntico a la normalizar_proveedor
-- anterior: trim, minúsculas, sin tildes, sin paréntesis ni forma jurídica final).
create or replace function public.normalizar_proveedor_base(p_proveedor text)
 RETURNS text
 LANGUAGE plpgsql
 IMMUTABLE STRICT
 SET search_path TO 'public'
AS $function$
DECLARE
  v_texto TEXT;
BEGIN
  -- Normalizar: trim + lowercase + quitar acentos
  v_texto := trim(lower(unaccent(p_proveedor)));
  
  -- PASO 1: Eliminar alias/apodos entre paréntesis "(nombre comercial)"
  v_texto := regexp_replace(v_texto, '\s*\([^)]*\)', '', 'g');
  
  -- PASO 2: Eliminar sufijos legales al FINAL del string
  -- Ordenados de más largo a más corto para evitar match parcial
  -- Usamos $ para anclar al final, con posible puntuación antes
  v_texto := regexp_replace(v_texto,
    '[,\s]+(sociedad\s+limitada\s+unipersonal|sociedad\s+anonima\s+unipersonal|sociedad\s+cooperativa|sociedad\s+limitada|sociedad\s+anonima|s\.l\.u\.|s\.a\.u\.|s\.l\.|s\.a\.|s\.c\.p\.|s\.c\.l\.|s\.c\.|s\.coop\.?|slu|sau|sl|sa|cb|sc)\s*$',
    '', 'gi');
  
  -- PASO 3: Limpiar comas, puntos y espacios sobrantes al final
  v_texto := regexp_replace(v_texto, '[,.\s]+$', '');
  
  -- PASO 4: Colapsar espacios múltiples
  v_texto := regexp_replace(trim(v_texto), '\s+', ' ', 'g');
  
  RETURN v_texto;
END;
$function$;
comment on function public.normalizar_proveedor_base(text) is
  'Normalización de nombre de proveedor SIN alias (la normalizar_proveedor anterior a 20261007180000, idéntica). '
  'La usan proveedores.nombre_normalizado, proveedores_alias y el trigger de facturas.';

-- CIF/NIF: sin guiones, espacios ni puntos, en mayúsculas y sin el «ES» del
-- NIF-IVA. '' → null.
create or replace function public.normalizar_cif(p_cif text)
returns text
language sql
immutable parallel safe
set search_path = ''
as $$
  select case when t.s ~ '^ES[0-9A-Z]{9}$' then substr(t.s, 3) else nullif(t.s, '') end
    from (select upper(regexp_replace(coalesce(p_cif, ''), '[^0-9A-Za-z]', '', 'g')) as s) t
$$;
comment on function public.normalizar_cif(text) is
  'CIF/NIF normalizado: sin guiones/espacios/puntos, mayúsculas, sin prefijo ES de NIF-IVA; vacío → null.';

-- ¿Tiene forma de CIF (letra + 7 cifras + control), NIF o NIE? (sin dígito de control)
create or replace function public.proveedor_cif_valido(p_cif text)
returns boolean
language sql
immutable parallel safe
set search_path = ''
as $$
  select coalesce(p_cif ~ '^([ABCDEFGHJNPQRSUVW][0-9]{7}[0-9A-J]|[0-9]{8}[A-Z]|[KLMXYZ][0-9]{7}[A-Z])$', false)
$$;

-- El cliente (Casa Tomás = MASIDE 2011 S.L., B54583356) nunca es proveedor.
-- p_base = normalizar_proveedor_base(nombre); p_cif = normalizar_cif(cif).
create or replace function public.proveedor_es_cliente(p_base text, p_cif text)
returns boolean
language sql
immutable parallel safe
set search_path = ''
as $$
  select coalesce(p_cif = 'B54583356', false)
      or coalesce(p_base ~ '^(maside 2011|casa tomas)( |,|$)', false)
$$;
comment on function public.proveedor_es_cliente(text, text) is
  'true si el nombre normalizado o el CIF normalizado son del cliente (MASIDE 2011 S.L. / Casa Tomás, B54583356): nunca es proveedor.';

-- ─── 2. proveedores (la tabla que ya existía) ───────────────────────────────
alter table public.proveedores add column if not exists nombre_comercial text;
alter table public.proveedores add column if not exists origen text;
alter table public.proveedores
  add column if not exists cif_normalizado text generated always as (public.normalizar_cif(cif::text)) stored;
alter table public.proveedores
  add column if not exists nombre_normalizado text generated always as (public.normalizar_proveedor_base(nombre::text)) stored;
alter table public.proveedores alter column origen set default 'manual';

do $$
begin
  if not exists (select 1 from pg_constraint where conrelid = 'public.proveedores'::regclass
                    and conname = 'proveedores_origen_check') then
    alter table public.proveedores add constraint proveedores_origen_check
      check (origen is null or origen in ('carga_inicial', 'automatico', 'manual'));
  end if;
  if not exists (select 1 from pg_constraint where conrelid = 'public.proveedores'::regclass
                    and conname = 'proveedores_no_es_cliente') then
    alter table public.proveedores add constraint proveedores_no_es_cliente
      check (not public.proveedor_es_cliente(public.normalizar_proveedor_base(nombre::text), public.normalizar_cif(cif::text)));
  end if;
  if not exists (select 1 from pg_constraint where conrelid = 'public.proveedores'::regclass
                    and conname = 'proveedores_nombre_util') then
    alter table public.proveedores add constraint proveedores_nombre_util
      check (coalesce(public.normalizar_proveedor_base(nombre::text), '') <> ''
             and (nombre_comercial is null or length(btrim(nombre_comercial)) between 1 and 120));
  end if;
end;
$$;
create unique index if not exists uq_proveedores_cif_normalizado
  on public.proveedores (cif_normalizado) where cif_normalizado is not null;
comment on column public.proveedores.cif_normalizado is 'normalizar_cif(cif): único si no es null. El de un proveedor fusionado queda en proveedores_alias.';
comment on column public.proveedores.nombre_normalizado is 'normalizar_proveedor_base(nombre): lo que devuelve normalizar_proveedor() para cualquier alias suyo.';
comment on column public.proveedores.nombre_comercial is 'Nombre comercial o apodo («Angelmar», «Joselito»); también es alias.';
comment on column public.proveedores.origen is 'carga_inicial (20261007180000) · automatico (trigger al guardar un documento) · manual (panel).';

-- ─── 3. proveedores_alias ───────────────────────────────────────────────────
create table if not exists public.proveedores_alias (
  id                 bigint generated always as identity primary key,
  proveedor_id       bigint not null references public.proveedores(id) on delete cascade,
  alias_normalizado  text unique check (alias_normalizado is null or alias_normalizado <> ''),
  cif_normalizado    text unique check (cif_normalizado is null or (cif_normalizado <> '' and cif_normalizado <> 'B54583356')),
  texto_original     text,
  origen             text not null default 'manual'
                     check (origen in ('carga_inicial', 'automatico', 'nombre', 'manual', 'fusion')),
  created_at         timestamptz not null default now(),
  constraint proveedores_alias_uno check (num_nonnulls(alias_normalizado, cif_normalizado) = 1)
);
create index if not exists idx_proveedores_alias_proveedor on public.proveedores_alias (proveedor_id);
comment on table public.proveedores_alias is
  'Formas de un proveedor: nombre normalizado (normalizar_proveedor_base del texto del documento) o CIF extra → proveedor. '
  'normalizar_proveedor() las traduce al nombre canónico; el trigger de facturas las usa para asignar proveedor_id.';

alter table public.proveedores_alias enable row level security;
revoke all on public.proveedores_alias from public, anon, authenticated;
grant select on public.proveedores_alias to authenticated;
grant all on public.proveedores_alias to service_role;
drop policy if exists proveedores_alias_select_seccion on public.proveedores_alias;
create policy proveedores_alias_select_seccion on public.proveedores_alias
  for select to authenticated using (public.can_read_section('facturas'));
drop policy if exists proveedores_alias_service_role on public.proveedores_alias;
create policy proveedores_alias_service_role on public.proveedores_alias
  for all to service_role using (true) with check (true);

-- ─── 4. facturas.proveedor_id y proveedor_normalizado ───────────────────────
alter table public.facturas add column if not exists proveedor_id bigint;
do $$
begin
  if not exists (select 1 from pg_constraint where conrelid = 'public.facturas'::regclass
                    and conname = 'facturas_proveedor_id_fkey') then
    alter table public.facturas add constraint facturas_proveedor_id_fkey
      foreign key (proveedor_id) references public.proveedores(id) on delete set null;
  end if;
  -- La columna generada pasa a normal (conserva valores e índice); la mantiene el trigger.
  if (select attgenerated from pg_attribute where attrelid = 'public.facturas'::regclass
         and attname = 'proveedor_normalizado' and not attisdropped) = 's' then
    alter table public.facturas alter column proveedor_normalizado drop expression;
  end if;
end;
$$;
create index if not exists idx_facturas_proveedor_id on public.facturas (proveedor_id);
-- Si se aplica después de su rollback: fuera el trigger que lo sustituía.
drop trigger if exists trg_facturas_proveedor_normalizado_compat on public.facturas;
drop function if exists public.facturas_proveedor_normalizado_compat();
comment on column public.facturas.proveedor_id is
  'Proveedor canónico (proveedores.id). Lo pone el trigger trg_facturas_asignar_proveedor por CIF o alias, o lo crea; se cambia fusionando en el panel.';
comment on column public.facturas.proveedor_normalizado is
  'Nombre canónico normalizado del proveedor (proveedores.nombre_normalizado) o, sin proveedor, normalizar_proveedor_base(proveedor). '
  'Lo mantiene el trigger trg_facturas_asignar_proveedor (antes era columna generada). Todas las RPC agrupan por aquí.';

-- ─── 5. normalizar_proveedor: alias → canónico ──────────────────────────────
create or replace function public.normalizar_proveedor(p_proveedor text)
returns text
language plpgsql
stable strict
set search_path = public
as $$
declare
  v_base      text := public.normalizar_proveedor_base(p_proveedor);
  v_canonico  text;
begin
  -- Sin permiso de lectura sobre las tablas (anon), lo de siempre en vez de un error.
  if has_table_privilege('public.proveedores_alias', 'select')
     and has_table_privilege('public.proveedores', 'select') then
    select p.nombre_normalizado into v_canonico
      from public.proveedores_alias a
      join public.proveedores p on p.id = a.proveedor_id
     where a.alias_normalizado = v_base;
  end if;
  return coalesce(v_canonico, v_base);
end;
$$;
comment on function public.normalizar_proveedor(text) is
  'Nombre de proveedor normalizado y CANÓNICO: si el texto (normalizado como siempre) es un alias de proveedores_alias, '
  'el nombre normalizado de su proveedor; si no, normalizar_proveedor_base. STABLE desde 20261007180000.';

-- ─── 6. Asignación de proveedor ─────────────────────────────────────────────
-- Devuelve el proveedor de un documento (CIF → alias → nuevo si p_crear).
-- Con p_crear también aprende: el nombre nuevo de un CIF conocido pasa a alias
-- y el CIF de un proveedor que no lo tenía se completa.
create or replace function public.proveedor_resolver(p_nombre text, p_cif text, p_crear boolean default false)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  v_base   text := nullif(public.normalizar_proveedor_base(coalesce(p_nombre, '')), '');
  v_cif    text := public.normalizar_cif(p_cif);
  v_nombre text := left(btrim(regexp_replace(coalesce(p_nombre, ''), '\s+', ' ', 'g')), 255);
  v_id     bigint;
begin
  if public.proveedor_es_cliente(v_base, null) then
    return null;                       -- el cliente no es proveedor
  end if;
  if v_cif = 'B54583356' then
    v_cif := null;                     -- el CIF del cliente no identifica al proveedor
  end if;

  if v_cif is not null then
    select id into v_id from public.proveedores where cif_normalizado = v_cif;
    if v_id is null then
      select proveedor_id into v_id from public.proveedores_alias where cif_normalizado = v_cif;
    end if;
    if v_id is not null and p_crear and v_base is not null then
      insert into public.proveedores_alias (proveedor_id, alias_normalizado, texto_original, origen)
      values (v_id, v_base, v_nombre, 'automatico')
      on conflict do nothing;
    end if;
  end if;

  if v_id is null and v_base is not null then
    select proveedor_id into v_id from public.proveedores_alias where alias_normalizado = v_base;
    if v_id is not null and p_crear and public.proveedor_cif_valido(v_cif)
       and not exists (select 1 from public.proveedores_alias where cif_normalizado = v_cif) then
      update public.proveedores set cif = v_cif
       where id = v_id and cif_normalizado is null
         and not exists (select 1 from public.proveedores where cif_normalizado = v_cif);
    end if;
  end if;

  if v_id is null and p_crear and v_base is not null then
    insert into public.proveedores (nombre, cif, origen)
    values (v_nombre, case when public.proveedor_cif_valido(v_cif) then v_cif end, 'automatico')
    on conflict do nothing
    returning id into v_id;
    if v_id is null then               -- otro lo acaba de crear, o ya había uno con ese nombre exacto
      select proveedor_id into v_id from public.proveedores_alias where alias_normalizado = v_base;
      if v_id is null then
        select id into v_id from public.proveedores where nombre = v_nombre;
      end if;
    end if;
  end if;
  return v_id;
end;
$$;
comment on function public.proveedor_resolver(text, text, boolean) is
  'Proveedor de un documento: CIF normalizado (no el del cliente) → alias de nombre → (p_crear) proveedor nuevo. Uso interno del trigger.';

create or replace function public.facturas_asignar_proveedor()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_resolver boolean;
begin
  if tg_op = 'INSERT' then
    v_resolver := new.proveedor_id is null;
  else
    -- Un cambio explícito de proveedor_id (fusión, panel, ON DELETE SET NULL) se respeta.
    v_resolver := new.proveedor_id is not distinct from old.proveedor_id
                  and (old.proveedor_id is null
                       or new.proveedor is distinct from old.proveedor
                       or new.cif is distinct from old.cif);
  end if;
  if v_resolver then
    new.proveedor_id := public.proveedor_resolver(new.proveedor, new.cif, true);
  end if;
  new.proveedor_normalizado := coalesce(
    (select p.nombre_normalizado from public.proveedores p where p.id = new.proveedor_id),
    public.normalizar_proveedor_base(new.proveedor));
  return new;
end;
$$;
drop trigger if exists trg_facturas_asignar_proveedor on public.facturas;
create trigger trg_facturas_asignar_proveedor
  before insert or update of proveedor, cif, proveedor_id, proveedor_normalizado on public.facturas
  for each row execute function public.facturas_asignar_proveedor();

-- El nombre canónico y el comercial son alias de su proveedor; al renombrar,
-- las facturas toman el nombre nuevo.
create or replace function public.proveedores_mantener_alias()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_alias text;
  v_otro  bigint;
begin
  foreach v_alias in array array[new.nombre_normalizado,
                                 public.normalizar_proveedor_base(nullif(btrim(coalesce(new.nombre_comercial, '')), ''))] loop
    continue when coalesce(v_alias, '') = '';
    select proveedor_id into v_otro from public.proveedores_alias where alias_normalizado = v_alias;
    if v_otro is null then
      insert into public.proveedores_alias (proveedor_id, alias_normalizado, texto_original, origen)
      values (new.id, v_alias, case when v_alias = new.nombre_normalizado then new.nombre else new.nombre_comercial end, 'nombre');
    elsif v_otro <> new.id then
      raise exception '«%» ya es otro proveedor (id %): fusiónalos en vez de repetir el nombre', v_alias, v_otro
        using errcode = '23505';
    end if;
  end loop;
  if tg_op = 'UPDATE' and new.nombre_normalizado is distinct from old.nombre_normalizado then
    update public.facturas set proveedor_normalizado = new.nombre_normalizado where proveedor_id = new.id;
  end if;
  return null;
end;
$$;
drop trigger if exists trg_proveedores_mantener_alias on public.proveedores;
create trigger trg_proveedores_mantener_alias
  after insert or update of nombre, nombre_comercial on public.proveedores
  for each row execute function public.proveedores_mantener_alias();

-- ─── 7. RPC del panel ───────────────────────────────────────────────────────
create or replace function public.proveedores_puede_editar()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((select auth.role()) = 'service_role', false)
      or coalesce(public.can_write_section('facturas'), false)
$$;

-- Lectura (SECURITY INVOKER: pasa por la RLS de proveedores/facturas/alias).
create or replace function public.proveedores_listado()
returns table (
  id               bigint,
  nombre           text,
  nombre_comercial text,
  cif              text,
  activo           boolean,
  origen           text,
  documentos       integer,
  facturas         integer,
  albaranes        integer,
  total_facturas   numeric,
  total_albaranes  numeric,
  ultima_fecha     date,
  variantes        text[],
  alias            text[],
  cifs_extra       text[]
)
language sql
stable
set search_path = public
as $$
  select p.id, p.nombre::text, p.nombre_comercial, p.cif_normalizado, coalesce(p.activo, true), p.origen,
         coalesce(d.documentos, 0), coalesce(d.facturas, 0), coalesce(d.albaranes, 0),
         coalesce(d.total_facturas, 0), coalesce(d.total_albaranes, 0), d.ultima_fecha,
         coalesce(d.variantes, '{}'::text[]), coalesce(a.alias, '{}'::text[]), coalesce(a.cifs, '{}'::text[])
    from public.proveedores p
    left join lateral (
      select count(*)::int                                                  as documentos,
             (count(*) filter (where f.tipo = 'factura'))::int              as facturas,
             (count(*) filter (where f.tipo = 'albaran'))::int              as albaranes,
             sum(f.total) filter (where f.tipo = 'factura')                 as total_facturas,
             sum(f.total) filter (where f.tipo = 'albaran')                 as total_albaranes,
             max(f.fecha)                                                   as ultima_fecha,
             array_agg(distinct f.proveedor::text) filter (where f.proveedor is not null) as variantes
        from public.facturas f
       where f.proveedor_id = p.id) d on true
    left join lateral (
      select array_agg(x.alias_normalizado order by x.alias_normalizado) filter (where x.alias_normalizado is not null) as alias,
             array_agg(x.cif_normalizado order by x.cif_normalizado) filter (where x.cif_normalizado is not null)         as cifs
        from public.proveedores_alias x
       where x.proveedor_id = p.id) a on true
   order by lower(p.nombre::text)
$$;
comment on function public.proveedores_listado() is
  'Panel Facturas › Proveedores: cada proveedor con su CIF, nº de documentos, totales, textos con que llega (variantes) y alias.';

create or replace function public.proveedores_editar(p_id bigint, p_nombre text, p_nombre_comercial text default null, p_cif text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_nombre text := btrim(regexp_replace(coalesce(p_nombre, ''), '\s+', ' ', 'g'));
  v_com    text := nullif(btrim(regexp_replace(coalesce(p_nombre_comercial, ''), '\s+', ' ', 'g')), '');
  v_cif    text := public.normalizar_cif(p_cif);
  v_otro   bigint;
  v_fila   public.proveedores%rowtype;
begin
  if not public.proveedores_puede_editar() then
    raise exception 'Cambiar proveedores exige permiso de edición en Facturas' using errcode = '42501';
  end if;
  perform 1 from public.proveedores where id = p_id for update;
  if not found then
    raise exception 'No existe el proveedor %', p_id using errcode = 'P0002';
  end if;
  if coalesce(public.normalizar_proveedor_base(v_nombre), '') = '' or length(v_nombre) > 255 then
    raise exception 'Escribe un nombre de proveedor (máximo 255 caracteres)' using errcode = '22023';
  end if;
  if v_com is not null and length(v_com) > 120 then
    raise exception 'El nombre comercial no puede pasar de 120 caracteres' using errcode = '22023';
  end if;
  if public.proveedor_es_cliente(public.normalizar_proveedor_base(v_nombre), v_cif) then
    raise exception 'Ese nombre o CIF es el del propio restaurante (MASIDE 2011 S.L.): no puede ser un proveedor' using errcode = '22023';
  end if;
  if v_cif is not null then
    if length(v_cif) > 20 then
      raise exception 'El CIF no parece válido: %', v_cif using errcode = '22023';
    end if;
    select id into v_otro from public.proveedores where cif_normalizado = v_cif and id <> p_id;
    if v_otro is null then
      select proveedor_id into v_otro from public.proveedores_alias where cif_normalizado = v_cif and proveedor_id <> p_id;
    end if;
    if v_otro is not null then
      raise exception 'El CIF % ya es de otro proveedor (id %): fusiónalos', v_cif, v_otro using errcode = '23505';
    end if;
    delete from public.proveedores_alias where proveedor_id = p_id and cif_normalizado = v_cif;
  end if;
  select id into v_otro from public.proveedores where nombre = v_nombre and id <> p_id;
  if v_otro is not null then
    raise exception 'Ya hay otro proveedor que se llama «%» (id %): fusiónalos', v_nombre, v_otro using errcode = '23505';
  end if;

  update public.proveedores
     set nombre = v_nombre, nombre_comercial = v_com, cif = v_cif, origen = 'manual'
   where id = p_id
  returning * into v_fila;
  return jsonb_build_object('id', v_fila.id, 'nombre', v_fila.nombre, 'nombre_comercial', v_fila.nombre_comercial,
                            'cif', v_fila.cif_normalizado, 'nombre_normalizado', v_fila.nombre_normalizado);
end;
$$;

create or replace function public.proveedores_fusionar(p_origen_ids bigint[], p_destino_id bigint)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_dest     public.proveedores%rowtype;
  v_origen   bigint[];
  v_cifs     text[];
  v_com      text;
  v_cif      text;
  v_docs     integer;
  v_alias    integer;
  v_borrados integer;
  r          record;
begin
  if not public.proveedores_puede_editar() then
    raise exception 'Fusionar proveedores exige permiso de edición en Facturas' using errcode = '42501';
  end if;
  select * into v_dest from public.proveedores where id = p_destino_id for update;
  if not found then
    raise exception 'No existe el proveedor %', p_destino_id using errcode = 'P0002';
  end if;
  v_origen := array(select distinct x from unnest(coalesce(p_origen_ids, '{}')) as x
                     where x is not null and x <> p_destino_id order by x);
  if cardinality(v_origen) = 0 then
    raise exception 'Elige al menos otro proveedor que fusionar con «%»', v_dest.nombre using errcode = '22023';
  end if;
  perform 1 from public.proveedores where id = any(v_origen) order by id for update;
  if (select count(*) from public.proveedores where id = any(v_origen)) <> cardinality(v_origen) then
    raise exception 'Alguno de los proveedores que se iban a fusionar ya no existe. Recarga y vuelve a intentarlo.' using errcode = 'P0002';
  end if;

  select array_agg(cif_normalizado order by array_position(p_origen_ids, id)) filter (where cif_normalizado is not null),
         (array_agg(nombre_comercial order by array_position(p_origen_ids, id)) filter (where nombre_comercial is not null))[1]
    into v_cifs, v_com
    from public.proveedores where id = any(v_origen);

  -- Documentos (el trigger les pone el nombre canónico del que queda).
  update public.facturas set proveedor_id = p_destino_id where proveedor_id = any(v_origen);
  get diagnostics v_docs = row_count;
  -- Alias (incluidos los nombres de los que se van: siguen reconociéndose).
  update public.proveedores_alias set proveedor_id = p_destino_id, origen = 'fusion' where proveedor_id = any(v_origen);
  get diagnostics v_alias = row_count;
  -- Cualquier otra tabla que apunte a proveedores (p. ej. el catálogo antiguo).
  for r in select c.conrelid::regclass as tabla, a.attname as columna
             from pg_constraint c
             join pg_attribute a on a.attrelid = c.conrelid and a.attnum = c.conkey[1]
            where c.contype = 'f' and c.confrelid = 'public.proveedores'::regclass
              and cardinality(c.conkey) = 1
              and c.conrelid not in ('public.facturas'::regclass, 'public.proveedores_alias'::regclass) loop
    execute format('update %s set %I = $1 where %I = any($2)', r.tabla, r.columna, r.columna) using p_destino_id, v_origen;
  end loop;
  delete from public.proveedores where id = any(v_origen);
  get diagnostics v_borrados = row_count;

  -- El CIF de los que se van: si el que queda no tenía, hereda el primero; los demás, CIF extra.
  foreach v_cif in array coalesce(v_cifs, '{}') loop
    if v_dest.cif_normalizado is null then
      update public.proveedores set cif = v_cif where id = p_destino_id;
      v_dest.cif_normalizado := v_cif;
    elsif v_cif <> v_dest.cif_normalizado then
      insert into public.proveedores_alias (proveedor_id, cif_normalizado, origen)
      values (p_destino_id, v_cif, 'fusion')
      on conflict do nothing;
    end if;
  end loop;
  if v_dest.nombre_comercial is null and v_com is not null then
    update public.proveedores set nombre_comercial = v_com where id = p_destino_id;
  end if;
  update public.proveedores set origen = 'manual' where id = p_destino_id;

  return jsonb_build_object('proveedor_id', p_destino_id, 'documentos_movidos', v_docs,
                            'alias_movidos', v_alias, 'proveedores_borrados', v_borrados);
end;
$$;

revoke all on function public.proveedor_resolver(text, text, boolean) from public, anon, authenticated;
grant execute on function public.proveedor_resolver(text, text, boolean) to service_role;
revoke all on function public.facturas_asignar_proveedor() from public, anon, authenticated;
revoke all on function public.proveedores_mantener_alias() from public, anon, authenticated;
revoke all on function public.proveedores_puede_editar() from public, anon;
grant execute on function public.proveedores_puede_editar() to authenticated, service_role;
revoke all on function public.proveedores_listado() from public, anon;
grant execute on function public.proveedores_listado() to authenticated, service_role;
revoke all on function public.proveedores_editar(bigint, text, text, text) from public, anon;
grant execute on function public.proveedores_editar(bigint, text, text, text) to authenticated, service_role;
revoke all on function public.proveedores_fusionar(bigint[], bigint) from public, anon;
grant execute on function public.proveedores_fusionar(bigint[], bigint) to authenticated, service_role;

-- ─── 8. Carga inicial (una vez; datos revisados a mano el 07/10/2026) ───────
-- 20 documentos → 15 proveedores. Uniones que no salían solas:
--   · Cárnicas Joselito S.A. (A87934337): factura 44 «Cárnicas Joselito S.A.» +
--     albarán 38 «JOSELITO (Cárnicas Joselito)» (CIF del albarán «372107159»:
--     no es un CIF, no se guarda).
--   · Flopeinversiones (B32455032): facturas 51 (B32455032) y 53 (B-32455032).
--   · Herederos Angel Mariño Hermo C.B. (E13781760), comercial «Angelmar».
--   · Francisco José Santacruz Gambín (B54968961): el texto «…, S.L.U» (sin
--     punto final) no perdía la forma jurídica → alias.
--   · MR Friosat (B24831901): «MR FRIOSAT, Crevillente (Alicante)» (historial
--     de precios) → alias.
-- El cliente (MASIDE 2011 S.L., B54583356) no aparece en ningún documento.
alter table public.facturas disable trigger trigger_facturas_updated;   -- no tocar updated_at

do $$
begin
  if exists (select 1 from public.proveedores where origen = 'carga_inicial') then
    raise notice 'proveedores_unificados: la carga inicial ya estaba hecha; no se repite.';
    return;
  end if;

  -- Fila de ejemplo de la plantilla (sin CIF, sin uso).
  begin
    delete from public.proveedores where id = 1 and nombre = 'Proveedor Ejemplo' and cif is null;
  exception when foreign_key_violation then
    update public.proveedores set activo = false where id = 1 and nombre = 'Proveedor Ejemplo';
  end;

  insert into public.proveedores (nombre, nombre_comercial, cif, origen)
  values ('Bodega Campoluz, S.L.',                   null,        null,        'carga_inicial'),
         ('Candela, S.L.',                           null,        'B53149829', 'carga_inicial'),
         ('Cárnicas Joselito S.A.',                  'Joselito',  'A87934337', 'carga_inicial'),
         ('Distribuciones Guillén, S.L.',            null,        'B03187580', 'carga_inicial'),
         ('Enchenta SLU',                            null,        'B94186988', 'carga_inicial'),
         ('Equipalia Suministros Hosteleros',        null,        null,        'carga_inicial'),
         ('Flopeinversiones, S.L.',                  null,        'B32455032', 'carga_inicial'),
         ('Francisco José Santacruz Gambín, S.L.U.', null,        'B54968961', 'carga_inicial'),
         ('Grupo Insula Roma S.L.',                  null,        'B73423998', 'carga_inicial'),
         ('Herederos Angel Mariño Hermo C.B.',       'Angelmar',  'E13781760', 'carga_inicial'),
         ('Luga Sabores S.L.',                       null,        'B54529045', 'carga_inicial'),
         ('MR Friosat',                              null,        'B24831901', 'carga_inicial'),
         ('Osborne',                                 null,        null,        'carga_inicial'),
         ('Racionalismo Dulce, S.L.',                null,        'B54977780', 'carga_inicial'),
         ('Salazones Garre',                         null,        'B73028474', 'carga_inicial')
  on conflict do nothing;

  -- Alias además del nombre y el comercial (esos los pone el trigger).
  insert into public.proveedores_alias (proveedor_id, alias_normalizado, texto_original, origen)
  select p.id, public.normalizar_proveedor_base(v.texto), v.texto, 'carga_inicial'
    from (values ('Cárnicas Joselito S.A.',                  'JOSELITO (Cárnicas Joselito)'),
                 ('Cárnicas Joselito S.A.',                  'Joselito'),
                 ('Francisco José Santacruz Gambín, S.L.U.', 'FRANCISCO JOSÉ SANTACRUZ GAMBÍN, S.L.U'),
                 ('Herederos Angel Mariño Hermo C.B.',       'HEREDEROS ANGEL MARIÑO HERMO C.B. (ANGELMAR)'),
                 ('Herederos Angel Mariño Hermo C.B.',       'Herederos Angel Mariño Hermo'),
                 ('Herederos Angel Mariño Hermo C.B.',       'Angelmar'),
                 ('MR Friosat',                              'MR FRIOSAT, Crevillente (Alicante)'),
                 ('Enchenta SLU',                            'ENCHENTA SLU')
         ) as v(proveedor, texto)
    join public.proveedores p on p.nombre = v.proveedor
  on conflict do nothing;

  -- Documentos por id (solo si el texto sigue siendo el revisado; si no, los
  -- asigna el paso siguiente con la regla del trigger).
  update public.facturas f
     set proveedor_id = p.id
    from (values (46, 'BODEGA CAMPOLUZ, S.L.',                        'Bodega Campoluz, S.L.'),
                 (48, 'Bodega Campoluz, S.L.',                        'Bodega Campoluz, S.L.'),
                 (37, 'CANDELA, S.L.',                                'Candela, S.L.'),
                 (44, 'Cárnicas Joselito S.A.',                       'Cárnicas Joselito S.A.'),
                 (38, 'JOSELITO (Cárnicas Joselito)',                 'Cárnicas Joselito S.A.'),
                 (36, 'DISTRIBUCIONES GUILLÉN, S.L.',                 'Distribuciones Guillén, S.L.'),
                 (47, 'ENCHENTA SLU',                                 'Enchenta SLU'),
                 (50, 'Equipalia Suministros Hosteleros',             'Equipalia Suministros Hosteleros'),
                 (51, 'FLOPEINVERSIONES, S.L.',                       'Flopeinversiones, S.L.'),
                 (53, 'FLOPEINVERSIONES, S.L.',                       'Flopeinversiones, S.L.'),
                 (49, 'FRANCISCO JOSÉ SANTACRUZ GAMBÍN, S.L.U',       'Francisco José Santacruz Gambín, S.L.U.'),
                 (52, 'GRUPO INSULA ROMA S.L.',                       'Grupo Insula Roma S.L.'),
                 (45, 'HEREDEROS ANGEL MARIÑO HERMO C.B. (ANGELMAR)', 'Herederos Angel Mariño Hermo C.B.'),
                 (54, 'LUGA SABORES S.L.',                            'Luga Sabores S.L.'),
                 (35, 'MR FRIOSAT',                                   'MR Friosat'),
                 (42, 'Osborne',                                      'Osborne'),
                 (43, 'Osborne',                                      'Osborne'),
                 (41, 'Racionalismo Dulce, S.L.',                     'Racionalismo Dulce, S.L.'),
                 (150, 'Racionalismo Dulce, S.L.',                    'Racionalismo Dulce, S.L.'),
                 (39, 'Salazones Garre',                              'Salazones Garre')
         ) as v(factura_id, texto, proveedor)
    join public.proveedores p on p.nombre = v.proveedor
   where f.id = v.factura_id and f.proveedor = v.texto;
end;
$$;

-- Lo que quede sin proveedor (documentos posteriores o retocados): la misma
-- regla que el trigger (UPDATE OF proveedor_id sin cambiarlo = resolver).
update public.facturas set proveedor_id = proveedor_id
 where proveedor_id is null and proveedor is not null;

-- proveedor_normalizado al día en todas (el trigger lo recalcula).
update public.facturas f set proveedor_normalizado = f.proveedor_normalizado
 where f.proveedor_normalizado is distinct from coalesce(
         (select p.nombre_normalizado from public.proveedores p where p.id = f.proveedor_id),
         public.normalizar_proveedor_base(f.proveedor));

alter table public.facturas enable trigger trigger_facturas_updated;

-- ─── 9. Comprobación final ──────────────────────────────────────────────────
do $$
declare
  v_a bigint;
  v_b bigint;
begin
  if (select attgenerated from pg_attribute where attrelid = 'public.facturas'::regclass
         and attname = 'proveedor_normalizado' and not attisdropped) <> '' then
    raise exception 'proveedores_unificados: facturas.proveedor_normalizado sigue siendo generada';
  end if;
  if md5(replace((select prosrc from pg_proc where oid = 'public.normalizar_proveedor_base(text)'::regprocedure), chr(13), ''))
     <> 'a4ab6d3511b714766d6f993a399a8d92' then
    raise exception 'proveedores_unificados: normalizar_proveedor_base no es idéntica a la normalizar_proveedor de siempre';
  end if;
  if public.normalizar_proveedor('JOSELITO (Cárnicas Joselito)') <> public.normalizar_proveedor('Cárnicas Joselito S.A.')
     or public.normalizar_proveedor('Angelmar') <> public.normalizar_proveedor('HEREDEROS ANGEL MARIÑO HERMO C.B. (ANGELMAR)') then
    raise exception 'proveedores_unificados: normalizar_proveedor no unifica Joselito / Angelmar';
  end if;
  select proveedor_id into v_a from public.facturas where id = 44 and proveedor = 'Cárnicas Joselito S.A.';
  select proveedor_id into v_b from public.facturas where id = 38 and proveedor = 'JOSELITO (Cárnicas Joselito)';
  if v_a is distinct from v_b then
    raise exception 'proveedores_unificados: el albarán 38 y la factura 44 de Joselito no tienen el mismo proveedor';
  end if;
  select proveedor_id into v_a from public.facturas where id = 51 and proveedor = 'FLOPEINVERSIONES, S.L.';
  select proveedor_id into v_b from public.facturas where id = 53 and proveedor = 'FLOPEINVERSIONES, S.L.';
  if v_a is distinct from v_b then
    raise exception 'proveedores_unificados: Flopeinversiones con y sin guion en el CIF no ha quedado unido';
  end if;
  if exists (select 1 from public.proveedores
              where public.proveedor_es_cliente(nombre_normalizado, cif_normalizado)) then
    raise exception 'proveedores_unificados: el cliente (MASIDE 2011 / B54583356) figura como proveedor';
  end if;
  if exists (select 1 from public.facturas f
              where f.proveedor_id is null and f.proveedor is not null
                and coalesce(public.normalizar_proveedor_base(f.proveedor), '') <> ''
                and not public.proveedor_es_cliente(public.normalizar_proveedor_base(f.proveedor), null)) then
    raise exception 'proveedores_unificados: quedan documentos con proveedor sin proveedor_id';
  end if;
  if exists (select 1 from public.facturas f join public.proveedores p on p.id = f.proveedor_id
              where f.proveedor_normalizado is distinct from p.nombre_normalizado) then
    raise exception 'proveedores_unificados: proveedor_normalizado no coincide con el proveedor asignado';
  end if;
  if exists (select 1 from public.proveedores p
              where coalesce(p.activo, true)
                and not exists (select 1 from public.proveedores_alias a
                                 where a.proveedor_id = p.id and a.alias_normalizado = p.nombre_normalizado)) then
    raise exception 'proveedores_unificados: hay proveedores cuyo nombre no es alias suyo';
  end if;
  if not exists (select 1 from pg_trigger where tgrelid = 'public.facturas'::regclass
                    and tgname = 'trg_facturas_asignar_proveedor' and not tgisinternal)
     or not exists (select 1 from pg_trigger where tgrelid = 'public.facturas'::regclass
                    and tgname = 'trigger_facturas_updated' and tgenabled = 'O') then
    raise exception 'proveedores_unificados: triggers de facturas mal (falta el de proveedor o updated_at quedó desactivado)';
  end if;
  if has_function_privilege('anon', 'public.proveedores_fusionar(bigint[], bigint)', 'execute')
     or has_function_privilege('anon', 'public.proveedores_listado()', 'execute')
     or has_function_privilege('authenticated', 'public.proveedor_resolver(text, text, boolean)', 'execute')
     or has_table_privilege('anon', 'public.proveedores_alias', 'select') then
    raise exception 'proveedores_unificados: privilegios demasiado abiertos';
  end if;
end;
$$;

notify pgrst, 'reload schema';

commit;

-- Verificación (solo lectura): «proveedores_unificados: aplicada | 15 | 20 | 20/20».
select format('proveedores_unificados: aplicada | %s | %s | %s/%s',
              (select count(*) from public.proveedores),
              (select count(*) from public.proveedores_alias),
              (select count(*) from public.facturas where proveedor_id is not null),
              (select count(*) from public.facturas)) as resultado;
