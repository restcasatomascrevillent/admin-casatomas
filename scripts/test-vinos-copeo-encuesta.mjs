// Vino por copas, puntuación Parker, «Vota tu vino favorito» y horario de
// «Menú del día»/«Tapas», contra un Postgres en memoria (PGlite). Nunca toca
// Supabase.
//
//   npm run test:vinos-copeo-encuesta:db
//
// Aplica las migraciones REALES 20261104140000, 20261104141000 y
// 20261104142000 dos veces (idempotentes) sobre un andamiaje con las políticas
// de la demo (04/11/2026), y cubre: los CHECK de copa y Parker; que la web
// (anon) vota solo con la votación abierta, por un vino publicado en Casa
// Tomás, con nombre, contacto válido y bases aceptadas, una vez por contacto
// (email sin distinguir mayúsculas; teléfono con o sin +34) y con tope por
// hora; que la web no puede leer ni borrar los votos y el panel solo con
// «Gestor carta»; la forma de los horarios y quién puede guardarlos; y los
// rollbacks.
import { PGlite } from "@electric-sql/pglite";
import { readFile } from "node:fs/promises";
import assert from "node:assert/strict";

const leer = (ruta) => readFile(ruta, "utf8");
const COPEO = await leer("supabase/migrations/20261104140000_vinos_copeo_y_parker.sql");
const ENCUESTA = await leer("supabase/migrations/20261104141000_encuesta_vino_favorito.sql");
const HORARIO = await leer("supabase/migrations/20261104142000_horario_menu_tapas.sql");
const PARKER_DATOS = await leer("supabase/migrations/20261104143000_vinos_puntuacion_parker_datos.sql");
const PARKER_DATOS_ROLLBACK = await leer("supabase/rollbacks/20261104143000_vinos_puntuacion_parker_datos_ROLLBACK.sql");
const ROLLBACKS = [
  await leer("supabase/rollbacks/20261104142000_horario_menu_tapas_ROLLBACK.sql"),
  await leer("supabase/rollbacks/20261104141000_encuesta_vino_favorito_ROLLBACK.sql"),
  await leer("supabase/rollbacks/20261104140000_vinos_copeo_y_parker_ROLLBACK.sql"),
];

let comprobaciones = 0;
const ok = (v, msg) => { assert.ok(v, msg); comprobaciones++; };
const igual = (a, b, msg) => { assert.deepEqual(a, b, msg); comprobaciones++; };

const U = {
  CARTA: "00000000-0000-0000-0000-00000000000a", // «Gestor carta» con editar
  WEB: "00000000-0000-0000-0000-00000000000b", // «Gestión web» con editar
  NADA: "00000000-0000-0000-0000-00000000000c", // sin permisos
};

const ANDAMIAJE = `
  create role anon nologin; create role authenticated nologin;
  create schema auth; create schema private;
  create function auth.jwt() returns jsonb language sql stable as $$ select nullif(current_setting('request.jwt.claims', true), '')::jsonb $$;
  create function auth.uid() returns uuid language sql stable as $$ select (auth.jwt() ->> 'sub')::uuid $$;
  grant usage on schema public, auth, private to anon, authenticated;
  grant execute on all functions in schema auth to anon, authenticated;

  create table public.user_permissions (user_id uuid, section_key text, can_edit boolean);
  create function public.can_write_section(_section text) returns boolean language sql stable security definer set search_path = public
    as $f$ select exists (select 1 from public.user_permissions where user_id = auth.uid() and section_key = _section and can_edit) $f$;
  grant execute on function public.can_write_section(text) to anon, authenticated;
  create function private.sesion_panel_permitida() returns boolean language sql stable security definer set search_path = ''
    as $f$ select auth.uid() is not null $f$;
  grant execute on function private.sesion_panel_permitida() to authenticated;

  create table public."Vinos" (
    id text primary key, nombre text, categoria text, precio_eur double precision,
    activado boolean, restaurante boolean default true, touza boolean default true);
  alter table public."Vinos" enable row level security;
  grant select, insert, update, delete on public."Vinos" to anon, authenticated;
  create policy vinos_publico on public."Vinos" for select using (activado = true);
  create policy vinos_update_seccion on public."Vinos" for update to authenticated
    using ((select public.can_write_section('gestor_carta'))) with check ((select public.can_write_section('gestor_carta')));

  create table public.configuracion_web (
    id boolean primary key default true, mostrar_fotos_platos_casa_tomas boolean not null default true,
    mostrar_menu_dia_casa_tomas boolean not null default true, mostrar_tapas_casa_tomas boolean not null default true);
  alter table public.configuracion_web enable row level security;
  grant select, insert, update, delete on public.configuracion_web to anon, authenticated;
  create policy configuracion_web_select_publico on public.configuracion_web for select to anon, authenticated using (true);
  create policy configuracion_web_update_seccion on public.configuracion_web for update to authenticated
    using (public.can_write_section('gestor_carta')) with check (public.can_write_section('gestor_carta'));
`;

const DATOS = `
  insert into public.user_permissions values ('${U.CARTA}', 'gestor_carta', true), ('${U.WEB}', 'gestion_web', true);
  insert into public."Vinos" (id, nombre, categoria, precio_eur, activado, restaurante, touza) values
    ('tinto', 'Pago de Carraovejas', 'VINOS TINTOS — RIBERA DEL DUERO', 50, true, true, true),
    ('solo-touza', 'Blanco del bar', 'VINOS BLANCOS — RUEDA', 20, true, false, true),
    ('oculto', 'Viña Oculta', 'VINOS TINTOS — RIOJA', 30, false, false, false);
  insert into public.configuracion_web (id) values (true);
`;

const db = new PGlite();
await db.exec(ANDAMIAJE);
await db.exec(DATOS);
const q = (sql, params) => db.query(sql, params);

async function como(u, fn) {
  await db.exec("begin");
  try {
    if (u === "anon") {
      await db.exec(`set local role anon; select set_config('request.jwt.claims', '{"role":"anon"}', true);`);
    } else {
      await db.exec(`set local role authenticated;
        select set_config('request.jwt.claims', '${JSON.stringify({ sub: u, role: "authenticated" })}', true);`);
    }
    const r = await fn();
    await db.exec("commit");
    return r;
  } catch (e) {
    await db.exec("rollback").catch(() => {});
    throw e;
  }
}
const rechaza = async (promesa, patron, msg) => { await assert.rejects(promesa, patron, msg); comprobaciones++; };

// ─── 0. Las migraciones se aplican dos veces sin error ──────────────────────
for (let i = 0; i < 2; i++) {
  await db.exec(COPEO);
  await db.exec(ENCUESTA);
  await db.exec(HORARIO);
}
ok(true, "las tres migraciones son idempotentes");

// ─── 1. Copeo y Parker ──────────────────────────────────────────────────────
igual((await q(`select copeo, precio_copa_eur, puntuacion_parker from public."Vinos" where id = 'tinto'`)).rows,
  [{ copeo: false, precio_copa_eur: null, puntuacion_parker: null }], "por defecto: sin copa ni Parker");
await q(`update public."Vinos" set copeo = true, precio_copa_eur = 6.5, puntuacion_parker = 95, puntuacion_parker_anada = 2019 where id = 'tinto'`);
ok(true, "copa con precio y Parker válidos se guardan");
await rechaza(q(`update public."Vinos" set copeo = true, precio_copa_eur = null where id = 'tinto'`), /vinos_copeo_con_precio/, "copeo sin precio de copa");
await rechaza(q(`update public."Vinos" set precio_copa_eur = 0 where id = 'tinto'`), /vinos_precio_copa_valido/, "precio de copa 0");
await rechaza(q(`update public."Vinos" set precio_copa_eur = 'Infinity' where id = 'tinto'`), /vinos_precio_copa_valido/, "precio de copa infinito");
await rechaza(q(`update public."Vinos" set puntuacion_parker = 101 where id = 'tinto'`), /vinos_parker_valido/, "Parker por encima de 100");
await rechaza(q(`update public."Vinos" set puntuacion_parker = 49 where id = 'tinto'`), /vinos_parker_valido/, "Parker por debajo de 50");
await rechaza(q(`update public."Vinos" set puntuacion_parker_anada = 1800 where id = 'tinto'`), /vinos_parker_anada_valida/, "añada imposible");
await q(`update public."Vinos" set copeo = false where id = 'tinto'`);
ok(true, "quitar el copeo deja el precio guardado (vuelve a valer al encenderlo)");

// ─── 2. Encuesta ────────────────────────────────────────────────────────────
const votar = (u, vino, nombre, contacto, bases = true, idioma = "es") =>
  como(u, () => q(`select public.votar_vino_favorito($1, $2, $3, $4, $5) as r`, [vino, nombre, contacto, bases, idioma]));

await rechaza(votar("anon", "tinto", "Ana", "ana@example.com"), /encuesta_cerrada/, "con la votación apagada no se vota");

// Encender: el panel con «Gestor carta» sí; sin permiso, la RLS no deja (0 filas).
const encender = (u, valor) => como(u, async () => (await q(`update public.configuracion_web set encuesta_vinos_activa = ${valor} where id = true returning id`)).rows.length);
igual(await encender(U.NADA, true), 0, "sin «Gestor carta» no se enciende la votación");
igual(await encender(U.CARTA, true), 1, "con «Gestor carta» se enciende");
igual((await como("anon", () => q(`select encuesta_vinos_activa from public.configuracion_web`))).rows, [{ encuesta_vinos_activa: true }],
  "la web lee el interruptor");

const r = await votar("anon", "tinto", "  Ana  ", "Ana@Example.com");
igual(r.rows[0].r, { ok: true, vino: "Pago de Carraovejas" }, "la web vota");
await rechaza(votar("anon", "tinto", "Ana bis", "ana@example.COM"), /ya_participado/, "mismo email con otras mayúsculas: no repite");
await votar("anon", "tinto", "Luis", "+34 600 11 22 33");
await rechaza(votar("anon", "tinto", "Luis bis", "600112233"), /ya_participado/, "mismo teléfono sin +34: no repite");
await votar("anon", "tinto", "Marta", "0034 611-22-33-44", true, "fr");
await rechaza(votar("anon", "solo-touza", "Pepe", "pepe@example.com"), /vino_no_disponible/, "un vino solo de Touza no se vota en Casa Tomás");
await rechaza(votar("anon", "oculto", "Pepe", "pepe@example.com"), /vino_no_disponible/, "un vino oculto no se vota");
await rechaza(votar("anon", "no-existe", "Pepe", "pepe@example.com"), /vino_no_disponible/, "un vino que no existe");
await rechaza(votar("anon", "tinto", "P", "pepe@example.com"), /datos_no_validos/, "nombre de una letra");
await rechaza(votar("anon", "tinto", "Pepe", "pepe@"), /datos_no_validos/, "email mal escrito");
await rechaza(votar("anon", "tinto", "Pepe", "123"), /datos_no_validos/, "teléfono corto");
await rechaza(votar("anon", "tinto", "Pepe", "pepe@example.com", false), /datos_no_validos/, "sin aceptar las bases");

const votos = await q(`select nombre, contacto_normalizado, idioma, vino_id, vino_nombre from public.votos_vino_favorito order by created_at, nombre`);
igual(votos.rows.map((v) => [v.nombre, v.contacto_normalizado, v.idioma]).sort(), [
  ["Ana", "email:ana@example.com", "es"],
  ["Luis", "tel:600112233", "es"],
  ["Marta", "tel:611223344", "fr"],
], "se guardan normalizados y sin espacios");

// Lectura y borrado de votos.
await rechaza(como("anon", () => q(`select * from public.votos_vino_favorito`)), /permission denied/, "la web no puede leer los votos");
await rechaza(como("anon", () => q(`insert into public.votos_vino_favorito (vino_nombre, nombre, contacto, contacto_normalizado, acepta_bases) values ('x','xx','xxxxx','x',true)`)),
  /permission denied/, "la web no puede insertar votos a mano");
igual((await como(U.NADA, () => q(`select * from public.votos_vino_favorito`))).rows.length, 0, "sin «Gestor carta» no se ven los votos");
igual((await como(U.CARTA, () => q(`select * from public.votos_vino_favorito`))).rows.length, 3, "con «Gestor carta» se ven");
igual((await como(U.NADA, () => q(`delete from public.votos_vino_favorito returning id`))).rows.length, 0, "sin permiso no se vacían");

// Tope por hora: con 300 votos en la última hora, el siguiente se rechaza.
await q(`insert into public.votos_vino_favorito (vino_id, vino_nombre, nombre, contacto, contacto_normalizado, acepta_bases)
         select 'tinto', 'Pago de Carraovejas', 'Relleno', 'relleno', 'email:r' || g || '@x.es', true from generate_series(1, 297) g`);
await rechaza(votar("anon", "tinto", "Último", "ultimo@example.com"), /demasiados_votos/, "tope de 300 votos por hora");
await q(`update public.votos_vino_favorito set created_at = now() - interval '2 hours' where nombre = 'Relleno'`);
await votar("anon", "tinto", "Último", "ultimo@example.com");
ok(true, "pasada la hora se vuelve a votar");

igual((await como(U.CARTA, () => q(`delete from public.votos_vino_favorito returning id`))).rows.length, 301, "el panel vacía la votación");
// Borrar el vino no borra los votos (se queda su nombre).
await votar("anon", "tinto", "Ana", "ana@example.com");
await q(`delete from public."Vinos" where id = 'tinto'`);
igual((await q(`select vino_id, vino_nombre from public.votos_vino_favorito`)).rows, [{ vino_id: null, vino_nombre: "Pago de Carraovejas" }],
  "borrar el vino conserva el voto con su nombre");

// ─── 3. Horario de menú y tapas ─────────────────────────────────────────────
const horario = (u, seccion, valor) => como(u, () => q(`select public.configuracion_web_horario_menu_tapas($1, $2::jsonb)`, [seccion, valor === null ? null : JSON.stringify(valor)]));
await horario(U.WEB, "menu", { dias: [2, 3, 4], desde: "13:00", hasta: "16:00" });
await horario(U.WEB, "tapas", { dias: [4, 5], desde: "20:00", hasta: "01:00" });
igual((await como("anon", () => q(`select horario_menu_dia_casa_tomas, horario_tapas_casa_tomas from public.configuracion_web`))).rows, [{
  horario_menu_dia_casa_tomas: { dias: [2, 3, 4], desde: "13:00", hasta: "16:00" },
  horario_tapas_casa_tomas: { dias: [4, 5], desde: "20:00", hasta: "01:00" },
}], "la web lee los dos horarios");
await horario(U.WEB, "menu", { dias: [1], desde: null, hasta: null });
await horario(U.WEB, "tapas", null);
ok(true, "todo el día y «lo de siempre» (NULL) se guardan");
await rechaza(horario(U.CARTA, "menu", { dias: [1], desde: null, hasta: null }), /No tienes permiso/, "«Gestor carta» no cambia el horario");
await rechaza(horario(U.NADA, "menu", { dias: [1], desde: null, hasta: null }), /No tienes permiso/, "sin permiso no se cambia");
await rechaza(como("anon", () => q(`select public.configuracion_web_horario_menu_tapas('menu', null)`)), /permission denied/, "la web no puede llamar a la RPC");
for (const [malo, motivo] of [
  [{ dias: [], desde: null, hasta: null }, "sin días"],
  [{ dias: [0], desde: null, hasta: null }, "día 0"],
  [{ dias: [8], desde: null, hasta: null }, "día 8"],
  [{ dias: [2, 2], desde: null, hasta: null }, "día repetido"],
  [{ dias: ["2"], desde: null, hasta: null }, "día como texto"],
  [{ dias: [2], desde: "13:00", hasta: null }, "solo una hora"],
  [{ dias: [2], desde: "13:00", hasta: "13:00" }, "horas iguales"],
  [{ dias: [2], desde: "24:00", hasta: "13:00" }, "hora imposible"],
  [{ dias: [2], desde: "9:00", hasta: "13:00" }, "hora sin cero"],
  [{ dias: [2], desde: null, hasta: null, extra: 1 }, "clave de más"],
  [{ desde: null, hasta: null }, "sin la clave de días"],
  [[2, 3], "un array"],
  ["martes", "un texto"],
]) {
  await rechaza(horario(U.WEB, "menu", malo), /no es válido/, `horario rechazado: ${motivo}`);
}
await rechaza(q(`update public.configuracion_web set horario_tapas_casa_tomas = '{"dias":[9]}'`), /configuracion_web_horarios_validos/,
  "el CHECK frena también la escritura directa");
await rechaza(horario(U.WEB, "postres", null), /Sección no válida/, "sección desconocida");

// ─── 4. Datos de Parker: rellena los vacíos, no pisa lo puesto a mano ──────
// Los dos primeros id de la propia migración.
const idReal = (await q(`select v.id from (values ${PARKER_DATOS.match(/\('([0-9a-f-]{36})', \d+, (?:\d{4}|null)\)/g).slice(0, 2).join(", ")}) v(id, p, a)`)).rows.map((r) => r.id);
await q(`insert into public."Vinos" (id, nombre, categoria, activado, restaurante) values ($1, 'Vacío', 'VINOS TINTOS — RIOJA', true, true), ($2, 'A mano', 'VINOS TINTOS — RIOJA', true, true)`, idReal);
await q(`update public."Vinos" set puntuacion_parker = 80 where id = $1`, [idReal[1]]);
await db.exec(PARKER_DATOS);
await db.exec(PARKER_DATOS);
const tras = (await q(`select id, puntuacion_parker from public."Vinos" where id = any($1) order by id = $2 desc`, [idReal, idReal[0]])).rows;
ok(tras[0].puntuacion_parker >= 50 && tras[0].puntuacion_parker <= 100, "rellena la puntuación de un vino sin ella");
igual(tras[1].puntuacion_parker, 80, "no pisa la puesta a mano");
await db.exec(PARKER_DATOS_ROLLBACK);
igual((await q(`select puntuacion_parker from public."Vinos" where id = any($1) order by id = $2 desc`, [idReal, idReal[0]])).rows.map((r) => r.puntuacion_parker),
  [null, 80], "su rollback quita solo lo que puso");

// ─── 5. Rollbacks ───────────────────────────────────────────────────────────
for (const rb of ROLLBACKS) await db.exec(rb);
const columnas = (await q(`select column_name from information_schema.columns where table_schema = 'public'
  and table_name in ('Vinos', 'configuracion_web') and column_name in ('copeo', 'precio_copa_eur', 'puntuacion_parker',
  'puntuacion_parker_anada', 'encuesta_vinos_activa', 'horario_menu_dia_casa_tomas', 'horario_tapas_casa_tomas')`)).rows;
igual(columnas, [], "los rollbacks quitan las columnas");
igual((await q(`select to_regclass('public.votos_vino_favorito') as t, to_regprocedure('public.votar_vino_favorito(text,text,text,boolean,text)') as f,
  to_regprocedure('public.horario_web_valido(jsonb)') as h`)).rows, [{ t: null, f: null, h: null }], "y la tabla y las funciones");
await db.exec(COPEO); await db.exec(ENCUESTA); await db.exec(HORARIO);
ok(true, "se pueden volver a aplicar tras el rollback");

console.log(`vinos-copeo-encuesta: ${comprobaciones} comprobaciones OK`);
