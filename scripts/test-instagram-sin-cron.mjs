// Instagram antiguo sin tareas automáticas (migración 20261219100000) contra un
// Postgres en memoria (PGlite) con un pg_cron de mentira. Nunca toca Supabase.
//
//   npm run test:instagram-sin-cron:db
//
// Cubre: quita las tres tareas del Instagram antiguo y no toca las demás; se puede
// aplicar dos veces; sin pg_cron no falla; la vuelta atrás las deja con la MISMA
// llamada que tenían en sus migraciones originales.
import { PGlite } from "@electric-sql/pglite";
import { readFile } from "node:fs/promises";
import assert from "node:assert/strict";

const MIGRACION = await readFile("supabase/migrations/20261219100000_instagram_antiguo_sin_cron.sql", "utf8");
const ROLLBACK = await readFile("supabase/rollbacks/20261219100000_instagram_antiguo_sin_cron_ROLLBACK.sql", "utf8");
const ORIGINALES = {
  "instagram-programador": "supabase/migrations/20261109100000_instagram_video.sql",
  "instagram-metricas-diarias": "supabase/migrations/20261106100000_instagram_metricas.sql",
  "instagram-limpieza-bucket": "supabase/migrations/20261107010000_instagram_limpieza_bucket.sql",
};
const TAREAS = Object.keys(ORIGINALES);

/** La llamada ($cron$ … $cron$) con la que una migración programa esa tarea (la última, si hay varias). */
function llamadaOriginal(sql, tarea) {
  const re = new RegExp(`cron\\.schedule\\(\\s*'${tarea}'[\\s\\S]*?\\$cron\\$([\\s\\S]*?)\\$cron\\$`, "g");
  const todas = [...sql.matchAll(re)].map((m) => m[1].trim());
  assert.ok(todas.length > 0, `no encuentro la tarea ${tarea}`);
  return todas.at(-1);
}

let comprobaciones = 0;
const ok = (v, msg) => { assert.ok(v, msg); comprobaciones++; };
const igual = (a, b, msg) => { assert.deepEqual(a, b, msg); comprobaciones++; };

// Sin pg_cron: no falla.
{
  const db = new PGlite();
  await db.exec(MIGRACION);
  await db.exec(ROLLBACK);
  ok(true, "sin pg_cron se aplica sin error");
  await db.close();
}

const db = new PGlite();
await db.exec(`
  create schema cron;
  create table cron.job (jobid bigserial primary key, jobname text unique, schedule text, command text);
  create function cron.schedule(p_name text, p_schedule text, p_command text) returns bigint language sql as $$
    insert into cron.job (jobname, schedule, command) values (p_name, p_schedule, p_command)
    on conflict (jobname) do update set schedule = excluded.schedule, command = excluded.command
    returning jobid $$;
  create function cron.unschedule(p_jobid bigint) returns boolean language sql as $$
    delete from cron.job where jobid = p_jobid returning true $$;
  insert into cron.job (jobname, schedule, command) values
    ('instagram-programador', '*/5 * * * *', 'x'),
    ('instagram-metricas-diarias', '0 5 * * *', 'x'),
    ('instagram-limpieza-bucket', '30 3 * * *', 'x'),
    ('reservas-aviso-sin-asignar', '*/15 * * * *', 'y');
`);
const tareas = async () => (await db.query("select jobname from cron.job order by 1")).rows.map((r) => r.jobname);

await db.exec(MIGRACION);
igual(await tareas(), ["reservas-aviso-sin-asignar"], "quita las tres del Instagram antiguo y deja las demás");
await db.exec(MIGRACION);
igual(await tareas(), ["reservas-aviso-sin-asignar"], "aplicarla dos veces no rompe nada");

await db.exec(ROLLBACK);
igual(await tareas(), [...TAREAS, "reservas-aviso-sin-asignar"].sort(), "la vuelta atrás las programa otra vez");
for (const tarea of TAREAS) {
  const { rows } = await db.query("select command from cron.job where jobname = $1", [tarea]);
  const original = llamadaOriginal(await readFile(ORIGINALES[tarea], "utf8"), tarea);
  const sinRetornos = (t) => t.replaceAll("\r", "").trim();
  igual(sinRetornos(rows[0].command), sinRetornos(original), `${tarea}: la misma llamada que en su migración original`);
}
await db.exec(ROLLBACK);
igual((await tareas()).length, 4, "la vuelta atrás dos veces no duplica");

await db.close();
console.log(`instagram_antiguo_sin_cron: ${comprobaciones} comprobaciones en verde`);
