import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";

const db = new PGlite();
const id = "11111111-1111-4111-8111-111111111111";
await db.exec(`
  create role anon; create role authenticated; create role service_role;
  create schema auth;
  create table auth.users (id uuid primary key, email text, banned_until timestamptz);
  create table public.user_roles (user_id uuid primary key references auth.users(id), role text);
  create table public.super_admins (user_id uuid references auth.users(id), email text unique);
  create table public.user_access_status (user_id uuid primary key references auth.users(id), access_blocked boolean not null);
  insert into auth.users values ('${id}', 'usuario@staff.local', null);
  insert into public.user_roles values ('${id}', 'staff');
  insert into public.user_access_status values ('${id}', false);
`);
// Obtiene la migración por sufijo: su versión se alinea con Supabase al publicar.
const { readdirSync } = await import("node:fs");
const fichero = readdirSync("supabase/migrations").find(n => n.endsWith("_gestion_superadmin_atomica.sql"));
assert.ok(fichero);
await db.exec(readFileSync(`supabase/migrations/${fichero}`, "utf8"));
await db.query("select public.establecer_superadmin_panel($1,true,'usuario@staff.local')", [id]);
assert.equal((await db.query("select role from public.user_roles")).rows[0].role, "admin");
assert.equal((await db.query("select count(*)::int as n from public.super_admins")).rows[0].n, 1);
await db.query("select public.establecer_superadmin_panel($1,true,'usuario@staff.local')", [id]);
assert.equal((await db.query("select count(*)::int as n from public.super_admins")).rows[0].n, 1);
await db.query("select public.establecer_superadmin_panel($1,false,'usuario@staff.local')", [id]);
assert.equal((await db.query("select count(*)::int as n from public.super_admins")).rows[0].n, 0);

// Si la segunda escritura falla, ni se concede superadmin ni se cambia el rol.
await db.exec("update public.user_roles set role='staff'; alter table public.super_admins add constraint simular_fallo check (email <> 'usuario@staff.local')");
await assert.rejects(() => db.query("select public.establecer_superadmin_panel($1,true,'usuario@staff.local')", [id]));
assert.equal((await db.query("select role from public.user_roles")).rows[0].role, "staff");
assert.equal((await db.query("select count(*)::int as n from public.super_admins")).rows[0].n, 0);
await db.exec("alter table public.super_admins drop constraint simular_fallo; update public.user_access_status set access_blocked=true");
await assert.rejects(() => db.query("select public.establecer_superadmin_panel($1,true,'usuario@staff.local')", [id]), /Desbloquea/);
assert.equal((await db.query("select role from public.user_roles")).rows[0].role, "staff");
for (const rol of ["anon", "authenticated"]) {
  const { rows } = await db.query("select has_function_privilege($1, 'public.establecer_superadmin_panel(uuid,boolean,text)', 'execute') as permitido", [rol]);
  assert.equal(rows[0].permitido, false);
}
assert.equal((await db.query("select has_function_privilege('service_role', 'public.establecer_superadmin_panel(uuid,boolean,text)', 'execute') as permitido")).rows[0].permitido, true);
console.log("OK: concesión y retirada, idempotencia, rollback, bloqueo y permisos de ejecución");
await db.close();
