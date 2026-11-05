// Carruseles de Instagram (migración 20261112000000_instagram_carrusel)
// contra un Postgres en memoria (PGlite) con TODAS las migraciones reales de
// Instagram (hasta 20261111000000_instagram_seguridad). Nunca toca Supabase.
//
//   · instagram_piezas admite tipo_medio/formato «carrusel» con 2–10
//     diapositivas válidas (rutas de SU pieza, alt_text ≤ 1000).
//   · Estado solo por el servidor: el panel no escribe drive_ids ni publica.
//   · Escribir exige «Editar» (can_edit_section), como el resto.
//   · instagram_programar acepta caption y textos alternativos en la llamada.
//   · Pieza programada: sus imágenes no cambian ni se borran del cubo.
//   · La limpieza diaria devuelve TODAS las imágenes del carrusel.
//   · Rollback y vuelta a aplicar.
//
//   npm run test:instagram-carrusel:db
import { PGlite } from "@electric-sql/pglite";
import { readFile } from "node:fs/promises";
import assert from "node:assert/strict";

const leer = (r) => readFile(r, "utf8");
const ANTERIORES = await Promise.all([
  "20261105090000_instagram",
  "20261105120000_instagram_fotos",
  "20261105150000_instagram_drive",
  "20261106100000_instagram_metricas",
  "20261106110000_instagram_programacion",
  "20261107000000_instagram_publicacion_servidor",
  "20261107010000_instagram_limpieza_bucket",
  "20261108000000_instagram_ia",
  "20261109000000_instagram_campanas",
  "20261109100000_instagram_video",
  "20261110000000_instagram_aprender",
  "20261110100000_instagram_encargos",
].map((m) => leer(`supabase/migrations/${m}.sql`)));
const SEGURIDAD = await leer("supabase/migrations/20261111000000_instagram_seguridad.sql");
const MIGRACION = await leer("supabase/migrations/20261112000000_instagram_carrusel.sql");
const ROLLBACK = await leer("supabase/rollbacks/20261112000000_instagram_carrusel_ROLLBACK.sql");

let comprobaciones = 0;
const ok = (v, msg) => { assert.ok(v, msg); comprobaciones++; };
const igual = (a, b, msg) => { assert.deepEqual(a, b, msg); comprobaciones++; };
const falla = async (p, re, msg) => { await assert.rejects(p, re, msg); comprobaciones++; };

// Andamiaje de Supabase. OJO: can_write_section mira «view» (como en el panel
// real, 20260918120000) y can_edit_section mira «edit» (20261001170000).
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
  create function public.can_edit_section(_section text) returns boolean language sql stable security definer set search_path = ''
    as $f$ select public.has_section_permission((select auth.uid()), _section, 'edit') $f$;
  grant execute on function public.is_super_admin(uuid), public.has_section_permission(uuid, text, text),
    public.can_read_section(text), public.can_write_section(text), public.can_edit_section(text) to authenticated, service_role;
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

  create schema storage;
  create table storage.buckets (id text primary key, name text, public boolean default false,
    file_size_limit bigint, allowed_mime_types text[]);
  create table storage.objects (id uuid primary key default gen_random_uuid(),
    bucket_id text references storage.buckets (id), name text, owner uuid default auth.uid(),
    metadata jsonb, created_at timestamptz not null default now(), unique (bucket_id, name));
  alter table storage.objects enable row level security;
  grant usage on schema storage to anon, authenticated, service_role;
  grant select, insert, update, delete on storage.objects to anon, authenticated;
  grant all on storage.objects, storage.buckets to service_role;

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

  create table public."Platos" (id text primary key, nombre text, categoria text, descripcion text, precio_eur numeric,
    unidad text, featured boolean, activado boolean, restaurante boolean, touza boolean, imagen_url text,
    alergenos_oficiales jsonb, sin_gluten_disponible boolean not null default false);
  create table public.novedades (id uuid primary key default gen_random_uuid(), titulo text not null, tipo text not null,
    descripcion text, activo boolean, fecha_inicio date not null, fecha_fin date, plato_id text);
  grant select on public."Platos", public.novedades to anon, authenticated;
  create table public.notificaciones_dashboard (id uuid primary key default gen_random_uuid(), tipo text not null, titulo text not null,
    mensaje text, referencia_id uuid, referencia_tipo text, leida boolean not null default false, created_at timestamptz default now(),
    origen text, prioridad text not null default 'normal');
`;

const U = {
  SA: "a0000000-0000-0000-0000-000000000001",
  EDI: "a0000000-0000-0000-0000-000000000002", // Marketing: ver y editar
  VER: "a0000000-0000-0000-0000-000000000003", // Marketing: solo ver
  AGE: "a0000000-0000-0000-0000-000000000004", // Agencia: ver y editar
  AGV: "a0000000-0000-0000-0000-000000000005", // Agencia: solo ver
  REN: "a0000000-0000-0000-0000-000000000006", // Trabajador de render: solo instagram_render (editar)
  RNV: "a0000000-0000-0000-0000-000000000007", // instagram_render solo ver
};
const sesion = (u) => u.replace(/^a/, "b");
const DATOS = `
  insert into auth.users (id, email) values
    ('${U.SA}', 'sa@t'), ('${U.EDI}', 'edi@t'), ('${U.VER}', 'ver@t'), ('${U.AGE}', 'age@t'), ('${U.AGV}', 'agv@t'),
    ('${U.REN}', 'render@t'), ('${U.RNV}', 'rnv@t');
  insert into auth.sessions (id, user_id) select ('b' || substr(id::text, 2))::uuid, id from auth.users;
  insert into public.super_admins values ('${U.SA}');
  insert into public.user_permissions values
    ('${U.EDI}', 'marketing', true, true), ('${U.VER}', 'marketing', true, false),
    ('${U.AGE}', 'instagram_agencia', true, true), ('${U.AGV}', 'instagram_agencia', true, false),
    ('${U.REN}', 'instagram_render', true, true), ('${U.RNV}', 'instagram_render', true, false);
`;

// ─── 0. Sin la migración de seguridad se para sin cambiar nada ──────────────
{
  const otra = new PGlite();
  await otra.exec(ANDAMIAJE);
  for (const m of ANTERIORES) await otra.exec(m);
  await falla(otra.exec(MIGRACION), /instagram_carrusel: falta public\.instagram_objeto_bloqueado/, "no se paró sin 20261111000000");
  await otra.exec("rollback");
  igual((await otra.query("select count(*)::int n from pg_attribute where attrelid = 'public.instagram_piezas'::regclass and attname = 'diapositivas'")).rows[0].n,
    0, "la migración abortada dejó columnas");
  await otra.close();
}

const db = new PGlite();
await db.exec(ANDAMIAJE);
await db.exec(DATOS);
for (const m of ANTERIORES) await db.exec(m);
await db.exec(SEGURIDAD);
await db.exec(MIGRACION);
await db.exec(MIGRACION); // idempotente
comprobaciones++;

const q = (sql, params) => db.query(sql, params);
const n = async (sql, params) => (await q(sql, params)).rows[0].n;

async function como(u, fn) {
  await db.exec("begin");
  try {
    if (u === "service") {
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
const rpcNombrada = (u, fn, args) =>
  como(u, () => q(`select public.${fn}(${Object.keys(args).map((k, i) => `${k} => $${i + 1}`).join(", ")}) r`, Object.values(args))).then((r) => r.rows[0].r);
const subir = (u, nombre) =>
  como(u, () => q("insert into storage.objects (bucket_id, name, metadata) values ('instagram', $1, '{}')", [nombre]));
const borrar = (u, nombre) =>
  como(u, () => q("delete from storage.objects where bucket_id = 'instagram' and name = $1 returning id", [nombre])).then((r) => r.rows.length);
const MES = new Date().toISOString().slice(0, 7);
const MANANA = new Date(Date.now() + 26 * 3600_000).toISOString();

const C1 = "c0000000-0000-4000-8000-0000000000c1";
const C2 = "c0000000-0000-4000-8000-0000000000c2";
const ruta = (id, i) => `piezas/${MES}/${id}-${String(i).padStart(2, "0")}.jpg`;
const diapositiva = (id, i, extra = {}) => ({
  foto: `drive:foto${i}`,
  plantilla: "ct-foto-titular",
  datos: { marca: "casa-tomas", plantilla: "ct-foto-titular", formato: "post", foto: `drive:foto${i}`, titular: `Producto ${i}` },
  alt_text: `Foto ${i} del producto`,
  imagen_ruta: ruta(id, i),
  ...extra,
});
const diapositivas = (id, k) => Array.from({ length: k }, (_, i) => diapositiva(id, i + 1));
const insertar = (u, id, d, extra = {}) =>
  como(u, () => q(
    `insert into public.instagram_piezas (id, marca, plantilla, formato, tipo_medio, estado, caption, imagen_ruta, datos, diapositivas)
     values ($1, 'casa-tomas', 'ct-foto-titular', $2, $3, 'generada', 'Llegó fresco #casatomas', $4, $5, $6)`,
    [id, extra.formato ?? "carrusel", extra.tipo ?? "carrusel", "imagen" in extra ? extra.imagen : d?.[0]?.imagen_ruta ?? null,
      JSON.stringify(d?.[0]?.datos ?? {}), d === null ? null : JSON.stringify(d)]));

// ─── 1. Forma del carrusel ──────────────────────────────────────────────────
await insertar(U.EDI, C1, diapositivas(C1, 6));
igual(await n("select jsonb_array_length(diapositivas)::int n from public.instagram_piezas where id = $1", [C1]), 6, "no guardó las 6 diapositivas");
await falla(insertar(U.VER, C2, diapositivas(C2, 3)), /row-level security/, "quien solo ve creó un carrusel");
await falla(insertar(U.EDI, C2, diapositivas(C2, 1)), /instagram_piezas_diapositivas_chk/, "aceptó un carrusel de 1 imagen");
await falla(insertar(U.EDI, C2, diapositivas(C2, 11)), /instagram_piezas_diapositivas_chk/, "aceptó un carrusel de 11 imágenes");
await falla(insertar(U.EDI, C2, [diapositiva(C2, 1), diapositiva(C2, 2, { imagen_ruta: ruta(C1, 2) })]),
  /instagram_piezas_diapositivas_chk/, "aceptó la ruta de otra pieza");
await falla(insertar(U.EDI, C2, [diapositiva(C2, 1), diapositiva(C2, 2, { imagen_ruta: ruta(C2, 5) })]),
  /instagram_piezas_diapositivas_chk/, "aceptó una ruta fuera de su posición");
await falla(insertar(U.EDI, C2, [diapositiva(C2, 1), diapositiva(C2, 2, { alt_text: "x".repeat(1001) })]),
  /instagram_piezas_diapositivas_chk/, "aceptó un alt_text de 1001");
await falla(insertar(U.EDI, C2, [diapositiva(C2, 1), diapositiva(C2, 2, { plantilla: "../x" })]),
  /instagram_piezas_diapositivas_chk/, "aceptó una plantilla rara");
await falla(insertar(U.EDI, C2, diapositivas(C2, 2), { imagen: ruta(C2, 2) }), /instagram_piezas_diapositivas_chk/, "la portada no es la primera");
await falla(insertar(U.EDI, C2, diapositivas(C2, 2), { formato: "post" }), /instagram_piezas_tipo_medio_chk/, "carrusel con formato post");
await falla(insertar(U.EDI, C2, diapositivas(C2, 2), { formato: "post", tipo: "imagen" }), /instagram_piezas_diapositivas_chk/, "diapositivas en una imagen");
await insertar(U.EDI, C2, diapositivas(C2, 3));
comprobaciones++;

// ─── 2. Solo el servidor: drive_ids, estado, tipo ───────────────────────────
await falla(como(U.EDI, () => q("update public.instagram_piezas set drive_ids = array['1abc'] where id = $1", [C1])),
  /Solo el servidor puede anotar los ficheros de Drive/, "el panel escribió drive_ids");
await falla(como(U.EDI, () => q("update public.instagram_piezas set estado = 'publicada', media_id = '1' where id = $1", [C1])),
  /Solo el servidor/, "el panel publicó el carrusel");
await falla(como(U.EDI, () => q("update public.instagram_piezas set tipo_medio = 'imagen', formato = 'post', diapositivas = null where id = $1", [C1])),
  /No se puede cambiar el tipo/, "el panel cambió el tipo");
// Regenerar (el render con el JWT del usuario) sí: menos imágenes.
await como(U.EDI, () => q("update public.instagram_piezas set diapositivas = $2 where id = $1", [C2, JSON.stringify(diapositivas(C2, 2))]));
comprobaciones++;

// ─── 3. Programar con el texto en la llamada ────────────────────────────────
const alts = ["Ostras sobre hielo", "Bogavante vivo", "Navajas", "Percebes", "Zamburiñas", "Almejas"];
await falla(rpcNombrada(U.VER, "instagram_programar", { p_pieza_id: C1, p_para: MANANA }), /hace falta «Editar»/, "quien solo ve programó");
await falla(rpcNombrada(U.EDI, "instagram_programar", { p_pieza_id: C1, p_para: MANANA, p_alt_texts: alts.slice(0, 5) }),
  /Hacen falta 6 textos alternativos/, "aceptó menos textos que imágenes");
await falla(rpcNombrada(U.EDI, "instagram_programar", { p_pieza_id: C1, p_para: MANANA, p_alt_text: "x".repeat(1001) }),
  /pasa de 1000/, "aceptó un alt_text largo");
const prog = await rpcNombrada(U.EDI, "instagram_programar", { p_pieza_id: C1, p_para: MANANA, p_caption: "Del Cantábrico #mariscos", p_alt_texts: alts });
ok(prog.ok, `no programó el carrusel: ${JSON.stringify(prog)}`);
const fila = (await q("select caption, diapositivas from public.instagram_piezas where id = $1", [C1])).rows[0];
igual([fila.caption, fila.diapositivas.map((d) => d.alt_text)], ["Del Cantábrico #mariscos", alts], "no guardó el texto de la llamada");
// Reprogramar cambiando solo los textos alternativos (ya programado): vale.
const alts2 = alts.map((a) => `${a}.`);
ok((await rpcNombrada(U.EDI, "instagram_programar", { p_pieza_id: C1, p_para: MANANA, p_alt_texts: alts2 })).ok, "no reprogramó con textos nuevos");
igual((await q("select diapositivas from public.instagram_piezas where id = $1", [C1])).rows[0].diapositivas.map((d) => d.alt_text), alts2, "no cambió los textos al reprogramar");
// La llamada de antes (3 argumentos) sigue valiendo.
ok((await rpcNombrada(U.EDI, "instagram_programar", { p_pieza_id: C1, p_para: MANANA, p_confirmar_conflicto: false })).ok, "la llamada de 3 argumentos dejó de valer");
igual(await n("select count(*)::int n from public.instagram_programaciones where pieza_id = $1 and estado = 'programada'", [C1]), 1, "duplicó la programación");
// Un post programa con p_alt_text, no con p_alt_texts.
const P1 = "c0000000-0000-4000-8000-0000000000a1";
await como(U.EDI, () => q(`insert into public.instagram_piezas (id, marca, plantilla, formato, estado, imagen_ruta)
  values ($1, 'touza', 'touza-foto', 'post', 'generada', $2)`, [P1, `piezas/${MES}/${P1}.jpg`]));
await falla(rpcNombrada(U.EDI, "instagram_programar", { p_pieza_id: P1, p_para: MANANA, p_alt_texts: ["a"] }), /solo para carruseles/, "aceptó p_alt_texts en un post");
ok((await rpcNombrada(U.EDI, "instagram_programar", { p_pieza_id: P1, p_para: MANANA, p_caption: "Hola", p_alt_text: "Barra de Touza" })).ok, "no programó el post");
igual({ ...(await q("select caption, alt_text from public.instagram_piezas where id = $1", [P1])).rows[0] }, { caption: "Hola", alt_text: "Barra de Touza" }, "no guardó caption/alt del post");
// Carrusel sin imágenes no se programa.
const C3 = "c0000000-0000-4000-8000-0000000000c3";
await insertar(U.EDI, C3, null, { imagen: null });
await falla(rpcNombrada(U.EDI, "instagram_programar", { p_pieza_id: C3, p_para: MANANA }), /no tiene sus imágenes/, "programó un carrusel sin imágenes");

// ─── 4. Programado: imágenes intocables ─────────────────────────────────────
const cambiada = diapositivas(C1, 6).map((d, i) => ({ ...d, alt_text: alts2[i], ...(i === 3 ? { plantilla: "ct-otra" } : {}) }));
await falla(como(U.EDI, () => q("update public.instagram_piezas set diapositivas = $2 where id = $1", [C1, JSON.stringify(cambiada)])),
  /publicación programada/, "cambió una imagen de un carrusel programado");
await falla(como(U.EDI, () => q("update public.instagram_piezas set diapositivas = $2 where id = $1", [C1, JSON.stringify(diapositivas(C1, 5))])),
  /publicación programada/, "quitó una imagen de un carrusel programado");
for (let i = 1; i <= 6; i++) await subir(U.EDI, ruta(C1, i));
for (let i = 1; i <= 2; i++) await subir(U.EDI, ruta(C2, i));
igual(await borrar(U.EDI, ruta(C1, 4)), 0, "borró del cubo una imagen de un carrusel programado");
igual(await borrar(U.EDI, ruta(C2, 2)), 1, "no dejó borrar la imagen de un carrusel sin programar");
await subir(U.EDI, ruta(C2, 2));
igual(await como("service", () => n("select public.instagram_objeto_bloqueado('instagram', $1)::int n", [ruta(C1, 6)])), 1, "la imagen 6 no está bloqueada");
igual(await como("service", () => n("select public.instagram_objeto_bloqueado('instagram', $1)::int n", [`piezas/${MES}/no-es-uuid-01.jpg`])), 0, "una ruta rara rompe el bloqueo");

// ─── 5. Servidor: drive_ids y publicada ─────────────────────────────────────
await como("service", () => q("update public.instagram_piezas set estado = 'publicada', media_id = '1800', drive_ids = array['d1','d2'] where id = $1", [C2]));
igual((await q("select drive_ids from public.instagram_piezas where id = $1", [C2])).rows[0].drive_ids, ["d1", "d2"], "el servidor no pudo anotar drive_ids");
await falla(como(U.EDI, () => q("update public.instagram_piezas set diapositivas = $2 where id = $1", [C2, JSON.stringify(diapositivas(C2, 3))])),
  /ya está publicada/, "cambió un carrusel publicado");

// ─── 6. Limpieza: todas las imágenes, nunca las de uno programado ───────────
const C4 = "c0000000-0000-4000-8000-0000000000c4";
await insertar(U.EDI, C4, diapositivas(C4, 4));
await q("alter table public.instagram_piezas disable trigger user");
await q("update public.instagram_piezas set updated_at = now() - interval '9 days' where id in ($1, $2, $3)", [C1, C4, C2]);
await q("alter table public.instagram_piezas enable trigger user");
const caducados = (await como("service", () => q("select * from public.instagram_piezas_reclamar_jpeg_caducados(7, 100) order by imagen_ruta"))).rows;
igual(caducados.map((r) => r.imagen_ruta), [1, 2, 3, 4].map((i) => ruta(C4, i)), "la limpieza no devolvió las 4 imágenes (o devolvió las de uno programado o publicado)");
ok(caducados.every((r) => r.id === C4), "la limpieza devolvió otra pieza");
ok((await q("select imagen_borrada_at from public.instagram_piezas where id = $1", [C4])).rows[0].imagen_borrada_at, "no marcó imagen_borrada_at");
igual((await como("service", () => q("select * from public.instagram_piezas_reclamar_jpeg_caducados(7, 100)"))).rows.length, 0, "repitió la limpieza");
await falla(rpcNombrada(U.EDI, "instagram_programar", { p_pieza_id: C4, p_para: MANANA }), /se borró/, "programó un carrusel con las imágenes borradas");
await falla(como(U.EDI, () => q("select * from public.instagram_piezas_reclamar_jpeg_caducados(7, 100)")), /permission denied/, "el panel lanzó la limpieza");

// ─── 7. Rollback y vuelta a aplicar ─────────────────────────────────────────
await db.exec(ROLLBACK);
await db.exec(ROLLBACK);
igual(await n("select count(*)::int n from public.instagram_piezas where formato = 'carrusel'"), 0, "el rollback dejó carruseles");
igual(await n("select count(*)::int n from pg_proc where proname = 'instagram_programar'"), 1, "el rollback dejó dos instagram_programar");
ok((await rpcNombrada(U.EDI, "instagram_programar", { p_pieza_id: P1, p_para: MANANA })).ok, "tras el rollback no se programa");
await db.exec(MIGRACION);
await insertar(U.EDI, C1, diapositivas(C1, 2));
igual(await n("select count(*)::int n from public.instagram_piezas where formato = 'carrusel'"), 1, "no se volvió a aplicar tras el rollback");

await db.close();
console.log(`test-instagram-carrusel: ${comprobaciones} comprobaciones OK`);
