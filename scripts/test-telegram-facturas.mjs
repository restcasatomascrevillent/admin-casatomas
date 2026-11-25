// Telegram › un mensaje por factura y cierre del día (20261222100000_telegram_facturas, 25/11/2026), contra un
// Postgres en memoria (PGlite). Nunca toca Supabase ni manda nada a Telegram.
//
//   node scripts/test-telegram-facturas.mjs
//
// Aplica las migraciones REALES de Telegram (20261126001000 … 20261217100000) y luego 20261222100000 dos veces
// (idempotente). Demuestra:
//   · columnas del cierre (activo, 22:00) y tipos al momento con Importes inusuales y Precio pactado roto, sin
//     duplicar al aplicarla otra vez;
//   · hay_pendientes cuenta las subidas de precio aunque no suenen en la campana (y el resto con campana apagada, no);
//   · disparar('cierre'): apagado o ya enviado hoy → no_toca; a su hora → llama (aquí, sin Vault: «sin_vault»);
//   · el registro de envíos admite 'cierre'; el rollback lo quita todo y la migración se puede volver a aplicar.
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
  "supabase/migrations/20261217100000_telegram_reservas_estado.sql",
].map(leer));
const MIGRACION = await leer("supabase/migrations/20261222100000_telegram_facturas.sql");
const ROLLBACK = await leer("supabase/rollbacks/20261222100000_telegram_facturas_ROLLBACK.sql");

let comprobaciones = 0;
const igual = (a, b, msg) => { assert.deepEqual(a, b, msg); comprobaciones++; };

const ADMIN = "a0000000-0000-0000-0000-000000000001";

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
const pendientes = () => valor(`select public.avisos_telegram_hay_pendientes()`);
const disparar = (accion) => valor(`select public.avisos_telegram_disparar($1)`, [accion]);

// 1. Configuración ──────────────────────────────────────────────────────────
igual(await valor(`select row_to_json(c)::jsonb - 'updated_at' - 'updated_by' from (select cierre_activo, cierre_hora, cierre_ultimo_dia from public.avisos_telegram_config) c`),
  { cierre_activo: true, cierre_hora: 22, cierre_ultimo_dia: null }, "cierre activo a las 22:00 por defecto");
igual(await valor(`select tipos_al_momento from public.avisos_telegram_config`),
  ["facturas_margen_bajo", "facturas_precio_sube", "facturas_importe_inusual", "facturas_precio_pactado"],
  "Importes inusuales y Precio pactado roto al momento, sin duplicar al aplicarla otra vez");
igual(await valor(`select has_column_privilege('authenticated', 'public.avisos_telegram_config', 'cierre_hora', 'update')`), true,
  "el super admin puede cambiar la hora del cierre");

// 2. hay_pendientes: subidas aunque no suenen ──────────────────────────────
await cfg(`activo = true, chat_facturas = '-100800', silencio_activo = false`);
await db.exec(`update public.avisos_telegram_config set activo_desde = now() - interval '1 hour' where id`);
await db.exec(`insert into public.notificaciones_dashboard (tipo, titulo, datos) values ('facturas_margen_bajo', 'Margen bajo', '{"campana": false}')`);
igual(await pendientes(), false, "un margen bajo con la campana apagada no cuenta");
await db.exec(`insert into public.notificaciones_dashboard (tipo, titulo, datos) values ('facturas_precio_sube', 'Gamba +31 %', '{"campana": false, "factura_id": 1}')`);
igual(await pendientes(), true, "una subida de precio sí, aunque no suene en la campana");
await cfg(`tipos_al_momento = array['facturas_margen_bajo']`);
igual(await pendientes(), false, "si se desmarca «Suben de precio», no");

// 3. disparar('cierre') ─────────────────────────────────────────────────────
await cfg(`chat_resumenes = '-100900', cierre_hora = 0`);
igual(await disparar("cierre"), "sin_vault", "a su hora llama a la función (aquí no hay Vault)");
await cfg(`cierre_ultimo_dia = (now() at time zone 'Europe/Madrid')::date`);
igual(await disparar("cierre"), "no_toca", "una vez al día");
await cfg(`cierre_ultimo_dia = null, cierre_activo = false`);
igual(await disparar("cierre"), "no_toca", "apagado, no");
await cfg(`cierre_activo = true, chat_resumenes = null, chat_id = null`);
igual(await disparar("cierre"), "sin_chat", "sin chat de Resúmenes (ni general), no");
igual(await disparar("semanal"), "sin_chat", "las demás acciones siguen igual");

// 4. Registro de envíos ─────────────────────────────────────────────────────
await db.exec(`insert into public.avisos_telegram_envios (tipo, ok) values ('cierre', true)`);
igual(await valor(`select count(*)::int from public.avisos_telegram_envios where tipo = 'cierre'`), 1, "el registro admite 'cierre'");

// 5. Rollback y otra vez ────────────────────────────────────────────────────
await db.exec(ROLLBACK);
await db.exec(ROLLBACK); // idempotente
igual(await valor(`select count(*)::int from information_schema.columns where table_name = 'avisos_telegram_config' and column_name like 'cierre%'`), 0,
  "el rollback quita las columnas del cierre");
igual(await valor(`select count(*)::int from public.avisos_telegram_envios where tipo = 'cierre'`), 0, "y los envíos 'cierre'");
igual(await valor(`select position('facturas_precio_sube' in pg_get_functiondef('public.avisos_telegram_hay_pendientes()'::regprocedure)) = 0`), true,
  "hay_pendientes vuelve a la versión de 20261217100000");
await assert.rejects(() => disparar("cierre"), /acción desconocida/, "disparar ya no conoce «cierre»");
comprobaciones++;
await db.exec(MIGRACION);
igual(await valor(`select cierre_hora from public.avisos_telegram_config`), 22, "aplicada otra vez, vuelve el cierre");

console.log(`telegram-facturas: ${comprobaciones} comprobaciones OK`);
