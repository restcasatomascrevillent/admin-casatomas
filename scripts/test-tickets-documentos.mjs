// Tickets automáticos de documentos (20261212420000 + 20261212520000) contra PGlite: F1 (el ticket es del Sistema, no cuenta para el
// tope de quien edita y un fallo queda en fallos_internos), F6 (solo documentos nuevos o recientes con cambio real) y rollback.
// Además variante_valida_agente (F2): los pares de la revisión.
//
//   npm run test:tickets-documentos:db
import { PGlite } from "@electric-sql/pglite";
import { readFile } from "node:fs/promises";
import assert from "node:assert/strict";

const fuente = await readFile("scripts/test-peticiones.mjs", "utf8");
const ini = fuente.indexOf("const BASE = ");
const fin = fuente.indexOf("// ─── 0.");
const { BASE, SUPER, AVISOS, STORAGE, IA, PRIVILEGIOS_SUPABASE, U, DATOS } = new Function(
  fuente.slice(ini, fin) + "; return { BASE, SUPER, AVISOS, STORAGE, IA, PRIVILEGIOS_SUPABASE, U, DATOS };",
)();
const PETICIONES = await readFile("supabase/migrations/20261129100000_peticiones.sql", "utf8");
const M420 = await readFile("supabase/migrations/20261212420000_tickets_documentos_automaticos.sql", "utf8");
const M520 = await readFile("supabase/migrations/20261212520000_tickets_documentos_sistema_y_recientes.sql", "utf8");
const R520 = await readFile("supabase/rollbacks/20261212520000_tickets_documentos_sistema_y_recientes_ROLLBACK.sql", "utf8");
const M410 = await readFile("supabase/migrations/20261212410000_chat_facturas_decisiones_dueno.sql", "utf8");
const M530 = await readFile("supabase/migrations/20261212530000_chat_facturas_variantes_estrictas.sql", "utf8");

let comprobaciones = 0;
const ok = (v, msg) => { assert.ok(v, msg); comprobaciones++; };
const igual = (a, b, msg) => { assert.deepEqual(a, b, msg); comprobaciones++; };

const db = new PGlite();
await db.exec(BASE + SUPER + AVISOS + STORAGE + IA + DATOS + PRIVILEGIOS_SUPABASE);
await db.exec(PETICIONES);
await db.exec(`
  create table public.facturas (id bigint generated always as identity primary key, tipo text default 'factura', numero_documento text default 'F-1',
    proveedor text, proveedor_id bigint, fecha date default current_date, total numeric, alertas_validacion jsonb default '[]'::jsonb,
    verificada boolean default false, import_clave text, drive_url text, resumen text, created_at timestamptz default now());
  create table public.ocr_trabajos (id bigint generated always as identity primary key, estado text default 'pendiente', nombre_original text default 'a.pdf',
    origen text default 'panel', num_paginas int default 1, error text, original_path text);
  create table public.fallos_internos (id bigint generated always as identity primary key, tipo text, datos jsonb, usuario_id uuid, clave text, unique (tipo, clave));
  create function public.fallo_interno_registrar(p_tipo text, p_datos jsonb default '{}', p_usuario_id uuid default null, p_clave text default null)
    returns bigint language sql as $f$ insert into public.fallos_internos (tipo, datos, usuario_id, clave) values (p_tipo, p_datos, p_usuario_id, p_clave)
    on conflict do nothing returning id $f$;
`);
await db.exec(M420);
await db.exec(M520);
await db.exec(M520); // idempotente
comprobaciones++;

const sesion = (u) => db.exec(`select set_config('request.jwt.claims', '${JSON.stringify({ sub: u, role: "authenticated" })}', false)`);
const n = async (sql) => Number((await db.query(sql)).rows[0].n);

// F1: un usuario edita un documento sin proveedor: el ticket es del Sistema y no cuenta para su tope
await sesion(U.ANA);
await db.exec("insert into public.facturas (numero_documento, proveedor_id) values ('SN-1', null)");
const t = (await db.query("select creado_por, creado_por_nombre, creado_por_email, origen from public.peticiones where clave_origen = 'doc:1'")).rows[0];
ok(t, "no se creó el ticket de un documento nuevo sin proveedor");
igual([t.creado_por, t.creado_por_nombre, t.origen], [null, "Sistema (revisión automática de documentos)", "documento"], "el ticket es de quien edita");
for (let i = 0; i < 20; i++) await db.exec(`insert into public.peticiones (titulo, modulo, descripcion) values ('Petición ${i} de Ana', 'facturas', 'una descripción suficiente')`);
igual(await n(`select count(*) n from public.peticiones where creado_por = '${U.ANA}'`), 20, "no hay 20 peticiones propias");
await db.exec("insert into public.facturas (numero_documento, proveedor_id) values ('SN-2', null)");
igual(await n("select count(*) n from public.peticiones where clave_origen = 'doc:2'"), 1, "con el tope de 20 lleno el ticket automático se perdió");
igual(await n(`select count(*) n from public.peticiones where creado_por = '${U.ANA}'`), 20, "el ticket automático cuenta para el tope de Ana");
await assert.rejects(db.exec("insert into public.peticiones (titulo, modulo, descripcion) values ('La 21', 'facturas', 'una descripción suficiente')"), /20 peticiones/);
comprobaciones++;

// F6: antiguo no crea; reciente sin cambio real no crea; reciente con cambio real sí
await db.exec("insert into public.facturas (numero_documento, proveedor_id, proveedor, created_at) values ('OK-3', 1, 'X', now() - interval '30 days')");
await db.exec("update public.facturas set proveedor_id = null where numero_documento = 'OK-3'");
igual(await n("select count(*) n from public.peticiones where clave_origen = 'doc:3'"), 0, "documento antiguo creó ticket al tocarlo");
await db.exec("insert into public.facturas (numero_documento, proveedor_id, proveedor) values ('OK-4', 1, 'X')");
await db.exec("update public.facturas set total = total where numero_documento = 'OK-4'");
igual(await n("select count(*) n from public.peticiones where clave_origen = 'doc:4'"), 0, "update sin cambio real creó ticket");
await db.exec("update public.facturas set proveedor_id = null where numero_documento = 'OK-4'");
igual(await n("select count(*) n from public.peticiones where clave_origen = 'doc:4'"), 1, "cambio real en documento reciente no creó ticket");
await db.exec("insert into public.facturas (numero_documento, proveedor_id, proveedor, created_at) select 'V-' || g, 1, 'X', now() - interval '60 days' from generate_series(1, 10) g");
const antes = await n("select count(*) n from public.peticiones");
await db.exec("update public.facturas set proveedor_id = null where created_at < now() - interval '40 days'");
igual(await n("select count(*) n from public.peticiones"), antes, "el update masivo sobre antiguos creó tickets");

// F1: si falla el ticket queda en fallos_internos y el documento se guarda
await db.exec("alter table public.peticiones add constraint rompe check (titulo not like '%ROMPE%')");
await db.exec("insert into public.facturas (numero_documento, proveedor, proveedor_id) values ('ROMPE-9', 'ROMPE', null)");
igual(await n("select count(*) n from public.facturas where numero_documento = 'ROMPE-9'"), 1, "el fallo del ticket impidió guardar el documento");
igual(await n("select count(*) n from public.fallos_internos where tipo = 'ticket_documento_fallido'"), 1, "el fallo del ticket no quedó registrado");
await db.exec("alter table public.peticiones drop constraint rompe");

// Rollback aplicable
await db.exec(R520);
comprobaciones++;

// F2: variante_valida_agente (función real; raiz_variante_agente de 20261212410000)
const trozo = (s, desde, hasta) => s.slice(s.indexOf(desde), s.indexOf(hasta));
const d = new PGlite();
await d.exec(trozo(M410, "create or replace function public.raiz_variante_agente", "do $mig$").replace(/revoke[^;]*;|grant[^;]*;/g, ""));
await d.exec(trozo(M530, "create or replace function public.variante_valida_agente", "do $mig$").replace(/revoke[^;]*;|grant[^;]*;/g, ""));
const v = async (a, b, fam = 5, fams = [5]) =>
  (await d.query("select public.variante_valida_agente($1, $2, $3::bigint, $4::bigint[]) r", [a, b, fam, fams])).rows[0].r;
for (const [a, b] of [["chuletón", "chuleta"], ["chuletón", "chuletero"], ["chuleta", "chuletón"], ["tomate", "tomatito"], ["tomate", "tomates"]])
  ok(await v(a, b), `${a} → ${b} debería sumar`);
for (const [a, b] of [["manzana", "manzanilla"], ["salchicha", "salchichón"], ["pepino", "pepinillo"], ["papel", "papelera"], ["granada", "granadilla"],
  ["azúcar", "azucarera"], ["ensalada", "ensaladera"], ["toalla", "toallita"], ["cuchara", "cucharilla"], ["batidor", "batidora"], ["pimiento", "pimienta"]])
  ok(!(await v(a, b)), `${a} → ${b} no debe sumar`);
ok(!(await v("tomate", "tomatito", 7, [5])), "tomatito de otra familia no debe sumar");
ok(!(await v("tomate", "tomatito", null, [5])), "tomatito sin familia no debe sumar");

console.log(`OK · ${comprobaciones} comprobaciones`);
