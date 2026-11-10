// Super Admin › Servicios: servicios_contratados, servicios_uso, servicios_config
// y sus RPC contra un Postgres en memoria (PGlite). Nunca toca Supabase.
//
//   npm run test:servicios:db
//
// Cubre las migraciones REALES 20261103120000 (tablas, RLS, auditoría) y
// 20261103160000 (planes, coste y uso de todos los servicios), aplicadas dos
// veces (idempotentes y sin pisar lo editado): la lista de exclusión de
// auditoría (servicios_uso sin trigger; servicios_contratados y
// servicios_config auditadas), RLS solo super admin (y sesión de panel viva),
// columnas editables, validación de límites, URL, categoría y precios, quién
// editó, la última lectura por proveedor con su coste variable, el tipo de
// cambio editable, las métricas sin token (BD, IA, Stripe, llamadas) solo para
// service_role, la semilla de los proveedores nuevos y los dos rollbacks.
// Y 20261104121000 (Configurar): altas y borrado de lo quitado, solo super
// admin, con sus lecturas, y su rollback.
import { PGlite } from "@electric-sql/pglite";
import { readFile } from "node:fs/promises";
import assert from "node:assert/strict";

const MIGRACION = await readFile("supabase/migrations/20261103120000_servicios_contratados.sql", "utf8");
const ROLLBACK = await readFile("supabase/rollbacks/20261103120000_servicios_contratados_ROLLBACK.sql", "utf8");
const MIGRACION_2 = await readFile("supabase/migrations/20261103160000_servicios_planes_costes.sql", "utf8");
const ROLLBACK_2 = await readFile("supabase/rollbacks/20261103160000_servicios_planes_costes_ROLLBACK.sql", "utf8");
const MIGRACION_3 = await readFile("supabase/migrations/20261104121000_servicios_configurables.sql", "utf8");
const ROLLBACK_3 = await readFile("supabase/rollbacks/20261104121000_servicios_configurables_ROLLBACK.sql", "utf8");
const MIGRACION_4 = await readFile("supabase/migrations/20261112120000_servicios_github_minutos.sql", "utf8");
const ROLLBACK_4 = await readFile("supabase/rollbacks/20261112120000_servicios_github_minutos_ROLLBACK.sql", "utf8");
const MIGRACION_5 = await readFile("supabase/migrations/20261120110000_servicios_estado_detalle.sql", "utf8");
const ROLLBACK_5 = await readFile("supabase/rollbacks/20261120110000_servicios_estado_detalle_ROLLBACK.sql", "utf8");
const MIGRACION_6 = await readFile("supabase/migrations/20261122153000_servicios_costes_mes.sql", "utf8");
const ROLLBACK_6 = await readFile("supabase/rollbacks/20261122153000_servicios_costes_mes_ROLLBACK.sql", "utf8");

let comprobaciones = 0;
const ok = (v, msg) => { assert.ok(v, msg); comprobaciones++; };
const igual = (a, b, msg) => { assert.deepEqual(a, b, msg); comprobaciones++; };

// Andamiaje mínimo de Supabase + una versión reducida del sistema de auditoría
// con la MISMA forma de lista de exclusión que 20261007220000/20261009100000
// ('ia_uso', … dentro de NOT IN), para comprobar que la migración la amplía.
const LISTA = `'audit_log','ia_uso','openai_uso_diario','metricas'`;
const ANDAMIAJE = `
  create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
  create schema auth; create schema private; create schema storage;
  create table auth.users (id uuid primary key, email text, banned_until timestamptz, last_sign_in_at timestamptz);
  create table auth.sessions (id uuid primary key, user_id uuid, updated_at timestamptz default now());
  create function auth.jwt() returns jsonb language sql stable as $$ select nullif(current_setting('request.jwt.claims', true), '')::jsonb $$;
  create function auth.uid() returns uuid language sql stable as $$ select (auth.jwt() ->> 'sub')::uuid $$;
  create table storage.objects (id uuid primary key default gen_random_uuid(), name text, metadata jsonb);
  grant usage on schema public, auth, private to anon, authenticated, service_role;
  grant execute on all functions in schema auth to anon, authenticated, service_role;

  create table public.super_admins (user_id uuid primary key);
  create function public.is_super_admin(_user_id uuid) returns boolean language sql stable security definer set search_path = public
    as $f$ select exists (select 1 from public.super_admins where user_id = _user_id) $f$;
  grant execute on function public.is_super_admin(uuid) to authenticated, service_role;
  create function private.sesion_panel_permitida() returns boolean language sql stable security definer set search_path = '' as $f$
    select auth.uid() is not null and exists (
      select 1 from auth.users u where u.id = auth.uid() and (u.banned_until is null or u.banned_until <= now())
        and exists (select 1 from auth.sessions s where s.user_id = u.id and s.id::text = auth.jwt()->>'session_id')) $f$;
  revoke all on function private.sesion_panel_permitida() from public;
  grant execute on function private.sesion_panel_permitida() to authenticated;

  create table public.envios_email_reserva (id uuid primary key default gen_random_uuid(), resultado text, creado_at timestamptz default now(), enviado_at timestamptz);
  create table public.newsletter_envios (id uuid primary key default gen_random_uuid(), canal text, estado text, total_destinatarios int, created_at timestamptz default now());
  create table public.newsletter_suscriptores (id uuid primary key default gen_random_uuid(), email text, activo boolean);
  -- Tablas que lee 20261103160000 (columnas que usa, como en producción).
  create table public.openai_costes_diarios (fecha date not null, project_id text not null default '', line_item text not null default '', usd numeric(16,6) not null, primary key (fecha, project_id, line_item));
  create table public.ia_uso (id bigserial primary key, funcion text, coste_usd numeric, created_at timestamptz not null default now());
  create table public.configuracion_facturas (id boolean primary key default true, tope_ia_mes_eur numeric(8,2) not null default 5);
  create table public.tipo_cambio_usd_eur (fecha date primary key, eur_por_usd numeric(12,6) not null, fuente text not null default 'bce');
  create table public.cheques_regalo (id uuid primary key default gen_random_uuid(), importe_eur numeric, estado text, origen text, stripe_payment_intent_id text, stripe_fee_eur numeric(10,2), created_at timestamptz default now());
  create table public.call_logs (id uuid primary key default gen_random_uuid(), started_at timestamptz, duration_seconds int, cost_total_usd numeric, cost_total_eur numeric);

  create table public.audit_log (id bigserial primary key, tabla text, accion text, actor uuid);
  create function public.fn_registrar_auditoria() returns trigger language plpgsql security definer set search_path = public as $f$
  begin
    insert into public.audit_log (tabla, accion, actor) values (TG_TABLE_NAME, lower(TG_OP), auth.uid());
    if TG_OP = 'DELETE' then return old; end if; return new;
  end $f$;
  create function public.instalar_auditoria_panel() returns void language plpgsql security definer set search_path = public as $f$
  declare r record;
  begin
    for r in select c.relname as tabla from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where c.relkind = 'r' and n.nspname = 'public' and c.relname not in (${LISTA})
    loop
      execute format('drop trigger if exists trg_auditoria on public.%I', r.tabla);
      execute format('create trigger trg_auditoria after insert or update or delete on public.%I for each row execute function public.fn_registrar_auditoria()', r.tabla);
    end loop;
  end $f$;
  create function public.fn_audit_nueva_tabla() returns event_trigger language plpgsql security definer set search_path = pg_catalog as $f$
  declare r record;
  begin
    for r in select c.relname as tabla from pg_event_trigger_ddl_commands() d join pg_class c on c.oid = d.objid
      join pg_namespace n on n.oid = c.relnamespace
      where d.object_type = 'table' and c.relkind = 'r' and n.nspname = 'public' and c.relname not in (${LISTA})
    loop
      execute format('drop trigger if exists trg_auditoria on public.%I', r.tabla);
      execute format('create trigger trg_auditoria after insert or update or delete on public.%I for each row execute function public.fn_registrar_auditoria()', r.tabla);
    end loop;
  end $f$;
  create event trigger audit_panel_nuevas_tablas on ddl_command_end when tag in ('CREATE TABLE') execute function public.fn_audit_nueva_tabla();
`;

const U = {
  SA: "a0000000-0000-0000-0000-000000000001",
  STAFF: "a0000000-0000-0000-0000-000000000002",
  SA_BLOQ: "a0000000-0000-0000-0000-000000000003",
  SA2: "a0000000-0000-0000-0000-000000000004",
};
const sesion = (u) => u.replace(/^a/, "b");
// Fechas relativas al «ahora» de la BD (la prueba vale cualquier día del mes).
const MES = `(date_trunc('month', now(), 'UTC') at time zone 'UTC')::date`;
const HOY = `(now() at time zone 'UTC')::date`;
const DATOS = `
  insert into auth.users (id, email, banned_until, last_sign_in_at) values
    ('${U.SA}', 'sa@t', null, now()), ('${U.STAFF}', 'staff@t', null, now() - interval '70 days'),
    ('${U.SA_BLOQ}', 'bloq@t', now() + interval '1 day', null), ('${U.SA2}', 'sa2@t', null, null);
  insert into auth.sessions (id, user_id, updated_at) values
    ('${sesion(U.SA)}', '${U.SA}', now()), ('${sesion(U.STAFF)}', '${U.STAFF}', now() - interval '70 days'),
    ('${sesion(U.SA_BLOQ)}', '${U.SA_BLOQ}', now() - interval '70 days'), ('${sesion(U.SA2)}', '${U.SA2}', now());
  insert into public.super_admins values ('${U.SA}'), ('${U.SA_BLOQ}'), ('${U.SA2}');
  insert into storage.objects (name, metadata) values ('a.jpg', '{"size": 1000}'), ('b.jpg', '{"size": 2500}'), ('c', '{"size": "x"}'), ('d', null);
  insert into public.envios_email_reserva (resultado, enviado_at) values
    ('enviado', now()), ('enviado', now()), ('fallido', now()), ('enviado', now() - interval '40 days'), ('pendiente', null);
  insert into public.newsletter_envios (canal, estado, total_destinatarios) values
    ('transaccional', 'completado', 7), ('transaccional', 'fallido', 50), ('broadcast', 'completado', 300);
  insert into public.newsletter_suscriptores (email, activo) values ('x@t', true), ('y@t', true), ('z@t', false);

  -- IA: 2,5 US$ facturados el día 1 (cerrado salvo que hoy sea día 1), 9 de hoy
  -- (OpenAI aún no lo ha cerrado: no cuenta) y 100 del mes pasado (fuera).
  insert into public.openai_costes_diarios (fecha, project_id, usd) values
    (${MES}, 'proj_a', 2.5), (${HOY}, 'proj_hoy', 9), (${MES} - 1, 'proj_a', 100);
  insert into public.ia_uso (funcion, coste_usd, created_at) values
    ('chat-facturas', 0.4, now()), ('ocr-trabajo', 0.1, date_trunc('month', now(), 'UTC') + interval '1 hour'),
    ('chat-facturas', 5, date_trunc('month', now(), 'UTC') - interval '1 day');
  insert into public.configuracion_facturas (id, tope_ia_mes_eur) values (true, 8);
  insert into public.tipo_cambio_usd_eur (fecha, eur_por_usd) values ('2026-10-23', 0.893416), ('2026-10-26', 0.893815);
  -- Stripe: 2 cobros de la web este mes (uno con comisión real 1,00 y otro sin
  -- ella: 20 × 1,5 % + 0,25 = 0,55); manual, pendiente y del mes pasado, fuera.
  insert into public.cheques_regalo (importe_eur, estado, origen, stripe_payment_intent_id, stripe_fee_eur, created_at) values
    (50, 'pagado', 'web', 'pi_1', 1.00, now()), (20, 'pagado', 'web', 'pi_2', null, now()),
    (30, 'pagado', 'manual', null, null, now()), (40, 'pendiente', 'web', 'pi_3', null, now()),
    (60, 'pagado', 'web', 'pi_4', 1.15, date_trunc('month', now(), 'UTC') - interval '1 day');
  insert into public.call_logs (started_at, duration_seconds, cost_total_usd, cost_total_eur) values
    (now(), 120, 0.3, 0.27), (now(), 60, 0.2, null), (date_trunc('month', now(), 'UTC') - interval '1 day', 999, 9, 8);
`;

const NUEVOS = ["google", "google_drive", "hostinger", "loading", "mapbox", "openai", "perplexity", "vapi"];
const TODOS = ["github", "google", "google_drive", "hostinger", "loading", "mapbox", "openai", "perplexity", "resend", "stripe", "supabase", "vapi", "vercel"];

const db = new PGlite();
await db.exec(ANDAMIAJE);
await db.exec(DATOS);
await db.exec(MIGRACION);
await db.exec(MIGRACION); // idempotente
await db.exec(MIGRACION_2);
await db.exec(MIGRACION_2); // idempotente
comprobaciones++;

const q = (sql, params) => db.query(sql, params);
async function como(u, fn, rol = "authenticated") {
  await db.exec("begin");
  try {
    if (rol === "service_role") await db.exec("set local role service_role;");
    else if (rol === "anon") await db.exec("set local role anon;");
    else await db.exec(`set local role authenticated;
      select set_config('request.jwt.claims', '${JSON.stringify({ sub: u, role: "authenticated", session_id: sesion(u) })}', true);`);
    const r = await fn();
    await db.exec("commit");
    return r;
  } catch (e) {
    await db.exec("rollback").catch(() => {});
    throw e;
  }
}
const rechaza = async (u, sql, patron, msg, rol) => {
  await assert.rejects(como(u, () => q(sql), rol), patron, msg);
  comprobaciones++;
};

// 1. Auditoría: la lista de exclusión crece y solo se audita la configuración.
for (const fn of ["instalar_auditoria_panel", "fn_audit_nueva_tabla"]) {
  const def = (await q(`select pg_get_functiondef('public.${fn}'::regproc) d`)).rows[0].d;
  ok(def.includes("'servicios_uso'"), `${fn} no excluye servicios_uso`);
  igual(def.split("'servicios_uso'").length - 1, 1, `${fn}: servicios_uso repetido tras aplicar dos veces`);
}
const triggers = async (tabla) => (await q(`select count(*)::int n from pg_trigger where tgrelid = 'public.${tabla}'::regclass and tgname = 'trg_auditoria'`)).rows[0].n;
igual(await triggers("servicios_contratados"), 1, "servicios_contratados sin trigger de auditoría");
igual(await triggers("servicios_config"), 1, "servicios_config sin trigger de auditoría");
igual(await triggers("servicios_uso"), 0, "servicios_uso con trigger de auditoría (es un dato derivado)");
await q("select public.instalar_auditoria_panel()");
igual(await triggers("servicios_uso"), 0, "reinstalar la auditoría vuelve a poner el trigger en servicios_uso");

// 2. Semilla: los 5 de la primera migración y los 8 nuevos.
const proveedores = (await q("select proveedor from public.servicios_contratados order by proveedor")).rows.map((r) => r.proveedor);
igual(proveedores, TODOS, "semilla de proveedores");
const vercel = (await q("select * from public.servicios_contratados where proveedor = 'vercel'")).rows[0];
igual([vercel.plan, Number(vercel.precio_mensual), vercel.ciclo], ["Hobby", 0, "gratuito"], "plan de Vercel");
igual(vercel.limites.peticiones_cdn.limite, 1000000, "límite de peticiones de Vercel");
ok(/^https:\/\/vercel\.com\/docs\//.test(vercel.limites.peticiones_cdn.fuente), "límite de Vercel sin fuente oficial");
igual((await q("select limites->'bd_tamano'->>'limite' l from public.servicios_contratados where proveedor = 'supabase'")).rows[0].l, "500", "límite de BD de Supabase");
igual((await q("select limites from public.servicios_contratados where proveedor = 'stripe'")).rows[0].limites, {}, "Stripe no tiene límites");
// Primera vez: categoría, orden, fuente y «por confirmar» de los 5 de antes.
const viejos = (await q("select proveedor, categoria, orden, fuente_precio, por_confirmar, activo from public.servicios_contratados where proveedor in ('vercel','supabase','github','resend','stripe') order by orden")).rows;
igual(viejos.map((r) => [r.proveedor, r.categoria, r.orden]), [
  ["vercel", "alojamiento", 10], ["supabase", "base_datos", 20], ["github", "codigo", 30], ["resend", "correo", 40], ["stripe", "pagos", 50],
], "categoría y orden de los 5 primeros");
ok(viejos.every((r) => /^https:\/\//.test(r.fuente_precio) && r.activo), "fuente del precio o «lo usamos» de los 5 primeros");
igual(viejos.filter((r) => r.por_confirmar).map((r) => r.proveedor), ["resend"], "solo Resend queda por confirmar de los 5 primeros");
ok(vercel.cuenta.includes("touza-casatomas"), "la cuenta de Vercel no menciona el proyecto touza-casatomas");
// Los nuevos.
const nuevos = (await q(`select * from public.servicios_contratados where proveedor = any($1) order by proveedor`, [NUEVOS])).rows;
ok(nuevos.every((r) => /^https:\/\//.test(r.panel_url) && /^https:\/\//.test(r.fuente_precio)), "proveedor nuevo sin enlace al panel o sin fuente del precio");
igual(nuevos.filter((r) => !r.activo).map((r) => r.proveedor), ["perplexity"], "solo Perplexity sale como «no lo usamos»");
igual(nuevos.filter((r) => !r.por_confirmar).map((r) => r.proveedor), ["openai"], "proveedores nuevos que no están por confirmar");
const porProv = Object.fromEntries(nuevos.map((r) => [r.proveedor, r]));
igual([porProv.openai.ciclo, porProv.openai.moneda, porProv.openai.categoria], ["por_uso", "USD", "ia"], "OpenAI: pago por uso en USD");
ok(!("limite" in porProv.openai.limites.gasto_ia_mes) && /Costes/.test(porProv.openai.limites.gasto_ia_mes.limite_desde), "el límite del gasto de IA debe venir del tope de Costes");
igual(porProv.google.limites.consultas_ficha_resenas.limite, 1000, "uso gratuito de Place Details con reseñas");
igual(porProv.mapbox.limites.cargas_mapa_web.limite, 50000, "cargas gratuitas de Mapbox");
igual(porProv.vapi.limites.llamadas_simultaneas.limite, 4, "llamadas a la vez de Vapi");
igual(porProv.google_drive.limites.almacenamiento.limite, 15, "espacio gratuito de Google");
igual([porProv.hostinger.ciclo, porProv.loading.ciclo, porProv.loading.categoria], ["anual", "anual", "dominio"], "Hostinger y Loading: anuales, de dominio");
ok(/controldeservidor\.com/.test(porProv.loading.cuenta) && /Hostinger/.test(porProv.hostinger.notas) && /Loading/.test(porProv.hostinger.notas), "Hostinger/Loading sin la explicación del DNS");
for (const r of nuevos) {
  for (const [clave, l] of Object.entries(r.limites)) if (l.fuente) ok(/^https:\/\//.test(l.fuente), `${r.proveedor}.${clave}: fuente sin https`);
}
// Tipo de cambio: nace con el último del BCE.
igual(Number((await q("select eur_por_usd from public.servicios_config")).rows[0].eur_por_usd), 0.893815, "el tipo de cambio no nace con el último del BCE");

// 3. RLS: solo super admin con sesión viva.
igual((await como(U.SA, () => q("select count(*)::int n from public.servicios_contratados"))).rows[0].n, 13, "el super admin no ve los servicios");
igual((await como(U.STAFF, () => q("select count(*)::int n from public.servicios_contratados"))).rows[0].n, 0, "un usuario normal ve los servicios");
igual((await como(U.SA_BLOQ, () => q("select count(*)::int n from public.servicios_contratados"))).rows[0].n, 0, "un super admin bloqueado ve los servicios");
await rechaza(null, "select * from public.servicios_contratados", /permission denied/, "anon lee los servicios", "anon");
igual((await como(U.SA, () => q("select count(*)::int n from public.servicios_config"))).rows[0].n, 1, "el super admin no ve el tipo de cambio");
igual((await como(U.STAFF, () => q("select count(*)::int n from public.servicios_config"))).rows[0].n, 0, "un usuario normal ve el tipo de cambio");
igual((await como(U.SA_BLOQ, () => q("select count(*)::int n from public.servicios_config"))).rows[0].n, 0, "un super admin bloqueado ve el tipo de cambio");
await rechaza(null, "select * from public.servicios_config", /permission denied/, "anon lee el tipo de cambio", "anon");

// 4. Edición: columnas permitidas, quién y cuándo, y auditoría.
const antes = (await q("select count(*)::int n from public.audit_log where tabla = 'servicios_contratados'")).rows[0].n;
const editado = await como(U.SA, () => q(`update public.servicios_contratados set plan = 'Pro', precio_mensual = 20, notas = 'Subimos de plan',
  limites = jsonb_set(limites, '{peticiones_cdn,limite}', '10000000') where proveedor = 'vercel' returning plan, actualizado_por, actualizado_en`));
igual(editado.rows.length, 1, "el super admin no pudo editar");
igual(editado.rows[0].actualizado_por, U.SA, "actualizado_por no es quien editó");
ok(new Date(editado.rows[0].actualizado_en) >= new Date(vercel.actualizado_en), "actualizado_en no avanza");
igual((await q("select count(*)::int n from public.audit_log where tabla = 'servicios_contratados'")).rows[0].n, antes + 1, "la edición no quedó auditada");
const nuevasColumnas = await como(U.SA, () => q(`update public.servicios_contratados set categoria = 'dominio', orden = 5, activo = false, por_confirmar = false,
  ciclo = 'anual', precio_anual = 14.99, precio_mensual = null, fuente_precio = 'https://www.loading.es/dominios/index.html', renovacion = '2027-03-01'
  where proveedor = 'loading' returning categoria, orden, activo, precio_anual`));
igual(nuevasColumnas.rows.map((r) => [r.categoria, r.orden, r.activo, Number(r.precio_anual)]), [["dominio", 5, false, 14.99]], "el super admin no pudo editar las columnas nuevas");
igual((await como(U.STAFF, () => q("update public.servicios_contratados set plan = 'X' where proveedor = 'vercel' returning 1"))).rows.length, 0, "un usuario normal editó");
igual((await como(U.SA_BLOQ, () => q("update public.servicios_contratados set plan = 'X' where proveedor = 'vercel' returning 1"))).rows.length, 0, "un super admin bloqueado editó");
await rechaza(U.SA, "update public.servicios_contratados set proveedor = 'otro' where proveedor = 'vercel'", /permission denied/, "se cambió el proveedor");
await rechaza(U.SA, "update public.servicios_contratados set actualizado_por = null where proveedor = 'vercel'", /permission denied/, "se falseó actualizado_por");
await rechaza(U.SA, "insert into public.servicios_contratados (proveedor, nombre) values ('nuevo', 'Nuevo')", /permission denied/, "el super admin dio de alta un proveedor");
await rechaza(U.SA, "delete from public.servicios_contratados where proveedor = 'stripe'", /permission denied/, "el super admin borró un proveedor");
await assert.rejects(q("update public.servicios_contratados set proveedor = 'otro' where proveedor = 'vercel'"), /no se puede cambiar/, "service_role cambió el proveedor"); comprobaciones++;

// 4b. Tipo de cambio: lo cambia el super admin (auditado y con quién), nadie más.
const antesConfig = (await q("select count(*)::int n from public.audit_log where tabla = 'servicios_config'")).rows[0].n;
const cambio = await como(U.SA, () => q("update public.servicios_config set eur_por_usd = 0.9 returning eur_por_usd, actualizado_por"));
igual([Number(cambio.rows[0].eur_por_usd), cambio.rows[0].actualizado_por], [0.9, U.SA], "el super admin no pudo cambiar el tipo de cambio");
igual((await q("select count(*)::int n from public.audit_log where tabla = 'servicios_config'")).rows[0].n, antesConfig + 1, "el cambio del tipo de cambio no quedó auditado");
igual((await como(U.STAFF, () => q("update public.servicios_config set eur_por_usd = 1 returning 1"))).rows.length, 0, "un usuario normal cambió el tipo de cambio");
igual((await como(U.SA_BLOQ, () => q("update public.servicios_config set eur_por_usd = 1 returning 1"))).rows.length, 0, "un super admin bloqueado cambió el tipo de cambio");
await rechaza(U.SA, "update public.servicios_config set actualizado_por = null", /permission denied/, "se falseó quién cambió el tipo de cambio");
await rechaza(U.SA, "insert into public.servicios_config (id, eur_por_usd) values (true, 1)", /permission denied/, "el super admin insertó otra configuración");
await rechaza(U.SA, "delete from public.servicios_config", /permission denied/, "el super admin borró la configuración");
await rechaza(U.SA, "update public.servicios_config set eur_por_usd = 0.1", /violates check constraint/, "tipo de cambio absurdo aceptado");
await assert.rejects(q("insert into public.servicios_config (id, eur_por_usd) values (false, 1)"), /violates check constraint/, "segunda fila de configuración aceptada"); comprobaciones++;

// 5. Validación.
const invalido = async (set, msg) => {
  await assert.rejects(como(U.SA, () => q(`update public.servicios_contratados set ${set} where proveedor = 'github'`)), /violates check constraint/, msg);
  comprobaciones++;
};
await invalido(`limites = '{"x": {"limite": -1}}'`, "límite negativo aceptado");
await invalido(`limites = '{"x": {"limite": "mucho"}}'`, "límite de texto aceptado");
await invalido(`limites = '{"Mayus": {"limite": 1}}'`, "clave de métrica con mayúsculas aceptada");
await invalido(`limites = '{"x": {"limite": 1, "fuente": "http://inseguro.test"}}'`, "fuente sin https aceptada");
await invalido(`limites = '{"x": {"limite": 1, "fuente": "javascript:alert(1)"}}'`, "fuente javascript: aceptada");
await invalido(`limites = '[]'`, "límites que no son un objeto aceptados");
await invalido(`panel_url = 'javascript:alert(1)'`, "enlace al panel sin https aceptado");
await invalido(`precio_mensual = -5`, "precio negativo aceptado");
await invalido(`moneda = 'euros'`, "moneda no ISO aceptada");
await invalido(`ciclo = 'semanal'`, "ciclo desconocido aceptado");
await invalido(`nombre = '  '`, "nombre vacío aceptado");
await invalido(`categoria = 'cosas'`, "categoría desconocida aceptada");
await invalido(`orden = 20000`, "orden fuera de rango aceptado");
await invalido(`precio_anual = -1`, "precio anual negativo aceptado");
await invalido(`fuente_precio = 'http://github.com/pricing'`, "fuente del precio sin https aceptada");
await rechaza(U.SA, "update public.servicios_contratados set categoria = null where proveedor = 'github'", /violates not-null constraint/, "categoría vacía aceptada");
const valido = await como(U.SA, () => q(`update public.servicios_contratados set limites = '{"a": {"limite": null, "etiqueta": "Sin dato"}, "b": {"limite": 2.5, "unidad": "GB", "fuente": "https://docs.github.com/x", "orden": 1}}' where proveedor = 'github' returning limites`));
igual(valido.rows[0].limites.a.limite, null, "límite vacío (sin dato) rechazado");

// 6. Lecturas: solo service_role escribe; la última por proveedor, con su coste variable.
await rechaza(U.SA, "insert into public.servicios_uso (proveedor, metricas) values ('vercel', '{}')", /permission denied/, "el navegador escribió una lectura");
await como(null, () => q(`insert into public.servicios_uso (proveedor, tomado_en, metricas, error, detalles, coste_variable) values
  ('vercel', now() - interval '1 hour', '{"peticiones_cdn": {"valor": 1}}', null, '{}', null),
  ('vercel', now() - interval '5 minutes', '{"peticiones_cdn": {"valor": 2}}', null, '{}', null),
  ('resend', now(), '{}', 'falta_secreto', '{"secreto": "RESEND_API_KEY"}', null),
  ('openai', now(), '{}', null, '{}', '{"importe": 1.23, "moneda": "USD", "periodo": "mes en curso", "origen": "bd"}')`), "service_role");
await assert.rejects(como(null, () => q("insert into public.servicios_uso (proveedor, error) values ('vercel', 'Mensaje con espacios')"), "service_role"), /violates check constraint/, "error libre aceptado (solo códigos)"); comprobaciones++;
await assert.rejects(como(null, () => q("insert into public.servicios_uso (proveedor, coste_variable) values ('vercel', '[1]')"), "service_role"), /violates check constraint/, "coste variable que no es un objeto aceptado"); comprobaciones++;
const ultimas = (await como(U.SA, () => q("select proveedor, metricas, error, detalles, coste_variable from public.servicios_uso_ultimas() order by proveedor"))).rows;
igual(ultimas.map((r) => r.proveedor), ["openai", "resend", "vercel"], "última lectura por proveedor");
igual(ultimas[2].metricas.peticiones_cdn.valor, 2, "servicios_uso_ultimas no devuelve la más reciente");
igual(ultimas[1].detalles.secreto, "RESEND_API_KEY", "detalles de la lectura");
igual(ultimas[0].coste_variable, { importe: 1.23, moneda: "USD", periodo: "mes en curso", origen: "bd" }, "servicios_uso_ultimas no devuelve el coste variable");
igual((await como(U.STAFF, () => q("select count(*)::int n from public.servicios_uso_ultimas()"))).rows[0].n, 0, "un usuario normal ve las lecturas");
igual((await como(U.SA_BLOQ, () => q("select count(*)::int n from public.servicios_uso"))).rows[0].n, 0, "un super admin bloqueado ve las lecturas");
igual((await q("select count(*)::int n from public.audit_log where tabla = 'servicios_uso'")).rows[0].n, 0, "las lecturas se auditan");

// 7. Métricas sin token: solo service_role.
await rechaza(U.SA, "select public.servicios_metricas_supabase()", /permission denied/, "el navegador llamó a servicios_metricas_supabase");
const m = (await como(null, () => q("select public.servicios_metricas_supabase() m"), "service_role")).rows[0].m;
ok(m.bd_bytes > 0, "sin tamaño de BD");
igual([m.storage_bytes, m.storage_objetos], [3500, 4], "Storage mal sumado (tamaños raros cuentan 0)");
igual(m.usuarios_activos_mes, 2, "usuarios activos del mes (inicio de sesión o sesión renovada este mes)");
igual(m.usuarios_total, 4, "usuarios totales");
igual([m.correos_reservas_mes, m.correos_reservas_hoy], [2, 2], "correos de reservas enviados");
igual([m.correos_newsletter_mes, m.contactos_newsletter], [7, 2], "newsletter transaccional y contactos activos");
// Tipo de cambio: el de la pantalla (ya cambiado a 0,9) y el último del BCE.
igual([m.eur_por_usd, m.eur_por_usd_bce, m.eur_por_usd_bce_fecha], [0.9, 0.893815, "2026-10-26"], "tipo de cambio de la pantalla o del BCE");
// IA: real (días cerrados del mes) + estimado desde el día siguiente al último real.
const esDia1 = new Date().getUTCDate() === 1;
igual(m.openai_usd_mes_real, esDia1 ? 0 : 2.5, "gasto real de OpenAI del mes (solo días cerrados)");
igual(m.ia_usd_mes_estimado, 0.5, "estimación de ia_uso del mes");
igual(m.ia_usd_estimado_sin_real, esDia1 ? 0.5 : 0.4, "estimación de lo que OpenAI aún no ha publicado");
ok(typeof m.openai_ultimo_dia_real === "string", "sin último día real de OpenAI");
igual(m.tope_ia_mes_eur, 8, "tope de gasto de IA");
// Stripe (cheques) y llamadas.
igual([m.cheques_stripe_mes, m.cheques_stripe_importe_mes, m.cheques_stripe_comision_mes, m.cheques_stripe_comision_estimadas], [2, 70, 1.55, 1], "cheques cobrados por Stripe este mes y su comisión");
igual([m.llamadas_mes, m.llamadas_segundos_mes, m.llamadas_usd_mes, m.llamadas_eur_mes], [2, 180, 0.5, 0.27], "llamadas del mes y su coste");

// 8. Reaplicar con datos no pisa lo editado (ni la configuración ni las columnas nuevas).
await como(U.SA, () => q("update public.servicios_contratados set plan = 'Pro', categoria = 'otros', orden = 1, por_confirmar = false where proveedor = 'resend'"));
await db.exec(MIGRACION);
await db.exec(MIGRACION_2);
igual((await q("select plan, categoria, orden, por_confirmar from public.servicios_contratados where proveedor = 'resend'")).rows[0], { plan: "Pro", categoria: "otros", orden: 1, por_confirmar: false }, "reaplicar las migraciones pisó lo editado");
igual((await q("select activo, orden from public.servicios_contratados where proveedor = 'loading'")).rows[0], { activo: false, orden: 5 }, "reaplicar la semilla pisó un proveedor nuevo editado");
igual(Number((await q("select eur_por_usd from public.servicios_config")).rows[0].eur_por_usd), 0.9, "reaplicar pisó el tipo de cambio");

// 8b. Configurar (20261104121000): el super admin da de alta y borra lo quitado.
await db.exec(MIGRACION_3);
await db.exec(MIGRACION_3); // idempotente
comprobaciones++;
igual(await triggers("servicios_contratados"), 1, "la tercera migración duplicó el trigger de auditoría");
const TEXTO_TOPE = "Tope de gasto de IA de Super Admin › Servicios › Costes";
const limiteIa = async () => (await q("select limites->'gasto_ia_mes'->>'limite_desde' t from public.servicios_contratados where proveedor = 'openai'")).rows[0].t;
igual(await limiteIa(), TEXTO_TOPE, "el texto del límite automático de OpenAI no apunta a Servicios › Costes");
const ALTA = `insert into public.servicios_contratados (proveedor, nombre, plan, precio_mensual, moneda, ciclo, categoria, orden, activo, por_confirmar, notas, panel_url)
  values ('n8n', 'n8n (automatizaciones)', 'Servidor propio', 5, 'EUR', 'mensual', 'otros', 110, true, true, 'Traducciones de la carta', 'https://n8n.example/panel')`;
const antesAlta = (await q("select count(*)::int n from public.audit_log where tabla = 'servicios_contratados' and accion = 'insert'")).rows[0].n;
await rechaza(U.STAFF, ALTA, /row-level security/, "un usuario normal dio de alta un servicio");
await rechaza(U.SA_BLOQ, ALTA, /row-level security/, "un super admin bloqueado dio de alta un servicio");
await rechaza(null, ALTA, /permission denied/, "anon dio de alta un servicio", "anon");
const alta = await como(U.SA, () => q(`${ALTA} returning proveedor, actualizado_por, limites, activo`));
igual(alta.rows[0], { proveedor: "n8n", actualizado_por: U.SA, limites: {}, activo: true }, "el super admin no pudo dar de alta un servicio");
igual((await q("select count(*)::int n from public.audit_log where tabla = 'servicios_contratados' and accion = 'insert'")).rows[0].n, antesAlta + 1, "el alta no quedó auditada");
igual((await como(U.SA, () => q("select count(*)::int n from public.servicios_contratados"))).rows[0].n, 14, "el super admin no ve el servicio nuevo");
await rechaza(U.SA, ALTA, /duplicate key|unique/, "se dio de alta dos veces el mismo proveedor");
await rechaza(U.SA, "insert into public.servicios_contratados (proveedor, nombre, actualizado_por) values ('otro', 'Otro', null)", /permission denied/, "se falseó quién dio de alta");
await rechaza(U.SA, "insert into public.servicios_contratados (proveedor, nombre, actualizado_en) values ('otro', 'Otro', now() - interval '1 year')", /permission denied/, "se falseó cuándo se dio de alta");
await rechaza(U.SA, "insert into public.servicios_contratados (proveedor, nombre) values ('Con Espacios', 'X')", /violates check constraint/, "clave de proveedor inválida aceptada");
await rechaza(U.SA, "insert into public.servicios_contratados (proveedor, nombre, categoria) values ('otro', 'X', 'cosas')", /violates check constraint/, "categoría desconocida aceptada en un alta");
await rechaza(U.SA, "insert into public.servicios_contratados (proveedor, nombre, panel_url) values ('otro', 'X', 'http://inseguro.test')", /violates check constraint/, "enlace sin https aceptado en un alta");
await rechaza(U.SA, "insert into public.servicios_contratados (proveedor, nombre, limites) values ('otro', 'X', '{\"x\": {\"limite\": -1}}')", /violates check constraint/, "límite negativo aceptado en un alta");
// Borrar: solo lo quitado (activo = false), solo super admin, y con sus lecturas.
await como(null, () => q(`insert into public.servicios_uso (proveedor, metricas) values ('n8n', '{}'), ('n8n', '{}'), ('perplexity', '{}')`), "service_role");
const BORRAR = "delete from public.servicios_contratados where proveedor = 'n8n' returning proveedor";
igual((await como(U.SA, () => q(BORRAR))).rows.length, 0, "se borró un servicio en uso");
await como(U.SA, () => q("update public.servicios_contratados set activo = false where proveedor = 'n8n'"));
igual((await como(U.STAFF, () => q(BORRAR))).rows.length, 0, "un usuario normal borró un servicio");
igual((await como(U.SA_BLOQ, () => q(BORRAR))).rows.length, 0, "un super admin bloqueado borró un servicio");
await rechaza(null, BORRAR, /permission denied/, "anon borró un servicio", "anon");
const antesBaja = (await q("select count(*)::int n from public.audit_log where tabla = 'servicios_contratados' and accion = 'delete'")).rows[0].n;
igual((await como(U.SA, () => q(BORRAR))).rows.map((r) => r.proveedor), ["n8n"], "el super admin no pudo borrar un servicio quitado");
igual((await q("select count(*)::int n from public.servicios_uso where proveedor = 'n8n'")).rows[0].n, 0, "las lecturas del servicio borrado se quedaron");
igual((await q("select count(*)::int n from public.servicios_uso where proveedor = 'perplexity'")).rows[0].n, 1, "se borraron lecturas de otro servicio");
igual((await q("select count(*)::int n from public.audit_log where tabla = 'servicios_contratados' and accion = 'delete'")).rows[0].n, antesBaja + 1, "el borrado no quedó auditado");
await rechaza(U.SA, "truncate public.servicios_contratados", /permission denied/, "el super admin vació la tabla");
// Rollback de la tercera: ya no se puede dar de alta ni borrar; lo añadido se queda.
await como(U.SA, () => q("insert into public.servicios_contratados (proveedor, nombre) values ('prueba_alta', 'Prueba')"));
await db.exec(ROLLBACK_3);
await rechaza(U.SA, ALTA, /permission denied/, "tras el rollback se puede dar de alta");
await rechaza(U.SA, "delete from public.servicios_contratados where proveedor = 'perplexity'", /permission denied/, "tras el rollback se puede borrar");
igual((await q("select count(*)::int n from public.servicios_contratados where proveedor = 'prueba_alta'")).rows[0].n, 1, "el rollback borró un servicio añadido por el dueño");
igual((await q("select to_regprocedure('public.servicios_contratados_al_borrar()') f")).rows[0].f, null, "el rollback deja el trigger de borrado");
ok(/Super Admin › Costes$/.test(await limiteIa()), "el rollback no devuelve el texto del límite de OpenAI");
igual((await como(U.SA, () => q("update public.servicios_contratados set plan = 'Pro' where proveedor = 'prueba_alta' returning 1"))).rows.length, 1, "tras el rollback ya no se puede editar");
await db.exec(MIGRACION_3); // se puede reaplicar
igual(await limiteIa(), TEXTO_TOPE, "no se pudo reaplicar la tercera tras su rollback");
await db.exec(ROLLBACK_3);
await q("delete from public.servicios_contratados where proveedor = 'prueba_alta'");

// 9. Rollback de la segunda: vuelve a como dejó la primera (y se puede reaplicar).
await db.exec(ROLLBACK_2);
igual((await q("select proveedor from public.servicios_contratados order by proveedor")).rows.map((r) => r.proveedor), ["github", "resend", "stripe", "supabase", "vercel"], "el rollback deja proveedores nuevos");
igual((await q("select count(*)::int n from information_schema.columns where table_schema = 'public' and table_name in ('servicios_contratados', 'servicios_uso') and column_name in ('categoria', 'orden', 'activo', 'por_confirmar', 'precio_anual', 'fuente_precio', 'coste_variable')")).rows[0].n, 0, "el rollback deja columnas nuevas");
igual((await q("select to_regclass('public.servicios_config') c")).rows[0].c, null, "el rollback deja servicios_config");
const mViejas = (await como(null, () => q("select public.servicios_metricas_supabase() m"), "service_role")).rows[0].m;
ok(!("openai_usd_mes_real" in mViejas) && mViejas.bd_bytes > 0 && mViejas.contactos_newsletter === 2, "el rollback no deja servicios_metricas_supabase() como en la primera migración");
igual((await como(U.SA, () => q("select proveedor from public.servicios_uso_ultimas() order by proveedor"))).rows.map((r) => r.proveedor), ["resend", "vercel"], "servicios_uso_ultimas no funciona tras el rollback");
await db.exec(MIGRACION_2);
igual((await q("select count(*)::int n from public.servicios_contratados")).rows[0].n, 13, "no se pudo reaplicar la segunda tras su rollback");

// 10. Rollback de las dos y reaplicación.
await db.exec(ROLLBACK_2);
await db.exec(ROLLBACK);
igual((await q("select to_regclass('public.servicios_contratados') t, to_regclass('public.servicios_uso') u, to_regclass('public.servicios_config') c, to_regprocedure('public.servicios_metricas_supabase()') f")).rows[0], { t: null, u: null, c: null, f: null }, "los rollbacks dejan restos");
await db.exec(MIGRACION);
await db.exec(MIGRACION_2);
igual((await q("select count(*)::int n from public.servicios_contratados")).rows[0].n, 13, "no se pudo reaplicar tras los rollbacks");

// 11. Sin el event trigger (como la demo, copia de producción): las migraciones
// ponen igualmente trg_auditoria en la configuración, y solo uno.
await db.exec("drop event trigger audit_panel_nuevas_tablas");
await db.exec(ROLLBACK_2);
await db.exec(ROLLBACK);
await db.exec(MIGRACION);
await db.exec(MIGRACION_2);
igual(await triggers("servicios_contratados"), 1, "sin event trigger, servicios_contratados queda sin auditar");
igual(await triggers("servicios_config"), 1, "sin event trigger, servicios_config queda sin auditar");
igual(await triggers("servicios_uso"), 0, "sin event trigger, servicios_uso acabó auditada");
await db.exec(MIGRACION);
await db.exec(MIGRACION_2);
igual((await q("select count(*)::int n from pg_trigger where tgrelid = 'public.servicios_contratados'::regclass and tgfoid = 'public.fn_registrar_auditoria()'::regprocedure")).rows[0].n, 1, "trigger de auditoría duplicado al reaplicar");
igual((await q("select count(*)::int n from pg_trigger where tgrelid = 'public.servicios_config'::regclass and tgfoid = 'public.fn_registrar_auditoria()'::regprocedure")).rows[0].n, 1, "trigger de auditoría de servicios_config duplicado al reaplicar");
const antesSemilla = (await q("select count(*)::int n from public.audit_log where tabla = 'servicios_contratados' and accion = 'insert'")).rows[0].n;
ok(antesSemilla >= 13, "la semilla no quedó auditada (el trigger debe ir antes de la semilla)");

// 12. Sin las tablas opcionales (IA, cheques, llamadas, BCE) la segunda se aplica igual.
const limpia = new PGlite();
await limpia.exec(ANDAMIAJE);
await limpia.exec("drop table public.openai_costes_diarios, public.ia_uso, public.configuracion_facturas, public.tipo_cambio_usd_eur, public.cheques_regalo, public.call_logs");
await limpia.exec(MIGRACION);
await assert.rejects(limpia.exec(MIGRACION_3), /falta 20261103160000/, "la tercera se aplicó sin la segunda"); comprobaciones++;
await limpia.exec("rollback"); // el `begin` de la migración queda abortado
await limpia.exec(MIGRACION_2);
await limpia.exec(MIGRACION_3);
igual(Number((await limpia.query("select eur_por_usd from public.servicios_config")).rows[0].eur_por_usd), 0.92, "sin BCE, el tipo de cambio no nace en 0,92");
const mLimpia = (await limpia.query("select public.servicios_metricas_supabase() m")).rows[0].m;
ok(mLimpia.bd_bytes > 0 && mLimpia.eur_por_usd === 0.92 && !("openai_usd_mes_real" in mLimpia) && !("llamadas_mes" in mLimpia) && !("cheques_stripe_mes" in mLimpia),
  "sin las tablas opcionales, servicios_metricas_supabase() falla o se inventa cifras");

// 13. Minutos de Actions de GitHub (20261112120000): límite de 2.000 al mes,
// idempotente, sin pisar un límite ya editado en el panel, y su rollback.
const limitesGithub = async () => (await limpia.query("select limites from public.servicios_contratados where proveedor = 'github'")).rows[0].limites;
await limpia.exec(MIGRACION_4);
const conMinutos = await limitesGithub();
ok(conMinutos.actions_minutos?.limite === 2000 && conMinutos.actions_minutos?.unidad === "minutos", "GitHub no tiene el límite de 2.000 minutos de Actions");
await limpia.exec(MIGRACION_4);
igual(await limitesGithub(), conMinutos, "reaplicar la de minutos de GitHub cambia los límites");
await limpia.exec(ROLLBACK_4);
ok(!("actions_minutos" in (await limitesGithub())), "el rollback deja el límite de minutos de GitHub");
await limpia.exec(`update public.servicios_contratados set limites = coalesce(limites, '{}'::jsonb) || '{"actions_minutos": {"limite": 3000, "etiqueta": "Minutos de Actions"}}' where proveedor = 'github'`);
await limpia.exec(MIGRACION_4);
igual((await limitesGithub()).actions_minutos.limite, 3000, "la migración pisa un límite de minutos editado en el panel");

// 14. Estado con más detalle (20261120100000): conexiones y tablas que más ocupan
// solo para service_role; GitHub con un solo límite (los minutos) y Vercel con el
// de la memoria de las funciones. Idempotente, sin pisar lo editado, y su rollback.
await limpia.exec(`update public.servicios_contratados set limites = (limites - 'actions_minutos') || '{"actions_minutos": {"limite": 2000, "unidad": "minutos", "etiqueta": "Minutos de Actions"}}' where proveedor = 'github'`);
await limpia.exec(MIGRACION_5);
const extra = (await limpia.query("select public.servicios_metricas_bd_extra() m")).rows[0].m;
ok(Number.isInteger(extra.conexiones) && extra.conexiones >= 0 && extra.conexiones_max > 0, "servicios_metricas_bd_extra() no da las conexiones");
ok(Array.isArray(extra.tablas_mayores) && extra.tablas_mayores.length > 0 && extra.tablas_mayores.length <= 5
  && extra.tablas_mayores.every((t, i, a) => typeof t.tabla === "string" && t.bytes >= 0 && (i === 0 || a[i - 1].bytes >= t.bytes)),
  "servicios_metricas_bd_extra() no da las tablas que más ocupan, de mayor a menor");
ok(!extra.tablas_mayores.some((t) => /^(pg_catalog|information_schema|pg_toast)\./.test(t.tabla)), "las tablas del sistema salen entre las que más ocupan");
ok(!(await limpia.query("select has_function_privilege('authenticated', 'public.servicios_metricas_bd_extra()', 'execute') p")).rows[0].p, "authenticated puede leer las conexiones");
ok(!(await limpia.query("select has_function_privilege('anon', 'public.servicios_metricas_bd_extra()', 'execute') p")).rows[0].p, "anon puede leer las conexiones");
ok((await limpia.query("select has_function_privilege('service_role', 'public.servicios_metricas_bd_extra()', 'execute') p")).rows[0].p, "service_role no puede leer las conexiones");
const g5 = await limitesGithub();
ok(!("limite" in g5.actions_computo) && g5.actions_computo.unidad === "USD", "GitHub sigue con el límite de 12 US$ (aviso repetido)");
igual(g5.actions_minutos.etiqueta, "Minutos de Actions en repositorios privados", "el límite de minutos no dice que es de los repositorios privados");
const limitesVercel = async () => (await limpia.query("select limites from public.servicios_contratados where proveedor = 'vercel'")).rows[0].limites;
ok((await limitesVercel()).memoria_funciones?.limite === 360, "Vercel no tiene el límite de memoria de las funciones");
await limpia.exec(MIGRACION_5);
igual(await limitesGithub(), g5, "reaplicar la del estado con más detalle cambia GitHub");
await limpia.exec(ROLLBACK_5);
igual((await limpia.query("select to_regprocedure('public.servicios_metricas_bd_extra()') f")).rows[0].f, null, "el rollback deja servicios_metricas_bd_extra()");
const g5r = await limitesGithub();
ok(g5r.actions_computo.limite === 12 && g5r.actions_minutos.etiqueta === "Minutos de Actions", "el rollback no devuelve los límites de GitHub");
ok(!("memoria_funciones" in (await limitesVercel())), "el rollback deja el límite de memoria de Vercel");
// No pisa lo editado: un límite de cómputo cambiado por el dueño se queda; uno de memoria, también.
await limpia.exec(`update public.servicios_contratados set limites = jsonb_set(limites, '{actions_computo,limite}', '20') where proveedor = 'github'`);
await limpia.exec(`update public.servicios_contratados set limites = limites || '{"memoria_funciones": {"limite": 1000, "unidad": "GB-hora"}}' where proveedor = 'vercel'`);
await limpia.exec(MIGRACION_5);
igual((await limitesGithub()).actions_computo.limite, 20, "la migración pisa un límite de cómputo editado en el panel");
igual((await limitesVercel()).memoria_funciones.limite, 1000, "la migración pisa un límite de memoria editado en el panel");

// 15. Costes de cada mes, informe mensual y Mapbox (20261122153000): costes por
// mes metidos a mano solo por un super admin con sesión viva (y auditados), el
// resumen de un mes con la última lectura de ese mes, las cargas del mapa de
// vinos solo para service_role (null sin logs de la web), notas de Drive y
// Mapbox sin pisar lo editado, idempotente y su rollback.
await db.exec(MIGRACION_6);
await db.exec(MIGRACION_6); // idempotente
igual(await triggers("servicios_costes_mes"), 1, "servicios_costes_mes sin auditar");
const MES_PASADO = `((date_trunc('month', now(), 'UTC') - interval '1 month') at time zone 'UTC')::date`;
await como(U.SA, () => q(`insert into public.servicios_costes_mes (proveedor, mes, importe, moneda, nota) values ('loading', ${MES_PASADO}, 12.5, 'EUR', 'Factura 123')`));
const fila6 = (await q("select * from public.servicios_costes_mes")).rows[0];
ok(fila6.actualizado_por === U.SA && Number(fila6.importe) === 12.5, "no guarda quién metió el coste o el importe");
await como(U.SA2, () => q(`update public.servicios_costes_mes set importe = 13 where proveedor = 'loading'`));
igual((await q("select actualizado_por from public.servicios_costes_mes")).rows[0].actualizado_por, U.SA2, "no apunta quién editó el coste");
ok((await q("select count(*)::int n from public.audit_log where tabla = 'servicios_costes_mes'")).rows[0].n >= 2, "los costes por mes no se auditan");
await rechaza(U.STAFF, `insert into public.servicios_costes_mes (proveedor, mes, importe) values ('vercel', ${MES_PASADO}, 1)`, /row-level security/, "alguien que no es super admin mete costes");
await rechaza(U.SA_BLOQ, `insert into public.servicios_costes_mes (proveedor, mes, importe) values ('vercel', ${MES_PASADO}, 1)`, /row-level security/, "un super admin bloqueado mete costes");
igual((await como(U.STAFF, () => q("select * from public.servicios_costes_mes"))).rows.length, 0, "alguien que no es super admin ve los costes");
await rechaza(null, "select * from public.servicios_costes_mes", /permission denied/, "anon ve los costes", "anon");
await rechaza(U.SA, `insert into public.servicios_costes_mes (proveedor, mes, importe) values ('vercel', ${MES_PASADO} + 3, 1)`, /servicios_costes_mes_mes_chk/, "acepta un mes que no es día 1");
await rechaza(U.SA, `insert into public.servicios_costes_mes (proveedor, mes, importe) values ('vercel', ${MES_PASADO}, -1)`, /servicios_costes_mes_importe_chk/, "acepta un importe negativo");
await rechaza(U.SA, `insert into public.servicios_costes_mes (proveedor, mes, importe, moneda) values ('vercel', ${MES_PASADO}, 1, 'BTC')`, /servicios_costes_mes_moneda_chk/, "acepta una moneda rara");
await rechaza(U.SA, `insert into public.servicios_costes_mes (proveedor, mes, importe) values ('no_existe', ${MES_PASADO}, 1)`, /foreign key/, "acepta un servicio que no existe");
await rechaza(U.SA, `update public.servicios_costes_mes set proveedor = 'vercel'`, /permission denied/, "deja cambiar el servicio de un coste");
// Resumen: lo metido a mano y la última lectura con coste del mes (ni la de este mes ni una sin coste).
await q(`insert into public.servicios_uso (proveedor, tomado_en, metricas, coste_variable) values
  ('openai', date_trunc('month', now(), 'UTC') - interval '20 days', '{}', '{"importe": 1, "moneda": "USD", "periodo": "mes en curso", "origen": "api"}'),
  ('openai', date_trunc('month', now(), 'UTC') - interval '2 days', '{}', '{"importe": 4, "moneda": "USD", "periodo": "mes en curso", "origen": "api"}'),
  ('openai', date_trunc('month', now(), 'UTC') - interval '1 day', '{}', null),
  ('openai', date_trunc('month', now(), 'UTC') + interval '1 hour', '{}', '{"importe": 99, "moneda": "USD", "periodo": "mes en curso", "origen": "api"}')`);
const resumen6 = new Map((await como(U.SA, () => q(`select * from public.servicios_resumen_mes(${MES_PASADO})`))).rows.map((r) => [r.proveedor, r]));
igual(resumen6.size, TODOS.length, "el resumen del mes no saca todos los servicios");
igual([Number(resumen6.get("loading").manual_importe), resumen6.get("loading").manual_moneda, resumen6.get("loading").manual_nota], [13, "EUR", "Factura 123"], "el resumen no trae el coste metido a mano");
igual(resumen6.get("openai").coste_variable.importe, 4, "el resumen no coge la última lectura con coste de ese mes");
igual(resumen6.get("openai").lecturas, 3, "el resumen cuenta lecturas de otro mes");
igual(resumen6.get("vercel").manual_importe, null, "el resumen se inventa un coste");
igual((await como(U.STAFF, () => q(`select * from public.servicios_resumen_mes(${MES_PASADO})`))).rows.length, 0, "alguien que no es super admin ve el resumen");
// Mapbox: sin logs de la web, null; con ellos, sesiones distintas de producción desde la fecha.
igual((await como(null, () => q("select public.servicios_cargas_mapa_vinos(now() - interval '30 days') n"), "service_role")).rows[0].n, null, "sin web_eventos no devuelve null");
await db.exec(`create table public.web_eventos (id bigserial primary key, evento_id uuid not null default gen_random_uuid(), ocurrido_en timestamptz not null default now(), entorno text, tipo text, sesion_id uuid, es_bot boolean not null default false, es_prueba boolean not null default false, es_interno boolean not null default false);
  insert into public.web_eventos (entorno, tipo, sesion_id, es_bot, ocurrido_en) values
    ('produccion', 'mapa_vinos', 'c0000000-0000-0000-0000-000000000001', false, now()),
    ('produccion', 'mapa_vinos', 'c0000000-0000-0000-0000-000000000001', false, now()),
    ('produccion', 'mapa_vinos', 'c0000000-0000-0000-0000-000000000002', false, now()),
    ('produccion', 'mapa_vinos', null, false, now()),
    ('produccion', 'mapa_vinos', 'c0000000-0000-0000-0000-000000000003', true, now()),
    ('demo', 'mapa_vinos', 'c0000000-0000-0000-0000-000000000004', false, now()),
    ('produccion', 'clic', 'c0000000-0000-0000-0000-000000000005', false, now()),
    ('produccion', 'mapa_vinos', 'c0000000-0000-0000-0000-000000000006', false, now() - interval '40 days');`);
igual((await como(null, () => q("select public.servicios_cargas_mapa_vinos(now() - interval '30 days') n"), "service_role")).rows[0].n, 3, "cargas del mapa mal contadas (sesiones distintas de producción, sin bots)");
ok(!(await q("select has_function_privilege('authenticated', 'public.servicios_cargas_mapa_vinos(timestamptz)', 'execute') p")).rows[0].p, "authenticated puede leer las cargas del mapa");
ok(!(await q("select has_function_privilege('anon', 'public.servicios_cargas_mapa_vinos(timestamptz)', 'execute') p")).rows[0].p, "anon puede leer las cargas del mapa");
// Notas: cambian las de la semilla y no las editadas.
const nota6 = async (p, k) => (await q(`select limites->'${k}'->>'nota' n from public.servicios_contratados where proveedor = '${p}'`)).rows[0].n;
ok(/Lectura automática/.test(await nota6("mapbox", "cargas_mapa_web")) && /Lectura automática/.test(await nota6("google_drive", "almacenamiento")), "las notas de Mapbox y Drive siguen diciendo que no hay lectura automática");
// Vercel: almacenamiento de despliegues y de funciones, sin límite («sin dato») y editable; no pisa lo editado.
const vercel6 = async () => (await q("select limites from public.servicios_contratados where proveedor = 'vercel'")).rows[0].limites;
const v6 = await vercel6();
ok("almacenamiento_despliegues" in v6 && v6.almacenamiento_despliegues.limite === null && v6.almacenamiento_despliegues.unidad === "GB", "Vercel sin el control del almacenamiento de despliegues");
ok("almacenamiento_funciones" in v6 && v6.almacenamiento_funciones.limite === null && /250 MB/.test(v6.almacenamiento_funciones.nota), "Vercel sin el control del almacenamiento de funciones");
await db.exec(`update public.servicios_contratados set limites = jsonb_set(limites, '{almacenamiento_despliegues,limite}', '1') where proveedor = 'vercel'`);
await db.exec(MIGRACION_6);
igual((await vercel6()).almacenamiento_despliegues.limite, 1, "la migración pisa el límite de almacenamiento de despliegues editado");
// Rollback: se va todo y se puede volver a aplicar; una nota editada no se toca.
await db.exec(ROLLBACK_6);
ok(!("almacenamiento_despliegues" in (await vercel6())) && !("almacenamiento_funciones" in (await vercel6())), "el rollback deja los límites de almacenamiento de Vercel");
igual((await q("select to_regclass('public.servicios_costes_mes') t, to_regprocedure('public.servicios_resumen_mes(date)') r, to_regprocedure('public.servicios_cargas_mapa_vinos(timestamptz)') m")).rows[0], { t: null, r: null, m: null }, "el rollback de costes por mes deja restos");
ok(/Sin lectura automática/.test(await nota6("mapbox", "cargas_mapa_web")) && /Sin lectura automática/.test(await nota6("google_drive", "almacenamiento")), "el rollback no devuelve las notas de Mapbox y Drive");
await db.exec(`update public.servicios_contratados set limites = jsonb_set(limites, '{cargas_mapa_web,nota}', '"Mi nota"') where proveedor = 'mapbox'`);
await db.exec(MIGRACION_6);
igual(await nota6("mapbox", "cargas_mapa_web"), "Mi nota", "la migración pisa una nota editada");
igual(await triggers("servicios_costes_mes"), 1, "tras reaplicar, servicios_costes_mes sin auditar");

console.log(`servicios_contratados + planes_costes + configurables (PGlite): ${comprobaciones} comprobaciones OK`);
