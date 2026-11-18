// Prueba la migración 20261211300000_precios_con_descuentos y su rollback contra un Postgres en
// memoria (PGlite). Nunca toca Supabase.
//
//   node scripts/test-precios-con-descuentos.mjs
//
// La migración reescribe por sustitución de texto las funciones que calculan precios, costes y
// sumas por producto. Aquí se crean funciones con los mismos fragmentos que las reales (precio
// unitario, importe, precio unitario + importe del informe y de las alertas, importe del copiloto)
// y se comprueba que:
//   - sin 20261211200000 (sin importe_neto) no cambia nada;
//   - con importe_neto devuelven el precio y el importe con descuento, y sin descuento lo de antes;
//   - lo que mira el importe impreso (regalos a 0 €) no cambia;
//   - aplicada dos veces da lo mismo y el rollback deja el cuerpo exacto de antes.
import { PGlite } from "@electric-sql/pglite";
import { readFile } from "node:fs/promises";
import assert from "node:assert/strict";

const MIGRACION = await readFile("supabase/migrations/20261211300000_precios_con_descuentos.sql", "utf8");
const ROLLBACK = await readFile("supabase/rollbacks/20261211300000_precios_con_descuentos_ROLLBACK.sql", "utf8");

let comprobaciones = 0;
const igual = (a, b, msg) => { assert.deepEqual(a, b, msg); comprobaciones++; };

const db = new PGlite();
await db.exec(`
  create table public.productos_factura (id bigint primary key, cantidad numeric, precio_unitario numeric, total numeric);
  insert into productos_factura values (1, 10, 40, 400), (2, 10, 40, 400), (3, 2, 0, 0);

  -- margenes_carta_ultima: «pf.total as importe» y el precio unitario
  create function public.margenes_carta_ultima(p_ids bigint[], p_hoy date, p_dias integer)
  returns table(id bigint, importe numeric, precio numeric) language sql stable as $f$
    select pf.id, pf.total as importe,
           coalesce(pf.precio_unitario, pf.total / nullif(pf.cantidad, 0)) as precio
      from public.productos_factura pf where pf.id = any(p_ids) and pf.total > 0 and pf.cantidad > 0
  $f$;
  -- informe_precios_compras: precio unitario + importe juntos
  create function public.informe_precios_compras(p_hoy date, p_local text)
  returns table(id bigint, cantidad numeric, precio_unitario numeric, importe numeric) language sql stable as $f$
    select pf.id, pf.cantidad, pf.precio_unitario, pf.total::numeric as importe
      from public.productos_factura pf where pf.total > 0
  $f$;
  -- compras_producto_agente: importe del copiloto y regalos a 0 € por lo impreso
  create function public.compras_producto_agente(p_texto text)
  returns table(id bigint, imp numeric, regalo boolean) language sql stable as $f$
    select pf.id,
           pf.total::numeric as imp,   -- solo el importe
           pf.total = 0 and pf.cantidad > 0 as regalo
      from public.productos_factura pf
  $f$;
`);

const cuerpos = async () => (await db.query(`
  select p.proname, pg_get_functiondef(p.oid) d from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' order by 1`)).rows;
const antes = await cuerpos();

await assert.rejects(db.exec(MIGRACION), /falta 20261211200000/, "sin importe_neto se para");
comprobaciones++;
igual(await cuerpos(), antes, "y no cambia nada");

await db.exec(`
  alter table productos_factura add column importe_neto numeric;
  update productos_factura set importe_neto = 240 where id = 1;   -- 40 % de descuento asociado
`);
await db.exec(MIGRACION);

const fila = async (sql) => (await db.query(sql)).rows.map((r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, v === null ? null : (typeof v === "boolean" ? v : Number(v))])));
igual(await fila(`select * from margenes_carta_ultima(array[1,2]::bigint[], current_date, 30) order by id`),
  [{ id: 1, importe: 240, precio: 24 }, { id: 2, importe: 400, precio: 40 }], "márgenes: con descuento el neto; sin descuento, lo de antes");
igual(await fila(`select * from informe_precios_compras(current_date, null) order by id`),
  [{ id: 1, cantidad: 10, precio_unitario: 24, importe: 240 }, { id: 2, cantidad: 10, precio_unitario: 40, importe: 400 }],
  "informe y alertas: precio unitario e importe netos");
igual(await fila(`select * from compras_producto_agente('x') order by id`),
  [{ id: 1, imp: 240, regalo: false }, { id: 2, imp: 400, regalo: false }, { id: 3, imp: 0, regalo: true }],
  "copiloto: importe neto; el regalo se sigue viendo por lo impreso");

const tras = await cuerpos();
await db.exec(MIGRACION);
igual(await cuerpos(), tras, "aplicada dos veces da lo mismo");

await db.exec(ROLLBACK);
igual(await cuerpos(), antes, "el rollback deja el cuerpo exacto de antes");

console.log(`OK precios-con-descuentos: ${comprobaciones} comprobaciones`);
