// Super Admin › Logs: migraciones 20261118100000 (tablas, RLS, ingesta,
// agrupación, estadísticas, retención) y 20261118100100 (operaciones de la BD)
// contra un Postgres en memoria (PGlite). Nunca toca Supabase.
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
// operación; y los rollbacks.
import { PGlite } from "@electric-sql/pglite";
import { readFile } from "node:fs/promises";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

const MIGRACION = await readFile("supabase/migrations/20261118100000_logs_web.sql", "utf8");
const OPERACIONES = await readFile("supabase/migrations/20261118100100_logs_web_operaciones_bd.sql", "utf8");
const ROLLBACK = await readFile("supabase/rollbacks/20261118100000_logs_web_ROLLBACK.sql", "utf8");
const ROLLBACK_OP = await readFile("supabase/rollbacks/20261118100100_logs_web_operaciones_bd_ROLLBACK.sql", "utf8");

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

// ─── 10. Rollbacks ──────────────────────────────────────────────────────────
await db.exec(ROLLBACK_OP);
await db.exec(ROLLBACK);
igual((await q("select to_regclass('public.web_eventos') t")).rows[0].t, null, "el rollback borra las tablas");
await q("insert into public.reservas (canal, estado, numero_comensales) values ('web', 'pendiente', 2)");
await db.exec(MIGRACION);
await db.exec(OPERACIONES);
ok((await q("select count(*)::int n from public.web_logs_config")).rows[0].n === 1, "se puede volver a aplicar tras el rollback");

console.log(`✓ Logs web: ${comprobaciones} comprobaciones`);
