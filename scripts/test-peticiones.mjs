// Peticiones (usuarios) y Tickets (Super Admin) con análisis de IA (13/11/2026): la migración REAL
// 20261129100000_peticiones.sql y su rollback contra un Postgres en memoria (PGlite). Nunca toca Supabase.
//
//   npm run test:peticiones:db
//
// Cubre: se para sin is_super_admin; se aplica sin cubos, sin avisos ni ia_funciones; idempotente; RLS
// (cada usuario crea a su nombre y ve SOLO las suyas, el super admin ve todas; sesión bloqueada y anon,
// nada); privilegios por columna (el usuario no puede poner estado, análisis, autor ni Linear al crear, ni
// cambiar nada después; el super admin solo estado y motivo); autor, nombre y email del servidor; CHECK
// (título, descripción, prioridad, módulo, ruta de la captura, descartar sin motivo); motivo que se borra al
// reabrir; quién y cuándo cambió el estado; tope de 20 al día por usuario; aviso «urgente» en la campana
// SOLO para el super admin (también «Marcar todos» de otro usuario no lo marca); reservar el análisis (una
// vez sin forzar, colgado > 3 min, forzar, tope de 10, solo service role); cubo privado y sus políticas;
// auditoría; baja de un usuario; rollback (seccion_aviso como antes) y nueva aplicación.
import { PGlite } from "@electric-sql/pglite";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import assert from "node:assert/strict";

const MIGRACION = await readFile("supabase/migrations/20261129100000_peticiones.sql", "utf8");
const ROLLBACK = await readFile("supabase/rollbacks/20261129100000_peticiones_ROLLBACK.sql", "utf8");

let comprobaciones = 0;
const ok = (v, msg) => { assert.ok(v, msg); comprobaciones++; };
const igual = (a, b, msg) => { assert.deepEqual(a, b, msg); comprobaciones++; };
const falla = async (p, re, msg) => { await assert.rejects(p, re, msg); comprobaciones++; };

const BASE = `
  create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
  create schema auth; create schema private;
  create table auth.users (id uuid primary key, email text, banned_until timestamptz, raw_user_meta_data jsonb default '{}'::jsonb);
  create table auth.sessions (id uuid primary key, user_id uuid);
  create function auth.jwt() returns jsonb language sql stable as $$ select nullif(current_setting('request.jwt.claims', true), '')::jsonb $$;
  create function auth.uid() returns uuid language sql stable as $$ select (auth.jwt() ->> 'sub')::uuid $$;
  grant usage on schema public, auth, private to anon, authenticated, service_role;
  grant execute on all functions in schema auth to anon, authenticated, service_role;
  grant references on auth.users to authenticated;
`;
const SUPER = `
  create table public.super_admins (user_id uuid primary key);
  create function public.is_super_admin(_user_id uuid) returns boolean language sql stable security definer set search_path = public
    as $f$ select exists (select 1 from public.super_admins where user_id = _user_id) $f$;
  create table public.user_permissions (user_id uuid, section_key text, can_view boolean, can_edit boolean, primary key (user_id, section_key));
  create function public.has_section_permission(_user_id uuid, _section text, _permission text) returns boolean
    language sql stable security definer set search_path = public as $f$
    select case when public.is_super_admin(_user_id) then true else exists (
      select 1 from public.user_permissions where user_id = _user_id and section_key = _section
        and ((_permission = 'view' and can_view = true) or (_permission = 'edit' and can_edit = true))) end $f$;
  create function public.can_read_section(_section text) returns boolean language sql stable security definer set search_path = public
    as $f$ select public.has_section_permission((select auth.uid()), _section, 'view') $f$;
  create function public.can_write_section(_section text) returns boolean language sql stable security definer set search_path = public
    as $f$ select public.has_section_permission((select auth.uid()), _section, 'edit') $f$;
  grant execute on function public.is_super_admin(uuid), public.has_section_permission(uuid, text, text),
    public.can_read_section(text), public.can_write_section(text) to authenticated, service_role;
  create function private.sesion_panel_permitida() returns boolean language sql stable security definer set search_path = '' as $f$
    select auth.uid() is not null and exists (
      select 1 from auth.users u where u.id = auth.uid() and (u.banned_until is null or u.banned_until <= now())
        and exists (select 1 from auth.sessions s where s.user_id = u.id and s.id::text = auth.jwt()->>'session_id')) $f$;
  revoke all on function private.sesion_panel_permitida() from public;
  grant execute on function private.sesion_panel_permitida() to authenticated;
  create table public.audit_log (id bigserial primary key, tabla text, accion text, actor uuid, detalles jsonb);
  create function public.fn_registrar_auditoria() returns trigger language plpgsql security definer set search_path = public as $f$
  begin
    insert into public.audit_log (tabla, accion, actor, detalles)
      values (TG_TABLE_NAME, lower(TG_OP), auth.uid(), case when TG_OP = 'DELETE' then to_jsonb(old) else to_jsonb(new) end);
    if TG_OP = 'DELETE' then return old; end if; return new;
  end $f$;
`;
// notificaciones_dashboard con las políticas de la demo (13/11/2026), seccion_aviso y marcar_avisos_revisados
// tal cual 20261124100000_avisos_revisado_por_seccion.sql.
const AVISOS = `
  create table public.notificaciones_dashboard (
    id uuid primary key default gen_random_uuid(), tipo text not null, titulo text not null, mensaje text,
    referencia_id uuid, referencia_tipo text, leida boolean not null default false,
    prioridad text not null default 'normal' check (prioridad in ('alta', 'normal')), datos jsonb,
    created_at timestamptz default now()
  );
  alter table public.notificaciones_dashboard enable row level security;
  create policy acceso_panel_no_bloqueado on public.notificaciones_dashboard as restrictive for all to authenticated
    using ((select private.sesion_panel_permitida())) with check ((select private.sesion_panel_permitida()));
  create policy notificaciones_dashboard_select_seccion on public.notificaciones_dashboard for select to authenticated
    using ((select public.can_read_section('dashboard')));
  create function public.seccion_aviso(p_tipo text) returns text language sql immutable set search_path = public as $f$
    select case
      when p_tipo in ('reserva_nueva', 'reserva_cancelada', 'reserva_sin_asignar', 'solicitud_pendiente') then 'reservas'
      when p_tipo like 'facturas\\_%' or p_tipo in ('subida_precio', 'original_sin_drive') then 'facturas'
      else 'dashboard'
    end $f$;
  grant execute on function public.seccion_aviso(text) to authenticated, service_role;
  create policy notificaciones_dashboard_select_por_seccion_aviso on public.notificaciones_dashboard for select to authenticated
    using ((select public.can_read_section(public.seccion_aviso(tipo))));
  create policy notificaciones_dashboard_update_seccion on public.notificaciones_dashboard for update to authenticated
    using ((select public.can_write_section('dashboard'))) with check ((select public.can_write_section('dashboard')));
  create policy notificaciones_ia_modelos_solo_super_admin on public.notificaciones_dashboard as restrictive for all to authenticated
    using ((tipo !~~ 'ia\\_modelo%' or (select public.is_super_admin((select auth.uid())))))
    with check ((tipo !~~ 'ia\\_modelo%' or (select public.is_super_admin((select auth.uid())))));
  grant select, insert, update, delete on public.notificaciones_dashboard to authenticated;
  create function public.marcar_avisos_revisados(p_ids uuid[] default null, p_tipos text[] default null)
  returns integer language plpgsql security definer set search_path = public as $f$
  declare v_uid uuid := (select auth.uid()); v_n integer;
  begin
    if v_uid is null then raise exception 'Hay que iniciar sesión para revisar avisos' using errcode = '42501'; end if;
    update public.notificaciones_dashboard n set leida = true
     where n.leida = false and (p_ids is null or n.id = any(p_ids)) and (p_tipos is null or n.tipo = any(p_tipos))
       and public.has_section_permission(v_uid, public.seccion_aviso(n.tipo), 'view')
       and (n.tipo not like 'ia\\_modelo%' or public.is_super_admin(v_uid));
    get diagnostics v_n = row_count;
    return v_n;
  end $f$;
  grant execute on function public.marcar_avisos_revisados(uuid[], text[]) to authenticated;
`;
const STORAGE = `
  create schema storage;
  create table storage.buckets (id text primary key, name text, public boolean default false,
    file_size_limit bigint, allowed_mime_types text[]);
  create table storage.objects (id uuid primary key default gen_random_uuid(),
    bucket_id text references storage.buckets (id), name text, owner uuid default auth.uid(), unique (bucket_id, name));
  alter table storage.objects enable row level security;
  grant usage on schema storage to anon, authenticated, service_role;
  grant select, insert, update, delete on storage.objects to anon, authenticated;
  grant all on storage.objects, storage.buckets to service_role;
`;
const IA = `
  create table public.ia_funciones (funcion text primary key, descripcion text not null,
    instrumentada boolean not null default false, unidad text not null default 'llamada',
    orden integer not null default 100, activo boolean not null default true);
  create table public.ia_modelo_funcion (funcion text primary key references public.ia_funciones (funcion) on delete restrict,
    modelo text, modelo_respaldo text, modelo_codigo text, centralizado boolean not null default false);
`;
// Como en Supabase: lo nuevo de public nace con todos los privilegios para anon y authenticated; la RLS (y
// los revoke de la migración) son la barrera.
const PRIVILEGIOS_SUPABASE = `
  alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
  alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
  alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;
`;

const U = {
  SA: "a0000000-0000-0000-0000-000000000001", // super admin
  ANA: "a0000000-0000-0000-0000-000000000002", // Reservas y el panel (dashboard)
  LUIS: "a0000000-0000-0000-0000-000000000003", // Solo Facturas
  BLOQ: "a0000000-0000-0000-0000-000000000004", // bloqueado
  BAJA: "a0000000-0000-0000-0000-000000000005", // se da de baja al final
  TOPE: "a0000000-0000-0000-0000-000000000006", // para el tope diario
};
const sesion = (u) => u.replace(/^a/, "b");
const DATOS = `
  insert into auth.users (id, email, banned_until, raw_user_meta_data) values
    ('${U.SA}', 'sa@t', null, '{}'), ('${U.ANA}', 'ana@t', null, '{"display_name": "Ana Sala"}'), ('${U.LUIS}', 'luis@t', null, '{}'),
    ('${U.BLOQ}', 'bloq@t', now() + interval '1 day', '{}'), ('${U.BAJA}', 'baja@t', null, '{}'), ('${U.TOPE}', 'tope@t', null, '{}');
  insert into auth.sessions (id, user_id) select ('b' || substr(id::text, 2))::uuid, id from auth.users;
  insert into public.super_admins values ('${U.SA}');
  insert into public.user_permissions values
    ('${U.ANA}', 'reservas', true, true), ('${U.ANA}', 'dashboard', true, true), ('${U.LUIS}', 'facturas', true, true),
    ('${U.BLOQ}', 'dashboard', true, true);
`;

// ─── 0. Sin is_super_admin se para sin crear nada ───────────────────────────
{
  const otra = new PGlite();
  await otra.exec(BASE);
  await falla(otra.exec(MIGRACION), /peticiones: falta is_super_admin/, "no se paró sin is_super_admin");
  await otra.exec("rollback");
  igual((await otra.query(`select to_regclass('public.peticiones') t`)).rows[0], { t: null }, "la migración abortada dejó la tabla");
  await otra.close();
}

// ─── 1. Sin cubos, avisos ni ia_funciones también se aplica ─────────────────
{
  const otra = new PGlite();
  await otra.exec(BASE + SUPER);
  await otra.exec(MIGRACION);
  ok((await otra.query(`select to_regclass('public.peticiones') is not null as t`)).rows[0].t, "sin storage ni avisos no creó la tabla");
  await otra.close();
}

const db = new PGlite();
await db.exec(BASE + SUPER + AVISOS + STORAGE + IA + DATOS + PRIVILEGIOS_SUPABASE);
await db.exec(MIGRACION);
await db.exec(MIGRACION); // idempotente
comprobaciones++;

const q = (sql, params) => db.query(sql, params);
const n = async (sql, params) => (await q(sql, params)).rows[0].n;
async function como(u, fn, rol = "authenticated", sesionId = u && sesion(u)) {
  await db.exec("begin");
  try {
    if (rol === "anon") {
      await db.exec(`set local role anon; select set_config('request.jwt.claims', '{"role":"anon"}', true);`);
    } else if (rol === "service_role") {
      await db.exec(`set local role service_role; select set_config('request.jwt.claims', '{"role":"service_role"}', true);`);
    } else {
      await db.exec(`set local role authenticated;
        select set_config('request.jwt.claims', '${JSON.stringify({ sub: u, role: "authenticated", session_id: sesionId })}', true);`);
    }
    const r = await fn();
    await db.exec("commit");
    return r;
  } catch (e) {
    await db.exec("rollback").catch(() => {});
    throw e;
  }
}
const filas = (u, sql, params, rol) => como(u, async () => (await q(sql, params)).rows, rol);
const crear = (u, campos = {}) => {
  const c = { titulo: "No se guarda la reserva", prioridad: "normal", modulo: "reservas", descripcion: "Al pulsar Guardar en una reserva no pasa nada.", ...campos };
  const cols = Object.keys(c);
  return como(u, async () => (await q(
    `insert into public.peticiones (${cols.join(", ")}) values (${cols.map((_, i) => `$${i + 1}`).join(", ")}) returning *`,
    Object.values(c),
  )).rows[0]);
};

// ─── 2. Estructura ──────────────────────────────────────────────────────────
{
  igual((await q(`select relrowsecurity r from pg_class where oid = 'public.peticiones'::regclass`)).rows[0].r, true, "peticiones sin RLS");
  igual(await n(`select count(*)::int n from pg_policies where tablename = 'peticiones' and policyname = 'acceso_panel_no_bloqueado' and permissive = 'RESTRICTIVE'`),
    1, "falta la restrictiva de sesión de panel");
  igual((await q(`select has_table_privilege('anon', 'public.peticiones', 'SELECT') s, has_table_privilege('anon', 'public.peticiones', 'INSERT') i`)).rows[0],
    { s: false, i: false }, "anon conserva privilegios en peticiones");
  igual((await q(`select has_table_privilege('authenticated', 'public.peticiones', 'UPDATE') u, has_table_privilege('authenticated', 'public.peticiones', 'DELETE') d,
      has_table_privilege('authenticated', 'public.peticiones', 'TRUNCATE') t`)).rows[0], { u: false, d: false, t: false },
    "authenticated conserva UPDATE de tabla, DELETE o TRUNCATE");
  const columnas = async (priv) => (await q(`select attname from pg_attribute where attrelid = 'public.peticiones'::regclass and attnum > 0 and not attisdropped
      and has_column_privilege('authenticated', attrelid, attnum, $1) order by attname`, [priv])).rows.map((r) => r.attname);
  igual(await columnas("INSERT"), ["captura_path", "descripcion", "dispositivo", "modulo", "prioridad", "ruta", "titulo"], "columnas que authenticated puede rellenar");
  igual(await columnas("UPDATE"), ["estado", "motivo_descarte"], "columnas que authenticated puede cambiar");
  igual((await q(`select has_function_privilege('authenticated', 'public.peticion_reservar_analisis(uuid, boolean)', 'EXECUTE') a,
      has_function_privilege('anon', 'public.peticion_reservar_analisis(uuid, boolean)', 'EXECUTE') b,
      has_function_privilege('service_role', 'public.peticion_reservar_analisis(uuid, boolean)', 'EXECUTE') c`)).rows[0],
    { a: false, b: false, c: true }, "reservar el análisis: solo service role");
  igual((await q(`select id, public, file_size_limit::int l, allowed_mime_types m from storage.buckets where id = 'peticiones'`)).rows,
    [{ id: "peticiones", public: false, l: 5242880, m: ["image/jpeg", "image/png", "image/webp"] }], "cubo privado de 5 MB");
  igual((await q(`select instrumentada, unidad from public.ia_funciones where funcion = 'analizar-peticion'`)).rows, [{ instrumentada: true, unidad: "petición" }],
    "alta de analizar-peticion en Gasto IA");
  igual(await n(`select count(*)::int n from public.ia_modelo_funcion where funcion = 'analizar-peticion' and modelo is null and centralizado`), 1,
    "alta en ia_modelo_funcion con el modelo del código");
  igual((await q(`select public.seccion_aviso('peticion_urgente') a, public.seccion_aviso('reserva_nueva') b, public.seccion_aviso('facturas_x') c, public.seccion_aviso('sistema') d`)).rows[0],
    { a: "solo_super_admin", b: "reservas", c: "facturas", d: "dashboard" }, "seccion_aviso de los avisos de peticiones");
}

// ─── 3. Crear: a su nombre, solo las columnas del formulario ───────────────
const p1 = await crear(U.ANA, { ruta: "/reservas?tab=hoy", dispositivo: "Mozilla/5.0 (iPad)", titulo: "  No se guarda la reserva  " });
igual([p1.creado_por, p1.creado_por_nombre, p1.creado_por_email, p1.estado, p1.analisis_estado, p1.titulo],
  [U.ANA, "Ana Sala", "ana@t", "nueva", "pendiente", "No se guarda la reserva"], "autor, nombre, email y estado del servidor");
const p2 = await crear(U.LUIS, { modulo: "facturas", titulo: "Mejorar el buscador", prioridad: "baja", descripcion: "Que se pueda buscar por proveedor y fecha." });
igual(p2.creado_por_nombre, "luis@t", "sin nombre guardado, el email");

await falla(como(U.ANA, () => q(`insert into public.peticiones (titulo, modulo, descripcion, estado) values ('Hola hola', 'reservas', 'Descripción larga suficiente', 'aceptada')`)),
  /permission denied/, "el usuario no puede poner el estado al crear");
await falla(como(U.ANA, () => q(`insert into public.peticiones (titulo, modulo, descripcion, analisis) values ('Hola hola', 'reservas', 'Descripción larga suficiente', '{}')`)),
  /permission denied/, "ni el análisis");
await falla(como(U.ANA, () => q(`insert into public.peticiones (titulo, modulo, descripcion, creado_por) values ('Hola hola', 'reservas', 'Descripción larga suficiente', '${U.LUIS}')`)),
  /permission denied/, "ni el autor");
await falla(como(U.ANA, () => q(`insert into public.peticiones (titulo, modulo, descripcion, linear_url) values ('Hola hola', 'reservas', 'Descripción larga suficiente', 'https://linear.app/x')`)),
  /permission denied/, "ni Linear");

// CHECK
await falla(crear(U.ANA, { titulo: "ab" }), /peticiones_titulo_check/, "título de menos de 3");
await falla(crear(U.ANA, { titulo: "x".repeat(121) }), /peticiones_titulo_check/, "título de más de 120");
await falla(crear(U.ANA, { descripcion: "corta" }), /peticiones_descripcion_check/, "descripción de menos de 10");
await falla(crear(U.ANA, { descripcion: "x".repeat(4001) }), /peticiones_descripcion_check/, "descripción de más de 4000");
await falla(crear(U.ANA, { prioridad: "critica" }), /peticiones_prioridad_check/, "prioridad que no existe");
await falla(crear(U.ANA, { modulo: "Reservas; drop" }), /peticiones_modulo_check/, "módulo con formato raro");
await falla(crear(U.ANA, { captura_path: `${U.ANA}/foto.exe` }), /peticiones_captura_path_check/, "ruta de captura no válida");
await falla(crear(U.ANA, { captura_path: `${U.LUIS}/${randomUUID()}.jpg` }), /row-level security/, "captura en la carpeta de otro");
const conCaptura = await crear(U.ANA, { captura_path: `${U.ANA}/${randomUUID()}.png`, prioridad: "alta" });
ok(conCaptura.captura_path.startsWith(U.ANA), "captura en su carpeta");

// Sesión bloqueada, sin sesión de panel, anon
await falla(crear(U.BLOQ), /row-level security/, "con la sesión bloqueada no se crea");
await falla(como(U.ANA, () => q(`insert into public.peticiones (titulo, modulo, descripcion) values ('Hola hola', 'reservas', 'Descripción larga suficiente')`), "authenticated", randomUUID()),
  /row-level security/, "sin sesión de panel no se crea");
await falla(como(null, () => q(`insert into public.peticiones (titulo, modulo, descripcion) values ('Hola hola', 'reservas', 'Descripción larga suficiente')`), "anon"),
  /permission denied/, "anon no crea");

// ─── 4. Leer: cada uno las suyas; el super admin, todas ─────────────────────
igual((await filas(U.ANA, `select titulo from public.peticiones order by created_at, titulo`)).length, 2, "Ana ve sus dos peticiones");
igual((await filas(U.ANA, `select count(*)::int n from public.peticiones where creado_por <> '${U.ANA}'`))[0].n, 0, "Ana no ve las de otros");
igual((await filas(U.LUIS, `select id from public.peticiones`)).map((r) => r.id), [p2.id], "Luis solo ve la suya");
igual((await filas(U.SA, `select count(*)::int n from public.peticiones`))[0].n, 3, "el super admin ve todas");
igual((await filas(U.BLOQ, `select count(*)::int n from public.peticiones`))[0].n, 0, "la sesión bloqueada no ve nada");
await falla(filas(null, `select 1 from public.peticiones`, [], "anon"), /permission denied/, "anon no lee");

// ─── 5. Cambiar: el usuario nada; el super admin, estado y motivo ──────────
await falla(como(U.ANA, () => q(`update public.peticiones set titulo = 'otro título' where id = $1`, [p1.id])), /permission denied/, "el usuario no cambia el título");
await falla(como(U.ANA, () => q(`update public.peticiones set analisis = '{}' where id = $1`, [p1.id])), /permission denied/, "ni el análisis");
igual(await como(U.ANA, async () => (await q(`update public.peticiones set estado = 'hecha' where id = $1`, [p1.id])).affectedRows), 0,
  "el usuario no cambia el estado de la suya (la RLS no le deja)");
await falla(como(U.ANA, () => q(`delete from public.peticiones where id = $1`, [p1.id])), /permission denied/, "ni la borra");
await falla(como(U.SA, () => q(`update public.peticiones set titulo = 'otro título' where id = $1`, [p1.id])), /permission denied/, "el super admin no cambia el texto");
await falla(como(U.SA, () => q(`update public.peticiones set analisis_estado = 'hecho' where id = $1`, [p1.id])), /permission denied/, "ni el análisis");
await falla(como(U.SA, () => q(`update public.peticiones set estado = 'descartada' where id = $1`, [p1.id])), /peticiones_descartada_con_motivo/,
  "descartar sin motivo");
await falla(como(U.SA, () => q(`update public.peticiones set estado = 'cerrada' where id = $1`, [p1.id])), /peticiones_estado_check/, "estado que no existe");
await como(U.SA, () => q(`update public.peticiones set estado = 'descartada', motivo_descarte = '  Ya existe: usa Copiar reserva.  ' where id = $1`, [p1.id]));
let fila = (await q(`select estado, motivo_descarte, estado_cambiado_por, estado_cambiado_en is not null as cuando, creado_por from public.peticiones where id = $1`, [p1.id])).rows[0];
igual(fila, { estado: "descartada", motivo_descarte: "Ya existe: usa Copiar reserva.", estado_cambiado_por: U.SA, cuando: true, creado_por: U.ANA },
  "descartada con motivo, quién y cuándo");
igual((await filas(U.ANA, `select estado, motivo_descarte from public.peticiones where id = $1`, [p1.id]))[0],
  { estado: "descartada", motivo_descarte: "Ya existe: usa Copiar reserva." }, "quien la envió ve el estado y el motivo");
await como(U.SA, () => q(`update public.peticiones set estado = 'aceptada' where id = $1`, [p1.id]));
igual((await q(`select estado, motivo_descarte from public.peticiones where id = $1`, [p1.id])).rows[0], { estado: "aceptada", motivo_descarte: null },
  "al reabrir se borra el motivo");
igual(await como(U.BLOQ, async () => (await q(`update public.peticiones set estado = 'hecha' where id = $1`, [p1.id])).affectedRows), 0,
  "la sesión bloqueada no cambia nada");

// ─── 6. Tope de 20 al día ───────────────────────────────────────────────────
for (let i = 0; i < 20; i++) await crear(U.TOPE, { titulo: `Petición número ${i}` });
await falla(crear(U.TOPE), /Has enviado 20 peticiones/, "la 21 en 24 h no entra");
// created_at no se puede cambiar (disparador): para viajar en el tiempo, sin él.
await db.exec(`alter table public.peticiones disable trigger trg_peticiones_al_cambiar;
  update public.peticiones set created_at = now() - interval '25 hours' where creado_por = '${U.TOPE}' and titulo = 'Petición número 0';
  alter table public.peticiones enable trigger trg_peticiones_al_cambiar;`);
await falla(como(null, () => q(`update public.peticiones set created_at = now() - interval '2 days' where creado_por = '${U.TOPE}' returning created_at`), "service_role")
  .then(async () => { if (await n(`select count(*)::int n from public.peticiones where created_at < now() - interval '30 hours'`)) throw new Error("cambió created_at"); throw new Error("sin cambios: bien"); }),
  /sin cambios: bien/, "created_at no se puede cambiar (ni con service role)");
ok(await crear(U.TOPE, { titulo: "Pasadas 24 horas" }), "lo de hace más de 24 h no cuenta");

// ─── 7. Aviso urgente: solo el super admin ──────────────────────────────────
const urgente = await crear(U.ANA, { prioridad: "urgente", titulo: "No puedo abrir Reservas" });
igual((await q(`select tipo, titulo, mensaje, referencia_id, referencia_tipo, prioridad, leida from public.notificaciones_dashboard where referencia_id = $1`, [urgente.id])).rows,
  [{ tipo: "peticion_urgente", titulo: "Petición urgente: No puedo abrir Reservas", mensaje: "Ana Sala · módulo reservas", referencia_id: urgente.id,
    referencia_tipo: "peticion", prioridad: "alta", leida: false }], "la urgente avisa en la campana");
igual(await n(`select count(*)::int n from public.notificaciones_dashboard where tipo = 'peticion_urgente'`), 1, "las no urgentes no avisan");
await db.exec(`insert into public.notificaciones_dashboard (tipo, titulo) values ('sistema', 'aviso-sistema')`);
igual((await filas(U.ANA, `select tipo from public.notificaciones_dashboard order by tipo`)).map((r) => r.tipo), ["sistema"],
  "un usuario con el panel no ve el aviso de petición (ni siendo quien la envió)");
igual(await como(U.ANA, async () => (await q(`select public.marcar_avisos_revisados(null, null) as n`)).rows[0].n), 1,
  "«Marcar todos» de un usuario marca solo lo suyo (el de sistema)");
igual((await q(`select leida from public.notificaciones_dashboard where tipo = 'peticion_urgente'`)).rows[0].leida, false, "el aviso de petición sigue sin revisar");
await falla(como(U.ANA, () => q(`insert into public.notificaciones_dashboard (tipo, titulo) values ('peticion_urgente', 'falso')`)), /row-level security/,
  "un usuario no se inventa avisos de peticiones");
igual((await filas(U.SA, `select tipo from public.notificaciones_dashboard where tipo = 'peticion_urgente'`)).length, 1, "el super admin sí lo ve");
igual(await como(U.SA, async () => (await q(`select public.marcar_avisos_revisados(null, array['peticion_urgente']) as n`)).rows[0].n), 1, "y lo marca");
// Un aviso que falla no impide guardar la petición.
await db.exec(`alter table public.notificaciones_dashboard add constraint sin_peticiones check (tipo <> 'peticion_urgente') not valid`);
ok(await crear(U.ANA, { prioridad: "urgente", titulo: "Urgente sin aviso" }), "si el aviso falla, la petición se guarda igual");
await db.exec(`alter table public.notificaciones_dashboard drop constraint sin_peticiones`);

// ─── 8. Reservar el análisis ────────────────────────────────────────────────
const reservar = (id, forzar = false) => como(null, async () => (await q(`select id, analisis_estado, analisis_intentos from public.peticion_reservar_analisis($1, $2)`, [id, forzar])).rows, "service_role");
igual(await reservar(p2.id), [{ id: p2.id, analisis_estado: "analizando", analisis_intentos: 1 }], "la primera vez se reserva");
igual(await reservar(p2.id), [], "si ya se está analizando, no se reserva otra vez");
await db.exec(`update public.peticiones set analisis_estado = 'hecho', analisis = '{"resumen":"x"}' where id = '${p2.id}'`);
igual(await reservar(p2.id), [], "ya analizada: sin forzar no se repite");
igual((await reservar(p2.id, true))[0].analisis_intentos, 2, "con forzar («Volver a analizar») sí");
await db.exec(`update public.peticiones set analisis_pedido_en = now() - interval '4 minutes' where id = '${p2.id}'`);
igual((await reservar(p2.id))[0]?.analisis_intentos, 3, "un análisis colgado más de 3 min se puede volver a reservar");
await db.exec(`update public.peticiones set analisis_estado = 'error', analisis_intentos = 10 where id = '${p2.id}'`);
igual(await reservar(p2.id, true), [], "tope de 10 intentos");
await falla(como(U.SA, () => q(`select * from public.peticion_reservar_analisis($1, true)`, [p2.id])), /permission denied/, "el navegador no puede reservar el análisis");
await como(null, () => q(`update public.peticiones set analisis_estado = 'hecho', analisis = '{"resumen": "ok"}', analisis_modelo = 'gpt-4.1-mini' where id = $1`, [p2.id]), "service_role");
igual((await q(`select analisis_estado, creado_por from public.peticiones where id = $1`, [p2.id])).rows[0], { analisis_estado: "hecho", creado_por: U.LUIS },
  "service role guarda el análisis (sin cambiar el autor)");

// ─── 9. Cubo «peticiones» ───────────────────────────────────────────────────
const fichero = `${U.ANA}/${randomUUID()}.jpg`;
await como(U.ANA, () => q(`insert into storage.objects (bucket_id, name) values ('peticiones', $1)`, [fichero]));
await falla(como(U.ANA, () => q(`insert into storage.objects (bucket_id, name) values ('peticiones', $1)`, [`${U.LUIS}/${randomUUID()}.jpg`])),
  /row-level security/, "no se sube a la carpeta de otro");
await falla(como(U.ANA, () => q(`insert into storage.objects (bucket_id, name) values ('peticiones', $1)`, [`${U.ANA}/captura.gif`])),
  /row-level security/, "ni con un nombre que no es <uuid>.jpg|png|webp");
await falla(como(U.BLOQ, () => q(`insert into storage.objects (bucket_id, name) values ('peticiones', $1)`, [`${U.BLOQ}/${randomUUID()}.jpg`])),
  /row-level security/, "ni con la sesión bloqueada");
igual((await filas(U.ANA, `select name from storage.objects where bucket_id = 'peticiones'`)).map((r) => r.name), [fichero], "Ana lee su captura");
igual((await filas(U.LUIS, `select name from storage.objects where bucket_id = 'peticiones'`)).length, 0, "Luis no lee la de Ana");
igual((await filas(U.SA, `select name from storage.objects where bucket_id = 'peticiones'`)).length, 1, "el super admin la lee");
igual(await como(U.ANA, async () => (await q(`delete from storage.objects where name = $1`, [fichero])).affectedRows), 0, "nadie borra capturas desde el panel");

// ─── 10. Auditoría y baja de un usuario ─────────────────────────────────────
ok(await n(`select count(*)::int n from public.audit_log where tabla = 'peticiones'`) > 0, "las peticiones se auditan");
const deBaja = await crear(U.BAJA, { titulo: "Antes de irme" });
await db.exec(`delete from auth.users where id = '${U.BAJA}'`);
igual((await q(`select creado_por, creado_por_email from public.peticiones where id = $1`, [deBaja.id])).rows[0], { creado_por: null, creado_por_email: "baja@t" },
  "al dar de baja al usuario la petición se queda (con su email)");

// ─── 11. Rollback (idempotente) y nueva aplicación ──────────────────────────
await db.exec(ROLLBACK);
await db.exec(ROLLBACK);
igual((await q(`select to_regclass('public.peticiones') t, to_regprocedure('public.peticion_reservar_analisis(uuid, boolean)') f`)).rows[0], { t: null, f: null },
  "el rollback quita la tabla y las funciones");
igual((await q(`select public.seccion_aviso('peticion_urgente') s`)).rows[0].s, "dashboard", "seccion_aviso vuelve a la de antes");
igual(await n(`select count(*)::int n from public.notificaciones_dashboard where tipo like 'peticion\\_%'`), 0, "los avisos de peticiones se borran");
igual(await n(`select count(*)::int n from pg_policies where policyname = 'notificaciones_peticiones_solo_super_admin'`), 0, "y su política");
igual(await n(`select count(*)::int n from public.ia_funciones where funcion = 'analizar-peticion'`), 0, "fuera de Gasto IA");
igual(await n(`select count(*)::int n from storage.buckets where id = 'peticiones'`), 1, "el cubo con capturas no se borra");
igual(await n(`select count(*)::int n from pg_policies where policyname like 'peticiones\\_capturas%'`), 0, "sus políticas sí");
await db.exec(MIGRACION);
ok(await crear(U.ANA, { titulo: "Otra vez aquí" }), "reaplicada, se vuelve a crear");
await db.exec(`delete from storage.objects where bucket_id = 'peticiones'`);
await db.exec(ROLLBACK);
igual(await n(`select count(*)::int n from storage.buckets where id = 'peticiones'`), 0, "vacío, el rollback borra el cubo");

await db.close();
console.log(`test-peticiones: ${comprobaciones} comprobaciones superadas`);
