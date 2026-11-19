// Prueba la migración 20261212900000_precios_netos_coherentes (sobre 20261211200000 y 20261211400000) y su
// rollback contra un Postgres en memoria (PGlite) con pg_trgm. Nunca toca Supabase.
//
//   node scripts/test-precios-netos-coherentes.mjs
//
// Casos reales de la revisión del 18/11/2026:
//   - P1 Catral 001061: dos descuentos sobre «BARRIL CRUZCAMPO 20 L» (461,75 €), uno con otra cantidad (-6
//     frente a 5): ese no se asocia; y si dos descuentos de cantidad correcta superan la línea, el sobrante
//     queda sin asociar y ninguna línea baja de 0. La suma del documento no cambia nunca.
//   - P5 rappel de Joselito, DTO ESPECIE de Catral y descuentos de telefonía → descuento_general; la promoción
//     de Makro sin artículo → sigue como pendiente.
//   - P3 productos_resumen y productos_gasto_por_categoria en neto, con el impreso al lado; las funciones de
//     precios se pasan al neto por sustitución de texto (y se comprueba que aborta si falta un trozo).
//   - P2 una línea con neto 0 (100 % de descuento) no es el último precio.
import { PGlite } from "@electric-sql/pglite";
import { pg_trgm } from "@electric-sql/pglite/contrib/pg_trgm";
import { readFile } from "node:fs/promises";
import assert from "node:assert/strict";

const BASE = await readFile("supabase/migrations/20261211200000_descuentos_asociados.sql", "utf8");
const REGALOS = await readFile("supabase/migrations/20261211400000_regalos_y_descuentos_positivos.sql", "utf8");
const MIGRACION = await readFile("supabase/migrations/20261212900000_precios_netos_coherentes.sql", "utf8");
const ROLLBACK = await readFile("supabase/rollbacks/20261212900000_precios_netos_coherentes_ROLLBACK.sql", "utf8");

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
  insert into productos_catalogo values (1, 'Cruzcampo 20 L', 1, 'ia', 'barril'), (2, 'Fenomenal verdejo', 1, 'ia', 'botella');
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

// Función de precios con el mismo fragmento que las reales (filtro «pf.total > 0») ya pasada al neto por 20261211300000.
await db.exec(`
  create function public.margenes_carta_ultima(p_ids bigint[], p_hoy date, p_dias integer)
  returns table(id bigint, importe numeric) language sql stable as $f$
    select pf.id, coalesce(pf.importe_neto, pf.total) as importe
      from public.productos_factura pf where pf.id = any(p_ids) and pf.total > 0 and pf.cantidad > 0
  $f$;
`);
const cuerpo = async (f) => (await db.query(`select pg_get_functiondef(p.oid) d from pg_proc p where p.proname = $1`, [f])).rows[0].d;
const asociarAntes = await cuerpo("facturas_asociar_descuentos");
const margenesAntes = await cuerpo("margenes_carta_ultima");

const f = async (id) => {
  const r = (await db.query(`select importe_neto, descuento_general from productos_factura where id = $1`, [id])).rows[0];
  return { neto: r.importe_neto === null ? null : Number(r.importe_neto), general: r.descuento_general };
};
const sumaPorDoc = async () => (await db.query(
  `select factura_id, round(sum(coalesce(importe_neto, total)), 2)::float8 neto, round(sum(total), 2)::float8 imp from productos_factura group by 1 order by 1`)).rows;

// Antes de la migración (estado de 20261211400000): el descuento de cantidad incoherente ya se asociaba.
const docsAntes = (await sumaPorDoc()).map((r) => r.imp);

await db.exec(MIGRACION);
const docsDespues = await sumaPorDoc();
igual(docsDespues.map((r) => r.imp), docsAntes, "lo impreso no cambia");
igual(docsDespues.map((r) => r.neto), docsDespues.map((r) => r.imp), "por documento, neto y total suman lo mismo (nada se cuenta dos veces)");

// P1
igual((await f(10)).neto, 195.95, "Catral 001061: la línea solo recibe el descuento de su cantidad (461,75 - 265,80)");
igual((await f(11)).neto, 0, "el descuento asociado vale 0");
igual((await f(12)).neto, null, "el de otra cantidad (-6 frente a 5) queda sin asociar (neto = su importe entero, -318,96)");
const neg = Number((await db.query(`select count(*) n from productos_factura where total > 0 and importe_neto < 0`)).rows[0].n);
igual(neg, 0, "ninguna línea con neto negativo");
igual((await f(20)).neto, 0, "dos descuentos de cantidad correcta que juntos superan la línea: la deja a 0, no por debajo");
igual([(await f(21)).neto, (await f(22)).neto], [0, -69.85], "y del segundo solo se asocia lo que cabe: el sobrante (69,85 €) queda sin asociar");

// P5
igual([(await f(31)).general, (await f(41)).general, (await f(61)).general], [true, true, true], "rappel, telefonía y DTO ESPECIE: descuento general del proveedor");
igual((await f(51)).general, null, "la promoción de Makro sin artículo sigue como pendiente");
const res = (await db.query(`select proveedor, lineas, importe::float8 imp, general from descuentos_sin_asociar_resumen() order by general, proveedor`)).rows;
igual(res.filter((r) => !r.general).map((r) => [r.proveedor, r.lineas]),
  [["DISTRIBUCIONES DE BEBIDAS CATRAL, S.L.", 2], ["Makro Distribucion Mayorista, S.A.", 1]], "pendientes por proveedor");
igual(res.filter((r) => r.general).map((r) => r.proveedor).sort(),
  ["AVATEL TELECOM, S.A.", "Cárnicas Joselito S.A.", "DISTRIBUCIONES DE BEBIDAS CATRAL, S.L."], "descuentos generales por proveedor");

// P3 + P2: Productos en neto con el impreso al lado
await db.exec(`update productos_factura set importe_neto = 0 where id = 70`);   // 100 % de descuento: neto 0, impreso 25
const p = (await db.query(`select nombre, gasto::float8 g, gasto_impreso::float8 gi, ultimo_precio::float8 u, ultimo_precio_impreso::float8 ui
                             from productos_resumen() where producto_id in (1, 2) order by producto_id`)).rows;
igual([p[0].g, p[0].gi], [195.95 + 0, 923.5], "Cruzcampo: gasto neto (solo lo que queda tras sus descuentos) frente a lo impreso");
igual([p[1].g, p[1].gi, p[1].u, p[1].ui], [75, 100, 6.25, 6.25], "Fenomenal: la línea a neto 0 no es el último precio (6,25 €, no 0) y no suma gasto");
const cat = (await db.query(`select gasto::float8 g from productos_gasto_por_categoria() where categoria = 'bebidas'`)).rows;
igual(cat.length, 1, "familia en neto");

// Funciones de precios: P2 en el filtro y rollback exacto
await db.exec(MIGRACION);   // reaplicable
igual(await cuerpo("facturas_asociar_descuentos"), await cuerpo("facturas_asociar_descuentos"), "reaplicable");
igual((await db.query(`select count(*) n from productos_factura_descuentos`)).rows[0].n, 3, "mismos repartos tras reaplicar");

await db.exec(ROLLBACK);
const sinCR = (t) => t.replaceAll(String.fromCharCode(13), "");
igual(sinCR(await cuerpo("facturas_asociar_descuentos")), sinCR(asociarAntes), "el rollback deja facturas_asociar_descuentos como estaba");
igual((await db.query(`select column_name from information_schema.columns where table_name = 'productos_factura' and column_name = 'descuento_general'`)).rows, [], "y quita la columna");
igual((await db.query(`select to_regprocedure('public.descuentos_sin_asociar_resumen()') t`)).rows[0].t, null, "y la función de resumen");
igual((await db.query(`select * from productos_resumen() limit 0`)).fields.length, 13, "productos_resumen vuelve con sus 13 columnas de antes");
igual(await cuerpo("margenes_carta_ultima"), margenesAntes, "la función de precios vuelve al cuerpo de antes");

console.log(`OK precios-netos-coherentes: ${comprobaciones} comprobaciones`);
