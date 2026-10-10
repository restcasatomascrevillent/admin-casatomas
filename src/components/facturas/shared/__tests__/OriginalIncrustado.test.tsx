/**
 * Original incrustado al final de la ficha: imagen, PDF, solo Drive o nada.
 * `supabase.storage` va simulado; la llamada siempre va ligada (`.from(...).createSignedUrl(...)`).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const base = vi.hoisted(() => ({ firmar: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { storage: { from: (bucket: string) => ({ createSignedUrl: (path: string, s: number) => base.firmar(bucket, path, s) }) } },
}));

import { OriginalIncrustado } from "../OriginalIncrustado";

function montar(props: { driveUrl: string | null; archivoPath: string | null }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <OriginalIncrustado {...props} titulo="Factura F-1" />
    </QueryClientProvider>,
  );
}

describe("OriginalIncrustado", () => {
  beforeEach(() => {
    base.firmar.mockReset();
    base.firmar.mockResolvedValue({ data: { signedUrl: "https://x.test/firmada" }, error: null });
  });

  it("imagen: pide la URL firmada del bucket y pinta la foto; al tocarla abre el visor", async () => {
    montar({ driveUrl: null, archivoPath: "facturas/1.jpeg" });
    const img = await screen.findByAltText("Factura F-1");
    expect(base.firmar).toHaveBeenCalledWith("facturas-originales", "facturas/1.jpeg", expect.any(Number));
    expect(img).toHaveAttribute("src", "https://x.test/firmada");
    expect(img).toHaveAttribute("loading", "lazy");
    expect(screen.getByText(/ctrl \+ rueda o pellizca para ampliar/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /pantalla completa/i }));
    expect(await screen.findByTestId("visor-original")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /ver al 100/i }));
    expect(screen.getByRole("button", { name: /ajustar a la pantalla/i })).toBeInTheDocument();
  });

  it("imagen que falla: mensaje amable con Reintentar", async () => {
    montar({ driveUrl: null, archivoPath: "facturas/1.png" });
    fireEvent.error(await screen.findByAltText("Factura F-1"));
    expect(await screen.findByText(/no se ha podido cargar/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /reintentar/i }));
    await waitFor(() => expect(base.firmar).toHaveBeenCalledTimes(2));
  });

  it("pdf: vista previa en <object> y enlace «Abrir PDF»", async () => {
    const { container } = montar({ driveUrl: null, archivoPath: "facturas/1.pdf" });
    expect(await screen.findByRole("link", { name: /abrir pdf/i })).toHaveAttribute("href", "https://x.test/firmada");
    expect(container.querySelector('object[type="application/pdf"]')).toHaveAttribute("data", "https://x.test/firmada");
  });

  it("solo Drive: una línea con el enlace y sin pedir nada a Storage", () => {
    montar({ driveUrl: "https://drive.google.com/file/d/abc", archivoPath: null });
    expect(screen.getByText(/original en google drive/i)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /abrir/i })).toHaveAttribute("href", "https://drive.google.com/file/d/abc");
    expect(base.firmar).not.toHaveBeenCalled();
  });

  it("sin original: no pinta nada", () => {
    const { container } = montar({ driveUrl: null, archivoPath: null });
    expect(container).toBeEmptyDOMElement();
    expect(base.firmar).not.toHaveBeenCalled();
  });
});
