/**
 * «Lo que publicáis ahora»: no llama al montar; al pulsar «Cargar» pinta
 * stories y publicaciones; si falla, mensaje en llano.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

const leerReferencias = vi.fn();
vi.mock("../api", () => ({ leerReferencias: (...a: unknown[]) => leerReferencias(...a) }));

import { LoQuePublicais } from "../LoQuePublicais";

function pintar(ui: ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

beforeEach(() => {
  leerReferencias.mockReset();
});

describe("LoQuePublicais", () => {
  it("no llama al montar y al pulsar «Cargar» pinta stories y publicaciones", async () => {
    leerReferencias.mockResolvedValue({
      marca: "casa-tomas",
      cuenta: { igUserId: "1", username: "casatomas" },
      stories: [{ id: "9", tipo: "story", mediaUrl: null, miniaturaUrl: "https://cdn/9.jpg", permalink: "https://instagram.com/s/9", caption: null, fecha: "2026-11-12T08:00:00+0000" }],
      publicaciones: [{ id: "1", tipo: "reel", mediaUrl: null, miniaturaUrl: "https://cdn/1.jpg", permalink: "https://instagram.com/p/1", caption: "Chuletón a la brasa", fecha: "2026-11-10T12:00:00+0000" }],
      avisos: [],
    });
    pintar(<LoQuePublicais marca="casa-tomas" />);
    expect(screen.getByText("Lo que publicáis ahora")).toBeTruthy();
    expect(leerReferencias).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: /Cargar/ }));
    await waitFor(() => expect(screen.getAllByTestId("referencia")).toHaveLength(2));
    expect(leerReferencias).toHaveBeenCalledWith("casa-tomas");
    expect(screen.getByText("Stories activas")).toBeTruthy();
    expect(screen.getByText("Chuletón a la brasa")).toBeTruthy();
    const enlaces = screen.getAllByRole("link", { name: /Ver en Instagram/ });
    expect(enlaces[0].getAttribute("target")).toBe("_blank");
    expect(enlaces[0].getAttribute("rel")).toContain("noopener");
    expect(screen.getByRole("button", { name: /Actualizar/ })).toBeTruthy();
  });

  it("si falla, mensaje en llano", async () => {
    leerReferencias.mockImplementation(async () => {
      throw new Error("Falta IG_USER_ID_CASA_TOMAS");
    });
    pintar(<LoQuePublicais marca="casa-tomas" />);
    fireEvent.click(screen.getByRole("button", { name: /Cargar/ }));
    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(screen.getByText(/No se han podido leer las publicaciones/)).toBeTruthy();
  });
});
