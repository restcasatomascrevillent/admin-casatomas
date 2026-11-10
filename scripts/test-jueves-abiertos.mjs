// Los jueves abren a reservas (20261122103000) contra un Postgres en memoria
// (PGlite). Nunca toca Supabase.
//
//   npm run test:jueves-abiertos:db
//
// Parte del estado que dejó 20261013120000_cierres_reserva.sql (aplicada de
// verdad aquí, con la regla de la demo y producción: comida {1,4}, cena
// {0,1,4}) y aplica la migración REAL dos veces. Cubre: que se para si falta
// la de cierres, que los jueves dejan de salir en `servicios_cerrados_reserva`
// (lunes y domingo noche siguen), que respeta otros días cambiados a mano, que
// no toca `cierres_reserva` (un jueves cerrado a mano sigue cerrado), los
// DEFAULT y el respaldo sin fila de configuración, y la vuelta atrás.
import { PGlite } from "@electric-sql/pglite";
import { readFile } from "node:fs/promises";
import assert from "node:assert/strict";

const CIERRES = await readFile("supabase/migrations/20261013120000_cierres_reserva.sql", "utf8");
const MIGRACION = await readFile("supabase/migrations/20261122103000_jueves_abiertos.sql", "utf8");
const ROLLBACK = await readFile("supabase/rollbacks/20261122103000_jueves_abiertos_ROLLBACK.sql", "utf8");

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
`;

async function base({ conCierres = true, filaConfig = true } = {}) {
  const db = new PGlite();
  await db.exec(ANDAMIAJE);
  if (filaConfig) await db.exec(`insert into public.configuracion_reservas (max_comensales_por_reserva) values (7);`);
  if (conCierres) await db.exec(CIERRES);
  return db;
}

// Noviembre 2026: lunes 16, martes 17, jueves 19, sábado 21, domingo 22.
async function cerrados(db, desde = "2026-11-16", hasta = "2026-11-22") {
  const { rows } = await db.query(
    `select to_char(fecha, 'YYYY-MM-DD') as fecha, turno, origen from public.servicios_cerrados_reserva($1::date, $2::date)`,
    [desde, hasta],
  );
  return rows.map((r) => `${r.fecha} ${r.turno}${r.origen === "manual" ? " (manual)" : ""}`).sort();
}
const regla = async (db) =>
  (await db.query(`select dias_cerrados_comida as comida, dias_cerrados_cena as cena from public.configuracion_reservas`)).rows;

const ANTES = ["2026-11-16 cena", "2026-11-16 comida", "2026-11-19 cena", "2026-11-19 comida", "2026-11-22 cena"];
const DESPUES = ["2026-11-16 cena", "2026-11-16 comida", "2026-11-22 cena"];

// 1) Sin la migración de cierres, se para con un mensaje claro.
{
  const db = await base({ conCierres: false });
  await assert.rejects(db.exec(MIGRACION), /20261013120000/, "debe pedir la migración de cierres");
  comprobaciones++;
}

// 2) Estado de la demo/producción: los jueves cierran; tras la migración, abren.
{
  const db = await base();
  igual(await cerrados(db), ANTES, "punto de partida: lunes, jueves y domingo noche");
  await db.exec(MIGRACION);
  igual(await regla(db), [{ comida: [1], cena: [0, 1] }], "regla sin el jueves");
  igual(await cerrados(db), DESPUES, "los jueves ya no salen cerrados");
  // Otro mes entero: ningún jueves (dow 4) cerrado.
  const mes = await db.query(
    `select count(*)::int as n from public.servicios_cerrados_reserva('2026-12-01', '2027-01-31') where extract(dow from fecha) = 4`,
  );
  igual(mes.rows[0].n, 0, "ningún jueves de diciembre y enero");
  await db.exec(MIGRACION);
  igual(await regla(db), [{ comida: [1], cena: [0, 1] }], "idempotente");
  igual(await cerrados(db), DESPUES, "idempotente (RPC)");

  // DEFAULT de las columnas.
  const def = await db.query(
    `select column_name, column_default from information_schema.columns
     where table_name = 'configuracion_reservas' and column_name like 'dias_cerrados_%' order by 1`,
  );
  ok(/\{0,1\}/.test(def.rows[0].column_default), `default cena {0,1} (${def.rows[0].column_default})`);
  ok(/\{1\}/.test(def.rows[1].column_default) && !/4/.test(def.rows[1].column_default), `default comida {1} (${def.rows[1].column_default})`);

  // Vuelta atrás: los jueves vuelven a cerrar.
  await db.exec(ROLLBACK);
  igual(await regla(db), [{ comida: [1, 4], cena: [0, 1, 4] }], "rollback: regla original");
  igual(await cerrados(db), ANTES, "rollback: los jueves cierran otra vez");
  await db.exec(ROLLBACK);
  igual(await regla(db), [{ comida: [1, 4], cena: [0, 1, 4] }], "rollback idempotente");
}

// 3) Excepciones y regla cambiada a mano: se respetan.
{
  const db = await base();
  await db.exec(`
    update public.configuracion_reservas set dias_cerrados_comida = '{1,2,4}', dias_cerrados_cena = '{0,1,4,6}';
    insert into public.cierres_reserva (fecha, turno, abierto, motivo) values
      ('2026-11-26', 'cena', false, 'Evento privado'),
      ('2026-11-19', 'comida', true, null);
  `);
  await db.exec(MIGRACION);
  igual(await regla(db), [{ comida: [1, 2], cena: [0, 1, 6] }], "solo se quita el jueves");
  const nov = await cerrados(db, "2026-11-19", "2026-11-26");
  ok(!nov.some((c) => c.startsWith("2026-11-19")), "el jueves 19 abierto");
  ok(nov.includes("2026-11-26 cena (manual)"), "el jueves 26 cerrado a mano sigue cerrado por la noche");
  ok(!nov.includes("2026-11-26 comida"), "y abierto a mediodía");
  const filas = await db.query(`select count(*)::int as n from public.cierres_reserva`);
  igual(filas.rows[0].n, 2, "no toca cierres_reserva");
}

// 4) Sin fila de configuración: el respaldo de la RPC tampoco cierra los jueves.
{
  const db = await base({ filaConfig: false });
  await db.exec(MIGRACION);
  igual(await cerrados(db), DESPUES, "respaldo sin configuración");
  // Fila nueva con los DEFAULT.
  await db.exec(`insert into public.configuracion_reservas (max_comensales_por_reserva) values (7);`);
  igual(await regla(db), [{ comida: [1], cena: [0, 1] }], "fila nueva con los DEFAULT nuevos");
}

console.log(`✓ jueves abiertos: ${comprobaciones} comprobaciones`);
