// Canal de los avisos de reserva (20261215100000) contra un Postgres en
// memoria (PGlite). Nunca toca Supabase.
//
//   npm run test:canal-avisos:db
//
// Aplica la migración REAL dos veces sobre una `reservas` con filas de antes.
// Cubre: que las reservas que ya existían quedan en 'email'; que una nueva sin
// decir nada también; que acepta 'whatsapp' y rechaza cualquier otro valor o
// NULL; que es idempotente; y la vuelta atrás (también idempotente).
import { PGlite } from "@electric-sql/pglite";
import { readFile } from "node:fs/promises";
import assert from "node:assert/strict";

const MIGRACION = await readFile("supabase/migrations/20261215100000_reservas_canal_avisos.sql", "utf8");
const ROLLBACK = await readFile("supabase/rollbacks/20261215100000_reservas_canal_avisos_ROLLBACK.sql", "utf8");

let comprobaciones = 0;
const igual = (a, b, msg) => { assert.deepEqual(a, b, msg); comprobaciones++; };
const falla = async (p, patron, msg) => { await assert.rejects(p, patron, msg); comprobaciones++; };

const db = new PGlite();
await db.exec(`
  create table public.reservas (
    id uuid primary key default gen_random_uuid(),
    nombre text,
    telefono text,
    estado text not null default 'pendiente'
  );
  insert into public.reservas (nombre, telefono, estado) values ('Antigua', '612345678', 'confirmada');
`);

const columna = async () =>
  (await db.query(`select column_name, is_nullable, column_default from information_schema.columns
                   where table_schema = 'public' and table_name = 'reservas' and column_name = 'canal_avisos'`)).rows;

await db.exec(MIGRACION);
igual((await db.query(`select canal_avisos from public.reservas where nombre = 'Antigua'`)).rows, [{ canal_avisos: "email" }],
  "las reservas que ya existían quedan en email");
await db.exec(`insert into public.reservas (nombre) values ('Nueva')`);
igual((await db.query(`select canal_avisos from public.reservas where nombre = 'Nueva'`)).rows, [{ canal_avisos: "email" }],
  "una reserva nueva sin decir nada: email");
await db.exec(`insert into public.reservas (nombre, canal_avisos) values ('Con WhatsApp', 'whatsapp')`);
igual((await db.query(`select canal_avisos from public.reservas where nombre = 'Con WhatsApp'`)).rows, [{ canal_avisos: "whatsapp" }],
  "acepta whatsapp");
await falla(db.exec(`insert into public.reservas (nombre, canal_avisos) values ('SMS', 'sms')`), /reservas_canal_avisos_check/,
  "rechaza un canal que no existe");
await falla(db.exec(`insert into public.reservas (nombre, canal_avisos) values ('Nulo', null)`), /null/i, "rechaza NULL");

await db.exec(MIGRACION);
igual((await columna()).length, 1, "idempotente: sigue habiendo una sola columna");
igual((await db.query(`select count(*)::int as n from pg_constraint where conname = 'reservas_canal_avisos_check'`)).rows, [{ n: 1 }],
  "idempotente: una sola restricción");

await db.exec(ROLLBACK);
igual(await columna(), [], "vuelta atrás: la columna desaparece");
igual((await db.query(`select count(*)::int as n from public.reservas`)).rows, [{ n: 3 }], "vuelta atrás: las reservas siguen ahí");
await db.exec(ROLLBACK);
igual(await columna(), [], "vuelta atrás idempotente");

console.log(`OK canal de avisos (20261215100000): ${comprobaciones} comprobaciones`);
