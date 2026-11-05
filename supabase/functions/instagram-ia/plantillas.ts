/**
 * Copia en el servidor de lo que la IA necesita saber de cada plantilla de
 * src/lib/instagram/plantillas (las Edge Functions no pueden importar de src/):
 * marca, campos de texto que usa y su máximo de caracteres. El test
 * instagram-ia/__tests__/plantillas.test.ts falla si esta copia se separa del
 * registro del panel (PLANTILLAS): si añades o cambias una plantilla, cámbiala
 * también aquí.
 */
import type { PlantillaCampana } from "../_shared/instagram/validar-campana.ts";

/**
 * Además de los rótulos, para las campañas (fase 2): formatos que admite,
 * si lleva foto y si sirve para una campaña (tz-tipografica no: necesita la
 * lista de cócteles con precios, que la IA no escribe).
 */
export interface PlantillaIA extends PlantillaCampana {
  campanas: boolean;
}

export const PLANTILLAS_IA: readonly PlantillaIA[] = [
  {
    id: "ct-foto-titular",
    marca: "casa-tomas",
    campos: ["antetitulo", "titular", "cta", "pie"],
    limites: { antetitulo: 40, titular: 44, cta: 26, pie: 48 },
    formatos: ["post", "story"],
    conFoto: true,
    campanas: true,
  },
  {
    id: "ct-tipografica",
    marca: "casa-tomas",
    campos: ["antetitulo", "titular", "cita", "pie"],
    limites: { antetitulo: 40, titular: 60, cita: 70, pie: 48 },
    titularOpcional: true,
    formatos: ["post"],
    conFoto: false,
    campanas: true,
  },
  {
    id: "tz-foto-titular",
    marca: "touza",
    campos: ["antetitulo", "titular", "cta", "pie"],
    limites: { antetitulo: 36, titular: 40, cta: 22, pie: 70 },
    formatos: ["post", "story"],
    conFoto: true,
    campanas: true,
  },
  {
    id: "tz-tipografica",
    marca: "touza",
    campos: ["antetitulo", "titular", "pie"],
    limites: { antetitulo: 28, titular: 40, pie: 40 },
    formatos: ["post"],
    conFoto: false,
    campanas: false,
  },
];

export function plantillaIA(id: unknown): PlantillaIA | null {
  return PLANTILLAS_IA.find((p) => p.id === id) ?? null;
}

/** Plantillas de una marca que sirven para una campaña. */
export function plantillasCampana(marca: string): PlantillaIA[] {
  return PLANTILLAS_IA.filter((p) => p.marca === marca && p.campanas);
}
