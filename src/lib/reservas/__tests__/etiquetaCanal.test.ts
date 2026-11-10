import { describe, expect, it } from "vitest";
import { etiquetaCanal } from "../etiquetaCanal";

describe("etiquetaCanal", () => {
  it("los sentados sin reserva (presencial) son «En local», no «Web»", () => {
    expect(etiquetaCanal("presencial")).toBe("En local");
    expect(etiquetaCanal("telefono")).toBe("Teléfono");
    expect(etiquetaCanal(null)).toBe("Web");
    expect(etiquetaCanal("otro")).toBe("otro");
  });
});
