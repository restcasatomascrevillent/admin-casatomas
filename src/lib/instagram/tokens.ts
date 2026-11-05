/**
 * Tokens de marca: FUENTE ÚNICA de colores, tipografías, radios, márgenes y
 * formatos de Casa Tomás y Touza para las piezas de Instagram.
 *
 * Portado tal cual del prototipo instagram-studio (src/marca/tokens.ts,
 * 04/11/2026). Isomórfico: sin fs ni nada de Node; funciona en el navegador y
 * en las funciones de Vercel.
 *
 * Regla: ningún valor inventado. Cada token lleva al lado su origen con el
 * formato `repo:fichero → variable`. Los HSL de los CSS de origen se han
 * convertido a hex con redondeo estándar (comprobado al copiar, 04/11/2026).
 *
 * FUENTE OFICIAL (07/11/2026): el sistema de marca de instagram-studio
 * (propuesta/marca-base/tokens/colors.css), copiado tal cual en
 * src/lib/instagram/marca-base/colors.css. Los colores de aquí que tienen
 * equivalente allí TIENEN que coincidir: lo comprueba
 * src/lib/instagram/__tests__/tokensMarcaBase.test.ts. Si cambia la marca,
 * se cambia primero esa copia y luego aquí.
 *
 * Las plantillas NO deben usar estos valores a mano: usan las variables CSS
 * que genera `generarCss()` (--color-*, --fuente-*, --peso-*, --radio-*…).
 *
 * ── Contrastes WCAG 2.x de los pares de texto principales ──────────────────
 * (calculados en el prototipo con src/marca/contraste.ts; AA pide ≥ 4,5 en texto normal y
 *  ≥ 3 en texto grande ≥ 24 px o ≥ 18,66 px en negrita)
 *
 *  Casa Tomás (oro oficial #b6852f: ver ORO_CASA_TOMAS)
 *   blanco   #ffffff sobre oro      #b6852f →  3,29 SOLO texto grande (≥ 24 px, o ≥ 18,66 px en
 *                                               negrita): la píldora del CTA lleva 26 px en negrita
 *   oro      #b6852f sobre blanco   #ffffff →  3,29 SOLO texto grande / filetes, marcos, cifras
 *   oro      #b6852f sobre papel    #fbf8f4 →  3,11 SOLO texto grande / decoración
 *   oro      #b6852f sobre pizarra  #394147 →  3,16 SOLO texto grande / decoración
 *   blanco   #ffffff sobre pizarra  #394147 → 10,39 AAA
 *   pizarra  #394147 sobre blanco   #ffffff → 10,39 AAA (titulares)
 *   pizarra  #394147 sobre papel    #fbf8f4 →  9,81 AAA
 *   oro-texto#845f1f sobre papel    #fbf8f4 →  5,45 AA (texto oro PEQUEÑO, p. ej. antetítulos de 21 px)
 *   oro-texto#845f1f sobre blanco   #ffffff →  5,77 AA
 *   oro-claro#d7ad65 sobre pizarra  #394147 →  4,97 AA
 *   gris-medio#67615f sobre blanco  #ffffff →  6,08 AA (antetítulos)
 *   gris-medio#67615f sobre papel   #fbf8f4 →  5,75 AA
 *   pizarra  #394147 sobre piedra-clara #ded8d4 → 7,36 AAA
 *   piedra   #9b8a7d sobre blanco   #ffffff →  3,32 SOLO texto grande / decoración
 *
 *  Touza
 *   crema    #f5f3ef sobre negro    #0a0a0a → 17,86 AAA
 *   oro      #d49a35 sobre negro    #0a0a0a →  7,99 AAA
 *   oro-claro#dab981 sobre negro    #0a0a0a → 10,59 AAA
 *   oro-oscuro#aa7418 sobre negro   #0a0a0a →  4,92 AA
 *   texto-suave (blanco 65 %) sobre negro    →  8,42 AAA (≈ #a9a9a9)
 *   negro    #0a0a0a sobre blanco   #ffffff → 19,80 AAA (botón píldora)
 *   negro    #0a0a0a sobre oro      #d49a35 →  7,99 AAA
 */

// ── Formatos compartidos ─────────────────────────────────────────────────────
// Origen: encargo de la fase 1 (formatos de Instagram: post vertical 4:5 y
// story 9:16 con 250 px libres arriba y abajo para la interfaz de la app).
export const FORMATOS = {
  post: { ancho: 1080, alto: 1350 },
  story: { ancho: 1080, alto: 1920, zonaSegura: { arriba: 250, abajo: 250 } },
} as const;

export type FormatoId = keyof typeof FORMATOS;
export const FORMATOS_IDS = Object.keys(FORMATOS) as FormatoId[];

/** Margen interior común de todas las plantillas (px). */
export const MARGEN = 72;

// ── Fuentes ──────────────────────────────────────────────────────────────────
// Rangos Unicode copiados de los CSS de @fontsource (cormorant-garamond/400.css
// y montserrat/400.css, bloques `-latin-` y `-latin-ext-`; idénticos en ambas
// familias y en todos los pesos, v5.3.0). Son los mismos que sirve Google Fonts.
export const UNICODE_LATIN =
  "U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD";
export const UNICODE_LATIN_EXT =
  "U+0100-02BA,U+02BD-02C5,U+02C7-02CC,U+02CE-02D7,U+02DD-02FF,U+0304,U+0308,U+0329,U+1D00-1DBF,U+1E00-1E9F,U+1EF2-1EFF,U+2020,U+20A0-20AB,U+20AD-20C0,U+2113,U+2C60-2C7F,U+A720-A7FF";

export interface ArchivoFuente {
  familia: string;
  /** Peso fijo o rango (fuentes variables). */
  peso: number | readonly [number, number];
  estilo: "normal" | "italic";
  /** Ruta relativa a public/instagram/fuentes/ del panel. */
  fichero: string;
  unicodeRange?: string;
  /** De dónde sale el fichero (repo:ruta o paquete npm). */
  origen: string;
}

const SUBSETS = [
  { id: "latin", rango: UNICODE_LATIN },
  { id: "latin-ext", rango: UNICODE_LATIN_EXT },
] as const;

/** Genera la lista de ficheros Fontsource para una familia/pesos/estilo. */
function fontsource(
  familia: string,
  slug: string,
  pesos: readonly number[],
  estilo: "normal" | "italic",
): ArchivoFuente[] {
  return pesos.flatMap((peso) =>
    SUBSETS.map((s) => ({
      familia,
      peso,
      estilo,
      fichero: `${slug}/${slug}-${s.id}-${peso}-${estilo}.woff2`,
      unicodeRange: s.rango,
      origen: `npm:@fontsource/${slug}/files/${slug}-${s.id}-${peso}-${estilo}.woff2`,
    })),
  );
}

/**
 * Pesos de Touza: exactamente los que carga la web por Google Fonts.
 * Origen: touza-restaurant-website:index.html → enlace a fonts.googleapis.com
 * `Cormorant+Garamond:ital,wght@0,400;0,500;0,600;0,700;1,400` y
 * `Montserrat:wght@300;400;500;600`.
 */
export const PESOS_CORMORANT = [400, 500, 600, 700] as const;
export const PESOS_CORMORANT_CURSIVA = [400] as const;
export const PESOS_MONTSERRAT = [300, 400, 500, 600] as const;

export const FUENTES = {
  "casa-tomas": [
    {
      familia: "Libre Baskerville",
      peso: [400, 700],
      estilo: "normal",
      fichero: "libre-baskerville/LibreBaskerville-Variable-latin.c844cbb9.woff2",
      // Subset Latin + Latin-1 + Latin Ext-A + puntuación + € (sin unicode-range).
      origen:
        "casa-tomas-story:public/fonts/libre-baskerville/LibreBaskerville-Variable-latin.c844cbb9.woff2 (misma @font-face en web-casatomas:src/index.css)",
    },
    {
      familia: "Libre Baskerville",
      peso: [400, 700],
      estilo: "italic",
      fichero: "libre-baskerville/LibreBaskerville-Italic-Variable-latin.c44cc02a.woff2",
      origen:
        "casa-tomas-story:public/fonts/libre-baskerville/LibreBaskerville-Italic-Variable-latin.c44cc02a.woff2",
    },
  ],
  touza: [
    ...fontsource("Cormorant Garamond", "cormorant-garamond", PESOS_CORMORANT, "normal"),
    ...fontsource("Cormorant Garamond", "cormorant-garamond", PESOS_CORMORANT_CURSIVA, "italic"),
    ...fontsource("Montserrat", "montserrat", PESOS_MONTSERRAT, "normal"),
  ],
} as const satisfies Record<string, readonly ArchivoFuente[]>;

/** Licencias OFL que acompañan a cada familia (ruta relativa a public/instagram/fuentes/). */
export const LICENCIAS_FUENTES = [
  "libre-baskerville/OFL.txt",
  "cormorant-garamond/OFL.txt",
  "montserrat/OFL.txt",
] as const;

// ── Oro de Casa Tomás: decisión en UN solo sitio ─────────────────────────────
/**
 * Oro de Casa Tomás (fase 0 de Instagram, 07/11/2026). El dueño no contestó a
 * la decisión 2 de la propuesta y se aplicó la recomendación:
 *   - acento = #b6852f, el OFICIAL (marca-base/tokens/colors.css → --ct-gold,
 *     web-casatomas:src/index.css → --accent / --gold = 38 59% 45%): filetes,
 *     marcos, cifras grandes, la píldora del CTA (texto blanco ≥ 24 px en
 *     negrita) y el oro de los reels;
 *   - texto = #845f1f (web-casatomas → --ticket-stamp, 38 62% 32%): SOLO para
 *     texto oro pequeño sobre fondo claro (AA 5,45 sobre papel).
 * Antes se usaba #8e6725 («38 59% 35%»), atribuido por error a web-casatomas:
 * ese valor nunca ha existido en su src/index.css.
 *
 * Para volver al oro oscuro: cambia `acento` aquí a "#8e6725" Y cambia
 * --ct-gold en src/lib/instagram/marca-base/colors.css (y en marca-base), o el
 * test de tokens fallará: la fuente oficial manda.
 */
export const ORO_CASA_TOMAS = { acento: "#b6852f", texto: "#845f1f" } as const;

// ── Marcas ───────────────────────────────────────────────────────────────────

export const MARCAS = {
  "casa-tomas": {
    id: "casa-tomas",
    nombre: "Restaurante Casa Tomás",
    tema: "claro",
    // Valores de PRODUCCIÓN (web-casatomas) = sistema de marca oficial (marca-base).
    colores: {
      pizarra: "#394147", // web-casatomas:src/index.css → --primary / --dark-slate / --foreground (206 11% 25%); marca-base → --ct-slate
      oro: ORO_CASA_TOMAS.acento, // web-casatomas:src/index.css → --accent / --gold (38 59% 45%); marca-base → --ct-gold
      "oro-claro": "#d7ad65", // web-casatomas:src/index.css → --gold-light (38 59% 62%)
      "oro-texto": ORO_CASA_TOMAS.texto, // web-casatomas:src/index.css → --ticket-stamp (38 62% 32%): oro para texto pequeño
      piedra: "#9b8a7d", // web-casatomas:src/index.css → --stone (25 13% 55%)
      "piedra-clara": "#ded8d4", // web-casatomas:src/index.css → --muted / --border (25 13% 85%)
      "gris-medio": "#67615f", // web-casatomas:src/index.css → --mid-gray (15 4% 39%)
      papel: "#fbf8f4", // web-casatomas:src/index.css → --ticket-paper (36 50% 97%)
      blanco: "#ffffff", // web-casatomas:src/index.css → --background (0 0% 100%)
      // Color real del logo: píxel dominante de casa-tomas-story:src/assets/logo-casa-tomas.png
      // (rgb 7,7,7). Solo para la variante «negro» del logo.
      "negro-logo": "#070707",
    },
    // Papeles de cada color (las plantillas usan estos alias).
    roles: {
      fondo: "blanco", // web-casatomas:src/index.css → --background
      superficie: "papel", // web-casatomas:src/index.css → --ticket-paper
      texto: "pizarra", // web-casatomas:src/index.css → --foreground
      titular: "pizarra", // web-casatomas:src/index.css → --foreground
      acento: "oro", // web-casatomas:src/index.css → --accent
      "acento-texto": "oro-texto", // web-casatomas:src/index.css → --ticket-stamp (oro legible sobre papel)
      antetitulo: "gris-medio", // web-casatomas:src/index.css → --mid-gray
      linea: "piedra-clara", // web-casatomas:src/index.css → --border
      "boton-fondo": "oro", // web-casatomas:src/components/Hero.tsx → bg-accent
      "boton-texto": "blanco", // web-casatomas:src/index.css → --accent-foreground (0 0% 100%)
    },
    tipografia: {
      // web-casatomas:src/index.css → body { font-family: "Libre Baskerville", "Bodoni MT", serif }
      titular: '"Libre Baskerville", "Bodoni MT", serif',
      texto: '"Libre Baskerville", "Bodoni MT", serif',
      pesos: {
        titular: 700, // encargo fase 1: titulares en Libre Baskerville bold
        lema: 600, // web-casatomas:src/components/Hero.tsx → .hero-lema font-semibold italic
        antetitulo: 500, // web-casatomas:src/components/Hero.tsx → h1 font-medium uppercase
        texto: 400, // web-casatomas:src/index.css → @font-face Libre Baskerville (rango 400–700, normal)
      },
      estiloLema: "italic", // web-casatomas:src/components/Hero.tsx → italic
      trackingAntetitulo: "0.3em", // web-casatomas:src/components/Hero.tsx → md:tracking-[0.3em] uppercase
      trackingWordmark: "normal", // CT no usa wordmark de texto (va en el logo)
    },
    radios: {
      base: "8px", // web-casatomas:src/index.css → --radius: 0.5rem
      boton: "9999px", // web-casatomas:src/components/Hero.tsx → rounded-full
    },
    espaciado: {
      margen: "72px", // encargo fase 1: margen interior de plantilla
    },
  },

  touza: {
    id: "touza",
    nombre: "Touza Cocktail Bar",
    tema: "oscuro",
    colores: {
      negro: "#0a0a0a", // touza-restaurant-website:src/index.css → --background (0 0% 4%)
      // marca-base → --tz-cream. La web da 42 25% 95% (≈ #f5f4ef con otro redondeo: 1/255 de diferencia).
      crema: "#f5f3ef", // touza-restaurant-website:src/index.css → --foreground / --cream (42 25% 95%)
      oro: "#d49a35", // touza-restaurant-website:src/index.css → --primary / --gold (38 65% 52%)
      "oro-claro": "#dab981", // touza-restaurant-website:src/index.css → --gold-light (38 55% 68%)
      "oro-oscuro": "#aa7418", // touza-restaurant-website:src/index.css → --gold-dark (38 75% 38%)
      blanco: "#ffffff", // touza-restaurant-website:src/components/BarraAccionesMovil.tsx → bg-white
      // Colores con alfa: se escriben como rgb() con transparencia.
      "blanco-10": "rgb(255 255 255 / 0.1)", // touza-restaurant-website:src/components/home/Claves.tsx → border-white/10 (líneas)
      trazo: "rgb(212 154 53 / 0.4)", // touza-restaurant-website:src/components/home/Showcase.tsx → bg-primary/40 (oro al 40 %)
      "texto-suave": "rgb(255 255 255 / 0.65)", // touza-restaurant-website:src/components/home/Claves.tsx → text-white/65 font-light
    },
    roles: {
      fondo: "negro", // touza-restaurant-website:src/index.css → --background
      superficie: "negro",
      texto: "crema", // touza-restaurant-website:src/index.css → --foreground
      titular: "crema", // touza-restaurant-website:src/components/home/Showcase.tsx → h2 text-foreground
      acento: "oro", // touza-restaurant-website:src/index.css → --primary
      "acento-texto": "oro", // touza-restaurant-website:src/components/home/Showcase.tsx → text-primary
      antetitulo: "oro", // touza-restaurant-website:src/components/home/Showcase.tsx → label text-primary
      linea: "blanco-10", // touza-restaurant-website:src/components/home/Claves.tsx → border-white/10
      "boton-fondo": "blanco", // touza-restaurant-website:src/components/BarraAccionesMovil.tsx → bg-white
      "boton-texto": "negro", // touza-restaurant-website:src/components/BarraAccionesMovil.tsx → text-black (se usa el negro de marca)
    },
    tipografia: {
      // touza-restaurant-website:tailwind.config.ts → fontFamily.serif / fontFamily.sans
      titular: '"Cormorant Garamond", serif',
      texto: '"Montserrat", sans-serif',
      pesos: {
        titular: 600, // touza-restaurant-website:src/index.css → h1-h6 @apply font-semibold
        wordmark: 700, // touza-restaurant-website:src/App.tsx → TOUZA font-bold tracking-wider
        numeral: 400, // touza-restaurant-website:src/components/home/Showcase.tsx → numeral font-serif (peso por defecto)
        antetitulo: 500, // touza-restaurant-website:src/components/home/Showcase.tsx → font-medium
        texto: 300, // touza-restaurant-website:src/components/home/Claves.tsx → font-light
      },
      trackingAntetitulo: "0.3em", // touza-restaurant-website:src/components/home/Showcase.tsx → tracking-[0.3em] uppercase
      trackingWordmark: "0.05em", // touza-restaurant-website:src/App.tsx → tracking-wider (Tailwind = 0.05em)
    },
    radios: {
      base: "8px", // touza-restaurant-website:src/index.css → --radius: 0.5rem
      boton: "9999px", // touza-restaurant-website:src/components/BarraAccionesMovil.tsx → rounded-full
    },
    espaciado: {
      margen: "72px", // encargo fase 1: margen interior de plantilla
    },
  },
} as const;

export type MarcaId = keyof typeof MARCAS;
export const MARCAS_IDS = Object.keys(MARCAS) as MarcaId[];

// ── Generación de CSS ────────────────────────────────────────────────────────

export interface OpcionesCss {
  /**
   * Base de fuentes y logos (sin barra final): las fuentes se piden a
   * `${baseRecursos}/fuentes/<fichero>`. Es public/instagram del panel:
   * baseRecursosPanel() ("/instagram") o baseRecursosPanel(origen) (absoluta,
   * cuando renderiza el servidor); en los tests, un servidor local.
   */
  baseRecursos: string;
}

function pesoCss(peso: number | readonly [number, number]): string {
  return typeof peso === "number" ? String(peso) : `${peso[0]} ${peso[1]}`;
}

/** Quita las barras finales de una URL base. */
export function sinBarraFinal(url: string): string {
  return url.replace(/\/+$/, "");
}

/** Bloque de @font-face de una marca. */
export function generarFontFaces(marca: MarcaId, opciones: OpcionesCss): string {
  const base = `${sinBarraFinal(opciones.baseRecursos)}/fuentes/`;
  return (FUENTES[marca] as readonly ArchivoFuente[])
    .map((f) => {
      const lineas = [
        "@font-face {",
        `  font-family: "${f.familia}";`,
        `  src: url("${base}${f.fichero}") format("woff2");`,
        `  font-style: ${f.estilo};`,
        `  font-weight: ${pesoCss(f.peso)};`,
        // block: en un render a PNG nunca queremos la fuente de reserva.
        "  font-display: block;",
      ];
      if (f.unicodeRange) lineas.push(`  unicode-range: ${f.unicodeRange};`);
      lineas.push("}");
      return lineas.join("\n");
    })
    .join("\n\n");
}

/** Pares [nombre de variable, valor] de :root para una marca. */
export function variablesCss(marca: MarcaId): Array<[string, string]> {
  const m = MARCAS[marca];
  const vars: Array<[string, string]> = [];

  for (const [nombre, valor] of Object.entries(m.colores)) vars.push([`--color-${nombre}`, valor]);
  for (const [rol, color] of Object.entries(m.roles)) {
    // Un rol con el mismo nombre que un color crearía `--color-x: var(--color-x)`
    // (variable cíclica = inválida en CSS). Se prohíbe.
    if (rol in m.colores) throw new Error(`El rol «${rol}» de ${marca} choca con un color del mismo nombre`);
    vars.push([`--color-${rol}`, `var(--color-${color})`]);
  }

  vars.push(["--fuente-titular", m.tipografia.titular]);
  vars.push(["--fuente-texto", m.tipografia.texto]);
  for (const [nombre, peso] of Object.entries(m.tipografia.pesos)) vars.push([`--peso-${nombre}`, String(peso)]);
  if ("estiloLema" in m.tipografia) vars.push(["--estilo-lema", m.tipografia.estiloLema]);
  vars.push(["--tracking-antetitulo", m.tipografia.trackingAntetitulo]);
  vars.push(["--tracking-wordmark", m.tipografia.trackingWordmark]);

  vars.push(["--radio-base", m.radios.base]);
  vars.push(["--radio-boton", m.radios.boton]);
  vars.push(["--margen", m.espaciado.margen]);

  vars.push(["--post-ancho", `${FORMATOS.post.ancho}px`]);
  vars.push(["--post-alto", `${FORMATOS.post.alto}px`]);
  vars.push(["--story-ancho", `${FORMATOS.story.ancho}px`]);
  vars.push(["--story-alto", `${FORMATOS.story.alto}px`]);
  vars.push(["--story-zona-segura-arriba", `${FORMATOS.story.zonaSegura.arriba}px`]);
  vars.push(["--story-zona-segura-abajo", `${FORMATOS.story.zonaSegura.abajo}px`]);
  return vars;
}

/** CSS completo de una marca: @font-face + :root con todas las variables. */
export function generarCss(marca: MarcaId, opciones: OpcionesCss): string {
  const root = variablesCss(marca)
    .map(([k, v]) => `  ${k}: ${v};`)
    .join("\n");
  return `/* Generado por src/lib/instagram/tokens.ts (${MARCAS[marca].nombre}). No editar a mano. */\n${generarFontFaces(marca, opciones)}\n\n:root {\n${root}\n}\n`;
}
