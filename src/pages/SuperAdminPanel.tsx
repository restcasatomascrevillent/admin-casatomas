import { useState } from "react";
import { SuperAdminLayout } from "@/components/SuperAdminLayout";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Loader2 } from "lucide-react";
import { useAdminFeatureToggles } from "@/hooks/useAdminFeatureToggles";
import { useAlturaDisponible } from "@/hooks/useAlturaDisponible";

/**
 * Suelo (px) del alto de la página: por debajo (ventanas muy bajas, teclado
 * abierto en el móvil) deja de encoger y vuelve el scroll de página.
 */
const ALTURA_MINIMA_CONTROL = 360;

export default function SuperAdminPanel() {
  const { toggles, loading, isEnabled, setEnabled } = useAdminFeatureToggles();
  // Alto de la pantalla (regla del dueño, 2026-10-07): el bloque mide justo lo
  // que queda bajo la cabecera del layout y es él quien hace scroll, no la
  // página. Sin medida (jsdom, primer pintado) cae al layout de siempre.
  const [raiz, setRaiz] = useState<HTMLDivElement | null>(null);
  const alto = useAlturaDisponible(raiz, ALTURA_MINIMA_CONTROL);

  return (
    <SuperAdminLayout>
      <div
        ref={setRaiz}
        className="flex flex-col overflow-y-auto overscroll-contain"
        style={alto ? { height: alto } : undefined}
      >
        {/* 2026-10-10: la tarjeta «Funcionalidades exclusivas de Super Admin» (9 enlaces) se quitó: repetía el menú
            lateral, que ya lleva a todas esas páginas. */}
        <section aria-labelledby="titulo-funcionalidades">
          <h2 id="titulo-funcionalidades" className="text-base font-semibold leading-tight">
            Funcionalidades del Admin Panel
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Al desactivar una funcionalidad, desaparece de la barra lateral para todos los usuarios
            (administradores, managers y staff) hasta que la vuelvas a activar.
          </p>
          {loading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <ul className="mt-2 divide-y divide-border/60">
              {toggles.map((toggle) => (
                <li key={toggle.section_key} className="flex min-h-14 items-center justify-between gap-3 py-1">
                  <Label htmlFor={`toggle-${toggle.section_key}`} className="flex-1 cursor-pointer py-3 text-sm font-medium">
                    {toggle.label}
                  </Label>
                  <Switch
                    id={`toggle-${toggle.section_key}`}
                    checked={isEnabled(toggle.section_key)}
                    onCheckedChange={(checked) => setEnabled(toggle.section_key, toggle.label, checked)}
                  />
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </SuperAdminLayout>
  );
}
