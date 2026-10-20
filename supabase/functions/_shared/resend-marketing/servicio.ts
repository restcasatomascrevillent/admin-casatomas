// ============================================================================
// Una pasada de sincronización con su cerrojo (fila en
// newsletter_sincronizaciones_resend) — la usan newsletter-sync-resend (panel
// y cron) y enviar-newsletter (modo broadcast, que además envía DENTRO del
// cerrojo: ni un doble clic ni el cron pueden colarse entre sincronizar y enviar).
// ============================================================================

import { sincronizar, type ClienteSync, type DatosSync, type ResumenSync } from "./sync.ts";
import type { InicioPasada, OrigenPasada } from "./repositorio.ts";

export interface RepoPasadas extends DatosSync {
  iniciarPasada(origen: OrigenPasada, usuarioId: string | null): Promise<InicioPasada>;
  terminarPasada(id: string, resumen: ResumenSync): Promise<void>;
}

export interface OpcionesPasada {
  repo: RepoPasadas;
  cliente: ClienteSync;
  origen: OrigenPasada;
  usuarioId: string | null;
  segmentIdConfigurado?: string | null;
  nombreSegmento: string;
  hastaMs?: number;
  ahora?: () => number;
  log?: (msg: string) => void;
}

export type ResultadoPasada<T> =
  | { tipo: "ocupado" }
  | { tipo: "error"; mensaje: string }
  | { tipo: "hecho"; pasadaId: string; resumen: ResumenSync; extra?: T };

export async function sincronizarConCerrojo<T = undefined>(
  op: OpcionesPasada,
  dentroDelCerrojo?: (resumen: ResumenSync) => Promise<T>,
): Promise<ResultadoPasada<T>> {
  const inicio = await op.repo.iniciarPasada(op.origen, op.usuarioId);
  if (inicio.estado === "ocupado") return { tipo: "ocupado" };
  if (inicio.estado === "error") return { tipo: "error", mensaje: inicio.mensaje };

  let resumen: ResumenSync | null = null;
  try {
    resumen = await sincronizar({
      cliente: op.cliente,
      datos: op.repo,
      segmentIdConfigurado: op.segmentIdConfigurado,
      nombreSegmento: op.nombreSegmento,
      hastaMs: op.hastaMs,
      ahora: op.ahora,
      log: op.log,
    });
    const extra = dentroDelCerrojo ? await dentroDelCerrojo(resumen) : undefined;
    return { tipo: "hecho", pasadaId: inicio.id, resumen, extra };
  } catch (e) {
    const mensaje = e instanceof Error ? e.message : String(e);
    if (resumen) {
      resumen = { ...resumen, estado: "error", mensajeError: resumen.mensajeError ?? mensaje };
    }
    throw e;
  } finally {
    await op.repo.terminarPasada(
      inicio.id,
      resumen ?? {
        estado: "error",
        segmentId: null,
        segmentoCreado: false,
        contactosResend: null,
        contactosSegmento: null,
        ajenos: null,
        destinatarios: null,
        altas: 0,
        actualizados: 0,
        anadidosSegmento: 0,
        quitadosSegmento: 0,
        borrados: 0,
        bajasResend: 0,
        errores: [],
        pendientes: 0,
        bloqueaEnvio: true,
        peticiones: 0,
        mensajeError: "La sincronización terminó con un error inesperado",
      },
    );
  }
}
