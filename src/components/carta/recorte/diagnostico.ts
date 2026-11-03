/**
 * MODO DIAGNÓSTICO del camino de las fotos de la carta (03-11-2026: en el
 * iPhone «no pasaba nada» al guardar y sin Mac no se ve la consola).
 *
 * Se activa abriendo el panel con `?diag=recorte` en la URL (se recuerda en
 * sessionStorage hasta cerrar la pestaña; `?diag=no` lo apaga). Entonces cada
 * paso (foto elegida, rama, destino, lectura IA, guardar, servidor, respuesta,
 * resultado) se apunta en un registro fijo en pantalla, abajo, además de en
 * la consola. Sin el modo solo va a la consola (console.debug). Sin tablas ni
 * red: todo en el propio navegador.
 */

const CLAVE = "panel.diag.recorte";
const MAX_LINEAS = 80;
const ID_PANEL = "diag-recorte";

let lineas: string[] = [];
let plegado = false;

/** ¿Está activo? Mira la URL (y la recuerda) y, si no, sessionStorage. */
export function diagActivo(): boolean {
  try {
    if (typeof window === "undefined") return false;
    const param = new URLSearchParams(window.location.search).get("diag");
    if (param === "recorte") sessionStorage.setItem(CLAVE, "1");
    else if (param === "no") sessionStorage.removeItem(CLAVE);
    return sessionStorage.getItem(CLAVE) === "1";
  } catch {
    return false;
  }
}

function texto(datos: unknown): string {
  if (datos === undefined) return "";
  try {
    return ` ${JSON.stringify(datos, (_k, v) => (v instanceof Blob ? `${v.type || "?"} ${Math.round(v.size / 1024)} KB` : v))}`;
  } catch {
    return ` ${String(datos)}`;
  }
}

function pintar(): void {
  if (typeof document === "undefined" || !document.body) return;
  let panel = document.getElementById(ID_PANEL);
  if (!panel) {
    panel = document.createElement("div");
    panel.id = ID_PANEL;
    panel.setAttribute("role", "log");
    panel.setAttribute("aria-label", "Diagnóstico del recorte de fotos");
    Object.assign(panel.style, {
      position: "fixed",
      left: "4px",
      right: "4px",
      bottom: "4px",
      zIndex: "2147483647",
      background: "rgba(0,0,0,0.88)",
      color: "#e5ffe5",
      font: "11px/1.35 ui-monospace, Menlo, monospace",
      borderRadius: "6px",
      padding: "4px 6px",
      whiteSpace: "pre-wrap",
      wordBreak: "break-word",
    } as CSSStyleDeclaration);
    const cabecera = document.createElement("div");
    cabecera.style.display = "flex";
    cabecera.style.gap = "8px";
    cabecera.style.fontWeight = "bold";
    const titulo = document.createElement("span");
    titulo.textContent = "Diagnóstico recorte";
    titulo.style.flex = "1";
    const boton = (t: string, fn: () => void) => {
      const b = document.createElement("button");
      b.type = "button";
      b.textContent = t;
      Object.assign(b.style, { color: "#fff", background: "#333", border: "0", borderRadius: "4px", padding: "2px 8px" } as CSSStyleDeclaration);
      b.addEventListener("click", fn);
      return b;
    };
    cabecera.append(
      titulo,
      boton("Copiar", () => void navigator.clipboard?.writeText(lineas.join("\n")).catch(() => undefined)),
      boton("Borrar", () => {
        lineas = [];
        pintar();
      }),
      boton("±", () => {
        plegado = !plegado;
        pintar();
      }),
    );
    const cuerpo = document.createElement("div");
    cuerpo.dataset.cuerpo = "1";
    cuerpo.style.maxHeight = "38vh";
    cuerpo.style.overflowY = "auto";
    panel.append(cabecera, cuerpo);
    document.body.append(panel);
  }
  const cuerpo = panel.querySelector<HTMLDivElement>("[data-cuerpo]");
  if (!cuerpo) return;
  cuerpo.style.display = plegado ? "none" : "block";
  cuerpo.textContent = lineas.join("\n");
  cuerpo.scrollTop = cuerpo.scrollHeight;
}

/** Apunta un paso del camino de la foto. Nunca lanza. */
export function diag(paso: string, datos?: unknown): void {
  try {
    const activo = diagActivo();
    if (!activo) {
      console.debug("[diag-recorte]", paso, datos ?? "");
      return;
    }
    console.info("[diag-recorte]", paso, datos ?? "");
    const hora = new Date().toLocaleTimeString("es-ES", { hour12: false });
    lineas.push(`${hora} ${paso}${texto(datos)}`);
    if (lineas.length > MAX_LINEAS) lineas = lineas.slice(-MAX_LINEAS);
    pintar();
  } catch {
    /* el diagnóstico nunca rompe nada */
  }
}

/** Solo para pruebas. */
export function _lineasDiag(): string[] {
  return [...lineas];
}
