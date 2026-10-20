import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { CHEQUE_EJEMPLO, PLANTILLA_REGALO } from "@/lib/cheques/regalo";
const mock = vi.hoisted(() => ({ generar: vi.fn(), crear: vi.fn(), revocar: vi.fn() }));
vi.mock("@/lib/cheques/chequeRegaloPdf", () => ({ generarVistaRegalo: mock.generar }));
import { VistaChequeRegalo } from "../VistaChequeRegalo";

describe("Vista del cheque sin visor PDF incrustado", () => {
  beforeEach(() => {
    mock.generar.mockReset(); mock.crear.mockReset(); mock.revocar.mockReset();
    Object.defineProperty(URL, "createObjectURL", { configurable: true, value: mock.crear });
    Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: mock.revocar });
    mock.crear.mockReturnValue("blob:cheque");
    mock.generar.mockResolvedValue({ pdf: new Uint8Array([37,80,68,70]), paginas: ['<svg xmlns="http://www.w3.org/2000/svg"><text>Cheque</text></svg>'] });
  });
  it("muestra una imagen compatible con CSP y conserva la descarga del PDF", async () => {
    const { container, unmount } = render(<VistaChequeRegalo cheque={CHEQUE_EJEMPLO} />);
    const imagen = await screen.findByRole("img", { name: "Cheque regalo · página 1 de 1" });
    expect(imagen.getAttribute("src")).toMatch(/^data:image\/svg\+xml/);
    expect(container.querySelector("iframe, object, embed")).toBeNull();
    expect(screen.getByRole("link", { name: "Descargar PDF" })).toHaveAttribute("download", "Cheque-CT-EJEMPLO.pdf");
    expect(screen.getByRole("link", { name: "Descargar PDF" })).toHaveAttribute("href", "blob:cheque");
    unmount(); expect(mock.revocar).toHaveBeenCalledWith("blob:cheque");
  });
  it("actualiza el diseño y presenta todas las páginas del documento", async () => {
    const { rerender } = render(<VistaChequeRegalo cheque={CHEQUE_EJEMPLO} />);
    await screen.findByRole("img");
    mock.generar.mockResolvedValueOnce({ pdf: new Uint8Array([37,80]), paginas: ["<svg/>","<svg/>"] });
    const plantilla = { ...PLANTILLA_REGALO, pdf_titulo: "Un regalo especial" };
    rerender(<VistaChequeRegalo cheque={CHEQUE_EJEMPLO} plantilla={plantilla} />);
    await screen.findByRole("img", { name: "Cheque regalo · página 2 de 2" });
    expect(screen.getAllByRole("img")).toHaveLength(2);
    expect(screen.getByText("Página 2 de 2")).toBeTruthy();
    await waitFor(() => expect(mock.generar).toHaveBeenLastCalledWith(CHEQUE_EJEMPLO, plantilla, expect.any(String)));
    expect(mock.revocar).toHaveBeenCalledWith("blob:cheque");
  });
});
