// Control del enlace ingrediente -> producto de escandallo_platos (migración
// 20261207231500), contra PGlite. Nunca toca Supabase.
//   npm run test:escandallos-enlace:db
import { PGlite } from "@electric-sql/pglite";
import { pg_trgm } from "@electric-sql/pglite/contrib/pg_trgm";
import { unaccent } from "@electric-sql/pglite/contrib/unaccent";
import { readFile } from "node:fs/promises";
import assert from "node:assert/strict";

const MIG = await readFile("supabase/migrations/20261207231500_escandallos_control_enlace_producto.sql", "utf8");
const RB = await readFile("supabase/rollbacks/20261207231500_escandallos_control_enlace_producto_ROLLBACK.sql", "utf8");
const db = new PGlite({ extensions: { pg_trgm, unaccent } });
await db.exec(`
  create role anon; create role authenticated; create role service_role;
  create schema if not exists extensions;
  create extension if not exists unaccent;
  create table "Platos"(id text primary key, nombre text);
  create table productos_catalogo(id bigint primary key, nombre text not null);
  create table escandallo_platos(
    id bigint generated always as identity primary key,
    plato_id text not null references "Platos"(id),
    producto_id bigint not null references productos_catalogo(id),
    cantidad numeric not null default 1, unidad text not null default 'g',
    origen text not null default 'manual', nota text, orden smallint not null default 0);
  insert into "Platos" values ('p1','Plato 1');
  insert into productos_catalogo values (1,'Gamba blanca N1'),(2,'Huevos clase M docena'),
    (3,'Leche Puleva UHT hostelería 1,5 L'),(4,'Ajos tiernos'),(5,'Berenjena negra Metro Chef 6 kg');
`);
await db.exec(MIG.replace("create extension if not exists pg_trgm with schema extensions;", "create extension if not exists pg_trgm with schema extensions;"));

const dudoso = async (nota, prod) =>
  (await db.query("select public.escandallo_enlace_dudoso($1,$2) d", [nota, prod])).rows[0].d;
let n = 0;
const casos = [
  ["queso manchego curado", "Gamba blanca N1", true],
  ["huevo (la línea es la docena)", "Huevos clase M docena", false],
  ["leche de la bechamel", "Leche Puleva UHT hostelería 1,5 L", false],
  // Difícil: sin raíz común. Se decide avisar (falso aviso mejor que fallo silencioso).
  ["ajetes", "Ajos tiernos", true],
  ["berenjena", "Berenjena negra Metro Chef 6 kg", false],
  ["huevos", "Oreja de cerdo", true],
  ["se vende al peso: 1 kg", "Langosta", false],
  [null, "Gamba blanca N1", false],
  ["   ", "Gamba blanca N1", false],
];
for (const [nota, prod, esperado] of casos) {
  assert.equal(await dudoso(nota, prod), esperado, `${nota} / ${prod}`);
  n++;
}

// Trigger: nunca bloquea, marca. Vale para insert y update.
await db.exec(`insert into escandallo_platos(plato_id,producto_id,nota,origen) values
  ('p1',1,'queso manchego curado','manual'),('p1',2,'huevo (la línea es la docena)','estimado'),
  ('p1',3,null,'manual')`);
const filas = async () => (await db.query("select producto_id, revisar_enlace r from escandallo_platos order by producto_id")).rows;
assert.deepEqual((await filas()).map((f) => f.r), [true, false, false]); n++;
await db.exec("update escandallo_platos set nota='gamba' where producto_id=1");
assert.equal((await filas())[0].r, false); n++;
await db.exec("update escandallo_platos set producto_id=5 where producto_id=2");
assert.equal((await filas()).find((f) => f.producto_id === 5).r, true); n++;

// Consulta de control: recalcula aunque el trigger estuviera apagado.
await db.exec("alter table escandallo_platos disable trigger escandallo_marcar_enlace_trg");
await db.exec("insert into escandallo_platos(plato_id,producto_id,nota) values ('p1',4,'queso manchego')");
await db.exec("alter table escandallo_platos enable trigger escandallo_marcar_enlace_trg");
const lista = (await db.query("select producto_id, marcada from escandallos_enlaces_dudosos()")).rows;
assert.ok(lista.some((r) => r.producto_id == 4 && r.marcada === false)); n++;
assert.ok(lista.some((r) => r.producto_id == 5)); n++;

await db.exec(MIG); n++; // idempotente
await db.exec(RB);
assert.equal((await db.query("select count(*)::int c from information_schema.columns where table_name='escandallo_platos' and column_name='revisar_enlace'")).rows[0].c, 0); n++;
console.log(`test-escandallos-control-enlace: ${n} comprobaciones OK`);
