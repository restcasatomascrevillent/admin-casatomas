// Gráficas de decisión (RPC facturas_decision, 20261115100000): validación de
// la respuesta, cifras del resumen, minigráficas y textos cortos de las alertas.
import { describe, expect, it } from "vitest";
import { detalleAhorro, geometriaMini, normalizarDecision, resumenDecision, textoMesesReferencia, textoPctCorto, tonoVariacion } from "../decision";
import { normalizarAlertas, resumenCortoAlerta, tituloCortoAlerta } from "../alertas";
import { RESPUESTA } from "./decisionRespuesta";


describe("normalizarDecision", () => {
  it("lee la respuesta y descarta lo que no se entiende", () => {
    const d = normalizarDecision(RESPUESTA);
    expect(d.familias).toHaveLength(3);
    expect(d.familias[1]).toMatchObject({ familia: "Congelados", aviso: true, alerta: { id: "a-fam" } });
    expect(d.cambios.sube.map((c) => c.alerta.id)).toEqual(["s1", "s2"]);
    expect(d.cambios.sube[0].doc).toMatchObject({ id: 7, numero: "260489", driveUrl: "https://drive.google.com/file/d/abc/view", tipo: "factura" });
    expect(d.cambios.sube[1].campana).toBe(false);
    // Un documento con total < 0 es un abono.
    expect(d.cambios.mejor[0].docOtro?.tipo).toBe("abono");
    expect(d.top).toHaveLength(1);
    expect(d.top[0].pactado).toEqual({ id: 4, precio: 203.98, unidad: "barril" });
    expect(d.revisarUnidades[0].unidades.map((u) => u.unidad)).toEqual(["pieza", "kg"]);
  });

  it("con basura no rompe", () => {
    const d = normalizarDecision(null);
    expect(d.familias).toEqual([]);
    expect(d.cambios.sube).toEqual([]);
    expect(d.umbrales.campanaMinEur).toBe(10);
  });
});

describe("resumenDecision (las cifras de arriba)", () => {
  it("subidas por € al mes, ahorro en 90 días y familias fuera", () => {
    const r = resumenDecision(normalizarDecision(RESPUESTA));
    expect(r.subidas).toBe(2);
    expect(r.impactoMes).toBeCloseTo(64.51, 2);
    expect(r.subidasCampana).toBe(1);
    expect(r.masBarato).toBe(2);
    expect(r.ahorro90).toBe(219);
    expect(r.familiasFuera.map((f) => f.familia)).toEqual(["Congelados"]);
    expect(r.variacionBasePct).toBeCloseTo(-12.8, 1);
  });
});

describe("«Puedes ahorrar» (10/11/2026: el dueño veía 0 €)", () => {
  it("suma el ahorro de las alertas «más barato en otro proveedor» de la RPC (las de la demo: 101,51 + 117 + 65,56)", () => {
    const mejor = [
      { id: "m1", tipo: "facturas_precio_mejor", titulo: "Pluma de cerdo ibérico: 19 % más barato", datos: { ahorro: "101.51", local: "casa_tomas" } },
      { id: "m2", tipo: "facturas_precio_mejor", titulo: "Berberecho: 18 % más barato", datos: { ahorro: 117, local: "casa_tomas" } },
      { id: "m3", tipo: "facturas_precio_mejor", titulo: "Pimiento del piquillo: 27 % más barato", datos: { ahorro: "65.56", local: "casa_tomas" } },
    ];
    const r = resumenDecision(normalizarDecision({ ...RESPUESTA, cambios: { ...RESPUESTA.cambios, mejor } }));
    expect(r.masBarato).toBe(3);
    expect(r.ahorro90).toBe(284.07);
    expect(detalleAhorro(r)).toBe("cada 90 días · 3 productos");
  });

  it("sin alertas vigentes la cifra es 0 € y el texto dice por qué (antes, «0 productos»)", () => {
    const r = resumenDecision(normalizarDecision({ ...RESPUESTA, cambios: { ...RESPUESTA.cambios, mejor: [] } }));
    expect(r.ahorro90).toBe(0);
    expect(detalleAhorro(r)).toBe("ningún producto más barato en otro proveedor que ya usas");
    expect(detalleAhorro({ masBarato: 1 })).toBe("cada 90 días · 1 producto");
  });
});

describe("textos", () => {
  it("meses de referencia, % y tono", () => {
    expect(textoMesesReferencia(["2026-05", "2026-06", "2026-08"])).toBe("mayo–agosto");
    expect(textoMesesReferencia(["2026-05"])).toBe("mayo de 2026");
    expect(textoMesesReferencia([])).toBeNull();
    expect(textoPctCorto(29)).toBe("+29 %");
    expect(textoPctCorto(-13.2)).toBe("−13 %");
    expect(textoPctCorto(2.5)).toBe("+2,5 %");
    expect(textoPctCorto(null)).toBe("—");
    expect(tonoVariacion(30)).toBe("sube");
    expect(tonoVariacion(-30)).toBe("baja");
    expect(tonoVariacion(3)).toBe("plano");
  });

  it("alertas: título y resumen cortos, sin recortar el mensaje largo (09/11/2026)", () => {
    const [melon] = normalizarAlertas([RESPUESTA.cambios.sube[1]]);
    expect(tituloCortoAlerta(melon)).toBe("Sube Melón piel de sapo +52 %");
    expect(resumenCortoAlerta(melon)).toBe("0,95 €/kg el 02/10 · antes 0,63 · +52 % · 2 € al mes");
    const [mejor] = normalizarAlertas([RESPUESTA.cambios.mejor[0]]);
    expect(resumenCortoAlerta(mejor)).toBe("Cetárea Angelmar → Casimiro Pérez · 35,50 → 29,00 €/kg · 117 € menos en 90 días");
    const [nuevo] = normalizarAlertas(RESPUESTA.cambios.otros);
    expect(resumenCortoAlerta(nuevo)).toBe("Primer documento el 10/10.");
  });
});

describe("geometriaMini", () => {
  it("salta los meses sin compra, marca la alerta y calcula la variación", () => {
    const g = geometriaMini(
      [
        { mes: "2026-05", precio: 65 },
        { mes: "2026-06", precio: null },
        { mes: "2026-07", precio: 75 },
        { mes: "2026-08", precio: 83 },
      ],
      ["2026-08"],
    );
    expect(g.linea.startsWith("M4,38")).toBe(true);
    expect(g.linea.split("L")).toHaveLength(3);
    expect(g.alertas).toEqual([{ x: 146, y: 4, mes: "2026-08" }]);
    expect(g.variacionPct).toBeCloseTo(27.7, 1);
    expect(g.ultimoPrecio).toBe(83);
  });

  it("precio plano y sin datos", () => {
    const g = geometriaMini([{ mes: "a", precio: 10 }, { mes: "b", precio: 10 }], []);
    expect(g.variacionPct).toBe(0);
    expect(geometriaMini([{ mes: "a", precio: null }], []).linea).toBe("");
  });
});
