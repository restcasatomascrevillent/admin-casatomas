// Prueba PGlite de public.informe_auditoria_mensual (migración 20261212100000_informe_auditoria_por_persona):
// el informe de auditoría persona a persona. Comprueba que solo lo genera un super admin, que cada persona
// trae sus días, horas, lo que tocó, los botones del servidor y sus últimas acciones (en hora de Madrid),
// que lo automático va aparte y que lo que devolvía antes sigue ahí.
//
//   node scripts/verificar-informe-auditoria.mjs
import { PGlite } from "@electric-sql/pglite";
import fs from "node:fs";
import assert from "node:assert/strict";

process.on("unhandledRejection", (e) => {
  console.error("informe de auditoría:", e.message, e.code ?? "", e.where ?? "");
  process.exit(1);
});

const leer = (f) => fs.readFileSync(`supabase/migrations/${f}`, "utf8");
const entre = (texto, desde, hasta) => {
  const i = texto.indexOf(desde);
  const j = texto.indexOf(hasta, i);
  assert.ok(i >= 0 && j > i, `no encuentro «${desde}»`);
  return texto.slice(i, j);
};

const db = new PGlite();
const admin = "00000000-0000-4000-8000-000000000001";
const normal = "00000000-0000-4000-8000-000000000002";
await db.exec(`
CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;
CREATE SCHEMA auth;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
CREATE TABLE public.super_admins(user_id uuid PRIMARY KEY);
INSERT INTO public.super_admins VALUES ('${admin}');
CREATE TABLE public.audit_log(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), created_at timestamptz DEFAULT now(), actor_user_id uuid,
  actor_email text, actor_label text, actor_origin text, accion text, tabla text, registro_id text, detalles jsonb, user_agent text,
  device_id text, ip_address text, request_id text, session_id text);
CREATE TABLE public."Vinos"(id bigint PRIMARY KEY, nombre text, precio_eur numeric);
`);
// La regla de qué tablas se ven y la vista, tal y como están en las migraciones.
await db.exec(entre(leer("20261012153701_auditoria_legible_chat_reversion.sql"), "CREATE OR REPLACE FUNCTION public.audit_tabla_util", "\nCREATE") );
await db.exec(entre(leer("20261013082609_bloquear_acceso_usuarios.sql"), "CREATE OR REPLACE VIEW public.audit_log_visible", "REVOKE ALL ON public.audit_log_visible"));
await db.exec(leer("20261205100100_informe_auditoria_rapido.sql"));
await db.exec(leer("20261212100000_informe_auditoria_por_persona.sql"));

// Noviembre de 2026 (UTC+1). Ana: lunes 2 a las 9:30 y 10:10, martes 3 a las 23:30 (hora de Madrid), entra el 4 sin hacer nada.
const filas = [
  ["2026-11-02T08:30:00Z", "ana@casa.es", "usuario", "acceso", "accesos_panel", null, null],
  ["2026-11-02T08:31:00Z", "ana@casa.es", "usuario", "actualizar", "Vinos", null, { antes: { nombre: "Ribera", precio_eur: 20 }, despues: { nombre: "Ribera", precio_eur: 22 }, campos_modificados: ["precio_eur"] }],
  ["2026-11-02T09:10:00Z", "ana@casa.es", "usuario", "crear", "reservas", null, { despues: { nombre: "Mesa López" } }],
  ["2026-11-03T22:30:00Z", "ana@casa.es", "usuario", "eliminar", "reservas", null, { antes: { nombre: "N".repeat(500) } }],
  ["2026-11-03T22:40:00Z", "ana@casa.es", "usuario", "ejecutar", "acciones_servidor", "rebuild-webs", { resultado: "completada" }],
  ["2026-11-03T22:41:00Z", "ana@casa.es", "usuario", "ejecutar", "acciones_servidor", "rebuild-webs", { resultado: "fallida" }],
  ["2026-11-04T10:00:00Z", "ana@casa.es", "usuario", "login", "accesos_panel", null, null],
  ["2026-11-05T11:00:00Z", "luis@casa.es", "usuario", "actualizar", "reservas", null, { despues: { nombre: "Pérez" } }],
  // Tablas de ruido (no se ven) y lo automático.
  ["2026-11-05T11:05:00Z", "luis@casa.es", "usuario", "actualizar", "ocr_trabajos", null, null],
  ["2026-11-06T03:00:00Z", "API · service_role · ocr-trabajo", "servicio", "crear", "facturas", null, null],
  ["2026-11-06T03:00:01Z", "Base de datos · postgres", "base_de_datos", "actualizar", "Vinos", null, null],
  // Otro mes: no cuenta.
  ["2026-10-31T22:59:00Z", "ana@casa.es", "usuario", "crear", "reservas", null, null],
];
for (const [created_at, label, origen, accion, tabla, registro, det] of filas) {
  await db.query("INSERT INTO public.audit_log(created_at, actor_label, actor_origin, accion, tabla, registro_id, detalles) VALUES ($1,$2,$3,$4,$5,$6,$7)", [
    created_at, label, origen, accion, tabla, registro, det,
  ]);
}

const informe = async (usuario, mes = "2026-11") => {
  await db.exec(`SELECT set_config('request.jwt.claim.sub', '${usuario}', false)`);
  return (await db.query("SELECT public.informe_auditoria_mensual($1) AS r", [mes])).rows[0].r;
};

await assert.rejects(informe(normal), /Solo el super admin/, "solo super admin");
await assert.rejects(informe(admin, "2026-13"), /Mes inválido/);

const r = await informe(admin);
let comprobaciones = 0;
const igual = (a, b, msg) => {
  assert.deepEqual(a, b, msg);
  comprobaciones++;
};

// Lo de antes sigue igual.
igual(Object.keys(r).sort(), ["accesos_fallidos", "delicadas", "delicadas_total", "por_dia", "por_hora", "sistema", "sistema_total", "usuarios"], "mismas claves arriba");
igual(r.usuarios.map((u) => [u.quien, u.acciones, u.dias, u.borrados, u.precios]), [["ana@casa.es", 5, 3, 1, 1], ["luis@casa.es", 1, 1, 0, 0]], "ranking");
igual(r.sistema_total, 2, "lo automático aparte");

const ana = r.usuarios[0];
igual(ana.primera, "2026-11-02T08:30:00+00:00", "primera vez (también cuenta entrar)");
igual(ana.entradas, 2, "veces que abrió el panel: acceso + login");
igual(ana.por_dia, [{ dia: "2026-11-02", n: 2 }, { dia: "2026-11-03", n: 3 }, { dia: "2026-11-04", n: 0 }], "días: el 4 entró sin hacer nada");
igual(ana.por_hora, [{ hora: 9, n: 1 }, { hora: 10, n: 1 }, { hora: 23, n: 3 }], "horas en hora de Madrid");
igual(ana.tablas, [
  { tabla: "reservas", crear: 1, actualizar: 0, eliminar: 1, n: 2 },
  { tabla: "Vinos", crear: 0, actualizar: 1, eliminar: 0, n: 1 },
], "todo lo que tocó, sin los botones del servidor ni los accesos");
igual(ana.servidor, [{ op: "rebuild-webs", n: 2, fallidas: 1 }], "botones del servidor con fallidas");
igual(ana.recientes.length, 5, "sus últimas acciones (sin los accesos)");
igual(ana.recientes[0], { created_at: "2026-11-03T22:41:00+00:00", accion: "ejecutar", tabla: "acciones_servidor", op: "rebuild-webs", resultado: "fallida" }, "la última, la más reciente");
igual(ana.recientes[2].nombre.length, 120, "nombres recortados a 120 letras");
igual(ana.recientes.at(-1), { created_at: "2026-11-02T08:31:00+00:00", accion: "actualizar", tabla: "Vinos", nombre: "Ribera", campos: ["precio_eur"] }, "campos cambiados");
igual(r.usuarios[1].tablas, [{ tabla: "reservas", crear: 0, actualizar: 1, eliminar: 0, n: 1 }], "ocr_trabajos no se ve");
igual(r.delicadas.map((d) => d.tipo_evento).sort(), ["cambiar_precio", "eliminar"], "delicadas");
igual(r.delicadas.find((d) => d.tipo_evento === "eliminar").det.antes.nombre.length, 120, "delicadas recortadas a 120 letras");

const vacio = await informe(admin, "2026-12");
igual([vacio.usuarios.length, vacio.sistema_total, vacio.delicadas_total], [0, 0, 0], "mes sin nada");

// La vuelta atrás deja la versión anterior (sin el detalle por persona) y funcionando.
await db.exec(fs.readFileSync("supabase/rollbacks/20261212100000_informe_auditoria_por_persona_ROLLBACK.sql", "utf8"));
const antes = await informe(admin);
igual([antes.usuarios[0].quien, antes.usuarios[0].acciones, antes.usuarios[0].tablas], ["ana@casa.es", 5, undefined], "vuelta atrás");

console.log(`Informe de auditoría por persona: ${comprobaciones} comprobaciones correctas.`);
