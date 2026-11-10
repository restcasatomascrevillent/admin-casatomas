/**
 * Exportación a PDF de un informe en diapositivas (Tráfico web, RRSS y los de
 * Super Admin › Informes): al pulsar «Descargar PDF» se montan las
 * diapositivas sin escalar fuera de la pantalla (portal en <body>, 1280 px de
 * ancho) y, con la maqueta ya hecha, se capturan una a una
 * (`descargarPdfInforme`). Antes vivía repetido dentro de cada diálogo.
 */
import { useEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { toast } from "sonner";
import { prepararFuenteInforme } from "@/components/trafico-web/informe/fuente";
import { descargarPdfInforme } from "@/components/trafico-web/informe/pdf";
import { ANCHO_DIAPOSITIVA } from "@/components/trafico-web/informe/tema";

export interface DocumentoDiapositivas {
  titulo: string;
  nombreArchivo: string;
  /** Asunto del PDF (propiedades del documento). */
  asunto?: string;
  /** Las diapositivas SIN envoltorio (a 1280 × 720). */
  diapositivas: ReactNode;
}

export function useExportarDiapositivas(documento: DocumentoDiapositivas | null) {
  const [exportando, setExportando] = useState(false);
  const [progreso, setProgreso] = useState<{ hechas: number; total: number } | null>(null);
  const [contenedor, setContenedor] = useState<HTMLDivElement | null>(null);
  const titulo = documento?.titulo;
  const nombreArchivo = documento?.nombreArchivo;
  const asunto = documento?.asunto;

  useEffect(() => {
    if (!exportando || !contenedor || !titulo || !nombreArchivo) return;
    let cancelado = false;
    (async () => {
      try {
        await prepararFuenteInforme();
        await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
        if (cancelado) return;
        const nodos = Array.from(contenedor.querySelectorAll<HTMLElement>("[data-diapositiva]"));
        await descargarPdfInforme(nodos, {
          titulo,
          nombreArchivo,
          ...(asunto ? { asunto } : {}),
          alAvanzar: (hechas, total) => !cancelado && setProgreso({ hechas, total }),
        });
        toast.success("Informe descargado");
      } catch (e) {
        toast.error(e instanceof Error ? `No se ha podido crear el PDF: ${e.message}` : "No se ha podido crear el PDF.");
      } finally {
        if (!cancelado) {
          setExportando(false);
          setProgreso(null);
        }
      }
    })();
    return () => {
      cancelado = true;
    };
  }, [exportando, contenedor, titulo, nombreArchivo, asunto]);

  const portal =
    exportando && documento
      ? createPortal(
          <div ref={setContenedor} aria-hidden style={{ position: "fixed", left: -20000, top: 0, width: ANCHO_DIAPOSITIVA, pointerEvents: "none" }}>
            {documento.diapositivas}
          </div>,
          document.body,
        )
      : null;

  const textoBoton = exportando ? (progreso ? `Creando PDF… ${progreso.hechas}/${progreso.total}` : "Creando PDF…") : "Descargar PDF";

  return { exportando, progreso, exportar: () => setExportando(true), portal, textoBoton };
}
