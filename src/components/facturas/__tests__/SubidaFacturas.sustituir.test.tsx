import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const invoke = vi.fn();
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    functions: { invoke: (...a: unknown[]) => invoke(...a) },
    // useTrabajosOcrEnCurso: sin trabajos en curso.
    from: () => ({
      select: () => ({
        in: () => ({ gte: () => ({ order: () => ({ limit: async () => ({ data: [], error: null }) }) }) }),
      }),
    }),
  },
}));
vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }) }));

import { SubidaFacturas } from "../SubidaFacturas";

const sustituible = {
  trabajo_id: "33333333-3333-4333-8333-333333333333",
  existente: {
    id: 54, numero_documento: "ML/101511", proveedor: "LUGA SABORES S.L.", fecha: "2025-12-31", total: null,
    total_origen: null, lineas: 8, alertas: 1, alertas_graves: 1, updated_at: "2026-09-29T15:28:55.00448",
  },
  nuevo: { total: 3787.53, total_origen: "deducido", lineas: 54, alertas: 1, proveedor: "LUGA SABORES S.L.", fecha: "2025-12-31" },
};

function montar() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}><SubidaFacturas /></QueryClientProvider>);
}

beforeEach(() => invoke.mockReset());

describe("SubidaFacturas · duplicado → «Sustituir la existente»", () => {
  it("enseña la fila actual y, al confirmar, pide la sustitución con lo que vio el usuario", async () => {
    invoke.mockImplementation(async (_f: string, opciones?: { body?: Record<string, unknown> }) => {
      if (opciones?.body?.modo === "sustituir") {
        return { data: { success: true, message: "Factura 54 sustituida: 8 → 54 líneas.", alertas: [] }, error: null };
      }
      return {
        data: {
          success: true, tipo: "factura", duplicado: true, message: "El documento ya existía (duplicado)",
          webhookResponse: { tipo: "factura", numero_documento: "ML/101511", duplicado: true }, sustituible,
        },
        error: null,
      };
    });
    montar();
    const input = screen.getByLabelText("Elegir facturas o albaranes (PDF o imágenes)");
    fireEvent.change(input, { target: { files: [new File(["x"], "ML101511.pdf", { type: "application/pdf" })] } });
    fireEvent.click(await screen.findByRole("button", { name: /Enviar 1 documento/ }));

    const boton = await screen.findByRole("button", { name: /Sustituir la existente/ });
    expect(screen.getByText(/Ya existe la factura ML\/101511 \(8 líneas\)/)).toBeTruthy();
    fireEvent.click(boton);

    expect(await screen.findByText(/¿Sustituir la factura ML\/101511\?/)).toBeTruthy();
    expect(screen.getByText("Ahora (factura 54)")).toBeTruthy();
    expect(screen.getByText(/1 graves/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Sí, sustituir/ }));

    await waitFor(() => expect(invoke).toHaveBeenCalledTimes(2));
    expect(invoke.mock.calls[1][1].body).toEqual({
      modo: "sustituir", factura_id: 54, trabajo_id: sustituible.trabajo_id,
      esperado: { lineas: 8, updated_at: "2026-09-29T15:28:55.00448" },
    });
    expect(await screen.findByText(/Factura existente sustituida/)).toBeTruthy();
  });

  it("un duplicado sin `sustituible` (servidor antiguo) se pinta como siempre, sin botón", async () => {
    invoke.mockResolvedValue({
      data: { success: true, tipo: "factura", duplicado: true, webhookResponse: { tipo: "factura", duplicado: true } },
      error: null,
    });
    montar();
    fireEvent.change(screen.getByLabelText("Elegir facturas o albaranes (PDF o imágenes)"), {
      target: { files: [new File(["x"], "a.pdf", { type: "application/pdf" })] },
    });
    fireEvent.click(await screen.findByRole("button", { name: /Enviar 1 documento/ }));
    expect(await screen.findByText(/mismo número, proveedor, fecha y total/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Sustituir la existente/ })).toBeNull();
    // El PDF falso no se puede trocear: se manda por el camino de una página.
    expect(invoke.mock.calls[0][1].body.archivo.nombre).toBe("a.pdf");
  });
});
