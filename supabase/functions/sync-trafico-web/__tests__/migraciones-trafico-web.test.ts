/**
 * Migraciones 20261101093700_trafico_web_datos_desde y
 * 20261101093800_trafico_web_cron_url_desde_vault (y sus rollbacks) contra un
 * Postgres en memoria (PGlite). Nunca toca Supabase.
 *
 * vault, cron y net son dobles mínimos con la misma forma que en Supabase
 * (vault.decrypted_secrets, cron.schedule/unschedule, net.http_post con
 * argumentos con nombre). La tabla trafico_web_sync_estado se crea con el
 * CREATE TABLE real de 20260923200000_trafico_web.sql.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

const raiz = process.cwd();
const leer = (rel: string) => readFileSync(path.resolve(raiz, rel), "utf8");

const MIG_DATOS_DESDE = leer("supabase/migrations/20261101093700_trafico_web_datos_desde.sql");
const MIG_CRON = leer("supabase/migrations/20261101093800_trafico_web_cron_url_desde_vault.sql");
const RB_DATOS_DESDE = leer("supabase/rollbacks/20261101093700_trafico_web_datos_desde_ROLLBACK.sql");
const RB_CRON = leer("supabase/rollbacks/20261101093800_trafico_web_cron_url_desde_vault_ROLLBACK.sql");

const TABLA_ESTADO = (() => {
  const original = leer("supabase/migrations/20260923200000_trafico_web.sql");
  const m = /create table if not exists public\.trafico_web_sync_estado \([\s\S]*?\n\);/.exec(original);
  if (!m) throw new Error("No se encontró el CREATE TABLE de trafico_web_sync_estado en 20260923200000_trafico_web.sql");
  return m[0];
})();

const DOBLES = `
create schema vault;
create table vault.secrets (id uuid primary key default gen_random_uuid(), name text unique not null, secret text not null);
create view vault.decrypted_secrets as select id, name, secret as decrypted_secret from vault.secrets;

create schema cron;
create table cron.job (jobid serial primary key, jobname text unique not null, schedule text not null, command text not null, active boolean not null default true);
create function cron.schedule(job_name text, schedule text, command text) returns bigint language sql as $f$
  insert into cron.job (jobname, schedule, command) values (job_name, schedule, command)
  on conflict (jobname) do update set schedule = excluded.schedule, command = excluded.command
  returning jobid::bigint
$f$;
create function cron.unschedule(job_name text) returns boolean language sql as $f$
  delete from cron.job where jobname = job_name returning true
$f$;

create schema net;
create table net.llamadas (url text, headers jsonb, body jsonb, timeout_milliseconds int);
create function net.http_post(url text, body jsonb default '{}'::jsonb, params jsonb default '{}'::jsonb,
                              headers jsonb default '{}'::jsonb, timeout_milliseconds int default 5000)
returns bigint language sql as $f$
  insert into net.llamadas values (url, headers, body, timeout_milliseconds);
  select 1::bigint
$f$;
`;

const URL_DEMO = "https://sfonaclosuafvlhutkon.supabase.co";

// Una sola instancia (arrancar PGlite cuesta segundos, más con la suite
// completa en paralelo); cada test parte de cero. Márgenes amplios por eso.
const MARGEN_MS = 120_000;
let db: PGlite;
beforeAll(async () => {
  db = new PGlite();
  await db.waitReady;
}, MARGEN_MS);
afterAll(async () => {
  await db?.close();
});
beforeEach(async () => {
  await db.exec("rollback").catch(() => {});
  await db.exec(`
    drop schema if exists vault cascade;
    drop schema if exists cron cascade;
    drop schema if exists net cascade;
    drop table if exists public.trafico_web_sync_estado;
  `);
  await db.exec(DOBLES);
  await db.exec(TABLA_ESTADO);
}, MARGEN_MS);

async function filas<T>(db: PGlite, sql: string): Promise<T[]> {
  return (await db.query<T>(sql)).rows;
}

/** Ejecuta el comando del job como lo haría pg_cron. */
async function ejecutarJob(db: PGlite) {
  const [job] = await filas<{ command: string }>(db, "select command from cron.job where jobname = 'sync-trafico-web'");
  await db.exec(job.command);
  return filas<{ url: string; secreto: string; timeout_milliseconds: number }>(
    db,
    "select url, headers->>'x-webhook-secret' as secreto, timeout_milliseconds from net.llamadas",
  );
}

describe("20261101093700_trafico_web_datos_desde", { timeout: MARGEN_MS }, () => {
  beforeEach(async () => {
    // Como PROD (Web Analytics apagado y fallos que siguen tras el 01-11) y DEMO (sin intentos desde el corte).
    await db.exec(`
      insert into public.trafico_web_sync_estado (proyecto, ultimo_ok_en, ultimo_intento_en, ultimo_error, fallos_consecutivos, dias_ultimo_sync) values
        ('casa-tomas-story', '2026-10-27 03:30:03+00', '2026-11-03 03:30:03+00',
         'Vercel 400 (by=day): Web Analytics is not enabled for this project', 7, 3),
        ('touza-restaurant-website', '2026-10-27 03:30:04+00', '2026-10-27 03:30:01+00', null, 0, 3);
    `);
  }, MARGEN_MS);

  it("añade la columna y siembra el suelo: 01-11 o el día del último fallo por Web Analytics, el mayor", async () => {
    await db.exec(MIG_DATOS_DESDE);
    expect(await filas(db, "select proyecto, datos_desde::text from public.trafico_web_sync_estado order by proyecto")).toEqual([
      { proyecto: "casa-tomas-story", datos_desde: "2026-11-03" },
      { proyecto: "touza-restaurant-website", datos_desde: "2026-11-01" },
    ]);
  });

  it("es idempotente y nunca baja un valor ya puesto", async () => {
    await db.exec(MIG_DATOS_DESDE);
    await db.exec("update public.trafico_web_sync_estado set datos_desde = '2026-11-20' where proyecto = 'touza-restaurant-website'");
    await db.exec(MIG_DATOS_DESDE);
    expect(await filas(db, "select datos_desde::text from public.trafico_web_sync_estado where proyecto = 'touza-restaurant-website'")).toEqual([
      { datos_desde: "2026-11-20" },
    ]);
  });

  it("el rollback quita la columna", async () => {
    await db.exec(MIG_DATOS_DESDE);
    await db.exec(RB_DATOS_DESDE);
    expect(
      await filas(db, "select column_name from information_schema.columns where table_name = 'trafico_web_sync_estado' and column_name = 'datos_desde'"),
    ).toEqual([]);
  });
});

describe("20261101093800_trafico_web_cron_url_desde_vault", { timeout: MARGEN_MS }, () => {
  it("DEMO (sin job, con project_url y secreto): crea el job a las 03:30 y llama a la función de ESE proyecto", async () => {
    await db.exec(`insert into vault.secrets (name, secret) values ('project_url', '${URL_DEMO}/'), ('trafico_web_cron_secret', 'secreto-de-prueba')`);
    await db.exec(MIG_CRON);
    expect(await filas(db, "select jobname, schedule, active from cron.job")).toEqual([
      { jobname: "sync-trafico-web", schedule: "30 3 * * *", active: true },
    ]);
    const [job] = await filas<{ command: string }>(db, "select command from cron.job");
    expect(job.command).not.toMatch(/jeamoczmbfsnwkfjxcyo|haqmmdfdzzatdnrrcgez|sfonaclosuafvlhutkon/);
    expect(await ejecutarJob(db)).toEqual([
      { url: `${URL_DEMO}/functions/v1/sync-trafico-web`, secreto: "secreto-de-prueba", timeout_milliseconds: 55000 },
    ]);
  });

  it("PROD (job con URL fija del kit): lo sustituye y no deja dos", async () => {
    await db.exec(`insert into vault.secrets (name, secret) values ('project_url', 'https://haqmmdfdzzatdnrrcgez.supabase.co'), ('trafico_web_cron_secret', 's')`);
    await db.exec("select cron.schedule('sync-trafico-web', '30 3 * * *', 'select 1')");
    await db.exec(MIG_CRON);
    await db.exec(MIG_CRON); // idempotente
    expect(await filas(db, "select count(*)::int as n from cron.job where jobname = 'sync-trafico-web'")).toEqual([{ n: 1 }]);
    expect((await ejecutarJob(db))[0].url).toBe("https://haqmmdfdzzatdnrrcgez.supabase.co/functions/v1/sync-trafico-web");
  });

  it("sin project_url en Vault (PROD hoy) falla y deja el job como estaba", async () => {
    await db.exec(`insert into vault.secrets (name, secret) values ('trafico_web_cron_secret', 's')`);
    await db.exec("select cron.schedule('sync-trafico-web', '30 3 * * *', 'select ''job del kit''')");
    await expect(db.exec(MIG_CRON)).rejects.toThrow(/project_url/);
    await db.exec("rollback").catch(() => {});
    expect(await filas(db, "select command from cron.job where jobname = 'sync-trafico-web'")).toEqual([{ command: "select 'job del kit'" }]);
  });

  it("sin el secreto del cron falla sin crear nada", async () => {
    await db.exec(`insert into vault.secrets (name, secret) values ('project_url', '${URL_DEMO}')`);
    await expect(db.exec(MIG_CRON)).rejects.toThrow(/trafico_web_cron_secret/);
    await db.exec("rollback").catch(() => {});
    expect(await filas(db, "select * from cron.job")).toEqual([]);
  });

  it("project_url con otra forma se rechaza", async () => {
    await db.exec(`insert into vault.secrets (name, secret) values ('project_url', 'http://localhost:54321'), ('trafico_web_cron_secret', 's')`);
    await expect(db.exec(MIG_CRON)).rejects.toThrow(/no tiene la forma/);
  });

  it("si luego se borra un secreto, el job no llama a nadie", async () => {
    await db.exec(`insert into vault.secrets (name, secret) values ('project_url', '${URL_DEMO}'), ('trafico_web_cron_secret', 's')`);
    await db.exec(MIG_CRON);
    await db.exec("delete from vault.secrets where name = 'trafico_web_cron_secret'");
    expect(await ejecutarJob(db)).toEqual([]);
  });

  it("el rollback vuelve al job con la URL escrita en el comando (forma del kit)", async () => {
    await db.exec(`insert into vault.secrets (name, secret) values ('project_url', '${URL_DEMO}'), ('trafico_web_cron_secret', 's')`);
    await db.exec(MIG_CRON);
    await db.exec(RB_CRON);
    const [job] = await filas<{ command: string; schedule: string }>(db, "select command, schedule from cron.job where jobname = 'sync-trafico-web'");
    expect(job.schedule).toBe("30 3 * * *");
    expect(job.command).toContain(`'${URL_DEMO}/functions/v1/sync-trafico-web'`);
    expect((await ejecutarJob(db))[0].url).toBe(`${URL_DEMO}/functions/v1/sync-trafico-web`);
  });
});
