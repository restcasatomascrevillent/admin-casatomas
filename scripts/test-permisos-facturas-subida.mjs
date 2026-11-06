// «Ver» en Facturas solo consulta y permiso nuevo «Facturas · Subida»
// ('facturas_subida') contra un Postgres en memoria (PGlite). Nunca toca Supabase.
//
//   npm run test:permisos-facturas-subida:db
//
// Parte del estado de la demo el 06/11/2026 (políticas de facturas,
// productos_factura, ocr_trabajos, ocr_trabajo_paginas, del historial del chat
// y del bucket facturas-originales; can_write_section mirando can_edit;
// ocr_resumen_factura; sesión de panel viva) y aplica la migración REAL
// 20261106510000 dos veces. Cubre los perfiles (solo Ver, solo Subida,
// Subida + Ver, Editar, super admin, sin Facturas y bloqueado): qué ve cada
// uno, qué corrige (solo lo suyo y solo los datos leídos), la subida a
// Storage, el historial de la IA, quién subió cada documento (relleno y
// trigger), que los triggers del servidor sigan escribiendo y el rollback.
import { PGlite } from "@electric-sql/pglite";
import { readFile } from "node:fs/promises";
import assert from "node:assert/strict";

const MIGRACION = await readFile("supabase/migrations/20261106510000_permisos_facturas_subida.sql", "utf8");
const ROLLBACK = await readFile("supabase/rollbacks/20261106510000_permisos_facturas_subida_ROLLBACK.sql", "utf8");

let comprobaciones = 0;
const ok = (v, msg) => { assert.ok(v, msg); comprobaciones++; };
const igual = (a, b, msg) => { assert.deepEqual(a, b, msg); comprobaciones++; };

const U = {
  SA: "a0000000-0000-0000-0000-000000000001",         // super admin
  EDITA: "a0000000-0000-0000-0000-000000000002",      // Facturas: Ver + Editar
  VER: "a0000000-0000-0000-0000-000000000003",        // Facturas: solo Ver
  SUBIDA: "a0000000-0000-0000-0000-000000000004",     // solo «Facturas · Subida»
  SUBIDA_B: "a0000000-0000-0000-0000-000000000005",   // otro con solo Subida
  SUBIDA_VER: "a0000000-0000-0000-0000-000000000006", // Subida + Ver
  SUBIDA_FLAG: "a0000000-0000-0000-0000-000000000007",// Subida guardada solo en can_edit (por SQL)
  NADA: "a0000000-0000-0000-0000-000000000008",       // solo Dashboard
  BLOQ: "a0000000-0000-0000-0000-000000000009",       // Subida, pero bloqueado
};
const BORRADO = "a0000000-0000-0000-0000-0000000000ff"; // creó un trabajo y ya no existe
const sesion = (u) => u.replace(/^a/, "b");
const T = {
  T1: "c0000000-0000-0000-0000-000000000001", // de SUBIDA → F1
  T2: "c0000000-0000-0000-0000-000000000002", // de SUBIDA_B → F2
  T3: "c0000000-0000-0000-0000-000000000003", // de SUBIDA_VER → F3
  T4: "c0000000-0000-0000-0000-000000000004", // de un usuario borrado → F5
  T5: "c0000000-0000-0000-0000-000000000005", // de SUBIDA, sin guardar aún (lo guardará la Edge Function)
};

const ANDAMIAJE = `
  create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
  create schema auth; create schema private; create schema storage;
  create table auth.users (id uuid primary key, email text, banned_until timestamptz);
  create table auth.sessions (id uuid primary key, user_id uuid);
  create function auth.jwt() returns jsonb language sql stable as $$ select nullif(current_setting('request.jwt.claims', true), '')::jsonb $$;
  create function auth.uid() returns uuid language sql stable as $$ select (auth.jwt() ->> 'sub')::uuid $$;
  create function auth.role() returns text language sql stable as $$ select auth.jwt() ->> 'role' $$;
  grant usage on schema public, auth, private, storage to anon, authenticated, service_role;
  grant execute on all functions in schema auth to anon, authenticated, service_role;

  create table public.super_admins (user_id uuid primary key);
  create function public.is_super_admin(_user_id uuid) returns boolean language sql stable security definer set search_path = public
    as $f$ select exists (select 1 from public.super_admins where user_id = _user_id) $f$;
  create table public.user_permissions (id uuid primary key default gen_random_uuid(), user_id uuid not null, section_key text not null,
    can_view boolean default false, can_edit boolean default false, unique (user_id, section_key));
  create function public.has_section_permission(_user_id uuid, _section text, _permission text) returns boolean
    language sql stable security definer set search_path = public as $f$
    select case when public.is_super_admin(_user_id) then true else exists (
      select 1 from public.user_permissions where user_id = _user_id and section_key = _section
        and ((_permission = 'view' and can_view = true) or (_permission = 'edit' and can_edit = true))) end $f$;
  create function public.can_read_section(_section text) returns boolean language sql stable security definer set search_path = public
    as $f$ select public.has_section_permission((select auth.uid()), _section, 'view') $f$;
  -- Como en la demo desde 20261002164236: escribir exige «Editar».
  create function public.can_write_section(_section text) returns boolean language sql stable security definer set search_path = public
    as $f$ select public.has_section_permission((select auth.uid()), _section, 'edit') $f$;
  revoke all on function public.has_section_permission(uuid, text, text) from public, anon, authenticated;
  grant execute on function public.is_super_admin(uuid), public.can_read_section(text), public.can_write_section(text)
    to authenticated, service_role;
  create function private.sesion_panel_permitida() returns boolean language sql stable security definer set search_path = '' as $f$
    select auth.uid() is not null and exists (
      select 1 from auth.users u where u.id = auth.uid() and (u.banned_until is null or u.banned_until <= now())
        and exists (select 1 from auth.sessions s where s.user_id = u.id and s.id::text = auth.jwt()->>'session_id')) $f$;
  revoke all on function private.sesion_panel_permitida() from public;
  grant execute on function private.sesion_panel_permitida() to authenticated;

  -- Tablas de Facturas (las columnas que importan aquí).
  create table public.ocr_trabajos (id uuid primary key, creado_por uuid, estado text not null default 'pendiente',
    factura_id bigint, created_at timestamptz not null default now());
  create table public.ocr_trabajo_paginas (id bigserial primary key, trabajo_id uuid not null references public.ocr_trabajos (id), numero integer not null);
  create table public.facturas (id bigserial primary key, tipo varchar default 'factura', proveedor varchar, cif varchar,
    numero_documento varchar, fecha date, subtotal numeric, iva numeric, total numeric, total_origen text, observaciones text,
    verificada boolean default false, verificacion_origen text, archivo_path text, alertas_validacion jsonb, ocr_trabajo_id uuid,
    proveedor_id bigint, retencion_irpf numeric, retencion_irpf_pct numeric, updated_at timestamp default now());
  create table public.productos_factura (id bigserial primary key, factura_id bigint references public.facturas (id),
    nombre varchar, cantidad numeric default 1, unidad varchar default 'ud', precio_unitario numeric, total numeric,
    producto_id bigint, nombre_normalizado text generated always as (lower(nombre)) stored);
  create table public.historial_precios (id uuid primary key default gen_random_uuid(), producto_nombre text, proveedor text,
    precio numeric, fecha date, factura_id bigint);
  create table public.conversaciones (id uuid primary key default gen_random_uuid(), session_id text, titulo text);
  create table public.mensajes_chat (id bigserial primary key, conversacion_id uuid, session_id text, role text, content text);

  -- Triggers del servidor que también escriben (como los de la demo).
  create function public.actualizar_updated_at() returns trigger language plpgsql as $f$
    begin new.updated_at := now(); return new; end $f$;
  create trigger trigger_facturas_updated before update on public.facturas for each row execute function public.actualizar_updated_at();
  -- Asigna el producto al cambiar el nombre (productos_factura_asignar_producto): va DESPUÉS del de la migración.
  create function public.productos_factura_asignar_producto() returns trigger language plpgsql security definer set search_path = public as $f$
    begin if new.nombre ilike '%gamba%' then new.producto_id := 7; end if; return new; end $f$;
  create trigger trg_productos_factura_asignar_producto before insert or update of nombre on public.productos_factura
    for each row execute function public.productos_factura_asignar_producto();
  -- Apunta el precio al añadir una línea (actualizar_historial_precios): SECURITY INVOKER, como en la demo.
  create function public.actualizar_historial_precios() returns trigger language plpgsql set search_path to 'public' as $f$
    begin
      if (select tipo from public.facturas where id = new.factura_id) = 'factura' and new.precio_unitario is not null then
        insert into public.historial_precios (producto_nombre, proveedor, precio, fecha, factura_id)
        select new.nombre, f.proveedor, new.precio_unitario, f.fecha, new.factura_id from public.facturas f where f.id = new.factura_id;
      end if;
      return new;
    end $f$;
  create trigger trigger_historial_precios after insert on public.productos_factura for each row execute function public.actualizar_historial_precios();
  -- Recalcula avisos de la cabecera al cambiar una línea (productos_factura_recalcular_alertas).
  create function public.productos_factura_recalcular_alertas() returns trigger language plpgsql security definer set search_path = public as $f$
    begin update public.facturas set alertas_validacion = jsonb_build_array(jsonb_build_object('codigo', 'recalculada'))
           where id = new.factura_id; return new; end $f$;
  create trigger trg_productos_factura_recalcular_alertas after update of total on public.productos_factura
    for each row execute function public.productos_factura_recalcular_alertas();

  do $f$
  declare t text;
  begin
    foreach t in array array['ocr_trabajos', 'ocr_trabajo_paginas', 'facturas', 'productos_factura', 'historial_precios', 'conversaciones', 'mensajes_chat'] loop
      execute format('alter table public.%I enable row level security', t);
      execute format('grant select, insert, update, delete on public.%I to authenticated', t);
      execute format('grant all on public.%I to service_role', t);
      execute format('create policy acceso_panel_no_bloqueado on public.%I as restrictive for all to authenticated
        using ((select private.sesion_panel_permitida())) with check ((select private.sesion_panel_permitida()))', t);
    end loop;
  end $f$;
  grant usage on all sequences in schema public to authenticated, service_role;

  create policy facturas_select_seccion on public.facturas for select to authenticated using ((select public.can_read_section('facturas')));
  create policy facturas_insert_seccion on public.facturas for insert to authenticated with check ((select public.can_write_section('facturas')));
  create policy facturas_update_seccion on public.facturas for update to authenticated
    using ((select public.can_write_section('facturas'))) with check ((select public.can_write_section('facturas')));
  create policy facturas_delete_seccion on public.facturas for delete to authenticated using ((select public.can_write_section('facturas')));
  create policy facturas_service_role on public.facturas for all to service_role using (true) with check (true);
  create policy productos_factura_select_seccion on public.productos_factura for select to authenticated using ((select public.can_read_section('facturas')));
  create policy productos_factura_insert_seccion on public.productos_factura for insert to authenticated with check ((select public.can_write_section('facturas')));
  create policy productos_factura_update_seccion on public.productos_factura for update to authenticated
    using ((select public.can_write_section('facturas'))) with check ((select public.can_write_section('facturas')));
  create policy productos_factura_delete_seccion on public.productos_factura for delete to authenticated using ((select public.can_write_section('facturas')));
  create policy productos_factura_service_role on public.productos_factura for all to service_role using (true) with check (true);
  create policy historial_precios_select_seccion on public.historial_precios for select to authenticated using ((select public.can_read_section('facturas')));
  create policy historial_precios_insert_seccion on public.historial_precios for insert to authenticated with check ((select public.can_write_section('facturas')));
  create policy historial_precios_service_role on public.historial_precios for all to service_role using (true) with check (true);
  create policy ocr_trabajos_select on public.ocr_trabajos for select to authenticated using ((select public.can_read_section('facturas')));
  create policy ocr_paginas_select on public.ocr_trabajo_paginas for select to authenticated using ((select public.can_read_section('facturas')));
  create policy conversaciones_select_seccion on public.conversaciones for select to authenticated using ((select public.can_read_section('facturas')));
  create policy conversaciones_insert_seccion on public.conversaciones for insert to authenticated with check ((select public.can_write_section('facturas')));
  create policy mensajes_chat_select_seccion on public.mensajes_chat for select to authenticated using ((select public.can_read_section('facturas')));
  create policy mensajes_chat_insert_seccion on public.mensajes_chat for insert to authenticated with check ((select public.can_write_section('facturas')));

  create function public.ocr_resumen_factura_datos(p_factura_id bigint) returns jsonb language sql stable security definer set search_path = public
    as $f$ select jsonb_build_object('id', p_factura_id, 'lineas', (select count(*) from public.productos_factura where factura_id = p_factura_id),
                                     'totales_lineas', 0) $f$;
  revoke all on function public.ocr_resumen_factura_datos(bigint) from public, anon, authenticated;
  create function public.ocr_resumen_factura(p_factura_id bigint) returns jsonb language plpgsql stable security definer set search_path to 'public'
    as $f$ begin
      if not public.can_read_section('facturas') then raise exception 'Sin permiso para ver facturas' using errcode = '42501'; end if;
      return public.ocr_resumen_factura_datos(p_factura_id) - 'totales_lineas';
    end $f$;
  revoke all on function public.ocr_resumen_factura(bigint) from public, anon;
  grant execute on function public.ocr_resumen_factura(bigint) to authenticated, service_role;

  -- Storage (bucket privado facturas-originales con sus dos políticas de la demo).
  create table storage.buckets (id text primary key, name text, public boolean default false);
  create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text references storage.buckets (id),
    name text, owner uuid default auth.uid(), unique (bucket_id, name));
  create function storage.foldername(name text) returns text[] language plpgsql immutable as $f$
    declare _parts text[]; begin select string_to_array(name, '/') into _parts; return _parts[1:array_length(_parts, 1) - 1]; end $f$;
  grant execute on function storage.foldername(text) to anon, authenticated, service_role;
  alter table storage.objects enable row level security;
  grant select, insert, update, delete on storage.objects to anon, authenticated;
  grant all on storage.objects, storage.buckets to service_role;
  insert into storage.buckets (id, name) values ('facturas-originales', 'facturas-originales'), ('otro', 'otro');
  create policy acceso_panel_no_bloqueado on storage.objects as restrictive for all to authenticated
    using ((select private.sesion_panel_permitida())) with check ((select private.sesion_panel_permitida()));
  create policy facturas_originales_select on storage.objects for select to authenticated
    using (bucket_id = 'facturas-originales' and public.can_read_section('facturas'));
  create policy facturas_originales_pendientes_insert on storage.objects for insert to authenticated
    with check (bucket_id = 'facturas-originales' and (storage.foldername(name))[1] = 'pendientes'
      and (storage.foldername(name))[2] = (select auth.uid())::text and public.can_read_section('facturas'));
`;

const DATOS = `
  insert into auth.users (id, email) select u::uuid, 'u@t' from unnest(array[
    '${U.SA}', '${U.EDITA}', '${U.VER}', '${U.SUBIDA}', '${U.SUBIDA_B}', '${U.SUBIDA_VER}', '${U.SUBIDA_FLAG}', '${U.NADA}']) u;
  insert into auth.users values ('${U.BLOQ}', 'bloq@t', now() + interval '1 day');
  insert into auth.sessions (id, user_id) select ('b' || substr(id::text, 2))::uuid, id from auth.users;
  insert into public.super_admins values ('${U.SA}');
  insert into public.user_permissions (user_id, section_key, can_view, can_edit) values
    ('${U.EDITA}', 'facturas', true, true),
    ('${U.VER}', 'facturas', true, false),
    ('${U.SUBIDA}', 'facturas_subida', true, false),
    ('${U.SUBIDA_B}', 'facturas_subida', true, false),
    ('${U.SUBIDA_VER}', 'facturas', true, false), ('${U.SUBIDA_VER}', 'facturas_subida', true, false),
    ('${U.SUBIDA_FLAG}', 'facturas_subida', false, true),
    ('${U.NADA}', 'dashboard', true, false),
    ('${U.BLOQ}', 'facturas_subida', true, false);
  insert into public.ocr_trabajos (id, creado_por, estado) values
    ('${T.T1}', '${U.SUBIDA}', 'completado'), ('${T.T2}', '${U.SUBIDA_B}', 'completado'),
    ('${T.T3}', '${U.SUBIDA_VER}', 'completado'), ('${T.T4}', '${BORRADO}', 'completado'), ('${T.T5}', '${U.SUBIDA}', 'paginas');
  insert into public.ocr_trabajo_paginas (trabajo_id, numero) values ('${T.T1}', 1), ('${T.T2}', 1), ('${T.T5}', 1), ('${T.T5}', 2);
  insert into public.facturas (id, numero_documento, proveedor, total, ocr_trabajo_id, archivo_path) values
    (1, 'F-1', 'Pescados', 100, '${T.T1}', 'facturas/2026/f1.pdf'),
    (2, 'F-2', 'Carnes', 200, '${T.T2}', 'facturas/2026/f2.pdf'),
    (3, 'F-3', 'Frutas', 300, '${T.T3}', null),
    (4, 'F-4', 'Histórica', 400, null, null),
    (5, 'F-5', 'Antigua', 500, '${T.T4}', null);
  select setval('public.facturas_id_seq', 5);
  insert into public.productos_factura (factura_id, nombre, cantidad, precio_unitario, total) values
    (1, 'Merluza', 2, 10, 20), (1, 'Rape', 1, 30, 30), (2, 'Ternera', 1, 50, 50), (3, 'Naranja', 5, 1, 5), (4, 'Viejo', 1, 1, 1);
  insert into storage.objects (bucket_id, name) values
    ('facturas-originales', 'facturas/2026/f1.pdf'), ('facturas-originales', 'facturas/2026/f2.pdf'),
    ('facturas-originales', 'pendientes/${U.SUBIDA}/${T.T5}/original.pdf'),
    ('facturas-originales', 'pendientes/${U.SUBIDA_B}/x/original.pdf');
  insert into public.conversaciones (id, session_id, titulo) values ('d0000000-0000-0000-0000-000000000001', 's1', 'Gasto de octubre');
  insert into public.mensajes_chat (conversacion_id, session_id, role, content) values ('d0000000-0000-0000-0000-000000000001', 's1', 'user', '¿Cuánto?');
`;

// ─── 0. Si falta algo de lo que depende, se para sin cambiar nada ──────────
{
  const otra = new PGlite();
  await otra.exec(ANDAMIAJE + "drop function public.ocr_resumen_factura(bigint); drop function public.ocr_resumen_factura_datos(bigint);");
  await assert.rejects(otra.exec(MIGRACION), /falta ocr_resumen_factura_datos/, "no se paró sin ocr_resumen_factura_datos");
  comprobaciones++;
  await otra.exec("rollback");
  igual((await otra.query(`select count(*)::int n from information_schema.columns where table_name = 'facturas' and column_name = 'subido_por'`)).rows[0].n, 0,
    "la migración abortada dejó la columna subido_por");
  await otra.close();
}
// can_write_section mirando «Ver» (antes de 20261002164236): «Ver» seguiría escribiendo → se para.
{
  const otra = new PGlite();
  await otra.exec(ANDAMIAJE + `create or replace function public.can_write_section(_section text) returns boolean language sql stable security definer
    set search_path = public as $f$ select public.has_section_permission((select auth.uid()), _section, 'view') $f$;`);
  await assert.rejects(otra.exec(MIGRACION), /can_write_section que exija «Editar»/, "no se paró con can_write_section mirando «Ver»");
  comprobaciones++;
  await otra.exec("rollback");
  await otra.close();
}
// Una política vieja desconocida que reabriría la escritura por OR: se para.
{
  const otra = new PGlite();
  await otra.exec(ANDAMIAJE + `create policy "Escritura libre" on public.productos_factura for update to authenticated using (true);`);
  await assert.rejects(otra.exec(MIGRACION), /política que sobra en productos_factura: Escritura libre/, "no se paró con una política que reabre");
  comprobaciones++;
  await otra.exec("rollback");
  igual((await otra.query(`select count(*)::int n from pg_policies where policyname = 'facturas_select_subida'`)).rows[0].n, 0,
    "la migración abortada dejó políticas");
  await otra.close();
}

const db = new PGlite();
await db.exec(ANDAMIAJE);
await db.exec(DATOS);
const q = (sql, params) => db.query(sql, params);

async function como(u, fn, rol = "authenticated") {
  await db.exec("begin");
  try {
    if (rol === "service_role") {
      await db.exec(`set local role service_role; select set_config('request.jwt.claims', '{"role":"service_role"}', true);`);
    } else {
      await db.exec(`set local role authenticated;
        select set_config('request.jwt.claims', '${JSON.stringify({ sub: u, role: "authenticated", session_id: sesion(u) })}', true);`);
    }
    const r = await fn();
    await db.exec("commit");
    return r;
  } catch (e) {
    await db.exec("rollback").catch(() => {});
    throw e;
  }
}
const filas = async (u, sql, params) => (await como(u, () => q(sql, params))).rows;
const cuantas = async (u, sql, params) => (await filas(u, sql, params)).length;
const ids = async (u, sql) => (await filas(u, sql)).map((r) => Number(r.id));
const rechaza = async (u, sql, patron, msg) => {
  await assert.rejects(como(u, () => q(sql)), patron, msg);
  comprobaciones++;
};
const RLS = /row-level security/;
const SOLO_LEIDO = /solo puedes corregir los datos leídos/;
const subirA = (u, nombre) => como(u, () => q("insert into storage.objects (bucket_id, name) values ('facturas-originales', $1) returning name", [nombre]));

// Antes: «Ver» sube a pendientes/{su uid}/ (lo que cambia la decisión 1).
await subirA(U.VER, `pendientes/${U.VER}/antes/original.pdf`); comprobaciones++;
igual(await cuantas(U.VER, "select id from public.conversaciones"), 1, "antes: «Ver» leía el historial de la IA");

// ─── 1. Migración (dos veces) y quién subió cada documento ─────────────────
await db.exec(MIGRACION);
await db.exec(MIGRACION);
const dueños = async () => (await q("select id::int id, subido_por::text u from public.facturas order by id")).rows;
igual(await dueños(), [
  { id: 1, u: U.SUBIDA }, { id: 2, u: U.SUBIDA_B }, { id: 3, u: U.SUBIDA_VER }, { id: 4, u: null }, { id: 5, u: null },
], "relleno: el creador del trabajo de OCR; sin trabajo o con el usuario borrado, sin dueño");
igual((await q("select column_default d from information_schema.columns where table_name = 'facturas' and column_name = 'subido_por'")).rows[0].d,
  "auth.uid()", "default auth.uid()");

// La Edge Function guarda con la service role: el dueño sale del trabajo de OCR.
await como(null, () => q(`insert into public.facturas (id, numero_documento, total, ocr_trabajo_id) values (6, 'F-6', 60, '${T.T5}')`), "service_role");
igual((await q("select subido_por::text u from public.facturas where id = 6")).rows[0].u, U.SUBIDA, "service role + trabajo → dueño del trabajo");
await como(null, () => q(`insert into public.productos_factura (factura_id, nombre, total) values (6, 'Sepia', 6)`), "service_role");
// Quien tiene «Editar» crea a mano: el dueño es él (default auth.uid()).
await como(U.EDITA, () => q(`insert into public.facturas (id, numero_documento, total) values (7, 'F-7', 70)`));
igual((await q("select subido_por::text u from public.facturas where id = 7")).rows[0].u, U.EDITA, "inserción con sesión → auth.uid()");

// ─── 2. facturas_puede_subir() por perfil ──────────────────────────────────
const puede = async (u) => (await filas(u, "select public.facturas_puede_subir() p"))[0].p;
igual(
  { SA: await puede(U.SA), EDITA: await puede(U.EDITA), VER: await puede(U.VER), SUBIDA: await puede(U.SUBIDA),
    SUBIDA_VER: await puede(U.SUBIDA_VER), SUBIDA_FLAG: await puede(U.SUBIDA_FLAG), NADA: await puede(U.NADA) },
  { SA: true, EDITA: true, VER: false, SUBIDA: true, SUBIDA_VER: true, SUBIDA_FLAG: true, NADA: false },
  "puede subir: super admin, Editar y Subida (can_view o can_edit); «Ver» solo, no");
await assert.rejects(
  (async () => { await db.exec("begin; set local role anon;"); try { await q("select public.facturas_puede_subir()"); } finally { await db.exec("rollback"); } })(),
  /permission denied/, "anon pudo llamar a facturas_puede_subir");
comprobaciones++;

// ─── 3. Qué documentos ve cada uno ─────────────────────────────────────────
const verDocs = (u) => ids(u, "select id from public.facturas order by id");
igual(await verDocs(U.VER), [1, 2, 3, 4, 5, 6, 7], "«Ver» consulta todos");
igual(await verDocs(U.EDITA), [1, 2, 3, 4, 5, 6, 7], "«Editar» ve todos");
igual(await verDocs(U.SA), [1, 2, 3, 4, 5, 6, 7], "el super admin ve todos");
igual(await verDocs(U.SUBIDA), [1, 6], "solo Subida: solo lo que subió él");
igual(await verDocs(U.SUBIDA_B), [2], "otro con Subida: solo lo suyo");
igual(await verDocs(U.SUBIDA_VER), [1, 2, 3, 4, 5, 6, 7], "Subida + Ver: consulta todos");
igual(await verDocs(U.NADA), [], "sin Facturas no ve nada");
igual(await verDocs(U.BLOQ), [], "bloqueado no ve nada");
igual(await cuantas(U.SUBIDA, "select id from public.productos_factura"), 3, "solo Subida: solo las líneas de lo suyo (F-1 y F-6)");
igual(await cuantas(U.SUBIDA_B, "select id from public.productos_factura"), 1, "otro con Subida: solo sus líneas");
igual(await cuantas(U.VER, "select id from public.productos_factura"), 6, "«Ver» lee todas las líneas");

// ─── 4. Corregir la cabecera: solo lo suyo y solo los datos leídos ─────────
const corregirTotal = (u, id, total) => cuantas(u, `update public.facturas set total = ${total}, total_origen = 'leido' where id = ${id} returning id`);
igual(await corregirTotal(U.SUBIDA, 1, 101), 1, "solo Subida corrige el total de lo suyo");
igual(await cuantas(U.SUBIDA, `update public.facturas set proveedor = 'Pescados Paco', cif = 'B1', numero_documento = 'F-1b',
  fecha = '2026-10-01', subtotal = 90, iva = 11, observaciones = 'ok', verificada = false where id = 1 returning id`), 1,
  "y proveedor, CIF, número, fecha, importes y observaciones (mandar verificada sin cambiarla no molesta)");
igual(await corregirTotal(U.SUBIDA, 2, 1), 0, "solo Subida no toca lo de otro");
igual(await corregirTotal(U.SUBIDA, 4, 1), 0, "ni lo histórico sin dueño");
igual(await corregirTotal(U.VER, 1, 1), 0, "«Ver» no corrige nada");
igual(await corregirTotal(U.NADA, 1, 1), 0, "sin Facturas, nada");
igual(await corregirTotal(U.BLOQ, 1, 1), 0, "bloqueado, nada");
igual(await corregirTotal(U.SUBIDA_VER, 3, 301), 1, "Subida + Ver corrige lo suyo");
igual(await corregirTotal(U.SUBIDA_VER, 1, 1), 0, "Subida + Ver no corrige lo de otro");
igual(await corregirTotal(U.EDITA, 2, 202), 1, "«Editar» corrige cualquiera");
igual(await corregirTotal(U.SA, 4, 404), 1, "el super admin, también");
await rechaza(U.SUBIDA, "update public.facturas set verificada = true where id = 1", SOLO_LEIDO, "solo Subida verificó");
await rechaza(U.SUBIDA, `update public.facturas set subido_por = '${U.SUBIDA_B}' where id = 1`, SOLO_LEIDO, "solo Subida regaló su documento");
await rechaza(U.SUBIDA, "update public.facturas set archivo_path = null where id = 1", SOLO_LEIDO, "solo Subida quitó el original");
await rechaza(U.SUBIDA, "update public.facturas set tipo = 'albaran' where id = 1", SOLO_LEIDO, "solo Subida cambió el tipo");
igual(await cuantas(U.EDITA, "update public.facturas set verificada = true where id = 1 returning id"), 1, "«Editar» verifica");
await como(null, () => q("update public.facturas set verificada = false, verificacion_origen = null where id = 1"), "service_role");
comprobaciones++;

// ─── 5. Corregir las líneas de lo suyo ─────────────────────────────────────
const lineaDe = async (factura, nombre) => (await q(`select id::int id from public.productos_factura where factura_id = ${factura} and nombre = '${nombre}'`)).rows[0].id;
const merluza = await lineaDe(1, "Merluza");
const ternera = await lineaDe(2, "Ternera");
igual(await cuantas(U.SUBIDA, `update public.productos_factura set nombre = 'Merluza fresca', cantidad = 3, unidad = 'kg',
  precio_unitario = 9, total = 27 where id = ${merluza} returning id`), 1,
  "solo Subida corrige nombre, cantidad, unidad, precio y total de una línea suya (columna generada incluida)");
igual((await q(`select alertas_validacion a from public.facturas where id = 1`)).rows[0].a, [{ codigo: "recalculada" }],
  "y el trigger del servidor recalcula los avisos de la cabecera (no lo frena el de la migración)");
await rechaza(U.SUBIDA, `update public.productos_factura set producto_id = 3 where id = ${merluza}`, SOLO_LEIDO, "solo Subida clasificó una línea");
await rechaza(U.SUBIDA, `update public.productos_factura set factura_id = 6 where id = ${merluza}`, SOLO_LEIDO, "solo Subida movió una línea");
igual(await cuantas(U.SUBIDA, `update public.productos_factura set total = 1 where id = ${ternera} returning id`), 0, "ni las líneas de otro");
igual(await cuantas(U.VER, `update public.productos_factura set total = 1 where id = ${merluza} returning id`), 0, "«Ver» no corrige líneas");
igual(await cuantas(U.SUBIDA, `delete from public.productos_factura where id = ${merluza} returning id`), 0, "solo Subida no borra líneas");
await como(U.SUBIDA, () => q("insert into public.productos_factura (factura_id, nombre, precio_unitario, total) values (1, 'Gambas', 6, 12)"));
comprobaciones++;
igual((await q("select producto_id::int p from public.productos_factura where factura_id = 1 and nombre = 'Gambas'")).rows[0].p, 7,
  "solo Subida añade una línea que faltaba a lo suyo; el producto lo asigna el servidor");
igual((await q("select precio::int p from public.historial_precios where factura_id = 1 and producto_nombre = 'Gambas'")).rows, [{ p: 6 }],
  "y el historial de precios la apunta (trigger SECURITY INVOKER)");
await rechaza(U.SUBIDA, "insert into public.historial_precios (producto_nombre, precio, factura_id) values ('Colado', 1, 2)", RLS,
  "solo Subida apuntó un precio en lo de otro");
await rechaza(U.VER, "insert into public.historial_precios (producto_nombre, precio, factura_id) values ('Colado', 1, 1)", RLS,
  "«Ver» apuntó un precio");
await rechaza(U.SUBIDA, "insert into public.productos_factura (factura_id, nombre, total, producto_id) values (1, 'Pulpo', 5, 3)",
  /Clasificar una línea exige «Editar»/, "solo Subida clasificó al añadir");
await rechaza(U.SUBIDA, "insert into public.productos_factura (factura_id, nombre, total) values (2, 'Pulpo', 5)", RLS, "solo Subida añadió a lo de otro");
await rechaza(U.VER, "insert into public.productos_factura (factura_id, nombre, total) values (1, 'Pulpo', 5)", RLS, "«Ver» añadió una línea");
await rechaza(U.SUBIDA, "insert into public.facturas (numero_documento) values ('a mano')", RLS, "solo Subida creó un documento a mano");
igual(await cuantas(U.EDITA, `update public.productos_factura set producto_id = 3 where id = ${merluza} returning id`), 1, "«Editar» clasifica");

// ─── 6. La cola de «Cargar»: sus trabajos y sus páginas ────────────────────
const trabajos = async (u) => (await filas(u, "select id::text id from public.ocr_trabajos order by id")).map((r) => r.id);
igual(await trabajos(U.SUBIDA), [T.T1, T.T5], "solo Subida ve sus trabajos");
igual(await trabajos(U.SUBIDA_B), [T.T2], "otro con Subida, los suyos");
igual((await trabajos(U.VER)).length, 5, "«Ver» sigue leyendo los trabajos (lectura)");
igual(await trabajos(U.NADA), [], "sin Facturas, ninguno");
igual(await cuantas(U.SUBIDA, "select id from public.ocr_trabajo_paginas"), 3, "y las páginas de sus trabajos");
igual(await cuantas(U.SUBIDA_B, "select id from public.ocr_trabajo_paginas"), 1, "solo las de los suyos");

// ─── 7. Storage ────────────────────────────────────────────────────────────
await subirA(U.SUBIDA, `pendientes/${U.SUBIDA}/nuevo/original.pdf`); comprobaciones++;
await subirA(U.EDITA, `pendientes/${U.EDITA}/nuevo/original.pdf`); comprobaciones++;
await subirA(U.SUBIDA_FLAG, `pendientes/${U.SUBIDA_FLAG}/nuevo/original.pdf`); comprobaciones++;
await assert.rejects(subirA(U.VER, `pendientes/${U.VER}/despues/original.pdf`), RLS, "«Ver» sigue subiendo"); comprobaciones++;
await assert.rejects(subirA(U.SUBIDA, `pendientes/${U.SUBIDA_B}/x/otro.pdf`), RLS, "solo Subida subió en la carpeta de otro"); comprobaciones++;
await assert.rejects(subirA(U.SUBIDA, "facturas/2026/colado.pdf"), RLS, "solo Subida subió fuera de pendientes/"); comprobaciones++;
await assert.rejects(subirA(U.NADA, `pendientes/${U.NADA}/x/original.pdf`), RLS, "sin Facturas subió"); comprobaciones++;
await assert.rejects(subirA(U.BLOQ, `pendientes/${U.BLOQ}/x/original.pdf`), RLS, "bloqueado subió"); comprobaciones++;
const originales = async (u) => (await filas(u, "select name from storage.objects where bucket_id = 'facturas-originales' order by name")).map((r) => r.name);
igual(await originales(U.SUBIDA), ["facturas/2026/f1.pdf", `pendientes/${U.SUBIDA}/${T.T5}/original.pdf`, `pendientes/${U.SUBIDA}/nuevo/original.pdf`],
  "solo Subida lee sus pendientes y el original de lo suyo");
igual(await originales(U.SUBIDA_B), ["facturas/2026/f2.pdf", `pendientes/${U.SUBIDA_B}/x/original.pdf`], "otro con Subida, lo suyo");
igual((await originales(U.VER)).length, 8, "«Ver» sigue viendo todos los originales");
igual(await originales(U.NADA), [], "sin Facturas, ninguno");

// ─── 8. La IA de Facturas, solo con «Editar» ───────────────────────────────
igual(await cuantas(U.VER, "select id from public.conversaciones"), 0, "«Ver» ya no lee el historial de la IA");
igual(await cuantas(U.VER, "select id from public.mensajes_chat"), 0, "ni sus mensajes");
igual(await cuantas(U.SUBIDA, "select id from public.conversaciones"), 0, "solo Subida tampoco");
igual(await cuantas(U.EDITA, "select id from public.conversaciones"), 1, "«Editar» sí");
igual(await cuantas(U.EDITA, "select id from public.mensajes_chat"), 1, "y sus mensajes");
igual((await q("select count(*)::int n from pg_policies where tablename = 'n8n_chat_histories'")).rows[0].n, 0,
  "una tabla del chat que no existe (n8n_chat_histories) se salta");

// ─── 9. ocr_resumen_factura («Sustituir» / «Añadir página» en Cargar) ──────
const resumen = async (u, id) => (await filas(u, `select public.ocr_resumen_factura(${id}) r`))[0].r;
igual(await resumen(U.VER, 2), { id: 2, lineas: 1 }, "«Ver» relee cualquiera");
igual(await resumen(U.SUBIDA, 1), { id: 1, lineas: 3 }, "solo Subida relee lo suyo");
await rechaza(U.SUBIDA, "select public.ocr_resumen_factura(2)", /Sin permiso para ver facturas/, "solo Subida releyó lo de otro");
await rechaza(U.NADA, "select public.ocr_resumen_factura(1)", /Sin permiso para ver facturas/, "sin Facturas releyó");

// ─── 10. La service role (Edge Functions) escribe como siempre ─────────────
await como(null, () => q("update public.facturas set verificada = true, archivo_path = null where id = 2"), "service_role");
await como(null, () => q(`update public.productos_factura set producto_id = 9 where id = ${ternera}`), "service_role");
comprobaciones += 2;

// ─── 11. Rollback: como estaba, y se puede volver a aplicar ────────────────
await db.exec(ROLLBACK);
await db.exec(ROLLBACK);
igual(await verDocs(U.SUBIDA), [], "rollback: solo Subida ya no ve nada");
igual(await corregirTotal(U.SUBIDA, 1, 1), 0, "rollback: ni corrige");
await subirA(U.VER, `pendientes/${U.VER}/rollback/original.pdf`); comprobaciones++;
await assert.rejects(subirA(U.SUBIDA, `pendientes/${U.SUBIDA}/rollback/original.pdf`), RLS, "rollback: solo Subida sigue subiendo"); comprobaciones++;
igual(await cuantas(U.VER, "select id from public.conversaciones"), 1, "rollback: «Ver» vuelve a leer el historial de la IA");
await rechaza(U.SUBIDA, "select public.ocr_resumen_factura(1)", /Sin permiso para ver facturas/, "rollback: ocr_resumen_factura solo con «Ver»");
igual(await cuantas(U.EDITA, "update public.facturas set verificada = false where id = 1 returning id"), 1, "rollback: «Editar» sigue editando");
igual((await q("select count(*)::int n from public.facturas where subido_por is not null")).rows[0].n, 5, "rollback: subido_por se conserva");
igual((await q(`select count(*)::int n from pg_proc where proname in ('facturas_puede_subir', 'facturas_subida_solo_lo_leido', 'factura_subida_por_mi')`)).rows[0].n, 0,
  "rollback: sin funciones nuevas");
await db.exec(MIGRACION);
igual(await verDocs(U.SUBIDA), [1, 6], "reaplicada: solo Subida vuelve a ver lo suyo");
igual(await dueños().then((d) => d.find((x) => x.id === 6).u), U.SUBIDA, "reaplicada: no pisa los dueños");

await db.close();
console.log(`permisos_facturas_subida (PGlite): ${comprobaciones} comprobaciones OK`);
