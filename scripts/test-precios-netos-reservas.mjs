// Prueba la migración 20261212910000_precios_netos_reservas (reservas de la revisión del PR #300) y su rollback contra
// un Postgres en memoria (PGlite) con pg_trgm, encima de 20261212900000. Nunca toca Supabase.
//
//   node scripts/test-precios-netos-reservas.mjs
//
//   - R2 precio_impreso_linea_agente: precio y % de descuento solo si la línea tiene descuento.
//   - R2/R4/R6 las sustituciones de texto se aplican una vez, se saltan al reaplicar, abortan si falta el trozo y el
//     rollback devuelve el cuerpo exacto (hash).
//   - R3 detalle_documento_agente con la clave importe_neto repetida queda con una sola.
//   - R6 productos_resumen.es_descuento marca «Descuento comercial» sin cambiar ningún total.
import { PGlite } from "@electric-sql/pglite";
import { pg_trgm } from "@electric-sql/pglite/contrib/pg_trgm";
import { readFile } from "node:fs/promises";
import assert from "node:assert/strict";

const BASE = await readFile("supabase/migrations/20261211200000_descuentos_asociados.sql", "utf8");
const REGALOS = await readFile("supabase/migrations/20261211400000_regalos_y_descuentos_positivos.sql", "utf8");
const M900 = await readFile("supabase/migrations/20261212900000_precios_netos_coherentes.sql", "utf8");
const MIGRACION = await readFile("supabase/migrations/20261212910000_precios_netos_reservas.sql", "utf8");
const ROLLBACK = await readFile("supabase/rollbacks/20261212910000_precios_netos_reservas_ROLLBACK.sql", "utf8");

let comprobaciones = 0;
const igual = (a, b, msg) => { assert.deepEqual(a, b, msg); comprobaciones++; };

const db = new PGlite({ extensions: { pg_trgm } });
await db.exec(`
  create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
  create schema extensions;
  create extension pg_trgm with schema extensions;
  create function public.can_read_section(s text) returns boolean language sql stable as $$ select true $$;
  create table public.categorias_producto (id bigint primary key, clave text, padre_id bigint, nombre text);
  create table public.productos_catalogo (id bigint primary key, nombre text, categoria_id bigint, origen text, unidad_habitual text);
  create table public.facturas (id bigint primary key, total numeric, proveedor text, fecha date, tipo text default 'factura', facturado_en_id bigint);
  create table public.productos_factura (
    id bigint primary key, factura_id bigint not null references public.facturas(id) on delete cascade,
    nombre text not null, nombre_busqueda text, nombre_normalizado text, cantidad numeric, precio_unitario numeric,
    total numeric, albaran_ref text, pagina smallint, orden integer, producto_id bigint, unidad text,
    descuento_pct numeric, importe_bruto numeric, importe_bruto_estimado boolean not null default false);
  create table public.auditoria (n serial);
  create function public.fn_auditoria() returns trigger language plpgsql as $$ begin insert into public.auditoria default values; return null; end $$;
  create trigger trg_auditoria after insert or update or delete on public.productos_factura for each row execute function public.fn_auditoria();

  insert into categorias_producto values (1, 'bebidas', null, 'bebidas');
  insert into productos_catalogo values (1, 'Cruzcampo 20 L', 1, 'ia', 'barril'), (2, 'Fenomenal verdejo', 1, 'ia', 'botella'), (3, 'Descuento comercial', 1, 'ia', 'ud');
  insert into facturas values
    (1, 1000, 'DISTRIBUCIONES DE BEBIDAS CATRAL, S.L.', '2026-05-10'),   -- P1: cantidad incoherente
    (2, 1000, 'DISTRIBUCIONES DE BEBIDAS CATRAL, S.L.', '2026-06-10'),   -- P1: los descuentos superan la línea
    (3, 1000, 'Cárnicas Joselito S.A.', '2026-06-11'),
    (4, 1000, 'AVATEL TELECOM, S.A.', '2026-06-12'),
    (5, 1000, 'Makro Distribucion Mayorista, S.A.', '2026-06-13'),
    (6, 1000, 'DISTRIBUCIONES DE BEBIDAS CATRAL, S.L.', '2026-06-14'),   -- DTO ESPECIE
    (7, 1000, 'Negociants', '2026-06-15'),                               -- P2: 100 % de descuento
    (8, 1000, 'Negociants', '2026-03-15');
  insert into productos_factura (id, factura_id, nombre, nombre_busqueda, nombre_normalizado, cantidad, precio_unitario, total, orden, producto_id, unidad) values
    (10, 1, 'BARRIL CRUZCAMPO 20 L. ESP.', 'barril cruzcampo 20 l. esp.', 'barril cruzcampo 20 l esp', 5, 92.35, 461.75, 0, 1, 'barril'),
    (11, 1, 'DESCUENTO BARRIL CRUZCAMPO 20 L. ESP.', 'descuento barril cruzcampo 20 l. esp.', 'descuento barril cruzcampo 20 l esp', -5, 53.16, -265.80, 1, null, 'barril'),
    (12, 1, 'DESCUENTO BARRIL CRUZCAMPO 20 L. ESP.', 'descuento barril cruzcampo 20 l. esp.', 'descuento barril cruzcampo 20 l esp', -6, 53.16, -318.96, 2, null, 'barril'),
    (20, 2, 'BARRIL CRUZCAMPO 20 L. ESP.', 'barril cruzcampo 20 l. esp.', 'barril cruzcampo 20 l esp', 5, 92.35, 461.75, 0, 1, 'barril'),
    (21, 2, 'DESCUENTO BARRIL CRUZCAMPO 20 L. ESP.', 'descuento barril cruzcampo 20 l. esp.', 'descuento barril cruzcampo 20 l esp', -5, 53.16, -265.80, 1, null, 'barril'),
    (22, 2, 'DESCUENTO BARRIL CRUZCAMPO 20 L. ESP.', 'descuento barril cruzcampo 20 l. esp.', 'descuento barril cruzcampo 20 l esp', -5, 53.16, -265.80, 2, null, 'barril'),
    (30, 3, 'JAMON', 'jamon', 'jamon', 1, 900, 900, 0, null, 'ud'),
    (31, 3, 'RAPPEL POR MARKETING Y ESCAPARATE', 'rappel por marketing y escaparate', 'rappel por marketing y escaparate', 1, 526.26, -526.26, 1, null, 'ud'),
    (40, 4, 'Fibra', 'fibra', 'fibra', 1, 60, 60, 0, null, 'ud'),
    (41, 4, 'Promo 15 meses Pack Negocio PLUS (abr 2025)', 'promo 15 meses pack negocio plus (abr 2025)', 'promo 15 meses pack negocio plus', 1, 5, -5, 1, null, 'ud'),
    (50, 5, 'SAL MALDON 250G', 'sal maldon 250g', 'sal maldon 250g', 1, 3.75, 3.75, 0, null, 'ud'),
    (51, 5, 'COMPRA MAS PAGA MENOS', 'compra mas paga menos', 'compra mas paga menos', -1, null, -2.20, 1, null, 'ud'),
    (60, 6, 'CERVEZA', 'cerveza', 'cerveza', 10, 100, 1000, 0, null, 'ud'),
    (61, 6, 'DTO ESPECIE S/C. CERVEZA', 'dto especie s/c. cerveza', 'dto especie s/c cerveza', 1, 171.71, -171.71, 1, null, 'ud'),
    (70, 7, 'Fenomenal verdejo', 'fenomenal verdejo', 'fenomenal verdejo', 6, 6.25, 25, 0, 2, 'botella'),
    (71, 7, '100 % de DESC.', '100 % de desc.', '100 % de desc', 0, null, 0, 1, null, 'ud'),
    (80, 8, 'Fenomenal verdejo', 'fenomenal verdejo', 'fenomenal verdejo', 12, 6.25, 75, 0, 2, 'botella');
`);
await db.exec(BASE);
await db.exec(REGALOS);
await db.exec(`insert into productos_factura (id, factura_id, nombre, nombre_busqueda, nombre_normalizado, cantidad, precio_unitario, total, orden, producto_id, unidad)
  values (81, 8, 'Descuento comercial', 'descuento comercial', 'descuento comercial', 1, 5, 5, 1, 3, 'ud')`);
await db.exec(M900);   // estado de partida: 20261212900000 ya aplicada
await db.exec(`update productos_factura set importe_neto = 0 where id = 70`);   // 100 % de descuento: neto 0, impreso 25

// Funciones del chat de mentira con los trozos que sustituye la migración (en producción son las reales).
const IMPRESO = `'importe_impreso', case when pf.importe_neto is not null and pf.importe_neto is distinct from pf.total then round(pf.total::numeric, 2) end,`;
const X = ` 'importe_neto', case when pf.importe_neto is not null and pf.importe_neto is distinct from pf.total then round(pf.importe_neto::numeric, 2) end,`;
await db.exec(`
  create function public.buscar_productos_texto_agente(p_texto text)
  returns json language plpgsql stable set search_path to 'public' as $f$
  begin
    return (select json_agg(jsonb_strip_nulls(jsonb_build_object('producto', pf.nombre, 'importe', round(coalesce(pf.importe_neto, pf.total)::numeric, 2), ${IMPRESO} 'fecha', 1)))
              from productos_factura pf where pf.id = 10);
  end $f$;
  create function public.detalle_documento_agente(p_id bigint)
  returns json language plpgsql stable set search_path to 'public' as $f$
  begin
    return (select json_agg(jsonb_build_object('importe',  round(pf.total::numeric, 2),${X}${X} 'fin', 1)) from productos_factura pf where pf.id = 10);
  end $f$;
`);
const cuerpo = async (f) => (await db.query(`select pg_get_functiondef(p.oid) d from pg_proc p where p.proname = $1`, [f])).rows[0].d;
const buscarAntes = await cuerpo("buscar_productos_texto_agente");
const resumenAntes = await cuerpo("productos_resumen");
const totales = async () => (await db.query(`select
  (select round(sum(coalesce(importe_neto, total)), 2)::float8 from productos_factura) lineas,
  (select round(sum(gasto), 2)::float8 from productos_resumen()) resumen,
  (select round(sum(gasto), 2)::float8 from productos_gasto_por_categoria()) categoria`)).rows[0];
const totAntes = await totales();
const resumenAntesFilas = (await db.query(`select producto_id, gasto::float8 g, ultimo_precio::float8 u from productos_resumen() order by 1`)).rows;

await db.exec(MIGRACION);
const hashes = async () => (await db.query(`select p.proname, md5(pg_get_functiondef(p.oid)) h from pg_proc p where p.proname in ('buscar_productos_texto_agente','detalle_documento_agente','productos_resumen','precio_impreso_linea_agente') order by 1`)).rows;
const h1 = await hashes();

// R2: precio impreso y descuento solo con descuento
const imp = async (id) => (await db.query(`select precio_impreso_linea_agente($1) v`, [id])).rows[0].v;
igual(await imp(10), { precio_impreso: 92.35, descuento_pct: 57.6 }, "Cruzcampo 20 L: se paga a 39,19 y la factura dice 92,35 (57,6 % de descuento)");
igual(await imp(70), { precio_impreso: 4.17, descuento_pct: 100 }, "100 % de descuento: neto 0, impreso 25 / 6 ud");
igual(await imp(80), null, "sin descuento no hay precio_impreso");
igual(await imp(11), null, "la línea de descuento (impreso negativo) tampoco");
igual(await imp(99999), null, "ni una línea que no existe");
const bus = (await db.query(`select buscar_productos_texto_agente('x')::jsonb v`)).rows[0].v[0];
igual([bus.precio_impreso, bus.descuento_pct, bus.importe_impreso], [92.35, 57.6, 461.75], "buscar_productos: el precio impreso y el descuento salen al lado del importe neto");

// R3: la clave repetida queda una vez; reaplicar no la duplica
const detalle = await cuerpo("detalle_documento_agente");
igual(detalle.split("'importe_neto'").length - 1, 1, "detalle_documento_agente: una sola clave importe_neto");
// R2/R3: reaplicable y el rollback devuelve el cuerpo de antes
await db.exec(MIGRACION);
igual(await hashes(), h1, "reaplicar la migración no cambia ninguna función (mismo hash)");
igual((await cuerpo("buscar_productos_texto_agente")).split("'precio_impreso'").length - 1, 2, "el trozo nuevo no se duplica (clave y llamada)");

// R6: es_descuento sin cambiar totales
const r = (await db.query(`select producto_id, es_descuento, gasto::float8 g, ultimo_precio::float8 u from productos_resumen() order by 1`)).rows;
igual(r.map((x) => [x.producto_id, x.es_descuento]), [[1, false], [2, false], [3, true]], "Descuento comercial sale marcado como descuento");
igual(r.map((x) => [x.producto_id, x.g, x.u]), resumenAntesFilas.map((x) => [x.producto_id, x.g, x.u]), "ninguna cifra de Productos cambia");
igual(await totales(), totAntes, "los totales (líneas, Productos, categorías) son los mismos");

// Si falta un trozo y la función existe, aborta sin cambiar nada
await db.exec(`create function public.ranking_agente(p_criterio text) returns json language sql as $f$ select '{}'::json $f$;`);
const antes = await hashes();
let fallo = null;
try { await db.exec(MIGRACION); } catch (e) { fallo = String(e.message); }
igual(fallo?.includes("ranking_agente") && fallo.includes("aparece 0 veces"), true, "con un trozo que no aparece aborta y dice dónde");
igual(await hashes(), antes, "y no cambia nada");
await db.exec(`drop function public.ranking_agente(text);`);

// Rollback: cuerpo exacto, dos veces
await db.exec(ROLLBACK);
await db.exec(ROLLBACK);
const sinCR = (t) => t.replaceAll(String.fromCharCode(13), "");
igual(sinCR(await cuerpo("buscar_productos_texto_agente")), sinCR(buscarAntes), "el rollback deja buscar_productos_texto_agente como estaba");
igual(sinCR(await cuerpo("productos_resumen")), sinCR(resumenAntes), "y productos_resumen");
igual((await db.query(`select * from productos_resumen() limit 0`)).fields.length, 15, "con sus 15 columnas de 20261212900000");
igual((await db.query(`select to_regprocedure('public.precio_impreso_linea_agente(bigint)') t`)).rows[0].t, null, "y quita la función de precio impreso");
await db.exec(MIGRACION);
igual(await hashes(), h1, "aplicar otra vez tras el rollback da lo mismo que la primera vez");

console.log(`OK precios-netos-reservas: ${comprobaciones} comprobaciones`);
