// «Qué funciona» de Instagram (20261110000000_instagram_aprender.sql) contra
// un Postgres en memoria (PGlite), con las migraciones REALES de Instagram
// debajo. Nunca toca Supabase.
//
//   npm run test:instagram-aprender:db
//
// Cubre: se para sin las métricas; se aplica sin la tabla de fotos;
// idempotente; columnas nuevas, relleno de las filas que ya había (hora local
// de Madrid y hashtags), texto hasta 2200 y CHECK; la vista lleva las
// columnas nuevas; la RPC instagram_que_funciona con pocos datos (aviso y
// «faltan datos», sin conclusiones), con datos (martes, franja de 12 a 14 h,
// reels y #cocido; plantillas «parecidas»; tipo de foto por drive_id; solo la
// última captura; mejores y peores), filtros de marca, cuenta y días, muestra
// mínima configurable; permisos (marketing sí, otra sección no, sesión
// bloqueada no ve, anon nada, SECURITY INVOKER); y el rollback.
import { PGlite } from "@electric-sql/pglite";
import { readFile } from "node:fs/promises";
import assert from "node:assert/strict";

const leer = (r) => readFile(r, "utf8");
const BASE = await leer("supabase/migrations/20261105090000_instagram.sql");
const MIG_FOTOS = await leer("supabase/migrations/20261105120000_instagram_fotos.sql");
const MIG_DRIVE = await leer("supabase/migrations/20261105150000_instagram_drive.sql");
const MIG_METRICAS = await leer("supabase/migrations/20261106100000_instagram_metricas.sql");
const MIGRACION = await leer("supabase/migrations/20261110000000_instagram_aprender.sql");
const ROLLBACK = await leer("supabase/rollbacks/20261110000000_instagram_aprender_ROLLBACK.sql");

let comprobaciones = 0;
const ok = (v, msg) => { assert.ok(v, msg); comprobaciones++; };
const igual = (a, b, msg) => { assert.deepEqual(a, b, msg); comprobaciones++; };
const falla = async (p, re, msg) => { await assert.rejects(p, re, msg); comprobaciones++; };

// Andamiaje mínimo de Supabase (el de scripts/test-instagram-servidor.mjs) +
// pg_cron, pg_net y Vault simulados, y las tablas "Platos" y novedades.
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

  -- Carta y novedades (lo justo de sus columnas reales).
  create table public."Platos" (id text primary key, nombre text, categoria text, descripcion text, precio_eur numeric,
    unidad text, featured boolean, activado boolean, restaurante boolean, touza boolean, imagen_url text,
    alergenos_oficiales jsonb, sin_gluten_disponible boolean not null default false);
  create table public.novedades (id uuid primary key default gen_random_uuid(), titulo text not null, tipo text not null,
    descripcion text, activo boolean, fecha_inicio date not null, fecha_fin date, plato_id text);
  -- Datos personales que el contexto NUNCA debe leer.
  create table public.reservas (id serial primary key, nombre text, telefono text, email text);
  grant select on public."Platos", public.novedades to anon, authenticated;
`;

const U = {
  SA: "a0000000-0000-0000-0000-000000000001",
  MKT: "a0000000-0000-0000-0000-000000000002",
  OTRA: "a0000000-0000-0000-0000-000000000003",
  BLOQ: "a0000000-0000-0000-0000-000000000004",
  VER: "a0000000-0000-0000-0000-000000000005",
};
const sesion = (u) => u.replace(/^a/, "b");
const DATOS = `
  insert into auth.users (id, email, banned_until) values
    ('${U.SA}', 'sa@t', null), ('${U.MKT}', 'mkt@t', null), ('${U.OTRA}', 'otra@t', null),
    ('${U.BLOQ}', 'bloq@t', now() + interval '1 day'), ('${U.VER}', 'ver@t', null);
  insert into auth.sessions (id, user_id) select ('b' || substr(id::text, 2))::uuid, id from auth.users;
  insert into public.super_admins values ('${U.SA}');
  insert into public.user_permissions values
    ('${U.MKT}', 'marketing', true, true), ('${U.OTRA}', 'reservas', true, true), ('${U.BLOQ}', 'marketing', true, true),
    ('${U.VER}', 'marketing', true, false);
`;

// ─── 0. Sin las métricas se para sin cambiar nada ───────────────────────────
{
  const otra = new PGlite();
  await otra.exec(ANDAMIAJE + CRON_NET_VAULT);
  await otra.exec(BASE);
  await falla(otra.exec(MIGRACION), /instagram_aprender: falta public\.instagram_metricas_publicacion/, "no se paró sin las métricas");
  await otra.exec("rollback");
  igual((await otra.query("select to_regprocedure('public.instagram_que_funciona(text,text,integer,integer)') f")).rows[0].f, null, "la migración abortada dejó la RPC");
  await otra.close();
}

// ─── 1. Sin la tabla de fotos también se aplica ─────────────────────────────
{
  const otra = new PGlite();
  await otra.exec(ANDAMIAJE + CRON_NET_VAULT);
  for (const m of [BASE, MIG_METRICAS]) await otra.exec(m);
  await otra.exec(MIGRACION);
  const r = (await otra.query("select public.instagram_que_funciona() r")).rows[0].r;
  ok(r.publicaciones === 0 && r.suficiente === false && /Todavía no hay publicaciones/.test(r.aviso), "sin datos: aviso de que no hay publicaciones");
  await otra.close();
}

const db = new PGlite();
await db.exec(ANDAMIAJE + CRON_NET_VAULT);
await db.exec(DATOS);
for (const m of [BASE, MIG_FOTOS, MIG_DRIVE, MIG_METRICAS]) await db.exec(m);
const q = (sql, params) => db.query(sql, params);
async function como(u, fn, rol = "authenticated") {
  await db.exec("begin");
  try {
    if (rol === "anon") {
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

const A = "17841400000000001"; // cuenta de las dos marcas (hoy, @oficiososia)
const B = "17841400000000002"; // otra cuenta

// Una fila de antes de la migración: se completa con la hora local y los hashtags.
await q(`insert into public.instagram_metricas_publicacion (media_id, ig_user_id, fecha_captura, producto, alcance, interacciones, publicado_at, caption)
         values ('9000', '${A}', current_date - 1, 'FEED', 100, 1, timestamptz '2026-07-14 11:30:00+00', 'Pulpo #Pulpo #casa_tomas #pulpo')`);

await db.exec(MIGRACION);
await db.exec(MIGRACION); // idempotente
comprobaciones++;

// ─── 2. Columnas, relleno de lo que había y CHECK ───────────────────────────
{
  const f = (await q("select hashtags, publicado_local::text l from public.instagram_metricas_publicacion where media_id = '9000'")).rows[0];
  igual(f.hashtags, ["#casa_tomas", "#pulpo"], "hashtags de las filas que ya había");
  igual(f.l, "2026-07-14 13:30:00", "hora local de Madrid (verano, +2)");
  const v = (await q("select column_name from information_schema.columns where table_name = 'instagram_metricas_publicacion_ultima' and column_name in ('hashtags','publicado_local','tiempo_medio_ms','tiempo_total_ms','tasa_salto')")).rows;
  igual(v.length, 5, "la vista no lleva las columnas nuevas");
  await q(`insert into public.instagram_metricas_publicacion (media_id, ig_user_id, fecha_captura, caption) values ('9001', '${A}', current_date, repeat('a', 2200))`);
  comprobaciones++;
  await falla(q(`insert into public.instagram_metricas_publicacion (media_id, ig_user_id, fecha_captura, caption) values ('9002', '${A}', current_date, repeat('a', 2201))`),
    /textos_chk/, "texto de más de 2200");
  await falla(q(`insert into public.instagram_metricas_publicacion (media_id, ig_user_id, fecha_captura, tasa_salto) values ('9003', '${A}', current_date, 120)`),
    /aprender_chk/, "tasa de salto de más del 100 %");
  await falla(q(`insert into public.instagram_metricas_publicacion (media_id, ig_user_id, fecha_captura, tiempo_medio_ms) values ('9004', '${A}', current_date, -1)`),
    /aprender_chk/, "tiempo medio negativo");
  await falla(como(U.MKT, () => q(`update public.instagram_metricas_publicacion set hashtags = '{#x}' where media_id = '9000'`)),
    /permission denied/, "el panel escribe métricas");
  await q("delete from public.instagram_metricas_publicacion where media_id in ('9000', '9001')");
}

const RPC = "select public.instagram_que_funciona($1, $2, $3, $4) r";
const qf = (u, marca = null, ig = null, dias = 90, minimo = 3, rol) =>
  como(u, async () => (await q(RPC, [marca, ig, dias, minimo])).rows[0].r, rol);

// ─── 3. Con pocos datos: «faltan datos», sin conclusiones ───────────────────
const LUNES = "date_trunc('week', now() at time zone 'Europe/Madrid')::date";
const REELS_MARTES = (desde, hasta) => `
  insert into public.instagram_metricas_publicacion (media_id, ig_user_id, fecha_captura, producto, tipo_medio, alcance, interacciones, guardados, publicado_at, hashtags, caption)
  select (100 + w)::text, '${A}', current_date, 'REELS', 'VIDEO', 1000, 90, 20,
         ((${LUNES} - w * 7 + 1) + time '13:15') at time zone 'Europe/Madrid', '{#cocido,#casatomas}', E'Cocido de los martes\\n#cocido #casatomas'
    from generate_series(${desde}, ${hasta}) w`;
await q(REELS_MARTES(1, 2));
{
  const r = await qf(U.MKT);
  igual(r.publicaciones, 2, "publicaciones con pocos datos");
  igual(r.suficiente, false, "con 2 publicaciones no hay muestra");
  ok(/Solo hay 2 publicaciones .* hacen falta al menos 6/.test(r.aviso), `aviso de faltan datos: ${r.aviso}`);
  ok(r.conclusiones.length === 6 && r.conclusiones.every((c) => c.estado === "faltan_datos" && /faltan datos/.test(c.texto) && !("clave" in c)),
    "con pocos datos se sacan conclusiones");
  igual([r.mejores, r.peores], [[], []], "mejores y peores sin muestra");
  igual(r.por.formato[0], { clave: "reel", publicaciones: 2, alcance_medio: 1000, tasa: 9, guardados_por_alcance: 2, suficiente: false, orden: 0 }, "grupo de formato");
  igual(r.por.hashtag, undefined, "hashtags sin muestra salen");
}

// ─── 4. Con datos: martes a mediodía, reels y #cocido ───────────────────────
const FOTO = "driveFotoCocido01";
await q(`insert into public.instagram_fotos (marca, ancho, alto, tipo, descripcion, drive_id) values ('casa-tomas', 1080, 1350, 'plato', 'Cocido', '${FOTO}')`);
await q(REELS_MARTES(3, 4));
// Jueves 20:30, plantilla foto-titular con foto de plato (Drive). Dos con pieza_id y dos solo por media_id.
await q(`insert into public.instagram_piezas (id, marca, plantilla, formato, datos, caption, estado, media_id)
         select ('11111111-0000-4000-8000-00000000000' || w)::uuid, 'casa-tomas', 'ct-foto-titular', 'post',
                '{"foto":"drive:${FOTO}"}', 'x', 'publicada', (200 + w)::text from generate_series(1, 4) w`);
await q(`insert into public.instagram_metricas_publicacion (media_id, ig_user_id, fecha_captura, pieza_id, producto, tipo_medio, alcance, interacciones, guardados, publicado_at, hashtags)
         select (200 + w)::text, '${A}', current_date, case when w <= 2 then ('11111111-0000-4000-8000-00000000000' || w)::uuid end,
                'FEED', 'IMAGE', 1000, 40, 5, ((${LUNES} - w * 7 + 3) + time '20:30') at time zone 'Europe/Madrid', '{#casatomas}'
           from generate_series(1, 4) w`);
// Captura vieja de una de ellas: no cuenta (vale la última).
await q(`insert into public.instagram_metricas_publicacion (media_id, ig_user_id, fecha_captura, producto, alcance, interacciones, publicado_at)
         select '201', '${A}', current_date - 3, 'FEED', 10, 10, publicado_at from public.instagram_metricas_publicacion where media_id = '201'`);
// Sábado 21:10, plantilla tipográfica sin foto.
await q(`insert into public.instagram_piezas (id, marca, plantilla, formato, datos, caption, estado, media_id)
         select ('22222222-0000-4000-8000-00000000000' || w)::uuid, 'casa-tomas', 'ct-tipografica', 'post', '{}', 'x', 'publicada', (300 + w)::text
           from generate_series(1, 4) w`);
await q(`insert into public.instagram_metricas_publicacion (media_id, ig_user_id, fecha_captura, pieza_id, producto, alcance, interacciones, guardados, publicado_at)
         select (300 + w)::text, '${A}', current_date, ('22222222-0000-4000-8000-00000000000' || w)::uuid, 'FEED', 800, 24, 2,
                ((${LUNES} - w * 7 + 5) + time '21:10') at time zone 'Europe/Madrid' from generate_series(1, 4) w`);
// Lo que NO debe contar en Casa Tomás / cuenta A / 90 días.
await q(`insert into public.instagram_piezas (id, marca, plantilla, formato, datos, caption, estado, media_id)
         values ('33333333-0000-4000-8000-000000000001', 'touza', 'tz-foto', 'post', '{}', 'x', 'publicada', '401')`);
await q(`insert into public.instagram_metricas_publicacion (media_id, ig_user_id, fecha_captura, pieza_id, producto, alcance, interacciones, publicado_at) values
  ('401', '${A}', current_date, '33333333-0000-4000-8000-000000000001', 'FEED', 500, 5, now() - interval '9 days'),
  ('402', '${B}', current_date, null, 'FEED', 500, 400, now() - interval '9 days'),
  ('403', '${A}', current_date, null, 'FEED', 500, 400, now() - interval '100 days'),
  ('404', '${A}', current_date, null, 'FEED', null, 400, now() - interval '5 days')`);

{
  const r = await qf(U.VER, "casa-tomas", A);
  igual(r.publicaciones, 12, "publicaciones de Casa Tomás en la cuenta A (90 días, con alcance)");
  igual(r.con_pieza, 8, "publicaciones del panel (por pieza_id y por media_id)");
  igual(r.suficiente, true, "muestra suficiente");
  igual(r.aviso, null, "aviso con muestra");
  igual(r.tasa_media, 5.5, "tasa media (616 / 11 200)");
  const c = Object.fromEntries(r.conclusiones.map((x) => [x.eje, x]));
  igual(c.dia.estado, "mejor", "día");
  igual(c.dia.clave, "martes", "el mejor día");
  igual(c.dia.texto, "Los martes funcionan mejor: 9 % de interacción en 4 publicaciones, frente al 5,5 % de media.", "frase del día");
  igual(c.franja.texto, "Publicar entre las 12 y las 14 h funciona mejor: 9 % de interacción en 4 publicaciones, frente al 5,5 % de media.", "frase de la franja");
  igual(c.formato.texto, "Los reels funcionan mejor: 9 % de interacción en 4 publicaciones, frente al 5,5 % de media.", "frase del formato");
  igual([c.hashtag.estado, c.hashtag.clave], ["mejor", "#cocido"], "el mejor hashtag");
  igual(c.plantilla.estado, "parecido", "plantillas sin diferencia clara (4 % y 3 % frente al 5,5 %)");
  ok(/no hay diferencias claras/.test(c.plantilla.texto), "frase de plantilla parecida");
  igual(c.tipo_foto.estado, "faltan_datos", "un solo tipo de foto: faltan datos");
  igual(r.por.tipo_foto.map((g) => [g.clave, g.publicaciones]), [["plato", 4]], "tipo de foto por drive_id");
  igual(r.por.dia.map((g) => g.clave), ["martes", "jueves", "sábado"], "días ordenados por tasa");
  igual(r.por.franja.map((g) => [g.clave, g.orden]), [["12-14", 12], ["20-22", 20]], "franjas de 2 h en hora de Madrid");
  igual(r.por.hashtag.map((g) => g.clave), ["#cocido", "#casatomas"], "hashtags con muestra");
  igual(r.por.plantilla.map((g) => [g.clave, g.tasa]), [["ct-foto-titular", 4], ["ct-tipografica", 3]], "plantillas");
  igual(r.mejores.length, 5, "5 mejores");
  igual(r.mejores[0].formato, "reel", "la mejor es un reel");
  igual(r.mejores[0].gancho, "Cocido de los martes", "gancho = primera línea");
  igual(r.peores.length, 5, "5 peores");
  ok(r.peores.slice(0, 4).every((p) => p.tasa === 3), "las peores son las tipográficas");
  ok(!r.mejores.concat(r.peores).some((p) => ["401", "402", "403", "404"].includes(p.media_id)), "entra lo que no debe");

  const todas = await qf(U.MKT);
  igual(todas.publicaciones, 14, "sin filtros: también TOUZA y la otra cuenta");
  igual((await qf(U.MKT, "touza", A)).publicaciones, 5, "TOUZA en la cuenta A: su pieza y las de fuera del panel");
  igual((await qf(U.MKT, null, B)).publicaciones, 1, "solo la cuenta B");
  igual((await qf(U.MKT, "casa-tomas", A, 120)).publicaciones, 13, "con 120 días entra la de hace 100");
  const exigente = await qf(U.MKT, "casa-tomas", A, 90, 5);
  igual(exigente.suficiente, true, "12 ≥ 2 × 5");
  ok(exigente.conclusiones.every((x) => x.estado === "faltan_datos"), "con un mínimo de 5 por grupo no hay conclusiones");
}

// ─── 5. Permisos ────────────────────────────────────────────────────────────
await falla(qf(U.OTRA), /Sin permiso de Marketing/, "otra sección lee «Qué funciona»");
igual((await qf(U.BLOQ)).publicaciones, 0, "sesión bloqueada ve publicaciones");
await falla(qf(null, null, null, 90, 3, "anon"), /permission denied/, "anon ejecuta la RPC");
await falla(qf(U.MKT, "otra"), /marca debe ser/, "marca rara");
await falla(qf(U.MKT, null, "@cuenta"), /solo dígitos/, "cuenta rara");
await falla(qf(U.MKT, null, null, 1000), /entre 7 y 365/, "días de más");
await falla(qf(U.MKT, null, null, 90, 0), /entre 1 y 50/, "mínimo raro");
ok(!(await q("select prosecdef from pg_proc where proname = 'instagram_que_funciona'")).rows[0].prosecdef, "la RPC no es SECURITY DEFINER");

// ─── 6. Rollback ────────────────────────────────────────────────────────────
{
  await q(`update public.instagram_metricas_publicacion set caption = repeat('b', 900) where media_id = '101'`);
  await db.exec(ROLLBACK);
  igual((await q("select to_regprocedure('public.instagram_que_funciona(text,text,integer,integer)') f")).rows[0].f, null, "el rollback dejó la RPC");
  igual((await q("select count(*)::int n from information_schema.columns where table_name = 'instagram_metricas_publicacion' and column_name in ('hashtags','publicado_local','tiempo_medio_ms','tiempo_total_ms','tasa_salto')")).rows[0].n, 0, "el rollback dejó columnas");
  igual((await q("select char_length(caption) n from public.instagram_metricas_publicacion where media_id = '101'")).rows[0].n, 300, "el rollback no recortó el texto");
  ok((await como(U.MKT, async () => (await q("select count(*)::int n from public.instagram_metricas_publicacion_ultima")).rows[0].n)) > 0, "la vista no funciona tras el rollback");
  await falla(como(null, () => q("select count(*) from public.instagram_metricas_publicacion_ultima"), "anon"), /permission denied/, "anon lee la vista tras el rollback");
  await db.exec(MIGRACION); // se puede volver a aplicar
  comprobaciones++;
}

await db.close();
console.log(`test-instagram-aprender: ${comprobaciones} comprobaciones OK`);
