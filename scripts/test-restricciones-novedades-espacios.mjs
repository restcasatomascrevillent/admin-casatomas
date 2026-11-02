// Restricciones en Novedades y espacios_reserva (3/3) contra un Postgres en
// memoria (PGlite), con la migración REAL 20261101180000 y su rollback.
// Nunca toca Supabase: ni la demo ni producción.
//
//   npm run test:restricciones:db
//
// Cubre: filas válidas siguen entrando y editándose; cada regla rechaza lo
// suyo (título vacío o de solo espacios, textos por encima del máximo, «hasta»
// antes de «desde», nombre vacío, capacidad negativa); los máximos justos
// caben; con filas viejas que incumplen la migración se cancela entera y dice
// cuáles (plantilla NOT VALID → comprobación → VALIDATE); reejecución
// idempotente; rollback.
import { PGlite } from "@electric-sql/pglite";
import { readFile } from "node:fs/promises";
import assert from "node:assert/strict";

const FICHERO = "20261101180000_restricciones_novedades_espacios";
const MIGRACION = await readFile(`supabase/migrations/${FICHERO}.sql`, "utf8");
const ROLLBACK = await readFile(`supabase/rollbacks/${FICHERO}_ROLLBACK.sql`, "utf8");

let comprobaciones = 0;
const ok = (v, msg) => { assert.ok(v, msg); comprobaciones++; };
const igual = (a, b, msg) => { assert.deepEqual(a, b, msg); comprobaciones++; };
const falla = async (promesa, patron, msg) => { await assert.rejects(promesa, patron, msg); comprobaciones++; };

// Columnas que tocan las reglas, con los tipos de la demo.
const TABLAS = `
  create table public.novedades (
    id uuid default gen_random_uuid() primary key, titulo text not null, descripcion text,
    titulo_en text, titulo_fr text, descripcion_en text, descripcion_fr text,
    badge_text text, badge_text_en text, badge_text_fr text,
    fecha_inicio date not null default current_date, fecha_fin date, tipo text not null default 'anuncio');
  create table public.espacios_reserva (
    id uuid default gen_random_uuid() primary key, nombre character varying not null, descripcion text,
    capacidad_maxima integer not null, activa boolean default true);
`;

const nuevaBd = async () => {
  const db = new PGlite();
  await db.exec(TABLAS);
  return db;
};
const restricciones = async (db) =>
  (await db.query(`select conname, convalidated from pg_constraint
     where conrelid in ('public.novedades'::regclass, 'public.espacios_reserva'::regclass) and contype = 'c'
     order by conname`)).rows;
const CHECK = /violates check constraint/;
const a = (n) => "a".repeat(n);

// 1. BD limpia: la migración entra y deja las 8 reglas validadas ------------
{
  const db = await nuevaBd();
  await db.query(`insert into public.novedades (titulo, fecha_inicio, fecha_fin) values ('Cocido', '2026-11-01', '2026-11-30')`);
  await db.query(`insert into public.espacios_reserva (nombre, capacidad_maxima) values ('Terraza', 40)`);
  await db.exec(MIGRACION);
  const r = await restricciones(db);
  igual(r.length, 8, "ocho restricciones");
  ok(r.every((x) => x.convalidated), "todas validadas (no quedan NOT VALID)");

  // Válidos: crear y editar siguen funcionando, también en los máximos justos.
  await db.query(`insert into public.novedades (titulo, descripcion, badge_text, titulo_en, descripcion_fr, badge_text_fr, fecha_inicio, fecha_fin)
    values ($1, $2, $3, $1, $2, $3, '2026-11-01', '2026-11-01')`, [a(150), a(2000), a(40)]);
  await db.query(`insert into public.novedades (titulo, fecha_inicio, fecha_fin) values ('Sin fin', '2026-11-01', null)`);
  await db.query(`update public.novedades set titulo = 'Cocido gallego', fecha_fin = '2026-12-31' where titulo = 'Cocido'`);
  await db.query(`insert into public.espacios_reserva (nombre, descripcion, capacidad_maxima) values ($1, $2, 0)`, [a(150), a(2000)]);
  await db.query(`update public.espacios_reserva set capacidad_maxima = 45, nombre = 'Terraza cubierta' where nombre = 'Terraza'`);
  // Emojis: char_length cuenta puntos de código, como el panel.
  await db.query(`insert into public.novedades (titulo, badge_text) values ('Emoji', $1)`, ["😀".repeat(40)]);
  igual((await db.query(`select count(*)::int n from public.novedades`)).rows[0].n, 4, "4 novedades");

  // Novedades: cada regla rechaza lo suyo.
  await falla(db.query(`insert into public.novedades (titulo) values ('')`), CHECK, "título vacío");
  await falla(db.query(`insert into public.novedades (titulo) values (E'  \\t\\n ')`), CHECK, "título de solo espacios");
  await falla(db.query(`insert into public.novedades (titulo) values ($1)`, [a(151)]), CHECK, "título de 151");
  await falla(db.query(`update public.novedades set titulo = '   ' where titulo = 'Sin fin'`), CHECK, "editar a título vacío");
  await falla(db.query(`insert into public.novedades (titulo, titulo_fr) values ('x', $1)`, [a(151)]), CHECK, "título FR de 151");
  await falla(db.query(`insert into public.novedades (titulo, descripcion) values ('x', $1)`, [a(2001)]), CHECK, "descripción de 2001");
  await falla(db.query(`insert into public.novedades (titulo, descripcion_en) values ('x', $1)`, [a(2001)]), CHECK, "descripción EN de 2001");
  await falla(db.query(`insert into public.novedades (titulo, badge_text) values ('x', $1)`, [a(41)]), CHECK, "etiqueta de 41");
  await falla(db.query(`insert into public.novedades (titulo, badge_text_fr) values ('x', $1)`, [a(41)]), CHECK, "etiqueta FR de 41");
  await falla(db.query(`insert into public.novedades (titulo, fecha_inicio, fecha_fin) values ('x', '2026-11-02', '2026-11-01')`),
    /novedades_fechas_en_orden/, "fin antes del inicio");
  await falla(db.query(`update public.novedades set fecha_inicio = '2027-01-01' where titulo = 'Cocido gallego'`),
    /novedades_fechas_en_orden/, "editar el inicio por detrás del fin");

  // espacios_reserva.
  await falla(db.query(`insert into public.espacios_reserva (nombre, capacidad_maxima) values ('', 10)`),
    /espacios_reserva_nombre_valido/, "nombre vacío");
  await falla(db.query(`insert into public.espacios_reserva (nombre, capacidad_maxima) values ('   ', 10)`), CHECK, "nombre de solo espacios");
  await falla(db.query(`insert into public.espacios_reserva (nombre, capacidad_maxima) values ($1, 10)`, [a(151)]), CHECK, "nombre de 151");
  await falla(db.query(`insert into public.espacios_reserva (nombre, descripcion, capacidad_maxima) values ('x', $1, 10)`, [a(2001)]), CHECK, "descripción de 2001");
  await falla(db.query(`insert into public.espacios_reserva (nombre, capacidad_maxima) values ('Sala', -1)`),
    /espacios_reserva_capacidad_no_negativa/, "capacidad negativa");
  await falla(db.query(`update public.espacios_reserva set capacidad_maxima = -5`), CHECK, "editar a capacidad negativa");

  // 2. Reejecutar: misma huella.
  const antes = await restricciones(db);
  await db.exec(MIGRACION);
  igual(await restricciones(db), antes, "idempotente");

  // 3. Rollback: sin reglas y los datos intactos; luego vuelve a aplicarse.
  await db.exec(ROLLBACK);
  igual(await restricciones(db), [], "rollback quita las 8");
  igual((await db.query(`select count(*)::int n from public.novedades`)).rows[0].n, 4, "rollback no toca datos");
  await db.query(`insert into public.espacios_reserva (nombre, capacidad_maxima) values ('', -1)`);
  ok(true, "sin reglas vuelve a aceptar lo de antes");
  await db.query(`delete from public.espacios_reserva where nombre = ''`);
  await db.exec(MIGRACION);
  igual((await restricciones(db)).length, 8, "se puede volver a aplicar tras el rollback");
  await db.close();
}

// 4. Filas viejas que incumplen: se cancela todo y dice cuáles ---------------
{
  const db = await nuevaBd();
  await db.query(`insert into public.novedades (titulo, fecha_inicio, fecha_fin) values ('  ', '2026-11-05', '2026-11-01')`);
  await db.query(`insert into public.novedades (titulo, badge_text) values ('Bien', $1)`, [a(41)]);
  await db.query(`insert into public.espacios_reserva (nombre, capacidad_maxima) values ('Patio', -3)`);
  let mensaje = "";
  try { await db.exec(MIGRACION); } catch (e) { mensaje = e.message; }
  ok(/Hay filas que incumplen/.test(mensaje), "la migración se cancela con un mensaje claro");
  for (const regla of ["novedades_titulo_valido", "novedades_fechas_en_orden", "novedades_etiquetas_longitud", "espacios_reserva_capacidad_no_negativa"]) {
    ok(mensaje.includes(regla), `el mensaje nombra ${regla}`);
  }
  ok(!mensaje.includes("espacios_reserva_nombre_valido"), "no nombra reglas que se cumplen");
  await db.exec("rollback").catch(() => {});
  igual(await restricciones(db), [], "nada a medias: ninguna restricción creada");

  // La consulta de la cabecera lista justo esas filas.
  const consulta = MIGRACION.split("\n")
    .slice(MIGRACION.split("\n").findIndex((l) => l.includes("select 'novedades' tabla")))
    .filter((l) => l.startsWith("--   ") || l.startsWith("--    "))
    .map((l) => l.slice(3));
  const sql = consulta.slice(0, consulta.findIndex((l) => l.trim().endsWith(";")) + 1).join("\n");
  const filas = (await db.query(sql)).rows.map((r) => `${r.tabla}:${r.nombre}`).sort();
  igual(filas, ["espacios_reserva:Patio", "novedades:  ", "novedades:Bien"], "la consulta de la cabecera lista las filas que incumplen");

  // Corregidas, entra.
  await db.query(`update public.novedades set titulo = 'Arreglada', fecha_fin = null where btrim(titulo) = ''`);
  await db.query(`update public.novedades set badge_text = left(badge_text, 40)`);
  await db.query(`update public.espacios_reserva set capacidad_maxima = 0`);
  await db.exec(MIGRACION);
  ok((await restricciones(db)).every((x) => x.convalidated), "tras corregir, entra y valida");
  await db.close();
}

console.log(`OK · restricciones de novedades y espacios_reserva: ${comprobaciones} comprobaciones`);
