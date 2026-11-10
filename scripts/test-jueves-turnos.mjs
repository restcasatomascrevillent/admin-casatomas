// Jueves de tapas por la noche en dos turnos fijos (20261122200000) contra un
// Postgres en memoria (PGlite). Nunca toca Supabase.
//
//   npm run test:jueves-turnos:db
//
// Parte de los turnos de la demo (Comida y Cena todos los días, escalera) y de
// la franja de mesa de 20261005130000. Cubre: la columna y su CHECK; que la
// Cena deja el jueves y nace «Cena · Jueves de tapas» con 20:30 y 22:00; que la
// mesa de las 20:30 del jueves queda libre a las 22:00 (y otro día no cambia);
// que aplicarla dos veces no duplica; y la vuelta atrás.
import { PGlite } from "@electric-sql/pglite";
import { readFile } from "node:fs/promises";
import assert from "node:assert/strict";

const MIGRACION = await readFile("supabase/migrations/20261122200000_turnos_horas_fijas_jueves_tapas.sql", "utf8");
const ROLLBACK = await readFile("supabase/rollbacks/20261122200000_turnos_horas_fijas_jueves_tapas_ROLLBACK.sql", "utf8");

let comprobaciones = 0;
const ok = (v, msg) => { assert.ok(v, msg); comprobaciones++; };
const igual = (a, b, msg) => { assert.deepEqual(a, b, msg); comprobaciones++; };

const ANDAMIAJE = `
  create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
  create table public.configuracion_reservas (
    id uuid primary key default gen_random_uuid(),
    estancia_comida_minutos integer not null default 105,
    estancia_cena_minutos integer not null default 120,
    created_at timestamptz not null default now()
  );
  insert into public.configuracion_reservas default values;
  create table public.configuracion_turnos (
    id uuid primary key default gen_random_uuid(),
    nombre_periodo text not null,
    hora_inicio time not null,
    hora_fin time not null,
    intervalo_base_minutos integer not null default 30,
    umbral_apertura_secundario integer not null default 70,
    dias_semana integer[] not null default array[0,1,2,3,4,5,6],
    activo boolean not null default true,
    espacio_id uuid,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    ocultar_primario_si_secundario boolean not null default false,
    niveles_escalera jsonb,
    ocultar_nivel_anterior boolean not null default false,
    base_umbral text not null default 'reparto_nivel_base'
  );
  insert into public.configuracion_turnos (nombre_periodo, hora_inicio, hora_fin, niveles_escalera) values
    ('Comida', '13:00', '16:00', '[{"minutos":60,"umbral":0},{"minutos":30,"umbral":70}]'),
    ('Cena', '20:00', '23:00', '[{"minutos":60,"umbral":0},{"minutos":30,"umbral":70},{"minutos":15,"umbral":85}]');
  -- Como 20261005130000_mesas_ocupacion_por_tiempo.sql
  create function public.fn_minutos_ocupacion_mesa(p_hora time) returns integer language sql stable as $$
    select case when p_hora < '17:00:00'::time
      then coalesce((select c.estancia_comida_minutos from public.configuracion_reservas c order by c.created_at limit 1), 105)
      else coalesce((select c.estancia_cena_minutos from public.configuracion_reservas c order by c.created_at limit 1), 120) end;
  $$;
  create function public.fn_franja_ocupacion_mesa(p_fecha date, p_hora time) returns tsrange language sql stable as $$
    select tsrange(p_fecha + p_hora, p_fecha + p_hora + make_interval(mins => public.fn_minutos_ocupacion_mesa(p_hora)), '[)');
  $$;
`;

const periodos = async (db) =>
  (await db.query(`select nombre_periodo as n, to_char(hora_inicio,'HH24:MI') as i, dias_semana as d,
     (select array_agg(to_char(h,'HH24:MI') order by h) from unnest(horas_fijas) h) as f
   from public.configuracion_turnos order by hora_inicio, nombre_periodo`)).rows;
const finFranja = async (db, fecha, hora) =>
  (await db.query(`select to_char(upper(public.fn_franja_ocupacion_mesa($1::date, $2::time)), 'HH24:MI') as f`, [fecha, hora])).rows[0].f;

const JUEVES = "2026-11-19";
const MIERCOLES = "2026-11-18";

const db = new PGlite();
await db.exec(ANDAMIAJE);
igual(await finFranja(db, JUEVES, "20:30"), "22:30", "antes: 120 min también el jueves");

// 1) Aplicar.
await db.exec(MIGRACION);
igual(await periodos(db), [
  { n: "Comida", i: "13:00", d: [0, 1, 2, 3, 4, 5, 6], f: null },
  { n: "Cena", i: "20:00", d: [0, 1, 2, 3, 5, 6], f: null },
  { n: "Cena · Jueves de tapas", i: "20:30", d: [4], f: ["20:30", "22:00"] },
], "la Cena deja el jueves y el jueves noche va en dos turnos; la comida no se toca");
const tapas = (await db.query(`select hora_fin::text as fin, niveles_escalera from public.configuracion_turnos where 4 = any(dias_semana) and horas_fijas is not null`)).rows[0];
igual(tapas.fin, "23:00:00", "el periodo de tapas acaba cuando la cena");

// 2) La mesa del 1.er turno queda libre a las 22:00 (solo el jueves).
igual(await finFranja(db, JUEVES, "20:30"), "22:00", "jueves 20:30 → 22:00");
igual(await finFranja(db, JUEVES, "21:00"), "22:00", "jueves 21:00 (a mano) → 22:00");
igual(await finFranja(db, JUEVES, "22:00"), "00:00", "jueves 22:00 → sus 120 min");
igual(await finFranja(db, JUEVES, "14:00"), "15:45", "la comida del jueves, igual");
igual(await finFranja(db, MIERCOLES, "20:30"), "22:30", "el miércoles, igual que antes");
ok((await db.query(`select (public.fn_franja_ocupacion_mesa('${JUEVES}', '20:30') && public.fn_franja_ocupacion_mesa('${JUEVES}', '22:00')) as s`)).rows[0].s === false,
  "la misma mesa vale para los dos turnos del jueves");

// 3) Un periodo de tapas desactivado no recorta nada.
await db.exec(`update public.configuracion_turnos set activo = false where horas_fijas is not null`);
igual(await finFranja(db, JUEVES, "20:30"), "22:30", "desactivado: sin recorte");
await db.exec(`update public.configuracion_turnos set activo = true where horas_fijas is not null`);

// 4) CHECK.
await assert.rejects(db.exec(`update public.configuracion_turnos set horas_fijas = '{}' where horas_fijas is not null`), /horas_fijas_check/);
comprobaciones++;

// 5) Idempotente.
await db.exec(MIGRACION);
igual((await periodos(db)).length, 3, "aplicarla otra vez no duplica");

// 6) Vuelta atrás.
await db.exec(ROLLBACK);
const tras = (await db.query(`select nombre_periodo as n, dias_semana as d from public.configuracion_turnos order by hora_inicio`)).rows;
igual(tras, [{ n: "Comida", d: [0, 1, 2, 3, 4, 5, 6] }, { n: "Cena", d: [0, 1, 2, 3, 4, 5, 6] }], "rollback: la Cena vuelve al jueves");
ok((await db.query(`select 1 from information_schema.columns where table_name='configuracion_turnos' and column_name='horas_fijas'`)).rows.length === 0, "rollback: sin columna");
igual(await finFranja(db, JUEVES, "20:30"), "22:30", "rollback: franja como antes");

console.log(`OK jueves de tapas en dos turnos: ${comprobaciones} comprobaciones`);
