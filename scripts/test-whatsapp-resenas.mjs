// WhatsApp: petición de reseña y registro de mensajes (migración 20261223100000),
// contra un Postgres en memoria (PGlite). Nunca toca Supabase.
//
//   node scripts/test-whatsapp-resenas.mjs
//
// Aplica la migración REAL dos veces sobre una `reservas` y `servicios_contratados`
// mínimas. Cubre: que whatsapp_resena_momento da lo mismo que momentoResena()
// (mismos casos: supabase/functions/whatsapp-reservas/__tests__/casos-momento-resena.json);
// que whatsapp_resenas_hay_trabajo solo ve reservas confirmadas/completadas con
// teléfono cuya hora ya llegó (12 h de ventana) y sin fila en whatsapp_resenas;
// que una reserva no puede tener dos filas; los CHECK de whatsapp_mensajes; que
// sin el secreto de Vault el disparador no llama a nada; la fila de WhatsApp en
// Servicios; que nadie más que service_role ve las tablas; idempotencia y vuelta atrás.
import { PGlite } from "@electric-sql/pglite";
import { readFile } from "node:fs/promises";
import assert from "node:assert/strict";

const MIGRACION = await readFile("supabase/migrations/20261223100000_whatsapp_resenas_y_coste.sql", "utf8");
const ROLLBACK = await readFile("supabase/rollbacks/20261223100000_whatsapp_resenas_y_coste_ROLLBACK.sql", "utf8");
const { casos } = JSON.parse(await readFile("supabase/functions/whatsapp-reservas/__tests__/casos-momento-resena.json", "utf8"));

let comprobaciones = 0;
const igual = (a, b, msg) => { assert.deepEqual(a, b, msg); comprobaciones++; };
const falla = async (p, patron, msg) => { await assert.rejects(p, patron, msg); comprobaciones++; };

const db = new PGlite();
await db.exec(`
  create role anon; create role authenticated; create role service_role;
  create schema vault;
  create table vault.decrypted_secrets (name text, decrypted_secret text);
  create table public.reservas (
    id uuid primary key default gen_random_uuid(),
    fecha date not null,
    hora time not null,
    estado text not null default 'pendiente',
    telefono text,
    canal_avisos text not null default 'email'
  );
  create table public.servicios_contratados (
    proveedor text primary key, nombre text, plan text, precio_mensual numeric, precio_anual numeric, moneda text,
    ciclo text, renovacion date, cuenta text, panel_url text, categoria text, orden int, activo boolean default true,
    por_confirmar boolean, fuente_precio text, precio_confirmado_en date, para_que text, si_se_pasa text,
    limites jsonb default '{}'::jsonb, notas text, actualizado_por uuid
  );
  create table public.servicios_uso (proveedor text, tomado_en timestamptz default now());
  insert into public.servicios_contratados (proveedor, nombre) values ('vapi', 'Vapi');
`);

await db.exec(MIGRACION);

// ─── Cuándo (mismos casos que resenas.test.ts) ──────────────────────────────
for (const c of casos) {
  const { rows } = await db.query(`select public.whatsapp_resena_momento($1::date, $2::time) as m`, [c.fecha, c.hora]);
  igual(new Date(rows[0].m).toISOString(), c.utc, `momento ${c.fecha} ${c.hora}: ${c.por}`);
}

// ─── ¿Hay trabajo? ──────────────────────────────────────────────────────────
// Reservas de ayer/hoy (Madrid) cuyo momento ya pasó (dentro de 12 h) y otra futura,
// buscadas con la propia función (la hora del test cambia).
const hayTrabajo = async () => (await db.query(`select public.whatsapp_resenas_hay_trabajo() as h`)).rows[0].h;
const huecos = (await db.query(`
  with hoy as (select (now() at time zone 'Europe/Madrid')::date as d),
  c as (
    select dia, h::time as hora, public.whatsapp_resena_momento(dia, h::time) as m
      from hoy, unnest(array[hoy.d - 1, hoy.d]) as dia,
           generate_series(timestamp '2000-01-01 07:00', timestamp '2000-01-01 23:45', interval '15 minutes') as h
  )
  select
    (select json_build_object('fecha', dia, 'hora', hora) from c where m <= now() and m > now() - interval '12 hours' order by m desc limit 1) as pasada,
    (select json_build_object('fecha', dia, 'hora', hora) from c where m > now() order by m limit 1) as futura,
    (select json_build_object('fecha', dia, 'hora', hora) from c where m <= now() - interval '13 hours' order by m desc limit 1) as caducada
`)).rows[0];
assert.ok(huecos.pasada && huecos.futura, "hay huecos de prueba");

igual(await hayTrabajo(), false, "sin reservas, no hay trabajo");
await db.query(`insert into public.reservas (fecha, hora, estado, telefono) values ($1, $2, 'confirmada', '612345678')`, [huecos.futura.fecha, huecos.futura.hora]);
igual(await hayTrabajo(), false, "una reserva cuya hora aún no ha llegado no cuenta");
if (huecos.caducada) {
  await db.query(`insert into public.reservas (fecha, hora, estado, telefono) values ($1, $2, 'confirmada', '612345678')`, [huecos.caducada.fecha, huecos.caducada.hora]);
  igual(await hayTrabajo(), false, "pasadas las 12 h, ya no cuenta");
}
for (const [estado, telefono] of [["cancelada", "612345678"], ["no_show", "612345678"], ["pendiente", "612345678"], ["confirmada", ""], ["confirmada", null]]) {
  await db.query(`insert into public.reservas (fecha, hora, estado, telefono) values ($1, $2, $3, $4)`, [huecos.pasada.fecha, huecos.pasada.hora, estado, telefono]);
}
igual(await hayTrabajo(), false, "canceladas, no presentadas, sin confirmar o sin teléfono no cuentan");
const { rows: [buena] } = await db.query(
  `insert into public.reservas (fecha, hora, estado, telefono) values ($1, $2, 'completada', '612345678') returning id`, [huecos.pasada.fecha, huecos.pasada.hora]);
igual(await hayTrabajo(), true, "una completada con teléfono cuya hora ya llegó: hay trabajo");
await db.query(`insert into public.whatsapp_resenas (reserva_id, estado) values ($1, 'enviando')`, [buena.id]);
igual(await hayTrabajo(), false, "en cuanto tiene fila en whatsapp_resenas, ya no");
await falla(db.query(`insert into public.whatsapp_resenas (reserva_id, estado) values ($1, 'enviada')`, [buena.id]), /duplicate key|whatsapp_resenas_pkey/,
  "una reserva no puede tener dos filas (no se manda dos veces)");
await falla(db.query(`insert into public.whatsapp_resenas (reserva_id, estado) values (gen_random_uuid(), 'enviada')`), /foreign key/,
  "solo reservas que existen");
await falla(db.query(`insert into public.whatsapp_resenas (reserva_id, estado) values ((select id from public.reservas limit 1), 'rara')`), /whatsapp_resenas_estado_chk/,
  "estado de la reseña controlado");

// ─── Disparador sin secreto: no llama a nada ────────────────────────────────
await db.query(`delete from public.whatsapp_resenas`);
igual((await db.query(`select public.whatsapp_resenas_disparar() as d`)).rows[0].d, false, "sin el secreto de Vault no hace nada (ni llama a net.http_post)");
await db.exec(`insert into vault.decrypted_secrets values ('project_url', 'https://sfonaclosuafvlhutkon.supabase.co')`);
igual((await db.query(`select public.whatsapp_resenas_disparar() as d`)).rows[0].d, false, "con project_url pero sin whatsapp_resenas_cron_secret, tampoco");

// ─── Registro de mensajes ───────────────────────────────────────────────────
await db.query(`insert into public.whatsapp_mensajes (reserva_id, tipo, plantilla, categoria, wamid) values ($1, 'resena', 'resena_tras_visita', 'utility', 'wamid.1')`, [buena.id]);
igual((await db.query(`select estado from public.whatsapp_mensajes where wamid = 'wamid.1'`)).rows, [{ estado: "enviado" }], "por defecto, enviado");
await db.query(`insert into public.whatsapp_mensajes (tipo, categoria) values ('respuesta', 'service'), ('respuesta', 'service')`);
igual((await db.query(`select count(*)::int as n from public.whatsapp_mensajes where wamid is null`)).rows, [{ n: 2 }], "varias filas sin wamid (errores) caben");
await falla(db.query(`insert into public.whatsapp_mensajes (tipo, categoria, wamid) values ('resena', 'utility', 'wamid.1')`), /whatsapp_mensajes_wamid_uidx/, "un wamid, una fila");
await falla(db.query(`insert into public.whatsapp_mensajes (tipo, categoria) values ('resena', 'promo')`), /whatsapp_mensajes_categoria_chk/, "categorías de Meta");
await falla(db.query(`insert into public.whatsapp_mensajes (tipo, categoria, estado) values ('resena', 'utility', 'raro')`), /whatsapp_mensajes_estado_chk/, "estados controlados");
await db.query(`delete from public.reservas where id = $1`, [buena.id]);
igual((await db.query(`select reserva_id from public.whatsapp_mensajes where wamid = 'wamid.1'`)).rows, [{ reserva_id: null }],
  "si se borra la reserva, el mensaje se queda (cuenta para el coste) sin ella");

// ─── Permisos ───────────────────────────────────────────────────────────────
for (const rol of ["anon", "authenticated"]) {
  for (const t of ["whatsapp_mensajes", "whatsapp_resenas"]) {
    igual((await db.query(`select has_table_privilege('${rol}', 'public.${t}', 'select') as p`)).rows, [{ p: false }], `${rol} no lee ${t}`);
  }
  igual((await db.query(`select has_function_privilege('${rol}', 'public.whatsapp_resenas_disparar()', 'execute') as p`)).rows, [{ p: false }],
    `${rol} no puede disparar el envío`);
}

// ─── Servicios ──────────────────────────────────────────────────────────────
const wa = async () => (await db.query(`select proveedor, moneda, ciclo, categoria, activo, limites -> 'mensajes_servicio' ->> 'limite' as gratis from public.servicios_contratados where proveedor = 'whatsapp'`)).rows;
igual(await wa(), [{ proveedor: "whatsapp", moneda: "EUR", ciclo: "por_uso", categoria: "telefonia", activo: true, gratis: "1000" }], "WhatsApp sale en Servicios");
await db.exec(`update public.servicios_contratados set activo = false where proveedor = 'whatsapp'`);

// ─── Idempotente ────────────────────────────────────────────────────────────
await db.exec(MIGRACION);
igual((await db.query(`select activo from public.servicios_contratados where proveedor = 'whatsapp'`)).rows, [{ activo: false }],
  "idempotente: no pisa lo que el dueño cambió en Servicios");
igual((await db.query(`select count(*)::int as n from public.whatsapp_mensajes`)).rows, [{ n: 3 }], "idempotente: conserva los mensajes");

// ─── Vuelta atrás ───────────────────────────────────────────────────────────
await db.exec(`insert into public.servicios_uso (proveedor) values ('whatsapp'), ('vapi')`);
await db.exec(ROLLBACK);
igual((await db.query(`select to_regclass('public.whatsapp_mensajes') as a, to_regclass('public.whatsapp_resenas') as b`)).rows, [{ a: null, b: null }],
  "vuelta atrás: sin tablas");
igual((await db.query(`select count(*)::int as n from pg_proc where proname like 'whatsapp_resena%'`)).rows, [{ n: 0 }], "vuelta atrás: sin funciones");
igual((await db.query(`select proveedor from public.servicios_contratados order by 1`)).rows, [{ proveedor: "vapi" }], "vuelta atrás: fuera de Servicios");
igual((await db.query(`select proveedor from public.servicios_uso`)).rows, [{ proveedor: "vapi" }], "vuelta atrás: sin sus lecturas");
await db.exec(ROLLBACK);
igual((await db.query(`select count(*)::int as n from public.reservas`)).rows[0].n > 0, true, "vuelta atrás idempotente y las reservas siguen");

console.log(`OK WhatsApp reseñas y coste (20261223100000): ${comprobaciones} comprobaciones`);
