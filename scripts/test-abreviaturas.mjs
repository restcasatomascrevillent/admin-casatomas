// Abreviaturas por proveedor (migración 20261209300000) contra un Postgres en
// memoria (PGlite). Nunca toca Supabase.
//
//   npm run test:abreviaturas:db
//
// Casos reales de Gambín: «LP LA CUVEE», «C/6B LP LA CUVEE», «CHA.LAURENT PERRIER»,
// «BOT.», «W.», «LC.»… Cubre: aprende por iniciales (alias o nombre), ignora tokens
// genéricos y marcas enteras, el truncado solo vale con 2 veces, el trigger se
// dispara al enlazar (insert y update de producto_id), nunca rompe el guardado,
// recalcular reconstruye y el rollback deja todo como estaba.
import { PGlite } from "@electric-sql/pglite";
import { readFile } from "node:fs/promises";
import assert from "node:assert/strict";

const MIGRACION = await readFile("supabase/migrations/20261209300000_abreviaturas_proveedor.sql", "utf8");
const ROLLBACK = await readFile("supabase/rollbacks/20261209300000_abreviaturas_proveedor_ROLLBACK.sql", "utf8");

let comprobaciones = 0;
const ok = (v, msg) => { assert.ok(v, msg); comprobaciones++; };
const igual = (a, b, msg) => { assert.deepEqual(a, b, msg); comprobaciones++; };

const db = new PGlite();
await db.exec(`
  create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
  create function public.normalizar_texto(t text) returns text language sql immutable as
    $$ select lower(btrim(regexp_replace(translate(t, 'áéíóúüñÁÉÍÓÚÜÑ', 'aeiouunAEIOUUN'), '\\s+', ' ', 'g'))) $$;
  create function public.can_read_section(s text) returns boolean language sql as $$ select true $$;
  create function public.productos_tocar_updated_at() returns trigger language plpgsql as $$ begin new.updated_at := now(); return new; end $$;
  create table public.proveedores (id bigint generated always as identity primary key, nombre text not null);
  create table public.facturas (id bigint generated always as identity primary key, proveedor_id bigint references public.proveedores(id));
  create table public.categorias_producto (id bigint primary key, nombre text not null, padre_id bigint);
  insert into public.categorias_producto values (1, 'Bebidas', null), (12, 'Vinos', 1), (6, 'Despensa', null);
  create table public.productos_catalogo (id bigint generated always as identity primary key, nombre text not null, categoria_id bigint);
  create table public.productos_alias (texto_normalizado text primary key, producto_id bigint not null references public.productos_catalogo(id) on delete cascade, origen text not null default 'manual');
  create table public.productos_factura (
    id bigserial primary key, factura_id bigint references public.facturas(id), nombre text not null,
    nombre_normalizado text, producto_id bigint references public.productos_catalogo(id));
  insert into public.proveedores (nombre) values ('Gambín'), ('Otro');
  insert into public.facturas (proveedor_id) values (1), (2);
  insert into public.productos_catalogo (nombre, categoria_id) values
    ('Laurent-Perrier La Cuvée 75 cl', 12),   -- 1
    ('La Cuvée Magnum', 12),                   -- 2 (sin marca; su alias sí la trae)
    ('Tanqueray 70 cl', 12),                   -- 3
    ('Barón de Ley Reserva 75 cl', 12),        -- 4
    ('Marqués de Murrieta Reserva', 12),       -- 5
    ('Johnnie Walker Black 70 cl', 12),        -- 6
    ('Alcachofa laminada 1 kg', 6),            -- 7
    ('Whisky Macallan 12 años 70 cl', 12),     -- 8
    ('Coca-Cola Zero 35 cl', 12);              -- 9
  insert into public.productos_alias values ('laurent perrier la cuvee magnum', 2, 'manual');
`);
await db.exec(MIGRACION);
await db.exec(MIGRACION); // idempotente

const uno = async (sql, params) => (await db.query(sql, params)).rows[0];
const filas = async () => (await db.query(`select abreviatura, expansion, veces, en_nombre from public.abreviaturas_proveedor where proveedor_id = 1 order by abreviatura, expansion`)).rows;
const obs = async (texto, prov, prod, veces = 1) => (await uno(`select public.abreviaturas_observar_linea($1,$2,$3,$4) r`, [texto, prov, prod, veces])).r;
const linea = (nombre, producto, factura = 1) => db.query(
  `insert into public.productos_factura (factura_id, nombre, nombre_normalizado, producto_id) values ($1, $2, lower($2), $3)`, [factura, nombre, producto]);
const limpiar = () => db.exec(`delete from public.abreviaturas_proveedor; delete from public.productos_factura`);

// ─── tokens genéricos ────────────────────────────────────────────────────────
for (const t of ["bot", "cha", "caja", "ud", "w", "lc", "gin", "ron", "6b", "1bs", "12l", "magnum"]) {
  ok((await uno(`select public.abreviaturas_token_generico($1) r`, [t])).r === true, `«${t}» es genérico`);
}
for (const t of ["lp", "laurent", "tanqueray"]) {
  ok((await uno(`select public.abreviaturas_token_generico($1) r`, [t])).r === false, `«${t}» no es genérico`);
}

// ─── aprende por iniciales del nombre ────────────────────────────────────────
ok(await obs("c/6b lp la cuvee 0,75l", 1, 1) === true, "«C/6B LP LA CUVEE» aprende");
igual(await filas(), [{ abreviatura: "lp", expansion: "Laurent-Perrier", veces: 1, en_nombre: true }], "LP = Laurent-Perrier (de una sola coincidencia: está en el nombre)");
ok(await obs("bot. lp la cuvee 0,75l-sin cargo", 1, 1) === true, "«BOT. LP LA CUVEE» también");
igual((await filas())[0].veces, 2, "la misma abreviatura suma veces, no duplica");

// Sin marca en el nombre pero con alias: aprende del alias («Laurent Perrier»).
await limpiar();
ok(await obs("lp la cuvee magnum", 1, 2) === true, "aprende de un alias del producto");
igual(await filas(), [{ abreviatura: "lp", expansion: "Laurent Perrier", veces: 1, en_nombre: true }], "LP = Laurent Perrier (del alias)");
// Si luego llega el nombre con guion, es la MISMA fila y gana el nombre del producto.
ok(await obs("lp la cuvee 0,75l", 1, 1) === true, "luego por el nombre");
igual(await filas(), [{ abreviatura: "lp", expansion: "Laurent-Perrier", veces: 2, en_nombre: true }], "una sola fila: con guion y 2 veces");

// ─── no aprende ──────────────────────────────────────────────────────────────
await limpiar();
ok(await obs("cha.laurent perrier la cuvee", 1, 1) === false, "«CHA.» es genérico y «laurent» es una marca entera");
ok(await obs("w. johnnie walker black 70cl", 1, 6) === false, "«W.» es genérico");
ok(await obs("gin.tanqueray 70cl", 1, 3) === false, "«GIN.» genérico y «tanqueray» marca entera");
ok(await obs("lp tanqueray 70cl", 1, 3) === false, "iniciales que no corresponden al producto");
ok(await obs("lp", 1, 1) === false, "sin nada detrás no hay evidencia");
ok(await obs("lp vino sin relacion", 1, 1) === false, "el resto de la línea no trae palabras del producto");
ok(await obs("jw black label", null, 6) === false, "sin proveedor no aprende");
ok(await obs("m murrieta rva 2021", 1, 5) === false, "«M.» de una letra no es abreviatura");
igual(await filas(), [], "no se ha guardado nada");

// «Marqués de»: la partícula no cuenta en las iniciales, «mm» = Marqués de Murrieta no por ser «mm» genérico.
ok(await obs("jw black 70cl", 1, 6) === true, "JW = Johnnie Walker");
igual((await filas()).map((f) => `${f.abreviatura}=${f.expansion}`), ["jw=Johnnie Walker"], "JW = Johnnie Walker");

// ─── truncado: solo vale con 2 veces ─────────────────────────────────────────
await limpiar();
ok(await obs("baron ley reserva 75cl", 1, 4) === false, "«baron» entero no es abreviatura de «Barón» (misma palabra)");
ok(await obs("barone ley 75cl", 1, 4) === false, "no es prefijo de «baron»");
await limpiar();
ok(await obs("mar murrieta reserva", 1, 5) === true, "«mar» es comienzo truncado de «Marqués»");
igual((await filas())[0].en_nombre, false, "…y no vale hasta repetirse");
await limpiar();
// «Johnnie» truncado «johnn» + resto
ok(await obs("johnn walker black", 1, 6) === true, "truncado + resto aprende");
igual(await filas(), [{ abreviatura: "johnn", expansion: "Johnnie", veces: 1, en_nombre: false }], "queda con en_nombre = false y 1 vez (aún no vale)");
await obs("johnn walker black 70", 1, 6);
igual((await filas())[0].veces, 2, "con 2 veces ya cuenta");

// Palabras de familia no son marca; la alimentación no aprende truncados.
await limpiar();
ok(await obs("wm macallan 12 anos", 1, 8) === false, "«Whisky Macallan» no es una marca: no se aprende WM");
ok(await obs("alcac laminada 1kg", 1, 7) === false, "«alcac» por «Alcachofa» no se aprende en alimentación");
ok(await obs("coca zero 35cl", 1, 9) === true, "«coca» por «Coca-Cola» sí, en bebidas");
igual(await filas(), [{ abreviatura: "coca", expansion: "Coca-Cola", veces: 1, en_nombre: false }], "…y no vale hasta repetirse");

// ─── trigger al enlazar ──────────────────────────────────────────────────────
await limpiar();
await linea("C/6B LP LA CUVEE 0,75L", 1);
igual(await filas(), [{ abreviatura: "lp", expansion: "Laurent-Perrier", veces: 1, en_nombre: true }], "INSERT con producto aprende");
await linea("LP LA CUVEE 0,75L", null);
igual((await filas())[0].veces, 1, "una línea sin producto no aprende");
await db.exec(`update public.productos_factura set producto_id = 1 where producto_id is null`);
igual((await filas())[0].veces, 2, "UPDATE de producto_id aprende");
await db.exec(`update public.productos_factura set nombre = nombre`);
igual((await filas())[0].veces, 2, "tocar otra columna no vuelve a contar");
await linea("LP LA CUVEE", 1, 2); // factura del otro proveedor
igual((await db.query(`select count(*)::int n from public.abreviaturas_proveedor where proveedor_id = 2`)).rows[0].n, 1, "cada proveedor tiene su diccionario");

// Un fallo al aprender nunca impide guardar la línea.
await db.exec(`alter table public.abreviaturas_proveedor rename to abreviaturas_roto`);
const antes = (await uno(`select count(*)::int n from public.productos_factura`)).n;
await linea("LP LA CUVEE 75CL", 1);
ok((await uno(`select count(*)::int n from public.productos_factura`)).n === antes + 1, "la línea se guarda aunque falle el aprendizaje");
await db.exec(`alter table public.abreviaturas_roto rename to abreviaturas_proveedor`);

// ─── recalcular ──────────────────────────────────────────────────────────────
await limpiar();
await db.exec(`
  insert into public.productos_factura (factura_id, nombre, nombre_normalizado, producto_id)
  select 1, 'LP LA CUVEE', 'lp la cuvee', 1 from generate_series(1, 3);
  delete from public.abreviaturas_proveedor;
  insert into public.abreviaturas_proveedor (proveedor_id, abreviatura, expansion, origen) values (1, 'zz', 'Zeta Zeta', 'manual');`);
const rec = (await uno(`select public.abreviaturas_recalcular() r`)).r;
igual(rec.textos_con_abreviatura, 1, "recalcular ve un texto con abreviatura");
igual((await filas()).map((f) => `${f.abreviatura}=${f.expansion}:${f.veces}`), ["lp=Laurent-Perrier:3", "zz=Zeta Zeta:1"], "cuenta las 3 líneas y respeta lo manual");

// ─── permisos y RLS ──────────────────────────────────────────────────────────
let denegado = false;
try { await db.exec(`set role authenticated; select public.abreviaturas_recalcular()`); } catch (e) { denegado = /permission denied/i.test(String(e.message)); } finally { await db.exec(`reset role`); }
ok(denegado, "authenticated no puede recalcular");
await db.exec(`set role authenticated`);
ok((await uno(`select count(*)::int n from public.abreviaturas_proveedor`)).n === 2, "authenticated lee");
let noEscribe = false;
try { await db.exec(`insert into public.abreviaturas_proveedor (proveedor_id, abreviatura, expansion) values (1,'ab','Abc')`); } catch (e) { noEscribe = /permission denied/i.test(String(e.message)); } finally { await db.exec(`reset role`); }
ok(noEscribe, "authenticated no escribe");
let anonLee = false;
try { await db.exec(`set role anon; select * from public.abreviaturas_proveedor`); } catch (e) { anonLee = /permission denied/i.test(String(e.message)); } finally { await db.exec(`reset role`); }
ok(anonLee, "anon no lee");

// ─── rollback ────────────────────────────────────────────────────────────────
await db.exec(ROLLBACK);
await db.exec(ROLLBACK); // idempotente
ok((await uno(`select to_regclass('public.abreviaturas_proveedor') r`)).r === null, "el rollback quita la tabla");
await linea("LP LA CUVEE", 1);
ok(true, "sin triggers, guardar líneas sigue funcionando");
await db.exec(MIGRACION);
ok((await uno(`select to_regclass('public.abreviaturas_proveedor') r`)).r !== null, "se puede volver a aplicar");

console.log(`abreviaturas: ${comprobaciones} comprobaciones OK`);
