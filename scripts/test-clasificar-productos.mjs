// «clasificar-productos» por tandas (CAS-7), contra un Postgres en memoria
// (PGlite). Nunca toca Supabase.
//
//   npm run test:clasificar-productos:db
//
// Cubre la migración REAL 20261205100000 (aplicada dos veces) y su rollback:
//   - productos_asignar_por_alias: tandas, tope de tiempo, «quedan», no pisa
//     líneas con producto, solo service_role.
//   - productos_aplicar_clasificacion_ia: crea productos y alias, asigna SOLO
//     las líneas de sus textos y un alias que ya existe manda.
//   - productos_despachar_clasificacion: asigna sin IA lo que ya tiene alias y
//     solo llama a la función si queda algo sin alias.
// net.http_post y Vault son stubs que apuntan las llamadas.
import { PGlite } from "@electric-sql/pglite";
import { readFile } from "node:fs/promises";
import assert from "node:assert/strict";

const MIGRACION = await readFile("supabase/migrations/20261205100000_clasificar_productos_por_tandas.sql", "utf8");
const ROLLBACK = await readFile("supabase/rollbacks/20261205100000_clasificar_productos_por_tandas_ROLLBACK.sql", "utf8");

let comprobaciones = 0;
const ok = (v, msg) => { assert.ok(v, msg); comprobaciones++; };
const igual = (a, b, msg) => { assert.deepEqual(a, b, msg); comprobaciones++; };

const db = new PGlite();
await db.exec(`
  create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
  create schema extensions; create schema vault; create schema net;

  create function public.normalizar_texto(t text) returns text language sql immutable as $$ select lower(btrim(regexp_replace(t, '\\s+', ' ', 'g'))) $$;
  create table public.categorias_producto (id bigint generated always as identity primary key, nombre text not null, activa boolean not null default true);
  create table public.productos_catalogo (
    id bigint generated always as identity primary key,
    nombre text not null,
    nombre_normalizado text generated always as (public.normalizar_texto(nombre)) stored unique,
    categoria_id bigint references public.categorias_producto(id),
    unidad_habitual text,
    origen text not null default 'manual');
  create table public.productos_alias (
    texto_normalizado text primary key,
    producto_id bigint not null references public.productos_catalogo(id) on delete cascade,
    origen text not null default 'manual');
  create table public.productos_factura (
    id bigserial primary key,
    nombre text not null,
    nombre_normalizado text,
    producto_id bigint references public.productos_catalogo(id),
    created_at timestamptz not null default now());
  grant select, insert, update on public.productos_factura, public.productos_alias, public.productos_catalogo to service_role, authenticated;

  create function public.url_funcion_edge(p text) returns text language sql stable as $$ select 'https://falso.supabase.co/functions/v1/' || p $$;
  create table vault.decrypted_secrets (name text primary key, decrypted_secret text);
  insert into vault.decrypted_secrets values ('ocr_trabajos_secret', 'secreto-falso');
  create table public.llamadas_http (url text, body jsonb);
  create function net.http_post(url text, headers jsonb, body jsonb, timeout_milliseconds integer) returns bigint
    language sql as $$ insert into public.llamadas_http values (url, body); select 1::bigint $$;

  insert into public.categorias_producto (nombre) values ('Pescado');
  insert into public.productos_catalogo (nombre, origen) values ('Merluza', 'manual'), ('Gamba roja', 'manual');
`);

const uno = async (sql, params) => (await db.query(sql, params)).rows[0];
const n = async (sql) => Number((await uno(sql)).n);
const lineas = (texto, cuantas, minutos = 10) => db.exec(
  `insert into public.productos_factura (nombre, nombre_normalizado, created_at)
   select '${texto}', '${texto}', now() - interval '${minutos} minutes' from generate_series(1, ${cuantas})`);
const sinProducto = (texto) => n(`select count(*) n from public.productos_factura where producto_id is null${texto ? ` and nombre_normalizado = '${texto}'` : ""}`);
const limpiar = () => db.exec(`delete from public.productos_factura; delete from public.productos_alias; delete from public.llamadas_http; delete from public.productos_catalogo where origen = 'ia'`);
const idDe = async (nombre) => Number((await uno(`select id from public.productos_catalogo where nombre = $1`, [nombre])).id);

await db.exec(MIGRACION);
await db.exec(MIGRACION); // idempotente

const merluza = await idDe("Merluza");
const gamba = await idDe("Gamba roja");

// ─── productos_asignar_por_alias ─────────────────────────────────────────────
await lineas("merluza fresca", 7);
await lineas("gamba roja denia", 3);
await lineas("sin alias", 2);
await db.exec(`insert into public.productos_alias values ('merluza fresca', ${merluza}, 'manual'), ('gamba roja denia', ${gamba}, 'manual')`);

// Tope de tiempo 0 y tandas de 2: hace UNA tanda y avisa de que quedan.
let r = (await uno(`select public.productos_asignar_por_alias(null, 0, 2) r`)).r;
igual(r, { lineas_asignadas: 2, quedan: true }, "con el tiempo agotado hace una sola tanda y dice que quedan");
ok((await sinProducto()) === 10, "solo se han asignado las 2 líneas de la tanda");

// Solo los textos pedidos.
r = (await uno(`select public.productos_asignar_por_alias(array['gamba roja denia'], 4000, 2) r`)).r;
igual(r, { lineas_asignadas: 3, quedan: false }, "con textos: asigna todas las suyas en varias tandas");
ok((await sinProducto("merluza fresca")) === 5, "las líneas de otros textos no se tocan");

// Sin límite de textos: termina lo que quedaba; lo que no tiene alias sigue sin producto.
r = (await uno(`select public.productos_asignar_por_alias() r`)).r;
igual(r, { lineas_asignadas: 5, quedan: false }, "termina lo pendiente con alias");
ok((await sinProducto("sin alias")) === 2, "lo que no tiene alias se queda sin producto");
ok((await n(`select count(*) n from public.productos_factura where nombre_normalizado = 'merluza fresca' and producto_id = ${merluza}`)) === 7, "cada línea recibe el producto de su alias");

// No pisa una línea que ya tiene producto, aunque su alias diga otra cosa.
await db.exec(`update public.productos_alias set producto_id = ${gamba} where texto_normalizado = 'merluza fresca'`);
r = (await uno(`select public.productos_asignar_por_alias() r`)).r;
igual(r, { lineas_asignadas: 0, quedan: false }, "nada que asignar");
ok((await n(`select count(*) n from public.productos_factura where nombre_normalizado = 'merluza fresca' and producto_id = ${merluza}`)) === 7, "una línea con producto no se pisa");

// Permisos: solo service_role.
let denegado = false;
try { await db.exec(`set role authenticated; select public.productos_asignar_por_alias()`); } catch (e) { denegado = /permission denied/i.test(String(e.message)); } finally { await db.exec(`reset role`); }
ok(denegado, "authenticated no puede ejecutar productos_asignar_por_alias");
await db.exec(`set role service_role; select public.productos_asignar_por_alias(); reset role`);
ok(true, "service_role sí puede");

// ─── productos_aplicar_clasificacion_ia ──────────────────────────────────────
await limpiar();
await lineas("rape cola", 4);
await lineas("merluza pincho", 3);
await lineas("ya tenia alias", 2);
await lineas("de otra tanda", 5);
await db.exec(`insert into public.productos_alias values ('ya tenia alias', ${gamba}, 'manual'), ('de otra tanda', ${gamba}, 'manual')`);
const items = [
  { textos: ["rape cola"], producto_id: null, nombre: "Rape", categoria_id: 1, unidad: "kg" },
  { textos: ["merluza pincho"], producto_id: merluza, nombre: null, categoria_id: null, unidad: null },
  // La IA propone otro producto para un texto que YA tiene alias: manda el alias.
  { textos: ["ya tenia alias"], producto_id: merluza, nombre: null, categoria_id: null, unidad: null },
];
r = (await uno(`select public.productos_aplicar_clasificacion_ia($1::jsonb) r`, [JSON.stringify(items)])).r;
igual(r, { productos_creados: 1, alias_creados: 2, lineas_asignadas: 9, lineas_pendientes: false }, "crea el producto y los alias y asigna las líneas de sus textos");
const rape = await idDe("Rape");
ok((await n(`select count(*) n from public.productos_factura where nombre_normalizado = 'rape cola' and producto_id = ${rape}`)) === 4, "las líneas del producto nuevo quedan asignadas a él");
ok((await n(`select count(*) n from public.productos_factura where nombre_normalizado = 'merluza pincho' and producto_id = ${merluza}`)) === 3, "las del producto existente, a ese producto");
ok((await n(`select count(*) n from public.productos_factura where nombre_normalizado = 'ya tenia alias' and producto_id = ${gamba}`)) === 2, "un alias que ya existía manda sobre lo que diga la IA");
ok((await sinProducto("de otra tanda")) === 5, "las líneas de textos que NO venían en la llamada no se tocan (las asigna el cron)");
ok((await uno(`select origen from public.productos_catalogo where id = ${rape}`)).origen === "ia", "el producto nuevo queda con origen «ia»");

// Repetir la misma llamada no duplica nada.
r = (await uno(`select public.productos_aplicar_clasificacion_ia($1::jsonb) r`, [JSON.stringify(items)])).r;
igual(r, { productos_creados: 0, alias_creados: 0, lineas_asignadas: 0, lineas_pendientes: false }, "repetir la llamada no crea ni asigna nada");

// Entrada no válida.
let rechazado = false;
try { await db.query(`select public.productos_aplicar_clasificacion_ia('{}'::jsonb)`); } catch (e) { rechazado = /tiene que ser una lista/.test(String(e.message)); }
ok(rechazado, "p_items que no es una lista se rechaza");
r = (await uno(`select public.productos_aplicar_clasificacion_ia('[]'::jsonb) r`)).r;
igual(r, { productos_creados: 0, alias_creados: 0, lineas_asignadas: 0, lineas_pendientes: false }, "una lista vacía no hace nada");

// ─── productos_despachar_clasificacion (el cron) ─────────────────────────────
// Quedan 5 líneas «de otra tanda» con alias: el cron las asigna sin IA y, como no queda nada, no llama a la función.
r = Number((await uno(`select public.productos_despachar_clasificacion() r`)).r);
ok(r === 0, "sin nada sin alias, el cron no llama a la función");
ok((await sinProducto()) === 0, "el cron ha asignado lo que ya tenía alias");
ok((await n(`select count(*) n from public.llamadas_http`)) === 0, "no se ha gastado ninguna llamada a la IA");

// Con líneas sin alias (de hace más de un minuto), sí llama, una vez.
await lineas("texto nuevo", 2);
r = Number((await uno(`select public.productos_despachar_clasificacion() r`)).r);
ok(r === 1, "con líneas sin alias el cron llama a la función");
const llamada = await uno(`select url, body from public.llamadas_http`);
ok(llamada.url.endsWith("/clasificar-productos") && llamada.body.modo === "cron", "llama a clasificar-productos en modo cron");

// Una línea recién creada (menos de un minuto) todavía no dispara la función.
await limpiar();
await lineas("recien llegada", 1, 0);
r = Number((await uno(`select public.productos_despachar_clasificacion() r`)).r);
ok(r === 0, "una línea de hace menos de un minuto aún no dispara la función");

// ─── Rollback ────────────────────────────────────────────────────────────────
await db.exec(ROLLBACK);
ok((await n(`select count(*) n from pg_proc where proname = 'productos_asignar_por_alias'`)) === 0, "el rollback quita productos_asignar_por_alias");
await limpiar();
await lineas("de otra tanda", 3);
await lineas("rape cola", 1);
await db.exec(`insert into public.productos_alias values ('de otra tanda', ${gamba}, 'manual')`);
r = (await uno(`select public.productos_aplicar_clasificacion_ia($1::jsonb) r`, [JSON.stringify([items[0]])])).r;
igual(r, { productos_creados: 1, alias_creados: 1, lineas_asignadas: 4 }, "tras el rollback vuelve la versión anterior (asigna todo lo que tenga alias)");
r = Number((await uno(`select public.productos_despachar_clasificacion() r`)).r);
ok(r === 0, "tras el rollback el cron sigue funcionando");
await db.exec(MIGRACION);
ok((await n(`select count(*) n from pg_proc where proname = 'productos_asignar_por_alias'`)) === 1, "y la migración se puede volver a aplicar");

console.log(`test-clasificar-productos: ${comprobaciones} comprobaciones OK`);
