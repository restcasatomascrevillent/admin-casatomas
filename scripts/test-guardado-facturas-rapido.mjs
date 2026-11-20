// Prueba la migración 20261213010000_guardado_facturas_rapido y su rollback contra un Postgres
// en memoria (PGlite). Nunca toca Supabase.
//
//   node scripts/test-guardado-facturas-rapido.mjs
//
// Cubre: reanudar_trabajos_ocr conserva sus pasos 1-4 y sale sin hacer nada si no hay trabajo;
// el paso 5 reanuda SOLO los fallidos por corte de tiempo de la base con todas las páginas leídas
// (tope 2 veces, espera de 3 minutos, ficheros presentes); los crons se escalonan sin cambiar su
// comando; reaplicar da lo mismo y el rollback lo deja como estaba.
import { PGlite } from "@electric-sql/pglite";
import { readFile } from "node:fs/promises";
import assert from "node:assert/strict";

const MIGRACION = await readFile("supabase/migrations/20261213010000_guardado_facturas_rapido.sql", "utf8");
const ROLLBACK = await readFile("supabase/rollbacks/20261213010000_guardado_facturas_rapido_ROLLBACK.sql", "utf8");

let comprobaciones = 0;
const igual = (a, b, msg) => { assert.deepEqual(a, b, msg); comprobaciones++; };

const db = new PGlite();
await db.exec(`
  create role anon nologin; create role authenticated nologin; create role service_role nologin;
  create schema storage;
  create table storage.objects (bucket_id text, name text);
  create schema cron;
  create table cron.job (jobid serial primary key, jobname text, schedule text, command text);
  create function cron.alter_job(p_id int, schedule text default null) returns void language sql as
    $$ update cron.job set schedule = coalesce(alter_job.schedule, job.schedule) where jobid = p_id $$;

  create table public.ocr_trabajos (
    id uuid primary key, estado text not null, error text, terminado_at timestamptz, lease_hasta timestamptz,
    limite_at timestamptz, updated_at timestamptz default now(), consolidar_despachado_at timestamptz,
    intentos_consolidacion int not null default 0, resultado jsonb, original_path text, factura_id bigint);
  create table public.ocr_trabajo_paginas (
    id serial primary key, trabajo_id uuid not null references public.ocr_trabajos(id), numero int not null,
    estado text not null, intentos int default 0, error text, lease_hasta timestamptz, despachada_at timestamptz,
    no_antes_de timestamptz, storage_path text);
  create table public.llamadas (que text, id text);
  create table public.peticiones (
    id serial primary key, titulo text, estado text not null default 'nueva', origen text, clave_origen text unique,
    descripcion text not null default 'REVISIÓN AUTOMÁTICA. El OCR no ha podido leer este archivo.');
  create table public.productos_factura (
    id serial primary key, factura_id bigint not null, nombre text not null, cantidad numeric, unidad text,
    precio_unitario numeric, total numeric, pagina int not null default 1, orden int, bultos numeric,
    importe_bruto_estimado boolean not null default false);
  create function public.ocr_despachar(p uuid) returns integer language plpgsql as
    $$ begin insert into public.llamadas values ('despachar', p::text); return 1; end $$;
  create function public.ocr_fallo_pagina(p int, e text) returns void language plpgsql as
    $$ begin insert into public.llamadas values ('fallo_pagina', p::text); end $$;

  insert into cron.job (jobname, schedule, command) values
    ('avisos-telegram-fallos', '*/5 * * * *', 'select 1'), ('avisos-telegram-pendientes', '*/5 * * * *', 'select 2'),
    ('clasificar-productos', '*/5 * * * *', 'select 3'), ('reservas-web-keep-warm', '*/5 * * * *', 'select 4'),
    ('instagram-programador', '*/5 * * * *', 'select 5'), ('procesar-logs-web', '*/5 * * * *', 'select 6'),
    ('facturas-originales-drive', '*/10 * * * *', 'select 7'), ('embeddings-nombres', '*/10 * * * *', 'select 8'),
    ('emails-reserva-reintentar-fallidos', '*/15 * * * *', 'select 9'), ('avisos-telegram-vigilante', '*/15 * * * *', 'select 10'),
    ('ia-modelos-openai', '15 6 * * *', 'select 11'), ('reanudar-trabajos-ocr', '* * * * *', 'select 12');
`);

// reanudar_trabajos_ocr ANTES (producción, 20/11/2026): el rollback la restaura; se usa para comparar.
await db.exec(ROLLBACK); // sin la migración aplicada no hace nada de lo demás, pero deja la versión «antigua»
const ANTIGUA = (await db.query(`select pg_get_functiondef('public.reanudar_trabajos_ocr'::regproc) d`)).rows[0].d;
await db.exec(MIGRACION);
await db.exec(MIGRACION); // reaplicable

const T = {
  parado: "00000000-0000-0000-0000-000000000001", // fallido por timeout, páginas leídas, hace 10 min → se reanuda
  reciente: "00000000-0000-0000-0000-000000000002", // fallido hace 1 min → todavía no
  otroError: "00000000-0000-0000-0000-000000000003", // fallido por OpenAI → no
  sinLeer: "00000000-0000-0000-0000-000000000004", // fallido por timeout con una página sin leer → no
  agotado: "00000000-0000-0000-0000-000000000005", // ya reanudado 2 veces → no
  sinFichero: "00000000-0000-0000-0000-000000000006", // el fichero ya no está → no
  viejo: "00000000-0000-0000-0000-000000000007", // fallido hace 5 horas → no
  lock: "00000000-0000-0000-0000-000000000008", // lock timeout, página 1 sin completar? no: todas completadas
};
const reiniciar = async () => {
  await db.exec(`delete from public.llamadas; delete from public.ocr_trabajo_paginas; delete from public.ocr_trabajos; delete from storage.objects;`);
};
const trabajo = async (id, estado, extra = {}) => {
  const c = { error: null, terminado: "now()", reint: 0, ...extra };
  await db.query(
    `insert into public.ocr_trabajos (id, estado, error, terminado_at, limite_at, reintentos_auto)
     values ($1, $2, $3, ${c.terminado}, now() + interval '15 minutes', $4)`,
    [id, estado, c.error, c.reint],
  );
};
const pagina = (id, numero, estado, ruta) =>
  db.query(`insert into public.ocr_trabajo_paginas (trabajo_id, numero, estado, storage_path) values ($1, $2, $3, $4)`, [id, numero, estado, ruta]);
const fichero = (ruta) => db.query(`insert into storage.objects values ('facturas-originales', $1)`, [ruta]);
const estado = async (id) => (await db.query(`select estado, error, reintentos_auto from public.ocr_trabajos where id = $1`, [id])).rows[0];
const llamadas = async () => (await db.query(`select que, id from public.llamadas order by que, id`)).rows;

const TIMEOUT = "Fallo al guardar (se reintenta): insert productos: canceling statement due to statement timeout";

// --- 1. Sin nada en marcha ni fallidos: sale al instante ---
await reiniciar();
igual((await db.query(`select public.reanudar_trabajos_ocr() n`)).rows[0].n, 0, "sin nada: devuelve 0");
igual(await llamadas(), [], "sin nada: no llama a nada");

// --- 2. Pasos 1-4 intactos (con trabajo en marcha) ---
await reiniciar();
await trabajo(T.parado, "consolidando", { terminado: "null" });
await db.query(`update public.ocr_trabajos set lease_hasta = now() - interval '1 minute', intentos_consolidacion = 1 where id = $1`, [T.parado]);
await db.query(`select public.reanudar_trabajos_ocr()`);
igual((await estado(T.parado)).estado, "paginas", "paso 3: lease caducado con <3 intentos vuelve a «paginas»");
await db.query(`update public.ocr_trabajos set estado = 'consolidando', lease_hasta = now() - interval '1 minute', intentos_consolidacion = 3 where id = $1`, [T.parado]);
await db.query(`select public.reanudar_trabajos_ocr()`);
igual((await estado(T.parado)).estado, "fallido", "paso 3: 3 intentos → fallido");
igual((await estado(T.parado)).error, "la consolidación falló 3 veces", "paso 3: mensaje de siempre");

await reiniciar();
await trabajo(T.parado, "paginas", { terminado: "null" });
await db.query(`update public.ocr_trabajos set limite_at = now() - interval '1 minute' where id = $1`, [T.parado]);
await db.query(`select public.reanudar_trabajos_ocr()`);
igual((await estado(T.parado)).error, "tiempo agotado (15 min) sin terminar", "paso 2: pasa del límite → fallido");

await reiniciar();
await trabajo(T.parado, "paginas", { terminado: "null" });
await db.query(`update public.ocr_trabajos set updated_at = now() - interval '2 minutes' where id = $1`, [T.parado]);
await pagina(T.parado, 1, "completada", "a.jpg");
await db.query(`select public.reanudar_trabajos_ocr()`);
igual(await llamadas(), [{ que: "despachar", id: T.parado }], "paso 4: un trabajo activo parado se vuelve a despachar");

await reiniciar();
await trabajo(T.parado, "paginas", { terminado: "null" });
await pagina(T.parado, 1, "procesando", "a.jpg");
await db.query(`update public.ocr_trabajo_paginas set lease_hasta = now() - interval '1 minute'`);
await db.query(`select public.reanudar_trabajos_ocr()`);
igual((await llamadas()).map((l) => l.que), ["fallo_pagina"], "paso 1: pieza con lease caducado → ocr_fallo_pagina");

// --- 3. Paso 5: reanudar solo los fallidos por corte de tiempo ---
await reiniciar();
const ahora = (min) => `now() - interval '${min} minutes'`;
await trabajo(T.parado, "fallido", { error: TIMEOUT, terminado: ahora(10) });
await trabajo(T.reciente, "fallido", { error: TIMEOUT, terminado: ahora(1) });
await trabajo(T.otroError, "fallido", { error: "OpenAI: 429 sin crédito", terminado: ahora(10) });
await trabajo(T.sinLeer, "fallido", { error: TIMEOUT, terminado: ahora(10) });
await trabajo(T.agotado, "fallido", { error: TIMEOUT, terminado: ahora(10), reint: 2 });
await trabajo(T.sinFichero, "fallido", { error: TIMEOUT, terminado: ahora(10) });
await trabajo(T.viejo, "fallido", { error: TIMEOUT, terminado: ahora(300) });
await trabajo(T.lock, "fallido", { error: "insert factura: lock timeout", terminado: ahora(4) });
for (const id of [T.parado, T.reciente, T.otroError, T.agotado, T.viejo, T.lock]) {
  await pagina(id, 1, "completada", `${id}.jpg`);
  await fichero(`${id}.jpg`);
}
await pagina(T.sinLeer, 1, "completada", "sl1.jpg"); await fichero("sl1.jpg");
await pagina(T.sinLeer, 2, "fallida", "sl2.jpg"); await fichero("sl2.jpg");
await pagina(T.sinFichero, 1, "completada", "no-existe.jpg");

const n = (await db.query(`select public.reanudar_trabajos_ocr() n`)).rows[0].n;
igual(n, 2, "reanuda exactamente 2 (el parado y el de lock timeout; cada uno llama a ocr_despachar una vez)");
igual((await estado(T.parado)).estado, "paginas", "el parado vuelve a «paginas» (todas sus páginas están leídas)");
igual((await estado(T.parado)).reintentos_auto, 1, "cuenta el reintento automático");
igual((await estado(T.parado)).error, null, "limpia el error");
igual((await estado(T.lock)).estado, "paginas", "«lock timeout» también");
for (const id of [T.reciente, T.otroError, T.sinLeer, T.agotado, T.sinFichero, T.viejo]) {
  igual((await estado(id)).estado, "fallido", `no se toca ${id}`);
}
igual((await llamadas()).map((l) => l.id).sort(), [T.parado, T.lock].sort(), "ocr_despachar solo de los reanudados");
igual((await db.query(`select estado from public.ocr_trabajo_paginas where trabajo_id = $1`, [T.sinLeer])).rows.map((r) => r.estado).sort(), ["completada", "fallida"], "no toca las páginas del que no se puede reanudar");

// Dos veces como máximo: el que acaba de reanudarse y vuelve a fallar se reanuda otra vez; a la tercera, no.
for (const vez of [2, 3]) {
  await db.query(`update public.ocr_trabajos set estado = 'fallido', error = $2, terminado_at = now() - interval '10 minutes' where id = $1`, [T.parado, TIMEOUT]);
  await db.query(`select public.reanudar_trabajos_ocr()`);
  igual((await estado(T.parado)).estado, vez === 2 ? "paginas" : "fallido", `intento automático ${vez}`);
}
igual((await estado(T.parado)).reintentos_auto, 2, "máximo 2 reintentos automáticos");

// Las funciones internas no se pueden llamar desde la API.
const permisos = (await db.query(`
  select p.proname, has_function_privilege('public', p.oid, 'execute') as publico
    from pg_proc p where p.proname in ('ocr_reanudar_fallido_interno', 'ocr_reanudar_fallidos_transitorios') order by 1`)).rows;
igual(permisos.map((p) => p.publico), [false, false], "sin EXECUTE para PUBLIC");


// --- 3b. Candidata sin ficheros: no ocupa hueco del limit 3 ---
await reiniciar();
const sinFich = ["a1", "a2", "a3"].map((x) => `00000000-0000-0000-0000-0000000000${x}`);
for (const [i, id] of sinFich.entries()) {
  await trabajo(id, "fallido", { error: TIMEOUT, terminado: ahora(30 - i) }); // más antiguos: irían primero
  await pagina(id, 1, "completada", `${id}.jpg`); // sin fichero en Storage
}
await trabajo(T.parado, "fallido", { error: TIMEOUT, terminado: ahora(10) });
await pagina(T.parado, 1, "completada", `${T.parado}.jpg`); await fichero(`${T.parado}.jpg`);
igual((await db.query(`select public.reanudar_trabajos_ocr() n`)).rows[0].n, 1, "3 candidatas sin ficheros no impiden reanudar la cuarta");
igual((await estado(T.parado)).estado, "paginas", "la que sí tiene ficheros se reanuda");
for (const id of sinFich) igual((await estado(id)).reintentos_auto, 0, "la que no tiene ficheros no gasta intento (ni se selecciona)");
igual((await db.query(`select public.ocr_trabajo_ficheros_presentes($1) ok`, [sinFich[0]])).rows[0].ok, false, "helper: sin ficheros");

// --- 3c. El ticket «Lectura fallida» se cierra solo ---
await reiniciar();
await db.exec(`delete from public.peticiones`);
const ticket = (clave, origen, est = "nueva") =>
  db.query(`insert into public.peticiones (titulo, estado, origen, clave_origen) values ($1, $4, $2, $3)`, ["Lectura fallida: x", origen, clave, est]);
const peticion = async (clave) => (await db.query(`select estado, descripcion from public.peticiones where clave_origen = $1`, [clave])).rows[0];
await trabajo(T.parado, "fallido", { error: TIMEOUT, terminado: ahora(10) });
await pagina(T.parado, 1, "completada", `${T.parado}.jpg`); await fichero(`${T.parado}.jpg`);
await trabajo(T.reciente, "fallido", { error: "otro", terminado: ahora(1) });
await trabajo(T.otroError, "fallido", { error: "otro", terminado: ahora(1) });
await trabajo(T.sinLeer, "fallido", { error: "otro", terminado: ahora(1) });
await ticket(`ocr:${T.parado}`, "ocr");
await ticket(`ocr:${T.reciente}`, "ocr"); // otro trabajo: no se cierra
await ticket(`doc:77`, "doc"); // otro tipo: no se cierra
await ticket(`ocr:${T.otroError}`, "ocr", "aceptada"); // ya aceptado a mano: se respeta
await db.query(`select public.reanudar_trabajos_ocr()`);
igual((await peticion(`ocr:${T.parado}`)).estado, "nueva", "reanudado pero aún sin terminar: el ticket sigue abierto");
await db.query(`update public.ocr_trabajos set estado = 'completado', factura_id = 5177 where id = $1`, [T.parado]);
const cerrado = await peticion(`ocr:${T.parado}`);
igual(cerrado.estado, "hecha", "el trabajo acaba bien: ticket «hecha»");
assert.match(cerrado.descripcion, /Resuelto solo: se reintentó y se guardó la factura 5177\./); comprobaciones++;
assert.match(cerrado.descripcion, /^REVISIÓN AUTOMÁTICA/); comprobaciones++;
igual((await peticion(`ocr:${T.reciente}`)).estado, "nueva", "no cierra el ticket de otro trabajo");
igual((await peticion(`doc:77`)).estado, "nueva", "no cierra tickets de otro tipo");
await db.query(`update public.ocr_trabajos set estado = 'completado', factura_id = 9 where id = $1`, [T.otroError]);
igual((await peticion(`ocr:${T.otroError}`)).estado, "aceptada", "un ticket ya aceptado no se toca");
await ticket(`ocr:${T.sinLeer}`, "ocr");
await db.query(`update public.ocr_trabajos set estado = 'duplicado', factura_id = 12 where id = $1`, [T.sinLeer]);
assert.match((await peticion(`ocr:${T.sinLeer}`)).descripcion, /el documento ya existía \(factura 12\)\./); comprobaciones++;
// Ticket muy largo: la nota cabe (descripcion ≤ 4000 en producción).
await db.query(`update public.peticiones set descripcion = repeat('x', 4000) where clave_origen = $1`, [`ocr:${T.reciente}`]);
await db.query(`update public.ocr_trabajos set estado = 'completado', factura_id = 1 where id = $1`, [T.reciente]);
igual((await peticion(`ocr:${T.reciente}`)).descripcion.length <= 4000, true, "la nota no pasa de 4000 caracteres");

// --- 3a. Líneas: idempotentes y con exclusión por factura ---
const LIN = (n) => JSON.stringify(Array.from({ length: n }, (_, i) => ({ nombre: `p${i}`, cantidad: 1, unidad: "kg", precio_unitario: 2, total: 2, pagina: 1, orden: i })));
const lineas = async (f) => (await db.query(`select count(*)::int n, coalesce(sum(total), 0)::int t from public.productos_factura where factura_id = $1`, [f])).rows[0];
await db.exec(`delete from public.productos_factura`);
igual((await db.query(`select public.facturas_insertar_lineas(100, $1::jsonb) n`, [LIN(5)])).rows[0].n, 5, "primera inserción: 5 líneas");
igual((await db.query(`select public.facturas_insertar_lineas(100, $1::jsonb) n`, [LIN(5)])).rows[0].n, 0, "la segunda (otro proceso/reintento) no inserta nada");
igual(await lineas(100), { n: 5, t: 10 }, "N líneas, nunca 2N");
igual((await db.query(`select importe_bruto_estimado from public.productos_factura where factura_id = 100 limit 1`)).rows[0].importe_bruto_estimado, false, "el DEFAULT de las columnas no enviadas se conserva");
// «Dos procesos a la vez»: PGlite es una sola conexión, así que se comprueba el mecanismo. Dentro de la
// transacción del primero el bloqueo por factura está tomado (en Postgres real el segundo espera ahí y,
// al soltarse, ve las líneas y devuelve 0; probado con dos conexiones en la demo).
const durante = await db.transaction(async (tx) => {
  const a = (await tx.query(`select public.facturas_insertar_lineas(200, $1::jsonb) n`, [LIN(4)])).rows[0].n;
  const blq = (await tx.query(`select count(*)::int n from pg_locks where locktype = 'advisory' and granted`)).rows[0].n;
  const otra = (await tx.query(`select public.facturas_insertar_lineas(200, $1::jsonb) n`, [LIN(4)])).rows[0].n;
  return { a, blq, otra };
});
igual(durante, { a: 4, blq: 1, otra: 0 }, "el primero toma el bloqueo por factura; el segundo ve las líneas y no inserta");
igual((await db.query(`select count(*)::int n from pg_locks where locktype = 'advisory'`)).rows[0].n, 0, "el bloqueo se suelta al terminar la transacción");
igual(await lineas(200), { n: 4, t: 8 }, "4 líneas, nunca 8");
const rs = await Promise.all(Array.from({ length: 6 }, () => db.query(`select public.facturas_insertar_lineas(300, $1::jsonb) n`, [LIN(7)])));
igual(rs.map((r) => r.rows[0].n).sort((x, y) => y - x), [7, 0, 0, 0, 0, 0], "6 llamadas simultáneas: una inserta 7, las demás 0");
igual((await lineas(300)).n, 7, "7 líneas, no 42");
await db.query(`select public.facturas_insertar_lineas(400, $1::jsonb)`, [JSON.stringify([{ nombre: "a", total: 1, bultos: 3 }, { nombre: "b", total: 2, bultos: null }])]);
igual((await db.query(`select bultos::int b from public.productos_factura where factura_id = 400 order by id`)).rows.map((r) => r.b), [3, null], "bultos y claves ausentes");
await assert.rejects(db.query(`select public.facturas_insertar_lineas(500, $1::jsonb)`, [JSON.stringify([{ nombre: "a", iva_pct: 10 }])]), /column "iva_pct" of relation "productos_factura" does not exist/); comprobaciones++;
igual((await lineas(500)).n, 0, "una columna que falta por migrar da el error de siempre y no deja nada");
igual((await db.query(`select public.facturas_insertar_lineas(600, '[]'::jsonb) n`)).rows[0].n, 0, "sin líneas: 0");
const permLin = (await db.query(`select has_function_privilege('public', 'public.facturas_insertar_lineas(bigint, jsonb)', 'execute') p, has_function_privilege('anon', 'public.facturas_insertar_lineas(bigint, jsonb)', 'execute') a,
  has_function_privilege('authenticated', 'public.facturas_insertar_lineas(bigint, jsonb)', 'execute') u, has_function_privilege('service_role', 'public.facturas_insertar_lineas(bigint, jsonb)', 'execute') s`)).rows[0];
igual(permLin, { p: false, a: false, u: false, s: true }, "solo service_role ejecuta la RPC");
igual((await db.query(`select proconfig from pg_proc where proname = 'facturas_insertar_lineas'`)).rows[0].proconfig.includes("lock_timeout=5s"), true, "lock_timeout propio de la función (no toca los de los roles)");

// --- 4. Crons ---
const horarios = async () => Object.fromEntries((await db.query(`select jobname, schedule from cron.job`)).rows.map((r) => [r.jobname, r.schedule]));
const h = await horarios();
igual(h["avisos-telegram-fallos"], "0-59/5 * * * *");
igual(h["avisos-telegram-pendientes"], "1-59/5 * * * *");
igual(h["facturas-originales-drive"], "6,16,26,36,46,56 * * * *");
igual(h["embeddings-nombres"], "9,19,29,39,49,59 * * * *");
igual(h["reanudar-trabajos-ocr"], "* * * * *", "el de cada minuto no cambia");
const comandos = (await db.query(`select jobname, command from cron.job order by jobid`)).rows;
igual(comandos.map((c) => c.command), Array.from({ length: 12 }, (_, i) => `select ${i + 1}`), "los comandos no cambian");
// A lo sumo 3 jobs de «cada 5/10/15» en el mismo minuto (antes, 8-11).
const minutos = new Map();
for (const [nombre, hor] of Object.entries(h)) {
  if (nombre === "reanudar-trabajos-ocr" || nombre === "ia-modelos-openai") continue;
  const [campoMin] = hor.split(" ");
  const lista = campoMin.includes(",") ? campoMin.split(",").map(Number)
    : campoMin.includes("/") ? (() => { const [ini, paso] = campoMin.split("/"); const i = Number(ini.split("-")[0]); return Array.from({ length: Math.ceil((60 - i) / Number(paso)) }, (_, k) => i + k * Number(paso)); })()
    : [Number(campoMin)];
  for (const m of lista) minutos.set(m, (minutos.get(m) ?? 0) + 1);
}
assert.ok(Math.max(...minutos.values()) <= 3, `como mucho 3 por minuto, hay ${Math.max(...minutos.values())}`); comprobaciones++;
igual(h["ia-modelos-openai"], "20 6 * * *", "ya no coincide con facturas-alertas (06:15)");

// --- 5. Rollback ---
await db.exec(ROLLBACK);
const h2 = await horarios();
igual(h2["avisos-telegram-fallos"], "*/5 * * * *", "rollback: horarios");
igual(h2["facturas-originales-drive"], "*/10 * * * *");
igual(h2["ia-modelos-openai"], "15 6 * * *");
igual((await db.query(`select pg_get_functiondef('public.reanudar_trabajos_ocr'::regproc) d`)).rows[0].d, ANTIGUA, "rollback: reanudar_trabajos_ocr como antes");
igual((await db.query(`select count(*)::int n from pg_proc where proname in ('ocr_reanudar_fallido_interno','ocr_reanudar_fallidos_transitorios','ocr_trabajo_ficheros_presentes','facturas_insertar_lineas','ocr_trabajos_cerrar_ticket_fallo')`)).rows[0].n, 0, "rollback: funciones nuevas fuera");
igual((await db.query(`select count(*)::int n from pg_trigger where tgname = 'trg_ocr_trabajos_cerrar_ticket_fallo'`)).rows[0].n, 0, "rollback: trigger fuera");
await db.exec(MIGRACION);
igual((await horarios())["embeddings-nombres"], "9,19,29,39,49,59 * * * *", "se puede volver a aplicar tras el rollback");

console.log(`OK · ${comprobaciones} comprobaciones`);
