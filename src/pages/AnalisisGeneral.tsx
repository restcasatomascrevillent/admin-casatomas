// «Análisis general» (07/11/2026, petición del dueño): sección propia del menú,
// fuera de Facturas. Primera pantalla: «Márgenes de carta» (precios de la carta
// frente a lo que cuesta comprar sus ingredientes). Usa los permisos de Facturas
// (ver: ver la sección; editar: corregir escandallos, vinos y umbrales): el
// sistema de secciones no tiene una 'analisis' propia y añadirla obligaría a
// tocar la tabla de permisos, el Super Admin y los usuarios.
//
// Sin scroll de página (regla del dueño, tablet): el bloque mide el alto
// disponible (useAlturaDisponible) y solo las listas hacen scroll por dentro.
import { useState } from "react";
import { Percent } from "lucide-react";
import { DashboardLayout } from "@/components/DashboardLayout";
import { Tabs, TabsContent } from "@/components/ui/tabs";
import { PestanasPagina } from "@/components/panel/PestanasPagina";
import { EtiquetaSoloLectura } from "@/components/panel/EtiquetaSoloLectura";
import { MargenesCarta } from "@/components/analisis/margenes/MargenesCarta";
import { useAlturaDisponible } from "@/hooks/useAlturaDisponible";
import { useCanAccessSection } from "@/hooks/useUserRole";

const ALTURA_MINIMA = 520;

const AnalisisGeneral = () => {
  const [raiz, setRaiz] = useState<HTMLDivElement | null>(null);
  const alto = useAlturaDisponible(raiz, ALTURA_MINIMA);
  const editar = useCanAccessSection("facturas", "edit");
  const [pestana, setPestana] = useState("margenes");

  return (
    <DashboardLayout>
      <div
        ref={setRaiz}
        className={`flex flex-col ${alto ? "" : "h-[calc(100vh-6rem)] supports-[height:100dvh]:h-[calc(100dvh-6rem)]"}`}
        style={alto ? { height: alto } : undefined}
      >
        <Tabs value={pestana} onValueChange={setPestana} className="flex min-h-0 flex-1 flex-col gap-2 sm:gap-3">
          <PestanasPagina
            pestanas={[{ valor: "margenes", etiqueta: "Márgenes de carta", icono: <Percent /> }]}
            acciones={!editar.loading && !editar.canAccess ? <EtiquetaSoloLectura className="ml-auto" /> : undefined}
          />
          <TabsContent value="margenes" className="m-0 min-h-0 flex-1 outline-none data-[state=inactive]:hidden">
            <MargenesCarta puedeEditar={editar.canAccess} />
          </TabsContent>
        </Tabs>
      </div>
    </DashboardLayout>
  );
};

export default AnalisisGeneral;
