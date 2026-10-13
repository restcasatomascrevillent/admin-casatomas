import { PGlite } from "@electric-sql/pglite";
import fs from "node:fs";
import assert from "node:assert/strict";

process.on("unhandledRejection", (error) => {
  console.error(error.message, error.code, error.where ?? "");
  process.exit(1);
});
const db = new PGlite();
const uid = "00000000-0000-4000-8000-000000000002";
const sid = "00000000-0000-4000-8000-000000000003";
await db.exec(`
CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS; CREATE ROLE authenticator;
CREATE SCHEMA auth; CREATE SCHEMA private; CREATE SCHEMA storage;
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$ SELECT (nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'sub')::uuid $$;
CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql AS $$ SELECT nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'role' $$;
CREATE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql AS $$ SELECT nullif(current_setting('request.jwt.claims',true),'')::jsonb $$;
CREATE TABLE auth.users(id uuid PRIMARY KEY, email text, banned_until timestamptz);
CREATE TABLE auth.sessions(id uuid PRIMARY KEY, user_id uuid REFERENCES auth.users);
CREATE TABLE auth.refresh_tokens(id integer PRIMARY KEY, user_id varchar(255));
CREATE TABLE public.user_permissions(user_id uuid, can_edit boolean);
CREATE TABLE storage.objects(id integer PRIMARY KEY, name text);
CREATE TABLE public.audit_log(id integer PRIMARY KEY,created_at timestamptz,actor_label text,tabla text,accion text,detalles jsonb);
CREATE FUNCTION public.audit_tabla_util(text) RETURNS boolean LANGUAGE sql AS $$ SELECT true $$;
ALTER TABLE public.user_permissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;
CREATE POLICY original ON public.user_permissions FOR ALL TO authenticated USING(true) WITH CHECK(true);
CREATE POLICY original ON storage.objects FOR ALL TO authenticated USING(true) WITH CHECK(true);
GRANT USAGE ON SCHEMA public,auth,storage TO anon,authenticated,service_role;
GRANT ALL ON public.user_permissions,storage.objects TO authenticated;
CREATE PUBLICATION supabase_realtime;
INSERT INTO auth.users VALUES('${uid}','persona@staff.local',null);
INSERT INTO auth.sessions VALUES('${sid}','${uid}');
INSERT INTO auth.refresh_tokens VALUES(1,'${uid}');
INSERT INTO public.user_permissions VALUES('${uid}',true);
INSERT INTO storage.objects VALUES(1,'foto.jpg');
`);
const migration = fs
  .readdirSync("supabase/migrations")
  .find((p) => p.endsWith("_bloquear_acceso_usuarios.sql"));
await db.exec(fs.readFileSync("supabase/migrations/" + migration, "utf8"));
const claims = JSON.stringify({
  role: "authenticated",
  sub: uid,
  session_id: sid,
});
const asUser = async () =>
  db.exec(`SET ROLE authenticated; SET request.jwt.claims='${claims}';`);
const scalar = async (sql) => Object.values((await db.query(sql)).rows[0])[0];
const denied = async (fn) => {
  await assert.rejects(fn, (error) => error.code === "42501");
};
await asUser();
await db.exec("SELECT private.verificar_acceso_panel()");
assert.equal(await scalar("SELECT count(*) FROM public.user_permissions"), 1);
assert.equal(await scalar("SELECT count(*) FROM storage.objects"), 1);
await db.exec("RESET ROLE");
await db.exec(
  `UPDATE auth.users SET banned_until=now()+interval '100 years' WHERE id='${uid}'`,
);
assert.equal(await scalar("SELECT count(*) FROM auth.sessions"), 0);
assert.equal(await scalar("SELECT count(*) FROM auth.refresh_tokens"), 0);
assert.equal(await scalar("SELECT count(*) FROM auth.users"), 1);
assert.equal(
  await scalar("SELECT can_edit FROM public.user_permissions"),
  true,
);
await asUser();
await denied(() => db.exec("SELECT private.verificar_acceso_panel()"));
assert.equal(await scalar("SELECT count(*) FROM public.user_permissions"), 0);
assert.equal(await scalar("SELECT count(*) FROM storage.objects"), 0);
// Realtime puede entregar el aviso al dispositivo bloqueado, solo el propio.
assert.equal(
  await scalar("SELECT access_blocked FROM public.user_access_status"),
  true,
);
await denied(() =>
  db.exec("UPDATE public.user_access_status SET access_blocked=false"),
);
await db.exec("RESET ROLE");
await db.exec(`UPDATE auth.users SET banned_until=null WHERE id='${uid}'`);
await asUser();
// Desbloquear permite otro login; nunca resucita las sesiones revocadas.
await denied(() => db.exec("SELECT private.verificar_acceso_panel()"));
await db.exec("RESET ROLE");
await db.exec(`INSERT INTO auth.sessions VALUES('${sid}','${uid}')`);
await asUser();
await db.exec("SELECT private.verificar_acceso_panel()");
assert.equal(await scalar("SELECT count(*) FROM public.user_permissions"), 1);
assert.equal(await scalar("SELECT count(*) FROM storage.objects"), 1);
await db.exec(
  'RESET ROLE; SET ROLE anon; SET request.jwt.claims=\'{"role":"anon"}\'; SELECT private.verificar_acceso_panel()',
);
await db.exec(
  'RESET ROLE; SET ROLE service_role; SET request.jwt.claims=\'{"role":"service_role"}\'; SELECT private.verificar_acceso_panel()',
);
console.log(
  "Bloqueo verificado: sesiones revocadas, tokens antiguos rechazados, RLS/Storage protegidos, aviso propio y permisos conservados al desbloquear.",
);
await db.close();
