import { describe, expect, it } from "vitest";
import {
  avisosDudosos,
  costeEfectivo,
  cumpleEstado,
  estadoVino,
  filtrarYOrdenar,
  formatoDistinto,
  motivoEstado,
  normalizarCandidatos,
  normalizarCosteVinos,
  precioSugerido,
  subidaMediaSugerida,
  textoAnada,
  textoSinCargo,
  type DatosEstado,
} from "../costeVinos";

const factura = (id: number, proveedor: string, extra: Record<string, unknown> = {}) => ({
  id, linea_id: id * 10, fecha: "2026-06-30", proveedor, numero_documento: `F-${id}`, tipo: "factura", total: 900,
  cantidad: 30, unidad_compra: "botella", precio_unidad: 19.3, importe: 579, medida: "l", eur_base: 25.73, ...extra,
});

/** Lo que devuelve la RPC vinos_coste_carta (recortado). */
const RPC = {
  hoy: "2026-11-16",
  meses: null,
  copas_por_botella: 6,
  config: { multiplicador_min_vino: 2.3, iva_pct: 10 },
  resumen: {
    total: 6, con_coste: 2, sin_coste: 2, sin_enlazar: 1, sin_compra: 1, sin_precio: 0, dudosos: 1, revisar: 1,
    anada_distinta: 1, por_debajo: 1, con_sin_cargo: 1, con_candidato: 1, multiplicador_mediana: 2.31,
  },
  vinos: [
    { id: "seque", nombre: "El Sequé 2022", categoria: "TINTOS — ALICANTE", precio: 37, venta: 33.6364, producto_id: 1, producto: "El Sequé 75 cl",
      origen: "estimado", litros: 0.75, litros_producto: 0.75, coste_factura: 19.3, coste_efectivo: 16.0833, botellas_pagadas: 30, botellas_sin_cargo: 6,
      importe_pagado: 579, facturas: 1, factura: factura(11, "VINOS DEL MUNDO"), multiplicador: 2.09, margen: 17.55, margen_pct: 52.2, estado: "bajo",
      avisos: [], precio_sugerido: 41, copeo: true, precio_copa: 7,
      copa: { venta: 6.3636, coste: 2.6806, multiplicador: 2.37, margen: 3.68, margen_pct: 57.9 } },
    { id: "ardanza", nombre: "Viña Ardanza", categoria: "TINTOS — RIOJA", precio: 42.5, venta: 38.6364, producto_id: 2, producto: "Viña Ardanza Reserva 75 cl",
      litros: 0.75, litros_producto: 0.75, coste_factura: 15.2, coste_efectivo: 15.2, botellas_pagadas: 60, botellas_sin_cargo: 0, importe_pagado: 912,
      facturas: 1, factura: factura(12, "Distribuciones Guillén"), multiplicador: 2.54, margen: 23.44, margen_pct: 60.7, estado: "bien",
      avisos: ["anada_distinta"], anada_carta: 2017, anada_compra: 2019, copeo: false },
    { id: "nacar", nombre: "Juan Gil Nácar", categoria: "TINTOS — JUMILLA", precio: 25, venta: 22.7273, producto_id: 3, producto: "Juan Gil Nácar 75 cl",
      litros: 0.75, coste_factura: 64.8, coste_efectivo: 64.8, botellas_sin_cargo: 0, factura: factura(13, "JULIÁN FERNÁNDEZ", { unidad_compra: "caja", medida: null }),
      multiplicador: 0.35, margen: -42.07, margen_pct: -185.1, estado: "dudoso", avisos: ["coste_mayor_que_carta", "coste_por_caja"] },
    { id: "godeval-m", nombre: "Godeval (Magnum)", categoria: "BLANCOS — VALDEORRAS", precio: 42, venta: 38.18, producto_id: 4, producto: "Godeval Cepas Vellas 75 cl",
      litros: 1.5, litros_producto: 0.75, coste_factura: 33.7, coste_efectivo: 22.47, botellas_pagadas: 12, botellas_sin_cargo: 6,
      factura: factura(14, "GODEVAL"), multiplicador: null, estado: "revisar", avisos: ["formato_distinto"] },
    { id: "pazo", nombre: "Pazo la Cuesta", categoria: "TINTOS — GALICIA", precio: 28, venta: 25.45, producto_id: 5, producto: "Pazo la Cuesta Mencía", estado: "sin_compra", avisos: [] },
    { id: "nido", nombre: "El Nido 2022", categoria: "TINTOS — JUMILLA", precio: 240, venta: 218.18, estado: "sin_enlazar", avisos: ["no_existe"],
      mejor_candidato: { id: 77, nombre: "El Nido 75 cl", similitud: 1 } },
    { nombre: "sin id" },
  ],
};

describe("coste efectivo", () => {
  it("descuenta las botellas sin cargo: total pagado ÷ (pagadas + regaladas)", () => {
    expect(costeEfectivo(579, 30, 6)).toBe(16.0833); // El Sequé: 19,30 € en factura
    expect(costeEfectivo(12 * 10, 12, 2)).toBe(8.5714); // 12 pagadas y 2 de regalo: ÷ 14
    expect(costeEfectivo(396, 22, 2)).toBe(16.5);
  });
  it("sin botellas sin cargo es el precio de la factura", () => {
    expect(costeEfectivo(912, 60)).toBe(15.2);
  });
  it("sin botellas pagadas o sin importe no hay coste", () => {
    expect(costeEfectivo(0, 6, 6)).toBeNull();
    expect(costeEfectivo(100, 0, 6)).toBeNull();
    expect(costeEfectivo(100, 6, -1)).toBeNull();
  });
});

describe("formato", () => {
  it("magnum frente a 75 cl es otro formato; sin formato conocido no se marca", () => {
    expect(formatoDistinto(1.5, 0.75)).toBe(true);
    expect(formatoDistinto(0.75, 1.5)).toBe(true);
    expect(formatoDistinto(0.75, 0.75)).toBe(false);
    expect(formatoDistinto(0.75, null)).toBe(false);
  });
});

describe("estado", () => {
  const base: DatosEstado = { venta: 38.64, productoId: 2, costeFactura: 15.2, costeEfectivo: 15.2, litros: 0.75, litrosProducto: 0.75 };
  it("bien y por debajo del mínimo", () => {
    expect(estadoVino(base, 2.3)).toBe("bien"); // ×2,54
    expect(estadoVino(base, 2.6)).toBe("bajo");
    expect(estadoVino({ ...base, costeEfectivo: 16.81 }, 2.3)).toBe("bajo"); // 38,64 ÷ 16,81 = ×2,299
  });
  it("el coste efectivo puede salvar a un vino que con el precio de factura estaría por debajo", () => {
    const seque = { ...base, venta: 38.64, costeFactura: 19.3 };
    expect(estadoVino({ ...seque, costeEfectivo: 19.3 }, 2.3)).toBe("bajo"); // ×2,00
    expect(estadoVino({ ...seque, costeEfectivo: 16.08 }, 2.3)).toBe("bien"); // ×2,40
  });
  it("sin precio, sin enlazar y sin compra, por ese orden", () => {
    expect(estadoVino({ ...base, venta: null, productoId: null }, 2.3)).toBe("sin_precio");
    expect(estadoVino({ ...base, productoId: null, costeFactura: null, costeEfectivo: null }, 2.3)).toBe("sin_enlazar");
    expect(estadoVino({ ...base, costeFactura: null, costeEfectivo: null }, 2.3)).toBe("sin_compra");
  });
  it("otro formato: revisar, aunque el dato también sea dudoso", () => {
    expect(estadoVino({ ...base, litros: 1.5 }, 2.3)).toBe("revisar");
    expect(estadoVino({ ...base, litros: 1.5, costeEfectivo: 90 }, 2.3)).toBe("revisar");
  });
  it("dudoso: coste mayor que la carta (Juan Gil Nácar: 64,80 € con carta a 25 €)", () => {
    const nacar = { ...base, venta: 22.73, costeFactura: 64.8, costeEfectivo: 64.8 };
    expect(avisosDudosos(nacar)).toEqual(["coste_mayor_que_carta"]);
    expect(estadoVino(nacar, 2.3)).toBe("dudoso");
  });
  it("dudoso: precio por caja, salto de precio o coste demasiado bajo", () => {
    expect(avisosDudosos({ ...base, unidadSinVolumen: "caja" })).toEqual(["coste_por_caja"]);
    expect(avisosDudosos({ ...base, unidadSinVolumen: "botella" })).toEqual([]);
    expect(avisosDudosos({ ...base, costeAnterior: 2.6 })).toEqual(["salto_precio"]); // ×5,8: caja frente a botella
    expect(avisosDudosos({ ...base, costeAnterior: 91.2 })).toEqual(["salto_precio"]);
    expect(avisosDudosos({ ...base, costeAnterior: 14 })).toEqual([]);
    expect(avisosDudosos({ ...base, costeFactura: 4, costeEfectivo: 4 })).toEqual(["coste_muy_bajo"]);
    expect(estadoVino({ ...base, unidadSinVolumen: "caja" }, 2.3)).toBe("dudoso");
  });
});

describe("precio sugerido", () => {
  it("redondea hacia arriba a 0,50 €, con IVA", () => {
    expect(precioSugerido(16.0833, 2.3)).toBe(41); // 40,69 → 41
    expect(precioSugerido(15.25, 2.3)).toBe(39); // 38,58 → 39
    expect(precioSugerido(10, 2.3)).toBe(25.5); // 25,30 → 25,50
    expect(precioSugerido(10, 2.5)).toBe(27.5); // exacto: no sube
  });
});

describe("normalizarCosteVinos", () => {
  const d = normalizarCosteVinos(RPC);
  it("lee resumen, configuración y supuestos", () => {
    expect(d.resumen).toMatchObject({ total: 6, conCoste: 2, sinCoste: 2, porDebajo: 1, dudosos: 1, revisar: 1, multiplicadorMediana: 2.31 });
    expect(d.multiplicadorMin).toBe(2.3);
    expect(d.copasPorBotella).toBe(6);
    expect(d.meses).toBeNull();
  });
  it("lee cada vino y descarta lo que no tiene id o no conoce", () => {
    expect(d.vinos).toHaveLength(6);
    const seque = d.vinos[0];
    expect(seque).toMatchObject({ costeFactura: 19.3, costeEfectivo: 16.0833, botellasPagadas: 30, botellasSinCargo: 6, estado: "bajo", precioSugerido: 41 });
    expect(seque.factura?.proveedor).toBe("VINOS DEL MUNDO");
    expect(seque.copa).toMatchObject({ margen: 3.68, multiplicador: 2.37 });
    const nido = d.vinos[5];
    expect(nido.avisos).toEqual([]);
    expect(nido.mejorCandidato).toEqual({ id: 77, nombre: "El Nido 75 cl", similitud: 1 });
    expect(nido.factura).toBeNull();
  });
  it("aguanta una respuesta vacía", () => {
    const v = normalizarCosteVinos(null);
    expect(v.vinos).toEqual([]);
    expect(v.resumen.total).toBe(0);
    expect(v.multiplicadorMin).toBe(2.3);
  });
});

describe("filtros y orden", () => {
  const { vinos } = normalizarCosteVinos(RPC);
  const base = { estado: "todos", categoria: "", texto: "", orden: "peor" } as const;
  const ids = (l: { id: string }[]) => l.map((v) => v.id);
  it("por multiplicador, peor primero y los que no tienen al final", () => {
    expect(ids(filtrarYOrdenar(vinos, base))).toEqual(["nacar", "seque", "ardanza", "nido", "godeval-m", "pazo"]);
    expect(ids(filtrarYOrdenar(vinos, { ...base, orden: "mejor" })).slice(0, 3)).toEqual(["ardanza", "seque", "nacar"]);
  });
  it("por estado; «revisar» incluye los de otra añada", () => {
    expect(ids(filtrarYOrdenar(vinos, { ...base, estado: "bajo" }))).toEqual(["seque"]);
    expect(ids(filtrarYOrdenar(vinos, { ...base, estado: "dudoso" }))).toEqual(["nacar"]);
    expect(ids(filtrarYOrdenar(vinos, { ...base, estado: "revisar" }))).toEqual(["ardanza", "godeval-m"]);
    expect(ids(filtrarYOrdenar(vinos, { ...base, estado: "sin_cargo" }))).toEqual(["seque", "godeval-m"]);
    expect(cumpleEstado(vinos[1], "bien")).toBe(true);
  });
  it("por categoría y por texto sin tildes (vino, producto o proveedor)", () => {
    expect(ids(filtrarYOrdenar(vinos, { ...base, categoria: "TINTOS — JUMILLA" }))).toEqual(["nacar", "nido"]);
    expect(ids(filtrarYOrdenar(vinos, { ...base, texto: "seque" }))).toEqual(["seque"]);
    expect(ids(filtrarYOrdenar(vinos, { ...base, texto: "guillen" }))).toEqual(["ardanza"]);
    expect(ids(filtrarYOrdenar(vinos, { ...base, texto: "mencia" }))).toEqual(["pazo"]);
  });
  it("por nombre y por precio de carta", () => {
    expect(ids(filtrarYOrdenar(vinos, { ...base, orden: "nombre" }))[0]).toBe("nido");
    expect(ids(filtrarYOrdenar(vinos, { ...base, orden: "precio" }))[0]).toBe("nido");
  });
  it("subida media sugerida de los que están por debajo", () => {
    expect(subidaMediaSugerida(vinos)).toBe(4);
    expect(subidaMediaSugerida([])).toBeNull();
  });
});

describe("textos", () => {
  const { vinos } = normalizarCosteVinos(RPC);
  it("botellas sin cargo", () => {
    expect(textoSinCargo(vinos[0])).toBe("30 pagadas + 6 sin cargo → 579,00 € ÷ 36");
    expect(textoSinCargo(vinos[1])).toBeNull();
  });
  it("motivo de cada estado", () => {
    expect(motivoEstado(vinos[0], 2.3)).toBe("Para llegar a ×2,3: 41,00 € en carta.");
    expect(motivoEstado(vinos[2], 2.3)).toContain("el coste es mayor que el precio de carta");
    expect(motivoEstado(vinos[2], 2.3)).toContain("parece de una caja");
    expect(motivoEstado(vinos[3], 2.3)).toContain("En carta es Magnum (1,5 l) y el producto enlazado es 75 cl");
    expect(motivoEstado(vinos[4], 2.3)).toBe("No hay compras de «Pazo la Cuesta Mencía».");
    expect(motivoEstado(vinos[5], 2.3)).toBe("Sin enlazar. ¿Es «El Nido 75 cl»?");
    expect(motivoEstado(vinos[1], 2.3)).toBeNull();
  });
  it("añada distinta", () => {
    expect(textoAnada(vinos[1])).toBe("Carta 2017, última compra 2019");
    expect(textoAnada(vinos[0])).toBeNull();
  });
});

describe("normalizarCandidatos", () => {
  it("lee los candidatos con su última compra y sus avisos", () => {
    const c = normalizarCandidatos([
      { id: 77, nombre: "Juan Gil Nácar 75 cl", categoria: "Vinos", similitud: 1, lineas: 1, ultima: "2026-08-26", litros: 0.75, formato_distinto: false,
        coste_botella: 64.8, factura: factura(13, "JULIÁN FERNÁNDEZ"), dudoso: true, enlazado_a: null },
      { id: 78, nombre: "Juan Gil Plata Magnum", similitud: 0.64, formato_distinto: true, enlazado_a: ["Juan Gil Plata (Magnum)"] },
      { nombre: "sin id" },
    ]);
    expect(c).toHaveLength(2);
    expect(c[0]).toMatchObject({ id: 77, dudoso: true, costeBotella: 64.8, enlazadoA: [] });
    expect(c[0].factura?.proveedor).toBe("JULIÁN FERNÁNDEZ");
    expect(c[1]).toMatchObject({ formatoDistinto: true, lineas: 0, factura: null, enlazadoA: ["Juan Gil Plata (Magnum)"] });
  });
});
