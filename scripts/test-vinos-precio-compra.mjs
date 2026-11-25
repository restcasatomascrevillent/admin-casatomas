// «Precio de compra de los vinos» (migración 20261222140000), contra un Postgres en memoria
// (PGlite). Nunca toca Supabase.
//
//   npm run test:vinos-precio-compra:db
//
// vinos_coste_carta_datos (el cruce factura → vino de Márgenes, con sus propias pruebas en
// test-coste-carta-vinos.mjs) es aquí un stub que devuelve lo que pone cada prueba en _stub_coste.
// Cubre: el volcado a la tabla (precio sin y con IVA, coste efectivo, IVA supuesto 21 %, proveedor y
// factura), que solo cambia actualizado_en si cambia algo, qué filas se borran (sin compra, desenlazado)
// y cuáles se conservan (fuera del análisis y con el mismo enlace); los disparadores (solo apuntan si la
// línea o la factura es de un vino); el cron (espera a que acabe la carga, recalcula y vacía la cola);
// la lectura solo para quien edita la carta (y nada para anon); idempotencia y rollback.
import { PGlite } from "@electric-sql/pglite";
import { readFile } from "node:fs/promises";
import assert from "node:assert/strict";

const MIG = await readFile("supabase/migrations/20261222140000_vinos_precio_compra.sql", "utf8");
const RB = await readFile("supabase/rollbacks/20261222140000_vinos_precio_compra_ROLLBACK.sql", "utf8");

let comprobaciones = 0;
const ok = (v, msg) => { assert.ok(v, msg); comprobaciones++; };
const igual = (a, b, msg) => { assert.deepEqual(a, b, msg); comprobaciones++; };
const cerca = (a, b, msg) => { assert.ok(a !== null && a !== undefined && Math.abs(Number(a) - Number(b)) < 0.006, `${msg}: ${a} ≠ ${b}`); comprobaciones++; };

const db = new PGlite();
const q = (sql, p) => db.query(sql, p);
await db.exec(`
  create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
  create schema auth; create schema extensions;
  create function auth.uid() returns uuid language sql stable as $$ select null::uuid $$;
  -- Permiso: «Editar» en la carta según test.editar_carta.
  create function public.can_write_section(p text) returns boolean language sql stable security definer as $$
    select p = 'gestor_carta' and coalesce(current_setting('test.editar_carta', true), '') = 'si' $$;
  grant execute on function public.can_write_section(text) to authenticated;

  create schema cron;
  create table cron.job (jobid bigserial primary key, jobname text unique, schedule text, command text);
  create function cron.schedule(n text, s text, c text) returns bigint language sql as
    $$ insert into cron.job (jobname, schedule, command) values (n, s, c) returning jobid $$;
  create function cron.unschedule(n text) returns boolean language sql as
    $$ delete from cron.job where jobname = n returning true $$;
  insert into cron.job (jobname, schedule, command) values ('otro', '0 3 * * *', 'select 1');

  create table public."Vinos" (id text primary key, nombre text, precio_eur double precision,
    activado boolean default true, restaurante boolean default true, descripcion text);
  create table public.productos_catalogo (id bigint primary key, nombre text);
  create table public.vino_producto (vino_id text primary key references public."Vinos"(id) on delete cascade,
    producto_id bigint not null, origen text not null default 'manual');
  create table public.facturas (id bigint primary key, fecha date, total numeric, local text, tipo text default 'factura',
    facturado_en_id bigint, verificada boolean default false);
  create table public.productos_factura (id bigserial primary key,
    factura_id bigint references public.facturas(id) on delete cascade, producto_id bigint, nombre text,
    cantidad numeric, unidad text, precio_unitario numeric, total numeric, importe_neto numeric, iva_pct numeric,
    contenido_cantidad numeric, contenido_unidad text, revisada boolean default false);

  -- Stub del cruce de Márgenes: lo que haya en _stub_coste.
  create table public._stub_coste (j jsonb not null);
  create table public._stub_llamadas (meses integer, margenes jsonb);
  create function public.vinos_coste_carta_datos(p_hoy date default null, p_meses integer default null, p_margenes jsonb default null)
  returns jsonb language plpgsql as $$
  begin
    insert into public._stub_llamadas values (p_meses, p_margenes);
    return (select j from public._stub_coste limit 1);
  end $$;

  insert into public."Vinos" (id, nombre, precio_eur, activado) values
    ('lagar', 'Lagar de Cervera 2024', 21.9, true), ('ardanza', 'Viña Ardanza', 42.5, true),
    ('sinfactura', 'Sin factura', 30, true), ('oculto', 'Vino oculto', 50, false), ('plato', 'Sin enlace', 20, true);
  insert into public.productos_catalogo values (1772, 'Lagar de Cervera 75 cl'), (2, 'Viña Ardanza 75 cl'),
    (3, 'Vino oculto 75 cl'), (99, 'Pan');
  insert into public.vino_producto values ('lagar', 1772, 'estimado'), ('ardanza', 2, 'manual'), ('oculto', 3, 'manual');
  insert into public.facturas (id, fecha, total) values (2323, current_date - 50, 5257.03), (500, current_date - 10, 900), (7, current_date - 3, 14);
  insert into public.productos_factura (factura_id, producto_id, nombre, cantidad, total) values
    (2323, 1772, 'LAGAR CERVERA', 15, 171.75), (500, 2, 'ARDANZA', 60, 900), (7, 99, 'PAN', 10, 14);
`);

const vino = (id, extra = {}) => ({
  id, estado: "bien", avisos: [], producto_id: null, producto: null, coste_factura: null, coste_efectivo: null,
  iva_compra_pct: null, botellas_pagadas: null, botellas_sin_cargo: 0, factura: null, ...extra,
});
const LAGAR = vino("lagar", {
  estado: "bajo", producto_id: 1772, producto: "Lagar de Cervera 75 cl", coste_factura: 11.45, coste_efectivo: 9.5417,
  iva_compra_pct: 21, botellas_pagadas: 15, botellas_sin_cargo: 3,
  factura: { id: 2323, linea_id: 14182, fecha: "2026-09-30", proveedor: "Distribuciones Guillén, S.L.", proveedor_id: 217,
    numero_documento: "002111F2", tipo: "factura", nombre_linea: "LAGAR CERVERA ALBARIÑO 75CL", iva_pct: 21, iva_origen: "linea" },
});
// IVA desconocido (Márgenes supone 10 %): para vino, 21 %.
const ARDANZA = vino("ardanza", {
  producto_id: 2, producto: "Viña Ardanza 75 cl", coste_factura: 15.2, coste_efectivo: 15.2, iva_compra_pct: 10,
  botellas_pagadas: 60, avisos: ["anada_distinta"],
  factura: { id: 500, linea_id: 9, fecha: "2026-11-15", proveedor: "Vinos del Mundo", proveedor_id: 3, numero_documento: "A-1",
    tipo: "albaran", nombre_linea: "ARDANZA", iva_pct: 10, iva_origen: "supuesto" },
});
const SIN_FACTURA = vino("sinfactura", { estado: "sin_enlazar" });
const PLATO = vino("plato", { estado: "sin_enlazar" });
const datos = (vinos) => ({ hoy: "2026-11-25", meses: null, config: { iva_pct: 10, multiplicador_min_vino: 2.3 }, vinos });
const ponerCoste = async (vinos) => {
  await q(`delete from public._stub_coste`);
  await q(`insert into public._stub_coste values ($1::jsonb)`, [JSON.stringify(datos(vinos))]);
};
const tabla = async () => Object.fromEntries((await q(`select * from public.vinos_precio_compra order by vino_id`)).rows.map((r) => [r.vino_id, r]));
const cola = async () => (await q(`select count(*)::int n from public.vinos_precio_compra_cola`)).rows[0].n;
const vaciarCola = () => q(`delete from public.vinos_precio_compra_cola`);

// ─── 1. Aplicar (dos veces: reaplicable) y rellenado inicial ────────────────
// Fila que ya existiera de un vino oculto (fuera del análisis) de otra pasada: se conserva.
await ponerCoste([LAGAR, ARDANZA, SIN_FACTURA, PLATO, vino("oculto", { producto_id: 3, producto: "Vino oculto 75 cl",
  coste_factura: 20, coste_efectivo: 20, iva_compra_pct: 21, factura: { id: 7, iva_origen: "linea", proveedor: "X", fecha: "2026-01-01" } })]);
await db.exec(MIG);
await ponerCoste([LAGAR, ARDANZA, SIN_FACTURA, PLATO]); // «oculto» ya no sale en el análisis (desactivado)
await db.exec(MIG);
{
  const t = await tabla();
  igual(Object.keys(t), ["ardanza", "lagar", "oculto"], "rellenado inicial: los vinos con compra (y el oculto, que sigue enlazado al mismo producto)");
  const l = t.lagar;
  cerca(l.precio_compra, 11.45, "Lagar: precio de factura sin IVA");
  cerca(l.precio_compra_iva, 13.85, "Lagar: con IVA 21 % = 13,85");
  cerca(l.coste_efectivo, 9.5417, "Lagar: coste efectivo (con 3 sin cargo)");
  cerca(l.coste_efectivo_iva, 11.55, "Lagar: coste efectivo con IVA");
  igual([Number(l.iva_pct), l.iva_origen], [21, "linea"], "Lagar: IVA de la línea");
  igual([l.proveedor, Number(l.factura_id), Number(l.linea_id), l.numero_documento, l.fecha.toISOString().slice(0, 10)],
    ["Distribuciones Guillén, S.L.", 2323, 14182, "002111F2", "2026-09-30"], "Lagar: proveedor y factura de origen");
  igual([Number(l.producto_id), l.estado, Number(l.botellas_sin_cargo)], [1772, "bajo", 3], "Lagar: producto, estado y sin cargo");
  igual([Number(l.iva_venta_pct), Number(l.multiplicador_min)], [10, 2.3], "config de Márgenes para el multiplicador");
  const a = t.ardanza;
  igual([Number(a.iva_pct), a.iva_origen], [21, "supuesto"], "Ardanza: IVA desconocido → 21 % (vino), marcado como supuesto");
  cerca(a.precio_compra_iva, 18.39, "Ardanza: 15,20 × 1,21");
  igual([a.tipo_documento, a.avisos], ["albaran", ["anada_distinta"]], "Ardanza: albarán y avisos de Márgenes");
  igual((await q(`select meses from public._stub_llamadas order by ctid desc limit 1`)).rows[0].meses, null, "usa la última factura (sin meses)");
  const jobs = Object.fromEntries((await q(`select jobname, schedule, command from cron.job`)).rows.map((r) => [r.jobname, r]));
  igual(jobs["vinos-precio-compra"].schedule, "* * * * *", "cron cada minuto");
  ok(/statement_timeout = '30s'/.test(jobs["vinos-precio-compra"].command) && /vinos_precio_compra_refrescar_pendiente\(\)/.test(jobs["vinos-precio-compra"].command), "cron: tope de 30 s y función de pendientes");
  ok(/vinos_precio_compra_refrescar\(\)/.test(jobs["vinos-precio-compra-diario"].command), "cron diario de seguridad");
  igual(jobs.otro.command, "select 1", "no toca otros crons");
  igual((await q(`select count(*)::int n from cron.job where jobname like 'vinos-precio-compra%'`)).rows[0].n, 2, "reaplicar no duplica crons");
}

// ─── 2. Recalcular: solo cambia lo que cambia; borra lo que ya no vale ──────
{
  const antes = await tabla();
  await new Promise((r) => setTimeout(r, 20));
  let r = (await q(`select public.vinos_precio_compra_refrescar() r`)).rows[0].r;
  igual([r.cambiadas, r.borradas, r.filas], [0, 0, 3], "sin cambios: no reescribe nada");
  igual((await tabla()).lagar.actualizado_en.getTime(), antes.lagar.actualizado_en.getTime(), "sin cambios: actualizado_en igual");

  // Nueva factura de Lagar a 12 € → cambia esa fila.
  await ponerCoste([{ ...LAGAR, coste_factura: 12, coste_efectivo: 12, botellas_sin_cargo: 0, factura: { ...LAGAR.factura, id: 3000, fecha: "2026-11-20" } }, ARDANZA, SIN_FACTURA, PLATO]);
  r = (await q(`select public.vinos_precio_compra_refrescar() r`)).rows[0].r;
  igual(r.cambiadas, 1, "solo cambia Lagar");
  const t = await tabla();
  cerca(t.lagar.precio_compra_iva, 14.52, "Lagar: nuevo precio con IVA 12 × 1,21");
  igual(Number(t.lagar.factura_id), 3000, "Lagar: nueva factura de origen");
  ok(t.lagar.actualizado_en > antes.lagar.actualizado_en, "Lagar: actualizado_en avanza");
  igual(t.ardanza.actualizado_en.getTime(), antes.ardanza.actualizado_en.getTime(), "Ardanza: intacta");

  // Ardanza pierde su compra (p. ej. se borra la factura) → fuera. Oculto se desenlaza → fuera.
  await ponerCoste([LAGAR, { ...ARDANZA, coste_factura: null, coste_efectivo: null, estado: "sin_compra", factura: null }, SIN_FACTURA, PLATO]);
  await q(`delete from public.vino_producto where vino_id = 'oculto'`);
  r = (await q(`select public.vinos_precio_compra_refrescar() r`)).rows[0].r;
  igual(Object.keys(await tabla()), ["lagar"], "sin compra o desenlazado: se borra");
  igual(r.borradas, 2, "dos borradas");
  // Un vino que se borra de la carta se lleva su fila.
  await ponerCoste([LAGAR, ARDANZA]);
  await q(`select public.vinos_precio_compra_refrescar()`);
  await q(`insert into public."Vinos" (id, nombre, precio_eur) values ('borrar', 'Para borrar', 10)`);
  await q(`insert into public.vinos_precio_compra (vino_id, precio_compra, iva_pct) values ('borrar', 5, 21)`);
  await q(`delete from public."Vinos" where id = 'borrar'`);
  igual(Object.keys(await tabla()), ["ardanza", "lagar"], "borrar el vino borra su precio de compra");
}

// ─── 3. Disparadores: solo apuntan cuando toca ──────────────────────────────
{
  await vaciarCola();
  await q(`insert into public.productos_factura (factura_id, producto_id, nombre, cantidad, total) values (7, 99, 'PAN', 5, 7)`);
  igual(await cola(), 0, "línea de un producto que no es vino: no apunta");
  await q(`update public.productos_factura set revisada = true where producto_id = 1772`);
  igual(await cola(), 0, "cambiar un campo que no afecta al precio: no apunta");
  await q(`update public.productos_factura set total = 7.5 where producto_id = 99`);
  igual(await cola(), 0, "cambiar el precio del pan: no apunta");
  await q(`insert into public.productos_factura (factura_id, producto_id, nombre, cantidad, total) values (500, 1772, 'LAGAR', 6, 72)`);
  igual(await cola(), 1, "línea nueva de un vino: apunta (una vez por sentencia)");
  await q(`insert into public.productos_factura (factura_id, producto_id, nombre, cantidad, total) values (7, 2, 'A', 1, 15), (7, 2, 'B', 1, 15), (7, 99, 'PAN', 1, 1)`);
  igual(await cola(), 2, "varias líneas en una sentencia: un solo apunte");
  await q(`update public.productos_factura set total = 80 where nombre = 'LAGAR'`);
  igual(await cola(), 3, "cambiar el importe de una línea de vino: apunta");
  await q(`update public.productos_factura set producto_id = 99 where nombre = 'A'`);
  igual(await cola(), 4, "una línea deja de ser del vino: apunta");
  await q(`delete from public.productos_factura where nombre = 'B'`);
  igual(await cola(), 5, "borrar una línea de vino: apunta");
  await q(`delete from public.productos_factura where nombre = 'PAN' and total = 7.5`);
  igual(await cola(), 5, "borrar una línea de pan: no apunta");
  await vaciarCola();
  await q(`update public.facturas set verificada = true where id = 2323`);
  igual(await cola(), 0, "verificar una factura: no apunta");
  await q(`update public.facturas set fecha = fecha - 1 where id = 2323`);
  igual(await cola(), 1, "cambiar la fecha de una factura con vinos: apunta");
  await q(`delete from public.productos_factura where factura_id = 7 and producto_id = 2`);
  await vaciarCola();
  await q(`update public.facturas set local = 'touza' where id = 7`);
  igual(await cola(), 0, "cambiar una factura sin vinos: no apunta");
  await q(`delete from public.facturas where id = 500`);
  ok(await cola() >= 1, "borrar una factura con vinos (borra sus líneas): apunta");
  await vaciarCola();
  await q(`insert into public.vino_producto values ('sinfactura', 2, 'manual')`);
  igual(await cola(), 1, "enlazar un vino: apunta");
  await q(`update public."Vinos" set descripcion = 'Nueva' where id = 'lagar'`);
  igual(await cola(), 1, "cambiar la descripción de un vino: no apunta");
  await q(`update public."Vinos" set precio_eur = 23 where id = 'lagar'`);
  igual(await cola(), 2, "cambiar el precio de carta: apunta");
}

// ─── 4. Cron: espera a que acabe la carga y luego recalcula ─────────────────
{
  await ponerCoste([LAGAR, ARDANZA]);
  await vaciarCola();
  igual((await q(`select public.vinos_precio_compra_refrescar_pendiente() r`)).rows[0].r.motivo, "nada", "sin apuntes: nada");
  await q(`insert into public.vinos_precio_compra_cola default values`);
  igual((await q(`select public.vinos_precio_compra_refrescar_pendiente() r`)).rows[0].r.motivo, "esperando", "apunte de hace un momento: espera");
  await q(`delete from public.vinos_precio_compra`);
  const r = (await q(`select public.vinos_precio_compra_refrescar_pendiente('0 seconds') r`)).rows[0].r;
  igual([r.hecho, r.resultado.filas], [true, 2], "pasada la espera: recalcula");
  igual(await cola(), 0, "y vacía la cola");
  await q(`insert into public.vinos_precio_compra_cola (creado) values (now() - interval '11 minutes'), (now())`);
  igual((await q(`select public.vinos_precio_compra_refrescar_pendiente() r`)).rows[0].r.hecho, true, "con apuntes de hace más de 10 min no espera más");
}

// ─── 5. Lectura: solo quien edita la carta; anon, nada; nadie escribe ───────
async function como(rol, editar, fn) {
  await db.exec("begin");
  try {
    await db.exec(`set local role ${rol}; select set_config('test.editar_carta', '${editar ? "si" : "no"}', true);`);
    return await fn();
  } finally {
    await db.exec("rollback");
  }
}
{
  igual(await como("authenticated", true, async () => (await q(`select vino_id from public.vinos_precio_compra`)).rows.length), 2, "edita la carta: lee los precios");
  igual(await como("authenticated", false, async () => (await q(`select vino_id from public.vinos_precio_compra`)).rows.length), 0, "solo «Ver» (u otra sección): no lee nada");
  await assert.rejects(como("anon", true, () => q(`select * from public.vinos_precio_compra`)), /permission denied/, "anon no tiene acceso");
  comprobaciones++;
  await assert.rejects(como("authenticated", true, () => q(`update public.vinos_precio_compra set precio_compra = 1`)), /permission denied/, "nadie escribe desde la API");
  comprobaciones++;
  await assert.rejects(como("authenticated", true, () => q(`insert into public.vinos_precio_compra_cola default values`)), /permission denied/, "la cola no es de la API");
  comprobaciones++;
  await assert.rejects(como("authenticated", true, () => q(`select public.vinos_precio_compra_refrescar()`)), /permission denied/, "recalcular no es de la API");
  comprobaciones++;
  // Un usuario cualquiera que guarda líneas de un vino sí apunta (los disparadores son security definer).
  await db.exec(`grant select, insert on public.productos_factura to authenticated; grant usage on sequence public.productos_factura_id_seq to authenticated;`);
  await vaciarCola();
  await db.exec("begin");
  await db.exec(`set local role authenticated; insert into public.productos_factura (factura_id, producto_id, nombre, cantidad, total) values (2323, 1772, 'X', 1, 10); reset role;`);
  igual(await cola(), 1, "las líneas que guarda un usuario sin acceso a la cola también apuntan");
  await db.exec("rollback");
}

// ─── 6. Rollback y reaplicar ────────────────────────────────────────────────
await db.exec(RB);
igual((await q(`select to_regclass('public.vinos_precio_compra') is null as n`)).rows[0].n, true, "rollback: sin tabla");
igual((await q(`select count(*)::int n from cron.job where jobname like 'vinos-precio-compra%'`)).rows[0].n, 0, "rollback: sin crons");
igual((await q(`select count(*)::int n from pg_trigger where tgname like 'trg_vinos_precio_compra%'`)).rows[0].n, 0, "rollback: sin disparadores");
await q(`insert into public.productos_factura (factura_id, producto_id, nombre, cantidad, total) values (2323, 1772, 'Y', 1, 10)`);
ok(true, "rollback: las líneas se guardan sin los disparadores");
await db.exec(MIG);
igual(Object.keys(await tabla()), ["ardanza", "lagar"], "reaplicar rellena la tabla otra vez");

console.log(`OK · precio de compra de los vinos: ${comprobaciones} comprobaciones`);
await db.close();
