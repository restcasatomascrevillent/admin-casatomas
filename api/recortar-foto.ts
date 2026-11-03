/**
 * POST /api/recortar-foto — quita el fondo de una foto de la carta en el
 * servidor (Vercel Function, runtime Node). Ver docs/recorte-servidor.md.
 *
 *   Petición: cuerpo = la foto (JPEG/WebP/PNG, ya reducida por el móvil,
 *             ≤ 4 MB), `Authorization: Bearer <JWT de Supabase>`.
 *   Respuesta 200: PNG gris de 1 canal (la máscara refinada) al tamaño de la
 *             foto, con `X-Recorte-Ancho`/`X-Recorte-Alto` y los tiempos en
 *             `Server-Timing`.
 *   Errores (JSON `{ error }`): 401 sin sesión, 403 sin permiso de carta,
 *             429 tope de gasto alcanzado (`{ tope: "mes"|"dia"|"cpu" }`),
 *             413 foto > 4 MB, 415 tipo no admitido, 400 foto ilegible,
 *             422 no se encuentra el producto, 500/503 fallo del servidor.
 *
 * Antes de gastar CPU: sesión + permiso + cupo (recorte_servidor_reservar,
 * que deja la fila en ia_uso). Al acabar se anota la duración.
 *
 * GET /api/recortar-foto — diagnóstico sin sesión: ¿está el modelo en el
 * bundle y cargan onnxruntime-node y sharp? (no crea la sesión ni recorta).
 */
import { autorizarRecorte, terminarRecorte } from "./_lib/autorizacion.js";
import { comprobarMotor, ErrorFotoNoValida, ErrorSinProducto, mascaraDeFoto } from "./_lib/recorteServidor.js";

/** Límite de la foto (el de Vercel para el cuerpo es 4,5 MB). */
export const BYTES_MAXIMOS = 4 * 1024 * 1024;
const TIPOS = /^image\/(jpeg|jpg|pjpeg|png|webp)$/i;

function json(estado: number, cuerpo: unknown, extra: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(cuerpo), {
    status: estado,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...extra },
  });
}

export async function POST(request: Request): Promise<Response> {
  const t0 = performance.now();
  const largo = Number(request.headers.get("content-length") ?? "0");
  if (largo > BYTES_MAXIMOS) return json(413, { error: "La foto pesa más de 4 MB" });
  const tipo = (request.headers.get("content-type") ?? "").split(";")[0].trim();
  if (!TIPOS.test(tipo)) return json(415, { error: "La foto tiene que ser JPEG, PNG o WebP" });

  const cabecera = request.headers.get("authorization");
  const auth = await autorizarRecorte(cabecera);
  // `"motivo" in auth` y no `!auth.ok`: el tsconfig raíz (el que usa Vercel) no tiene strictNullChecks y no estrecha.
  if ("motivo" in auth) {
    if (auth.estado >= 500) console.error("[recortar-foto] autorización", auth.motivo);
    if (auth.estado === 429) console.warn("[recortar-foto] tope alcanzado", JSON.stringify({ tope: auth.tope, uso: auth.uso }));
    return json(auth.estado, { error: auth.motivo, ...(auth.tope ? { tope: auth.tope, uso: auth.uso } : {}) }, auth.estado === 401 ? { "WWW-Authenticate": "Bearer" } : {});
  }
  const msAuth = performance.now() - t0;

  const foto = new Uint8Array(await request.arrayBuffer());
  if (foto.byteLength === 0 || foto.byteLength > BYTES_MAXIMOS) {
    await terminarRecorte(cabecera, auth.reserva, 0, false);
    return foto.byteLength === 0 ? json(400, { error: "No ha llegado la foto" }) : json(413, { error: "La foto pesa más de 4 MB" });
  }

  const tTrabajo = performance.now();
  try {
    const r = await mascaraDeFoto(foto);
    const t = r.tiempos;
    const msCpu = t.msTotal; // decodificar + inferencia + refinado + PNG (sin la espera en cola)
    await terminarRecorte(cabecera, auth.reserva, msCpu, true);
    console.info(
      "[recortar-foto]",
      JSON.stringify({
        usuario: auth.usuario,
        caliente: r.caliente,
        medidas: `${r.ancho}x${r.alto}`,
        bytesFoto: foto.byteLength,
        bytesMascara: r.png.byteLength,
        msAuth: Math.round(msAuth),
        ...t,
        memoriaMB: Math.round(process.memoryUsage().rss / 1048576),
        recortesMes: auth.uso ? `${auth.uso.recortes_mes}/${auth.uso.tope_mes}` : undefined,
      }),
    );
    return new Response(new Uint8Array(r.png), {
      status: 200,
      headers: {
        "Content-Type": "image/png",
        "Cache-Control": "no-store",
        "X-Recorte-Ancho": String(r.ancho),
        "X-Recorte-Alto": String(r.alto),
        "X-Recorte-Caliente": r.caliente ? "1" : "0",
        "Server-Timing": [
          `auth;dur=${Math.round(msAuth)}`,
          `carga;dur=${t.msCarga}`,
          `entrada;dur=${t.msEntrada}`,
          `inferencia;dur=${t.msInferencia}`,
          `refinado;dur=${t.msRefinado}`,
          `png;dur=${t.msPng}`,
        ].join(", "),
      },
    });
  } catch (e) {
    await terminarRecorte(cabecera, auth.reserva, performance.now() - tTrabajo, false);
    if (e instanceof ErrorSinProducto) return json(422, { error: e.message });
    if (e instanceof ErrorFotoNoValida) return json(400, { error: e.message });
    console.error("[recortar-foto] fallo", e);
    return json(500, { error: "No se pudo quitar el fondo en el servidor" });
  }
}

export async function GET(): Promise<Response> {
  const estado = await comprobarMotor();
  const ok = estado.modelo && estado.motor && estado.imagenes;
  return json(ok ? 200 : 503, { ok, ...estado });
}
