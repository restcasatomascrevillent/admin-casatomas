// Limitadores y salvaguardas de T4b-ABUSO contra un Postgres en memoria
// (PGlite), con las migraciones REALES del repo. Nunca toca Supabase.
//
//   npm run test:abuso:db
//
// Cubre:
//   FN-07  20261030150000_reservas_web_limitador.sql
//          cupo por IP y hora, cupo global diario, rechazos sin fila,
//          llamadas simultáneas sin superar el cupo, umbrales configurables,
//          1 correo de rechazo por dirección cada 24 h, permisos.
//   FN-03  20261030151000_panel_auth_limite_por_email.sql
//          11 intentos al mismo email desde IPs distintas -> bloqueado;
//          el límite por IP sigue; los logins correctos no cuentan.
//   FN-03  20261030200000_panel_auth_cubo_sin_ip.sql (residual V2)
//          x-audit-ip vacía o ausente -> cubo común «sin-ip» con 30/min.
//   FN-13  20261030152000_superadmin_minimo_uno.sql
//          nunca 0 superadmins (RPC, DELETE directo, cascada, TRUNCATE,
//          dos degradaciones lanzadas a la vez).
//   FN-11  20261030153000_novedades_limpiar_foto_con_secreto.sql
//          trigger con y sin secreto en Vault, sin URL en duro.
//
// Límite de PGlite: es UNA conexión, así que las llamadas "simultáneas"
// (Promise.all) se ejecutan una detrás de otra. La exclusión mutua real
// entre conexiones la da el advisory lock de transacción global, cuya
// presencia se comprueba aquí en pg_locks; el bloqueo entre dos backends
// reales no se puede reproducir en PGlite.
import { PGlite } from "@electric-sql/pglite";
import { readFile } from "node:fs/promises";
import assert from "node:assert/strict";

const M = "supabase/migrations";
const leer = (f) => readFile(`${M}/${f}`, "utf8");
let comprobaciones = 0;
const igual = (v, e, n) => { assert.deepEqual(v, e, n); comprobaciones++; };
const falla = async (p, patron, n) => { await assert.rejects(p, patron, n); comprobaciones++; };
const una = async (db, q, p) => (await db.query(q, p)).rows[0];
const hex = (c) => c.repeat(64);

// =============================================================================
// FN-07 · reservas-web/crear
// =============================================================================
{
  const db = new PGlite();
  await db.exec(`
    create role anon; create role authenticated; create role service_role bypassrls;
    create table public.configuracion_reservas (id uuid primary key default gen_random_uuid(), max_comensales_por_reserva int);
    insert into public.configuracion_reservas (max_comensales_por_reserva) values (12);
  `);
  const MIG = await leer("20261030150000_reservas_web_limitador.sql");
  await db.exec(MIG);
  await db.exec(MIG); // idempotente

  igual((await una(db, "select limite_web_crear_ip_hora a, limite_web_crear_dia b from public.configuracion_reservas")), { a: 10, b: 300 }, "umbrales por defecto 10/h y 300/día");

  const cupo = async (ip) => (await una(db, "select public.reservas_web_reservar_cupo($1) r", [ip])).r;
  const filas = async () => (await una(db, "select count(*)::int n from public.reservas_web_intentos")).n;

  for (let i = 0; i < 10; i++) igual((await cupo(hex("a"))).permitido, true, `solicitud ${i + 1}/10 de la IP admitida`);
  igual(await cupo(hex("a")), { permitido: false, motivo: "max_ip_hora" }, "la solicitud 11 de la misma IP en la hora se bloquea");
  igual(await filas(), 10, "la solicitud bloqueada no deja fila");
  igual((await cupo(hex("b"))).permitido, true, "otra IP no se ve afectada");

  // La ventana se desliza: lo de hace más de una hora no cuenta para la IP.
  await db.exec("update public.reservas_web_intentos set created_at = now() - interval '61 minutes' where ip_hash = repeat('a', 64)");
  igual((await cupo(hex("a"))).permitido, true, "pasada una hora la IP vuelve a tener cupo");

  // Cupo global diario (configurable).
  await db.exec("delete from public.reservas_web_intentos; update public.configuracion_reservas set limite_web_crear_dia = 5");
  for (let i = 0; i < 5; i++) await cupo((i + 1).toString(16).repeat(64).slice(0, 64));
  igual(await cupo(hex("f")), { permitido: false, motivo: "max_dia" }, "cupo global diario agotado bloquea a cualquier IP");
  igual(await filas(), 5, "sin fila al superar el cupo diario");
  await db.exec("update public.configuracion_reservas set limite_web_crear_dia = 300");

  // Sin fila de configuración: valores por defecto.
  await db.exec("delete from public.reservas_web_intentos; delete from public.configuracion_reservas");
  for (let i = 0; i < 10; i++) await cupo(hex("c"));
  igual((await cupo(hex("c"))).motivo, "max_ip_hora", "sin configuración se aplica el 10/h por defecto");
  await db.exec("insert into public.configuracion_reservas (max_comensales_por_reserva) values (12)");

  // Ráfaga "concurrente": 25 llamadas a la vez desde la misma IP -> 10 admitidas.
  await db.exec("delete from public.reservas_web_intentos");
  const rafaga = await Promise.all(Array.from({ length: 25 }, () => cupo(hex("d"))));
  igual(rafaga.filter((r) => r.permitido).length, 10, "una ráfaga simultánea no supera el cupo por IP");
  igual(await filas(), 10, "la ráfaga deja exactamente 10 filas");

  // El cupo se serializa con un advisory lock de transacción global.
  await db.exec("begin");
  await db.query("select public.reservas_web_reservar_cupo($1)", [hex("e")]);
  const locks = await una(db, "select count(*)::int n from pg_locks where locktype = 'advisory'");
  await db.exec("rollback");
  igual(locks.n >= 1, true, "el cupo se toma bajo advisory lock de transacción");

  await falla(db.query("select public.reservas_web_reservar_cupo('203.0.113.7')"), /HMAC/, "rechaza IP en claro (solo hash hex)");
  await falla(db.query("select public.reservas_web_reservar_cupo(null)"), /HMAC/, "rechaza hash nulo");

  // Retención: lo de hace más de 2 días se borra al llamar.
  await db.exec("insert into public.reservas_web_intentos (ip_hash, created_at) values (repeat('9', 64), now() - interval '3 days')");
  await cupo(hex("8"));
  igual((await una(db, "select count(*)::int n from public.reservas_web_intentos where ip_hash = repeat('9', 64)")).n, 0, "retención de 2 días");

  // Correo de rechazo: 1 por dirección cada 24 h.
  const correo = async (e) => (await una(db, "select public.reservas_web_reservar_correo_rechazo($1) r", [e])).r;
  igual(await correo("Victima@Example.com"), true, "primer rechazo a una dirección: se envía");
  igual(await correo("  victima@example.com "), false, "segundo rechazo en 24 h (misma dirección normalizada): no se envía");
  igual(await correo("otra@example.com"), true, "otra dirección no se ve afectada");
  igual((await una(db, "select count(*)::int n from public.reservas_web_correos_rechazo where email_hash like '%@%'")).n, 0, "no guarda la dirección en claro");
  await db.exec("update public.reservas_web_correos_rechazo set ultimo_envio = now() - interval '25 hours'");
  igual(await correo("victima@example.com"), true, "pasadas 24 h se puede volver a enviar");
  igual(await correo(""), false, "sin dirección no se envía");
  const simult = await Promise.all(Array.from({ length: 5 }, () => correo("rafaga@example.com")));
  igual(simult.filter(Boolean).length, 1, "rechazos simultáneos a la misma dirección: un solo correo");

  for (const f of ["reservas_web_reservar_cupo(text)", "reservas_web_reservar_correo_rechazo(text)"]) {
    for (const rol of ["anon", "authenticated"]) {
      igual((await una(db, "select has_function_privilege($1, $2, 'execute') p", [rol, `public.${f}`])).p, false, `${rol} no puede ejecutar ${f}`);
    }
    igual((await una(db, "select has_function_privilege('service_role', $1, 'execute') p", [`public.${f}`])).p, true, `service_role ejecuta ${f}`);
    igual((await una(db, "select prosecdef d, proconfig c from pg_proc where oid = $1::regprocedure", [`public.${f}`])), { d: true, c: ['search_path=""'] }, `${f}: SECURITY DEFINER con search_path vacío`);
  }
  for (const t of ["reservas_web_intentos", "reservas_web_correos_rechazo"]) {
    for (const rol of ["anon", "authenticated"]) {
      igual((await una(db, "select has_table_privilege($1, $2, 'select') p", [rol, `public.${t}`])).p, false, `${rol} no lee ${t}`);
    }
  }
  await db.close();
}

// =============================================================================
// FN-07b · reservas-web/disponibilidad (limitador por IP, falla en abierto)
//          20261119110000_reservas_web_limitador_disponibilidad.sql
// =============================================================================
{
  const db = new PGlite();
  await db.exec(`
    create role anon; create role authenticated; create role service_role bypassrls;
    create table public.configuracion_reservas (id uuid primary key default gen_random_uuid(), max_comensales_por_reserva int);
    insert into public.configuracion_reservas (max_comensales_por_reserva) values (12);
  `);
  const MIG = await leer("20261119110000_reservas_web_limitador_disponibilidad.sql");
  await db.exec(MIG);
  await db.exec(MIG); // idempotente

  igual((await una(db, "select limite_web_disponibilidad_ip_hora a, limite_web_disponibilidad_dia b from public.configuracion_reservas")), { a: 120, b: 5000 }, "umbrales disponibilidad por defecto 120/h y 5000/día");

  const cupo = async (ip) => (await una(db, "select public.reservas_web_reservar_cupo_disponibilidad($1) r", [ip])).r;
  const filas = async () => (await una(db, "select count(*)::int n from public.reservas_web_intentos_disponibilidad")).n;

  // Umbral por IP bajado a 3 para probar rápido (sin 120 llamadas).
  await db.exec("update public.configuracion_reservas set limite_web_disponibilidad_ip_hora = 3");
  for (let i = 0; i < 3; i++) igual((await cupo(hex("a"))).permitido, true, `consulta ${i + 1}/3 de la IP admitida`);
  igual(await cupo(hex("a")), { permitido: false, motivo: "max_ip_hora" }, "la consulta 4 de la misma IP en la hora se bloquea");
  igual(await filas(), 3, "la consulta bloqueada no deja fila");
  igual((await cupo(hex("b"))).permitido, true, "otra IP no se ve afectada");

  // La ventana se desliza.
  await db.exec("update public.reservas_web_intentos_disponibilidad set created_at = now() - interval '61 minutes' where ip_hash = repeat('a', 64)");
  igual((await cupo(hex("a"))).permitido, true, "pasada una hora la IP vuelve a tener cupo");

  // Cupo global diario (configurable), con tabla separada de la de /crear.
  await db.exec("delete from public.reservas_web_intentos_disponibilidad; update public.configuracion_reservas set limite_web_disponibilidad_dia = 5, limite_web_disponibilidad_ip_hora = 120");
  for (let i = 0; i < 5; i++) await cupo((i + 1).toString(16).repeat(64).slice(0, 64));
  igual(await cupo(hex("f")), { permitido: false, motivo: "max_dia" }, "cupo global diario de disponibilidad agotado bloquea a cualquier IP");
  igual(await filas(), 5, "sin fila al superar el cupo diario");

  // Sin fila de configuración: valores por defecto (120/h).
  await db.exec("delete from public.reservas_web_intentos_disponibilidad; delete from public.configuracion_reservas");
  igual((await cupo(hex("c"))).permitido, true, "sin configuración se admite (defecto 120/h)");
  await db.exec("insert into public.configuracion_reservas (max_comensales_por_reserva) values (12)");

  // Advisory lock (clave distinta a la de /crear: no se serializan entre sí).
  await db.exec("delete from public.reservas_web_intentos_disponibilidad");
  await db.exec("begin");
  await db.query("select public.reservas_web_reservar_cupo_disponibilidad($1)", [hex("e")]);
  const locks = await una(db, "select count(*)::int n from pg_locks where locktype = 'advisory'");
  await db.exec("rollback");
  igual(locks.n >= 1, true, "el cupo de disponibilidad se toma bajo advisory lock de transacción");

  await falla(db.query("select public.reservas_web_reservar_cupo_disponibilidad('203.0.113.7')"), /HMAC/, "rechaza IP en claro (solo hash hex)");
  await falla(db.query("select public.reservas_web_reservar_cupo_disponibilidad(null)"), /HMAC/, "rechaza hash nulo");

  // Retención 2 días.
  await db.exec("insert into public.reservas_web_intentos_disponibilidad (ip_hash, created_at) values (repeat('9', 64), now() - interval '3 days')");
  await cupo(hex("8"));
  igual((await una(db, "select count(*)::int n from public.reservas_web_intentos_disponibilidad where ip_hash = repeat('9', 64)")).n, 0, "retención de 2 días");

  // Permisos.
  const fdisp = "reservas_web_reservar_cupo_disponibilidad(text)";
  for (const rol of ["anon", "authenticated"]) {
    igual((await una(db, "select has_function_privilege($1, $2, 'execute') p", [rol, `public.${fdisp}`])).p, false, `${rol} no puede ejecutar ${fdisp}`);
  }
  igual((await una(db, "select has_function_privilege('service_role', $1, 'execute') p", [`public.${fdisp}`])).p, true, `service_role ejecuta ${fdisp}`);
  igual((await una(db, "select prosecdef d, proconfig c from pg_proc where oid = $1::regprocedure", [`public.${fdisp}`])), { d: true, c: ['search_path=""'] }, `${fdisp}: SECURITY DEFINER con search_path vacío`);
  for (const rol of ["anon", "authenticated"]) {
    igual((await una(db, "select has_table_privilege($1, 'public.reservas_web_intentos_disponibilidad', 'select') p", [rol])).p, false, `${rol} no lee reservas_web_intentos_disponibilidad`);
  }
  await db.close();
}

// =============================================================================
// FN-03 · iniciar_intento_panel con límite por email
// =============================================================================
{
  const db = new PGlite();
  await db.exec(`
    create role anon; create role authenticated; create role service_role bypassrls;
    create role supabase_auth_admin superuser;
    create schema auth;
    create table auth.users (id uuid primary key, email text);
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('test.actor', true), '')::uuid $$;
    create function auth.role() returns text language sql stable as $$ select nullif(current_setting('test.role', true), '') $$;
    create table public.user_roles (id uuid default gen_random_uuid() primary key, user_id uuid references auth.users(id) on delete cascade, role text);
    create table public.user_permissions (id uuid default gen_random_uuid() primary key, user_id uuid references auth.users(id) on delete cascade, section_key text);
    create table public.super_admins (id uuid default gen_random_uuid() primary key, user_id uuid);
    ${["admin_feature_toggles", "sell_users", "configuracion_reservas", "configuracion_web", "configBotWeb", "chat_web_config", "gdpr_config", "dashboard_config", "phone_system_config", "user_role_presets"].map((t) => `create table public."${t}" (id uuid default gen_random_uuid() primary key, user_id uuid, value text);`).join("\n")}
    insert into auth.users values ('10000000-0000-0000-0000-000000000001', 'admin@staff.local');
  `);
  for (const f of [
    "20261007120000_audit_log.sql", "20261007140000_audit_log_actor_fallback.sql",
    "20261007190000_audit_log_identidad_obligatoria.sql", "20261007200000_audit_log_limpiar_y_exigir_identidad.sql",
    "20261007210000_audit_log_cambios_permisos.sql", "20261007213000_audit_preparar_servidor.sql",
    "20261007220000_audit_log_panel_completo.sql", "20261008080000_audit_accesos_dispositivos.sql",
  ]) await db.exec(await leer(f));
  const MIG = await leer("20261030151000_panel_auth_limite_por_email.sql");
  await db.exec(MIG);
  await db.exec(MIG);

  const cabeceras = (ip, req = "r") => db.query("select set_config('request.headers', $1, false)", [JSON.stringify({
    "x-audit-source": "panel-auth", "x-audit-request-id": req, "x-audit-ip": ip })]);
  await db.exec("set test.role='service_role'");
  const intento = async (email) => (await una(db, "select public.iniciar_intento_panel($1, '/auth') d", [email])).d;

  // 10 intentos al mismo email desde 10 IPs distintas: admitidos; el 11.º no.
  for (let i = 1; i <= 10; i++) {
    await cabeceras(`198.51.100.${i}`);
    igual((await intento("Objetivo@Staff.Local")).permitido, true, `intento ${i}/10 al email admitido`);
  }
  await cabeceras("198.51.100.11");
  const bloqueado = await intento("objetivo@staff.local");
  igual([bloqueado.permitido, bloqueado.motivo], [false, "email"], "11 intentos al mismo email desde IPs distintas: bloqueado");
  const fila = await una(db, "select accion, detalles from public.audit_log where id = $1", [bloqueado.id]);
  igual([fila.accion, fila.detalles.resultado, fila.detalles.limite], ["login_fallido", "limite_intentos", "email"], "el bloqueo queda visible en la auditoría");
  igual((await intento("otro@staff.local")).permitido, true, "otro email desde la misma IP sigue pudiendo");

  // Los intentos bloqueados no alargan el bloqueo; la ventana es de 15 min.
  await db.exec("update public.audit_log set created_at = now() - interval '16 minutes' where detalles->>'email_introducido' = 'objetivo@staff.local' and detalles->>'resultado' <> 'limite_intentos'");
  igual((await intento("objetivo@staff.local")).permitido, true, "pasados 15 min desde los intentos admitidos vuelve a admitir");

  // Los logins correctos no cuentan.
  await db.exec("delete from public.audit_log where tabla = 'accesos_panel'");
  for (let i = 0; i < 12; i++) {
    await cabeceras(`192.0.2.${i}`, `ok-${i}`);
    const d = await intento("admin@staff.local");
    igual(d.permitido, true, `login correcto ${i + 1} admitido`);
    await db.query("select public.finalizar_intento_panel($1, $2, 'correcto', null)", [d.id, "10000000-0000-0000-0000-000000000001"]);
  }

  // El límite por IP (30/min) sigue igual.
  await db.exec("delete from public.audit_log where tabla = 'accesos_panel'");
  await cabeceras("203.0.113.99");
  for (let i = 0; i < 30; i++) await intento(`u${i}@staff.local`);
  const porIp = await intento("nuevo@staff.local");
  igual([porIp.permitido, porIp.motivo], [false, "ip"], "el límite de 30/min por IP se mantiene");

  // Simultáneos al mismo email desde IPs distintas: no superan el cupo.
  await db.exec("delete from public.audit_log where tabla = 'accesos_panel'");
  const res = [];
  await Promise.all(Array.from({ length: 15 }, async (_, i) => {
    // Cabecera + llamada en la misma sentencia para que no se mezclen.
    const r = await una(db, `select (select set_config('request.headers', $1, false)) h, public.iniciar_intento_panel('rafaga@staff.local', '/auth') d`,
      [JSON.stringify({ "x-audit-source": "panel-auth", "x-audit-request-id": `c${i}`, "x-audit-ip": `100.64.0.${i}` })]);
    res.push(r.d.permitido);
  }));
  igual(res.filter(Boolean).length, 10, "ráfaga simultánea al mismo email: como mucho 10 admitidos");

  // Firma y permisos sin cambios.
  igual((await una(db, "select has_function_privilege('anon', 'public.iniciar_intento_panel(text,text)', 'execute') p")).p, false, "anon no ejecuta");
  igual((await una(db, "select has_function_privilege('authenticated', 'public.iniciar_intento_panel(text,text)', 'execute') p")).p, false, "authenticated no ejecuta");
  igual((await una(db, "select has_function_privilege('service_role', 'public.iniciar_intento_panel(text,text)', 'execute') p")).p, true, "service_role ejecuta");
  await db.exec("set test.role='authenticated'");
  await falla(db.query("select public.iniciar_intento_panel('x@staff.local', '/auth')"), /Solo panel-auth/, "fuera de panel-auth sigue rechazado");

  // ---------------------------------------------------------------------------
  // FN-03 residual «cubo sin-ip» · 20261030200000_panel_auth_cubo_sin_ip.sql
  // Con x-audit-ip '' el trigger guarda ip_address = '' y la versión 151000
  // contaba con IS NULL: el cubo sin IP no tenía límite por IP.
  // ---------------------------------------------------------------------------
  await db.exec("set test.role='service_role'");
  await db.exec("delete from public.audit_log where tabla = 'accesos_panel'");
  // Defecto reproducido con la versión 151000: 31 intentos con IP '' admitidos.
  const conIp = (ip, req = "s") => JSON.stringify(ip === undefined
    ? { "x-audit-source": "panel-auth", "x-audit-request-id": req }
    : { "x-audit-source": "panel-auth", "x-audit-request-id": req, "x-audit-ip": ip });
  const intentoCon = async (cab, email) =>
    (await una(db, "select (select set_config('request.headers', $1, false)) h, public.iniciar_intento_panel($2, '/auth') d", [cab, email])).d;
  let admitidos = 0;
  for (let i = 0; i < 31; i++) if ((await intentoCon(conIp(""), `sinip${i}@staff.local`)).permitido) admitidos++;
  igual(admitidos, 31, "con 151000 el cubo sin IP no se limita (defecto reproducido)");

  const SINIP = await leer("20261030200000_panel_auth_cubo_sin_ip.sql");
  await db.exec(SINIP);
  await db.exec(SINIP); // idempotente

  // 1) x-audit-ip vacía: 30 admitidos, el 31.º denegado por IP.
  await db.exec("delete from public.audit_log where tabla = 'accesos_panel'");
  for (let i = 0; i < 30; i++) {
    igual((await intentoCon(conIp(""), `v${i}@staff.local`)).permitido, true, `sin IP ('') intento ${i + 1}/30 admitido`);
  }
  const vacia = await intentoCon(conIp(""), "v31@staff.local");
  igual([vacia.permitido, vacia.motivo, typeof vacia.id], [false, "ip", "string"], "x-audit-ip '' : el 31.º se deniega por IP con contrato {id, permitido, motivo}");
  igual((await una(db, "select ip_address from public.audit_log where id = $1", [vacia.id])).ip_address, "", "la fila sigue guardando '' (el trigger no cambia)");

  // 2) '' y cabecera ausente (NULL) comparten el mismo cubo.
  await db.exec("delete from public.audit_log where tabla = 'accesos_panel'");
  for (let i = 0; i < 15; i++) await intentoCon(conIp(""), `m${i}@staff.local`);
  for (let i = 15; i < 30; i++) await intentoCon(conIp(undefined), `m${i}@staff.local`);
  igual((await una(db, "select count(*) filter (where ip_address = '')::int v, count(*) filter (where ip_address is null)::int n from public.audit_log where tabla = 'accesos_panel'")),
    { v: 15, n: 15 }, "hay 15 filas con '' y 15 con NULL");
  const mixta = await intentoCon(conIp(undefined), "m31@staff.local");
  igual([mixta.permitido, mixta.motivo], [false, "ip"], "'' y NULL cuentan juntos en el cubo «sin-ip»");
  const mixta2 = await intentoCon(conIp(""), "m32@staff.local");
  igual([mixta2.permitido, mixta2.motivo], [false, "ip"], "el cubo «sin-ip» también deniega con ''");

  // 3) Una IP real no se ve afectada por el cubo sin IP agotado.
  igual((await intentoCon(conIp("203.0.113.7"), "real@staff.local")).permitido, true, "una IP real no comparte el cubo «sin-ip»");

  // 4) El límite por IP real y el de email siguen igual.
  await db.exec("delete from public.audit_log where tabla = 'accesos_panel'");
  for (let i = 0; i < 30; i++) await intentoCon(conIp("203.0.113.8"), `r${i}@staff.local`);
  igual((await intentoCon(conIp("203.0.113.8"), "r31@staff.local")).motivo, "ip", "IP real: 30/min se mantiene");
  await db.exec("delete from public.audit_log where tabla = 'accesos_panel'");
  for (let i = 1; i <= 10; i++) await intentoCon(conIp(`198.18.0.${i}`), "victima@staff.local");
  igual((await intentoCon(conIp("198.18.0.11"), "victima@staff.local")).motivo, "email", "el límite por email se mantiene");
  // Sin IP, el email también se limita (el cubo IP no tapa el de email).
  await db.exec("delete from public.audit_log where tabla = 'accesos_panel'");
  for (let i = 1; i <= 10; i++) await intentoCon(conIp(""), "victima@staff.local");
  igual((await intentoCon(conIp(""), "victima@staff.local")).motivo, "email", "sin IP, el 11.º al mismo email se deniega por email");

  // 5) Ráfaga «simultánea» sin IP: como mucho 30 admitidas.
  await db.exec("delete from public.audit_log where tabla = 'accesos_panel'");
  const rafagaSinIp = await Promise.all(Array.from({ length: 40 }, (_, i) => intentoCon(conIp(i % 2 ? "" : undefined, `q${i}`), `q${i}@staff.local`)));
  igual(rafagaSinIp.filter((d) => d.permitido).length, 30, "ráfaga sin IP: como mucho 30 admitidas");

  // 6) Firma, seguridad y permisos.
  igual((await una(db, "select pg_get_function_identity_arguments('public.iniciar_intento_panel(text,text)'::regprocedure) a")).a, "p_email text, p_ruta text", "misma firma");
  igual((await una(db, "select prosecdef s, proconfig c from pg_proc where oid = 'public.iniciar_intento_panel(text,text)'::regprocedure")),
    { s: true, c: ['search_path=""'] }, "SECURITY DEFINER y search_path vacío");
  for (const [rol, esperado] of [["anon", false], ["authenticated", false], ["service_role", true]]) {
    igual((await una(db, "select has_function_privilege($1, 'public.iniciar_intento_panel(text,text)', 'execute') p", [rol])).p, esperado, `${rol} execute = ${esperado}`);
  }
  igual((await una(db, "select count(*)::int n from pg_indexes where indexname = 'idx_audit_log_accesos_panel_ip_cubo'")).n, 1, "índice del cubo creado");
  await db.exec("set test.role='authenticated'");
  await falla(db.query("select public.iniciar_intento_panel('x@staff.local', '/auth')"), /Solo panel-auth/, "fuera de panel-auth sigue rechazado (cubo sin-ip)");

  // 7) El rollback se ejecuta y vuelve a la 151000 (reabre el residual).
  await db.exec(await readFile("supabase/rollbacks/20261030200000_panel_auth_cubo_sin_ip_ROLLBACK.sql", "utf8"));
  igual((await una(db, "select count(*)::int n from pg_indexes where indexname = 'idx_audit_log_accesos_panel_ip_cubo'")).n, 0, "el rollback borra el índice del cubo");
  igual((await una(db, "select position('is not distinct from nullif(v_ip' in prosrc) > 0 p from pg_proc where oid = 'public.iniciar_intento_panel(text,text)'::regprocedure")).p, true, "el rollback repone la definición de 151000");
  igual((await una(db, "select has_function_privilege('authenticated', 'public.iniciar_intento_panel(text,text)', 'execute') p")).p, false, "tras el rollback authenticated sigue sin ejecutar");
  await db.close();
}

// =============================================================================
// FN-13 · nunca 0 superadmins
// =============================================================================
{
  const db = new PGlite();
  const A = "11111111-1111-4111-8111-111111111111";
  const B = "22222222-2222-4222-8222-222222222222";
  const C = "33333333-3333-4333-8333-333333333333";
  await db.exec(`
    create role anon; create role authenticated; create role service_role;
    create schema auth;
    create table auth.users (id uuid primary key, email text, banned_until timestamptz);
    create table public.user_roles (user_id uuid primary key references auth.users(id) on delete cascade, role text);
    create table public.super_admins (id uuid primary key default gen_random_uuid(), user_id uuid references auth.users(id) on delete cascade, email text not null unique);
    create table public.user_access_status (user_id uuid primary key references auth.users(id) on delete cascade, access_blocked boolean not null);
    insert into auth.users values ('${A}', 'a@staff.local', null), ('${B}', 'b@staff.local', null), ('${C}', 'c@staff.local', null);
  `);
  await db.exec(await leer("20261013132015_gestion_superadmin_atomica.sql"));
  const MIG = await leer("20261030152000_superadmin_minimo_uno.sql");
  await db.exec(MIG);
  await db.exec(MIG);
  const fijar = (id, si, email) => db.query("select public.establecer_superadmin_panel($1, $2, $3)", [id, si, email]);
  const n = async () => (await una(db, "select count(*)::int n from public.super_admins where user_id is not null")).n;

  await fijar(A, true, "a@staff.local");
  await fijar(B, true, "b@staff.local");
  igual(await n(), 2, "dos superadmins");
  await fijar(B, false, "b@staff.local");
  igual(await n(), 1, "quitar uno de dos funciona");
  await falla(fijar(A, false, "a@staff.local"), (e) => e.code === "23514" && /al menos un superadmin/.test(e.message), "quitar el último falla con 23514");
  igual(await n(), 1, "y no cambia nada");

  // Dos degradaciones cruzadas lanzadas a la vez (A quita a B, B quita a A).
  await fijar(B, true, "b@staff.local");
  const r = await Promise.allSettled([fijar(B, false, "b@staff.local"), fijar(A, false, "a@staff.local")]);
  igual(r.filter((x) => x.status === "fulfilled").length, 1, "de dos degradaciones simultáneas solo pasa una");
  igual(await n(), 1, "queda al menos un superadmin");

  // El lock global lo toman la RPC y el trigger.
  await fijar(B, true, "b@staff.local");
  await db.exec("begin");
  await fijar(C, true, "c@staff.local");
  const lockRpc = await una(db, "select count(*)::int n from pg_locks where locktype = 'advisory'");
  await db.exec("rollback");
  igual(lockRpc.n >= 1, true, "establecer_superadmin_panel toma el advisory lock global");

  // Otros caminos que no pasan por la RPC.
  await falla(db.query("delete from public.super_admins"), /al menos un superadmin/, "DELETE directo de todos falla");
  await falla(db.query("update public.super_admins set user_id = null"), /al menos un superadmin/, "anular user_id de todos falla");
  await falla(db.query("truncate public.super_admins"), /vaciar super_admins/, "TRUNCATE falla");
  await db.query("delete from auth.users where id = $1", [B]);
  igual(await n(), 1, "borrar en Auth a un superadmin que no es el último funciona (cascada)");
  await falla(db.query("delete from auth.users where id = $1", [A]), /al menos un superadmin/, "borrar en Auth al último superadmin falla");
  igual(await n(), 1, "sigue habiendo uno");

  // Conceder sigue funcionando (y el upsert por email no dispara el error).
  await fijar(C, true, "c@staff.local");
  await fijar(C, true, "c@staff.local");
  igual(await n(), 2, "conceder e idempotencia siguen igual");
  igual((await una(db, "select role from public.user_roles where user_id = $1", [C])).role, "admin", "conceder sigue dando rol admin");
  for (const rol of ["anon", "authenticated"]) {
    igual((await una(db, "select has_function_privilege($1, 'public.establecer_superadmin_panel(uuid,boolean,text)', 'execute') p", [rol])).p, false, `${rol} no ejecuta la RPC`);
    igual((await una(db, "select has_function_privilege($1, 'public.super_admins_exigir_al_menos_uno()', 'execute') p", [rol])).p, false, `${rol} no ejecuta la función del trigger`);
  }
  await db.close();
}

// =============================================================================
// FN-11 · trigger novedades_limpiar_foto con secreto de Vault
// =============================================================================
{
  const db = new PGlite();
  await db.exec(`
    create role anon; create role authenticated; create role service_role bypassrls;
    create table public.novedades (id serial primary key, titulo text, imagen_url text);
    create schema vault;
    create table vault.decrypted_secrets (name text primary key, decrypted_secret text);
    create schema net;
    create table net.llamadas (url text, headers jsonb, body jsonb);
    create function net.http_post(url text, headers jsonb, body jsonb, timeout_milliseconds int) returns bigint
      language plpgsql as $$ begin
        if url like '%falla%' then raise exception 'pg_net caído'; end if;
        insert into net.llamadas values (url, headers, body); return 1; end $$;
  `);
  const MIG = await leer("20261030153000_novedades_limpiar_foto_con_secreto.sql");
  igual(/supabase\.co/.test(MIG.split("\n").filter((l) => !l.trim().startsWith("--")).join("\n")), false, "la migración no lleva URL de proyecto en duro");
  igual(MIG.includes("jeamoczmbfsnwkfjxcyo"), false, "ni rastro del proyecto viejo");
  await db.exec(MIG);
  await db.exec(MIG);

  const FOTO = (n) => `https://x.supabase.co/storage/v1/object/public/novedades/${n}.jpg`;
  const cola = async () => (await db.query("select ruta from public.novedades_fotos_por_borrar order by ruta")).rows.map((r) => r.ruta);
  const llamadas = async () => (await db.query("select * from net.llamadas")).rows;
  await db.exec(`insert into public.novedades (titulo, imagen_url) values
    ('a', '${FOTO("a")}'), ('b', '${FOTO("b")}'), ('c', '${FOTO("c")}'), ('d', '${FOTO("d")}'),
    ('carta', 'https://x.supabase.co/storage/v1/object/public/platos/p.jpg')`);

  // Sin secreto: la novedad se borra, la ruta queda en cola y no se llama.
  await db.exec("delete from public.novedades where titulo = 'a'");
  igual(await cola(), ["a.jpg"], "sin secreto: la ruta queda en cola");
  igual((await llamadas()).length, 0, "sin secreto: no se llama a la función");
  igual((await una(db, "select count(*)::int n from public.novedades where titulo = 'a'")).n, 0, "sin secreto: el borrado de la novedad no se rompe");

  // Solo la URL, sin secreto: tampoco llama.
  await db.exec("insert into vault.decrypted_secrets values ('project_url', 'https://ref-demo.supabase.co/')");
  await db.exec(`update public.novedades set imagen_url = null where titulo = 'b'`);
  igual((await llamadas()).length, 0, "con URL pero sin secreto: no se llama");

  // Con secreto: llama con la cabecera y la URL de Vault.
  await db.exec("insert into vault.decrypted_secrets values ('limpiar_fotos_novedades_secret', 's3creto')");
  await db.exec("delete from public.novedades where titulo = 'c'");
  const [ll] = await llamadas();
  igual(ll.url, "https://ref-demo.supabase.co/functions/v1/limpiar-fotos-novedades", "URL tomada de Vault");
  igual(ll.headers["x-webhook-secret"], "s3creto", "manda x-webhook-secret");
  igual(await cola(), ["a.jpg", "b.jpg", "c.jpg"], "todas las rutas siguen en la cola para la función");

  // Foto de la carta: no se toca.
  await db.exec("delete from public.novedades where titulo = 'carta'");
  igual((await llamadas()).length, 1, "foto del bucket platos: ni cola ni llamada");

  // pg_net falla: la operación sigue.
  await db.exec("update vault.decrypted_secrets set decrypted_secret = 'https://falla.supabase.co' where name = 'project_url'");
  await db.exec("delete from public.novedades where titulo = 'd'");
  igual((await cola()).includes("d.jpg"), true, "si pg_net falla la ruta queda en cola y el borrado sigue");

  // Sin Vault en absoluto: la operación sigue.
  await db.exec("drop schema vault cascade; insert into public.novedades (titulo, imagen_url) values ('e', '" + FOTO("e") + "')");
  await db.exec("delete from public.novedades where titulo = 'e'");
  igual((await cola()).includes("e.jpg"), true, "sin Vault la ruta queda en cola y el borrado sigue");

  igual((await una(db, "select has_function_privilege('authenticated', 'public.novedades_limpiar_foto()', 'execute') p")).p, false, "nadie ejecuta la función del trigger");
  for (const rol of ["anon", "authenticated"]) {
    igual((await una(db, "select has_table_privilege($1, 'public.novedades_fotos_por_borrar', 'select') p", [rol])).p, false, `${rol} no lee la cola`);
  }
  await db.close();
}

// Los rollbacks se pueden ejecutar (sintaxis) — se comprueba el de FN-13, que
// es el único que redefine una función ya en uso por una Edge Function.
{
  const db = new PGlite();
  await db.exec(`
    create role anon; create role authenticated; create role service_role;
    create schema auth; create table auth.users (id uuid primary key, email text);
    create table public.user_roles (user_id uuid primary key, role text);
    create table public.super_admins (id uuid primary key default gen_random_uuid(), user_id uuid, email text not null unique);
    create table public.user_access_status (user_id uuid primary key, access_blocked boolean not null);
  `);
  await db.exec(await leer("20261013132015_gestion_superadmin_atomica.sql"));
  await db.exec(await leer("20261030152000_superadmin_minimo_uno.sql"));
  await db.exec(await readFile("supabase/rollbacks/20261030152000_superadmin_minimo_uno_ROLLBACK.sql", "utf8"));
  igual((await una(db, "select count(*)::int n from pg_trigger where tgname like 'trg_super_admins_%'")).n, 0, "el rollback de FN-13 quita los triggers");
  await db.close();
}

console.log(`OK test-abuso-limites: ${comprobaciones} comprobaciones`);
