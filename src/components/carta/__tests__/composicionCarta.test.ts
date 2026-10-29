import { describe, expect, it, vi } from "vitest";

vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));

import {
  CENTRO_Y_PLATO,
  FONDO_ACTIVO,
  OCUPACION_PLATO,
  PLATO_ALTO,
  PLATO_ANCHO,
  planPlato,
  temasDisponibles,
} from "../composicionCarta";
import { TEMAS } from "../composicionVino";
import { rutaOriginalDesdeCarta } from "../rutasFotoCarta";
import { rutaEnBucket, rutasSubida } from "../subirFotoCarta";

describe("planPlato (layout 4:3 de platos)", () => {
  it("el lienzo es 4:3", () => {
    expect(PLATO_ANCHO / PLATO_ALTO).toBeCloseTo(4 / 3);
  });

  it("plato redondo: lo limita el alto, ocupa el 78 % y queda centrado", () => {
    const { destino: d } = planPlato({ x: 100, y: 50, w: 800, h: 800 });
    expect(d.h).toBe(Math.round(PLATO_ALTO * OCUPACION_PLATO));
    expect(d.w).toBe(d.h);
    expect(d.x + d.w / 2).toBeCloseTo(PLATO_ANCHO / 2, 0);
    expect(d.y + d.h / 2).toBeCloseTo(PLATO_ALTO * CENTRO_Y_PLATO, 0);
  });

  it("plato muy alargado: lo limita el ancho y no se sale del lienzo", () => {
    const { destino: d } = planPlato({ x: 0, y: 0, w: 2000, h: 500 });
    expect(d.w).toBe(Math.round(PLATO_ANCHO * OCUPACION_PLATO));
    expect(d.h).toBeLessThan(PLATO_ALTO * OCUPACION_PLATO);
    expect(d.x).toBeGreaterThanOrEqual(0);
    expect(d.y).toBeGreaterThanOrEqual(0);
    expect(d.x + d.w).toBeLessThanOrEqual(PLATO_ANCHO);
    expect(d.y + d.h).toBeLessThanOrEqual(PLATO_ALTO);
  });

  it("plato pequeño en la foto: se amplía igual", () => {
    const { escala, destino: d } = planPlato({ x: 10, y: 10, w: 200, h: 150 });
    expect(escala).toBeGreaterThan(1);
    expect(Math.max(d.w / PLATO_ANCHO, d.h / PLATO_ALTO)).toBeCloseTo(OCUPACION_PLATO, 2);
  });
});

describe("temasDisponibles", () => {
  it("lista todos los temas de composicionVino, incluido el activo", () => {
    const lista = temasDisponibles();
    expect(lista.map((t) => t.clave)).toEqual(Object.keys(TEMAS));
    expect(lista.some((t) => t.clave === FONDO_ACTIVO)).toBe(true);
    for (const t of lista) expect(t.color).toMatch(/^#|^rgb/);
  });
});

describe("rutasSubida", () => {
  const original = new File(["x"], "IMG_0001.JPEG", { type: "image/jpeg" });

  it("con foto de carta: original intacto + `-carta-<ext>.webp` (se puede volver)", () => {
    const carta = new File(["y"], "foto-carta.webp", { type: "image/webp" });
    const r = rutasSubida("abc", original, carta);
    expect(r).toEqual({ original: "abc.jpeg", carta: "abc-carta-jpeg.webp" });
    expect(rutaOriginalDesdeCarta(r.carta)).toBe("abc.jpeg");
  });

  it("Safari (JPEG): `-carta-<ext>.jpg`", () => {
    const carta = new File(["y"], "foto-carta.jpg", { type: "image/jpeg" });
    expect(rutasSubida("abc", original, carta).carta).toBe("abc-carta-jpeg.jpg");
  });

  it("solo original", () => {
    expect(rutasSubida("abc", new File(["x"], "sin-extension", { type: "image/png" }), null)).toEqual({
      original: "abc.jpg",
      carta: null,
    });
  });
});

describe("rutaEnBucket", () => {
  it("saca la ruta de la URL pública (sin ?t=)", () => {
    const url = "https://x.supabase.co/storage/v1/object/public/platos/abc-carta-jpeg.webp?t=123";
    expect(rutaEnBucket(url, "platos")).toBe("abc-carta-jpeg.webp");
    expect(rutaEnBucket(url, "vinos")).toBeNull();
    expect(rutaEnBucket(null, "platos")).toBeNull();
  });
});
