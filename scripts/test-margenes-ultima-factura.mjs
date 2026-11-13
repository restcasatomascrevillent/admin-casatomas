// Márgenes con el precio de la ÚLTIMA factura (migración 20261128140000), contra un
// Postgres en memoria (PGlite). Nunca toca Supabase.
//
//   npm run test:margenes-ultima-factura:db
//
// Estado de partida: las funciones REALES de antes (margenes_carta_costes y
// margenes_gramos_venta de 20261115200000, margenes_carta_iva y margenes_carta_datos
// de 20261125100000, margenes_num, margenes_avisos_estado y margenes_generar_avisos
// de 20261125110000, facturas_alertas_num de 20261107300000) sobre tablas mínimas.
// volumen_linea, unidad_agente, envase_texto y tienda_precio_venta son stubs
// sencillos (su lógica real tiene sus propias pruebas).
//
// Cubre: la última factura (fecha desc, línea desc; sin Touza, albaranes facturados,
// abonos ni fechas futuras), su precio en la unidad de compra y por kg/l, la factura
// anterior y la de hace 6 meses; la mediana en la misma pasada, igual que
// margenes_carta_costes; coste, % y multiplicador de platos, vinos y al peso
// con la última factura y la mediana aparte; banderas (sube_coste compara factura con
// factura y respeta historial_ajustes_precios); IVA de la línea usada; el aviso de
// plato con el texto nuevo y texto_telegram IGUAL que antes; que aplicar la migración
// no inunda Avisos; idempotencia, permisos y el rollback.
import { PGlite } from "@electric-sql/pglite";
import { readFile } from "node:fs/promises";
import assert from "node:assert/strict";

const leer = (f) => readFile(f, "utf8");
const MIG = await leer("supabase/migrations/20261128140000_margenes_ultima_factura.sql");
const RB = await leer("supabase/rollbacks/20261128140000_margenes_ultima_factura_ROLLBACK.sql");
const M_ANALISIS = await leer("supabase/migrations/20261115200000_analisis_margenes_carta.sql");
const M_SIN_IVA = await leer("supabase/migrations/20261125100000_margenes_sin_iva_tienda.sql");
const M_AVISOS = await leer("supabase/migrations/20261125110000_avisos_margen_bajo.sql");
const M_ALERTAS = await leer("supabase/migrations/20261107300000_facturas_alertas.sql");

/** Trozo de una migración: desde `inicio` hasta el final de `fin` (incluido). */
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
const cerca = (a, b, msg) => { assert.ok(Math.abs(Number(a) - Number(b)) < 0.006, `${msg}: ${a} ≠ ${b}`); comprobaciones++; };

const db = new PGlite();
await db.exec(`
  create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
  create schema auth;
  create function auth.uid() returns uuid language sql stable as $$ select null::uuid $$;

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
    orden int not null default 0, activado boolean not null default true, restaurante boolean default true);
  create table public.historial_ajustes_precios (id bigserial primary key, tipo_carta text, snapshot jsonb, fecha timestamptz not null default now());
  create table public.configuracion_tienda (id boolean primary key default true, activa boolean, descuento_pct numeric, vinos_excluidos text[]);
  create table public.notificaciones_dashboard (id bigserial primary key, tipo text, titulo text, mensaje text,
    referencia_tipo text, prioridad text, clave text, caduca_en timestamptz, datos jsonb, leida boolean not null default false,
    created_at timestamptz not null default now());
  create unique index notificaciones_dashboard_clave_uq on public.notificaciones_dashboard (clave) where clave is not null;

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

  -- Stubs (la lógica real de volumen, unidades y envases tiene sus propias pruebas).
  create function public.unidad_agente(p text) returns text language sql immutable as $$
    select case lower(btrim(coalesce(p, ''))) when 'kg' then 'kg' when 'kilo' then 'kg' when 'l' then 'l'
                when 'botella' then 'botella' when 'cubeta' then 'cubeta' when 'caja' then 'caja' else 'ud' end $$;
  create function public.volumen_linea(p_nombre text, p_unidad text, p_cantidad numeric, p_precio numeric,
    p_cont_cant numeric, p_cont_ud text, p_env_cant numeric, p_env_ud text, p_env_bulto numeric, p_max numeric)
  returns table (medida text, por_unidad numeric, cantidad_base numeric, envases numeric, metodo text)
  language sql immutable as $$
    select 'kg'::text, 1::numeric, p_cantidad, null::numeric, 'unidad'::text where lower(p_unidad) in ('kg', 'kilo')
    union all
    select p_env_ud, p_env_cant, p_cantidad * p_env_cant * coalesce(p_env_bulto, 1), null::numeric, 'envase'::text
     where lower(p_unidad) not in ('kg', 'kilo') and p_env_ud in ('kg', 'l') and p_env_cant > 0 $$;
  create function public.volumen_max_eur_litro(p text) returns numeric language sql immutable as $$ select null::numeric $$;
  create function public.envase_texto(p text) returns table (volumen numeric, unidad text, unidades numeric)
    language sql immutable as $$ select 1.5::numeric, 'l'::text, 1::numeric where p ~* 'magnum' $$;
  create function public.tienda_precio_venta(p numeric, d numeric) returns numeric language sql immutable as $$
    select round(p * (1 - d / 100), 2) $$;
`);

// ─── Funciones de antes (las reales) ────────────────────────────────────────
await db.exec(funcion(M_ALERTAS, "facturas_alertas_num"));
await db.exec(funcion(M_ANALISIS, "margenes_carta_costes"));
await db.exec(funcion(M_ANALISIS, "margenes_gramos_venta"));
await db.exec(funcion(M_SIN_IVA, "margenes_carta_iva"));
await db.exec(funcion(M_SIN_IVA, "margenes_carta_datos"));
await db.exec(trozo(M_AVISOS, "create table if not exists public.margenes_avisos_estado", "grant all on public.margenes_avisos_estado to service_role;"));
await db.exec(funcion(M_AVISOS, "margenes_num"));
await db.exec(funcion(M_AVISOS, "margenes_generar_avisos"));

// ─── Datos (fechas relativas a hoy: la migración se pone al día con current_date) ──
await db.exec(`
  insert into public.margenes_carta_config (id, multiplicador_min_vino) values (true, 2.6);
  insert into public.configuracion_tienda values (true, false, 30, '{}');
  insert into public.categorias_producto (nombre) values ('Mariscos'), ('Vinos');
  insert into public.proveedores (nombre) values ('MARISCOS A'), ('MARISCOS B'), ('MARISCOS C'), ('MARISCOS D'), ('BODEGA X'), ('HELADOS Y');
  insert into public.productos_catalogo (nombre, categoria_id, envase_cantidad, envase_unidad) values
    ('Percebe', 1, null, null), ('Tinto 75 cl', 2, 0.75, 'l'), ('Helado cubeta', null, null, null);
`);
const factura = async (prov, dias, lineas, extra = {}) => {
  const f = { tipo: "factura", local: null, facturado_en_id: null, subtotal: null, iva: null, ...extra };
  const total = f.total ?? lineas.reduce((s, l) => s + l.total, 0);
  const { rows } = await db.query(
    `insert into public.facturas (tipo, proveedor, proveedor_id, numero_documento, fecha, subtotal, iva, total, local, facturado_en_id, archivo_path)
     values ($1, (select nombre from public.proveedores where id = $2), $2, $3, current_date + $4::int, $5, $6, $7, $8, $9, $10) returning id`,
    [f.tipo, prov, `N-${prov}-${dias}`, -dias, f.subtotal, f.iva, total, f.local, f.facturado_en_id, `docs/${prov}-${dias}.pdf`],
  );
  for (const l of lineas) {
    await db.query(
      `insert into public.productos_factura (factura_id, producto_id, nombre, cantidad, unidad, precio_unitario, total, iva_pct)
       values ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [rows[0].id, l.producto, l.nombre ?? "LINEA", l.cantidad, l.unidad, l.total / l.cantidad, l.total, l.iva ?? null],
    );
  }
  return Number(rows[0].id);
};
// Percebe (1), por kg. Mediana de 90 días: 105, 110, 130, 120 → 115. Última: 120 (MARISCOS C, hace 10 días).
await factura(1, 200, [{ producto: 1, cantidad: 2, unidad: "kg", total: 200 }]); // hace 6 meses: 100 €/kg
await factura(1, 50, [{ producto: 1, cantidad: 1, unidad: "kg", total: 105 }]);
await factura(2, 30, [{ producto: 1, cantidad: 1, unidad: "kg", total: 110 }]);
await factura(4, 10, [{ producto: 1, cantidad: 1, unidad: "kg", total: 130 }]); // mismo día, línea anterior
const fUltimaPercebe = await factura(3, 10, [{ producto: 1, cantidad: 2, unidad: "kg", total: 240, iva: 10, nombre: "PERCEBE GALLEGO" }]);
await factura(1, 5, [{ producto: 1, cantidad: 1, unidad: "kg", total: 50 }], { local: "touza" }); // Touza: no cuenta
await factura(1, 4, [{ producto: 1, cantidad: 1, unidad: "kg", total: 60 }], { tipo: "albaran", facturado_en_id: fUltimaPercebe }); // ya facturado
await factura(1, 3, [{ producto: 1, cantidad: 1, unidad: "kg", total: 70 }], { total: -10 }); // abono
await factura(1, -5, [{ producto: 1, cantidad: 1, unidad: "kg", total: 999 }]); // fecha futura
// Tinto (2), por botella de 75 cl. Mediana: (12 + 16) / 2 = 14 €/l → 10,50 la botella. Última: 12 € (16 €/l).
await factura(5, 200, [{ producto: 2, cantidad: 6, unidad: "botella", total: 60 }]); // hace 6 meses: 10 €
await factura(5, 60, [{ producto: 2, cantidad: 12, unidad: "botella", total: 108 }]);
const fUltimaTinto = await factura(5, 15, [{ producto: 2, cantidad: 6, unidad: "botella", total: 72 }], { subtotal: 72, iva: 15.12 });
// Helado (3), por cubeta. Última: 25 € la cubeta; anterior 20 €.
await factura(6, 40, [{ producto: 3, cantidad: 1, unidad: "cubeta", total: 20 }]);
const fUltimaHelado = await factura(6, 12, [{ producto: 3, cantidad: 2, unidad: "cubeta", total: 50 }]);

await db.exec(`
  insert into public."Platos" (id, nombre, categoria, precio_eur, unidad) values
    ('percebes', 'Percebes', 'MARISCOS', 19, '100 g'),
    ('percebes-gallegos', 'Percebes gallegos', 'MARISCOS', 300, 'kg'),
    ('helado', 'Helado', 'POSTRES', 5.5, 'Unidad');
  insert into public.escandallo_platos (plato_id, producto_id, cantidad, unidad) values
    ('percebes', 1, 100, 'g'), ('percebes-gallegos', 1, 1000, 'g'), ('helado', 3, 0.1, 'ud');
  insert into public.margenes_carta_revision (tipo, articulo_id, revisado) values ('plato', 'helado', true);
  -- Subida de precio de la carta hace un mes: «Percebes gallegos» no debe marcar «sube el coste».
  insert into public.historial_ajustes_precios (tipo_carta, snapshot, fecha)
    values ('platos', '[{"id": "percebes-gallegos"}]', now() - interval '30 days');
  insert into public."Vinos" (id, nombre, categoria, precio_eur) values ('tinto', 'Tinto de la casa', 'TINTOS', 33);
  insert into public.vino_producto (vino_id, producto_id) values ('tinto', 2);
`);

const datos = async () => (await db.query(`select public.margenes_carta_datos(null) as j`)).rows[0].j;
const de = (lista, id) => lista.find((x) => x.id === id);

// ─── Antes: la mediana ──────────────────────────────────────────────────────
const antes = await datos();
cerca(de(antes.vinos, "tinto").coste, 10.5, "antes: el vino cuesta la mediana (10,50 €)");
ok(!de(antes.vinos, "tinto").banderas.includes("multiplicador_bajo"), "antes: con la mediana (2,86×) el vino no está en rojo");
await db.query(`select public.margenes_generar_avisos(current_date, true)`);

// ─── La migración (dos veces: idempotente) ──────────────────────────────────
await db.exec(MIG);
await db.exec(MIG);

const fns = (await db.query(`select proname from pg_proc where pronamespace = 'public'::regnamespace and proname like 'margenes_carta%' order by 1`)).rows.map((r) => r.proname);
ok(fns.includes("margenes_carta_ultima"), "crea margenes_carta_ultima");
const priv = (await db.query(`select has_function_privilege('authenticated', 'public.margenes_carta_ultima(bigint[],date,integer)', 'execute') a,
  has_function_privilege('anon', 'public.margenes_carta_ultima(bigint[],date,integer)', 'execute') b,
  has_function_privilege('service_role', 'public.margenes_carta_ultima(bigint[],date,integer)', 'execute') c,
  has_function_privilege('authenticated', 'public.margenes_carta_datos(date)', 'execute') d`)).rows[0];
igual([priv.a, priv.b, priv.c, priv.d], [false, false, true, false], "margenes_carta_ultima y margenes_carta_datos: solo service_role");

// margenes_carta_ultima suelta: una fila por producto (última factura base y ud, y la mediana)
const ult = (await db.query(`select *, ultima::text as ultima_txt from public.margenes_carta_ultima(array[1, 2, 3]::bigint[], current_date, 90) order by producto_id`)).rows;
const u = (p) => ult.find((r) => Number(r.producto_id) === p);
const hace = async (dias) => (await db.query(`select (current_date - $1::int)::text f`, [dias])).rows[0].f;
cerca(u(1).base_eur, 120, "percebe: la última factura es la de 120 €/kg (misma fecha: gana la línea más nueva)");
igual(u(1).base_factura.proveedor, "MARISCOS C", "percebe: proveedor de la última factura");
igual(Number(u(1).base_factura.id), fUltimaPercebe, "percebe: id de la factura (para el enlace)");
igual(u(1).base_factura.archivo_path, `docs/3-10.pdf`, "percebe: el original de la factura");
igual(u(1).base_factura.nombre_linea, "PERCEBE GALLEGO", "percebe: la línea tal cual");
cerca(u(1).base_eur_anterior, 130, "percebe: la factura anterior (130 €/kg, el mismo día)");
igual(u(1).base_proveedor_anterior, "MARISCOS D", "percebe: proveedor de la anterior");
cerca(u(1).base_eur_6m, 100, "percebe: la última factura de hace 6 meses (100 €/kg)");
ok(u(1).ud_eur === null && u(1).ud_factura === null, "percebe: comprado por kg, sin precio por unidad de compra");
cerca(u(1).base_iva_pct, 10, "percebe: IVA de la línea");
igual(u(1).base_iva_origen, "linea", "percebe: IVA de la línea (origen)");
cerca(u(1).mediana_eur_base, 115, "percebe: la mediana de 90 días (105, 110, 130, 120), en la misma pasada");
igual([u(1).mediana_medida, u(1).lineas], ["kg", 4], "percebe: medida y líneas de la mediana (sin Touza, albarán facturado, abono ni futuras)");
igual(u(1).ultima_txt, await hace(10), "percebe: fecha de la compra más nueva");
cerca(u(2).base_eur, 16, "tinto: 16 €/l");
cerca(u(2).ud_eur, 12, "tinto: 12 € la botella");
igual(u(2).ud_medida, "botella", "tinto: unidad de compra");
cerca(u(2).ud_factura.precio_unidad, 12, "tinto: precio tal como se compra");
cerca(u(2).ud_factura.eur_base, 16, "tinto: y por litro");
igual(u(2).base_iva_origen, "factura", "tinto: sin IVA en la línea, el general de la factura");
cerca(u(2).base_iva_pct, 21, "tinto: 15,12 / 72 = 21 %");
cerca(u(2).mediana_eur_base, 14, "tinto: mediana 14 €/l");
cerca(u(3).ud_eur, 25, "helado: 25 € la cubeta");
igual(Number(u(3).ud_factura.id), fUltimaHelado, "helado: id de su última factura");
cerca(u(3).mediana_eur_ud, 22.5, "helado: mediana por cubeta");
// La mediana es la misma que la de margenes_carta_costes (la función de siempre).
const costes = (await db.query(`select * from public.margenes_carta_costes(array[1, 2, 3]::bigint[], current_date, 90) order by producto_id`)).rows;
for (const c of costes) {
  const f = u(Number(c.producto_id));
  igual(
    [f.mediana_eur_base, f.mediana_medida, f.mediana_eur_ud, f.mediana_unidad_compra, f.lineas, String(f.ultima)],
    [c.eur_base, c.medida, c.eur_ud, c.unidad_compra, c.lineas, String(c.ultima)],
    `producto ${c.producto_id}: misma mediana que margenes_carta_costes`,
  );
}

// ─── Después: el coste es el de la última factura ───────────────────────────
const d = await datos();
igual(d.coste_desde, "ultima_factura", "dice de dónde sale el coste");
const tinto = de(d.vinos, "tinto");
cerca(tinto.coste, 12, "vino: la botella cuesta lo de la última factura (12 €)");
cerca(tinto.coste_mediana, 10.5, "vino: la mediana va aparte (10,50 €)");
cerca(tinto.multiplicador, 2.5, "vino: 30 € sin IVA ÷ 12 € = 2,5×");
cerca(tinto.multiplicador_mediana, 2.86, "vino: con la mediana sería 2,86×");
cerca(tinto.pct, 40, "vino: el coste es el 40 % de la venta sin IVA");
cerca(tinto.coste_6m, 10, "vino: la última factura de hace 6 meses (10 €)");
cerca(tinto.variacion_pct, 20, "vino: +20 % de factura a factura");
cerca(tinto.coste_anterior, 9, "vino: la factura anterior (9 €)");
igual(Number(tinto.factura.id), fUltimaTinto, "vino: la factura usada");
cerca(tinto.coste_iva, 14.52, "vino: con el IVA de esa factura (21 %)");
igual(tinto.iva_origen, "factura", "vino: origen del IVA");
igual(tinto.banderas, ["multiplicador_bajo", "sube_coste"], "vino: en rojo (2,5 < 2,6) y sube el coste");
cerca(tinto.multiplicador_tienda, 1.59, "vino: la tienda también con la última factura");

const percebes = de(d.peso, "percebes");
cerca(percebes.compra_kg, 120, "al peso: compra con la última factura");
cerca(percebes.compra_kg_mediana, 115, "al peso: la mediana aparte");
cerca(percebes.compra_kg_iva, 132, "al peso: con el IVA de la línea");
cerca(percebes.compra_kg_6m, 100, "al peso: hace 6 meses");
cerca(percebes.compra_kg_anterior, 130, "al peso: la anterior");
cerca(percebes.multiplicador, 1.44, "al peso: 172,73 ÷ 120");
cerca(percebes.multiplicador_mediana, 1.5, "al peso: con la mediana, 172,73 ÷ 115");
igual(percebes.ultimo_proveedor, "MARISCOS C", "al peso: el proveedor es el de la factura usada");
igual(percebes.banderas, ["multiplicador_bajo", "sube_coste"], "al peso: en rojo y sube el coste");
const gallegos = de(d.peso, "percebes-gallegos");
ok(!gallegos.banderas.includes("sube_coste"), "al peso: con la carta subida en 6 meses no marca «sube el coste»");
cerca(gallegos.variacion_pct, 20, "al peso: pero la variación sigue ahí");

const helado = de(d.platos, "helado");
cerca(helado.coste, 2.5, "plato: 0,1 cubeta × 25 €");
cerca(helado.pct, 50, "plato: 2,50 ÷ 5,00 = 50 % de lo que se cobra sin IVA");
cerca(helado.coste_mediana, 2.25, "plato: con la mediana, 2,25 €");
cerca(helado.pct_mediana, 45, "plato: 45 % con la mediana");
igual(Number(helado.factura.id), fUltimaHelado, "plato: la factura del ingrediente que más pesa");
igual(helado.banderas, ["coste_alto"], "plato: coste alto (sin compras de hace 6 meses no hay «sube»)");
const ingHelado = helado.ingredientes[0];
cerca(ingHelado.eur, 25, "ingrediente: precio de la última factura");
cerca(ingHelado.eur_mediana, 22.5, "ingrediente: mediana aparte");
cerca(ingHelado.eur_anterior, 20, "ingrediente: la factura anterior");
igual(ingHelado.unidad_compra, "cubeta", "ingrediente: unidad de compra de la factura");
const ingPercebe = de(d.platos, "percebes").ingredientes[0];
cerca(ingPercebe.coste, 12, "ingrediente al peso: 100 g × 120 €/kg");
igual(ingPercebe.factura.proveedor, "MARISCOS C", "ingrediente: la factura usada");

// ─── Avisos: aplicar la migración no inunda Avisos ──────────────────────────
const sinAvisar = (await db.query(`select public.margenes_generar_avisos(current_date) as r`)).rows[0].r;
igual(sinAvisar.nuevos, 0, "tras la migración (estado puesto al día) no salta ningún «margen bajo»");
const estadoVino = (await db.query(`select bajo, coste from public.margenes_avisos_estado where canal = 'vino' and articulo_id = 'tinto'`)).rows[0];
ok(estadoVino.bajo === true && Math.abs(Number(estadoVino.coste) - 12) < 0.001, "el estado guarda el coste de la última factura");

// ─── Aviso de plato: texto nuevo en el panel, Telegram como antes ───────────
const cruzarHelado = `update public.margenes_avisos_estado set bajo = false, coste = 2,
  detalle = '{"3": {"producto": "Helado cubeta", "eur": 20, "coste": 2, "medida": "cubeta"}}'::jsonb
  where canal = 'plato' and articulo_id = 'helado'`;
await db.exec(cruzarHelado);
const r1 = (await db.query(`select public.margenes_generar_avisos(current_date) as r`)).rows[0].r;
igual(r1.nuevos, 1, "el plato cruza su límite: un aviso");
const aviso = (await db.query(`select titulo, mensaje, datos from public.notificaciones_dashboard where tipo = 'facturas_margen_bajo'`)).rows[0];
const ddmm = (await db.query(`select to_char(current_date - 12, 'DD/MM') f`)).rows[0].f;
igual(aviso.titulo, "Margen bajo: Helado (coste: 50 % de lo que cobras)", "título: el % es de lo que se cobra");
igual(
  aviso.mensaje,
  `El coste del plato «Helado» ya es el 50 % de su precio de venta sin IVA (límite 35 %): de cada 100 € que cobras, 50 € se van en ingredientes. ` +
    `Sube Helado cubeta de 20,00 a 25,00 € la cubeta, según la factura de HELADOS Y del ${ddmm}. Precios sin IVA.`,
  "mensaje en sencillo",
);
const telegramNuevo = aviso.datos.texto_telegram;
igual(
  telegramNuevo,
  `El coste del plato «Helado» es ya el 50 % del precio (límite 35 %): sube Helado cubeta de 20,00 a 25,00 € la cubeta, según la factura de HELADOS Y del ${ddmm}.`,
  "texto_telegram: el de siempre",
);

// ─── Rollback ───────────────────────────────────────────────────────────────
await db.exec(RB);
const fns2 = (await db.query(`select proname from pg_proc where pronamespace = 'public'::regnamespace and proname = 'margenes_carta_ultima'`)).rows;
igual(fns2.length, 0, "rollback: borra margenes_carta_ultima");
const tras = await datos();
cerca(de(tras.vinos, "tinto").coste, 10.5, "rollback: el coste vuelve a ser la mediana");
ok(!("coste_desde" in tras), "rollback: sin los campos nuevos");
// La versión de antes genera EXACTAMENTE el mismo texto de Telegram.
await db.exec(`delete from public.notificaciones_dashboard; ${cruzarHelado.replace("coste = 2,", "coste = 1,")}`);
await db.exec(`update public.margenes_avisos_estado set bajo = false where canal = 'plato' and articulo_id = 'helado'`);
const r2 = (await db.query(`select public.margenes_generar_avisos(current_date) as r`)).rows[0].r;
igual(r2.nuevos, 1, "rollback: el aviso de plato sigue saltando");
const avisoViejo = (await db.query(`select titulo, datos from public.notificaciones_dashboard where tipo = 'facturas_margen_bajo'`)).rows[0];
igual(avisoViejo.titulo, "Margen bajo: Helado (45 % de coste)", "rollback: el título de antes (con la mediana: 45 %)");
igual(
  avisoViejo.datos.texto_telegram,
  telegramNuevo.replace("50 %", "45 %").replace("a 25,00 €", "a 22,50 €"),
  "texto_telegram: la versión nueva y la de antes escriben igual (solo cambian las cifras)",
);

console.log(`test-margenes-ultima-factura: ${comprobaciones} comprobaciones OK`);
