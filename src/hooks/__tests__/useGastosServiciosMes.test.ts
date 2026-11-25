import { describe, expect, it, vi } from "vitest";
import { renderHook } from "@testing-library/react";

// Servicios › Costes simulado: el informe del mes trae OpenAI, Stripe y un gasto sin meter.
vi.mock("@/hooks/useServicios", () => ({
  useServiciosContratados: () => ({ data: { disponible: true, costes: true, servicios: [] }, isLoading: false, isError: false }),
  useConfigServicios: () => ({ data: { eurPorUsd: 0.9 }, isLoading: false }),
  useResumenesMes: () => [{ data: { disponible: true, filas: [] }, isLoading: false, isError: false }],
}));
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
  it("sin mes no da gastos", () => {
    const { result } = renderHook(() => useGastosServiciosMes(undefined));
    expect(result.current.gastos).toBeNull();
  });
});
