import { useId } from "react";
import { Link } from "react-router-dom";
import { ArrowRight } from "lucide-react";
import { toast } from "sonner";
import { Card, CardContent } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { EtiquetaSoloLectura } from "@/components/panel/EtiquetaSoloLectura";
import { useCanAccessSection } from "@/hooks/useUserRole";
import { useCambiarTiendaVisible, useConfiguracionTienda } from "@/hooks/useTienda";
import { mensajeUsuario } from "@/lib/mensaje-usuario";

/**
 * Gestor Web › Tienda (10/11/2026, petición del dueño): enciende o apaga la
 * sección «Tienda» de la web de Casa Tomás. Es el mismo dato que «Tienda
 * visible en la web» de Tienda › Ajustes (`configuracion_tienda.activa`):
 * cambiarlo aquí lo cambia allí. Apagada, la web quita «Tienda» del menú, del
 * pie y de la tarjeta de cheques regalo, y `/tienda` dice que no está
 * disponible. Los vinos a la venta, el descuento y los textos no se tocan.
 *
 * Como el resto del panel: con el permiso «Ver» de Tienda pero sin «Editar»
 * no sale el interruptor (se oculta, no se desactiva) y se enseña el estado
 * con la etiqueta «Solo lectura». Sin explicación de qué hace (como los de
 * Menú del día y Tapas, petición del dueño del 18/10/2026: se entiende solo).
 */
export function InterruptorTiendaWeb() {
  const id = useId();
  const configuracion = useConfiguracionTienda();
  const { canAccess: puedeEditar, loading: cargandoPermisos } = useCanAccessSection("tienda", "edit");
  const cambiar = useCambiarTiendaVisible();
  const config = configuracion.data?.disponible ? configuracion.data.config : null;

  const aviso = configuracion.isLoading
    ? "Cargando..."
    : configuracion.isError
      ? "No se pudo cargar la configuración de la tienda."
      : !config
        ? "Falta aplicar la actualización de la tienda en la base de datos."
        : null;

  const alternar = (activa: boolean) =>
    cambiar.mutate(activa, {
      onSuccess: (nueva) => toast.success(nueva.activa ? "Tienda visible en la web" : "Tienda oculta en la web"),
      onError: (err) => toast.error("No se pudo cambiar la tienda en la web", { description: mensajeUsuario(err) }),
    });

  return (
    <Card data-tour="gw-tienda-interruptor" className="max-w-3xl">
      <CardContent className="space-y-1 px-4 py-2.5">
        <div className="flex min-h-11 items-center justify-between gap-4">
          <Label htmlFor={cargandoPermisos || puedeEditar ? id : undefined} className={puedeEditar ? "cursor-pointer leading-snug" : "leading-snug"}>
            Mostrar «Tienda» en la web de Casa Tomás
          </Label>
          {cargandoPermisos || puedeEditar ? (
            <Switch
              id={id}
              checked={config?.activa ?? false}
              disabled={cargandoPermisos || !config || cambiar.isPending}
              onCheckedChange={alternar}
            />
          ) : (
            config && (
              <span className="shrink-0 text-sm font-medium">
                {config.activa ? "Visible" : "Oculta"}
              </span>
            )
          )}
        </div>
        {aviso && <p className="text-xs text-muted-foreground">{aviso}</p>}
        {!cargandoPermisos && !puedeEditar && config && (
          <EtiquetaSoloLectura detalle="Tienes permiso para ver la tienda, pero no para cambiarla. Si necesitas hacer cambios, pídeselo a un administrador." />
        )}
        {/* Lo demás de la tienda (qué vinos, el descuento y los textos) sigue en su sección. */}
        <div className="border-t pt-1.5">
          <Link
            to="/tienda"
            className="flex min-h-11 items-center justify-between gap-3 rounded-md text-sm text-muted-foreground hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            Vinos a la venta, descuento y textos de la tienda
            <ArrowRight className="h-4 w-4 shrink-0" aria-hidden="true" />
          </Link>
        </div>
      </CardContent>
    </Card>
  );
}
