/**
 * Carga, en el navegador, lo que necesita la carta impresa: fontkit y los tres
 * TTF de Libre Baskerville (servidos por el propio panel, con hash en el
 * nombre), y registra las fuentes para la vista previa (FontFace con los mismos
 * bytes que van al PDF, así la vista previa mide y pinta igual).
 *
 * Se carga una sola vez por sesión y solo al abrir el diálogo.
 */
import urlItalica from "@/assets/fuentes/carta-pdf/LibreBaskerville-Italic.ttf?url";
import urlRegular from "@/assets/fuentes/carta-pdf/LibreBaskerville-Regular.ttf?url";
import urlSeminegrita from "@/assets/fuentes/carta-pdf/LibreBaskerville-SemiBold.ttf?url";
import { cargarFontkit, crearFuentesKit, crearMedidor, FAMILIA_VISTA, type BytesFuentes } from "./fuentes";
import type { FuenteCarta, Medidor } from "./maquetacion";
import type { RecursosPdf } from "./pdf";

export interface MotorCarta {
  medidor: Medidor;
  recursos: RecursosPdf;
}

const URLS: Record<FuenteCarta, string> = {
  regular: urlRegular,
  italica: urlItalica,
  seminegrita: urlSeminegrita,
};

const ESTILO_VISTA: Record<FuenteCarta, FontFaceDescriptors> = {
  regular: { style: "normal", weight: "400" },
  italica: { style: "italic", weight: "400" },
  seminegrita: { style: "normal", weight: "600" },
};

async function descargar(url: string): Promise<Uint8Array> {
  const respuesta = await fetch(url);
  if (!respuesta.ok) throw new Error(`No se ha podido descargar la fuente (${respuesta.status})`);
  return new Uint8Array(await respuesta.arrayBuffer());
}

async function registrarParaVista(bytes: BytesFuentes): Promise<void> {
  if (typeof document === "undefined" || typeof FontFace === "undefined" || !document.fonts) return;
  await Promise.all(
    (Object.keys(bytes) as FuenteCarta[]).map(async (fuente) => {
      try {
        // Copia: FontFace se queda con el búfer y pdf-lib necesita el suyo intacto.
        const cara = new FontFace(FAMILIA_VISTA[fuente], bytes[fuente].slice().buffer, ESTILO_VISTA[fuente]);
        document.fonts.add(await cara.load());
      } catch {
        // Sin la fuente, la vista previa cae a una serif del sistema; el PDF no cambia.
      }
    }),
  );
}

let motor: Promise<MotorCarta> | null = null;

export function cargarMotorCarta(): Promise<MotorCarta> {
  motor ??= (async () => {
    const [fontkit, regular, italica, seminegrita] = await Promise.all([
      cargarFontkit(),
      descargar(URLS.regular),
      descargar(URLS.italica),
      descargar(URLS.seminegrita),
    ]);
    const bytes: BytesFuentes = { regular, italica, seminegrita };
    const kit = crearFuentesKit(fontkit, bytes);
    await registrarParaVista(bytes);
    return { medidor: crearMedidor(kit), recursos: { fontkit, bytes, kit } };
  })().catch((error) => {
    motor = null;
    throw error;
  });
  return motor;
}

/** Descarga el PDF con su nombre (sin abrir pestañas: la CSP del panel no deja incrustar blobs). */
export function descargarPdf(bytes: Uint8Array, nombre: string): void {
  const blob = new Blob([bytes], { type: "application/pdf" });
  const url = URL.createObjectURL(blob);
  const enlace = document.createElement("a");
  enlace.href = url;
  enlace.download = nombre;
  document.body.appendChild(enlace);
  enlace.click();
  enlace.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
