// Prueba la migración 20261211400000_regalos_y_descuentos_positivos (sobre 20261211200000) y su
// rollback contra un Postgres en memoria (PGlite) con pg_trgm. Nunca toca Supabase.
//
//   node scripts/test-regalos-y-descuentos-positivos.mjs
//
// Casos del cotejo con los originales (docs/facturas/revision-descuentos/INFORME.md, apartado 7):
//   - Riscal «ARIENZO 2022 Sin Cargo» a 0 € → regalo; su valor sale de la línea pagada del mismo vino;
//   - botella bonificada con valor ya calculado → regalo, sin tocar el valor;
//   - pan sin valorar, envase a 0 € y servicio a 0 € → no son regalo;
//   - Catral «DESCUENTO JUDAS» en positivo bajo Judas (cobro de más) y «DESC. HEINEKEN 0'0» en
//     positivo bajo su devolución → se asocian a esa línea;
//   - lo que se inserta después se marca solo (trigger); el rollback deja todo como estaba.
import { PGlite } from "@electric-sql/pglite";
import { pg_trgm } from "@electric-sql/pglite/contrib/pg_trgm";
import { readFile } from "node:fs/promises";
import assert from "node:assert/strict";

const BASE = await readFile("supabase/migrations/20261211200000_descuentos_asociados.sql", "utf8");
const MIGRACION = await readFile("supabase/migrations/20261211400000_regalos_y_descuentos_positivos.sql", "utf8");
const ROLLBACK = await readFile("supabase/rollbacks/20261211400000_regalos_y_descuentos_positivos_ROLLBACK.sql", "utf8");

let comprobaciones = 0;
const igual = (a, b, msg) => { assert.deepEqual(a, b, msg); comprobaciones++; };

const db = new PGlite({ extensions: { pg_trgm } });
await db.exec(`
  create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
  create schema extensions;
  create extension pg_trgm with schema extensions;
  create function public.can_read_section(s text) returns boolean language sql stable as $$ select true $$;
  create table public.categorias_producto (id bigint primary key, clave text, padre_id bigint);
  create table public.productos_catalogo (id bigint primary key, categoria_id bigint);
  create table public.facturas (id bigint primary key, total numeric);
  create table public.productos_factura (
    id bigint primary key, factura_id bigint not null references public.facturas(id) on delete cascade,
    nombre text not null, nombre_busqueda text, nombre_normalizado text, cantidad numeric, precio_unitario numeric,
    total numeric, albaran_ref text, pagina smallint, orden integer, producto_id bigint,
    descuento_pct numeric, importe_bruto numeric, importe_bruto_estimado boolean not null default false);
  create table public.auditoria (n serial);
  create function public.fn_auditoria() returns trigger language plpgsql as $$ begin insert into public.auditoria default values; return null; end $$;
  create trigger trg_auditoria after insert or update or delete on public.productos_factura for each row execute function public.fn_auditoria();

  insert into categorias_producto values (1, 'bebidas', null), (12, 'bebidas.vinos', 1), (11, 'servicios', null), (7, 'panaderia', null);
  insert into productos_catalogo values (100, 12), (200, 11), (300, 7), (400, 1);
  insert into facturas values (1, 1000), (2, 500), (3, 100);
  insert into productos_factura (id, factura_id, nombre, nombre_busqueda, nombre_normalizado, cantidad, precio_unitario, total, orden, producto_id, importe_bruto) values
    -- Riscal: Arienzo pagado y «Sin Cargo»
    (10, 1, 'ARIENZO 2022', 'arienzo 2022', 'arienzo 2022', 6, 10, 60, 0, 100, null),
    (11, 1, 'ARIENZO 2022 Sin Cargo', 'arienzo 2022 sin cargo', 'arienzo 2022 sin cargo', 12, 0, 0, 1, 100, null),
    (12, 1, 'TANQUERAY 70 CL', 'tanqueray 70 cl', 'tanqueray 70 cl', 2, 0, 0, 2, 400, 30),
    (13, 1, 'PANES DE 1 KILO', 'panes de 1 kilo', 'panes de 1 kilo', 4, 2.5, 0, 3, 300, null),
    (14, 1, 'ENVASES C0SA', 'envases c0sa', 'envases c0sa', 3, 0, 0, 4, null, null),
    (16, 1, 'Jamon Bellota 100% Iberico', 'jamon bellota 100% iberico', 'jamon bellota 100% iberico', 51.85, 44.5, 2307.33, 6, 400, null),
    (17, 1, 'Jamon Bellota 100% Iberico', 'jamon bellota 100% iberico', 'jamon bellota 100% iberico', 8.72, null, null, 7, 400, null),
    (15, 1, 'Facturación por energía reactiva', 'facturacion por energia reactiva', 'facturacion por energia reactiva', 1, 0, 0, 5, 200, null),
    -- Catral: descuento en positivo bajo el producto (cobro de más) y bajo una devolución
    (20, 2, 'JUDAS 1/3 N.R. * 12', 'judas 1/3 n.r. * 12', 'judas 1/3 n.r. * 12', 3, 40.14, 120.42, 0, null, null),
    (21, 2, 'DESCUENTO JUDAS 1/3 N.R. * 12', 'descuento judas 1/3 n.r. * 12', 'descuento judas 1/3 n.r. * 12', 3, 4.94, 14.82, 1, null, null),
    (22, 2, 'HEINEKEN 0''0 % 1/3 * 24', 'heineken 0''0 % 1/3 * 24', 'heineken 0''0 % 1/3 * 24', -2, 41.76, -83.52, 2, null, null),
    (23, 2, 'DESC. HEINEKEN 0''0 % 1/3 * 24', 'desc. heineken 0''0 % 1/3 * 24', 'desc. heineken 0''0 % 1/3 * 24', 2, 16.98, 33.96, 3, null, null),
    (24, 2, 'LOTE OFERTA 12 BOTELLAS', 'lote oferta 12 botellas', 'lote oferta 12 botellas', 1, 100, 100, 4, null, null);
`);
await db.exec(BASE);

const fila = async (id) => {
  const r = (await db.query(`select descuento_pct, importe_bruto, importe_bruto_estimado, importe_neto from productos_factura where id = $1`, [id])).rows[0];
  const n = (v) => (v === null ? null : Number(v));
  return { pct: n(r.descuento_pct), bruto: n(r.importe_bruto), est: r.importe_bruto_estimado, neto: n(r.importe_neto) };
};
const antes = (await db.query(`select id, descuento_pct, importe_bruto, importe_bruto_estimado, importe_neto from productos_factura order by id`)).rows;
const auditoria0 = Number((await db.query(`select count(*) n from auditoria`)).rows[0].n);

await db.exec(MIGRACION);
igual(Number((await db.query(`select count(*) n from auditoria`)).rows[0].n), auditoria0, "el relleno no apunta auditoría");
igual(await fila(11), { pct: 100, bruto: 120, est: true, neto: null }, "Sin Cargo: regalo con el valor de la línea pagada, estimado");
igual(await fila(12), { pct: 100, bruto: 30, est: false, neto: null }, "botella con valor ya calculado: regalo, valor intacto");
igual([await fila(13), await fila(14), await fila(15)].map((f) => f.pct), [null, null, null], "pan sin valorar, envase y servicio: no son regalo");
igual([await fila(20), await fila(21)].map((f) => f.neto), [135.24, 0], "Catral: el descuento cobrado de más sube el producto");
igual([await fila(22), await fila(23)].map((f) => f.neto), [-49.56, 0], "Catral: el que deshace el descuento va con su devolución");
igual((await fila(24)).neto, null, "una línea positiva que solo dice «oferta» no se toca");
igual(await fila(17), { pct: 100, bruto: 388.04, est: true, neto: null }, "Osborne: pieza sin importe del mismo jamón pagado → regalo, valor estimado");
igual(Number((await db.query(`select count(*) n from productos_regalos_marcados_20261118`)).rows[0].n), 3, "respaldo: los 3 regalos marcados");

await db.exec(`
  insert into productos_factura (id, factura_id, nombre, nombre_busqueda, nombre_normalizado, cantidad, precio_unitario, total, orden) values
    (30, 3, 'HIBIKY HARMONY', 'hibiky harmony', 'hibiky harmony', 1, 50, 50, 0),
    (31, 3, 'HIBIKY HARMONY S/C', 'hibiky harmony s/c', 'hibiky harmony s/c', 1, 50, 0, 1);
`);
igual(await fila(31), { pct: 100, bruto: 50, est: false, neto: null }, "lo que se guarda después se marca solo (trigger)");

await db.exec(ROLLBACK);
igual((await db.query(`select id, descuento_pct, importe_bruto, importe_bruto_estimado, importe_neto from productos_factura where id < 30 order by id`)).rows,
  antes, "el rollback deja regalos y repartos como estaban");
igual((await db.query(`select to_regclass('public.productos_regalos_marcados_20261118') t`)).rows[0].t, null, "y borra el respaldo");

console.log(`OK regalos-y-descuentos-positivos: ${comprobaciones} comprobaciones`);
