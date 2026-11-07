// Facturas › Análisis en una pantalla (07/11/2026): cuentas puras de las vistas.
import { describe, expect, it } from "vitest";
import { normalizarDecision } from "../decision";
import {
  decisionesDeHoy,
  explicarAhorro,
  fraseAhorro,
  geometriaPrecio,
  mesesHasta,
  nombreMes,
  partesFraseAhorro,
  VISTA_DE_MODULO,
  VISTAS,
  vistaInicial,
} from "../vistasAnalisis";
import { MODULOS } from "../widgetsTablero";
import { RESPUESTA } from "./decisionRespuesta";

const dec = () => normalizarDecision(RESPUESTA);

describe("vistas", () => {
  it("siete vistas, «Qué decidir hoy» por defecto; la de la URL manda sobre la recordada", () => {
    expect(VISTAS.map((v) => v.etiqueta)).toEqual(["Qué decidir hoy", "Precios", "Ahorro", "Gasto", "Proveedores", "Explorar", "Por revisar"]);
    expect(vistaInicial(new URLSearchParams(), null)).toBe("decidir");
    expect(vistaInicial(new URLSearchParams(), "gasto")).toBe("gasto");
    expect(vistaInicial(new URLSearchParams("vista=precios"), "gasto")).toBe("precios");
    // Lo que no es una vista, no vale.
    expect(vistaInicial(new URLSearchParams("vista=bento"), "nada")).toBe("decidir");
  });

  it("todo módulo del configurador tiene sitio: en su vista o como contenido fijo de una", () => {
    const fijos = new Set(["explorar", "subidas", "ahorro", "familias"]);
    for (const m of MODULOS) expect(fijos.has(m.id) || !!VISTA_DE_MODULO[m.id]).toBe(true);
    expect(VISTA_DE_MODULO.gasto_mes).toBe("decidir");
    expect(VISTA_DE_MODULO.locales).toBe("proveedores");
  });
});

describe("Qué decidir hoy", () => {
  it("las 5 que más dinero mueven, mezcladas y ordenadas por € al mes", () => {
    const l = decisionesDeHoy(dec());
    // Congelados: +428 € en el mes; percebe 62 €/mes; berberecho 117 €/90 días = 39 €/mes; pluma 34; melón 2.
    expect(l.map((x) => x.tipo)).toEqual(["familia", "sube", "mejor", "mejor", "sube"]);
    expect(l[0]).toMatchObject({ tipo: "familia", exceso: 428 });
    expect(Math.round(l[2].eurosMes)).toBe(39);
    expect(decisionesDeHoy(dec(), 2)).toHaveLength(2);
  });

  it("con «Año» (último mes completo) la familia se cuenta por mes, no dividida por todo el año", () => {
    const d = normalizarDecision({ ...RESPUESTA, periodo: { ...RESPUESTA.periodo, meses_equivalentes: 10, comparado: { modo: "ultimo_mes", desde: "2026-09-01", hasta: "2026-09-30" } } });
    expect(d.periodo.comparado).toEqual({ modo: "ultimo_mes", desde: "2026-09-01", hasta: "2026-09-30" });
    expect(decisionesDeHoy(d)[0]).toMatchObject({ tipo: "familia", eurosMes: 428 });
    // Sin «comparado» (RPC de antes): null.
    expect(dec().periodo.comparado).toBeNull();
  });
});

describe("¿Dónde puedo ahorrar? explicado", () => {
  it("la cantidad sale de ahorro / diferencia de precio y la frase lo cuenta", () => {
    const a = explicarAhorro(dec().cambios.mejor[0]);
    expect(a).toMatchObject({ producto: "Berberecho", proveedor: "Cetárea Angelmar", precio: 35.5, proveedorOtro: "Casimiro Pérez", precioOtro: 29, ahorro: 117, cantidad: 18, pct: 18, medida: "kg" });
    expect(fraseAhorro(a)).toBe("Compraste 18 kg en 90 días. A 29,00 € en lugar de 35,50 € habrías pagado 117 € menos.");
    expect(partesFraseAhorro(a)[1]).toBe("habrías pagado 117 € menos");
  });

  it("sin precios no se inventa la cantidad", () => {
    const a = explicarAhorro(dec().cambios.mejor[1]);
    expect(a.cantidad).toBeNull();
    expect(fraseAhorro(a)).toBe("En 90 días habrías pagado 102 € menos comprándolo al proveedor más barato que ya usas.");
  });
});

describe("gráfica de precio", () => {
  it("línea por mes saltando los huecos, con la raya de referencia dentro", () => {
    const g = geometriaPrecio([{ mes: "2026-08", precio: 10 }, { mes: "2026-09", precio: null }, { mes: "2026-10", precio: 14 }], 11);
    expect(g?.puntos.map((p) => p.mes)).toEqual(["2026-08", "2026-10"]);
    expect(g?.linea.startsWith("M")).toBe(true);
    expect(g?.yReferencia).not.toBeNull();
    expect(g!.yReferencia!).toBeGreaterThan(g!.puntos[1].y); // 11 queda por debajo de 14
    expect(g?.meses).toHaveLength(3);
    expect(geometriaPrecio([{ mes: "2026-08", precio: null }], 5)).toBeNull();
  });

  it("los 6 meses hasta una fecha y el nombre del mes", () => {
    expect(mesesHasta("2026-02-14", 4)).toEqual(["2025-11", "2025-12", "2026-01", "2026-02"]);
    expect(nombreMes("2026-09-01")).toBe("septiembre");
  });
});
