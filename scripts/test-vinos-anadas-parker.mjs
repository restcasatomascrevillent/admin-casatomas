// Scripts de datos «añadas en el nombre + Parker aplicado» (10/11/2026),
// contra un Postgres en memoria (PGlite). Nunca toca Supabase.
//
//   npm run test:vinos-anadas:db
//
// Aplica las migraciones REALES de Parker (20261104140000 y 20261118103000) y
// luego:
//   1. Un juego de cambios de prueba generado con scripts/parker/generar-sql-anadas.mjs:
//      cambia nombre + traducciones + añada, la puntuación verificada de la añada
//      servida pasa a la web, una fila en revisión se corrige, una fila nueva se
//      inserta; es idempotente; salta (y no pisa) lo que alguien cambió después;
//      la vuelta atrás deja los valores anteriores.
//   2. Los scripts REALES de supabase/seeds/20261110_vinos_anadas_parker_* sobre
//      una carta sembrada con los valores «antes» de docs/anadas-parker-2026-11-10/cambios.json:
//      aplican todo, dos veces sin cambiar nada más, y la vuelta atrás lo deja igual.
import { PGlite } from "@electric-sql/pglite";
import { readFile } from "node:fs/promises";
import assert from "node:assert/strict";
import { generar, nombreConAnada } from "./parker/generar-sql-anadas.mjs";

const leer = (ruta) => readFile(ruta, "utf8");
const COPEO = await leer("supabase/migrations/20261104140000_vinos_copeo_y_parker.sql");
const FUENTES = await leer("supabase/migrations/20261118103000_vinos_puntuacion_parker_fuentes.sql");

let comprobaciones = 0;
const ok = (v, msg) => { assert.ok(v, msg); comprobaciones++; };
const igual = (a, b, msg) => { assert.deepEqual(a, b, msg); comprobaciones++; };

const ANDAMIAJE = `
  create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
  create schema auth; create schema private;
  create table auth.users (id uuid primary key);
  create function auth.jwt() returns jsonb language sql stable as $$ select nullif(current_setting('request.jwt.claims', true), '')::jsonb $$;
  create function auth.uid() returns uuid language sql stable as $$ select (auth.jwt() ->> 'sub')::uuid $$;
  create function public.can_read_section(_section text) returns boolean language sql stable as $f$ select false $f$;
  create function public.can_edit_section(_section text) returns boolean language sql stable as $f$ select false $f$;
  create table public."Vinos" (
    id text primary key, nombre text, nombre_en text, nombre_fr text, categoria text, precio_eur double precision,
    activado boolean default true, restaurante boolean default true, touza boolean default true);
`;

async function nuevaBd() {
  const db = new PGlite();
  await db.exec(ANDAMIAJE);
  await db.exec(COPEO);
  await db.exec(FUENTES);
  return db;
}

/** Ejecuta un script y devuelve los avisos (raise notice). */
async function ejecutar(db, sql) {
  const avisos = [];
  await db.exec(sql, { onNotice: (n) => avisos.push(n.message) });
  return avisos;
}

const FILA_BASE = {
  estado: "verificada", motivo: null, puntos_texto: "94", puntos_min: 94, puntos_max: 94, provisional: false,
  vino_evaluado: "Aalto PS 2022", entidad: "Robert Parker Wine Advocate", critico: "Luis Gutiérrez",
  fecha_valoracion: "2024-06", fuente_nombre: "Wine-Searcher", fuente_url: "https://www.wine-searcher.com/x",
  fuente_tipo: "secundaria", cita: "Wine Advocate 94", fecha_consulta: "2026-11-10", discrepancias: [], notas: null,
  origen: "revision",
};

// ─── 1. Juego de prueba ────────────────────────────────────────────────────
{
  const db = await nuevaBd();
  const q = (sql, p) => db.query(sql, p);
  await db.exec(`
    insert into public."Vinos" (id, nombre, nombre_en, nombre_fr) values
      ('ps', 'Aalto PS', 'Aalto PS', 'Aalto PS'),
      ('mag', 'Carraovejas (Magnum)', 'Carraovejas (Magnum)', null),
      ('nv', 'Piper-Heidsieck', null, null),
      ('tocado', 'Mauro', 'Mauro', 'Mauro');
    insert into public.vinos_puntuacion_parker (vino_id, anada, estado, puntos_texto, puntos_min, puntos_max,
      fuente_nombre, fuente_url, fecha_consulta, origen)
    values ('ps', 2022, 'verificada', '94', 94, 94, 'Wine-Searcher', 'https://www.wine-searcher.com/x', '2026-11-08', 'revision'),
           ('mag', 2023, 'revision', '93', 93, 93, 'Tienda', 'https://tienda.es/x', '2026-11-08', 'revision');
  `);
  const vino = (id, antes, a, nv = false) => ({
    id, nombre_antes: antes.nombre, nombre_despues: nv ? antes.nombre : nombreConAnada(antes.nombre, a),
    nombre_en_antes: antes.en ?? null, nombre_en_despues: antes.en ? nombreConAnada(antes.en, a) : antes.en ?? null,
    nombre_fr_antes: antes.fr ?? null, nombre_fr_despues: antes.fr ? nombreConAnada(antes.fr, a) : antes.fr ?? null,
    anada_antes: null, anada_despues: nv ? null : a, sin_anada_antes: false, sin_anada_despues: nv,
  });
  const datos = {
    vinos: [
      vino("ps", { nombre: "Aalto PS", en: "Aalto PS", fr: "Aalto PS" }, 2022),
      vino("mag", { nombre: "Carraovejas (Magnum)", en: "Carraovejas (Magnum)" }, 2023),
      vino("nv", { nombre: "Piper-Heidsieck" }, null, true),
      vino("tocado", { nombre: "Mauro", en: "Mauro", fr: "Mauro" }, 2023),
      vino("no-existe", { nombre: "Solo en producción" }, 2020),
    ],
    parker: [
      { vino_id: "mag", nombre: "Carraovejas (Magnum)", anada: 2023, sin_anada: false,
        antes: { estado: "revision", puntos_texto: "93", provisional: false },
        despues: { ...FILA_BASE, puntos_texto: "92", puntos_min: 92, puntos_max: 92, vino_evaluado: "Pago de Carraovejas 2023" } },
      { vino_id: "tocado", nombre: "Mauro", anada: 2023, sin_anada: false, antes: null,
        despues: { ...FILA_BASE, estado: "revision", puntos_texto: "94+", puntos_min: 94, puntos_max: 94 } },
      { vino_id: "no-existe", nombre: "Solo en producción", anada: 2020, sin_anada: false, antes: null, despues: FILA_BASE },
    ],
  };
  const sql = generar(datos);
  igual(Object.keys(sql).sort(), [
    "20261110_vinos_anadas_parker_demo.sql", "20261110_vinos_anadas_parker_demo_ROLLBACK.sql",
    "20261110_vinos_anadas_parker_produccion.sql", "20261110_vinos_anadas_parker_produccion_ROLLBACK.sql",
  ], "genera ida y vuelta para demo y producción");
  ok(sql["20261110_vinos_anadas_parker_produccion.sql"].includes("haqmmdfdzzatdnrrcgez"), "el de producción lo dice en la cabecera");

  // Alguien cambia «Mauro» en el panel antes de aplicar: no se pisa.
  await q(`update public."Vinos" set nombre = 'Mauro VS' where id = 'tocado'`);
  const avisos = await ejecutar(db, sql["20261110_vinos_anadas_parker_demo.sql"]);
  const v = async (id) => (await q(`select nombre, nombre_en, nombre_fr, anada, sin_anada, puntuacion_parker, puntuacion_parker_texto from public."Vinos" where id = $1`, [id])).rows[0];
  igual(await v("ps"), { nombre: "Aalto PS 2022", nombre_en: "Aalto PS 2022", nombre_fr: "Aalto PS 2022", anada: 2022, sin_anada: false, puntuacion_parker: 94, puntuacion_parker_texto: "94" },
    "nombre, traducciones y añada; la verificada de esa añada pasa a la web");
  igual(await v("mag"), { nombre: "Carraovejas 2023 (Magnum)", nombre_en: "Carraovejas 2023 (Magnum)", nombre_fr: null, anada: 2023, sin_anada: false, puntuacion_parker: 92, puntuacion_parker_texto: "92" },
    "la fila en revisión corregida y verificada se publica; la traducción vacía sigue vacía");
  igual(await v("nv"), { nombre: "Piper-Heidsieck", nombre_en: null, nombre_fr: null, anada: null, sin_anada: true, puntuacion_parker: null, puntuacion_parker_texto: null },
    "NV: sin_anada, mismo nombre y sin puntuación (no hay fila NV verificada)");
  igual((await v("tocado")).nombre, "Mauro VS", "no pisa un vino cambiado después");
  ok((await q(`select 1 from public.vinos_puntuacion_parker where vino_id = 'tocado' and anada = 2023 and estado = 'revision'`)).rows.length === 1,
    "la fila Parker nueva se inserta (en revisión no se publica)");
  igual((await v("tocado")).puntuacion_parker, null, "una fila en revisión no sale en la web");
  ok(avisos.some((a) => /3 vinos cambiados, 0 ya estaban, 2 cambios en puntuaciones Parker/.test(a)), `resumen: ${avisos.join(" | ")}`);
  ok(avisos.some((a) => /saltados.*tocado \(Mauro\)/.test(a)), "lista los saltados");

  // Idempotente.
  const avisos2 = await ejecutar(db, sql["20261110_vinos_anadas_parker_demo.sql"]);
  ok(avisos2.some((a) => /0 vinos cambiados, 3 ya estaban, 0 cambios/.test(a)), `segunda pasada sin cambios: ${avisos2.join(" | ")}`);

  // Vuelta atrás.
  await ejecutar(db, sql["20261110_vinos_anadas_parker_demo_ROLLBACK.sql"]);
  igual(await v("ps"), { nombre: "Aalto PS", nombre_en: "Aalto PS", nombre_fr: "Aalto PS", anada: null, sin_anada: false, puntuacion_parker: null, puntuacion_parker_texto: null },
    "vuelta atrás: nombre, traducciones y añada anteriores; deja de publicarse");
  igual(await v("nv"), { nombre: "Piper-Heidsieck", nombre_en: null, nombre_fr: null, anada: null, sin_anada: false, puntuacion_parker: null, puntuacion_parker_texto: null }, "vuelta atrás del NV");
  igual((await q(`select estado, puntos_texto from public.vinos_puntuacion_parker where vino_id = 'mag'`)).rows, [{ estado: "revision", puntos_texto: "93" }],
    "vuelta atrás: la fila Parker vuelve a como estaba");
  igual((await q(`select count(*)::int n from public.vinos_puntuacion_parker where vino_id = 'tocado'`)).rows[0].n, 0, "vuelta atrás: la fila nueva se borra");
  igual((await v("tocado")).nombre, "Mauro VS", "la vuelta atrás tampoco pisa lo cambiado después");
}

// ─── 2. Scripts reales ─────────────────────────────────────────────────────
{
  const datos = JSON.parse(await leer("docs/anadas-parker-2026-11-10/cambios.json"));
  const generados = generar(datos);
  for (const entorno of ["demo", "produccion"]) {
    const base = `supabase/seeds/20261110_vinos_anadas_parker_${entorno}`;
    const ida = await leer(`${base}.sql`);
    const vuelta = await leer(`${base}_ROLLBACK.sql`);
    igual(ida, generados[`20261110_vinos_anadas_parker_${entorno}.sql`], `${entorno}: el .sql está al día con cambios.json (node scripts/parker/generar-sql-anadas.mjs)`);
    igual(vuelta, generados[`20261110_vinos_anadas_parker_${entorno}_ROLLBACK.sql`], `${entorno}: el ROLLBACK está al día`);

    const db = await nuevaBd();
    const q = (sql, p) => db.query(sql, p);
    for (const v of datos.vinos) {
      await q(`insert into public."Vinos" (id, nombre, nombre_en, nombre_fr, anada, sin_anada) values ($1, $2, $3, $4, $5, $6)`,
        [v.id, v.nombre_antes, v.nombre_en_antes, v.nombre_fr_antes, v.anada_antes, v.sin_anada_antes]);
    }
    for (const v of datos.vinos_contexto ?? []) {
      await q(`insert into public."Vinos" (id, nombre, anada, sin_anada) values ($1, $2, $3, $4)`, [v.id, v.nombre, v.anada, v.sin_anada]);
    }
    // Filas Parker de antes: las que el script cambia (con todos sus campos) y
    // las verificadas que ya había de esos vinos (deciden lo que sale en la web).
    const sembrar = async (vinoId, anada, sinAnada, f) => {
      await q(`insert into public.vinos_puntuacion_parker (vino_id, anada, sin_anada, estado, motivo, puntos_texto, puntos_min, puntos_max, provisional,
                 vino_evaluado, critico, fecha_valoracion, fuente_nombre, fuente_url, fuente_tipo, cita, fecha_consulta, discrepancias, notas, origen)
               values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18::jsonb, $19, coalesce($20, 'revision'))`,
        [vinoId, anada, sinAnada, f.estado, f.motivo ?? null, f.puntos_texto ?? null, f.puntos_min ?? null, f.puntos_max ?? null, f.provisional === true,
         f.vino_evaluado ?? null, f.critico ?? null, f.fecha_valoracion ?? null, f.fuente_nombre ?? null, f.fuente_url ?? null, f.fuente_tipo ?? null,
         f.cita ?? null, f.fecha_consulta ?? null, JSON.stringify(f.discrepancias ?? []), f.notas ?? null, f.origen ?? null]);
    };
    for (const p of datos.parker.filter((x) => x.antes)) await sembrar(p.vino_id, p.anada, p.sin_anada, p.antes);
    for (const f of datos.filas_verificadas_existentes) await sembrar(f.vino_id, f.anada, f.sin_anada, f);
    const foto = async () => (await q(`select id, nombre, nombre_en, nombre_fr, anada, sin_anada, puntuacion_parker, puntuacion_parker_texto from public."Vinos" order by id`)).rows;
    const fotoParker = async () => (await q(`select vino_id, clave_anada, estado, puntos_texto, provisional from public.vinos_puntuacion_parker order by 1, 2`)).rows;
    const antes = await foto();
    const antesParker = await fotoParker();

    const avisos = await ejecutar(db, ida);
    ok(avisos.some((a) => new RegExp(`${datos.vinos.length} vinos cambiados, 0 ya estaban, ${datos.parker.length} cambios`).test(a)),
      `${entorno}: aplica todos los cambios (${avisos.join(" | ")})`);
    ok(!avisos.some((a) => /saltados/.test(a)), `${entorno}: no salta ninguno`);
    const despues = await foto();
    for (const v of datos.vinos) {
      const fila = despues.find((x) => x.id === v.id);
      igual([fila.nombre, fila.anada, fila.sin_anada], [v.nombre_despues, v.anada_despues, v.sin_anada_despues], `${entorno}: ${v.nombre_despues}`);
    }
    const cambiados = new Set(datos.vinos.map((v) => v.id));
    const publicadas = despues.filter((x) => cambiados.has(x.id) && x.puntuacion_parker !== null).length;
    const contexto = despues.filter((x) => !cambiados.has(x.id) && x.puntuacion_parker !== null).length;
    igual(contexto, datos.resumen.vinos_contexto_publicados_tras_aplicar, `${entorno}: vinos que ya tenían añada y pasan a enseñar la puntuación`);
    ok(publicadas === datos.resumen.publicadas_tras_aplicar_en_cambiados, `${entorno}: ${publicadas} vinos cambiados enseñan la puntuación (esperado ${datos.resumen.publicadas_tras_aplicar_en_cambiados})`);

    const avisos2 = await ejecutar(db, ida);
    ok(avisos2.some((a) => new RegExp(`0 vinos cambiados, ${datos.vinos.length} ya estaban, 0 cambios`).test(a)), `${entorno}: idempotente`);

    await ejecutar(db, vuelta);
    igual(await foto(), antes, `${entorno}: la vuelta atrás deja "Vinos" como estaba`);
    igual(await fotoParker(), antesParker, `${entorno}: la vuelta atrás deja las puntuaciones como estaban`);
  }
}

console.log(`test-vinos-anadas-parker: ${comprobaciones} comprobaciones OK`);
