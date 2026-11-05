// Estado de publicación solo por el servidor, cerrojo contra la doble
// publicación, texto alternativo y limpieza del bucket, contra un Postgres en
// memoria (PGlite) con las migraciones REALES (20261107000000_instagram_
// publicacion_servidor y 20261107010000_instagram_limpieza_bucket, encima de
// las anteriores de Instagram). Nunca toca Supabase.
//
//   npm run test:instagram-servidor:db
//
// Cubre: se paran si falta lo anterior; idempotentes; alt_text (≤ 1000); el
// panel (authenticated) no puede poner prueba_ok/publicada/error ni media_id,
// permalink, contenedor_id o drive_id, ni tocar una publicada, pero sí lo que
// hace el render; service_role sí; cerrojo (solo service_role, exclusivo,
// caducidad, publicada, programada solo a mano); limpieza (solo service_role,
// respeta publicadas, programadas a 60 días, en curso y recientes; una
// cancelada sí entra; no se programa sin JPEG; regenerar quita la marca y el
// panel no puede quitarla a mano); cron diario mudo sin Vault; rollbacks.
import { PGlite } from "@electric-sql/pglite";
import { readFile } from "node:fs/promises";
import assert from "node:assert/strict";

const leer = (r) => readFile(r, "utf8");
const BASE = await leer("supabase/migrations/20261105090000_instagram.sql");
const MIG_FOTOS = await leer("supabase/migrations/20261105120000_instagram_fotos.sql");
const MIG_DRIVE = await leer("supabase/migrations/20261105150000_instagram_drive.sql");
const MIG_PROG = await leer("supabase/migrations/20261106110000_instagram_programacion.sql");
const MIG_A = await leer("supabase/migrations/20261107000000_instagram_publicacion_servidor.sql");
const RB_A = await leer("supabase/rollbacks/20261107000000_instagram_publicacion_servidor_ROLLBACK.sql");
const MIG_B = await leer("supabase/migrations/20261107010000_instagram_limpieza_bucket.sql");
const RB_B = await leer("supabase/rollbacks/20261107010000_instagram_limpieza_bucket_ROLLBACK.sql");
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

const db = new PGlite();
await db.exec(ANDAMIAJE + CRON_NET_VAULT);
await db.exec(DATOS);
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

// ─── 0. Se para si falta lo anterior ────────────────────────────────────────
await db.exec(BASE);
await falla(db.exec(MIG_A), /instagram_publicacion_servidor: falta public\.instagram_programaciones/, "A no se paró sin programaciones");
await db.exec("rollback").catch(() => {});
await db.exec(MIG_FOTOS);
await db.exec(MIG_DRIVE);
await db.exec(MIG_PROG);
await falla(db.exec(MIG_B), /instagram_limpieza_bucket: falta public\.instagram_publicaciones_en_curso/, "B no se paró sin A");
await db.exec("rollback").catch(() => {});

const P = {
  GEN: "c0000000-0000-4000-8000-000000000001",
  PUB: "c0000000-0000-4000-8000-000000000002",
  VIEJA: "c0000000-0000-4000-8000-000000000003",
  PROG: "c0000000-0000-4000-8000-000000000004",
  CURSO: "c0000000-0000-4000-8000-000000000005",
  RECIENTE: "c0000000-0000-4000-8000-000000000006",
  PROBADA: "c0000000-0000-4000-8000-000000000007",
};
for (const [clave, id] of Object.entries(P)) {
  const pub = clave === "PUB";
  await q(`insert into public.instagram_piezas (id, marca, plantilla, formato, caption, estado, imagen_ruta, media_id, permalink)
           values ($1, 'casa-tomas', 'ct-tipografica', 'post', 'Hola', $2, $3, $4, $5)`,
    [id, pub ? "publicada" : clave === "PROBADA" ? "prueba_ok" : "generada", `piezas/2026-11/${id}.jpg`, pub ? "1800000000000001" : null, pub ? "https://www.instagram.com/p/A/" : null]);
}

await db.exec(MIG_A);
await db.exec(MIG_A); // idempotente
comprobaciones++;

// ─── 1. alt_text ────────────────────────────────────────────────────────────
await como(U.MKT, () => q("update public.instagram_piezas set alt_text = $2 where id = $1", [P.GEN, "Chuleta a la brasa"]));
igual((await q("select alt_text from public.instagram_piezas where id = $1", [P.GEN])).rows[0].alt_text, "Chuleta a la brasa", "marketing no pudo guardar alt_text");
await falla(q("update public.instagram_piezas set alt_text = $2 where id = $1", [P.GEN, "a".repeat(1001)]), /instagram_piezas_alt_text_chk/, "alt_text de más de 1000");

// ─── 2. Estado de publicación: solo el servidor ─────────────────────────────
const nueva = "c0000000-0000-4000-8000-0000000000a1";
for (const [cols, msg] of [
  ["estado = 'publicada', media_id = '1800000000000099'", "marketing marcó publicada"],
  ["estado = 'prueba_ok'", "marketing marcó prueba_ok"],
  ["estado = 'error'", "marketing marcó error"],
  ["media_id = '1800000000000099'", "marketing puso media_id"],
  ["permalink = 'https://www.instagram.com/p/FALSO/'", "marketing puso permalink"],
  ["contenedor_id = '1790000000000099'", "marketing puso contenedor_id"],
  ["drive_id = '1DriveFalso0000000000000001'", "marketing puso drive_id"],
]) {
  await falla(como(U.MKT, () => q(`update public.instagram_piezas set ${cols} where id = $1`, [P.GEN])), /Solo el servidor/, msg);
}
await falla(como(U.MKT, () => q("update public.instagram_piezas set caption = 'otra' where id = $1", [P.PUB])), /ya está publicada/, "marketing editó una publicada");
await falla(como(U.MKT, () => q(`insert into public.instagram_piezas (id, marca, plantilla, formato, estado, media_id)
  values ($1, 'casa-tomas', 'ct-tipografica', 'post', 'publicada', '1')`, [nueva])), /Solo el servidor/, "marketing creó una publicada");
// Lo que hace el render sí vale: crear «generada», regenerar (generada + contenedor null).
await como(U.MKT, () => q(`insert into public.instagram_piezas (id, marca, plantilla, formato, estado, imagen_ruta)
  values ($1, 'casa-tomas', 'ct-tipografica', 'post', 'generada', 'piezas/2026-11/a1.jpg')`, [nueva]));
await q("update public.instagram_piezas set estado = 'prueba_ok', contenedor_id = '1790000000000001' where id = $1", [P.PROBADA]); // servidor
await como(U.MKT, () => q("update public.instagram_piezas set estado = 'generada', contenedor_id = null, error = null, caption = 'nuevo' where id = $1", [P.PROBADA]));
igual((await q("select estado, contenedor_id from public.instagram_piezas where id = $1", [P.PROBADA])).rows[0], { estado: "generada", contenedor_id: null }, "el render no pudo regenerar");
// service_role (Edge Functions) y postgres sí.
await como(null, () => q("update public.instagram_piezas set estado = 'prueba_ok', contenedor_id = '1790000000000002' where id = $1", [P.PROBADA]), "service_role");
igual((await q("select estado from public.instagram_piezas where id = $1", [P.PROBADA])).rows[0].estado, "prueba_ok", "service_role no pudo escribir el estado");
await como(null, () => q("update public.instagram_piezas set estado = 'publicada', media_id = '1800000000000005', permalink = 'https://www.instagram.com/p/B/' where id = $1", [nueva]), "service_role");
ok((await q("select publicada_at from public.instagram_piezas where id = $1", [nueva])).rows[0].publicada_at instanceof Date, "publicada_at sigue funcionando");
await q("delete from public.instagram_piezas where id = $1", [nueva]);

// ─── 3. Cerrojo ─────────────────────────────────────────────────────────────
const reservar = async (pieza, comprobar = true, seg = 180) =>
  (await como(null, () => q("select public.instagram_pieza_reservar_publicacion($1, $2, $3) r", [pieza, seg, comprobar]), "service_role")).rows[0].r;
const liberar = async (pieza, bloqueo) =>
  (await como(null, () => q("select public.instagram_pieza_liberar_publicacion($1, $2) r", [pieza, bloqueo]), "service_role")).rows[0].r;
await falla(como(U.MKT, () => q("select public.instagram_pieza_reservar_publicacion($1, 180, true)", [P.GEN])), /permission denied/, "marketing reservó");
await falla(como(U.MKT, () => q("select * from public.instagram_publicaciones_en_curso")), /permission denied/, "marketing leyó los cerrojos");
const r1 = await reservar(P.GEN);
ok(r1.ok === true && typeof r1.bloqueo === "string", "no reservó");
igual(await reservar(P.GEN), { ok: false, motivo: "en_curso" }, "reservó dos veces");
igual(await reservar(P.GEN, false), { ok: false, motivo: "en_curso" }, "una prueba entró con una publicación en curso");
igual(await liberar(P.GEN, "d0000000-0000-4000-8000-000000000000"), false, "liberó con otro bloqueo");
igual(await liberar(P.GEN, r1.bloqueo), true, "no liberó");
const r2 = await reservar(P.GEN);
ok(r2.ok, "no se pudo volver a reservar tras liberar");
await q("update public.instagram_publicaciones_en_curso set bloqueada_hasta = now() - interval '1 second' where pieza_id = $1", [P.GEN]);
ok((await reservar(P.GEN)).ok, "un cerrojo caducado sigue bloqueando");
igual((await reservar(P.PUB)).motivo, "publicada", "reservó una publicada");
igual((await reservar("c0000000-0000-4000-8000-0000000000ff")).motivo, "no_existe", "reservó una inexistente");
// Programada: publicar a mano no; programador (o prueba) sí.
await q(`insert into public.instagram_programaciones (pieza_id, marca, programada_para, siguiente_intento_at)
         values ($1, 'casa-tomas', now() + interval '60 days', now() + interval '60 days')`, [P.PROG]);
const r3 = await reservar(P.PROG, true);
igual([r3.ok, r3.motivo], [false, "programada"], "publicó a mano una programada");
ok(typeof r3.programadaPara === "string", "sin fecha de la programación");
ok((await reservar(P.PROG, false)).ok, "el programador no pudo reservar su pieza");
// Al borrar la pieza se va su cerrojo.
await q("insert into public.instagram_publicaciones_en_curso values ($1, gen_random_uuid(), now() + interval '1 hour')", [P.CURSO]);

// ─── 4. Limpieza del bucket ─────────────────────────────────────────────────
await db.exec(MIG_B);
await db.exec(MIG_B); // idempotente
comprobaciones++;
// Antigüedad: todas «viejas» menos RECIENTE.
await db.exec("alter table public.instagram_piezas disable trigger instagram_piezas_al_editar");
await q("update public.instagram_piezas set updated_at = now() - interval '30 days' where id <> $1", [P.RECIENTE]);
await db.exec("alter table public.instagram_piezas enable trigger instagram_piezas_al_editar");
await q("delete from public.instagram_publicaciones_en_curso where pieza_id in ($1, $2)", [P.GEN, P.PROG]);
const reclamar = async (dias = 7) =>
  (await como(null, () => q("select * from public.instagram_piezas_reclamar_jpeg_caducados($1, 100)", [dias]), "service_role")).rows;
await falla(como(U.MKT, () => q("select * from public.instagram_piezas_reclamar_jpeg_caducados(7, 100)")), /permission denied/, "marketing ejecutó la limpieza");
const borradas = (await reclamar()).map((r) => r.id).sort();
igual(borradas, [P.GEN, P.VIEJA, P.PROBADA].sort(), "la limpieza no respetó publicadas, programadas (60 días vista), en curso o recientes");
ok((await reclamar()).length === 0, "reclamó dos veces las mismas");
ok((await q("select imagen_borrada_at from public.instagram_piezas where id = $1", [P.VIEJA])).rows[0].imagen_borrada_at instanceof Date, "sin marca de borrada");
// No se programa una pieza con el JPEG borrado…
await falla(como(U.MKT, () => q("select public.instagram_programar($1, now() + interval '1 day', false)", [P.VIEJA])), /se borró/, "programó una pieza sin JPEG");
// …el panel no puede quitar la marca a mano…
await como(U.MKT, () => q("update public.instagram_piezas set imagen_borrada_at = null, caption = 'x' where id = $1", [P.PROBADA]));
ok((await q("select imagen_borrada_at from public.instagram_piezas where id = $1", [P.PROBADA])).rows[0].imagen_borrada_at !== null, "el panel quitó la marca a mano");
// …y al regenerar (el render deja «generada») vuelve a null y se puede programar.
await como(U.MKT, () => q("update public.instagram_piezas set estado = 'generada', contenedor_id = null where id = $1", [P.VIEJA]));
igual((await q("select imagen_borrada_at from public.instagram_piezas where id = $1", [P.VIEJA])).rows[0].imagen_borrada_at, null, "regenerar no quitó la marca");
igual((await como(U.MKT, () => q("select public.instagram_programar($1, now() + interval '1 day', false) r", [P.VIEJA]))).rows[0].r.ok, true, "no se pudo programar tras regenerar");
// La programada (a 60 días) sigue sin tocarse aunque pase el tiempo.
igual((await q("select imagen_borrada_at from public.instagram_piezas where id = $1", [P.PROG])).rows[0].imagen_borrada_at, null, "se borró el JPEG de una programada");
// Cancelada, ya sí entra en la limpieza.
await q("update public.instagram_programaciones set estado = 'cancelada' where pieza_id = $1", [P.PROG]);
await db.exec("alter table public.instagram_piezas disable trigger instagram_piezas_al_editar");
await q("update public.instagram_piezas set updated_at = now() - interval '30 days' where id = $1", [P.PROG]);
await db.exec("alter table public.instagram_piezas enable trigger instagram_piezas_al_editar");
igual((await reclamar()).map((r) => r.id), [P.PROG], "una cancelada no entró en la limpieza");

// Cron
const orden = (await q("select command, schedule from cron.job where jobname = 'instagram-limpieza-bucket'")).rows[0];
igual(orden.schedule, "30 3 * * *", "horario del cron");
ok(/"accion":"limpiar"/.test(orden.command) && /instagram_programador_secret/.test(orden.command), "el cron no pide limpiar con el secreto de Vault");
await q("delete from net.peticiones");
await db.exec(orden.command);
igual(await n("select count(*)::int n from net.peticiones"), 0, "el cron llamó sin Vault");
await q("insert into vault.decrypted_secrets values ('project_url', 'https://sfonaclosuafvlhutkon.supabase.co'), ('instagram_programador_secret', 's')");
await db.exec(orden.command);
const llamada = (await q("select * from net.peticiones")).rows[0];
igual([llamada.url, llamada.body], ["https://sfonaclosuafvlhutkon.supabase.co/functions/v1/instagram-programador", { accion: "limpiar" }], "llamada del cron");

// ─── 5. Rollbacks (B y luego A) ─────────────────────────────────────────────
await db.exec(RB_B);
igual(await n("select count(*)::int n from cron.job where jobname = 'instagram-limpieza-bucket'"), 0, "el rollback B dejó el cron");
igual(await n("select count(*)::int n from information_schema.columns where table_name = 'instagram_piezas' and column_name = 'imagen_borrada_at'"), 0, "el rollback B dejó la columna");
igual(await n("select count(*)::int n from pg_proc where proname in ('instagram_piezas_reclamar_jpeg_caducados', 'instagram_piezas_imagen_borrada')"), 0, "el rollback B dejó funciones");
ok((await q("select prosrc from pg_proc where proname = 'instagram_programacion_pieza'")).rows[0].prosrc.includes("genérala antes"), "el rollback B no restauró instagram_programacion_pieza");
await db.exec(RB_A);
igual(await n("select count(*)::int n from information_schema.columns where table_name = 'instagram_piezas' and column_name = 'alt_text'"), 0, "el rollback A dejó alt_text");
igual((await q("select to_regclass('public.instagram_publicaciones_en_curso') t")).rows[0].t, null, "el rollback A dejó la tabla de cerrojos");
await como(U.MKT, () => q("update public.instagram_piezas set estado = 'prueba_ok' where id = $1", [P.GEN]));
comprobaciones++; // sin el trigger, vuelve el comportamiento anterior
await db.exec(MIG_A);
await db.exec(MIG_B);
comprobaciones++; // se pueden volver a aplicar

await db.close();
console.log(`test-instagram-servidor: ${comprobaciones} comprobaciones OK`);
