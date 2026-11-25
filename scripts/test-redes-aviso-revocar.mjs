// Aviso inmediato a rrss al quitar «Redes» (migración 20261224100100) contra un
// Postgres en memoria (PGlite) con pg_net y Vault de mentira. Nunca toca Supabase.
//
//   npm run test:redes-aviso:db
//
// Cubre: quitar «Ver» en Redes, borrar la fila o borrar al usuario llama a
// rrss-embed-revoke con el secreto de Vault; quitar solo «Editar», tocar otra
// sección o dar «Redes» no; sin Vault no hace nada ni rompe el guardado; la vuelta
// atrás quita el disparador.
import { PGlite } from "@electric-sql/pglite";
import { readFile } from "node:fs/promises";
import assert from "node:assert/strict";

const MIGRACION = await readFile("supabase/migrations/20261224100100_redes_aviso_revocar.sql", "utf8");
const ROLLBACK = await readFile("supabase/rollbacks/20261224100100_redes_aviso_revocar_ROLLBACK.sql", "utf8");

let comprobaciones = 0;
const igual = (a, b, msg) => { assert.deepEqual(a, b, msg); comprobaciones++; };

const BASE = `
  create role anon nologin; create role authenticated nologin;
  create schema auth;
  create table auth.users (id uuid primary key default gen_random_uuid());
  create table public.user_permissions (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null references auth.users(id) on delete cascade,
    section_key text not null, can_view boolean default false, can_edit boolean default false,
    unique (user_id, section_key));
`;

// Sin Vault ni pg_net: no hace nada y el guardado funciona.
{
  const db = new PGlite();
  await db.exec(BASE);
  await db.exec(MIGRACION);
  const { rows } = await db.query("insert into auth.users default values returning id");
  await db.query("insert into public.user_permissions (user_id, section_key, can_view) values ($1, 'redes', true)", [rows[0].id]);
  await db.query("update public.user_permissions set can_view = false");
  igual(1, 1, "sin Vault ni pg_net, guardar permisos no falla");
  await db.close();
}

const db = new PGlite();
await db.exec(BASE + `
  create schema net;
  create table net.llamadas (url text, headers jsonb, body jsonb);
  create function net.http_post(url text, headers jsonb, body jsonb, timeout_milliseconds integer) returns bigint
    language sql as $$ insert into net.llamadas values (url, headers, body); select 1::bigint $$;
  create schema vault;
  create table vault.decrypted_secrets (name text, decrypted_secret text);
  insert into vault.decrypted_secrets values
    ('project_url', 'https://demo.supabase.co/'), ('rrss_embed_revoke_secret', 'secreto-de-prueba');
`);
await db.exec(MIGRACION);
const llamadas = async () => (await db.query("select url, headers, body from net.llamadas")).rows;
const nuevo = async () => (await db.query("insert into auth.users default values returning id")).rows[0].id;
const permiso = (u, seccion, ver, editar = false) =>
  db.query("insert into public.user_permissions (user_id, section_key, can_view, can_edit) values ($1, $2, $3, $4)", [u, seccion, ver, editar]);

const a = await nuevo();
await permiso(a, "redes", true, true);
await db.query("update public.user_permissions set can_edit = false where user_id = $1", [a]);
igual((await llamadas()).length, 0, "quitar solo «Editar» no avisa");
await permiso(a, "marketing", true);
await db.query("update public.user_permissions set can_view = false where user_id = $1 and section_key = 'marketing'", [a]);
igual((await llamadas()).length, 0, "otra sección no avisa");
await db.query("update public.user_permissions set can_view = false where user_id = $1 and section_key = 'redes'", [a]);
const [primera] = await llamadas();
igual(primera.url, "https://demo.supabase.co/functions/v1/rrss-embed-revoke", "llama a rrss-embed-revoke");
igual(primera.headers["x-rrss-revoke-secret"], "secreto-de-prueba", "con el secreto de Vault");
igual(primera.body, { user_id: a }, "y la persona");

const b = await nuevo();
await permiso(b, "redes", true);
await db.query("delete from public.user_permissions where user_id = $1 and section_key = 'redes'", [b]);
igual((await llamadas()).length, 2, "borrar la fila de Redes avisa");

const c = await nuevo();
await permiso(c, "redes", true);
await db.query("delete from auth.users where id = $1", [c]);
igual((await llamadas()).length, 3, "borrar al usuario (la fila cae en cascada) avisa");

await db.exec(ROLLBACK);
const d = await nuevo();
await permiso(d, "redes", true);
await db.query("update public.user_permissions set can_view = false where user_id = $1", [d]);
igual((await llamadas()).length, 3, "tras la vuelta atrás ya no avisa");

await db.close();
console.log(`redes_aviso_revocar: ${comprobaciones} comprobaciones en verde`);
