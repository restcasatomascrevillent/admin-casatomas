// Facturas › Márgenes con IVA o sin IVA (11/11/2026). Petición del dueño: «Que para márgenes y
// facturas tenga la capacidad de calcular con bases imponibles, antes de impuestos y después de
// impuestos, y que salgan como avisos explicándolos para tontos».
//
// Acordado con él:
//   · Venta: el IVA de la carta (`config.ivaPct`, 10 %) para todo lo que se sirve en el
//     restaurante, comida y bebida. La tienda (vino para llevar, 21 %) no sale en esta pantalla.
//   · Compra: el IVA que pone cada factura. Si la RPC lo trae (`iva_compra_pct`, `coste_iva`,
//     `compra_kg_iva` e `iva_pct` de cada ingrediente) se usa ese; si no, el habitual (10 % la
//     comida, 21 % el vino) y se dice que es «supuesto».
//
// Rojo o no rojo lo decide la base de datos (las banderas) y no cambia con el conmutador: aquí cada
// cifra se pasa a la cuenta elegida y el umbral también, para que la comparación sea la misma.
// Sin React: se prueba suelto.
import {
  euros,
  eurosKg,
  fmt,
  porcentaje,
  precioCompra,
  razon,
  type ArticuloMargen,
  type ConfigMargenes,
  type Ingrediente,
  type MargenesCarta,
  type VinoMargen,
} from "./margenesCarta";

export type ModoIva = "sin" | "con";

/** IVA de compra cuando la factura no lo dice: comida y bebida sin alcohol 10 %, vino 21 %. */
export const IVA_COMPRA_SUPUESTO = { comida: 10, vino: 21 } as const;

export const ETIQUETA_MODO: Record<ModoIva, string> = { sin: "sin IVA", con: "con IVA" };

/** Lo que significa cada cuenta, para tontos (sale debajo del conmutador). */
export const EXPLICACION_MODO: Record<ModoIva, string> = {
  sin: "Sin IVA (base imponible): lo que de verdad ganas. El IVA no es tuyo: el que cobras en la carta se lo das a Hacienda y el que pagas en las compras te lo descuentas.",
  con: "Con IVA: los precios como salen en la carta y en las facturas, con el impuesto dentro (10 % en lo que se sirve en el restaurante; en las compras, el de cada factura).",
};

const factor = (pct: number) => 1 + pct / 100;
const positivo = (n: number | null): number | null => (n !== null && n > 0 ? n : null);

/** Coste de un ingrediente con IVA: el de la RPC, o el sin IVA por su IVA (10 % si no se sabe). */
export function costeIngredienteIva(i: Pick<Ingrediente, "coste" | "costeIva" | "ivaPct">): number | null {
  if (i.costeIva !== null) return i.costeIva;
  return i.coste === null ? null : i.coste * factor(i.ivaPct ?? IVA_COMPRA_SUPUESTO.comida);
}

interface Bases {
  precioSin: number | null;
  precioCon: number | null;
  costeSin: number | null;
  costeCon: number | null;
  ivaSupuesto: boolean;
}

function bases(a: ArticuloMargen, config: ConfigMargenes): Bases {
  if (a.tipo === "peso") {
    const iva = a.ivaCompraPct ?? IVA_COMPRA_SUPUESTO.comida;
    const precioSin = positivo(a.ventaKg);
    return {
      precioSin,
      precioCon: positivo(a.ventaKgIva) ?? (precioSin === null ? null : precioSin * factor(config.ivaPct)),
      costeSin: a.compraKg,
      costeCon: a.compraKg === null ? null : a.compraKgIva ?? a.compraKg * factor(iva),
      ivaSupuesto: a.ivaSupuesto,
    };
  }
  if (a.tipo === "vino") {
    const iva = a.ivaCompraPct ?? IVA_COMPRA_SUPUESTO.vino;
    return {
      precioSin: positivo(a.venta),
      precioCon: positivo(a.precio),
      costeSin: a.coste,
      costeCon: a.coste === null ? null : a.costeIva ?? a.coste * factor(iva),
      ivaSupuesto: a.ivaSupuesto,
    };
  }
  const conCoste = a.ingredientes.filter((i) => i.coste !== null);
  const costeCon =
    a.coste === null
      ? null
      : a.costeIva ??
        (conCoste.length ? conCoste.reduce((s, i) => s + (costeIngredienteIva(i) ?? 0), 0) : a.coste * factor(IVA_COMPRA_SUPUESTO.comida));
  return { precioSin: positivo(a.venta), precioCon: positivo(a.precio), costeSin: a.coste, costeCon, ivaSupuesto: a.ivaSupuesto };
}

/**
 * El mínimo de vinos de la configuración puede ir sobre el precio de CARTA (con IVA, como en la
 * migración 20261115200000) o sobre el precio sin IVA (si la RPC ya da el multiplicador en base).
 * Se deduce de las cifras del propio vino: multiplicador de la RPC × coste / venta sin IVA ≈ 1,10 o 1.
 * Sin cifras, la regla de 20261115200000 (precio de carta).
 */
function escalaVino(a: VinoMargen, config: ConfigMargenes): number {
  const fv = factor(config.ivaPct);
  if (a.multiplicador === null || a.venta === null || a.coste === null || a.venta <= 0 || a.coste <= 0) return fv;
  const k = (a.multiplicador * a.coste) / a.venta;
  return Math.abs(k - fv) < Math.abs(k - 1) ? fv : 1;
}

export interface CifrasIva {
  modo: ModoIva;
  /** Precio de venta (ración, botella o kilo) en esta cuenta. */
  precio: number | null;
  coste: number | null;
  margen: number | null;
  multiplicador: number | null;
  /** Coste entre precio, en %. */
  pct: number | null;
  /** Umbral pasado a esta cuenta: mínimo (×) en vinos y al peso, máximo (%) en platos. */
  limite: number | null;
  /** El mismo umbral en % de coste (gráfica y explicación). */
  limitePct: number | null;
  /** IVA de compra efectivo (%): coste con IVA / coste sin IVA. En platos con varios ingredientes, la media. */
  ivaCompraPct: number | null;
  ivaCompraSupuesto: boolean;
  /** Precio con IVA (de carta) y sin IVA, sea cual sea la cuenta (para los textos). */
  precioCarta: number | null;
  precioBase: number | null;
  costeSinIva: number | null;
  costeConIva: number | null;
  porKilo: boolean;
}

export function cifrasIva(a: ArticuloMargen, modo: ModoIva, config: ConfigMargenes): CifrasIva {
  const b = bases(a, config);
  const precio = modo === "sin" ? b.precioSin : b.precioCon;
  const coste = modo === "sin" ? b.costeSin : b.costeCon;
  const hay = precio !== null && coste !== null;
  const ivaCompraPct =
    b.costeSin !== null && b.costeSin > 0 && b.costeCon !== null ? Math.round((b.costeCon / b.costeSin - 1) * 1000) / 10 : null;
  // Pasar de sin IVA a con IVA: el precio sube con el IVA de venta y el coste con el de compra.
  // multiplicador con IVA = multiplicador sin IVA × paso; % de coste con IVA = % sin IVA / paso.
  const ivaC = ivaCompraPct ?? (a.tipo === "vino" ? IVA_COMPRA_SUPUESTO.vino : IVA_COMPRA_SUPUESTO.comida);
  const paso = modo === "sin" ? 1 : factor(config.ivaPct) / factor(ivaC);
  let limite: number;
  let limitePct: number;
  if (a.tipo === "plato") {
    limitePct = config.costeMaxPlatoPct / paso;
    limite = limitePct;
  } else {
    const minSinIva = a.tipo === "peso" ? config.multiplicadorMinPeso : config.multiplicadorMinVino / escalaVino(a, config);
    limite = minSinIva * paso;
    limitePct = 100 / limite;
  }
  return {
    modo,
    precio,
    coste,
    margen: hay ? precio - coste : null,
    multiplicador: hay && coste > 0 ? precio / coste : null,
    pct: hay ? (coste / precio) * 100 : null,
    limite,
    limitePct,
    ivaCompraPct,
    ivaCompraSupuesto: b.ivaSupuesto,
    precioCarta: b.precioCon,
    precioBase: b.precioSin,
    costeSinIva: b.costeSin,
    costeConIva: b.costeCon,
    porKilo: a.tipo === "peso",
  };
}

const x = (n: number | null) => (n === null ? "—" : `×${fmt(n, 2)}`);
/** «IVA 21 %», «IVA 10 %, supuesto», «IVA 9,8 % de media». */
export function textoIvaCompra(c: Pick<CifrasIva, "ivaCompraPct" | "ivaCompraSupuesto">, varios = false): string {
  if (c.ivaCompraPct === null) return "IVA de compra sin datos";
  const pct = fmt(c.ivaCompraPct, Number.isInteger(c.ivaCompraPct) ? 0 : 1);
  return `IVA ${pct} %${varios ? " de media" : ""}${c.ivaCompraSupuesto ? ", supuesto" : ""}`;
}

/** Precio de compra de un ingrediente en la cuenta elegida: «110 €/kg sin IVA», «121 €/kg con IVA». */
export function precioCompraModo(i: Ingrediente, modo: ModoIva): string {
  if (i.eur === null) return "sin compras";
  const eur = modo === "sin" ? i.eur : i.eur * factor(i.ivaPct ?? IVA_COMPRA_SUPUESTO.comida);
  return `${precioCompra({ ...i, eur: Math.round(eur * 100) / 100 })} ${ETIQUETA_MODO[modo]}`;
}

export const costeIngredienteModo = (i: Ingrediente, modo: ModoIva) => (modo === "sin" ? i.coste : costeIngredienteIva(i));

/**
 * El porqué en la cuenta elegida, diciendo en cada cifra si lleva IVA:
 *   «Percebes: lo compras a 110,00 €/kg sin IVA y lo vendes a 172,73 €/kg sin IVA (190 €/kg en carta) → ×1,57, 64 % de coste.»
 *   «Percebes: lo compras a 121,00 €/kg con IVA (IVA 10 %) y en carta lo vendes a 190 €/kg con IVA → ×1,57, 64 % de coste.»
 * Sin coste o sin precio, el motivo de siempre (`razon`).
 */
export function razonIva(a: ArticuloMargen, config: ConfigMargenes, modo: ModoIva): string {
  const c = cifrasIva(a, modo, config);
  if (c.coste === null || c.precio === null) return razon(a, config);
  const et = ETIQUETA_MODO[modo];
  const varios = a.tipo === "plato" && a.ingredientes.filter((i) => i.coste !== null).length > 1;
  const ivaCompra = modo === "con" ? ` (${textoIvaCompra(c, varios)})` : "";
  const partes: string[] = [];
  if (a.tipo === "peso") {
    partes.push(
      modo === "sin"
        ? `${a.nombre}: lo compras a ${eurosKg(c.coste, 2)} sin IVA y lo vendes a ${eurosKg(c.precio, 2)} sin IVA (${eurosKg(c.precioCarta)} en carta)` +
            ` → ${x(c.multiplicador)}, ${porcentaje(c.pct)} de coste`
        : `${a.nombre}: lo compras a ${eurosKg(c.coste, 2)} con IVA${ivaCompra} y en carta lo vendes a ${eurosKg(c.precio)} con IVA` +
            ` → ${x(c.multiplicador)}, ${porcentaje(c.pct)} de coste`,
    );
  } else if (a.tipo === "vino") {
    partes.push(
      modo === "sin"
        ? `${a.nombre}: la botella te cuesta ${euros(c.coste)} sin IVA y la vendes a ${euros(c.precio)} sin IVA (${euros(c.precioCarta)} en carta)` +
            ` → ${x(c.multiplicador)} (mínimo ${x(c.limite)})`
        : `${a.nombre}: la botella te cuesta ${euros(c.coste)} con IVA${ivaCompra} y en carta la vendes a ${euros(c.precio)}` +
            ` → ${x(c.multiplicador)} (mínimo ${x(c.limite)})`,
    );
  } else {
    const unico = a.ingredientes.length === 1 ? a.ingredientes[0] : null;
    if (unico && unico.unidad !== "ud" && a.gramosVenta && unico.eur !== null && unico.cantidad === a.gramosVenta) {
      const ventaKg = (c.precio / a.gramosVenta) * 1000;
      partes.push(`${a.nombre}: cuesta ${precioCompraModo(unico, modo)} y se vende a ${euros(ventaKg)}/${unico.medida ?? "kg"} ${et} → ${porcentaje(c.pct)} de coste`);
    } else {
      partes.push(
        `${a.nombre}: el coste ${et} (${euros(c.coste)}) es el ${porcentaje(c.pct)} de lo que cobras ${et} (${euros(c.precio)})` +
          (a.principal && a.ingredientes.length > 1 ? `; lo que más pesa, ${a.principal}` : ""),
      );
    }
  }
  if (a.banderas.includes("sube_coste") && a.variacionPct !== null) {
    partes.push(`el coste ha subido un ${porcentaje(a.variacionPct)} en 6 meses y la carta sigue igual`);
  }
  if (a.banderas.includes("incompleto")) partes.push("falta el coste de algún ingrediente");
  return partes.join("; ") + ".";
}

/**
 * Para tontos: «De cada 100 € que cobras sin IVA, 64 € se van en comprarlo y te quedan 36 € para
 * todo lo demás (sueldos, local, luz…). Lo recomendable es que se vayan menos de 50 €.»
 */
export function explicacionIva(a: ArticuloMargen, config: ConfigMargenes, modo: ModoIva): string | null {
  const c = cifrasIva(a, modo, config);
  if (c.pct === null || c.limitePct === null) return null;
  const van = Math.round(c.pct);
  const quedan = 100 - van;
  const en = a.tipo === "plato" ? "en sus ingredientes" : a.tipo === "vino" ? "en comprar la botella" : "en comprarlo";
  const resto = quedan > 0 ? ` y te quedan ${quedan} € para todo lo demás (sueldos, local, luz…)` : quedan < 0 ? `: pierdes ${-quedan} €` : ": no te queda nada";
  return `De cada 100 € que cobras ${ETIQUETA_MODO[modo]}, ${van} € se van ${en}${resto}. Lo recomendable es que se vayan menos de ${Math.round(c.limitePct)} €.`;
}

/**
 * Qué parte de cada precio es IVA: «En carta cobras 190,00 €/kg: 172,73 € son tuyos y 17,27 € son
 * IVA (10 %), que se lleva Hacienda. Lo compras a 121,00 €/kg: 110,00 € de producto y 11,00 € de
 * IVA (10 %), que te descuentas.»
 */
export function desgloseIva(a: ArticuloMargen, config: ConfigMargenes): string | null {
  const c = cifrasIva(a, "sin", config);
  if (c.precioCarta === null || c.precioBase === null) return null;
  const u = c.porKilo ? "/kg" : "";
  const venta = `En carta cobras ${euros(c.precioCarta)}${u}: ${euros(c.precioBase)} son tuyos y ${euros(c.precioCarta - c.precioBase)} son IVA (${fmt(config.ivaPct, 0)} %), que se lleva Hacienda.`;
  if (c.costeSinIva === null || c.costeConIva === null) return venta;
  const varios = a.tipo === "plato" && a.ingredientes.filter((i) => i.coste !== null).length > 1;
  const que = a.tipo === "plato" ? "Sus ingredientes te cuestan" : a.tipo === "vino" ? "La botella te cuesta" : "Lo compras a";
  return (
    `${venta} ${que} ${euros(c.costeConIva)}${u}: ${euros(c.costeSinIva)} de producto y ${euros(c.costeConIva - c.costeSinIva)} de ` +
    `${textoIvaCompra(c, varios)}, que te descuentas.`
  );
}

// ─── Gráfica y cifras de arriba ───────────────────────────────────────────
export interface PuntoIva {
  id: string;
  nombre: string;
  precio: number;
  pct: number;
  rojo: boolean;
}

/** Puntos de la dispersión en la cuenta elegida: precio de venta (por kilo al peso) frente a % de coste. */
export function puntosDispersionIva(lista: ArticuloMargen[], modo: ModoIva, config: ConfigMargenes): PuntoIva[] {
  return lista.flatMap((a) => {
    const c = cifrasIva(a, modo, config);
    if (c.precio === null || c.pct === null || c.limitePct === null) return [];
    return [{ id: a.id, nombre: a.nombre, precio: c.precio, pct: Math.min(c.pct, 150), rojo: c.pct > c.limitePct }];
  });
}

const mediana = (xs: number[]): number | null => {
  if (xs.length === 0) return null;
  const o = [...xs].sort((p, q) => p - q);
  const m = Math.floor(o.length / 2);
  return o.length % 2 ? o[m] : (o[m - 1] + o[m]) / 2;
};

/**
 * Línea roja de la gráfica (% de coste): la mediana de los umbrales de cada artículo en la cuenta
 * elegida (con IVA cambia un poco con el IVA de compra de cada uno). Sin datos, `porDefecto`.
 */
export function umbralGraficaIva(lista: ArticuloMargen[], modo: ModoIva, config: ConfigMargenes, porDefecto: number): number {
  const ls = lista.flatMap((a) => {
    const c = cifrasIva(a, modo, config);
    return c.pct !== null && c.limitePct !== null ? [c.limitePct] : [];
  });
  return mediana(ls) ?? porDefecto;
}

/** Medianas de las cifras de arriba en la cuenta elegida (al peso y vinos, lo comparable). */
export function medianasIva(d: Pick<MargenesCarta, "peso" | "vinos" | "config">, modo: ModoIva) {
  const peso = d.peso.map((a) => cifrasIva(a, modo, d.config));
  const vinos = d.vinos.map((a) => cifrasIva(a, modo, d.config));
  const de = (cs: CifrasIva[], k: "multiplicador" | "pct") => mediana(cs.flatMap((c) => (c[k] === null ? [] : [c[k] as number])));
  return { pesoMultiplicador: de(peso, "multiplicador"), pesoPct: de(peso, "pct"), vinosMultiplicador: de(vinos, "multiplicador") };
}
