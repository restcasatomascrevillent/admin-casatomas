import { describe, expect, it } from "vitest";
import { avisosFuncion, formatoPrecio, modeloActual, modelosSeleccionables, motivoNoElegible, normalizarCentro, type FuncionModelo, type ModeloDisponible } from "../modelosIa";
import { rutaDeAviso, TIPO_ICON } from "../avisos";

const disp = (id: string, input: number | null, extra: Partial<ModeloDisponible> = {}): ModeloDisponible => ({
  id, owned_by: "system", creado_openai: null, primera_vez_visto: "2026-11-07", ultima_vez_visto: "2026-11-07",
  retirado_en: null, de_interes: true, nuevo: false, usd_por_m_input: input, usd_por_m_output: input == null ? null : input * 5,
  precio_fuente: null, compatible_herramientas: null, compatible_motivo: null, compatible_probado_en: null, ...extra,
});

const fn = (extra: Partial<FuncionModelo> = {}): FuncionModelo => ({
  funcion: "chat-facturas", descripcion: null, modelo: null, modelo_respaldo: null,
  modelo_codigo: "gpt-4.1-mini (secreto CHAT_FACTURAS_MODELO)", centralizado: true, usa_herramientas: true, notas: null,
  cambiado_por_email: null, cambiado_en: null, ultimo_modelo_usado: null, ultimo_uso: null,
  coste_usd: null, llamadas: null, coste_sin_tarifa: false, ...extra,
});

describe("centro de modelos", () => {
  it("normaliza los numeric que llegan como texto", () => {
    const c = normalizarCentro({ funciones: [{ funcion: "x", coste_usd: "0.123", llamadas: "4", centralizado: true }], disponibles: [{ id: "gpt-6-luna", usd_por_m_input: "0.1" }] });
    expect(c.funciones[0].coste_usd).toBe(0.123);
    expect(c.funciones[0].llamadas).toBe(4);
    expect(c.disponibles[0].usd_por_m_input).toBe(0.1);
    expect(normalizarCentro(null).funciones).toEqual([]);
  });

  it("el selector solo ofrece modelos de chat, no retirados y con precio, del más barato al más caro", () => {
    const r = modelosSeleccionables([
      disp("gpt-6-sol", 2), disp("gpt-6-luna", 0.1), disp("gpt-6-astra", null),
      disp("gpt-4o-mini-tts", 0.6), disp("text-embedding-3-small", 0.02), disp("gpt-5-mini", 0.25, { retirado_en: "2026-11-01" }),
    ]);
    expect(r.map((d) => d.id)).toEqual(["gpt-6-luna", "gpt-6-sol"]);
  });

  it("modelo actual: el elegido o el del código", () => {
    expect(modeloActual(fn())).toEqual({ modelo: "gpt-4.1-mini", desdeTabla: false });
    expect(modeloActual(fn({ modelo: "gpt-6-luna" }))).toEqual({ modelo: "gpt-6-luna", desdeTabla: true });
  });

  it("avisa si el modelo elegido se ha retirado o no tiene precio", () => {
    const d = [disp("gpt-6-luna", null), disp("gpt-4.1-mini", 0.4, { retirado_en: "2026-11-07" })];
    const a = avisosFuncion(fn({ modelo: "gpt-6-luna", modelo_respaldo: "gpt-4.1-mini" }), d);
    expect(a).toHaveLength(2);
    expect(a[0]).toMatch(/no tiene precio/);
    expect(a[1]).toMatch(/ya no está/);
  });

  it("precio legible", () => {
    expect(formatoPrecio({ usd_por_m_input: null, usd_por_m_output: null })).toBe("sin precio");
    expect(formatoPrecio({ usd_por_m_input: 0.1, usd_por_m_output: 0.5 })).toBe("0,1 / 0,5 $ por M");
  });

  it("los avisos de modelos llevan a la pestaña Modelos y tienen icono", () => {
    expect(rutaDeAviso({ tipo: "ia_modelo_retirado", referencia_tipo: "ia_modelos" })).toBe("/super-admin/servicios?tab=modelos");
    expect(TIPO_ICON.ia_modelo_nuevo).toBeDefined();
    expect(TIPO_ICON.ia_modelo_sin_precio).toBeDefined();
  });
});

describe("modelos incompatibles con herramientas (20261107620000)", () => {
  const sol = disp("gpt-6.1-sol", 5, { compatible_herramientas: false, compatible_motivo: "OpenAI 400: use /v1/responses" });
  it("una función con herramientas no puede elegirlo y enseña el motivo", () => {
    expect(motivoNoElegible(fn(), sol)).toBe("OpenAI 400: use /v1/responses");
    expect(motivoNoElegible(fn(), disp("gpt-6.1-terra", 1, { compatible_herramientas: true }))).toBeNull();
    expect(motivoNoElegible(fn(), disp("gpt-6-luna", 1))).toBeNull(); // sin probar: se puede elegir
    expect(motivoNoElegible(fn(), { ...sol, compatible_motivo: null })).toBe("No admite Chat Completions con herramientas");
  });
  it("una función sin herramientas sí puede", () => {
    expect(motivoNoElegible(fn({ funcion: "procesar-factura", usa_herramientas: false }), sol)).toBeNull();
  });
  it("si ya lo tiene puesto, sale un aviso", () => {
    expect(avisosFuncion(fn({ modelo: "gpt-6.1-sol" }), [sol])).toEqual(["El modelo gpt-6.1-sol no sirve para esta función: OpenAI 400: use /v1/responses"]);
  });
  it("normaliza los campos nuevos", () => {
    const c = normalizarCentro({
      funciones: [{ funcion: "chat-web", usa_herramientas: true }, { funcion: "ocr-trabajo" }],
      disponibles: [{ id: "gpt-6.1-sol", compatible_herramientas: false, compatible_motivo: "x" }, { id: "gpt-6-luna" }],
    });
    expect(c.funciones.map((f) => f.usa_herramientas)).toEqual([true, false]);
    expect(c.disponibles.map((d) => d.compatible_herramientas)).toEqual([false, null]);
    expect(c.disponibles[0].compatible_motivo).toBe("x");
  });
});
