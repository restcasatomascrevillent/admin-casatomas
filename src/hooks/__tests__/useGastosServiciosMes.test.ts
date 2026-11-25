import { describe, expect, it, vi } from "vitest";
import { renderHook } from "@testing-library/react";

// Servicios › Costes simulado: el informe del mes trae OpenAI, Stripe y un gasto sin meter.
vi.mock("@/hooks/useServicios", () => ({
  useServiciosContratados: () => ({ data: { disponible: true, costes: true, servicios: [] }, isLoading: false, isError: false }),
  useConfigServicios: () => ({ data: { eurPorUsd: 0.9 }, isLoading: false }),
  useResumenesMes: () => [{ data: { disponible: true, filas: [] }, isLoading: false, isError: false }],
}));
// IA por función del mes (ia_coste_por_uso): 20 US$ en facturas y 10 US$ en el chat (a 0,9 → 18 € + 9 €).
const ia = vi.hoisted(() => ({ resultado: null as unknown, isLoading: false }));
vi.mock("@/hooks/useCostePorUso", () => ({ useCostePorUso: () => ({ data: ia.resultado, isLoading: ia.isLoading }) }));
const fila = (funcion: string, costeUsd: number, usos: number) => ({ funcion, queHace: null, accion: null, unidad: "llamada", orden: 1, llamadas: usos, usos, usosConCoste: usos, costeUsd, filasSinTarifa: 0, modelosSinTarifa: [], medianaUsd: null, mediaUsd: null, servidorPropio: false });
vi.mock("@/lib/informeServicios", () => ({
  informeMes: () => ({
    filas: [
      { proveedor: "openai", nombre: "OpenAI", categoria: "ia", totalEur: 42.5, origen: "estimado" },
      { proveedor: "stripe", nombre: "Stripe", categoria: "pagos", totalEur: 3.2, origen: "estimado" },
      { proveedor: "hostinger", nombre: "Hostinger", categoria: "dominio", totalEur: 0, origen: "falta" },
      { proveedor: "github", nombre: "GitHub", categoria: "codigo", totalEur: 0, origen: "gratis" },
    ],
  }),
}));

import { useGastosServiciosMes } from "../useGastosServiciosMes";

describe("useGastosServiciosMes", () => {
  it("trae los gastos del mes para el recibo sin Stripe (no lo pagamos nosotros)", () => {
    const { result } = renderHook(() => useGastosServiciosMes("2026-11"));
    expect(result.current.gastos?.map((g) => g.proveedor)).toEqual(["openai", "hostinger"]);
    expect(result.current).toMatchObject({ cargando: false, error: false, disponible: true });
  });
  it("la línea de OpenAI lleva su desglose por funciones (y lo que no se apunta, «Sin asignar»)", () => {
    ia.resultado = { disponible: true, filas: [fila("ocr-trabajo", 20, 300), fila("chat-facturas", 10, 40)] };
    const { result } = renderHook(() => useGastosServiciosMes("2026-11"));
    const openai = result.current.gastos?.find((g) => g.proveedor === "openai");
    expect(openai?.importe).toBe(42.5);
    expect(openai?.desglose?.map((d) => d.concepto)).toEqual(["Subir y leer facturas", "Chat (Facturas y web)", "Sin asignar"]);
    expect(openai?.desglose?.[0]).toMatchObject({ usos: 300 });
    expect(result.current.gastos?.find((g) => g.proveedor === "hostinger")?.desglose).toBeUndefined();
  });
  it("«Probar modelos de IA» no se cobra: la línea de OpenAI baja en lo suyo y queda apuntado aparte", () => {
    ia.resultado = { disponible: true, filas: [fila("ocr-trabajo", 20, 300), fila("ia-modelos-openai", 5, 149)] };
    const { result } = renderHook(() => useGastosServiciosMes("2026-11"));
    const openai = result.current.gastos?.find((g) => g.proveedor === "openai");
    expect(openai?.importe).toBeCloseTo(38); // 42,5 € − 5 US$ × 0,9
    expect(openai?.noCobrado).toEqual([{ concepto: "Probar modelos de IA (Servicios)", importe: expect.closeTo(4.5), usos: 149 }]);
    expect(openai?.desglose?.map((d) => d.concepto)).toEqual(["Subir y leer facturas", "Sin asignar"]);
  });
  it("sin lo apuntado por función (falta la RPC o no hay nada) la línea sale sola, como antes", () => {
    ia.resultado = { disponible: false };
    const { result } = renderHook(() => useGastosServiciosMes("2026-11"));
    expect(result.current.gastos?.find((g) => g.proveedor === "openai")?.desglose).toBeUndefined();
  });
  it("sin mes no da gastos", () => {
    const { result } = renderHook(() => useGastosServiciosMes(undefined));
    expect(result.current.gastos).toBeNull();
  });
});
