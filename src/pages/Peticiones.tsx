import { useState } from "react";
import { useLocation, useSearchParams } from "react-router-dom";
import { ListChecks, MessageSquarePlus } from "lucide-react";
import { DashboardLayout } from "@/components/DashboardLayout";
import { Tabs, TabsContent } from "@/components/ui/tabs";
import { PestanasPagina } from "@/components/panel/PestanasPagina";
import { FormularioPeticion } from "@/components/peticiones/FormularioPeticion";
import { MisPeticiones } from "@/components/peticiones/MisPeticiones";
import { useMisPeticiones } from "@/hooks/usePeticiones";
import { ESTADOS_ABIERTOS } from "../../supabase/functions/_shared/peticiones";

type Pestana = "nueva" | "mias";

/** Página desde la que se abrió (el menú la pasa en `state.desde`), para proponer el módulo. */
function rutaDeOrigen(state: unknown): string | null {
  const desde = (state as { desde?: unknown } | null)?.desde;
  return typeof desde === "string" && desde.startsWith("/") && !desde.startsWith("/peticiones") ? desde : null;
}

/**
 * «Nueva petición» (13/11/2026, petición del dueño): cualquier usuario del panel reporta un error, pide una
 * mejora o pregunta una duda, y sigue cómo va en «Mis peticiones». El super admin las ve en Super Admin ›
 * Tickets, con el análisis de la IA. (Se llama «Peticiones» porque «Solicitudes» son las de reserva.)
 */
export default function Peticiones() {
  const location = useLocation();
  const [params, setParams] = useSearchParams();
  const pestana: Pestana = params.get("tab") === "mias" ? "mias" : "nueva";
  const cambiar = (v: string) => setParams((p) => {
    const n = new URLSearchParams(p);
    if (v === "mias") n.set("tab", "mias");
    else n.delete("tab");
    return n;
  }, { replace: true, state: location.state });
  // La ruta de origen se fija al entrar (al cambiar de pestaña no se pierde).
  const [ruta] = useState(() => rutaDeOrigen(location.state));
  const mias = useMisPeticiones();
  const abiertas = mias.data?.filter((p) => ESTADOS_ABIERTOS.includes(p.estado)).length ?? 0;

  return (
    <DashboardLayout>
      <div className="mx-auto flex w-full max-w-2xl flex-col gap-4 pb-8">
        <header className="space-y-1">
          <h1 className="text-xl font-semibold">Peticiones</h1>
          <p className="text-sm text-muted-foreground">
            ¿Algo no funciona, te falta algo o tienes una duda? Cuéntalo aquí y lo revisamos.
          </p>
        </header>
        <Tabs value={pestana} onValueChange={cambiar} className="flex flex-col gap-4">
          <PestanasPagina
            pestanas={[
              { valor: "nueva", etiqueta: "Nueva petición", etiquetaCorta: "Nueva", icono: <MessageSquarePlus /> },
              { valor: "mias", etiqueta: "Mis peticiones", icono: <ListChecks />, contador: abiertas, etiquetaContador: `${abiertas} abiertas` },
            ]}
          />
          <TabsContent value="nueva" className="mt-0">
            <FormularioPeticion ruta={ruta} onEnviada={() => cambiar("mias")} />
          </TabsContent>
          <TabsContent value="mias" className="mt-0">
            <MisPeticiones
              peticiones={mias.data}
              cargando={mias.isLoading}
              error={mias.error}
              onReintentar={() => void mias.refetch()}
              onNueva={() => cambiar("nueva")}
            />
          </TabsContent>
        </Tabs>
      </div>
    </DashboardLayout>
  );
}
