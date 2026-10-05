import { describe, expect, it, vi } from "vitest";
import { admiteDetalleOriginal, configModelo, costeUsd, MODELO_POR_DEFECTO } from "./modelo.ts";
import { compararTiempoConstante, verificarSecreto } from "./auth.ts";
import { validarInicio } from "./trabajos.ts";
import { bloqueRepetido, motivosLocales, PAGINA_JSON_SCHEMA, validarPagina } from "./pagina.ts";
import { leerPieza } from "./pieza.ts";
import { anexoPieza, CIF_CLIENTE, VISION_SYSTEM_PROMPT } from "./prompts.ts";
import { crearClienteOpenAI } from "./openai.ts";

// ─── modelo ──────────────────────────────────────────────────────────────────
describe("modelo configurable (OCR_MODELO / OCR_MODELO_PIEZAS / OCR_DETALLE)", () => {
  it("por defecto: gpt-5.6-luna con detail original (ver 04b §1.14)", () => {
    const c = configModelo();
    expect(c.modelo).toBe(MODELO_POR_DEFECTO);
    expect(c.modelo).toBe("gpt-5.6-luna");
    expect(c.detalle).toBe("original");
    expect(c.maxTokensExtraccion).toBe(32000);
  });
  it("gpt-5-mini no admite 'original': cae a 'high' (el de v101)", () => {
    expect(configModelo({ OCR_MODELO: "gpt-5-mini" })).toMatchObject({ modelo: "gpt-5-mini", detalle: "high" });
  });
  it("gpt-5.4-mini con original; OCR_DETALLE=high lo fuerza", () => {
    expect(configModelo({ OCR_MODELO: "gpt-5.4-mini" }).detalle).toBe("original");
    expect(configModelo({ OCR_MODELO: "gpt-5.4-mini", OCR_DETALLE: "high" }).detalle).toBe("high");
  });
  it("OCR_MODELO_PIEZAS solo afecta al camino de piezas", () => {
    const env = { OCR_MODELO: "gpt-5.4-mini", OCR_MODELO_PIEZAS: "gpt-5.6-luna" };
    expect(configModelo(env, "unico").modelo).toBe("gpt-5.4-mini");
    expect(configModelo(env, "piezas").modelo).toBe("gpt-5.6-luna");
    expect(configModelo({ OCR_MODELO: "gpt-5.4-mini" }, "piezas").modelo).toBe("gpt-5.4-mini");
  });
  it("valores raros se ignoran", () => {
    expect(configModelo({ OCR_MODELO: "  " }).modelo).toBe(MODELO_POR_DEFECTO);
    expect(configModelo({ OCR_MODELO: "gpt 5; drop" }).modelo).toBe(MODELO_POR_DEFECTO);
  });
  it("tabla de detail original y coste", () => {
    expect(admiteDetalleOriginal("gpt-5.4-mini-2026-03-17")).toBe(true);
    expect(admiteDetalleOriginal("gpt-6-luna")).toBe(true);
    expect(admiteDetalleOriginal("gpt-5.1")).toBe(false);
    expect(costeUsd(configModelo({ OCR_MODELO: "gpt-5-mini" }), { prompt_tokens: 1_000_000, completion_tokens: 1_000_000 }))
      .toBe(2.25);
  });
  it("el payload lleva el modelo configurado y se anota el uso", async () => {
    const fetch = vi.fn(async () =>
      new Response(JSON.stringify({ choices: [{ message: { content: '{"filas_tabla":3}' } }], usage: { prompt_tokens: 10, completion_tokens: 5 } }))
    );
    const cli = crearClienteOpenAI({ apiKey: "k", config: configModelo({ OCR_MODELO: "gpt-5-mini" }), fetch: fetch as never });
    await cli.contarFilas({ type: "image_url", image_url: { url: "data:x", detail: "high" } });
    const llamada = fetch.mock.calls[0] as unknown as [string, { body: string }];
    expect(JSON.parse(llamada[1].body).model).toBe("gpt-5-mini");
    expect(cli.uso.llamadas).toBe(1);
  });
  it("reintenta un 429 de límite por minuto y luego sigue", async () => {
    let n = 0;
    const fetch = vi.fn(async () =>
      ++n === 1
        ? new Response("Please try again in 0.01s", { status: 429 })
        : new Response(JSON.stringify({ choices: [{ message: { content: '{"filas_tabla":2}' } }] }))
    );
    const cli = crearClienteOpenAI({ apiKey: "k", config: configModelo(), fetch: fetch as never });
    expect((await cli.contarFilas({}))?.filas_tabla).toBe(2);
    expect(fetch).toHaveBeenCalledTimes(2);
  });
});

// ─── cliente ≠ proveedor ─────────────────────────────────────────────────────
describe("prompt: el CIF del cliente (MASIDE) nunca es el del proveedor (Garre, factura 39)", () => {
  it("el prompt y el esquema de pieza nombran el CIF del cliente y la regla", () => {
    expect(CIF_CLIENTE).toBe("B54583356");
    expect(VISION_SYSTEM_PROMPT).toContain("B54583356");
    expect(VISION_SYSTEM_PROMPT).toMatch(/NUNCA es la\s+respuesta de "cif"/);
    expect(JSON.stringify(PAGINA_JSON_SCHEMA)).toContain("Nunca B54583356");
  });
});

// ─── ocr-trabajo: secreto ────────────────────────────────────────────────────
describe("verificarSecreto (ocr-trabajo, falla cerrado)", () => {
  const req = (h?: string) => new Request("https://x", { method: "POST", headers: h ? { "x-ocr-secret": h } : {} });
  it("sin secreto configurado → 500", () => expect(verificarSecreto(req("a"), undefined)?.status).toBe(500));
  it("sin cabecera o distinta → 401", () => {
    expect(verificarSecreto(req(), "s3cr3t")?.status).toBe(401);
    expect(verificarSecreto(req("s3cr3"), "s3cr3t")?.status).toBe(401);
  });
  it("correcto → null", () => expect(verificarSecreto(req("s3cr3t"), "s3cr3t")).toBeNull());
  it("comparación en tiempo constante", () => {
    expect(compararTiempoConstante("abc", "abc")).toBe(true);
    expect(compararTiempoConstante("abc", "abcd")).toBe(false);
  });
});

// ─── procesar-factura modo iniciar ───────────────────────────────────────────
describe("validarInicio (modo iniciar)", () => {
  const uid = "11111111-1111-4111-8111-111111111111";
  const tid = "22222222-2222-4222-8222-222222222222";
  const base = "pendientes/" + uid + "/" + tid;
  const pieza = (n: number, extra: Record<string, unknown> = {}) => ({
    numero: n, path: base + "/0" + n + ".jpg", mime: "image/jpeg", bytes: 1000,
    pieza: "franja", pagina_doc: 1, franja: n, franjas_pagina: 3, ...extra,
  });
  const ok = {
    trabajo_id: tid, nombre: "luga.jpeg", origen: "imagen",
    original: { path: base + "/original.jpg", mime: "image/jpeg", bytes: 5000 },
    piezas: [pieza(1), pieza(2), pieza(3)],
  };
  it("acepta 3 franjas bien formadas", () => {
    const r = validarInicio(ok, uid);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.peticion.piezas.map((p) => p.franja)).toEqual([1, 2, 3]);
  });
  it("rechaza rutas de otro usuario", () => {
    expect(validarInicio({ ...ok, piezas: [pieza(1), pieza(2, { path: "pendientes/otro/" + tid + "/02.jpg" })] }, uid).ok).toBe(false);
    expect(validarInicio({ ...ok, original: { ...ok.original, path: "pendientes/otro/" + tid + "/o.jpg" } }, uid).ok).toBe(false);
  });
  it("rechaza huecos, N=1, N=41, trabajo no UUID, mime y tamaños malos, '..'", () => {
    expect(validarInicio({ ...ok, piezas: [pieza(1), pieza(3)] }, uid).ok).toBe(false);
    expect(validarInicio({ ...ok, piezas: [pieza(1)] }, uid).ok).toBe(false);
    const muchas = Array.from({ length: 41 }, (_, i) => pieza(i + 1, { franja: 1, franjas_pagina: 1 }));
    expect(validarInicio({ ...ok, piezas: muchas }, uid).ok).toBe(false);
    expect(validarInicio({ ...ok, trabajo_id: "x" }, uid).ok).toBe(false);
    expect(validarInicio({ ...ok, piezas: [pieza(1), pieza(2, { mime: "text/html" })] }, uid).ok).toBe(false);
    expect(validarInicio({ ...ok, piezas: [pieza(1), pieza(2, { bytes: 11 * 1024 * 1024 })] }, uid).ok).toBe(false);
    expect(validarInicio({ ...ok, piezas: [pieza(1), pieza(2, { path: base + "/../x.jpg" })] }, uid).ok).toBe(false);
  });
});

// ─── una pieza ───────────────────────────────────────────────────────────────
const fila = (nombre: string, total: number, cantidad = 1) => ({
  nombre, cantidad, unidad: "ud", peso_kg: null, base_precio: "por_unidad", precio_unitario: total / cantidad, total,
  importe_literal: total.toFixed(2), bonificada: false, albaran_ref: null, es_fila_arrastre: false, partida: "no",
});
const respuesta = (lineas: unknown[], filas = lineas.length) => ({
  pie: { total_literal: null, subtotal_literal: null, iva_literal: null, subtotal: null, iva: null, total: null, tabla_totales_vacia: false },
  pagina_visible: { literal: null, numero_impreso: null, total_impreso: null },
  cabecera_visible: {
    titulo_literal: null, tipo: null, proveedor: null, cif: null, numero_documento: null,
    numero_etiqueta_literal: null, fecha: null, fecha_literal: null,
  },
  sin_importes: false,
  formato_numerico: { formato: "en", ejemplo_literal: "1,547.26" },
  columnas: [],
  arrastre_entrada: { presente: false, literal: null, importe: null },
  primera_fila: { texto_literal: null, partida_desde_pagina_anterior: false },
  ultima_fila: { texto_literal: null, continua_en_pagina_siguiente: false },
  filas_tabla: filas,
  lineas,
  arrastre_salida: { presente: false, literal: null, importe: null },
  albaran_abierto_al_final: { ref: null, fecha_literal: null },
  continua_en_otra_pagina: false,
  observaciones: null,
  resumen: null,
});
function clienteFalso(extracciones: unknown[], contadas: number) {
  const cola = [...extracciones];
  return {
    config: configModelo(),
    uso: { llamadas: 0, tokensEntrada: 0, tokensSalida: 0, costeUsd: 0 },
    llamarVision: vi.fn(async () => cola.shift()),
    contarFilas: vi.fn(async () => ({ filas_tabla: contadas })),
    verificarPie: vi.fn(async () => null),
    embed: vi.fn(),
  };
}
const desc = { numero: 2, total: 5, pieza: "franja" as const, paginaDoc: 1, franja: 2, franjasDePagina: 5 };

describe("leerPieza", () => {
  it("el contador ve más filas → relectura en la misma llamada; se acepta si solo AÑADE", async () => {
    const a = [fila("A", 10), fila("B", 20)];
    const cli = clienteFalso([respuesta(a), respuesta([...a, fila("C", 30)])], 3);
    const r = await leerPieza(cli as never, {}, desc, { contexto: null, esUltima: false, yaReleida: false });
    expect(r.relecturas).toBe(1);
    expect(r.resultado.lineas.map((l) => l.nombre)).toEqual(["A", "B", "C"]);
    expect(r.motivos).toEqual([]);
    expect(cli.verificarPie).not.toHaveBeenCalled();
  });
  it("una relectura que recompone los importes para que cuadre se DESCARTA", async () => {
    const a = [fila("A", 10), fila("B", 20), fila("C", 30), fila("D", 40)];
    const b = [fila("A", 11), fila("B", 21), fila("C", 31), fila("D", 41)];
    const cli = clienteFalso([respuesta(a), respuesta(b)], 5);
    const r = await leerPieza(cli as never, {}, desc, { contexto: null, esUltima: true, yaReleida: false });
    expect(r.resultado.lineas.map((l) => l.total)).toEqual([10, 20, 30, 40]);
    expect(r.motivos.map((m) => m.codigo)).toContain("lineas_incompletas_pagina");
    expect(cli.verificarPie).toHaveBeenCalled();
  });
  it("ya releída (relectura diferida) → no vuelve a releer", async () => {
    const cli = clienteFalso([respuesta([fila("A", 10)])], 4);
    const r = await leerPieza(cli as never, {}, desc, { contexto: null, esUltima: false, yaReleida: true });
    expect(cli.llamarVision).toHaveBeenCalledTimes(1);
    expect(r.relecturas).toBe(1);
  });
  it("la pieza 1 deja el contexto (formato y columnas) para las demás", async () => {
    const cli = clienteFalso([respuesta([fila("A", 10)])], 1);
    const r = await leerPieza(cli as never, {}, { ...desc, numero: 1, franja: 1 }, { contexto: null, esUltima: false, yaReleida: false });
    expect(r.contexto?.formato_numerico).toBe("en");
  });
});

describe("pagina.ts", () => {
  it("validarPagina señala la ruta del campo malo", () => {
    const r = validarPagina({ lineas: [{ nombre: "A", cantidad: "dos" }] });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.problemas[0].campo).toBe("lineas[0].cantidad");
  });
  it("bloqueRepetido detecta 4+ filas idénticas repetidas y motivosLocales lo pide releer", () => {
    const ls = ["A", "B", "C", "D"].map((n, i) => fila(n, i + 1));
    const r = validarPagina(respuesta([...ls, fila("X", 99), ...ls]));
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(bloqueRepetido(r.datos.lineas)).toEqual({ desde: 5, original: 0, largo: 4 });
      expect(motivosLocales(r.datos, null, null).map((m) => m.codigo)).toContain("bloque_repetido");
    }
  });
  it("el importe citado '1,547.26' cuadra con 1547.26 aunque el modelo declare formato 'es'", () => {
    const r = validarPagina({
      ...respuesta([{ ...fila("JAMON", 1547.26, 8), importe_literal: "1,547.26" }]),
      formato_numerico: { formato: "es", ejemplo_literal: null },
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(motivosLocales(r.datos, null, null).map((m) => m.codigo)).not.toContain("importe_linea_discordante");
  });
  it("el anexo de franja pide ignorar filas cortadas por el borde", () => {
    expect(anexoPieza(desc, null)).toMatch(/IGNORA una fila que quede CORTADA/);
    expect(anexoPieza({ ...desc, pieza: "pagina", franja: null, franjasDePagina: null }, '{"x":1}')).toMatch(/PÁGINA 1[\s\S]*CONTEXTO/);
  });
});
