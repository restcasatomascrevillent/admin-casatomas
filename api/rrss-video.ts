/**
 * /api/rrss-video — motor de VÍDEO del editor IA de RRSS (Vercel, Node, hasta 300 s).
 * Ver api/_lib/rrss/http.ts (contrato) y docs/rrss.md.
 *
 *   POST { accion: "analizar", archivoId }   medidas, duración, hoja de contactos y audio de un vídeo (o foto)
 *   POST { accion: "generar", generacionId } monta el MP4 del plan (ffmpeg) en segundo plano
 *   GET                                      diagnóstico sin sesión (incluye la versión de ffmpeg)
 */
import { diagnostico, manejarPost } from "./_lib/rrss/http.js";
import { rutaFfmpeg } from "./_lib/rrss/video.js";

async function cargarSharp() {
  return (await import("sharp")).default;
}

export async function POST(request: Request): Promise<Response> {
  return manejarPost(request, { medio: "video", dependencias: async () => ({ sharp: await cargarSharp(), ffmpeg: await rutaFfmpeg() }) });
}

export async function GET(): Promise<Response> {
  return diagnostico("video", cargarSharp, rutaFfmpeg);
}
