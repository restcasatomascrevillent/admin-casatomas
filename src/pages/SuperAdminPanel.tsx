import { SuperAdminLayout } from "@/components/SuperAdminLayout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Loader2, ShoppingCart, Wallet, Star, Phone, Mail, Activity, MapPin, Bot } from "lucide-react";
import { useAdminFeatureToggles } from "@/hooks/useAdminFeatureToggles";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";

const MOVED_FEATURES = [
  { title: "Ecommerce", url: "/super-admin/ecommerce", icon: ShoppingCart },
  { title: "Asistente Tel.", url: "/super-admin/asistente-telefonico", icon: Phone },
  { title: "Gestor Gasto", url: "/super-admin/gestor-gasto", icon: Wallet },
  { title: "Reseñas Google", url: "/super-admin/resenas", icon: Star },
  { title: "Plantillas Email", url: "/super-admin/plantillas-email", icon: Mail },
  { title: "Tráfico web", url: "/super-admin/trafico-web", icon: Activity },
  { title: "Espacios", url: "/super-admin/espacios", icon: MapPin },
  { title: "Bot Web", url: "/super-admin/bot-web", icon: Bot },
];

export default function SuperAdminPanel() {
  const { toggles, loading, isEnabled, setEnabled } = useAdminFeatureToggles();

  return (
    <SuperAdminLayout>
      <div className="space-y-6">
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
                    className="flex items-center justify-between py-3 first:pt-0 last:pb-0"
                  >
                    <Label htmlFor={`toggle-${toggle.section_key}`} className="text-sm font-medium">
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
                  className="justify-start h-auto py-3"
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
