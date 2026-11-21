// Comidas de los jueves con reserva web (20261214100000) contra un Postgres en
// memoria (PGlite). Nunca toca Supabase.
//
//   npm run test:jueves-comida-web:db
//
// Parte del estado de la demo y de producción (cierres 20261013120000 y jueves
// de tapas 20261122103000 aplicados de verdad: comida {1,4}, cena {0,1,4},
// abiertos sin reserva web {4}) y aplica la migración REAL dos veces. Cubre:
// que se para si falta la de cierres; que la web y el bot reciben la comida del
// jueves ABIERTA y la cena igual de cerrada; que el resto de la regla no cambia
// (lunes, domingo noche, la columna del jueves de tapas); que las excepciones
// de `cierres_reserva` siguen mandando; que no pisa otros días puestos a mano;
// y la vuelta atrás.
import { PGlite } from "@electric-sql/pglite";
import { readFile } from "node:fs/promises";
import assert from "node:assert/strict";

const CIERRES = await readFile("supabase/migrations/20261013120000_cierres_reserva.sql", "utf8");
const JUEVES_TAPAS = await readFile("supabase/migrations/20261122103000_jueves_abiertos_sin_reserva_web.sql", "utf8");
const MIGRACION = await readFile("supabase/migrations/20261214100000_jueves_comida_reserva_web.sql", "utf8");
const ROLLBACK = await readFile("supabase/rollbacks/20261214100000_jueves_comida_reserva_web_ROLLBACK.sql", "utf8");

let comprobaciones = 0;
const ok = (v, msg) => { assert.ok(v, msg); comprobaciones++; };
const igual = (a, b, msg) => { assert.deepEqual(a, b, msg); comprobaciones++; };

const ANDAMIAJE = `
  create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
  create schema auth;
  create function auth.uid() returns uuid language sql stable as $$ select null::uuid $$;
  create function public.can_read_section(text) returns boolean language sql stable as $$ select true $$;
  create function public.can_write_section(text) returns boolean language sql stable as $$ select true $$;
  create function public.fn_registrar_auditoria() returns trigger language plpgsql as $$ begin return null; end $$;
  create table public.configuracion_reservas (
    id uuid primary key default gen_random_uuid(),
    max_comensales_por_reserva integer,
    created_at timestamptz not null default now()
  );
  insert into public.configuracion_reservas (max_comensales_por_reserva) values (7);
`;

async function base({ conCierres = true } = {}) {
  const db = new PGlite();
  await db.exec(ANDAMIAJE);
  if (conCierres) {
    await db.exec(CIERRES);
    await db.exec(JUEVES_TAPAS);
  }
  return db;
}

// Semana del 23/11/2026: lunes 23, martes 24, jueves 26, domingo 29.
async function cerrados(db, desde = "2026-11-23", hasta = "2026-11-29") {
  const { rows } = await db.query(
    `select to_char(fecha, 'YYYY-MM-DD') || ' ' || turno || ' ' || origen as s from public.servicios_cerrados_reserva($1, $2)`,
    [desde, hasta],
  );
  return rows.map((r) => r.s).sort();
}
const regla = async (db) => {
  const r = (await db.query(`select dias_cerrados_comida as c, dias_cerrados_cena as n, dias_abiertos_sin_reserva_online as a from public.configuracion_reservas`)).rows[0];
  return { comida: r.c, cena: r.n, abiertosSinWeb: r.a };
};

const ANTES = [
  "2026-11-23 cena semanal", "2026-11-23 comida semanal",
  "2026-11-26 cena semanal", "2026-11-26 comida semanal",
  "2026-11-29 cena semanal",
];
// Lo único que cambia: la comida del jueves 26 deja de estar cerrada.
const DESPUES = [
  "2026-11-23 cena semanal", "2026-11-23 comida semanal",
  "2026-11-26 cena semanal",
  "2026-11-29 cena semanal",
];

// 1) Sin la migración de cierres, se para con un mensaje claro.
{
  const db = await base({ conCierres: false });
  await assert.rejects(db.exec(MIGRACION), /20261013120000/, "debe pedir la migración de cierres");
  comprobaciones++;
}

// 2) Estado de la demo/producción.
{
  const db = await base();
  igual(await cerrados(db), ANTES, "punto de partida: lunes, jueves entero y domingo noche sin reservas web");
  await db.exec(MIGRACION);
  igual(await cerrados(db), DESPUES, "la comida del jueves se abre a la web y al bot; todo lo demás igual");
  igual(await regla(db), { comida: [1], cena: [0, 1, 4], abiertosSinWeb: [4] }, "solo cambia la comida; la cena y el jueves de tapas, igual");

  // Todos los jueves de aquí a febrero: comida abierta, cena cerrada.
  const jueves = (await cerrados(db, "2026-11-26", "2027-02-25")).filter((s) => {
    const d = new Date(`${s.slice(0, 10)}T00:00:00Z`);
    return d.getUTCDay() === 4;
  });
  ok(jueves.length === 14 && jueves.every((s) => s.includes(" cena ")), "14 jueves: solo la cena sigue sin reserva web");

  // Idempotente.
  await db.exec(MIGRACION);
  igual((await regla(db)).comida, [1], "aplicarla otra vez no cambia nada");

  // Las excepciones a mano siguen mandando.
  await db.exec(`insert into public.cierres_reserva (fecha, turno, abierto, motivo) values
    ('2026-12-03', 'comida', false, 'Evento privado'),
    ('2027-01-07', 'comida', true, null)`);
  const dic = await cerrados(db, "2026-12-03", "2026-12-03");
  igual(dic, ["2026-12-03 cena semanal", "2026-12-03 comida manual"], "un jueves cerrado a mano sigue cerrado");
  igual(await cerrados(db, "2027-01-07", "2027-01-07"), ["2027-01-07 cena semanal"], "la apertura que ya había no estorba");

  // Vuelta atrás.
  await db.exec(ROLLBACK);
  igual((await regla(db)).comida, [1, 4], "rollback: el jueves vuelve a cerrar la comida");
  igual(await cerrados(db), ANTES, "rollback: la web y el bot reciben lo de antes");
  igual(await cerrados(db, "2027-01-07", "2027-01-07"), ["2027-01-07 cena semanal"], "rollback: la apertura a mano del 7/01 sigue mandando");
  await db.exec(ROLLBACK);
  igual((await regla(db)).comida, [1, 4], "rollback idempotente");
}

// 3) Otros días puestos a mano en la regla: solo se quita el jueves, y la vuelta atrás lo devuelve en orden.
{
  const db = await base();
  await db.exec(`update public.configuracion_reservas set dias_cerrados_comida = '{6,1,4}'`);
  await db.exec(MIGRACION);
  igual((await regla(db)).comida, [6, 1], "solo se quita el jueves");
  await db.exec(ROLLBACK);
  igual((await regla(db)).comida, [1, 4, 6], "rollback: el jueves vuelve (en orden)");
}

// 4) Si la regla ya no cerraba la comida del jueves, no hace nada.
{
  const db = await base();
  await db.exec(`update public.configuracion_reservas set dias_cerrados_comida = '{1}'`);
  await db.exec(MIGRACION);
  igual((await regla(db)).comida, [1], "ya abierta: igual");
}

console.log(`✓ comidas de los jueves con reserva web: ${comprobaciones} comprobaciones`);
