// «Apto para celíacos» y «Apto sin lactosa» a mano (Platos.apto_celiacos /
// apto_sin_lactosa) contra un Postgres en memoria (PGlite). Nunca toca Supabase.
//
//   npm run test:platos-aptitudes:db
//
// Cubre: la migración REAL 20261122093000 aplicada dos veces (idempotente), que
// no cambia ninguna fila (todo queda NULL = automático), que admite true/false/
// NULL, que un `authenticated` con UPDATE puede cambiarlas, que no admite
// valores que no sean booleanos, y el rollback.
import { PGlite } from "@electric-sql/pglite";
import { readFile } from "node:fs/promises";
import assert from "node:assert/strict";

const MIGRACION = await readFile("supabase/migrations/20261122093000_platos_aptitudes_manuales.sql", "utf8");
const ROLLBACK = await readFile("supabase/rollbacks/20261122093000_platos_aptitudes_manuales_ROLLBACK.sql", "utf8");

let comprobaciones = 0;
const ok = (v, msg) => { assert.ok(v, msg); comprobaciones++; };

const db = new PGlite();

// Sin la tabla: falla con un mensaje claro y sin cambiar nada.
let error = null;
try { await db.exec(MIGRACION); } catch (e) { error = e; }
ok(error && /falta public\."Platos"/.test(String(error.message)), "sin Platos avisa y no hace nada");
await db.exec("rollback").catch(() => undefined);

await db.exec(`
  create role anon nologin; create role authenticated nologin;
  create table public."Platos" (id text primary key, nombre text, alergenos_oficiales jsonb,
    sin_gluten_disponible boolean not null default false, etiquetas_dieteticas jsonb);
  grant select, update on public."Platos" to authenticated;
  insert into public."Platos" values
    ('p1', 'Arroz meloso', '["moluscos"]', false, null),
    ('p2', 'Tarta de queso', '["lacteos","gluten"]', true, '["vegetariano"]');
`);

await db.exec(MIGRACION);
await db.exec(MIGRACION); // idempotente

const columnas = (await db.query(
  `select column_name, data_type, is_nullable, column_default from information_schema.columns
    where table_name = 'Platos' and column_name in ('apto_celiacos', 'apto_sin_lactosa') order by 1`,
)).rows;
ok(columnas.length === 2, "crea las dos columnas");
ok(columnas.every((c) => c.data_type === "boolean" && c.is_nullable === "YES" && c.column_default === null),
  "booleanas, NULL permitido y sin default");

const filas = (await db.query(`select id, apto_celiacos, apto_sin_lactosa, sin_gluten_disponible, etiquetas_dieteticas from public."Platos" order by id`)).rows;
ok(filas.every((f) => f.apto_celiacos === null && f.apto_sin_lactosa === null), "todos los platos quedan en automático (NULL)");
ok(filas[1].sin_gluten_disponible === true && JSON.stringify(filas[1].etiquetas_dieteticas) === '["vegetariano"]',
  "no toca «Se puede hacer sin gluten» ni «Vegetariano»");

await db.exec(`set role authenticated;
  update public."Platos" set apto_celiacos = true, apto_sin_lactosa = false where id = 'p1';
  reset role;`);
const p1 = (await db.query(`select apto_celiacos, apto_sin_lactosa from public."Platos" where id = 'p1'`)).rows[0];
ok(p1.apto_celiacos === true && p1.apto_sin_lactosa === false, "un usuario del panel puede marcarlo a mano");

await db.exec(`update public."Platos" set apto_celiacos = null where id = 'p1'`);
ok((await db.query(`select apto_celiacos from public."Platos" where id = 'p1'`)).rows[0].apto_celiacos === null,
  "se puede volver a automático (NULL)");

error = null;
try { await db.exec(`update public."Platos" set apto_sin_lactosa = 'quizá' where id = 'p1'`); } catch (e) { error = e; }
ok(error, "no admite valores que no sean booleanos");

const comentario = (await db.query(
  `select col_description('public."Platos"'::regclass, attnum) c from pg_attribute
    where attrelid = 'public."Platos"'::regclass and attname = 'apto_celiacos'`,
)).rows[0].c;
ok(/NULL = automático/.test(comentario), "documenta en la columna qué significa NULL");

await db.exec(ROLLBACK);
await db.exec(ROLLBACK); // repetible
const quedan = (await db.query(
  `select count(*)::int n from information_schema.columns where table_name = 'Platos' and column_name in ('apto_celiacos', 'apto_sin_lactosa')`,
)).rows[0].n;
ok(quedan === 0, "el rollback quita las dos columnas");
ok((await db.query(`select count(*)::int n from public."Platos"`)).rows[0].n === 2, "el rollback no borra platos");

console.log(`✔ Platos «Apto para» a mano: ${comprobaciones} comprobaciones`);
