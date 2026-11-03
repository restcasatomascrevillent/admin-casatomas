// «Mi cuenta» › Cambiar contraseña: límite de intentos y registro, contra un
// Postgres en memoria (PGlite) con las migraciones REALES. Nunca toca Supabase.
//
//   npm run test:cambio-contrasena:db
//
// Cubre 20261103170000_cambio_contrasena_propia.sql:
//   · solo service_role con x-audit-source cambiar-mi-contrasena; anon y
//     authenticated no ejecutan; SECURITY DEFINER con search_path vacío;
//   · 5 cambios con la contraseña actual incorrecta -> el 6.º se bloquea; los
//     bloqueados no alargan el bloqueo; pasados 15 min vuelve a admitir;
//   · los logins fallidos de la cuenta cuentan (si el login está bloqueado,
//     el cambio también) y los cambios correctos no;
//   · los fallos posteriores a comprobar bien la contraseña no cuentan;
//   · finalizar: misma petición, mismo usuario, una sola vez;
//   · la fila de auditoría va a nombre del usuario y sin la contraseña;
//   · advisory lock por email compartido con iniciar_intento_panel;
//   · el rollback se ejecuta.
import { PGlite } from "@electric-sql/pglite";
import { readFile } from "node:fs/promises";
import assert from "node:assert/strict";

const M = "supabase/migrations";
const leer = (f) => readFile(`${M}/${f}`, "utf8");
let comprobaciones = 0;
const igual = (v, e, n) => { assert.deepEqual(v, e, n); comprobaciones++; };
const falla = async (p, patron, n) => { await assert.rejects(p, patron, n); comprobaciones++; };
const una = async (db, q, p) => (await db.query(q, p)).rows[0];

const DUENO = "10000000-0000-0000-0000-000000000001";
const OTRO = "10000000-0000-0000-0000-000000000002";

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
  insert into auth.users values ('${DUENO}', 'Dueno@CasaTomas.test'), ('${OTRO}', 'otro@staff.local');
`);
for (const f of [
  "20261007120000_audit_log.sql", "20261007140000_audit_log_actor_fallback.sql",
  "20261007190000_audit_log_identidad_obligatoria.sql", "20261007200000_audit_log_limpiar_y_exigir_identidad.sql",
  "20261007210000_audit_log_cambios_permisos.sql", "20261007213000_audit_preparar_servidor.sql",
  "20261007220000_audit_log_panel_completo.sql", "20261008080000_audit_accesos_dispositivos.sql",
  "20261030151000_panel_auth_limite_por_email.sql", "20261030200000_panel_auth_cubo_sin_ip.sql",
]) await db.exec(await leer(f));
const MIG = await leer("20261103170000_cambio_contrasena_propia.sql");
await db.exec(MIG);
await db.exec(MIG); // idempotente

const CAMBIO = (req = "r1") => JSON.stringify({ "x-audit-source": "cambiar-mi-contrasena", "x-audit-request-id": req, "x-audit-ip": "203.0.113.5" });
const LOGIN = (req = "l1") => JSON.stringify({ "x-audit-source": "panel-auth", "x-audit-request-id": req, "x-audit-ip": "198.51.100.7" });
await db.exec("set test.role='service_role'");

// Cabecera + llamada en la misma sentencia para que no se mezclen.
const iniciar = async (actor, req = "r1") =>
  (await una(db, "select (select set_config('request.headers', $1, false)) h, public.iniciar_cambio_contrasena($2) d", [CAMBIO(req), actor])).d;
const finalizar = (id, actor, resultado, req = "r1") =>
  db.query("select (select set_config('request.headers', $1, false)) h, public.finalizar_cambio_contrasena($2, $3, $4)", [CAMBIO(req), id, actor, resultado]);
const intento = async (actor, resultado, req) => {
  const d = await iniciar(actor, req);
  if (d.permitido) await finalizar(d.id, actor, resultado, req);
  return d;
};
const loginFallido = async (email, i) => {
  const d = (await una(db, "select (select set_config('request.headers', $1, false)) h, public.iniciar_intento_panel($2, '/auth') d", [LOGIN(`l${i}`), email])).d;
  await db.query("select (select set_config('request.headers', $1, false)) h, public.finalizar_intento_panel($2, null, 'credenciales_invalidas', null)", [LOGIN(`l${i}`), d.id]);
};
const limpiar = () => db.exec("delete from public.audit_log");

// ---------------------------------------------------------------------------
// Permisos y firma
// ---------------------------------------------------------------------------
for (const f of ["iniciar_cambio_contrasena(uuid)", "finalizar_cambio_contrasena(uuid,uuid,text)"]) {
  for (const rol of ["anon", "authenticated"]) {
    igual((await una(db, "select has_function_privilege($1, $2, 'execute') p", [rol, `public.${f}`])).p, false, `${rol} no ejecuta ${f}`);
  }
  igual((await una(db, "select has_function_privilege('service_role', $1, 'execute') p", [`public.${f}`])).p, true, `service_role ejecuta ${f}`);
  igual((await una(db, "select prosecdef d, proconfig c from pg_proc where oid = $1::regprocedure", [`public.${f}`])), { d: true, c: ['search_path=""'] }, `${f}: SECURITY DEFINER con search_path vacío`);
}
await falla(una(db, "select (select set_config('request.headers', $1, false)) h, public.iniciar_cambio_contrasena($2) d", [LOGIN(), DUENO]), /Solo cambiar-mi-contrasena/, "otra fuente (panel-auth) no puede empezar un cambio");
await db.exec("set test.role='authenticated'");
await falla(iniciar(DUENO), /Solo cambiar-mi-contrasena/, "un usuario autenticado no puede llamarla aunque mande la cabecera");
await db.exec("set test.role='service_role'");
await falla(iniciar("10000000-0000-0000-0000-0000000000ff"), /La cuenta no existe/, "usuario inexistente");

// ---------------------------------------------------------------------------
// Registro: a nombre del usuario y sin la contraseña
// ---------------------------------------------------------------------------
{
  const d = await iniciar(DUENO, "reg");
  igual(d.permitido, true, "primer intento admitido");
  const fila = await una(db, "select accion, tabla, registro_id, actor_user_id, actor_email, actor_origin, request_id, ip_address, detalles from public.audit_log where id = $1", [d.id]);
  igual([fila.accion, fila.tabla, fila.registro_id, fila.actor_user_id, fila.actor_origin], ["ejecutar", "acciones_servidor", "cambiar-mi-contrasena", DUENO, "usuario"], "la fila va a nombre del usuario");
  igual(fila.actor_email, "Dueno@CasaTomas.test", "con su email de Auth");
  igual([fila.request_id, fila.ip_address], ["reg", "203.0.113.5"], "con la petición y la IP de la función");
  igual([fila.detalles.resultado, fila.detalles.operacion, fila.detalles.tipo_evento], ["pendiente", "cambiar-mi-contrasena", "cambio_contrasena"], "empieza pendiente");
  await falla(finalizar(d.id, DUENO, "correcto", "otra-peticion"), /no existe o ya terminó/, "otra petición no puede terminarlo");
  await falla(finalizar(d.id, OTRO, "correcto", "reg"), /no existe o ya terminó/, "otro usuario no puede terminarlo");
  await finalizar(d.id, DUENO, "correcto", "reg");
  const fin = (await una(db, "select detalles from public.audit_log where id = $1", [d.id])).detalles;
  igual([fin.resultado, fin.motivo, typeof fin.finalizado_en], ["completada", undefined, "string"], "cambio correcto: completada");
  await falla(finalizar(d.id, DUENO, "correcto", "reg"), /no existe o ya terminó/, "no se termina dos veces");

  const d2 = await iniciar(DUENO, "raro");
  await finalizar(d2.id, DUENO, "inventado", "raro");
  igual((await una(db, "select detalles->>'motivo' m from public.audit_log where id = $1", [d2.id])).m, "error_servicio", "un resultado desconocido se guarda como error_servicio");
  const claves = (await una(db, "select string_agg(distinct k, ',') c from public.audit_log, jsonb_object_keys(detalles) k where registro_id = 'cambiar-mi-contrasena'")).c;
  igual(/password|contrase/i.test(claves), false, "ninguna clave del registro guarda contraseñas");
}

// ---------------------------------------------------------------------------
// Límite de cambios fallidos (5 / 15 min)
// ---------------------------------------------------------------------------
await limpiar();
for (let i = 1; i <= 5; i++) igual((await intento(DUENO, "contrasena_actual_incorrecta", `m${i}`)).permitido, true, `cambio fallido ${i}/5 admitido`);
{
  const b = await iniciar(DUENO, "m6");
  igual([b.permitido, b.motivo], [false, "cambio"], "el 6.º cambio con contraseña incorrecta se bloquea");
  const fila = (await una(db, "select detalles from public.audit_log where id = $1", [b.id])).detalles;
  igual([fila.resultado, fila.motivo, fila.limite], ["fallida", "limite_intentos", "cambio"], "el bloqueo queda visible en la auditoría");
  for (let i = 0; i < 5; i++) await iniciar(DUENO, `b${i}`);
  await db.exec("update public.audit_log set created_at = now() - interval '16 minutes' where detalles->>'motivo' = 'contrasena_actual_incorrecta'");
  igual((await iniciar(DUENO, "m7")).permitido, true, "pasados 15 min desde los fallos vuelve a admitir (los bloqueados no alargan el bloqueo)");
}
igual((await iniciar(OTRO, "otro")).permitido, true, "otra cuenta no se ve afectada");

// Pendientes sin terminar cuentan (fail-closed); los correctos y los fallos
// posteriores a comprobar la contraseña, no.
await limpiar();
for (let i = 0; i < 5; i++) await iniciar(DUENO, `p${i}`);
igual((await iniciar(DUENO, "p5")).motivo, "cambio", "5 intentos sin terminar cuentan como fallos");
await limpiar();
for (let i = 0; i < 12; i++) igual((await intento(DUENO, i % 3 === 0 ? "correcto" : i % 3 === 1 ? "contrasena_rechazada" : "error_servicio", `ok${i}`)).permitido, true, `cambio ${i + 1} (contraseña actual correcta) admitido`);

// ---------------------------------------------------------------------------
// Compartido con el login: si el login de la cuenta está bloqueado, el cambio también
// ---------------------------------------------------------------------------
await limpiar();
for (let i = 0; i < 10; i++) await loginFallido("dueno@casatomas.test", i);
{
  const b = await iniciar(DUENO, "tras-login");
  igual([b.permitido, b.motivo], [false, "cuenta"], "10 logins fallidos de la cuenta bloquean también el cambio");
}
await limpiar();
for (let i = 0; i < 7; i++) await loginFallido("dueno@casatomas.test", i);
for (let i = 0; i < 3; i++) await intento(DUENO, "contrasena_actual_incorrecta", `mx${i}`);
igual((await iniciar(DUENO, "mx3")).motivo, "cuenta", "7 logins + 3 cambios fallidos = 10: bloqueado por cuenta");
igual((await iniciar(OTRO, "otro2")).permitido, true, "los logins de otra cuenta no cuentan");

// ---------------------------------------------------------------------------
// Advisory lock (mismo que el login por email)
// ---------------------------------------------------------------------------
await db.exec("begin");
await db.query("select (select set_config('request.headers', $1, true)) h, public.iniciar_cambio_contrasena($2)", [CAMBIO("lk"), OTRO]);
const locks = await una(db, "select count(*)::int n from pg_locks where locktype = 'advisory'");
await db.exec("rollback");
igual(locks.n >= 1, true, "el cupo se toma bajo advisory lock de transacción");

// ---------------------------------------------------------------------------
// Rollback
// ---------------------------------------------------------------------------
await db.exec(await readFile("supabase/rollbacks/20261103170000_cambio_contrasena_propia_ROLLBACK.sql", "utf8"));
igual((await una(db, "select count(*)::int n from pg_proc where proname in ('iniciar_cambio_contrasena', 'finalizar_cambio_contrasena')")).n, 0, "el rollback quita las funciones");
igual((await una(db, "select count(*)::int n from pg_proc where proname = 'iniciar_intento_panel'")).n, 1, "el rollback no toca el login");
await db.close();

console.log(`OK test-cambio-contrasena: ${comprobaciones} comprobaciones`);
