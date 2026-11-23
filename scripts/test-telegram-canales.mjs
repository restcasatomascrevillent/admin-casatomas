// Telegram en 4 chats, uno por canal (20261216100000_telegram_canales, 22/11/2026), contra un Postgres en
// memoria (PGlite). Nunca toca Supabase ni manda nada a Telegram (sin pg_net ni Vault: el disparador
// devuelve «sin_vault» cuando habría llamado a la función).
//
//   npm run test:telegram-canales:db
//
// Aplica las migraciones REALES de Telegram (20261126001000, 20261127100100, 20261209400000 y
// 20261209600000) y luego 20261216100000 dos veces (idempotente). Demuestra:
//   · columnas nuevas vacías; el trigger limpia los chats y rechaza los mal escritos; solo el super admin
//     (columnas con permiso) puede cambiarlos, y fallos_desde no;
//   · cada tipo de aviso tiene su canal (reservas / facturas) y el disparador pide el chat del canal de la
//     acción: «sin_chat» si no hay; Reservas, Facturas y Resúmenes usan el general si no tienen el suyo;
//   · hay_pendientes solo cuenta los avisos cuyo canal tiene chat;
//   · los fallos técnicos solo van a chat_fallos (nunca al general) y desde que se puso: no se suelta el atraso;
//   · el vigilante no hace nada sin chat_fallos y no cuenta lecturas fallidas de antes de ponerlo;
//   · el rollback vuelve al chat único y la migración se puede aplicar otra vez.
import { PGlite } from "@electric-sql/pglite";
import { readFile } from "node:fs/promises";
import assert from "node:assert/strict";

const leer = (f) => readFile(f, "utf8");
const PREVIAS = await Promise.all([
  "supabase/migrations/20261126001000_avisos_telegram.sql",
  "supabase/migrations/20261127100100_fallos_internos_telegram.sql",
  "supabase/migrations/20261209400000_telegram_avisos_utiles.sql",
  "supabase/migrations/20261209600000_telegram_avisos_revision.sql",
].map(leer));
const MIGRACION = await leer("supabase/migrations/20261216100000_telegram_canales.sql");
const ROLLBACK = await leer("supabase/rollbacks/20261216100000_telegram_canales_ROLLBACK.sql");

let comprobaciones = 0;
const igual = (a, b, msg) => { assert.deepEqual(a, b, msg); comprobaciones++; };
const falla = async (p, re, msg) => { await assert.rejects(p, re, msg); comprobaciones++; };

const ADMIN = "a0000000-0000-0000-0000-000000000001";
const RESERVA = "b0000000-0000-0000-0000-000000000001";

const db = new PGlite();
await db.exec(`
  create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
  create schema auth;
  create function auth.uid() returns uuid language sql stable
    as $$ select (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')::uuid $$;
  create table auth.users (id uuid primary key, email text);
  grant usage on schema public, auth to anon, authenticated, service_role;
  create function public.is_super_admin(p uuid) returns boolean language sql stable as $$ select p = '${ADMIN}'::uuid $$;
  create table public.notificaciones_dashboard (
    id uuid primary key default gen_random_uuid(), tipo text not null, titulo text, mensaje text,
    referencia_tipo text, referencia_id uuid, created_at timestamptz not null default now(), caduca_en timestamptz, datos jsonb);
  create table public.reservas (id uuid primary key, fecha date, hora time, numero_comensales int, canal text,
    estado text, cancelada_por text);
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

const uno = async (sql, p = []) => (await db.query(sql, p)).rows[0];
const valor = async (sql, p = []) => Object.values(await uno(sql, p))[0];
const cfg = (set) => db.exec(`update public.avisos_telegram_config set ${set} where id`);
const disparar = (accion) => valor(`select public.avisos_telegram_disparar($1)`, [accion]);
const comoAdmin = async (sql) => {
  await db.exec(`set role authenticated; set request.jwt.claims = '{"sub":"${ADMIN}","role":"authenticated"}';`);
  try { return await db.query(sql); } finally { await db.exec(`reset role; reset request.jwt.claims;`); }
};

// 1. Columnas, limpieza y permisos ──────────────────────────────────────────
igual(await uno(`select chat_reservas, chat_facturas, chat_resumenes, chat_fallos, fallos_desde from public.avisos_telegram_config`),
  { chat_reservas: null, chat_facturas: null, chat_resumenes: null, chat_fallos: null, fallos_desde: null }, "columnas nuevas vacías");
await comoAdmin(`update public.avisos_telegram_config set chat_reservas = '  -1001  ', chat_facturas = '', chat_resumenes = '@casatomas_res' where id`);
igual(await uno(`select chat_reservas, chat_facturas, chat_resumenes from public.avisos_telegram_config`),
  { chat_reservas: "-1001", chat_facturas: null, chat_resumenes: "@casatomas_res" }, "el trigger quita espacios y deja vacío = null");
await falla(cfg(`chat_fallos = 'no es un chat'`), /check/, "un chat mal escrito se rechaza");
await falla(comoAdmin(`update public.avisos_telegram_config set fallos_desde = now() where id`), /permission denied/,
  "fallos_desde no se puede poner a mano");
igual(await valor(`select has_column_privilege('authenticated', 'public.avisos_telegram_config', 'chat_fallos', 'UPDATE')`), true,
  "el panel puede cambiar los chats (la política exige super admin)");
igual(await valor(`select has_function_privilege('authenticated', 'public.avisos_telegram_canal(text)', 'execute')`), false,
  "el canal es solo para el servidor");
await cfg(`chat_reservas = null, chat_resumenes = null`);

// 2. Canal de cada tipo ─────────────────────────────────────────────────────
igual((await db.query(`select t, public.avisos_telegram_canal(t) c from unnest(array['reserva_nueva','reserva_cancelada','solicitud_pendiente',
  'facturas_margen_bajo','facturas_precio_sube','reservas_raras','peticion_urgente']) t`)).rows.map((r) => r.c),
  ["reservas", "reservas", "reservas", "facturas", "facturas", "facturas", "facturas"], "reservas y solicitudes → reservas; el resto → facturas");

// 3. El disparador pide el chat del canal ───────────────────────────────────
igual(await disparar("resumen"), "inactivo", "desactivado no hace nada");
await cfg(`activo = true, silencio_activo = false, hora_resumen = 0`);
igual([await disparar("pendientes"), await disparar("resumen"), await disparar("semanal"), await disparar("fallos")],
  ["sin_chat", "sin_chat", "sin_chat", "sin_chat"], "activo pero sin ningún chat: «sin_chat» en todas las acciones");
await cfg(`chat_id = '-100500'`);
igual([await disparar("resumen"), await disparar("fallos")], ["sin_vault", "sin_chat"],
  "con el chat general: el resumen llamaría; los fallos técnicos NO van al general");
await cfg(`chat_id = null, chat_resumenes = '-100600'`);
igual([await disparar("resumen"), await disparar("pendientes")], ["sin_vault", "sin_chat"], "el resumen va a su chat aunque no haya general");

// 4. hay_pendientes por canal ───────────────────────────────────────────────
await db.exec(`insert into public.notificaciones_dashboard (tipo, titulo) values ('facturas_margen_bajo', 'Margen bajo: Chuletón')`);
await cfg(`chat_reservas = '-100700'`);
igual([await valor(`select public.avisos_telegram_hay_pendientes()`), await disparar("pendientes")], [false, "nada"],
  "un margen bajo no cuenta si Facturas no tiene chat (ni hay general)");
await cfg(`chat_facturas = '-100800'`);
igual([await valor(`select public.avisos_telegram_hay_pendientes()`), await disparar("pendientes")], [true, "sin_vault"],
  "con chat de Facturas, sí");
await db.exec(`delete from public.notificaciones_dashboard;
  insert into public.reservas values ('${RESERVA}', (now() at time zone 'Europe/Madrid')::date, '21:00', 4, 'web', 'verificada', null);
  insert into public.notificaciones_dashboard (tipo, titulo, referencia_tipo, referencia_id) values ('reserva_nueva', 'Reserva nueva', 'reserva', '${RESERVA}');`);
await cfg(`chat_facturas = null`);
igual(await valor(`select public.avisos_telegram_hay_pendientes()`), true, "una reserva de hoy cuenta con el chat de Reservas");
await cfg(`chat_reservas = null, chat_facturas = '-100800'`);
igual(await valor(`select public.avisos_telegram_hay_pendientes()`), false, "y no cuenta si solo hay chat de Facturas");
await cfg(`chat_id = '-100500'`);
igual(await valor(`select public.avisos_telegram_hay_pendientes()`), true, "sin chat propio, la reserva usa el general");

// 5. Fallos técnicos: solo a su chat y sin soltar el atraso ─────────────────
await db.exec(`select public.fallo_interno_registrar('ocr_fallido', '{"trabajos": 2}'::jsonb)`); // el trigger dispara: «sin_chat», sin error
igual((await db.query(`select * from public.fallos_internos_reclamar(20)`)).rows.length, 0, "sin chat de fallos no se reclama nada");
await cfg(`chat_fallos = '-100900'`);
const desde1 = await valor(`select fallos_desde from public.avisos_telegram_config`);
assert.ok(desde1, "poner el chat de fallos apunta desde cuándo"); comprobaciones++;
igual([await disparar("fallos"), (await db.query(`select * from public.fallos_internos_reclamar(20)`)).rows.length], ["nada", 0],
  "el fallo de antes de poner el chat no se manda");
await db.exec(`select public.fallo_interno_registrar('ocr_fallido', '{"trabajos": 1}'::jsonb)`);
igual(await disparar("fallos"), "sin_vault", "uno nuevo sí: el disparador llamaría a la función");
igual((await db.query(`select tipo, datos from public.fallos_internos_reclamar(20)`)).rows, [{ tipo: "ocr_fallido", datos: { trabajos: 1 } }],
  "y la función solo reclama el nuevo");
await cfg(`chat_reservas = '-100700'`);
igual(await valor(`select fallos_desde from public.avisos_telegram_config`), desde1, "cambiar otro chat no mueve fallos_desde");

// 6. Vigilante ──────────────────────────────────────────────────────────────
await db.exec(`insert into public.ocr_trabajos (estado, error, terminado_at) values ('fallido', 'You have no credits', now() - interval '2 hours')`);
await cfg(`chat_fallos = null`);
igual(await valor(`select public.vigilante_fallos_telegram()`), "inactivo", "sin chat de fallos el vigilante no hace nada (aunque haya general)");
await cfg(`chat_fallos = '-100901'`);
igual(await valor(`select public.vigilante_fallos_telegram()`), "nada", "la lectura fallida de antes de poner el chat no cuenta");
await db.exec(`insert into public.ocr_trabajos (estado, error, terminado_at) values ('fallido', 'insufficient_quota', now())`);
igual(await valor(`select public.vigilante_fallos_telegram()`), "openai", "una nueva sí");
igual(await valor(`select (datos ->> 'trabajos')::int from public.fallos_internos where tipo = 'openai_sin_creditos'`), 1, "y cuenta solo la nueva");

// 7. Rollback y otra vez ────────────────────────────────────────────────────
await db.exec(ROLLBACK);
await db.exec(ROLLBACK); // idempotente
igual(await valor(`select count(*)::int from information_schema.columns where table_name = 'avisos_telegram_config'
  and column_name in ('chat_reservas','chat_facturas','chat_resumenes','chat_fallos','fallos_desde')`), 0, "el rollback quita las columnas");
igual(await valor(`select to_regprocedure('public.avisos_telegram_canal(text)') is null`), true, "y la función de canal");
igual(await disparar("resumen"), "sin_vault", "vuelve al chat único (chat_id)");
igual(await valor(`select public.vigilante_fallos_telegram()`), "nada", "el vigilante vuelve a funcionar con el chat general");
await db.exec(MIGRACION);
igual(await disparar("fallos"), "sin_chat", "aplicada otra vez: los fallos vuelven a necesitar su chat");

console.log(`telegram-canales: ${comprobaciones} comprobaciones OK`);
