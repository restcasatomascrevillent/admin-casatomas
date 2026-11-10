// ============================================================================
//  Logs web · causas conocidas
// ----------------------------------------------------------------------------
//  Fallos que ya se han visto y diagnosticado (informe del 10/11/2026,
//  docs/INFORME-LOGS-2026-11-10.md). Si una incidencia encaja, el ticket y el
//  panel lo dicen con la explicación y qué hacer, en vez de dejarlo solo a las
//  hipótesis de la IA (que, sin este contexto, especulaba: «problemas de red
//  entre Vercel y Supabase» para un fallo de pg_cron).
//
//  Es un HECHO de catálogo, no una hipótesis: solo se usa cuando el patrón
//  coincide literalmente. Lo comparten las funciones edge (ticket, IA) y el
//  panel (detalle de la incidencia): sin Deno ni imports remotos.
// ============================================================================

import { PATRON_CHUNK_CADUCADO, PATRON_CRON_PLATAFORMA } from "./huella.ts";

export interface CausaConocida {
  id: string;
  titulo: string;
  /** Qué está pasando, en una o dos frases. */
  explicacion: string;
  /** Qué hacer (en orden). */
  acciones: string[];
  /** Si se puede ignorar cuando es aislado (pocas sesiones). */
  ruidoSiAislado: boolean;
}

export interface DatosCausa {
  tipo: string;
  fuente?: string | null;
  mensaje?: string | null;
  pila?: string | null;
  objetivo?: string | null;
  propiedades?: Record<string, unknown> | null;
}

interface Regla extends CausaConocida {
  coincide: (d: DatosCausa) => boolean;
}

const txt = (d: DatosCausa) => `${d.mensaje ?? ""}\n${d.pila ?? ""}`;
const esAssetDeDespliegue = (url: string) => /\/assets\/[^/?#]+-[A-Za-z0-9_-]{8}\.(?:m?js|css)(?:$|[?#])/.test(url);

const REGLAS: Regla[] = [
  {
    id: "chunk_caducado",
    titulo: "Fichero de una versión anterior de la web (tras publicar)",
    explicacion:
      "El visitante tenía abierta la web antes de una publicación y, al navegar, su navegador pidió un fichero (JS/CSS) de la versión vieja que ya no existe. No es un fallo del código de la página que nombra el error.",
    acciones: [
      "En la web pública: escuchar `vite:preloadError` (y los errores de import dinámico) y recargar la página una sola vez, guardando un aviso en sessionStorage para no entrar en bucle.",
      "Si aparece justo después de publicar y luego para, es esperado: se puede marcar resuelta.",
    ],
    ruidoSiAislado: true,
    coincide: (d) =>
      (["error_js", "error_promesa", "error_react"].includes(d.tipo) && PATRON_CHUNK_CADUCADO.test(txt(d)))
      || (d.tipo === "error_recurso" && esAssetDeDespliegue(String(d.objetivo ?? ""))),
  },
  {
    id: "cron_plataforma",
    titulo: "pg_cron no pudo arrancar las tareas (base de datos saturada o en mantenimiento)",
    explicacion:
      "«job startup timeout» lo da pg_cron cuando no consigue abrir la conexión para lanzar la tarea a tiempo: falla a la vez en todas las tareas, no por culpa de ninguna. Suele coincidir con la base de datos saturada (conexiones o CPU), una migración o restauración larga, o un mantenimiento de Supabase.",
    acciones: [
      "Mirar en Supabase › Reports la CPU y las conexiones de esa franja, y el estado de Supabase (status.supabase.com).",
      "Si se repite: espaciar las tareas más frecuentes (reanudar-trabajos-ocr va cada minuto) o activar cron.use_background_workers.",
      "Las tareas se vuelven a lanzar solas en el siguiente turno: comprobar que no queda trabajo atascado (OCR, Instagram, emails).",
    ],
    ruidoSiAislado: false,
    coincide: (d) => d.tipo === "error_integracion" && PATRON_CRON_PLATAFORMA.test(d.mensaje ?? ""),
  },
  {
    id: "react_hidratacion",
    titulo: "React no pudo «hidratar» el HTML pre-renderizado (errores #418/#423/#425)",
    explicacion:
      "El HTML que se sirve ya pintado no coincide con lo que React pinta en el navegador (fechas u horas, textos que dependen del idioma o de datos que llegan después). React lo vuelve a pintar entero: la página funciona, pero tarda más.",
    acciones: [
      "Reproducir con la versión sin minificar (`npm run dev`) para ver el aviso completo y el componente.",
      "Mover a un useEffect lo que dependa del navegador (fecha actual, localStorage, idioma) o renderizarlo solo en cliente.",
    ],
    ruidoSiAislado: false,
    coincide: (d) => /minified react error #(418|423|425)\b|hydrat/i.test(txt(d)),
  },
  {
    id: "peticion_sin_respuesta",
    titulo: "Petición sin respuesta (estado 0)",
    explicacion:
      "El navegador no llegó a recibir respuesta: suele ser la red del visitante, que cerró o cambió de página mientras cargaba, o un bot. Solo es un problema si se repite en muchas sesiones o a la vez en todos (entonces es el servidor).",
    acciones: [
      "Si afecta a pocas sesiones, ignorarla.",
      "Si son muchas a la vez: revisar el estado de Supabase y los logs de la función o tabla nombrada.",
    ],
    ruidoSiAislado: true,
    coincide: (d) => d.tipo === "error_peticion" && (Number(d.propiedades?.status) === 0 || /^sin respuesta/i.test(d.mensaje ?? "")),
  },
  {
    id: "dns_host_inexistente",
    titulo: "Una función llama a un servidor que ya no existe",
    explicacion:
      "La función intenta conectar con un dominio que no resuelve (DNS): suele ser una URL fija de un proyecto antiguo de Supabase o de un servicio dado de baja.",
    acciones: [
      "Buscar la URL en el código de la función y sustituirla por la variable de entorno correspondiente, o retirar la llamada.",
    ],
    ruidoSiAislado: false,
    coincide: (d) => /dns error|failed to lookup address|ENOTFOUND|name or service not known/i.test(txt(d)),
  },
  {
    id: "falta_secreto",
    titulo: "Falta un secreto o una clave en el servidor",
    explicacion: "La función se ejecutó sin una variable de entorno (secreto) que necesita y respondió con error.",
    acciones: [
      "Comprobar en Supabase › Edge Functions › Secrets que el secreto nombrado existe en este entorno.",
      "Si es una petición sin firma (bots o sondeos), se puede ignorar.",
    ],
    ruidoSiAislado: false,
    coincide: (d) => /falta_secreto|falta (el )?secreto|falta firma|missing (secret|api key)/i.test(txt(d)),
  },
];

/** Causa conocida que encaja con la incidencia o el evento, o null. */
export function causaConocida(d: DatosCausa): CausaConocida | null {
  const r = REGLAS.find((x) => {
    try {
      return x.coincide(d);
    } catch {
      return false;
    }
  });
  if (!r) return null;
  const { coincide: _c, ...causa } = r;
  return causa;
}

export const IDS_CAUSAS = REGLAS.map((r) => r.id);
