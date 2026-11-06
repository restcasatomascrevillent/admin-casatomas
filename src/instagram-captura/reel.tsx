/**
 * Página de captura de reels (__reel-instagram.html). Monta ReelEnInstante a
 * 1080×1920, sin escala ni controles, y expone a Playwright lo que necesita el
 * trabajador de render (ver src/lib/instagram/reels/captura.ts):
 *
 *   __reelEstado, __listo(), __fijarTiempo(t) y __medirTextos().
 *
 * El reel y las URL de sus fotos llegan en window.__REEL_CAPTURA__ (los pone el
 * trabajador con page.addInitScript antes de cargar). Sin datos, o con un reel
 * que no pasa validarReel, __reelEstado.ok = false con los problemas.
 */
import { useState } from "react";
import { createRoot } from "react-dom/client";
import { flushSync } from "react-dom";
import {
  ReelEnInstante,
  calcularTiempos,
  crearResolverFotos,
  instantePortada,
  instantesDeMedida,
  revisarCajas,
  validarReel,
  type CajaTexto,
  type DatosCaptura,
  type EstadoCaptura,
  type ReelPieza,
} from "@/lib/instagram/reels";
import { FPS_REEL } from "@/lib/instagram/reels/motor";

declare global {
  interface Window {
    __REEL_CAPTURA__?: DatosCaptura;
    __reelEstado?: EstadoCaptura;
    __listo?: () => Promise<{ fotosFallidas: string[]; fuentes: number }>;
    __fijarTiempo?: (t: number) => Promise<string | null>;
    __medirTextos?: () => { problemas: string[]; avisos: string[] };
  }
}

const datos = window.__REEL_CAPTURA__;
const baseRecursos = (datos?.baseRecursos ?? "/instagram").replace(/\/+$/, "");
const fotos = datos?.fotos ?? {};
const urlFoto = crearResolverFotos(baseRecursos, (id) => fotos[id]);

function estadoInicial(): { reel: ReelPieza | null; estado: EstadoCaptura } {
  const vacio = { duracion: 0, fotogramas: 0, instantesMedida: [], portada_s: 0 };
  if (!datos) return { reel: null, estado: { ok: false, problemas: ["Faltan los datos del reel (window.__REEL_CAPTURA__)"], avisos: [], ...vacio } };
  const v = validarReel(datos.reel);
  let reel: ReelPieza | null = v.ok ? v.reel : null;
  // Pruebas del trabajador: un reel corto que no cumple los 5-90 s se acepta si el esquema es válido.
  if (!reel && datos.limiteSegundos && v.problemas.every((p) => /duración|dura/i.test(p))) reel = datos.reel as ReelPieza;
  if (!reel) return { reel: null, estado: { ok: false, problemas: v.problemas ?? [], avisos: v.avisos, ...vacio } };
  const total = calcularTiempos(reel).total;
  const duracion = datos.limiteSegundos ? Math.min(total, datos.limiteSegundos) : total;
  const avisos = [...v.avisos];
  for (const id of new Set([...reel.escenas.map((e) => e.foto), reel.cierre.foto])) {
    if (id && !urlFoto(id)) avisos.push(`La foto «${id}» no tiene URL: saldrá un hueco oscuro.`);
  }
  return {
    reel,
    estado: {
      ok: true,
      problemas: [],
      avisos,
      duracion,
      fotogramas: Math.max(1, Math.round(duracion * FPS_REEL)),
      instantesMedida: instantesDeMedida(reel).filter((t) => t < duracion),
      portada_s: Math.min(instantePortada(reel, datos.portada_s), Math.max(0, duracion - 1 / FPS_REEL)),
    },
  };
}

const { reel, estado } = estadoInicial();
window.__reelEstado = estado;

let fijar: ((t: number) => void) | null = null;

function Captura() {
  const [t, setT] = useState(0);
  fijar = setT;
  if (!reel) return null;
  // Sin zona segura ni rótulos de hueco: es el vídeo final.
  return <ReelEnInstante reel={reel} t={t} urlFoto={urlFoto} baseRecursos={baseRecursos} zonaSegura={false} marcarHuecos={false} />;
}

const raiz = document.getElementById("reel");
if (raiz) {
  // flushSync: el DOM ya está montado cuando el trabajador pregunta.
  const r = createRoot(raiz);
  flushSync(() => r.render(<Captura />));
}

/** Fotos del reel precargadas y decodificadas (se guardan para que no salgan de la caché). */
const precargadas: HTMLImageElement[] = [];

window.__listo = async () => {
  // Todas las @font-face (las que aún no se usan no cargan solas).
  const caras = [...document.fonts];
  await Promise.all(caras.map((f) => f.load().catch(() => null)));
  await document.fonts.ready;
  const fallidas: string[] = [];
  if (reel) {
    const ids = new Set([...reel.escenas.map((e) => e.foto), reel.cierre.foto].filter((x): x is string => !!x));
    await Promise.all(
      [...ids].map(async (id) => {
        const url = urlFoto(id);
        if (!url) return;
        const img = new Image();
        img.decoding = "sync";
        img.src = url;
        try {
          await img.decode();
          precargadas.push(img);
        } catch {
          fallidas.push(id);
        }
      }),
    );
  }
  return { fotosFallidas: fallidas, fuentes: caras.length };
};

window.__fijarTiempo = async (t: number) => {
  flushSync(() => fijar?.(t));
  const lienzo = document.querySelector("[data-reel]");
  // Las <img> que acaban de montarse: esperar a que estén decodificadas.
  await Promise.all([...(lienzo?.querySelectorAll("img") ?? [])].map((img) => img.decode().catch(() => null)));
  return lienzo?.getAttribute("data-reel-t") ?? null;
};

/** Opacidad efectiva (producto de los antepasados) para no medir textos invisibles. */
function opacidad(el: Element | null): number {
  let o = 1;
  for (let e = el; e && e instanceof HTMLElement; e = e.parentElement) o *= Number(getComputedStyle(e).opacity || "1");
  return o;
}

window.__medirTextos = () => {
  const lienzo = document.querySelector("[data-reel]");
  if (!lienzo) return { problemas: ["No se encuentra el lienzo del reel"], avisos: [] };
  const base = lienzo.getBoundingClientRect();
  const cajas: CajaTexto[] = [];
  for (const el of lienzo.querySelectorAll("[data-campo]")) {
    if (opacidad(el) < 0.5) continue;
    const rango = document.createRange();
    rango.selectNodeContents(el);
    const b = rango.getBoundingClientRect();
    if (!b.width || !b.height) continue;
    cajas.push({ campo: el.getAttribute("data-campo") ?? "texto", izquierda: b.left - base.left, derecha: b.right - base.left, arriba: b.top - base.top, abajo: b.bottom - base.top });
  }
  const t = Number(lienzo.getAttribute("data-reel-t") ?? "0");
  return revisarCajas(cajas, t);
};
