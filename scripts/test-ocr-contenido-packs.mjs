// Contenido de las líneas de factura: packs y cajas (migración 20261207300000),
// contra un Postgres en memoria (PGlite). Nunca toca Supabase.
//
//   npm run test:ocr-contenido-packs:db
//
// Estado de partida: las funciones REALES de antes (extraer_contenido y el
// trigger de 20261010160000, envase_texto de 20261123100000) sobre una tabla
// productos_factura mínima. productos_envase_recalcular es un stub.
//
// Cubre: la migración REAL aplicada dos veces; los nombres REALES de las 16
// reglas de la corrección a mano del 17/11/2026 (packs_seguras.md) con la unidad
// con la que estaban; lo que NO se puede saber por el texto (se queda como
// estaba o vacío, nunca inventado); contraejemplos que no deben cambiar
// («12 meses 75 cl», «Reserva 2016», «C/ Mayor 24», «12 años», códigos); el
// trigger (rellena, no pisa lo manual) y el rollback.
import { PGlite } from "@electric-sql/pglite";
import { readFile } from "node:fs/promises";
import assert from "node:assert/strict";

const leer = (f) => readFile(f, "utf8");
const MIG = await leer("supabase/migrations/20261207300000_ocr_contenido_packs.sql");
const RB = await leer("supabase/rollbacks/20261207300000_ocr_contenido_packs_ROLLBACK.sql");
const M_OCR = await leer("supabase/migrations/20261010160000_ocr_calidad_extraccion.sql");
const M_TERCIO = await leer("supabase/migrations/20261123100000_envase_tercio_litro.sql");

function funcion(texto, nombre) {
  const i = texto.indexOf(`CREATE OR REPLACE FUNCTION public.${nombre}`);
  assert.ok(i >= 0, `No encuentro ${nombre}`);
  const j = texto.indexOf("$function$", texto.indexOf("$function$", i) + 5);
  return texto.slice(i, j + "$function$".length) + ";";
}

let comprobaciones = 0;
const fallos = [];
const igual = (a, b, msg) => { try { assert.deepEqual(a, b, msg); } catch { fallos.push(`${msg}: sale ${JSON.stringify(a)}, esperado ${JSON.stringify(b)}`); } comprobaciones++; };

const db = new PGlite();
await db.exec(`
  create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
  create table public.productos_catalogo (id bigint generated always as identity primary key, nombre text);
  create table public.productos_factura (
    id bigint generated always as identity primary key,
    producto_id bigint, nombre text, unidad text default 'ud', cantidad numeric,
    contenido_cantidad numeric, contenido_unidad text, contenido_origen text);
  create function public.productos_envase_recalcular(p_ids bigint[] default null) returns integer language sql as 'select 0';
`);
await db.exec(funcion(M_OCR, "extraer_contenido"));
await db.exec(funcion(M_OCR, "trg_productos_factura_rellenar_contenido"));
await db.exec(funcion(M_TERCIO, "envase_texto"));
await db.exec(`
  create trigger trg_productos_factura_rellenar_contenido
    before insert or update of nombre, unidad, contenido_cantidad, contenido_unidad, contenido_origen on public.productos_factura
    for each row execute function public.trg_productos_factura_rellenar_contenido();
`);

// Antes: el fallo que se arregla.
const antes = async (t) => (await db.query("select cantidad::float8 c, unidad u from public.extraer_contenido($1)", [t])).rows[0] ?? null;
igual(await antes("COCA COLA 237 CL. * 24"), { c: 2.37, u: "l" }, "antes: 237 CL = 2,37 l");
igual(await antes("LANJARON VIDRIO RET. 0'50 L. * 20"), { c: 50, u: "l" }, "antes: 0'50 L = 50 l");

await db.exec(MIG);
await db.exec(MIG); // idempotente

const linea = async (nombre, unidad, cantidad = 1) => {
  const r = (await db.query("select cantidad::float8 c, unidad u from public.contenido_linea($1, $2, $3)", [nombre, unidad, cantidad])).rows[0];
  return r ? `${r.c} ${r.u}` : null;
};

// ── Las 16 reglas: nombre REAL, unidad con la que estaba la línea → contenido ──
const REGLAS = [
  // R1 Disbeya: «237/300/350 CL * 24» son mililitros
  ["AQUARIUS LIMON 300 CL. E.R.* 24", "caja", "7.2 l"],
  ["AQUARIUS NARANJA 300 CL. E.R. *24", "caja", "7.2 l"],
  ["COCA COLA 237 CL. * 24", "caja", "5.688 l"],
  ["COCA COLA 350 CL. E.R. *24", "caja", "8.4 l"],
  ["COCA COLA ZERO -ZERO 237 CL. *24", "caja", "5.688 l"],
  ["FANTA NARANJA 237 CL*24", "caja", "5.688 l"],
  ["FUZE TEA LIMON 300 CL. E.R. *24", "caja", "7.2 l"],
  ["SPRITE 237 CL. * 24", "caja", "5.688 l"],
  // R2 Disbeya Lanjarón
  ["LANJARON VIDRIO RET. 0'50 L. * 20", "caja", "10 l"],
  ["LANJARON VIDRIO RET. 1 L. * 12", "caja", "12 l"],
  // R3 Tabarca
  ["LA CASERA TINTO GASEOSA SR 275ml*24", "caja", "6.6 l"],
  ["LCA TDV GASEOSA RET. 24*275 ML", "caja", "6.6 l"],
  ["SCHWEPPES TONICA E/R 200ml*28", "caja", "5.6 l"],
  ["TRINA SR MANZANA ZERO 250ml*24", "caja", "6 l"],
  // R4 Orowines
  ["JUAN GIL NACAR C.x06 BOT.0,75 L ES-ECO-024-MU", "caja", "4.5 l"],
  // R5 Makro «contiene N unidades» (con cualquier unidad: el precio es el del pack)
  ["Aulet fuet 175 g contiene 2 unidades (total 350 g)", "ud", "0.35 kg"],
  ["Cataliment perlas yuzu 50 g contiene 3 unidades (Total 150 g)", "pack", "0.15 kg"],
  ["Central Lechera Asturiana leche semidesnatada sin lactosa brik 1 L contiene 6 unidades", "brik", "6 l"],
  ["FONT VELLA Agua mineral natural en botella de 33cl contiene 35 unidades", "bote", "11.55 l"],
  ["Levanova levadura 25 g contiene 20 unidades (total 500 g)", "paquete", "0.5 kg"],
  ["METRO Chef harina para frituras paquete 1kg contiene 10 unidades", "paquete", "10 kg"],
  ["METRO Chef leche entera 1,5 L contiene 6 unidades", "caja", "9 l"],
  ["METRO Chef queso burrata 125 g contiene 8 unidades (total 1 Kg)", "bandeja", "1 kg"],
  ["METRO Chef vinagre vino blanco botella 1l contiene 6 unidades", "pack de 6", "6 l"],
  ["Panaeras harina para freír paquete 1 kg contiene 5 unidades", "pack de 5", "5 kg"],
  ["RIOBA gofre maxi normal 110 g contiene 24 unidades", "pack", "2.64 kg"],
  ["RIOBA gofre mini 50g contiene 12 unidades", "rt", "0.6 kg"],
  ["RIOBA leche condensada entera 25 g contiene 50 unidades (total 1,250 Kg)", "caja", "1.25 kg"],
  ["RIOBA néctar de piña botella 1L contiene 6 unidades", "botella", "6 l"],
  ["RIOBA piruleta redonda 6 g contiene 200 unidades (Total 1,2 kg)", "bolsa", "1.2 kg"],
  ["RIOBA piruletas de corazón 10 g contiene 150 unidades (total 1500 g)", "bolsa", "1.5 kg"],
  ["Red Bull bebida energética lata 25cl contiene 24 unidades", "lata", "6 l"],
  ["S.PELLEGRINO agua con gas botella de 50cl contiene 24 unidades", "ud", "12 l"],
  ["Tio Resti tarta queso 80 g contiene 12 unidades (total 960 g)", "ud", "0.96 kg"],
  ["aro azúcar blanco 1kg contiene 10 unidades (total 10 kg)", "ud", "10 kg"],
  ["aro bacon loncheado 500 g contiene 2 unidades (total 1 kg)", "bandeja", "1 kg"],
  ["aro galletas tostadas 200 g contiene 4 paquetes (total 800 g)", "caja", "0.8 kg"],
  ["aro leche entera 1 L contiene 6 unidades", "brik", "6 l"],
  // R5b Makro: las que traen el pack escrito
  ["GALLETA TOSTADA ARO 200GX4", "caja", "0.8 kg"],
  ["HARINA FREIR PANAERAS 1KG (pack 5)", "pack", "5 kg"],
  ["METRO Chef Harina de trigo uso común 10 ud. x 1 Kg (total 10 Kg)", "paquete", "10 kg"],
  ["aro Azúcar blanco 10 ud. x 1 Kg (total 10 Kg)", "rt", "10 kg"],
  // R8 Tomás Nicolás: peso neto de la lata
  ["L/ Gordal DH F/5G 3000 neto (lectura dudosa)", "lata", "3 kg"],
  ["L/ Rellenas anchoa F/5G 2500 neto (lectura dudosa)", "lata", "2.5 kg"],
  // R11 Transgourmet «E/K»: el contenido ya estaba bien (la regla cambió la unidad)
  ["CEBOLLA SACO 10K E/K", "ud", "10 kg"],
  ["ZANAHORIA BOL.5K E/K", "ud", "5 kg"],
  // R12 Marqués de Riscal
  ["C/3 MAGNUM ROSE LP", "caja", "4.5 l"],
  ["C/3B MAGNUM LA CUVEE", "caja", "4.5 l"],
  ["C/3B MILLESIME MG 1,5L 2015", "caja", "4.5 l"],
  ["C/6 ARIENZO 0,75L 2022", "caja", "4.5 l"],
  ["C/6 MILLESIME 0,75 (EI) 2015", "caja", "4.5 l"],
  ["C/6B LP LA CUVEE 0,75L", "caja", "4.5 l"],
  ["C/6B LP ROSE 0,75", "caja", "4.5 l"],
  // R13 Luga
  ["PAN ACEITE (60g Hogaza Burguer) (C/ 120 U) -Amics-", "caja", "7.2 kg"],
  ["PICOS Sin Gluten (C/ 25 U)(individual 20g) Obando", "caja", "0.5 kg"],
  // R15 Makro: la unidad dice «pack de 6»
  ["ACTIMEL DESN 100ML NATURAL", "pack de 6", "0.6 l"],
  ["AGUA BEZOYA 1,5L", "pack de 6", "9 l"],
  ["BATIDO CACAO BK 200ML PULEVA", "pack de 6", "1.2 l"],
];
for (const [nombre, unidad, esperado] of REGLAS) igual(await linea(nombre, unidad), esperado, `${nombre} [${unidad}]`);

// ── Reglas que el texto NO puede resolver: no se inventa ──
const SIN_INVENTAR = [
  // R5b y R6: pack de Makro sin unidades escritas → vacío (antes, el de UNA lata) y aviso caja_sin_unidades
  ["COCACOLA LT 33CL REGULAR", "pack", null],
  ["AQUARIUS LT 33CL LIMON", "pack", null],
  ["RED BULL LT 25CL", "pack", null],
  ["LECHE ENT ARO BK 1L", "pack", null],
  ["ACTIMEL FRESA 100ML", "pack", null],
  // …y facturadas por lata o botella, lo que dice el papel (un envase)
  ["COCACOLA LT 33CL REGULAR", "lata", "0.33 l"],
  ["BITTER KAS BT 20CL", "botella", "0.2 l"],
  ["VINAGRE VINO BCO MC 1L", "botella", "1 l"],
  // R4 facturada por «ud» y R7 por botella: sin el precio no se sabe que es la caja
  ["JUAN GIL NACAR C X06 BOT 0.75 L ES-ECO-024-MU", "ud", "0.75 l"],
  ["AGUA VICHY CATALAN BANDEJA 30CL C1", "botella", "0.3 l"],
  // R9 (cantidad ↔ precio) y R10 (pan de cristal): no hay contenido en el texto
  ["CARABINERO", "kg", null],
  ["PAN DE CRISTAL", "caja", null],
  ["185 PAN DE CRISTAL", "caja", null],
  // R14: «12X125GR» sigue leyéndose como el total (el precio por tarrina no se ve en el texto)
  ["FRAMBUESA I 12X125GR PT", "ud", "1.5 kg"],
  // Dudosas del 16/11: caja de refresco sin unidades → vacío
  ["CASERA GASEOSA PERSONAL.RET 500ml", "caja", null],
  ["REFRESCO KAS LIMON RET 350ml", "caja", null],
  // Ambiguos: no se rellenan
  ["Salmorreta Tarro 380grsx9 PAELLALIA (UD)", "ud", null],
  ["BUÑUELO DE CHOCO Y LANGOSTINO 500g (C/ 15u) -Islanova", "caja", null],
  ["CERRO DE LA CRUZ vino blanco brik 12 unidades 1L", "brik", null],
  ["METRO Chef vol au vent red, 75mm, 900g, contiene 24 unidades", "caja", null],
];
for (const [nombre, unidad, esperado] of SIN_INVENTAR) igual(await linea(nombre, unidad), esperado, `sin inventar: ${nombre} [${unidad}]`);

// ── Otros patrones del encargo ──
const PATRONES = [
  ["HEINEKEN 1/3 LONG NET * 24", "caja", "7.92 l"],
  ["HEINEKEN 0'0 % 1/3 * 24", "caja", "7.92 l"],
  ["18/70 LA RUBIA RECUP. 1/3 * 24", "caja", "7.92 l"],
  ["CRUZCAMPO ESP. SIN GLUTEN 1/3 NR.* 12", "caja", "3.96 l"],
  ["PAULANER H. WEISSBIER 1/2 * 20 N.R.", "caja", "10 l"],
  ["AGUA VICHY CATALAN E/R 0,30 L.*24", "botella", "0.3 l"], // precio por botella
  ["AGUA VICHY CATALAN E/R 0,30 L.*24", "caja", "7.2 l"],
  ["W.JOHNNIE WALKER E/N 70CL 40º C12", "botella", "0.7 l"], // Gambín: precio por botella
  ["W.JOHNNIE WALKER E/N 70CL 40º C12", "caja", "8.4 l"],
  ["CAVA GRAMONA IMPERIAL BRUT CORPINNAT 75CL 12º C6", "caja", "4.5 l"],
  ["ESTRELLA GALICIA 33CL P6 C4", "caja", "7.92 l"],
  ["ESTRELLA GALICIA 33CL P6", "pack", "1.98 l"],
  ["ZUMO PIÑA TUAREG 200CL. 24 UNID*1", "caja", "4.8 l"],
  ["CERVEZA LATA 33CL 24U", "caja", "7.92 l"],
  ["AGUA VICHY 30CL BANDEJA 24", "bandeja", "7.2 l"],
  ["EL NIDO ECO CAJA 04 BT 0,75L ES-ECO-024-MU", "caja", "3 l"],
  ["C/1B G.SIECLE IT.24 1,5L", "caja", "1.5 l"],
  ["AALTO TINTO FINO 23 3/4x6b (trazab. AA23/01)", "botella", "0.75 l"],
  ["Mexifoods tortilla trigo 25 cm contiene 20 unidades (1260 g aprox)", "paquete", "1.26 kg"],
  ["SALSA KIMUCHI NO MOTO 1250 CL", "ud", "1.25 l"],
  ["Aalto MAGNUM 150 cl", "botella", "1.5 l"], // 150 cl sí son centilitros
  ["DETERGENTE MANUAL PALM P5 0,75 KG c/10", "ud", "0.75 kg"],
  ["DETERGENTE MANUAL PALM P5 0,75 KG c/10", "caja", null], // ¿10 de 0,75 kg o 10 piezas en 0,75 kg? No se rellena
  ["VIB-PULLED CERDO DESMIGADO 1KG C/5U", "caja", "5 kg"],
  ["FREGASUELOS INSECTICIDA XERONA 5l c/3u", "garrafa", "5 l"],
  ["ZZ ACEITE (CAJA 10 KG)", "caja", "10 kg"],
  ["TOMATE PERA 5 KG", "caja", "5 kg"],
  ["HIERBABUENA MC BJ 125G", "bandeja", "0.125 kg"],
];
for (const [nombre, unidad, esperado] of PATRONES) igual(await linea(nombre, unidad), esperado, `${nombre} [${unidad}]`);

// ── Contraejemplos: NO deben cambiar ──
const CONTRA = [
  ["Juan Gil Etiqueta Plata 12 meses 75 cl", "botella", "0.75 l"],
  ["Juan Gil Etiqueta Plata 12 meses 75 cl", "caja", null], // caja sin unidades: «12 meses» no es un pack
  ["Vino Reserva 2016", "botella", null],
  ["Vino Reserva 2016", "caja", null],
  ["C/ Mayor 24", "ud", null],
  ["C/ Mayor 24", "caja", null],
  ["Whisky 12 años", "botella", null],
  ["W.MACALLAN 12YO DOUBLE CASK 70CL 40º C6", "botella", "0.7 l"],
  ["C015 VENTRESCA ATÚN ROJO SALVAJE ALM. MÁX. CALIDAD CONG.", "kg", null],
  ["PULPO P3 SHANDONG26 FAO34 (origen Marruecos, lote 0226)", "kg", null],
  ["Ref. 24*7 ES-ECO-024-MU", "ud", null],
  ["INTE/DIF 6KA 30MA 1P+N 10A OPW1N10C030A", "ud", null],
  ["FUENTE OVAL STOLT Ø 26,5x13 CM (12) VITROPORCELANA", "ud", null],
  ["T-4240MP Amplificador de megafonía 4 x 240W", "ud", null],
  ["Ximenez Spinola Brandy 10000 Botellas 70 cl.", "botella", "0.7 l"],
  ["VIEIRA PACIFICO M/C 20/30", "kg", null],
  ["Jamón Bellota 100% Ibérico 5,0-10 kg N24", "pieza", null],
  ["GAMBON REBOZADO XXL (C/2K- 45U aprox) -Gegarri-", "caja", "2 kg"],
  ["LA-REBOZUELO SILVESTRE A GRANEL C/3KG", "caja", "3 kg"],
  ["BEEFEATER 70 CL.", "botella", "0.7 l"],
  ["HELADO MAGNUM ALMENDRA", "caja", null],
  ["1.000 g", "ud", null],
];
for (const [nombre, unidad, esperado] of CONTRA) igual(await linea(nombre, unidad), esperado, `contraejemplo: ${nombre} [${unidad}]`);
// «C/15UD» con cantidad múltiplo: el precio ya es por unidad (20261010160000).
igual(await linea("(C)OK-TATAKI DE CHULETA PREMIUM LIMPIO C/15 UD", "ud", 30), null, "C/15 UD múltiplo");
igual(await linea("(C)OK-TATAKI DE CHULETA PREMIUM LIMPIO C/15 UD", "ud", 2), "15 ud", "C/15 UD no múltiplo");

// ── extraer_contenido (texto suelto) sigue dando lo de 20261008140000 ──
const ec = async (t) => { const r = (await db.query("select cantidad::float8 c, unidad u from public.extraer_contenido($1)", [t])).rows[0]; return r ? `${r.c} ${r.u}` : null; };
for (const [t, e] of [
  ["caja 10 kg", "10 kg"], ["C/2K", "2 kg"], ["MAYONESA ORIGINAL (CUBO 5L) -Hellmanns-", "5 l"], ["5KG", "5 kg"],
  ["750 ml", "0.75 l"], ["500 g", "0.5 kg"], ["24x33cl", "7.92 l"], ["45U", "45 ud"], ["CRUJIENTE (C/45U) Didess", "45 ud"],
  ["LEJIA 5L c/3u", "5 l"], ["1/2 KG", "0.5 kg"], ["ENVASE 2 kg Y 3 L", null], ["NATOP 35mg", null], ["", null],
  ["Buey de mar gallego hembra 1-1.5 kg", null], ["COCA COLA 237 CL. * 24", "5.688 l"], ["W.WHITE LABEL 70CL 40º C6 REF", "0.7 l"],
]) igual(await ec(t), e, `extraer_contenido(«${t}»)`);

// ── envase_texto (litros comprados) ──
const et = async (t) => { const r = (await db.query("select volumen::float8 v, unidad u, unidades::float8 n from public.envase_texto($1)", [t])).rows[0]; return r ? `${r.v} ${r.u} x${r.n}` : null; };
igual(await et("COCA COLA 237 CL. * 24"), "0.237 l x24", "envase_texto 237 CL");
igual(await et("LANJARON VIDRIO RET. 0'50 L. * 20"), "0.5 l x20", "envase_texto 0'50 L");
igual(await et("LCA TDV GASEOSA RET. 24*275 ML"), "0.275 l x24", "envase_texto 24*275 ML");
igual(await et("JUAN GIL NACAR C.x06 BOT.0,75 L ES-ECO-024-MU"), "0.75 l x6", "envase_texto C.x06");
igual(await et("Heineken 1/3 L caja 24"), "0.33 l xnull", "envase_texto 1/3 L (como antes)");
igual(await et("W.JOHNNIE WALKER E/N 70CL 40º C12"), "0.7 l x12", "envase_texto C12 (como antes)");
igual(await et("Aalto MAGNUM 150 cl"), "1.5 l xnull", "envase_texto 150 cl");

// ── Trigger ──
const fila = async (id) => { const r = (await db.query("select contenido_cantidad::float8 c, contenido_unidad u, contenido_origen o from public.productos_factura where id = $1", [id])).rows[0]; return `${r.c} ${r.u} ${r.o}`; };
const alta = async (nombre, unidad, extra = "") => (await db.query(`insert into public.productos_factura (nombre, unidad, cantidad${extra ? ", contenido_cantidad, contenido_unidad" : ""}) values ($1, $2, 3${extra}) returning id`, [nombre, unidad])).rows[0].id;
const a = await alta("COCA COLA 237 CL. * 24", "caja");
igual(await fila(a), "5.688 l texto", "trigger: caja de 24 al insertar");
const b = await alta("COCACOLA LT 33CL REGULAR", "pack");
igual(await fila(b), "null null null", "trigger: pack sin unidades → vacío");
await db.query("update public.productos_factura set unidad = 'lata' where id = $1", [b]);
igual(await fila(b), "0.33 l texto", "trigger: al cambiar la unidad se vuelve a leer");
const c = await alta("COCA COLA 237 CL. * 24", "caja", ", 7, 'l'");
igual(await fila(c), "7 l manual", "trigger: lo puesto a mano no se pisa");
await db.query("update public.productos_factura set nombre = nombre || ' ' where id = $1", [c]);
igual(await fila(c), "7 l manual", "trigger: ni al renombrar");

// ── Rollback y vuelta a aplicar ──
await db.exec(RB);
igual(await antes("COCA COLA 237 CL. * 24"), { c: 2.37, u: "l" }, "rollback: vuelve la lectura de antes");
igual((await db.query("select to_regprocedure('public.contenido_linea(text,text,numeric)') is null as f")).rows[0].f, true, "rollback: quita contenido_linea");
const d = await alta("COCA COLA 237 CL. * 24", "caja");
igual(await fila(d), "2.37 l texto", "rollback: el trigger vuelve a ser el de antes");
await db.exec(MIG);
igual(await linea("COCA COLA 237 CL. * 24", "caja"), "5.688 l", "se puede volver a aplicar");

if (fallos.length) { console.error(fallos.join(String.fromCharCode(10))); process.exit(1); }
console.log(`test-ocr-contenido-packs: OK (${comprobaciones} comprobaciones)`);
