import { describe, it, expect } from "vitest";
import { agruparSuscriptores, etiquetaOrigenBaja, esBajaPorEntrega, formatearFechaBaja, type SuscriptorNewsletter } from "../bajas";

const fila = (p: Partial<SuscriptorNewsletter>): SuscriptorNewsletter => ({
  id: p.id ?? Math.random().toString(),
  email: p.email ?? "a@b.es",
  nombre: null,
  activo: true,
  created_at: "2026-09-01T10:00:00Z",
  fecha_baja: null,
  origen_baja: null,
  ...p,
});

describe("agruparSuscriptores", () => {
  it("separa activos y bajas; activo=false es baja aunque no tenga fecha", () => {
    const { activos, bajas } = agruparSuscriptores([
      fila({ id: "1" }),
      fila({ id: "2", activo: false }),
      fila({ id: "3", activo: false, fecha_baja: "2026-10-01T10:00:00Z", origen_baja: "enlace_email" }),
    ]);
    expect(activos.map((f) => f.id)).toEqual(["1"]);
    expect(bajas.map((f) => f.id)).toEqual(["3", "2"]);
  });

  it("bajas más recientes primero", () => {
    const { bajas } = agruparSuscriptores([
      fila({ id: "viejo", activo: false, fecha_baja: "2026-09-20T10:00:00Z" }),
      fila({ id: "nuevo", activo: false, fecha_baja: "2026-10-02T10:00:00Z" }),
    ]);
    expect(bajas.map((f) => f.id)).toEqual(["nuevo", "viejo"]);
  });
});

describe("etiquetaOrigenBaja", () => {
  it("traduce todos los orígenes del CHECK", () => {
    expect(etiquetaOrigenBaja("enlace_email")).toMatch(/enlace/i);
    expect(etiquetaOrigenBaja("cabecera_one_click")).toMatch(/Cancelar suscripción/);
    expect(etiquetaOrigenBaja("queja_spam")).toMatch(/spam/);
    expect(etiquetaOrigenBaja("rebote_permanente")).toMatch(/inexistente/);
    expect(etiquetaOrigenBaja("suprimido_resend")).toMatch(/Resend/);
    expect(etiquetaOrigenBaja("resend_baja_nativa")).toMatch(/Resend/);
    expect(etiquetaOrigenBaja("panel_manual")).toMatch(/panel/);
    expect(etiquetaOrigenBaja(null)).toMatch(/antigua/);
    expect(etiquetaOrigenBaja("otro")).toBe("otro");
  });

  it("marca como 'por entrega' solo queja, rebote y supresión", () => {
    expect(esBajaPorEntrega("queja_spam")).toBe(true);
    expect(esBajaPorEntrega("rebote_permanente")).toBe(true);
    expect(esBajaPorEntrega("suprimido_resend")).toBe(true);
    expect(esBajaPorEntrega("enlace_email")).toBe(false);
    expect(esBajaPorEntrega(null)).toBe(false);
  });
});

describe("formatearFechaBaja", () => {
  it("sin fecha o fecha inválida", () => {
    expect(formatearFechaBaja(null)).toBe("Fecha no registrada");
    expect(formatearFechaBaja("nope")).toBe("Fecha no registrada");
    expect(formatearFechaBaja("2026-10-03T08:00:00Z")).toMatch(/2026/);
  });
});
