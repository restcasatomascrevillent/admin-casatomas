/**
 * Recorta en ESTE ordenador una foto que un móvil guardó sin recortar:
 * reclamar → bajar la original del bucket → recortar con el modelo del
 * navegador y componer con el fondo elegido → guardar la foto de carta en la
 * ficha (recortarFotoGuardada) → marcar listo → push al que la subió.
 * Si falla: marcar error y avisar igualmente. Si se cancela: soltar.
 */
import type { NombreTema } from "../composicionCarta";
import { recortarFotoGuardada, LADO_RECORTE_PC } from "../recorte/recortarFotoGuardada";
import type { DatosRecorte } from "../recorte/recorteMovil";
import {
  notificarRecorte,
  reclamarTrabajoRecorte,
  soltarTrabajoRecorte,
  terminarTrabajoRecorte,
  type TrabajoRecorte,
} from "./trabajosRecorte";

export interface DependenciasRecorteRemoto {
  reclamar?: typeof reclamarTrabajoRecorte;
  terminar?: typeof terminarTrabajoRecorte;
  soltar?: typeof soltarTrabajoRecorte;
  notificar?: typeof notificarRecorte;
  recortar?: (d: DatosRecorte) => Promise<string>;
}

export type ResultadoRecorteRemoto =
  | { estado: "listo"; url: string }
  | { estado: "cogido"; mensaje: string }
  | { estado: "cancelado" }
  | { estado: "error"; mensaje: string };

export function datosDeTrabajo(t: Pick<TrabajoRecorte, "tabla" | "registro_id" | "nombre" | "ruta_original" | "tema">): DatosRecorte {
  return { tabla: t.tabla, registroId: t.registro_id, nombre: t.nombre, rutaOriginal: t.ruta_original, tema: t.tema as NombreTema };
}

export async function procesarTrabajoRecorte(
  trabajo: Pick<TrabajoRecorte, "id">,
  deps: DependenciasRecorteRemoto = {},
): Promise<ResultadoRecorteRemoto> {
  const reclamar = deps.reclamar ?? reclamarTrabajoRecorte;
  const terminar = deps.terminar ?? terminarTrabajoRecorte;
  const soltar = deps.soltar ?? soltarTrabajoRecorte;
  const notificar = deps.notificar ?? notificarRecorte;
  const recortar = deps.recortar ?? ((d: DatosRecorte) => recortarFotoGuardada(d, { lado: LADO_RECORTE_PC }));

  const mio = await reclamar(trabajo.id);
  if (!mio) return { estado: "cogido", mensaje: "Otro ordenador ya está recortando esta foto." };
  try {
    const url = await recortar(datosDeTrabajo(mio));
    await terminar(mio.id, true);
    await notificar(mio.id);
    return { estado: "listo", url };
  } catch (e) {
    if ((e as Error)?.name === "AbortError") {
      await soltar(mio.id).catch(() => undefined);
      return { estado: "cancelado" };
    }
    const mensaje = (e as Error)?.message || "No se pudo recortar la foto";
    await terminar(mio.id, false, mensaje).catch(() => undefined);
    await notificar(mio.id);
    return { estado: "error", mensaje };
  }
}
