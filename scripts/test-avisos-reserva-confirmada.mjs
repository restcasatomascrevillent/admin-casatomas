// Avisos de Reservas: solo canceladas, nuevas por verificar y confirmadas por el cliente (18/11/2026),
// contra un Postgres en memoria (PGlite). Nunca toca Supabase.
//
//   npm run test:avisos-confirmada:db
//
// Aplica las migraciones REALES 20261122160000 y 20261205100200 (lo que hay antes) y luego
// 20261212720000 dos veces (idempotente), y demuestra:
//   · al aplicarla, las «Reserva nueva» sin revisar cuya reserva ya no está pendiente quedan revisadas;
//     las de reservas pendientes siguen sin revisar;
//   · verificar una reserva (desde el panel o con la clave de servicio) revisa su «Reserva nueva»
//     y no crea ningún aviso; cancelarla la revisa y crea «Reserva cancelada»;
//   · el cliente confirma con el enlace (clave de servicio, verificada → confirmada) → aviso
//     «Confirmada por el cliente» con los datos de la reserva;
//   · confirmarla desde el panel o con SQL a mano no avisa; volver a guardarla confirmada tampoco;
//   · los avisos de otras reservas y de otros tipos no se tocan;
//   · seccion_aviso('reserva_confirmada') = 'reservas';
//   · el rollback deja la función como antes (sin aviso verde ni revisión sola).
import { PGlite } from "@electric-sql/pglite";
import { readFile } from "node:fs/promises";
import assert from "node:assert/strict";

const AVISOS = await readFile("supabase/migrations/20261122160000_avisos_reservas_nuevas_canceladas.sql", "utf8");
const CANCELADA_POR = await readFile("supabase/migrations/20261205100200_reservas_cancelada_por.sql", "utf8");
const MIGRACION = await readFile("supabase/migrations/20261212720000_avisos_reserva_confirmada_cliente.sql", "utf8");
const ROLLBACK = await readFile("supabase/rollbacks/20261212720000_avisos_reserva_confirmada_cliente_ROLLBACK.sql", "utf8");

let comprobaciones = 0;
const igual = (a, b, msg) => { assert.deepEqual(a, b, msg); comprobaciones++; };

const USUARIO = "a0000000-0000-0000-0000-000000000001";
const id = (n) => `d0000000-0000-0000-0000-00000000000${n}`;

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
    id uuid primary key, nombre text, fecha date default '2026-11-20', hora time default '21:00', numero_comensales int default 2,
    estado varchar default 'pendiente', canal text default 'web',
    constraint reservas_estado_check check (estado in ('pendiente','verificada','confirmada','cancelada','completada','no_show')));
  grant select, insert, update on public.reservas to authenticated, service_role;
  create table public.notificaciones_dashboard (id serial primary key, tipo text, titulo text, mensaje text,
    referencia_id uuid, referencia_tipo text, prioridad text, leida boolean not null default false);
`);
await db.exec(AVISOS);
await db.exec(CANCELADA_POR);

// Lo que hay antes de la migración: cuatro reservas web nuevas (crean su aviso) y una que ya se verificó
// y otra que ya se canceló sin que nadie marcara su «Reserva nueva».
await db.exec(`
  insert into public.reservas (id, nombre) values
    ('${id(1)}', 'García'), ('${id(2)}', 'López'), ('${id(3)}', 'Pérez'), ('${id(4)}', 'Ruiz'), ('${id(5)}', 'Sanz'), ('${id(6)}', 'Vidal');
  update public.reservas set estado = 'verificada' where id = '${id(5)}';
  update public.reservas set estado = 'cancelada' where id = '${id(6)}';
  insert into public.notificaciones_dashboard (tipo, titulo, referencia_id, referencia_tipo)
    values ('reserva_nueva', 'Reserva nueva', '${id(9)}', 'reserva'),   -- reserva borrada
           ('subida_precio', 'Sube el pan', null, null);
`);

const sinRevisar = async (n, tipo = "reserva_nueva") =>
  (await db.query(`select count(*)::int c from public.notificaciones_dashboard where tipo = $1 and referencia_id = $2 and not leida`, [tipo, id(n)])).rows[0].c;
const avisos = async (n, tipo) =>
  (await db.query(`select titulo, mensaje from public.notificaciones_dashboard where tipo = $1 and referencia_id = $2 order by id`, [tipo, id(n)])).rows;
const comoPanel = async (sql) => {
  await db.exec(`set role authenticated; set request.jwt.claims = '{"sub":"${USUARIO}","role":"authenticated"}';`);
  try { return await db.query(sql); } finally { await db.exec(`reset role; reset request.jwt.claims;`); }
};
const comoServicio = async (sql) => {
  await db.exec(`set role service_role; set request.jwt.claims = '{"role":"service_role"}';`);
  try { return await db.query(sql); } finally { await db.exec(`reset role; reset request.jwt.claims;`); }
};

igual([await sinRevisar(5), await sinRevisar(6)], [1, 1], "antes de la migración, verificar o cancelar no revisa la «Reserva nueva»");

await db.exec(MIGRACION);
await db.exec(MIGRACION); // idempotente

// Limpieza de lo que ya había.
igual([await sinRevisar(5), await sinRevisar(6), await sinRevisar(9)], [0, 0, 0], "al aplicarla, las «Reserva nueva» de reservas que ya no están pendientes (o borradas) quedan revisadas");
igual([await sinRevisar(1), await sinRevisar(2), await sinRevisar(3), await sinRevisar(4)], [1, 1, 1, 1], "las de reservas pendientes siguen por verificar");
igual((await db.query(`select leida from public.notificaciones_dashboard where tipo = 'subida_precio'`)).rows[0].leida, false, "los avisos de otros tipos no se tocan");

// Verificar desde el panel: revisa la «Reserva nueva» y no crea ningún aviso.
await comoPanel(`update public.reservas set estado = 'verificada' where id = '${id(1)}'`);
igual(await sinRevisar(1), 0, "verificarla desde el panel revisa su «Reserva nueva»");
igual(await sinRevisar(2), 1, "y no toca la de otra reserva");
igual((await avisos(1, "reserva_confirmada")).length + (await avisos(1, "reserva_cancelada")).length, 0, "verificar no crea avisos");

// El cliente confirma con el enlace del correo (reservas-web con la clave de servicio).
await comoServicio(`update public.reservas set estado = 'confirmada' where id = '${id(1)}' and estado = 'verificada'`);
igual(await avisos(1, "reserva_confirmada"), [{ titulo: "Confirmada por el cliente", mensaje: "García · 20/11 21:00 · 2 pers. · web" }],
  "el cliente confirma → aviso «Confirmada por el cliente»");
igual(await sinRevisar(1, "reserva_confirmada"), 1, "sin revisar");
await comoServicio(`update public.reservas set nombre = 'García (2)', estado = 'confirmada' where id = '${id(1)}'`);
igual((await avisos(1, "reserva_confirmada")).length, 1, "volver a guardarla confirmada no repite el aviso");

// Confirmarla el restaurante (panel) no avisa; pendiente → confirmada revisa la «Reserva nueva».
await comoPanel(`update public.reservas set estado = 'confirmada' where id = '${id(2)}'`);
igual([(await avisos(2, "reserva_confirmada")).length, await sinRevisar(2)], [0, 0], "confirmarla desde el panel no avisa y revisa la «Reserva nueva»");

// SQL a mano, sin sesión: tampoco avisa.
await db.exec(`update public.reservas set estado = 'confirmada' where id = '${id(3)}'`);
igual([(await avisos(3, "reserva_confirmada")).length, await sinRevisar(3)], [0, 0], "con SQL a mano no avisa, pero revisa la «Reserva nueva»");

// Cancelada por el cliente (pendiente → cancelada): revisa la azul y crea la roja.
await comoServicio(`update public.reservas set estado = 'cancelada' where id = '${id(4)}'`);
igual(await sinRevisar(4), 0, "cancelarla revisa su «Reserva nueva»");
igual(await avisos(4, "reserva_cancelada"), [{ titulo: "Reserva cancelada", mensaje: "Ruiz · 20/11 21:00 · 2 pers. · web · la canceló el cliente" }],
  "y crea «Reserva cancelada» como antes");

// Una reserva nueva después de la migración sigue avisando en azul.
await db.exec(`insert into public.reservas (id, nombre) values ('${id(7)}', 'Nueva')`);
igual(await sinRevisar(7), 1, "una reserva web nueva sigue creando «Reserva nueva»");

igual((await db.query(`select public.seccion_aviso('reserva_confirmada') s`)).rows[0].s, "reservas", "«Confirmada por el cliente» es de la sección Reservas");
igual((await db.query(`select public.seccion_aviso('reserva_nueva') s, public.seccion_aviso('facturas_revision') f`)).rows[0], { s: "reservas", f: "facturas" }, "el resto de secciones no cambia");
// #293 (20261212100000_avisos_solo_su_seccion): esta migración no deshace «cada aviso solo para quien ve su sección».
igual(
  (await db.query(`select public.seccion_aviso('email_fallido') r, public.seccion_aviso('instagram_encargo') m, public.seccion_aviso('sistema') s, public.seccion_aviso('tipo_nuevo') n`)).rows[0],
  { r: "reservas", m: "marketing", s: "solo_super_admin", n: "solo_super_admin" },
  "sigue la lista de #293: lo que no es de una sección, solo el super admin",
);

// Rollback: sin aviso verde y sin revisar sola la azul.
await db.exec(ROLLBACK);
await db.exec(ROLLBACK); // idempotente
await comoPanel(`update public.reservas set estado = 'verificada' where id = '${id(7)}'`);
igual(await sinRevisar(7), 1, "tras el rollback, verificar ya no revisa la «Reserva nueva»");
await comoServicio(`update public.reservas set estado = 'confirmada' where id = '${id(7)}'`);
igual((await avisos(7, "reserva_confirmada")).length, 0, "ni hay aviso «Confirmada por el cliente»");
igual((await db.query(`select public.seccion_aviso('reserva_confirmada') s`)).rows[0].s, "solo_super_admin", "y seccion_aviso vuelve a ser la de #293 (sin sección: solo el super admin)");

console.log(`✔ avisos de reservas (confirmada por el cliente): ${comprobaciones} comprobaciones`);
