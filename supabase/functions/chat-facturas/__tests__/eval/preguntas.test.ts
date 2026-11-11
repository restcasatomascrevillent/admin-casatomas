import { describe, expect, it } from "vitest";
import bateria from "./preguntas.json";
import { peticionEvaluar } from "../../../ia-modelos-openai/logica.ts";
import { TOOLS } from "../../herramientas.ts";
import { anadirAlTexto, casoDeFeedback, casosNuevos, RUTA_BATERIA } from "../../../../../scripts/chat-feedback-a-eval.mjs";
import { readFileSync } from "node:fs";

const nombres = new Set(TOOLS.map((t) => t.function.name));

describe("batería de evaluación de modelos (preguntas.json)", () => {
  // 12 de referencia (07/11/2026) + los 👎 revisados que añada scripts/chat-feedback-a-eval.mjs.
  it("al menos 12 preguntas con id único, referencia y herramientas que existen", () => {
    expect(bateria.preguntas.length).toBeGreaterThanOrEqual(12);
    expect(new Set(bateria.preguntas.map((p) => p.id)).size).toBe(bateria.preguntas.length);
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

describe("scripts/chat-feedback-a-eval.mjs (👎 revisados → batería)", () => {
  const fila = {
    id: 7, valoracion: -1, revisado: true, modelo: "gpt-6.1-terra", created_at: "2026-11-11T10:00:00Z",
    pregunta: "Y de vaca", respuesta: "No hay compras de vaca.", comentario: "No ha mirado Embajadores",
    historial: [
      { rol: "assistant", contenido: "suelto" },
      { rol: "user", contenido: "Dime precio de toda la ternera de embajadores" },
      { rol: "assistant", contenido: "12,40 €/kg" },
    ],
    herramientas: [{ nombre: "compras_producto", argumentos: { producto: "vaca" }, resultado: "completada" }],
  };

  it("convierte un 👎 revisado en un caso con el formato de la batería", () => {
    const c = casoDeFeedback(fila);
    expect(c.id).toBe("fb7");
    expect(Object.keys(c)).toEqual(["id", "mensaje", "historial", "esperado", "herramientas_esperadas", "sql"]);
    expect(c.historial[0].rol).toBe("user");
    expect(c.esperado.notas).toContain("No ha mirado Embajadores");
    expect(c.esperado.notas).toContain("compras_producto");
    expect(c.sql.length).toBeGreaterThan(5);
    const r = peticionEvaluar({ modelo: "gpt-6-luna", preguntas: [{ id: c.id, mensaje: c.mensaje, historial: c.historial }] });
    expect(r.preguntas[0].historial).toHaveLength(2);
  });

  it("solo los 👎 revisados y sin repetir; añade sin reformatear el fichero", () => {
    const nuevos = casosNuevos(bateria, [fila, { ...fila, id: 8, revisado: false }, { ...fila, id: 9, valoracion: 1 }]);
    expect(nuevos.map((c: { id: string }) => c.id)).toEqual(["fb7"]);
    const texto = readFileSync(RUTA_BATERIA, "utf8");
    const nuevo = anadirAlTexto(texto, nuevos);
    expect(nuevo.startsWith(texto.replace(/\s*\]\s*\}\s*$/, ""))).toBe(true);
    const parsed = JSON.parse(nuevo);
    expect(parsed.preguntas.at(-1).id).toBe("fb7");
    expect(casosNuevos(parsed, [fila])).toEqual([]);
  });
});
