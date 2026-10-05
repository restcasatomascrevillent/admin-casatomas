import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/integrations/supabase/client", async () => {
  const m = await import("@/components/facturas/__tests__/dobleSupabaseFacturas");
  return { supabase: m.doble.supabase };
});

import { doble, filtra } from "@/components/facturas/__tests__/dobleSupabaseFacturas";
import {
  CLAVE_DESCARTADOS,
  fusionarPendientes,
  guardarDescartados,
  leerDescartados,
  leerPendientesDecidir,
} from "../pendientesDecidir";
import type { ElementoCola } from "../colaSubida";

const sust = (trabajo_id: string) => ({
  trabajo_id,
  existente: { id: 54, numero_documento: "ML/101511", proveedor: "LUGA", fecha: "2025-12-31", total: null, total_origen: null, lineas: 8, alertas: 0, alertas_graves: 0 },
  nuevo: { total: 10, total_origen: "leido", lineas: 54, alertas: 0, proveedor: "LUGA", fecha: "2025-12-31" },
});

beforeEach(() => {
  doble.reiniciar();
  window.localStorage.clear();
});

describe("leerPendientesDecidir", () => {
  it("lee los duplicados sustituibles del usuario desde ocr_trabajos (sobrevive a recargar)", async () => {
    let filtros: unknown[] = [];
    doble.fijarRespuestas((tabla, llamadas) => {
      filtros = llamadas;
      expect(tabla).toBe("ocr_trabajos");
      return [
        { id: "t1", nombre_original: "a.pdf", created_at: "2026-10-05T10:00:00Z", resultado: { success: true, duplicado: true, sustituible: sust("t1") } },
        // Duplicado sin «sustituible» (servidor antiguo): no hay nada que decidir.
        { id: "t2", nombre_original: "b.pdf", created_at: "2026-10-05T10:00:00Z", resultado: { success: true, duplicado: true } },
      ];
    });
    const r = await leerPendientesDecidir("u1");
    expect(r.map((p) => p.trabajoId)).toEqual(["t1"]);
    expect(filtra(filtros as never, "estado", "duplicado")).toBe(true);
    expect(filtra(filtros as never, "creado_por", "u1")).toBe(true);
  });
});

describe("fusionarPendientes", () => {
  const elemento = (trabajo: string): ElementoCola => ({
    id: `e-${trabajo}`, nombre: `${trabajo}.pdf`, file: null, preview: "", tamano: 0, fase: "terminado", progreso: "", tanda: 1,
    resultado: { nombre: `${trabajo}.pdf`, success: true, duplicado: true, sustituible: sust(trabajo) },
  });

  it("junta BD y cola sin repetir, y quita descartados y sustituidos", () => {
    const deBd = [{ trabajoId: "t1", nombre: "a.pdf", creado: null, sustituible: sust("t1") }, { trabajoId: "t3", nombre: "c.pdf", creado: null, sustituible: sust("t3") }];
    const r = fusionarPendientes(deBd, [elemento("t1"), elemento("t2")], new Set(["t3"]));
    expect(r.map((p) => p.trabajoId)).toEqual(["t1", "t2"]);
  });
});

describe("descartados («Dejar la que hay»)", () => {
  it("se recuerdan en este navegador y toleran basura", () => {
    guardarDescartados(new Set(["t1", "t2"]));
    expect([...leerDescartados()]).toEqual(["t1", "t2"]);
    window.localStorage.setItem(CLAVE_DESCARTADOS, "{no es json");
    expect(leerDescartados().size).toBe(0);
  });
});
