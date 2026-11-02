// Restricciones de "Bebidas" y "Cocteles" (2/3) contra un Postgres en memoria
// (PGlite), con la migración REAL *_restricciones_bebidas_cocteles.sql y la
// función public.alergenos_bien_formados tal y como la crea la 1/3
// (*_restricciones_platos_vinos.sql). Nunca toca Supabase.
//
//   npm run test:restricciones-bebidas:db
//
// Las dos tablas no se crean en ninguna migración del repo (vienen del
// proyecto original), así que aquí se crean con las columnas que tienen hoy
// en la demo (information_schema, 01/11/2026).
//
// Cubre: filas válidas de hoy, cada CHECK rechazando lo imposible como
// `authenticated`, la cancelación con RAISE si hay filas que incumplen (sin
// dejar nada a medias), que exige la función de la 1/3, la consulta de la
// cabecera, reejecución, el fichero de rollback y que los máximos coincidan con
// LIMITES_CARTA (src/lib/limites-carta.ts).
import { PGlite } from "@electric-sql/pglite";
import { readdir, readFile } from "node:fs/promises";
import assert from "node:assert/strict";

const MIGRACIONES = "supabase/migrations";
const ficheros = await readdir(MIGRACIONES);
const buscar = (sufijo) => {
  const f = ficheros.find((x) => x.endsWith(sufijo));
  assert.ok(f, `No se encontró supabase/migrations/*${sufijo}`);
  return f;
};
const FICHERO = buscar("_restricciones_bebidas_cocteles.sql");
const MIGRACION = await readFile(`${MIGRACIONES}/${FICHERO}`, "utf8");
const ROLLBACK = await readFile(`supabase/rollbacks/${FICHERO.replace(/\.sql$/, "_ROLLBACK.sql")}`, "utf8");

// La función de alérgenos, copiada tal cual de la migración de la 1/3.
const PLATOS_VINOS = await readFile(`${MIGRACIONES}/${buscar("_restricciones_platos_vinos.sql")}`, "utf8");
const FUNCION_1_3 = /CREATE OR REPLACE FUNCTION public\.alergenos_bien_formados[\s\S]*?\$fn\$;/.exec(PLATOS_VINOS)?.[0];
assert.ok(FUNCION_1_3, "No se encontró public.alergenos_bien_formados en la migración de la 1/3");
assert.ok(FICHERO > buscar("_restricciones_platos_vinos.sql"), "La 2/3 tiene que ir después de la 1/3");

// La consulta «Filas que incumplen» de la cabecera, sin el «--   ».
const ENSAYO = (() => {
  const lineas = MIGRACION.split(/\r?\n/);
  const inicio = lineas.findIndex((l) => l.startsWith("--   select 'Bebidas' tabla"));
  const fin = lineas.findIndex((l, i) => i > inicio && l.trimEnd().endsWith(";"));
  assert.ok(inicio >= 0 && fin > inicio, "La cabecera no tiene la consulta de filas que incumplen");
  return lineas.slice(inicio, fin + 1).map((l) => l.replace(/^--\s{0,3}/, "")).join("\n");
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

async function nuevaBD({ conFuncion = true } = {}) {
  const db = new PGlite();
  await db.exec(TABLAS);
  if (conFuncion) await db.exec(FUNCION_1_3);
  await db.exec(FILAS_HOY);
  return db;
}
const contarChecks = async (db) => (await db.query(`select count(*)::int n from pg_constraint where contype = 'c'
  and conrelid in ('public."Bebidas"'::regclass, 'public."Cocteles"'::regclass)`)).rows[0].n;

// --- 0. Sin la función de la 1/3 se cancela -------------------------------
{
  const sin = await nuevaBD({ conFuncion: false });
  await falla(sin.exec(MIGRACION), /Falta public\.alergenos_bien_formados/, "Sin la 1/3 la migración se cancela");
  await sin.exec("rollback");
  igual(await contarChecks(sin), 0, "Sin la 1/3 no queda ningún CHECK");
  await sin.close();
}

// --- 1. Se aplica sobre los datos de hoy y es reejecutable ----------------
const db = await nuevaBD();
igual((await db.query(ENSAYO)).rows.length, 0, "Consulta de la cabecera: 0 filas con los datos de hoy");
await pasa(db.exec(MIGRACION), "La migración se aplica sobre filas válidas");
await pasa(db.exec(MIGRACION), "La migración se puede volver a ejecutar");
const { rows: checks } = await db.query(`
  select conname, convalidated from pg_constraint
   where contype = 'c' and conrelid in ('public."Bebidas"'::regclass, 'public."Cocteles"'::regclass)`);
igual(checks.length, 11, "Once CHECK entre las dos tablas");
igual(checks.every((c) => c.convalidated), true, "Todos los CHECK quedan validados");

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

// Alérgenos (forma que fija la función de la 1/3)
const alerg = (v) => ins("Cocteles", { ...BASE, alergenos_oficiales: v });
await pasa(alerg(JSON.stringify(["gluten", "huevos", "marisco"])), "Alérgenos: lista de textos");
await pasa(alerg(JSON.stringify(["sin alérgenos declarados"])), "Alérgenos: declaración expresa");
await pasa(alerg(JSON.stringify(["a".repeat(100)])), "Alérgenos: uno de 100");
await pasa(alerg(null), "Alérgenos: NULL (sin completar)");
for (const [malo, nombre] of [
  ['"gluten"', "texto suelto"],
  ['"[\\"gluten\\"]"', "lista doblemente codificada como texto"],
  ['{"gluten": true}', "objeto"],
  ["[1, 2]", "números"],
  ['["gluten", null]', "con null"],
  ['["gluten", ""]', "con vacío"],
  ['["gluten", "  "]', "con solo espacios"],
  [JSON.stringify(["a".repeat(101)]), "alérgeno de 101"],
  ['[["gluten"]]', "lista anidada"],
]) {
  await falla(alerg(malo), CHECK, `Alérgenos: ${nombre}`);
}
await db.exec("reset role");

// --- 3. Filas que incumplen: RAISE con el recuento y nada a medias ---------
for (const [regla, rompe] of [
  ["bebidas_precio_valido", `update public."Bebidas" set precio_eur = -1 where id = 'b1'`],
  ["bebidas_imagen_url_https", `update public."Bebidas" set imagen_url = 'http://viejo/a.jpg' where id = 'b1'`],
  ["bebidas_nombre_valido", `update public."Bebidas" set nombre = null where id = 'b2'`],
  ["cocteles_nombre_valido", `update public."Cocteles" set nombre = '  ' where id = 'c1'`],
  ["cocteles_alergenos_validos", `update public."Cocteles" set alergenos_oficiales = '"[\\"gluten\\"]"' where id = 'c1'`],
]) {
  const sucia = await nuevaBD();
  await sucia.exec(rompe);
  igual((await sucia.query(ENSAYO)).rows.length, 1, `${regla}: la consulta de la cabecera lista la fila`);
  await falla(sucia.exec(MIGRACION), new RegExp(`Hay filas que incumplen[\\s\\S]*${regla}: 1 fila`), `${regla}: la migración se cancela y lo dice`);
  await sucia.exec("rollback");
  igual(await contarChecks(sucia), 0, `${regla}: tras cancelar no queda ningún CHECK a medias`);
  await sucia.close();
}

// --- 4. Rollback ------------------------------------------------------------
await pasa(db.exec(ROLLBACK), "El fichero de rollback se ejecuta");
igual(await contarChecks(db), 0, "Tras el rollback no queda ningún CHECK");
const { rows: fn } = await db.query(`select count(*)::int n from pg_proc where proname = 'alergenos_bien_formados'`);
igual(fn[0].n, 1, "El rollback no borra la función de la 1/3");
await pasa(db.exec(MIGRACION), "Se puede volver a aplicar tras el rollback");
await db.close();

// --- 5. Los máximos coinciden con LIMITES_CARTA ----------------------------
const lib = await readFile("src/lib/limites-carta.ts", "utf8");
const constante = (nombre) => Number(new RegExp(`export const ${nombre} = ([\\d.]+)`).exec(lib)?.[1]);
const bloque = /export const LIMITES_CARTA = \{([\s\S]*?)\} as const/.exec(lib)?.[1] ?? "";
const limite = (clave) => {
  const v = new RegExp(`\\b${clave}: ([\\w.]+)`).exec(bloque)?.[1];
  return /^\d+$/.test(v ?? "") ? Number(v) : constante(v);
};
const enSql = (col) => Number(new RegExp(`char_length\\(${col}\\)(?:, 0\\))?\\s*<= (\\d+)`).exec(MIGRACION)?.[1]);
for (const [clave, col] of [
  ["nombre", "nombre"], ["categoria", "categoria"], ["descripcion", "descripcion"], ["tamano", "tamano"],
  ["tipo", "tipo"], ["tag", "tag"], ["base", "base"], ["ingredientes", "ingredientes"],
  ["preparacion", "preparacion"], ["alergenosNotas", "alergenos_notas"], ["imagenUrl", "imagen_url"],
]) {
  igual(enSql(col), limite(clave), `Máximo de ${col}: migración = LIMITES_CARTA.${clave}`);
}
igual(constante("MAX_PRECIO_CARTA"), Number(/precio_eur <= ([\d.]+)/.exec(MIGRACION)[1]), "Precio máximo: migración = MAX_PRECIO_CARTA");
igual(Number(/char_length\(e\.elemento #>> '\{\}'\) > (\d+)/.exec(FUNCION_1_3)?.[1]), limite("alergeno"), "Largo de cada alérgeno: función de la 1/3 = LIMITES_CARTA.alergeno");

console.log(`✔ Restricciones de Bebidas y Cocteles: ${comprobaciones} comprobaciones`);
