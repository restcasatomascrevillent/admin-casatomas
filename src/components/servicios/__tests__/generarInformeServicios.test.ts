import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ rpc: vi.fn(), servicios: [] as unknown[] }));
vi.mock("@/integrations/supabase/client", () => {
  const builder = (tabla: string) => {
    const b: Record<string, unknown> = {
      select: () => b, order: () => b, limit: () => b,
      then: (ok: (v: unknown) => unknown) => Promise.resolve(
        tabla === "servicios_contratados" ? { data: h.servicios, error: null }
          : tabla === "servicios_config" ? { data: [{ eur_por_usd: 0.9, actualizado_en: null }], error: null }
            : { data: [], error: null },
      ).then(ok),
    };
    return b;
  };
  return { supabase: { from: builder, rpc: (...a: unknown[]) => h.rpc(...a), functions: { invoke: vi.fn() } } };
});

import { generarInformeServicios } from "../generarInformeServicios";

const s = (proveedor: string, extra: Record<string, unknown>) => ({
  proveedor, nombre: proveedor.toUpperCase(), plan: null, precio_mensual: 0, moneda: "USD", ciclo: "gratuito", renovacion: null, cuenta: null,
  panel_url: null, limites: {}, notas: null, actualizado_en: "2026-11-01T00:00:00Z", categoria: "otros", orden: 1, activo: true, por_confirmar: false,
  precio_anual: null, fuente_precio: null, ...extra,
});

beforeEach(() => {
  h.servicios = [s("openai", { ciclo: "por_uso", precio_mensual: null }), s("hosting", { ciclo: "mensual", precio_mensual: 10, moneda: "EUR" })];
  h.rpc.mockReset().mockImplementation(async (_fn: string, { p_mes }: { p_mes: string }) => ({
    data: p_mes === "2026-10-01" ? [{ proveedor: "openai", lecturas: 3, coste_variable: { importe: 10, moneda: "USD" } }] : [{ proveedor: "openai", lecturas: 3, coste_variable: { importe: 5, moneda: "USD" } }],
    error: null,
  }));
});

describe("generarInformeServicios (para Super Admin › Informes)", () => {
  it("recibe el mes y devuelve el informe con su CSV y su PDF", async () => {
    const r = await generarInformeServicios("2026-10-15", { hoy: new Date("2026-11-10T00:00:00Z") });
    expect(r.disponible).toBe(true);
    if (!r.disponible) return;
    expect(h.rpc.mock.calls.map((c) => c[1].p_mes).sort()).toEqual(["2026-09-01", "2026-10-01"]);
    expect(r.informe).toMatchObject({ mes: "2026-10-01", totalEur: 19, totalAnteriorEur: 14.5, enCurso: false });
    expect(r.titulo).toBe("Informe de servicios · Octubre 2026");
    expect(r.nombreArchivo).toBe("informe-servicios-2026-10");
    const csv = r.csv();
    expect(csv.type).toBe("text/csv;charset=utf-8");
    expect(await csv.text()).toContain("Total;;;;19,00;14,50");
    const pdf = await r.pdf();
    expect(pdf.type).toBe("application/pdf");
    expect(pdf.size).toBeGreaterThan(1000);
  });

  it("sin la migración de costes por mes dice qué falta", async () => {
    h.rpc.mockResolvedValue({ data: null, error: { code: "PGRST202", message: "Could not find the function public.servicios_resumen_mes" } });
    expect(await generarInformeServicios("2026-10-01")).toEqual({ disponible: false, motivo: expect.stringMatching(/20261122153000/) });
  });
});
