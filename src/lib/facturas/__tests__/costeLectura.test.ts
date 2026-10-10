import { describe, expect, it, vi } from "vitest";

// El hook importa el cliente real de Supabase (necesita variables de entorno): aquí se inyecta un doble.
vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));

import {
  costeDeRespuesta,
  fmtCentimos,
  nombreCortoProveedor,
  normalizarEstadisticasLectura,
  textoResumenLectura,
} from "../costeLectura";
import { cargarEstadisticasLectura, leerCosteLecturaFactura } from "@/hooks/useEstadisticasLectura";

const fila = {
  documentos: 3, total_usd: "0.04688", media_usd: "0.015627", mediana_usd: 0.0087, llamadas_media: null,
  mas_cara_id: 54, mas_cara_proveedor: "LUGA SABORES S.L.", mas_cara_numero: "ML/101511", mas_cara_usd: "0.03488",
  por_paginas: [
    { tramo: "1 página", documentos: 3, media_usd: 0.0156, total_usd: 0.0469 },
    { tramo: "2 páginas", documentos: 0, media_usd: 0, total_usd: 0 },
  ],
  por_lineas: [{ tramo: "más de 50 líneas", documentos: 1, media_usd: 0.03488, total_usd: 0.03488 }],
};

describe("fmtCentimos", () => {
  it("céntimos de euro con decimales según el tamaño (a 0,92 €/USD)", () => {
    expect(fmtCentimos(0.0043)).toBe("0,4 cént.");
    expect(fmtCentimos(0.03488)).toBe("3,2 cént.");
    expect(fmtCentimos(0.0005)).toBe("0,05 cént.");
    expect(fmtCentimos(0.2)).toBe("18 cént.");
    expect(fmtCentimos(0)).toBe("0 cént.");
    expect(fmtCentimos(0.03488, 0.5)).toBe("1,7 cént.");
  });
  it("null o basura = sin datos (nunca 0)", () => {
    expect(fmtCentimos(null)).toBe("sin datos");
    expect(fmtCentimos(undefined)).toBe("sin datos");
    expect(fmtCentimos(Number.NaN)).toBe("sin datos");
  });
});

describe("nombreCortoProveedor", () => {
  it("quita la forma jurídica y las palabras genéricas del principio", () => {
    expect(nombreCortoProveedor("LUGA SABORES S.L.")).toBe("Luga");
    expect(nombreCortoProveedor("Salazones Garre")).toBe("Garre");
    expect(nombreCortoProveedor("Racionalismo Dulce, S.L.")).toBe("Racionalismo");
    expect(nombreCortoProveedor("Pescados")).toBe("Pescados");
    expect(nombreCortoProveedor(null)).toBe("");
    expect(nombreCortoProveedor("")).toBe("");
  });
});

describe("estadísticas de lectura", () => {
  it("normaliza la fila de la RPC (números como texto, tramos vacíos fuera)", () => {
    const e = normalizarEstadisticasLectura([fila])!;
    expect(e.documentos).toBe(3);
    expect(e.totalUsd).toBeCloseTo(0.04688, 6);
    expect(e.mediaUsd).toBeCloseTo(0.015627, 6);
    expect(e.llamadasMedia).toBeNull();
    expect(e.masCara).toEqual({ id: 54, proveedor: "LUGA SABORES S.L.", numero: "ML/101511", usd: 0.03488 });
    expect(e.porPaginas).toEqual([{ tramo: "1 página", documentos: 3, mediaUsd: 0.0156, totalUsd: 0.0469 }]);
    expect(e.porLineas).toHaveLength(1);
  });

  it("sin documentos o basura = null", () => {
    expect(normalizarEstadisticasLectura([{ ...fila, documentos: 0 }])).toBeNull();
    expect(normalizarEstadisticasLectura([])).toBeNull();
    expect(normalizarEstadisticasLectura(null)).toBeNull();
    expect(normalizarEstadisticasLectura("x")).toBeNull();
  });

  it("frase del monitor: «N docs · media X cént./doc · más cara: Luga Y cént.»", () => {
    expect(textoResumenLectura(normalizarEstadisticasLectura([fila]))).toBe("3 docs · media 1,4 cént./doc · más cara: Luga 3,2 cént.");
    const uno = normalizarEstadisticasLectura([{ ...fila, documentos: 1, mas_cara_id: null, mas_cara_usd: null }])!;
    expect(textoResumenLectura(uno)).toBe("1 doc · media 1,4 cént./doc");
    expect(textoResumenLectura(null)).toBeNull();
  });

  it("sin nombre de proveedor, la más cara se nombra por su número", () => {
    const e = normalizarEstadisticasLectura([{ ...fila, mas_cara_proveedor: null }])!;
    expect(textoResumenLectura(e)).toContain("más cara: ML/101511 3,2 cént.");
  });
});

describe("costeDeRespuesta", () => {
  it("coste_usd válido o null", () => {
    expect(costeDeRespuesta({ coste_usd: 0.01 })).toBe(0.01);
    expect(costeDeRespuesta({ coste_usd: "0.02" })).toBe(0.02);
    expect(costeDeRespuesta({})).toBeNull();
    expect(costeDeRespuesta(null)).toBeNull();
    expect(costeDeRespuesta({ coste_usd: -3 })).toBeNull();
  });
});

describe("cargarEstadisticasLectura (RPC simulada)", () => {
  const calls: { fn: string; args: Record<string, unknown> }[] = [];
  const cliente = (resp: { data: unknown; error: { message: string } | null } | Error) => ({
    marca: true,
    rpc(this: { marca?: boolean }, fn: string, args: Record<string, unknown>) {
      // `rpc` usa this: llamarlo suelto rompería.
      if (this?.marca !== true) throw new Error("rpc sin this");
      calls.push({ fn, args });
      return resp instanceof Error ? Promise.reject(resp) : Promise.resolve(resp);
    },
  });

  it("pide p_dias y normaliza", async () => {
    calls.length = 0;
    const e = await cargarEstadisticasLectura(cliente({ data: [fila], error: null }), 10);
    expect(calls).toEqual([{ fn: "estadisticas_lectura", args: { p_dias: 10 } }]);
    expect(e?.documentos).toBe(3);
  });

  it("RPC inexistente o error: null, sin lanzar", async () => {
    const aviso = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(await cargarEstadisticasLectura(cliente({ data: null, error: { message: "function does not exist" } }), 10)).toBeNull();
    expect(await cargarEstadisticasLectura(cliente(new Error("red")), 10)).toBeNull();
    aviso.mockRestore();
  });
});

describe("leerCosteLecturaFactura", () => {
  const supa = (data: unknown, error: unknown = null) => ({
    from() {
      return { select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data, error }) }) }) };
    },
  });
  it("lee coste, llamadas y modelo", async () => {
    expect(await leerCosteLecturaFactura(supa({ coste_lectura_usd: "0.0043", lectura_llamadas: 3, lectura_modelo: "gpt-5.6-luna" }), 39)).toEqual({
      costeUsd: 0.0043,
      llamadas: 3,
      modelo: "gpt-5.6-luna",
    });
  });
  it("sin dato, sin columna o con error: null", async () => {
    expect(await leerCosteLecturaFactura(supa({ coste_lectura_usd: null }), 39)).toBeNull();
    expect(await leerCosteLecturaFactura(supa(null), 39)).toBeNull();
    expect(await leerCosteLecturaFactura(supa(null, { message: "column does not exist" }), 39)).toBeNull();
  });
});
