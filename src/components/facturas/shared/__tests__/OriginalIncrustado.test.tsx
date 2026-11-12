/**
 * Visor del original en la ficha: Drive (servido por facturas-original, o la
 * vista previa sin id), imagen, PDF, enlace suelto o nada.
 * `supabase.storage` y `fetch` van simulados; la llamada a Storage siempre va
 * ligada (`.from(...).createSignedUrl(...)`).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const base = vi.hoisted(() => ({ firmar: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    storage: { from: (bucket: string) => ({ createSignedUrl: (path: string, s: number) => base.firmar(bucket, path, s) }) },
    auth: { getSession: async () => ({ data: { session: { access_token: "jwt-de-prueba" } } }) },
  },
}));

import { OriginalIncrustado } from "../OriginalIncrustado";

function montar(props: { driveUrl: string | null; archivoPath: string | null; documentoId?: number }) {
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
    URL.createObjectURL = vi.fn(() => "blob:original");
    URL.revokeObjectURL = vi.fn();
  });
  afterEach(() => vi.unstubAllGlobals());

  const DRIVE = "https://drive.google.com/file/d/1AbCdEfGhIjK_lm-no/view?usp=drivesdk";
  const servidor = (r: () => Response) => {
    const f = vi.fn(async (_u: string, _init?: RequestInit) => r());
    vi.stubGlobal("fetch", f);
    return f;
  };

  it("Drive con id: lo pide a facturas-original con la sesión y pinta la foto con zoom, sin iframe ni Google", async () => {
    const f = servidor(() => new Response(new Uint8Array([0xff, 0xd8, 0xff]), { status: 200, headers: { "Content-Type": "image/jpeg" } }));
    const { container } = montar({ driveUrl: DRIVE, archivoPath: null, documentoId: 7 });
    const img = await screen.findByAltText("Factura F-1");
    expect(img).toHaveAttribute("src", "blob:original");
    expect(container.querySelector("iframe")).toBeNull();
    const [url, init] = f.mock.calls[0];
    expect(url).toMatch(/\/functions\/v1\/facturas-original\?id=7$/);
    expect(new Headers(init?.headers).get("authorization")).toBe("Bearer jwt-de-prueba");
    expect(screen.getByRole("link", { name: /abrir en drive/i })).toHaveAttribute("href", DRIVE);
    // Zoom y pantalla completa, como la copia de Storage.
    fireEvent.click(screen.getByRole("button", { name: /pantalla completa/i }));
    expect(await screen.findByTestId("visor-original")).toBeInTheDocument();
    expect(base.firmar).not.toHaveBeenCalled();
  });

  it("Drive con id y PDF: <object> con el blob", async () => {
    servidor(() => new Response("%PDF-1.4", { status: 200, headers: { "Content-Type": "application/pdf" } }));
    const { container } = montar({ driveUrl: DRIVE, archivoPath: null, documentoId: 7 });
    await waitFor(() => expect(container.querySelector('object[type="application/pdf"]')).toHaveAttribute("data", "blob:original"));
  });

  it("Drive con id que falla: aviso claro con el motivo, «Reintentar» y «Abrir en Drive»", async () => {
    const f = servidor(
      () => new Response(JSON.stringify({ ok: false, error: "La cuenta de Google del restaurante no encuentra este archivo en Drive" }), { status: 404, headers: { "Content-Type": "application/json" } }),
    );
    montar({ driveUrl: DRIVE, archivoPath: null, documentoId: 7 });
    const aviso = await screen.findByText(/no se ha podido cargar el original desde google drive/i);
    expect(aviso).toHaveTextContent("no encuentra este archivo en Drive");
    expect(aviso).toHaveTextContent("«Abrir en Drive»");
    expect(screen.getByRole("link", { name: /abrir en drive/i })).toHaveAttribute("href", DRIVE);
    fireEvent.click(screen.getByRole("button", { name: /reintentar/i }));
    await waitFor(() => expect(f).toHaveBeenCalledTimes(2));
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

  it("Drive sin id: vista previa incrustada (/preview) con «Abrir en Drive», sin pedir nada a Storage", () => {
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
