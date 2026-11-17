// Prueba la migración 20261211100000_reparar_producto_id_de_categoria y su rollback contra un
// Postgres en memoria (PGlite). Nunca toca Supabase.
//
//   node scripts/test-reparar-producto-categoria.mjs
//
// Caso real (17/11/2026): la categoría Servicios es la 11 y el producto 11 es la mostaza; la IA
// metía en la mostaza alquileres y descuentos. Se comprueba que:
//   - salen de la mostaza los alias IA ajenos (desde el 08/11) y sus líneas quedan sin producto;
//   - la mostaza de verdad, los alias manuales y los anteriores al 08/11 no se tocan;
//   - un producto cuyo id no es de categoría no se toca;
//   - aplicada dos veces no hace nada más; el rollback lo devuelve todo.
import { PGlite } from "@electric-sql/pglite";
import { readFile } from "node:fs/promises";
import assert from "node:assert/strict";

const MIGRACION = await readFile("supabase/migrations/20261211100000_reparar_producto_id_de_categoria.sql", "utf8");
const ROLLBACK = await readFile("supabase/rollbacks/20261211100000_reparar_producto_id_de_categoria_ROLLBACK.sql", "utf8");

let comprobaciones = 0;
const igual = (a, b, msg) => { assert.deepEqual(a, b, msg); comprobaciones++; };

const db = new PGlite();
await db.exec(`
  create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
  create table public.categorias_producto (id bigint primary key, nombre text not null);
  create table public.productos_catalogo (id bigint primary key, nombre text not null, categoria_id bigint);
  create table public.productos_alias (
    texto_normalizado text primary key, producto_id bigint not null, origen text not null,
    created_at timestamptz not null default now());
  create table public.productos_factura (id bigint primary key, nombre_normalizado text, producto_id bigint);

  insert into categorias_producto values (6, 'Despensa'), (11, 'Servicios');
  insert into productos_catalogo values (11, 'Mostaza de cerveza Rooftop 150 g', 6), (500, 'Alquiler', 11);
  insert into productos_alias values
    ('mostaza de cerveza 150g -rooftop-', 11, 'ia', '2026-11-13'),
    ('alquiler local febrero', 11, 'ia', '2026-11-15'),
    ('- 20 % bonificac s/ 12.975,5', 11, 'ia', '2026-11-08 12:00'),
    ('albaran 58', 11, 'manual', '2026-11-15'),
    ('cuota antigua', 11, 'ia', '2026-10-01'),
    ('albaran 63', 500, 'ia', '2026-11-15');
  insert into productos_factura values
    (1, 'mostaza de cerveza 150g -rooftop-', 11),
    (2, 'alquiler local febrero', 11),
    (3, 'alquiler local febrero', 11),
    (4, '- 20 % bonificac s/ 12.975,5', 11),
    (5, 'albaran 58', 11),
    (6, 'cuota antigua', 11),
    (7, 'albaran 63', 500);
`);

const estado = async () => ({
  alias: (await db.query(`select texto_normalizado t, producto_id p from productos_alias order by 1`)).rows,
  lineas: (await db.query(`select id, producto_id p from productos_factura order by id`)).rows,
});
const antes = await estado();

await db.exec(MIGRACION);
const despues = await estado();
igual(despues.alias.map((r) => r.t), ["albaran 58", "albaran 63", "cuota antigua", "mostaza de cerveza 150g -rooftop-"],
  "solo salen los alias IA ajenos desde el 08/11");
igual(despues.lineas.filter((r) => r.p === null).map((r) => r.id), [2, 3, 4], "sus líneas quedan sin producto");
igual(despues.lineas.find((r) => r.id === 7).p, 500, "un producto que no es id de categoría no se toca");
igual(Number((await db.query(`select count(*) n from productos_reparacion_ia_20261117`)).rows[0].n), 5, "respaldo: 2 alias + 3 líneas");

await db.exec(MIGRACION);
igual(await estado(), despues, "aplicada dos veces no cambia nada más");

await db.exec(ROLLBACK);
igual(await estado(), antes, "el rollback lo devuelve todo");
igual((await db.query(`select to_regclass('public.productos_reparacion_ia_20261117') r`)).rows[0].r, null, "y borra el respaldo");

console.log(`OK reparar-producto-categoria: ${comprobaciones} comprobaciones`);
