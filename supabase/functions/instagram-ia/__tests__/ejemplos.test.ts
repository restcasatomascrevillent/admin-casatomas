// @vitest-environment node
/**
 * La copia de los rótulos de ejemplo del servidor (instagram-ia/ejemplos.ts)
 * tiene que coincidir con los EJEMPLOS del panel (src/lib/instagram/ejemplos.ts).
 */
import { describe, expect, it } from "vitest";
import { EJEMPLOS } from "@/lib/instagram/ejemplos";
import { CAMPOS_EJEMPLO, ROTULOS_EJEMPLO } from "../ejemplos.ts";

describe("rótulos de ejemplo de instagram-ia", () => {
  it("mismos textos que los ejemplos del panel, por marca", () => {
    const delPanel: Record<string, string[]> = {};
    for (const e of EJEMPLOS) {
      const j = e.json as Record<string, unknown>;
      const lista = (delPanel[String(j.marca)] ??= []);
      for (const c of CAMPOS_EJEMPLO) if (typeof j[c] === "string" && (j[c] as string).trim()) lista.push((j[c] as string).trim());
    }
    for (const marca of Object.keys(delPanel)) delPanel[marca] = [...new Set(delPanel[marca])].sort();
    const delServidor = Object.fromEntries(Object.entries(ROTULOS_EJEMPLO).map(([m, l]) => [m, [...l].sort()]));
    expect(delServidor).toEqual(delPanel);
  });
});
