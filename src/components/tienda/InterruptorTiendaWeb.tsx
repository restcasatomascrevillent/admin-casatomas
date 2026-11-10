import { useId } from "react";
import { toast } from "sonner";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useCambiarTiendaVisible } from "@/hooks/useTienda";
import { mensajeUsuario } from "@/lib/mensaje-usuario";
import { type ConfiguracionTienda, porcentaje } from "@/lib/tienda";
import { cn } from "@/lib/utils";

/** Verde con la tienda en la web, ámbar sin ella (los colores de la pastilla de estado de siempre). */
const TONO = {
  visible: "border-emerald-300 bg-emerald-50 text-emerald-900",
  oculta: "border-amber-300 bg-amber-50 text-amber-900",
} as const;

/**
 * Arriba a la derecha de Panel › Tienda, junto a las pestañas (se ve desde
 * Vinos y desde Ajustes). Petición del dueño del 10/11/2026: un botón para
 * encender o apagar la sección Tienda de la web.
 *
 * - Con «Puede editar»: interruptor «Visible en la web» que se guarda al
 *   momento (`useCambiarTiendaVisible`, solo la columna `activa`). Apagada,
 *   la web quita «Tienda» del menú, del pie y de la tarjeta de cheques regalo,
 *   y `/tienda` dice que no está disponible. No se borra nada.
 * - Con solo «Ver»: la pastilla de estado de siempre, sin interruptor (se
 *   oculta, no se desactiva: decisión del dueño del 06/11/2026).
 *
 * Sustituye al interruptor que había dentro del formulario de Ajustes: ese
 * pedía «Guardar ajustes» y, con dos para lo mismo, guardar el formulario
 * podía deshacer lo cambiado aquí.
 */
export function InterruptorTiendaWeb({ config, puedeEditar }: { config: ConfiguracionTienda; puedeEditar: boolean }) {
  const id = useId();
  const cambiar = useCambiarTiendaVisible();
  const tono = config.activa ? TONO.visible : TONO.oculta;

  if (!puedeEditar) {
    return (
      <span className={cn("whitespace-nowrap rounded-full border px-3 py-1 text-xs font-medium", tono)}>
        {config.activa ? `Visible · ${porcentaje(config.descuento_pct)}` : "Oculta en la web"}
      </span>
    );
  }

  const alternar = (activa: boolean) =>
    cambiar.mutate(activa, {
      onSuccess: (nueva) => toast.success(nueva.activa ? "Tienda visible en la web" : "Tienda oculta en la web"),
      onError: (err) => toast.error("No se pudo cambiar la tienda en la web", { description: mensajeUsuario(err) }),
    });

  return (
    <div className={cn("flex h-9 items-center gap-2 rounded-full border pl-3 pr-1.5 pointer-coarse:h-11", tono)}>
      <Label htmlFor={id} className="cursor-pointer whitespace-nowrap text-xs font-medium">
        Visible en la web
      </Label>
      {/* El descuento, como en la pastilla de antes; en el móvil no cabe junto a las pestañas. */}
      {config.activa && (
        <span className="hidden whitespace-nowrap text-xs tabular-nums sm:inline">· {porcentaje(config.descuento_pct)}</span>
      )}
      <Switch id={id} checked={config.activa} disabled={cambiar.isPending} onCheckedChange={alternar} />
    </div>
  );
}
