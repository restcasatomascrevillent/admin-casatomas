set client_encoding = 'UTF8';
-- ===========================================================================
-- 20261103150000_tienda_vinos — Tienda de vinos (escaparate) (03/11/2026)
-- ===========================================================================
-- Petición del dueño: «En la web pon otra sección que sea Tienda (y una
-- pestaña Tienda en el panel) con todos los vinos a la venta para el público
-- con un 30 % de descuento sobre el precio de carta, configurable en el panel».
-- Matiz posterior del dueño: «la tienda no puede permitir pago por internet,
-- solo vista». La tienda es un ESCAPARATE: la web enseña los vinos con su
-- precio de carta y el de tienda, y se compran EN EL RESTAURANTE. No hay
-- pedidos ni pagos online: esta migración no toca pedidos_ecommerce ni crea
-- ninguna RPC para la web.
--
-- CONTRATO CON LA WEB (no cambiar nombres: web-casatomas depende):
--   * public.configuracion_tienda (fila única, id = true). La leen anon y
--     authenticated. Columnas:
--       id              boolean  primary key, siempre true
--       activa          boolean  la web enseña la tienda (true por defecto)
--       descuento_pct   numeric(5,2)  0–90, 30 por defecto
--       vinos_excluidos text[]   ids de public."Vinos" que NO salen en la tienda
--       aviso           text     texto para la web (≤ 500), null = sin aviso
--       recogida        text     cómo comprar en el restaurante: horario,
--                                dónde preguntar… (≤ 500), null = sin texto
--       updated_at      timestamptz, updated_by uuid
--   * VINO A LA VENTA = activado = true AND restaurante IS TRUE AND
--     precio_eur > 0 AND id <> ALL(vinos_excluidos). `restaurante IS TRUE` es
--     el mismo filtro que la carta de vinos de la web (CartaVinos.tsx y
--     scripts/carta-ssg.mjs): separa la carta de Casa Tomás de la del bar.
--   * PRECIO DE TIENDA (igual en BD, panel y web):
--       round(precio_eur * (1 - descuento_pct / 100), 2)
--     = public.tienda_precio_venta(precio, pct). IVA incluido, como la carta.
--
-- QUÉ MÁS CREA
--   * configuracion_tienda_al_editar (trigger): quién y cuándo, lista de
--     excluidos sin duplicados ni vacíos, textos sin espacios sobrantes.
--   * RLS: SELECT para anon y authenticated; UPDATE solo de las columnas
--     editables y solo con can_write_section('tienda') (el super admin
--     siempre, como en has_section_permission); sin INSERT ni DELETE (fila
--     única); sesión de panel viva (acceso_panel_no_bloqueado). SE AUDITA.
--   * tienda_marcar_vinos(p_vino_ids, p_a_la_venta) para Panel › Tienda ›
--     Vinos: pone o quita de la venta SOLO esos ids (atómico: dos personas a
--     la vez no se pisan). SECURITY INVOKER: decide la RLS.
--   * admin_feature_toggles: 'tienda' (el super admin puede ocultar la
--     pestaña del panel).
--
-- AUDITORÍA: configuracion_tienda recibe trg_auditoria (el event trigger
-- audit_panel_nuevas_tablas o, si no existe —la demo no lo tiene—, esta
-- migración), con la misma función que instala instalar_auditoria_panel().
--
-- APLICAR (una a una, nunca `db push`): demo primero (sfonaclosuafvlhutkon),
-- producción (haqmmdfdzzatdnrrcgez) solo tras aceptar el PR y con el «sí» del
-- dueño. Idempotente. Tiene que terminar en «tienda_vinos: aplicada».
-- Deshacer: supabase/rollbacks/20261103150000_tienda_vinos_ROLLBACK.sql
-- Pruebas: npm run test:tienda:db (PGlite).
-- ===========================================================================

begin;
set local lock_timeout = '5s';

-- ─── 0. Comprobaciones previas (no cambian nada) ────────────────────────────
do $$
declare
  v_faltan text[] := '{}';
  v_col text;
begin
  if to_regclass('public."Vinos"') is null then
    v_faltan := v_faltan || 'public."Vinos"'::text;
  else
    foreach v_col in array array['id', 'precio_eur', 'activado', 'restaurante'] loop
      if not exists (select 1 from pg_attribute
                      where attrelid = 'public."Vinos"'::regclass and attname = v_col and attnum > 0 and not attisdropped) then
        v_faltan := v_faltan || format('public."Vinos".%s', v_col);
      end if;
    end loop;
  end if;
  if to_regprocedure('public.can_write_section(text)') is null then
    v_faltan := v_faltan || 'public.can_write_section(text)'::text;
  end if;
  if cardinality(v_faltan) > 0 then
    raise exception 'tienda_vinos: falta %. No se ha cambiado nada.', array_to_string(v_faltan, ', ');
  end if;
end;
$$;

-- ─── 1. Precio de tienda (la fórmula del contrato) ──────────────────────────
create or replace function public.tienda_precio_venta(p_precio_carta numeric, p_descuento_pct numeric)
returns numeric
language sql
immutable
set search_path = ''
as $$
  select round(p_precio_carta * (1 - p_descuento_pct / 100), 2)
$$;
comment on function public.tienda_precio_venta(numeric, numeric) is
  'Precio de tienda de un vino: round(precio_eur * (1 - descuento_pct / 100), 2). La misma fórmula en el panel (src/lib/tienda.ts) y en la web.';
revoke all on function public.tienda_precio_venta(numeric, numeric) from public;
grant execute on function public.tienda_precio_venta(numeric, numeric) to anon, authenticated, service_role;

-- ─── 2. Configuración (fila única) ──────────────────────────────────────────
create table if not exists public.configuracion_tienda (
  id              boolean primary key default true check (id),
  activa          boolean not null default true,
  descuento_pct   numeric(5, 2) not null default 30,
  vinos_excluidos text[] not null default '{}',
  aviso           text,
  recogida        text,
  updated_at      timestamptz not null default now(),
  updated_by      uuid default auth.uid(),
  constraint configuracion_tienda_descuento_chk check (descuento_pct between 0 and 90),
  constraint configuracion_tienda_aviso_chk check (aviso is null or length(aviso) <= 500),
  constraint configuracion_tienda_recogida_chk check (recogida is null or length(recogida) <= 500),
  constraint configuracion_tienda_excluidos_chk check (cardinality(vinos_excluidos) <= 2000 and array_position(vinos_excluidos, null) is null)
);
comment on table public.configuracion_tienda is
  'Tienda de vinos de la web (escaparate: se compra en el restaurante, sin pago online). Fila única (id = true). '
  'La lee la web (anon); la edita el panel (Tienda › Vinos y Ajustes) con la sección de permisos tienda. Se audita.';
comment on column public.configuracion_tienda.activa is 'La web enseña la tienda.';
comment on column public.configuracion_tienda.descuento_pct is
  'Descuento sobre el precio de carta (0–90 %). Precio de tienda = round(precio_eur * (1 - descuento_pct / 100), 2).';
comment on column public.configuracion_tienda.vinos_excluidos is
  'Ids de public."Vinos" que NO salen en la tienda aunque estén activos y con precio.';
comment on column public.configuracion_tienda.aviso is 'Texto para la web (cabecera de la tienda), hasta 500 caracteres.';
comment on column public.configuracion_tienda.recogida is
  'Cómo comprar en el restaurante (horario, dónde preguntar…), hasta 500 caracteres.';

-- Quién y cuándo; lista sin duplicados ni vacíos; textos sin espacios sobrantes.
create or replace function public.configuracion_tienda_al_editar()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  new.updated_by := coalesce(auth.uid(), case when tg_op = 'UPDATE' then old.updated_by end, new.updated_by);
  new.vinos_excluidos := coalesce(
    (select array_agg(distinct btrim(v) order by btrim(v)) from unnest(new.vinos_excluidos) v
      where v is not null and btrim(v) <> ''),
    '{}');
  new.aviso := nullif(btrim(new.aviso), '');
  new.recogida := nullif(btrim(new.recogida), '');
  return new;
end;
$$;
revoke all on function public.configuracion_tienda_al_editar() from public, anon, authenticated;
drop trigger if exists configuracion_tienda_al_editar on public.configuracion_tienda;
create trigger configuracion_tienda_al_editar
  before insert or update on public.configuracion_tienda
  for each row execute function public.configuracion_tienda_al_editar();

-- Auditoría: el mismo trigger y la misma función que instala
-- instalar_auditoria_panel() (la demo no tiene el event trigger).
do $$
begin
  if to_regprocedure('public.fn_registrar_auditoria()') is not null
     and not exists (select 1 from pg_trigger
                      where tgrelid = 'public.configuracion_tienda'::regclass
                        and tgfoid = 'public.fn_registrar_auditoria()'::regprocedure
                        and not tgisinternal) then
    execute 'drop trigger if exists trg_auditoria on public.configuracion_tienda';
    execute 'create trigger trg_auditoria after insert or update or delete on public.configuracion_tienda
             for each row execute function public.fn_registrar_auditoria()';
  end if;
end;
$$;

-- RLS: lectura pública; edición con la sección tienda; altas y bajas, nadie
-- (salvo service_role): la fila es única.
alter table public.configuracion_tienda enable row level security;
revoke all on public.configuracion_tienda from public, anon, authenticated;
grant select on public.configuracion_tienda to anon, authenticated;
grant update (activa, descuento_pct, vinos_excluidos, aviso, recogida)
  on public.configuracion_tienda to authenticated;
grant all on public.configuracion_tienda to service_role;

drop policy if exists configuracion_tienda_select_publico on public.configuracion_tienda;
create policy configuracion_tienda_select_publico
  on public.configuracion_tienda for select to anon, authenticated using (true);
drop policy if exists configuracion_tienda_update_seccion on public.configuracion_tienda;
create policy configuracion_tienda_update_seccion
  on public.configuracion_tienda for update to authenticated
  using ((select public.can_write_section('tienda')))
  with check ((select public.can_write_section('tienda')));
drop policy if exists configuracion_tienda_service_role on public.configuracion_tienda;
create policy configuracion_tienda_service_role
  on public.configuracion_tienda for all to service_role using (true) with check (true);

do $$
begin
  if to_regprocedure('private.sesion_panel_permitida()') is not null then
    execute 'drop policy if exists "acceso_panel_no_bloqueado" on public.configuracion_tienda';
    execute 'create policy "acceso_panel_no_bloqueado" on public.configuracion_tienda as restrictive for all to authenticated
      using ((select private.sesion_panel_permitida())) with check ((select private.sesion_panel_permitida()))';
  end if;
end;
$$;

-- Semilla: visible, 30 %, ningún vino quitado (no pisa lo que se haya editado).
insert into public.configuracion_tienda (id) values (true) on conflict (id) do nothing;

-- ─── 3. Poner y quitar vinos de la venta (panel) ────────────────────────────
-- SECURITY INVOKER: la RLS y los GRANT de columna deciden (sección tienda con
-- edición); sin permiso no actualiza ninguna fila y se avisa.
create or replace function public.tienda_marcar_vinos(p_vino_ids text[], p_a_la_venta boolean)
returns text[]
language plpgsql
volatile
security invoker
set search_path = ''
as $$
declare
  v_ids text[];
  v_resultado text[];
begin
  select coalesce(array_agg(distinct btrim(x)), '{}') into v_ids
    from unnest(coalesce(p_vino_ids, '{}')) x
   where x is not null and btrim(x) <> '';
  if cardinality(v_ids) = 0 or cardinality(v_ids) > 1000 or p_a_la_venta is null then
    raise exception 'Lista de vinos no válida';
  end if;

  update public.configuracion_tienda c
     set vinos_excluidos = case
           when p_a_la_venta then coalesce((select array_agg(x) from unnest(c.vinos_excluidos) x where x <> all (v_ids)), '{}')
           else c.vinos_excluidos || v_ids
         end
   where c.id
  returning c.vinos_excluidos into v_resultado;
  if not found then
    raise exception 'No tienes permiso para cambiar los vinos de la tienda' using errcode = '42501';
  end if;
  return v_resultado;
end;
$$;
comment on function public.tienda_marcar_vinos(text[], boolean) is
  'Panel › Tienda › Vinos: pone o quita de la venta solo los vinos indicados (vinos_excluidos), sin pisar cambios simultáneos.';
revoke all on function public.tienda_marcar_vinos(text[], boolean) from public, anon;
grant execute on function public.tienda_marcar_vinos(text[], boolean) to authenticated, service_role;

-- ─── 4. Interruptor del Super Admin ─────────────────────────────────────────
do $$
begin
  if to_regclass('public.admin_feature_toggles') is not null then
    insert into public.admin_feature_toggles (section_key, label, enabled)
    values ('tienda', 'Tienda', true)
    on conflict (section_key) do nothing;
  end if;
end;
$$;

-- ─── 5. Comprobación final ──────────────────────────────────────────────────
do $$
declare
  v_malos text[] := '{}';
begin
  if not exists (select 1 from public.configuracion_tienda where id) then
    v_malos := v_malos || 'falta la fila de configuracion_tienda'::text;
  end if;
  if not (select relrowsecurity from pg_class where oid = 'public.configuracion_tienda'::regclass) then
    v_malos := v_malos || 'RLS apagada en configuracion_tienda'::text;
  end if;
  if exists (select 1 from pg_roles where rolname = 'anon') then
    if not has_table_privilege('anon', 'public.configuracion_tienda', 'SELECT') then
      v_malos := v_malos || 'anon no puede leer configuracion_tienda'::text;
    end if;
    if has_table_privilege('anon', 'public.configuracion_tienda', 'UPDATE')
       or has_table_privilege('anon', 'public.configuracion_tienda', 'INSERT')
       or has_table_privilege('anon', 'public.configuracion_tienda', 'DELETE')
       or has_table_privilege('anon', 'public.configuracion_tienda', 'TRUNCATE') then
      v_malos := v_malos || 'anon puede escribir en configuracion_tienda'::text;
    end if;
    if has_table_privilege('authenticated', 'public.configuracion_tienda', 'INSERT')
       or has_table_privilege('authenticated', 'public.configuracion_tienda', 'DELETE')
       or has_table_privilege('authenticated', 'public.configuracion_tienda', 'TRUNCATE') then
      v_malos := v_malos || 'authenticated puede crear o borrar la configuración'::text;
    end if;
    if has_function_privilege('anon', 'public.tienda_marcar_vinos(text[], boolean)', 'EXECUTE') then
      v_malos := v_malos || 'anon puede quitar vinos de la tienda'::text;
    end if;
  end if;
  if cardinality(v_malos) > 0 then
    raise exception 'tienda_vinos: comprobación final fallida (%). No se ha aplicado nada.', array_to_string(v_malos, '; ');
  end if;
  raise notice 'tienda_vinos: aplicada';
end;
$$;

commit;
