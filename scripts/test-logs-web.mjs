// Super Admin › Logs: migraciones 20261118100000 (tablas, RLS, ingesta,
// agrupación, estadísticas, retención), 20261118100100 (operaciones de la BD),
// 20261129143000 (errores «tras publicar» y explicación en sencillo) y
// 20261130100000 (origen de cada error: fallo de la web, servicio externo o no
// depende de la web) contra un Postgres en memoria (PGlite). Nunca toca Supabase.
//
//   npm run test:logs-web:db
//
// Comprueba: idempotencia y lista de exclusión de auditoría; RLS solo super
// admin (también en las RPC) y columnas editables; ingesta sin duplicados
// (reenvíos), orden y resumen exacto de la sesión, sin visitante sin
// consentimiento, entornos, límites (sesión, IP, día) y rutas excluidas;
// agrupación por huella sin duplicados, umbrales, críticos, 404, patrones
// ignorados, reapertura (reabrir y nuevo ticket); estadísticas que cuadran con
// los eventos y embudo con operaciones completadas; contexto antes/después;
// salud de la recogida; purga; triggers de reservas/cheques que no rompen la
// operación; errores de versión antigua tras publicar (no cuentan salvo que se
// repitan tras recargar), tráfico interno fuera de los umbrales y la vuelta
// atrás de las incidencias pendientes; el origen de cada error (mismos casos
// que origen.ts), que solo los fallos de la web (y externos si se activa)
// abren o reabren tickets, «Pedir ticket» a mano, errores por sesión y la
// clasificación de lo ya guardado; y los rollbacks.
import { PGlite } from "@electric-sql/pglite";
import { readFile } from "node:fs/promises";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

const MIGRACION = await readFile("supabase/migrations/20261118100000_logs_web.sql", "utf8");
const OPERACIONES = await readFile("supabase/migrations/20261118100100_logs_web_operaciones_bd.sql", "utf8");
const ROLLBACK = await readFile("supabase/rollbacks/20261118100000_logs_web_ROLLBACK.sql", "utf8");
const ROLLBACK_OP = await readFile("supabase/rollbacks/20261118100100_logs_web_operaciones_bd_ROLLBACK.sql", "utf8");
const LEGIBLES = await readFile("supabase/migrations/20261129143000_logs_web_legibles.sql", "utf8");
const ROLLBACK_LEGIBLES = await readFile("supabase/rollbacks/20261129143000_logs_web_legibles_ROLLBACK.sql", "utf8");
const ORIGEN = await readFile("supabase/migrations/20261130100000_logs_web_origen.sql", "utf8");
const ROLLBACK_ORIGEN = await readFile("supabase/rollbacks/20261130100000_logs_web_origen_ROLLBACK.sql", "utf8");
// Los mismos casos que el vitest de origen.ts: el SQL tiene que clasificar igual.
const CASOS_ORIGEN = JSON.parse(await readFile("supabase/functions/_shared/__tests__/logs-web-origen-casos.json", "utf8"));
// El patrón de «versión antigua» del SQL tiene que ser el mismo que el de huella.ts.
const HUELLA_TS = await readFile("supabase/functions/_shared/logs-web/huella.ts", "utf8");

let comprobaciones = 0;
const ok = (v, msg) => { assert.ok(v, msg); comprobaciones++; };
const igual = (a, b, msg) => { assert.deepEqual(a, b, msg); comprobaciones++; };

const LISTA = `'audit_log','ia_uso','metricas'`;
const ANDAMIAJE = `
  create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
  create schema auth; create schema private;
  create table auth.users (id uuid primary key, email text, banned_until timestamptz);
  create table auth.sessions (id uuid primary key, user_id uuid);
  create function auth.jwt() returns jsonb language sql stable as $$ select nullif(current_setting('request.jwt.claims', true), '')::jsonb $$;
  create function auth.uid() returns uuid language sql stable as $$ select (auth.jwt() ->> 'sub')::uuid $$;
  create function auth.role() returns text language sql stable as $$ select auth.jwt() ->> 'role' $$;
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

  create table public.trafico_web_diario (fecha date, proyecto text, ruta text, visitas int, primary key (fecha, proyecto, ruta));
  create table public.reservas (id uuid primary key default gen_random_uuid(), canal text, estado text, numero_comensales int);
  create table public.cheques_regalo (id uuid primary key default gen_random_uuid(), origen text, estado text, importe_eur numeric);

  create table public.audit_log (id bigserial primary key, tabla text, accion text);
  create function public.fn_registrar_auditoria() returns trigger language plpgsql security definer set search_path = public as $f$
  begin insert into public.audit_log (tabla, accion) values (TG_TABLE_NAME, lower(TG_OP)); if TG_OP = 'DELETE' then return old; end if; return new; end $f$;
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

const U = { SA: "a0000000-0000-0000-0000-000000000001", STAFF: "a0000000-0000-0000-0000-000000000002" };
const sesionPanel = (u) => u.replace(/^a/, "b");
const DATOS = `
  insert into auth.users (id, email) values ('${U.SA}', 'sa@t'), ('${U.STAFF}', 'staff@t');
  insert into auth.sessions (id, user_id) values ('${sesionPanel(U.SA)}', '${U.SA}'), ('${sesionPanel(U.STAFF)}', '${U.STAFF}');
  insert into public.super_admins values ('${U.SA}');
  insert into public.trafico_web_diario values (current_date - 1, 'casa-tomas-story', '*', 12);
`;

const db = new PGlite();
await db.exec(ANDAMIAJE);
await db.exec(DATOS);
await db.exec(MIGRACION);
await db.exec(MIGRACION); // idempotente
await db.exec(OPERACIONES);
await db.exec(OPERACIONES); // idempotente
await db.exec(LEGIBLES);
await db.exec(LEGIBLES); // idempotente
comprobaciones++;

const q = (sql, params) => db.query(sql, params);
async function como(u, fn, rol = "authenticated") {
  await db.exec("begin");
  try {
    if (rol === "service_role") {
      await db.exec(`set local role service_role; select set_config('request.jwt.claims', '{"role":"service_role"}', true);`);
    } else if (rol === "anon") await db.exec("set local role anon;");
    else await db.exec(`set local role authenticated;
      select set_config('request.jwt.claims', '${JSON.stringify({ sub: u, role: "authenticated", session_id: sesionPanel(u) })}', true);`);
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
const ingerir = (eventos, ctx = { entorno: "produccion" }) =>
  como(null, async () => (await q("select public.web_logs_ingerir($1::jsonb, $2::jsonb) r", [JSON.stringify(eventos), JSON.stringify(ctx)])).rows[0].r, "service_role");
const agrupar = () => como(null, async () => (await q("select public.web_logs_agrupar_errores() r")).rows[0].r, "service_role");
const sa = (sql, params) => como(U.SA, () => q(sql, params));
const staff = (sql, params) => como(U.STAFF, () => q(sql, params));

// ─── 1. Auditoría ───────────────────────────────────────────────────────────
for (const fn of ["instalar_auditoria_panel", "fn_audit_nueva_tabla"]) {
  const def = (await q(`select pg_get_functiondef('public.${fn}'::regproc) d`)).rows[0].d;
  ok(def.includes("'web_eventos'") && def.includes("'web_sesiones'") && def.includes("'web_incidencias'"), `${fn} no excluye las tablas web_*`);
  igual(def.split("'web_eventos'").length - 1, 1, `${fn}: web_eventos repetido tras aplicar dos veces`);
}
const triggers = async (t) => (await q(`select count(*)::int n from pg_trigger where tgrelid = 'public.${t}'::regclass and tgname = 'trg_auditoria'`)).rows[0].n;
for (const t of ["web_eventos", "web_sesiones", "web_incidencias", "web_logs_ingesta_diaria", "web_linear_prueba"]) {
  igual(await triggers(t), 0, `${t} con trigger de auditoría (es un dato derivado)`);
}
igual(await triggers("web_logs_config"), 1, "la configuración de Logs debe auditarse");
igual((await q("select entorno_bd from public.web_logs_config")).rows[0].entorno_bd, "produccion", "entorno_bd por defecto");
ok((await q("select count(*)::int n from public.web_eventos_catalogo")).rows[0].n >= 30, "catálogo de eventos incompleto");

// ─── 2. RLS y permisos ──────────────────────────────────────────────────────
await rechaza(null, "select * from public.web_eventos", /permission denied/, "anon no puede leer eventos", "anon");
await rechaza(U.STAFF, `select public.web_logs_ingerir('[]'::jsonb, '{}'::jsonb)`, /permission denied/, "el personal no puede ingerir");
await rechaza(U.SA, `select public.web_logs_ingerir('[]'::jsonb, '{}'::jsonb)`, /permission denied/, "ni un super admin ingiere desde el panel");
await rechaza(U.SA, `select public.web_logs_agrupar_errores()`, /permission denied/, "agrupar es solo del servidor");
await rechaza(U.STAFF, `select public.web_logs_estado_recogida('produccion')`, /super admin/, "el estado de la recogida es solo de super admin");

// ─── 3. Ingesta ─────────────────────────────────────────────────────────────
const S1 = randomUUID(), S2 = randomUUID(), V1 = randomUUID();
const ahora = Date.now();
const iso = (msAntes) => new Date(ahora - msAntes).toISOString();
const ev = (o) => ({
  evento_id: randomUUID(), fuente: "navegador", categoria: "actividad", proyecto: "casa-tomas-story",
  consentimiento: true, dispositivo: "movil", navegador: "Safari", so: "iOS", ...o,
});
const vista1 = randomUUID(), vista2 = randomUUID(), vista3 = randomUUID();
const lote1 = [
  ev({ tipo: "pagina_vista", sesion_id: S1, visitante_id: V1, secuencia: 1, ocurrido_en: iso(60_000), ruta: "/",
       propiedades: { origen_tipo: "qr", campana: "mesa", origen_detalle: "qr", idioma: "es", vista_id: vista1 } }),
  ev({ tipo: "clic", sesion_id: S1, visitante_id: V1, secuencia: 2, ocurrido_en: iso(55_000), ruta: "/", objetivo: "Ver la carta" }),
  ev({ tipo: "pagina_salida", sesion_id: S1, visitante_id: V1, secuencia: 3, ocurrido_en: iso(50_000), ruta: "/", valor: 10_000,
       accion: "navegacion", propiedades: { scroll_max: 60, vista_id: vista1 } }),
  ev({ tipo: "pagina_vista", sesion_id: S1, visitante_id: V1, secuencia: 4, ocurrido_en: iso(49_000), ruta: "/reservas", propiedades: { vista_id: vista2 } }),
  ev({ tipo: "formulario", accion: "inicio", objetivo: "reserva", sesion_id: S1, visitante_id: V1, secuencia: 5, ocurrido_en: iso(40_000), ruta: "/reservas" }),
  ev({ tipo: "reserva_disponibilidad", accion: "con_huecos", sesion_id: S1, visitante_id: V1, secuencia: 6, ocurrido_en: iso(35_000), ruta: "/reservas" }),
  ev({ tipo: "formulario", accion: "envio", objetivo: "reserva", sesion_id: S1, visitante_id: V1, secuencia: 7, ocurrido_en: iso(30_000), ruta: "/reservas" }),
  ev({ tipo: "reserva_solicitada", categoria: "operacion", accion: "ok", sesion_id: S1, visitante_id: V1, secuencia: 8, ocurrido_en: iso(29_000), ruta: "/reservas" }),
  ev({ tipo: "pagina_salida", sesion_id: S1, visitante_id: V1, secuencia: 9, ocurrido_en: iso(20_000), ruta: "/reservas", valor: 25_000,
       accion: "oculta", propiedades: { scroll_max: 90, vista_id: vista2 } }),
];
let r = await ingerir(lote1);
igual([r.aceptados, r.duplicados, r.descartados, r.rechazados], [9, 0, 0, 0], "primer lote");
r = await ingerir(lote1); // el navegador reenvía el mismo lote (sendBeacon + fetch, reintento…)
igual([r.aceptados, r.duplicados], [0, 9], "un reenvío no duplica");
igual((await q("select count(*)::int n from public.web_eventos")).rows[0].n, 9, "eventos tras el reenvío");

let s1 = (await q(`select * from public.web_sesiones where sesion_id = $1`, [S1])).rows[0];
igual([s1.pagina_entrada, s1.ultima_pagina, s1.paginas_vistas, s1.eventos, s1.origen_tipo, s1.campana, s1.idioma],
      ["/", "/reservas", 2, 9, "qr", "mesa", "es"], "resumen de la sesión");
igual([Number(s1.tiempo_activo_ms), s1.scroll_max, s1.inicio_operacion, s1.conversiones, s1.visitante_id],
      [35_000, 90, true, 1, V1], "tiempo, scroll, operación y conversión de la sesión");

// Un evento suelto marcado como bot (otro User-Agent en un sendBeacon) no convierte la sesión en bot.
await ingerir([ev({ tipo: "scroll", sesion_id: S1, visitante_id: V1, secuencia: 10, valor: 50, ruta: "/reservas", es_bot: true })]);
igual((await q(`select es_bot from public.web_sesiones where sesion_id = $1`, [S1])).rows[0].es_bot, false, "un evento bot suelto no tumba la sesión");
await q(`delete from public.web_eventos where sesion_id = $1 and secuencia = 10`, [S1]);

// Sin consentimiento: errores sí, pero sin visitante persistente.
r = await ingerir([ev({ tipo: "error_js", categoria: "error", consentimiento: false, sesion_id: S2, visitante_id: V1, secuencia: 1,
                        ocurrido_en: iso(10_000), ruta: "/carta", huella: "a".repeat(32), mensaje: "TypeError: x is undefined", gravedad: "error" })]);
igual(r.aceptados, 1, "error sin consentimiento aceptado");
igual((await q(`select visitante_id from public.web_eventos where sesion_id = $1`, [S2])).rows[0].visitante_id, null, "sin consentimiento no se guarda visitante");

// Entorno no aceptado (local por defecto), inválidos y fecha acotada.
r = await ingerir([ev({ tipo: "pagina_vista", sesion_id: randomUUID(), secuencia: 1, ruta: "/" })], { entorno: "local" });
igual([r.aceptados, r.motivo], [0, "entorno_no_aceptado"], "local no se acepta por defecto");
r = await ingerir([ev({ tipo: "Pagina Vista!", sesion_id: randomUUID() }), ev({ tipo: "x", categoria: "nada" }),
                   ev({ tipo: "error_js", categoria: "error", huella: null })]);
igual([r.aceptados, r.rechazados], [0, 3], "eventos inválidos rechazados");
const futuro = randomUUID();
await ingerir([ev({ evento_id: futuro, tipo: "clic", sesion_id: randomUUID(), secuencia: 1, ocurrido_en: "2099-01-01T00:00:00Z", objetivo: "x" })]);
ok((await q(`select ocurrido_en <= now() + interval '5 minutes' f from public.web_eventos where evento_id = $1`, [futuro])).rows[0].f,
   "una hora del navegador en el futuro se acota");

// Tope por sesión (los errores no cuentan), rutas excluidas, límite por IP y cupo diario.
await q("update public.web_logs_config set limite_eventos_sesion = 20, rutas_excluidas = array['/privado']");
const S3 = randomUUID();
const muchos = Array.from({ length: 25 }, (_, i) => ev({ tipo: "scroll", sesion_id: S3, secuencia: i + 1, valor: 25, ruta: "/" }));
muchos.push(ev({ tipo: "error_js", categoria: "error", sesion_id: S3, secuencia: 99, huella: "b".repeat(32), mensaje: "boom" }));
muchos.push(ev({ tipo: "pagina_vista", sesion_id: S3, secuencia: 100, ruta: "/privado/x" }));
r = await ingerir(muchos);
igual([r.aceptados, r.descartados], [21, 6], "tope por sesión (20 + el error) y ruta excluida");
await q("update public.web_logs_config set limite_eventos_ip_minuto = 10");
const ip = "c".repeat(64);
r = await ingerir(Array.from({ length: 8 }, () => ev({ tipo: "clic", objetivo: "a" })), { entorno: "produccion", ip_hash: ip });
igual(r.aceptados, 8, "dentro del límite por IP");
r = await ingerir(Array.from({ length: 5 }, () => ev({ tipo: "clic", objetivo: "a" })), { entorno: "produccion", ip_hash: ip });
igual([r.aceptados, r.motivo], [0, "limite_ip"], "límite por IP y minuto");
const hoyAceptados = (await q("select sum(aceptados)::int n from public.web_logs_ingesta_diaria")).rows[0].n;
await q(`update public.web_logs_config set limite_eventos_ip_minuto = 300, limite_eventos_sesion = 400, rutas_excluidas = '{}', limite_eventos_dia = ${hoyAceptados + 102}`);
r = await ingerir(Array.from({ length: 105 }, () => ev({ tipo: "clic", objetivo: "b" })));
igual(r.aceptados, 102, "cupo diario");
await q("update public.web_logs_config set limite_eventos_dia = 50000");
await q("delete from public.web_eventos where objetivo in ('a', 'b')");
const cont = (await q("select sum(aceptados)::int a, sum(duplicados)::int d, sum(rechazados)::int x from public.web_logs_ingesta_diaria where entorno = 'produccion'")).rows[0];
ok(cont.a > 0 && cont.d === 9 && cont.x === 3, "contadores diarios de la ingesta");

// ─── 4. Agrupación de errores e incidencias ─────────────────────────────────
const H1 = "d".repeat(32);
const errores = (n, sesiones, extra = {}) =>
  Array.from({ length: n }, (_, i) => ev({ tipo: "error_js", categoria: "error", gravedad: "error", huella: H1, ruta: "/carta/vinos",
    mensaje: "TypeError: vino.precio is null", sesion_id: sesiones[i % sesiones.length], secuencia: 50 + i, version: "0.40", ...extra }));
await ingerir(errores(2, [S1]));
r = await agrupar();
let inc = (await q(`select * from public.web_incidencias where huella = $1`, [H1])).rows[0];
igual([inc.ocurrencias, inc.sesiones_afectadas, inc.linear_estado, inc.estado], [2, 1, "sin_ticket", "nueva"], "por debajo del umbral no hay ticket");
await ingerir(errores(1, [S2]));
await Promise.all([agrupar(), agrupar()]); // cron y «Procesar ahora» a la vez
const filas = (await q(`select * from public.web_incidencias where huella = $1`, [H1])).rows;
igual(filas.length, 1, "una sola incidencia por huella aunque se agrupe dos veces a la vez");
inc = filas[0];
igual([inc.ocurrencias, inc.sesiones_afectadas, inc.linear_estado, inc.requiere_ticket], [3, 2, "pendiente", true], "umbral alcanzado: ticket pendiente");
ok(/3 ocurrencias y 2 sesiones/.test(inc.motivo_ticket), "motivo del ticket con cifras");
igual(inc.rutas, [{ ruta: "/carta/vinos", n: 3 }], "rutas afectadas");
igual((await q("select count(*)::int n from public.web_eventos where huella = $1 and incidencia_id is null", [H1])).rows[0].n, 0, "todos los eventos enlazados");

// El mismo error en la demo no abre ticket (entornos_ticket = produccion).
await ingerir(errores(5, [randomUUID(), randomUUID()]), { entorno: "demo" });
await agrupar();
const demo = (await q(`select * from public.web_incidencias where huella = $1 and entorno = 'demo'`, [H1])).rows[0];
igual([demo.ocurrencias, demo.linear_estado], [5, "sin_ticket"], "la demo no abre tickets por defecto");

// Crítico: ticket con la primera ocurrencia. Servidor: sin sesiones.
await ingerir([ev({ tipo: "error_servidor", categoria: "error", fuente: "servidor", proyecto: "servidor", gravedad: "critico",
                    huella: "e".repeat(32), mensaje: "reservas-web 500", consentimiento: false })]);
// 404: con 30 en 24 h no hay ticket mientras tickets_404 esté apagado.
await ingerir(Array.from({ length: 30 }, (_, i) => ev({ tipo: "error_404", categoria: "error", gravedad: "aviso", huella: "f".repeat(32),
                                                         ruta: "/carta/viejo", sesion_id: randomUUID(), secuencia: i })));
// Patrón ignorado (extensión del navegador).
await ingerir(Array.from({ length: 5 }, () => ev({ tipo: "error_js", categoria: "error", huella: "1".repeat(32), sesion_id: randomUUID(),
                                                    mensaje: "Error in chrome-extension://abc/content.js" })));
// Bots no cuentan.
await ingerir(Array.from({ length: 6 }, () => ev({ tipo: "error_js", categoria: "error", huella: "2".repeat(32), sesion_id: randomUUID(), es_bot: true, mensaje: "bot" })));
await agrupar();
const porHuella = async (h) => (await q(`select * from public.web_incidencias where huella = $1 and entorno = 'produccion'`, [h])).rows[0];
igual((await porHuella("e".repeat(32))).linear_estado, "pendiente", "un crítico abre ticket a la primera");
igual((await porHuella("f".repeat(32))).linear_estado, "sin_ticket", "los 404 no abren ticket por defecto");
const ign = await porHuella("1".repeat(32));
igual([ign.estado, ign.linear_estado], ["ignorada", "sin_ticket"], "patrón ignorado");
const bot = await porHuella("2".repeat(32));
igual([bot.ocurrencias, bot.linear_estado], [0, "sin_ticket"], "los bots no cuentan");
await q("update public.web_logs_config set tickets_404 = true");
await ingerir([ev({ tipo: "error_404", categoria: "error", gravedad: "aviso", huella: "f".repeat(32), ruta: "/carta/viejo", sesion_id: randomUUID() })]);
await agrupar();
igual((await porHuella("f".repeat(32))).linear_estado, "pendiente", "con tickets_404 y por encima del umbral diario, sí");

// RLS de incidencias: el super admin cambia estado y nota; nada más.
await rechaza(U.SA, `update public.web_incidencias set ocurrencias = 0 where huella = '${H1}'`, /permission denied/, "las cifras no se editan a mano");
const tocadas = await staff(`update public.web_incidencias set nota = 'x' returning id`).catch(() => ({ rows: [] }));
igual(tocadas.rows.length, 0, "el personal no ve ni toca incidencias");

// Reapertura (política «reabrir»): ticket creado → reabierta y aviso pendiente al ticket.
await q(`update public.web_incidencias set linear_estado = 'creado', linear_issue_id = 'iss_1', linear_identificador = 'CT-1' where huella = '${H1}' and entorno = 'produccion'`);
await sa(`update public.web_incidencias set estado = 'resuelta', nota = 'arreglado en 0.41' where huella = '${H1}' and entorno = 'produccion'`);
inc = await porHuella(H1);
ok(inc.estado === "resuelta" && inc.resuelta_en !== null, "resolver a mano fija resuelta_en");
await new Promise((res) => setTimeout(res, 20));
await ingerir(errores(1, [S1], { ocurrido_en: new Date().toISOString(), version: "0.41" }));
r = await agrupar();
inc = await porHuella(H1);
igual([inc.estado, inc.reabierta_veces, inc.linear_pendiente_reapertura, inc.linear_estado, inc.version_ultima],
      ["reabierta", 1, true, "creado", "0.41"], "reaparece tras resolverse: se reabre el mismo ticket");
// Política «nuevo_ticket»: id nuevo y el anterior enlazado en el motivo.
await q("update public.web_logs_config set reapertura = 'nuevo_ticket'");
const uuidAntes = inc.linear_uuid;
await sa(`update public.web_incidencias set estado = 'resuelta' where id = ${inc.id}`);
await q(`update public.web_incidencias set linear_pendiente_reapertura = false where id = ${inc.id}`);
await new Promise((res) => setTimeout(res, 20));
await ingerir(errores(3, [S1, S2], { ocurrido_en: new Date().toISOString() }));
await agrupar();
inc = await porHuella(H1);
ok(inc.linear_uuid !== uuidAntes && inc.linear_issue_id === null && inc.linear_estado === "pendiente", "nuevo ticket con id nuevo");
ok(/ticket anterior: CT-1/.test(inc.motivo_ticket), "el ticket nuevo enlaza el anterior");
await q("update public.web_logs_config set reapertura = 'reabrir'");

// ─── 5. Estadísticas: cuadran con los eventos ───────────────────────
const hoy = (await q("select (now() at time zone 'Europe/Madrid')::date::text d")).rows[0].d;
const est = (await sa(`select public.web_comportamiento($1::date - 6, $1::date, 'produccion', false) r`, [hoy])).rows[0].r;
const sesionesEsperadas = (await q(`select count(*)::int n from public.web_sesiones where entorno = 'produccion' and not es_bot and not es_interno and not es_prueba`)).rows[0].n;
igual(est.resumen.sesiones, sesionesEsperadas, "sesiones de las estadísticas = sesiones registradas");
const pv = (await q(`select count(*)::int n from public.web_eventos e join public.web_sesiones s using (sesion_id)
                     where e.tipo = 'pagina_vista' and s.entorno = 'produccion' and not s.es_bot`)).rows[0].n;
igual(Number(est.resumen.paginas_vistas), pv, "páginas vistas = eventos pagina_vista");
igual(Number(est.resumen.conversiones), 1, "una sola conversión: la reserva aceptada por el servidor");
const reserva = est.embudos.find((e) => e.operacion === "reserva");
igual([reserva.consulta, reserva.inicio, reserva.envio, reserva.fin], [1, 1, 1, 1], "embudo de reservas");
igual(est.origenes.find((o) => o.origen_tipo === "qr")?.sesiones, 1, "procedencia QR");
igual(est.recorridos[0]?.recorrido, "/ → /reservas", "recorrido frecuente");
const pagIni = est.paginas.find((p) => p.ruta === "/");
igual([pagIni.vistas, Number(pagIni.tiempo_medio_s), Number(pagIni.scroll_medio)], [1, 10, 60], "tiempo y scroll de la portada");
igual(est.periodo.zona, "Europe/Madrid", "zona horaria declarada");
ok(est.errores_por_ruta.some((e) => e.ruta === "/carta/vinos"), "errores por página");
const estStaff = (await staff(`select public.web_comportamiento($1::date - 6, $1::date, 'produccion', false) r`, [hoy])).rows[0].r;
igual(estStaff.resumen.sesiones, 0, "sin ser super admin, las estadísticas salen vacías (RLS)");

// ─── 6. Contexto, búsquedas y salud ─────────────────────────────────────────
const idReserva = (await q(`select id from public.web_eventos where tipo = 'reserva_solicitada'`)).rows[0].id;
const ctx = (await sa(`select tipo, secuencia from public.web_contexto_evento($1, 3, 2) order by ocurrido_en, secuencia`, [idReserva])).rows;
igual(ctx.map((e) => e.secuencia), [5, 6, 7, 8, 9, 50], "contexto antes y después en orden");
const ses = (await sa(`select (sesion).sesion_id, total from public.web_buscar_sesiones(now() - interval '1 day', now() + interval '1 hour', 'produccion', '/reservas')`)).rows;
igual([ses.length, Number(ses[0].total)], [1, 1], "buscar sesiones por página");
const evs = (await sa(`select total from public.web_buscar_eventos(now() - interval '1 day', now() + interval '1 hour', 'produccion', 'error', null, null, null, null, null, 'vino', false, false, 5, 0)`)).rows;
ok(evs.length > 0 && Number(evs[0].total) >= 3, "buscar eventos de error por texto");
const salud = (await sa(`select public.web_logs_estado_recogida('produccion') r`)).rows[0].r;
ok(salud.fuentes.some((f) => f.fuente === "navegador" && f.n_1h > 0), "salud: hay eventos del navegador");
igual(salud.vercel_ultimo_dia.visitas, 12, "salud: referencia de Vercel");

// ─── 7. Configuración ───────────────────────────────────────────────────────
await sa("update public.web_logs_config set umbral_ocurrencias = 5");
igual((await q("select umbral_ocurrencias, actualizado_por from public.web_logs_config")).rows[0], { umbral_ocurrencias: 5, actualizado_por: U.SA }, "el super admin edita la configuración");
await rechaza(U.SA, "update public.web_logs_config set entorno_bd = 'demo'", /permission denied/, "entorno_bd no se edita desde el panel");
await rechaza(U.SA, "update public.web_logs_config set umbral_ocurrencias = 0", /check/, "umbral fuera de rango");
const nada = await staff("update public.web_logs_config set umbral_ocurrencias = 9 returning 1").catch(() => ({ rows: [] }));
igual(nada.rows.length, 0, "el personal no edita la configuración");

// ─── 8. Operaciones registradas por la BD ───────────────────────────────────
const idR = (await q("insert into public.reservas (canal, estado, numero_comensales) values ('web', 'pendiente', 4) returning id")).rows[0].id;
await q("insert into public.reservas (canal, estado, numero_comensales) values ('telefono', 'pendiente', 2)");
await q(`update public.reservas set estado = 'confirmada' where id = '${idR}'`);
await q(`update public.reservas set estado = 'pendiente' where id = '${idR}'`);
await q(`update public.reservas set estado = 'confirmada' where id = '${idR}'`);
const idC = (await q("insert into public.cheques_regalo (origen, estado, importe_eur) values ('web', 'pendiente', 50) returning id")).rows[0].id;
await q(`update public.cheques_regalo set estado = 'pagado' where id = '${idC}'`);
await q("insert into public.cheques_regalo (origen, estado, importe_eur) values ('manual', 'pagado', 30)");
const bd = (await q("select tipo, count(*)::int n, sum(valor)::int v from public.web_eventos where fuente = 'base_datos' group by tipo order by tipo")).rows;
igual(bd, [{ tipo: "cheque_pagado_bd", n: 1, v: 50 }, { tipo: "reserva_confirmada_bd", n: 1, v: 4 }, { tipo: "reserva_creada_bd", n: 1, v: 4 }],
      "una vez por operación web, aunque el estado vaya y vuelva");
await q("alter table public.web_eventos rename to web_eventos_x");
await q("insert into public.reservas (canal, estado, numero_comensales) values ('web', 'pendiente', 2)");
await q("alter table public.web_eventos_x rename to web_eventos");
ok(true, "si registrar falla, la reserva entra igual");
comprobaciones++;

// ─── 9. Purga ───────────────────────────────────────────────────────────────
await q("update public.web_eventos set ocurrido_en = now() - interval '100 days' where sesion_id = $1 and categoria <> 'error'", [S3]);
const purga = await como(null, async () => (await q("select public.web_logs_purgar() r")).rows[0].r, "service_role");
igual(purga.eventos, 20, "purga de actividad fuera de retención (90 días)");
ok((await q("select count(*)::int n from public.web_eventos where sesion_id = $1", [S3])).rows[0].n === 1, "los errores tienen su propia retención");


// ─── 9 bis. Errores «tras publicar» y explicación en sencillo ──────────────
{
  // Mismo patrón que PATRON_CHUNK_CADUCADO (huella.ts).
  const fuenteTs = /PATRON_CHUNK_CADUCADO =\s*\/(.+)\/i;/.exec(HUELLA_TS)?.[1];
  ok(fuenteTs, "huella.ts sigue definiendo PATRON_CHUNK_CADUCADO");
  const reTs = new RegExp(fuenteTs, "i");
  const muestras = [
    ["error_promesa", "TypeError: Failed to fetch dynamically imported module: https://w/assets/Carta-AbCd1234.js", null],
    ["error_js", "TypeError: Importing a module script failed.", null],
    ["error_react", "Error: Unable to preload CSS for /assets/x-AbCd1234.css", null],
    ["error_js", "ChunkLoadError: Loading chunk 12 failed.", null],
    ["error_js", "TypeError: 'text/html' is not a valid JavaScript MIME type.", null],
    ["error_js", "TypeError: vino.precio is null", null],
    ["error_promesa", "TypeError: Failed to fetch", null],
  ];
  for (const [tipo, mensaje] of muestras) {
    const sql = (await q("select public.web_logs_es_version_antigua($1, $2, null, null) r", [tipo, mensaje])).rows[0].r;
    igual(sql, reTs.test(mensaje), `SQL y huella.ts opinan igual de «${mensaje}»`);
  }
  igual((await q("select public.web_logs_es_version_antigua('error_recurso', null, null, 'https://w/assets/index-AbCd_123.js') r")).rows[0].r, true, "recurso de un despliegue");
  igual((await q("select public.web_logs_es_version_antigua('error_recurso', null, null, 'https://w/fotos/plato.jpg') r")).rows[0].r, false, "una foto no es un fichero de versión");

  await q("update public.web_logs_config set umbral_ocurrencias = 3, umbral_sesiones = 2");
  const HC = "1e".repeat(16);
  const MSG = "TypeError: Failed to fetch dynamically imported module: https://w/assets/Carta-AbCd1234.js";
  const chunk = (o) => ev({ tipo: "error_promesa", categoria: "error", gravedad: "error", huella: HC, ruta: "/carta", mensaje: MSG, ...o });
  const [A, B, C, D, E, F] = Array.from({ length: 6 }, () => randomUUID());
  await ingerir([
    // A: mandado por la página ya recargada (props.recargado) → sin impacto.
    chunk({ sesion_id: A, secuencia: 1, ocurrido_en: iso(9_000), propiedades: { recargado: true, origen: "lazy" } }),
    // B: sesión con consentimiento que sigue navegando después → sin impacto.
    chunk({ sesion_id: B, secuencia: 1, ocurrido_en: iso(9_000) }),
    ev({ tipo: "pagina_vista", sesion_id: B, secuencia: 2, ocurrido_en: iso(8_000), ruta: "/carta", propiedades: { navegacion: "inicial" } }),
    // C: sin consentimiento, nada después → sin datos.
    chunk({ sesion_id: C, secuencia: 1, consentimiento: false, ocurrido_en: iso(9_000) }),
    // D: recargó (aviso «recargado») y volvió a fallar en la misma carga → repetido.
    chunk({ sesion_id: D, secuencia: 1, consentimiento: false, ocurrido_en: iso(9_000), propiedades: { recargado: true } }),
    chunk({ sesion_id: D, secuencia: 2, consentimiento: false, ocurrido_en: iso(8_000) }),
  ]);
  await agrupar();
  const clase = async (sesion) => (await q("select tras_publicar t from public.web_eventos where sesion_id = $1 and categoria = 'error' order by ocurrido_en", [sesion])).rows.map((x) => x.t);
  igual(await clase(A), ["sin_impacto"], "recargada sola: sin impacto");
  igual(await clase(B), ["sin_impacto"], "siguió navegando: sin impacto");
  igual(await clase(C), ["sin_datos"], "sin datos de después");
  igual(await clase(D), ["sin_impacto", "repetido"], "falla otra vez tras recargar: repetido");
  let ic = (await q("select * from public.web_incidencias where huella = $1", [HC])).rows[0];
  igual([ic.ocurrencias, ic.ocurrencias_tras_publicar, ic.repetidas_tras_recargar, ic.ocurrencias_ventana, ic.sesiones_ventana], [5, 4, 1, 1, 1],
        "cifras: solo la repetida cuenta para los umbrales");
  igual(ic.linear_estado, "sin_ticket", "5 ocurrencias de versión antigua en 4 sesiones no abren ticket");

  // E: con consentimiento, falla, recarga entera (pagina_vista inicial) y vuelve a fallar → repetido; otra sesión igual → umbral.
  await ingerir([
    chunk({ sesion_id: E, secuencia: 1, ocurrido_en: iso(7_000) }),
    ev({ tipo: "pagina_vista", sesion_id: E, secuencia: 2, ocurrido_en: iso(6_500), ruta: "/carta", propiedades: { navegacion: "inicial" } }),
    chunk({ sesion_id: E, secuencia: 3, ocurrido_en: iso(6_000) }),
    chunk({ sesion_id: F, secuencia: 1, consentimiento: false, ocurrido_en: iso(5_000), propiedades: { recargado: true } }),
    chunk({ sesion_id: F, secuencia: 2, consentimiento: false, ocurrido_en: iso(4_000) }),
  ]);
  await agrupar();
  igual(await clase(E), ["sin_impacto", "repetido"], "recarga completa entre medias: la segunda es repetida");
  ic = (await q("select * from public.web_incidencias where huella = $1", [HC])).rows[0];
  igual([ic.repetidas_tras_recargar, ic.ocurrencias_ventana, ic.sesiones_ventana, ic.linear_estado], [3, 3, 3, "pendiente"],
        "se repite tras recargar en 3 sesiones: ahora sí pide ticket");

  // Con la marca de la web (`accion`, web-casatomas recarga-por-version.ts): es la señal principal.
  const HA = "1a".repeat(16);
  const marca = (accion, o = {}) => chunk({ huella: HA, accion, sesion_id: randomUUID(), secuencia: 1, consentimiento: false, ocurrido_en: iso(4_500), ...o });
  const [G, Hs, I, J, K, L, M] = Array.from({ length: 7 }, () => randomUUID());
  await ingerir([
    marca("recuperado_tras_recarga", { sesion_id: G, propiedades: { recargado: true } }),
    marca("recarga_sin_efecto", { sesion_id: Hs, propiedades: { recargado: true } }), // recargado, pero NO se arregló
    marca("aviso_version_nueva", { sesion_id: I }),
    marca("sin_conexion", { sesion_id: J }),
    marca("sin_version_nueva", { sesion_id: K }),
    // «Load failed» no es el patrón de versión antigua, pero la web lo marcó: manda la marca.
    marca("recuperado_tras_recarga", { sesion_id: M, mensaje: "TypeError: Load failed · recuperado: la pestaña se recargó sola con la versión nueva (antes: v1.11.0)" }),
    // Un bot (horas falsas): no se clasifica ni cuenta.
    marca(null, { sesion_id: L, es_bot: true, ocurrido_en: "2099-01-01T00:00:00Z" }),
  ]);
  await agrupar();
  const unaClase = async (sesion) => (await q("select tras_publicar t from public.web_eventos where sesion_id = $1", [sesion])).rows[0].t;
  igual([await unaClase(G), await unaClase(Hs), await unaClase(I), await unaClase(J), await unaClase(K), await unaClase(M), await unaClase(L)],
        ["sin_impacto", "repetido", "repetido", "sin_conexion", null, "sin_impacto", null], "la marca de la web decide la clase; el bot no se clasifica");
  const ia = (await q("select * from public.web_incidencias where huella = $1", [HA])).rows[0];
  igual([ia.ocurrencias, ia.ocurrencias_tras_publicar, ia.repetidas_tras_recargar, ia.ocurrencias_ventana, ia.sesiones_ventana, ia.linear_estado],
        [6, 3, 2, 3, 3, "pendiente"], "cuentan «recargar no lo arregló» y «no había versión nueva»; no cuentan recuperadas, sin conexión ni bots");

  // Tráfico interno: no cuenta para los umbrales (con «no contar pruebas»).
  const HI = "1f".repeat(16);
  await ingerir(Array.from({ length: 4 }, (_, i) => ev({ tipo: "error_js", categoria: "error", gravedad: "error", huella: HI, mensaje: "Error interno",
    sesion_id: randomUUID(), secuencia: 1, es_interno: true, ocurrido_en: iso(3_000 - i) })));
  await agrupar();
  let ii = (await q("select ocurrencias, ocurrencias_ventana, linear_estado from public.web_incidencias where huella = $1", [HI])).rows[0];
  igual([ii.ocurrencias, ii.ocurrencias_ventana, ii.linear_estado], [4, 0, "sin_ticket"], "el tráfico interno no abre tickets");
  await q("update public.web_logs_config set excluir_pruebas_tickets = false");
  await q("update public.web_eventos set ocurrido_en = ocurrido_en where huella = $1", [HI]);
  await agrupar();
  ii = (await q("select ocurrencias_ventana, linear_estado from public.web_incidencias where huella = $1", [HI])).rows[0];
  igual([ii.ocurrencias_ventana, ii.linear_estado], [4, "pendiente"], "si se quiere contar el tráfico interno, se configura");
  await q("update public.web_logs_config set excluir_pruebas_tickets = true");

  // Al aplicar la migración: las pendientes que solo tenían errores esperados vuelven a «sin ticket» (no las pedidas a mano).
  const HV = "19".repeat(16);
  const HM = "18".repeat(16);
  await ingerir([chunk({ huella: HV, sesion_id: randomUUID(), secuencia: 1, consentimiento: false, ocurrido_en: iso(2_000) }),
                 chunk({ huella: HM, sesion_id: randomUUID(), secuencia: 1, consentimiento: false, ocurrido_en: iso(2_000) })]);
  await agrupar();
  await q("update public.web_incidencias set linear_estado = 'pendiente', requiere_ticket = true, motivo_ticket = '3 ocurrencias…' where huella = $1", [HV]);
  await q("update public.web_incidencias set linear_estado = 'pendiente', requiere_ticket = true, motivo_ticket = 'Pedido a mano desde Super Admin › Logs' where huella = $1", [HM]);
  await db.exec(LEGIBLES);
  const vuelta = (await q("select huella, linear_estado from public.web_incidencias where huella in ($1, $2) order by huella", [HM, HV])).rows;
  igual(vuelta.map((x) => x.linear_estado), ["pendiente", "sin_ticket"], "vuelve a «sin ticket» la automática; la pedida a mano, no");
  igual((await q("select linear_estado from public.web_incidencias where huella = $1", [HC])).rows[0].linear_estado, "pendiente",
        "la que se repite tras recargar sigue pendiente");

  // Explicación de la IA: la escribe el servidor; el super admin la lee, nadie más la escribe desde el panel.
  await q("update public.web_incidencias set explicacion_ia = $2::jsonb, explicacion_ia_en = now() where huella = $1",
          [HI, JSON.stringify({ que_paso: "x", a_quien_afecta: "y", que_hacer: "z", gravedad: "baja" })]);
  igual((await sa("select explicacion_ia ->> 'que_paso' t from public.web_incidencias where huella = $1", [HI])).rows[0].t, "x", "el super admin lee la explicación");
  await rechaza(U.SA, `update public.web_incidencias set explicacion_ia = '{}'::jsonb`, /permission denied/, "la explicación no se edita desde el panel");
  await rechaza(null, `update public.web_incidencias set explicacion_ia = '"texto"'::jsonb where huella = '${HI}'`, /check/, "la explicación es un objeto", "service_role");
  await rechaza(U.SA, "select public.web_logs_clasificar_tras_publicar(now())", /permission denied/, "clasificar es solo del servidor");

  // Vuelta atrás de esta migración: agrupación anterior y sin columnas nuevas; y se puede volver a aplicar.
  await db.exec(ROLLBACK_LEGIBLES);
  igual((await q("select count(*)::int n from information_schema.columns where table_name = 'web_eventos' and column_name = 'tras_publicar'")).rows[0].n, 0, "el rollback quita la clasificación");
  await agrupar();
  ok(true, "la agrupación anterior funciona tras el rollback");
  await db.exec(LEGIBLES);
  igual((await q("select tras_publicar t from public.web_eventos where sesion_id = $1 order by ocurrido_en", [D])).rows.map((x) => x.t), ["sin_impacto", "repetido"],
        "al volver a aplicarla, reclasifica lo guardado");
}

// ─── 9 ter. Origen: fallo de la web / servicio externo / no depende de la web ─
{
  await db.exec(ORIGEN);
  await db.exec(ORIGEN); // idempotente
  comprobaciones++;

  // Mismos casos que origen.ts (vitest): el SQL clasifica igual.
  for (const c of CASOS_ORIGEN) {
    const d = c.datos;
    const r = (await q("select public.web_logs_origen_error($1, $2, $3, $4, $5, $6::jsonb, $7, $8) o, public.web_logs_proveedor_externo($1, $2, $3, $4, $5) p",
      [d.tipo, d.fuente ?? null, d.mensaje ?? null, d.pila ?? null, d.objetivo ?? null, JSON.stringify(d.propiedades ?? {}), d.accion ?? null, d.tras_publicar ?? null])).rows[0];
    igual([r.o, c.origen === "externo" ? r.p : null], [c.origen, c.proveedor], `SQL = origen.ts: ${c.nombre}`);
  }

  await q("update public.web_logs_config set umbral_ocurrencias = 3, umbral_sesiones = 2, linear_tickets_externos = false, excluir_pruebas_tickets = true");
  const H = { con: "2a".repeat(16), web: "2b".repeat(16), ext: "2c".repeat(16), nav: "2d".repeat(16), int: "2e".repeat(16), mix: "2f".repeat(16) };
  const err = (o) => ev({ categoria: "error", gravedad: "error", consentimiento: false, sesion_id: randomUUID(), secuencia: 1, ocurrido_en: iso(1_500), ...o });
  const [S, T] = [randomUUID(), randomUUID()];
  await ingerir([
    // La captura del dueño: 3 «Sin respuesta» en 3 sesiones (supera los umbrales de antes).
    ...[0, 1, 2].map((i) => err({ tipo: "error_peticion", huella: H.con, objetivo: "rest:novedades", mensaje: "Sin respuesta de rest:novedades (sin conexión)",
      propiedades: { status: 0, endpoint: "rest:novedades", metodo: "GET" }, ocurrido_en: iso(1_500 - i) })),
    // Un fallo nuestro, en la sesión S (con consentimiento) y otras dos.
    err({ tipo: "error_js", huella: H.web, mensaje: "TypeError: vino.precio is null", sesion_id: S, consentimiento: true }),
    ev({ tipo: "pagina_vista", sesion_id: S, secuencia: 2, ocurrido_en: iso(1_400), ruta: "/carta", propiedades: { navegacion: "inicial" } }),
    err({ tipo: "error_js", huella: H.web, mensaje: "TypeError: vino.precio is null" }),
    err({ tipo: "error_js", huella: H.web, mensaje: "TypeError: vino.precio is null" }),
    // Google Maps (externo), también en S, y en otras dos sesiones.
    err({ tipo: "error_js", huella: H.ext, mensaje: "Google Maps JavaScript API error: RefererNotAllowedMapError", sesion_id: S, consentimiento: true, secuencia: 3 }),
    err({ tipo: "error_js", huella: H.ext, mensaje: "Google Maps JavaScript API error: RefererNotAllowedMapError" }),
    err({ tipo: "error_js", huella: H.ext, mensaje: "Google Maps JavaScript API error: RefererNotAllowedMapError" }),
    // Extensión del navegador, en la sesión T.
    ...[0, 1, 2].map(() => err({ tipo: "error_js", huella: H.nav, mensaje: "TypeError: x is undefined", pila: "at chrome-extension://abc/content.js:1:1", sesion_id: T, consentimiento: true })),
    // Solo tráfico interno.
    err({ tipo: "error_js", huella: H.int, mensaje: "TypeError: interno", es_interno: true }),
    // Mezcla: dos que se arreglaron solas y una que no se arregló al recargar.
    err({ tipo: "error_promesa", huella: H.mix, mensaje: "TypeError: Importing a module script failed.", accion: "recuperado_tras_recarga" }),
    err({ tipo: "error_promesa", huella: H.mix, mensaje: "TypeError: Importing a module script failed.", accion: "recuperado_tras_recarga" }),
    err({ tipo: "error_promesa", huella: H.mix, mensaje: "TypeError: Importing a module script failed.", accion: "recarga_sin_efecto" }),
  ]);
  await agrupar();
  const inc = async (h) => (await q("select * from public.web_incidencias where huella = $1", [h])).rows[0];
  const [con, web, ext, nav, int, mix] = await Promise.all([H.con, H.web, H.ext, H.nav, H.int, H.mix].map(inc));
  igual([con.origen, web.origen, ext.origen, nav.origen, int.origen, mix.origen], ["conexion", "web", "externo", "navegador", "bots", "web"],
        "origen de cada incidencia (la mezcla es de la web: una no se arregló al recargar)");
  igual([con.origen_prioridad, web.origen_prioridad, ext.origen_prioridad, int.origen_prioridad], [3, 1, 2, 3], "prioridad para ordenar y filtrar");
  igual([ext.origen_proveedor, con.origen_proveedor], ["Google Maps", null], "proveedor solo en las externas");
  igual((await q("select array_agg(distinct origen) o from public.web_eventos where huella = $1", [H.con])).rows[0].o, ["conexion"], "cada ocurrencia guarda su origen");
  igual([con.ocurrencias, con.ocurrencias_ventana, con.linear_estado], [3, 0, "sin_ticket"], "la conexión del visitante no cuenta ni abre ticket");
  igual([web.ocurrencias_ventana, web.linear_estado], [3, "pendiente"], "el fallo de la web sí");
  igual([ext.ocurrencias_ventana, ext.linear_estado], [0, "sin_ticket"], "el servicio externo no, por defecto");
  igual([nav.linear_estado, int.linear_estado], ["sin_ticket", "sin_ticket"], "ni extensiones ni tráfico interno");
  igual([mix.ocurrencias_ventana, mix.linear_estado], [1, "sin_ticket"], "de la mezcla solo cuenta la que no se arregló (1 < umbral)");

  // Errores por sesión: S tiene 1 de la web y 1 externo; T, 3 de una extensión.
  const ses = (await q("select sesion_id, errores, errores_web, errores_externos from public.web_sesiones where sesion_id in ($1, $2)", [S, T])).rows;
  const deS = ses.find((x) => x.sesion_id === S), deT = ses.find((x) => x.sesion_id === T);
  igual([deS?.errores, deS?.errores_web, deS?.errores_externos], [2, 1, 1], "sesión con un fallo de la web y uno externo");
  igual([deT?.errores, deT?.errores_web, deT?.errores_externos], [3, 0, 0], "sesión con errores que no dependen de la web");

  // Con el interruptor, los externos cuentan y abren ticket.
  await q("update public.web_logs_config set linear_tickets_externos = true");
  await q("update public.web_eventos set ocurrido_en = ocurrido_en where huella = $1", [H.ext]);
  await agrupar();
  igual([(await inc(H.ext)).ocurrencias_ventana, (await inc(H.ext)).linear_estado], [3, "pendiente"], "externos con el interruptor encendido: ticket");
  // Si se apaga antes de crearlo, vuelve a «sin ticket» y lo dice.
  await q("update public.web_logs_config set linear_tickets_externos = false");
  await agrupar();
  const ext2 = await inc(H.ext);
  igual(ext2.linear_estado, "sin_ticket", "apagado el interruptor: la pendiente externa se suelta");
  ok(/Servicio externo \(Google Maps\)/.test(ext2.motivo_ticket), "y dice por qué");

  // Una pendiente que no depende de la web vuelve a «sin ticket»; la pedida a mano, no.
  await q("update public.web_incidencias set linear_estado = 'pendiente', requiere_ticket = true, motivo_ticket = '3 ocurrencias…' where huella = $1", [H.con]);
  await agrupar();
  igual((await inc(H.con)).linear_estado, "sin_ticket", "pendiente de conexión: se suelta");
  await sa("select public.web_incidencia_pedir_ticket($1)", [nav.id]);
  let nav2 = await inc(H.nav);
  igual(nav2.linear_estado, "pendiente", "«Pedir ticket» a mano vale para cualquiera");
  ok(nav2.motivo_ticket.startsWith("Pedido a mano"), "y el motivo empieza por «Pedido a mano» (aunque hubiera otro)");
  await agrupar();
  nav2 = await inc(H.nav);
  igual(nav2.linear_estado, "pendiente", "la pedida a mano no se suelta");

  // Reapertura: el ticket de la web se reabre; el de una que no depende de la web, no (no se toca).
  await q("update public.web_incidencias set estado = 'resuelta', linear_estado = 'creado', linear_issue_id = 'X', linear_destino = 'prueba' where huella in ($1, $2)", [H.con, H.web]);
  await q("update public.web_incidencias set resuelta_en = now() - interval '1 hour' where huella in ($1, $2)", [H.con, H.web]); // el trigger pone now() al resolver
  await ingerir([
    err({ tipo: "error_peticion", huella: H.con, objetivo: "rest:novedades", mensaje: "Sin respuesta de rest:novedades", propiedades: { status: 0 }, ocurrido_en: iso(500) }),
    err({ tipo: "error_js", huella: H.web, mensaje: "TypeError: vino.precio is null", ocurrido_en: iso(500) }),
  ]);
  await agrupar();
  const [con3, web3] = [await inc(H.con), await inc(H.web)];
  igual([con3.estado, con3.linear_pendiente_reapertura, con3.linear_estado], ["reabierta", false, "creado"], "conexión: se reabre aquí, pero su ticket no se toca");
  igual([web3.estado, web3.linear_pendiente_reapertura], ["reabierta", true], "fallo de la web: se reabre su ticket");

  // Lectura y escritura desde el panel.
  igual((await sa("select origen from public.web_incidencias where huella = $1", [H.con])).rows[0].origen, "conexion", "el super admin lee el origen");
  await sa("update public.web_logs_config set linear_tickets_externos = true");
  igual((await q("select linear_tickets_externos v from public.web_logs_config")).rows[0].v, true, "el super admin cambia el interruptor");
  await q("update public.web_logs_config set linear_tickets_externos = false");
  await rechaza(U.SA, "update public.web_incidencias set origen = 'web'", /permission denied/, "el origen no se edita desde el panel");
  igual((await staff("select count(*)::int n from public.web_incidencias")).rows[0].n, 0, "el personal no ve incidencias");

  // Al aplicar la migración sobre datos de antes: clasifica lo guardado y suelta las pendientes que ya no pueden.
  await db.exec(ROLLBACK_ORIGEN);
  igual((await q("select count(*)::int n from information_schema.columns where table_name = 'web_incidencias' and column_name = 'origen'")).rows[0].n, 0, "el rollback quita el origen");
  const HP = "3a".repeat(16), HQ = "3b".repeat(16);
  await ingerir([...[0, 1, 2].map((i) => err({ tipo: "error_peticion", huella: HP, objetivo: "rest:tapas", mensaje: "Sin respuesta de rest:tapas (sin conexión)",
                   propiedades: { status: 0 }, ocurrido_en: iso(400 - i) })),
                 ...[0, 1, 2].map((i) => err({ tipo: "error_js", huella: HQ, mensaje: "TypeError: otro fallo nuestro", ocurrido_en: iso(400 - i) }))]);
  await agrupar(); // agrupación de antes: las dos llegan al umbral
  igual([(await q("select linear_estado from public.web_incidencias where huella = $1", [HP])).rows[0].linear_estado,
         (await q("select linear_estado from public.web_incidencias where huella = $1", [HQ])).rows[0].linear_estado], ["pendiente", "pendiente"],
        "antes de la migración, la conexión del visitante pedía ticket");
  await db.exec(ORIGEN);
  const [p, qq] = [await inc(HP), await inc(HQ)];
  igual([p.origen, p.linear_estado, p.ocurrencias_ventana], ["conexion", "sin_ticket", 0], "al aplicarla: conexión, sin ticket y sin contar");
  igual([qq.origen, qq.linear_estado], ["web", "pendiente"], "el fallo de la web sigue pendiente");
  igual((await q("select count(*)::int n from public.web_eventos where categoria = 'error' and origen is null")).rows[0].n, 0, "todos los errores guardados tienen origen");
  ok((await q("select errores_web from public.web_sesiones where sesion_id = $1", [S])).rows[0].errores_web === 1, "y las sesiones, sus errores de la web");
}

// ─── 10. Rollbacks ──────────────────────────────────────────────────────────
await db.exec(ROLLBACK_ORIGEN);
await db.exec(ROLLBACK_LEGIBLES);
await db.exec(ROLLBACK_OP);
await db.exec(ROLLBACK);
igual((await q("select to_regclass('public.web_eventos') t")).rows[0].t, null, "el rollback borra las tablas");
await q("insert into public.reservas (canal, estado, numero_comensales) values ('web', 'pendiente', 2)");
await db.exec(MIGRACION);
await db.exec(OPERACIONES);
await db.exec(LEGIBLES);
await db.exec(ORIGEN);
ok((await q("select count(*)::int n from public.web_logs_config")).rows[0].n === 1, "se puede volver a aplicar tras el rollback");

console.log(`✓ Logs web: ${comprobaciones} comprobaciones`);
