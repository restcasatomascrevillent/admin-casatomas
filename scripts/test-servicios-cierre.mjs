// Super Admin › Servicios: cierre de los gastos mensuales (20261209100000)
// contra un Postgres en memoria (PGlite). Nunca toca Supabase.
//
//   npm run test:servicios-cierre:db
//
// Cubre: migración REAL aplicada dos veces (idempotente), Loading fuera,
// Vercel en Pro sin los límites de Hobby y con el uso del periodo, Hostinger
// con su precio al año, el contador de cargas del mapa de vinos (lo suma
// cualquiera, solo lo lee un super admin, tope diario), la lectura de las
// cargas del mes, el cuadre de la IA con la factura de OpenAI (días UTC, RLS)
// y el rollback (todo como estaba).
import { PGlite } from "@electric-sql/pglite";
import { readFile } from "node:fs/promises";
import assert from "node:assert/strict";

const MIGRACION = await readFile("supabase/migrations/20261209100000_servicios_cierre.sql", "utf8");
const ROLLBACK = await readFile("supabase/rollbacks/20261209100000_servicios_cierre_ROLLBACK.sql", "utf8");

let comprobaciones = 0;
const ok = (v, msg) => { assert.ok(v, msg); comprobaciones++; };
const igual = (a, b, msg) => { assert.deepEqual(a, b, msg); comprobaciones++; };

const U = { SA: "a0000000-0000-0000-0000-000000000001", STAFF: "a0000000-0000-0000-0000-000000000002" };
const HOBBY = "https://vercel.com/docs/plans/hobby";

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
    por_confirmar boolean not null default false, precio_anual numeric(12,2), fuente_precio text, para_que text,
    precio_confirmado_en date, plan_siguiente text, precio_siguiente numeric(10,2), si_se_pasa text);
  insert into public.servicios_contratados (proveedor, nombre, plan, precio_mensual, moneda, ciclo, limites, activo, por_confirmar, plan_siguiente, precio_siguiente, para_que) values
    ('vercel', 'Vercel', 'Hobby', 0, 'USD', 'gratuito', '{
        "peticiones_cdn": {"limite": 1000000, "unidad": "peticiones", "fuente": "${HOBBY}"},
        "cpu_activa": {"limite": 4, "unidad": "horas", "fuente": "${HOBBY}"},
        "recortes_servidor_mes": {"limite": 600, "unidad": "fotos", "nota": "Tope nuestro"},
        "almacenamiento_despliegues": {"limite": null, "unidad": "GB", "fuente": "https://vercel.com/docs/limits"},
        "almacenamiento_funciones": {"limite": 5, "unidad": "GB", "fuente": "https://vercel.com/docs/functions/limitations"}
      }'::jsonb, true, false, 'Pro', 20, 'Publica las webs.'),
    ('hostinger', 'Hostinger', 'Por confirmar', null, 'EUR', 'anual', '{}'::jsonb, true, true, null, null, 'Dominio y alojamiento (falta confirmar si se usa).'),
    ('loading', 'Loading (dominio, correo y web antigua)', 'Por confirmar', null, 'EUR', 'anual', '{}'::jsonb, true, true, null, null, 'El dominio.'),
    ('mapbox', 'Mapbox (mapa de vinos)', 'Pago por uso', null, 'USD', 'por_uso', '{"cargas_mapa_web": {"limite": 50000, "unidad": "cargas", "nota": "vieja"}}'::jsonb, true, true, null, null, 'El mapa.'),
    ('openai', 'OpenAI', 'Pago por uso', null, 'USD', 'por_uso', '{}'::jsonb, true, false, null, null, 'La IA.');

  create table public.ia_funciones (funcion text primary key, descripcion text not null, instrumentada boolean not null default false,
    unidad text not null default 'llamada', orden integer not null default 100, activo boolean not null default true, que_hace text, accion text);
  insert into public.ia_funciones (funcion, descripcion) values ('procesar-dibujo-perimetro', 'gpt-5.4-mini, en código');

  create table public.ia_uso (id bigserial primary key, funcion text not null, modelo text not null, coste_usd numeric, created_at timestamptz not null default now());
  create table public.chat_web_uso (id bigserial primary key, coste_usd numeric, created_at timestamptz not null default now());
  create table public.openai_costes_diarios (fecha date not null, project_id text not null default '', line_item text not null, usd numeric not null, primary key (fecha, project_id, line_item));
  alter table public.ia_uso enable row level security;
  alter table public.chat_web_uso enable row level security;
  alter table public.openai_costes_diarios enable row level security;
  grant select on public.ia_uso, public.chat_web_uso, public.openai_costes_diarios to authenticated;
  create policy sa on public.ia_uso for select to authenticated using ((select public.is_super_admin((select auth.uid()))));
  create policy sa on public.chat_web_uso for select to authenticated using ((select public.is_super_admin((select auth.uid()))));
  create policy sa on public.openai_costes_diarios for select to authenticated using ((select public.is_super_admin((select auth.uid()))));

  create table public.web_eventos (evento_id bigserial primary key, sesion_id text, tipo text, entorno text, es_bot boolean default false,
    es_prueba boolean default false, es_interno boolean default false, ocurrido_en timestamptz default now());
`;

const db = new PGlite();
await db.exec(ANDAMIAJE);
const fila = async (sql, params = []) => (await db.query(sql, params)).rows[0];
const servicio = (p) => fila("select * from public.servicios_contratados where proveedor = $1", [p]);
async function como(rol, sub, fn) {
  await db.exec(`set role ${rol}; select set_config('request.jwt.claims', '${JSON.stringify({ sub, role: rol })}', false);`);
  try { return await fn(); } finally { await db.exec("reset role; select set_config('request.jwt.claims', '', false);"); }
}
const falla = async (fn, msg) => { let fallo = false; try { await fn(); } catch { fallo = true; } ok(fallo, msg); };

const antes = { vercel: await servicio("vercel"), hostinger: await servicio("hostinger"), loading: await servicio("loading"), mapbox: await servicio("mapbox") };

// ─── La migración, dos veces ────────────────────────────────────────────────
await db.exec(MIGRACION);
// Entre una y otra, el dueño retoca un límite y un precio: la segunda pasada no lo pisa.
await db.exec(`update public.servicios_contratados set limites = jsonb_set(limites, '{uso_periodo,limite}', '25'), precio_mensual = 21 where proveedor = 'vercel'`);
await db.exec(MIGRACION);

const loading = await servicio("loading");
igual(loading.activo, false, "Loading: ya no se usa");
igual(loading.por_confirmar, false, "Loading: nada que confirmar");

const vercel = await servicio("vercel");
igual([vercel.plan, vercel.ciclo, vercel.moneda, vercel.por_confirmar, vercel.plan_siguiente], ["Pro", "mensual", "USD", false, null], "Vercel: plan Pro al mes");
igual(Number(vercel.precio_mensual), 21, "Vercel: la segunda pasada no pisa el precio que retocó el dueño");
ok(vercel.precio_confirmado_en, "Vercel: precio confirmado");
igual(Object.keys(vercel.limites).sort(), ["almacenamiento_funciones", "recortes_servidor_mes", "uso_periodo"],
  "Vercel: fuera los límites de Hobby y el «sin dato» de almacenamiento; quedan los topes propios y los que tienen cifra");
igual([vercel.limites.uso_periodo.limite, vercel.limites.uso_periodo.unidad], [25, "USD"], "Vercel: uso del periodo (y no se pisa lo retocado)");
ok(/pro-plan/.test(vercel.limites.uso_periodo.fuente), "Vercel: el límite nuevo es del plan (tiene página oficial)");

const hostinger = await servicio("hostinger");
igual([hostinger.ciclo, Number(hostinger.precio_anual), hostinger.moneda, hostinger.por_confirmar], ["anual", 48.15, "EUR", false], "Hostinger: 48,15 € al año, confirmado");
ok(/2 buzones/.test(hostinger.plan) && /dominio/i.test(hostinger.plan), "Hostinger: un dominio y dos buzones");

ok(/contador propio/.test((await servicio("mapbox")).limites.cargas_mapa_web.nota), "Mapbox: nota del contador");
igual((await servicio("openai")).plan, "Pago por uso", "Lo demás no se toca");

const f = await fila("select instrumentada, accion, unidad from public.ia_funciones where funcion = 'procesar-dibujo-perimetro'");
igual([f.instrumentada, f.unidad], [true, "dibujo"], "procesar-dibujo-perimetro: instrumentada");
ok(f.accion, "procesar-dibujo-perimetro: con su frase");

// ─── Contador de cargas del mapa ────────────────────────────────────────────
igual((await fila("select public.servicios_cargas_mapa_vinos(now() - interval '40 days') as n")).n, 0, "Sin cargas todavía: 0, no «sin dato»");
await como("anon", null, async () => {
  for (let i = 0; i < 3; i++) await db.query("select public.mapa_vinos_contar_carga()");
  await falla(() => db.query("select * from public.mapa_vinos_cargas"), "anon no lee el contador");
  await falla(() => db.query("insert into public.mapa_vinos_cargas values (current_date, 99999)"), "anon no escribe el contador a mano");
  await falla(() => db.query("select public.servicios_cargas_mapa_vinos(now())"), "anon no lee las cargas del mes");
});
await como("authenticated", U.STAFF, async () => {
  await db.query("select public.mapa_vinos_contar_carga()");
  igual((await db.query("select * from public.mapa_vinos_cargas")).rows.length, 0, "Un usuario normal no ve el contador (RLS)");
});
await como("authenticated", U.SA, async () => {
  igual((await db.query("select cargas from public.mapa_vinos_cargas")).rows, [{ cargas: 4 }], "El super admin ve las cargas de hoy");
});
await db.exec(`insert into public.mapa_vinos_cargas values (date '2020-01-15', 500), ((now() at time zone 'utc')::date - 1, 6)`);
igual((await fila("select public.servicios_cargas_mapa_vinos(date_trunc('day', now() at time zone 'utc') at time zone 'utc' - interval '1 day') as n")).n, 10,
  "Cargas desde una fecha: solo los días de después");
// Si un día llega el evento de los logs y da más, manda la cifra mayor.
await db.exec(`insert into public.web_eventos (sesion_id, tipo, entorno) select 's' || g, 'mapa_vinos', 'produccion' from generate_series(1, 12) g`);
igual((await fila("select public.servicios_cargas_mapa_vinos(now() - interval '1 day') as n")).n, 12, "Con más sesiones en los logs que cargas contadas, las sesiones");
await db.exec(`update public.mapa_vinos_cargas set cargas = 200000 where dia = (now() at time zone 'utc')::date; select public.mapa_vinos_contar_carga();`);
igual((await fila("select cargas from public.mapa_vinos_cargas where dia = (now() at time zone 'utc')::date")).cargas, 200000, "Tope diario: no se infla sin fin");

// ─── Cuadre con la factura de OpenAI ────────────────────────────────────────
await db.exec(`
  insert into public.openai_costes_diarios (fecha, line_item, usd) values
    ('2026-11-01', 'gpt, input', 1.00), ('2026-11-01', 'gpt, output', 0.50), ('2026-11-02', 'gpt, input', 2.00), ('2026-10-31', 'gpt, input', 9.00);
  insert into public.ia_uso (funcion, modelo, coste_usd, created_at) values
    ('ocr-trabajo', 'gpt-5.6-luna', 1.00, '2026-11-01T10:00:00Z'),
    ('ocr-trabajo', 'gpt-5.6-luna', null, '2026-11-01T11:00:00Z'),          -- sin tarifa: no suma
    ('recortar-foto', 'vercel:recortar-foto', 0.30, '2026-11-01T12:00:00Z'), -- nuestro servidor: no es OpenAI
    ('buscar-precios-mercado', 'sonar-pro', 0.40, '2026-11-01T12:00:00Z'),   -- Perplexity: no es OpenAI
    ('chat-facturas', 'gpt-4.1-mini', 0.50, '2026-11-02T23:30:00Z'),
    ('chat-facturas', 'gpt-4.1-mini', 7.00, '2026-11-03T00:30:00Z'),         -- día 3 (UTC): OpenAI aún no lo ha publicado
    ('chat-facturas', 'gpt-4.1-mini', 5.00, '2026-10-31T23:59:00Z');         -- octubre
  insert into public.chat_web_uso (coste_usd, created_at) values (0.25, '2026-11-02T09:00:00Z');
`);
await como("authenticated", U.SA, async () => {
  igual((await db.query("select public.ia_cuadre_openai('2026-11-01', '2026-11-30') as c")).rows[0].c,
    { dias: 2, primer_dia: "2026-11-01", ultimo_dia: "2026-11-02", real_usd: 3.5, registrado_usd: 1.75 },
    "Cuadre: solo los días publicados, en UTC, sin lo que no es de OpenAI; lo de la web del chat también cuenta");
  igual((await db.query("select public.ia_cuadre_openai('2026-12-01', '2026-12-31') as c")).rows[0].c,
    { dias: 0, primer_dia: null, ultimo_dia: null, real_usd: 0, registrado_usd: 0 }, "Cuadre: mes sin días publicados");
});
await como("authenticated", U.STAFF, async () => {
  igual((await db.query("select public.ia_cuadre_openai('2026-11-01', '2026-11-30') as c")).rows[0].c.dias, 0, "Cuadre: quien no es super admin no ve nada (RLS)");
});
await como("anon", null, () => falla(() => db.query("select public.ia_cuadre_openai('2026-11-01', '2026-11-30')"), "anon no puede pedir el cuadre"));

// ─── Rollback: todo como estaba ─────────────────────────────────────────────
await db.exec(ROLLBACK);
for (const p of Object.keys(antes)) igual(await servicio(p), antes[p], `Rollback: ${p} como estaba`);
igual((await fila("select to_regclass('public.mapa_vinos_cargas') as t, to_regclass('public.servicios_contratados_copia_cierre') as c")), { t: null, c: null }, "Rollback: sin contador ni copia");
igual((await fila("select public.servicios_cargas_mapa_vinos(now() - interval '1 day') as n")).n, 12, "Rollback: las cargas vuelven a salir de los logs");
igual((await fila("select instrumentada from public.ia_funciones where funcion = 'procesar-dibujo-perimetro'")).instrumentada, false, "Rollback: la función, como antes");
await db.exec(ROLLBACK); // dos veces: no falla
await db.exec(MIGRACION); // y se puede volver a aplicar
igual((await servicio("vercel")).plan, "Pro", "Tras el rollback se puede volver a aplicar");

console.log(`✓ servicios-cierre: ${comprobaciones} comprobaciones`);
