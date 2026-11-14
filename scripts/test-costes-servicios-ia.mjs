// Super Admin › Servicios › Costes: el precio de todos los servicios y de las
// IAs (20261129153000) contra un Postgres en memoria (PGlite). Nunca toca
// Supabase.
//
//   npm run test:costes-ia:db
//
// Cubre: migración REAL aplicada dos veces (idempotente y sin pisar lo que
// haya escrito el dueño), columnas nuevas de servicios_contratados (para qué,
// precio confirmado, plan siguiente, su precio y qué pasa si se pasa) con sus
// límites y su permiso (solo super admin), `si_se_pasa` por métrica, el
// catálogo de funciones de IA (qué hace, acción, altas y «instrumentada»),
// ia_coste_por_uso (usos agrupados por trabajo de OCR o por ráfaga, mediana,
// filas sin tarifa que no suman, chat-web, servidor propio, día de Madrid y
// RLS) y el rollback.
import { PGlite } from "@electric-sql/pglite";
import { readFile } from "node:fs/promises";
import assert from "node:assert/strict";

const MIGRACION = await readFile("supabase/migrations/20261129153000_costes_servicios_ia.sql", "utf8");
const ROLLBACK = await readFile("supabase/rollbacks/20261129153000_costes_servicios_ia_ROLLBACK.sql", "utf8");

let comprobaciones = 0;
const ok = (v, msg) => { assert.ok(v, msg); comprobaciones++; };
const igual = (a, b, msg) => { assert.deepEqual(a, b, msg); comprobaciones++; };

const U = { SA: "a0000000-0000-0000-0000-000000000001", STAFF: "a0000000-0000-0000-0000-000000000002" };

// Tablas como en producción (las columnas que usa la migración) con su RLS de super admin.
const ANDAMIAJE = `
  create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
  create schema auth;
  create function auth.jwt() returns jsonb language sql stable as $$ select nullif(current_setting('request.jwt.claims', true), '')::jsonb $$;
  create function auth.uid() returns uuid language sql stable as $$ select (auth.jwt() ->> 'sub')::uuid $$;
  grant usage on schema public, auth to anon, authenticated, service_role;
  grant execute on all functions in schema auth to anon, authenticated, service_role;
  create table public.super_admins (user_id uuid primary key);
  create function public.is_super_admin(_user_id uuid) returns boolean language sql stable security definer set search_path = public
    as $f$ select exists (select 1 from public.super_admins where user_id = _user_id) $f$;
  grant execute on function public.is_super_admin(uuid) to authenticated, service_role;
  insert into public.super_admins values ('${U.SA}');

  create table public.servicios_contratados (
    proveedor text primary key, nombre text not null, plan text, precio_mensual numeric(10,2), moneda text not null default 'USD',
    ciclo text not null default 'mensual', limites jsonb not null default '{}'::jsonb, notas text,
    categoria text not null default 'otros', orden integer not null default 100, activo boolean not null default true,
    por_confirmar boolean not null default false, precio_anual numeric(12,2), fuente_precio text);
  alter table public.servicios_contratados enable row level security;
  grant select on public.servicios_contratados to authenticated;
  grant update (nombre, plan, precio_mensual, moneda, ciclo, limites, notas, categoria, orden, activo, por_confirmar, precio_anual, fuente_precio)
    on public.servicios_contratados to authenticated;
  create policy sel on public.servicios_contratados for select to authenticated using ((select public.is_super_admin((select auth.uid()))));
  create policy upd on public.servicios_contratados for update to authenticated
    using ((select public.is_super_admin((select auth.uid())))) with check ((select public.is_super_admin((select auth.uid()))));

  create table public.ia_funciones (funcion text primary key check (length(funcion) between 1 and 80), descripcion text not null,
    instrumentada boolean not null default false, unidad text not null default 'llamada', orden integer not null default 100, activo boolean not null default true);
  alter table public.ia_funciones enable row level security;
  grant select on public.ia_funciones to authenticated;
  create policy sel on public.ia_funciones for select to authenticated using ((select public.is_super_admin((select auth.uid()))));
  create table public.ia_modelo_funcion (funcion text primary key references public.ia_funciones(funcion) on delete restrict, modelo text);

  create table public.ia_uso (id bigint generated always as identity primary key, funcion text not null, operacion text not null default 'chat',
    modelo text not null, llamadas integer not null default 1, coste_usd numeric(12,6), estado text not null default 'ok',
    disparador text, created_at timestamptz not null default now());
  alter table public.ia_uso enable row level security;
  grant select on public.ia_uso to authenticated;
  create policy sel on public.ia_uso for select to authenticated using ((select public.is_super_admin((select auth.uid()))));
  create table public.chat_web_uso (id uuid primary key default gen_random_uuid(), estado text not null, modelo text,
    llamadas_openai integer not null default 0, coste_usd numeric(12,6), created_at timestamptz not null default now());
  alter table public.chat_web_uso enable row level security;
  grant select on public.chat_web_uso to authenticated;
  create policy sel on public.chat_web_uso for select to authenticated using ((select public.is_super_admin((select auth.uid()))));

  insert into public.servicios_contratados (proveedor, nombre, plan, precio_mensual, ciclo, limites, por_confirmar, moneda) values
    ('vercel', 'Vercel', 'Hobby', 0, 'gratuito', '{"cpu_activa": {"limite": 4, "unidad": "horas"}}', false, 'USD'),
    ('supabase', 'Supabase', 'Free', 0, 'gratuito', '{"bd_tamano": {"limite": 500, "unidad": "MB"}, "almacenamiento": {"limite": 1, "unidad": "GB", "si_se_pasa": "texto del dueño"}, "texto": "no es objeto"}', false, 'USD'),
    ('resend', 'Resend', 'Free (por confirmar)', 0, 'gratuito', '{"correos_mes": {"limite": 3000}}', true, 'USD'),
    ('loading', 'Loading', 'Por confirmar', null, 'anual', '{}', true, 'EUR'),
    ('nuevo_x', 'Otro', null, null, 'mensual', '{}', false, 'EUR');

  insert into public.ia_funciones (funcion, descripcion, instrumentada, unidad, orden) values
    ('ocr-trabajo', 'OCR en segundo plano', true, 'documento', 25),
    ('chat-facturas', 'Chatbot contable', false, 'pregunta', 30),
    ('traducir-contenido', 'Traduce platos', false, 'plato', 40),
    ('extraer-vino-foto', 'Vino desde foto', true, 'foto', 60),
    ('recortar-foto', 'Recorte', true, 'foto', 90),
    ('chat-web', 'Chat de la web', true, 'pregunta', 10),
    ('procesar-dibujo-perimetro', 'Huérfana', false, 'llamada', 60);
  -- Una que el dueño ya había descrito: no se pisa.
  alter table public.ia_funciones add column que_hace text;
  update public.ia_funciones set que_hace = 'Lo que escribió el dueño' where funcion = 'chat-web';

  -- IA de noviembre de 2026 (hora de Madrid).
  insert into public.ia_uso (funcion, operacion, modelo, llamadas, coste_usd, disparador, created_at) values
    -- OCR: el trabajo A son tres filas en 3 minutos (un documento); el B, una.
    ('ocr-trabajo', 'vision', 'gpt-5.6-luna', 1, 0.005, 'trabajo:aaaa#lectura', '2026-11-10 08:40:00+00'),
    ('ocr-trabajo', 'vision', 'gpt-5.6-luna', 1, 0.003, 'trabajo:aaaa#pie', '2026-11-10 08:43:00+00'),
    ('ocr-trabajo', 'embedding', 'text-embedding-3-small', 1, 0.000001, 'trabajo:aaaa#embeddings', '2026-11-10 08:43:05+00'),
    ('ocr-trabajo', 'vision', 'gpt-5.6-luna', 1, 0.004001, 'trabajo:bbbb#lectura', '2026-11-10 09:00:00+00'),
    -- Vino desde foto: dos peticiones del mismo usuario, cada una tres filas seguidas.
    ('extraer-vino-foto', 'vision', 'gpt-4.1', 2, 0.015, 'usuario:u1', '2026-11-12 16:56:04.315+00'),
    ('extraer-vino-foto', 'chat', 'gpt-4.1-mini', 1, 0.004, 'usuario:u1', '2026-11-12 16:56:04.487+00'),
    ('extraer-vino-foto', 'otro', 'openai-web-search-call', 1, 0.01, 'usuario:u1', '2026-11-12 16:56:04.596+00'),
    ('extraer-vino-foto', 'vision', 'gpt-4.1', 2, 0.008, 'usuario:u1', '2026-11-12 16:57:07.381+00'),
    ('extraer-vino-foto', 'chat', 'gpt-4.1-mini', 1, 0.004, 'usuario:u1', '2026-11-12 16:57:07.484+00'),
    ('extraer-vino-foto', 'otro', 'openai-web-search-call', 1, 0.01, 'usuario:u1', '2026-11-12 16:57:07.590+00'),
    -- Chat de Facturas: una pregunta con un modelo sin tarifa (no suma ni entra en la mediana) y otra con coste.
    ('chat-facturas', 'chat', 'gpt-6.1-terra', 2, null, 'usuario:u2', '2026-11-12 17:03:45.833+00'),
    ('chat-facturas', 'embedding', 'text-embedding-3-small', 1, 0, 'usuario:u2', '2026-11-12 17:03:46.000+00'),
    ('chat-facturas', 'chat', 'gpt-4.1-mini', 2, 0.002, 'usuario:u2', '2026-11-12 18:00:00+00'),
    -- Traducir: dos platos con medio minuto entre uno y otro.
    ('traducir-contenido', 'chat', 'gpt-4.1-mini', 1, 0.0006, 'usuario:u3', '2026-11-11 09:23:51+00'),
    ('traducir-contenido', 'chat', 'gpt-4.1-mini', 1, 0.0008, 'usuario:u3', '2026-11-11 09:24:21+00'),
    -- Recortes en nuestro servidor: gratis. El primero es el 1 de noviembre en Madrid (31/10 en UTC).
    ('recortar-foto', 'vision', 'vercel:recortar-foto', 1, 0, 'usuario:u4', '2026-10-31 23:30:00+00'),
    ('recortar-foto', 'vision', 'vercel:recortar-foto', 1, 0, 'usuario:u4', '2026-11-05 10:00:00+00'),
    -- Una función sin catálogo y una fila de octubre (fuera).
    ('funcion-nueva', 'chat', 'gpt-4.1-mini', 1, 0.001, null, '2026-11-06 10:00:00+00'),
    ('ocr-trabajo', 'vision', 'gpt-5.6-luna', 1, 9, 'trabajo:cccc#lectura', '2026-10-31 22:30:00+00');
  insert into public.chat_web_uso (estado, modelo, llamadas_openai, coste_usd, created_at) values
    ('ok', 'gpt-5.6-luna', 1, 0.0001, '2026-11-09 22:23:57+00'),
    ('ok', 'gpt-5.6-luna', 1, 0.0007, '2026-11-09 22:24:30+00'),
    ('reservado', 'gpt-5.6-luna', 0, 0, '2026-11-09 22:25:00+00');
`;

const db = new PGlite();
await db.exec(ANDAMIAJE);
await db.exec(MIGRACION);
await db.exec(MIGRACION); // idempotente
comprobaciones++;

const q = async (sql) => (await db.query(sql)).rows;
async function como(u, fn) {
  await db.exec("begin");
  try {
    await db.exec(`set local role authenticated;
      select set_config('request.jwt.claims', '${JSON.stringify({ sub: u, role: "authenticated" })}', true);`);
    const r = await fn();
    await db.exec("commit");
    return r;
  } catch (e) {
    await db.exec("rollback").catch(() => {});
    throw e;
  }
}
const servicio = async (p) => (await q(`select * from public.servicios_contratados where proveedor = '${p}'`))[0];

// 1. Semilla de servicios: para qué, plan siguiente, su precio y qué pasaría.
const vercel = await servicio("vercel");
ok(/webs/.test(vercel.para_que), "para qué se usa Vercel");
igual([vercel.plan_siguiente, Number(vercel.precio_siguiente)], ["Pro", 20], "plan siguiente de Vercel");
ok(/pausa/.test(vercel.si_se_pasa), "qué pasa si Vercel se pasa");
const supabase = await servicio("supabase");
igual([supabase.plan_siguiente, Number(supabase.precio_siguiente)], ["Pro", 25], "plan siguiente de Supabase");
ok(/solo lectura/.test(supabase.limites.bd_tamano.si_se_pasa), "qué pasa si la base de datos se pasa");
igual(supabase.limites.almacenamiento.si_se_pasa, "texto del dueño", "ha pisado el «qué pasa» que escribió el dueño");
igual(supabase.limites.texto, "no es objeto", "ha tocado una entrada de límites que no es un objeto");
ok(!("egreso" in supabase.limites), "ha creado una métrica que no existía (egreso)");
igual((await servicio("resend")).limites.correos_mes.si_se_pasa.includes("mes siguiente"), true, "qué pasa con los correos del mes");
const otro = await servicio("nuevo_x");
igual([otro.para_que, otro.plan_siguiente, otro.precio_siguiente, otro.si_se_pasa, otro.precio_confirmado_en], [null, null, null, null, null], "un servicio desconocido no recibe semilla");

// 2. El super admin edita las columnas nuevas; otro usuario no; los límites valen.
await como(U.SA, () => q(`update public.servicios_contratados set para_que = 'Lo nuestro', precio_confirmado_en = '2026-11-13',
  plan_siguiente = 'Business', precio_siguiente = 99.5, si_se_pasa = 'Se para', por_confirmar = false where proveedor = 'resend'`));
const resend = await servicio("resend");
igual([resend.para_que, resend.precio_confirmado_en.toISOString().slice(0, 10), resend.plan_siguiente, Number(resend.precio_siguiente), resend.si_se_pasa, resend.por_confirmar],
  ["Lo nuestro", "2026-11-13", "Business", 99.5, "Se para", false], "el super admin no puede confirmar el precio ni editar el plan siguiente");
const filasStaff = await como(U.STAFF, () => q("update public.servicios_contratados set para_que = 'x' where proveedor = 'vercel' returning proveedor"));
igual(filasStaff.length, 0, "un usuario sin super admin ha cambiado un servicio");
for (const [col, valor] of [["para_que", `'${"x".repeat(301)}'`], ["precio_siguiente", "-1"], ["plan_siguiente", `'${"x".repeat(81)}'`], ["si_se_pasa", `'${"x".repeat(501)}'`], ["precio_confirmado_en", "'2019-01-01'"]]) {
  await assert.rejects(db.query(`update public.servicios_contratados set ${col} = ${valor} where proveedor = 'vercel'`), /check constraint/, `${col} admite un valor no válido`);
  comprobaciones++;
}
// Volver a aplicar no pisa lo escrito.
await db.exec(MIGRACION);
igual((await servicio("resend")).plan_siguiente, "Business", "volver a aplicar la migración pisa el plan siguiente escrito");

// 3. Catálogo de IA.
const f = Object.fromEntries((await q("select * from public.ia_funciones")).map((r) => [r.funcion, r]));
igual(f["ocr-trabajo"].accion, "Leer una factura", "acción de ocr-trabajo");
igual(f["traducir-contenido"].accion, "Traducir un plato", "acción de traducir-contenido");
igual(f["extraer-vino-foto"].accion, "Leer la etiqueta de un vino", "acción de extraer-vino-foto");
igual(f["recortar-foto"].accion, "Recortar una foto", "acción de recortar-foto");
igual(f["chat-web"].que_hace, "Lo que escribió el dueño", "ha pisado el «qué hace» escrito");
igual(f["chat-web"].accion, "Contestar una pregunta en el chat de la web", "rellena la acción aunque ya hubiera «qué hace»");
igual(f["procesar-dibujo-perimetro"].accion, null, "una función sin uso no debería tener acción");
igual([f["chat-facturas"].instrumentada, f["traducir-contenido"].instrumentada, f["procesar-dibujo-perimetro"].instrumentada], [true, true, false], "marca de «instrumentada»");
ok(f["buscar-puntuacion-parker"]?.instrumentada === true && f["interpretar-reserva-manuscrita"]?.unidad === "reserva", "faltan las dos funciones que registraban sin catálogo");

// 4. ia_coste_por_uso.
const filas = await como(U.SA, () => q("select * from public.ia_coste_por_uso('2026-11-01', '2026-11-30')"));
const por = Object.fromEntries(filas.map((r) => [r.funcion, r]));
const n = (v) => (v === null ? null : Number(v));
igual(filas[0].funcion, "extraer-vino-foto", "la más cara va primero");
// OCR: dos documentos (A = 0,008001; B = 0,004001); la fila de octubre (9 $) fuera.
igual([n(por["ocr-trabajo"].usos), n(por["ocr-trabajo"].llamadas), n(por["ocr-trabajo"].coste_usd), n(por["ocr-trabajo"].mediana_usd)],
  [2, 4, 0.012002, 0.006001], "OCR: un uso por trabajo y su mediana");
igual(por["ocr-trabajo"].accion, "Leer una factura", "la acción sale con la fila");
// Vino: dos peticiones (0,029 y 0,022).
igual([n(por["extraer-vino-foto"].usos), n(por["extraer-vino-foto"].llamadas), n(por["extraer-vino-foto"].mediana_usd), n(por["extraer-vino-foto"].media_usd)],
  [2, 8, 0.0255, 0.0255], "vino desde foto: una petición = las tres filas seguidas");
// Chat de Facturas: la pregunta sin tarifa ni suma ni entra en la mediana, pero avisa.
const chat = por["chat-facturas"];
igual([n(chat.usos), n(chat.usos_con_coste), n(chat.coste_usd), n(chat.mediana_usd), n(chat.filas_sin_tarifa), chat.modelos_sin_tarifa],
  [2, 1, 0.002, 0.002, 1, ["gpt-6.1-terra"]], "chat de Facturas con un modelo sin tarifa");
igual([n(por["traducir-contenido"].usos), n(por["traducir-contenido"].mediana_usd)], [2, 0.0007], "traducir: un plato por petición");
igual([n(por["recortar-foto"].usos), n(por["recortar-foto"].mediana_usd), por["recortar-foto"].servidor_propio], [2, 0, true], "recortes: gratis, en nuestro servidor (y el del 1 de noviembre en Madrid cuenta)");
igual([n(por["chat-web"].usos), n(por["chat-web"].coste_usd), por["chat-web"].servidor_propio], [2, 0.0008, false], "chat de la web desde chat_web_uso (sin las reservadas)");
igual([por["funcion-nueva"].que_hace, por["funcion-nueva"].unidad, n(por["funcion-nueva"].usos)], [null, "llamada", 1], "una función sin catálogo también sale");
ok(!("procesar-dibujo-perimetro" in por), "una función sin uso no debería salir");
igual(por["extraer-vino-foto"].modelos_sin_tarifa, [], "sin modelos sin tarifa, lista vacía");
const vacio = await como(U.STAFF, () => q("select * from public.ia_coste_por_uso('2026-11-01', '2026-11-30')"));
igual(vacio.length, 0, "un usuario sin super admin ve el gasto de IA");
await assert.rejects(
  (async () => { await db.exec("begin; set local role anon;"); try { await db.query("select * from public.ia_coste_por_uso('2026-11-01', '2026-11-30')"); } finally { await db.exec("rollback"); } })(),
  /permission denied/,
  "anon puede llamar a ia_coste_por_uso",
);
comprobaciones++;
const octubre = await como(U.SA, () => q("select * from public.ia_coste_por_uso('2026-10-01', '2026-10-31')"));
igual(octubre.map((r) => [r.funcion, n(r.coste_usd)]), [["ocr-trabajo", 9]], "octubre en hora de Madrid");

// 5. Rollback.
await db.exec("insert into public.ia_modelo_funcion values ('interpretar-reserva-manuscrita', 'gpt-4.1')");
await db.exec(ROLLBACK);
await db.exec(ROLLBACK); // repetible
const cols = (await q(`select column_name from information_schema.columns where table_schema = 'public'
  and ((table_name = 'servicios_contratados' and column_name in ('para_que', 'precio_confirmado_en', 'plan_siguiente', 'precio_siguiente', 'si_se_pasa'))
    or (table_name = 'ia_funciones' and column_name in ('que_hace', 'accion')))`)).map((r) => r.column_name);
igual(cols, [], "el rollback deja columnas nuevas");
ok(!(await servicio("supabase")).limites.bd_tamano.si_se_pasa, "el rollback deja el «qué pasa» por métrica");
igual((await servicio("supabase")).limites.texto, "no es objeto", "el rollback rompe una entrada de límites que no es un objeto");
const quedan = (await q("select funcion from public.ia_funciones where funcion in ('buscar-puntuacion-parker', 'interpretar-reserva-manuscrita') order by 1")).map((r) => r.funcion);
igual(quedan, ["interpretar-reserva-manuscrita"], "el rollback borra una función que usa ia_modelo_funcion (o deja la otra)");
igual((await q("select count(*)::int c from pg_proc where proname = 'ia_coste_por_uso'"))[0].c, 0, "el rollback deja ia_coste_por_uso");

console.log(`costes_servicios_ia: OK (${comprobaciones} comprobaciones)`);
