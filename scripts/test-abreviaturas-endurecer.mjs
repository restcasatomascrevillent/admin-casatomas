// Abreviaturas: reglas más estrictas, lista de exclusión y «No es» (migración 20261209500000) contra PGlite.
//
//   npm run test:abreviaturas-endurecer:db
//
// Cubre: expansion_valida (marcas sí; «Cs-Salchichon» y «Smoothie de mango,» no), el aprendizaje ya no
// guarda las dos falsas de producción pero sí lp/coca/fever/juve, la lista de exclusión (por proveedor,
// global, con o sin expansión), proponer la respeta, listar/quitar con permisos, quitar impide que
// recalcular la vuelva a aprender, idempotencia y rollback.
import { PGlite } from "@electric-sql/pglite";
import { readFile } from "node:fs/promises";
import assert from "node:assert/strict";

const M1 = await readFile("supabase/migrations/20261209300000_abreviaturas_proveedor.sql", "utf8");
const M2 = await readFile("supabase/migrations/20261209310000_abreviaturas_avisos.sql", "utf8");
const M3 = await readFile("supabase/migrations/20261209500000_abreviaturas_endurecer.sql", "utf8");
const RB = await readFile("supabase/rollbacks/20261209500000_abreviaturas_endurecer_ROLLBACK.sql", "utf8");

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
  insert into public.categorias_producto values (1, 'Bebidas', null), (12, 'Vinos', 1), (6, 'Despensa', null);
  create table public.productos_catalogo (id bigint generated always as identity primary key, nombre text not null,
    nombre_normalizado text generated always as (lower(nombre)) stored unique, categoria_id bigint);
  create table public.productos_alias (texto_normalizado text primary key, producto_id bigint not null references public.productos_catalogo(id) on delete cascade, origen text not null default 'manual');
  create table public.productos_factura (id bigserial primary key, factura_id bigint references public.facturas(id), nombre text not null, nombre_normalizado text, producto_id bigint references public.productos_catalogo(id));
  create table public.notificaciones_dashboard (id uuid primary key default gen_random_uuid(), tipo text not null, titulo text not null, mensaje text,
    referencia_id uuid, referencia_tipo text, leida boolean not null default false, created_at timestamptz default now(),
    prioridad text not null default 'normal', clave text, caduca_en timestamptz, datos jsonb);
  create function public.productos_renombrar(p_id bigint, p_nombre text) returns jsonb language plpgsql as $$
    begin update public.productos_catalogo set nombre = p_nombre where id = p_id; return '{}'::jsonb; end $$;
  insert into public.proveedores (nombre) values ('Gambín'), ('Disbeya'), ('Nicolás y Valero'), ('Garcimar');
  insert into public.facturas (proveedor_id) values (1), (2), (3), (4);
  insert into public.productos_catalogo (nombre, categoria_id) values
    ('Laurent-Perrier La Cuvée 75 cl', 12),               -- 1
    ('Coca-Cola Zero 33 cl', 1),                           -- 2
    ('Cs-Salchichon Cular 1 kg', 6),                       -- 3 (alias: la falsa «cs»)
    ('Smoothie de mango, B5 fresa 250 ml', 6),             -- 4 (la falsa «sm»)
    ('Fever-Tree Tonic 20 cl', 1),                         -- 5
    ('Juve&Camps Cinta Purpura 75 cl', 12);                      -- 6
  insert into public.productos_alias values ('cs-salchichon cular casa sendra', 3, 'manual');
`);
await db.exec(M1);
await db.exec(M2);

// ── 2. Antes de la migración endurecedora aprendía las falsas ──
const linea = (n, prod, fact) => db.query(`insert into public.productos_factura (factura_id, nombre, nombre_normalizado, producto_id) values ($1, $2, lower($2), $3)`, [fact, n, prod]);
const cargar = async () => {
  await db.exec(`delete from public.productos_factura; delete from public.abreviaturas_proveedor`);
  await linea("LP LA CUVEE 0,75L", 1, 1);
  for (let i = 0; i < 2; i++) { await linea("COCA ZERO 33CL", 2, 2); }
  await linea("CS SALCHICHON CULAR CASA SENDRA", 3, 3);
  await linea("SM CULAR SMOOTHIE", 4, 4);
  await linea("FEVER TONIC 20CL", 5, 1);
  await linea("FEVER TONIC 20CL", 5, 1);
  await linea("JUVE CINTA PURPURA 75CL", 6, 1);
  await linea("JUVE CINTA PURPURA 75CL", 6, 1);
};
await cargar();
const aprendidas = async () => (await db.query(`select p.nombre prov, a.abreviatura, a.expansion from public.abreviaturas_proveedor a join public.proveedores p on p.id = a.proveedor_id order by 1, 2`)).rows;
const antes = (await aprendidas()).map((r) => r.abreviatura);
ok(antes.includes("cs"), "sin endurecer, aprende «cs» (falsa)");

// ── 3. Con la migración ──
await db.exec(M3);
await db.exec(M3); // idempotente
const v = async (t) => (await db.query(`select public.abreviaturas_expansion_valida($1::text) r`, [t])).rows[0].r;
// ── 1. La validación ──
for (const bien of ["Laurent Perrier", "Laurent-Perrier", "Fever-Tree", "Juve&Camps", "Dom Pérignon", "Coca-Cola", "Château", "Marqués", "Moët & Chandon"])
  ok(await v(bien), `«${bien}» es una marca válida`);
for (const mal of ["Cs-Salchichon", "Smoothie de mango,", "Smoothie de mango", "Marqués de Riscal", "Whisky Macallan", "Aceite 5 l", "Pa", "Reserva Especial", "A. Dos", "Salchichon.", null])
  ok(!(await v(mal)), `«${mal}» no es una marca`);

await cargar();
const despues = await aprendidas();
const abrevs = despues.map((r) => r.abreviatura);
ok(!abrevs.includes("cs") && !abrevs.includes("sm"), "ya no aprende cs ni sm");
ok(abrevs.includes("lp") && abrevs.includes("coca") && abrevs.includes("fever") && abrevs.includes("juve"), "sí aprende lp, coca, fever y juve: " + JSON.stringify(abrevs));
igual((await db.query(`select count(*)::int n from public.abreviaturas_excluidas`)).rows[0].n, 2, "las dos falsas conocidas están en la lista de exclusión (y no se duplican)");

// ── 4. Exclusión editable ──
await db.exec(`insert into public.abreviaturas_excluidas (proveedor_id, abreviatura, expansion_clave) values (2, 'coca', null)`);
await cargar();
ok(!(await aprendidas()).some((r) => r.prov === "Disbeya" && r.abreviatura === "coca"), "excluida para Disbeya: no la aprende");
await db.exec(`delete from public.abreviaturas_excluidas where abreviatura = 'coca'`);
await cargar();
ok((await aprendidas()).some((r) => r.prov === "Disbeya" && r.abreviatura === "coca"), "al quitarla de la lista vuelve a aprenderla");

// ── 5. proponer respeta la exclusión ──
await db.exec(`insert into public.abreviaturas_excluidas (proveedor_id, abreviatura, expansion_clave) values (null, 'lp', 'laurent perrier')`);
const prop = (await db.query(`select public.abreviaturas_proponer($1::jsonb) r`, [JSON.stringify([
  { proveedor_id: 2, abreviatura: "lp", propuesta: "Laurent Perrier", texto: "lp x" },
  { proveedor_id: 2, abreviatura: "dp", propuesta: "Dom Pérignon", texto: "dp x" }])])).rows[0].r;
igual(prop.avisos_creados, 1, "propone dp y no la excluida lp");
await db.exec(`delete from public.abreviaturas_excluidas where abreviatura = 'lp'`);

// ── 6. listar y quitar («No es») ──
await cargar();
const lista = (await db.query(`select public.abreviaturas_listar() r`)).rows[0].r;
ok(lista.length >= 4 && lista.every((x) => x.proveedor && x.expansion && "usable" in x), "listar devuelve proveedor, expansión y si es usable");
const fever = lista.find((x) => x.abreviatura === "fever");
const q = (await db.query(`select public.abreviaturas_quitar($1) r`, [fever.id])).rows[0].r;
igual(q.quitada, true, "quitar borra la fila");
ok(!(await aprendidas()).some((r) => r.abreviatura === "fever"), "ya no está en el diccionario");
await cargar();
ok(!(await aprendidas()).some((r) => r.abreviatura === "fever"), "y recalcular/aprender no la vuelve a traer");
igual((await db.query(`select public.abreviaturas_quitar(999999) r`)).rows[0].r.quitada, false, "quitar un id que no existe no falla");
await db.exec(`update public.perm set puede = false`);
let denegado = null;
try { await db.query(`select public.abreviaturas_quitar($1)`, [lista[0].id]); } catch (e) { denegado = e; }
ok(denegado && /permiso de edición/.test(denegado.message), "sin permiso de edición no se puede quitar");
await db.exec(`update public.perm set puede = true`);

// ── 7. Permisos ──
const priv = async (rol, sql) => { try { await db.exec(`set role ${rol}; ${sql}; reset role`); return true; } catch { await db.exec("reset role"); return false; } };
ok(!(await priv("anon", "select public.abreviaturas_quitar(1)")), "anon no puede quitar");
ok(!(await priv("anon", "select public.abreviaturas_listar()")), "anon no puede listar");
ok(!(await priv("authenticated", "select public.abreviaturas_excluida(1,'lp','x')")), "authenticated no llama a la interna");
ok(!(await priv("authenticated", "insert into public.abreviaturas_excluidas (abreviatura) values ('zz')")), "authenticated no escribe la lista a mano");
ok(await priv("authenticated", "select public.abreviaturas_listar()"), "authenticated lista");

// ── 8. Rollback ──
await db.exec(RB);
igual((await db.query(`select to_regclass('public.abreviaturas_excluidas') r`)).rows[0].r, null, "el rollback quita la tabla");
igual((await db.query(`select to_regprocedure('public.abreviaturas_expansion_valida(text)') r`)).rows[0].r, null, "y las funciones nuevas");
await cargar();
ok((await aprendidas()).some((r) => r.abreviatura === "cs"), "y vuelve el comportamiento anterior");
await db.exec(M3);
console.log(`abreviaturas endurecer: ${comprobaciones} comprobaciones OK`);
