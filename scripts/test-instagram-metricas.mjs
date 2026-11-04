// Métricas de Instagram (20261106100000_instagram_metricas.sql) contra un
// Postgres en memoria (PGlite), con la migración REAL. Nunca toca Supabase.
//
//   npm run test:instagram-metricas:db
//
// Cubre: se para sin instagram_piezas; idempotente; RLS (marketing lee,
// otra sección no, anon nada, sesión bloqueada no; NADIE autenticado escribe;
// service_role sí); únicos fecha+cuenta y media+fecha; CHECK; vista de la
// última captura con la RLS del que llama; enlace a instagram_piezas (on
// delete set null); cron: sin pg_cron no se programa, con pg_cron se programa
// una vez, el comando saca URL y secreto de Vault y no lleva valores en duro;
// y el rollback (quita el cron y las tablas).
import { PGlite } from "@electric-sql/pglite";
import { readFile } from "node:fs/promises";
import assert from "node:assert/strict";

const MIG_INSTAGRAM = await readFile("supabase/migrations/20261105090000_instagram.sql", "utf8");
const MIGRACION = await readFile("supabase/migrations/20261106100000_instagram_metricas.sql", "utf8");
const ROLLBACK = await readFile("supabase/rollbacks/20261106100000_instagram_metricas_ROLLBACK.sql", "utf8");

let comprobaciones = 0;
const ok = (v, msg) => { assert.ok(v, msg); comprobaciones++; };
const igual = (a, b, msg) => { assert.deepEqual(a, b, msg); comprobaciones++; };
const falla = async (p, re, msg) => { await assert.rejects(p, re, msg); comprobaciones++; };

// Andamiaje mínimo de Supabase (el mismo que scripts/test-instagram.mjs).
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
const ANDAMIAJE = `
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
  ${STORAGE}
`;

// pg_cron y Vault simulados: lo justo para ver qué programa la migración.
const CRON_Y_VAULT = `
  create schema cron; create schema vault;
  create table cron.job (jobid bigserial primary key, jobname text unique, schedule text, command text, active boolean default true);
  create function cron.schedule(_nombre text, _cuando text, _comando text) returns bigint language plpgsql as $f$
  declare v bigint;
  begin
    insert into cron.job (jobname, schedule, command) values (_nombre, _cuando, _comando)
      on conflict (jobname) do update set schedule = excluded.schedule, command = excluded.command
      returning jobid into v;
    return v;
  end $f$;
  create function cron.unschedule(_nombre text) returns boolean language plpgsql as $f$
  begin delete from cron.job where jobname = _nombre; return found; end $f$;
  create table vault.decrypted_secrets (name text primary key, decrypted_secret text);
`;

const U = {
  SA: "a0000000-0000-0000-0000-000000000001",
  MKT: "a0000000-0000-0000-0000-000000000002",
  OTRA: "a0000000-0000-0000-0000-000000000003",
  BLOQ: "a0000000-0000-0000-0000-000000000004",
};
const sesion = (u) => u.replace(/^a/, "b");
const DATOS = `
  insert into auth.users (id, email, banned_until) values
    ('${U.SA}', 'sa@t', null), ('${U.MKT}', 'mkt@t', null), ('${U.OTRA}', 'otra@t', null),
    ('${U.BLOQ}', 'bloq@t', now() + interval '1 day');
  insert into auth.sessions (id, user_id) select ('b' || substr(id::text, 2))::uuid, id from auth.users;
  insert into public.super_admins values ('${U.SA}');
  insert into public.user_permissions values
    ('${U.MKT}', 'marketing', true, true), ('${U.OTRA}', 'reservas', true, true), ('${U.BLOQ}', 'marketing', true, true);
`;

// ─── 0. Sin instagram_piezas se para sin crear nada ─────────────────────────
{
  const otra = new PGlite();
  await otra.exec(ANDAMIAJE);
  await falla(otra.exec(MIGRACION), /instagram_metricas: falta public\.instagram_piezas/, "no se paró sin instagram_piezas");
  await otra.exec("rollback");
  igual((await otra.query("select to_regclass('public.instagram_metricas_cuenta') t")).rows[0].t, null, "la migración abortada dejó tablas");
  await otra.close();
}

// ─── 1. Sin pg_cron: crea las tablas y no programa nada ─────────────────────
{
  const otra = new PGlite();
  await otra.exec(ANDAMIAJE);
  await otra.exec(MIG_INSTAGRAM);
  await otra.exec(MIGRACION);
  ok((await otra.query("select to_regclass('public.instagram_metricas_cuenta') is not null t")).rows[0].t, "sin pg_cron no creó las tablas");
  await otra.close();
}

const db = new PGlite();
await db.exec(ANDAMIAJE);
await db.exec(CRON_Y_VAULT);
await db.exec(DATOS);
await db.exec(MIG_INSTAGRAM);
await db.exec(MIGRACION);
await db.exec(MIGRACION); // idempotente
comprobaciones++;

const q = (sql, params) => db.query(sql, params);
async function como(u, fn, rol = "authenticated") {
  await db.exec("begin");
  try {
    if (rol === "anon") {
      await db.exec(`set local role anon; select set_config('request.jwt.claims', '{"role":"anon"}', true);`);
    } else if (rol === "service_role") {
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

// ─── 2. Cron ────────────────────────────────────────────────────────────────
{
  const jobs = (await q("select jobname, schedule, command from cron.job where jobname = 'instagram-metricas-diarias'")).rows;
  igual(jobs.length, 1, "el cron no quedó programado una sola vez");
  igual(jobs[0].schedule, "0 5 * * *", "horario del cron");
  const c = jobs[0].command;
  ok(c.includes("/functions/v1/instagram-metricas"), "el cron no llama a instagram-metricas");
  ok(c.includes("'instagram_metricas_cron_secret'") && c.includes("'project_url'") && c.includes("'x-webhook-secret'"), "el cron no lee URL y secreto de Vault");
  ok(c.includes(`'{"accion":"capturar"}'`), "el cron no pide la acción capturar");
  ok(!/supabase\.co/.test(c), "el cron lleva una URL de proyecto en duro");
}

// ─── 3. Datos de ejemplo (service_role) ─────────────────────────────────────
const PIEZA = "3f2b8a52-6c1e-4d7a-9b0f-1a2b3c4d5e6f";
await q(`insert into public.instagram_piezas (id, marca, plantilla, formato, datos, estado, media_id)
  values ('${PIEZA}', 'casa-tomas', 'ct-foto-titular', 'post', '{"foto":"ct-salon-1"}', 'publicada', '1790000000000001')`);
await como(null, () => db.exec(`
  insert into public.instagram_metricas_cuenta (fecha, ig_user_id, seguidores, alcance, visualizaciones)
    values ('2026-11-01', '17841400000000001', 1000, 300, 900), ('2026-11-02', '17841400000000001', null, 320, 950);
  insert into public.instagram_metricas_publicacion (media_id, ig_user_id, fecha_captura, pieza_id, tipo_medio, producto, alcance, me_gusta)
    values ('1790000000000001', '17841400000000001', '2026-11-01', '${PIEZA}', 'IMAGE', 'FEED', 100, 10),
           ('1790000000000001', '17841400000000001', '2026-11-02', '${PIEZA}', 'IMAGE', 'FEED', 150, 14),
           ('1790000000000002', '17841400000000001', '2026-11-02', null, 'VIDEO', 'REELS', 400, 30);
  insert into public.instagram_metricas_capturas (origen, ok, dias, publicaciones) values ('cron', true, 3, 2);
`), "service_role");
comprobaciones++;

// Upsert por fecha + cuenta (lo que hace la función con on_conflict).
await como(null, () => db.exec(`
  insert into public.instagram_metricas_cuenta (fecha, ig_user_id, alcance) values ('2026-11-02', '17841400000000001', 330)
    on conflict (fecha, ig_user_id) do update set alcance = excluded.alcance;`), "service_role");
igual((await q("select alcance from public.instagram_metricas_cuenta where fecha = '2026-11-02'")).rows[0].alcance, 330, "upsert por fecha y cuenta");

// ─── 4. Únicos y CHECK ──────────────────────────────────────────────────────
await falla(q("insert into public.instagram_metricas_cuenta (fecha, ig_user_id) values ('2026-11-01', '17841400000000001')"), /duplicate key|unique/, "fecha+cuenta duplicada");
await falla(q("insert into public.instagram_metricas_publicacion (media_id, ig_user_id, fecha_captura) values ('1790000000000001', '17841400000000001', '2026-11-01')"), /duplicate key|unique/, "media+fecha duplicada");
await falla(q("insert into public.instagram_metricas_cuenta (fecha, ig_user_id) values ('2026-11-03', '@casatomas')"), /instagram_metricas_cuenta_ig_chk/, "ig_user_id no numérico");
await falla(q("insert into public.instagram_metricas_cuenta (fecha, ig_user_id, alcance) values ('2026-11-03', '1', -1)"), /no_negativos/, "alcance negativo");
await falla(q("insert into public.instagram_metricas_publicacion (media_id, ig_user_id, fecha_captura, producto) values ('1', '1', '2026-11-03', 'TIKTOK')"), /producto_chk/, "producto raro");
await falla(q("insert into public.instagram_metricas_capturas (origen) values ('alguien')"), /origen_chk/, "origen raro");

// ─── 5. RLS de lectura ──────────────────────────────────────────────────────
const cuenta = (u, rol) => como(u, async () => (await q("select count(*)::int n from public.instagram_metricas_cuenta")).rows[0].n, rol);
const ultima = (u) => como(u, async () => (await q("select media_id, alcance from public.instagram_metricas_publicacion_ultima order by media_id")).rows);
igual(await cuenta(U.MKT), 2, "marketing lee la cuenta");
igual(await cuenta(U.SA), 2, "el super admin lee la cuenta");
igual(await cuenta(U.OTRA), 0, "otra sección no lee");
igual(await cuenta(U.BLOQ), 0, "sesión bloqueada no lee");
await falla(cuenta(null, "anon"), /permission denied/, "anon lee");
igual(await ultima(U.MKT), [{ media_id: "1790000000000001", alcance: 150 }, { media_id: "1790000000000002", alcance: 400 }], "la vista da la última captura");
igual(await ultima(U.OTRA), [], "la vista respeta la RLS (security_invoker)");
igual(await como(U.MKT, async () => (await q("select count(*)::int n from public.instagram_metricas_capturas")).rows[0].n), 1, "marketing lee las capturas");

// ─── 6. Nadie autenticado escribe (ni el super admin) ───────────────────────
for (const u of [U.MKT, U.SA]) {
  await falla(como(u, () => q("insert into public.instagram_metricas_cuenta (fecha, ig_user_id) values ('2026-11-05', '1')")), /permission denied/, "un usuario inserta en la cuenta");
  await falla(como(u, () => q("update public.instagram_metricas_publicacion set alcance = 0")), /permission denied/, "un usuario edita publicaciones");
  await falla(como(u, () => q("delete from public.instagram_metricas_capturas")), /permission denied/, "un usuario borra capturas");
}

// ─── 7. Enlace a instagram_piezas: al borrar la pieza queda NULL ────────────
await q(`delete from public.instagram_piezas where id = '${PIEZA}'`);
igual((await q("select count(*)::int n from public.instagram_metricas_publicacion where pieza_id is not null")).rows[0].n, 0, "on delete set null");
igual((await q("select count(*)::int n from public.instagram_metricas_publicacion")).rows[0].n, 3, "borrar la pieza no borra métricas");

// ─── 8. Rollback ────────────────────────────────────────────────────────────
await db.exec(ROLLBACK);
igual((await q("select count(*)::int n from cron.job where jobname = 'instagram-metricas-diarias'")).rows[0].n, 0, "el rollback no quitó el cron");
igual((await q(`select to_regclass('public.instagram_metricas_cuenta') a, to_regclass('public.instagram_metricas_publicacion') b,
  to_regclass('public.instagram_metricas_capturas') c, to_regclass('public.instagram_metricas_publicacion_ultima') d`)).rows[0],
  { a: null, b: null, c: null, d: null }, "el rollback dejó tablas");
ok((await q("select to_regclass('public.instagram_piezas') is not null t")).rows[0].t, "el rollback borró instagram_piezas");
await db.exec(MIGRACION); // se puede volver a aplicar
comprobaciones++;

await db.close();
console.log(`test-instagram-metricas: ${comprobaciones} comprobaciones OK`);
