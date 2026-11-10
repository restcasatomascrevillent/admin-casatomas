// Reseñas · contestador con IA y conexión con Google Business Profile
// (20261122143000_resenas_contestador.sql y 20261122143100_resenas_cron.sql)
// contra un Postgres en memoria (PGlite), con las migraciones REALES. Nunca
// toca Supabase.
//
//   npm run test:resenas:db
//
// Cubre: se para si falta `resenas`; idempotente (dos veces, sin pisar los
// ajustes editados); las respuestas que ya había cuentan como publicadas;
// CHECK del estado, el origen, el largo (4.096, límite de Google), el enlace
// https y el nombre único de Business Profile; `anon` sigue sin ver las
// columnas nuevas (la web pública no cambia); ajustes: una sola fila, solo
// super admin (y con sesión de panel viva), solo las preferencias se cambian
// desde el navegador (no la ficha conectada), estrellas 1-5 y quién lo
// cambió; el token de Google ni siquiera lo lee un super admin (solo la
// service role); alta en Gasto IA instrumentada; auditoría de los ajustes;
// el cron (falla sin secretos, programa sin URL en duro y su rollback) y el
// rollback principal, con nueva aplicación después.
import { PGlite } from "@electric-sql/pglite";
import { readFile } from "node:fs/promises";
import assert from "node:assert/strict";

const MIGRACION = await readFile("supabase/migrations/20261122143000_resenas_contestador.sql", "utf8");
const ROLLBACK = await readFile("supabase/rollbacks/20261122143000_resenas_contestador_ROLLBACK.sql", "utf8");
const CRON = await readFile("supabase/migrations/20261122143100_resenas_cron.sql", "utf8");
const CRON_ROLLBACK = await readFile("supabase/rollbacks/20261122143100_resenas_cron_ROLLBACK.sql", "utf8");

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
  alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
  alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;

  create table public.super_admins (user_id uuid primary key);
  create function public.is_super_admin(_user_id uuid) returns boolean language sql stable security definer set search_path = public
    as $f$ select exists (select 1 from public.super_admins where user_id = _user_id) $f$;
  create function private.sesion_panel_permitida() returns boolean language sql stable security definer set search_path = '' as $f$
    select auth.uid() is not null and exists (
      select 1 from auth.users u where u.id = auth.uid() and (u.banned_until is null or u.banned_until <= now())
        and exists (select 1 from auth.sessions s where s.user_id = u.id and s.id::text = auth.jwt()->>'session_id')) $f$;
  revoke all on function private.sesion_panel_permitida() from public;
  grant execute on function private.sesion_panel_permitida() to authenticated;

  create table public.audit_log (id bigserial primary key, tabla text, accion text, actor uuid);
  create function public.fn_registrar_auditoria() returns trigger language plpgsql security definer set search_path = public as $f$
  begin
    insert into public.audit_log (tabla, accion, actor) values (TG_TABLE_NAME, lower(TG_OP), auth.uid());
    if TG_OP = 'DELETE' then return old; end if; return new;
  end $f$;
`;
// resenas como en producción (20251124064529 + 20251124065322 + 20260923100000).
const RESENAS = `
  create table public.resenas (
    id uuid primary key default gen_random_uuid(), nombre_cliente text not null, email text,
    valoracion integer not null check (valoracion >= 1 and valoracion <= 5), comentario text,
    fuente text default 'web', fecha date not null default current_date,
    estado text default 'publicada' check (estado in ('publicada', 'pendiente', 'oculta')),
    created_at timestamptz default now(), updated_at timestamptz default now(),
    google_review_id text, google_rating numeric, respuesta text, fecha_respuesta timestamptz);
  alter table public.resenas enable row level security;
  create policy resenas_superadmin on public.resenas for all to authenticated
    using ((select public.is_super_admin((select auth.uid())))) with check ((select public.is_super_admin((select auth.uid()))));
  create policy "Público puede ver reseñas publicadas" on public.resenas for select to anon using (estado = 'publicada');
  revoke all on public.resenas from anon;
  grant select (id, nombre_cliente, comentario, valoracion, fecha, estado, google_rating) on public.resenas to anon;
  insert into public.resenas (nombre_cliente, valoracion, comentario, fuente, fecha, respuesta) values
    ('Con respuesta', 5, 'Bien', 'google', '2026-10-01', 'Gracias'),
    ('Sin respuesta', 4, 'Normal', 'google', '2026-10-02', null),
    ('Respuesta vacía', 3, null, 'google', '2026-10-03', '  ');
`;
const IA = `
  create table public.ia_funciones (funcion text primary key, descripcion text not null,
    instrumentada boolean not null default false, unidad text not null default 'llamada',
    orden integer not null default 100, activo boolean not null default true);
  create table public.ia_modelo_funcion (funcion text primary key references public.ia_funciones(funcion) on delete restrict,
    modelo text, modelo_respaldo text, modelo_codigo text, centralizado boolean not null default false);
`;
const CRON_Y_VAULT = `
  create schema cron; create schema vault;
  create table cron.job (jobid bigserial primary key, jobname text unique, schedule text, command text, active boolean default true);
  create function cron.schedule(_nombre text, _cuando text, _comando text) returns bigint language plpgsql as $f$
  declare v bigint;
  begin
    insert into cron.job (jobname, schedule, command) values (_nombre, _cuando, _comando)
      on conflict (jobname) do update set schedule = excluded.schedule, command = excluded.command returning jobid into v;
    return v;
  end $f$;
  create function cron.unschedule(_nombre text) returns boolean language plpgsql as $f$
  begin delete from cron.job where jobname = _nombre; return found; end $f$;
  create table vault.decrypted_secrets (name text primary key, decrypted_secret text);
`;

const U = {
  SA: "a0000000-0000-0000-0000-000000000001",
  STAFF: "a0000000-0000-0000-0000-000000000002",
  BLOQ: "a0000000-0000-0000-0000-000000000003", // super admin bloqueado
};
const sesion = (u) => u.replace(/^a/, "b");
const USUARIOS = `
  insert into auth.users (id, email, banned_until) values
    ('${U.SA}', 'sa@x', null), ('${U.STAFF}', 'staff@x', null), ('${U.BLOQ}', 'bloq@x', now() + interval '1 day');
  insert into auth.sessions (id, user_id) values ('${sesion(U.SA)}', '${U.SA}'), ('${sesion(U.STAFF)}', '${U.STAFF}'), ('${sesion(U.BLOQ)}', '${U.BLOQ}');
  insert into public.super_admins values ('${U.SA}'), ('${U.BLOQ}');
`;

// ─── 1. Sin la tabla resenas se para sin dejar nada ─────────────────────────
{
  const otra = new PGlite();
  await otra.exec(BASE);
  await falla(otra.exec(MIGRACION), /falta la tabla resenas/, "no se paró sin resenas");
  await otra.exec("rollback");
  ok(!(await otra.query("select to_regclass('public.resenas_ajustes') is not null t")).rows[0].t, "dejó resenas_ajustes a medias");
  await otra.close();
}

const db = new PGlite();
await db.exec(BASE + RESENAS + IA + USUARIOS);
const q = (sql, params) => db.query(sql, params);
const n = async (sql, params) => (await q(sql, params)).rows[0].n;

async function como(u, fn, rol = "authenticated") {
  await db.exec("begin");
  try {
    if (rol === "anon") await db.exec(`set local role anon; select set_config('request.jwt.claims', '{"role":"anon"}', true);`);
    else if (rol === "service_role") await db.exec(`set local role service_role; select set_config('request.jwt.claims', '{"role":"service_role"}', true);`);
    else {
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
const filas = (u, sql, params, rol) => como(u, async () => (await q(sql, params)).rows, rol);

// ─── 2. Se aplica, y dos veces sin pisar lo editado ─────────────────────────
await db.exec(MIGRACION);
await q("update public.resenas_ajustes set firma = 'Tomás y familia', autorespuesta_activa = true");
await db.exec(MIGRACION);
igual(await n("select count(*)::int n from public.resenas_ajustes"), 1, "una sola fila de ajustes");
igual((await q("select firma, autorespuesta_activa from public.resenas_ajustes")).rows[0], { firma: "Tomás y familia", autorespuesta_activa: true }, "la segunda aplicación pisó los ajustes");
await q("update public.resenas_ajustes set firma = 'El equipo de Casa Tomás', autorespuesta_activa = false");

// Valores por defecto: proponer sí, publicar solas NO.
{
  const a = (await q("select proponer_automatico, autorespuesta_activa, autorespuesta_estrellas, autorespuesta_sin_texto from public.resenas_ajustes")).rows[0];
  igual(a, { proponer_automatico: true, autorespuesta_activa: false, autorespuesta_estrellas: [4, 5], autorespuesta_sin_texto: true }, "valores por defecto");
}

// ─── 3. Columnas de resenas, relleno y CHECK ────────────────────────────────
{
  const r = (await q("select nombre_cliente, respuesta_estado, respuesta_origen from public.resenas order by fecha")).rows;
  igual(r, [
    { nombre_cliente: "Con respuesta", respuesta_estado: "publicada", respuesta_origen: "google" },
    { nombre_cliente: "Sin respuesta", respuesta_estado: "pendiente", respuesta_origen: null },
    { nombre_cliente: "Respuesta vacía", respuesta_estado: "pendiente", respuesta_origen: null },
  ], "las respuestas ya existentes no cuentan como publicadas");
  await falla(q("update public.resenas set respuesta_estado = 'enviada'"), /resenas_respuesta_estado_check/, "estado inventado");
  await falla(q("update public.resenas set respuesta_origen = 'robot'"), /resenas_respuesta_origen_check/, "origen inventado");
  await falla(q("update public.resenas set respuesta_propuesta = repeat('x', 4097)"), /resenas_respuesta_propuesta_largo/, "más de 4.096 caracteres");
  await q("update public.resenas set respuesta_propuesta = repeat('x', 4096) where nombre_cliente = 'Sin respuesta'");
  await falla(q("update public.resenas set google_maps_uri = 'javascript:alert(1)'"), /resenas_google_maps_uri_https/, "enlace no https");
  await falla(q("update public.resenas set respuesta_intentos = -1"), /no_negativo/, "intentos negativos");
  await q("update public.resenas set gbp_review_name = 'accounts/1/locations/2/reviews/a' where nombre_cliente = 'Sin respuesta'");
  await falla(q("update public.resenas set gbp_review_name = 'accounts/1/locations/2/reviews/a' where nombre_cliente = 'Con respuesta'"), /resenas_gbp_review_name_unico/, "el nombre de Business Profile no es único");
  await falla(q("update public.resenas set respuesta_estado = null"), /null/, "respuesta_estado admite NULL");
}

// ─── 4. La web pública no ve nada nuevo ─────────────────────────────────────
{
  igual((await filas(null, "select id, nombre_cliente, comentario, valoracion, fecha, estado, google_rating from public.resenas", [], "anon")).length, 3, "anon dejó de leer lo de siempre");
  await falla(filas(null, "select respuesta_propuesta from public.resenas", [], "anon"), /permission denied/, "anon ve los borradores");
  await falla(filas(null, "select respuesta from public.resenas", [], "anon"), /permission denied/, "anon ve las respuestas");
  await falla(filas(null, "select * from public.resenas_ajustes", [], "anon"), /permission denied/, "anon ve los ajustes");
}

// ─── 5. Ajustes: solo super admin, solo preferencias ────────────────────────
{
  igual((await filas(U.SA, "select firma from public.resenas_ajustes")).length, 1, "el super admin no lee los ajustes");
  igual((await filas(U.STAFF, "select firma from public.resenas_ajustes")).length, 0, "un usuario normal lee los ajustes");
  igual((await filas(U.BLOQ, "select firma from public.resenas_ajustes")).length, 0, "un super admin bloqueado lee los ajustes");
  await como(U.SA, () => q("update public.resenas_ajustes set autorespuesta_activa = true, autorespuesta_estrellas = '{5}', firma = 'Tomás', indicaciones = 'Breve', proponer_automatico = false, autorespuesta_sin_texto = false"));
  const a = (await q("select autorespuesta_activa, autorespuesta_estrellas, firma, updated_by from public.resenas_ajustes")).rows[0];
  igual(a, { autorespuesta_activa: true, autorespuesta_estrellas: [5], firma: "Tomás", updated_by: U.SA }, "el super admin no pudo cambiar sus preferencias");
  igual(await n("select count(*)::int n from public.audit_log where tabla = 'resenas_ajustes' and actor = $1", [U.SA]), 1, "el cambio de ajustes no quedó auditado");
  await falla(como(U.SA, () => q("update public.resenas_ajustes set gbp_ubicacion = 'accounts/9/locations/9'")), /permission denied/, "el navegador cambia la ficha conectada");
  await falla(como(U.SA, () => q("update public.resenas_ajustes set ultimo_ciclo = now()")), /permission denied/, "el navegador cambia el resumen del ciclo");
  await falla(como(U.SA, () => q("insert into public.resenas_ajustes (id) values (true)")), /permission denied/, "el navegador inserta ajustes");
  await falla(como(U.SA, () => q("delete from public.resenas_ajustes")), /permission denied/, "el navegador borra los ajustes");
  await falla(como(U.SA, () => q("update public.resenas_ajustes set autorespuesta_estrellas = '{0,6}'")), /resenas_ajustes_estrellas_validas/, "estrellas fuera de 1-5");
  await falla(como(U.SA, () => q("update public.resenas_ajustes set firma = repeat('x', 121)")), /check/, "firma demasiado larga");
  igual(await como(U.STAFF, async () => (await q("update public.resenas_ajustes set autorespuesta_activa = false")).affectedRows), 0, "un usuario normal cambia los ajustes");
  await falla(q("update public.resenas_ajustes set gbp_ubicacion = 'cualquier cosa'"), /resenas_ajustes_ubicacion_formato/, "ficha con formato raro");
  await falla(q("insert into public.resenas_ajustes (id) values (false)"), /check/, "una segunda fila de ajustes");
  await q("update public.resenas_ajustes set autorespuesta_activa = false, proponer_automatico = true, autorespuesta_estrellas = '{4,5}', firma = 'El equipo de Casa Tomás'");
}

// ─── 6. Token de Google: solo la service role ───────────────────────────────
{
  await como(null, () => q("insert into public.resenas_google_token (refresh_token, email) values ('RT-secreto', 'x@x')"), "service_role");
  igual((await filas(null, "select refresh_token from public.resenas_google_token", [], "service_role")).length, 1, "la service role no lee el token");
  await falla(filas(U.SA, "select refresh_token from public.resenas_google_token"), /permission denied/, "un super admin lee el token");
  await falla(filas(null, "select refresh_token from public.resenas_google_token", [], "anon"), /permission denied/, "anon lee el token");
  await falla(como(U.SA, () => q("delete from public.resenas_google_token")), /permission denied/, "un super admin borra el token");
  await falla(q("insert into public.resenas_google_token (id, refresh_token) values (false, 'x')"), /check/, "un segundo token");
}

// ─── 7. Gasto IA ────────────────────────────────────────────────────────────
igual((await q("select instrumentada, unidad from public.ia_funciones where funcion = 'resenas-contestador'")).rows, [{ instrumentada: true, unidad: "respuesta" }], "alta en ia_funciones");
igual((await q("select centralizado from public.ia_modelo_funcion where funcion = 'resenas-contestador'")).rows, [{ centralizado: true }], "alta en ia_modelo_funcion");

// ─── 8. Cron ────────────────────────────────────────────────────────────────
{
  await db.exec(CRON_Y_VAULT);
  await falla(db.exec(CRON), /resenas_cron_secret/, "el cron se programó sin su secreto");
  await db.exec("rollback");
  await q("insert into vault.decrypted_secrets values ('resenas_cron_secret', 's')");
  await falla(db.exec(CRON), /project_url/, "el cron se programó sin project_url");
  await db.exec("rollback");
  igual(await n("select count(*)::int n from cron.job"), 0, "un cron fallido dejó un job");
  await q("insert into vault.decrypted_secrets values ('project_url', 'https://abcdefgh.supabase.co')");
  await db.exec(CRON);
  await db.exec(CRON);
  const jobs = (await q("select schedule, command from cron.job where jobname = 'resenas-ciclo'")).rows;
  igual(jobs.length, 1, "el cron no quedó programado una sola vez");
  igual(jobs[0].schedule, "10 8,20 * * *", "horario del cron");
  ok(jobs[0].command.includes("/functions/v1/resenas-contestador"), "el cron no llama a resenas-contestador");
  ok(jobs[0].command.includes(`'{"accion":"ciclo","origen":"cron"}'`), "el cron no pide el ciclo");
  ok(jobs[0].command.includes("'resenas_cron_secret'") && jobs[0].command.includes("'x-webhook-secret'"), "el cron no lleva el secreto de Vault");
  ok(!/supabase\.co/.test(jobs[0].command), "el cron lleva una URL de proyecto en duro");
  await db.exec(CRON_ROLLBACK);
  igual(await n("select count(*)::int n from cron.job where jobname = 'resenas-ciclo'"), 0, "el rollback no quitó el cron");
}

// ─── 9. Rollback y nueva aplicación ─────────────────────────────────────────
{
  await db.exec(ROLLBACK);
  ok(!(await q("select to_regclass('public.resenas_ajustes') is not null t")).rows[0].t, "el rollback no quitó resenas_ajustes");
  ok(!(await q("select to_regclass('public.resenas_google_token') is not null t")).rows[0].t, "el rollback no quitó el token");
  igual(await n("select count(*)::int n from information_schema.columns where table_name = 'resenas' and column_name like 'respuesta\\_%' and column_name <> 'respuesta'"), 0, "el rollback dejó columnas del contestador");
  igual(await n("select count(*)::int n from public.resenas where respuesta = 'Gracias'"), 1, "el rollback perdió las respuestas");
  igual(await n("select count(*)::int n from public.ia_funciones where funcion = 'resenas-contestador'"), 0, "el rollback dejó el alta en Gasto IA");
  await db.exec(MIGRACION);
  igual(await n("select count(*)::int n from public.resenas where respuesta_estado = 'publicada'"), 1, "no se pudo volver a aplicar");
}

await db.close();
console.log(`✓ Reseñas · contestador: ${comprobaciones} comprobaciones`);
