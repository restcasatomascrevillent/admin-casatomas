// @vitest-environment node
/**
 * La copia de plantillas del servidor (instagram-ia/plantillas.ts) tiene que
 * coincidir con el registro del panel (src/lib/instagram/plantillas): mismas
 * plantillas, marca, campos de texto y límites.
 */
import { describe, expect, it } from "vitest";
import { PLANTILLAS } from "@/lib/instagram";
import { CAMPOS_ROTULO, type CampoRotulo } from "../../_shared/instagram/validar-ia.ts";
import { PLANTILLAS_IA } from "../plantillas.ts";

describe("plantillas de instagram-ia", () => {
  it("mismas plantillas que el panel, con sus campos de texto y límites", () => {
    const delPanel = PLANTILLAS.map((p) => {
      const campos = CAMPOS_ROTULO.filter((c) => (p.admitidos as readonly string[]).includes(c));
      const limites: Partial<Record<CampoRotulo, number>> = {};
      for (const c of campos) if (p.limites?.[c] !== undefined) limites[c] = p.limites[c];
      return { id: p.id, marca: p.marca, campos, limites, titularOpcional: p.titularOpcional === true };
    });
    const delServidor = [...PLANTILLAS_IA]
      .map((p) => ({ id: p.id, marca: p.marca, campos: [...p.campos], limites: p.limites, titularOpcional: p.titularOpcional === true }))
      .sort((a, b) => a.id.localeCompare(b.id));
    expect(delServidor).toEqual(delPanel);
  });

  it("formatos, foto y si sirve para campañas (fase 2) cuadran con el panel", () => {
    const delPanel = PLANTILLAS.map((p) => ({
      id: p.id,
      formatos: [...p.formatos],
      conFoto: (p.admitidos as readonly string[]).includes("foto"),
      // Sirve para una campaña si lo único obligatorio (además del titular) es la foto.
      campanas: p.obligatorios.every((c) => c === "foto"),
    }));
    const delServidor = [...PLANTILLAS_IA]
      .map((p) => ({ id: p.id, formatos: [...p.formatos], conFoto: p.conFoto, campanas: p.campanas }))
      .sort((a, b) => a.id.localeCompare(b.id));
    expect(delServidor).toEqual(delPanel);
  });
});
