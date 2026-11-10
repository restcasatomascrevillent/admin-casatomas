// Newsletter: plantillas guardadas y tope de «Crear con IA»
// (20261122153700_newsletter_plantillas.sql) contra un Postgres en memoria
// (PGlite), con la migración REAL. Nunca toca Supabase.
//
//   npm run test:newsletter-plantillas:db
//
// Cubre: se para sin can_edit_section sin dejar nada; se aplica sin
// ia_funciones ni sesión de panel; idempotente (no pisa ia_funciones); RLS
// (con «Ver» se leen las plantillas y no se escriben; con «Editar» sí; otra
// sección, sesión bloqueada y anon, nada); autor y fechas del servidor (ni al
// crear ni al cambiar); CHECK (nombre, tipo, bloques como lista de 1 a 20,
// origen); tope de 40 propuestas de IA por usuario y día de Madrid, que no
// cuenta lo de ayer ni se salta con un created_at viejo, y solo «ok» se
// cambia; auditoría de las plantillas; alta en ia_funciones e
// ia_modelo_funcion; baja de un usuario; y el rollback, con nueva aplicación.
import { PGlite } from "@electric-sql/pglite";
import { readFile } from "node:fs/promises";
import assert from "node:assert/strict";

const MIGRACION = await readFile("supabase/migrations/20261122153700_newsletter_plantillas.sql", "utf8");
const ROLLBACK = await readFile("supabase/rollbacks/20261122153700_newsletter_plantillas_ROLLBACK.sql", "utf8");

let comprobaciones = 0;
const ok = (v, msg) => { assert.ok(v, msg); comprobaciones++; };
const igual = (a, b, msg) => { assert.deepEqual(a, b, msg); comprobaciones++; };
const falla = async (p, re, msg) => { await assert.rejects(p, re, msg); comprobaciones++; };

const BASE = `
  create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
  create schema auth; create schema private;
  create table auth.users (id uuid primary key, email text, banned_until timestamptz);
  create table auth.sessions (id uuid primary key, user_id uuid);
  create function auth.jwt() returns jsonb language sql stable as $$ select nullif(current_setting('request.jwt.claims', true), '')::jsonb $$;
  create function auth.uid() returns uuid language sql stable as $$ select (auth.jwt() ->> 'sub')::uuid $$;
  grant usage on schema public, auth, private to anon, authenticated, service_role;
  grant execute on all functions in schema auth to anon, authenticated, service_role;
  grant references on auth.users to authenticated;

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
  grant execute on function public.is_super_admin(uuid), public.has_section_permission(uuid, text, text),
    public.can_read_section(text) to authenticated, service_role;
`;
const SESION = `
  create function private.sesion_panel_permitida() returns boolean language sql stable security definer set search_path = '' as $f$
    select auth.uid() is not null and exists (
      select 1 from auth.users u where u.id = auth.uid() and (u.banned_until is null or u.banned_until <= now())
        and exists (select 1 from auth.sessions s where s.user_id = u.id and s.id::text = auth.jwt()->>'session_id')) $f$;
  revoke all on function private.sesion_panel_permitida() from public;
  grant execute on function private.sesion_panel_permitida() to authenticated;
`;
const AUDITORIA = `
  create table public.audit_log (id bigserial primary key, tabla text, accion text, actor uuid, detalles jsonb);
  create function public.fn_registrar_auditoria() returns trigger language plpgsql security definer set search_path = public as $f$
  begin
    insert into public.audit_log (tabla, accion, actor, detalles)
      values (TG_TABLE_NAME, lower(TG_OP), auth.uid(), case when TG_OP = 'DELETE' then to_jsonb(old) else to_jsonb(new) end);
    if TG_OP = 'DELETE' then return old; end if; return new;
  end $f$;
`;
const CAN_EDIT = `
  create function public.can_edit_section(_section text) returns boolean language sql stable security definer set search_path = ''
    as $f$ select public.has_section_permission((select auth.uid()), _section, 'edit') $f$;
  revoke all on function public.can_edit_section(text) from public, anon;
  grant execute on function public.can_edit_section(text) to authenticated, service_role;
`;
const IA = `
  create table public.ia_funciones (funcion text primary key, descripcion text not null,
    instrumentada boolean not null default false, unidad text not null default 'llamada',
    orden integer not null default 100, activo boolean not null default true);
  create table public.ia_modelo_funcion (funcion text primary key references public.ia_funciones (funcion) on update cascade on delete restrict,
    modelo text, modelo_respaldo text, modelo_codigo text, centralizado boolean not null default false);
`;
const PRIVILEGIOS_SUPABASE = `
  alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
  alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
  alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;
`;

const U = {
  SA: "a0000000-0000-0000-0000-000000000001",
  MKT: "a0000000-0000-0000-0000-000000000002", // Marketing: ver y editar
  VER: "a0000000-0000-0000-0000-000000000003", // Marketing: solo ver
  OTRA: "a0000000-0000-0000-0000-000000000004", // Reservas: ver y editar
  BLOQ: "a0000000-0000-0000-0000-000000000005", // Marketing: ver y editar, pero bloqueado
  BAJA: "a0000000-0000-0000-0000-000000000006", // Marketing: ver y editar; se le da de baja al final
};
const sesion = (u) => u.replace(/^a/, "b");
const DATOS = `
  insert into auth.users (id, email, banned_until) values
    ('${U.SA}', 'sa@t', null), ('${U.MKT}', 'mkt@t', null), ('${U.VER}', 'ver@t', null), ('${U.OTRA}', 'otra@t', null),
    ('${U.BLOQ}', 'bloq@t', now() + interval '1 day'), ('${U.BAJA}', 'baja@t', null);
  insert into auth.sessions (id, user_id) select ('b' || substr(id::text, 2))::uuid, id from auth.users;
  insert into public.super_admins values ('${U.SA}');
  insert into public.user_permissions values
    ('${U.MKT}', 'marketing', true, true), ('${U.VER}', 'marketing', true, false), ('${U.OTRA}', 'reservas', true, true),
    ('${U.BLOQ}', 'marketing', true, true), ('${U.BAJA}', 'marketing', true, true);
`;
const TABLAS = ["newsletter_ia_peticiones", "newsletter_plantillas"];
const LISTAR = "select tablename from pg_tables where schemaname = 'public' and tablename in ('newsletter_plantillas', 'newsletter_ia_peticiones') order by 1";
const BLOQUES = JSON.stringify([{ tipo: "texto", texto: "Hola" }, { tipo: "boton", texto: "Reservar", url: "https://restaurantecasatomascrevillente.es/reservas" }]);

// ─── 0. Sin can_edit_section se para sin crear nada ─────────────────────────
{
  const otra = new PGlite();
  await otra.exec(BASE + IA);
  await falla(otra.exec(MIGRACION), /faltan can_read_section \/ can_edit_section/, "no se paró sin can_edit_section");
  await otra.exec("rollback");
  igual((await otra.query(`select to_regclass('public.newsletter_plantillas') t, (select count(*)::int from public.ia_funciones) ia`)).rows[0],
    { t: null, ia: 0 }, "la migración abortada dejó la tabla o la fila de ia_funciones");
  await otra.close();
}

// ─── 1. Sin ia_funciones, auditoría ni sesión de panel también se aplica ────
{
  const otra = new PGlite();
  await otra.exec(BASE + CAN_EDIT);
  await otra.exec(MIGRACION);
  igual((await otra.query(LISTAR)).rows.map((r) => r.tablename), TABLAS, "sin los opcionales no creó las tablas");
  await otra.close();
}

const db = new PGlite();
await db.exec(BASE + SESION + AUDITORIA + CAN_EDIT + IA);
await db.exec(DATOS);
await db.exec(PRIVILEGIOS_SUPABASE);
// Una fila ya cambiada a mano: la migración no la pisa.
await db.exec(`insert into public.ia_funciones (funcion, descripcion, instrumentada, unidad, orden) values ('newsletter-ia', 'a mano', true, 'propuesta', 1)`);
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
const DIA = "(date_trunc('day', now() at time zone 'Europe/Madrid') at time zone 'Europe/Madrid')";

// ─── 2. Estructura ──────────────────────────────────────────────────────────
{
  igual((await q(LISTAR)).rows.map((r) => r.tablename), TABLAS, "faltan tablas");
  igual(await n(`select count(*)::int n from pg_class where relname = any($1) and relrowsecurity`, [TABLAS]), 2, "alguna tabla sin RLS");
  igual(await n(`select count(*)::int n from pg_policies where tablename = any($1) and policyname = 'acceso_panel_no_bloqueado' and permissive = 'RESTRICTIVE'`, [TABLAS]),
    2, "falta la política restrictiva de sesión de panel");
  igual(await n(`select count(*)::int n from unnest($1::text[]) t where has_table_privilege('anon', 'public.' || t, 'SELECT')
      or has_table_privilege('anon', 'public.' || t, 'INSERT') or has_table_privilege('anon', 'public.' || t, 'UPDATE')
      or has_table_privilege('anon', 'public.' || t, 'DELETE')`, [TABLAS]), 0, "anon conserva privilegios");
  igual((await q(`select has_table_privilege('authenticated', 'public.newsletter_ia_peticiones', 'UPDATE') upd,
      has_table_privilege('authenticated', 'public.newsletter_ia_peticiones', 'DELETE') del`)).rows[0],
    { upd: false, del: false }, "authenticated puede cambiar o borrar peticiones a la IA");
  igual((await q(`select attname from pg_attribute where attrelid = 'public.newsletter_ia_peticiones'::regclass and attnum > 0 and not attisdropped
      and has_column_privilege('authenticated', attrelid, attnum, 'UPDATE')`)).rows.map((r) => r.attname), ["ok"], "columnas de peticiones que se pueden cambiar");
  ok((await q(`select prosrc from pg_proc where proname = 'newsletter_comprobar_cupo_ia'`)).rows[0].prosrc.includes("pg_advisory_xact_lock"),
    "el tope diario no tiene cerrojo");
  igual((await q(`select descripcion, instrumentada from public.ia_funciones where funcion = 'newsletter-ia'`)).rows,
    [{ descripcion: "a mano", instrumentada: true }], "la migración pisó la fila de ia_funciones");
  igual((await q(`select centralizado, modelo from public.ia_modelo_funcion where funcion = 'newsletter-ia'`)).rows,
    [{ centralizado: true, modelo: null }], "falta newsletter-ia en ia_modelo_funcion (con el modelo del código)");
}

// ─── 3. RLS de las plantillas ───────────────────────────────────────────────
const INSERTAR = `insert into public.newsletter_plantillas (nombre, tipo, titulo, bloques, origen, creado_por, created_at)
  values ($1, 'evento', 'Cena de San Valentín', $2::jsonb, 'ia', '${U.SA}', now() - interval '30 days') returning id, creado_por, created_at > now() - interval '1 minute' reciente`;
let id;
{
  const [fila] = await filas(U.MKT, INSERTAR, ["San Valentín", BLOQUES]);
  id = fila.id;
  igual(fila.creado_por, U.MKT, "creado_por no lo puso el servidor");
  igual(fila.reciente, true, "created_at no lo puso el servidor");

  igual((await filas(U.VER, "select nombre from public.newsletter_plantillas")).map((r) => r.nombre), ["San Valentín"], "con «Ver» no se leen");
  await falla(filas(U.VER, INSERTAR, ["x", BLOQUES]), /row-level security/, "con «Ver» se pudo crear");
  igual((await filas(U.VER, "update public.newsletter_plantillas set nombre = 'x' returning id")).length, 0, "con «Ver» se pudo cambiar");
  igual((await filas(U.VER, "delete from public.newsletter_plantillas returning id")).length, 0, "con «Ver» se pudo borrar");
  igual((await filas(U.OTRA, "select id from public.newsletter_plantillas")).length, 0, "otra sección lee las plantillas");
  igual((await filas(U.BLOQ, "select id from public.newsletter_plantillas")).length, 0, "un usuario bloqueado lee las plantillas");
  igual((await como(U.MKT, async () => (await q("select id from public.newsletter_plantillas")).rows, "authenticated", "b0000000-0000-0000-0000-00000000dead")).length, 0,
    "una sesión inexistente lee las plantillas");
  await falla(filas(null, "select id from public.newsletter_plantillas", [], "anon"), /permission denied/, "anon lee las plantillas");

  // Cambiar: el autor y la fecha de creación no cambian; updated_at sí.
  const [cambiada] = await filas(U.SA, `update public.newsletter_plantillas set nombre = 'San Valentín 2027', creado_por = '${U.SA}', created_at = now() - interval '9 days'
      where id = $1 returning nombre, creado_por, created_at > now() - interval '1 minute' reciente, updated_at >= created_at actualizada`, [id]);
  igual(cambiada, { nombre: "San Valentín 2027", creado_por: U.MKT, reciente: true, actualizada: true }, "al cambiar, se pudo tocar el autor o la fecha");
}

// ─── 4. CHECK ───────────────────────────────────────────────────────────────
{
  const mal = (sql, msg) => falla(filas(U.MKT, sql), /violates check constraint/, msg);
  await mal(`insert into public.newsletter_plantillas (nombre, bloques) values ('   ', '[{"tipo":"texto","texto":"a"}]')`, "nombre vacío aceptado");
  await mal(`insert into public.newsletter_plantillas (nombre, bloques) values ('${"x".repeat(81)}', '[{"tipo":"texto","texto":"a"}]')`, "nombre largo aceptado");
  await mal(`insert into public.newsletter_plantillas (nombre, tipo, bloques) values ('a', 'spam', '[{"tipo":"texto","texto":"a"}]')`, "tipo desconocido aceptado");
  await mal(`insert into public.newsletter_plantillas (nombre, bloques) values ('a', '[]')`, "bloques vacíos aceptados");
  await mal(`insert into public.newsletter_plantillas (nombre, bloques) values ('a', '{"tipo":"texto"}')`, "bloques que no son lista aceptados");
  await mal(`insert into public.newsletter_plantillas (nombre, bloques) values ('a', (select jsonb_agg('{"tipo":"separador"}'::jsonb) from generate_series(1, 21)))`,
    "más de 20 bloques aceptados");
  await mal(`insert into public.newsletter_plantillas (nombre, origen, bloques) values ('a', 'otro', '[{"tipo":"separador"}]')`, "origen desconocido aceptado");
  const [porDefecto] = await filas(U.MKT, `insert into public.newsletter_plantillas (nombre, bloques) values ('Mínima', '[{"tipo":"separador"}]')
      returning tipo, origen, titulo, insignia, preheader, descripcion`);
  igual(porDefecto, { tipo: "personalizada", origen: "manual", titulo: "", insignia: "", preheader: "", descripcion: "" }, "valores por defecto");
  igual((await filas(U.MKT, "delete from public.newsletter_plantillas where nombre = 'Mínima' returning id")).length, 1, "con «Editar» no se pudo borrar");
}

// ─── 5. Tope diario de la IA ────────────────────────────────────────────────
{
  const pedir = (u) => filas(u, `insert into public.newsletter_ia_peticiones (modelo, ok, creado_por, created_at)
      values ('gpt-5.6-luna', true, '${U.SA}', now() - interval '3 days') returning id, creado_por, ok, created_at > now() - interval '1 minute' reciente`);
  const [p] = await pedir(U.MKT);
  igual({ creado_por: p.creado_por, ok: p.ok, reciente: p.reciente }, { creado_por: U.MKT, ok: null, reciente: true },
    "la petición no la fechó ni firmó el servidor");
  await falla(pedir(U.VER), /row-level security/, "con «Ver» se pudo pedir a la IA");
  // Lo de ayer no cuenta (se mete como servicio, saltándose el disparador).
  await db.exec(`alter table public.newsletter_ia_peticiones disable trigger newsletter_ia_peticiones_cupo;
    insert into public.newsletter_ia_peticiones (modelo, creado_por, created_at)
      select 'x', '${U.MKT}', ${DIA} - interval '1 second' from generate_series(1, 50);
    alter table public.newsletter_ia_peticiones enable trigger newsletter_ia_peticiones_cupo;`);
  for (let i = 1; i < 40; i++) await pedir(U.MKT);
  igual(await n(`select count(*)::int n from public.newsletter_ia_peticiones where creado_por = '${U.MKT}' and created_at >= ${DIA}`), 40, "no llegó a 40 hoy");
  await falla(pedir(U.MKT), /newsletter_cupo_ia/, "se pasó del tope de 40");
  await pedir(U.SA); // el tope es por usuario
  comprobaciones++;

  // Solo «ok», y solo las suyas.
  igual((await filas(U.MKT, `update public.newsletter_ia_peticiones set ok = true where id = $1 returning ok`, [p.id])), [{ ok: true }], "no pudo marcar su petición");
  await falla(filas(U.MKT, `update public.newsletter_ia_peticiones set modelo = 'x' where id = $1 returning id`, [p.id]), /permission denied/, "pudo cambiar el modelo");
  igual((await filas(U.SA, `update public.newsletter_ia_peticiones set ok = false where id = $1 returning id`, [p.id])).length, 0, "marcó una petición ajena");
  await falla(filas(U.MKT, `delete from public.newsletter_ia_peticiones where id = $1`, [p.id]), /permission denied/, "pudo borrar una petición");
}

// ─── 6. Auditoría y baja de usuario ─────────────────────────────────────────
{
  igual((await q(`select accion from public.audit_log where tabla = 'newsletter_plantillas' order by id`)).rows.map((r) => r.accion),
    ["insert", "update", "insert", "delete"], "la auditoría no registra las plantillas");
  igual(await n(`select count(*)::int n from public.audit_log where tabla = 'newsletter_ia_peticiones'`), 0, "las peticiones a la IA llenan la auditoría");
  await filas(U.BAJA, INSERTAR, ["De quien se va", BLOQUES]);
  await filas(U.BAJA, `insert into public.newsletter_ia_peticiones (modelo) values ('x') returning id`);
  await q(`delete from auth.users where id = '${U.BAJA}'`);
  igual((await q(`select creado_por from public.newsletter_plantillas where nombre = 'De quien se va'`)).rows, [{ creado_por: null }],
    "la plantilla de un usuario dado de baja no quedó sin autor");
  igual(await n(`select count(*)::int n from public.newsletter_ia_peticiones where creado_por = '${U.BAJA}'`), 0, "quedaron peticiones de un usuario dado de baja");
}

// ─── 7. Rollback y nueva aplicación ─────────────────────────────────────────
{
  await db.exec(ROLLBACK);
  igual((await q(LISTAR)).rows, [], "el rollback dejó tablas");
  igual((await q(`select count(*)::int n from pg_proc where proname in ('newsletter_comprobar_cupo_ia', 'newsletter_plantillas_fijar_autor')`)).rows[0].n, 0,
    "el rollback dejó funciones");
  igual(await n(`select count(*)::int n from public.ia_funciones where funcion = 'newsletter-ia'`), 0, "el rollback dejó la fila de ia_funciones");
  await db.exec(ROLLBACK); // idempotente
  await db.exec(MIGRACION);
  igual((await q(LISTAR)).rows.map((r) => r.tablename), TABLAS, "no se pudo volver a aplicar después del rollback");
  igual((await q(`select instrumentada from public.ia_funciones where funcion = 'newsletter-ia'`)).rows, [{ instrumentada: false }],
    "al volver a aplicar, newsletter-ia no quedó sin instrumentar");
}

await db.close();
console.log(`newsletter_plantillas: ${comprobaciones} comprobaciones correctas`);
