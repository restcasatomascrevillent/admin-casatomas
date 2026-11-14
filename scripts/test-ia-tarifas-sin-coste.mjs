// IA: tarifas de los modelos del centro de modelos y recálculo de las filas de
// ia_uso sin coste (20261129143000) contra un Postgres en memoria (PGlite).
// Nunca toca Supabase.
//
//   npm run test:ia-tarifas:db
//
// Cubre: migración REAL aplicada dos veces (idempotente y sin pisar una tarifa
// existente), las tarifas nuevas, el recálculo de lo que estaba a NULL con la
// MISMA cuenta que ia_registrar_uso (cacheados y escritura en caché fuera del
// input, razonamiento dentro de la salida), que un coste ya calculado no se
// toca nunca (nada se cuenta dos veces), que un modelo sin tarifa sigue a NULL
// hasta que se le da de alta (y entonces se arregla solo con el trigger), que
// corregir una tarifa solo arregla lo que estaba a NULL, permisos de la
// función y el rollback (que conserva tarifas y costes).
import { PGlite } from "@electric-sql/pglite";
import { readFile } from "node:fs/promises";
import assert from "node:assert/strict";

const MIGRACION = await readFile("supabase/migrations/20261129143100_ia_tarifas_sin_coste.sql", "utf8");
const ROLLBACK = await readFile("supabase/rollbacks/20261129143100_ia_tarifas_sin_coste_ROLLBACK.sql", "utf8");

let comprobaciones = 0;
const ok = (v, msg) => { assert.ok(v, msg); comprobaciones++; };
const igual = (a, b, msg) => { assert.deepEqual(a, b, msg); comprobaciones++; };

// Las tablas como en producción (columnas que usa la migración).
const ANDAMIAJE = `
  create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
  grant usage on schema public to anon, authenticated, service_role;
  create table public.ia_precios (
    modelo text primary key check (length(modelo) between 1 and 120),
    usd_por_m_input numeric(12,6) not null check (usd_por_m_input >= 0),
    usd_por_m_cached numeric(12,6) check (usd_por_m_cached >= 0),
    usd_por_m_cache_write numeric(12,6) check (usd_por_m_cache_write >= 0),
    usd_por_m_output numeric(12,6) not null check (usd_por_m_output >= 0),
    razonamiento_como_output boolean not null default true,
    notas text, fuente text, verificado_en date, actualizado_en timestamptz not null default now());
  create table public.ia_uso (
    id bigint generated always as identity primary key,
    funcion text not null, operacion text not null default 'chat', modelo text not null,
    prompt_tokens integer not null default 0, cached_tokens integer not null default 0, cache_write_tokens integer not null default 0,
    completion_tokens integer not null default 0, razonamiento_tokens integer not null default 0,
    llamadas integer not null default 1, coste_usd numeric(12,6) check (coste_usd >= 0),
    estado text not null default 'ok', disparador text, duracion_ms integer, created_at timestamptz not null default now(),
    constraint ia_uso_razonamiento_cabe_en_completion check (razonamiento_tokens <= completion_tokens));
  alter table public.ia_uso enable row level security;
  grant select on public.ia_uso to authenticated;
  grant all on public.ia_uso, public.ia_precios to service_role;

  insert into public.ia_precios (modelo, usd_por_m_input, usd_por_m_cached, usd_por_m_cache_write, usd_por_m_output, notas) values
    ('gpt-4.1', 2, 0.5, null, 8, 'existente'),
    -- Ya existía con otra tarifa: la migración NO la pisa.
    ('gpt-6-luna', 9, 9, 9, 9, 'tarifa del dueño');

  insert into public.ia_uso (funcion, modelo, prompt_tokens, cached_tokens, cache_write_tokens, completion_tokens, razonamiento_tokens, coste_usd) values
    -- 1: chat-facturas con gpt-6.1-terra sin coste (el caso de producción).
    ('chat-facturas', 'gpt-6.1-terra', 8099, 3876, 100, 69, 0, null),
    -- 2: gpt-4.1 a NULL (registrada antes de su tarifa).
    ('extraer-vino-foto', 'gpt-4.1', 3680, 0, 0, 194, 0, null),
    -- 3: gpt-4.1 con coste ya calculado: no se toca aunque no cuadre.
    ('extraer-vino-foto', 'gpt-4.1', 1000000, 0, 0, 0, 0, 1.234567),
    -- 4: un modelo que sigue sin tarifa.
    ('otra', 'modelo-raro', 1000, 0, 0, 10, 0, null),
    -- 5: razonamiento dentro de la salida (no se suma aparte).
    ('chat-facturas', 'gpt-6.1-terra', 0, 0, 0, 1000, 800, null);
`;

const db = new PGlite();
await db.exec(ANDAMIAJE);
await db.exec(MIGRACION);
await db.exec(MIGRACION); // idempotente
comprobaciones++;

const q = async (sql) => (await db.query(sql)).rows;
const coste = async (id) => {
  const [r] = await q(`select coste_usd from public.ia_uso where id = ${id}`);
  return r.coste_usd === null ? null : Number(r.coste_usd);
};

// 1. Tarifas nuevas, sin pisar las existentes.
const modelos = (await q("select modelo from public.ia_precios order by modelo")).map((r) => r.modelo);
for (const m of ["gpt-6.1-terra", "gpt-6.1-sol", "gpt-6-astra", "gpt-6-sol", "gpt-6-luna", "gpt-5.6-sol", "gpt-5.6-terra", "gpt-5.5", "gpt-5.4-nano"]) {
  ok(modelos.includes(m), `falta la tarifa de ${m}`);
}
const [terra] = await q("select * from public.ia_precios where modelo = 'gpt-6.1-terra'");
igual([Number(terra.usd_por_m_input), Number(terra.usd_por_m_cached), Number(terra.usd_por_m_cache_write), Number(terra.usd_por_m_output)], [1, 0.05, 1.25, 5], "tarifa de gpt-6.1-terra");
ok(/developers\.openai\.com/.test(terra.fuente), "la tarifa dice de dónde sale");
const [luna] = await q("select * from public.ia_precios where modelo = 'gpt-6-luna'");
igual([Number(luna.usd_por_m_input), luna.notas], [9, "tarifa del dueño"], "pisa una tarifa que ya existía");

// 2. Recálculo con la cuenta de ia_registrar_uso.
// Fila 1: (8099 − 3876 − 100) × 1 + 3876 × 0,05 + 100 × 1,25 + 69 × 5 = 4123 + 193,8 + 125 + 345 = 4786,8 → 0,004787
igual(await coste(1), 0.004787, "coste de la pregunta de chat-facturas con gpt-6.1-terra");
// Fila 2: 3680 × 2 + 194 × 8 = 7360 + 1552 = 8912 → 0,008912
igual(await coste(2), 0.008912, "coste de la fila de gpt-4.1 que estaba a NULL");
igual(await coste(3), 1.234567, "ha cambiado un coste ya calculado (contaría dos veces)");
igual(await coste(4), null, "un modelo sin tarifa no puede salir con coste (NULL = sin datos, nunca 0)");
// Fila 5: 1000 de salida × 5 = 0,005 (el razonamiento ya va dentro).
igual(await coste(5), 0.005, "el razonamiento se ha sumado aparte");

// 3. Al dar de alta la tarifa del modelo que faltaba, sus filas se arreglan solas.
await db.exec("insert into public.ia_uso (funcion, modelo, prompt_tokens, completion_tokens) values ('otra', 'modelo-raro', 2000, 0)");
await db.exec("insert into public.ia_precios (modelo, usd_por_m_input, usd_por_m_output) values ('modelo-raro', 3, 6)");
igual(await coste(4), 0.00306, "el trigger no recalcula al dar de alta la tarifa (1000 × 3 + 10 × 6)");
igual(await coste(6), 0.006, "el trigger no recalcula todas las filas del modelo");

// 4. Corregir una tarifa solo arregla lo que estaba a NULL (no reescribe el histórico).
await db.exec("insert into public.ia_uso (funcion, modelo, prompt_tokens, completion_tokens) values ('otra', 'modelo-raro', 1000000, 0)");
const antes = await coste(7);
igual(antes, null, "una fila nueva de un modelo con tarifa no debería tocarse aquí (la calcula ia_registrar_uso)");
await db.exec("update public.ia_precios set usd_por_m_input = 4 where modelo = 'modelo-raro'");
igual(await coste(7), 4, "al corregir la tarifa, la fila a NULL no se ha recalculado");
igual(await coste(4), 0.00306, "corregir una tarifa ha reescrito un coste ya calculado");
// Cambiar solo las notas no dispara nada (y no rompe).
await db.exec("update public.ia_precios set notas = 'x' where modelo = 'modelo-raro'");
comprobaciones++;

// 5. Permisos: solo service_role puede llamar al recálculo.
await assert.rejects(
  (async () => { await db.exec("begin; set local role authenticated;"); try { await db.query("select public.ia_retarifar_sin_coste(null)"); } finally { await db.exec("rollback"); } })(),
  /permission denied/,
  "un usuario del panel puede lanzar el recálculo",
);
comprobaciones++;
await db.exec("begin; set local role service_role;");
const [{ n }] = (await db.query("select public.ia_retarifar_sin_coste(null) as n")).rows;
await db.exec("commit");
igual(n, 0, "con todo calculado, el recálculo no debería tocar nada");

// 6. Rollback: fuera trigger y funciones; tarifas y costes se quedan.
await db.exec(ROLLBACK);
await db.exec(ROLLBACK); // repetible
const [{ fns }] = await q("select count(*)::int fns from pg_proc where proname in ('ia_retarifar_sin_coste', 'ia_precios_retarifar')");
igual(fns, 0, "el rollback deja las funciones");
const [{ trg }] = await q("select count(*)::int trg from pg_trigger where tgname = 'ia_precios_retarifar'");
igual(trg, 0, "el rollback deja el trigger");
igual(await coste(1), 0.004787, "el rollback ha borrado un coste recalculado");
ok((await q("select 1 from public.ia_precios where modelo = 'gpt-6.1-terra'")).length === 1, "el rollback ha borrado una tarifa");

console.log(`ia_tarifas_sin_coste: OK (${comprobaciones} comprobaciones)`);
