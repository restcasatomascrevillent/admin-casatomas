// Botones de acción y menú de las novedades contra un Postgres en memoria
// (PGlite), con las migraciones REALES del repo: la tabla novedades tal y como
// la dejan 20260114180149 y las que le añadieron columnas, y encima la
// migración *_novedades_botones_menu.sql sin tocar.
// Nunca toca Supabase: ni la demo ni producción.
//
//   npm run test:novedades:db
//
// Cubre: valor por defecto en filas previas y nuevas, compatibilidad con el
// panel de hoy, combinaciones válidas e inválidas de botones, forma del menú,
// «Ver menú» sin menú, el menú versión 2 (maridaje y cata) con la misma
// migración, borrado del plato enlazado (ON DELETE SET NULL), reparación de la
// FK si no fuera SET NULL, reejecución, RLS sin cambios y el bloque REVERSIÓN
// comentado de la propia migración.
import { PGlite } from "@electric-sql/pglite";
import { readdir, readFile } from "node:fs/promises";
import assert from "node:assert/strict";

const MIGRACIONES = "supabase/migrations";
// La tabla novedades de antes de esta historia (todas las migraciones que la crean o le añaden columnas).
const BASE = [
  "20260114180149_edbc789b-28c8-4a3d-b36d-3ada5a506b76.sql",
  "20260114192246_4d649eaf-4f7c-4cd4-99ea-934470f10fa8.sql",
  "20260118093327_b5212832-7266-4938-81f1-7f2524881b8c.sql",
  "20260118123537_migracion_remota_sin_nombre.sql",
  "20260118124836_migracion_remota_sin_nombre.sql",
  "20260118171940_fdd2720b-db0f-47ef-a0c0-331d21f0904a.sql",
];
// Por sufijo: su versión se alinea con Supabase al publicarla.
const fichero = (await readdir(MIGRACIONES)).find((f) => f.endsWith("_novedades_botones_menu.sql"));
assert.ok(fichero, "No se encontró supabase/migrations/*_novedades_botones_menu.sql");
const MIGRACION = await readFile(`${MIGRACIONES}/${fichero}`, "utf8");

/** El SQL entre «-- >>> REVERSIÓN» y «-- <<< FIN REVERSIÓN», quitando el «-- » de cada línea. */
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

let comprobaciones = 0;
const igual = (valor, esperado, nombre) => { assert.deepEqual(valor, esperado, nombre); comprobaciones++; };
const falla = async (promesa, patron, nombre) => { await assert.rejects(promesa, patron, nombre); comprobaciones++; };

const EDITOR = "10000000-0000-0000-0000-000000000001";
const SQL_NULL = Symbol("NULL de SQL");
const json = (v) => (v === SQL_NULL ? null : JSON.stringify(v));
const MENU = {
  version: 1,
  incluye_bebidas: true,
  secciones: {
    primero: [{ id: "m1", origen: "carta", platoId: "p2", nombre: "Gazpacho", descripcion: null,
      traducciones: { en: { nombre: "Gazpacho", descripcion: null }, fr: null } }],
    segundo: [{ id: "m2", origen: "libre", platoId: null, nombre: "Cordero asado" }],
    postre: [],
    bebidas: [{ id: "m3", origen: "libre", platoId: null, nombre: "Vino de la casa" }],
  },
};

// Menú versión 2 (historia «Maridajes y catas»): copia literal de los fixtures
// canónicos del plan del CTO, sección 2. Las copias del panel viven en
// FIXTURES_V2 y, cuando existen, tienen que ser idénticas (se comprueba en 4b).
const FIXTURES_V2 = "src/lib/__tests__/fixtures";
const MENU_V2_MARIDAJE = JSON.parse(`{"version":2,"tipo":"menu","incluye_bebidas":false,"maridaje":true,"secciones":{
 "primero":[{"id":"p1","origen":"libre","platoId":null,"nombre":"Gamba roja de Santa Pola","descripcion":"A la plancha","imagenUrl":null,"imagenPosicionY":null,"alergenos":[],"alergenosInferidos":[],"alergenosNotas":null,
   "traducciones":{"en":{"nombre":"Santa Pola red prawn","descripcion":"Grilled"},"fr":{"nombre":"Crevette rouge de Santa Pola","descripcion":"À la plancha"}},
   "maridaje":{"id":"m1","origen":"libre","refId":null,"nombre":"Cava brut nature","descripcion":"Bien frío","sulfitos":true,
     "traducciones":{"en":{"nombre":"Brut nature cava","descripcion":"Well chilled"},"fr":{"nombre":"Cava brut nature","descripcion":"Bien frais"}}}}],
 "segundo":[{"id":"s1","origen":"libre","platoId":null,"nombre":"Arroz a banda","descripcion":null,"imagenUrl":null,"imagenPosicionY":null,"alergenos":[],"alergenosInferidos":[],"alergenosNotas":null}],
 "postre":[{"id":"d1","origen":"libre","platoId":null,"nombre":"Turrón de Jijona","descripcion":null,"imagenUrl":null,"imagenPosicionY":null,"alergenos":[],"alergenosInferidos":[],"alergenosNotas":null,
   "maridaje":{"id":"m2","origen":"vino","refId":"vino-fondillon","nombre":"Fondillón","descripcion":null,"sulfitos":true}}],
 "bebidas":[]}}`);
const MENU_V2_CATA = JSON.parse(`{"version":2,"tipo":"cata","incluye_bebidas":false,"maridaje":false,"secciones":{"primero":[],"segundo":[],"postre":[],"bebidas":[],
 "cata":[
  {"id":"c1","origen":"bebida","refId":"bebida-whisky-12","nombre":"Whisky de malta 12 años","descripcion":null,"sulfitos":false,
   "traducciones":{"en":{"nombre":"12-year-old malt whisky","descripcion":null}}},
  {"id":"c2","origen":"vino","refId":"vino-fondillon","nombre":"Fondillón","descripcion":"Alicante, dulce","sulfitos":true},
  {"id":"c3","origen":"libre","refId":null,"nombre":"Ginebra de Mahón","descripcion":null,"sulfitos":false}]}}`);
/** El fixture del panel si ya existe (null si aún no), para compararlo con la copia literal. */
async function fixturePanel(nombre) {
  try {
    return JSON.parse(await readFile(`${FIXTURES_V2}/${nombre}`, "utf8"));
  } catch (e) {
    if (e.code === "ENOENT") return null;
    throw e;
  }
}
/** Copia profunda del menú con incluye_bebidas quitado (SIN_CLAVE) o cambiado por otro valor. */
const SIN_CLAVE = Symbol("sin la clave");
function conIncluyeBebidas(menu, valor) {
  const copia = structuredClone(menu);
  if (valor === SIN_CLAVE) delete copia.incluye_bebidas;
  else copia.incluye_bebidas = valor;
  return copia;
}

/** Postgres nuevo con Platos, Vinos, Bebidas y la tabla novedades de antes de esta migración. */
async function montar() {
  const db = new PGlite();
  await db.exec(`
    create role anon; create role authenticated; create role service_role bypassrls;
    create schema auth;
    create table auth.users (id uuid primary key, email text);
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('test.actor', true), '')::uuid $$;
    create function public.update_updated_at_column() returns trigger language plpgsql as $$
      begin new.updated_at = now(); return new; end $$;
    create table public."Platos" (id text primary key, nombre text not null,
      activado boolean not null default true, restaurante boolean default true);
    create table public."Vinos" (id text primary key);
    create table public."Bebidas" (id text primary key);
    insert into auth.users values ('${EDITOR}', 'editor@test.local');
  `);
  for (const f of BASE) await db.exec(await readFile(`${MIGRACIONES}/${f}`, "utf8"));
  // Privilegios de tabla como los de Supabase: la RLS es la única barrera.
  await db.exec(`
    grant usage on schema public, auth to anon, authenticated;
    grant select, insert, update, delete on public.novedades to anon, authenticated;
  `);
  return db;
}
const aplicar = (db) => db.exec(MIGRACION);
const filas = async (db, texto, params) => (await db.query(texto, params)).rows;
const una = async (db, texto, params) => (await filas(db, texto, params))[0];

/** Esquema de novedades que no debe cambiar al revertir: columnas, restricciones, índices y políticas. */
async function esquema(db) {
  return {
    columnas: await filas(db, `select column_name, data_type, is_nullable, column_default
      from information_schema.columns where table_schema = 'public' and table_name = 'novedades'
      order by ordinal_position`),
    restricciones: await filas(db, `select conname, pg_get_constraintdef(oid) as def from pg_constraint
      where conrelid = 'public.novedades'::regclass order by conname`),
    indices: await filas(db, `select indexname, indexdef from pg_indexes
      where schemaname = 'public' and tablename = 'novedades' order by indexname`),
    politicas: await filas(db, `select policyname, roles::text as roles, cmd, qual, with_check from pg_policies
      where schemaname = 'public' and tablename = 'novedades' order by policyname`),
  };
}
const fksPlato = (db) => filas(db, `select c.conname, c.confdeltype from pg_constraint c
  join pg_attribute a on a.attrelid = c.conrelid and a.attnum = c.conkey[1]
  where c.contype = 'f' and c.conrelid = 'public.novedades'::regclass and a.attname = 'plato_id'
  order by c.conname`);
const insertar = (db, botones, { menu = SQL_NULL, plato = null, titulo = "Prueba" } = {}) =>
  db.query(`insert into public.novedades (titulo, botones, menu, plato_id)
    values ($1, $2::jsonb, $3::jsonb, $4) returning id, botones, menu, plato_id`, [titulo, json(botones), json(menu), plato]);

// =============================================================================
// 1. Valor por defecto y compatibilidad con el panel y la web de PROD
// =============================================================================
const db = await montar();
await db.exec(`
  insert into public."Platos" (id, nombre) values ('p1', 'Arroz con costra'), ('p2', 'Gazpacho');
  insert into public.novedades (titulo, tipo, tipo_asociacion, seccion, activo)
  values ('Antigua activa', 'anuncio', 'seccion', 'carta', true),
         ('Antigua inactiva', 'anuncio', 'seccion', 'carta', false);
`);
const esquemaAntes = await esquema(db);
const antiguasAntes = await filas(db, `select to_jsonb(n) as fila from public.novedades n order by titulo`);
igual(await fksPlato(db), [{ conname: "novedades_plato_id_fkey", confdeltype: "n" }], "partimos de la FK original ON DELETE SET NULL");

await aplicar(db);
igual(await filas(db, `select titulo, botones, menu from public.novedades order by titulo`), [
  { titulo: "Antigua activa", botones: [], menu: null },
  { titulo: "Antigua inactiva", botones: [], menu: null },
], "las novedades existentes quedan sin botones y sin menú");
igual(await fksPlato(db), [{ conname: "novedades_plato_id_fkey", confdeltype: "n" }], "con la FK ya en SET NULL no la toca");
igual(await filas(db, `select policyname, roles::text as roles, cmd, qual, with_check from pg_policies
  where schemaname = 'public' and tablename = 'novedades' order by policyname`), esquemaAntes.politicas,
  "no crea, borra ni cambia ninguna política RLS");
igual((await esquema(db)).indices, esquemaAntes.indices, "no añade índices");

// El panel de PROD inserta y actualiza sin enviar botones ni menu (useNovedades.ts).
const delPanelViejo = await una(db, `insert into public.novedades (titulo, descripcion, tipo, tipo_asociacion, seccion, activo, orden)
  values ('Del panel de hoy', 'Texto', 'anuncio', 'seccion', 'carta', true, 3) returning id, botones, menu`);
igual([delPanelViejo.botones, delPanelViejo.menu], [[], null], "un alta sin las claves nuevas toma [] y NULL");
const conBotones = (await insertar(db, ["ver_menu", "llamar"], { menu: MENU, titulo: "Con botones" })).rows[0];
await db.query(`update public.novedades set titulo = 'Con botones (editada)', descripcion = 'Otra' where id = $1`, [conBotones.id]);
igual(await una(db, `select botones, menu from public.novedades where id = $1`, [conBotones.id]),
  { botones: ["ver_menu", "llamar"], menu: MENU }, "una edición que no envía botones ni menu los conserva");

// =============================================================================
// 2. Combinaciones válidas: el orden del array es el de la pantalla
// =============================================================================
const VALIDOS = [
  [], ["llamar"], ["ver_menu"], ["ver_plato"],
  ["llamar", "ver_menu"], ["ver_menu", "llamar"],
  ["llamar", "ver_plato"], ["ver_plato", "llamar"],
  ["ver_menu", "ver_plato"], ["ver_plato", "ver_menu"],
];
for (const botones of VALIDOS) {
  const fila = (await insertar(db, botones, {
    menu: botones.includes("ver_menu") ? MENU : SQL_NULL,
    plato: botones.includes("ver_plato") ? "p2" : null,
  })).rows[0];
  igual(fila.botones, botones, `acepta ${JSON.stringify(botones)} y conserva el orden`);
}
igual((await insertar(db, ["ver_menu"], { menu: { secciones: {}, incluye_bebidas: false } })).rows[0].menu,
  { secciones: {}, incluye_bebidas: false }, "la BBDD solo exige la forma exterior del menú (el contenido lo valida el panel)");
igual((await insertar(db, [], { menu: MENU })).rows[0].botones, [],
  "un menú sin «Ver menú» no lo rechaza la BBDD (el panel guarda menu = NULL al quitar el botón)");
// «Échale un vistazo» sin plato: lo valida el panel, no la BBDD (ADR-4).
igual((await insertar(db, ["ver_plato"])).rows[0].plato_id, null, "ver_plato sin plato_id no lo bloquea la BBDD");

// =============================================================================
// 3. Combinaciones inválidas de botones
// =============================================================================
const INVALIDOS = [
  [["llamar", "ver_menu", "ver_plato"], "3 botones"],
  [["llamar", "ver_menu", "llamar"], "3 botones con uno repetido"],
  [["llamar", "llamar"], "un tipo repetido"],
  [["ver_menu", "ver_menu"], "ver_menu repetido"],
  [["reservar"], "un tipo desconocido"],
  [["llamar", "whatsapp"], "uno válido y otro desconocido"],
  [["Llamar"], "mayúsculas"],
  [[""], "cadena vacía"],
  [[1], "número dentro del array"],
  [[true], "booleano dentro del array"],
  [[null], "null dentro del array"],
  [[["llamar"]], "array anidado"],
  [[{ tipo: "llamar" }], "objeto dentro del array"],
  [1, "un número en vez de un array"],
  ["llamar", "una cadena suelta (con <@ solo, un escalar pasaría)"],
  [{ llamar: true }, "un objeto en vez de un array"],
  [null, "null de JSON"],
];
for (const [botones, caso] of INVALIDOS) {
  // Con menú válido, para que el único motivo de rechazo sea el de botones.
  await falla(insertar(db, botones, { menu: MENU }), /novedades_botones_validos/, `rechaza ${caso}: ${JSON.stringify(botones)}`);
}
await falla(insertar(db, SQL_NULL, { menu: MENU }), /null value in column "botones"/, "rechaza botones NULL de SQL");
await falla(db.query(`update public.novedades set botones = '["llamar","llamar","ver_menu"]' where id = $1`, [conBotones.id]),
  /novedades_botones_validos/, "también al actualizar");

// =============================================================================
// 4. «Ver menú» y forma del menú
// =============================================================================
await falla(insertar(db, ["ver_menu"]), /novedades_ver_menu_con_menu/, "rechaza ver_menu sin menú");
await falla(insertar(db, ["llamar", "ver_menu"]), /novedades_ver_menu_con_menu/, "rechaza ver_menu sin menú aunque haya otro botón");
await falla(db.query(`update public.novedades set menu = null where id = $1`, [conBotones.id]),
  /novedades_ver_menu_con_menu/, "no deja quitar el menú y dejar el botón");
await falla(db.query(`update public.novedades set botones = '["ver_menu"]' where id = $1`, [delPanelViejo.id]),
  /novedades_ver_menu_con_menu/, "no deja añadir ver_menu a una novedad sin menú");
await db.query(`update public.novedades set botones = '["llamar"]', menu = null where id = $1`, [conBotones.id]);
igual(await una(db, `select botones, menu from public.novedades where id = $1`, [conBotones.id]),
  { botones: ["llamar"], menu: null }, "quitar «Ver menú» y su menú a la vez está permitido");

const MENUS_INVALIDOS = [
  [[], "un array"],
  ["menú", "una cadena"],
  [null, "null de JSON"],
  [{}, "un objeto vacío"],
  [{ secciones: {} }, "sin incluye_bebidas (daría NULL y el CHECK lo daría por bueno sin coalesce)"],
  [{ incluye_bebidas: true }, "sin secciones"],
  [{ secciones: [], incluye_bebidas: true }, "secciones como array"],
  [{ secciones: null, incluye_bebidas: false }, "secciones null"],
  [{ secciones: "primero", incluye_bebidas: false }, "secciones como cadena"],
  [{ secciones: {}, incluye_bebidas: "true" }, "incluye_bebidas como cadena"],
  [{ secciones: {}, incluye_bebidas: 1 }, "incluye_bebidas como número"],
  [{ secciones: {}, incluye_bebidas: null }, "incluye_bebidas null"],
];
for (const [menu, caso] of MENUS_INVALIDOS) {
  await falla(insertar(db, ["ver_menu"], { menu }), /novedades_menu_forma/, `rechaza un menú que es ${caso}`);
}

// =============================================================================
// 4b. Menú versión 2 (maridaje y cata) con la misma migración, sin otra nueva
// =============================================================================
for (const [nombre, literal] of [
  ["menu-novedad-v2-maridaje.json", MENU_V2_MARIDAJE],
  ["menu-novedad-v2-cata.json", MENU_V2_CATA],
]) {
  const delPanel = await fixturePanel(nombre);
  if (delPanel !== null) igual(delPanel, literal, `${FIXTURES_V2}/${nombre} coincide con el fixture canónico del plan`);
}
igual(["primero", "segundo", "postre", "bebidas"].map((s) => MENU_V2_CATA.secciones[s].length), [0, 0, 0, 0],
  "(control) la cata canónica no lleva comida ni bebidas sueltas");

// Una novedad con menú v1 guardada antes de los casos v2.
const v1Previa = (await insertar(db, ["ver_menu"], { menu: MENU, titulo: "Menú v1 previo" })).rows[0];

// Caso 1: v2 de tipo Menú con maridaje.
const maridada = (await insertar(db, ["ver_menu"], { menu: MENU_V2_MARIDAJE, titulo: "Menú maridado" })).rows[0];
igual([maridada.botones, maridada.menu], [["ver_menu"], MENU_V2_MARIDAJE],
  "acepta una v2 con maridaje y [\"ver_menu\"], y la devuelve igual (maridajes dentro de los platos incluidos)");

// Caso 2: cata sin comida.
const cata = (await insertar(db, ["ver_menu"], { menu: MENU_V2_CATA, titulo: "Cata de destilados" })).rows[0];
igual([cata.botones, cata.menu], [["ver_menu"], MENU_V2_CATA],
  "acepta una cata sin comida con [\"ver_menu\"], con las bebidas en el mismo orden");

// La web lee las v2 como anon, igual que la v1.
await db.exec(`set test.actor = ''; set role anon;`);
igual(await filas(db, `select menu from public.novedades where id in ($1, $2) order by titulo`, [cata.id, maridada.id]),
  [{ menu: MENU_V2_CATA }, { menu: MENU_V2_MARIDAJE }], "la web (anon) lee la cata y el menú maridado completos");
await db.exec(`reset role;`);

// Casos 3 y 4: incluye_bebidas ausente o no booleano, en las dos formas de la v2.
for (const [menu, tipo] of [[MENU_V2_MARIDAJE, "con maridaje"], [MENU_V2_CATA, "de cata"]]) {
  await falla(insertar(db, ["ver_menu"], { menu: conIncluyeBebidas(menu, SIN_CLAVE) }), /novedades_menu_forma/,
    `rechaza una v2 ${tipo} sin incluye_bebidas`);
  for (const valor of ["no", "false", 0, null]) {
    await falla(insertar(db, ["ver_menu"], { menu: conIncluyeBebidas(menu, valor) }), /novedades_menu_forma/,
      `rechaza una v2 ${tipo} con incluye_bebidas = ${JSON.stringify(valor)}`);
  }
}
await falla(db.query(`update public.novedades set menu = $1::jsonb where id = $2`,
  [json(conIncluyeBebidas(MENU_V2_MARIDAJE, SIN_CLAVE)), maridada.id]), /novedades_menu_forma/,
  "también al actualizar: el panel no puede dejar una v2 sin incluye_bebidas");
igual((await una(db, `select menu from public.novedades where id = $1`, [maridada.id])).menu, MENU_V2_MARIDAJE,
  "la actualización rechazada no toca el menú guardado");

// Caso 5: la v1 sigue aceptándose después de las v2, nueva y editada.
igual((await una(db, `select menu from public.novedades where id = $1`, [v1Previa.id])).menu, MENU,
  "la v1 guardada antes sigue intacta");
const v1Nueva = (await insertar(db, ["ver_menu"], { menu: MENU, titulo: "Menú v1 posterior" })).rows[0];
igual([v1Nueva.botones, v1Nueva.menu], [["ver_menu"], MENU], "una v1 de antes se sigue aceptando después de las v2");
// Encender el maridaje, pasar a cata y volver a la v1 (lo que hace el panel al editar la misma novedad).
for (const [menu, paso] of [[MENU_V2_MARIDAJE, "v1 → v2 con maridaje"], [MENU_V2_CATA, "maridaje → cata"], [MENU, "cata → v1"]]) {
  igual((await db.query(`update public.novedades set menu = $1::jsonb where id = $2`, [json(menu), v1Previa.id])).affectedRows, 1,
    `acepta la edición ${paso}`);
  igual((await una(db, `select menu from public.novedades where id = $1`, [v1Previa.id])).menu, menu, `tras ${paso} el menú guardado es el nuevo`);
}

// =============================================================================
// 5. Borrar el plato enlazado: la FK pone plato_id a NULL y la novedad sigue
// =============================================================================
const vistazo = (await insertar(db, ["ver_plato"], { plato: "p1", titulo: "Plato nuevo" })).rows[0];
const vistazoYLlamar = (await insertar(db, ["llamar", "ver_plato"], { plato: "p1", titulo: "Plato nuevo 2" })).rows[0];
const borrado = await db.query(`delete from public."Platos" where id = 'p1'`);
igual(borrado.affectedRows, 1, "se puede borrar de la carta un plato enlazado a novedades");
igual(await filas(db, `select titulo, botones, plato_id from public.novedades where id in ($1, $2) order by titulo`,
  [vistazo.id, vistazoYLlamar.id]), [
  { titulo: "Plato nuevo", botones: ["ver_plato"], plato_id: null },
  { titulo: "Plato nuevo 2", botones: ["llamar", "ver_plato"], plato_id: null },
], "las novedades siguen, con sus botones y plato_id a NULL (la web oculta el botón y el panel avisa)");
await falla(insertar(db, ["ver_plato"], { plato: "no-existe" }), /novedades_plato_id_fkey/, "la FK sigue impidiendo enlazar un plato inexistente");

// =============================================================================
// 6. RLS: las políticas de siempre cubren las columnas nuevas
// =============================================================================
const conMenu = (await insertar(db, ["ver_menu", "llamar"], { menu: MENU, titulo: "Menú de Navidad" })).rows[0];
await db.exec(`set test.actor = ''; set role anon;`);
igual(await filas(db, `select botones, menu from public.novedades where id = $1`, [conMenu.id]),
  [{ botones: ["ver_menu", "llamar"], menu: MENU }], "la web (anon) lee botones y menú de una novedad activa vigente");
igual(await filas(db, `select titulo from public.novedades where titulo = 'Antigua inactiva'`), [],
  "anon sigue sin ver las novedades inactivas");
igual((await db.query(`update public.novedades set botones = '[]' where id = $1`, [conMenu.id])).affectedRows, 0,
  "anon no puede cambiar los botones");
await falla(db.query(`insert into public.novedades (titulo, botones) values ('Intrusa', '["llamar"]')`),
  /row-level security/, "anon no puede crear novedades con botones");
await db.exec(`reset role; set test.actor = '${EDITOR}'; set role authenticated;`);
igual((await db.query(`update public.novedades set botones = '["llamar"]', menu = null where id = $1`, [conMenu.id])).affectedRows, 1,
  "un usuario del panel sí puede cambiar los botones");
await db.exec(`reset role; set test.actor = '';`);
igual((await una(db, `select botones from public.novedades where id = $1`, [conMenu.id])).botones, ["llamar"],
  "el cambio del panel queda guardado y el de anon no");

// =============================================================================
// 7. Reejecución: la migración se puede aplicar dos veces
// =============================================================================
const esquemaDespues = await esquema(db);
const datosDespues = await filas(db, `select id, botones, menu, plato_id from public.novedades order by id`);
await aplicar(db);
igual(await esquema(db), esquemaDespues, "aplicarla otra vez deja el mismo esquema");
igual(await filas(db, `select id, botones, menu, plato_id from public.novedades order by id`), datosDespues,
  "aplicarla otra vez no cambia ningún dato");

// =============================================================================
// 8. REVERSIÓN: el bloque comentado deja la tabla como antes
// =============================================================================
await db.exec(REVERSION);
igual(await esquema(db), esquemaAntes, "la reversión deja columnas, restricciones, índices y políticas como antes");
igual(await filas(db, `select to_jsonb(n) as fila from public.novedades n where titulo like 'Antigua%' order by titulo`),
  antiguasAntes, "las novedades anteriores quedan exactamente como estaban");
await db.exec(REVERSION);
igual(await esquema(db), esquemaAntes, "la reversión también se puede ejecutar dos veces");
await aplicar(db);
igual((await esquema(db)).columnas, esquemaDespues.columnas, "y la migración se vuelve a aplicar después de revertirla");
await db.close();

// =============================================================================
// 9. Entornos donde la FK de plato_id no fuera ON DELETE SET NULL
// =============================================================================
// 9a. FK con otro nombre y NO ACTION: borrar el plato fallaría.
const otraFk = await montar();
await otraFk.exec(`
  alter table public.novedades drop constraint novedades_plato_id_fkey;
  alter table public.novedades add constraint novedades_plato_fk_vieja foreign key (plato_id) references public."Platos"(id);
  insert into public."Platos" (id, nombre) values ('p9', 'Pulpo');
  insert into public.novedades (titulo, plato_id) values ('Con plato', 'p9');
`);
await falla(otraFk.query(`delete from public."Platos" where id = 'p9'`), /novedades_plato_fk_vieja/,
  "(control) con NO ACTION el borrado del plato falla");
await aplicar(otraFk);
igual(await fksPlato(otraFk), [{ conname: "novedades_plato_id_fkey", confdeltype: "n" }],
  "quita la FK NO ACTION y crea la de SET NULL");
await otraFk.query(`delete from public."Platos" where id = 'p9'`);
igual(await filas(otraFk, `select titulo, plato_id from public.novedades`), [{ titulo: "Con plato", plato_id: null }],
  "después, borrar el plato deja la novedad con plato_id NULL");
await otraFk.close();

// 9b. Sin FK y con un plato_id huérfano: se pone a NULL antes de crearla.
const sinFk = await montar();
await sinFk.exec(`
  alter table public.novedades drop constraint novedades_plato_id_fkey;
  insert into public."Platos" (id, nombre) values ('p9', 'Pulpo');
  insert into public.novedades (titulo, plato_id) values ('Huérfana', 'fantasma'), ('Con plato', 'p9');
`);
await aplicar(sinFk);
igual(await fksPlato(sinFk), [{ conname: "novedades_plato_id_fkey", confdeltype: "n" }], "crea la FK que faltaba");
igual(await filas(sinFk, `select titulo, plato_id from public.novedades order by titulo`), [
  { titulo: "Con plato", plato_id: "p9" },
  { titulo: "Huérfana", plato_id: null },
], "solo el plato_id huérfano pasa a NULL");
await sinFk.close();

// 9c. La FK original SET NULL y otra duplicada NO ACTION (p. ej. añadida desde el dashboard).
const fkDoble = await montar();
await fkDoble.exec(`
  alter table public.novedades add constraint novedades_zz_plato_duplicada foreign key (plato_id) references public."Platos"(id);
  insert into public."Platos" (id, nombre) values ('p9', 'Pulpo');
  insert into public.novedades (titulo, plato_id) values ('Con plato', 'p9');
`);
await aplicar(fkDoble);
igual(await fksPlato(fkDoble), [{ conname: "novedades_plato_id_fkey", confdeltype: "n" }],
  "quita la FK duplicada NO ACTION y conserva la SET NULL");
await fkDoble.query(`delete from public."Platos" where id = 'p9'`);
igual(await filas(fkDoble, `select plato_id from public.novedades`), [{ plato_id: null }], "y el plato se puede borrar");
await fkDoble.close();

console.log(`test-novedades-botones: ${comprobaciones} comprobaciones superadas`);
