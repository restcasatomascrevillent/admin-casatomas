/**
 * Comprobaciones de maquetación sobre el documento YA PINTADO (en un iframe del
 * panel o en Chromium con Playwright). Son las del motor del prototipo
 * (instagram-studio: src/render/renderizar.ts → comprobarMaquetacion):
 *
 *  (a) desbordes en los contenedores con data-ajuste (con la corrección del
 *      falso desborde vertical cuando el line-height es apretado y del vuelo
 *      horizontal de las cursivas);
 *  (b) todo data-campo dentro del margen de 72 px y, en story, dentro de la
 *      zona segura (250 px arriba y abajo);
 *  (c) ningún data-campo vacío;
 *  (d) aviso (no error) si el titular pasa de 3 líneas.
 *
 * AUTOCONTENIDAS A PROPÓSITO: comprobarMaquetacion y esperarRecursos no usan
 * nada de fuera (ni imports, ni constantes del módulo, ni funciones auxiliares
 * con nombre) porque se serializan con Function.prototype.toString para
 * mandarlas a Playwright (CODIGO_*). Por eso las medidas de los formatos van
 * repetidas dentro; un test comprueba que coinciden con tokens.ts. Tampoco
 * hay funciones internas con nombre: esbuild con keepNames las envolvería en
 * __name(), que no existe en la página (pasó en el prototipo con tsx); por si
 * acaso, los CODIGO_* definen además __name como identidad.
 */
import type { FormatoId } from "./tokens.js";

/**
 * Comprueba la maquetación de una pieza pintada. Devuelve los ERRORES ([] =
 * bien). Si se pasa `avisos`, añade ahí los avisos no bloqueantes (titular de
 * más de 3 líneas). Necesita un documento con layout real (navegador), no jsdom.
 */
export function comprobarMaquetacion(doc: Document, formato: FormatoId, avisos?: string[]): string[] {
  // Repetidas a propósito (función autocontenida). Ver test «coinciden con tokens».
  const MEDIDAS: Record<string, { ancho: number; alto: number; arriba: number; abajo: number }> = {
    post: { ancho: 1080, alto: 1350, arriba: 0, abajo: 0 },
    story: { ancho: 1080, alto: 1920, arriba: 250, abajo: 250 },
  };
  const MARGEN_PX = 72;
  const MAX_LINEAS_TITULAR = 3;

  const errores: string[] = [];
  const m = MEDIDAS[formato];
  if (!m) return [`Formato desconocido «${String(formato)}»`];
  const win = doc.defaultView;
  if (!win) return ["El documento no está pintado (no tiene ventana): no se puede medir"];
  const lienzo = doc.querySelector(".lienzo");
  if (!lienzo) return ["No hay elemento .lienzo"];
  const r0 = lienzo.getBoundingClientRect();
  const story = formato === "story";

  // (a) Desbordes en contenedores con data-ajuste.
  const desbordados = new Set<string>();
  const ajustables = Array.from(doc.querySelectorAll("[data-ajuste]")) as HTMLElement[];
  for (const el of ajustables) {
    if (win.getComputedStyle(el).display === "none") continue;

    // Nombre del campo: data-ajuste, data-campo propio o del ancestro, el de dentro, o la clase.
    let campo = el.getAttribute("data-ajuste") || "";
    if (!campo) {
      const ancestro = el.closest("[data-campo]");
      const dentro = el.querySelector("[data-campo]");
      campo =
        el.getAttribute("data-campo") ||
        (ancestro ? ancestro.getAttribute("data-campo") : null) ||
        (dentro ? dentro.getAttribute("data-campo") : null) ||
        (el.className ? `.${String(el.className).split(" ")[0]}` : el.tagName.toLowerCase());
    }

    // Horizontal: scrollWidth puede incluir el vuelo de las cursivas; se
    // contrasta con las cajas reales del texto (Range.getClientRects).
    let dx = 0;
    const brutoX = el.scrollWidth - el.clientWidth;
    if (brutoX > 1) {
      const cs = win.getComputedStyle(el);
      const r = el.getBoundingClientRect();
      const izq = r.left + parseFloat(cs.borderLeftWidth) + parseFloat(cs.paddingLeft);
      const der = r.right - parseFloat(cs.borderRightWidth) - parseFloat(cs.paddingRight);
      const rango = doc.createRange();
      rango.selectNodeContents(el);
      let fuera = 0;
      for (const t of Array.from(rango.getClientRects())) {
        if (t.width < 0.5) continue;
        fuera = Math.max(fuera, t.right - der, izq - t.left);
      }
      dx = Math.min(brutoX, Math.ceil(fuera));
    }

    // Vertical: Chromium cuenta en scrollHeight el «área de contenido» de la
    // fuente (ascendente + descendente), que con line-height < ~1.25 sobresale
    // de la caja de línea aunque el texto quepa (Libre Baskerville a 1.06 →
    // 3-8 px). Para no dar falsos desbordes se mide ese exceso con la caja
    // libre de restricciones de alto y se descuenta.
    let dy = 0;
    const brutoY = el.scrollHeight - el.clientHeight;
    if (brutoY > 1) {
      const st = el.style;
      const antes = [st.maxHeight, st.height, st.minHeight, st.flex, st.alignSelf];
      st.maxHeight = "none";
      st.height = "auto";
      st.minHeight = "0";
      const padre = el.parentElement ? win.getComputedStyle(el.parentElement) : null;
      if (padre && padre.display.includes("flex") && padre.flexDirection.startsWith("column")) st.flex = "0 0 auto";
      if (padre && padre.display.includes("grid")) st.alignSelf = "start";
      const exceso = Math.max(0, el.scrollHeight - el.clientHeight);
      st.maxHeight = antes[0];
      st.height = antes[1];
      st.minHeight = antes[2];
      st.flex = antes[3];
      st.alignSelf = antes[4];
      dy = brutoY - exceso;
    }

    if (dx > 1 || dy > 1) {
      const partes: string[] = [];
      if (dy > 1) partes.push(`${dy} px de alto`);
      if (dx > 1) partes.push(`${dx} px de ancho`);
      desbordados.add(campo);
      errores.push(`El campo «${campo}» se desborda (${partes.join(", ")}): acórtalo`);
    }
  }

  // (b) Márgenes y zona segura; (c) campos vacíos.
  const minX = MARGEN_PX;
  const maxX = m.ancho - MARGEN_PX;
  const minY = story ? Math.max(MARGEN_PX, m.arriba) : MARGEN_PX;
  const maxY = story ? Math.min(m.alto - MARGEN_PX, m.alto - m.abajo) : m.alto - MARGEN_PX;
  const tol = 1;
  const campos = Array.from(doc.querySelectorAll("[data-campo]")) as HTMLElement[];
  for (const el of campos) {
    if (win.getComputedStyle(el).display === "none") continue;
    const campo = el.getAttribute("data-campo") || "?";
    const r = el.getBoundingClientRect();
    const tieneMedia = !!el.querySelector("img, svg, picture, canvas");
    if (r.height < 0.5 || r.width < 0.5 || (!(el.textContent || "").trim() && !tieneMedia)) {
      errores.push(`El campo «${campo}» está vacío o no ocupa espacio (alto ${Math.round(r.height)} px)`);
      continue;
    }
    // Si ya se ha dicho que se desborda, el resto es consecuencia: no repetir.
    if (desbordados.has(campo)) continue;
    const x0 = r.left - r0.left;
    const x1 = r.right - r0.left;
    const y0 = r.top - r0.top;
    const y1 = r.bottom - r0.top;
    const fuera: string[] = [];
    if (x0 < minX - tol) fuera.push(`izquierda x=${Math.round(x0)} < ${minX}`);
    if (x1 > maxX + tol) fuera.push(`derecha x=${Math.round(x1)} > ${maxX}`);
    if (y0 < minY - tol) fuera.push(`arriba y=${Math.round(y0)} < ${minY}`);
    if (y1 > maxY + tol) fuera.push(`abajo y=${Math.round(y1)} > ${maxY}`);
    if (fuera.length) {
      errores.push(
        story
          ? `El campo «${campo}» invade la zona segura del story (${fuera.join("; ")})`
          : `El campo «${campo}» se sale del margen de ${MARGEN_PX} px (${fuera.join("; ")})`,
      );
    }
  }

  // (d) Líneas del titular (aviso).
  const titular = doc.querySelector('[data-campo="titular"]') as HTMLElement | null;
  if (titular && avisos) {
    const rango = doc.createRange();
    rango.selectNodeContents(titular);
    const rects = Array.from(rango.getClientRects()).filter((r) => r.width > 0.5 && r.height > 0.5);
    const tam = parseFloat(win.getComputedStyle(titular).fontSize) || 16;
    const lineas: number[] = [];
    for (const r of rects) {
      const centro = (r.top + r.bottom) / 2;
      if (!lineas.some((c) => Math.abs(c - centro) < tam * 0.5)) lineas.push(centro);
    }
    if (lineas.length > MAX_LINEAS_TITULAR) {
      avisos.push(`El titular ocupa ${lineas.length} líneas (recomendado ≤ ${MAX_LINEAS_TITULAR})`);
    }
  }
  return errores;
}

/**
 * Espera a que el documento tenga TODAS sus fuentes y sus imágenes (<img> y
 * background-image) cargadas y decodificadas, como el motor del prototipo
 * antes de capturar. Devuelve los fallos ([] = todo cargado). Llamarla antes
 * de comprobarMaquetacion y de capturar: si no, se mide con la fuente de
 * reserva del sistema.
 */
export async function esperarRecursos(doc: Document): Promise<string[]> {
  const fallos: string[] = [];
  const win = doc.defaultView;
  if (!win) return ["El documento no está pintado (no tiene ventana)"];

  // Fuentes: forzar la carga de cada @font-face (las de unicode-range solo se
  // descargan si se usan; aquí se quieren todas).
  const caras = Array.from(doc.fonts as unknown as Iterable<FontFace>);
  await Promise.allSettled(caras.map((f) => f.load()));
  await doc.fonts.ready;
  if (caras.length === 0) fallos.push("El documento no declara ninguna @font-face");
  for (const f of caras) {
    if (f.status !== "loaded") fallos.push(`La fuente ${f.family} ${f.weight} ${f.style} no carga (estado «${f.status}»)`);
  }

  // <img>
  const imgs = Array.from(doc.images);
  await Promise.all(
    imgs.map(async (img) => {
      const src = img.currentSrc || img.src || "(sin src)";
      try {
        if (!img.complete) {
          await new Promise<void>((ok, ko) => {
            img.addEventListener("load", () => ok(), { once: true });
            img.addEventListener("error", () => ko(new Error("error de carga")), { once: true });
          });
        }
        await img.decode();
        if (!img.naturalWidth) fallos.push(`La imagen ${src} no tiene tamaño (¿no ha cargado?)`);
      } catch {
        fallos.push(`La imagen ${src} no carga o no se puede decodificar`);
      }
    }),
  );

  // background-image: url(...) en cualquier elemento (y pseudoelementos).
  const urls = new Set<string>();
  for (const el of Array.from(doc.querySelectorAll("*"))) {
    for (const pseudo of [null, "::before", "::after"]) {
      const bg = win.getComputedStyle(el, pseudo).backgroundImage;
      if (!bg || bg === "none") continue;
      for (const mm of Array.from(bg.matchAll(/url\((["']?)(.*?)\1\)/g))) if (mm[2] && !mm[2].startsWith("data:")) urls.add(mm[2]);
    }
  }
  await Promise.all(
    Array.from(urls).map(async (u) => {
      const im = new win.Image();
      im.src = u;
      try {
        await im.decode();
      } catch {
        fallos.push(`La imagen de fondo ${u} no carga o no se puede decodificar`);
      }
    }),
  );
  return fallos;
}

/** Shim de __name (esbuild keepNames) para el código que se manda a la página. */
const PREAMBULO = "var __name = globalThis.__name || function (f) { return f; };";

/**
 * Código JS (expresión) para page.evaluate de Playwright: define
 * comprobarMaquetacion, deduce el formato de la clase del .lienzo y devuelve
 * `{ errores: string[], avisos: string[] }`.
 *
 *   const { errores, avisos } = await page.evaluate(CODIGO_COMPROBAR_MAQUETACION);
 */
export const CODIGO_COMPROBAR_MAQUETACION = `(() => {
${PREAMBULO}
const comprobar = (${comprobarMaquetacion.toString()});
const lienzo = document.querySelector(".lienzo");
const m = /formato-(post|story)/.exec(lienzo ? String(lienzo.className) : "");
const avisos = [];
const errores = comprobar(document, m ? m[1] : "post", avisos);
return { errores: errores, avisos: avisos };
})()`;

/**
 * Código JS (expresión, devuelve una promesa) para page.evaluate: espera
 * fuentes e imágenes y devuelve la lista de fallos ([] = todo cargado).
 *
 *   const fallos = await page.evaluate(CODIGO_ESPERAR_RECURSOS);
 */
export const CODIGO_ESPERAR_RECURSOS = `(() => {
${PREAMBULO}
const esperar = (${esperarRecursos.toString()});
return esperar(document);
})()`;
