// Prueba la migración 20261211200000_descuentos_asociados y su rollback contra un Postgres en
// memoria (PGlite) con pg_trgm. Nunca toca Supabase.
//
//   node scripts/test-descuentos-asociados.mjs
//
// Casos reales de la revisión (docs/facturas/revision-descuentos/INFORME.md):
//   - Catral: «DESCUENTO HEINEKEN …» bajo su producto, dentro de cada albarán de la factura;
//   - Riscal: «- 20 % BONIFICAC S/ base» en el pie → reparto proporcional;
//   - Disjover: «Descuento 5 %» = 5 % de la línea anterior;
//   - Negociants: «100 % de DESC. (línea anterior …)»;
//   - Mª Carmen Virola: 20 % sobre el total con IVA;
//   - Makro: promoción sin artículo → sin asociar.
// Y además: la suma por documento no cambia, el reparto manual se respeta, el trigger recalcula al
// insertar, cambiar y borrar, el relleno no apunta auditoría, aplicada dos veces da lo mismo y el
// rollback lo quita todo.
import { PGlite } from "@electric-sql/pglite";
import { pg_trgm } from "@electric-sql/pglite/contrib/pg_trgm";
import { readFile } from "node:fs/promises";
import assert from "node:assert/strict";

const MIGRACION = await readFile("supabase/migrations/20261211200000_descuentos_asociados.sql", "utf8");
const ROLLBACK = await readFile("supabase/rollbacks/20261211200000_descuentos_asociados_ROLLBACK.sql", "utf8");

let comprobaciones = 0;
const igual = (a, b, msg) => { assert.deepEqual(a, b, msg); comprobaciones++; };

const db = new PGlite({ extensions: { pg_trgm } });
await db.exec(`
  create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
  create schema extensions;
  create extension pg_trgm with schema extensions;
  create function public.can_read_section(s text) returns boolean language sql stable as $$ select true $$;
  create table public.facturas (id bigint primary key, total numeric);
  create table public.productos_factura (
    id bigint primary key, factura_id bigint not null references public.facturas(id) on delete cascade,
    nombre text not null, nombre_busqueda text, cantidad numeric, total numeric,
    albaran_ref text, pagina smallint, orden integer, producto_id bigint);
  create table public.auditoria (n serial, tabla text);
  create function public.fn_auditoria() returns trigger language plpgsql as $$
    begin insert into public.auditoria (tabla) values (tg_table_name); return null; end $$;
  create trigger trg_auditoria after insert or update or delete on public.productos_factura
    for each row execute function public.fn_auditoria();

  insert into facturas values (1, 500), (2, 1000), (3, 300), (4, 120), (5, 83.2), (6, 50), (7, -40);
  insert into productos_factura (id, factura_id, nombre, nombre_busqueda, cantidad, total, albaran_ref, pagina, orden) values
    -- Catral: dos albaranes, cada uno con Heineken y su descuento
    (10, 1, 'HEINEKEN 1/3 LONG NET * 24', 'heineken 1/3 long net * 24', 5, 200, 'A-1', 1, 0),
    (11, 1, 'DESCUENTO HEINEKEN 1/3 LONG NET * 24', 'descuento heineken 1/3 long net * 24', 5, -80, 'A-1', 1, 1),
    (12, 1, 'BARRIL CRUZCAMPO 50 L', 'barril cruzcampo 50 l', 1, 200, 'A-1', 1, 2),
    (13, 1, 'DESCUENTO BARRIL CRUZCAMPO 50 L', 'descuento barril cruzcampo 50 l', 1, -100, 'A-1', 1, 3),
    (14, 1, 'HEINEKEN 1/3 LONG NET * 24', 'heineken 1/3 long net * 24', 10, 400, 'A-2', 1, 4),
    (15, 1, 'DESCUENTO HEINEKEN 1/3 LONG NET * 24', 'descuento heineken 1/3 long net * 24', 10, -160, 'A-2', 1, 5),
    (16, 1, 'ENVASE BARRIL', 'envase barril', 1, 40, 'A-2', 1, 6),
    -- Riscal: bonificación del 20 % en el pie
    (20, 2, 'C/6B LP ROSE 0,75', 'c/6b lp rose 0,75', 6, 750, 'R-1', 1, 0),
    (21, 2, 'C/1BS 12L LP LA CUVEE', 'c/1bs 12l lp la cuvee', 1, 500, 'R-2', 1, 1),
    (22, 2, '- 20 % BONIFICAC S/ 1.250', '- 20 % bonificac s/ 1.250', 1, -250, null, 1, 2),
    -- Disjover: 5 % de la línea anterior
    (30, 3, 'LAURENT PERRIER BRUT CUVEE', 'laurent perrier brut cuvee', 6, 316, null, 1, 0),
    (31, 3, 'Descuento 5%', 'descuento 5%', 1, -15.8, null, 1, 1),
    -- Negociants: línea anterior regalada al 100 %
    (40, 4, 'FENOMENAL verdejo 2024 (ref. 145557)', 'fenomenal verdejo 2024 (ref. 145557)', 6, 120, null, 1, 0),
    (41, 4, '100 % de DESC. (línea anterior, FENOMENAL 145557)', '100 % de desc. (linea anterior, fenomenal 145557)', 1, -60, null, 1, 1),
    (42, 4, 'FENOMENAL verdejo 2024 (ref. 145557), segunda línea', 'fenomenal verdejo 2024 (ref. 145557), segunda linea', 6, 60, null, 1, 2),
    -- Virola: 20 % sobre el total con IVA (4 %)
    (50, 5, 'BARRAS INTEGRALES', 'barras integrales', 100, 100, null, 1, 0),
    (51, 5, 'Descuento 20% (sobre total con IVA)', 'descuento 20% (sobre total con iva)', 1, -20.8, null, 1, 1),
    -- Makro: promoción sin artículo
    (60, 6, 'QSO CREMA CB MC 5KG', 'qso crema cb mc 5kg', 1, 51.2, null, 1, 0),
    (61, 6, 'COMPRA MAS PAGA MENOS (DT 90719)', 'compra mas paga menos (dt 90719)', -1, -1.2, null, 3, 1),
    -- Abono: no se toca
    (70, 7, 'RAPPEL BARRIL', 'rappel barril', -1, -40, null, 1, 0);
`);

const sumaPorDoc = async () => (await db.query(`
  select factura_id f, sum(total)::text bruto, sum(coalesce(importe_neto, total))::text neto
    from productos_factura group by 1 order by 1`)).rows;
const neto = async (id) => {
  const r = (await db.query(`select importe_neto from productos_factura where id = $1`, [id])).rows[0];
  return r.importe_neto === null ? null : Number(r.importe_neto);
};
const reparto = async () => (await db.query(`
  select descuento_linea_id d, linea_id l, importe::text i, regla from productos_factura_descuentos order by 1, 2`)).rows;

const auditoriaAntes = Number((await db.query(`select count(*) n from auditoria`)).rows[0].n);
await db.exec(MIGRACION);
igual(Number((await db.query(`select count(*) n from auditoria`)).rows[0].n), auditoriaAntes, "el relleno no apunta auditoría");
igual(Number((await db.query(`select count(*) n from pg_trigger where tgname = 'trg_auditoria' and tgenabled = 'O'`)).rows[0].n), 1, "la auditoría vuelve a quedar encendida");

const r1 = await reparto();
igual(r1.filter((r) => r.d === 11 || r.d === 13 || r.d === 15).map((r) => [r.d, r.l, r.i, r.regla]),
  [[11, 10, "-80.00", "nombre"], [13, 12, "-100.00", "nombre"], [15, 14, "-160.00", "nombre"]],
  "Catral: cada descuento a su producto, dentro de su albarán");
igual(r1.filter((r) => r.d === 22).map((r) => [r.l, r.i, r.regla]), [[20, "-150.00", "pie"], [21, "-100.00", "pie"]],
  "Riscal: el 20 % del pie se reparte en proporción");
igual(r1.filter((r) => r.d === 31).map((r) => [r.l, r.i, r.regla]), [[30, "-15.80", "pct_linea"]], "Disjover: 5 % de la línea anterior");
igual(r1.filter((r) => r.d === 41).map((r) => [r.l, r.i, r.regla]), [[40, "-60.00", "linea_anterior"]], "Negociants: línea anterior");
igual(r1.filter((r) => r.d === 51).map((r) => [r.l, r.i, r.regla]), [[50, "-20.80", "pie_con_iva"]], "Virola: 20 % sobre el total con IVA");
igual(r1.some((r) => r.d === 61), false, "Makro: la promoción sin artículo se queda sin asociar");
igual(r1.some((r) => r.d === 70 || r.l === 70), false, "un abono no se toca");

igual([await neto(10), await neto(11), await neto(12), await neto(16), await neto(61)], [120, 0, 100, null, null],
  "importe_neto: producto con su descuento, descuento repartido a 0, el resto igual");
igual((await sumaPorDoc()).every((r) => Number(r.bruto) === Number(r.neto)), true, "por documento la suma no cambia");

// Reparto manual: se respeta al recalcular.
await db.exec(`
  insert into facturas values (8, 100);
  insert into productos_factura (id, factura_id, nombre, nombre_busqueda, cantidad, total, pagina, orden) values
    (80, 8, 'COCA COLA 350', 'coca cola 350', 24, 30, 1, 0),
    (81, 8, 'FANTA 350', 'fanta 350', 24, 30, 1, 1),
    (82, 8, 'PROMOCION ESPECIAL', 'promocion especial', 1, -6, 1, 2);
`);
igual(await neto(82), null, "un descuento sin regla clara se queda sin asociar");
await db.exec(`insert into productos_factura_descuentos (descuento_linea_id, linea_id, importe, regla) values (82, 80, -6, 'manual')`);
await db.exec(`select facturas_asociar_descuentos(array[8]::bigint[])`);
igual([await neto(80), await neto(82)], [24, 0], "el reparto manual cuenta y se respeta al recalcular");

// Trigger: insertar, cambiar y borrar.
await db.exec(`
  insert into facturas values (9, 100);
  insert into productos_factura (id, factura_id, nombre, nombre_busqueda, cantidad, total, pagina, orden) values
    (90, 9, 'AMSTEL ORO 0% 1/3 * 24', 'amstel oro 0% 1/3 * 24', 2, 80, 1, 0),
    (91, 9, 'DESC. AMSTEL ORO 0% 1/3 * 24', 'desc. amstel oro 0% 1/3 * 24', 2, -30, 1, 1);
`);
igual([await neto(90), await neto(91)], [50, 0], "al insertar la factura se asocia sola");
await db.exec(`update productos_factura set total = -20 where id = 91`);
igual(await neto(90), 60, "al corregir el importe del descuento se recalcula");
await db.exec(`delete from productos_factura where id = 91`);
igual(await neto(90), null, "al borrar el descuento el producto vuelve a su importe");

const antesDeRepetir = { reparto: await reparto(), sumas: await sumaPorDoc() };
await db.exec(MIGRACION);
igual({ reparto: await reparto(), sumas: await sumaPorDoc() }, antesDeRepetir, "aplicada dos veces da lo mismo");

await db.exec(ROLLBACK);
igual((await db.query(`select to_regclass('public.productos_factura_descuentos') t,
  (select count(*) from information_schema.columns where table_name = 'productos_factura' and column_name = 'importe_neto')::int c,
  (select count(*) from pg_trigger where tgname like 'trg_productos_factura_descuentos%')::int g`)).rows[0],
  { t: null, c: 0, g: 0 }, "el rollback quita tabla, columna y triggers");

console.log(`OK descuentos-asociados: ${comprobaciones} comprobaciones`);
