/**
 * Tests de utilidades del arnés de evals (supabase/functions/chat-web/evals/run.mjs).
 * run.mjs solo ejecuta main() cuando se lanza como script, así que se puede importar.
 *
 * Falsos negativos reales de la batería del 2026-09-26_1852:
 *   - carta-inexistente-en: "I don’t have…" con apóstrofo tipográfico.
 *   - idioma-cambio-es-en: "11:30 p.m." no casaba con /11[:.]30 ?pm/.
 */
import { describe, it, expect } from "vitest";
// @ts-expect-error — módulo JS sin tipos
import { normalizarRespuesta, extraerHoras, evaluarTurno, planificar, validar } from "../evals/run.mjs";

const ok = (respuesta: string) => ({ status: 200, json: { success: true, respuesta }, texto: "" });

describe("normalizarRespuesta", () => {
  it("apóstrofos y comillas tipográficas", () => {
    expect(normalizarRespuesta("I don’t have Casa Tomás’s ‘x’")).toBe("I don't have Casa Tomás's 'x'");
    expect(normalizarRespuesta("“hola” „x“")).toBe('"hola" "x"');
  });
  it("espacios y guiones no separables", () => {
    expect(normalizarRespuesta("24,00 € y 10 € pre‑order")).toBe("24,00 € y 10 € pre-order");
  });
  it("quita negrita/cursiva Markdown", () => {
    expect(normalizarRespuesta("abrimos de **10:30 a 23:30** y __ya__")).toBe("abrimos de 10:30 a 23:30 y ya");
  });
  it.each([
    ["We close at 11:30 p.m. on Saturdays", "We close at 11:30 pm on Saturdays"],
    ["cierra a las 11:30 p. m.", "cierra a las 11:30 pm"],
    ["from 9 a.m.", "from 9 am"],
    ["9:30 A.M.", "9:30 am"],
    ["11:30 PM", "11:30 PM"],
  ])("%s → %s", (a, b) => {
    expect(normalizarRespuesta(a)).toBe(b);
  });
  it("no toca a.m./p.m. que no van tras un número", () => {
    expect(normalizarRespuesta("p.m. y a.m.")).toBe("p.m. y a.m.");
  });
});

describe("extraerHoras (am/pm)", () => {
  it.each([
    ["We close at 11:30 p.m.", ["23:30"]],
    ["We close at 11:30 pm", ["23:30"]],
    ["We close at 11:30 PM", ["23:30"]],
    ["open 9:30 a.m. to 11 p.m.", ["9:30", "23:00"]],
    ["open 9:30 a. m.", ["9:30"]],
    ["12 p.m. and 12 a.m.", ["12:00", "0:00"]],
    ["de 10:30 a 23:30", ["10:30", "23:30"]],
  ])("%s → %j", (t, horas) => {
    expect(extraerHoras(t).sort()).toEqual([...horas].sort());
    expect(extraerHoras(normalizarRespuesta(t)).sort()).toEqual([...horas].sort());
  });
});

describe("evaluarTurno con normalización", () => {
  const doc = {
    _meta: { macros: { PRECIO: "\\d{1,3}(?:[.,]\\d{1,2})?\\s?(?:€|eur)" } },
    escenarios: [
      {
        id: "neg-en", idioma: "en", categoria: "carta",
        turnos: [{ mensaje: "kangaroo?" }],
        debe_contener: ["(?:don't|do not) (?:have|serve)|no kangaroo"],
      },
      {
        id: "pm", idioma: "en", categoria: "idioma",
        turnos: [{ mensaje: "close?" }],
        debe_contener: ["23[:.]30|11[:.]30\\s?p\\.?\\s?m(?!\\p{L})"],
        solo_horas_validas: true,
      },
    ],
  };
  const plan = planificar(doc, { solo: null, idioma: null, excluirCostosos: true });
  const turno = (id: string) => plan.find((p: any) => p.e.id === id).turnos[0];

  it("carta-inexistente-en: 'I don’t have' pasa", () => {
    const r = evaluarTurno(turno("neg-en"), ok("Good afternoon! I don’t have kangaroo steak on Casa Tomás’s menu."), [], []);
    expect(r.fallos).toEqual([]);
  });

  it("idioma-cambio-es-en: '11:30 p.m.' pasa y cuenta como 23:30 válida", () => {
    const r = evaluarTurno(turno("pm"), ok("We close at **11:30 p.m. on Saturdays**."), [], ["23:30"]);
    expect(r.fallos).toEqual([]);
  });

  it("solo_horas_validas sigue detectando horas inventadas en formato am/pm", () => {
    const r = evaluarTurno(turno("pm"), ok("We close at 11:30 p.m., kitchen until 10:45 p.m."), [], ["23:30"]);
    expect(r.fallos.join(" ")).toMatch(/22:45/);
  });
});

describe("plantillas {{X}} sin resolver → SKIP, nunca FAIL", () => {
  const base = { idioma: "es", categoria: "carta", turnos: [{ mensaje: "hola" }] };
  const doc = {
    _meta: { macros: { PRECIO: "\\d+\\s?€" } },
    escenarios: [
      { ...base, id: "macro", debe_contener: ["{{PRECIO}}"] },
      { ...base, id: "var-regex", debe_contener: ["{{PLATO}}"] },
      { ...base, id: "var-mensaje", turnos: [{ mensaje: "¿cuánto cuesta {{PLATO}}?" }], debe_contener: ["x"] },
      { ...base, id: "var-criterio", debe_contener: ["x"], criterio_juez: "Habla de {{DO}}" },
      { ...base, id: "desconocida", debe_contener: ["{{NOEXISTE}}"] },
    ],
  };
  const guardado = { ...process.env };
  it("macros se resuelven; variables ausentes o desconocidas quedan en faltan", () => {
    delete process.env.EVAL_PLATO;
    delete process.env.EVAL_DO;
    delete process.env.EVAL_PLATO_PRECIO;
    try {
      const plan = planificar(doc, { solo: null, idioma: null, excluirCostosos: true });
      const faltan = Object.fromEntries(plan.map((p: any) => [p.e.id, p.faltan]));
      expect(faltan).toEqual({
        macro: [],
        "var-regex": ["PLATO"],
        "var-mensaje": ["PLATO"],
        "var-criterio": ["DO"],
        desconocida: ["NOEXISTE"],
      });
    } finally {
      Object.assign(process.env, guardado);
    }
  });
  it("validar() marca como error una plantilla que no es macro ni variable conocida", () => {
    const { errores } = validar(doc);
    expect(errores.some((e: string) => /plantilla desconocida \{\{NOEXISTE\}\}/.test(e))).toBe(true);
    expect(errores.filter((e: string) => /plantilla desconocida/.test(e))).toHaveLength(1);
  });
});
