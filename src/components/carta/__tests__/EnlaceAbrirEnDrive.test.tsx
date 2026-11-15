import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { EnlaceAbrirEnDrive, urlCarpetaDrive } from "../EnlaceAbrirEnDrive";

describe("EnlaceAbrirEnDrive", () => {
  it("con una carpeta válida enlaza a Drive en una pestaña nueva", () => {
    render(<EnlaceAbrirEnDrive carpetaId="1AbCdEfGhIjKlMnOpQrS" />);
    const a = screen.getByTestId("abrir-en-drive") as HTMLAnchorElement;
    expect(a.href).toBe("https://drive.google.com/drive/folders/1AbCdEfGhIjKlMnOpQrS");
    expect(a.target).toBe("_blank");
    expect(a.rel).toContain("noopener");
    expect(a.textContent).toMatch(/Abrir en Drive/);
  });

  it("sin carpeta (o con un id raro) no sale nada", () => {
    for (const v of [null, undefined, "", "corto", "con/barra/xxxxxxxxxxxx", "https://evil.example/x"]) {
      const { container, unmount } = render(<EnlaceAbrirEnDrive carpetaId={v} />);
      expect(container.innerHTML).toBe("");
      expect(urlCarpetaDrive(v)).toBeNull();
      unmount();
    }
  });
});
