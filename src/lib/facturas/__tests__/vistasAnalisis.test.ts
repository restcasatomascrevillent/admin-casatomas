// Facturas › Análisis en una pantalla (07/11/2026): cuentas puras de las vistas.
import { describe, expect, it } from "vitest";
import { normalizarDecision } from "../decision";
import {
  decisionesDeHoy,
  enPeriodo,
  explicarAhorro,
  fraseAhorro,
  geometriaPrecio,
  mesesHasta,
  nombreMes,
  notasComparar,
  partesFraseAhorro,
  proveedorCorto,
  textoDecision,
  VISTA_DE_MODULO,
  VISTAS,
  vistaInicial,
  type MargenDecision,
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
  const margen = (extra: Partial<MargenDecision> = {}): MargenDecision => ({
    id: "mg1", canal: "plato", nombre: "Chuletón", valor: 41, limite: 35, coste: 9.8, fecha: "2026-09-20", local: "casa_tomas",
    precioActual: 26, precioSugerido: 30.5, aplicado: false, enlaceMargenes: "?tab=margenes&articulo=plato:12", ...extra,
  });

  it("solo subidas, más barato en otro proveedor y poco margen (sin familias); por € al mes y con 10 €/mes como mínimo", () => {
    const l = decisionesDeHoy(dec(), [margen()]);
    // Percebe 62 €/mes; berberecho 117 €/90 días = 39 €/mes; el chuletón (margen) al final.
    // Fuera: «Pluma» (sin precios), el melón (2 €/mes) y la familia de congelados.
    expect(l.map((x) => x.tipo)).toEqual(["sube", "mejor", "margen"]);
    expect(Math.round(l[1].eurosMes)).toBe(39);
    expect(decisionesDeHoy(dec(), [], 1)).toHaveLength(1);
    // Un margen ya aplicado no sale.
    expect(decisionesDeHoy(dec(), [margen({ aplicado: true })]).map((x) => x.tipo)).toEqual(["sube", "mejor"]);
  });

  it("subida de 10 % o menos, o de menos de 10 €/mes: no sale", () => {
    const d = dec();
    const s1 = d.cambios.sube[0];
    const poca = { ...s1, alerta: { ...s1.alerta, datos: { ...s1.alerta.datos, precio: 110, precioRef: 100 } } };
    const barata = { ...s1, impactoMes: 9.5 };
    expect(decisionesDeHoy({ ...d, cambios: { ...d.cambios, sube: [poca] } }).map((x) => x.tipo)).toEqual(["mejor"]);
    expect(decisionesDeHoy({ ...d, cambios: { ...d.cambios, sube: [barata] } }).map((x) => x.tipo)).toEqual(["mejor"]);
  });

  it("una subida sin la factura anterior con que compararla (regla de antes: mediana) no sale", () => {
    const d = dec();
    const s1 = d.cambios.sube[0];
    const vieja = { ...s1, alerta: { ...s1.alerta, datos: { ...s1.alerta.datos, fechaRef: null } } };
    expect(decisionesDeHoy({ ...d, cambios: { ...d.cambios, sube: [vieja] } }).map((x) => x.tipo)).toEqual(["mejor"]);
  });

  it("el filtro de fechas cambia TODA la lista: lo de fuera del periodo no sale", () => {
    const d = dec();
    const oct = { ...d, periodo: { ...d.periodo, desde: "2026-10-01", hasta: "2026-10-31" } };
    expect(decisionesDeHoy(oct, [margen()])).toEqual([]);
    expect(enPeriodo(null, oct.periodo)).toBe(true);
  });

  it("el mismo producto sale una vez (el aviso que más dinero mueve), aunque venga en otra unidad", () => {
    const d = dec();
    const s1 = d.cambios.sube[0];
    const otraUnidad = { ...s1, impactoMes: 20, alerta: { ...s1.alerta, id: "s1b", datos: { ...s1.alerta.datos, medida: "ud" } } };
    const l = decisionesDeHoy({ ...d, cambios: { ...d.cambios, sube: [otraUnidad, s1] } });
    expect(l.filter((x) => x.tipo === "sube").map((x) => x.id)).toEqual(["s1"]);
  });

  it("cada aviso en tres líneas: qué pasa / la factura frente a la anterior / cuánto al mes; la media de 90 días, aparte", () => {
    const [sube, mejor, mg] = decisionesDeHoy(dec(), [margen()]);
    const ts = textoDecision(sube);
    expect(ts.titulo).toBe("Percebe te ha subido un 29 % en Cetárea Angelmar.");
    expect(ts.detalle).toBe("Factura del 26/09: 140,00 €/kg. En la anterior (12/09) lo pagabas a 108,50 €/kg.");
    expect(ts.cuanto).toBe("Son unos 62 € más al mes.");
    expect(ts.contexto).toBe("Lo normal en los últimos 90 días: 112,00 €/kg.");
    expect(ts.sinRevisar).toBe(true);
    expect(ts.euros).toBe("+62 €/mes");
    const tm = textoDecision(mejor);
    expect(tm.titulo).toBe("Berberecho: Casimiro Pérez te lo vende más barato.");
    expect(tm.detalle).toBe("Cetárea Angelmar (28/09): 35,50 €/kg. Casimiro Pérez (20/09): 29,00 €/kg.");
    expect(tm.cuanto).toMatch(/^Ahorrarías unos 39 € al mes/);
    expect(tm.sinRevisar).toBe(false);
    const tg = textoDecision(mg);
    expect(tg.titulo).toBe("El plato «Chuletón» te deja poco margen.");
    expect(tg.cuanto).toBe("Para volver a tu límite, ponlo a 30,50 € en la carta.");
    expect(notasComparar(sube)?.map((n) => n.etiqueta)).toEqual(["Factura nueva", "Factura anterior"]);
    expect(notasComparar(sube)?.[1].linea).toBe("PERCEBE GALLEGO G: 108,50 €/kg");
  });

  it("el nombre del proveedor sin «S.L.U.», «S.A.»…", () => {
    expect(proveedorCorto("Francisco José Santacruz Gambín, S.L.U.")).toBe("Francisco José Santacruz Gambín");
    expect(proveedorCorto("MUSGRAVE ESPAÑA, S.A.U.")).toBe("MUSGRAVE ESPAÑA");
    expect(proveedorCorto("Enchenta SLU")).toBe("Enchenta");
    expect(proveedorCorto("CETAREA ANGELMAR S.L.")).toBe("CETAREA ANGELMAR");
    expect(proveedorCorto(null)).toBe("el proveedor");
  });

  it("«comparado» de la RPC (Año, Todo) se sigue leyendo", () => {
    const d = normalizarDecision({ ...RESPUESTA, periodo: { ...RESPUESTA.periodo, meses_equivalentes: 10, comparado: { modo: "ultimo_mes", desde: "2026-09-01", hasta: "2026-09-30" } } });
    expect(d.periodo.comparado).toEqual({ modo: "ultimo_mes", desde: "2026-09-01", hasta: "2026-09-30" });
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
