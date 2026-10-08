import { useCallback, useEffect, useRef, useState } from "react";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { CLAVE_RECARGA, hayVersionNueva, leerIdVersion, puedeRecargarSola } from "./logicaVersion";

/**
 * Aviso de versión nueva del panel (solo en producción).
 *
 * Detección: cada build publica /version.json (sin caché) con su id; aquí se
 * compara con el id embebido (__BUILD_ID__) cada 5 min, al volver a primer
 * plano, al enfocar la ventana y al recuperar conexión. Al arrancar no hace
 * falta: la carga ya trae el HTML fresco (el SW nunca cachea navegaciones).
 *
 * Si la app vuelve de segundo plano con versión nueva y no hay ningún diálogo
 * ni campo con foco, recarga sola. Si no, muestra el pop-up; «Más tarde» lo
 * pospone 10 min. Antibucle en sessionStorage (ver logicaVersion.ts).
 */

const CADA_CHEQUEO_MS = 5 * 60 * 1000;
const POSPONER_MS = 10 * 60 * 1000;
const ATRIBUTO_PROPIO = "data-aviso-actualizacion";

function leerSesion(clave: string): string | null {
  try {
    return sessionStorage.getItem(clave);
  } catch {
    return null;
  }
}

function escribirSesion(clave: string, valor: string | null): void {
  try {
    if (valor === null) sessionStorage.removeItem(clave);
    else sessionStorage.setItem(clave, valor);
  } catch {
    // Sin sessionStorage: se pierde solo el antibucle.
  }
}

async function pedirIdRemoto(): Promise<string | null> {
  try {
    const res = await fetch(`/version.json?t=${Date.now()}`, { cache: "no-store" });
    if (!res.ok) return null;
    return leerIdVersion(await res.json());
  } catch {
    return null;
  }
}

/** ¿Hay un diálogo abierto (que no sea este aviso) o un campo con foco? */
function hayAlgoAbierto(): boolean {
  const dialogos = document.querySelectorAll('[role="dialog"], [role="alertdialog"]');
  for (const d of Array.from(dialogos)) {
    if (!d.closest(`[${ATRIBUTO_PROPIO}]`)) return true;
  }
  const activo = document.activeElement as HTMLElement | null;
  if (!activo) return false;
  return activo.matches("input, textarea, select") || activo.isContentEditable;
}

/** Activa el SW nuevo si está esperando y recarga la página. */
async function actualizarYRecargar(idRemoto: string): Promise<void> {
  escribirSesion(CLAVE_RECARGA, idRemoto);
  try {
    const registro = await navigator.serviceWorker?.getRegistration();
    if (registro) {
      await registro.update().catch(() => {});
      const esperando = registro.waiting;
      if (esperando) {
        await new Promise<void>((resolve) => {
          navigator.serviceWorker.addEventListener("controllerchange", () => resolve(), { once: true });
          esperando.postMessage({ type: "SKIP_WAITING" });
          setTimeout(resolve, 3000);
        });
      }
    }
  } catch {
    // Si el SW falla, se recarga igual: las navegaciones van siempre a red.
  }
  window.location.reload();
}

export function AvisoActualizacion() {
  const [idNuevo, setIdNuevo] = useState<string | null>(null);
  const [recargando, setRecargando] = useState(false);
  const pospuestoHasta = useRef(0);
  const comprobando = useRef(false);

  const comprobar = useCallback(async (vuelveDeSegundoPlano: boolean) => {
    if (comprobando.current || !navigator.onLine) return;
    comprobando.current = true;
    try {
      const idRemoto = await pedirIdRemoto();
      if (!idRemoto || !hayVersionNueva(__BUILD_ID__, idRemoto)) return;

      const yaIntentado = leerSesion(CLAVE_RECARGA);
      if (vuelveDeSegundoPlano && puedeRecargarSola(idRemoto, yaIntentado) && !hayAlgoAbierto()) {
        setRecargando(true);
        await actualizarYRecargar(idRemoto);
        return;
      }
      if (Date.now() >= pospuestoHasta.current) setIdNuevo(idRemoto);
    } finally {
      comprobando.current = false;
    }
  }, []);

  useEffect(() => {
    if (!import.meta.env.PROD) return;

    // Si arrancamos ya con la versión a la que se recargó, limpiar el antibucle.
    if (leerSesion(CLAVE_RECARGA) === __BUILD_ID__) escribirSesion(CLAVE_RECARGA, null);

    const alCambiarVisibilidad = () => {
      if (document.visibilityState === "visible") void comprobar(true);
    };
    const alEnfocar = () => void comprobar(false);
    const alConectar = () => void comprobar(false);
    const intervalo = window.setInterval(() => void comprobar(false), CADA_CHEQUEO_MS);

    document.addEventListener("visibilitychange", alCambiarVisibilidad);
    window.addEventListener("focus", alEnfocar);
    window.addEventListener("online", alConectar);
    return () => {
      window.clearInterval(intervalo);
      document.removeEventListener("visibilitychange", alCambiarVisibilidad);
      window.removeEventListener("focus", alEnfocar);
      window.removeEventListener("online", alConectar);
    };
  }, [comprobar]);

  if (!import.meta.env.PROD) return null;

  const masTarde = () => {
    pospuestoHasta.current = Date.now() + POSPONER_MS;
    setIdNuevo(null);
  };

  const actualizarAhora = () => {
    if (!idNuevo) return;
    setRecargando(true);
    void actualizarYRecargar(idNuevo);
  };

  return (
    <AlertDialog open={idNuevo !== null} onOpenChange={(abierto) => !abierto && !recargando && masTarde()}>
      <AlertDialogContent {...{ [ATRIBUTO_PROPIO]: "" }}>
        <AlertDialogHeader>
          <AlertDialogTitle>Hay una versión nueva del panel</AlertDialogTitle>
          <AlertDialogDescription>
            Actualiza para usar los últimos cambios. Si estás a mitad de algo, termínalo y pulsa «Más tarde»: te lo
            volveremos a recordar en 10 minutos.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter className="gap-2">
          <Button variant="outline" size="lg" onClick={masTarde} disabled={recargando}>
            Más tarde
          </Button>
          <Button size="lg" className="h-12 text-base" onClick={actualizarAhora} disabled={recargando}>
            {recargando ? "Actualizando…" : "Actualizar ahora"}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
