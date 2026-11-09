// @vitest-environment node
/**
 * La copia de plantillas del servidor (instagram-ia/plantillas.ts) tiene que
 * coincidir con el registro del panel (src/lib/instagram/plantillas): mismas
 * plantillas, marca, campos de texto y límites.
 */
import { describe, expect, it } from "vitest";
import { PLANTILLAS, encajeDe } from "@/lib/instagram";
import { CAMPOS_ROTULO, type CampoRotulo } from "../../_shared/instagram/validar-ia.ts";
import { PLANTILLAS_IA, plantillaMarco } from "../plantillas.ts";

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

  it("formatos, foto, encaje y si sirve para campañas (fase 2) cuadran con el panel", () => {
    const delPanel = PLANTILLAS.map((p) => ({
      id: p.id,
      formatos: [...p.formatos],
      conFoto: (p.admitidos as readonly string[]).includes("foto"),
      // Encaje de la foto (solo plantillas con foto): «sangre» por defecto o «marco» (Foto enmarcada).
      encaje: (p.admitidos as readonly string[]).includes("foto") ? encajeDe(p) : undefined,
      // Sirve para una campaña si lo único obligatorio (además del titular) es la foto.
      campanas: p.obligatorios.every((c) => c === "foto"),
    }));
    // Cada marca tiene una enmarcada para post y story (las fotos de la carta solo valen así).
    for (const marca of ["casa-tomas", "touza"]) {
      for (const formato of ["post", "story"] as const) {
        expect(plantillaMarco(marca, formato)?.id, `${marca} ${formato}`).toBe(marca === "touza" ? "tz-marco" : "ct-marco");
      }
    }
    const delServidor = [...PLANTILLAS_IA]
      .map((p) => ({ id: p.id, formatos: [...p.formatos], conFoto: p.conFoto, encaje: p.conFoto ? (p.encaje ?? "sangre") : undefined, campanas: p.campanas }))
      .sort((a, b) => a.id.localeCompare(b.id));
    expect(delServidor).toEqual(delPanel);
  });
});
