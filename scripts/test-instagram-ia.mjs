// IA de textos de Instagram (20261108000000_instagram_ia.sql) contra un
// Postgres en memoria (PGlite), con la migración REAL. Nunca toca Supabase.
//
//   npm run test:instagram-ia:db
//
// Cubre: se para sin instagram_piezas; idempotente y sin pisar una guía
// editada; siembra (dos marcas, sin emoji, TOUZA sin «reservar» en las CTA);
// alta en ia_funciones sin instrumentar; RLS de guías (marketing lee, solo
// edición cambia guía/hashtags/CTA, la versión sube sola, nadie inserta ni
// borra, otra sección y sesión bloqueada no ven, anon nada); RLS de
// sugerencias (insertar con edición, creado_por del servidor, marcar la
// elegida solo quien la pidió, no se toca la salida, nadie borra); CHECK;
// enlace a instagram_piezas (on delete set null); y el rollback.
import { PGlite } from "@electric-sql/pglite";
import { readFile } from "node:fs/promises";
import assert from "node:assert/strict";

const MIG_INSTAGRAM = await readFile("supabase/migrations/20261105090000_instagram.sql", "utf8");
const MIGRACION = await readFile("supabase/migrations/20261108000000_instagram_ia.sql", "utf8");
const ROLLBACK = await readFile("supabase/rollbacks/20261108000000_instagram_ia_ROLLBACK.sql", "utf8");

let comprobaciones = 0;
const ok = (v, msg) => { assert.ok(v, msg); comprobaciones++; };
const igual = (a, b, msg) => { assert.deepEqual(a, b, msg); comprobaciones++; };
const falla = async (p, re, msg) => { await assert.rejects(p, re, msg); comprobaciones++; };

// Andamiaje mínimo de Supabase (el mismo que scripts/test-instagram-metricas.mjs).
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
// Catálogo de costes (20260928193000_costes_sistema.sql), lo justo.
const IA_FUNCIONES = `
  create table public.ia_funciones (funcion text primary key, descripcion text not null,
    instrumentada boolean not null default false, unidad text not null default 'llamada',
    orden integer not null default 100, activo boolean not null default true);
`;

const U = {
  SA: "a0000000-0000-0000-0000-000000000001",
  MKT: "a0000000-0000-0000-0000-000000000002",
  OTRA: "a0000000-0000-0000-0000-000000000003",
  BLOQ: "a0000000-0000-0000-0000-000000000004",
  VER: "a0000000-0000-0000-0000-000000000005",
  MKT2: "a0000000-0000-0000-0000-000000000006",
};
const sesion = (u) => u.replace(/^a/, "b");
const DATOS = `
  insert into auth.users (id, email, banned_until) values
    ('${U.SA}', 'sa@t', null), ('${U.MKT}', 'mkt@t', null), ('${U.OTRA}', 'otra@t', null),
    ('${U.BLOQ}', 'bloq@t', now() + interval '1 day'), ('${U.VER}', 'ver@t', null), ('${U.MKT2}', 'mkt2@t', null);
  insert into auth.sessions (id, user_id) select ('b' || substr(id::text, 2))::uuid, id from auth.users;
  insert into public.super_admins values ('${U.SA}');
  insert into public.user_permissions values
    ('${U.MKT}', 'marketing', true, true), ('${U.OTRA}', 'reservas', true, true), ('${U.BLOQ}', 'marketing', true, true),
    ('${U.VER}', 'marketing', true, false), ('${U.MKT2}', 'marketing', true, true);
`;

// ─── 0. Sin instagram_piezas se para sin crear nada ─────────────────────────
{
  const otra = new PGlite();
  await otra.exec(ANDAMIAJE);
  await falla(otra.exec(MIGRACION), /instagram_ia: falta public\.instagram_piezas/, "no se paró sin instagram_piezas");
  await otra.exec("rollback");
  igual((await otra.query("select to_regclass('public.instagram_guias_marca') t")).rows[0].t, null, "la migración abortada dejó tablas");
  await otra.close();
}

// ─── 1. Sin ia_funciones también se aplica ──────────────────────────────────
{
  const otra = new PGlite();
  await otra.exec(ANDAMIAJE);
  await otra.exec(MIG_INSTAGRAM);
  await otra.exec(MIGRACION);
  igual((await otra.query("select count(*)::int n from public.instagram_guias_marca")).rows[0].n, 2, "sin ia_funciones no sembró las guías");
  await otra.close();
}

const db = new PGlite();
await db.exec(ANDAMIAJE);
await db.exec(IA_FUNCIONES);
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

// ─── 2. Siembra ─────────────────────────────────────────────────────────────
{
  const guias = (await q("select marca, version, guia, hashtags_base, ctas from public.instagram_guias_marca order by marca")).rows;
  igual(guias.map((g) => g.marca), ["casa-tomas", "touza"], "faltan guías");
  igual(guias.map((g) => g.version), [1, 1], "versión inicial");
  const emoji = /\p{Extended_Pictographic}/u;
  ok(guias.every((g) => !emoji.test(g.guia) && !g.ctas.some((c) => emoji.test(c))), "la siembra lleva emoji");
  ok(guias[0].guia.includes("volver a casa") && guias[0].guia.includes("Nunca é longo o camiño"), "guía de Casa Tomás incompleta");
  ok(guias[1].guia.includes("no admite reservas") && guias[1].guia.includes("TOUZA"), "guía de TOUZA incompleta");
  ok(guias[0].ctas.includes("Reservar mesa"), "Casa Tomás sin «Reservar mesa»");
  ok(!guias[1].ctas.some((c) => /reserv/i.test(c)), "TOUZA con una CTA de reservar");
  ok(guias.every((g) => g.hashtags_base.every((h) => /^#[\p{L}\p{N}_]+$/u.test(h))), "hashtag base mal formado");
  igual((await q("select instrumentada from public.ia_funciones where funcion = 'instagram-ia'")).rows, [{ instrumentada: false }], "ia_funciones");
}

// ─── 3. RLS de las guías ────────────────────────────────────────────────────
const verGuias = (u, rol) => como(u, async () => (await q("select count(*)::int n from public.instagram_guias_marca")).rows[0].n, rol);
igual(await verGuias(U.MKT), 2, "marketing lee las guías");
igual(await verGuias(U.VER), 2, "marketing (solo ver) lee las guías");
igual(await verGuias(U.SA), 2, "el super admin lee las guías");
igual(await verGuias(U.OTRA), 0, "otra sección lee las guías");
igual(await verGuias(U.BLOQ), 0, "sesión bloqueada lee las guías");
await falla(verGuias(null, "anon"), /permission denied/, "anon lee las guías");

{
  const r = await como(U.MKT, async () => (await q(
    "update public.instagram_guias_marca set guia = guia || ' Prueba.', hashtags_base = hashtags_base || '#Prueba'::text where marca = 'casa-tomas' returning version, actualizado_por",
  )).rows);
  igual(r, [{ version: 2, actualizado_por: U.MKT }], "la versión no subió o no anotó quién");
  const solo = await como(U.MKT, async () => (await q("update public.instagram_guias_marca set ctas = ctas where marca = 'touza' returning version")).rows);
  igual(solo, [{ version: 1 }], "subió la versión sin cambios");
  igual(await como(U.VER, async () => (await q("update public.instagram_guias_marca set guia = 'x' returning marca")).rows.length), 0, "solo ver cambió la guía");
  igual(await como(U.OTRA, async () => (await q("update public.instagram_guias_marca set guia = 'x' returning marca")).rows.length), 0, "otra sección cambió la guía");
  await falla(como(U.MKT, () => q("update public.instagram_guias_marca set version = 99")), /permission denied/, "se cambió la versión a mano");
  await falla(como(U.MKT, () => q("update public.instagram_guias_marca set marca = 'otra'")), /permission denied/, "se cambió la marca");
  await falla(como(U.MKT, () => q("insert into public.instagram_guias_marca (marca, guia) values ('touza', 'x')")), /permission denied/, "marketing inserta guías");
  await falla(como(U.SA, () => q("delete from public.instagram_guias_marca")), /permission denied/, "el super admin borra guías");
  await falla(como(null, () => q("update public.instagram_guias_marca set guia = 'x'"), "anon"), /permission denied/, "anon cambia guías");
  await falla(q("update public.instagram_guias_marca set guia = '  ' where marca = 'touza'"), /instagram_guias_marca_guia_chk/, "guía vacía");
  await falla(q("insert into public.instagram_guias_marca (marca, guia) values ('otra-marca', 'x')"), /instagram_guias_marca_marca_chk/, "marca rara");
  // Volver a aplicar la migración no pisa la guía editada.
  await db.exec(MIGRACION);
  const ct = (await q("select version, guia from public.instagram_guias_marca where marca = 'casa-tomas'")).rows[0];
  ok(ct.version === 2 && ct.guia.endsWith(" Prueba."), "volver a aplicar pisó la guía editada");
}

// ─── 4. Sugerencias ─────────────────────────────────────────────────────────
const PIEZA = "3f2b8a52-6c1e-4d7a-9b0f-1a2b3c4d5e6f";
await q(`insert into public.instagram_piezas (id, marca, plantilla, formato, datos) values ('${PIEZA}', 'casa-tomas', 'ct-foto-titular', 'post', '{}')`);
const INSERTAR = (creadoPor = U.OTRA) => `
  insert into public.instagram_sugerencias_ia (tipo, marca, pieza_id, entrada, salida, modelo, version_guia, variantes, descartadas, creado_por, aceptada, variante_elegida)
  values ('sugerir_texto', 'casa-tomas', '${PIEZA}', '{"tono":"cercano"}', '{"variantes":[]}', 'gpt-5.6-luna', 2, 3, 0, '${creadoPor}', true, 2)
  returning id, creado_por, aceptada, variante_elegida`;
const fila = (await como(U.MKT, async () => (await q(INSERTAR())).rows))[0];
igual({ creado_por: fila.creado_por, aceptada: fila.aceptada, variante_elegida: fila.variante_elegida },
  { creado_por: U.MKT, aceptada: null, variante_elegida: null }, "el cliente falseó creado_por o la elección al insertar");
await falla(como(U.VER, () => q(INSERTAR())), /row-level security/, "solo ver inserta sugerencias");
await falla(como(U.OTRA, () => q(INSERTAR())), /row-level security/, "otra sección inserta sugerencias");
await falla(como(null, () => q(INSERTAR()), "anon"), /permission denied/, "anon inserta sugerencias");

const verSug = (u) => como(u, async () => (await q("select count(*)::int n from public.instagram_sugerencias_ia")).rows[0].n);
igual(await verSug(U.MKT2), 1, "otro de marketing lee las sugerencias");
igual(await verSug(U.OTRA), 0, "otra sección lee las sugerencias");
igual(await verSug(U.BLOQ), 0, "sesión bloqueada lee las sugerencias");

{
  const marcar = (u, v) => como(u, async () => (await q(
    `update public.instagram_sugerencias_ia set aceptada = true, variante_elegida = ${v} where id = '${fila.id}' returning variante_elegida`,
  )).rows);
  igual(await marcar(U.MKT2, 1), [], "otro usuario marcó la elegida de otro");
  igual(await marcar(U.MKT, 1), [{ variante_elegida: 1 }], "quien la pidió no pudo marcar la elegida");
  await falla(marcar(U.MKT, 5), /la variante 5 no existe/, "se marcó una variante que no existe");
  await falla(como(U.MKT, () => q(`update public.instagram_sugerencias_ia set aceptada = false, variante_elegida = 0 where id = '${fila.id}'`)),
    /instagram_sugerencias_ia_elegida_chk/, "elegida sin aceptar");
  await falla(como(U.MKT, () => q(`update public.instagram_sugerencias_ia set salida = '{}' where id = '${fila.id}'`)), /permission denied/, "se cambió la salida");
  await falla(como(U.MKT, () => q(`delete from public.instagram_sugerencias_ia where id = '${fila.id}'`)), /permission denied/, "marketing borra sugerencias");
  await falla(q("insert into public.instagram_sugerencias_ia (tipo, marca, modelo) values ('proponer_campana', 'touza', 'gpt-5.6-luna')"), /tipo_chk/, "tipo raro");
  await falla(q("insert into public.instagram_sugerencias_ia (tipo, marca, modelo) values ('sugerir_texto', 'touza', 'gpt 5; drop')"), /modelo_chk/, "modelo raro");
  await falla(q("insert into public.instagram_sugerencias_ia (tipo, marca, modelo, entrada) values ('sugerir_texto', 'touza', 'm', '[]')"), /json_chk/, "entrada no objeto");
}

// ─── 5. Enlace a instagram_piezas: al borrar la pieza queda NULL ────────────
await q(`delete from public.instagram_piezas where id = '${PIEZA}'`);
igual((await q("select pieza_id from public.instagram_sugerencias_ia")).rows, [{ pieza_id: null }], "on delete set null");

// ─── 6. Rollback ────────────────────────────────────────────────────────────
await db.exec(ROLLBACK);
igual((await q("select to_regclass('public.instagram_guias_marca') a, to_regclass('public.instagram_sugerencias_ia') b")).rows[0],
  { a: null, b: null }, "el rollback dejó tablas");
igual((await q("select count(*)::int n from public.ia_funciones where funcion = 'instagram-ia'")).rows[0].n, 0, "el rollback dejó ia_funciones");
ok((await q("select to_regclass('public.instagram_piezas') is not null t")).rows[0].t, "el rollback borró instagram_piezas");
await db.exec(MIGRACION); // se puede volver a aplicar
comprobaciones++;

await db.close();
console.log(`test-instagram-ia: ${comprobaciones} comprobaciones OK`);
