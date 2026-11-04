// Permiso propio de Reservas › Configuración ('reservas_configuracion') contra
// un Postgres en memoria (PGlite). Nunca toca Supabase.
//
//   npm run test:reservas-configuracion:db
//
// Parte del estado de la demo el 04/11/2026 (políticas de configuracion_reservas,
// configuracion_turnos y plantillas_email_reserva, fn_restaurar_version_plantilla,
// permisos por sección con el super admin siempre dentro, sesión de panel viva)
// y aplica la migración REAL 20261104111000 dos veces. Cubre: que se para si
// falta algo, la semilla (solo admins que hoy ven la pestaña; no la repite ni
// pisa lo cambiado), los roles preconfigurados, la RLS por persona (lo que
// Reservas necesita leer sigue leyéndose), la función de restaurar, la
// comprobación final ante una política vieja que reabriría por OR y el rollback.
import { PGlite } from "@electric-sql/pglite";
import { readFile } from "node:fs/promises";
import assert from "node:assert/strict";

const MIGRACION = await readFile("supabase/migrations/20261104111000_permiso_reservas_configuracion.sql", "utf8");
const ROLLBACK = await readFile("supabase/rollbacks/20261104111000_permiso_reservas_configuracion_ROLLBACK.sql", "utf8");

let comprobaciones = 0;
const ok = (v, msg) => { assert.ok(v, msg); comprobaciones++; };
const igual = (a, b, msg) => { assert.deepEqual(a, b, msg); comprobaciones++; };

// fn_restaurar_version_plantilla tal y como está en la demo (20260920010000).
const RESTAURAR_ANTES = `
  create function public.fn_restaurar_version_plantilla(p_tipo text, p_version_a_restaurar integer, p_actor uuid default auth.uid())
  returns public.plantillas_email_reserva language plpgsql security definer set search_path to 'public' as $f$
  declare v_origen public.plantillas_email_reserva; v_siguiente integer; v_nueva public.plantillas_email_reserva;
  begin
    if not public.can_write_section('reservas') then
      raise exception 'No tienes permiso de escritura en la sección reservas';
    end if;
    select * into v_origen from public.plantillas_email_reserva where tipo = p_tipo and version = p_version_a_restaurar;
    if not found then raise exception 'No existe la version % de la plantilla %', p_version_a_restaurar, p_tipo; end if;
    select coalesce(max(version), 0) + 1 into v_siguiente from public.plantillas_email_reserva where tipo = p_tipo;
    update public.plantillas_email_reserva set es_actual = false where tipo = p_tipo and es_actual;
    insert into public.plantillas_email_reserva (tipo, version, es_actual, asunto, saludo, cuerpo, texto_boton_principal,
      texto_boton_secundario, pie, color_acento, color_oscuro, logo_url, bloques, nota_version, creado_por)
    values (v_origen.tipo, v_siguiente, true, v_origen.asunto, v_origen.saludo, v_origen.cuerpo, v_origen.texto_boton_principal,
      v_origen.texto_boton_secundario, v_origen.pie, v_origen.color_acento, v_origen.color_oscuro, v_origen.logo_url,
      v_origen.bloques, 'Restaurada desde la version ' || p_version_a_restaurar, p_actor)
    returning * into v_nueva;
    return v_nueva;
  end $f$;
  revoke all on function public.fn_restaurar_version_plantilla(text, integer, uuid) from public, anon;
  grant execute on function public.fn_restaurar_version_plantilla(text, integer, uuid) to authenticated, service_role;
`;

const ANDAMIAJE = `
  create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
  create schema auth; create schema private;
  create table auth.users (id uuid primary key, email text, banned_until timestamptz);
  create table auth.sessions (id uuid primary key, user_id uuid);
  create function auth.jwt() returns jsonb language sql stable as $$ select nullif(current_setting('request.jwt.claims', true), '')::jsonb $$;
  create function auth.uid() returns uuid language sql stable as $$ select (auth.jwt() ->> 'sub')::uuid $$;
  create function auth.role() returns text language sql stable as $$ select auth.jwt() ->> 'role' $$;
  grant usage on schema public, auth, private to anon, authenticated, service_role;
  grant execute on all functions in schema auth to anon, authenticated, service_role;

  create type public.app_role as enum ('admin', 'manager', 'staff');
  create table public.user_roles (id uuid primary key default gen_random_uuid(), user_id uuid not null unique, role public.app_role not null default 'staff');
  create table public.super_admins (user_id uuid primary key);
  create function public.is_super_admin(_user_id uuid) returns boolean language sql stable security definer set search_path = public
    as $f$ select exists (select 1 from public.super_admins where user_id = _user_id) $f$;
  create function public.is_admin(_user_id uuid) returns boolean language sql stable security definer set search_path = public
    as $f$ select exists (select 1 from public.user_roles where user_id = _user_id and role = 'admin') $f$;
  create table public.user_permissions (id uuid primary key default gen_random_uuid(), user_id uuid not null, section_key text not null,
    can_view boolean default false, can_edit boolean default false, unique (user_id, section_key));
  create table public.user_role_presets (id uuid primary key default gen_random_uuid(), name text not null unique,
    base_role public.app_role not null default 'staff', permissions jsonb not null default '[]'::jsonb);
  create function public.has_section_permission(_user_id uuid, _section text, _permission text) returns boolean
    language sql stable security definer set search_path = public as $f$
    select case when public.is_super_admin(_user_id) then true else exists (
      select 1 from public.user_permissions where user_id = _user_id and section_key = _section
        and ((_permission = 'view' and can_view = true) or (_permission = 'edit' and can_edit = true))) end $f$;
  create function public.can_read_section(_section text) returns boolean language sql stable security definer set search_path = public
    as $f$ select public.has_section_permission((select auth.uid()), _section, 'view') $f$;
  create function public.can_write_section(_section text) returns boolean language sql stable security definer set search_path = public
    as $f$ select public.has_section_permission((select auth.uid()), _section, 'edit') $f$;
  grant execute on function public.is_super_admin(uuid), public.is_admin(uuid), public.has_section_permission(uuid, text, text),
    public.can_read_section(text), public.can_write_section(text) to anon, authenticated, service_role;
  create function private.sesion_panel_permitida() returns boolean language sql stable security definer set search_path = '' as $f$
    select auth.uid() is not null and exists (
      select 1 from auth.users u where u.id = auth.uid() and (u.banned_until is null or u.banned_until <= now())
        and exists (select 1 from auth.sessions s where s.user_id = u.id and s.id::text = auth.jwt()->>'session_id')) $f$;
  revoke all on function private.sesion_panel_permitida() from public;
  grant execute on function private.sesion_panel_permitida() to authenticated;

  -- Las tres tablas, con las políticas de la demo (04/11/2026).
  create table public.configuracion_reservas (id uuid primary key default gen_random_uuid(), dias_max_antelacion integer not null default 60);
  create table public.configuracion_turnos (id uuid primary key default gen_random_uuid(), nombre_periodo text not null, activo boolean default true);
  create table public.plantillas_email_reserva (
    id uuid primary key default gen_random_uuid(), tipo text not null, version integer not null, es_actual boolean not null default false,
    asunto text not null, saludo text not null, cuerpo text not null, texto_boton_principal text, texto_boton_secundario text, pie text,
    color_acento text not null default '#B8936A', color_oscuro text not null default '#1C1F22', logo_url text,
    bloques jsonb not null default '{}'::jsonb, nota_version text, creado_por uuid, creado_at timestamptz not null default now(),
    unique (tipo, version));
  create unique index uq_plantilla_actual on public.plantillas_email_reserva (tipo) where es_actual;
  alter table public.configuracion_reservas enable row level security;
  alter table public.configuracion_turnos enable row level security;
  alter table public.plantillas_email_reserva enable row level security;
  grant select, insert, update, delete on public.configuracion_reservas, public.configuracion_turnos, public.plantillas_email_reserva to authenticated;
  grant all on public.configuracion_reservas, public.configuracion_turnos, public.plantillas_email_reserva to service_role;

  create policy "Admins can manage configuracion_reservas" on public.configuracion_reservas for all to authenticated
    using (public.is_admin(auth.uid())) with check (public.is_admin(auth.uid()));
  create policy configuracion_reservas_select_seccion on public.configuracion_reservas for select to authenticated
    using (((select public.can_read_section('reservas'))) or ((select public.can_read_section('dashboard'))));

  create policy "Admins pueden actualizar configuración de turnos" on public.configuracion_turnos for update to authenticated
    using (public.is_admin(auth.uid())) with check (public.is_admin(auth.uid()));
  create policy "Admins pueden crear configuración de turnos" on public.configuracion_turnos for insert to authenticated
    with check (public.is_admin(auth.uid()));
  create policy "Admins pueden eliminar configuración de turnos" on public.configuracion_turnos for delete to authenticated
    using (public.is_admin(auth.uid()));
  create policy configuracion_turnos_select_seccion on public.configuracion_turnos for select to authenticated
    using (((select public.can_read_section('reservas'))) or ((select public.can_read_section('dashboard'))));
  create policy configuracion_turnos_insert_seccion on public.configuracion_turnos for insert to authenticated
    with check ((select public.can_write_section('reservas')));
  create policy configuracion_turnos_update_seccion on public.configuracion_turnos for update to authenticated
    using ((select public.can_write_section('reservas'))) with check ((select public.can_write_section('reservas')));
  create policy configuracion_turnos_delete_seccion on public.configuracion_turnos for delete to authenticated
    using ((select public.can_write_section('reservas')));

  create policy plantillas_email_reserva_select_seccion on public.plantillas_email_reserva for select to authenticated
    using (public.can_read_section('reservas'));
  create policy plantillas_email_reserva_insert_seccion on public.plantillas_email_reserva for insert to authenticated
    with check (public.can_write_section('reservas'));
  create policy plantillas_email_reserva_update_seccion on public.plantillas_email_reserva for update to authenticated
    using (public.can_write_section('reservas')) with check (public.can_write_section('reservas'));
  create policy plantillas_email_reserva_delete_seccion on public.plantillas_email_reserva for delete to authenticated
    using (public.can_write_section('reservas'));
  create policy plantillas_email_reserva_service_role on public.plantillas_email_reserva for all to service_role using (true) with check (true);

  create policy "acceso_panel_no_bloqueado" on public.configuracion_reservas as restrictive for all to authenticated
    using ((select private.sesion_panel_permitida())) with check ((select private.sesion_panel_permitida()));
  create policy "acceso_panel_no_bloqueado" on public.configuracion_turnos as restrictive for all to authenticated
    using ((select private.sesion_panel_permitida())) with check ((select private.sesion_panel_permitida()));
  create policy "acceso_panel_no_bloqueado" on public.plantillas_email_reserva as restrictive for all to authenticated
    using ((select private.sesion_panel_permitida())) with check ((select private.sesion_panel_permitida()));
  ${RESTAURAR_ANTES}
`;

// Personas. ADMIN_VE: hoy ve la pestaña (admin + «Ver» Reservas) → se siembra.
const U = {
  SA: "a0000000-0000-0000-0000-000000000001",         // super admin (y admin)
  ADMIN_VE: "a0000000-0000-0000-0000-000000000002",   // admin con «Ver» en Reservas, sin editar
  ADMIN_FUERA: "a0000000-0000-0000-0000-000000000003",// admin sin «Ver» en Reservas: hoy no ve la pestaña
  GERENTE: "a0000000-0000-0000-0000-000000000004",    // manager con Reservas editar: no se siembra
  CONF_VE: "a0000000-0000-0000-0000-000000000005",    // Reservas editar; tras migrar, Configuración solo ver
  CONF_EDITA: "a0000000-0000-0000-0000-000000000006", // Reservas ver; tras migrar, Configuración editar
  DASH: "a0000000-0000-0000-0000-000000000007",       // solo Dashboard
  BLOQ: "a0000000-0000-0000-0000-000000000008",       // admin con Reservas (se siembra), pero bloqueado
};
const sesion = (u) => u.replace(/^a/, "b");
const PLANTILLA = `insert into public.plantillas_email_reserva (tipo, version, es_actual, asunto, saludo, cuerpo)
  values ('confirmada', 1, true, 'Asunto v1', 'Hola', 'Cuerpo')`;
const DATOS = `
  insert into auth.users (id, email, banned_until) select id::uuid, 'u@t', null from unnest(array[
    '${U.SA}', '${U.ADMIN_VE}', '${U.ADMIN_FUERA}', '${U.GERENTE}', '${U.CONF_VE}', '${U.CONF_EDITA}', '${U.DASH}']) id;
  insert into auth.users values ('${U.BLOQ}', 'bloq@t', now() + interval '1 day');
  insert into auth.sessions (id, user_id) select ('b' || substr(id::text, 2))::uuid, id from auth.users;
  insert into public.super_admins values ('${U.SA}');
  insert into public.user_roles (user_id, role) values
    ('${U.SA}', 'admin'), ('${U.ADMIN_VE}', 'admin'), ('${U.ADMIN_FUERA}', 'admin'), ('${U.GERENTE}', 'manager'),
    ('${U.CONF_VE}', 'staff'), ('${U.CONF_EDITA}', 'staff'), ('${U.DASH}', 'staff'), ('${U.BLOQ}', 'admin');
  insert into public.user_permissions (user_id, section_key, can_view, can_edit) values
    ('${U.SA}', 'reservas', true, false),
    ('${U.ADMIN_VE}', 'reservas', true, false), ('${U.ADMIN_FUERA}', 'facturas', true, true),
    ('${U.GERENTE}', 'reservas', true, true),
    ('${U.CONF_VE}', 'reservas', true, true), ('${U.CONF_EDITA}', 'reservas', true, false),
    ('${U.DASH}', 'dashboard', true, false), ('${U.BLOQ}', 'reservas', true, true);
  insert into public.user_role_presets (name, base_role, permissions) values
    ('Admin', 'admin', '[{"section_key":"dashboard","can_view":true,"can_edit":false},{"section_key":"reservas","can_view":true,"can_edit":false}]'),
    ('Camarero', 'staff', '[{"section_key":"reservas","can_view":true,"can_edit":false}]'),
    ('Admin sin reservas', 'admin', '[{"section_key":"facturas","can_view":true,"can_edit":false}]');
  insert into public.configuracion_reservas (dias_max_antelacion) values (60);
  insert into public.configuracion_turnos (nombre_periodo) values ('Comida'), ('Cena');
  ${PLANTILLA};
`;

// ─── 0. Si falta algo de lo que depende, se para sin cambiar nada ──────────
{
  const otra = new PGlite();
  await otra.exec(ANDAMIAJE + "drop function public.fn_restaurar_version_plantilla(text, integer, uuid);");
  await assert.rejects(otra.exec(MIGRACION), /falta public\.fn_restaurar_version_plantilla/, "no se paró sin la función de restaurar");
  comprobaciones++;
  await otra.exec("rollback");
  igual((await otra.query("select count(*)::int n from pg_policies where policyname = 'configuracion_reservas_update_seccion'")).rows[0].n, 0,
    "la migración abortada dejó políticas");
  await otra.close();
}

// Una política vieja desconocida que reabriría la escritura por OR: se para.
{
  const otra = new PGlite();
  await otra.exec(ANDAMIAJE + `create policy "Escritura libre" on public.configuracion_turnos for update to public using (true);`);
  await assert.rejects(otra.exec(MIGRACION), /política que sobra en configuracion_turnos: Escritura libre/, "no se paró con una política que reabre");
  comprobaciones++;
  await otra.exec("rollback");
  igual((await otra.query(`select count(*)::int n from pg_policies where policyname = 'Admins pueden crear configuración de turnos'`)).rows[0].n, 1,
    "la migración abortada borró políticas");
  await otra.close();
}

const db = new PGlite();
await db.exec(ANDAMIAJE);
await db.exec(DATOS);
const q = (sql, params) => db.query(sql, params);
const n = async (sql) => (await q(sql)).rows[0].n;

async function como(u, fn) {
  await db.exec("begin");
  try {
    await db.exec(`set local role authenticated;
      select set_config('request.jwt.claims', '${JSON.stringify({ sub: u, role: "authenticated", session_id: sesion(u) })}', true);`);
    const r = await fn();
    await db.exec("commit");
    return r;
  } catch (e) {
    await db.exec("rollback").catch(() => {});
    throw e;
  }
}
const filas = (u, sql) => como(u, async () => (await q(sql)).rows.length);
const rechaza = async (u, sql, patron, msg) => {
  await assert.rejects(como(u, () => q(sql)), patron, msg);
  comprobaciones++;
};
const RLS = /row-level security/;
const SIN_PERMISO = /No tienes permiso de escritura en la sección reservas_configuracion/;
const actualizarReglas = (u) => filas(u, "update public.configuracion_reservas set dias_max_antelacion = 61 returning id");
const crearTurno = (u) => como(u, () => q("insert into public.configuracion_turnos (nombre_periodo) values ('Merienda') returning id"));
const borrarTurnos = (u) => filas(u, "delete from public.configuracion_turnos where nombre_periodo = 'Merienda' returning id");
const leerPlantillas = (u) => filas(u, "select id from public.plantillas_email_reserva");
const restaurar = (u) => como(u, () => q("select version from public.fn_restaurar_version_plantilla('confirmada', 1)"));

// Antes: el admin escribe reglas y turnos por ser admin (is_admin) y lee plantillas con «Ver» Reservas.
igual(await actualizarReglas(U.ADMIN_FUERA), 1, "antes: un admin sin Reservas guardaba las reglas");

// ─── 1. Migración (dos veces) y semilla ────────────────────────────────────
await db.exec(MIGRACION);
const sembrados = async () =>
  (await q(`select user_id::text u, can_view v, can_edit e from public.user_permissions
            where section_key = 'reservas_configuracion' order by user_id`)).rows;
igual(await sembrados(), [
  { u: U.ADMIN_VE, v: true, e: true },
  { u: U.BLOQ, v: true, e: true },
], "semilla: solo los admin que hoy ven la pestaña (ni el super admin, ni el admin sin Reservas, ni el manager)");

const presets = async () =>
  (await q(`select name, permissions from public.user_role_presets order by name`)).rows.map((r) => ({
    name: r.name, conf: r.permissions.filter((p) => p.section_key === "reservas_configuracion"),
  }));
igual(await presets(), [
  { name: "Admin", conf: [{ section_key: "reservas_configuracion", can_view: true, can_edit: true }] },
  { name: "Admin sin reservas", conf: [] },
  { name: "Camarero", conf: [] },
], "roles preconfigurados: solo el de rol base admin con «Ver» en Reservas");

// El dueño reparte el permiso nuevo en Usuarios (y le quita la edición a quien la sembró la
// migración); si la migración se vuelve a aplicar, no se pisa ni se duplica nada.
await db.exec(`insert into public.user_permissions (user_id, section_key, can_view, can_edit) values
  ('${U.CONF_VE}', 'reservas_configuracion', true, false), ('${U.CONF_EDITA}', 'reservas_configuracion', true, true);
  update public.user_permissions set can_edit = false where user_id = '${U.ADMIN_VE}' and section_key = 'reservas_configuracion';`);
await db.exec(MIGRACION);
igual((await sembrados()).find((s) => s.u === U.ADMIN_VE), { u: U.ADMIN_VE, v: true, e: false }, "la segunda pasada pisó lo cambiado");
igual((await sembrados()).length, 4, "la segunda pasada sembró otra vez");
igual((await presets()).find((p) => p.name === "Admin").conf.length, 1, "la segunda pasada duplicó el permiso del rol preconfigurado");
await db.exec(`update public.user_permissions set can_edit = true where user_id = '${U.ADMIN_VE}' and section_key = 'reservas_configuracion'`);

// ─── 2. Lo que Reservas necesita leer se sigue leyendo ─────────────────────
for (const u of [U.GERENTE, U.CONF_VE, U.CONF_EDITA, U.DASH, U.SA]) {
  igual(await filas(u, "select id from public.configuracion_reservas"), 1, `reglas legibles para ${u}`);
  igual(await filas(u, "select id from public.configuracion_turnos"), 2, `turnos legibles para ${u}`);
}

// ─── 3. Guardar las reglas (configuracion_reservas) ────────────────────────
igual(await actualizarReglas(U.CONF_EDITA), 1, "con «Puede editar» en Configuración se guardan las reglas");
igual(await actualizarReglas(U.ADMIN_VE), 1, "el admin sembrado las sigue guardando");
igual(await actualizarReglas(U.SA), 1, "el super admin, siempre");
igual(await actualizarReglas(U.CONF_VE), 0, "con solo «Ver» en Configuración no se guardan (aunque edite Reservas)");
igual(await actualizarReglas(U.GERENTE), 0, "editar Reservas no basta para las reglas");
igual(await actualizarReglas(U.ADMIN_FUERA), 0, "ser admin ya no basta para las reglas");
igual(await actualizarReglas(U.BLOQ), 0, "un usuario bloqueado no guarda nada");
await rechaza(U.SA, "insert into public.configuracion_reservas default values", RLS, "nadie crea otra fila de reglas");
igual(await filas(U.SA, "delete from public.configuracion_reservas returning id"), 0, "nadie borra la fila de reglas");

// ─── 4. Turnos ─────────────────────────────────────────────────────────────
await crearTurno(U.CONF_EDITA); comprobaciones++;
igual(await filas(U.CONF_EDITA, "update public.configuracion_turnos set activo = false where nombre_periodo = 'Merienda' returning id"), 1,
  "con «Puede editar» en Configuración se cambian turnos");
igual(await borrarTurnos(U.CONF_VE), 0, "con solo «Ver» no se borran turnos");
igual(await borrarTurnos(U.GERENTE), 0, "editar Reservas ya no basta para borrar turnos");
igual(await borrarTurnos(U.CONF_EDITA), 1, "con «Puede editar» en Configuración se borran turnos");
for (const u of [U.CONF_VE, U.GERENTE, U.ADMIN_FUERA, U.BLOQ]) await rechaza(u, "insert into public.configuracion_turnos (nombre_periodo) values ('Merienda')", RLS, `${u} creó un turno`);
igual(await filas(U.GERENTE, "update public.configuracion_turnos set activo = false returning id"), 0, "editar Reservas ya no basta para cambiar turnos");
await crearTurno(U.SA); comprobaciones++;

// ─── 5. Plantillas de correo ───────────────────────────────────────────────
igual(await leerPlantillas(U.CONF_VE), 1, "con «Ver» en Configuración se leen las plantillas");
igual(await leerPlantillas(U.CONF_EDITA), 1, "y con «Puede editar»");
igual(await leerPlantillas(U.GERENTE), 0, "Reservas sin Configuración ya no lee plantillas");
igual(await leerPlantillas(U.DASH), 0, "Dashboard no lee plantillas");
igual(await leerPlantillas(U.BLOQ), 0, "un usuario bloqueado no lee plantillas");
await rechaza(U.CONF_VE, "insert into public.plantillas_email_reserva (tipo, version, asunto, saludo, cuerpo) values ('confirmada', 9, 'a', 'b', 'c')",
  RLS, "con solo «Ver» se guardó una plantilla");
await rechaza(U.GERENTE, "insert into public.plantillas_email_reserva (tipo, version, asunto, saludo, cuerpo) values ('confirmada', 9, 'a', 'b', 'c')",
  RLS, "editar Reservas bastó para guardar una plantilla");
await como(U.CONF_EDITA, () => q("insert into public.plantillas_email_reserva (tipo, version, asunto, saludo, cuerpo) values ('confirmada', 2, 'v2', 'b', 'c')"));
comprobaciones++;
igual(await filas(U.CONF_EDITA, "update public.plantillas_email_reserva set nota_version = 'ok' where version = 2 returning id"), 1,
  "con «Puede editar» en Configuración se actualizan plantillas");
igual(await filas(U.GERENTE, "update public.plantillas_email_reserva set nota_version = 'no' returning id"), 0, "Reservas no actualiza plantillas");
igual(await filas(U.CONF_EDITA, "delete from public.plantillas_email_reserva where version = 2 returning id"), 1, "y las borra");

// Restaurar una versión: la función salta la RLS, así que comprueba la sección ella misma.
await rechaza(U.GERENTE, "select public.fn_restaurar_version_plantilla('confirmada', 1)", SIN_PERMISO, "Reservas restauró una plantilla");
await rechaza(U.CONF_VE, "select public.fn_restaurar_version_plantilla('confirmada', 1)", SIN_PERMISO, "con solo «Ver» se restauró");
igual((await restaurar(U.CONF_EDITA)).rows, [{ version: 2 }], "con «Puede editar» se restaura como versión nueva");
igual((await restaurar(U.SA)).rows, [{ version: 3 }], "el super admin restaura");
igual(await n("select count(*)::int n from public.plantillas_email_reserva where es_actual"), 1, "una sola versión vigente");
await assert.rejects(
  (async () => { await db.exec("begin; set local role anon;"); try { await q("select public.fn_restaurar_version_plantilla('confirmada', 1)"); } finally { await db.exec("rollback"); } })(),
  /permission denied/, "anon pudo llamar a restaurar");
comprobaciones++;

// ─── 6. Rollback: todo como estaba, y se puede volver a aplicar ────────────
await db.exec(ROLLBACK);
igual(await actualizarReglas(U.ADMIN_FUERA), 1, "rollback: el admin vuelve a guardar las reglas");
igual(await actualizarReglas(U.CONF_EDITA), 0, "rollback: Configuración ya no sirve para las reglas");
igual(await leerPlantillas(U.GERENTE), 3, "rollback: Reservas vuelve a leer plantillas");
igual((await restaurar(U.GERENTE)).rows, [{ version: 4 }], "rollback: Reservas vuelve a restaurar");
await rechaza(U.CONF_EDITA, "select public.fn_restaurar_version_plantilla('confirmada', 1)", /sección reservas(?!_)/,
  "rollback: la función vuelve a pedir la sección reservas");
igual(await n(`select count(*)::int n from pg_policies where tablename = 'configuracion_turnos' and policyname like 'Admins pueden%'`), 3,
  "rollback: vuelven las tres políticas de admin de turnos");
igual((await sembrados()).length, 4, "el rollback deja los permisos sembrados (inofensivos)");
await db.exec(MIGRACION);
igual((await sembrados()).length, 4, "volver a aplicar tras el rollback no siembra otra vez");
igual(await actualizarReglas(U.ADMIN_FUERA), 0, "reaplicada: ser admin vuelve a no bastar");

await db.close();
console.log(`permiso_reservas_configuracion (PGlite): ${comprobaciones} comprobaciones OK`);
