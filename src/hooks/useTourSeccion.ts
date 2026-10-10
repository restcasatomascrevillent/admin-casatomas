import { useCallback, useEffect, useRef } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { driver, type Driver, type DriveStep } from "driver.js";
import "driver.js/dist/driver.css";
import "@/components/ayuda/tour.css";
import { useAuth } from "@/hooks/useAuth";
import {
  TOURS,
  claveTourVisto,
  esEstadoLanzarTour,
  resolverPasos,
  selectorTour,
  type SeccionAyuda,
} from "@/lib/ayuda/tours";

/** Margen para que la pantalla termine de pintarse (datos, pestañas lazy) antes de resaltar nada. */
const ESPERA_LANZAR_MS = 700;

/** Primer elemento con ese `data-tour` que de verdad se ve (las pestañas ocultas siguen en el DOM). */
function elementoVisible(id: string): Element | null {
  const candidatos = document.querySelectorAll(selectorTour(id));
  for (const el of Array.from(candidatos)) {
    if (el.getClientRects().length > 0) return el;
  }
  return null;
}

function leerVisto(clave: string): boolean {
  try {
    return window.localStorage.getItem(clave) === "1";
  } catch {
    // Sin almacenamiento (modo privado, bloqueado): mejor no lanzarlo solo cada vez.
    return true;
  }
}

function guardarVisto(clave: string) {
  try {
    window.localStorage.setItem(clave, "1");
  } catch {
    /* sin almacenamiento: no pasa nada */
  }
}

/** Usuario actual sin exigir <AuthProvider> (en los tests de página no lo hay). */
function useUsuarioId(): string | null {
  try {
    return useAuth().user?.id ?? null;
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
  const usuarioId = useUsuarioId();
  const location = useLocation();
  const navigate = useNavigate();
  const driverRef = useRef<Driver | null>(null);

  const lanzar = useCallback(() => {
    driverRef.current?.destroy();
    guardarVisto(claveTourVisto(seccion, usuarioId));

    const pasos = resolverPasos(TOURS[seccion], elementoVisible);
    const steps: DriveStep[] = pasos.map(({ paso, elemento }) => ({
      element: elemento ?? undefined,
      popover: {
        title: paso.titulo,
        description: paso.texto,
        side: elemento ? paso.lado : undefined,
        align: "start",
      },
    }));

    const d = driver({
      steps,
      showProgress: true,
      progressText: "{{current}} de {{total}}",
      nextBtnText: "Siguiente",
      prevBtnText: "Anterior",
      doneBtnText: "Entendido",
      popoverClass: "tour-panel",
      overlayColor: "#000",
      overlayOpacity: 0.55,
      stagePadding: 6,
      stageRadius: 10,
      smoothScroll: true,
      // Durante el tour se mira, no se toca: así un toque no abre diálogos a medias.
      disableActiveInteraction: true,
      onDestroyed: () => {
        if (driverRef.current === d) driverRef.current = null;
      },
    });
    driverRef.current = d;
    d.drive();
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

  // Primera visita a la sección: lanzarlo solo, una vez por usuario.
  useEffect(() => {
    if (!auto || !usuarioId) return;
    if (leerVisto(claveTourVisto(seccion, usuarioId))) return;
    programar();
  }, [auto, usuarioId, seccion, programar]);

  // Al salir de la sección (también a mitad de tour): nada pendiente ni capa oscura encima.
  useEffect(
    () => () => {
      window.clearTimeout(temporizador.current);
      driverRef.current?.destroy();
    },
    [],
  );

  return { lanzar };
}
