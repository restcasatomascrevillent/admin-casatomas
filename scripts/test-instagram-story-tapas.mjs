// Story automática del jueves de tapas contra un Postgres en memoria (PGlite)
// con las migraciones REALES (20261105090000_instagram,
// 20261106110000_instagram_programacion y 20261127090000_instagram_story_tapas).
// Nunca toca Supabase. El andamiaje es el de scripts/test-instagram-programar.mjs.
//
//   npm run test:instagram-story-tapas:db
//
// Cubre: se para si falta algo; idempotente; RLS (Marketing lee, otra sección
// no; nadie escribe la tabla sin RPC; ajustes solo con «Editar»); una por
// semana (reclamar → crear, mismas tapas → nada, otras tapas → regenerar,
// cerrojo de 3 min, publicada → nada nunca más, cancelada → nada salvo el
// botón manual); un solo aviso en la campana por semana; la fila sigue a la
// programación (cambiar hora, publicada); y el rollback.
import { PGlite } from "@electric-sql/pglite";
import { readFile } from "node:fs/promises";
import assert from "node:assert/strict";

const BASE = await readFile("supabase/migrations/20261105090000_instagram.sql", "utf8");
const MIGRACION = await readFile("supabase/migrations/20261106110000_instagram_programacion.sql", "utf8");
const TAPAS = await readFile("supabase/migrations/20261127090000_instagram_story_tapas.sql", "utf8");
const ROLLBACK = await readFile("supabase/rollbacks/20261127090000_instagram_story_tapas_ROLLBACK.sql", "utf8");

let comprobaciones = 0;
const ok = (v, msg) => { assert.ok(v, msg); comprobaciones++; };
const igual = (a, b, msg) => { assert.deepEqual(a, b, msg); comprobaciones++; };
const falla = async (p, re, msg) => { await assert.rejects(p, re, msg); comprobaciones++; };

// Andamiaje mínimo de Supabase (igual que scripts/test-instagram.mjs) + pg_cron,
// pg_net y Vault simulados.
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
const CRON_NET_VAULT = `
  create schema cron;
  create table cron.job (jobid bigserial primary key, jobname text unique, schedule text, command text, active boolean default true);
  create function cron.schedule(p_nombre text, p_horario text, p_orden text) returns bigint language sql as $f$
    insert into cron.job (jobname, schedule, command) values (p_nombre, p_horario, p_orden)
    on conflict (jobname) do update set schedule = excluded.schedule, command = excluded.command returning jobid $f$;
  create function cron.unschedule(p_nombre text) returns boolean language sql as $f$
    with b as (delete from cron.job where jobname = p_nombre returning 1) select exists (select 1 from b) $f$;
  create schema net;
  create table net.peticiones (id bigserial primary key, url text, headers jsonb, body jsonb, timeout_milliseconds int);
  create function net.http_post(url text, body jsonb default '{}', params jsonb default '{}', headers jsonb default '{}',
    timeout_milliseconds integer default 5000) returns bigint language sql as $f$
    insert into net.peticiones (url, headers, body, timeout_milliseconds) values (url, headers, body, timeout_milliseconds) returning id $f$;
  create schema vault;
  create table vault.decrypted_secrets (name text primary key, decrypted_secret text);
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
    as $f$ select public.has_section_permission((select auth.uid()), _section, 'view') $f$;
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

const U = {
  SA: "a0000000-0000-0000-0000-000000000001",
  MKT: "a0000000-0000-0000-0000-000000000002",
  OTRA: "a0000000-0000-0000-0000-000000000003",
  BLOQ: "a0000000-0000-0000-0000-000000000004",
  LECT: "a0000000-0000-0000-0000-000000000005",
};
const sesion = (u) => u.replace(/^a/, "b");
const DATOS = `
  insert into auth.users (id, email, banned_until) values
    ('${U.SA}', 'sa@t', null), ('${U.MKT}', 'mkt@t', null), ('${U.OTRA}', 'otra@t', null),
    ('${U.BLOQ}', 'bloq@t', now() + interval '1 day'), ('${U.LECT}', 'lect@t', null);
  insert into auth.sessions (id, user_id) select ('b' || substr(id::text, 2))::uuid, id from auth.users;
  insert into public.super_admins values ('${U.SA}');
  insert into public.user_permissions values
    ('${U.MKT}', 'marketing', true, true), ('${U.OTRA}', 'reservas', true, true), ('${U.BLOQ}', 'marketing', true, true);
`;


const EXTRA = `
  create function public.can_edit_section(_section text) returns boolean language sql stable security definer set search_path = public
    as $f$ select public.has_section_permission((select auth.uid()), _section, 'edit') $f$;
  grant execute on function public.can_edit_section(text) to authenticated, service_role;
  create table public.notificaciones_dashboard (id uuid primary key default gen_random_uuid(), tipo text not null, titulo text not null,
    mensaje text, referencia_id uuid, referencia_tipo text, leida boolean not null default false, created_at timestamptz default now(),
    clave text, datos jsonb);
  create unique index notificaciones_dashboard_clave_uq on public.notificaciones_dashboard (clave) where clave is not null;
  grant select, insert, update, delete on public.notificaciones_dashboard to authenticated;
`;

{
  const otra = new PGlite();
  await otra.exec(ANDAMIAJE + CRON_NET_VAULT + EXTRA);
  await falla(otra.exec(TAPAS), /instagram_story_tapas: faltan public\.instagram_piezas/, "no se paró sin instagram_piezas");
  await otra.close();
}

const db = new PGlite();
await db.exec(ANDAMIAJE + CRON_NET_VAULT + EXTRA);
await db.exec(DATOS);
await db.exec(BASE);
await db.exec(MIGRACION);
await db.exec(TAPAS);
await db.exec(TAPAS); // idempotente
comprobaciones++;
const q = (sql, params) => db.query(sql, params);

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
const rpc = async (u, sql, params) => (await como(u, () => q(sql, params))).rows[0]?.r;
const reclamar = (u, fecha, huella, manual = false) => rpc(u, "select public.instagram_story_tapas_reclamar($1, $2, $3) r", [fecha, huella, manual]);
const registrar = (u, semana, pieza, prog, huella, tapas = ["Gambón rebozado"]) =>
  rpc(u, "select public.instagram_story_tapas_registrar($1, $2, $3, $4, $5::jsonb, 'ct-tapas') r", [semana, pieza, prog, huella, JSON.stringify(tapas)]);
const enMin = (m) => new Date(Date.now() + m * 60_000).toISOString();
const ver = async (semana) => (await como(U.MKT, () => q("select public.instagram_story_tapas_ver($1) r", [semana]))).rows[0].r;

// Piezas: dos stories de Casa Tomás generadas.
const P1 = "c0000000-0000-4000-8000-000000000001";
const P2 = "c0000000-0000-4000-8000-000000000002";
for (const id of [P1, P2]) {
  await q(`insert into public.instagram_piezas (id, marca, plantilla, formato, caption, estado, imagen_ruta)
           values ($1, 'casa-tomas', 'ct-tapas', 'story', '', 'generada', $2)`, [id, `piezas/2026-11/${id}.jpg`]);
}

// ── RLS y permisos ──────────────────────────────────────────────────────────
igual((await como(U.MKT, () => q("select activa, hora::text as hora, plantilla from public.instagram_story_tapas_ajustes"))).rows,
  [{ activa: true, hora: "12:00:00", plantilla: "ct-tapas" }], "ajustes por defecto");
igual((await como(U.OTRA, () => q("select * from public.instagram_story_tapas_ajustes"))).rows.length, 0, "otra sección ve los ajustes");
await como(U.MKT, () => q("update public.instagram_story_tapas_ajustes set hora = '13:30', plantilla = 'ct-tapas-clasica', foto = 'drive:abc123'"));
igual((await q("select hora::text as hora, plantilla, foto, updated_by from public.instagram_story_tapas_ajustes")).rows[0],
  { hora: "13:30:00", plantilla: "ct-tapas-clasica", foto: "drive:abc123", updated_by: U.MKT }, "no guardó los ajustes");
await falla(como(U.MKT, () => q("update public.instagram_story_tapas_ajustes set plantilla = 'otra'")), /check/i, "admitió una plantilla rara");
await falla(como(U.MKT, () => q("insert into public.instagram_story_tapas (semana, fecha_tapas) values ('2026-11-09', '2026-11-12')")), /permission denied/i, "escribió la tabla sin RPC");
await falla(reclamar(U.OTRA, "2026-11-12", "h1"), /Sin permiso de Marketing/, "reclamó sin Marketing");
await falla(reclamar(U.BLOQ, "2026-11-12", "h1"), /Sesión de panel no válida/, "reclamó con la cuenta bloqueada");

// ── Una por semana ──────────────────────────────────────────────────────────
let r = await reclamar(U.MKT, "2026-11-12", "h1");
igual(r.accion, "crear", "la primera vez no crea");
igual(r.fila.semana, "2026-11-09", "la semana no es el lunes");
igual((await reclamar(U.MKT, "2026-11-12", "h1")).accion, "nada", "con el cerrojo puesto deja crear otra");
const prog1 = (await rpc(U.MKT, "select public.instagram_programar($1, $2, true) r", [P1, enMin(120)])).programacion.id;
r = await registrar(U.MKT, "2026-11-09", P1, prog1, "h1");
igual(r.fila.estado, "programada", "no quedó programada");
const aviso = (await q("select tipo, leida, datos->>'piezaId' as pieza, datos->>'programacionId' as prog from public.notificaciones_dashboard")).rows;
igual(aviso, [{ tipo: "instagram_story_tapas", leida: false, pieza: P1, prog: prog1 }], "aviso de la campana");
igual((await reclamar(U.MKT, "2026-11-11", "h1")).accion, "nada", "con las mismas tapas no debe hacer nada");
r = await reclamar(U.MKT, "2026-11-12", "h2");
igual(r.accion, "regenerar", "con otras tapas no regenera");
igual(r.fila.pieza_id, P1, "regenerar no da la misma pieza");
// El panel cancela, regenera la MISMA pieza y la vuelve a programar.
await rpc(U.MKT, "select public.instagram_cancelar_programacion($1) r", [prog1]);
igual((await ver("2026-11-09")).estado, "programada", "con el cerrojo, ver la dio por cancelada");
const prog2 = (await rpc(U.MKT, "select public.instagram_programar($1, $2, true) r", [P1, enMin(120)])).programacion.id;
await registrar(U.MKT, "2026-11-09", P1, prog2, "h2", ["Gambón", "Bravas"]);
igual(Number((await q("select count(*) as n from public.notificaciones_dashboard")).rows[0].n), 1, "más de un aviso para la misma semana");
await falla(registrar(U.MKT, "2026-11-09", P2, prog2, "h3"), /no es de esa pieza/, "registró una programación de otra pieza");
// Cambiar la hora desde el calendario: la fila lo refleja.
const nueva = enMin(300);
await rpc(U.MKT, "select public.instagram_reprogramar($1, $2, true) r", [prog2, nueva]);
igual(new Date((await ver("2026-11-09")).programada_para).toISOString(), nueva, "ver no recoge la hora nueva");
// Publicada (como lo haría el programador) → nada nunca más.
await q("update public.instagram_programaciones set estado = 'publicada', publicada_at = now() where id = $1", [prog2]);
await q("update public.instagram_piezas set estado = 'publicada', media_id = '17900000000000001' where id = $1", [P1]);
igual((await reclamar(U.MKT, "2026-11-12", "h9")).accion, "nada", "regeneró una publicada");
igual((await reclamar(U.MKT, "2026-11-12", "h9", true)).accion, "nada", "el manual rehízo una publicada");
igual((await q("select estado from public.instagram_story_tapas where semana = '2026-11-09'")).rows[0].estado, "publicada", "no quedó publicada");
await falla(registrar(U.MKT, "2026-11-09", P2, null, "h9"), /ya está publicada/, "registró otra pieza en una semana publicada");
await falla(rpc(U.MKT, "select public.instagram_story_tapas_cancelar('2026-11-09') r"), /Ya está publicada/, "canceló una publicada");

// ── Cancelada ───────────────────────────────────────────────────────────────
r = await reclamar(U.MKT, "2026-11-19", "x1");
igual([r.accion, r.fila.semana], ["crear", "2026-11-16"], "otra semana no crea");
const prog3 = (await rpc(U.MKT, "select public.instagram_programar($1, $2, true) r", [P2, enMin(200)])).programacion.id;
await registrar(U.MKT, "2026-11-16", P2, prog3, "x1");
r = await rpc(U.MKT, "select public.instagram_story_tapas_cancelar('2026-11-16') r");
igual(r.fila.estado, "cancelada", "no se canceló");
igual((await q("select estado from public.instagram_programaciones where id = $1", [prog3])).rows[0].estado, "cancelada", "la programación sigue viva");
igual((await reclamar(U.MKT, "2026-11-19", "x2")).accion, "nada", "el automático rehízo una cancelada");
igual((await reclamar(U.MKT, "2026-11-19", "x2", true)).accion, "regenerar", "el manual no puede rehacer una cancelada");
await rpc(U.MKT, "select public.instagram_story_tapas_fallo('2026-11-16', 'Render caído') r");
igual((await q("select estado, error, bloqueo_hasta from public.instagram_story_tapas where semana = '2026-11-16'")).rows[0],
  { estado: "cancelada", error: "Render caído", bloqueo_hasta: null }, "el fallo no soltó el cerrojo");

// ── Rollback ────────────────────────────────────────────────────────────────
await db.exec(ROLLBACK);
igual((await q("select to_regclass('public.instagram_story_tapas') as t")).rows[0].t, null, "el rollback dejó la tabla");
igual(Number((await q("select count(*) as n from public.notificaciones_dashboard where tipo = 'instagram_story_tapas'")).rows[0].n), 0, "el rollback dejó avisos");
await db.exec(TAPAS);
comprobaciones++;
await db.close();
console.log(`instagram story tapas (PGlite): ${comprobaciones} comprobaciones OK`);
