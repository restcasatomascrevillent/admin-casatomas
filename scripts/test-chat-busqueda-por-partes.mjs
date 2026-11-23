// Búsqueda de productos y proveedores del copiloto de Facturas (migración
// 20261217100000_chat_facturas_busqueda_por_partes), contra un Postgres en memoria
// (PGlite) con pg_trgm y unaccent. Nunca toca Supabase.
//
//   npm run test:chat-busqueda:db
//
// Se prueban las funciones NUEVAS de la migración (se extraen de su fichero):
// una_letra_agente, palabras_proveedor_agente, proveedor_buscar_agente,
// consulta_producto_agente, parcial_producto_agente y albaranes_facturados_agente.
// Las que la migración parchea sobre la definición viva (compras_producto_agente,
// ficha_proveedor_agente, lineas_producto_*) se prueban con la batería del copiloto
// (scripts/eval-chat-fallos.mjs --bateria), que necesita los datos reales.
//
// Estado de partida: las funciones de apoyo tal como están en producción el 23/11/2026
// (palabras/raíz de producto, normalizar_texto, normalizar_proveedor_base,
// errata_proveedor_agente, es_linea_servicio_agente, numero_documento_normalizado)
// sobre tablas mínimas con los casos de las conversaciones reales.
import { PGlite } from "@electric-sql/pglite";
import { pg_trgm } from "@electric-sql/pglite/contrib/pg_trgm";
import { unaccent } from "@electric-sql/pglite/contrib/unaccent";
import { readFile } from "node:fs/promises";
import assert from "node:assert/strict";

const MIG = await readFile("supabase/migrations/20261217100000_chat_facturas_busqueda_por_partes.sql", "utf8");

/** Una función de la migración (las nuevas van con `as $$ … $$;`). */
function funcion(nombre) {
  const i = MIG.indexOf(`create or replace function public.${nombre}(`);
  assert.ok(i >= 0, `No encuentro la función ${nombre} en la migración`);
  const j = MIG.indexOf("\n$$;", i);
  assert.ok(j >= 0, `No encuentro el final de ${nombre}`);
  return MIG.slice(i, j + 4);
}

let comprobaciones = 0;
const ok = (v, msg) => { assert.ok(v, msg); comprobaciones++; };
const igual = (a, b, msg) => { assert.deepEqual(a, b, msg); comprobaciones++; };

const db = new PGlite({ extensions: { pg_trgm, unaccent } });
await db.exec(`
  create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
  create schema extensions;
  create extension pg_trgm with schema extensions;
  create extension unaccent with schema public;

  -- ── Funciones de apoyo (definición viva del 23/11/2026) ──
  create function public.normalizar_texto(p_texto text) returns text language sql immutable strict set search_path = public as $$
    select regexp_replace(trim(lower(unaccent(p_texto))), '\\s+', ' ', 'g') $$;
  create function public.palabras_producto_agente(p_texto text) returns text[] language sql immutable set search_path = public as $$
    select coalesce(array_agg(w order by n) filter (where w <> ''), '{}'::text[])
      from regexp_split_to_table(regexp_replace(coalesce(normalizar_texto(p_texto), ''), '[^a-z0-9]+', ' ', 'g'), ' ') with ordinality as t(w, n) $$;
  create function public.raiz_producto_agente(p_palabra text) returns text language sql immutable set search_path = public as $$
    with s as (
      select case when p_palabra ~ '[0-9]' then p_palabra
                  when length(p_palabra) >= 4 and p_palabra ~ '[^s]s$' then left(p_palabra, -1)
                  else p_palabra end as w
    ), r as (
      select case when p_palabra ~ '[0-9]' then w
                  when length(w) >= 4 and w ~ '[aeo]$' then left(w, -1)
                  else w end as w
        from s
    )
    select case when w in ('cg', 'cong', 'congel', 'congelad') then 'congel'
                when w in ('fr', 'fresc') then 'fresc'
                when w in ('ib', 'iber', 'iberic') then 'iberic'
                when w = 'jam' then 'jamon'
                else w end
      from r $$;
  create function public.raices_producto_agente(p_texto text) returns text[] language sql immutable set search_path = public as $$
    select coalesce(array_agg(distinct raiz_producto_agente(w)), '{}'::text[]) from unnest(palabras_producto_agente(p_texto)) w $$;
  create function public.es_linea_servicio_agente(p_nombre text) returns boolean language sql immutable set search_path = public as $$
    select coalesce(lower(p_nombre), '') ~
      '\\m(portes?|transportes?|env[ií]os?|gastos? de (env[ií]o|gesti[oó]n|transporte)|gesti[oó]n y log[ií]stica|log[ií]stica|punto verde|ecoembes|canon|recargos?|fianzas?|dep[oó]sitos?|trabajos?|mano de obra|servicios?|desplazamientos?|reparaci[oó]n(es)?|instalaci[oó]n(es)?|montajes?)\\M' $$;
  create function public.normalizar_proveedor_base(p_proveedor text) returns text language plpgsql immutable strict set search_path = public as $$
  declare v_texto text;
  begin
    v_texto := trim(lower(unaccent(p_proveedor)));
    v_texto := regexp_replace(v_texto, '\\s*\\([^)]*\\)', '', 'g');
    v_texto := regexp_replace(v_texto,
      '[,\\s]+(sociedad\\s+limitada\\s+unipersonal|sociedad\\s+anonima\\s+unipersonal|sociedad\\s+cooperativa|sociedad\\s+limitada|sociedad\\s+anonima|s\\.l\\.u\\.|s\\.a\\.u\\.|s\\.l\\.|s\\.a\\.|s\\.c\\.p\\.|s\\.c\\.l\\.|s\\.c\\.|s\\.coop\\.?|slu|sau|sl|sa|cb|sc)\\s*$',
      '', 'gi');
    v_texto := regexp_replace(v_texto, '[,.\\s]+$', '');
    v_texto := regexp_replace(trim(v_texto), '\\s+', ' ', 'g');
    return v_texto;
  end $$;
  create function public.numero_documento_normalizado(p text) returns text language sql immutable set search_path = public as $$
    select nullif(ltrim(regexp_replace(regexp_replace(lower(coalesce(p, '')), '^\\s*v\\s*/', ''), '[^a-z0-9]', '', 'g'), '0'), '') $$;

  -- ── Tablas mínimas ──
  create table public.categorias_producto (id bigint primary key, clave text unique, nombre text, padre_id bigint, activa boolean default true);
  create table public.terminos_agente (termino text primary key, raices text[] generated always as (raices_producto_agente(termino)) stored,
    categoria_clave text, nivel text, formato text, origen text default 'semilla');
  create table public.proveedores (id bigint primary key, nombre varchar(255), nombre_comercial text,
    nombre_normalizado text generated always as (normalizar_proveedor_base(nombre::text)) stored);
  create table public.proveedores_alias (id bigserial primary key, proveedor_id bigint, alias_normalizado text);
  create table public.facturas (id bigint primary key, tipo varchar(20) default 'factura', proveedor varchar(255), proveedor_id bigint,
    numero_documento varchar(100), fecha date, facturado_en_id bigint, facturado_origen text);
  create table public.productos_catalogo (id bigint primary key, nombre text, categoria_id bigint,
    raices_nombre text[] generated always as (raices_producto_agente(nombre)) stored,
    palabras_nombre text[] generated always as (palabras_producto_agente(nombre)) stored);
  create table public.productos_alias (texto_normalizado text primary key, producto_id bigint,
    raices_texto text[] generated always as (raices_producto_agente(texto_normalizado)) stored);
  create table public.productos_factura (id bigint primary key, factura_id bigint, nombre varchar(500), producto_id bigint,
    albaran_ref varchar(100), total numeric,
    nombre_normalizado varchar generated always as (normalizar_texto(nombre::text)) stored,
    raices_nombre text[] generated always as (raices_producto_agente(nombre::text)) stored,
    palabras_nombre text[] generated always as (palabras_producto_agente(nombre::text)) stored);

  insert into categorias_producto (id, clave, nombre, padre_id) values
    (1, 'bebidas', 'Bebidas', null), (12, 'bebidas.vinos', 'Vinos', 1), (14, 'bebidas.licores', 'Licores y destilados', 1),
    (6, 'despensa', 'Despensa', null), (9, 'limpieza', 'Limpieza y desechables', null), (10, 'menaje', 'Menaje y equipamiento', null);
  insert into terminos_agente (termino, categoria_clave, nivel) values
    ('vino', 'bebidas.vinos', 'familia'), ('aceite', 'despensa', 'producto'), ('copas', 'bebidas.licores', 'familia'),
    ('champagne', 'bebidas.vinos', 'producto');
  insert into proveedores (id, nombre) values
    (1, 'SUMINISTROS HOSTELEROS ALTAMIRA, S. L.'), (2, 'D. PRIMERAS MARCAS, S.A.U.'), (3, 'ACEITES HACIENDA EL PALO, S.L.'),
    (4, 'BODEGAS DE LOS HEREDEROS DEL MARQUÉS DE RISCAL, S.L.U.'), (5, 'FERRANDO PEREZ ANTONIO'),
    (6, 'SANCHEZ RODRIGUEZ, FERNANDO ANGEL'), (7, 'SALAZONES HERPAC, S.L'), (8, 'Suministros Hosteleros Equipalia, S.L.'),
    (9, 'MARTINEZ PEREZ, JOSE'), (10, 'MARTINEZ QUESADA, JOSE'), (11, 'Makro distribuidor mayorista S.A.'), (12, 'DISVALERO, SL');
  insert into proveedores_alias (proveedor_id, alias_normalizado) values (11, 'makro distribucion mayorista');
  insert into facturas (id, proveedor_id, proveedor, numero_documento, fecha) values
    (1, 1, 'Altamira', 'A1', '2026-10-01'), (2, 2, 'Primeras Marcas', 'FV26072899', '2026-07-31'),
    (3, 3, 'Aceites Hacienda El Palo', '0A/3219', '2026-08-10'), (4, 4, 'Riscal', 'VFN 26/009277', '2026-08-31'),
    (5, 11, 'Makro', 'M1', '2026-09-01'), (6, 12, 'Disvalero', 'D1', '2026-05-28'), (7, 7, 'Herpac', 'H1', '2026-05-28'),
    (8, 5, 'Ferrando', 'F1', '2026-05-28'), (9, 6, 'Fernando', 'F2', '2026-05-28'), (10, 9, 'Martinez P', 'MP', '2026-05-28'),
    (11, 10, 'Martinez Q', 'MQ', '2026-05-28'), (12, 8, 'Equipalia', 'E1', '2026-05-28');
  insert into productos_catalogo (id, nombre, categoria_id) values
    (100, 'L. Beyer Gewurztraminer', 12), (101, 'Botella verde 500 ml Hacienda El Palo', 9), (102, 'Laurent-Perrier La Cuvée Rosé 75 cl', 12),
    (103, 'Palo Cortado Península 75 cl', 12), (104, 'Palo de aluminio Mpro 150 cm', 10), (105, 'Aalto 75 cl', 12), (106, 'Aalto PS 75 cl', 12),
    (107, 'Aceite de girasol alto oleico', 6), (108, 'La Hormiga de Antídoto', 12), (109, 'La Hormiga de Antídoto 2022 Magnum', 12),
    (110, 'Copa de champán Inventa7Bartender 30 cl', 10), (111, 'Copa de vino Spiegelau Riscal', 10),
    (112, 'Desengrasante caliente Help HC40 6 kg', 9), (113, 'Cuchillo chuletero London', 10), (114, '80/20 Altamira dorado', 10),
    (115, 'Pétalos negros con sal 300 g', 6), (116, 'Fefiñanes 2023', 12), (117, 'Silla Alexander tapizada', 10), (118, 'Brandy Magno 70 cl', 14),
    (119, 'Grasa de vaca derretida congelada', 6), (120, 'Condado de Haza Crianza Magnum', 12);
  insert into productos_factura (id, factura_id, nombre, producto_id, total) values
    (1, 2, 'L.Beyer Gewurztraminer 2021 (cód. 730226)', 100, 97.5),
    (2, 3, 'HACIENDA EL PALO PREMIUM 500ML (N)', 101, 1020),
    (3, 4, 'C/6B LP ROSE 0,75', 102, 344.64),
    (4, 5, 'PALO CORTADO PENINSULA 75 CL', 103, 30),
    (5, 5, 'PALO ALUMINIO MPRO 150CM', 104, 9),
    (6, 6, 'Aalto 75 cl.', 105, 200),
    (7, 6, 'Aalto PS 75 cl.', 106, 400),
    (8, 5, 'LITROS DE ACEITE DE GIRASOL ALTO OLEICO', 107, 50),
    (9, 6, 'LA HORMIGA DE ANTIDOTO 2022', 108, 100),
    (10, 6, 'LA HORMIGA DE ANTIDOTO 2022 MAGNUM', 109, 514.2),
    (11, 1, 'COPA INVENTA7BARTENDER CHAMPAGNE 30CL', 110, 176.64),
    (12, 4, 'COPA SPIEGELAU VINO RISCAL', 111, 0),
    (13, 1, 'HELP DESENGRASANTE CALIENTE HC40 6KG', 112, 40),
    (14, 1, 'LONDON CUCHILLO CHULETERO', 113, 60),
    (15, 1, '80/20 ALTAMIRA DORADO ALTAMIRA (C/ 12 u.)', 114, 12),
    (16, 5, 'PETALOS NEGROS SAL 300GR', 115, 8),
    (17, 2, 'Fefiñanes 2023', 116, 90),
    (18, 1, 'Silla ALEXANDER tap. SEATTLE OCEAN', 117, 300),
    (19, 5, 'B.MAGNO 70CL 36º C6', 118, 70),
    (21, 5, 'OK-GRASA DE VACA SUPREMA DERRETIDA CONG.', 119, 20),
    (22, 6, 'CONDADO DE HAZA CRIANZA MAGNUM', 120, 80),
    (20, 1, 'Portes', null, 5);
`);

// Solo las funciones nuevas de la migración (en su orden).
// errata_proveedor_agente es de 20261209200000 y usa una_letra_agente: va después de la nueva.
await db.exec(funcion("una_letra_agente"));
await db.exec(`
  create function public.errata_proveedor_agente(p_buscado text, p_nombre text) returns boolean language sql immutable set search_path = public as $$
    with b as (select w from regexp_split_to_table(coalesce(p_buscado, ''), '[^a-z0-9]+') w where length(w) >= 3),
    n as (select w from regexp_split_to_table(coalesce(p_nombre, ''), '[^a-z0-9]+') w where w <> ''),
    m as (
      select b.w,
             exists (select 1 from n where n.w = b.w or (length(b.w) >= 4 and n.w like b.w || '%')) as igual,
             exists (select 1 from n where length(b.w) >= 4 and length(n.w) >= 4 and una_letra_agente(b.w, n.w)) as errata
        from b)
    select count(*) > 0 and bool_and(m.igual or m.errata) and (bool_or(m.igual) or (count(*) = 1 and max(length(m.w)) >= 6)) from m $$;
`);
for (const f of ["palabras_proveedor_agente", "proveedor_buscar_agente", "consulta_producto_agente", "parcial_producto_agente", "albaranes_facturados_agente"]) {
  await db.exec(funcion(f));
}
const una = async (sql, p = []) => (await db.query(sql, p)).rows[0];

// ── 1. una_letra_agente ──
{
  const f = async (a, b) => (await una(`select una_letra_agente($1, $2) r`, [a, b])).r;
  igual(await f("fenrando", "fernando"), true, "dos letras bailadas");
  igual(await f("discalrux", "discarlux"), true, "dos letras bailadas en medio");
  igual(await f("garro", "garre"), true, "una letra cambiada (como antes)");
  igual(await f("centolo", "centollo"), true, "una letra de menos (como antes)");
  igual(await f("mahou", "mamadou"), false, "dos letras de más no es una errata");
  igual(await f("damm", "dama"), true, "una letra cambiada, también en palabras cortas (el largo mínimo lo pone quien llama)");
  igual(await f("abcd", "badc"), false, "dos pares bailados no");
}

// ── 2. Proveedores ──
{
  const buscar = async (t) => (await db.query(`select nombre, metodo, claro from proveedor_buscar_agente($1)`, [t])).rows;
  const primero = async (t) => (await buscar(t))[0] ?? null;
  let p = await primero("suministros altamira");
  igual([p.nombre, p.metodo, p.claro], ["SUMINISTROS HOSTELEROS ALTAMIRA, S. L.", "palabras", true],
    "«suministros altamira»: las palabras están en el nombre aunque falte la de en medio");
  p = await primero("altamira");
  igual([p.metodo, p.claro], ["contiene", true], "una palabra del nombre (como antes)");
  p = await primero("marques riscal");
  igual([p.nombre.includes("RISCAL"), p.metodo, p.claro], [true, "palabras", true], "sin tilde ni «de»");
  p = await primero("riscal bodegas");
  igual([p.metodo, p.claro], ["palabras", true], "en otro orden");
  p = await primero("makro distribucion");
  igual([p.nombre, p.claro], ["Makro distribuidor mayorista S.A.", true], "por el alias");
  let r = await buscar("martinez jose");
  igual(r.filter((x) => x.metodo === "palabras").length, 2, "«martinez jose»: dos proveedores las llevan");
  igual(r[0].claro, false, "… y entonces no se elige ninguno: se pregunta");
  p = await primero("harpac");
  igual([p.nombre, p.metodo, p.claro], ["SALAZONES HERPAC, S.L", "parecido", true], "errata de una letra en una palabra de 6: clara");
  r = await buscar("fenrando");
  igual(r.map((x) => x.claro), [false, false], "«fenrando» puede ser Ferrando o Fernando: se pregunta");
  igual(r.map((x) => x.nombre).sort(), ["FERRANDO PEREZ ANTONIO", "SANCHEZ RODRIGUEZ, FERNANDO ANGEL"], "… y salen los dos");
  igual((await buscar("mercadona")).some((x) => x.claro), false, "un proveedor que no existe nunca es claro");
  igual(await buscar(""), [], "sin texto, nada");
  igual((await una(`select palabras_proveedor_agente('Bodegas de los Herederos, S.L.') r`)).r.sort(), ["bodegas", "herederos"], "sin artículos ni forma societaria");
}

// ── 3. Siglas con puntos ──
{
  const c = async (t) => (await una(`select consulta_producto_agente($1) r`, [t])).r;
  igual(await una(`select palabras_producto_agente(consulta_producto_agente('L.P.ROSE')) r`), { r: ["lp", "rose"] }, "«L.P.ROSE» = lp rose");
  igual(await una(`select palabras_producto_agente(consulta_producto_agente('PRECIO L.P. ROSE')) r`), { r: ["precio", "lp", "rose"] }, "con espacio tras las siglas");
  igual(await una(`select palabras_producto_agente(consulta_producto_agente('l. p. rose')) r`), { r: ["lp", "rose"] }, "siglas con espacios");
  igual(await c("j.b."), "jb.", "dos letras");
  igual(await c("a.b.c. x"), "abc. x", "tres letras");
  igual(await c("S.CANTABRIA"), "s.cantabria", "una inicial delante de una palabra no se toca");
  igual(await c("0,75 l. pack"), "0,75 l. pack", "una unidad con punto no se une a la palabra siguiente");
  igual(await c("Léon Beyer"), "leon beyer", "sin tildes y en minúsculas");
}

// ── 4. Búsqueda por partes ──
{
  const parcial = async (t, excl = null) => (await una(`select parcial_producto_agente($1, $2) r`, [t, excl])).r;
  const nombres = async (r) => r?.ids
    ? (await db.query(`select nombre from productos_factura where id = any($1::bigint[]) order by id`, [r.ids])).rows.map((x) => x.nombre)
    : null;

  let r = await parcial("Leon Beyer");
  igual(await nombres(r), ["L.Beyer Gewurztraminer 2021 (cód. 730226)"], "«leon beyer» = «L.Beyer…» (inicial con punto)");
  igual(r.nivel, "union", "… por unión de partes");

  r = await parcial("Leon beyern vino 2021");
  igual(await nombres(r), ["L.Beyer Gewurztraminer 2021 (cód. 730226)"], "con errata, la familia («vino») y la añada que sí figura");
  igual(r.sin_casar ?? null, null, "… y nada queda sin casar");

  r = await parcial("aceite palo");
  igual(await nombres(r), ["HACIENDA EL PALO PREMIUM 500ML (N)"],
    "«aceite palo»: «aceite» está en el proveedor que la factura; no entran el palo cortado ni el de aluminio");

  r = await parcial("vino aalto");
  igual(await nombres(r), ["Aalto 75 cl.", "Aalto PS 75 cl."], "«vino aalto»: la familia no está en el nombre; no entra el aceite «alto oleico»");
  igual(r.nivel, "categoria", "… por la familia");

  r = await parcial("aalto 2021");
  igual(await nombres(r), ["Aalto 75 cl.", "Aalto PS 75 cl."], "añada que no figura en el nombre: se da el producto");
  igual(r.sin_casar, ["2021"], "… y se avisa de la añada");

  r = await parcial("brandy magno");
  igual(await nombres(r), ["B.MAGNO 70CL 36º C6"], "«brandy magno» = «B.MAGNO» (por el catálogo o la inicial)");

  r = await parcial("cuchillos altamira");
  igual(await nombres(r), ["LONDON CUCHILLO CHULETERO"], "producto + proveedor en el mismo texto");

  r = await parcial("suministros altamira");
  igual(r, { es_proveedor: "SUMINISTROS HOSTELEROS ALTAMIRA, S. L." }, "«suministros altamira» es un proveedor, no el producto «Altamira dorado»");

  r = await parcial("hormiga magnitud");
  igual(r.ids ?? null, null, "«hormiga magnitud»: hay dos Hormigas, no se elige");
  igual(r.sugerencias.sort(), ["LA HORMIGA DE ANTIDOTO 2022", "LA HORMIGA DE ANTIDOTO 2022 MAGNUM"], "… se sugieren las dos");

  r = await parcial("petalos negros superior");
  igual(await nombres(r), ["PETALOS NEGROS SAL 300GR"], "una palabra que no existe en ningún producto y las otras dos señalan uno solo: se da");
  igual([r.nivel, r.sin_casar], ["unico", ["superior"]], "… avisando de la palabra que no figura");
  r = await parcial("fefiñanes superior");
  igual([r.ids ?? null, r.sugerencias], [null, ["Fefiñanes 2023"]], "con una sola palabra que casa no se da nada: se sugiere («sierra cantabria» no es la sierra de carnicero)");
  r = await parcial("hormiga magnum reserva");
  igual(r.sugerencias.every((n) => /HORMIGA/.test(n)), true, "las sugerencias llevan la palabra que más distingue (hormiga), no cualquier «magnum»");

  await db.exec(`delete from terminos_agente where termino = 'copas'`);   // lo hace la migración (punto 8)
  r = await parcial("copas riedel");
  igual(r.ids ?? null, null, "«copas riedel»: no hay Riedel");
  igual(r.sugerencias.sort(), ["COPA INVENTA7BARTENDER CHAMPAGNE 30CL", "COPA SPIEGELAU VINO RISCAL"], "… se sugieren las copas que sí hay");

  r = await parcial("quitagrasa");
  igual(r.ids ?? null, null, "«quitagrasa» no existe");
  r.sugerencias = (r.sugerencias ?? []).sort();
  igual(r.sugerencias, ["HELP DESENGRASANTE CALIENTE HC40 6KG", "OK-GRASA DE VACA SUPREMA DERRETIDA CONG."].sort(),
    "… pero acaba en «grasa» (que es una palabra de las compras): se sugiere lo que la lleva, también dentro de «desengrasante»");

  r = await parcial("champagne alexander");
  igual(r, {}, "«champagne alexander»: la silla Alexander no es de la familia pedida, no se sugiere");

  r = await parcial("la faraona");
  igual(r, {}, "nada que se le parezca: vacío");

  r = await parcial("aalto", "ps");
  igual(await nombres(r), ["Aalto 75 cl."], "respeta las palabras excluidas");

  igual(await parcial("de la"), null, "sin palabras con significado, nada");
  igual((await parcial("portes altamira")).ids ?? null, null, "un servicio (portes) nunca se da como producto");
}

// ── 5. albaranes_facturados_agente: misma regla, por índice ──
{
  await db.exec(`
    create index productos_factura_albaran_ref_norm_idx on public.productos_factura (public.numero_documento_normalizado(albaran_ref::text)) where albaran_ref is not null;
    insert into facturas (id, tipo, proveedor_id, numero_documento, fecha, facturado_en_id, facturado_origen) values
      (100, 'albaran', 1, 'V/ 775.630', '2026-10-01', null, null),      -- lo cita la factura 110
      (101, 'albaran', 1, 'A-26/0004939', '2026-10-08', null, null),    -- nadie lo cita
      (102, 'albaran', 1, '0005000', '2026-11-20', null, null),         -- lo cita una factura ANTERIOR: no cuenta
      (103, 'albaran', 2, '775630', '2026-10-01', null, null),          -- otro proveedor con el mismo número: no cuenta
      (104, 'albaran', 1, 'X-9', '2026-10-01', 111, 'manual'),          -- vínculo manual
      (105, 'albaran', 1, '0775631', '2026-10-01', null, 'manual'),     -- desvinculado a mano: no cuenta aunque lo citen
      (110, 'factura', 1, 'F-10', '2026-10-31', null, null),
      (111, 'factura', 1, 'F-11', '2026-10-31', null, null);
    insert into productos_factura (id, factura_id, nombre, albaran_ref, total) values
      (200, 110, 'Vaso', '0775630', 10), (201, 110, 'Plato', '775630', 10), (202, 110, 'Taza', '5000', 10), (203, 110, 'Jarra', '775631', 10);
  `);
  const r = (await db.query(`select albaran_id, factura_id, motivo from albaranes_facturados_agente() order by 1`)).rows;
  igual(r, [{ albaran_id: 100, factura_id: 110, motivo: "cita" }, { albaran_id: 104, factura_id: 111, motivo: "vinculo" }],
    "albarán facturado = vínculo o cita del mismo proveedor en una factura no anterior; uno por albarán");
}

// ── 6. Permisos de las funciones nuevas ──
{
  const acl = async (f) => (await una(`select coalesce(array_to_string(proacl, ','), '') a from pg_proc where oid = $1::regprocedure`, [f])).a;
  for (const f of ["public.parcial_producto_agente(text, text)", "public.consulta_producto_agente(text)", "public.palabras_proveedor_agente(text)"]) {
    await db.exec(MIG.slice(MIG.indexOf(`revoke all on function ${f}`), MIG.indexOf(";", MIG.indexOf(`grant execute on function ${f}`)) + 1));
    const a = await acl(f);
    ok(a.includes("authenticated=X") && a.includes("service_role=X") && !a.includes("anon=X") && !/(^|,)=X/.test(a), `${f}: solo authenticated y service_role`);
  }
}

console.log(`chat · búsqueda por partes: ${comprobaciones} comprobaciones correctas`);
await db.close();
