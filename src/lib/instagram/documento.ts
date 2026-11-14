/**
 * DatosPieza (ya validados) → documento HTML completo, listo para pintarlo en
 * un iframe del panel o para que Chromium (Playwright en Vercel) lo capture a
 * PNG. Es el mismo HTML que construía el motor del prototipo
 * (instagram-studio: src/render/renderizar.ts → construirHtml), con fuentes y
 * logos apuntando a `baseRecursos` (public/instagram del panel) y las fotos a
 * `baseFotos` (bucket «instagram»). Ver recursos.ts.
 */
import { FORMATOS, MARGEN, generarCss, type FormatoId, type MarcaId } from "./tokens.js";
import { urlFoto, urlLogo, urlRecurso } from "./recursos.js";
import { FOTOS, type Foto } from "./fotos.js";
import { obtenerPlantilla } from "./plantillas/index.js";
import { esc, type ContextoPlantilla, type DatosPieza, type Plantilla } from "./tipos.js";

export interface OpcionesDocumento {
  /**
   * Base de FUENTES y LOGOS (public/instagram del panel): baseRecursosPanel()
   * → "/instagram" en el navegador, o baseRecursosPanel(origen) → absoluta
   * cuando renderiza el servidor.
   */
  baseRecursos: string;
  /** Base de las FOTOS (bucket público «instagram»): baseFotosPublica(supabaseUrl). */
  baseFotos: string;
  /** Catálogo de fotos (por defecto, el estático FOTOS; con las subidas, combinarCatalogo). */
  fotos?: readonly Foto[];
  /** Plantilla a usar en lugar de buscarla en el registro (tests). */
  plantilla?: Plantilla;
}

/** Contexto que recibe la plantilla. */
export function crearContexto(marca: MarcaId, formato: FormatoId, bases: Pick<OpcionesDocumento, "baseRecursos" | "baseFotos" | "fotos">): ContextoPlantilla {
  const f = FORMATOS[formato];
  const zona = "zonaSegura" in f ? f.zonaSegura : { arriba: 0, abajo: 0 };
  return {
    ancho: f.ancho,
    alto: f.alto,
    zonaSegura: { arriba: zona.arriba, abajo: zona.abajo },
    margen: MARGEN,
    urlFoto: (id) => urlFoto(bases.baseFotos, id, bases.fotos),
    urlLogo: (pieza, color) => urlLogo(bases.baseRecursos, marca, pieza, color),
    urlFuente: (fichero) => urlRecurso(bases.baseRecursos, `fuentes/${fichero}`),
    medidasFoto: (id) => {
      const f = (bases.fotos ?? FOTOS).find((x) => x.id === id);
      return f && f.ancho > 0 && f.alto > 0 ? { ancho: f.ancho, alto: f.alto } : undefined;
    },
  };
}

/** Reset común (idéntico al del prototipo). */
export const RESET_CSS = `
*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
html, body { margin: 0; padding: 0; background: var(--color-fondo); }
body {
  -webkit-font-smoothing: antialiased;
  text-rendering: optimizeLegibility;
  font-kerning: normal;
  color: var(--color-texto);
  font-family: var(--fuente-texto);
}
img { display: block; max-width: none; }
.lienzo {
  position: relative;
  overflow: hidden;
  background: var(--color-fondo);
}
.lienzo.formato-post { width: var(--post-ancho); height: var(--post-alto); }
.lienzo.formato-story { width: var(--story-ancho); height: var(--story-alto); }
`;

/**
 * Documento HTML completo de la pieza. Lanza si la plantilla no existe, no es
 * de esa marca o no tiene ese formato, o si la foto no está en el catálogo
 * (con datos que hayan pasado validarPieza no ocurre).
 */
export function construirDocumento(datos: DatosPieza, opciones: OpcionesDocumento): string {
  const plantilla = opciones.plantilla ?? obtenerPlantilla(datos.plantilla);
  if (!plantilla) throw new Error(`La plantilla «${datos.plantilla}» no existe`);
  if (plantilla.marca !== datos.marca) {
    throw new Error(`La plantilla «${plantilla.id}» es de ${plantilla.marca} y la pieza es de ${datos.marca}`);
  }
  if (!plantilla.formatos.includes(datos.formato)) {
    throw new Error(`La plantilla «${plantilla.id}» no tiene formato ${datos.formato} (sí: ${plantilla.formatos.join(", ")})`);
  }
  const ctx = crearContexto(datos.marca, datos.formato, opciones);
  const interior = plantilla.html(datos, ctx);
  const css = generarCss(datos.marca, { baseRecursos: opciones.baseRecursos });
  return `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=${ctx.ancho}">
<title>${esc(plantilla.id)} · ${datos.formato}</title>
<style>
${css}
${RESET_CSS}
body { width: ${ctx.ancho}px; height: ${ctx.alto}px; overflow: hidden; }
</style>
</head>
<body>
<main class="lienzo formato-${datos.formato}" data-marca="${datos.marca}" data-plantilla="${esc(plantilla.id)}">
${interior}
</main>
</body>
</html>`;
}
