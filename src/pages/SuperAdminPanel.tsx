import { useState } from "react";
import { SuperAdminLayout } from "@/components/SuperAdminLayout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Loader2, ShoppingCart, Wallet, Coins, Star, Phone, Mail, Activity, MapPin, Bot } from "lucide-react";
import { useAdminFeatureToggles } from "@/hooks/useAdminFeatureToggles";
import { useAlturaDisponible } from "@/hooks/useAlturaDisponible";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";

/**
 * Suelo (px) del alto de la página: por debajo (ventanas muy bajas, teclado
 * abierto en el móvil) deja de encoger y vuelve el scroll de página.
 */
const ALTURA_MINIMA_CONTROL = 360;

const MOVED_FEATURES = [
  { title: "Ecommerce", url: "/super-admin/ecommerce", icon: ShoppingCart },
  { title: "Asistente Tel.", url: "/super-admin/asistente-telefonico", icon: Phone },
  { title: "Gestor Gasto", url: "/super-admin/gestor-gasto", icon: Wallet },
  { title: "Costes", url: "/super-admin/costes", icon: Coins },
  { title: "Reseñas Google", url: "/super-admin/resenas", icon: Star },
  { title: "Plantillas Email", url: "/super-admin/plantillas-email", icon: Mail },
  { title: "Tráfico web", url: "/super-admin/trafico-web", icon: Activity },
  { title: "Espacios", url: "/super-admin/espacios", icon: MapPin },
  { title: "Bot Web", url: "/super-admin/bot-web", icon: Bot },
];

export default function SuperAdminPanel() {
  const { toggles, loading, isEnabled, setEnabled } = useAdminFeatureToggles();
  // Alto de la pantalla (regla del dueño, 2026-10-07): el bloque mide justo lo
  // que queda bajo la cabecera del layout y es él (con las dos tarjetas) el que
  // hace scroll, no la página. Sin medida (jsdom, primer pintado) cae al layout
  // de siempre.
  const [raiz, setRaiz] = useState<HTMLDivElement | null>(null);
  const alto = useAlturaDisponible(raiz, ALTURA_MINIMA_CONTROL);

  return (
    <SuperAdminLayout>
      <div
        ref={setRaiz}
        className="space-y-6 overflow-y-auto overscroll-contain"
        style={alto ? { height: alto } : undefined}
      >
        {/* Sin título de página (2026-09-25): la pestaña "Control del Panel"
            activa en el menú lateral ya dice dónde estás, y el subtítulo
            repetía lo que ya explica la CardDescription de justo abajo. */}

        <Card>
          <CardHeader>
            <CardTitle>Funcionalidades del Admin Panel</CardTitle>
            <CardDescription>
              Al desactivar una funcionalidad, desaparece de la barra lateral para todos los usuarios
              (administradores, managers y staff) hasta que la vuelvas a activar.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {loading ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
              </div>
            ) : (
              <div className="divide-y divide-border">
                {toggles.map((toggle) => (
                  <div
                    key={toggle.section_key}
                    className="flex min-h-14 items-center justify-between gap-3 py-1 first:pt-0 last:pb-0"
                  >
                    <Label htmlFor={`toggle-${toggle.section_key}`} className="flex-1 cursor-pointer py-3 text-sm font-medium">
                      {toggle.label}
                    </Label>
                    <Switch
                      id={`toggle-${toggle.section_key}`}
                      checked={isEnabled(toggle.section_key)}
                      onCheckedChange={(checked) =>
                        setEnabled(toggle.section_key, toggle.label, checked)
                      }
                    />
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Funcionalidades exclusivas de Super Admin</CardTitle>
            <CardDescription>
              Estas secciones ya no están disponibles en el Admin Panel normal. Solo son accesibles
              desde aquí.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {MOVED_FEATURES.map((feature) => (
                <Button
                  key={feature.url}
                  variant="outline"
                  className="h-auto min-h-11 justify-start py-3"
                  asChild
                >
                  <Link to={feature.url}>
                    <feature.icon className="h-4 w-4 mr-2" />
                    {feature.title}
                  </Link>
                </Button>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>
    </SuperAdminLayout>
  );
}
