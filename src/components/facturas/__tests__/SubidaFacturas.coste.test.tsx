import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";

vi.mock("@/integrations/supabase/client", async () => {
  const m = await import("./dobleSupabaseFacturas");
  return { supabase: m.doble.supabase };
});
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ user: { id: "u1" } }) }));
vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), warning: vi.fn() }) }));

import { doble } from "./dobleSupabaseFacturas";
import { montarSubida } from "./montarSubida";
import { aResultado, type ResultadoProcesamiento } from "@/lib/facturas/colaSubida";
import { SinDocumentosLargos } from "@/lib/facturas/documentoLargo";

const servidorAntiguo = async (): Promise<never> => {
  throw new SinDocumentosLargos("Un documento de una sola pieza va por el camino normal");
};
const base = { alertas: [] as never[], archivoGuardado: true, duplicado: false, tipo: "factura", success: true as const };

const resultados = async (_f: File, nombre: string): Promise<ResultadoProcesamiento> => {
  if (nombre.startsWith("garre")) return { nombre, ...base, facturaId: 39, costeUsd: 0.0043 };
  if (nombre.startsWith("luga")) return { nombre, ...base, facturaId: 54, costeUsd: 0.03488 };
  if (nombre.startsWith("repetido")) return { nombre, ...base, duplicado: true, archivoGuardado: undefined, costeUsd: 0.0087 };
  if (nombre.startsWith("fallo")) return { nombre, success: false, error: "No se pudo leer" };
  return { nombre, ...base, facturaId: 7 }; // servidor sin la medición: no hay coste
};

const elegir = (nombres: string[]) =>
  fireEvent.change(screen.getByLabelText("Elegir facturas o albaranes (PDF o imágenes)"), {
    target: { files: nombres.map((n) => new File(["x".repeat(2048)], n, { type: "application/pdf" })) },
  });

beforeEach(() => {
  doble.reiniciar();
  window.localStorage.clear();
});

describe("Cargar · coste de lectura de cada documento", () => {
  it("cada resultado con coste muestra «lectura X cént.» en gris; sin coste o fallido, nada", async () => {
    montarSubida({ deps: { planificar: async () => ({ camino: "unico" }), iniciarUnico: servidorAntiguo, procesarUnico: resultados } });
    elegir(["garre.pdf", "luga.pdf", "repetido.pdf", "viejo.pdf", "fallo.pdf"]);
    fireEvent.click(screen.getByRole("button", { name: /Enviar 5 documentos/ }));
    const seccion = await screen.findByRole("region", { name: "Documentos enviados" });
    await waitFor(() => expect(seccion.querySelectorAll("li[data-nivel='ok']").length).toBeGreaterThanOrEqual(3));
    const fila = (nombre: string) => Array.from(seccion.querySelectorAll("li")).find((f) => within(f).queryByText(nombre))!;

    // 0,0043 $ x 0,92 = 0,40 cént.; 0,03488 $ x 0,92 = 3,2 cént.; 0,0087 $ x 0,92 = 0,8 cént.
    expect(within(fila("garre.pdf")).getByTestId("coste-lectura")).toHaveTextContent("lectura 0,4 cént.");
    expect(within(fila("luga.pdf")).getByTestId("coste-lectura")).toHaveTextContent("lectura 3,2 cént.");
    // Un duplicado también se pagó: se ve lo que costó leerlo.
    expect(within(fila("repetido.pdf")).getByTestId("coste-lectura")).toHaveTextContent("lectura 0,8 cént.");
    expect(within(fila("viejo.pdf")).queryByTestId("coste-lectura")).toBeNull();
    expect(within(fila("fallo.pdf")).queryByTestId("coste-lectura")).toBeNull();
    // El detalle exacto está en el tooltip.
    expect(within(fila("luga.pdf")).getByTestId("coste-lectura")).toHaveAttribute("title", expect.stringContaining("0,0349 $"));
  });
});

describe("aResultado · coste de la respuesta", () => {
  it("lo toma de coste_usd (camino síncrono y trabajos); ausente o basura = sin coste", () => {
    const ok = { success: true, tipo: "factura", webhookResponse: { factura_id: 5 }, alertas: [], archivo_guardado: true };
    expect(aResultado("a.pdf", { ...ok, coste_usd: 0.0123 }).costeUsd).toBe(0.0123);
    expect(aResultado("a.pdf", { ...ok, coste_usd: 0 }).costeUsd).toBe(0);
    expect("costeUsd" in aResultado("a.pdf", ok)).toBe(false);
    expect("costeUsd" in aResultado("a.pdf", { ...ok, coste_usd: "n/a" })).toBe(false);
    expect("costeUsd" in aResultado("a.pdf", { ...ok, coste_usd: -1 })).toBe(false);
  });
});
