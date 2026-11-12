// Ajustes de Instagram («Estilo del feed», 12/11/2026) contra un Postgres en
// memoria (PGlite), con la migración REAL. Nunca toca Supabase.
//
//   node scripts/test-instagram-ajustes.mjs
//
// Cubre 20261127100000_instagram_ajustes_estilo_feed.sql: se para sin los
// permisos por sección; idempotente; una sola fila con «solo_foto» por
// defecto; CHECK del estilo; RLS (Marketing lee; solo «Editar» cambia
// estilo_feed; otra sección y anon nada); trigger (updated_by no falseable);
// y su rollback.
import { PGlite } from "@electric-sql/pglite";
import { readFile } from "node:fs/promises";
import assert from "node:assert/strict";

const MIGRACION = await readFile("supabase/migrations/20261127100000_instagram_ajustes_estilo_feed.sql", "utf8");
const ROLLBACK = await readFile("supabase/rollbacks/20261127100000_instagram_ajustes_estilo_feed_ROLLBACK.sql", "utf8");

let n = 0;
const ok = (v, msg) => {
  assert.ok(v, msg);
  n++;
};

const ANDAMIAJE = `
  create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
  create schema auth;
  create function auth.jwt() returns jsonb language sql stable as $$ select nullif(current_setting('request.jwt.claims', true), '')::jsonb $$;
  create function auth.uid() returns uuid language sql stable as $$ select (auth.jwt() ->> 'sub')::uuid $$;
  grant usage on schema public, auth to anon, authenticated, service_role;
  grant execute on all functions in schema auth to anon, authenticated;
  create table public.permisos (usuario uuid, seccion text, editar boolean);
  grant select on public.permisos to authenticated;
  create function public.can_read_section(s text) returns boolean language sql stable security definer set search_path = '' as $$
    select exists (select 1 from public.permisos p where p.usuario = auth.uid() and p.seccion = s) $$;
  create function public.can_edit_section(s text) returns boolean language sql stable security definer set search_path = '' as $$
    select exists (select 1 from public.permisos p where p.usuario = auth.uid() and p.seccion = s and p.editar) $$;
  grant execute on function public.can_read_section(text), public.can_edit_section(text) to authenticated;
`;

const EDITOR = "11111111-1111-4111-8111-111111111111";
const LECTOR = "22222222-2222-4222-8222-222222222222";
const OTRO = "33333333-3333-4333-8333-333333333333";

const db = new PGlite();

// Sin los permisos por sección, se para.
let parada = false;
try {
  await db.exec(MIGRACION);
} catch (e) {
  parada = /can_read_section/.test(String(e.message));
}
ok(parada, "sin can_read_section/can_edit_section la migración se para");

await db.exec(ANDAMIAJE);
await db.exec(`insert into public.permisos values ('${EDITOR}', 'marketing', true), ('${LECTOR}', 'marketing', false), ('${OTRO}', 'reservas', true)`);
await db.exec(MIGRACION);
await db.exec(MIGRACION); // idempotente
const filas = await db.query("select id, estilo_feed from public.instagram_ajustes");
ok(filas.rows.length === 1 && filas.rows[0].estilo_feed === "solo_foto", "una fila con «solo_foto» por defecto");

let mal = false;
try {
  await db.exec("update public.instagram_ajustes set estilo_feed = 'otro'");
} catch {
  mal = true;
}
ok(mal, "CHECK: solo «solo_foto» o «rotulos»");

async function como(usuario, sql) {
  await db.exec(`set role authenticated; select set_config('request.jwt.claims', '{"sub":"${usuario}","role":"authenticated"}', false);`);
  try {
    return await db.query(sql);
  } finally {
    await db.exec("reset role;");
  }
}

ok((await como(LECTOR, "select estilo_feed from public.instagram_ajustes")).rows.length === 1, "Marketing (ver) lee");
ok((await como(OTRO, "select estilo_feed from public.instagram_ajustes")).rows.length === 0, "otra sección no lee");
ok((await como(LECTOR, "update public.instagram_ajustes set estilo_feed = 'rotulos' returning id")).rows.length === 0, "Marketing sin «Editar» no cambia");
const r = await como(EDITOR, "update public.instagram_ajustes set estilo_feed = 'rotulos' returning estilo_feed, updated_by");
ok(r.rows.length === 1 && r.rows[0].estilo_feed === "rotulos" && r.rows[0].updated_by === EDITOR, "Marketing con «Editar» cambia; updated_by = quien lo cambia");
let soloEstilo = false;
try {
  await como(EDITOR, `update public.instagram_ajustes set updated_by = '${OTRO}'`);
} catch {
  soloEstilo = true;
}
ok(soloEstilo, "solo se puede cambiar estilo_feed");
let anon = false;
await db.exec("set role anon;");
try {
  await db.query("select * from public.instagram_ajustes");
} catch {
  anon = true;
}
await db.exec("reset role;");
ok(anon, "anon no lee");

await db.exec(ROLLBACK);
ok((await db.query("select to_regclass('public.instagram_ajustes') as t")).rows[0].t === null, "el rollback quita la tabla");
await db.exec(MIGRACION);
ok((await db.query("select estilo_feed from public.instagram_ajustes")).rows[0].estilo_feed === "solo_foto", "se puede volver a aplicar tras el rollback");

console.log(`instagram_ajustes: ${n} comprobaciones correctas`);
