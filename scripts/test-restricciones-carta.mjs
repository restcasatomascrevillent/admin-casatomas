// Restricciones de "Bebidas" y "Cocteles" contra un Postgres en memoria
// (PGlite), con la migración REAL *_restricciones_bebidas_cocteles.sql.
// Nunca toca Supabase: ni la demo ni producción.
//
//   npm run test:restricciones-carta:db
//
// Las dos tablas no se crean en ninguna migración del repo (vienen del
// proyecto original), así que aquí se crean con las columnas que tienen hoy
// en la demo (information_schema, 01/11/2026).
//
// Cubre: filas válidas de hoy (incluido lo que manda el panel), cada CHECK
// rechazando lo imposible, que un usuario `authenticated` sin más permisos
// pueda guardar (EXECUTE de la función de alérgenos), que el VALIDATE falle
// con filas que incumplen y no deje nada a medias, reejecución, bloque
// REVERSIÓN y que los máximos coincidan con src/lib/limites-carta.ts.
import { PGlite } from "@electric-sql/pglite";
import { readdir, readFile } from "node:fs/promises";
import assert from "node:assert/strict";

const MIGRACIONES = "supabase/migrations";
const fichero = (await readdir(MIGRACIONES)).find((f) => f.endsWith("_restricciones_bebidas_cocteles.sql"));
assert.ok(fichero, "No se encontró supabase/migrations/*_restricciones_bebidas_cocteles.sql");
const MIGRACION = await readFile(`${MIGRACIONES}/${fichero}`, "utf8");

function sqlReversion(texto) {
  const lineas = texto.split(/\r?\n/);
  const inicio = lineas.findIndex((l) => l.trim() === "-- >>> REVERSIÓN");
  const fin = lineas.findIndex((l) => l.trim() === "-- <<< FIN REVERSIÓN");
  assert.ok(inicio >= 0 && fin > inicio, "La migración no tiene el bloque REVERSIÓN con sus dos marcadores");
  return lineas.slice(inicio + 1, fin).map((l) => {
    assert.match(l, /^-- /, `Línea del bloque REVERSIÓN que no está comentada: «${l}»`);
    return l.slice(3);
  }).join("\n");
}
const REVERSION = sqlReversion(MIGRACION);

/** La CONSULTA DE ENSAYO comentada de la migración, sin el «-- » ni los comentarios de final de línea. */
const ENSAYO = (() => {
  const lineas = MIGRACION.split(/\r?\n/);
  const inicio = lineas.findIndex((l) => l.startsWith("-- SELECT 'Bebidas' AS tabla"));
  const fin = lineas.findIndex((l, i) => i > inicio && l.trimEnd().endsWith(";"));
  assert.ok(inicio >= 0 && fin > inicio, "La migración no tiene la CONSULTA DE ENSAYO");
  return lineas.slice(inicio, fin + 1).map((l) => l.slice(3).replace(/\s+--.*$/, "")).join("\n");
})();

let comprobaciones = 0;
const igual = (valor, esperado, nombre) => { assert.deepEqual(valor, esperado, nombre); comprobaciones++; };
const falla = async (promesa, patron, nombre) => { await assert.rejects(promesa, patron, nombre); comprobaciones++; };
const pasa = async (promesa, nombre) => {
  try { await promesa; } catch (e) { throw new Error(`${nombre}: ${e.message}`); }
  comprobaciones++;
};

const TABLAS = `
  create role anon nologin; create role authenticated nologin;
  create table public."Bebidas" (
    id text primary key, nombre text, categoria text, precio_eur float8, descripcion text, tamano text,
    activado boolean, orden int8, created_at timestamptz, updated_at timestamptz, imagen_url text,
    traducciones jsonb default '{}'::jsonb, nombre_en text, categoria_en text, descripcion_en text,
    nombre_fr text, categoria_fr text, descripcion_fr text, touza boolean default true,
    restaurante boolean default true, featured boolean default false, tipo text, tag text);
  create table public."Cocteles" (
    id text primary key default (gen_random_uuid())::text, nombre text, categoria text, precio_eur float8,
    descripcion text, ingredientes text, preparacion text, alergenos_oficiales jsonb, alergenos_notas text,
    activado boolean default true, orden int8, imagen_url text, traducciones jsonb default '{}'::jsonb,
    nombre_en text, categoria_en text, descripcion_en text, ingredientes_en text, nombre_fr text,
    categoria_fr text, descripcion_fr text, ingredientes_fr text, created_at timestamptz default now(),
    updated_at timestamptz default now(), base text, touza boolean default true,
    restaurante boolean default false, featured boolean default false);
  grant usage on schema public to anon, authenticated;
  grant select, insert, update, delete on public."Bebidas", public."Cocteles" to authenticated;
`;

const IMG = "https://sfonaclosuafvlhutkon.supabase.co/storage/v1/object/public/bebidas/b1-carta-jpg.webp";
const FILAS_HOY = `
  insert into public."Bebidas" (id, nombre, categoria, precio_eur, descripcion, tamano, imagen_url, nombre_en, nombre_fr)
    values ('b1', 'Agua mineral', 'Refrescos', 2.2, null, '50cl', '${IMG}', 'Mineral water', 'Eau minérale'),
           ('b2', 'Café solo', 'Cafés', 0, 'Espresso', null, null, null, null);
  insert into public."Cocteles" (id, nombre, categoria, precio_eur, ingredientes, alergenos_oficiales, base)
    values ('c1', 'Mojito', 'Clásicos', 9, 'Ron, menta, lima', null, 'Ron'),
           ('c2', 'Piña colada', 'Clásicos', 10.5, null, '["lácteos","frutos de cáscara"]', null),
           ('c3', 'Sin nada', 'Clásicos', 8, null, '[]', null);
`;

async function nuevaBD() {
  const db = new PGlite();
  await db.exec(TABLAS);
  await db.exec(FILAS_HOY);
  return db;
}

// --- 1. Se aplica sobre los datos de hoy y es reejecutable ----------------
const db = await nuevaBD();
await pasa(db.exec(MIGRACION), "La migración se aplica sobre filas válidas");
await pasa(db.exec(MIGRACION), "La migración se puede volver a ejecutar");
const { rows: checks } = await db.query(`
  select conrelid::regclass::text as tabla, conname, convalidated from pg_constraint
   where contype = 'c' and conrelid in ('public."Bebidas"'::regclass, 'public."Cocteles"'::regclass) order by 1, 2`);
igual(checks.length, 11, "Once CHECK entre las dos tablas");
igual(checks.every((c) => c.convalidated), true, "Todos los CHECK quedan VALIDATE");

// --- 2. Lo imposible se rechaza, como `authenticated` ---------------------
await db.exec("set role authenticated");
const ins = (tabla, cols) => {
  const claves = Object.keys(cols);
  return db.query(
    `insert into public."${tabla}" (id, ${claves.join(", ")}) values ('x' || gen_random_uuid(), ${claves.map((_, i) => `$${i + 1}`).join(", ")})`,
    Object.values(cols),
  );
};
const BASE = { nombre: "Tónica", categoria: "Refrescos", precio_eur: 3 };
const CHECK = /violates check constraint/;

for (const tabla of ["Bebidas", "Cocteles"]) {
  await pasa(ins(tabla, BASE), `${tabla}: alta válida (lo que manda el panel)`);
  await pasa(ins(tabla, { ...BASE, precio_eur: 9999.99 }), `${tabla}: precio 9999.99`);
  await pasa(ins(tabla, { ...BASE, precio_eur: 0 }), `${tabla}: precio 0 (lo prohíbe el formulario, no la BD)`);
  await pasa(ins(tabla, { ...BASE, nombre: "n".repeat(150), descripcion: "d".repeat(2000) }), `${tabla}: justo en los máximos`);
  await pasa(ins(tabla, { ...BASE, imagen_url: IMG }), `${tabla}: imagen https`);

  await falla(ins(tabla, { ...BASE, nombre: "" }), CHECK, `${tabla}: nombre vacío`);
  await falla(ins(tabla, { ...BASE, nombre: "   " }), CHECK, `${tabla}: nombre solo espacios`);
  await falla(ins(tabla, { ...BASE, nombre: " \t\n" }), CHECK, `${tabla}: nombre solo tabuladores y saltos`);
  await falla(ins(tabla, { ...BASE, nombre: null }), CHECK, `${tabla}: nombre NULL`);
  await falla(ins(tabla, { ...BASE, nombre: "n".repeat(151) }), CHECK, `${tabla}: nombre de 151`);
  await falla(ins(tabla, { ...BASE, categoria: "" }), CHECK, `${tabla}: categoría vacía`);
  await falla(ins(tabla, { ...BASE, categoria: "  " }), CHECK, `${tabla}: categoría solo espacios`);
  await falla(ins(tabla, { ...BASE, categoria: null }), CHECK, `${tabla}: categoría NULL`);
  await falla(ins(tabla, { ...BASE, precio_eur: -0.01 }), CHECK, `${tabla}: precio negativo`);
  await falla(ins(tabla, { ...BASE, precio_eur: 10000 }), CHECK, `${tabla}: precio 10000`);
  await falla(ins(tabla, { ...BASE, precio_eur: null }), CHECK, `${tabla}: precio NULL`);
  for (const raro of ["Infinity", "-Infinity", "NaN"]) {
    await falla(db.query(`insert into public."${tabla}" (id, nombre, categoria, precio_eur) values ('r', 'X', 'Y', '${raro}'::float8)`),
      CHECK, `${tabla}: precio ${raro}`);
  }
  for (const url of ["http://ejemplo.com/a.jpg", "", "javascript:alert(1)", "https://", "https://a b.jpg", "ftp://x/y.jpg"]) {
    await falla(ins(tabla, { ...BASE, imagen_url: url }), CHECK, `${tabla}: imagen_url «${url}»`);
  }
  await falla(ins(tabla, { ...BASE, descripcion: "d".repeat(2001) }), CHECK, `${tabla}: descripción de 2001`);
  await falla(ins(tabla, { ...BASE, nombre_en: "n".repeat(151) }), CHECK, `${tabla}: nombre_en de 151`);
  await falla(db.query(`update public."${tabla}" set nombre = ' ' where id = '${tabla === "Bebidas" ? "b1" : "c1"}'`),
    CHECK, `${tabla}: editar dejando el nombre en blanco`);
}
await falla(ins("Bebidas", { ...BASE, tamano: "t".repeat(31) }), CHECK, "Bebidas: tamaño de 31");
await falla(ins("Cocteles", { ...BASE, alergenos_notas: "a".repeat(501) }), CHECK, "Cocteles: notas de alérgenos de 501");
await falla(ins("Cocteles", { ...BASE, ingredientes: "i".repeat(2001) }), CHECK, "Cocteles: ingredientes de 2001");

// Alérgenos
const alerg = (v) => ins("Cocteles", { ...BASE, alergenos_oficiales: v });
await pasa(alerg(JSON.stringify(["gluten", "huevos", "marisco"])), "Alérgenos: lista de textos");
await pasa(alerg(JSON.stringify(["sin alérgenos declarados"])), "Alérgenos: declaración expresa");
await pasa(alerg(null), "Alérgenos: NULL (sin completar)");
for (const [malo, nombre] of [
  ['"gluten"', "texto suelto"],
  ['"[\\"gluten\\"]"', "lista doblemente codificada como texto"],
  ['{"gluten": true}', "objeto"],
  ["[1, 2]", "números"],
  ['["gluten", null]', "con null"],
  ['["gluten", ""]', "con vacío"],
  ['["gluten", "  "]', "con solo espacios"],
  ['["gluten", "Gluten "]', "repetido (mayúsculas y espacios)"],
  [JSON.stringify(["a".repeat(61)]), "alérgeno de 61"],
  [JSON.stringify(Array.from({ length: 31 }, (_, i) => `a${i}`)), "31 alérgenos"],
  ['[["gluten"]]', "lista anidada"],
]) {
  await falla(alerg(malo), CHECK, `Alérgenos: ${nombre}`);
}
await db.exec("reset role");

// --- 3. Filas que incumplen: el VALIDATE falla y no queda nada a medias ---
for (const [tabla, rompe] of [
  ["Bebidas", `update public."Bebidas" set precio_eur = -1 where id = 'b1'`],
  ["Bebidas", `update public."Bebidas" set imagen_url = 'http://viejo/a.jpg' where id = 'b1'`],
  ["Cocteles", `update public."Cocteles" set nombre = '  ' where id = 'c1'`],
  ["Cocteles", `update public."Cocteles" set alergenos_oficiales = '"[\\"gluten\\"]"' where id = 'c1'`],
]) {
  const sucia = await nuevaBD();
  await sucia.exec(rompe);
  await falla(sucia.exec(`begin; ${MIGRACION}; commit;`), /check constraint .* is violated by some row/, `${tabla}: VALIDATE falla con «${rompe}»`);
  await sucia.exec("rollback");
  const { rows } = await sucia.query(`select count(*)::int n from pg_constraint where contype = 'c'
    and conrelid in ('public."Bebidas"'::regclass, 'public."Cocteles"'::regclass)`);
  igual(rows[0].n, 0, `${tabla}: tras el fallo no queda ningún CHECK a medias`);
  // La consulta de ensayo de la migración encuentra esa fila.
  await sucia.exec(MIGRACION.split("-- Bebidas\n")[0]); // crea solo la función, para la consulta
  const { rows: encontradas } = await sucia.query(ENSAYO);
  igual(encontradas.length, 1, `${tabla}: la consulta de ensayo lista la fila que incumple`);
  await sucia.close();
}

// --- 4. Reversión ----------------------------------------------------------
await pasa(db.exec(REVERSION), "El bloque REVERSIÓN se ejecuta");
const { rows: tras } = await db.query(`select count(*)::int n from pg_constraint where contype = 'c'
  and conrelid in ('public."Bebidas"'::regclass, 'public."Cocteles"'::regclass)`);
igual(tras[0].n, 0, "Tras la reversión no queda ningún CHECK");
const { rows: fn } = await db.query(`select count(*)::int n from pg_proc where proname = 'carta_alergenos_bien_formados'`);
igual(fn[0].n, 0, "Tras la reversión no queda la función");
await db.close();

// --- 5. Los máximos coinciden con src/lib/limites-carta.ts ----------------
const lib = await readFile("src/lib/limites-carta.ts", "utf8");
const limite = (clave) => Number(new RegExp(`\\b${clave}: (\\d+)`).exec(lib)?.[1]);
const enSql = (col) => {
  const m = new RegExp(`char_length\\(${col}\\)\\)?,? ?0?\\)?\\s*<= (\\d+)`).exec(MIGRACION);
  return Number(m?.[1]);
};
for (const [clave, col] of [
  ["nombre", "nombre"], ["categoria", "categoria"], ["descripcion", "descripcion"], ["tamano", "tamano"],
  ["tipo", "tipo"], ["tag", "tag"], ["base", "base"], ["ingredientes", "ingredientes"],
  ["preparacion", "preparacion"], ["alergenosNotas", "alergenos_notas"], ["imagenUrl", "imagen_url"],
]) {
  igual(enSql(col), limite(clave), `Máximo de ${col}: migración = limites-carta.ts`);
}
igual(Number(/PRECIO_MAXIMO_CARTA = ([\d.]+)/.exec(lib)[1]), 9999.99, "Precio máximo en limites-carta.ts");
igual(Number(/precio_eur <= ([\d.]+)/.exec(MIGRACION)[1]), 9999.99, "Precio máximo en la migración");
igual(Number(/> (\d+)\n\s+\)\n\s+AND \(/.exec(MIGRACION)?.[1]), limite("alergeno"), "Largo de cada alérgeno");
igual(Number(/jsonb_array_length\(alergenos\) <= (\d+)/.exec(MIGRACION)[1]), limite("alergenosMax"), "Número de alérgenos");

console.log(`✔ Restricciones de Bebidas y Cocteles: ${comprobaciones} comprobaciones`);
