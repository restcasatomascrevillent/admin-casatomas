import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { BellRing, Volume2, VolumeX } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { useCanAccessSection } from "@/hooks/useUserRole";
import { useAvisosEnVivo, useEstadoAvisosEnVivo } from "@/hooks/useAvisosEnVivo";
import { tituloConCifra, type AlertaNueva } from "@/lib/avisosEnVivo/detectar";
import { avisosEnVivo } from "@/lib/avisosEnVivo/preferencias";
import { FILTRO_POR_ATENDER } from "@/lib/reservas/vistaUnificada";
import {
  notificarSistema,
  pedirPermisoNotificaciones,
  permisoNotificaciones,
  prepararDesbloqueoAudio,
  sonarAviso,
  type EstadoPermisoSistema,
} from "@/lib/avisosEnVivo/sonidoYSistema";

// ============================================================================
// AVISOS EN VIVO (10/11/2026, pedido del dueño: «hay que mejorar la
// notificación, que se vea más»). Montado UNA vez en `MarcoPanel`. Cuando entra
// algo que gestionar: aviso grande arriba (no se cierra solo), sonido corto
// (silenciable), cifra en el título de la pestaña y, si se activó, notificación
// del sistema. La detección es pura: lib/avisosEnVivo/detectar.ts.
// ============================================================================

/** Más de esto a la vez (p. ej. al volver la red) = un solo aviso resumen. */
const MAXIMO_AVISOS_SUELTOS = 3;

const CLASES_TOAST = {
  toast: "!w-[min(26rem,calc(100vw-2rem))] !gap-3 !border-2 !border-red-600 !p-4 !shadow-2xl",
  title: "!text-base !font-bold sm:!text-lg",
  description: "!text-sm !text-foreground sm:!text-base",
  actionButton: "!h-10 !min-w-16 !rounded-md !bg-red-600 !px-4 !text-sm !font-semibold !text-white",
  closeButton: "!h-6 !w-6",
};

export function AvisosEnVivo() {
  const { canAccess: veReservas } = useCanAccessSection("reservas");
  const navigate = useNavigate();
  const { sinVer } = useEstadoAvisosEnVivo();

  useEffect(() => prepararDesbloqueoAudio(), []);

  const alAvisar = useCallback(
    (nuevas: AlertaNueva[]) => {
      avisosEnVivo.sumarSinVer(nuevas.length);
      sonarAviso(avisosEnVivo.leer().sonido);
      const ir = (ruta: string) => {
        avisosEnVivo.marcarVistos();
        navigate(ruta);
      };
      const opciones = (ruta: string) => ({
        duration: Infinity,
        position: "top-center" as const,
        closeButton: true,
        classNames: CLASES_TOAST,
        icon: <BellRing className="h-5 w-5 text-red-600" aria-hidden="true" />,
        action: { label: "Ver", onClick: () => ir(ruta) },
      });
      if (nuevas.length > MAXIMO_AVISOS_SUELTOS) {
        const ruta = `/reservas?tab=reservas&status=${FILTRO_POR_ATENDER}`;
        toast(`${nuevas.length} avisos nuevos`, {
          ...opciones(ruta),
          id: `avisos-en-vivo-resumen`,
          description: nuevas.slice(0, 3).map((a) => a.texto).join(" | "),
        });
        notificarSistema(`${nuevas.length} avisos nuevos en Casa Tomás`, nuevas[0].texto, () => ir(ruta));
        return;
      }
      for (const alerta of nuevas) {
        toast(alerta.titulo, { ...opciones(alerta.ruta), id: `aviso-${alerta.clave}`, description: alerta.texto });
        notificarSistema(alerta.titulo, alerta.texto, () => ir(alerta.ruta));
      }
    },
    [navigate],
  );

  const { cuantasPorGestionar } = useAvisosEnVivo(veReservas, alAvisar);

  // Título de la pestaña: «(3) Casa Tomás…». Las páginas pueden cambiar el título: se vigila
  // el <title> y se vuelve a poner la cifra (sin bucle: solo se escribe si cambia).
  const cifra = Math.max(cuantasPorGestionar, sinVer);
  useEffect(() => {
    if (typeof document === "undefined") return;
    const aplicar = () => {
      const deseado = tituloConCifra(document.title, cifra);
      if (document.title !== deseado) document.title = deseado;
    };
    aplicar();
    const titulo = document.querySelector("title");
    if (!titulo || typeof MutationObserver === "undefined") {
      return () => {
        document.title = tituloConCifra(document.title, 0);
      };
    }
    const observador = new MutationObserver(aplicar);
    observador.observe(titulo, { childList: true, characterData: true, subtree: true });
    return () => {
      observador.disconnect();
      document.title = tituloConCifra(document.title, 0);
    };
  }, [cifra]);

  return null;
}

/** Interruptor de sonido y botón «Activar avisos en este ordenador» (campana y modal de Avisos). */
export function AjustesAvisosEnVivo({ className }: { className?: string }) {
  const { sonido } = useEstadoAvisosEnVivo();
  const [permiso, setPermiso] = useState<EstadoPermisoSistema>(() => permisoNotificaciones());

  return (
    <div className={className} data-testid="ajustes-avisos-en-vivo">
      <label className="flex min-h-9 cursor-pointer items-center justify-between gap-3 text-sm">
        <span className="flex items-center gap-2">
          {sonido ? <Volume2 className="h-4 w-4" aria-hidden="true" /> : <VolumeX className="h-4 w-4" aria-hidden="true" />}
          Sonido al llegar algo nuevo
        </span>
        <Switch
          checked={sonido}
          onCheckedChange={(activo) => {
            avisosEnVivo.ponerSonido(activo);
            if (activo) sonarAviso(true);
          }}
          aria-label="Sonido al llegar algo nuevo"
        />
      </label>
      {permiso === "default" && (
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="mt-2 h-9 w-full gap-2"
          onClick={async () => setPermiso(await pedirPermisoNotificaciones())}
        >
          <BellRing className="h-4 w-4" aria-hidden="true" />
          Activar avisos en este ordenador
        </Button>
      )}
      {permiso === "granted" && <p className="mt-1 text-xs text-muted-foreground">Avisos del sistema activados en este ordenador.</p>}
      {permiso === "denied" && (
        <p className="mt-1 text-xs text-muted-foreground">El navegador tiene bloqueados los avisos: se activan desde el candado de la barra de direcciones.</p>
      )}
    </div>
  );
}
