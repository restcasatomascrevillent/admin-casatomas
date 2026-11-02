import { useCallback, useEffect, useRef } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { driver, type Driver, type DriveStep } from "driver.js";
import type { User } from "@supabase/supabase-js";
import "driver.js/dist/driver.css";
import "@/components/ayuda/tour.css";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import {
  TOURS,
  cadenaPestanas,
  cambiarPestanaComoTour,
  claveTourVisto,
  esEstadoLanzarTour,
  esperarA,
  pestanasDelTour,
  selectorTour,
  type PasoTour,
  type SeccionAyuda,
} from "@/lib/ayuda/tours";

/** Margen para que la pantalla termine de pintarse (datos, pestañas lazy) antes de resaltar nada. */
const ESPERA_LANZAR_MS = 700;
/** Lo que se espera a que aparezca el elemento de un paso tras cambiar de pestaña (luego se salta). */
const ESPERA_TRAS_PESTANA_MS = 2000;
/** Lo mismo sin cambio de pestaña (datos que aún cargan). */
const ESPERA_SIN_CAMBIO_MS = 400;

/** Primer elemento con ese `data-tour` que de verdad se ve (las pestañas ocultas siguen en el DOM). */
function elementoVisible(id: string): Element | null {
  const candidatos = document.querySelectorAll(selectorTour(id));
  for (const el of Array.from(candidatos)) {
    if (el.getClientRects().length > 0) return el;
  }
  return null;
}

/** ¿Está abierta la pestaña cuyo botón lleva ese `data-tour`? */
function pestanaAbierta(id: string): boolean {
  return document.querySelector(selectorTour(id))?.getAttribute("aria-selected") === "true";
}

/**
 * Abre una pestaña (Radix) pulsando su botón por programa: Radix cambia de
 * pestaña con `mousedown`, no con `click`. Devuelve si ha habido cambio.
 */
function abrirPestana(id: string): boolean {
  const boton = document.querySelector<HTMLElement>(selectorTour(id));
  if (!boton || pestanaAbierta(id)) return false;
  // Marcado como cambio del tour: la pantalla lo pone en la URL sin apilar historial.
  cambiarPestanaComoTour(() =>
    boton.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true, button: 0 })),
  );
  return true;
}

function leerVisto(clave: string): boolean {
  try {
    return window.localStorage.getItem(clave) === "1";
  } catch {
    // Sin almacenamiento (modo privado, bloqueado): mejor no lanzarlo solo cada vez.
    return true;
  }
}

/** Como `leerVisto`, pero sin almacenamiento cuenta como «no visto» (para no apuntar de más). */
function leerVistoLocal(clave: string): boolean {
  try {
    return window.localStorage.getItem(clave) === "1";
  } catch {
    return false;
  }
}

function guardarVisto(clave: string) {
  try {
    window.localStorage.setItem(clave, "1");
  } catch {
    /* sin almacenamiento: no pasa nada */
  }
}

/**
 * Tours vistos guardados también en la cuenta (user_metadata de Supabase Auth).
 * localStorage solo vale para ese navegador y esa dirección: con otro móvil, otra
 * URL del panel (la migración cambió el dominio), el navegador borrando datos al
 * cerrarse o la demo, el tour volvía a salir solo aunque el usuario ya lo hubiera
 * cerrado. La cuenta lo recuerda en todas partes; localStorage queda como caché.
 */
const CLAVE_TOURS_CUENTA = "ayuda_tours_vistos";

function vistosEnCuenta(usuario: User | null): string[] {
  const valor: unknown = usuario?.user_metadata?.[CLAVE_TOURS_CUENTA];
  return Array.isArray(valor) ? valor.filter((v): v is string => typeof v === "string") : [];
}

/** Secciones ya apuntadas en la cuenta en esta sesión (el objeto `user` no se refresca). */
const apuntadasEnCuenta = new Set<string>();

function guardarVistoEnCuenta(usuario: User | null, seccion: SeccionAyuda) {
  if (!usuario) return;
  const yaVistos = vistosEnCuenta(usuario);
  if (yaVistos.includes(seccion) || apuntadasEnCuenta.has(`${usuario.id}:${seccion}`)) return;
  apuntadasEnCuenta.add(`${usuario.id}:${seccion}`);
  // Se guarda la unión con lo que sabe este navegador: `user` puede ser de antes
  // de otros tours de esta misma sesión y el valor se sustituye entero.
  const vistos = new Set<string>(yaVistos);
  for (const s of Object.keys(TOURS) as SeccionAyuda[]) {
    if (s === seccion || leerVistoLocal(claveTourVisto(s, usuario.id))) vistos.add(s);
  }
  void supabase.auth
    .updateUser({ data: { [CLAVE_TOURS_CUENTA]: [...vistos].sort() } })
    .then(({ error }) => {
      // Sin red o sin sesión: se queda en localStorage y se reintenta otro día.
      if (error) apuntadasEnCuenta.delete(`${usuario.id}:${seccion}`);
    })
    .catch(() => apuntadasEnCuenta.delete(`${usuario.id}:${seccion}`));
}

/** Usuario actual sin exigir <AuthProvider> (en los tests de página no lo hay). */
function useUsuario(): User | null {
  try {
    return useAuth().user ?? null;
  } catch {
    return null;
  }
}

/**
 * Tour guiado de una sección del panel (driver.js). Devuelve `lanzar` para el
 * botón «?» y, además:
 *   · lo lanza solo la primera vez que el usuario entra en la sección
 *     (recordado en localStorage por usuario; con `auto: false`, nunca);
 *   · lo lanza al llegar desde el Centro de Ayuda («Ver tour»), que navega con
 *     `state: { lanzarTour: seccion }`.
 */
export function useTourSeccion(seccion: SeccionAyuda, { auto = true }: { auto?: boolean } = {}) {
  const usuario = useUsuario();
  const usuarioId = usuario?.id ?? null;
  // Para los efectos y `lanzar` sin depender de la referencia de `user`.
  const usuarioRef = useRef(usuario);
  usuarioRef.current = usuario;
  const location = useLocation();
  const navigate = useNavigate();
  const driverRef = useRef<Driver | null>(null);

  // Pestaña en la que estaba el usuario al lanzar el tour (para devolverle a ella).
  const pestanaInicialRef = useRef<string | null>(null);

  const lanzar = useCallback(() => {
    const habiaTour = driverRef.current !== null;
    driverRef.current?.destroy();
    guardarVisto(claveTourVisto(seccion, usuarioId));
    guardarVistoEnCuenta(usuarioRef.current, seccion);

    // Relanzado a mitad de tour: la pestaña «de vuelta» sigue siendo la de antes.
    // Si no, se apunta justo antes del primer cambio de pestaña (al lanzarse solo,
    // la barra de pestañas puede no haberse pintado aún).
    const pasos: PasoTour[] = [...TOURS[seccion]];
    const pestanasTour = pestanasDelTour(pasos);
    if (!habiaTour) pestanaInicialRef.current = null;
    const apuntarPestanaInicial = () => {
      if (!pestanaInicialRef.current) pestanaInicialRef.current = pestanasTour.find(pestanaAbierta) ?? null;
    };

    // Los elementos se resuelven al llegar a cada paso (tras abrir su pestaña);
    // driver.js lee este mismo array, así que quitar un paso saltado actualiza
    // también el «3 de 12».
    const steps: DriveStep[] = pasos.map((paso) => ({
      popover: { title: paso.titulo, description: paso.texto, align: "start" },
    }));

    // Desplegables que abrió el tour (estaban plegados): al acabar se vuelven a plegar.
    const desplegados: HTMLElement[] = [];

    let ocupado = false;
    let terminado = false;
    const terminar = () => {
      if (terminado) return;
      terminado = true;
      if (driverRef.current === d) driverRef.current = null;
      for (const boton of desplegados) {
        if (boton.isConnected && boton.getAttribute("aria-expanded") === "true") boton.click();
      }
      if (pestanaInicialRef.current) abrirPestana(pestanaInicialRef.current);
    };
    const vigente = () => !terminado && driverRef.current === d;

    /** Prepara y enseña el paso `i`; si es opcional y no aparece, sigue en la dirección `dir`. */
    const mostrar = async (i: number, dir: 1 | -1) => {
      if (ocupado) return;
      ocupado = true;
      try {
        while (i >= 0 && i < pasos.length) {
          const paso = pasos[i];
          // Pestaña y, si hace falta, subpestaña, en orden: yendo hacia atrás la
          // de fuera puede no estar abierta y el botón de dentro no verse.
          const cadena = cadenaPestanas(paso);
          if (cadena.length > 0) apuntarPestanaInicial();
          let cambio = false;
          for (const [n, pestana] of cadena.entries()) {
            if (n > 0) {
              // El botón de la subpestaña aparece al abrirse (o mostrarse) la de fuera.
              await esperarA(() => elementoVisible(pestana), cambio ? ESPERA_TRAS_PESTANA_MS : ESPERA_SIN_CAMBIO_MS);
              if (!vigente()) return;
            }
            if (abrirPestana(pestana)) cambio = true;
          }
          if (paso.abrir) {
            // Tras abrir la pestaña, el desplegable puede tardar en montarse.
            const abrir = paso.abrir;
            const boton = await esperarA(() => elementoVisible(abrir), cambio ? ESPERA_TRAS_PESTANA_MS : ESPERA_SIN_CAMBIO_MS);
            if (!vigente()) return;
            if (boton instanceof HTMLElement && boton.getAttribute("aria-expanded") !== "true") {
              boton.click();
              if (!desplegados.includes(boton)) desplegados.push(boton);
              cambio = true;
            }
          }
          const id = paso.elemento;
          const elemento = id
            ? await esperarA(() => elementoVisible(id), cambio ? ESPERA_TRAS_PESTANA_MS : ESPERA_SIN_CAMBIO_MS)
            : null;
          if (!vigente()) return;
          if (id && !elemento && paso.opcional) {
            pasos.splice(i, 1);
            steps.splice(i, 1);
            if (dir < 0) i -= 1;
            continue;
          }
          // En el móvil la barra de pestañas se desliza de lado: que el botón quede a la vista.
          elemento?.scrollIntoView?.({ block: "nearest", inline: "nearest" });
          steps[i].element = elemento ?? undefined;
          steps[i].popover = { ...steps[i].popover, side: elemento ? paso.lado : undefined };
          // driver.js quita el resaltado del paso anterior al terminar su animación;
          // si se avanza antes (o el navegador frena las animaciones), se queda
          // pegado. Se limpia aquí: el paso nuevo lo vuelve a poner.
          document.querySelectorAll(".driver-active-element").forEach((el) =>
            el.classList.remove("driver-active-element", "driver-no-interaction"),
          );
          if (d.isActive()) d.moveTo(i);
          else d.drive(i);
          return;
        }
        if (i >= pasos.length) {
          d.destroy();
          terminar();
        }
      } finally {
        ocupado = false;
      }
    };

    const d = driver({
      steps,
      showProgress: true,
      progressText: "{{current}} de {{total}}",
      nextBtnText: "Siguiente",
      prevBtnText: "Anterior",
      doneBtnText: "Entendido",
      popoverClass: "tour-panel",
      // P-20: driver.js pone «Close» en inglés en el aria-label del botón de cerrar.
      onPopoverRender: (popover) => popover.closeButton?.setAttribute("aria-label", "Cerrar la guía"),
      overlayColor: "#000",
      overlayOpacity: 0.55,
      stagePadding: 6,
      stageRadius: 10,
      smoothScroll: true,
      // Durante el tour se mira, no se toca: así un toque no abre diálogos a medias.
      disableActiveInteraction: true,
      onNextClick: () => void mostrar((d.getActiveIndex() ?? -1) + 1, 1),
      onPrevClick: () => void mostrar((d.getActiveIndex() ?? 1) - 1, -1),
      // Cierre por el usuario («×», Esc, clic fuera). Se usa este aviso y no
      // `onDestroyed`: ese solo llega si la animación del paso terminó.
      onDestroyStarted: () => {
        d.destroy();
        terminar();
      },
    });
    driverRef.current = d;
    void mostrar(0, 1);
  }, [seccion, usuarioId]);

  // Un solo temporizador para las dos formas de lanzarlo solo; no depende de
  // los efectos que lo programan (al limpiar el estado de navegación, el efecto
  // vuelve a correr y no debe cancelarlo).
  const lanzarRef = useRef(lanzar);
  lanzarRef.current = lanzar;
  const temporizador = useRef<number | undefined>(undefined);
  const programar = useCallback(() => {
    window.clearTimeout(temporizador.current);
    temporizador.current = window.setTimeout(() => lanzarRef.current(), ESPERA_LANZAR_MS);
  }, []);

  // Llegada desde el Centro de Ayuda: lanzar y limpiar el estado (si no, recargar lo relanzaría).
  const pedidoDesdeAyuda = esEstadoLanzarTour(location.state) && location.state.lanzarTour === seccion;
  useEffect(() => {
    if (!pedidoDesdeAyuda) return;
    navigate(`${location.pathname}${location.search}`, { replace: true, state: null });
    programar();
    // Solo al llegar con la petición; `location` cambia con cada pestaña.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pedidoDesdeAyuda]);

  // Primera visita a la sección: lanzarlo solo, una vez por usuario (en este
  // navegador o en cualquier otro: lo recuerda la cuenta).
  useEffect(() => {
    if (!auto || !usuarioId) return;
    const clave = claveTourVisto(seccion, usuarioId);
    if (leerVisto(clave)) {
      // Visto antes de que se guardara en la cuenta: se sube para los demás dispositivos.
      if (leerVistoLocal(clave)) guardarVistoEnCuenta(usuarioRef.current, seccion);
      return;
    }
    if (vistosEnCuenta(usuarioRef.current).includes(seccion)) {
      guardarVisto(clave);
      return;
    }
    programar();
  }, [auto, usuarioId, seccion, programar]);

  // Al salir de la sección (también a mitad de tour): nada pendiente ni capa oscura encima.
  useEffect(
    () => () => {
      window.clearTimeout(temporizador.current);
      // Primero se suelta: un tour a medio preparar ya no debe arrancar.
      const d = driverRef.current;
      driverRef.current = null;
      d?.destroy();
    },
    [],
  );

  return { lanzar };
}
