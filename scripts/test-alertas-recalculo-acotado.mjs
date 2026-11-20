// Recálculo de alertas del minuto acotado (migración 20261213030000), contra un Postgres en
// memoria (PGlite). Nunca toca Supabase.
//
//   npm run test:alertas-recalculo:db
//
// Cubre la migración REAL (aplicada dos veces) y su vuelta atrás:
//   - cola vacía → «nada»; cola reciente → «esperando»; cola vieja → recalcula y vacía la cola;
//   - pausa de 2 min tras un recálculo bueno (la cola se conserva);
//   - si el recálculo choca con un bloqueo (55P03), se cancela (57014) o se interbloquea (40P01),
//     el intento se DESHACE (la cola se conserva), se anota el fallo y se espera 2, 4… 10 min;
//   - cede el paso a un guardado en marcha, pero no más de 15 min;
//   - lock_timeout vuelve a su valor tras un recálculo bueno;
//   - el comando del cron lleva el statement_timeout de 20 s, sin tocar el horario ni otros jobs;
//   - rollback.
// facturas_generar_alertas se sustituye por un stub que apunta las llamadas (su lógica de alertas no
// cambia: la igualdad de resultados se comprobó contra producción/demo con begin … rollback).
import { PGlite } from "@electric-sql/pglite";
import { readFile } from "node:fs/promises";
import assert from "node:assert/strict";

const MIGRACION = await readFile("supabase/migrations/20261213030000_alertas_recalculo_acotado.sql", "utf8");
const ROLLBACK = await readFile("supabase/rollbacks/20261213030000_alertas_recalculo_acotado_ROLLBACK.sql", "utf8");

let comprobaciones = 0;
const ok = (v, msg) => { assert.ok(v, msg); comprobaciones++; };
const eq = (a, b, msg) => { assert.deepEqual(a, b, msg); comprobaciones++; };

ok(!/^\s*(begin|commit)\s*;/im.test(MIGRACION), "la migración no lleva begin/commit propios");
ok(/for update of n;/.test(MIGRACION) && /order by n\.clave/.test(MIGRACION), "facturas_generar_alertas bloquea las filas en orden de clave");

const db = new PGlite();
await db.exec(`
  create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
  create table public.facturas_alertas_recalculo_cola (id bigserial primary key, creado timestamptz not null default now());
  create table public.llamadas (n serial, ok boolean);
  create function public.facturas_generar_alertas(p_hoy date default current_date) returns jsonb
    language plpgsql as $$ begin insert into public.llamadas (ok) values (true); return jsonb_build_object('vigentes', 3); end $$;
  create schema cron;
  create table cron.job (jobid bigserial primary key, jobname text, schedule text, command text);
  create function cron.alter_job(job_id bigint, schedule text default null, command text default null) returns void language sql as
    $$ update cron.job set schedule = coalesce(alter_job.schedule, job.schedule), command = coalesce(alter_job.command, job.command) where jobid = alter_job.job_id $$;
  insert into cron.job (jobname, schedule, command) values
    ('facturas-alertas-recalculo', '* * * * *', 'select public.facturas_alertas_recalcular_pendiente();'),
    ('facturas-alertas', '15 6 * * *', 'select public.facturas_generar_alertas();');
`);

const MIGRACION_SIN_STUB = MIGRACION; // la migración recrea facturas_generar_alertas: se vuelve a poner el stub tras aplicarla
const ponerStub = (cuerpo) => db.exec(`
  create or replace function public.facturas_generar_alertas(p_hoy date default current_date) returns jsonb
    language plpgsql as $$ begin ${cuerpo} end $$;`);
const STUB_OK = `insert into public.llamadas (ok) values (true); return jsonb_build_object('vigentes', 3);`;

const aplicar = async () => { await db.exec(MIGRACION_SIN_STUB); await ponerStub(STUB_OK); };
await aplicar();
await db.exec(MIGRACION_SIN_STUB); // idempotente
await ponerStub(STUB_OK);

const llamar = async () => (await db.query(`select public.facturas_alertas_recalcular_pendiente() as r`)).rows[0].r;
const motivo = (r) => r.motivo ?? (r.hecho ? "hecho" : "?");
const cola = async () => Number((await db.query(`select count(*) n from public.facturas_alertas_recalculo_cola`)).rows[0].n);
const llamadasN = async () => Number((await db.query(`select count(*) n from public.llamadas`)).rows[0].n);
const estado = async () => (await db.query(`select * from public.facturas_alertas_recalculo_estado where id = 1`)).rows[0];
const llenarCola = (n, hace = "5 minutes") => db.exec(`insert into public.facturas_alertas_recalculo_cola (creado) select now() - interval '${hace}' + g * interval '1 second' from generate_series(1, ${n}) g`);
const limpiar = () => db.exec(`delete from public.facturas_alertas_recalculo_cola; delete from public.llamadas; delete from public.facturas_alertas_recalculo_estado;`);

// ── 1. cola vacía / reciente / vieja ─────────────────────────────────────────
eq(motivo(await llamar()), "nada", "cola vacía: no hace nada");
eq(await estado(), undefined, "cola vacía: no escribe estado");
await db.exec(`insert into public.facturas_alertas_recalculo_cola default values`);
eq(motivo(await llamar()), "esperando", "cola de hace un instante: espera a que acaben de cargar");
eq(await cola(), 1, "esperando no vacía la cola");
await limpiar();

await llenarCola(4);
let r = await llamar();
ok(r.hecho === true && r.resultado.vigentes === 3, "cola vieja: recalcula y devuelve el resultado");
eq(await cola(), 0, "recalcular vacía la cola");
eq(await llamadasN(), 1, "se llamó una vez a facturas_alertas_generar");
let e = await estado();
ok(e.ultimo_motivo === "hecho" && e.fallos_seguidos === 0 && e.ultimo_fin !== null && e.ultima_duracion_ms >= 0, "estado: hecho");

// ── 2. pausa de 2 min ────────────────────────────────────────────────────────
await llenarCola(2);
eq(motivo(await llamar()), "pausa", "otro recálculo enseguida: pausa");
eq(await cola(), 2, "la pausa conserva la cola");
eq(await llamadasN(), 1, "la pausa no recalcula");
await db.exec(`update public.facturas_alertas_recalculo_estado set ultimo_fin = now() - interval '3 minutes'`);
r = await llamar();
ok(r.hecho === true && (await cola()) === 0 && (await llamadasN()) === 2, "pasada la pausa vuelve a recalcular");
await limpiar();

// ── 3. choques: bloqueo, cancelación, interbloqueo ──────────────────────────
for (const [nombre, codigo] of [["bloqueo (lock_timeout)", "55P03"], ["tiempo (statement_timeout)", "57014"], ["interbloqueo", "40P01"]]) {
  await limpiar();
  await ponerStub(`insert into public.llamadas (ok) values (false); raise exception 'choque' using errcode = '${codigo}';`);
  await llenarCola(3);
  r = await llamar();
  ok(r.hecho === false && r.motivo === "cedido", `${nombre}: cede`);
  eq(await cola(), 3, `${nombre}: el intento se deshace y la cola se conserva`);
  eq(await llamadasN(), 0, `${nombre}: lo escrito por el intento se deshace`);
  e = await estado();
  ok(e.fallos_seguidos === 1 && e.ultimo_motivo === "cedido" && /choque/.test(e.ultimo_error), `${nombre}: anota el fallo`);
  eq(motivo(await llamar()), "reintento_mas_tarde", `${nombre}: no insiste el minuto siguiente`);
  eq(await cola(), 3, `${nombre}: la espera conserva la cola`);
}
// espera creciente y recuperación
await limpiar();
await ponerStub(`raise exception 'choque' using errcode = '55P03';`);
await llenarCola(1);
await llamar();
await db.exec(`update public.facturas_alertas_recalculo_estado set ultimo_intento = now() - interval '3 minutes'`);
eq(motivo(await llamar()), "cedido", "a los 2 min del primer fallo reintenta (y vuelve a ceder)");
eq((await estado()).fallos_seguidos, 2, "segundo fallo seguido");
await db.exec(`update public.facturas_alertas_recalculo_estado set ultimo_intento = now() - interval '3 minutes'`);
eq(motivo(await llamar()), "reintento_mas_tarde", "con 2 fallos la espera es de 4 min: a los 3 aún no");
await db.exec(`update public.facturas_alertas_recalculo_estado set ultimo_intento = now() - interval '5 minutes'`);
await ponerStub(STUB_OK);
r = await llamar();
ok(r.hecho === true && (await cola()) === 0, "pasada la espera y sin choque, recalcula");
e = await estado();
ok(e.fallos_seguidos === 0 && e.ultimo_error === null && e.ultimo_motivo === "hecho", "un recálculo bueno borra los fallos");
await limpiar();

// Otros errores NO se tragan.
await ponerStub(`raise exception 'otro fallo' using errcode = 'XX000';`);
await llenarCola(1);
await assert.rejects(llamar(), /otro fallo/);
comprobaciones++;
eq(await cola(), 1, "un error inesperado también deja la cola intacta (se deshace la transacción)");
await ponerStub(STUB_OK);
await limpiar();

// ── 4. ceder el paso a un guardado en marcha (máx. 15 min) ──────────────────
eq((await db.query(`select public.facturas_alertas_hay_guardado_en_curso() as b`)).rows[0].b, false, "sin guardados visibles no cede (y no falla)");
await db.exec(`create or replace function public.facturas_alertas_hay_guardado_en_curso() returns boolean language sql as $$ select true $$;`);
await llenarCola(2, "5 minutes");
r = await llamar();
ok(r.hecho === false && r.motivo === "cede_a_guardado", "hay un guardado en marcha: cede");
eq(await cola(), 2, "ceder conserva la cola");
await db.exec(`delete from public.facturas_alertas_recalculo_cola`);
await llenarCola(2, "20 minutes");
r = await llamar();
ok(r.hecho === true, "con la cola de más de 15 min ya no cede (no hay inanición)");
await db.exec(MIGRACION_SIN_STUB); await ponerStub(STUB_OK); // restaura la función real de «guardado en curso»
await limpiar();

// ── 5. lock_timeout vuelve a su valor ───────────────────────────────────────
await db.exec(`set lock_timeout = '7s'`);
await llenarCola(1);
await db.exec(`begin`);
r = await llamar();
const lt = (await db.query(`select current_setting('lock_timeout') as v`)).rows[0].v;
await db.exec(`rollback`);
ok(r.hecho === true && lt === "7s", `lock_timeout restaurado tras recalcular (era 7s, queda ${lt})`);
await db.exec(`reset lock_timeout`);
await limpiar();

// ── 6. cron: solo cambia el comando de su job ───────────────────────────────
const jobs = async () => Object.fromEntries((await db.query(`select jobname, schedule, command from cron.job`)).rows.map((x) => [x.jobname, x]));
let j = await jobs();
ok(/set local statement_timeout = '20s'/.test(j["facturas-alertas-recalculo"].command) && /facturas_alertas_recalcular_pendiente/.test(j["facturas-alertas-recalculo"].command), "el cron lleva el tope de 20 s");
eq(j["facturas-alertas-recalculo"].schedule, "* * * * *", "no toca el horario");
eq(j["facturas-alertas"].command, "select public.facturas_generar_alertas();", "no toca el cron diario");
// el escalonado de horarios de otro PR sigue valiendo antes o después
await db.exec(`select cron.alter_job(jobid, schedule := '*/2 * * * *') from cron.job where jobname = 'facturas-alertas-recalculo'`);
await db.exec(MIGRACION_SIN_STUB); await ponerStub(STUB_OK);
j = await jobs();
ok(j["facturas-alertas-recalculo"].schedule === "*/2 * * * *" && /20s/.test(j["facturas-alertas-recalculo"].command), "reaplicar no pisa un horario cambiado");
// sin pg_cron (otro entorno) no falla
const sinCron = new PGlite();
await sinCron.exec(`
  create role anon nologin; create role authenticated nologin; create role service_role nologin;
  create table public.facturas_alertas_recalculo_cola (id bigserial primary key, creado timestamptz not null default now());
  create function public.facturas_generar_alertas(p_hoy date default current_date) returns jsonb language sql as $$ select '{}'::jsonb $$;`);
await sinCron.exec(MIGRACION);
comprobaciones++;
await sinCron.close();

// ── 7. rollback ─────────────────────────────────────────────────────────────
await db.exec(ROLLBACK);
await db.exec(ROLLBACK); // reaplicable
eq((await db.query(`select to_regclass('public.facturas_alertas_recalculo_estado') as t`)).rows[0].t, null, "rollback: borra la tabla de estado");
eq((await db.query(`select to_regprocedure('public.facturas_alertas_hay_guardado_en_curso()') as t`)).rows[0].t, null, "rollback: borra la función auxiliar");
j = await jobs();
eq(j["facturas-alertas-recalculo"].command, "select public.facturas_alertas_recalcular_pendiente();", "rollback: el cron vuelve a su comando");
await limpiar().catch(() => {});
await db.exec(`delete from public.facturas_alertas_recalculo_cola; delete from public.llamadas`);
await ponerStub(STUB_OK);
await llenarCola(1);
r = await llamar();
ok(r.hecho === true && (await cola()) === 0, "rollback: el recálculo vuelve a funcionar como antes (sin pausa ni estado)");
await llenarCola(1);
r = await llamar();
ok(r.hecho === true, "rollback: sin pausa entre recálculos");

console.log(`OK: ${comprobaciones} comprobaciones del recálculo acotado de alertas`);
