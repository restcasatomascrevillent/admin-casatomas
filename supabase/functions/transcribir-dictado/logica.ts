// Lógica pura de transcribir-dictado (sin imports de Deno, para probarla con vitest).
// El panel graba el dictado en el móvil/tablet y lo manda aquí; se devuelve el
// texto y NO se guarda el audio en ningún sitio (ni disco, ni Storage, ni BD).

export const MODELO_DICTADO = "gpt-4o-mini-transcribe";
/** Un dictado del chat son frases sueltas: 4 MB cubre de sobra 90 s en cualquier códec. */
export const MAX_BYTES_AUDIO = 4 * 1024 * 1024;
export const MIN_BYTES_AUDIO = 800;
export const MAX_SEGUNDOS = 90;

export const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const TIPOS_OK = /^(audio\/(webm|ogg|mp4|x-m4a|m4a|aac|mpeg|mp3|wav|x-wav|wave|flac)|video\/(webm|mp4))(;|$)/i;

export const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });

export interface UsoOpenAI {
  input_tokens?: number;
  output_tokens?: number;
  total_tokens?: number;
  [k: string]: unknown;
}

export interface DependenciasDictado {
  /** Usuario real del panel (JWT verificado); nunca un id del body. */
  autenticar: (req: Request) => Promise<{ ok: true; userId: string } | { ok: false; status: number; error: string }>;
  clave: () => string;
  modelo: string;
  fetch: typeof fetch;
  /** Contabilidad en ia_uso. Nunca debe lanzar. */
  registrar: (r: { modelo: string; usage: UsoOpenAI | null; error: boolean; userId: string; duracionMs: number }) => Promise<void>;
}

export async function manejarDictado(req: Request, d: DependenciasDictado): Promise<Response> {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
  if (req.method !== "POST") return json({ ok: false, error: "Método no permitido" }, 405);

  const auth = await d.autenticar(req);
  if (!auth.ok) return json({ ok: false, error: auth.error }, auth.status);

  const longitud = Number(req.headers.get("content-length") ?? "0");
  if (longitud > MAX_BYTES_AUDIO + 4096) return json({ ok: false, error: "El audio es demasiado largo" }, 413);

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return json({ ok: false, error: "Se esperaba un audio (multipart)" }, 400);
  }
  const audio = form.get("audio");
  if (!(audio instanceof Blob)) return json({ ok: false, error: "Falta el audio" }, 400);
  if (audio.size > MAX_BYTES_AUDIO) return json({ ok: false, error: "El audio es demasiado largo" }, 413);
  if (audio.size < MIN_BYTES_AUDIO) return json({ ok: true, texto: "" });
  if (!TIPOS_OK.test(audio.type || "")) return json({ ok: false, error: "Formato de audio no soportado" }, 415);
  const segundos = Number(form.get("segundos") ?? 0);
  if (Number.isFinite(segundos) && segundos > MAX_SEGUNDOS + 5) {
    return json({ ok: false, error: "El dictado es demasiado largo (máximo 90 s)" }, 413);
  }

  const clave = d.clave();
  if (!clave) return json({ ok: false, error: "OPENAI_API_KEY no configurada" }, 503);

  const t0 = Date.now();
  let usage: UsoOpenAI | null = null;
  let error = false;
  try {
    const envio = new FormData();
    const ext = /mp4|m4a|aac/i.test(audio.type) ? "m4a" : /ogg/i.test(audio.type) ? "ogg" : /mpeg|mp3/i.test(audio.type) ? "mp3" : /wav/i.test(audio.type) ? "wav" : "webm";
    envio.append("file", audio, `dictado.${ext}`);
    envio.append("model", d.modelo);
    envio.append("language", "es");
    envio.append("response_format", "json");
    envio.append("prompt", "Dictado en español de una pregunta sobre facturas, proveedores, productos y precios de un restaurante.");
    const res = await d.fetch("https://api.openai.com/v1/audio/transcriptions", {
      method: "POST",
      headers: { Authorization: `Bearer ${clave}` },
      body: envio,
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) {
      error = true;
      console.error(`[transcribir-dictado] OpenAI ${res.status}`);
      return json({ ok: false, error: res.status === 429 ? "La IA está saturada; prueba en un momento" : "No se pudo transcribir el dictado" }, 502);
    }
    const data = (await res.json().catch(() => null)) as { text?: unknown; usage?: UsoOpenAI } | null;
    usage = data?.usage ?? null;
    const texto = typeof data?.text === "string" ? data.text.trim().slice(0, 4000) : "";
    return json({ ok: true, texto });
  } catch (e) {
    error = true;
    console.error("[transcribir-dictado]", e instanceof Error ? e.name : "error");
    return json({ ok: false, error: "No se pudo transcribir el dictado" }, 502);
  } finally {
    await d.registrar({ modelo: d.modelo, usage, error, userId: auth.userId, duracionMs: Date.now() - t0 });
  }
}
