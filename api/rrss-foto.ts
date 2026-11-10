/**
 * /api/rrss-foto — motor de FOTOS del editor IA de RRSS (Vercel, Node).
 * Ver api/_lib/rrss/http.ts (contrato) y docs/rrss.md.
 *
 *   POST { accion: "analizar", archivoId }   previa y medidas de una foto subida
 *   POST { accion: "generar", generacionId } edita las fotos del plan (sharp) en segundo plano
 *   GET                                      diagnóstico sin sesión
 *
 * Las transformaciones creativas (desenfocar o cambiar el fondo) usan la
 * máscara del producto del recorte de la carta (onnxruntime-node + IS-Net),
 * solo si el usuario las permitió en el trabajo.
 */
import { diagnostico, manejarPost } from "./_lib/rrss/http.js";

async function cargarSharp() {
  return (await import("sharp")).default;
}

async function mascara(jpeg: Uint8Array): Promise<Buffer> {
  const { mascaraDeFoto } = await import("./_lib/recorteServidor.js");
  const r = await mascaraDeFoto(jpeg);
  return Buffer.from(r.png);
}

export async function POST(request: Request): Promise<Response> {
  return manejarPost(request, { medio: "foto", dependencias: async () => ({ sharp: await cargarSharp(), mascara }) });
}

export async function GET(): Promise<Response> {
  return diagnostico("foto", cargarSharp);
}
