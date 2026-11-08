import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { EtiquetaOriginal } from "../EtiquetaOriginal";

describe("EtiquetaOriginal (biblioteca de Instagram)", () => {
  it("«Original» con original en Drive, «Solo web» sin él; nada en fotos que no son de la carta", () => {
    const { rerender, container } = render(<EtiquetaOriginal foto={{ platoId: "p1", original: true }} />);
    expect(screen.getByTestId("etiqueta-original").textContent).toBe("Original");
    rerender(<EtiquetaOriginal foto={{ vinoId: "v1", original: false }} />);
    expect(screen.getByTestId("etiqueta-original").textContent).toBe("Solo web");
    rerender(<EtiquetaOriginal foto={{ original: true }} />);
    expect(container.textContent).toBe("");
    rerender(<EtiquetaOriginal foto={{ platoId: "p1" }} />);
    expect(container.textContent).toBe("");
  });
});
