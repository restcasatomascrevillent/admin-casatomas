// Platos.updated_at cambia al editar (QA F-45) contra un Postgres en memoria
// (PGlite). Nunca toca Supabase.
//
//   npm run test:platos-updated-at:db
//
// Cubre: la migración REAL 20261101210000 aplicada dos veces (idempotente),
// que un UPDATE cualquiera (también uno que intenta fijar updated_at a mano)
// deja updated_at = now(), que el INSERT no se ve afectado, que un
// `authenticated` con permiso de UPDATE también lo dispara, y el rollback.
import { PGlite } from "@electric-sql/pglite";
import { readFile } from "node:fs/promises";
import assert from "node:assert/strict";

const MIGRACION = await readFile("supabase/migrations/20261101210000_platos_updated_at_al_editar.sql", "utf8");
const ROLLBACK = await readFile("supabase/rollbacks/20261101210000_platos_updated_at_al_editar_ROLLBACK.sql", "utf8");

let comprobaciones = 0;
const ok = (v, msg) => { assert.ok(v, msg); comprobaciones++; };

const db = new PGlite();
await db.exec(`
  create role anon nologin; create role authenticated nologin;
  create table public."Platos" (id text primary key, nombre text, activado boolean default true,
    created_at timestamptz, updated_at timestamptz);
  grant select, update on public."Platos" to authenticated;
  insert into public."Platos" values ('p1', 'Arroz meloso', true, '2026-01-01', '2026-01-01');
`);

const fecha = async (id = "p1") =>
  (await db.query(`select updated_at from public."Platos" where id = $1`, [id])).rows[0].updated_at;

// Sin la migración: el defecto (updated_at no cambia).
await db.exec(`update public."Platos" set nombre = 'Arroz meloso de bogavante' where id = 'p1'`);
ok((await fecha()).toISOString().startsWith("2026-01-01"), "sin trigger, updated_at se queda igual (defecto F-45)");

await db.exec(MIGRACION);
await db.exec(MIGRACION); // idempotente

await db.exec(`update public."Platos" set nombre = 'Arroz del senyoret' where id = 'p1'`);
const tras = await fecha();
ok(Date.now() - tras.getTime() < 60_000, "al editar el nombre, updated_at pasa a ahora");

await db.exec(`update public."Platos" set updated_at = '2000-01-01' where id = 'p1'`);
ok(Date.now() - (await fecha()).getTime() < 60_000, "no se puede dejar una fecha antigua a mano");

await db.exec(`insert into public."Platos" values ('p2', 'Chuletón', true, '2026-02-02', '2026-02-02')`);
ok((await fecha("p2")).toISOString().startsWith("2026-02-02"), "el INSERT conserva el updated_at que se le pasa");

await db.exec(`update public."Platos" set updated_at = '2026-03-03' where id = 'p2'`);
await db.exec(`set role authenticated; update public."Platos" set activado = false where id = 'p2'; reset role;`);
ok(Date.now() - (await fecha("p2")).getTime() < 60_000, "un usuario del panel (authenticated) también lo dispara");

const n = (await db.query(`select count(*)::int n from pg_trigger where tgname = 'trg_platos_updated_at'`)).rows[0].n;
ok(n === 1, "un único trigger tras aplicar la migración dos veces");

await db.exec(ROLLBACK);
const tras_rb = (await db.query(`select count(*)::int n from pg_trigger where tgname = 'trg_platos_updated_at'`)).rows[0].n;
ok(tras_rb === 0, "el rollback quita el trigger");
const f = (await db.query(`select count(*)::int n from pg_proc where proname = 'carta_tocar_updated_at'`)).rows[0].n;
ok(f === 0, "el rollback quita la función");

console.log(`✔ Platos.updated_at al editar: ${comprobaciones} comprobaciones`);
