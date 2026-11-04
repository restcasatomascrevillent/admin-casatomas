// Sección Instagram: bucket «instagram» e instagram_piezas contra un Postgres
// en memoria (PGlite), con la migración REAL. Nunca toca Supabase.
//
//   npm run test:instagram:db
//
// Cubre 20261105090000_instagram.sql: se para si falta algo de lo que
// depende; idempotente; bucket público de 8 MB con sus tipos; políticas de
// storage.objects acotadas al bucket y a la sección marketing; RLS de
// instagram_piezas (marketing lee y escribe, otra sección no, anon nada,
// sesión bloqueada no); CHECK; trigger (updated_at, creado_por no falseable);
// índice; auditoría; y el rollback.
//
// Y 20261105120000_instagram_fotos.sql (fotos subidas desde el panel): se
// para sin el bucket; idempotente; RLS (marketing lee/sube/borra, otra
// sección y bloqueados no, anon nada); subida_por no falseable; solo se
// editan tipo y descripción; CHECK (ruta = fotos/<marca>/subidas/<id>.jpg,
// tipo, medidas, descripción ≤ 140); auditoría; y su rollback.
import { PGlite } from "@electric-sql/pglite";
import { readFile } from "node:fs/promises";
import assert from "node:assert/strict";

const MIGRACION = await readFile("supabase/migrations/20261105090000_instagram.sql", "utf8");
const ROLLBACK = await readFile("supabase/rollbacks/20261105090000_instagram_ROLLBACK.sql", "utf8");
const MIG_FOTOS = await readFile("supabase/migrations/20261105120000_instagram_fotos.sql", "utf8");
const RB_FOTOS = await readFile("supabase/rollbacks/20261105120000_instagram_fotos_ROLLBACK.sql", "utf8");

let comprobaciones = 0;
const ok = (v, msg) => { assert.ok(v, msg); comprobaciones++; };
const igual = (a, b, msg) => { assert.deepEqual(a, b, msg); comprobaciones++; };

// Andamiaje mínimo de Supabase: roles, auth, permisos por sección (el super
// admin siempre dentro; can_write_section exige «Ver», como en producción),
// sesión de panel viva, auditoría reducida y storage.
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
  insert into storage.buckets (id, name, public) values ('platos', 'platos', true);
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
};
const sesion = (u) => u.replace(/^a/, "b");
const DATOS = `
  insert into auth.users (id, email, banned_until) values
    ('${U.SA}', 'sa@t', null), ('${U.MKT}', 'mkt@t', null), ('${U.OTRA}', 'otra@t', null),
    ('${U.BLOQ}', 'bloq@t', now() + interval '1 day');
  insert into auth.sessions (id, user_id) select ('b' || substr(id::text, 2))::uuid, id from auth.users;
  insert into public.super_admins values ('${U.SA}');
  insert into public.user_permissions values
    ('${U.MKT}', 'marketing', true, false), ('${U.OTRA}', 'reservas', true, true), ('${U.BLOQ}', 'marketing', true, true);
`;

// ─── 0. Si falta algo de lo que depende, se para sin crear nada ─────────────
{
  const otra = new PGlite();
  await otra.exec(ANDAMIAJE.replace(STORAGE, ""));
  await assert.rejects(otra.exec(MIGRACION), /instagram: falta storage\.buckets, storage\.objects/, "no se paró sin storage"); comprobaciones++;
  await otra.exec("rollback");
  igual((await otra.query("select to_regclass('public.instagram_piezas') t")).rows[0].t, null, "la migración abortada dejó la tabla");
  await otra.close();
}

const db = new PGlite();
await db.exec(ANDAMIAJE);
await db.exec(DATOS);
await db.exec(MIGRACION);
await db.exec("update storage.buckets set public = false where id = 'instagram'");
await db.exec(MIGRACION); // idempotente (y vuelve a dejar el bucket como debe)
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
const n = async (sql) => (await q(sql)).rows[0].n;

// ─── 1. Bucket ──────────────────────────────────────────────────────────────
igual((await q("select public, file_size_limit::int l, allowed_mime_types t from storage.buckets where id = 'instagram'")).rows[0], {
  public: true,
  l: 8 * 1024 * 1024,
  t: ["image/jpeg", "image/png", "image/webp"],
}, "bucket instagram");
igual(await n("select count(*)::int n from storage.buckets"), 2, "reaplicar duplicó el bucket o tocó otros");
igual((await q("select public from storage.buckets where id = 'platos'")).rows[0].public, true, "tocó otro bucket");

// Políticas de storage: solo marketing y solo en su bucket. (Como en el resto
// de buckets, storage.objects no lleva acceso_panel_no_bloqueado.)
const subir = (u, bucket, nombre) => como(u, () => q("insert into storage.objects (bucket_id, name) values ($1, $2) returning name", [bucket, nombre]));
igual((await subir(U.MKT, "instagram", "piezas/a.jpg")).rows.length, 1, "marketing no pudo subir");
igual((await subir(U.SA, "instagram", "fotos/touza/x.jpg")).rows.length, 1, "el super admin no pudo subir");
for (const [u, bucket, msg] of [
  [U.OTRA, "instagram", "otra sección subió al bucket"],
  [U.MKT, "platos", "marketing subió a platos por la política de instagram"],
]) {
  await assert.rejects(subir(u, bucket, `x-${comprobaciones}.jpg`), /row-level security/, msg); comprobaciones++;
}
await assert.rejects(como(null, () => q("insert into storage.objects (bucket_id, name) values ('instagram', 'anon.jpg')"), "anon"), /row-level security/, "anon subió"); comprobaciones++;
igual((await como(U.OTRA, () => q("select name from storage.objects where bucket_id = 'instagram'"))).rows, [], "otra sección listó el bucket");
igual((await como(null, () => q("select name from storage.objects"), "anon")).rows, [], "anon listó el bucket");
igual((await como(U.MKT, () => q("select name from storage.objects order by 1"))).rows.map((r) => r.name), ["fotos/touza/x.jpg", "piezas/a.jpg"], "marketing no lista el bucket");
igual((await como(U.MKT, () => q("update storage.objects set name = 'piezas/b.jpg' where name = 'piezas/a.jpg' returning name"))).rows.length, 1, "marketing no pudo sobrescribir (upsert)");
igual((await como(U.OTRA, () => q("delete from storage.objects returning name"))).rows.length, 0, "otra sección borró en el bucket");
igual((await como(U.MKT, () => q("delete from storage.objects where name = 'piezas/b.jpg' returning name"))).rows.length, 1, "marketing no pudo borrar");
const sinBucket = await n(`select count(*)::int n from pg_policies where schemaname = 'storage' and tablename = 'objects'
  and policyname like 'instagram_%' and coalesce(qual, with_check) not like '%bucket_id = ''instagram''%'`);
igual(sinBucket, 0, "política de storage sin acotar al bucket");
igual(await n("select count(*)::int n from pg_policies where schemaname = 'storage' and policyname like 'instagram_%'"), 4, "políticas de storage");

// ─── 2. Tabla: estructura ───────────────────────────────────────────────────
const columnas = (await q(`select column_name c from information_schema.columns
  where table_schema = 'public' and table_name = 'instagram_piezas' order by ordinal_position`)).rows.map((r) => r.c);
igual(columnas, ["id", "marca", "plantilla", "formato", "datos", "caption", "estado", "imagen_ruta", "contenedor_id", "media_id",
  "permalink", "error", "creado_por", "created_at", "updated_at"], "columnas de instagram_piezas");
ok((await q("select indexdef from pg_indexes where indexname = 'instagram_piezas_estado_created_idx'")).rows[0]?.indexdef.includes("(estado, created_at DESC)"), "índice (estado, created_at desc)");
igual(await n("select count(*)::int n from pg_trigger where tgrelid = 'public.instagram_piezas'::regclass and tgname = 'trg_auditoria'"), 1, "instagram_piezas sin auditoría (o duplicada)");

// ─── 3. RLS ─────────────────────────────────────────────────────────────────
const PIEZA = `('casa-tomas', 'ct-tipografica', 'post', '{"titular":"De padres a hijos"}', 'Pie de foto')`;
const crear = (u, extra = "") => como(u, () => q(`insert into public.instagram_piezas (marca, plantilla, formato, datos, caption${extra ? ", creado_por" : ""})
  values ${extra ? PIEZA.replace(/\)$/, `, '${extra}')`) : PIEZA} returning id, creado_por, estado`));
const creada = (await crear(U.MKT, U.SA)).rows[0];
igual([creada.creado_por, creada.estado], [U.MKT, "borrador"], "creado_por falseado o estado por defecto");
igual(await n(`select count(*)::int n from public.audit_log where tabla = 'instagram_piezas' and actor = '${U.MKT}'`), 1, "el alta no se auditó con su autor");
for (const [u, msg] of [[U.OTRA, "otra sección creó una pieza"], [U.BLOQ, "un usuario bloqueado creó una pieza"]]) {
  await assert.rejects(crear(u), /row-level security/, msg); comprobaciones++;
}
await assert.rejects(como(null, () => q(`insert into public.instagram_piezas (marca, plantilla, formato) values ('touza', 'tz-tipografica', 'post')`), "anon"),
  /permission denied/, "anon creó una pieza"); comprobaciones++;
await assert.rejects(como(null, () => q("select * from public.instagram_piezas"), "anon"), /permission denied/, "anon leyó piezas"); comprobaciones++;
igual((await como(U.OTRA, () => q("select id from public.instagram_piezas"))).rows, [], "otra sección leyó piezas");
igual((await como(U.BLOQ, () => q("select id from public.instagram_piezas"))).rows, [], "un usuario bloqueado leyó piezas");
igual((await como(U.SA, () => q("select id from public.instagram_piezas"))).rows.length, 1, "el super admin no lee piezas");

const antes = (await q("select updated_at, created_at from public.instagram_piezas where id = $1", [creada.id])).rows[0];
await new Promise((r) => setTimeout(r, 15));
const editada = (await como(U.SA, () => q(`update public.instagram_piezas set estado = 'generada', imagen_ruta = 'piezas/x.jpg',
  creado_por = '${U.SA}', created_at = now() - interval '1 year' where id = $1 returning creado_por, created_at, updated_at`, [creada.id]))).rows[0];
igual(editada.creado_por, U.MKT, "se cambió creado_por");
igual(editada.created_at.getTime(), antes.created_at.getTime(), "se cambió created_at");
ok(editada.updated_at > antes.updated_at, "updated_at no avanzó");
igual((await como(U.OTRA, () => q("update public.instagram_piezas set estado = 'publicada' returning id"))).rows.length, 0, "otra sección editó");
igual((await como(U.OTRA, () => q("delete from public.instagram_piezas returning id"))).rows.length, 0, "otra sección borró");
await assert.rejects(como(U.MKT, () => q("truncate public.instagram_piezas")), /permission denied/, "authenticated hizo TRUNCATE"); comprobaciones++;

// ─── 4. CHECK ───────────────────────────────────────────────────────────────
for (const [set, msg] of [
  ["estado = 'pendiente'", "estado desconocido"],
  ["marca = 'otra'", "marca desconocida"],
  ["formato = 'reel'", "formato desconocido"],
  ["plantilla = 'Mala Plantilla'", "id de plantilla raro"],
  ["datos = '[1,2]'", "datos que no son un objeto"],
  ["caption = repeat('x', 2201)", "caption de más de 2200"],
  ["error = repeat('x', 4001)", "error larguísimo"],
]) {
  await assert.rejects(q(`update public.instagram_piezas set ${set} where id = $1`, [creada.id]), /violates check constraint/, `${msg} aceptado`); comprobaciones++;
}
for (const estado of ["borrador", "generada", "prueba_ok", "publicada", "error"]) {
  await q("update public.instagram_piezas set estado = $2 where id = $1", [creada.id, estado]); comprobaciones++;
}
igual((await como(U.MKT, () => q("delete from public.instagram_piezas where id = $1 returning id", [creada.id]))).rows.length, 1, "marketing no pudo borrar");

// ─── 5. Rollback ────────────────────────────────────────────────────────────
await db.exec(ROLLBACK);
igual((await q("select to_regclass('public.instagram_piezas') t")).rows[0].t, null, "el rollback no borró la tabla");
igual(await n("select count(*)::int n from pg_policies where policyname like 'instagram_%'"), 0, "el rollback dejó políticas");
igual(await n("select count(*)::int n from pg_proc where proname = 'instagram_piezas_al_editar'"), 0, "el rollback dejó la función");
igual(await n("select count(*)::int n from storage.buckets where id = 'instagram'"), 1, "el rollback borró el bucket (debe conservarlo)");
await db.exec(MIGRACION); // se puede volver a aplicar
ok((await q("select to_regclass('public.instagram_piezas') t")).rows[0].t !== null, "reaplicar tras el rollback");

// ─── 6. Fotos subidas (20261105120000_instagram_fotos) ──────────────────────
{
  // Sin el bucket «instagram» se para sin crear nada.
  const otra = new PGlite();
  await otra.exec(ANDAMIAJE);
  await assert.rejects(otra.exec(MIG_FOTOS), /instagram_fotos: falta el bucket instagram/, "no se paró sin el bucket"); comprobaciones++;
  await otra.exec("rollback");
  igual((await otra.query("select to_regclass('public.instagram_fotos') t")).rows[0].t, null, "la migración abortada dejó la tabla");
  await otra.close();
}
await db.exec(MIG_FOTOS);
await db.exec(MIG_FOTOS); // idempotente
comprobaciones++;

const colsFotos = (await q(`select column_name c from information_schema.columns
  where table_schema = 'public' and table_name = 'instagram_fotos' order by ordinal_position`)).rows.map((r) => r.c);
igual(colsFotos, ["id", "marca", "ruta", "ancho", "alto", "tipo", "descripcion", "subida_por", "created_at"], "columnas de instagram_fotos");
igual(await n("select count(*)::int n from pg_trigger where tgrelid = 'public.instagram_fotos'::regclass and tgname = 'trg_auditoria'"), 1, "instagram_fotos sin auditoría (o duplicada)");
ok((await q("select relrowsecurity r from pg_class where oid = 'public.instagram_fotos'::regclass")).rows[0].r, "RLS apagada en instagram_fotos");

const F1 = "c0000000-0000-4000-8000-000000000001";
const F2 = "c0000000-0000-4000-8000-000000000002";
const filaFoto = (id, marca = "casa-tomas", extra = {}) => ({
  id, marca, ruta: `fotos/${marca}/subidas/${id}.jpg`, ancho: 1708, alto: 2560, tipo: "plato", descripcion: "Chuleta", ...extra,
});
const insertFoto = (f) => [
  `insert into public.instagram_fotos (${Object.keys(f).join(", ")}) values (${Object.keys(f).map((_, i) => `$${i + 1}`).join(", ")}) returning *`,
  Object.values(f),
];
const subirFoto = (u, f) => como(u, () => q(...insertFoto(f)));

const subida = (await subirFoto(U.MKT, filaFoto(F1, "casa-tomas", { subida_por: U.SA }))).rows[0];
igual(subida.subida_por, U.MKT, "subida_por falseado");
igual(await n(`select count(*)::int n from public.audit_log where tabla = 'instagram_fotos' and actor = '${U.MKT}'`), 1, "la subida no se auditó");
for (const [u, msg] of [[U.OTRA, "otra sección subió una foto"], [U.BLOQ, "un usuario bloqueado subió una foto"]]) {
  await assert.rejects(subirFoto(u, filaFoto(F2)), /row-level security/, msg); comprobaciones++;
}
await assert.rejects(como(null, () => q("select * from public.instagram_fotos"), "anon"), /permission denied/, "anon leyó fotos"); comprobaciones++;
await assert.rejects(como(null, () => q(...insertFoto(filaFoto(F2))), "anon"), /permission denied/, "anon subió una foto"); comprobaciones++;
igual((await como(U.OTRA, () => q("select id from public.instagram_fotos"))).rows, [], "otra sección leyó fotos");
igual((await como(U.BLOQ, () => q("select id from public.instagram_fotos"))).rows, [], "un usuario bloqueado leyó fotos");
igual((await como(U.MKT, () => q("select id from public.instagram_fotos"))).rows.map((r) => r.id), [F1], "marketing no lee las fotos");

// Al editar solo cambian tipo y descripción.
const editadaF = (await como(U.SA, () => q(`update public.instagram_fotos set tipo = 'sala', descripcion = 'Otra', ancho = 10, alto = 10,
  ruta = 'piezas/x.jpg', marca = 'touza', subida_por = '${U.SA}', created_at = now() - interval '1 year' where id = $1 returning *`, [F1]))).rows[0];
igual([editadaF.tipo, editadaF.descripcion], ["sala", "Otra"], "no se pudo editar tipo y descripción");
igual([editadaF.ancho, editadaF.alto, editadaF.ruta, editadaF.marca, editadaF.subida_por, editadaF.created_at.getTime()],
  [1708, 2560, subida.ruta, "casa-tomas", U.MKT, subida.created_at.getTime()], "se cambió algo que no es tipo ni descripción");
igual((await como(U.OTRA, () => q("update public.instagram_fotos set descripcion = 'x' returning id"))).rows.length, 0, "otra sección editó una foto");
igual((await como(U.OTRA, () => q("delete from public.instagram_fotos returning id"))).rows.length, 0, "otra sección borró una foto");
await assert.rejects(como(U.MKT, () => q("truncate public.instagram_fotos")), /permission denied/, "authenticated hizo TRUNCATE en fotos"); comprobaciones++;

// CHECK
for (const [f, msg] of [
  [filaFoto(F2, "casa-tomas", { ruta: `fotos/casa-tomas/${F2}.jpg` }), "ruta fuera de subidas/"],
  [filaFoto(F2, "casa-tomas", { ruta: `fotos/touza/subidas/${F2}.jpg` }), "ruta de otra marca"],
  [filaFoto(F2, "casa-tomas", { ruta: `fotos/casa-tomas/subidas/${F1}.jpg` }), "ruta con otro id"],
  [filaFoto(F2, "casa-tomas", { ruta: "piezas/2026-11/x.jpg" }), "ruta a una pieza"],
  [filaFoto(F2, "otra"), "marca desconocida"],
  [filaFoto(F2, "casa-tomas", { tipo: "postre" }), "tipo desconocido"],
  [filaFoto(F2, "casa-tomas", { ancho: 4000 }), "lado mayor de más de 2560"],
  [filaFoto(F2, "casa-tomas", { alto: 0 }), "alto 0"],
  [filaFoto(F2, "casa-tomas", { descripcion: "x".repeat(141) }), "descripción de más de 140"],
]) {
  await assert.rejects(q(...insertFoto(f)), /violates check constraint/, `${msg} aceptado`); comprobaciones++;
}
for (const tipo of ["plato", "sala", "bebida", "ambiente", "barra", "coctel", "interior"]) {
  await q("update public.instagram_fotos set tipo = $2 where id = $1", [F1, tipo]); comprobaciones++;
}
igual((await subirFoto(U.SA, filaFoto(F2, "touza", { descripcion: "x".repeat(140) }))).rows.length, 1, "no admite 140 caracteres o Touza");
await assert.rejects(subirFoto(U.SA, filaFoto(F2, "touza")), /duplicate key|unique/, "se repitió la foto"); comprobaciones++;
igual((await como(U.MKT, () => q("delete from public.instagram_fotos where id = $1 returning id", [F2]))).rows.length, 1, "marketing no pudo borrar una foto");

// Rollback de las fotos: no toca instagram_piezas ni el bucket.
await db.exec(RB_FOTOS);
igual((await q("select to_regclass('public.instagram_fotos') t")).rows[0].t, null, "el rollback no borró instagram_fotos");
igual(await n("select count(*)::int n from pg_proc where proname = 'instagram_fotos_al_editar'"), 0, "el rollback dejó la función de fotos");
ok((await q("select to_regclass('public.instagram_piezas') t")).rows[0].t !== null, "el rollback de fotos borró instagram_piezas");
igual(await n("select count(*)::int n from storage.buckets where id = 'instagram'"), 1, "el rollback de fotos borró el bucket");
await db.exec(MIG_FOTOS);
ok((await q("select to_regclass('public.instagram_fotos') t")).rows[0].t !== null, "reaplicar fotos tras el rollback");

await db.close();
console.log(`test-instagram: ${comprobaciones} comprobaciones OK`);
