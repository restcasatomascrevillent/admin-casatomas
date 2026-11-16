/**
 * Reglas fijas de «mismo producto y formato» (pareja.ts). Cada caso sale de
 * la auditoría de la tarifa real del 16/11/2026: la IA de confirmación los
 * dio por buenos y no lo eran (o al revés). Nombres genéricos de tarifa de
 * bebidas; sin precios de ningún proveedor.
 */
import { describe, expect, it } from "vitest";
import { conflictoDePareja, envaseDelNombre, normalizarParaComparar } from "../pareja.ts";

const tipo = (t: string, c: string, compras: string[] = []) => conflictoDePareja(t, c, compras)?.tipo ?? "ok";

describe("conflictoDePareja: lo que SÍ es el mismo producto", () => {
  it.each([
    ["GIN.BEEFEATER 70CL 40º C6 ROSCA", "Beefeater 70 cl", ["GIN BEEFEATER 70CL"]],
    ["W.JOHNNIE WALKER E/N 70CL 40º C12 N/REF", "Johnnie Walker Black 70 cl", ["W. JOHNNIE WALKER BLACK LABEL 0.70"]],
    ["W.JOHNNIE WALKER E/ROJA 70CL 40º C6", "Johnnie Walker Red 70 cl", []],
    ["T.JOSE CUERVO ESPECIAL REPOSADO 70CL 35º C6 N/REF", "Cuervo Especial Reposado 70 cl", ["TEQUILA JOSE CUERVO REPOSADO 70CL"]],
    ["V.VIÑA ARDANZA RESERVA 75CL 14,5º C12", "Viña Ardanza Reserva 75 cl", []],
    ["GIN.LARIOS 12 PREMIUN 70CL 40º C6", "Larios 12 Premium 70 cl", []],
    ["GIN.TANQUERAY 0,0% SIN ALCOHOL 70CL C6", "Gin Tanqueray 0,0 % sin alcohol", []],
    ["RON ZACAPA RVA 23A 70CL 40º C6", "Ron Zacapa Reserva 23 años 70 cl", []],
    ["B.1866 70CL 40º C6 N/REF", "B.1866 70 cl", []],
    ["R.COCA COLA LATA ZERO 33CL C24", "Coca-Cola Zero 33 cl", []],
    ["L.MANZANA DROLS S/A 1L C6", "Licor de manzana Drols 1 L", ["LICOR MANZANA DROLS S/A 1L"]],
    ["ENVASES COCA-COLA 23,7CL C1", "Envase Coca-Cola 23,7 cl", ["ENVASE COCA-COLA"]],
  ])("%s = %s", (t, c, compras) => {
    expect(tipo(t, c, compras)).toBe("ok");
  });
});

describe("conflictoDePareja: otro producto", () => {
  it.each([
    ["GIN.BEEFEATER 0,0% SIN ALCOHOL 70CL C6", "Beefeater 70 cl", "sin alcohol"],
    ["GIN.BEEFEATER 70CL 40º C6", "Gin Beefeater 0,0 70 cl", "sin alcohol"],
    ["GIN.HENDRICKS LUNAR 70CL 44º C6", "Hendrick's 70 cl", "lunar"],
    ["VODKA ABSOLUT MANGO 70CL 40º C6", "Absolut Vodka 70 cl", "mango"],
    ["W.DYC 5A 70CL 40º C6 N/REF", "Whisky DYC 8 años 70 cl", "edad"],
    ["W.JOHNNIE WALKER DOUBLE BLACK 70CL 40º C6", "Johnnie Walker Black 70 cl", "Double"],
    ["W.JOHNNIE WALKER GOLD RVE 70CL 40º C6", "Johnnie Walker Black 70 cl", "Black"],
    ["CERVEZA ALHAMBRA LATA 33CL 4,6º C24", "Envase retornable caja cerveza 33 cl", "envase"],
    ["R.COCA COLA RETO IGLU 23,7CL 24U C1", "Envase Coca-Cola 23,7 cl", "envase"],
    ["CHA.VEUVE CLICQUOT ROSE 75CL 12,5º C6", "Veuve Clicquot Brut 75 cl", "rosado"],
    ["VERMOUTH YZAGUIRRE ROJO 1L 15º C6", "Vermouth Yzaguirre Blanco 1 L", "color"],
    ["MEZCAL LOS AMANTES JOVEN 70CL 40º C6", "Mezcal Los Amantes Reposado 70 cl", "crianza"],
    ["GIN.LONDON NUM.1 70CL 43º C3", "London Nº 3 Gin 70 cl", "3"],
    ["T.DON JULIO 1942 70CL 38º C6 ESTUCHE", "Tequila Don Julio Blanco 70 cl", "1942"],
    ["ATUN CLARO ARROYABE A/O RO280 C24", "Atún claro Arroyabe en aceite vegetal RO-900", "oliva"],
    ["V.MARQUES DE RISCAL RESERVA 75CL 14,5º C6", "Tinto XR 75 cl", "XR"],
    ["RON BUMBU 70CL 40º C6", "Ron Bumbu XO 70 cl", "XO"],
  ])("%s ≠ %s", (t, c, dice) => {
    const k = conflictoDePareja(t, c, []);
    expect(k?.tipo).toBe("otro_producto");
    expect(k?.motivo).toContain(dice);
  });

  it("los grados, la caja de reparto y los rangos no son números de modelo", () => {
    expect(tipo("GIN.MOMBASA CLUB 70CL 41,5º C6", "Mombasa Club Gin 70 cl")).toBe("ok");
    expect(tipo("RON LEGENDARIO ELIXIR 70CL 34º C11+1", "Ron Legendario Elixir 7 años", ["RON LEGENDARIO ELIXIR 70CL"])).toBe("ok");
    expect(tipo("ATUN CLARO CALVO A/O P3 RO65 C25", "Atún claro Calvo RO65", ["ATUN CALVO RO65"])).toBe("ok");
  });
});

describe("conflictoDePareja: otro formato", () => {
  it.each([
    ["MINI GIN.LARIOS 12 5CL 40º P20 C120 PET", "Larios 12 Premium 70 cl", "5 cl frente a 70 cl"],
    ["W.JACK DANIELS FIRE 1L 35º C6", "Jack Daniel's Fire 70 cl", "1 l frente a 70 cl"],
    ["V.CONDADO DE HAZA CRIANZA 75CL 15º C6", "Condado de Haza Crianza Magnum", "75 cl frente a 1,5 l"],
    ["ATUN CLARO RIANXEIRA A/O P3 RO80 C16", "Atún claro Rianxeira 650 g", "RO80"],
    ["CHA.DOM PERIGNON 2018 75CL 12,5º C6", "Dom Pérignon 2012 75 cl", "añada"],
    ["SALSA LEA & PERRINS 150GR C12", "Salsa Worcestershire Lea & Perrins 2 L", "150 g frente a 2 l"],
  ])("%s ≠ %s", (t, c, motivo) => {
    const k = conflictoDePareja(t, c, []);
    expect(k?.tipo).toBe("formato_distinto");
    expect(k?.motivo).toContain(motivo);
  });

  it("una petaca o un mini contra un producto sin tamaño en el catálogo", () => {
    expect(conflictoDePareja("PETACA GIN.NORDES 20CL 40º C12 CRIS", "Gin Nordés", ["GIN NORDES"])?.tipo).toBe("formato_distinto");
  });
});

describe("conflictoDePareja: dudosa (sale en «Revisar», no se descarta)", () => {
  it("otra marca con un catálogo genérico, una edición que tus facturas no dicen", () => {
    expect(tipo("V.MATEUS ROSE 75CL 11º C6", "La Cuvée Rosé 75 cl", ["LAURENT PERRIER CUVEE ROSE"])).toBe("dudosa");
    expect(tipo("V.FAUSTINO I GRAN RESERVA 75CL 13,5º C6", "Vino Gran Reserva 75 cl (Guillén)", ["VINO GRAN RESERVA"])).toBe("dudosa");
    expect(tipo("GIN.TANQUERAY TEN 70CL 47,3º C6", "Tanqueray 70 cl", ["GIN TANQUERAY 70CL"])).toBe("dudosa");
    expect(tipo("RON BARCELO GRAN AÑEJO 70CL 37,5º C6", "Barceló Añejo 70 cl", ["RON BARCELO AÑEJO 70CL"])).toBe("dudosa");
  });
});

describe("envaseDelNombre y normalización", () => {
  it("tamaños: miles en gramos, fracciones de litro, magnum", () => {
    expect(envaseDelNombre("TOMATE FRITO BRIK 2,100GR C6")).toEqual({ cantidad: 2.1, unidad: "kg" });
    expect(envaseDelNombre("LAVAVAJILLAS 1,015ML C8")).toEqual({ cantidad: 1.015, unidad: "l" });
    expect(envaseDelNombre("Cider Ladrón de Manzanas 1/3 L caja 24")).toEqual({ cantidad: 0.333, unidad: "l" });
    expect(envaseDelNombre("V.RISCAL RVA 3/8 C12")).toEqual({ cantidad: 0.375, unidad: "l" });
    expect(envaseDelNombre("Juan Gil Etiqueta Plata Magnum")).toEqual({ cantidad: 1.5, unidad: "l" });
    expect(envaseDelNombre("ACEITE OLIVA 0,4º 1L C15")).toEqual({ cantidad: 1, unidad: "l" });
  });

  it("abreviaturas de tarifa", () => {
    expect(normalizarParaComparar("W.JOHNNIE WALKER E/N")).toContain("black");
    expect(normalizarParaComparar("L.MORA DROLS S/A 1L")).toContain("sinalcohol");
    expect(normalizarParaComparar("RON SANTA TERESA G.RVA")).toContain("granreserva");
    expect(normalizarParaComparar("GIN 70CL 40º C6")).not.toMatch(/\b40\b/);
  });
});
