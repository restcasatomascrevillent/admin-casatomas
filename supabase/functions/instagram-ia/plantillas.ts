/**
 * Copia en el servidor de lo que la IA necesita saber de cada plantilla de
 * src/lib/instagram/plantillas (las Edge Functions no pueden importar de src/):
 * marca, campos de texto que usa y su máximo de caracteres. El test
 * instagram-ia/__tests__/plantillas.test.ts falla si esta copia se separa del
 * registro del panel (PLANTILLAS): si añades o cambias una plantilla, cámbiala
 * también aquí.
 */
import type { PlantillaRotulos } from "../_shared/instagram/validar-ia.ts";

export const PLANTILLAS_IA: readonly PlantillaRotulos[] = [
  {
    id: "ct-foto-titular",
    marca: "casa-tomas",
    campos: ["antetitulo", "titular", "cta", "pie"],
    limites: { antetitulo: 40, titular: 44, cta: 26, pie: 48 },
  },
  {
    id: "ct-tipografica",
    marca: "casa-tomas",
    campos: ["antetitulo", "titular", "cita", "pie"],
    limites: { antetitulo: 40, titular: 60, cita: 70, pie: 48 },
    titularOpcional: true,
  },
  {
    id: "tz-foto-titular",
    marca: "touza",
    campos: ["antetitulo", "titular", "cta", "pie"],
    limites: { antetitulo: 36, titular: 40, cta: 22, pie: 70 },
  },
  {
    id: "tz-tipografica",
    marca: "touza",
    campos: ["antetitulo", "titular", "pie"],
    limites: { antetitulo: 28, titular: 40, pie: 40 },
  },
];

export function plantillaIA(id: unknown): PlantillaRotulos | null {
  return PLANTILLAS_IA.find((p) => p.id === id) ?? null;
}
