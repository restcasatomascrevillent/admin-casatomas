// Programar publicaciones de Instagram contra un Postgres en memoria (PGlite)
// con las migraciones REALES (20261105090000_instagram + 20261106110000_
// instagram_programacion). Nunca toca Supabase.
//
//   npm run test:instagram-programar:db
//
// Cubre: se para si falta algo; idempotente; publicada_at (relleno sin mover
// updated_at, trigger no falseable); RLS (marketing lee, otra sección,
// bloqueados y anon no; nadie escribe sin RPC); RPC del panel (ventana de 10
// min a 75 días, pieza sin JPEG o publicada, aviso de ±30 min de la misma
// marca con confirmación, mover, cancelar, permisos); RPC del programador
// (solo service_role, solo vencidas, bloqueo exclusivo, bloqueo caducado sin
// volver a publicar, reintentos hasta 3, aplazar sin contar, publicada);
// cron (una vez, mudo sin Vault, solo con trabajo); auditoría; y el rollback.
import { PGlite } from "@electric-sql/pglite";
import { readFile } from "node:fs/promises";
import assert from "node:assert/strict";

const BASE = await readFile("supabase/migrations/20261105090000_instagram.sql", "utf8");
const MIGRACION = await readFile("supabase/migrations/20261106110000_instagram_programacion.sql", "utf8");
const ROLLBACK = await readFile("supabase/rollbacks/20261106110000_instagram_programacion_ROLLBACK.sql", "utf8");

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

// ─── 0. Si falta algo de lo que depende, se para sin crear nada ─────────────
{
  const otra = new PGlite();
  await otra.exec(ANDAMIAJE);
  await otra.exec(BASE);
  await falla(otra.exec(MIGRACION), /instagram_programacion: falta pg_cron \(cron\.job\), pg_net \(esquema net\), Vault/, "no se paró sin pg_cron/pg_net/Vault");
  await otra.exec("rollback");
  igual((await otra.query("select to_regclass('public.instagram_programaciones') t")).rows[0].t, null, "la migración abortada dejó la tabla");
  await otra.close();
}
{
  const otra = new PGlite();
  await otra.exec(ANDAMIAJE + CRON_NET_VAULT);
  await falla(otra.exec(MIGRACION), /falta public\.instagram_piezas/, "no se paró sin instagram_piezas");
  await otra.close();
}

const db = new PGlite();
await db.exec(ANDAMIAJE + CRON_NET_VAULT);
await db.exec(DATOS);
await db.exec(BASE);
const q = (sql, params) => db.query(sql, params);
const n = async (sql, params) => (await q(sql, params)).rows[0].n;

// Piezas de prueba (como service_role/postgres): P1..P4 de Casa Tomás, T1 de
// Touza, SIN sin imagen, PUB ya publicada antes de la migración.
const P = {
  P1: "c0000000-0000-4000-8000-000000000001",
  P2: "c0000000-0000-4000-8000-000000000002",
  P3: "c0000000-0000-4000-8000-000000000003",
  P4: "c0000000-0000-4000-8000-000000000004",
  T1: "c0000000-0000-4000-8000-000000000005",
  SIN: "c0000000-0000-4000-8000-000000000006",
  PUB: "c0000000-0000-4000-8000-000000000007",
};
for (const [clave, id] of Object.entries(P)) {
  const marca = clave === "T1" ? "touza" : "casa-tomas";
  const ruta = clave === "SIN" ? null : `piezas/2026-11/${id}.jpg`;
  await q(`insert into public.instagram_piezas (id, marca, plantilla, formato, caption, estado, imagen_ruta, media_id)
           values ($1, $2, 'ct-tipografica', 'post', 'Hola', $3, $4, $5)`,
    [id, marca, clave === "PUB" ? "publicada" : ruta ? "generada" : "borrador", ruta, clave === "PUB" ? "1800000000000001" : null]);
}
await q("update public.instagram_piezas set updated_at = '2026-11-01 10:00+00' where id = $1", [P.PUB]);
const actualizadaPub = (await q("select updated_at from public.instagram_piezas where id = $1", [P.PUB])).rows[0].updated_at;

await db.exec(MIGRACION);
await db.exec(MIGRACION); // idempotente
comprobaciones++;

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
const rpc = async (u, sql, params, rol) => (await como(u, () => q(sql, params), rol)).rows[0];
const programar = async (u, pieza, para, confirmar = false) =>
  (await rpc(u, "select public.instagram_programar($1, $2, $3) r", [pieza, para, confirmar])).r;
const reprogramar = async (u, id, para, confirmar = false) =>
  (await rpc(u, "select public.instagram_reprogramar($1, $2, $3) r", [id, para, confirmar])).r;
const cancelar = async (u, id) => (await rpc(u, "select public.instagram_cancelar_programacion($1) r", [id])).r;
const reclamar = async (lease = 600) => (await como(null, () => q("select * from public.instagram_programador_reclamar($1)", [lease]), "service_role")).rows;
const cerrar = (id, bloqueo, resultado, extra = {}) => rpc(null,
  "select * from public.instagram_programador_cerrar($1, $2, $3, $4, $5, $6, $7, $8)",
  [id, bloqueo, resultado, extra.mensaje ?? null, extra.media ?? null, extra.permalink ?? null, extra.contenedor ?? null, extra.espera ?? 0],
  "service_role");
const fila = async (id) => (await q("select * from public.instagram_programaciones where id = $1", [id])).rows[0];
const enMin = (m) => new Date(Date.now() + m * 60_000).toISOString();
// «Vence» una programación sin pasar por la RPC (que no deja programar al pasado).
const vencer = (id, minutosAtras = 1) => q(`update public.instagram_programaciones
  set siguiente_intento_at = now() - make_interval(mins => $2), programada_para = now() - make_interval(mins => $2) where id = $1`, [id, minutosAtras]);

// ─── 1. publicada_at ────────────────────────────────────────────────────────
{
  const r = (await q("select publicada_at, updated_at from public.instagram_piezas where id = $1", [P.PUB])).rows[0];
  igual(r.publicada_at?.getTime(), actualizadaPub.getTime(), "el relleno no puso publicada_at = updated_at");
  igual(r.updated_at.getTime(), actualizadaPub.getTime(), "el relleno movió updated_at");
  const falseada = (await q("update public.instagram_piezas set publicada_at = '2000-01-01' where id = $1 returning publicada_at", [P.PUB])).rows[0];
  igual(falseada.publicada_at.getTime(), actualizadaPub.getTime(), "se pudo falsear publicada_at");
  igual((await q("select publicada_at from public.instagram_piezas where id = $1", [P.P4])).rows[0].publicada_at, null, "publicada_at en una no publicada");
  ok((await q("select indexdef from pg_indexes where indexname = 'instagram_piezas_publicada_at_idx'")).rows.length === 1, "índice de publicada_at");
}

// ─── 2. Estructura, RLS y permisos ──────────────────────────────────────────
ok((await q("select relrowsecurity r from pg_class where oid = 'public.instagram_programaciones'::regclass")).rows[0].r, "RLS apagada");
ok((await q("select indexdef from pg_indexes where indexname = 'instagram_programaciones_pendientes_idx'")).rows[0]?.indexdef.includes("WHERE (estado = 'programada'"), "índice de pendientes");
igual(await n("select count(*)::int n from pg_trigger where tgrelid = 'public.instagram_programaciones'::regclass and tgname = 'trg_auditoria'"), 1, "sin auditoría (o duplicada)");

const r1 = await programar(U.MKT, P.P1, enMin(60));
igual([r1.ok, r1.accion, r1.programacion.estado, r1.programacion.marca], [true, "programada", "programada", "casa-tomas"], "programar");
const ID1 = r1.programacion.id;
igual((await fila(ID1)).creado_por, U.MKT, "creado_por");
igual(await n(`select count(*)::int n from public.audit_log where tabla = 'instagram_programaciones' and actor = '${U.MKT}'`), 1, "el alta no se auditó con su autor");

igual((await como(U.MKT, () => q("select id from public.instagram_programaciones"))).rows.map((r) => r.id), [ID1], "marketing no lee");
igual((await como(U.OTRA, () => q("select id from public.instagram_programaciones"))).rows, [], "otra sección leyó");
igual((await como(U.BLOQ, () => q("select id from public.instagram_programaciones"))).rows, [], "un bloqueado leyó");
await falla(como(null, () => q("select * from public.instagram_programaciones"), "anon"), /permission denied/, "anon leyó");
await falla(como(U.MKT, () => q("update public.instagram_programaciones set estado = 'publicada'")), /permission denied/, "marketing escribió sin RPC");
await falla(como(U.MKT, () => q(`insert into public.instagram_programaciones (pieza_id, marca, programada_para, siguiente_intento_at) values ($1, 'casa-tomas', now(), now())`, [P.P2])), /permission denied/, "marketing insertó sin RPC");
await falla(como(U.MKT, () => q("delete from public.instagram_programaciones")), /permission denied/, "marketing borró sin RPC");

for (const [u, msg] of [[U.OTRA, "otra sección programó"], [U.BLOQ, "un bloqueado programó"], [U.LECT, "sin permisos programó"]]) {
  await falla(programar(u, P.P2, enMin(60)), /Sin permiso de Marketing|Sesión de panel no válida/, msg);
}
await falla(como(null, () => q("select public.instagram_programar($1, $2, false)", [P.P2, enMin(60)]), "anon"), /permission denied/, "anon programó");
await falla(como(U.MKT, () => q("select * from public.instagram_programador_reclamar(600)")), /permission denied/, "marketing reclamó como el programador");
await falla(como(U.MKT, () => q("select * from public.instagram_programador_cerrar($1, $1, 'error')", [ID1])), /permission denied/, "marketing cerró como el programador");

// ─── 3. Validaciones del panel ──────────────────────────────────────────────
await falla(programar(U.MKT, P.P2, enMin(-5)), /al menos 10 minutos/, "aceptó una fecha pasada");
await falla(programar(U.MKT, P.P2, enMin(9)), /al menos 10 minutos/, "aceptó menos de 10 minutos");
await falla(programar(U.MKT, P.P2, enMin(76 * 24 * 60)), /75 días/, "aceptó más de 75 días");
igual((await programar(U.MKT, P.P2, enMin(74 * 24 * 60))).ok, true, "no aceptó 74 días");
await falla(programar(U.MKT, P.SIN, enMin(60)), /no tiene imagen/, "programó una pieza sin JPEG");
await falla(programar(U.MKT, P.PUB, enMin(60)), /ya está publicada/, "programó una ya publicada");
await falla(programar(U.MKT, "c0000000-0000-4000-8000-0000000000ff", enMin(60)), /No existe esa pieza/, "programó una pieza inexistente");

// Aviso de ±30 min de la misma marca (P1 está a +60).
const conflicto = await programar(U.MKT, P.P3, enMin(80));
igual([conflicto.ok, conflicto.requiereConfirmacion, conflicto.conflictos.map((c) => c.piezaId)], [false, true, [P.P1]], "no avisó del conflicto");
igual(await n("select count(*)::int n from public.instagram_programaciones where pieza_id = $1", [P.P3]), 0, "el aviso cambió algo");
igual((await programar(U.MKT, P.T1, enMin(70))).ok, true, "otra marca a ±30 min no debe avisar");
const confirmada = await programar(U.MKT, P.P3, enMin(80), true);
igual([confirmada.ok, confirmada.conflictos.length], [true, 1], "con confirmación no programó");
igual((await programar(U.MKT, P.P4, enMin(200))).ok, true, "a +200 no debe avisar");

// Programar otra vez la misma pieza = moverla (una sola activa por pieza).
const movida = await programar(U.MKT, P.P1, enMin(300));
igual([movida.ok, movida.accion, movida.programacion.id], [true, "reprogramada", ID1], "programar de nuevo no movió la activa");
igual(await n("select count(*)::int n from public.instagram_programaciones where pieza_id = $1", [P.P1]), 1, "duplicó la programación");
// Reprogramar con conflicto (P4 está a +200).
const conflicto2 = await reprogramar(U.MKT, ID1, enMin(215));
igual([conflicto2.ok, conflicto2.requiereConfirmacion], [false, true], "reprogramar no avisó del conflicto");
igual((await reprogramar(U.MKT, ID1, enMin(500))).programacion.programada_para !== undefined, true, "reprogramar");
await falla(reprogramar(U.OTRA, ID1, enMin(600)), /Sin permiso/, "otra sección reprogramó");

// Cancelar
const ID3 = (await fila((await q("select id from public.instagram_programaciones where pieza_id = $1", [P.P3])).rows[0].id)).id;
igual((await cancelar(U.MKT, ID3)).programacion.estado, "cancelada", "no canceló");
igual((await fila(ID3)).cancelada_por, U.MKT, "cancelada_por");
await falla(cancelar(U.MKT, ID3), /No hay ninguna programación pendiente/, "canceló dos veces");
await falla(reprogramar(U.MKT, ID3, enMin(60)), /ya está cancelada/, "movió una cancelada");
await falla(cancelar(U.OTRA, ID1), /Sin permiso/, "otra sección canceló");
igual((await programar(U.MKT, P.P3, enMin(900))).accion, "programada", "no se puede volver a programar tras cancelar");

// ─── 4. Programador ─────────────────────────────────────────────────────────
igual(await reclamar(), [], "reclamó algo no vencido");
await vencer(ID1);
const [c1] = await reclamar();
igual([c1.id, c1.estado], [ID1, "publicando"], "no reclamó la vencida");
ok(c1.bloqueo_id && c1.bloqueada_hasta > new Date(), "sin bloqueo");
igual(await reclamar(), [], "se reclamó dos veces la misma (sin bloqueo)");
await falla(reprogramar(U.MKT, ID1, enMin(60)), /Se está publicando/, "se movió una que se está publicando");
await falla(cancelar(U.MKT, ID1), /Se está publicando/, "se canceló una que se está publicando");
await falla(programar(U.MKT, P.P1, enMin(60)), /Se está publicando/, "se programó una que se está publicando");
await falla(cerrar(ID1, "d0000000-0000-4000-8000-000000000000", "publicada", { media: "1" }), /ya no está bloqueada/, "cerró con otro bloqueo");

// Reintentos: 1.º y 2.º vuelven a «programada» con espera; el 3.º, error.
let r = await cerrar(ID1, c1.bloqueo_id, "reintentar", { mensaje: "Meta 503", espera: 300, contenedor: "1790000000000001" });
igual([r.estado, r.intentos, r.ultimo_error, r.contenedor_id, r.bloqueo_id], ["programada", 1, "Meta 503", "1790000000000001", null], "1.er reintento");
ok(r.siguiente_intento_at > new Date(Date.now() + 290_000), "sin espera tras el reintento");
igual(await reclamar(), [], "reclamó antes de la espera");
await vencer(ID1);
r = await cerrar(ID1, (await reclamar())[0].bloqueo_id, "reintentar", { mensaje: "otra vez", espera: 900 });
igual([r.estado, r.intentos, r.contenedor_id], ["programada", 2, null], "2.º reintento");
await vencer(ID1);
// Aplazar (cuota) NO cuenta intento.
r = await cerrar(ID1, (await reclamar())[0].bloqueo_id, "aplazar", { mensaje: "Cuota agotada", espera: 300 });
igual([r.estado, r.intentos], ["programada", 2], "aplazar contó un intento");
await vencer(ID1);
r = await cerrar(ID1, (await reclamar())[0].bloqueo_id, "reintentar", { mensaje: "y otra" });
igual([r.estado, r.intentos, r.ultimo_error], ["error", 3, "y otra"], "el 3.er fallo no dejó la programación en error");
igual(await reclamar(), [], "reclamó una en error");

// Una en error se puede mover (reinicia intentos) o cancelar.
const rep = await reprogramar(U.MKT, ID1, enMin(30));
igual([rep.ok, rep.programacion.estado, rep.programacion.intentos, rep.programacion.ultimo_error], [true, "programada", 0, null], "mover una en error");

// Publicada
await vencer(ID1);
const c2 = (await reclamar())[0];
await falla(cerrar(ID1, c2.bloqueo_id, "publicada"), /Falta el media_id/, "publicada sin media_id");
r = await cerrar(ID1, c2.bloqueo_id, "publicada", { media: "1800000000000009", permalink: "https://www.instagram.com/p/X/" });
igual([r.estado, r.media_id, r.permalink], ["publicada", "1800000000000009", "https://www.instagram.com/p/X/"], "publicada");
ok(r.publicada_at instanceof Date, "sin publicada_at");
await falla(cancelar(U.MKT, ID1), /No hay ninguna programación pendiente/, "canceló una publicada");

// Error definitivo
const ID4 = (await q("select id from public.instagram_programaciones where pieza_id = $1 and estado = 'programada'", [P.P4])).rows[0].id;
await vencer(ID4, 3);
const IDT = (await q("select id from public.instagram_programaciones where pieza_id = $1", [P.T1])).rows[0].id;
await vencer(IDT, 1);
const [primero] = await reclamar();
igual(primero.id, ID4, "no reclamó primero la más antigua");
r = await cerrar(ID4, primero.bloqueo_id, "error", { mensaje: "La pieza no tiene imagen" });
igual([r.estado, r.intentos], ["error", 1], "error definitivo");

// Bloqueo caducado: NO se vuelve a publicar.
const [ct] = await reclamar(60);
igual(ct.id, IDT, "no reclamó la de Touza");
await q("update public.instagram_programaciones set bloqueada_hasta = now() - interval '1 minute' where id = $1", [IDT]);
igual(await reclamar(), [], "volvió a reclamar una con el bloqueo caducado");
r = await fila(IDT);
igual([r.estado, r.bloqueo_id], ["error", null], "bloqueo caducado sin media_id → error");
ok(/se cortó a mitad/.test(r.ultimo_error), "sin explicación del corte");
// …y si la pieza ya tenía media_id, se da por publicada.
await reprogramar(U.MKT, IDT, enMin(45));
await vencer(IDT);
const [ct2] = await reclamar(60);
await q("update public.instagram_piezas set estado = 'publicada', media_id = '1800000000000077', permalink = 'https://www.instagram.com/p/Y/' where id = $1", [P.T1]);
await q("update public.instagram_programaciones set bloqueada_hasta = now() - interval '1 minute' where id = $1", [ct2.id]);
await reclamar();
r = await fila(IDT);
igual([r.estado, r.media_id, r.permalink], ["publicada", "1800000000000077", "https://www.instagram.com/p/Y/"], "bloqueo caducado con media_id → publicada");
await falla(cerrar(IDT, ct2.bloqueo_id, "publicada", { media: "1" }), /ya no está bloqueada/, "una pasada caducada pudo cerrar");

// CHECK
await falla(q("update public.instagram_programaciones set estado = 'rara' where id = $1", [ID4]), /violates check constraint/, "estado desconocido");
await falla(q("update public.instagram_programaciones set estado = 'publicando' where id = $1", [ID4]), /violates check constraint/, "publicando sin bloqueo");
await falla(q("update public.instagram_programaciones set intentos = 4 where id = $1", [ID4]), /violates check constraint/, "más de 3 intentos");
await falla(q("update public.instagram_programaciones set contenedor_id = 'abc' where id = $1", [ID4]), /violates check constraint/, "contenedor no numérico");

// ─── 5. Cron ────────────────────────────────────────────────────────────────
igual(await n("select count(*)::int n from cron.job where jobname = 'instagram-programador' and schedule = '*/5 * * * *'"), 1, "cron no instalado una vez cada 5 min");
const orden = (await q("select command from cron.job where jobname = 'instagram-programador'")).rows[0].command;
ok(/instagram_programador_secret/.test(orden) && /project_url/.test(orden) && /x-webhook-secret/.test(orden), "el cron no lee URL y secreto de Vault");
ok(/\/functions\/v1\/instagram-programador/.test(orden), "el cron no llama a la función");
const ejecutarCron = async () => { await q("delete from net.peticiones"); await db.exec(orden); return (await q("select * from net.peticiones")).rows; };
await vencer(ID4); // está en error: no es trabajo
await q("update public.instagram_programaciones set estado = 'programada', siguiente_intento_at = now() - interval '1 minute' where pieza_id = $1 and estado = 'programada'", [P.P2]);
igual((await ejecutarCron()).length, 0, "el cron llamó sin secretos en Vault (debe estar mudo)");
await q("insert into vault.decrypted_secrets values ('project_url', 'https://sfonaclosuafvlhutkon.supabase.co/'), ('instagram_programador_secret', 'secreto-de-prueba')");
const llamadas = await ejecutarCron();
igual(llamadas.length, 1, "el cron no llamó con trabajo vencido");
igual(llamadas[0].url, "https://sfonaclosuafvlhutkon.supabase.co/functions/v1/instagram-programador", "URL del cron");
igual(llamadas[0].headers["x-webhook-secret"], "secreto-de-prueba", "cabecera del cron");
await q("update public.instagram_programaciones set siguiente_intento_at = now() + interval '1 hour' where estado = 'programada'");
igual((await ejecutarCron()).length, 0, "el cron llamó sin trabajo");

// Al borrar la pieza se van sus programaciones.
await q("delete from public.instagram_piezas where id = $1", [P.P2]);
igual(await n("select count(*)::int n from public.instagram_programaciones where pieza_id = $1", [P.P2]), 0, "no se borró en cascada");

// ─── 6. Rollback ────────────────────────────────────────────────────────────
await db.exec(ROLLBACK);
igual((await q("select to_regclass('public.instagram_programaciones') t")).rows[0].t, null, "el rollback no borró la tabla");
igual(await n("select count(*)::int n from cron.job where jobname = 'instagram-programador'"), 0, "el rollback dejó el cron");
igual(await n("select count(*)::int n from pg_proc where proname like 'instagram_program%' or proname = 'instagram_piezas_marcar_publicada' or proname = 'instagram_reprogramar' or proname = 'instagram_cancelar_programacion'"), 0, "el rollback dejó funciones");
igual(await n("select count(*)::int n from information_schema.columns where table_name = 'instagram_piezas' and column_name = 'publicada_at'"), 0, "el rollback dejó publicada_at");
ok((await q("select to_regclass('public.instagram_piezas') t")).rows[0].t !== null, "el rollback borró instagram_piezas");
await db.exec(MIGRACION); // se puede volver a aplicar
ok((await q("select to_regclass('public.instagram_programaciones') t")).rows[0].t !== null, "reaplicar tras el rollback");

await db.close();
console.log(`test-instagram-programar: ${comprobaciones} comprobaciones OK`);
