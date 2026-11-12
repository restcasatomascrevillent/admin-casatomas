// @vitest-environment node
/**
 * La copia de plantillas del servidor (instagram-ia/plantillas.ts) tiene que
 * coincidir con el registro del panel (src/lib/instagram/plantillas): mismas
 * plantillas, marca, campos de texto y límites.
 */
import { describe, expect, it } from "vitest";
import { PLANTILLAS, encajeDe } from "@/lib/instagram";
import { CAMPOS_ROTULO, type CampoRotulo } from "../../_shared/instagram/validar-ia.ts";
import { PLANTILLAS_IA, plantillaMarco, plantillaPara } from "../plantillas.ts";

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
      // Sirve para una campaña si no es clásica y lo único obligatorio (además del titular) es la foto.
      // «Solo foto» (sinTexto) tampoco: una campaña necesita rótulos.
      campanas: !p.clasica && !p.sinTexto && p.obligatorios.every((c) => c === "foto"),
      // Papel (plantillas v2) y si es clásica (no la eligen montar_pieza ni las campañas).
      papel: p.papel,
      clasica: p.clasica === true,
      sinTexto: p.sinTexto === true,
    }));
    // Cada marca tiene una enmarcada para post y story (las fotos de la carta solo valen así).
    for (const marca of ["casa-tomas", "touza"]) {
      for (const formato of ["post", "story"] as const) {
        const pre = marca === "touza" ? "tz" : "ct";
        expect(plantillaMarco(marca, formato)?.id, `${marca} ${formato}`).toBe(`${pre}-portada-marco`);
        for (const papel of ["portada", "plato", "cierre"] as const) {
          expect(plantillaPara(marca, formato, papel, "sangre")?.id).toBe(`${pre}-${papel}`);
          expect(plantillaPara(marca, formato, papel, "marco")?.id).toBe(`${pre}-${papel}-marco`);
        }
      }
    }
    const delServidor = [...PLANTILLAS_IA]
      .map((p) => ({
        id: p.id,
        formatos: [...p.formatos],
        conFoto: p.conFoto,
        encaje: p.conFoto ? (p.encaje ?? "sangre") : undefined,
        campanas: p.campanas,
        papel: p.papel,
        clasica: p.clasica === true,
        sinTexto: p.sinTexto === true,
      }))
      .sort((a, b) => a.id.localeCompare(b.id));
    expect(delServidor).toEqual(delPanel);
  });
});
