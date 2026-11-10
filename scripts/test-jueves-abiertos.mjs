// Jueves de tapas: abierto en el panel, sin reservas web (20261122103000)
// contra un Postgres en memoria (PGlite). Nunca toca Supabase.
//
//   npm run test:jueves-abiertos:db
//
// Parte del estado que dejó 20261013120000_cierres_reserva.sql (aplicada de
// verdad aquí: comida {1,4}, cena {0,1,4}, como la demo) y aplica la migración
// REAL dos veces. Cubre: que se para si falta la de cierres; la columna nueva
// con el jueves; que NO cambia lo que reciben la web y el bot
// (`servicios_cerrados_reserva` da el jueves igual que antes); que no rellena
// el jueves si la regla ya no lo cerraba; que no pisa un valor cambiado; el
// CHECK; y la vuelta atrás.
import { PGlite } from "@electric-sql/pglite";
import { readFile } from "node:fs/promises";
import assert from "node:assert/strict";

const CIERRES = await readFile("supabase/migrations/20261013120000_cierres_reserva.sql", "utf8");
const MIGRACION = await readFile("supabase/migrations/20261122103000_jueves_abiertos_sin_reserva_web.sql", "utf8");
const ROLLBACK = await readFile("supabase/rollbacks/20261122103000_jueves_abiertos_sin_reserva_web_ROLLBACK.sql", "utf8");

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
  if (conCierres) await db.exec(CIERRES);
  return db;
}

// Noviembre 2026: lunes 16, jueves 19, domingo 22.
async function cerrados(db) {
  const { rows } = await db.query(
    `select to_char(fecha, 'YYYY-MM-DD') || ' ' || turno || ' ' || origen as s from public.servicios_cerrados_reserva('2026-11-16', '2026-11-22')`,
  );
  return rows.map((r) => r.s).sort();
}
const abiertos = async (db) => (await db.query(`select dias_abiertos_sin_reserva_online as d from public.configuracion_reservas`)).rows[0]?.d;
const columna = async (db) =>
  (await db.query(`select 1 from information_schema.columns where table_name = 'configuracion_reservas' and column_name = 'dias_abiertos_sin_reserva_online'`)).rows.length === 1;

const CANALES = [
  "2026-11-16 cena semanal", "2026-11-16 comida semanal",
  "2026-11-19 cena semanal", "2026-11-19 comida semanal",
  "2026-11-22 cena semanal",
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
  igual(await cerrados(db), CANALES, "punto de partida: lunes, jueves y domingo noche sin reservas web");
  await db.exec(MIGRACION);
  igual(await abiertos(db), [4], "el jueves, abierto sin reservas web");
  igual(await cerrados(db), CANALES, "la web y el bot reciben exactamente lo mismo que antes");
  const regla = (await db.query(`select dias_cerrados_comida as c, dias_cerrados_cena as n from public.configuracion_reservas`)).rows[0];
  igual([regla.c, regla.n], [[1, 4], [0, 1, 4]], "la regla de los canales no cambia");

  // Idempotente y sin pisar lo cambiado a mano.
  await db.exec(`update public.configuracion_reservas set dias_abiertos_sin_reserva_online = '{4,6}'`);
  await db.exec(MIGRACION);
  igual(await abiertos(db), [4, 6], "aplicarla otra vez no pisa el valor");

  // CHECK.
  await assert.rejects(db.exec(`update public.configuracion_reservas set dias_abiertos_sin_reserva_online = '{9}'`), /check|viola|violates/i);
  comprobaciones++;

  // Fila nueva: DEFAULT vacío (no inventa días).
  await db.exec(`insert into public.configuracion_reservas (max_comensales_por_reserva) values (5)`);
  const nueva = (await db.query(`select dias_abiertos_sin_reserva_online as d from public.configuracion_reservas order by created_at desc, ctid desc limit 1`)).rows[0].d;
  igual(nueva, [], "DEFAULT vacío");

  // Vuelta atrás.
  await db.exec(ROLLBACK);
  ok(!(await columna(db)), "rollback: sin la columna");
  igual(await cerrados(db), CANALES, "rollback: los canales igual");
  await db.exec(ROLLBACK);
  ok(!(await columna(db)), "rollback idempotente");
}

// 3) Si la regla ya no cerraba el jueves entero, no se rellena.
{
  const db = await base();
  await db.exec(`update public.configuracion_reservas set dias_cerrados_comida = '{1}', dias_cerrados_cena = '{0,1,4}'`);
  await db.exec(MIGRACION);
  igual(await abiertos(db), [], "jueves solo sin cena: no se marca");
}

console.log(`✓ jueves de tapas (abierto, sin reservas web): ${comprobaciones} comprobaciones`);
