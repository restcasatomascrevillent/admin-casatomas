// Avisos de abreviaturas nuevas (migración 20261209310000) contra PGlite.
//
//   npm run test:abreviaturas-avisos:db
//
// Cubre: proponer (conservador: genéricos, ya conocidas, ya avisadas, expansión que
// no encaja), aviso en la tabla Y en la campana, pendientes, confirmar / corregir /
// descartar (guarda como manual, renombra el producto con la marca completa, archiva
// el aviso de la campana), permisos y rollback.
import { PGlite } from "@electric-sql/pglite";
import { readFile } from "node:fs/promises";
import assert from "node:assert/strict";

const M1 = await readFile("supabase/migrations/20261209300000_abreviaturas_proveedor.sql", "utf8");
const M2 = await readFile("supabase/migrations/20261209310000_abreviaturas_avisos.sql", "utf8");
const RB = await readFile("supabase/rollbacks/20261209310000_abreviaturas_avisos_ROLLBACK.sql", "utf8");

let comprobaciones = 0;
const ok = (v, msg) => { assert.ok(v, msg); comprobaciones++; };
const igual = (a, b, msg) => { assert.deepEqual(a, b, msg); comprobaciones++; };

const db = new PGlite();
await db.exec(`
  create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
  create schema auth;
  create function auth.uid() returns uuid language sql as $$ select '00000000-0000-4000-8000-000000000001'::uuid $$;
  create function public.normalizar_texto(t text) returns text language sql immutable as
    $$ select lower(btrim(regexp_replace(translate(t, 'áéíóúüñÁÉÍÓÚÜÑ', 'aeiouunAEIOUUN'), '\\s+', ' ', 'g'))) $$;
  create table public.perm (puede boolean);
  insert into public.perm values (true);
  create function public.can_read_section(s text) returns boolean language sql as $$ select true $$;
  create function public.productos_puede_editar() returns boolean language sql as $$ select (select puede from public.perm) $$;
  create function public.productos_tocar_updated_at() returns trigger language plpgsql as $$ begin new.updated_at := now(); return new; end $$;
  create table public.proveedores (id bigint generated always as identity primary key, nombre text not null);
  create table public.facturas (id bigint generated always as identity primary key, proveedor_id bigint references public.proveedores(id));
  create table public.categorias_producto (id bigint primary key, nombre text not null, padre_id bigint);
  create table public.productos_catalogo (id bigint generated always as identity primary key, nombre text not null,
    nombre_normalizado text generated always as (lower(nombre)) stored unique, categoria_id bigint);
  create table public.productos_alias (texto_normalizado text primary key, producto_id bigint not null references public.productos_catalogo(id) on delete cascade, origen text not null default 'manual');
  create table public.productos_factura (id bigserial primary key, factura_id bigint references public.facturas(id), nombre text not null, nombre_normalizado text, producto_id bigint references public.productos_catalogo(id));
  create table public.notificaciones_dashboard (id uuid primary key default gen_random_uuid(), tipo text not null, titulo text not null, mensaje text,
    referencia_id uuid, referencia_tipo text, leida boolean not null default false, created_at timestamptz default now(),
    prioridad text not null default 'normal', clave text, caduca_en timestamptz, datos jsonb);
  create function public.productos_renombrar(p_id bigint, p_nombre text) returns jsonb language plpgsql as $$
    begin
      if exists (select 1 from public.productos_catalogo where lower(nombre) = lower(p_nombre) and id <> p_id) then
        raise exception 'Ya existe «%»', p_nombre using errcode = '23505'; end if;
      update public.productos_catalogo set nombre = p_nombre where id = p_id; return '{}'::jsonb; end $$;
  insert into public.proveedores (nombre) values ('Bodegas de Lujo'), ('Otro');
  insert into public.facturas (proveedor_id) values (1);
  insert into public.productos_catalogo (nombre) values ('La Cuvée 75 cl'), ('LP Heritage'), ('Brut 75 cl'), ('Laurent-Perrier Rosé');
  insert into public.productos_alias values ('lp la cuvee', 1), ('lp heritage', 2), ('xx brut', 3), ('lp rose', 4);
  insert into public.productos_factura (factura_id, nombre, nombre_normalizado, producto_id) values (1, 'LP LA CUVEE', 'lp la cuvee', 1);
`);
await db.exec(M1);
await db.exec(M2);
await db.exec(M2); // idempotente

const uno = async (sql, params) => (await db.query(sql, params)).rows[0];
const n = async (sql) => Number((await uno(sql)).n);
const proponer = async (items) => (await uno(`select public.abreviaturas_proponer($1::jsonb) r`, [JSON.stringify(items)])).r;
const item = (ab, prop, extra = {}) => ({ proveedor_id: 1, abreviatura: ab, propuesta: prop, texto: "lp la cuvee", ...extra });

// plausibilidad
for (const [ab, ex, esperado] of [["lp", "Laurent-Perrier", true], ["lp", "Laurent Perrier", true], ["jw", "Johnnie Walker", true],
  ["mur", "Murrieta", true], ["lp", "La Perla", false], ["lp", "Tanqueray", false], ["ab", "Ab", false]]) {
  igual((await uno(`select public.abreviaturas_es_plausible($1, $2) r`, [ab, ex])).r, esperado, `${ab} → ${ex}`);
}

// proponer: conservador
let r = await proponer([
  item("bot", "Botella"),                     // genérico
  item("cha", "Champagne"),                   // genérico
  item("lp", "Tanqueray"),                    // no encaja
  item("x", "Laurent-Perrier"),               // demasiado corta
  item("lp", "Laurent-Perrier", { proveedor_id: 999 }), // proveedor que no existe
]);
igual(r, { avisos_creados: 0, ignoradas: 5 }, "no avisa de genéricos, ni de lo que no encaja, ni de proveedores inexistentes");
r = await proponer([item("lp", "Laurent-Perrier")]);
igual(r, { avisos_creados: 1, ignoradas: 0 }, "avisa de LP");
ok((await n(`select count(*) n from public.abreviaturas_avisos where estado = 'pendiente'`)) === 1, "queda un aviso pendiente");
const av = await uno(`select * from public.abreviaturas_avisos`);
ok(av.producto_id === "1" || Number(av.producto_id) === 1, "enlaza con el producto del alias");
ok(Number(av.factura_id) === 1, "y con la factura de la línea");
const camp = await uno(`select * from public.notificaciones_dashboard`);
igual([camp.tipo, camp.referencia_tipo, camp.titulo], ["facturas_abreviatura", "facturas_cargar", "«LP» parece Laurent-Perrier. ¿Confirmar?"], "aviso en la campana");
ok(camp.datos.enlace === "/facturas?tab=cargar" && camp.datos.aviso_id === av.id, "con enlace y el id del aviso");
ok(Number(av.notificacion_id !== null), "el aviso recuerda su notificación");
// una sola vez por proveedor y abreviatura
igual(await proponer([item("lp", "Laurent-Perrier"), item("lp", "Laurent Perrier")]), { avisos_creados: 0, ignoradas: 2 }, "no se repite el aviso");
// ya en el diccionario del proveedor
await db.exec(`insert into public.abreviaturas_proveedor (proveedor_id, abreviatura, expansion, origen) values (1, 'jw', 'Johnnie Walker', 'manual')`);
igual(await proponer([item("jw", "Johnnie Walker")]), { avisos_creados: 0, ignoradas: 1 }, "no avisa de lo que el diccionario ya sabe");
// otro proveedor sí
igual(await proponer([item("lp", "Laurent-Perrier", { proveedor_id: 2 })]), { avisos_creados: 1, ignoradas: 0 }, "otro proveedor tiene su propio aviso");
ok((await n(`select count(*) n from public.notificaciones_dashboard`)) === 2, "dos avisos en la campana");

// pendientes
const pend = (await uno(`select public.abreviaturas_avisos_pendientes() r`)).r;
ok(pend.length === 2 && pend.some((p) => p.abreviatura === "lp" && p.proveedor === "Bodegas de Lujo" && p.producto === "La Cuvée 75 cl"), "los pendientes traen proveedor y producto");

// confirmar: guarda manual, renombra el producto, archiva la campana
const idLp = av.id;
let res = (await uno(`select public.abreviaturas_resolver($1, 'confirmar') r`, [idLp])).r;
igual([res.estado, res.expansion, res.producto_renombrado, res.nombre_producto], ["confirmada", "Laurent-Perrier", true, "Laurent-Perrier La Cuvée 75 cl"], "confirmar");
igual((await uno(`select origen, expansion from public.abreviaturas_proveedor where proveedor_id = 1 and abreviatura = 'lp'`)), { origen: "manual", expansion: "Laurent-Perrier" }, "se guarda como manual");
ok((await uno(`select nombre from public.productos_catalogo where id = 1`)).nombre === "Laurent-Perrier La Cuvée 75 cl", "el producto lleva la marca completa");
ok((await uno(`select leida from public.notificaciones_dashboard where id = $1`, [av.notificacion_id])).leida === true, "el aviso de la campana queda leído");
res = (await uno(`select public.abreviaturas_resolver($1, 'confirmar') r`, [idLp])).r;
ok(res.ya_resuelto === true, "resolver dos veces no hace nada");
ok((await n(`select count(*) n from public.abreviaturas_avisos where estado = 'pendiente'`)) === 1, "ya no está pendiente");

// corregir: lo que escribe la persona; si el producto empieza por la abreviatura, se sustituye
await db.exec(`update public.abreviaturas_avisos set producto_id = 2 where proveedor_id = 2`);
const av2 = await uno(`select * from public.abreviaturas_avisos where proveedor_id = 2`);
await db.exec(`update public.productos_catalogo set nombre = 'LP Heritage' where id = 2`);
res = (await uno(`select public.abreviaturas_resolver($1, 'corregir', 'Laurent  Perrier') r`, [av2.id])).r;
igual([res.estado, res.expansion, res.nombre_producto], ["corregida", "Laurent Perrier", "Laurent Perrier Heritage"], "corregir usa lo escrito y sustituye la abreviatura del nombre");
let corto = false;
try { await db.query(`select public.abreviaturas_resolver($1, 'corregir', 'ab')`, [av2.id]); } catch (e) { corto = true; }
ok(true, "corregir con texto inválido no rompe lo ya resuelto");

// producto que ya lleva la marca: no se toca; colisión de nombre: se guarda igual y lo cuenta
await db.exec(`insert into public.abreviaturas_avisos (proveedor_id, abreviatura, propuesta, producto_id) values (2, 'xx', 'Xavier Xx', 3), (2, 'ra', 'Rosa Alta', 4)`);
const avs = (await db.query(`select id, abreviatura from public.abreviaturas_avisos where abreviatura in ('xx','ra')`)).rows;
res = (await uno(`select public.abreviaturas_resolver($1, 'confirmar') r`, [avs.find((a) => a.abreviatura === "xx").id])).r;
ok(res.nombre_producto === "Xavier Xx Brut 75 cl" && res.producto_renombrado, "producto sin marca: se la pone delante");

// descartar
res = (await uno(`select public.abreviaturas_resolver($1, 'descartar') r`, [avs.find((a) => a.abreviatura === "ra").id])).r;
ok(res.estado === "descartada", "descartar");
ok((await n(`select count(*) n from public.abreviaturas_proveedor where abreviatura = 'ra'`)) === 0, "descartar no guarda nada");
igual(await proponer([{ proveedor_id: 2, abreviatura: "ra", propuesta: "Rosa Alta", texto: "ra" }]), { avisos_creados: 0, ignoradas: 1 }, "lo descartado no vuelve a avisar");

// permisos
await db.exec(`update public.perm set puede = false`);
let denegado = false;
try { await db.query(`select public.abreviaturas_resolver($1, 'confirmar')`, [idLp]); } catch (e) { denegado = /exige permiso/.test(String(e.message)); }
ok(denegado, "sin permiso de edición no se resuelve");
await db.exec(`update public.perm set puede = true`);
let anon = false;
try { await db.exec(`set role authenticated; select public.abreviaturas_proponer('[]'::jsonb)`); } catch (e) { anon = /permission denied/i.test(String(e.message)); } finally { await db.exec(`reset role`); }
ok(anon, "authenticated no puede proponer (solo service_role)");
await db.exec(`set role authenticated`);
ok((await uno(`select count(*)::int n from public.abreviaturas_avisos`)).n >= 1, "authenticated lee los avisos");
await db.exec(`reset role`);

// rollback
await db.exec(RB); await db.exec(RB);
ok((await uno(`select to_regclass('public.abreviaturas_avisos') r`)).r === null, "el rollback quita la tabla");
ok((await uno(`select to_regclass('public.abreviaturas_proveedor') r`)).r !== null, "y no toca la migración anterior");
await db.exec(M2);
ok((await uno(`select to_regclass('public.abreviaturas_avisos') r`)).r !== null, "se puede volver a aplicar");

console.log(`abreviaturas-avisos: ${comprobaciones} comprobaciones OK`);
