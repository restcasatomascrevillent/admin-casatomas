// Alertas de un documento al añadir o borrar líneas, contra un Postgres en
// memoria (PGlite). Nunca toca Supabase.
//
//   npm run test:alertas-lineas:db
//
// Cubre la migración REAL 20261104120000 (aplicada dos veces): un INSERT o
// DELETE de líneas desde el panel recalcula UNA vez por documento y sentencia;
// service_role (el OCR) no dispara nada; y el rollback.
// recalcular_alertas_factura se sustituye por un stub que apunta las llamadas
// (su lógica real ya está en 20261010140000).
import { PGlite } from "@electric-sql/pglite";
import { readFile } from "node:fs/promises";
import assert from "node:assert/strict";

const MIGRACION = await readFile("supabase/migrations/20261104120000_productos_factura_alertas_al_anadir_borrar.sql", "utf8");
const ROLLBACK = await readFile("supabase/rollbacks/20261104120000_productos_factura_alertas_al_anadir_borrar_ROLLBACK.sql", "utf8");

let comprobaciones = 0;
const ok = (v, msg) => { assert.ok(v, msg); comprobaciones++; };

const db = new PGlite();
await db.exec(`
  create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
  create schema auth;
  create function auth.jwt() returns jsonb language sql stable as $$ select nullif(current_setting('request.jwt.claims', true), '')::jsonb $$;
  create function auth.role() returns text language sql stable as $$ select auth.jwt() ->> 'role' $$;
  grant usage on schema auth to anon, authenticated, service_role;
  grant execute on all functions in schema auth to anon, authenticated, service_role;

  create table public.facturas (id bigint primary key);
  create table public.productos_factura (id bigserial primary key, factura_id bigint references public.facturas(id) on delete cascade, nombre text not null);
  grant select, insert, update, delete on public.productos_factura to authenticated, service_role;
  grant usage on sequence public.productos_factura_id_seq to authenticated, service_role;
  insert into public.facturas values (1), (2);

  create table public.llamadas (factura_id bigint);
  create function public.recalcular_alertas_factura(p_factura_id bigint) returns void
    language sql security definer as $$ insert into public.llamadas values (p_factura_id) $$;
`);

const llamadas = async () => (await db.query(`select factura_id from public.llamadas order by factura_id`)).rows.map((r) => Number(r.factura_id));
const limpiar = () => db.exec(`delete from public.llamadas`);
const comoPanel = (sql) => db.exec(`set role authenticated; select set_config('request.jwt.claims', '{"role":"authenticated"}', false); ${sql}; reset role; select set_config('request.jwt.claims', '', false);`);
const comoOcr = (sql) => db.exec(`set role service_role; select set_config('request.jwt.claims', '{"role":"service_role"}', false); ${sql}; reset role; select set_config('request.jwt.claims', '', false);`);

await db.exec(MIGRACION);
await db.exec(MIGRACION); // idempotente

await comoPanel(`insert into public.productos_factura (factura_id, nombre) values (1, 'Chuletón')`);
ok(JSON.stringify(await llamadas()) === "[1]", "añadir una línea desde el panel recalcula su documento");
await limpiar();

await comoPanel(`insert into public.productos_factura (factura_id, nombre) values (1, 'a'), (1, 'b'), (2, 'c')`);
ok(JSON.stringify(await llamadas()) === "[1,2]", "varias líneas en una sentencia: una vez por documento");
await limpiar();

await comoPanel(`delete from public.productos_factura where nombre = 'a'`);
ok(JSON.stringify(await llamadas()) === "[1]", "borrar una línea recalcula su documento");
await limpiar();

await comoOcr(`insert into public.productos_factura (factura_id, nombre) values (2, 'ocr')`);
await comoOcr(`delete from public.productos_factura where factura_id = 2`);
ok((await llamadas()).length === 0, "service_role (OCR) no dispara el recálculo");

await db.exec(`insert into public.productos_factura (factura_id, nombre) values (2, 'sql editor')`);
ok(JSON.stringify(await llamadas()) === "[2]", "sin JWT (SQL editor) sí recalcula");
await limpiar();

await comoPanel(`update public.productos_factura set nombre = 'x' where factura_id = 1`);
ok((await llamadas()).length === 0, "un UPDATE no lo dispara (es cosa del trigger de 20261010140000)");

const n = (await db.query(`select count(*)::int n from pg_trigger where tgname like 'trg_productos_factura_alertas_%'`)).rows[0].n;
ok(n === 2, "dos triggers (insert y delete) tras aplicar la migración dos veces");

await db.exec(ROLLBACK);
const tras = (await db.query(`select count(*)::int n from pg_trigger where tgname like 'trg_productos_factura_alertas_%'`)).rows[0].n;
ok(tras === 0, "el rollback quita los triggers");
const f = (await db.query(`select count(*)::int n from pg_proc where proname = 'productos_factura_recalcular_alertas_lote'`)).rows[0].n;
ok(f === 0, "el rollback quita la función");
await comoPanel(`insert into public.productos_factura (factura_id, nombre) values (1, 'tras rollback')`);
ok((await llamadas()).length === 0, "tras el rollback, añadir una línea ya no recalcula");

console.log(`✔ Alertas al añadir/borrar líneas: ${comprobaciones} comprobaciones`);
