// Telegram › Reservas: cada paso de la reserva (20261217100000_telegram_reservas_estado, 23/11/2026), contra un
// Postgres en memoria (PGlite). Nunca toca Supabase ni manda nada a Telegram.
//
//   npm run test:telegram-reservas:db
//
// Aplica las migraciones REALES de Telegram (20261126001000 … 20261216100000) y luego 20261217100000 dos veces
// (idempotente). Demuestra:
//   · con Telegram apagado no se apunta nada;
//   · reserva web o por teléfono → «nueva»; las del panel (manual) no;
//   · pendiente → verificada desde el panel → «aceptada» (restaurante);
//   · verificada → confirmada con la clave de servicio y sin usuario (enlace del correo) → «confirmada» (cliente);
//     desde el panel → «confirmada» (restaurante);
//   · cancelada → «cancelada» con quién la canceló; otros cambios no apuntan nada;
//   · hay_pendientes cuenta los pasos (no los avisos «Reserva nueva» del panel) solo con chat de Reservas y
//     reservas_al_momento; el reclamo no duplica y no manda lo anterior a la activación;
//   · el registro de envíos admite 'reserva'; el rollback lo quita todo y la migración se puede volver a aplicar.
import { PGlite } from "@electric-sql/pglite";
import { readFile } from "node:fs/promises";
import assert from "node:assert/strict";

const leer = (f) => readFile(f, "utf8");
const PREVIAS = await Promise.all([
  "supabase/migrations/20261126001000_avisos_telegram.sql",
  "supabase/migrations/20261127100100_fallos_internos_telegram.sql",
  "supabase/migrations/20261209400000_telegram_avisos_utiles.sql",
  "supabase/migrations/20261209600000_telegram_avisos_revision.sql",
  "supabase/migrations/20261216100000_telegram_canales.sql",
].map(leer));
const MIGRACION = await leer("supabase/migrations/20261217100000_telegram_reservas_estado.sql");
const ROLLBACK = await leer("supabase/rollbacks/20261217100000_telegram_reservas_estado_ROLLBACK.sql");

let comprobaciones = 0;
const igual = (a, b, msg) => { assert.deepEqual(a, b, msg); comprobaciones++; };

const ADMIN = "a0000000-0000-0000-0000-000000000001";
const id = (n) => `b0000000-0000-0000-0000-00000000000${n}`;

const db = new PGlite();
await db.exec(`
  create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
  create schema auth;
  create function auth.uid() returns uuid language sql stable
    as $$ select (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')::uuid $$;
  create function auth.role() returns text language sql stable
    as $$ select nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role' $$;
  create table auth.users (id uuid primary key, email text);
  grant usage on schema public, auth to anon, authenticated, service_role;
  create function public.is_super_admin(p uuid) returns boolean language sql stable as $$ select p = '${ADMIN}'::uuid $$;
  create table public.notificaciones_dashboard (
    id uuid primary key default gen_random_uuid(), tipo text not null, titulo text, mensaje text,
    referencia_tipo text, referencia_id uuid, created_at timestamptz not null default now(), caduca_en timestamptz, datos jsonb);
  create table public.reservas (id uuid primary key, nombre text, fecha date default current_date, hora time default '21:00',
    numero_comensales int default 4, canal text default 'web', estado text default 'pendiente', cancelada_por text);
  create table public.chat_feedback (id bigint generated always as identity primary key, pregunta text, respuesta text,
    comentario text, modelo text, conversacion_id uuid, usuario_id uuid, valoracion int, created_at timestamptz default now());
  create table public.facturas (id bigint primary key, tipo text, facturado_en_id bigint, proveedor_id bigint, proveedor text, total numeric);
  create table public.ocr_trabajos (id bigint generated always as identity primary key, estado text, error text,
    terminado_at timestamptz, updated_at timestamptz default now());
  create function public.margenes_carta_datos(date) returns jsonb language sql as $$ select '{}'::jsonb $$;
  create function public.facturas_alertas_umbrales() returns jsonb language sql as $$ select '{}'::jsonb $$;
`);
for (const sql of PREVIAS) await db.exec(sql);
await db.exec(MIGRACION);
await db.exec(MIGRACION); // idempotente

const valor = async (sql, p = []) => Object.values((await db.query(sql, p)).rows[0] ?? {})[0];
const cfg = (set) => db.exec(`update public.avisos_telegram_config set ${set} where id`);
const pasos = async () => (await db.query(`select reserva_id, evento, quien, estado from public.avisos_telegram_reservas order by id`)).rows
  .map((r) => [r.reserva_id.slice(-1), r.evento, r.quien, r.estado]);
/** Ejecuta como un usuario del panel (auth.uid) o como la clave de servicio sin usuario (enlace del correo). */
const como = async (quien, sql) => {
  const claims = quien === "panel" ? `{"sub":"${ADMIN}","role":"authenticated"}` : `{"role":"service_role"}`;
  await db.exec(`set request.jwt.claims = '${claims}'`);
  try { await db.exec(sql); } finally { await db.exec(`reset request.jwt.claims`); }
};
const reclamar = async () => (await db.query(`select evento from public.avisos_telegram_reservas_reclamar(50)`)).rows.map((r) => r.evento);

// 1. Apagado: nada ──────────────────────────────────────────────────────────
await db.exec(`insert into public.reservas (id) values ('${id(1)}')`);
igual(await pasos(), [], "con Telegram apagado no se apunta nada");

// 2. Encendido: cada paso ───────────────────────────────────────────────────
await cfg(`activo = true, chat_reservas = '-100700', silencio_activo = false`);
await db.exec(`insert into public.reservas (id, canal) values ('${id(2)}', 'web'), ('${id(3)}', 'telefono'), ('${id(4)}', 'manual')`);
igual(await pasos(), [["2", "nueva", null, "pendiente"], ["3", "nueva", null, "pendiente"]], "web y teléfono: «nueva»; manual no");

await como("panel", `update public.reservas set estado = 'verificada' where id = '${id(2)}'`);
await como("servicio", `update public.reservas set estado = 'confirmada' where id = '${id(2)}'`);
await como("panel", `update public.reservas set estado = 'verificada' where id = '${id(3)}'`);
await como("panel", `update public.reservas set estado = 'confirmada' where id = '${id(3)}'`);
await como("servicio", `update public.reservas set estado = 'cancelada', cancelada_por = 'cliente' where id = '${id(2)}'`);
await como("panel", `update public.reservas set estado = 'cancelada', cancelada_por = 'restaurante' where id = '${id(4)}'`);
await como("panel", `update public.reservas set numero_comensales = 6 where id = '${id(3)}'`);
await como("panel", `update public.reservas set estado = 'completada' where id = '${id(3)}'`);
igual((await pasos()).slice(2), [
  ["2", "aceptada", "restaurante", "verificada"],
  ["2", "confirmada", "cliente", "confirmada"],
  ["3", "aceptada", "restaurante", "verificada"],
  ["3", "confirmada", "restaurante", "confirmada"],
  ["2", "cancelada", "cliente", "cancelada"],
  ["4", "cancelada", "restaurante", "cancelada"],
], "aceptada, confirmada (cliente o restaurante) y cancelada con quién; otros cambios no apuntan nada");

// 3. hay_pendientes y reclamo ───────────────────────────────────────────────
igual(await valor(`select public.avisos_telegram_hay_pendientes()`), true, "hay pasos de reserva por mandar");
await cfg(`reservas_al_momento = false`);
igual(await valor(`select public.avisos_telegram_hay_pendientes()`), false, "con reservas_al_momento apagado no cuentan");
await cfg(`reservas_al_momento = true, chat_reservas = null`);
igual(await valor(`select public.avisos_telegram_hay_pendientes()`), false, "sin chat de Reservas (ni general) no cuentan");
await cfg(`chat_id = '-100500'`);
igual(await valor(`select public.avisos_telegram_hay_pendientes()`), true, "con el general, sí");
igual((await reclamar()).length, 8, "el reclamo devuelve los 8 pasos");
igual(await reclamar(), [], "y no los vuelve a dar (sin duplicados)");
igual(await valor(`select public.avisos_telegram_hay_pendientes()`), false, "reclamados, ya no cuentan");
await db.exec(`update public.avisos_telegram_reservas set enviado_en = now()`);

// Lo anterior a la activación no sale: se apaga, se apunta a mano un paso viejo y se vuelve a encender.
await db.exec(`insert into public.avisos_telegram_reservas (reserva_id, evento, created_at) values ('${id(1)}', 'nueva', now() - interval '1 hour')`);
await cfg(`activo = false`);
await cfg(`activo = true`);
igual(await reclamar(), [], "un paso anterior a la activación no se manda");

// Los avisos «Reserva nueva» del panel ya no cuentan, aunque estén marcados al momento; un margen bajo sí.
await db.exec(`insert into public.notificaciones_dashboard (tipo, titulo) values ('reserva_nueva', 'Reserva nueva')`);
await cfg(`tipos_al_momento = array['reserva_nueva', 'facturas_margen_bajo']`);
igual(await valor(`select public.avisos_telegram_hay_pendientes()`), false, "el aviso «Reserva nueva» del panel ya no cuenta");
await db.exec(`insert into public.notificaciones_dashboard (tipo, titulo) values ('facturas_margen_bajo', 'Margen bajo')`);
igual(await valor(`select public.avisos_telegram_hay_pendientes()`), true, "un margen bajo sí");

// 4. Registro de envíos y permisos ──────────────────────────────────────────
await db.exec(`insert into public.avisos_telegram_envios (tipo, ok) values ('reserva', true)`);
igual(await valor(`select count(*)::int from public.avisos_telegram_envios where tipo = 'reserva'`), 1, "el registro admite 'reserva'");
igual(await valor(`select has_function_privilege('authenticated', 'public.avisos_telegram_reservas_reclamar(integer)', 'execute')`), false,
  "el reclamo es solo para el servidor");

// 5. Rollback y otra vez ────────────────────────────────────────────────────
await db.exec(ROLLBACK);
await db.exec(ROLLBACK); // idempotente
igual(await valor(`select to_regclass('public.avisos_telegram_reservas') is null`), true, "el rollback quita la tabla");
await db.exec(`insert into public.reservas (id) values ('${id(5)}')`);
igual(await valor(`select count(*)::int from public.avisos_telegram_envios where tipo = 'reserva'`), 0, "y los envíos 'reserva'");
igual(await valor(`select position('avisos_telegram_reservas' in pg_get_functiondef('public.avisos_telegram_hay_pendientes()'::regprocedure)) = 0`), true,
  "hay_pendientes vuelve a la versión de 20261216100000");
await db.exec(MIGRACION);
await db.exec(`insert into public.reservas (id) values ('${id(6)}')`);
igual(await pasos(), [["6", "nueva", null, "pendiente"]], "aplicada otra vez, vuelve a apuntar los pasos");

console.log(`telegram-reservas: ${comprobaciones} comprobaciones OK`);
