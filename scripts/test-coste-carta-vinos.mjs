// «Coste de la carta de vinos» (migración 20261207150000), contra un Postgres en
// memoria (PGlite). Nunca toca Supabase.
//
//   npm run test:coste-carta-vinos:db
//
// Estado de partida: las funciones REALES de las que parte (margenes_carta_ultima y
// margenes_carta_datos de 20261128140000, margenes_gramos_venta de 20261115200000,
// margenes_carta de 20261125100000) sobre tablas mínimas. volumen_linea,
// unidad_agente, envase_texto, tienda_precio_venta, _factura_agente y los permisos
// son stubs sencillos (su lógica real tiene sus propias pruebas).
//
// Cubre: el coste efectivo (botellas sin cargo de la última factura, cajas pasadas a
// botellas, sin cargo de otras facturas que no cuentan, y la variante de N meses); el
// formato (magnum frente a 75 cl: revisar y sin multiplicador); los datos dudosos
// (coste mayor que la carta, precio por caja, salto de precio); la añada distinta; el
// estado de cada vino y el resumen; el precio sugerido y el margen por copa; los
// candidatos por nombre (solo vinos, con su última compra y el aviso de dudoso); el
// chat (margenes_carta_agente con el mismo coste); permisos, idempotencia y rollback.
import { PGlite } from "@electric-sql/pglite";
import { pg_trgm } from "@electric-sql/pglite/contrib/pg_trgm";
import { readFile } from "node:fs/promises";
import assert from "node:assert/strict";

const leer = (f) => readFile(f, "utf8");
const MIG = await leer("supabase/migrations/20261207150000_coste_carta_vinos.sql");
const RB = await leer("supabase/rollbacks/20261207150000_coste_carta_vinos_ROLLBACK.sql");
const MIG2 = await leer("supabase/migrations/20261208213000_margenes_vinos_coste_efectivo.sql");
const RB2 = await leer("supabase/rollbacks/20261208213000_margenes_vinos_coste_efectivo_ROLLBACK.sql");
const M_ULTIMA = await leer("supabase/migrations/20261128140000_margenes_ultima_factura.sql");
const M_ANALISIS = await leer("supabase/migrations/20261115200000_analisis_margenes_carta.sql");
const M_SIN_IVA = await leer("supabase/migrations/20261125100000_margenes_sin_iva_tienda.sql");

function trozo(texto, inicio, fin) {
  const i = texto.indexOf(inicio);
  assert.ok(i >= 0, `No encuentro «${inicio}»`);
  const j = texto.indexOf(fin, i);
  assert.ok(j >= 0, `No encuentro el final de «${inicio}»`);
  return texto.slice(i, j + fin.length);
}
const funcion = (texto, nombre) => trozo(texto, `create or replace function public.${nombre}`, "\n$$;");

let comprobaciones = 0;
const ok = (v, msg) => { assert.ok(v, msg); comprobaciones++; };
const igual = (a, b, msg) => { assert.deepEqual(a, b, msg); comprobaciones++; };
const cerca = (a, b, msg) => { assert.ok(a !== null && a !== undefined && Math.abs(Number(a) - Number(b)) < 0.006, `${msg}: ${a} ≠ ${b}`); comprobaciones++; };

const db = new PGlite({ extensions: { pg_trgm } });
await db.exec(`
  create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
  create schema auth; create schema extensions;
  create extension pg_trgm with schema extensions;
  create function auth.uid() returns uuid language sql stable as $$ select null::uuid $$;
  create function auth.role() returns text language sql stable as $$ select current_setting('test.rol', true) $$;
  create function public.can_read_section(p text) returns boolean language sql stable as $$
    select coalesce(current_setting('test.ver_facturas', true), '') = 'si' $$;

  create table public.categorias_producto (id bigserial primary key, nombre text, clave text);
  create table public.proveedores (id bigserial primary key, nombre text);
  create table public.productos_catalogo (id bigserial primary key, nombre text not null, categoria_id bigint,
    envase_cantidad numeric, envase_unidad text, envases_por_bulto numeric);
  create table public.facturas (id bigserial primary key, tipo text not null default 'factura', proveedor text,
    proveedor_id bigint, numero_documento text, fecha date, subtotal numeric, iva numeric, total numeric, local text,
    facturado_en_id bigint, drive_url text, archivo_path text);
  create table public.productos_factura (id bigserial primary key, factura_id bigint references public.facturas(id),
    producto_id bigint, nombre text, cantidad numeric, unidad text, precio_unitario numeric, total numeric,
    contenido_cantidad numeric, contenido_unidad text, iva_pct numeric);
  create table public."Platos" (id text primary key, nombre text, categoria text, precio_eur numeric, unidad text,
    orden int not null default 0, activado boolean not null default true, restaurante boolean default true);
  create table public."Vinos" (id text primary key, nombre text, categoria text, precio_eur numeric, precio_copa_eur numeric,
    copeo boolean default false, anada smallint, sin_anada boolean default false,
    orden int not null default 0, activado boolean not null default true, restaurante boolean default true);
  create table public.historial_ajustes_precios (id bigserial primary key, tipo_carta text, snapshot jsonb, fecha timestamptz not null default now());
  create table public.configuracion_tienda (id boolean primary key default true, activa boolean, descuento_pct numeric, vinos_excluidos text[]);
  create table public.margenes_carta_config (id boolean primary key default true check (id),
    coste_max_plato_pct numeric(5,2) not null default 35, multiplicador_min_vino numeric(5,2) not null default 2.3,
    subida_coste_pct numeric(5,2) not null default 10, iva_pct numeric(5,2) not null default 10,
    dias_referencia integer not null default 90, multiplicador_min_peso numeric(5,2) not null default 2,
    iva_tienda_pct numeric(5,2) not null default 21, multiplicador_min_tienda numeric(5,2) not null default 1.5,
    updated_at timestamptz not null default now(), updated_by uuid);
  create table public.escandallo_platos (id bigint generated always as identity primary key,
    plato_id text not null references public."Platos"(id) on delete cascade, producto_id bigint not null,
    cantidad numeric(12,4) not null, unidad text not null, origen text not null default 'manual', nota text,
    orden smallint not null default 0, updated_at timestamptz not null default now(), updated_by uuid);
  create table public.vino_producto (vino_id text primary key, producto_id bigint not null,
    origen text not null default 'manual', nota text, updated_at timestamptz not null default now(), updated_by uuid);
  create table public.margenes_carta_revision (tipo text not null, articulo_id text not null,
    revisado boolean not null default false, sin_mapear_motivo text, updated_at timestamptz not null default now(),
    updated_by uuid, primary key (tipo, articulo_id));

  -- Stubs.
  create function public._norm_agente(t text) returns text language sql immutable as $$
    select lower(translate(coalesce(t, ''), 'ÁÉÍÓÚÜÑáéíóúüñ', 'AEIOUUNaeiouun')) $$;
  create function public._factura_agente(f jsonb) returns jsonb language sql immutable as $$ select f $$;
  create function public.unidad_agente(p text) returns text language sql immutable as $$
    select case lower(btrim(coalesce(p, ''))) when 'kg' then 'kg' when 'l' then 'l'
                when 'botella' then 'botella' when 'caja' then 'caja' else 'ud' end $$;
  -- Litros de la línea: envase del catálogo × cantidad (× envases por bulto si viene por caja).
  create function public.volumen_linea(p_nombre text, p_unidad text, p_cantidad numeric, p_precio numeric,
    p_cont_cant numeric, p_cont_ud text, p_env_cant numeric, p_env_ud text, p_env_bulto numeric, p_max numeric)
  returns table (medida text, por_unidad numeric, cantidad_base numeric, envases numeric, metodo text)
  language sql immutable as $$
    select p_env_ud, p_env_cant,
           p_cantidad * p_env_cant * case when lower(p_unidad) = 'caja' then coalesce(p_env_bulto, 1) else 1 end,
           null::numeric, 'envase'::text
     where p_env_ud = 'l' and p_env_cant > 0 $$;
  create function public.volumen_max_eur_litro(p text) returns numeric language sql immutable as $$ select null::numeric $$;
  create function public.envase_texto(p text) returns table (volumen numeric, unidad text, unidades numeric)
    language sql immutable as $$ select 1.5::numeric, 'l'::text, 1::numeric where p ~* 'magnum' $$;
  create function public.tienda_precio_venta(p numeric, d numeric) returns numeric language sql immutable as $$
    select round(p * (1 - d / 100), 2) $$;
`);

// ─── Funciones de las que parte (las reales) ────────────────────────────────
await db.exec(funcion(M_ANALISIS, "margenes_gramos_venta"));
await db.exec(funcion(M_ULTIMA, "margenes_carta_ultima"));
await db.exec(funcion(M_ULTIMA, "margenes_carta_datos"));
await db.exec(funcion(M_SIN_IVA, "margenes_carta(p_hoy"));

// ─── Datos (fechas relativas a hoy) ─────────────────────────────────────────
await db.exec(`
  insert into public.margenes_carta_config (id) values (true);
  insert into public.configuracion_tienda values (true, false, 30, '{}');
  insert into public.categorias_producto (nombre) values ('Vinos'), ('Panadería');
  insert into public.proveedores (nombre) values ('VINOS DEL MUNDO'), ('GUILLÉN');
  insert into public.productos_catalogo (id, nombre, categoria_id, envase_cantidad, envase_unidad, envases_por_bulto) values
    (1, 'El Sequé 75 cl', 1, 0.75, 'l', null),
    (2, 'Viña Ardanza Reserva 75 cl', 1, 0.75, 'l', null),
    (3, 'Laurent-Perrier Millésimé 75 cl', 1, 0.75, 'l', 6),
    (4, 'Godeval Cepas Vellas 75 cl', 1, 0.75, 'l', null),
    (5, 'Juan Gil Nácar', 1, null, null, null),
    (6, 'Pazo la Cuesta Mencía 75 cl', 1, 0.75, 'l', null),
    (7, 'El Nido 75 cl', 1, 0.75, 'l', null),
    (8, 'Fefiñanes 75 cl', 1, 0.75, 'l', null),
    (9, 'Vino del salto 75 cl', 1, 0.75, 'l', null),
    (10, 'Pan de cristal', 2, null, null, null),
    (11, 'El Nido Magnum', 1, 1.5, 'l', null);
  insert into public."Vinos" (id, nombre, categoria, precio_eur, precio_copa_eur, copeo, anada, orden) values
    ('seque', 'El Sequé 2022', 'TINTOS', 37, 7, true, 2022, 1),
    ('ardanza', 'Viña Ardanza', 'TINTOS', 42.5, null, false, null, 2),
    ('millesime', 'Laurent-Perrier Millésimé 2015', 'CHAMPAGNE', 110, null, false, 2015, 3),
    ('godeval-m', 'Godeval (Magnum)', 'BLANCOS', 42, null, false, null, 4),
    ('nacar', 'Juan Gil Nácar', 'TINTOS', 25, null, false, null, 5),
    ('pazo', 'Pazo la Cuesta', 'TINTOS', 28, null, false, null, 6),
    ('nido', 'El Nido 2022', 'TINTOS', 240, null, false, 2022, 7),
    ('cristal', 'Louis Roederer Cristal', 'CHAMPAGNE', 420, null, false, null, 8),
    ('fefinanes', 'Fefiñanes 2024', 'BLANCOS', 30, null, false, null, 9),
    ('salto', 'Vino del salto', 'TINTOS', 40, null, false, null, 10),
    ('sinprecio', 'Vino sin precio', 'TINTOS', 0, null, false, null, 11);
  insert into public.vino_producto (vino_id, producto_id, origen) values
    ('seque', 1, 'estimado'), ('ardanza', 2, 'manual'), ('millesime', 3, 'estimado'), ('godeval-m', 4, 'estimado'),
    ('nacar', 5, 'estimado'), ('pazo', 6, 'estimado'), ('fefinanes', 8, 'estimado'), ('salto', 9, 'estimado');
`);
const factura = async (prov, dias, lineas, extra = {}) => {
  const f = { tipo: "factura", local: null, ...extra };
  const { rows } = await db.query(
    `insert into public.facturas (tipo, proveedor, proveedor_id, numero_documento, fecha, total, local)
     values ($1, (select nombre from public.proveedores where id = $2), $2, $3, current_date - $4::int, $5, $6) returning id`,
    [f.tipo, prov, `N-${prov}-${dias}`, dias, lineas.reduce((s, l) => s + (l.total ?? 0), 0), f.local],
  );
  for (const l of lineas) {
    await db.query(
      `insert into public.productos_factura (factura_id, producto_id, nombre, cantidad, unidad, precio_unitario, total)
       values ($1, $2, $3, $4, $5, $6, $7)`,
      [rows[0].id, l.producto, l.nombre ?? "LINEA", l.cantidad, l.unidad ?? "botella", l.precio ?? null, l.total],
    );
  }
  return rows[0].id;
};
// El Sequé: 30 a 19,30 € + 6 sin cargo (con el precio de referencia y total 0) → 579 ÷ 36 = 16,0833.
const F_SEQUE = await factura(1, 10, [
  { producto: 1, nombre: "El Seque 2022 (cód. 220006)", cantidad: 30, precio: 19.3, total: 579 },
  { producto: 1, nombre: "El Seque 2022 (cód. 220006), sin cargo", cantidad: 6, precio: 19.3, total: 0 },
]);
// Una factura vieja SOLO con botellas sin cargo: no cuenta (no es la última factura con precio).
await factura(1, 200, [{ producto: 1, cantidad: 5, precio: 0, total: 0 }]);
// Ardanza: la última sin regalo (15,20 €); la de hace 100 días, 60 a 16 € + 12 sin cargo.
await factura(2, 20, [{ producto: 2, nombre: "VIÑA ARDANZA 75CL RVA.", cantidad: 60, unidad: "ud", precio: 15.2, total: 912 }]);
await factura(2, 100, [
  { producto: 2, cantidad: 60, unidad: "ud", precio: 16, total: 960 },
  { producto: 2, cantidad: 12, unidad: "ud", precio: 0, total: 0 },
]);
// Millésimé: 8 cajas de 6 (48 botellas) a 482,40 € la caja + 3 botellas sin cargo → 3.859,20 ÷ 51 = 75,6706.
await factura(1, 30, [
  { producto: 3, nombre: "C/6 MILLESIME 0,75 (EI) 2015", cantidad: 8, unidad: "caja", precio: 482.4, total: 3859.2 },
  { producto: 3, nombre: "BOT. MILLESIME LP 2015-Sin Cargo", cantidad: 3, unidad: "botella", precio: 0, total: 0 },
]);
// Godeval 75 cl enlazado al Magnum de la carta: otro formato.
await factura(1, 15, [
  { producto: 4, cantidad: 12, precio: 16.85, total: 202.2 },
  { producto: 4, cantidad: 6, precio: 0, total: 0 },
]);
// Juan Gil Nácar: una CAJA a 64,80 € guardada sin contenido → coste por caja, mayor que la carta (25 €).
await factura(2, 12, [{ producto: 5, nombre: "JUAN GIL NACAR C/6", cantidad: 1, unidad: "caja", precio: 64.8, total: 64.8 }]);
// El Nido: comprado, sin enlazar (candidato). Pan de cristal: comprado, no es vino.
await factura(2, 40, [
  { producto: 7, nombre: "EL NIDO 2022", cantidad: 6, precio: 98.5, total: 591 },
  { producto: 11, nombre: "EL NIDO MAGNUM", cantidad: 1, precio: 400, total: 400 },
  { producto: 10, nombre: "PAN CRISTAL", cantidad: 10, unidad: "ud", precio: 1.4, total: 14 },
]);
// Fefiñanes: en carta 2024, la compra es 2025.
await factura(1, 8, [{ producto: 8, nombre: "Fefiñanes 2025 (cód. 198068)", cantidad: 10, precio: 10, total: 100 }]);
// Salto de precio: 2 € la botella hace 40 días, 12 € ahora (×6).
await factura(1, 40, [{ producto: 9, cantidad: 6, precio: 2, total: 12 }]);
await factura(1, 5, [{ producto: 9, cantidad: 6, precio: 12, total: 72 }]);
// De Touza: no cuenta (ni su precio ni sus botellas sin cargo).
await factura(1, 1, [
  { producto: 1, cantidad: 10, precio: 5, total: 50 },
  { producto: 1, cantidad: 10, precio: 0, total: 0 },
], { local: "touza" });

// ─── Migración (dos veces: es idempotente) ──────────────────────────────────
await db.exec(MIG);
await db.exec(MIG);

const datos = async (meses = null) => (await db.query(`select public.vinos_coste_carta_datos(null, $1, null) as r`, [meses])).rows[0].r;
const d = await datos();
const vino = (r, id) => r.vinos.find((v) => v.id === id);

// 1. Coste efectivo con botellas sin cargo
{
  const s = vino(d, "seque");
  cerca(s.coste_factura, 19.3, "Sequé: precio de factura");
  cerca(s.coste_efectivo, 16.0833, "Sequé: coste efectivo = 579 ÷ 36");
  igual([Number(s.botellas_pagadas), Number(s.botellas_sin_cargo)], [30, 6], "Sequé: 30 pagadas + 6 sin cargo");
  cerca(s.importe_pagado, 579, "Sequé: total pagado");
  igual(Number(s.factura.id), F_SEQUE, "Sequé: la factura es la última de Casa Tomás (no la de Touza)");
  cerca(s.venta, 33.6364, "Sequé: venta sin IVA");
  cerca(s.multiplicador, 2.09, "Sequé: multiplicador con el coste efectivo");
  cerca(s.margen, 17.55, "Sequé: margen €");
  cerca(s.margen_pct, 52.2, "Sequé: margen %");
  igual(s.estado, "bajo", "Sequé: por debajo de ×2,3");
  cerca(s.precio_sugerido, 41, "Sequé: precio sugerido (40,69 → 41,00)");
  igual(s.avisos, [], "Sequé: sin avisos (añada 2022 = 2022)");
  // Copa: 6 copas por botella.
  cerca(s.copa.coste, 2.6806, "Sequé: coste de la copa");
  cerca(s.copa.venta, 6.3636, "Sequé: venta de la copa sin IVA");
  cerca(s.copa.margen, 3.68, "Sequé: margen de la copa");
  cerca(s.copa.multiplicador, 2.37, "Sequé: multiplicador de la copa");
  igual(Number(d.copas_por_botella), 6, "el supuesto de 6 copas va en la respuesta");
}
// 2. Sin regalo en la última factura: efectivo = factura
{
  const a = vino(d, "ardanza");
  cerca(a.coste_efectivo, 15.2, "Ardanza: sin botellas sin cargo, el de la factura");
  igual(Number(a.botellas_sin_cargo), 0, "Ardanza: el regalo de hace 100 días no cuenta en la última factura");
  igual(a.estado, "bien", "Ardanza: ×2,54");
  igual(a.precio_sugerido, null, "Ardanza: sin precio sugerido");
  igual(a.copa, null, "Ardanza: no se vende por copas");
}
// 3. Cajas pasadas a botellas
{
  const m = vino(d, "millesime");
  cerca(m.coste_factura, 80.4, "Millésimé: 482,40 la caja de 6 = 80,40 la botella");
  igual([Number(m.botellas_pagadas), Number(m.botellas_sin_cargo)], [48, 3], "Millésimé: 48 pagadas (8 cajas) + 3 sin cargo");
  cerca(m.coste_efectivo, 75.6706, "Millésimé: 3.859,20 ÷ 51");
  igual(m.estado, "bajo", "Millésimé: por debajo");
}
// 4. Formato
{
  const g = vino(d, "godeval-m");
  igual(g.estado, "revisar", "Godeval Magnum enlazado a 75 cl: revisar");
  ok(g.avisos.includes("formato_distinto"), "Godeval Magnum: aviso de formato");
  igual(g.multiplicador, null, "Godeval Magnum: no se compara (sin multiplicador)");
  igual(g.margen, null, "Godeval Magnum: sin margen");
  igual([Number(g.litros), Number(g.litros_producto)], [1.5, 0.75], "Godeval Magnum: 1,5 l en carta, 0,75 l comprado");
}
// 5. Datos dudosos
{
  const n = vino(d, "nacar");
  igual(n.estado, "dudoso", "Nácar: dato dudoso");
  cerca(n.coste_efectivo, 64.8, "Nácar: 64,80 € (una caja)");
  ok(n.avisos.includes("coste_mayor_que_carta") && n.avisos.includes("coste_por_caja"), "Nácar: cuesta más que la carta y es precio de caja");
  igual(n.precio_sugerido, null, "Nácar: sin precio sugerido con un dato dudoso");
  const s = vino(d, "salto");
  igual(s.estado, "dudoso", "Salto de precio: dudoso");
  igual(s.avisos, ["salto_precio"], "Salto de precio: de 2 € a 12 €");
}
// 6. Añada, sin compra, sin enlazar, sin precio
{
  const f = vino(d, "fefinanes");
  igual(f.estado, "bien", "Fefiñanes: bien (×2,73)");
  igual(f.avisos, ["anada_distinta"], "Fefiñanes: carta 2024, compra 2025");
  igual([f.anada_carta, f.anada_compra], [2024, 2025], "Fefiñanes: añadas");
  igual(vino(d, "pazo").estado, "sin_compra", "Pazo la Cuesta: enlazado, sin compras");
  igual(vino(d, "pazo").coste_efectivo, null, "Pazo la Cuesta: sin coste");
  igual(vino(d, "nido").estado, "sin_enlazar", "El Nido: sin enlazar");
  igual(vino(d, "nido").mejor_candidato, { id: 7, nombre: "El Nido 75 cl", similitud: 1 }, "El Nido: propone el producto del mismo nombre");
  igual(vino(d, "cristal").mejor_candidato, null, "Cristal: «Pan de cristal» no es vino, no se propone");
  igual(vino(d, "sinprecio").estado, "sin_precio", "sin precio en carta");
}
// 7. Resumen
{
  const r = d.resumen;
  igual([r.total, r.con_coste, r.sin_coste, r.sin_enlazar, r.sin_compra, r.sin_precio], [11, 4, 4, 2, 1, 1], "resumen: con y sin coste");
  igual([r.dudosos, r.revisar, r.por_debajo, r.anada_distinta, r.con_candidato], [2, 1, 2, 1, 1], "resumen: dudosos, revisar, por debajo");
  igual(r.con_sin_cargo, 3, "resumen: Sequé, Millésimé y Godeval traen botellas sin cargo");
  cerca(r.multiplicador_mediana, 2.315, "resumen: mediana de 1,32 · 2,09 · 2,54 · 2,73 (ni dudosos ni otro formato)");
  igual(Number(d.config.multiplicador_min_vino), 2.3, "mínimo de la configuración");
  igual(d.vinos.length, 11, "una fila por vino");
}
// 8. Últimos N meses
{
  const m6 = await datos(6);
  const a = vino(m6, "ardanza");
  cerca(a.coste_efectivo, 14.1818, "Ardanza 6 meses: (912 + 960) ÷ (60 + 60 + 12)");
  igual([Number(a.botellas_pagadas), Number(a.botellas_sin_cargo), a.facturas], [120, 12, 2], "Ardanza 6 meses: dos facturas");
  cerca(a.coste_factura, 15.2, "Ardanza 6 meses: el precio de factura sigue siendo el de la última");
  igual(m6.meses, 6, "la respuesta dice el periodo");
  igual(Number(vino(m6, "seque").botellas_sin_cargo), 6, "Sequé 6 meses: las sin cargo de hace 200 días quedan fuera");
  const m1 = await datos(1);
  cerca(vino(m1, "ardanza").coste_efectivo, 15.2, "Ardanza 1 mes: solo la última");
  igual((await datos(99)).meses, null, "un periodo fuera de 1-36 meses se ignora");
}
// 9. Con el mínimo cambiado
{
  await db.exec(`update public.margenes_carta_config set multiplicador_min_vino = 2`);
  const r = await datos();
  igual(vino(r, "seque").estado, "bien", "con mínimo ×2, el Sequé (×2,09) está bien");
  igual(r.resumen.por_debajo, 1, "con mínimo ×2 solo queda el Millésimé");
  await db.exec(`update public.margenes_carta_config set multiplicador_min_vino = 2.3`);
}
// 10. Candidatos
{
  await db.exec(`select set_config('test.ver_facturas', 'si', false)`);
  const cand = async (id) => (await db.query(`select public.vinos_coste_candidatos($1, 6) as r`, [id])).rows[0].r;
  const nido = await cand("nido");
  igual(nido.map((c) => c.id), [7, 11], "candidatos de El Nido: el de 75 cl y el magnum, por parecido");
  cerca(nido[0].coste_botella, 98.5, "candidato: coste de la última compra");
  igual([nido[0].formato_distinto, nido[1].formato_distinto], [false, true], "candidato: el magnum es otro formato");
  igual(nido[0].factura.proveedor, "GUILLÉN", "candidato: proveedor de la última compra");
  igual(nido[0].dudoso, false, "candidato: 98,50 € con carta a 240 € no es dudoso");
  igual(nido[1].dudoso, true, "candidato: 400 € con carta a 240 € (218 sin IVA) es dudoso");
  const nacar = await cand("nacar");
  igual([nacar[0].id, nacar[0].dudoso], [5, true], "candidato dudoso: cuesta más que la carta y es una caja");
  igual((await cand("ardanza"))[0].enlazado_a, null, "enlazado_a no cuenta al propio vino");
  await db.exec(`insert into public.vino_producto (vino_id, producto_id) values ('cristal', 7)`);
  igual((await cand("nido"))[0].enlazado_a, ["Louis Roederer Cristal"], "candidato: avisa si ya está enlazado a otro vino");
  await db.exec(`delete from public.vino_producto where vino_id = 'cristal'`);
  igual(await cand("cristal"), [], "sin parecidos entre los vinos: lista vacía");
  await assert.rejects(db.query(`select public.vinos_coste_candidatos('no-existe', 6)`), /El vino no existe/);
  comprobaciones++;
}
// 11. Permisos
{
  igual((await db.query(`select (public.vinos_coste_carta(null, null) -> 'resumen' ->> 'total')::int as n`)).rows[0].n, 11, "con «ver Facturas» se puede leer");
  await db.exec(`select set_config('test.ver_facturas', 'no', false)`);
  await assert.rejects(db.query(`select public.vinos_coste_carta(null, null)`), /Sin permiso/);
  await assert.rejects(db.query(`select public.vinos_coste_candidatos('nido', 6)`), /Sin permiso/);
  await db.exec(`select set_config('test.rol', 'service_role', false)`);
  ok((await db.query(`select public.vinos_coste_carta(null, 12) is not null as s`)).rows[0].s, "service_role (chat) puede leer");
  const priv = async (rol, firma) => (await db.query(`select has_function_privilege($1, $2, 'execute') as p`, [rol, firma])).rows[0].p;
  igual(await priv("authenticated", "public.vinos_coste_carta_datos(date, integer, jsonb)"), false, "la función interna no es para authenticated");
  igual(await priv("anon", "public.vinos_coste_carta(date, integer)"), false, "anon no puede");
  igual(await priv("anon", "public.vinos_coste_candidatos(text, integer)"), false, "anon no puede (candidatos)");
  igual(await priv("authenticated", "public.vinos_coste_carta(date, integer)"), true, "authenticated sí (con su permiso dentro)");
  igual(await priv("authenticated", "public.margenes_carta_agente(text, text, boolean, integer)"), false, "el chat sigue siendo solo de service_role");
  comprobaciones += 2;
}
// 12. Chat: mismo coste
{
  const ag = async (texto, vista, solo) =>
    (await db.query(`select public.margenes_carta_agente($1, $2, $3, 15) as r`, [texto, vista, solo])).rows[0].r;
  const s = (await ag("seque", "vinos", false)).vinos[0];
  cerca(s.coste_botella, 16.0833, "chat: coste_botella es el efectivo");
  cerca(s.coste_factura, 19.3, "chat: coste_factura aparte");
  igual([Number(s.botellas_sin_cargo), Number(s.botellas_pagadas)], [6, 30], "chat: botellas sin cargo y pagadas");
  igual([s.estado, s.por_debajo], ["bajo", true], "chat: estado");
  cerca(s.precio_sugerido, 41, "chat: precio sugerido");
  const todos = await ag(null, "vinos", false);
  igual(todos.vinos.map((v) => v.nombre), ["Laurent-Perrier Millésimé 2015", "El Sequé 2022", "Viña Ardanza", "Fefiñanes 2024"],
    "chat sin texto: solo los comparables, de peor a mejor (ni dudosos ni otro formato)");
  igual((await ag(null, "vinos", true)).vinos.length, 2, "chat: solo problemas = los que están por debajo");
  igual((await ag("nacar", "vinos", false)).vinos[0].estado, "dudoso", "chat por nombre: el dudoso sale, marcado");
  igual(todos.resumen.vinos, { vinos: 11, con_coste: 4, por_debajo: 2, mediana: todos.resumen.vinos.mediana, dudosos: 2, otro_formato: 1, sin_enlazar: 2, sin_compra: 1 },
    "chat: resumen de vinos con la misma cuenta que la pantalla");
  ok(/coste EFECTIVO/.test(todos.como_leer), "chat: como_leer explica el coste efectivo");
  ok((await ag(null, "peso", false)).vinos === undefined, "chat: otra vista no trae vinos");
}
// 13. Rollback
{
  await db.exec(`
    create or replace function public.margenes_carta_agente(p_texto text default null, p_vista text default null,
      p_solo_problemas boolean default false, p_limite integer default 15) returns jsonb language sql as $$ select '{}'::jsonb $$;`);
  await db.exec(RB);
  const quedan = (await db.query(`select count(*)::int as n from pg_proc where proname like 'vinos_coste_%'`)).rows[0].n;
  igual(quedan, 0, "rollback: no quedan funciones vinos_coste_*");
  const r = (await db.query(`select public.margenes_carta_agente('seque', 'vinos', false, 5) as r`)).rows[0].r;
  cerca(r.vinos[0].coste_botella, 19.3, "rollback: el chat vuelve al precio de la factura");
  igual(r.vinos[0].coste_factura, undefined, "rollback: sin los campos nuevos");
  await db.exec(MIG);
  cerca((await datos()).vinos.find((v) => v.id === "seque").coste_efectivo, 16.0833, "se puede volver a aplicar tras el rollback");
}

// ─── 14. Una sola fuente: margenes_carta_datos con el coste efectivo (20261208213000) ───
{
  // Godeval 75 cl: 12 pagadas a 16,85 € (202,20 €) + 2 sin cargo → 202,20 ÷ 14 = 14,4429 (el caso de las 12 + 2).
  await db.exec(`
    insert into public.productos_catalogo (id, nombre, categoria_id, envase_cantidad, envase_unidad) values (12, 'Godeval 75 cl', 1, 0.75, 'l');
    insert into public."Vinos" (id, nombre, categoria, precio_eur, orden) values ('godeval', 'Godeval', 'BLANCOS', 30, 12);
    insert into public.vino_producto (vino_id, producto_id, origen) values ('godeval', 12, 'estimado');`);
  await factura(1, 3, [
    { producto: 12, cantidad: 12, precio: 16.85, total: 202.2 },
    { producto: 12, cantidad: 2, precio: 0, total: 0 },
  ]);
  const antes = (await db.query(`select public.margenes_carta_datos() as r`)).rows[0].r;
  const antesVino = (id) => antes.vinos.find((v) => v.id === id);
  cerca(antesVino("godeval").coste, 16.85, "ANTES de aplicar: con la migración 20261207150000 la pestaña sigue con el precio de factura");
  await db.exec(MIG2);
  await db.exec(MIG2); // idempotente
  const m = (await db.query(`select public.margenes_carta_datos() as r`)).rows[0].r;
  const b = (await db.query(`select public.margenes_carta_datos_base() as r`)).rows[0].r;
  const v = (await db.query(`select public.vinos_coste_carta_datos(null, null, null) as r`)).rows[0].r;
  const mv = (id) => m.vinos.find((x) => x.id === id);
  const bv = (id) => b.vinos.find((x) => x.id === id);
  const vv = (id) => v.vinos.find((x) => x.id === id);

  // Con regalo (12 + 2): el coste de la pestaña «Vinos» es el efectivo; el de factura, aparte.
  cerca(bv("godeval").coste, 16.85, "base: precio de factura 16,85");
  cerca(mv("godeval").coste, 14.4429, "Godeval 12 + 2: la pestaña «Vinos» usa 202,20 ÷ 14");
  cerca(mv("godeval").coste_factura, 16.85, "Godeval: la factura queda como dato secundario");
  igual([Number(mv("godeval").botellas_sin_cargo), Number(mv("godeval").botellas_pagadas)], [2, 12], "Godeval: 2 sin cargo, 12 pagadas");
  cerca(mv("godeval").multiplicador, 1.89, "Godeval: multiplicador 27,27 ÷ 14,44 (con el precio de factura era 1,62)");
  cerca(bv("godeval").multiplicador, 1.62, "Godeval base: ×1,62 con el precio de factura");
  ok(mv("godeval").banderas.includes("multiplicador_bajo"), "Godeval: sigue por debajo de ×2,3");
  cerca(mv("godeval").coste_iva, 15.8872, "Godeval: coste con IVA = efectivo × 1,10");
  cerca(mv("godeval").margen, 12.83, "Godeval: margen con el coste efectivo");
  // Sequé (30 + 6): de «×1,74» a «×2,09»; sigue bajo ×2,3 pero ya no con el multiplicador distinto.
  cerca(bv("seque").multiplicador, 1.74, "Sequé base: ×1,74 con el precio de factura");
  cerca(mv("seque").multiplicador, 2.09, "Sequé: ×2,09 con el coste efectivo");
  // Sin regalo: idéntico a la base campo a campo (salvo las claves nuevas).
  for (const id of ["ardanza", "nacar", "fefinanes", "salto", "pazo", "nido", "cristal"]) {
    const { coste_factura, botellas_sin_cargo, botellas_pagadas, ...resto } = mv(id);
    const { ...orig } = bv(id);
    igual(resto, orig, `${id}: sin botellas sin cargo sale igual que antes`);
    igual(Number(botellas_sin_cargo), 0, `${id}: 0 sin cargo`);
  }
  // Platos, peso y config: sin cambios.
  igual(m.platos, b.platos, "platos: sin cambios");
  igual(m.peso, b.peso, "al peso: sin cambios");
  igual(m.config, b.config, "config: sin cambios");
  // Las dos RPC, vino a vino: mismo coste y mismo multiplicador (donde «Coste vinos» da multiplicador).
  let comparados = 0;
  for (const x of v.vinos) {
    if (x.coste_efectivo === null || x.coste_efectivo === undefined) continue;
    cerca(mv(x.id).coste, x.coste_efectivo, `${x.id}: mismo coste en las dos pantallas`);
    if (x.multiplicador !== null) { cerca(mv(x.id).multiplicador, x.multiplicador, `${x.id}: mismo multiplicador`); comparados++; }
    if (x.estado === "bajo") ok(mv(x.id).banderas.includes("multiplicador_bajo"), `${x.id}: «bajo» en Coste vinos = margen bajo en Vinos`);
  }
  ok(comparados >= 5, `se compararon ${comparados} vinos`);
  // Resumen de vinos recalculado con los nuevos multiplicadores.
  const rojos = m.vinos.filter((x) => x.banderas.includes("multiplicador_bajo")).length;
  igual(m.resumen.vinos.en_rojo, rojos, "resumen: en_rojo cuadra con las banderas");
  igual(m.resumen.vinos.total, b.resumen.vinos.total, "resumen: mismo total");
  // Vinos de «Coste vinos» siguen igual (el coste_factura sale del precio de factura, no del efectivo).
  cerca(vv("seque").coste_factura, 19.3, "Coste vinos: el precio de factura sigue siendo el de la factura");
  // El chat, que pasa el margenes ya corregido, tampoco duplica ni cambia el coste de factura.
  const ag = (await db.query(`select public.margenes_carta_agente('seque', 'vinos', false, 5) as r`)).rows[0].r.vinos[0];
  cerca(ag.coste_botella, 16.0833, "chat: coste efectivo");
  cerca(ag.coste_factura, 19.3, "chat: el precio de factura sigue siendo 19,30 (no el efectivo)");
  igual((await db.query(`select has_function_privilege('authenticated', 'public.margenes_carta_datos(date)', 'execute') as p`)).rows[0].p, false, "margenes_carta_datos sigue sin ser para authenticated");
  igual((await db.query(`select has_function_privilege('service_role', 'public.margenes_carta_datos_base(date)', 'execute') as p`)).rows[0].p, true, "la base es de service_role");
  // Rollback y reaplicado.
  await db.exec(RB2);
  cerca((await db.query(`select public.margenes_carta_datos() as r`)).rows[0].r.vinos.find((x) => x.id === "seque").coste, 19.3, "rollback: la pestaña vuelve al precio de factura");
  igual((await db.query(`select to_regprocedure('public.margenes_carta_datos_base(date)') is null as n`)).rows[0].n, true, "rollback: no queda la base");
  await db.exec(MIG2);
  cerca((await db.query(`select public.margenes_carta_datos() as r`)).rows[0].r.vinos.find((x) => x.id === "seque").coste, 16.0833, "se puede volver a aplicar");
}

console.log(`OK · coste de la carta de vinos: ${comprobaciones} comprobaciones`);
await db.close();
