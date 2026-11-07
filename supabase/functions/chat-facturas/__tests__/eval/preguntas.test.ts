import { describe, expect, it } from "vitest";
import bateria from "./preguntas.json";
import { peticionEvaluar } from "../../../ia-modelos-openai/logica.ts";
import { TOOLS } from "../../herramientas.ts";

const nombres = new Set(TOOLS.map((t) => t.function.name));

describe("batería de evaluación de modelos (preguntas.json)", () => {
  it("12 preguntas con id único, referencia y herramientas que existen", () => {
    expect(bateria.preguntas).toHaveLength(12);
    expect(new Set(bateria.preguntas.map((p) => p.id)).size).toBe(12);
    for (const p of bateria.preguntas) {
      expect(p.esperado.notas.length).toBeGreaterThan(20);
      expect(p.sql.length).toBeGreaterThan(5);
      for (const h of p.herramientas_esperadas) expect(nombres.has(h), `${p.id}: ${h}`).toBe(true);
    }
  });

  it("cada pregunta es una petición válida para la acción «evaluar»", () => {
    for (const p of bateria.preguntas) {
      const r = peticionEvaluar({ modelo: "gpt-6-luna", preguntas: [{ id: p.id, mensaje: p.mensaje, historial: p.historial }] });
      expect(r.preguntas[0].id).toBe(p.id);
      expect(r.preguntas[0].historial).toHaveLength(p.historial.length);
    }
  });
});
