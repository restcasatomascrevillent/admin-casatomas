/**
 * Visor del original en la ficha: Drive (vista previa), imagen, PDF, enlace suelto o nada.
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

  it("Drive: vista previa incrustada (/preview) con «Abrir en Drive», sin pedir nada a Storage", () => {
    const url = "https://drive.google.com/file/d/1AbCdEfGhIjK_lm-no/view?usp=drivesdk";
    montar({ driveUrl: url, archivoPath: null });
    const marco = screen.getByTitle("Original: Factura F-1");
    expect(marco.tagName).toBe("IFRAME");
    expect(marco).toHaveAttribute("src", "https://drive.google.com/file/d/1AbCdEfGhIjK_lm-no/preview");
    expect(screen.getByRole("link", { name: /abrir en drive/i })).toHaveAttribute("href", url);
    // Un solo enlace para abrirlo fuera: nada de la antigua fila «Original en Google Drive · Abrir».
    expect(screen.getAllByRole("link")).toHaveLength(1);
    expect(screen.queryByText(/original en google drive/i)).not.toBeInTheDocument();
    expect(base.firmar).not.toHaveBeenCalled();
  });

  it("Drive y copia en Storage: manda Drive (la copia es temporal)", () => {
    const { container } = montar({ driveUrl: "https://drive.google.com/open?id=1AbCdEfGhIjK", archivoPath: "facturas/1.jpeg" });
    expect(container.querySelector("iframe")).toHaveAttribute("src", "https://drive.google.com/file/d/1AbCdEfGhIjK/preview");
    expect(base.firmar).not.toHaveBeenCalled();
  });

  it("enlace de Drive del que no sale el id: una línea con «Abrir en Drive»", () => {
    const { container } = montar({ driveUrl: "https://drive.google.com/drive/folders", archivoPath: null });
    expect(container.querySelector("iframe")).toBeNull();
    expect(screen.getByRole("link", { name: /abrir en drive/i })).toHaveAttribute("href", "https://drive.google.com/drive/folders");
  });

  it("sin original: estado vacío discreto y sin pedir nada", () => {
    montar({ driveUrl: null, archivoPath: null });
    expect(screen.getByTestId("sin-original")).toHaveTextContent("No se guardó el original de este documento.");
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
    expect(base.firmar).not.toHaveBeenCalled();
  });
});
