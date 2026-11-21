// Avisos de Reservas: solo por verificar y canceladas, sin «Confirmada por el cliente» (CAS-24, 20/11/2026),
// contra un Postgres en memoria (PGlite). Nunca toca Supabase.
//
//   npm run test:avisos-sin-confirmada:db
//
// Aplica las migraciones REALES de antes (20261122160000, 20261205100200 y 20261212720000, la que
// creaba el aviso verde), deja un aviso verde sin revisar y otro revisado, y luego 20261213050000 dos
// veces (idempotente). Demuestra:
//   · los avisos verdes sin revisar quedan revisados (no se borran) y los de otros tipos no se tocan;
//   · el cliente confirma con el enlace del correo → ya NO hay aviso «Confirmada por el cliente»,
//     pero su «Reserva nueva» sin revisar queda revisada (sigue la regla de 20261212720000);
//   · reserva web nueva → «Reserva nueva»; verificarla la revisa; cancelarla → «Reserva cancelada»
//     con quién la canceló, como antes;
//   · el rollback vuelve a crear el aviso verde.
import { PGlite } from "@electric-sql/pglite";
import { readFile } from "node:fs/promises";
import assert from "node:assert/strict";

const AVISOS = await readFile("supabase/migrations/20261122160000_avisos_reservas_nuevas_canceladas.sql", "utf8");
const CANCELADA_POR = await readFile("supabase/migrations/20261205100200_reservas_cancelada_por.sql", "utf8");
const VERDES = await readFile("supabase/migrations/20261212720000_avisos_reserva_confirmada_cliente.sql", "utf8");
const MIGRACION = await readFile("supabase/migrations/20261213050000_avisos_sin_reserva_confirmada.sql", "utf8");
const ROLLBACK = await readFile("supabase/rollbacks/20261213050000_avisos_sin_reserva_confirmada_ROLLBACK.sql", "utf8");

let comprobaciones = 0;
const igual = (a, b, msg) => { assert.deepEqual(a, b, msg); comprobaciones++; };

const USUARIO = "a0000000-0000-0000-0000-000000000001";
const id = (n) => `e0000000-0000-0000-0000-00000000000${n}`;

const db = new PGlite();
await db.exec(`
  create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
  create schema auth;
  create function auth.uid() returns uuid language sql stable
    as $$ select (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')::uuid $$;
  create function auth.role() returns text language sql stable
    as $$ select nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role' $$;
  grant usage on schema public, auth to anon, authenticated, service_role;
  create table public.reservas (
    id uuid primary key, nombre text, fecha date default '2026-11-21', hora time default '14:00', numero_comensales int default 4,
    estado varchar default 'pendiente', canal text default 'web',
    constraint reservas_estado_check check (estado in ('pendiente','verificada','confirmada','cancelada','completada','no_show')));
  grant select, insert, update on public.reservas to authenticated, service_role;
  create table public.notificaciones_dashboard (id serial primary key, tipo text, titulo text, mensaje text,
    referencia_id uuid, referencia_tipo text, prioridad text, leida boolean not null default false);
`);
await db.exec(AVISOS);
await db.exec(CANCELADA_POR);
await db.exec(VERDES);

const avisos = async (n, tipo) =>
  (await db.query(`select titulo, mensaje, leida from public.notificaciones_dashboard where tipo = $1 and referencia_id = $2 order by id`, [tipo, id(n)])).rows;
const sinRevisar = async (n, tipo = "reserva_nueva") =>
  (await db.query(`select count(*)::int c from public.notificaciones_dashboard where tipo = $1 and referencia_id = $2 and not leida`, [tipo, id(n)])).rows[0].c;
const comoPanel = async (sql) => {
  await db.exec(`set role authenticated; set request.jwt.claims = '{"sub":"${USUARIO}","role":"authenticated"}';`);
  try { return await db.query(sql); } finally { await db.exec(`reset role; reset request.jwt.claims;`); }
};
const comoServicio = async (sql) => {
  await db.exec(`set role service_role; set request.jwt.claims = '{"role":"service_role"}';`);
  try { return await db.query(sql); } finally { await db.exec(`reset role; reset request.jwt.claims;`); }
};
/** El cliente confirma con el enlace del correo (reservas-web con la clave de servicio). */
const confirmaElCliente = (n) => comoServicio(`update public.reservas set estado = 'confirmada' where id = '${id(n)}'`);

// Antes: dos reservas que confirma el cliente (avisos verdes; uno ya revisado) y un aviso de otro tipo.
await db.exec(`insert into public.reservas (id, nombre) values ('${id(1)}', 'Antón'), ('${id(2)}', 'Belén');`);
await comoPanel(`update public.reservas set estado = 'verificada' where id in ('${id(1)}', '${id(2)}')`);
await confirmaElCliente(1);
await confirmaElCliente(2);
await db.exec(`update public.notificaciones_dashboard set leida = true where tipo = 'reserva_confirmada' and referencia_id = '${id(2)}';
  insert into public.notificaciones_dashboard (tipo, titulo) values ('subida_precio', 'Sube el pan');`);
igual([(await avisos(1, "reserva_confirmada")).length, await sinRevisar(1, "reserva_confirmada")], [1, 1], "antes, el cliente que confirma crea un aviso verde sin revisar");

await db.exec(MIGRACION);
await db.exec(MIGRACION); // idempotente

// 1. Los verdes que quedaban: revisados, no borrados.
igual(await avisos(1, "reserva_confirmada"), [{ titulo: "Confirmada por el cliente", mensaje: "Antón · 21/11 14:00 · 4 pers. · web", leida: true }],
  "el verde sin revisar pasa a revisado y sigue en el historial");
igual((await avisos(2, "reserva_confirmada"))[0].leida, true, "el que ya estaba revisado sigue igual");
igual((await db.query(`select leida from public.notificaciones_dashboard where tipo = 'subida_precio'`)).rows[0].leida, false, "los de otros tipos no se tocan");

// 2. El cliente confirma: ya no hay aviso, pero la «Reserva nueva» queda revisada (pendiente → confirmada).
await db.exec(`insert into public.reservas (id, nombre) values ('${id(3)}', 'Carmen')`);
igual(await sinRevisar(3), 1, "reserva web nueva → «Reserva nueva» sin revisar (azul, para verificar)");
await confirmaElCliente(3);
igual((await avisos(3, "reserva_confirmada")).length, 0, "el cliente confirma → ya NO hay aviso «Confirmada por el cliente»");
igual(await sinRevisar(3), 0, "y su «Reserva nueva» queda revisada: ya no hay nada que verificar");

// Verificada → confirmada por el cliente (el caso normal): tampoco avisa.
await db.exec(`insert into public.reservas (id, nombre) values ('${id(4)}', 'Diego')`);
await comoPanel(`update public.reservas set estado = 'verificada' where id = '${id(4)}'`);
igual(await sinRevisar(4), 0, "verificarla desde el panel revisa su «Reserva nueva»");
await confirmaElCliente(4);
igual((await avisos(4, "reserva_confirmada")).length, 0, "verificada → confirmada por el cliente: sin aviso");

// 3. Canceladas: como antes (rojo, con quién la canceló).
await db.exec(`insert into public.reservas (id, nombre) values ('${id(5)}', 'Elena')`);
await comoServicio(`update public.reservas set estado = 'cancelada' where id = '${id(5)}'`);
igual(await avisos(5, "reserva_cancelada"), [{ titulo: "Reserva cancelada", mensaje: "Elena · 21/11 14:00 · 4 pers. · web · la canceló el cliente", leida: false }],
  "cancelarla sigue creando «Reserva cancelada»");
igual(await sinRevisar(5), 0, "y revisa su «Reserva nueva»");
igual((await db.query(`select public.seccion_aviso('reserva_confirmada') s`)).rows[0].s, "reservas", "los verdes viejos siguen siendo de la sección Reservas");

// 4. Rollback: vuelve el verde.
await db.exec(ROLLBACK);
await db.exec(ROLLBACK); // idempotente
await db.exec(`insert into public.reservas (id, nombre) values ('${id(6)}', 'Fran')`);
await comoPanel(`update public.reservas set estado = 'verificada' where id = '${id(6)}'`);
await confirmaElCliente(6);
igual((await avisos(6, "reserva_confirmada")).length, 1, "tras el rollback, el cliente que confirma vuelve a crear el aviso verde");

console.log(`✔ avisos de reservas sin «Confirmada por el cliente»: ${comprobaciones} comprobaciones`);
