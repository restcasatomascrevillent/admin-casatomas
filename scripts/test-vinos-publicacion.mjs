// Vinos: un interruptor por carta (activado = restaurante OR touza) y sin
// publicar sin origen, contra un Postgres en memoria (PGlite). Nunca toca
// Supabase.
//
//   npm run test:vinos-publicacion:db
//
// Cubre: la migración REAL 20261104100000 aplicada dos veces (idempotente),
// que se para sin tocar nada si falta una columna, los datos que reproducen la
// demo (37 ocultos con restaurante y touza encendidos → siguen ocultos; los
// publicados no cambian; los 18 publicados de «ORIGEN PENDIENTE» se ocultan,
// decisión del dueño), que `activado` se recalcula en cualquier INSERT/UPDATE
// (y lo escrito a mano se ignora), el filtro de la web (activado AND
// restaurante) y el de Touza, que no se publica sin país, sin región o con
// categoría «ORIGEN PENDIENTE» (alta, encender una carta, cambiar el origen),
// que un vino antiguo publicado sin país no bloquea otros cambios ni que se
// apague, que un usuario del panel (authenticated) pasa por el mismo trigger,
// los avisos de la comprobación final y el rollback.
import { PGlite } from "@electric-sql/pglite";
import { readFile } from "node:fs/promises";
import assert from "node:assert/strict";

const MIGRACION = await readFile("supabase/migrations/20261104100000_vinos_publicacion_por_carta.sql", "utf8");
const ROLLBACK = await readFile("supabase/rollbacks/20261104100000_vinos_publicacion_por_carta_ROLLBACK.sql", "utf8");

let comprobaciones = 0;
const ok = (v, msg) => { assert.ok(v, msg); comprobaciones++; };
const igual = (a, b, msg) => { assert.deepEqual(a, b, msg); comprobaciones++; };
const rechaza = async (promesa, patron, msg) => { await assert.rejects(promesa, patron, msg); comprobaciones++; };

// Columnas reales de "Vinos" que importan aquí (information_schema de la demo,
// 04/11/2026): restaurante y touza con default true, activado sin default; y
// los triggers que ya tiene (sin foto no hay expandida; auditoría AFTER).
const VINOS = `create table public."Vinos" (
    id text primary key, nombre text, categoria text, precio_eur double precision,
    ubicacion_pais text, ubicacion_region text, activado boolean,
    restaurante boolean default true, touza boolean default true,
    imagen_url text, expanded boolean default false, nombre_en text);`;
const ANDAMIAJE = `
  create role anon nologin; create role authenticated nologin;
  ${VINOS}
  grant select, insert, update on public."Vinos" to authenticated;
  create function public.carta_sin_foto_no_expandida() returns trigger language plpgsql as $f$
  begin
    if coalesce(btrim(new.imagen_url), '') = '' and new.expanded is true then new.expanded := false; end if;
    return new;
  end $f$;
  create trigger trg_vinos_sin_foto_no_expandida before insert or update of imagen_url, expanded on public."Vinos"
    for each row execute function public.carta_sin_foto_no_expandida();
  create table public.audit_log (id bigserial primary key, tabla text, accion text, fila jsonb);
  grant insert on public.audit_log to authenticated; grant usage on sequence public.audit_log_id_seq to authenticated;
  create function public.fn_registrar_auditoria() returns trigger language plpgsql as $f$
  begin insert into public.audit_log (tabla, accion, fila) values (TG_TABLE_NAME, lower(TG_OP), to_jsonb(new)); return new; end $f$;
  create trigger trg_auditoria after insert or update on public."Vinos" for each row execute function public.fn_registrar_auditoria();
`;

// Lo que hay en la demo, en pequeño: ocultos con las dos cartas encendidas,
// publicados en las dos o solo en el restaurante, uno de «ORIGEN PENDIENTE»
// publicado, y casos raros que en producción podrían existir.
const DATOS = `
  insert into public."Vinos" (id, nombre, categoria, precio_eur, ubicacion_pais, ubicacion_region, activado, restaurante, touza) values
    ('oculto', 'Viña Oculta', 'VINOS TINTOS — RIOJA', 30, 'España', 'Haro, La Rioja', false, true, true),
    ('oculto-null', 'Sin estado', 'VINOS TINTOS — RIOJA', 30, 'España', 'Haro, La Rioja', null, true, null),
    ('oculto-touza', 'Solo bar oculto', 'VINOS BLANCOS — RUEDA', 20, 'España', 'Rueda, Valladolid', false, false, true),
    ('ambas', 'Pago de Carraovejas', 'VINOS TINTOS — RIBERA DEL DUERO', 60, 'España', 'Peñafiel, Valladolid', true, true, true),
    ('solo-rest', 'Albariño', 'VINOS BLANCOS — RÍAS BAIXAS', 28, 'España', 'Cambados, Pontevedra', true, true, false),
    ('ninguna', 'Activo sin carta', 'VINOS ROSADOS — NAVARRA', 22, 'España', 'Olite, Navarra', true, false, false),
    ('pendiente', 'Burbujas', 'VINOS ESPUMOSOS — ORIGEN PENDIENTE', 45, 'Francia', 'Champagne', true, true, true),
    ('pendiente-min', 'Blanco dudoso', 'Vinos blancos — origen pendiente', 25, 'España', 'Galicia', true, true, false),
    ('por-confirmar', 'Tinto dudoso', 'VINOS TINTOS — POR CONFIRMAR', 25, 'España', 'Castilla y León', true, false, true),
    ('pendiente-oculto', 'Oculto dudoso', 'VINOS TINTOS — ORIGEN PENDIENTE', 25, 'España', 'Rioja', false, true, true),
    ('sin-origen', 'Antiguo sin país', 'VINOS TINTOS — RIOJA', 35, null, 'Rioja Alta', true, true, true);
`;

const filas = async (db, sql, params) => (await db.query(sql, params)).rows;
const estado = async (db, id) =>
  (await filas(db, `select activado, restaurante, touza from public."Vinos" where id = $1`, [id]))[0];

// ─── 0. Si falta una columna, se para sin tocar nada ────────────────────────
{
  const otra = new PGlite();
  await otra.exec(ANDAMIAJE.replace("restaurante boolean default true, touza boolean default true,", "restaurante boolean default true,"));
  await otra.exec(`insert into public."Vinos" (id, activado, restaurante) values ('x', false, true)`);
  await rechaza(otra.exec(MIGRACION), /falta public\."Vinos"\.touza/, "no se paró sin Vinos.touza");
  await otra.exec("rollback");
  igual((await filas(otra, `select activado, restaurante from public."Vinos" where id = 'x'`))[0], { activado: false, restaurante: true }, "la migración abortada cambió datos");
  igual((await filas(otra, `select count(*)::int n from pg_proc where proname = 'vinos_publicacion_por_carta'`))[0].n, 0, "la migración abortada dejó la función");
  await otra.close();
}

// ─── 1. Aplicar dos veces ───────────────────────────────────────────────────
const db = new PGlite();
await db.exec(ANDAMIAJE);
await db.exec(DATOS);
const avisos = [];
await db.exec(MIGRACION, { onNotice: (n) => avisos.push(n.message) });
ok(avisos.includes("vinos_publicacion_por_carta: aplicada"), "no terminó en «vinos_publicacion_por_carta: aplicada»");
ok(avisos.some((a) => /AVISO, 1 vinos publicados sin país o región/.test(a)), "no avisó del vino publicado sin país");
const auditoriaAntes = (await filas(db, "select count(*)::int n from public.audit_log"))[0].n;
await db.exec(MIGRACION); // idempotente
igual((await filas(db, "select count(*)::int n from public.audit_log"))[0].n, auditoriaAntes, "reaplicar volvió a tocar filas");
igual((await filas(db, `select count(*)::int n from pg_trigger where tgname = 'trg_vinos_publicacion_por_carta'`))[0].n, 1, "un único trigger");

// ─── 2. Datos tras la migración ─────────────────────────────────────────────
igual(await estado(db, "oculto"), { activado: false, restaurante: false, touza: false }, "un oculto con las dos cartas encendidas tiene que quedar oculto y sin cartas");
igual(await estado(db, "oculto-null"), { activado: false, restaurante: false, touza: false }, "activado null = oculto");
igual(await estado(db, "oculto-touza"), { activado: false, restaurante: false, touza: false }, "oculto con solo Touza encendido");
igual(await estado(db, "ambas"), { activado: true, restaurante: true, touza: true }, "publicado en las dos no cambia");
igual(await estado(db, "solo-rest"), { activado: true, restaurante: true, touza: false }, "publicado solo en el restaurante no cambia");
igual(await estado(db, "ninguna"), { activado: false, restaurante: false, touza: false }, "activo sin ninguna carta: activado = false");
igual(await estado(db, "pendiente"), { activado: false, restaurante: false, touza: false }, "los de ORIGEN PENDIENTE se ocultan en las dos cartas");
igual(await estado(db, "pendiente-min"), { activado: false, restaurante: false, touza: false }, "también con «origen pendiente» en minúsculas");
igual(await estado(db, "por-confirmar"), { activado: false, restaurante: false, touza: false }, "y con «por confirmar»");
igual(await estado(db, "pendiente-oculto"), { activado: false, restaurante: false, touza: false }, "un pendiente que ya estaba oculto");
igual(await estado(db, "sin-origen"), { activado: true, restaurante: true, touza: true }, "un publicado sin país no se despublica");
const web = async () =>
  (await filas(db, `select id from public."Vinos" where activado = true and restaurante is true order by id`)).map((r) => r.id);
const bar = async () =>
  (await filas(db, `select id from public."Vinos" where activado = true and touza is true order by id`)).map((r) => r.id);
igual(await web(), ["ambas", "sin-origen", "solo-rest"], "carta de la web de Casa Tomás");
igual(await bar(), ["ambas", "sin-origen"], "carta de Touza");

// ─── 3. activado calculado ──────────────────────────────────────────────────
await db.exec(`update public."Vinos" set restaurante = true where id = 'oculto'`);
igual(await estado(db, "oculto"), { activado: true, restaurante: true, touza: false }, "encender Restaurante lo publica");
ok((await web()).includes("oculto") && !(await bar()).includes("oculto"), "Restaurante: sale en la web de Casa Tomás y no en Touza");
await db.exec(`update public."Vinos" set restaurante = false, touza = true where id = 'oculto'`);
ok(!(await web()).includes("oculto") && (await bar()).includes("oculto"), "Touza: sale en Touza y no en la web de Casa Tomás");
await db.exec(`update public."Vinos" set touza = false where id = 'oculto'`);
igual((await estado(db, "oculto")).activado, false, "las dos apagadas: no se publica");
await db.exec(`update public."Vinos" set activado = true where id = 'oculto'`);
igual((await estado(db, "oculto")).activado, false, "activado a mano se ignora (sigue sin carta)");
await db.exec(`update public."Vinos" set activado = false where id = 'ambas'`);
igual((await estado(db, "ambas")).activado, true, "apagar activado a mano no despublica: mandan las cartas");
await db.exec(`update public."Vinos" set restaurante = null, touza = null where id = 'ninguna'`);
igual((await estado(db, "ninguna")).activado, false, "null en las dos = no publicado");

// Alta: con los defaults (las dos cartas encendidas) queda publicado.
await db.exec(`insert into public."Vinos" (id, nombre, categoria, ubicacion_pais, ubicacion_region, activado)
  values ('nuevo', 'Nuevo', 'VINOS TINTOS — TORO', 'España', 'Toro, Zamora', false)`);
igual(await estado(db, "nuevo"), { activado: true, restaurante: true, touza: true }, "alta con defaults: publicado en las dos");
await db.exec(`insert into public."Vinos" (id, nombre, activado, restaurante, touza) values ('borrador', 'Borrador', true, false, false)`);
igual(await estado(db, "borrador"), { activado: false, restaurante: false, touza: false }, "alta sin cartas y sin origen: se guarda, sin publicar");

// ─── 4. Sin origen no se publica ────────────────────────────────────────────
const SIN_ORIGEN = /El vino «.+» no se puede publicar sin origen: indica el país y la región/;
await rechaza(
  db.exec(`insert into public."Vinos" (id, nombre, ubicacion_pais) values ('x1', 'Sin región', 'España')`),
  SIN_ORIGEN, "alta publicada sin región");
await rechaza(
  db.exec(`insert into public."Vinos" (id, nombre, ubicacion_pais, ubicacion_region, touza, restaurante) values ('x2', 'Bar', '  ', 'Toro', true, false)`),
  SIN_ORIGEN, "alta solo en Touza con país en blanco");
await rechaza(db.exec(`update public."Vinos" set restaurante = true where id = 'borrador'`), SIN_ORIGEN, "encender Restaurante sin origen");
await rechaza(db.exec(`update public."Vinos" set touza = true where id = 'borrador'`), SIN_ORIGEN, "encender Touza sin origen");
await rechaza(db.exec(`update public."Vinos" set ubicacion_region = '' where id = 'ambas'`), SIN_ORIGEN, "borrar la región de un publicado");
await rechaza(db.exec(`update public."Vinos" set ubicacion_pais = null where id = 'solo-rest'`), SIN_ORIGEN, "borrar el país de un publicado");
const error = await db.exec(`update public."Vinos" set restaurante = true where id = 'borrador'`).catch((e) => e);
igual(error.code, "23514", "el error es check_violation (la API lo devuelve como 400 con el mensaje)");
ok(/«Borrador»/.test(error.message), "el mensaje nombra el vino");
igual(await estado(db, "borrador"), { activado: false, restaurante: false, touza: false }, "el rechazo no cambió nada");
await db.exec(`update public."Vinos" set ubicacion_pais = 'España', ubicacion_region = 'Toro, Zamora', restaurante = true where id = 'borrador'`);
igual((await estado(db, "borrador")).activado, true, "con país y región ya se publica");
await db.exec(`update public."Vinos" set ubicacion_pais = null, ubicacion_region = null where id = 'oculto'`);
igual((await estado(db, "oculto")).activado, false, "sin publicar se puede dejar sin origen");

// Un vino antiguo publicado sin origen no bloquea otros cambios ni apagarlo.
await db.exec(`update public."Vinos" set precio_eur = 36, nombre_en = 'Old one' where id = 'sin-origen'`);
igual((await filas(db, `select precio_eur from public."Vinos" where id = 'sin-origen'`))[0].precio_eur, 36, "cambiar el precio de un antiguo sin país");
await db.exec(`update public."Vinos" set restaurante = false where id = 'sin-origen'`);
igual(await estado(db, "sin-origen"), { activado: true, restaurante: false, touza: true }, "apagar una carta de un antiguo sin país");
await rechaza(db.exec(`update public."Vinos" set restaurante = true where id = 'sin-origen'`), SIN_ORIGEN, "volver a encenderla sin país");
await db.exec(`update public."Vinos" set touza = false where id = 'sin-origen'`);
igual((await estado(db, "sin-origen")).activado, false, "apagar las dos de un antiguo sin país");

// Categoría «ORIGEN PENDIENTE»: no se publica hasta tener su denominación.
const PENDIENTE = /El vino «.+» no tiene la denominación de origen confirmada: cámbiale la categoría antes de publicarlo/;
await rechaza(db.exec(`update public."Vinos" set restaurante = true where id = 'pendiente'`), PENDIENTE, "encender Restaurante de un ORIGEN PENDIENTE");
await rechaza(db.exec(`update public."Vinos" set touza = true where id = 'pendiente-min'`), PENDIENTE, "encender Touza de un origen pendiente (minúsculas)");
await rechaza(
  db.exec(`insert into public."Vinos" (id, nombre, categoria, ubicacion_pais, ubicacion_region) values ('x3', 'Nuevo dudoso', 'VINOS BLANCOS — ORIGEN PENDIENTE', 'España', 'Galicia')`),
  PENDIENTE, "alta publicada con categoría ORIGEN PENDIENTE");
await rechaza(
  db.exec(`update public."Vinos" set categoria = 'VINOS TINTOS — ORIGEN PENDIENTE' where id = 'ambas'`),
  PENDIENTE, "pasar un publicado a ORIGEN PENDIENTE");
await db.exec(`update public."Vinos" set precio_eur = 50, nombre_en = 'Bubbles' where id = 'pendiente'`);
igual((await filas(db, `select precio_eur from public."Vinos" where id = 'pendiente'`))[0].precio_eur, 50, "sin publicar, un ORIGEN PENDIENTE se puede editar");
await db.exec(`insert into public."Vinos" (id, nombre, categoria, restaurante, touza) values ('x4', 'Borrador dudoso', 'VINOS TINTOS — ORIGEN PENDIENTE', false, false)`);
igual((await estado(db, "x4")).activado, false, "alta sin publicar de un ORIGEN PENDIENTE: se guarda oculta");
await db.exec(`update public."Vinos" set categoria = 'VINOS ESPUMOSOS — CHAMPAGNE', restaurante = true, touza = true where id = 'pendiente'`);
igual(await estado(db, "pendiente"), { activado: true, restaurante: true, touza: true }, "con su denominación ya se publica");

// Otros triggers de "Vinos" siguen funcionando a la vez.
await db.exec(`update public."Vinos" set expanded = true, imagen_url = null where id = 'ambas'`);
igual((await filas(db, `select expanded from public."Vinos" where id = 'ambas'`))[0].expanded, false, "sin foto no hay expandida (otro trigger)");

// ─── 5. Un usuario del panel pasa por el mismo trigger ──────────────────────
await db.exec(`set role authenticated`);
await db.exec(`update public."Vinos" set touza = true, activado = false where id = 'solo-rest'`);
await rechaza(db.exec(`update public."Vinos" set restaurante = true where id = 'oculto'`), SIN_ORIGEN, "authenticated: encender sin origen");
await db.exec(`reset role`);
igual(await estado(db, "solo-rest"), { activado: true, restaurante: true, touza: true }, "authenticated: activado recalculado");

// ─── 6. Rollback ────────────────────────────────────────────────────────────
await db.exec(ROLLBACK);
igual((await filas(db, `select count(*)::int n from pg_trigger where tgname = 'trg_vinos_publicacion_por_carta'`))[0].n, 0, "el rollback quita el trigger");
igual((await filas(db, `select count(*)::int n from pg_proc where proname = 'vinos_publicacion_por_carta'`))[0].n, 0, "el rollback quita la función");
igual((await filas(db, `select count(*)::int n from pg_proc where proname = 'vino_categoria_origen_pendiente'`))[0].n, 0, "el rollback quita la función de la categoría");
await db.exec(`update public."Vinos" set activado = false where id = 'ambas'`);
igual((await estado(db, "ambas")).activado, false, "tras el rollback activado vuelve a escribirse a mano");
igual(await estado(db, "nuevo"), { activado: true, restaurante: true, touza: true }, "el rollback no cambia datos");

await db.close();
console.log(`✔ Vinos, un interruptor por carta y sin publicar sin origen: ${comprobaciones} comprobaciones`);
