// Reels en MP4 (fase 6): columnas de vídeo de instagram_piezas, cola
// instagram_trabajos_render y sus RPC, cubo «instagram-video», programar
// reels y el cron que cierra los «procesando», contra un Postgres en memoria
// (PGlite) con las migraciones REALES de Instagram. Nunca toca Supabase.
//
//   npm run test:instagram-video:db
//
// Cubre: se para si falta lo anterior; idempotente; el panel no escribe el
// vídeo ni pone «procesando» y, si cambia el reel, el vídeo se quita; cubo
// público de 50 MB con escritura solo de marketing; encolar (permisos,
// validaciones, sustituye al pendiente, no con programación activa);
// reclamar atómico (FOR UPDATE SKIP LOCKED), progreso y terminar solo por quien
// reclamó, terminar exige los ficheros en el cubo y respeta un reel cambiado;
// abandonados (10 min) y al 3.er abandono error; cancelar; programar un reel
// con y sin vídeo; datos de «procesando» que se limpian solos; el cron llama
// también con reels «procesando»; rollback y volver a aplicar.
import { PGlite } from "@electric-sql/pglite";
import { readFile } from "node:fs/promises";
import assert from "node:assert/strict";

const leer = (r) => readFile(r, "utf8");
const BASE = await leer("supabase/migrations/20261105090000_instagram.sql");
const MIG_FOTOS = await leer("supabase/migrations/20261105120000_instagram_fotos.sql");
const MIG_DRIVE = await leer("supabase/migrations/20261105150000_instagram_drive.sql");
const MIG_PROG = await leer("supabase/migrations/20261106110000_instagram_programacion.sql");
const MIG_SERVIDOR = await leer("supabase/migrations/20261107000000_instagram_publicacion_servidor.sql");
const MIG_LIMPIEZA = await leer("supabase/migrations/20261107010000_instagram_limpieza_bucket.sql");
const MIGRACION = await leer("supabase/migrations/20261109100000_instagram_video.sql");
const ROLLBACK = await leer("supabase/rollbacks/20261109100000_instagram_video_ROLLBACK.sql");
let comprobaciones = 0;
const ok = (v, msg) => { assert.ok(v, msg); comprobaciones++; };
const igual = (a, b, msg) => { assert.deepEqual(a, b, msg); comprobaciones++; };
const falla = async (p, re, msg) => { await assert.rejects(p, re, msg); comprobaciones++; };

// Andamiaje mínimo de Supabase (igual que scripts/test-instagram-servidor.mjs)
// + pg_cron, pg_net y Vault simulados.
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
  RENDER: "a0000000-0000-0000-0000-000000000005",
};
const DATOS = `
  insert into auth.users (id, email, banned_until) values
    ('${U.SA}', 'sa@t', null), ('${U.MKT}', 'mkt@t', null), ('${U.OTRA}', 'otra@t', null),
    ('${U.BLOQ}', 'bloq@t', now() + interval '1 day'), ('${U.RENDER}', 'render@t', null);
  insert into auth.sessions (id, user_id) select ('b' || substr(id::text, 2))::uuid, id from auth.users;
  insert into public.super_admins values ('${U.SA}');
  insert into public.user_permissions values
    ('${U.MKT}', 'marketing', true, true), ('${U.OTRA}', 'reservas', true, true),
    ('${U.BLOQ}', 'marketing', true, true), ('${U.RENDER}', 'marketing', true, true);
`;
const sesion = (u) => u.replace(/^a/, "b");

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
await falla(db.exec(MIGRACION), /instagram_video: falta public\.instagram_programaciones/, "no se paró sin lo anterior");
await db.exec("rollback").catch(() => {});
for (const m of [MIG_FOTOS, MIG_DRIVE, MIG_PROG, MIG_SERVIDOR, MIG_LIMPIEZA]) await db.exec(m);
await db.exec(MIGRACION);
await db.exec(MIGRACION); // idempotente
comprobaciones++;

// ─── 1. Columnas, restricciones y cubo ──────────────────────────────────────
igual((await q("select tipo_medio from public.instagram_piezas limit 0")).fields.map((f) => f.name), ["tipo_medio"], "falta tipo_medio");
const cubo = (await q("select public, file_size_limit, allowed_mime_types from storage.buckets where id = 'instagram-video'")).rows[0];
igual([cubo.public, Number(cubo.file_size_limit)], [true, 52428800], "cubo instagram-video");
ok(cubo.allowed_mime_types.includes("video/mp4") && cubo.allowed_mime_types.includes("image/jpeg") && cubo.allowed_mime_types.includes("audio/mp4"), "tipos del cubo");
// La comprobación final de 20261105090000 (políticas «instagram_%») sigue pasando.
await db.exec(BASE);
comprobaciones++;
// Escritura en el cubo: marketing sí, otra sección no.
await como(U.MKT, () => q("insert into storage.objects (bucket_id, name) values ('instagram-video', 'audio/prueba.m4a')"));
await falla(como(U.OTRA, () => q("insert into storage.objects (bucket_id, name) values ('instagram-video', 'audio/otra.m4a')")), /row-level security/, "otra sección escribió en el cubo");
igual(await como(U.OTRA, () => n("select count(*)::int n from storage.objects where bucket_id = 'instagram-video'")), 0, "otra sección listó el cubo");
await falla(q("insert into public.instagram_piezas (marca, plantilla, formato, tipo_medio) values ('touza', 'touza', 'reel', 'imagen')"), /instagram_piezas_tipo_medio_chk/, "formato reel con tipo imagen");
await falla(q("insert into public.instagram_piezas (marca, plantilla, formato, tipo_medio, video_ruta) values ('touza', 'touza', 'reel', 'reel', 'otra/cosa.mp4')"), /instagram_piezas_video_chk/, "ruta de vídeo libre");

// ─── 2. El panel no escribe el vídeo ────────────────────────────────────────
const PZ = "c0000000-0000-4000-8000-000000000001";
const RUTA = (pieza, t = "abcdef01", ext = "mp4") => `reels/2026-11/${pieza}-${t}.${ext}`;
await falla(como(U.MKT, () => q(`insert into public.instagram_piezas (id, marca, plantilla, formato, tipo_medio, video_ruta)
  values ($1, 'casa-tomas', 'del-mar', 'reel', 'reel', $2)`, [PZ, RUTA(PZ)])), /Solo el trabajador/, "el panel creó un reel con vídeo");
await como(U.MKT, () => q(`insert into public.instagram_piezas (id, marca, plantilla, formato, tipo_medio, datos)
  values ($1, 'casa-tomas', 'del-mar', 'reel', 'reel', '{"marca":"casa-tomas"}')`, [PZ]));
await falla(como(U.MKT, () => q("update public.instagram_piezas set video_ruta = $2 where id = $1", [PZ, RUTA(PZ)])), /Solo el servidor puede cambiar el vídeo/, "el panel puso el vídeo");
await falla(como(U.MKT, () => q("update public.instagram_piezas set tipo_medio = 'imagen', formato = 'post' where id = $1", [PZ])), /tipo de una pieza/, "el panel cambió el tipo");
await falla(como(U.MKT, () => q("update public.instagram_piezas set estado = 'procesando' where id = $1", [PZ])), /Solo el servidor/, "el panel puso «procesando»");
// «procesando»: los datos se limpian solos al salir.
await q("update public.instagram_piezas set estado = 'procesando', procesando_accion = 'prueba', contenedor_id = '1790000000000001' where id = $1", [PZ]);
ok((await q("select procesando_desde from public.instagram_piezas where id = $1", [PZ])).rows[0].procesando_desde instanceof Date, "sin procesando_desde");
await q("update public.instagram_piezas set estado = 'prueba_ok' where id = $1", [PZ]);
igual((await q("select procesando_accion, procesando_desde from public.instagram_piezas where id = $1", [PZ])).rows[0], { procesando_accion: null, procesando_desde: null }, "no se limpió «procesando»");
await q("delete from public.instagram_piezas where id = $1", [PZ]);

// ─── 3. Encolar ─────────────────────────────────────────────────────────────
const REEL = { marca: "casa-tomas", base: "del-mar", escenas: [{ id: "e1", foto: "drive:abc" }], cierre: { frase: "Hola" } };
const FOTOS = { "drive:abc": "https://sfonaclosuafvlhutkon.supabase.co/storage/v1/object/public/instagram/tmp/x.jpg" };
const encolar = (u, pieza, reel = REEL, fotos = FOTOS, extra = {}) =>
  como(u, () => q("select public.instagram_render_encolar($1, $2, $3, $4, $5, $6, $7) r",
    [pieza, extra.marca ?? reel.marca, JSON.stringify(reel), JSON.stringify(fotos), extra.caption ?? null, extra.portada ?? null, extra.audio ?? null])).then((r) => r.rows[0].r);
await falla(encolar(U.OTRA, null), /Sin permiso de Marketing/, "otra sección encoló");
await falla(encolar(U.BLOQ, null), /Sesión de panel no válida/, "un bloqueado encoló");
await falla(como(null, () => q("select public.instagram_render_encolar(null, 'touza', '{}'::jsonb)"), "anon"), /permission denied/, "anon encoló");
await falla(encolar(U.MKT, null, REEL, FOTOS, { marca: "touza" }), /marca del reel no coincide/, "marca distinta");
await falla(encolar(U.MKT, null, { marca: "casa-tomas", base: "del-mar" }), /forma esperada/, "reel sin escenas");
await falla(encolar(U.MKT, null, REEL, { "drive:abc": "http://192.168.1.10/x.jpg" }), /URL https válida/, "foto sin https");
await falla(encolar(U.MKT, null, REEL, FOTOS, { audio: "../secreto.wav" }), /pista de audio no válida/, "audio con ruta libre");
await falla(encolar(U.MKT, null, REEL, FOTOS, { portada: 120 }), /portada/, "portada fuera de rango");
const e1 = await encolar(U.MKT, null, REEL, FOTOS, { caption: "Del mar", portada: 2.5 });
ok(e1.ok && e1.piezaId && e1.trabajo.estado === "pendiente", "no encoló");
const PIEZA = e1.piezaId;
const pieza = async () => (await q("select * from public.instagram_piezas where id = $1", [PIEZA])).rows[0];
igual([(await pieza()).tipo_medio, (await pieza()).formato, (await pieza()).plantilla, (await pieza()).estado, (await pieza()).caption], ["reel", "reel", "del-mar", "borrador", "Del mar"], "pieza del reel");
ok((await pieza()).creado_por === U.MKT, "creado_por del reel");
// Escritura directa en la cola: no.
await falla(como(U.MKT, () => q("insert into public.instagram_trabajos_render (pieza_id, reel) values ($1, '{}')", [PIEZA])), /permission denied/, "insert directo en la cola");
await falla(como(U.MKT, () => q("update public.instagram_trabajos_render set estado = 'listo'")), /permission denied/, "update directo en la cola");
igual(await como(U.MKT, () => n("select count(*)::int n from public.instagram_trabajos_render")), 1, "marketing no ve la cola");
igual(await como(U.OTRA, () => n("select count(*)::int n from public.instagram_trabajos_render")), 0, "otra sección ve la cola");
// Volver a encolar la misma pieza sustituye al pendiente.
const e2 = await encolar(U.MKT, PIEZA, { ...REEL, escenas: [{ id: "e1", foto: "drive:abc", nombre: "otra" }] });
ok(e2.ok && e2.piezaId === PIEZA && e2.trabajo.id !== e1.trabajo.id, "no re-encoló");
igual((await q("select estado from public.instagram_trabajos_render where id = $1", [e1.trabajo.id])).rows[0].estado, "cancelado", "el pendiente anterior no se canceló");
igual((await pieza()).caption, "Del mar", "re-encolar sin texto borró el caption");

// ─── 4. Reclamar, progreso y terminar ───────────────────────────────────────
const reclamar = (u, id = null) => como(u, () => q("select * from public.instagram_render_reclamar('PC Oficiosos', $1)", [id])).then((r) => r.rows);
await falla(reclamar(U.OTRA), /Sin permiso de Marketing/, "otra sección reclamó");
const [t1] = await reclamar(U.RENDER);
ok(t1 && t1.id === e2.trabajo.id && t1.estado === "renderizando" && t1.procesado_por === U.RENDER && t1.intentos === 1, "no reclamó");
igual((await reclamar(U.MKT)).length, 0, "dos reclamaron el mismo");
ok(MIGRACION.includes("for update skip locked"), "reclamar sin FOR UPDATE SKIP LOCKED");
await falla(encolar(U.MKT, PIEZA), /Ya se está generando/, "re-encoló un reel que se está generando");
igual((await como(U.MKT, () => q("select public.instagram_render_progreso($1, 50) r", [t1.id]))).rows[0].r, false, "otro usuario marcó progreso");
igual((await como(U.RENDER, () => q("select public.instagram_render_progreso($1, 50, 615) r", [t1.id]))).rows[0].r, true, "no marcó progreso");
igual((await q("select progreso, fotogramas from public.instagram_trabajos_render where id = $1", [t1.id])).rows[0], { progreso: 50, fotogramas: 615 }, "progreso");
const terminar = (u, id, args) => como(u, () => q("select public.instagram_render_terminar($1, $2, $3, $4, $5, $6, $7, $8) r",
  [id, args.ok, args.error ?? null, args.video ?? null, args.portada ?? null, args.duracion ?? null, args.bytes ?? null, JSON.stringify(args.avisos ?? [])])).then((r) => r.rows[0].r);
await falla(terminar(U.MKT, t1.id, { ok: true, video: RUTA(PIEZA), duracion: 20.5, bytes: 1000 }), /no lo está generando este usuario/, "otro cerró el trabajo");
await falla(terminar(U.RENDER, t1.id, { ok: true, video: RUTA("c0000000-0000-4000-8000-0000000000ff"), duracion: 20.5, bytes: 1000 }), /Ruta del vídeo no válida/, "vídeo de otra pieza");
await falla(terminar(U.RENDER, t1.id, { ok: true, video: RUTA(PIEZA), duracion: 120, bytes: 1000 }), /3-90 s/, "duración fuera de rango");
await falla(terminar(U.RENDER, t1.id, { ok: true, video: RUTA(PIEZA), duracion: 20.5, bytes: 1000 }), /no está en el cubo/, "cerró sin subir el vídeo");
await como(U.RENDER, () => q("insert into storage.objects (bucket_id, name) values ('instagram-video', $1), ('instagram-video', $2)", [RUTA(PIEZA), RUTA(PIEZA, "abcdef01", "jpg")]));
const fin = await terminar(U.RENDER, t1.id, { ok: true, video: RUTA(PIEZA), portada: RUTA(PIEZA, "abcdef01", "jpg"), duracion: 20.5, bytes: 18000000, avisos: ["Texto cerca del borde"] });
ok(fin.ok && fin.piezaAlDia === true && fin.trabajo.estado === "listo" && fin.trabajo.progreso === 100, "no terminó");
const pz = await pieza();
igual([pz.estado, pz.video_ruta, pz.portada_ruta, Number(pz.duracion_s), Number(pz.video_bytes)], ["generada", RUTA(PIEZA), RUTA(PIEZA, "abcdef01", "jpg"), 20.5, 18000000], "la pieza no quedó con el vídeo");
await falla(terminar(U.RENDER, t1.id, { ok: false, error: "x" }), /no lo está generando/, "cerró dos veces");

// Si el panel cambia el reel, el vídeo se quita.
await como(U.MKT, () => q("update public.instagram_piezas set caption = 'otro texto' where id = $1", [PIEZA]));
igual((await pieza()).video_ruta, RUTA(PIEZA), "cambiar el texto quitó el vídeo");
await como(U.MKT, () => q("update public.instagram_piezas set datos = $2 where id = $1", [PIEZA, JSON.stringify({ ...REEL, cierre: { frase: "Otra" } })]));
igual([(await pieza()).video_ruta, (await pieza()).estado], [null, "borrador"], "cambiar el reel no quitó el vídeo");

// Terminar con el reel cambiado entre medias: el trabajo queda listo, la pieza no se toca.
const e3 = await encolar(U.MKT, PIEZA);
const [t3] = await reclamar(U.RENDER);
igual(t3.id, e3.trabajo.id, "no reclamó el tercero");
await q("update public.instagram_piezas set datos = '{\"marca\":\"casa-tomas\",\"cambiado\":true}' where id = $1", [PIEZA]);
await como(U.RENDER, () => q("insert into storage.objects (bucket_id, name) values ('instagram-video', $1)", [RUTA(PIEZA, "abcdef03")]));
const fin3 = await terminar(U.RENDER, t3.id, { ok: true, video: RUTA(PIEZA, "abcdef03"), duracion: 20.5, bytes: 1000 });
igual([fin3.trabajo.estado, fin3.piezaAlDia, (await pieza()).video_ruta], ["listo", false, null], "un vídeo viejo pisó un reel cambiado");

// Error del trabajador.
const e4 = await encolar(U.MKT, PIEZA);
const [t4] = await reclamar(U.RENDER);
const fin4 = await terminar(U.RENDER, t4.id, { ok: false, error: "ffmpeg no está instalado" });
igual([fin4.trabajo.estado, fin4.trabajo.error], ["error", "ffmpeg no está instalado"], "error del trabajador");
igual(e4.trabajo.id, t4.id, "trabajo del error");

// ─── 5. Abandonados, soltar y cancelar ──────────────────────────────────────
const e5 = await encolar(U.MKT, PIEZA);
const [t5] = await reclamar(U.RENDER);
igual((await como(U.RENDER, () => q("select public.instagram_render_soltar($1) r", [t5.id]))).rows[0].r, true, "no soltó");
igual((await q("select estado, intentos from public.instagram_trabajos_render where id = $1", [t5.id])).rows[0], { estado: "pendiente", intentos: 0 }, "soltar");
await reclamar(U.RENDER);
await falla(como(U.MKT, () => q("select public.instagram_render_cancelar($1)", [t5.id])), /Se está generando/, "canceló uno vivo");
// Sin latido en 10 min: otro lo retoma.
await q("update public.instagram_trabajos_render set latido_en = now() - interval '11 minutes' where id = $1", [t5.id]);
const [t5b] = await reclamar(U.MKT);
igual([t5b?.id, t5b?.procesado_por, t5b?.intentos], [e5.trabajo.id, U.MKT, 2], "no se retomó el abandonado");
// Al 3.er abandono, error.
await q("update public.instagram_trabajos_render set latido_en = now() - interval '11 minutes', intentos = 3 where id = $1", [t5.id]);
igual((await reclamar(U.RENDER)).length, 0, "reclamó un trabajo abandonado 3 veces");
igual((await q("select estado from public.instagram_trabajos_render where id = $1", [t5.id])).rows[0].estado, "error", "el abandonado 3 veces no pasó a error");
const e6 = await encolar(U.MKT, PIEZA);
igual((await como(U.MKT, () => q("select public.instagram_render_cancelar($1) r", [e6.trabajo.id]))).rows[0].r.trabajo.estado, "cancelado", "no canceló un pendiente");
await falla(como(U.MKT, () => q("select public.instagram_render_cancelar($1)", [e6.trabajo.id])), /No hay ningún vídeo pendiente/, "canceló dos veces");

// ─── 6. Programar reels ─────────────────────────────────────────────────────
const programar = (pieza) => como(U.MKT, () => q("select public.instagram_programar($1, now() + interval '1 day', true) r", [pieza])).then((r) => r.rows[0].r);
await falla(programar(PIEZA), /no tiene vídeo/, "programó un reel sin vídeo");
const e7 = await encolar(U.MKT, PIEZA);
const [t7] = await reclamar(U.RENDER);
await como(U.RENDER, () => q("insert into storage.objects (bucket_id, name) values ('instagram-video', $1)", [RUTA(PIEZA, "abcdef07")]));
await terminar(U.RENDER, t7.id, { ok: true, video: RUTA(PIEZA, "abcdef07"), duracion: 20.5, bytes: 1000 });
igual(e7.trabajo.id, t7.id, "trabajo 7");
await q("update public.instagram_piezas set estado = 'procesando', procesando_accion = 'prueba' where id = $1", [PIEZA]);
await falla(programar(PIEZA), /procesando/, "programó un reel «procesando»");
await q("update public.instagram_piezas set estado = 'prueba_ok' where id = $1", [PIEZA]);
ok((await programar(PIEZA)).ok, "no programó un reel con vídeo");
await falla(encolar(U.MKT, PIEZA), /cancela la programación/, "re-encoló un reel programado");
// Las imágenes siguen igual.
const IMG = "c0000000-0000-4000-8000-000000000002";
await q("insert into public.instagram_piezas (id, marca, plantilla, formato, estado) values ($1, 'touza', 'touza-foto', 'post', 'generada')", [IMG]);
await falla(programar(IMG), /no tiene imagen/, "programó una imagen sin JPEG");
await falla(encolar(U.MKT, IMG), /no es un reel/, "encoló una imagen");

// ─── 7. Cron: también con reels «procesando» del panel ─────────────────────
const orden = (await q("select command from cron.job where jobname = 'instagram-programador'")).rows[0].command;
igual(await n("select count(*)::int n from cron.job where jobname = 'instagram-programador'"), 1, "cron duplicado");
const ejecutarCron = async () => { await q("delete from net.peticiones"); await db.exec(orden); return (await q("select * from net.peticiones")).rows; };
await q("update public.instagram_programaciones set estado = 'cancelada', cancelada_at = now()");
await q("insert into vault.decrypted_secrets values ('project_url', 'https://sfonaclosuafvlhutkon.supabase.co'), ('instagram_programador_secret', 's')");
igual((await ejecutarCron()).length, 0, "el cron llamó sin trabajo");
await q("update public.instagram_piezas set estado = 'procesando', procesando_accion = 'programador' where id = $1", [PIEZA]);
igual((await ejecutarCron()).length, 0, "el cron llamó por un «procesando» de una programación (lo cierra la programación)");
await q("update public.instagram_piezas set procesando_accion = 'publicar' where id = $1", [PIEZA]);
const llamadas = await ejecutarCron();
igual([llamadas.length, llamadas[0]?.url], [1, "https://sfonaclosuafvlhutkon.supabase.co/functions/v1/instagram-programador"], "el cron no llamó con un reel «procesando»");
await q("delete from vault.decrypted_secrets");
igual((await ejecutarCron()).length, 0, "el cron llamó sin Vault");

// ─── 8. Rollback y volver a aplicar ─────────────────────────────────────────
await db.exec(ROLLBACK);
igual(await n("select count(*)::int n from information_schema.columns where table_name = 'instagram_piezas' and column_name in ('tipo_medio', 'video_ruta', 'procesando_accion')"), 0, "el rollback dejó columnas");
igual((await q("select to_regclass('public.instagram_trabajos_render') t")).rows[0].t, null, "el rollback dejó la cola");
igual(await n("select count(*)::int n from public.instagram_piezas where formato = 'reel'"), 0, "el rollback dejó reels");
ok(!(await q("select command from cron.job where jobname = 'instagram-programador'")).rows[0].command.includes("procesando"), "el rollback no restauró el cron");
ok(!(await q("select prosrc from pg_proc where proname = 'instagram_programacion_pieza'")).rows[0].prosrc.includes("reel"), "el rollback no restauró instagram_programacion_pieza");
igual(await n("select count(*)::int n from pg_policies where policyname like 'ig\\_video\\_%'"), 0, "el rollback dejó políticas del cubo");
await db.exec(MIGRACION);
comprobaciones++; // se puede volver a aplicar

await db.close();
console.log(`test-instagram-video: ${comprobaciones} comprobaciones OK`);
