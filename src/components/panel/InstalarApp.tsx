import { useState, useSyncExternalStore } from "react";
import { Download, Share, X } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { lanzarInstalacion, modoInstalacion, suscribirInstalacion, type ModoInstalacion } from "@/lib/instalarApp";

export const TEXTO_AYUDA_IOS = "Pulsa Compartir y luego «Añadir a pantalla de inicio».";
const CLAVE_AVISO = "ct.instalar-app.aviso-descartado";

/** Modo actual (se actualiza al llegar `beforeinstallprompt` o al instalarse). */
export function useModoInstalacion(): ModoInstalacion {
  return useSyncExternalStore(suscribirInstalacion, modoInstalacion, () => "no-disponible" as ModoInstalacion);
}

/**
 * Botón «Instalar app» del menú lateral (abajo, con «Cerrar sesión»). Android/Chrome: abre el
 * diálogo del navegador. iPhone/iPad: un globo con el gesto de Safari. Instalada o sin forma de
 * instalar (escritorio sin el evento): no pinta nada.
 */
export function InstalarApp({ colapsado = false, className }: { colapsado?: boolean; className?: string }) {
  const modo = useModoInstalacion();
  if (modo === "instalada" || modo === "no-disponible") return null;

  const clases = cn(
    "flex w-full items-center gap-3 rounded-lg px-2 py-2 text-left text-sm text-sidebar-foreground hover:bg-sidebar-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring",
    colapsado && "justify-center px-0",
    className,
  );
  const contenido = (
    <>
      <Download className="h-4 w-4 shrink-0" aria-hidden="true" />
      {!colapsado && <span className="truncate">Instalar app</span>}
    </>
  );

  if (modo === "android") {
    return (
      <button type="button" className={clases} aria-label="Instalar app" title="Instalar app" onClick={() => void lanzarInstalacion()}>
        {contenido}
      </button>
    );
  }

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button type="button" className={clases} aria-label="Instalar app" title="Instalar app">
          {contenido}
        </button>
      </PopoverTrigger>
      <PopoverContent side="top" className="w-64 text-sm">
        <p className="flex items-start gap-2">
          <Share className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <span>{TEXTO_AYUDA_IOS}</span>
        </p>
      </PopoverContent>
    </Popover>
  );
}

function avisoDescartado(): boolean {
  try {
    return localStorage.getItem(CLAVE_AVISO) === "1";
  } catch {
    return false;
  }
}

function esPantallaMovil(): boolean {
  try {
    return window.matchMedia?.("(max-width: 1023px)").matches ?? false;
  } catch {
    return false;
  }
}

/**
 * Aviso de la primera vez en el móvil: tarjeta pequeña flotante (posición fija, no ocupa alto de la
 * página: regla «sin scroll vertical»), con «Instalar» o el gesto de iPhone, y una ✕ que lo
 * descarta para siempre en este dispositivo (localStorage; si no se puede guardar, vale para la sesión).
 */
export function AvisoInstalarApp() {
  const modo = useModoInstalacion();
  const [descartado, setDescartado] = useState(() => avisoDescartado() || !esPantallaMovil());
  if (descartado || modo === "instalada" || modo === "no-disponible") return null;

  const descartar = () => {
    setDescartado(true);
    try {
      localStorage.setItem(CLAVE_AVISO, "1");
    } catch {
      /* sin almacenamiento: solo esta sesión */
    }
  };

  return (
    <div
      role="status"
      data-testid="aviso-instalar-app"
      className="fixed inset-x-3 bottom-[max(0.75rem,env(safe-area-inset-bottom))] z-50 mx-auto flex max-w-sm items-center gap-2 rounded-lg border border-border bg-card p-2 pl-3 text-sm text-card-foreground shadow-lg"
    >
      <Download className="h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
      <span className="min-w-0 flex-1">
        {modo === "android" ? "Instala el panel en el móvil para abrirlo más rápido." : TEXTO_AYUDA_IOS}
      </span>
      {modo === "android" && (
        <Button
          size="sm"
          className="h-8 shrink-0"
          onClick={() => {
            void lanzarInstalacion();
            descartar();
          }}
        >
          Instalar
        </Button>
      )}
      <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0" aria-label="Cerrar aviso de instalar" onClick={descartar}>
        <X className="h-4 w-4" aria-hidden="true" />
      </Button>
    </div>
  );
}
