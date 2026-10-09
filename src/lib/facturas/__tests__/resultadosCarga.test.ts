import { describe, expect, it, vi } from "vitest";

vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));

import { aResultado, type ElementoCola, normalizarTipo, type ResultadoProcesamiento } from "../colaSubida";
import {
  claseFichero,
  formatoTamano,
  lineaEstado,
  nivelFila,
  ordenarPorGravedad,
  tipoDocumento,
} from "../resultadosCarga";

const ok = (extra: Partial<ResultadoProcesamiento> = {}): ResultadoProcesamiento => ({
  nombre: "x", success: true, tipo: "factura", alertas: [], archivoGuardado: true, duplicado: false, ...extra,
});

const el = (id: string, resultado: ResultadoProcesamiento | undefined, extra: Partial<ElementoCola> = {}): ElementoCola => ({
  id, nombre: `${id}.pdf`, file: null, preview: "", tamano: 1, fase: resultado ? "terminado" : "procesando", progreso: "", tanda: 1, resultado, ...extra,
});

describe("tipoDocumento: Factura o Albarán según el resultado real", () => {
  it("un albarán sale como albarán (con o sin tilde, en mayúsculas o con espacios)", () => {
    for (const t of ["albaran", "albarán", "ALBARÁN", " Albaran "]) {
      expect(tipoDocumento(ok({ tipo: t }))).toBe("albaran");
    }
  });

  it("una factura sale como factura", () => {
    expect(tipoDocumento(ok({ tipo: "factura" }))).toBe("factura");
    expect(tipoDocumento(ok({ tipo: "Factura" }))).toBe("factura");
  });

  it("si el tipo de arriba no está, manda el de la respuesta del servidor", () => {
    expect(tipoDocumento(ok({ tipo: undefined, respuesta: { tipo: "albarán" } }))).toBe("albaran");
  });

  it("sin tipo reconocible no inventa «factura»", () => {
    expect(tipoDocumento(ok({ tipo: undefined }))).toBeNull();
    expect(tipoDocumento(ok({ tipo: "nota" }))).toBeNull();
    expect(tipoDocumento(undefined)).toBeNull();
    expect(normalizarTipo(42)).toBeNull();
  });

  it("aResultado normaliza el tipo que llega del servidor, también el del albarán con tilde", () => {
    const r = aResultado("a.pdf", { success: true, tipo: "albarán", webhookResponse: { tipo: "albarán" }, alertas: [] });
    expect(r.tipo).toBe("albaran");
    expect(aResultado("b.pdf", { success: true, webhookResponse: { tipo: "factura" } }).tipo).toBe("factura");
    // El del webhookResponse manda, como siempre; sin ninguno, queda sin tipo.
    expect(aResultado("c.pdf", { success: true }).tipo).toBeUndefined();
  });
});

describe("ordenarPorGravedad: fallido → aviso → duplicado → ok", () => {
  const fallido = el("fallido", { nombre: "f", success: false, error: "borrosa" });
  const aviso = el("aviso", ok({ alertas: [{ codigo: "suma", severidad: "media", mensaje: "No cuadra" }] }));
  const sinOriginal = el("sinoriginal", ok({ archivoGuardado: false }));
  const duplicado = el("duplicado", ok({ duplicado: true }));
  const pendiente = el("pendiente", ok({ duplicado: true, sustituible: {} as never }));
  const guardado = el("guardado", ok());
  const sustituido = el("sustituido", ok({ sustituida: true }));
  const enMarcha = el("marcha", undefined);

  it("clasifica cada resultado en su nivel", () => {
    expect(nivelFila(fallido)).toBe("fallido");
    expect(nivelFila(aviso)).toBe("aviso");
    expect(nivelFila(sinOriginal)).toBe("aviso");
    expect(nivelFila(duplicado)).toBe("duplicado");
    expect(nivelFila(pendiente)).toBe("duplicado");
    expect(nivelFila(guardado)).toBe("ok");
    expect(nivelFila(sustituido)).toBe("ok");
    expect(nivelFila(enMarcha)).toBe("marcha");
  });

  it("ordena sea cual sea el orden de llegada; los que siguen en marcha, arriba", () => {
    const orden = ordenarPorGravedad([guardado, duplicado, aviso, fallido, enMarcha]).map((e) => e.id);
    expect(orden).toEqual(["marcha", "fallido", "aviso", "duplicado", "guardado"]);
    const otro = ordenarPorGravedad([fallido, guardado, enMarcha, duplicado, aviso]).map((e) => e.id);
    expect(otro).toEqual(["marcha", "fallido", "aviso", "duplicado", "guardado"]);
  });

  it("dentro del mismo nivel, el último enviado primero, y no toca el original", () => {
    const a = el("a", ok());
    const b = el("b", ok());
    const entrada = [a, b];
    expect(ordenarPorGravedad(entrada).map((e) => e.id)).toEqual(["b", "a"]);
    expect(entrada.map((e) => e.id)).toEqual(["a", "b"]);
  });
});

describe("lineaEstado: una sola línea por documento", () => {
  it("fallido: el error del servidor", () => {
    expect(lineaEstado(el("f", { nombre: "f", success: false, error: "la foto está borrosa" }))).toEqual({
      nivel: "fallido", texto: "la foto está borrosa",
    });
  });

  it("aviso: cuenta y mensajes en la misma línea", () => {
    const l = lineaEstado(el("a", ok({ alertas: [
      { codigo: "a", severidad: "media", mensaje: "No cuadra" },
      { codigo: "b", severidad: "baja", mensaje: "Falta fecha" },
    ] })));
    expect(l.nivel).toBe("aviso");
    expect(l.texto).toBe("2 avisos: No cuadra · Falta fecha");
    expect(l.texto).not.toContain("\n");
  });

  it("sin original archivado: aviso, no «guardado»", () => {
    const l = lineaEstado(el("s", ok({ archivoGuardado: false })));
    expect(l.nivel).toBe("aviso");
    expect(l.texto).toMatch(/no se ha podido archivar/);
  });

  it("duplicado, sustituido, guardado y en marcha", () => {
    expect(lineaEstado(el("d", ok({ duplicado: true }))).texto).toMatch(/mismo número, proveedor, fecha y total/);
    expect(lineaEstado(el("p", ok({ duplicado: true, sustituible: {} as never }))).texto).toMatch(/«Pendientes de decidir»/);
    expect(lineaEstado(el("x", ok({ sustituida: true }))).texto).toMatch(/sustituida/);
    expect(lineaEstado(el("g", ok()))).toEqual({ nivel: "ok", texto: "Guardado" });
    expect(lineaEstado(el("m", undefined, { progreso: "Subiendo…" }))).toEqual({ nivel: "marcha", texto: "Subiendo…" });
    expect(lineaEstado(el("l", undefined, { progreso: "Leyendo", piezas: 4 })).texto).toMatch(/Documento largo: se lee en 4 trozos/);
  });
});

describe("fichero de la cola", () => {
  it("tamaño legible", () => {
    expect(formatoTamano(0)).toBe("");
    expect(formatoTamano(100)).toBe("1 KB");
    expect(formatoTamano(312 * 1024)).toBe("312 KB");
    expect(formatoTamano(1.5 * 1024 * 1024)).toBe("1,5 MB");
  });

  it("icono según el tipo de fichero", () => {
    expect(claseFichero({ file: new File(["x"], "a.pdf", { type: "application/pdf" }), nombre: "a.pdf" })).toBe("pdf");
    expect(claseFichero({ file: new File(["x"], "a.png", { type: "image/png" }), nombre: "a.png" })).toBe("imagen");
    expect(claseFichero({ file: null, nombre: "luga.JPG" })).toBe("imagen");
    expect(claseFichero({ file: null, nombre: "datos.xml" })).toBe("otro");
  });
});
