import { describe, expect, it, vi } from "vitest";
import { construirInformeCheques, fmtEuros, type FilaInformeCheque, type InformeCheques } from "../modelo";
import { periodoInforme, periodoPorDefecto, periodosSeleccionables } from "../periodo";

vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc: vi.fn() } }));

const fila = (creado: string, importe: number, extra: Partial<FilaInformeCheque> = {}): FilaInformeCheque => ({
  creado: creado.length === 10 ? `${creado}T12:00:00` : creado,
  importe_eur: importe,
  gastos_gestion_eur: 0,
  stripe_fee_eur: null,
  canal: "web",
  estado: "pagado",
  canjeado: null,
  caduca_el: null,
  ...extra,
});

describe("periodos del informe de cheques", () => {
  it("un mes cerrado se compara con el mes anterior entero", () => {
    const p = periodoInforme("2026-10", "2026-11-10");
    expect([p.desde, p.hasta, p.desdeAnterior, p.hastaAnterior, p.enCurso]).toEqual(["2026-10-01", "2026-10-31", "2026-09-01", "2026-09-30", false]);
    expect(p.nombre).toBe("octubre 2026");
    expect(p.descripcion).toBe("Del 1 al 31 de octubre de 2026 · comparado con septiembre");
  });

  it("el mes en curso incluye hoy y se compara con los mismos días del mes anterior", () => {
    const p = periodoInforme("2026-11", "2026-11-10");
    expect([p.hasta, p.hastaAnterior, p.enCurso, p.dias]).toEqual(["2026-11-10", "2026-10-10", true, 10]);
    // Del 31 de marzo: febrero no tiene día 31.
    expect(periodoInforme("2026-03", "2026-03-31").hastaAnterior).toBe("2026-02-28");
  });

  it("un año en curso se compara con el mismo tramo del anterior", () => {
    const p = periodoInforme("2026", "2026-11-10");
    expect([p.desde, p.hasta, p.desdeAnterior, p.hastaAnterior, p.tipo]).toEqual(["2026-01-01", "2026-11-10", "2025-01-01", "2025-11-10", "anio"]);
    expect(periodoInforme("2025", "2026-11-10").hastaAnterior).toBe("2024-12-31");
  });

  it("rechaza claves no válidas o futuras y ofrece meses y años", () => {
    expect(() => periodoInforme("2026-13", "2026-11-10")).toThrow();
    expect(() => periodoInforme("2026-12", "2026-11-10")).toThrow();
    const opciones = periodosSeleccionables("2026-11-10");
    expect(opciones[0]).toEqual({ clave: "2026-11", etiqueta: "Noviembre 2026 (en curso)", tipo: "mes" });
    expect(opciones.filter((o) => o.tipo === "anio").map((o) => o.clave)).toEqual(["2026", "2025", "2024"]);
    expect(periodoPorDefecto("2026-11-10")).toBe("2026-10");
  });
});

describe("construirInformeCheques", () => {
  const periodo = periodoInforme("2026-10", "2026-11-10");
  const datos = {
    cheques: [
      // Septiembre (periodo anterior): 2 ventas de 50 €.
      fila("2026-09-05", 50, { stripe_fee_eur: 1 }),
      fila("2026-09-20", 50, { canal: "manual" }),
      // Octubre: 3 ventas (2 web, 1 restaurante) + una cortesía + un reembolso.
      fila("2026-10-03T20:15:00", 100, { gastos_gestion_eur: 1.78, stripe_fee_eur: 1.78, caduca_el: "2027-10-03" }),
      fila("2026-10-10", 50, { caduca_el: "2027-10-10" }),
      fila("2026-10-10", 25, { canal: "manual", canjeado: "2026-10-30T21:00:00", caduca_el: "2027-10-10" }),
      fila("2026-10-12", 40, { canal: "cortesia" }),
      fila("2026-10-15", 75, { estado: "reembolsado" }),
      // Vendido antes, canjeado en octubre; y uno que caduca en octubre sin canjear.
      fila("2025-12-01", 60, { canjeado: "2026-10-05T14:00:00", caduca_el: "2026-12-01" }),
      fila("2025-10-14", 30, { caduca_el: "2026-10-14" }),
      // Pendiente que caduca pronto (en los 60 días siguientes al cierre).
      fila("2025-12-15", 20, { caduca_el: "2026-12-15" }),
      // Noviembre: fuera del periodo.
      fila("2026-11-02", 500),
    ],
  };
  const informe = construirInformeCheques(datos, periodo) as InformeCheques;

  it("cuenta ventas sin cortesías ni reembolsos y compara con el periodo anterior", () => {
    expect(informe.vacio).toBe(false);
    expect(informe.resumen.vendido.valor).toBe(175);
    expect(informe.resumen.vendido.anterior).toBe(100);
    expect(informe.resumen.vendido.variacion?.valor).toBeCloseTo(75);
    expect(informe.resumen.vendidos.valor).toBe(3);
    expect(informe.resumen.ticketMedio.valor).toBeCloseTo(58.33, 2);
    expect(informe.resumen.titular).toBe("3 cheques vendidos por 175\u00A0€, un 75,0\u00A0% más que en septiembre");
  });

  it("separa cobros web (con gastos y comisión real o estimada), restaurante, cortesías y reembolsos", () => {
    const { web, manual, cortesia, reembolsos, cobradoTotal, canales } = informe.cobros;
    // 101,78 + 50 cobrados; comisión 1,78 real + (50 × 1,5 % + 0,25 = 1) estimada.
    expect(web).toEqual({ cheques: 2, cobrado: 151.78, gastos: 1.78, comision: 2.78, neto: 149, comisionEstimada: true });
    expect([manual, cortesia, reembolsos]).toEqual([{ cheques: 1, importe: 25 }, { cheques: 1, importe: 40 }, { cheques: 1, importe: 75 }]);
    expect(cobradoTotal).toBe(176.78);
    expect(canales.map((c) => [c.nombre, c.visitas, c.destacado])).toEqual([["Web (Stripe)", 150, true], ["Cortesía (regalo)", 40, false], ["En el restaurante", 25, false]]);
    expect(informe.notas.some((n) => n.includes("se estima"))).toBe(true);
  });

  it("canjes del periodo (aunque se vendieran antes), pendientes al cierre y caducidad", () => {
    const { canjeados, pendiente, caducanPronto, caducadosSinCanjear, diasMediosHastaCanje } = informe.canjes;
    expect([canjeados.cheques, canjeados.valor]).toEqual([2, 85]);
    // Pendientes al 31/10: 50 + 50 (septiembre, sin caducidad) + 100 + 50 (octubre) + 20 (diciembre 2025).
    // No: el canjeado, el caducado, la cortesía, el reembolso ni noviembre.
    expect([pendiente.cheques, pendiente.valor]).toEqual([5, 270]);
    // Al cierre de septiembre: 50 + 50 + 60 + 30 + 20.
    expect(pendiente.anterior).toBe(210);
    expect(caducanPronto).toEqual({ cheques: 1, importe: 20, dias: 60 });
    expect(caducadosSinCanjear).toEqual({ cheques: 1, importe: 30 });
    // 20 días (25 €) y 308 días (60 €).
    expect(diasMediosHastaCanje).toBe(164);
  });

  it("evolución acumulada por día del mes, con el mes anterior por debajo", () => {
    const { puntos, mejorDia, tipo } = informe.evolucion;
    expect(tipo).toBe("acumulado");
    expect(puntos).toHaveLength(31);
    expect(puntos[2]).toMatchObject({ dia: 3, actual: 100 });
    expect(puntos[9]).toMatchObject({ dia: 10, actual: 175 });
    // Septiembre no tiene día 31: ese punto no lleva valor anterior.
    expect(puntos[30]).toMatchObject({ dia: 31, actual: 175, anterior: null });
    expect(puntos[29].anterior).toBe(100);
    expect(mejorDia?.fecha).toBe("2026-10-03");
    expect(informe.evolucion.titular).toBe("El día de más ventas fue el sábado 3 de octubre, con 100\u00A0€");
  });

  it("días de la semana, importes más vendidos y conclusiones", () => {
    expect(informe.diasSemana?.mejor.singular).toBe("sábado");
    expect(informe.diasSemana?.titular).toBe("El sábado es el día que más cheques se venden");
    expect(informe.canjes.importes.map((i) => i.nombre)).toEqual(["Cheque de 100\u00A0€", "Cheque de 50\u00A0€", "Cheque de 25\u00A0€"]);
    expect(informe.conclusiones.length).toBeGreaterThanOrEqual(5);
    expect(informe.nombreArchivo).toBe("informe-cheques-regalo-2026-10.pdf");
  });

  it("un año se agrupa por meses (los futuros sin valor)", () => {
    const anual = construirInformeCheques(datos, periodoInforme("2026", "2026-11-10")) as InformeCheques;
    expect(anual.evolucion.tipo).toBe("meses");
    expect(anual.evolucion.meses.map((m) => m.media)).toEqual([0, 0, 0, 0, 0, 0, 0, 0, 100, 175, 500, null]);
    expect(anual.evolucion.titular).toBe("Noviembre fue el mes de más ventas, con 500\u00A0€");
  });

  it("vacío si no hay nada que contar en el periodo", () => {
    expect(construirInformeCheques({ cheques: [] }, periodo)).toEqual({ vacio: true, titulo: "Cheques regalo: octubre 2026", motivo: "No hay cheques vendidos, canjeados ni pendientes de canjear en octubre 2026." });
  });

  it("sin ventas pero con canjes sí hay informe, sin variación inventada", () => {
    const soloCanje = construirInformeCheques({ cheques: [fila("2025-12-01", 60, { canjeado: "2026-10-05T14:00:00" })] }, periodo) as InformeCheques;
    expect(soloCanje.vacio).toBe(false);
    expect(soloCanje.resumen.vendido.variacion).toBeNull();
    expect(soloCanje.resumen.titular).toBe("Sin ventas de cheques en octubre 2026; se canjearon 1 cheque");
    expect(soloCanje.diasSemana).toBeNull();
  });

  it("números en español", () => {
    expect([fmtEuros(1250), fmtEuros(48.5), fmtEuros(0)]).toEqual(["1.250\u00A0€", "48,50\u00A0€", "0\u00A0€"]);
  });
});

describe("generarInformeCheques", () => {
  it("pide a la RPC el tramo del periodo anterior hasta el cierre y construye el informe", async () => {
    const { generarInformeCheques } = await import("..");
    const rpc = vi.fn().mockResolvedValue({ data: { cheques: [fila("2026-10-03", 100)] }, error: null });
    const informe = await generarInformeCheques("2026-10", { hoy: "2026-11-10", cliente: { rpc } as never });
    expect(rpc).toHaveBeenCalledWith("informe_cheques_regalo", { p_desde: "2026-09-01", p_hasta: "2026-10-31" });
    expect(informe.vacio).toBe(false);
  });

  it("explica que falta la migración", async () => {
    const { generarInformeCheques } = await import("..");
    const rpc = vi.fn().mockResolvedValue({ data: null, error: { code: "PGRST202", message: "x" } });
    await expect(generarInformeCheques("2026-10", { hoy: "2026-11-10", cliente: { rpc } as never })).rejects.toThrow(/migración 20261122093700/);
  });
});
