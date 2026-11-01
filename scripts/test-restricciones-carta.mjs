// Restricciones en la BD de Platos y Vinos contra un Postgres en memoria
// (PGlite). Nunca toca Supabase.
//
//   npm run test:restricciones-carta:db
//
// Cubre: la migración REAL 20261101220000 aplicada dos veces (idempotente)
// sobre filas que reproducen las que incumplían en demo y producción (vinos con
// alergenos_inferidos = texto "[]" y uno con imagen_url relativa, a la vez),
// que todas las restricciones quedan VALIDADAS, que la API rechaza cada dato
// imposible, que los válidos (precio NULL en Platos = «consultar precio»,
// precio 0, máximos justos) pasan, y el rollback.
import { PGlite } from "@electric-sql/pglite";
import { readFile } from "node:fs/promises";
import assert from "node:assert/strict";

const MIGRACION = await readFile("supabase/migrations/20261101220000_restricciones_platos_vinos.sql", "utf8");
const ROLLBACK = await readFile("supabase/rollbacks/20261101220000_restricciones_platos_vinos_ROLLBACK.sql", "utf8");

let comprobaciones = 0;
const ok = (v, msg) => { assert.ok(v, msg); comprobaciones++; };
const igual = (a, b, msg) => { assert.deepEqual(a, b, msg); comprobaciones++; };

// Columnas que tocan las restricciones, con los tipos reales (information_schema
// de la demo, 01/11/2026).
const ESQUEMA = `
  create table public."Platos" (
    id text primary key, nombre text, categoria text, precio_eur double precision, descripcion text,
    alergenos_oficiales jsonb, alergenos_inferidos jsonb, imagen_url text, expanded boolean default false
  );
  create table public."Vinos" (
    id text primary key, nombre text, categoria text, precio_eur double precision, descripcion text,
    alergenos_oficiales jsonb, alergenos_inferidos jsonb, imagen_url text, expanded boolean default false
  );
  insert into public."Platos" values
    ('p1', 'Arroz a banda', 'Arroces', 18.5, 'Clásico', '["moluscos"]', null, 'https://x.supabase.co/a.jpg', true),
    ('p2', 'Bogavante', 'Mariscos', null, null, '[]', '[]', null, false);
  insert into public."Vinos" values
    ('v1', 'Terreus', 'Tintos', 0, null, '["sulfitos"]', '"[]"', '/images/terreus.jpeg', true),
    ('v2', 'Ossian', 'Blancos', 42, null, '["sulfitos"]', '"[]"', 'https://x.supabase.co/o.jpg', false),
    ('v3', 'Mauro', 'Tintos', 39, null, '["sulfitos"]', '["sulfitos"]', null, false);
`;

const db = new PGlite();
await db.exec(ESQUEMA);
await db.exec(MIGRACION);
await db.exec(MIGRACION); // idempotente

const filas = async (sql, params) => (await db.query(sql, params)).rows;

// --- Restricciones creadas y validadas ---------------------------------------
const cons = await filas(`select conrelid::regclass::text tabla, conname, convalidated from pg_constraint
  where conrelid in ('public."Platos"'::regclass, 'public."Vinos"'::regclass) and contype = 'c' order by 1, 2`);
igual(cons.length, 12, "6 CHECK por tabla, sin duplicados tras aplicar dos veces");
ok(cons.every((c) => c.convalidated), "todas VALIDADAS (no quedan NOT VALID)");

// --- Limpieza de datos ---------------------------------------------------------
const terreus = (await filas(`select imagen_url, expanded, alergenos_inferidos from "Vinos" where id = 'v1'`))[0];
igual(terreus.imagen_url, null, "imagen_url relativa → NULL");
igual(terreus.expanded, false, "sin foto → no expandido");
igual(terreus.alergenos_inferidos, [], 'texto "[]" → array [] (en la misma fila que la imagen mala)');
igual((await filas(`select alergenos_inferidos from "Vinos" where id = 'v2'`))[0].alergenos_inferidos, [], 'texto "[]" → []');
igual((await filas(`select imagen_url, expanded from "Platos" where id = 'p1'`))[0], { imagen_url: "https://x.supabase.co/a.jpg", expanded: true }, "las filas buenas no se tocan");
igual((await filas(`select precio_eur from "Platos" where id = 'p2'`))[0].precio_eur, null, "precio NULL de Platos («consultar precio») se conserva");

// --- La API rechaza datos imposibles --------------------------------------------
const rechaza = async (tabla, columnas, valores, msg) => {
  let error = null;
  try {
    await db.query(`insert into public."${tabla}" (id, ${columnas.join(", ")}) values ('x', ${valores.map((_, i) => `$${i + 1}`).join(", ")})`, valores);
  } catch (e) { error = e; }
  ok(error && /check constraint/i.test(error.message), `${tabla}: rechaza ${msg}`);
};
const acepta = async (tabla, columnas, valores, msg) => {
  await db.exec("begin");
  try {
    await db.query(`insert into public."${tabla}" (id, ${columnas.join(", ")}) values ('ok', ${valores.map((_, i) => `$${i + 1}`).join(", ")})`, valores);
    comprobaciones++;
  } catch (e) {
    throw new Error(`${tabla}: debería aceptar ${msg}: ${e.message}`);
  } finally {
    await db.exec("rollback");
  }
};

const BASE = { nombre: "Plato", categoria: "Cat" };
const con = (extra) => {
  const o = { ...BASE, ...extra };
  return [Object.keys(o), Object.values(o)];
};

for (const tabla of ["Platos", "Vinos"]) {
  await rechaza(tabla, ...con({ nombre: "" }), "nombre vacío");
  await rechaza(tabla, ...con({ nombre: "   " }), "nombre solo espacios");
  await rechaza(tabla, ...con({ nombre: "\t\n " }), "nombre solo tabuladores/saltos");
  await rechaza(tabla, ["categoria"], ["Cat"], "nombre NULL");
  await rechaza(tabla, ...con({ nombre: "a".repeat(151) }), "nombre de 151");
  await rechaza(tabla, ...con({ categoria: "" }), "categoría vacía");
  await rechaza(tabla, ...con({ categoria: "  " }), "categoría solo espacios");
  await rechaza(tabla, ["nombre"], ["Plato"], "categoría NULL");
  await rechaza(tabla, ...con({ descripcion: "d".repeat(2001) }), "descripción de 2.001");
  await rechaza(tabla, ...con({ precio_eur: -0.01 }), "precio negativo");
  await rechaza(tabla, ...con({ precio_eur: 10000 }), "precio de 10.000");
  await rechaza(tabla, ...con({ precio_eur: "Infinity" }), "precio infinito");
  await rechaza(tabla, ...con({ precio_eur: "-Infinity" }), "precio -infinito");
  await rechaza(tabla, ...con({ precio_eur: "NaN" }), "precio NaN");
  await rechaza(tabla, ...con({ alergenos_oficiales: '"gluten"' }), "alérgenos como texto");
  await rechaza(tabla, ...con({ alergenos_oficiales: '{"gluten": true}' }), "alérgenos como objeto");
  await rechaza(tabla, ...con({ alergenos_oficiales: '[1]' }), "alérgeno numérico");
  await rechaza(tabla, ...con({ alergenos_oficiales: '[""]' }), "alérgeno vacío");
  await rechaza(tabla, ...con({ alergenos_oficiales: '[null]' }), "alérgeno null");
  await rechaza(tabla, ...con({ alergenos_inferidos: '"[]"' }), 'alergenos_inferidos como texto "[]"');
  await rechaza(tabla, ...con({ alergenos_oficiales: JSON.stringify(["x".repeat(101)]) }), "alérgeno de 101");
  await rechaza(tabla, ...con({ imagen_url: "http://ejemplo.com/a.jpg" }), "imagen http://");
  await rechaza(tabla, ...con({ imagen_url: "/images/a.jpg" }), "imagen relativa");
  await rechaza(tabla, ...con({ imagen_url: "javascript:alert(1)" }), "imagen javascript:");
  await rechaza(tabla, ...con({ imagen_url: "" }), "imagen vacía");

  await acepta(tabla, ...con({}), "lo mínimo");
  await acepta(tabla, ...con({ nombre: "a".repeat(150), descripcion: "d".repeat(2000) }), "los máximos justos");
  await acepta(tabla, ...con({ precio_eur: null }), "precio NULL («consultar precio»)");
  await acepta(tabla, ...con({ precio_eur: 0 }), "precio 0");
  await acepta(tabla, ...con({ precio_eur: 9999.99 }), "precio 9.999,99");
  await acepta(tabla, ...con({ alergenos_oficiales: '["gluten","frutos de cáscara"]', alergenos_inferidos: "[]" }), "alérgenos bien formados");
  await acepta(tabla, ...con({ alergenos_oficiales: null, alergenos_inferidos: null }), "alérgenos NULL");
  await acepta(tabla, ...con({ imagen_url: "https://x.supabase.co/storage/v1/object/public/vinos/a.webp" }), "imagen https");
}

// Editar una fila existente también se comprueba (las de antes ya no se libran).
let errorEdicion = null;
try { await db.query(`update public."Vinos" set precio_eur = -5 where id = 'v3'`); } catch (e) { errorEdicion = e; }
ok(errorEdicion, "editar con precio negativo se rechaza");
await db.query(`update public."Vinos" set precio_eur = 41.5, nombre = '  Mauro  ' where id = 'v3'`);
comprobaciones++;

// --- Rollback ------------------------------------------------------------------
await db.exec(ROLLBACK);
igual((await filas(`select count(*)::int n from pg_constraint where conrelid in ('public."Platos"'::regclass, 'public."Vinos"'::regclass) and contype = 'c'`))[0].n, 0, "rollback quita los CHECK");
igual((await filas(`select count(*)::int n from pg_proc where proname = 'alergenos_bien_formados'`))[0].n, 0, "rollback quita la función");
await db.exec(MIGRACION); // se puede volver a aplicar tras el rollback
igual((await filas(`select count(*)::int n from pg_constraint where conrelid in ('public."Platos"'::regclass, 'public."Vinos"'::regclass) and contype = 'c' and convalidated`))[0].n, 12, "reaplicar tras rollback");

console.log(`✓ Restricciones de Platos y Vinos: ${comprobaciones} comprobaciones`);
