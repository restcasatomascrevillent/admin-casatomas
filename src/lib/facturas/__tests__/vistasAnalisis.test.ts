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
  proveedorCorto,
  textoDecision,
  VISTA_DE_MODULO,
  VISTAS,
  vistaInicial,
} from "../vistasAnalisis";
import { MODULOS } from "../widgetsTablero";
import { RESPUESTA } from "./decisionRespuesta";

const dec = () => normalizarDecision(RESPUESTA);

describe("vistas", () => {
  it("seis vistas, «Qué decidir hoy» por defecto; la de la URL manda sobre la recordada", () => {
    expect(VISTAS.map((v) => v.etiqueta)).toEqual(["Qué decidir hoy", "Precios", "Ahorro", "Gasto", "Proveedores", "Por revisar"]);
    expect(vistaInicial(new URLSearchParams(), null)).toBe("decidir");
    expect(vistaInicial(new URLSearchParams(), "gasto")).toBe("gasto");
    expect(vistaInicial(new URLSearchParams("vista=precios"), "gasto")).toBe("precios");
    // Lo que no es una vista, no vale.
    expect(vistaInicial(new URLSearchParams("vista=bento"), "nada")).toBe("decidir");
    // «Explorar» ya no existe: cae en la vista por defecto.
    expect(vistaInicial(new URLSearchParams("vista=explorar"), null)).toBe("decidir");
    expect(vistaInicial(new URLSearchParams(), "explorar")).toBe("decidir");
  });

  it("todo módulo del configurador tiene sitio: en su vista o como contenido fijo de una", () => {
    const fijos = new Set(["subidas", "ahorro", "familias"]);
    for (const m of MODULOS) expect(fijos.has(m.id) || !!VISTA_DE_MODULO[m.id]).toBe(true);
    expect(VISTA_DE_MODULO.gasto_mes).toBe("decidir");
    expect(VISTA_DE_MODULO.locales).toBe("proveedores");
  });
});

describe("Qué decidir hoy", () => {
  it("las que más dinero mueven, mezcladas y ordenadas por € al mes; sin datos o con menos de 3 €/mes no salen", () => {
    const l = decisionesDeHoy(dec());
    // Congelados: +428 € en el mes; percebe 62 €/mes; berberecho 117 €/90 días = 39 €/mes.
    // Fuera: «Pluma» (sin precios) y el melón (2 €/mes).
    expect(l.map((x) => x.tipo)).toEqual(["familia", "sube", "mejor"]);
    expect(l[0]).toMatchObject({ tipo: "familia", exceso: 428 });
    expect(Math.round(l[2].eurosMes)).toBe(39);
    expect(decisionesDeHoy(dec(), 2)).toHaveLength(2);
  });

  it("una subida sin la factura anterior con que compararla (regla de antes: mediana) no sale", () => {
    const d = dec();
    const s1 = d.cambios.sube[0];
    const vieja = { ...s1, alerta: { ...s1.alerta, datos: { ...s1.alerta.datos, fechaRef: null } } };
    expect(decisionesDeHoy({ ...d, cambios: { ...d.cambios, sube: [vieja] } }).map((x) => x.tipo)).toEqual(["familia", "mejor"]);
  });

  it("textos para todos: qué ha pasado (con la factura y la anterior), por qué importa y qué hacer", () => {
    const [fam, sube, mejor] = decisionesDeHoy(dec());
    const ts = textoDecision(sube, null);
    expect(ts.titulo).toBe("Percebe ha subido un 29 % en Cetárea Angelmar");
    expect(ts.quePasa).toBe("En la factura del 03/10 lo pagaste a 140,00 €/kg. En la anterior (19/09) estaba a 108,50 €/kg: 31,50 € más por cada kilo.");
    expect(ts.porQue).toBe("Compras unos 2,3 kg al mes: te cuesta unos 62 € más al mes.");
    expect(ts.queHacer).toMatch(/^Pregunta a Cetárea Angelmar por qué ha subido/);
    expect(ts.euros).toBe("+62 €/mes");
    const tm = textoDecision(mejor, null);
    expect(tm.titulo).toBe("Berberecho: Casimiro Pérez te lo vende más barato");
    expect(tm.quePasa).toBe("En tu última factura de Cetárea Angelmar (10/10) lo pagaste a 35,50 €/kg. Casimiro Pérez, en su última factura (29/09), te lo cobró a 29,00 €/kg: 6,50 € menos por cada kilo.");
    expect(tm.porQue).toBe("En los últimos 90 días compraste unos 18 kg: habrías ahorrado unos 117 €.");
    const tf = textoDecision(fam, "septiembre");
    expect(tf.titulo).toBe("Congelados: gastas más de lo normal");
    expect(tf.quePasa).toMatch(/^En septiembre has gastado .* € en congelados\. Lo normal \(la media de los meses anteriores\) es .* €: son 428 € más/);
  });

  it("el nombre del proveedor sin «S.L.U.», «S.A.»…", () => {
    expect(proveedorCorto("Francisco José Santacruz Gambín, S.L.U.")).toBe("Francisco José Santacruz Gambín");
    expect(proveedorCorto("MUSGRAVE ESPAÑA, S.A.U.")).toBe("MUSGRAVE ESPAÑA");
    expect(proveedorCorto("Enchenta SLU")).toBe("Enchenta");
    expect(proveedorCorto("CETAREA ANGELMAR S.L.")).toBe("CETAREA ANGELMAR");
    expect(proveedorCorto(null)).toBe("el proveedor");
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
