// reservas.mesa_fijada («Fijar mesa», 07/11/2026) contra un Postgres en memoria
// (PGlite). Nunca toca Supabase.
//
//   npm run test:mesa-fijada:db
//
// Cubre: la migración REAL 20261107120000 aplicada dos veces (idempotente), el
// valor por defecto (false, también en filas que ya existían), que no admite
// NULL, que un `authenticated` con UPDATE la puede escribir, y el rollback.
import { PGlite } from "@electric-sql/pglite";
import { readFile } from "node:fs/promises";
import assert from "node:assert/strict";

const MIGRACION = await readFile("supabase/migrations/20261107120000_reservas_mesa_fijada.sql", "utf8");
const ROLLBACK = await readFile("supabase/rollbacks/20261107120000_reservas_mesa_fijada_ROLLBACK.sql", "utf8");

let comprobaciones = 0;
const ok = (v, msg) => { assert.ok(v, msg); comprobaciones++; };

const db = new PGlite();
await db.exec(`
  create role anon nologin; create role authenticated nologin;
  create table public.reservas (id text primary key, nombre text, hora time, estado text default 'pendiente');
  grant select, insert, update on public.reservas to authenticated;
  insert into public.reservas (id, nombre, hora) values ('r1', 'García', '21:30');
`);

await db.exec(MIGRACION);
await db.exec(MIGRACION); // idempotente

const fijada = async (id) => (await db.query(`select mesa_fijada from public.reservas where id = $1`, [id])).rows[0].mesa_fijada;
ok((await fijada("r1")) === false, "las reservas que ya había quedan sin fijar");

await db.exec(`insert into public.reservas (id, nombre, hora) values ('r2', 'López', '21:00')`);
ok((await fijada("r2")) === false, "una reserva nueva nace sin fijar");

await assert.rejects(db.exec(`update public.reservas set mesa_fijada = null where id = 'r1'`), /null/i);
comprobaciones++;

await db.exec(`set role authenticated; update public.reservas set mesa_fijada = true where id = 'r1'; reset role;`);
ok((await fijada("r1")) === true, "un usuario del panel con UPDATE la puede fijar");

const comentario = (await db.query(`select col_description('public.reservas'::regclass, attnum) c from pg_attribute where attrelid = 'public.reservas'::regclass and attname = 'mesa_fijada'`)).rows[0].c;
ok(/fijada/i.test(comentario ?? ""), "la columna lleva comentario");

await db.exec(ROLLBACK);
const n = (await db.query(`select count(*)::int n from information_schema.columns where table_name = 'reservas' and column_name = 'mesa_fijada'`)).rows[0].n;
ok(n === 0, "el rollback quita la columna");
await db.exec(ROLLBACK); // idempotente
comprobaciones++;

console.log(`✔ reservas.mesa_fijada: ${comprobaciones} comprobaciones`);
