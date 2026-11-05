// Fechas y campañas de Instagram (20261109000000_instagram_campanas.sql)
// contra un Postgres en memoria (PGlite), con las migraciones REALES de
// Instagram debajo. Nunca toca Supabase.
//
//   npm run test:instagram-campanas:db
//
// Cubre: se para sin instagram_sugerencias_ia; idempotente y sin pisar fechas
// editadas; siembra (anuales con año 2000, «sin verificar» en las locales y de
// temporada, Semana Santa 2027 calculada); marketing_fechas_entre (anuales
// repetidas, las que cruzan el año, marca); RLS de fechas y campañas
// (marketing lee, edición inserta, nadie borra, campañas solo por RPC, sesión
// bloqueada y otra sección no ven, anon nada); el panel no puede falsear
// origen ni campana_id de una pieza; instagram_ia_contexto (carta sin precios
// y featured primero, novedades del periodo, fechas, fotos, métricas por
// formato/franja/tipo de foto, historial; nunca reservas); aceptar crea
// BORRADORES con fecha prevista y NUNCA programa; validaciones de aceptar
// (fuera de rango, plantilla de otra marca, dos veces, sin permiso);
// descartar; tipos nuevos de sugerencia; y el rollback.
import { PGlite } from "@electric-sql/pglite";
import { readFile } from "node:fs/promises";
import assert from "node:assert/strict";

const leer = (r) => readFile(r, "utf8");
const BASE = await leer("supabase/migrations/20261105090000_instagram.sql");
const MIG_FOTOS = await leer("supabase/migrations/20261105120000_instagram_fotos.sql");
const MIG_DRIVE = await leer("supabase/migrations/20261105150000_instagram_drive.sql");
const MIG_METRICAS = await leer("supabase/migrations/20261106100000_instagram_metricas.sql");
const MIG_PROG = await leer("supabase/migrations/20261106110000_instagram_programacion.sql");
const MIG_SERVIDOR = await leer("supabase/migrations/20261107000000_instagram_publicacion_servidor.sql");
const MIG_IA = await leer("supabase/migrations/20261108000000_instagram_ia.sql");
const MIGRACION = await leer("supabase/migrations/20261109000000_instagram_campanas.sql");
const ROLLBACK = await leer("supabase/rollbacks/20261109000000_instagram_campanas_ROLLBACK.sql");

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
  insert into public."Platos" (id, nombre, categoria, descripcion, precio_eur, featured, activado, restaurante, touza, imagen_url) values
    ('pulpo', 'Pulpo a la gallega', 'Del mar', 'Pulpo con cachelos', 22.5, true, true, true, false, 'https://x/pulpo.jpg'),
    ('croquetas', 'Croquetas de jamón', 'Entrantes', null, 12, false, true, true, false, null),
    ('baja', 'Plato dado de baja', 'Entrantes', null, 9, true, false, true, false, null),
    ('vermu', 'Vermú de la casa', 'Barra', null, 5, false, true, false, true, null);
  insert into public.novedades (titulo, tipo, descripcion, activo, fecha_inicio, fecha_fin) values
    ('Menú de castañas', 'evento', 'Solo en noviembre', true, '2026-11-01', '2026-11-30'),
    ('Novedad vieja', 'evento', null, true, '2026-01-01', '2026-01-31'),
    ('Novedad apagada', 'evento', null, false, '2026-11-01', '2026-11-30');
  insert into public.reservas (nombre, telefono, email) values ('Ana Cliente', '612345678', 'ana@correo.es');
`;

// ─── 0. Sin la migración de la IA se para sin crear nada ────────────────────
{
  const otra = new PGlite();
  await otra.exec(ANDAMIAJE + CRON_NET_VAULT);
  await otra.exec(BASE);
  await falla(otra.exec(MIGRACION), /instagram_campanas: falta public\.instagram_sugerencias_ia/, "no se paró sin la IA");
  await otra.exec("rollback");
  igual((await otra.query("select to_regclass('public.marketing_fechas') t")).rows[0].t, null, "la migración abortada dejó tablas");
  await otra.close();
}

// ─── 1. Sin métricas, fotos ni programación también se aplica ───────────────
{
  const otra = new PGlite();
  await otra.exec(ANDAMIAJE + CRON_NET_VAULT);
  await otra.exec(BASE);
  await otra.exec(MIG_IA);
  await otra.exec(MIGRACION);
  const c = (await otra.query("select public.instagram_ia_contexto('casa-tomas', '2026-11-09', '2026-11-29') c")).rows[0].c;
  ok(c.metricas === null && Array.isArray(c.fotos) && c.fotos.length === 0, "sin métricas ni fotos, el contexto falló");
  await otra.close();
}

const db = new PGlite();
await db.exec(ANDAMIAJE + CRON_NET_VAULT);
await db.exec(DATOS);
for (const m of [BASE, MIG_FOTOS, MIG_DRIVE, MIG_METRICAS, MIG_PROG, MIG_SERVIDOR, MIG_IA]) await db.exec(m);
await db.exec(MIGRACION);
await db.exec(MIGRACION); // idempotente
comprobaciones++;

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

// ─── 2. Siembra ─────────────────────────────────────────────────────────────
{
  const filas = (await q("select clave, ambito, anual, desde, hasta, verificacion, marcas from public.marketing_fechas")).rows;
  ok(filas.length >= 25, "faltan fechas sembradas");
  for (const a of ["galicia", "temporada", "crevillent", "alicante", "comercial"]) ok(filas.some((f) => f.ambito === a), `falta el ámbito ${a}`);
  const por = Object.fromEntries(filas.map((f) => [f.clave, f]));
  igual(por["crevillent-moros-cristianos"].verificacion, "sin verificar", "Moros y Cristianos tendría que ir sin verificar");
  ok(filas.filter((f) => f.ambito === "temporada").every((f) => f.verificacion === "sin verificar"), "una temporada va como verificada");
  igual(por["galicia-dia-de-galicia"].verificacion, "verificada", "el 25 de julio es fijo");
  igual(String(por["crevillent-semana-santa-2027"].hasta.toISOString().slice(0, 10)), "2027-03-28", "Pascua de 2027");
  ok(filas.filter((f) => f.anual).every((f) => f.desde.getUTCFullYear() === 2000), "una anual sin el año 2000");
  ok(!/reserv/i.test(JSON.stringify((await q("select idea from public.marketing_fechas where 'touza' = any (marcas)")).rows)), "una fecha de TOUZA habla de reservar");
  ok(!/\p{Extended_Pictographic}/u.test(JSON.stringify((await q("select titulo, idea from public.marketing_fechas")).rows)), "la siembra lleva emoji");
  await falla(q("insert into public.marketing_fechas (clave, titulo, ambito, desde, hasta, anual) values ('x', 'x', 'galicia', '2027-01-01', '2027-01-02', true)"),
    /marketing_fechas_rango_chk/, "anual sin el año 2000");
  await falla(q("insert into public.marketing_fechas (titulo, ambito, desde, hasta) values ('x', 'luna', '2000-01-01', '2000-01-02')"), /ambito_chk/, "ámbito raro");
  await falla(q("insert into public.marketing_fechas (titulo, ambito, desde, hasta, marcas) values ('x', 'propio', '2000-01-01', '2000-01-02', '{bar}')"), /marcas_chk/, "marca rara");
}

// ─── 3. marketing_fechas_entre ──────────────────────────────────────────────
{
  const entre = async (d, h, m) => (await q("select clave, desde::text, hasta::text from public.marketing_fechas_entre($1, $2, $3)", [d, h, m])).rows;
  const nov = await entre("2026-11-09", "2026-11-29", "casa-tomas");
  const claves = nov.map((f) => f.clave);
  ok(claves.includes("galicia-san-martin") && claves.includes("temporada-setas") && claves.includes("comercial-comidas-empresa"), "faltan fechas de noviembre");
  const marisco = nov.find((f) => f.clave === "temporada-marisco-meses-r");
  igual([marisco.desde, marisco.hasta], ["2026-09-01", "2027-04-30"], "la que cruza el año no se calcula bien");
  ok(!claves.includes("comercial-nochevieja"), "sale una fecha fuera del rango");
  ok(!(await entre("2026-11-09", "2026-11-29", "touza")).some((f) => f.clave === "galicia-san-martin"), "a TOUZA le sale una fecha solo de Casa Tomás");
  ok((await entre("2027-03-15", "2027-03-31", "casa-tomas")).some((f) => f.clave === "crevillent-semana-santa-2027"), "falta la Semana Santa de 2027");
  ok(!(await entre("2028-03-15", "2028-04-30", "casa-tomas")).some((f) => f.clave === "crevillent-semana-santa-2027"), "la de 2027 sale en 2028");
  ok((await entre("2027-01-01", "2027-01-03", "touza")).some((f) => f.clave === "comercial-regalo-experiencia"), "falta la de diciembre-enero en enero");
}

// ─── 4. RLS de las fechas ───────────────────────────────────────────────────
{
  const ver = (u, rol) => como(u, async () => (await q("select count(*)::int n from public.marketing_fechas")).rows[0].n, rol);
  ok((await ver(U.MKT)) >= 25 && (await ver(U.VER)) >= 25, "marketing no lee las fechas");
  igual(await ver(U.OTRA), 0, "otra sección lee las fechas");
  igual(await ver(U.BLOQ), 0, "sesión bloqueada lee las fechas");
  await falla(ver(null, "anon"), /permission denied/, "anon lee las fechas");
  const nueva = await como(U.MKT, async () => (await q(
    "insert into public.marketing_fechas (titulo, ambito, marcas, desde, hasta, anual, idea) values ('Aniversario', 'propio', '{casa-tomas}', '2000-09-15', '2000-09-15', true, 'Cumplimos años') returning id, clave, actualizado_por")).rows[0]);
  ok(nueva.clave.startsWith("propia-") && nueva.actualizado_por === U.MKT, "alta propia sin clave o sin autor");
  await falla(como(U.VER, () => q("insert into public.marketing_fechas (titulo, ambito, desde, hasta) values ('x', 'propio', '2000-01-01', '2000-01-01')")),
    /row-level security/, "solo ver añade fechas");
  igual(await como(U.MKT, async () => (await q("update public.marketing_fechas set activo = false, verificacion = 'verificada' where clave = 'crevillent-moros-cristianos' returning activo")).rows), [{ activo: false }], "marketing no desactiva");
  await falla(como(U.MKT, () => q("update public.marketing_fechas set clave = 'otra' where clave = 'galicia-magosto'")), /permission denied/, "se cambió la clave");
  await falla(como(U.SA, () => q("delete from public.marketing_fechas")), /permission denied/, "se borran fechas desde el panel");
  // Volver a aplicar no pisa la fila editada.
  await db.exec(MIGRACION);
  igual((await q("select activo, verificacion from public.marketing_fechas where clave = 'crevillent-moros-cristianos'")).rows[0], { activo: false, verificacion: "verificada" }, "volver a aplicar pisó la fecha editada");
  ok(!(await q("select clave from public.marketing_fechas_entre('2026-10-01', '2026-10-31', 'casa-tomas')")).rows.some((f) => f.clave === "crevillent-moros-cristianos"), "sale una fecha desactivada");
}

// ─── 5. Contexto para la IA ─────────────────────────────────────────────────
const PIEZA_PUB = "11111111-0000-4000-8000-000000000001";
const DRIVE = "driveFotoPulpo01";
await q(`insert into public.instagram_fotos (marca, ancho, alto, tipo, descripcion, drive_id) values ('casa-tomas', 1080, 1350, 'plato', 'Pulpo en plato de madera', '${DRIVE}')`);
await q(`insert into public.instagram_piezas (id, marca, plantilla, formato, datos, caption, estado, media_id)
         values ('${PIEZA_PUB}', 'casa-tomas', 'ct-foto-titular', 'post', '{"foto":"drive:${DRIVE}"}', E'El pulpo de casa.\\nMás texto', 'publicada', '178')`);
await q(`insert into public.instagram_metricas_publicacion (media_id, ig_user_id, fecha_captura, pieza_id, alcance, interacciones, guardados, publicado_at)
         values ('178', '1', current_date, '${PIEZA_PUB}', 1000, 80, 12, now() - interval '3 days')`);
{
  const ctx = (u, m = "casa-tomas", d = "2026-11-09", h = "2026-11-29") =>
    como(u, async () => (await q("select public.instagram_ia_contexto($1, $2, $3) c", [m, d, h])).rows[0].c);
  const c = await ctx(U.MKT);
  igual(c.carta.map((p) => p.id), ["pulpo", "croquetas"], "carta: featured primero, solo activos y de la marca");
  ok(!JSON.stringify(c.carta).includes("precio") && !JSON.stringify(c.carta).includes("22.5"), "el contexto lleva precios");
  ok(c.carta[0].tiene_foto === true && c.carta[1].tiene_foto === false, "tiene_foto");
  igual(c.novedades.map((n) => n.titulo), ["Menú de castañas"], "novedades del periodo");
  ok(c.fechas.some((f) => f.titulo === "San Martín y la matanza"), "faltan fechas en el contexto");
  igual(c.fotos, [{ id: `drive:${DRIVE}`, tipo: "plato", descripcion: "Pulpo en plato de madera" }], "fotos de la biblioteca");
  igual(c.metricas.publicaciones, 1, "métricas");
  igual(c.metricas.por.tipo_foto[0].clave, "plato", "métricas por tipo de foto");
  igual(c.metricas.por.formato[0].tasa, 8, "tasa de interacción");
  ok(c.metricas.por.franja?.length === 1 && /^\d{2}:00-\d{2}:00$/.test(c.metricas.por.franja[0].clave), "métricas por franja");
  igual(c.historial, [{ plantilla: "ct-foto-titular", formato: "post", gancho: "El pulpo de casa." }], "historial de ganchos");
  ok(!/612345678|ana@correo|Ana Cliente/.test(JSON.stringify(c)), "el contexto lleva datos de clientes");
  const t = await ctx(U.MKT, "touza");
  igual(t.carta.map((p) => p.id), ["vermu"], "carta de TOUZA");
  igual(t.novedades, [], "TOUZA no lleva las novedades del restaurante");
  igual(t.metricas, null, "TOUZA con métricas de Casa Tomás");
  await falla(ctx(U.OTRA), /Sin permiso de Marketing/, "otra sección lee el contexto");
  await falla(ctx(U.MKT, "otra"), /marca debe ser/, "marca rara");
  await falla(ctx(U.MKT, "casa-tomas", "2026-11-01", "2027-02-01"), /como mucho 62 días/, "rango enorme");
  await falla(como(null, () => q("select public.instagram_ia_contexto('casa-tomas', '2026-11-09', '2026-11-10')"), "anon"),
    /permission denied/, "anon lee el contexto");
}

// ─── 6. Campañas: insertar (como la función, con el JWT) y RLS ──────────────
const HOY = (await q("select (now() at time zone 'Europe/Madrid')::date::text d")).rows[0].d;
const dia = (n) => new Date(Date.parse(`${HOY}T12:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
const PROPUESTA = {
  fases: [{ nombre: "Anuncio", desde: dia(3), hasta: dia(9) }],
  piezas: [
    { fecha: dia(3), hora: "13:00", formato: "post", plantilla: "ct-foto-titular", platoId: "pulpo", foto: "carta:pulpo", faltaFoto: false,
      antetitulo: "Esta semana", titular: "El pulpo de casa", caption: "El pulpo de casa, como siempre.", hashtags: ["#CasaTomás", "#Pulpo"], altText: "Pulpo con cachelos." },
    { fecha: dia(5), hora: "20:30", formato: "story", plantilla: "ct-tipografica", platoId: null, foto: null, faltaFoto: false,
      titular: "Noches de otoño", caption: "Te esperamos.", hashtags: [], altText: "" },
    { fecha: dia(8), hora: "13:00", formato: "post", plantilla: "ct-foto-titular", platoId: "croquetas", foto: null, faltaFoto: true,
      titular: "Croquetas de la casa", caption: "Croquetas.", hashtags: ["#Croquetas"], altText: "Croquetas." },
  ],
};
const INSERTAR = (desde = dia(2), hasta = dia(20), propuesta = PROPUESTA, marca = "casa-tomas") => `
  insert into public.instagram_campanas (marca, titulo, objetivo, desde, hasta, propuesta, modelo)
  values ('${marca}', 'Temporada de otoño', 'Llenar los mediodías', '${desde}', '${hasta}', '${JSON.stringify(propuesta).replace(/'/g, "''")}', 'gpt-5.6-luna')
  returning id, estado, creado_por`;
const camp = (await como(U.MKT, async () => (await q(INSERTAR())).rows))[0];
igual({ estado: camp.estado, creado_por: camp.creado_por }, { estado: "propuesta", creado_por: U.MKT }, "campaña insertada");
await falla(como(U.VER, () => q(INSERTAR())), /row-level security/, "solo ver inserta campañas");
await falla(como(U.OTRA, () => q(INSERTAR())), /row-level security/, "otra sección inserta campañas");
await falla(como(null, () => q(INSERTAR()), "anon"), /permission denied/, "anon inserta campañas");
await falla(como(U.MKT, () => q(`insert into public.instagram_campanas (marca, titulo, desde, hasta, estado) values ('touza', 'x', '${dia(1)}', '${dia(14)}', 'aceptada')`)),
  /permission denied/, "el panel crea una campaña ya aceptada");
await falla(como(U.MKT, () => q(`update public.instagram_campanas set estado = 'aceptada' where id = '${camp.id}'`)), /permission denied/, "se acepta sin RPC");
await falla(como(U.SA, () => q(`delete from public.instagram_campanas where id = '${camp.id}'`)), /permission denied/, "se borran campañas");
await falla(q(INSERTAR(dia(2), dia(40))), /instagram_campanas_fechas_chk/, "campaña de más de 4 semanas");
igual(await como(U.OTRA, async () => (await q("select count(*)::int n from public.instagram_campanas")).rows[0].n), 0, "otra sección lee campañas");
igual(await como(U.BLOQ, async () => (await q("select count(*)::int n from public.instagram_campanas")).rows[0].n), 0, "sesión bloqueada lee campañas");

// ─── 7. Aceptar: crea BORRADORES y nunca programa ───────────────────────────
{
  const aceptar = (u, id, piezas = null) =>
    como(u, async () => (await q("select public.instagram_aceptar_campana($1, $2) r", [id, piezas])).rows[0].r);
  await falla(aceptar(U.VER, camp.id), /Sin permiso de Marketing/, "solo ver acepta");
  await falla(aceptar(U.BLOQ, camp.id), /Sesión de panel no válida/, "sesión bloqueada acepta");
  await falla(aceptar(U.MKT, camp.id, [0, 7]), /fuera de la campaña/, "índice fuera de la campaña");
  await falla(aceptar(U.MKT, camp.id, []), /al menos una pieza/, "sin piezas");
  const r = await aceptar(U.MKT, camp.id, [0, 2]);
  ok(r.ok && r.piezas.length === 2, "aceptar no devolvió las piezas");
  const piezas = (await q(`select estado, origen, campana_id, marca, plantilla, formato, datos, caption, alt_text, creado_por,
                             to_char(fecha_prevista at time zone 'Europe/Madrid', 'YYYY-MM-DD HH24:MI') fp
                           from public.instagram_piezas where campana_id = $1 order by fecha_prevista`, [camp.id])).rows;
  igual(piezas.map((p) => p.estado), ["borrador", "borrador"], "no son borradores");
  igual(piezas.map((p) => p.origen), ["ia", "ia"], "origen");
  igual(piezas.map((p) => p.fp), [`${dia(3)} 13:00`, `${dia(8)} 13:00`], "fecha prevista en hora de Madrid");
  igual(piezas[0].datos, { marca: "casa-tomas", plantilla: "ct-foto-titular", formato: "post", foto: "carta:pulpo", antetitulo: "Esta semana", titular: "El pulpo de casa" }, "datos del borrador");
  ok(!("foto" in piezas[1].datos), "la pieza sin foto lleva foto");
  igual(piezas[0].caption, "El pulpo de casa, como siempre.\n\n#CasaTomás #Pulpo", "texto + hashtags");
  igual(piezas[0].creado_por, U.MKT, "creado_por");
  igual((await q("select count(*)::int n from public.instagram_programaciones")).rows[0].n, 0, "aceptar PROGRAMÓ algo");
  igual((await q(`select estado, piezas_aceptadas, decidida_por from public.instagram_campanas where id = $1`, [camp.id])).rows[0],
    { estado: "aceptada", piezas_aceptadas: 2, decidida_por: U.MKT }, "estado de la campaña");
  await falla(aceptar(U.MKT, camp.id), /ya está aceptada/, "se aceptó dos veces");

  // Validaciones: pieza fuera de rango, plantilla de otra marca, campaña terminada.
  const mala = (pieza) => ({ piezas: [{ ...PROPUESTA.piezas[0], ...pieza }] });
  for (const [pieza, re, msg] of [
    [{ fecha: dia(30) }, /cae fuera de la campaña/, "fecha fuera de rango"],
    [{ plantilla: "tz-foto-titular" }, /plantilla de la marca/, "plantilla de otra marca"],
    [{ formato: "reel" }, /formato válido/, "formato raro"],
    [{ hora: "25:00" }, /hora válida/, "hora rara"],
    [{ foto: "https://evil/x.jpg" }, /foto no válida/, "foto rara"],
  ]) {
    const c2 = (await como(U.MKT, async () => (await q(INSERTAR(dia(2), dia(20), mala(pieza)))).rows))[0];
    await falla(aceptar(U.MKT, c2.id), re, msg);
  }
  const vieja = (await q(`insert into public.instagram_campanas (marca, titulo, desde, hasta, propuesta) values ('casa-tomas', 'x', '${dia(-20)}', '${dia(-2)}', '${JSON.stringify(PROPUESTA)}') returning id`)).rows[0];
  await falla(aceptar(U.MKT, vieja.id), /ya ha terminado/, "campaña terminada");

  // Descartar.
  const c3 = (await como(U.MKT, async () => (await q(INSERTAR())).rows))[0];
  igual((await como(U.MKT, async () => (await q("select public.instagram_descartar_campana($1) r", [c3.id])).rows[0].r)).ok, true, "descartar");
  await falla(aceptar(U.MKT, c3.id), /ya está descartada/, "se aceptó una descartada");
  await falla(como(U.VER, () => q("select public.instagram_descartar_campana($1)", [c3.id])), /Sin permiso/, "solo ver descarta");
}

// ─── 8. El panel no falsea origen ni campaña de una pieza ───────────────────
{
  const p = (await como(U.MKT, async () => (await q(
    `insert into public.instagram_piezas (marca, plantilla, formato, datos, origen, campana_id, fecha_prevista)
     values ('casa-tomas', 'ct-tipografica', 'post', '{}', 'ia', '${camp.id}', now() + interval '3 days') returning id, origen, campana_id, fecha_prevista`)).rows[0]));
  igual({ origen: p.origen, campana_id: p.campana_id }, { origen: "manual", campana_id: null }, "el panel falseó origen o campaña");
  ok(p.fecha_prevista !== null, "el panel no pudo poner la fecha prevista");
  const borrador = (await q("select id from public.instagram_piezas where campana_id = $1 limit 1", [camp.id])).rows[0].id;
  const r = (await como(U.MKT, async () => (await q(
    `update public.instagram_piezas set origen = 'manual', fecha_prevista = now() + interval '5 days' where id = $1 returning origen, campana_id`, [borrador])).rows[0]));
  igual(r, { origen: "ia", campana_id: camp.id }, "el panel cambió el origen");
  igual((await como(U.MKT, async () => (await q("update public.instagram_piezas set campana_id = null where id = $1 returning campana_id", [borrador])).rows[0])).campana_id, null, "no se puede soltar de la campaña");
}

// ─── 9. Tipos nuevos de sugerencia ──────────────────────────────────────────
await como(U.MKT, () => q("insert into public.instagram_sugerencias_ia (tipo, marca, modelo) values ('proponer_campana', 'touza', 'gpt-5.6-luna'), ('ideas_semana', 'casa-tomas', 'gpt-5.6-luna')"));
comprobaciones++;
await falla(q("insert into public.instagram_sugerencias_ia (tipo, marca, modelo) values ('otra_cosa', 'touza', 'm')"), /tipo_chk/, "tipo raro");

// ─── 10. Rollback ───────────────────────────────────────────────────────────
{
  const antes = (await q("select count(*)::int n from public.instagram_piezas")).rows[0].n;
  await db.exec(ROLLBACK);
  igual((await q("select to_regclass('public.marketing_fechas') a, to_regclass('public.instagram_campanas') b")).rows[0], { a: null, b: null }, "el rollback dejó tablas");
  igual((await q("select count(*)::int n from information_schema.columns where table_name = 'instagram_piezas' and column_name in ('fecha_prevista', 'campana_id', 'origen')")).rows[0].n, 0, "el rollback dejó columnas");
  igual((await q("select count(*)::int n from public.instagram_piezas")).rows[0].n, antes, "el rollback borró borradores");
  igual((await q("select count(*)::int n from public.instagram_sugerencias_ia where tipo in ('proponer_campana', 'ideas_semana')")).rows[0].n, 0, "el rollback dejó sugerencias nuevas");
  await falla(q("insert into public.instagram_sugerencias_ia (tipo, marca, modelo) values ('ideas_semana', 'touza', 'm')"), /tipo_chk/, "el rollback no restauró el CHECK");
  await db.exec(MIGRACION); // se puede volver a aplicar
  comprobaciones++;
}

await db.close();
console.log(`test-instagram-campanas: ${comprobaciones} comprobaciones OK`);
