import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";

vi.mock("@/integrations/supabase/client", async () => {
  const m = await import("./dobleSupabaseFacturas");
  return { supabase: m.doble.supabase };
});
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ user: { id: "u1" } }) }));
vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), warning: vi.fn() }) }));

import { doble, filtra } from "./dobleSupabaseFacturas";
import { montarSubida } from "./montarSubida";
import { CLAVE_DESCARTADOS } from "@/lib/facturas/pendientesDecidir";

const sustituible = {
  trabajo_id: "33333333-3333-4333-8333-333333333333",
  existente: {
    id: 54, numero_documento: "ML/101511", proveedor: "LUGA SABORES S.L.", fecha: "2025-12-31", total: null,
    total_origen: null, lineas: 8, alertas: 1, alertas_graves: 1, updated_at: "2026-09-29T15:28:55.00448",
  },
  nuevo: { total: 3787.53, total_origen: "deducido", lineas: 54, alertas: 1, proveedor: "LUGA SABORES S.L.", fecha: "2025-12-31" },
};

const invoke = doble.invoke;

beforeEach(() => {
  doble.reiniciar();
  window.localStorage.clear();
});

const enviarUno = async (nombre: string) => {
  fireEvent.change(screen.getByLabelText("Elegir facturas o albaranes (PDF o imágenes)"), {
    target: { files: [new File(["x"], nombre, { type: "application/pdf" })] },
  });
  fireEvent.click(await screen.findByRole("button", { name: /Enviar 1 documento/ }));
};

describe("SubidaFacturas · duplicado → «Pendientes de decidir» → «Sustituir la existente»", () => {
  it("no bloquea: queda en la lista y, al confirmar, pide la sustitución con lo que vio el usuario", async () => {
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
    montarSubida();
    await enviarUno("ML101511.pdf");

    const seccion = await screen.findByRole("region", { name: "Pendientes de decidir" });
    expect(within(seccion).getByText(/Ya existe la factura ML\/101511 \(8 líneas\)/)).toBeTruthy();
    expect(screen.getByText(/está arriba, en «Pendientes de decidir»/)).toBeTruthy();
    fireEvent.click(within(seccion).getByRole("button", { name: /Sustituir la existente/ }));

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
    expect(screen.queryByRole("region", { name: "Pendientes de decidir" })).toBeNull();
  });

  it("un duplicado sin `sustituible` (servidor antiguo) se pinta como siempre, sin botón", async () => {
    invoke.mockResolvedValue({
      data: { success: true, tipo: "factura", duplicado: true, webhookResponse: { tipo: "factura", duplicado: true } },
      error: null,
    });
    montarSubida();
    await enviarUno("a.pdf");
    expect(await screen.findByText(/mismo número, proveedor, fecha y total/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Sustituir la existente/ })).toBeNull();
    // El PDF falso no se puede trocear: se manda por el camino de una página.
    expect(invoke.mock.calls[0][1].body.archivo.nombre).toBe("a.pdf");
  });

  it("los pendientes se leen de la BD al entrar (sobreviven a recargar) y «Dejar la que hay» los quita", async () => {
    doble.fijarRespuestas((tabla, llamadas) =>
      tabla === "ocr_trabajos" && filtra(llamadas, "estado", "duplicado")
        ? [{ id: sustituible.trabajo_id, nombre_original: "ML101511.pdf", created_at: "2026-10-05T10:00:00Z", resultado: { success: true, duplicado: true, sustituible } }]
        : [],
    );
    montarSubida();
    const seccion = await screen.findByRole("region", { name: "Pendientes de decidir" });
    expect(within(seccion).getByText("ML101511.pdf")).toBeTruthy();
    fireEvent.click(within(seccion).getByRole("button", { name: "Dejar la que hay" }));
    await waitFor(() => expect(screen.queryByRole("region", { name: "Pendientes de decidir" })).toBeNull());
    expect(window.localStorage.getItem(CLAVE_DESCARTADOS)).toContain(sustituible.trabajo_id);
  });
});
