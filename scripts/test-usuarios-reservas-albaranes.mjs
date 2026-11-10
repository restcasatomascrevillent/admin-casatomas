// Tipos de usuario «Reservas» (ver y crear reservas) y «Albaranes» (solo subir
// fotos) contra un Postgres en memoria (PGlite). Nunca toca Supabase.
//
//   npm run test:usuarios-reservas-albaranes:db
//
// Parte del estado de la demo el 10/11/2026 (políticas de reservas,
// asignaciones_mesa, blacklist, salas_cerradas_servicio, configuracion_reservas,
// facturas, productos_factura, ocr_trabajos, ocr_trabajo_paginas y del bucket
// facturas-originales tras 20261106510000; permisos por sección con el super
// admin siempre dentro; sesión de panel viva) y aplica la migración REAL
// 20261122143500 dos veces. Demuestra que el usuario «Reservas» solo ve y crea
// reservas (como el formulario del panel; ni modificar, ni borrar, ni cambiar
// el estado, ni mesas, ni configuración, ni otras secciones) y que el de
// «Albaranes» solo sube fotos a su carpeta y ve el ESTADO de lo suyo (ni
// facturas, ni líneas, ni lo leído, ni importes, ni fotos de otros). También
// que se para si falta algo, que lo de «Facturas · Subida» no cambia y el rollback.
import { PGlite } from "@electric-sql/pglite";
import { readFile } from "node:fs/promises";
import assert from "node:assert/strict";

const MIGRACION = await readFile("supabase/migrations/20261122143500_usuarios_reservas_albaranes.sql", "utf8");
const ROLLBACK = await readFile("supabase/rollbacks/20261122143500_usuarios_reservas_albaranes_ROLLBACK.sql", "utf8");

let comprobaciones = 0;
const ok = (v, msg) => { assert.ok(v, msg); comprobaciones++; };
const igual = (a, b, msg) => { assert.deepEqual(a, b, msg); comprobaciones++; };

const U = {
  SA: "a0000000-0000-0000-0000-000000000001",          // super admin
  RES: "a0000000-0000-0000-0000-000000000002",         // tipo «Reservas»: Ver Reservas + Reservas · Crear
  RES_FLAG: "a0000000-0000-0000-0000-000000000003",    // igual, con reservas_crear guardado en can_edit (por SQL)
  CREAR_SIN_VER: "a0000000-0000-0000-0000-000000000004", // Reservas · Crear sin «Ver» en Reservas
  VER: "a0000000-0000-0000-0000-000000000005",         // Reservas: solo Ver
  EDITA: "a0000000-0000-0000-0000-000000000006",       // Reservas: Ver + Editar
  ALB: "a0000000-0000-0000-0000-000000000007",         // tipo «Albaranes»
  ALB_B: "a0000000-0000-0000-0000-000000000008",       // otro de albaranes
  SUBIDA: "a0000000-0000-0000-0000-000000000009",      // «Facturas · Subida» (lo de antes)
  BLOQ: "a0000000-0000-0000-0000-00000000000a",        // albaranes, pero bloqueado
  NADA: "a0000000-0000-0000-0000-00000000000b",        // solo Dashboard
};
const sesion = (u) => u.replace(/^a/, "b");
const T = {
  ALB1: "c0000000-0000-0000-0000-000000000001", // de ALB, ya guardado (→ factura 1)
  ALB2: "c0000000-0000-0000-0000-000000000002", // de ALB, leyéndose
  ALB_VIEJO: "c0000000-0000-0000-0000-000000000003", // de ALB, de hace un mes
  ALB_B1: "c0000000-0000-0000-0000-000000000004", // de ALB_B
  SUB1: "c0000000-0000-0000-0000-000000000005", // de SUBIDA (→ factura 2)
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
  create function public.can_write_section(_section text) returns boolean language sql stable security definer set search_path = public
    as $f$ select public.has_section_permission((select auth.uid()), _section, 'edit') $f$;
  create function public.can_edit_section(_section text) returns boolean language sql stable security definer set search_path = ''
    as $f$ select public.has_section_permission((select auth.uid()), _section, 'edit') $f$;
  revoke all on function public.has_section_permission(uuid, text, text) from public, anon, authenticated;
  grant execute on function public.has_section_permission(uuid, text, text) to service_role;
  grant execute on function public.is_super_admin(uuid), public.can_read_section(text), public.can_write_section(text),
    public.can_edit_section(text) to authenticated, service_role;
  create function private.sesion_panel_permitida() returns boolean language sql stable security definer set search_path = '' as $f$
    select auth.uid() is not null and exists (
      select 1 from auth.users u where u.id = auth.uid() and (u.banned_until is null or u.banned_until <= now())
        and exists (select 1 from auth.sessions s where s.user_id = u.id and s.id::text = auth.jwt()->>'session_id')) $f$;
  revoke all on function private.sesion_panel_permitida() from public;
  grant execute on function private.sesion_panel_permitida() to authenticated;

  -- ── Reservas (las columnas que importan aquí, CHECK de la demo) ──
  create table public.reservas (id uuid primary key default gen_random_uuid(), fecha date not null, hora time not null,
    numero_comensales integer not null check (numero_comensales > 0),
    estado varchar default 'pendiente' check (estado in ('pendiente', 'verificada', 'confirmada', 'cancelada', 'completada', 'no_show')),
    nombre varchar, telefono varchar, email varchar, en_blacklist boolean default false, importante boolean default false,
    espacio_id uuid, canal text default 'web' check (canal in ('web', 'telefono', 'manual', 'presencial')), marca text default 'casa_tomas',
    llegada_at timestamptz, salida_at timestamptz, solicitud_id uuid, email_verificado_at timestamptz,
    mesa_fijada boolean default false, notas_cliente text, updated_at timestamptz default now());
  create table public.asignaciones_mesa (id uuid primary key default gen_random_uuid(), reserva_id uuid, mesa_id uuid);
  create table public.blacklist (id uuid primary key default gen_random_uuid(), telefono text);
  create table public.salas_cerradas_servicio (id uuid primary key default gen_random_uuid(), espacio_id uuid, fecha date);
  create table public.configuracion_reservas (id uuid primary key default gen_random_uuid(), dias_max_antelacion integer not null default 60);
  -- Un trigger de la demo que escribe al crear (auditoría, SECURITY DEFINER): tiene que seguir funcionando.
  create table public.audit_log (id bigserial primary key, tabla text, accion text, usuario uuid);
  create function public.fn_registrar_auditoria() returns trigger language plpgsql security definer set search_path = public as $f$
    begin insert into public.audit_log (tabla, accion, usuario) values (tg_table_name, tg_op, auth.uid()); return coalesce(new, old); end $f$;
  create trigger trg_auditoria after insert or update or delete on public.reservas for each row execute function public.fn_registrar_auditoria();

  -- ── Facturas (estado tras 20261106510000) ──
  create table public.ocr_trabajos (id uuid primary key, creado_por uuid, estado text not null default 'pendiente',
    nombre_original text, num_paginas smallint default 1, resultado jsonb, factura_id bigint, error text,
    created_at timestamptz not null default now(), terminado_at timestamptz);
  create table public.ocr_trabajo_paginas (id bigserial primary key, trabajo_id uuid not null references public.ocr_trabajos (id), numero integer not null);
  create table public.facturas (id bigserial primary key, proveedor varchar, numero_documento varchar, total numeric,
    subido_por uuid, ocr_trabajo_id uuid, archivo_path text);
  create table public.productos_factura (id bigserial primary key, factura_id bigint references public.facturas (id), nombre varchar, total numeric);

  create function public.facturas_puede_subir_usuario(_user_id uuid) returns boolean language sql stable security definer set search_path = public as $f$
    select _user_id is not null and (
         coalesce(public.has_section_permission(_user_id, 'facturas', 'edit'), false)
      or coalesce(public.has_section_permission(_user_id, 'facturas_subida', 'view'), false)
      or coalesce(public.has_section_permission(_user_id, 'facturas_subida', 'edit'), false)) $f$;
  create function public.facturas_puede_subir() returns boolean language sql stable security definer set search_path = public
    as $f$ select public.facturas_puede_subir_usuario((select auth.uid())) $f$;
  create function public.factura_subida_por_mi(p_factura_id bigint) returns boolean language sql stable security definer set search_path = public as $f$
    select (select auth.uid()) is not null and exists (select 1 from public.facturas f where f.id = p_factura_id and f.subido_por = (select auth.uid())) $f$;
  create function public.ocr_trabajo_es_mio(p_trabajo_id uuid) returns boolean language sql stable security definer set search_path = public as $f$
    select (select auth.uid()) is not null and exists (select 1 from public.ocr_trabajos t where t.id = p_trabajo_id and t.creado_por = (select auth.uid())) $f$;
  create function public.factura_original_es_mio(p_nombre text) returns boolean language sql stable security definer set search_path = public as $f$
    select (select auth.uid()) is not null and p_nombre is not null and (
         p_nombre like 'pendientes/' || (select auth.uid())::text || '/%'
      or exists (select 1 from public.facturas f where f.archivo_path = p_nombre and f.subido_por = (select auth.uid()))) $f$;
  revoke all on function public.facturas_puede_subir_usuario(uuid), public.facturas_puede_subir(), public.factura_subida_por_mi(bigint),
    public.ocr_trabajo_es_mio(uuid), public.factura_original_es_mio(text) from public, anon;
  grant execute on function public.facturas_puede_subir_usuario(uuid), public.facturas_puede_subir(), public.factura_subida_por_mi(bigint),
    public.ocr_trabajo_es_mio(uuid), public.factura_original_es_mio(text) to authenticated, service_role;

  do $f$
  declare t text;
  begin
    foreach t in array array['reservas', 'asignaciones_mesa', 'blacklist', 'salas_cerradas_servicio', 'configuracion_reservas',
                             'ocr_trabajos', 'ocr_trabajo_paginas', 'facturas', 'productos_factura'] loop
      execute format('alter table public.%I enable row level security', t);
      execute format('grant select, insert, update, delete on public.%I to authenticated', t);
      execute format('grant all on public.%I to service_role', t);
      execute format('create policy acceso_panel_no_bloqueado on public.%I as restrictive for all to authenticated
        using ((select private.sesion_panel_permitida())) with check ((select private.sesion_panel_permitida()))', t);
    end loop;
  end $f$;
  grant usage on all sequences in schema public to authenticated, service_role;

  -- Reservas: como en la demo (crear y modificar, «Editar»; consultar, «Ver»).
  create policy reservas_select_seccion on public.reservas for select to authenticated using ((select public.can_read_section('reservas')));
  create policy reservas_insert_seccion on public.reservas for insert to authenticated with check ((select public.can_edit_section('reservas')));
  create policy reservas_update_seccion on public.reservas for update to authenticated
    using ((select public.can_edit_section('reservas'))) with check ((select public.can_edit_section('reservas')));
  create policy reservas_delete_seccion on public.reservas for delete to authenticated using ((select public.can_edit_section('reservas')));
  create policy reservas_service_role on public.reservas for all to service_role using (true) with check (true);
  do $f$
  declare t text;
  begin
    foreach t in array array['asignaciones_mesa', 'blacklist', 'salas_cerradas_servicio'] loop
      execute format('create policy %I on public.%I for select to authenticated using ((select public.can_read_section(''reservas'')))', t || '_select', t);
      execute format('create policy %I on public.%I for insert to authenticated with check ((select public.can_write_section(''reservas'')))', t || '_insert', t);
      execute format('create policy %I on public.%I for update to authenticated using ((select public.can_write_section(''reservas'')))', t || '_update', t);
      execute format('create policy %I on public.%I for delete to authenticated using ((select public.can_write_section(''reservas'')))', t || '_delete', t);
    end loop;
  end $f$;
  create policy configuracion_reservas_select_seccion on public.configuracion_reservas for select to authenticated
    using (((select public.can_read_section('reservas'))) or ((select public.can_read_section('dashboard'))));
  create policy configuracion_reservas_update_seccion on public.configuracion_reservas for update to authenticated
    using ((select public.can_write_section('reservas_configuracion'))) with check ((select public.can_write_section('reservas_configuracion')));

  -- Facturas: «Ver»/«Editar» y lo propio con «Facturas · Subida» (20261106510000).
  create policy facturas_select_seccion on public.facturas for select to authenticated using ((select public.can_read_section('facturas')));
  create policy facturas_update_seccion on public.facturas for update to authenticated using ((select public.can_write_section('facturas')));
  create policy facturas_insert_seccion on public.facturas for insert to authenticated with check ((select public.can_write_section('facturas')));
  create policy facturas_select_subida on public.facturas for select to authenticated
    using ((select public.facturas_puede_subir()) and subido_por = (select auth.uid()));
  create policy facturas_update_subida on public.facturas for update to authenticated
    using ((select public.facturas_puede_subir()) and subido_por = (select auth.uid()));
  create policy productos_factura_select_seccion on public.productos_factura for select to authenticated using ((select public.can_read_section('facturas')));
  create policy productos_factura_select_subida on public.productos_factura for select to authenticated
    using ((select public.facturas_puede_subir()) and public.factura_subida_por_mi(factura_id));
  create policy ocr_trabajos_select on public.ocr_trabajos for select to authenticated using ((select public.can_read_section('facturas')));
  create policy ocr_trabajos_select_subida on public.ocr_trabajos for select to authenticated
    using ((select public.facturas_puede_subir()) and creado_por = (select auth.uid()));
  create policy ocr_paginas_select on public.ocr_trabajo_paginas for select to authenticated using ((select public.can_read_section('facturas')));
  create policy ocr_paginas_select_subida on public.ocr_trabajo_paginas for select to authenticated
    using ((select public.facturas_puede_subir()) and public.ocr_trabajo_es_mio(trabajo_id));

  -- Storage (bucket privado facturas-originales con sus políticas de la demo).
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
  create policy facturas_originales_select_subida on storage.objects for select to authenticated
    using (bucket_id = 'facturas-originales' and (select public.facturas_puede_subir()) and public.factura_original_es_mio(name));
  create policy facturas_originales_pendientes_insert on storage.objects for insert to authenticated
    with check (bucket_id = 'facturas-originales' and (storage.foldername(name))[1] = 'pendientes'
      and (storage.foldername(name))[2] = (select auth.uid())::text and (select public.facturas_puede_subir()));
  create policy otro_insert on storage.objects for insert to authenticated with check (bucket_id = 'otro' and public.can_read_section('dashboard'));
`;

const DATOS = `
  insert into auth.users (id, email) select u::uuid, 'u@t' from unnest(array[
    '${U.SA}', '${U.RES}', '${U.RES_FLAG}', '${U.CREAR_SIN_VER}', '${U.VER}', '${U.EDITA}', '${U.ALB}', '${U.ALB_B}', '${U.SUBIDA}', '${U.NADA}']) u;
  insert into auth.users values ('${U.BLOQ}', 'bloq@t', now() + interval '1 day');
  insert into auth.sessions (id, user_id) select ('b' || substr(id::text, 2))::uuid, id from auth.users;
  insert into public.super_admins values ('${U.SA}');
  insert into public.user_permissions (user_id, section_key, can_view, can_edit) values
    ('${U.RES}', 'reservas', true, false), ('${U.RES}', 'reservas_crear', true, false),
    ('${U.RES_FLAG}', 'reservas', true, false), ('${U.RES_FLAG}', 'reservas_crear', false, true),
    ('${U.CREAR_SIN_VER}', 'reservas_crear', true, false),
    ('${U.VER}', 'reservas', true, false),
    ('${U.EDITA}', 'reservas', true, true),
    ('${U.ALB}', 'facturas_albaranes', true, false),
    ('${U.ALB_B}', 'facturas_albaranes', true, false),
    ('${U.SUBIDA}', 'facturas_subida', true, false),
    ('${U.BLOQ}', 'facturas_albaranes', true, false),
    ('${U.NADA}', 'dashboard', true, false);
  insert into public.reservas (id, fecha, hora, numero_comensales, estado, nombre, canal) values
    ('e0000000-0000-0000-0000-000000000001', '2026-11-20', '14:00', 4, 'confirmada', 'Ana', 'web');
  insert into public.configuracion_reservas (dias_max_antelacion) values (60);
  insert into public.ocr_trabajos (id, creado_por, estado, nombre_original, resultado, factura_id, error, created_at) values
    ('${T.ALB1}', '${U.ALB}', 'completado', 'albaran-pescado.jpg', '{"total": 123.45, "proveedor": "Pescados"}', 1, null, now() - interval '1 hour'),
    ('${T.ALB2}', '${U.ALB}', 'paginas', 'albaran-carne.jpg', null, null, null, now() - interval '5 minutes'),
    ('${T.ALB_VIEJO}', '${U.ALB}', 'completado', 'viejo.jpg', '{"total": 9}', null, null, now() - interval '30 days'),
    ('${T.ALB_B1}', '${U.ALB_B}', 'fallido', 'otro.jpg', null, null, 'openai 500: detalle interno', now() - interval '2 hours'),
    ('${T.SUB1}', '${U.SUBIDA}', 'completado', 'factura.pdf', '{"total": 50}', 2, null, now() - interval '3 hours');
  insert into public.ocr_trabajo_paginas (trabajo_id, numero) values ('${T.ALB1}', 1), ('${T.ALB2}', 1), ('${T.SUB1}', 1);
  insert into public.facturas (id, proveedor, numero_documento, total, subido_por, ocr_trabajo_id, archivo_path) values
    (1, 'Pescados', 'A-1', 123.45, '${U.ALB}', '${T.ALB1}', 'facturas/2026/a1.jpg'),
    (2, 'Carnes', 'F-2', 50, '${U.SUBIDA}', '${T.SUB1}', 'facturas/2026/f2.pdf'),
    (3, 'Frutas', 'F-3', 300, null, null, null);
  select setval('public.facturas_id_seq', 3);
  insert into public.productos_factura (factura_id, nombre, total) values (1, 'Merluza', 100), (2, 'Ternera', 50);
  insert into storage.objects (bucket_id, name) values
    ('facturas-originales', 'facturas/2026/a1.jpg'), ('facturas-originales', 'facturas/2026/f2.pdf'),
    ('facturas-originales', 'pendientes/${U.ALB}/${T.ALB2}/01.jpg'),
    ('facturas-originales', 'pendientes/${U.ALB_B}/${T.ALB_B1}/01.jpg');
`;

// ─── 0. Si falta algo de lo que depende, se para sin cambiar nada ──────────
{
  const otra = new PGlite();
  await otra.exec(ANDAMIAJE + "drop function public.facturas_puede_subir_usuario(uuid) cascade;");
  await assert.rejects(otra.exec(MIGRACION), /falta facturas_puede_subir_usuario/, "no se paró sin 20261106510000");
  comprobaciones++;
  await otra.exec("rollback");
  igual((await otra.query(`select count(*)::int n from pg_policies where policyname = 'reservas_insert_crear'`)).rows[0].n, 0,
    "la migración abortada dejó políticas");
  await otra.close();
}
// Otra política de alta en reservas (p. ej. con «Ver»): crear ya estaría abierto → se para.
{
  const otra = new PGlite();
  await otra.exec(ANDAMIAJE + `create policy "Alta con ver" on public.reservas for insert to authenticated with check (public.can_read_section('reservas'));`);
  await assert.rejects(otra.exec(MIGRACION), /hay otra que ya deja crear/, "no se paró con otra política de alta");
  comprobaciones++;
  await otra.exec("rollback");
  igual((await otra.query(`select count(*)::int n from pg_proc where proname = 'reservas_puede_crear'`)).rows[0].n, 0,
    "la migración abortada dejó funciones");
  await otra.close();
}
// Una política vieja de UPDATE que reabriría la modificación por OR: la comprobación final la para.
{
  const otra = new PGlite();
  await otra.exec(ANDAMIAJE + `create policy "Modificar con ver" on public.reservas for update to authenticated using (public.can_read_section('reservas'));`);
  await assert.rejects(otra.exec(MIGRACION), /política que sobra en reservas: Modificar con ver/, "no se paró con una política que reabre");
  comprobaciones++;
  await otra.exec("rollback");
  igual((await otra.query(`select count(*)::int n from pg_trigger where tgname = 'trg_00_reservas_alta_solo_crear'`)).rows[0].n, 0,
    "la migración abortada dejó el trigger");
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
    } else if (rol === "anon") {
      await db.exec(`set local role anon; select set_config('request.jwt.claims', '{"role":"anon"}', true);`);
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
const rechaza = async (u, sql, patron, msg, params) => {
  await assert.rejects(como(u, () => q(sql, params)), patron, msg);
  comprobaciones++;
};
const RLS = /row-level security|permission denied/;
const SIN_PERMISO_RPC = /Sin permiso para subir fotos de albaranes|permission denied/;

// Alta como la del formulario del panel (FormularioReserva): verificada, canal manual.
const ALTA = (extra = {}) => {
  const fila = { fecha: "2026-11-21", hora: "21:00", numero_comensales: 2, estado: "verificada", nombre: "Pepe", telefono: "+34600000000",
    canal: "manual", en_blacklist: false, marca: "casa_tomas", ...extra };
  const cols = Object.keys(fila);
  return {
    sql: `insert into public.reservas (${cols.join(", ")}) values (${cols.map((_, i) => `$${i + 1}`).join(", ")}) returning id, estado`,
    params: Object.values(fila),
  };
};
const crear = (u, extra) => { const a = ALTA(extra); return como(u, () => q(a.sql, a.params)); };
const rechazaAlta = (u, extra, patron, msg) => { const a = ALTA(extra); return rechaza(u, a.sql, patron, msg, a.params); };
const subirA = (u, nombre, bucket = "facturas-originales") =>
  como(u, () => q("insert into storage.objects (bucket_id, name) values ($1, $2) returning name", [bucket, nombre]));

// Antes: el tipo «Reservas» no puede crear y el de «Albaranes» no puede subir.
await rechazaAlta(U.RES, {}, RLS, "antes: «Reservas · Crear» ya creaba");
await rechaza(U.ALB, "insert into storage.objects (bucket_id, name) values ('facturas-originales', $1)", RLS,
  "antes: «Solo fotos» ya subía", [`pendientes/${U.ALB}/x/01.jpg`]);

// ─── 1. Migración (dos veces) ───────────────────────────────────────────────
await db.exec(MIGRACION);
await db.exec(MIGRACION);
comprobaciones++;

// ─── 2. ¿Quién puede crear? ─────────────────────────────────────────────────
const puedeCrear = async (u) => (await filas(u, "select public.reservas_puede_crear() as v"))[0].v;
igual(await puedeCrear(U.RES), true, "tipo Reservas: puede crear");
igual(await puedeCrear(U.RES_FLAG), true, "reservas_crear guardado en can_edit también vale");
igual(await puedeCrear(U.CREAR_SIN_VER), false, "Reservas · Crear sin «Ver» en Reservas no basta");
igual(await puedeCrear(U.VER), false, "solo «Ver» no crea");
igual(await puedeCrear(U.EDITA), true, "«Editar» crea");
igual(await puedeCrear(U.SA), true, "super admin crea");
igual(await puedeCrear(U.ALB), false, "albaranes no crea reservas");
await assert.rejects(como(null, () => q("select public.reservas_puede_crear()"), "anon"), /permission denied/, "anon ejecuta reservas_puede_crear");
comprobaciones++;

// ─── 3. Usuario «Reservas»: ve y crea, nada más ─────────────────────────────
igual(await cuantas(U.RES, "select id from public.reservas"), 1, "Reservas ve las reservas");
igual(await cuantas(U.RES, "select id from public.configuracion_reservas"), 1, "Reservas lee la configuración que necesita el formulario");
const creada = (await crear(U.RES)).rows[0];
ok(creada?.id, "Reservas crea una reserva como el formulario (y la relee: RETURNING)");
igual(creada.estado, "verificada", "nace verificada");
ok((await crear(U.RES, { estado: "pendiente", en_blacklist: true })).rows[0]?.id, "cliente en lista negra: nace pendiente");
ok((await crear(U.RES, { canal: "telefono", email: null })).rows[0]?.id, "alta por teléfono y sin email");
ok((await crear(U.RES_FLAG)).rows[0]?.id, "reservas_crear en can_edit también crea");
igual((await q(`select count(*)::int n from public.audit_log where tabla = 'reservas' and accion = 'INSERT' and usuario in ('${U.RES}', '${U.RES_FLAG}')`)).rows[0].n, 4,
  "la auditoría (trigger SECURITY DEFINER) sigue apuntando las altas");

await rechazaAlta(U.RES, { estado: "confirmada" }, /nace pendiente o verificada/, "Reservas crea ya confirmada");
await rechazaAlta(U.RES, { estado: "cancelada" }, /nace pendiente o verificada/, "Reservas crea cancelada");
await rechazaAlta(U.RES, { canal: "web" }, /canal manual, teléfono o presencial/, "Reservas crea como si fuera de la web");
await rechazaAlta(U.RES, { solicitud_id: "f0000000-0000-0000-0000-000000000001" }, /solicitud del asistente/, "Reservas convierte solicitudes");
await rechazaAlta(U.RES, { llegada_at: new Date().toISOString() }, /solo se crea la reserva/, "Reservas crea con llegada (Ha llegado)");
await rechazaAlta(U.RES, { importante: true }, /solo se crea la reserva/, "Reservas marca importante");
await rechazaAlta(U.RES, { mesa_fijada: true }, /solo se crea la reserva/, "Reservas fija mesa");
await rechazaAlta(U.RES, { email_verificado_at: new Date().toISOString() }, /solo se crea la reserva/, "Reservas da el email por verificado");

// Cambiar el estado («Ha llegado», confirmar, cancelar), modificar o borrar: nada (0 filas).
igual(await cuantas(U.RES, `update public.reservas set estado = 'completada', llegada_at = now() where id = $1 returning id`, [creada.id]), 0,
  "Reservas marca «Ha llegado»");
igual(await cuantas(U.RES, `update public.reservas set estado = 'cancelada' returning id`), 0, "Reservas cancela");
igual(await cuantas(U.RES, `update public.reservas set numero_comensales = 9 returning id`), 0, "Reservas modifica");
igual(await cuantas(U.RES, `delete from public.reservas returning id`), 0, "Reservas borra");
igual((await q(`select estado from public.reservas where id = $1`, [creada.id])).rows[0].estado, "verificada", "el estado no cambió");
igual((await q(`select count(*)::int n from public.reservas`)).rows[0].n, 5, "no se borró nada");

// Mesas, lista negra, cerrar sala, configuración: nada.
await rechaza(U.RES, `insert into public.asignaciones_mesa (reserva_id) values ('${creada.id}')`, RLS, "Reservas asigna mesa");
await rechaza(U.RES, `insert into public.blacklist (telefono) values ('+34611111111')`, RLS, "Reservas añade a la lista negra");
await rechaza(U.RES, `insert into public.salas_cerradas_servicio (fecha) values ('2026-11-21')`, RLS, "Reservas cierra la sala (evento)");
igual(await cuantas(U.RES, `update public.configuracion_reservas set dias_max_antelacion = 1 returning id`), 0, "Reservas cambia la configuración");

// Otras secciones: nada.
igual(await cuantas(U.RES, "select id from public.facturas"), 0, "Reservas ve facturas");
igual(await cuantas(U.RES, "select id from public.ocr_trabajos"), 0, "Reservas ve trabajos de OCR");
await rechaza(U.RES, "insert into storage.objects (bucket_id, name) values ('facturas-originales', $1)", RLS,
  "Reservas sube a facturas", [`pendientes/${U.RES}/x/01.jpg`]);
await rechaza(U.RES, "select * from public.albaranes_mis_subidas()", SIN_PERMISO_RPC, "Reservas lee subidas de albaranes");

// Los demás, como antes.
await rechazaAlta(U.VER, {}, RLS, "solo «Ver» crea");
await rechazaAlta(U.CREAR_SIN_VER, {}, RLS, "Reservas · Crear sin «Ver» crea");
igual(await cuantas(U.CREAR_SIN_VER, "select id from public.reservas"), 0, "Reservas · Crear sin «Ver» lee reservas");
igual((await crear(U.EDITA, { estado: "confirmada", importante: true })).rows[0].estado, "confirmada", "«Editar» crea como quiera");
igual(await cuantas(U.EDITA, `update public.reservas set llegada_at = now() where id = $1 returning id`, [creada.id]), 1, "«Editar» marca llegadas");
igual((await crear(U.SA, { canal: "web", estado: "confirmada" })).rows[0].estado, "confirmada", "super admin crea como quiera");
ok((await como(null, () => q(`insert into public.reservas (fecha, hora, numero_comensales, estado, canal) values ('2026-11-22', '13:00', 2, 'confirmada', 'web') returning id`), "service_role")).rows[0].id,
  "la web y el bot (service role) siguen creando como siempre");

// ─── 4. Usuario «Albaranes»: sube fotos y ve el estado de lo suyo ───────────
const puedeFotos = async (u) => (await filas(u, "select public.facturas_puede_subir_fotos() as v, public.facturas_puede_subir() as s"))[0];
igual(await puedeFotos(U.ALB), { v: true, s: false }, "albaranes: sube fotos, pero NO tiene «Facturas · Subida»");
igual(await puedeFotos(U.SUBIDA), { v: true, s: true }, "Facturas · Subida sigue subiendo");
igual(await puedeFotos(U.RES), { v: false, s: false }, "Reservas no sube");

igual((await subirA(U.ALB, `pendientes/${U.ALB}/c0000000-0000-0000-0000-0000000000aa/01.jpg`)).rows.length, 1,
  "albaranes sube una foto a su carpeta (y Storage la relee)");
await rechaza(U.ALB, "insert into storage.objects (bucket_id, name) values ('facturas-originales', $1)", RLS,
  "albaranes sube a la carpeta de otro", [`pendientes/${U.ALB_B}/x/01.jpg`]);
await rechaza(U.ALB, "insert into storage.objects (bucket_id, name) values ('facturas-originales', 'facturas/2026/colada.jpg')", RLS,
  "albaranes sube fuera de pendientes/");
await rechaza(U.ALB, "insert into storage.objects (bucket_id, name) values ('otro', $1)", RLS,
  "albaranes sube a otro bucket", [`pendientes/${U.ALB}/x/01.jpg`]);
const fotosVistas = (await filas(U.ALB, "select name from storage.objects order by name")).map((r) => r.name);
igual(fotosVistas.every((n) => n.startsWith(`pendientes/${U.ALB}/`)), true, "albaranes solo ve sus fotos pendientes");
ok(!fotosVistas.includes("facturas/2026/a1.jpg"), "albaranes no ve el original archivado, ni de lo suyo");
igual(await cuantas(U.ALB, `update storage.objects set name = name || '.x' returning id`), 0, "albaranes renombra fotos");
igual(await cuantas(U.ALB, `delete from storage.objects returning id`), 0, "albaranes borra fotos");

// Ni facturas, ni líneas, ni trabajos (tampoco los suyos): ahí van los importes.
igual(await cuantas(U.ALB, "select id from public.facturas"), 0, "albaranes ve facturas (ni la que subió)");
igual(await cuantas(U.ALB, "select id from public.productos_factura"), 0, "albaranes ve líneas");
igual(await cuantas(U.ALB, "select id from public.ocr_trabajos"), 0, "albaranes lee ocr_trabajos (con el resultado)");
igual(await cuantas(U.ALB, "select id from public.ocr_trabajo_paginas"), 0, "albaranes lee páginas de OCR");
igual(await cuantas(U.ALB, "update public.facturas set total = 1 returning id"), 0, "albaranes corrige lo leído");
await rechaza(U.ALB, "insert into public.facturas (proveedor, total) values ('x', 1)", RLS, "albaranes crea facturas");
igual(await cuantas(U.ALB, "select id from public.reservas"), 0, "albaranes ve reservas");
await rechazaAlta(U.ALB, {}, RLS, "albaranes crea reservas");

// Lo único que ve de lo suyo: el estado, sin resultado ni importes ni error interno.
const mias = await filas(U.ALB, "select * from public.albaranes_mis_subidas()");
igual(mias.map((r) => r.nombre_original), ["albaran-carne.jpg", "albaran-pescado.jpg"], "albaranes ve sus subidas de 14 días, la última primero");
igual(Object.keys(mias[0]).sort(), ["created_at", "estado", "id", "nombre_original", "num_paginas", "terminado_at"],
  "albaranes_mis_subidas no devuelve resultado, factura, importes ni error");
igual(mias.map((r) => r.estado), ["paginas", "completado"], "con su estado");
igual((await filas(U.ALB_B, "select * from public.albaranes_mis_subidas()")).map((r) => r.id), [T.ALB_B1], "cada uno, lo suyo");
igual((await filas(U.ALB, "select * from public.albaranes_mis_subidas(1)")).length, 1, "respeta el límite");
igual((await filas(U.SUBIDA, "select * from public.albaranes_mis_subidas()")).length, 1, "Facturas · Subida también puede usarla");
await rechaza(U.NADA, "select * from public.albaranes_mis_subidas()", SIN_PERMISO_RPC, "sin permiso lee subidas");
await rechaza(U.BLOQ, "select * from public.albaranes_mis_subidas()", /Sesión del panel no válida/, "bloqueado lee subidas");
await rechaza(U.BLOQ, "insert into storage.objects (bucket_id, name) values ('facturas-originales', $1)", RLS,
  "bloqueado sube", [`pendientes/${U.BLOQ}/x/01.jpg`]);
await assert.rejects(como(null, () => q("select * from public.albaranes_mis_subidas()"), "anon"), /permission denied/, "anon lee subidas");
comprobaciones++;

// Lo de «Facturas · Subida» no cambia.
igual(await cuantas(U.SUBIDA, "select id from public.facturas"), 1, "Subida sigue viendo lo suyo");
igual((await subirA(U.SUBIDA, `pendientes/${U.SUBIDA}/x/01.pdf`)).rows.length, 1, "Subida sigue subiendo");
igual(await cuantas(U.SUBIDA, "select name from storage.objects where name like 'pendientes/%'"), 1, "Subida solo ve sus pendientes");

// ─── 5. Rollback (dos veces) y vuelta a aplicar ─────────────────────────────
await db.exec(ROLLBACK);
await db.exec(ROLLBACK);
await rechazaAlta(U.RES, {}, RLS, "tras el rollback, Reservas · Crear sigue creando");
await rechaza(U.ALB, "insert into storage.objects (bucket_id, name) values ('facturas-originales', $1)", RLS,
  "tras el rollback, albaranes sigue subiendo", [`pendientes/${U.ALB}/y/01.jpg`]);
igual((await subirA(U.SUBIDA, `pendientes/${U.SUBIDA}/y/01.pdf`)).rows.length, 1, "tras el rollback, Subida sigue subiendo");
ok((await crear(U.EDITA)).rows[0]?.id, "tras el rollback, «Editar» sigue creando");
igual((await q(`select count(*)::int n from pg_proc where proname in ('reservas_puede_crear', 'albaranes_mis_subidas', 'facturas_puede_subir_fotos')`)).rows[0].n, 0,
  "el rollback dejó funciones");
await db.exec(MIGRACION);
ok((await crear(U.RES)).rows[0]?.id, "se puede volver a aplicar");

await db.close();
console.log(`usuarios-reservas-albaranes: OK (${comprobaciones} comprobaciones)`);
