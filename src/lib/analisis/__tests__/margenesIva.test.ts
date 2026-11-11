import { describe, expect, it } from "vitest";
import { normalizarMargenes } from "../margenesCarta";
import { cifrasIva, desgloseIva, explicacionIva, medianasIva, puntosDispersionIva, razonIva } from "../margenesIva";

// RPC de hoy (20261116100000): el multiplicador de vinos va sobre el precio de carta y no trae el IVA de compra.
const HOY = normalizarMargenes({
  config: { coste_max_plato_pct: 35, multiplicador_min_vino: 2.5, multiplicador_min_peso: 2, subida_coste_pct: 10, iva_pct: 10, dias_referencia: 90 },
  platos: [],
  vinos: [
    { id: "v1", nombre: "Laurent‑Perrier Millésimé", precio: 110, venta: 100, producto_id: 1785, coste: 80.4, multiplicador: 1.37, pct: 80.4, banderas: ["multiplicador_bajo"] },
  ],
  peso: [
    { id: "p1", nombre: "Percebes", precio: 19, unidad: "100 g", gramos_venta: 100, venta_kg_iva: 190, venta_kg: 172.73, producto_id: 301,
      compra_kg: 110, multiplicador: 1.57, pct: 63.68, banderas: ["multiplicador_bajo"] },
    { id: "pb", nombre: "Bogavante", precio: 95, unidad: "kg", gramos_venta: 1000, venta_kg_iva: 95, venta_kg: 86.36, producto_id: 218,
      compra_kg: 25, multiplicador: 3.45, pct: 28.95, banderas: [] },
  ],
});

// RPC que ya trae el IVA de cada factura y el multiplicador de vinos en base (sin IVA / sin IVA).
const CON_IVA_COMPRA = normalizarMargenes({
  config: { coste_max_plato_pct: 35, multiplicador_min_vino: 2.3, multiplicador_min_peso: 2, iva_pct: 10 },
  vinos: [
    { id: "v2", nombre: "Gewurztraminer", precio: 24.5, venta: 22.2727, coste: 16.25, coste_iva: 19.6625, iva_compra_pct: 21, iva_origen: "linea",
      multiplicador: 1.37, pct: 72.96, banderas: ["multiplicador_bajo"] },
  ],
  platos: [
    { id: "a1", nombre: "Arroz meloso de langosta", precio: 32.5, unidad: "Unidad", venta: 29.5455, coste: 15.1379, coste_iva: 16.6434, pct: 51.24,
      principal: "Langosta", banderas: ["coste_alto"],
      ingredientes: [
        { producto_id: 337, producto: "Langosta", cantidad: 250, unidad: "g", medida: "kg", eur: 60, coste: 15, iva_pct: 10, coste_iva: 16.5 },
        { producto_id: 629, producto: "Arroz", cantidad: 80, unidad: "g", medida: "kg", eur: 1.724, coste: 0.1379, iva_pct: 4, coste_iva: 0.1434 },
      ] },
  ],
});

describe("cifras con y sin IVA", () => {
  it("al peso: sin IVA es la cuenta de siempre; con IVA, el kilo de carta y el de compra con su IVA", () => {
    const sin = cifrasIva(HOY.peso[0], "sin", HOY.config);
    expect(sin).toMatchObject({ precio: 172.73, coste: 110, limite: 2, ivaCompraSupuesto: true });
    expect(sin.multiplicador).toBeCloseTo(1.57, 2);
    const con = cifrasIva(HOY.peso[0], "con", HOY.config);
    expect(con.precio).toBe(190);
    expect(con.coste).toBeCloseTo(121, 5);
    expect(con.margen).toBeCloseTo(69, 5);
    // Compra y venta al 10 %: el multiplicador y el límite no cambian.
    expect(con.multiplicador).toBeCloseTo(1.57, 2);
    expect(con.limite).toBeCloseTo(2, 5);
  });

  it("vino con la RPC de hoy: el mínimo (sobre el precio de carta) se pasa a cada cuenta", () => {
    const sin = cifrasIva(HOY.vinos[0], "sin", HOY.config);
    expect(sin.multiplicador).toBeCloseTo(1.24, 2);
    expect(sin.limite).toBeCloseTo(2.5 / 1.1, 5);
    const con = cifrasIva(HOY.vinos[0], "con", HOY.config);
    // Botella al 21 % (supuesto): 80,40 × 1,21 = 97,28 €.
    expect(con.coste).toBeCloseTo(97.284, 3);
    expect(con.multiplicador).toBeCloseTo(1.13, 2);
    expect(con.limite).toBeCloseTo((2.5 / 1.1) * (1.1 / 1.21), 5);
    expect(con.ivaCompraPct).toBe(21);
  });

  it("vino con la RPC en base: el mínimo ya es sin IVA y el coste con IVA viene de la factura", () => {
    const sin = cifrasIva(CON_IVA_COMPRA.vinos[0], "sin", CON_IVA_COMPRA.config);
    expect(sin.limite).toBeCloseTo(2.3, 5);
    const con = cifrasIva(CON_IVA_COMPRA.vinos[0], "con", CON_IVA_COMPRA.config);
    expect(con).toMatchObject({ coste: 19.6625, ivaCompraPct: 21, ivaCompraSupuesto: false });
  });

  it("plato con ingredientes a distinto IVA: coste con IVA de la RPC y el % de coste se compara con su límite", () => {
    const con = cifrasIva(CON_IVA_COMPRA.platos[0], "con", CON_IVA_COMPRA.config);
    expect(con.coste).toBe(16.6434);
    expect(con.pct).toBeCloseTo(51.21, 2);
    expect(con.limite).toBeCloseTo(35 * (1 + (con.ivaCompraPct as number) / 100) / 1.1, 5);
  });
});

describe("textos", () => {
  it("el porqué dice en cada cifra si lleva IVA", () => {
    expect(razonIva(HOY.peso[0], HOY.config, "sin")).toBe(
      "Percebes: lo compras a 110,00 €/kg sin IVA y lo vendes a 172,73 €/kg sin IVA (190 €/kg en carta) → ×1,57, 64 % de coste.",
    );
    expect(razonIva(HOY.peso[0], HOY.config, "con")).toBe(
      "Percebes: lo compras a 121,00 €/kg con IVA (IVA 10 %, supuesto) y en carta lo vendes a 190 €/kg con IVA → ×1,57, 64 % de coste.",
    );
    expect(razonIva(HOY.vinos[0], HOY.config, "sin")).toBe(
      "Laurent‑Perrier Millésimé: la botella te cuesta 80,40 € sin IVA y la vendes a 100,00 € sin IVA (110,00 € en carta) → ×1,24 (mínimo ×2,27).",
    );
    expect(razonIva(CON_IVA_COMPRA.platos[0], CON_IVA_COMPRA.config, "con")).toMatch(
      /^Arroz meloso de langosta: el coste con IVA \(16,64 €\) es el 51 % de lo que cobras con IVA \(32,50 €\); lo que más pesa, Langosta\.$/,
    );
  });

  it("para tontos: de cada 100 € y qué parte es IVA", () => {
    expect(explicacionIva(HOY.peso[0], HOY.config, "sin")).toBe(
      "De cada 100 € que cobras sin IVA, 64 € se van en comprarlo y te quedan 36 € para todo lo demás (sueldos, local, luz…). Lo recomendable es que se vayan menos de 50 €.",
    );
    expect(desgloseIva(HOY.peso[0], HOY.config)).toBe(
      "En carta cobras 190,00 €/kg: 172,73 € son tuyos y 17,27 € son IVA (10 %), que se lleva Hacienda. " +
        "Lo compras a 121,00 €/kg: 110,00 € de producto y 11,00 € de IVA 10 %, supuesto, que te descuentas.",
    );
  });
});

describe("gráfica y cifras de arriba", () => {
  it("los puntos y las medianas siguen la cuenta elegida", () => {
    expect(puntosDispersionIva(HOY.peso, "sin", HOY.config).map((p) => [p.id, p.precio, p.rojo])).toEqual([["p1", 172.73, true], ["pb", 86.36, false]]);
    expect(puntosDispersionIva(HOY.peso, "con", HOY.config).map((p) => p.precio)).toEqual([190, 95]);
    const m = medianasIva(HOY, "sin");
    expect(m.pesoMultiplicador).toBeCloseTo(2.51, 2);
    expect(m.vinosMultiplicador).toBeCloseTo(1.24, 2);
  });
});
