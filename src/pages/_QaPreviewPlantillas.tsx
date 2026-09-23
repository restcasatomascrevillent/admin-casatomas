// ============================================================================
// _QaPreviewPlantillas — ARNÉS TEMPORAL SOLO PARA QA VISUAL EN NAVEGADOR.
// No hay forma de autenticarse con una sesión real en este entorno de
// verificación, así que esta pantalla siembra react-query a mano con filas
// mock y monta PlantillaTipoEditor (el componente real, sin modificar) fuera
// de ProtectedRoute. Exclusivamente para comprobar visualmente el fix de la
// vista previa y la reorganización del layout. SE BORRA antes de terminar
// la tarea — no forma parte de la entrega.
// ============================================================================
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { PlantillaTipoEditor } from "@/components/emails/PlantillaTipoEditor";
import type { PlantillaEmailVersion, TipoPlantilla } from "@/hooks/usePlantillasEmail";

function filaMock(tipo: TipoPlantilla, overrides: Partial<PlantillaEmailVersion> = {}): PlantillaEmailVersion {
  return {
    id: `mock-${tipo}`,
    tipo,
    version: 3,
    es_actual: true,
    asunto: "Hemos recibido tu solicitud - Casa Tomás",
    saludo: "Hola {{nombre}},",
    cuerpo:
      "Hemos recibido tu solicitud de reserva para el {{fecha}} a las {{hora}} ({{comensales}}) y la estamos revisando.\n\nTe confirmaremos en breve por este mismo correo. Si tienes cualquier duda, puedes responder aquí mismo.",
    texto_boton_principal: "Ver mi solicitud",
    texto_boton_secundario: "Cancelar solicitud",
    pie: "¿Necesitas ayuda? Escríbenos o llama al 966 10 78 87.",
    color_acento: "#B8936A",
    color_oscuro: "#1C1F22",
    logo_url: null,
    bloques: {},
    nota_version: null,
    creado_por: null,
    creado_at: new Date().toISOString(),
    ...overrides,
  };
}

const TIPOS_QA: TipoPlantilla[] = ["solicitud_recibida", "propuesta"];

export default function QaPreviewPlantillas() {
  const queryClient = useQueryClient();
  const [tipo, setTipo] = useState<TipoPlantilla>("solicitud_recibida");

  // Se siembra SÍNCRONAMENTE durante el render (no en un useEffect): los
  // efectos de PlantillaTipoEditor (hijo) se disparan antes que los de este
  // padre, así que un useEffect aquí llega tarde y useVersionesPlantilla ya
  // ha lanzado la consulta real contra Supabase (que falla sin sesión).
  if (!queryClient.getQueryData(["plantillas-email", "solicitud_recibida"])) {
    queryClient.setQueryData(["plantillas-email", "solicitud_recibida"], [filaMock("solicitud_recibida")]);
    queryClient.setQueryData(
      ["plantillas-email", "propuesta"],
      [
        filaMock("propuesta", {
          asunto: "Tenemos una propuesta para tu reserva - Casa Tomás",
          cuerpo:
            "No teníamos disponibilidad exacta para tu solicitud, así que te proponemos una alternativa muy cercana.\n\nDinos si te viene bien respondiendo a este correo.",
        }),
      ],
    );
  }

  return (
    <div className="flex min-h-screen w-full bg-background">
      <div className="hidden shrink-0 border-r bg-muted/20 md:block" style={{ width: 256 }} />
      <div className="flex-1 overflow-x-hidden">
        {/* Imita la cabecera sticky real de DashboardLayout (h-14 sm:h-16, sticky top-0, z-50)
            para poder comprobar aquí si el "sticky top-20" de la vista previa queda tapado. */}
        <header className="sticky top-0 z-50 flex h-14 w-full items-center border-b border-border bg-card px-3 sm:h-16 sm:px-6">
          <p className="text-xs font-semibold uppercase tracking-wide text-destructive">
            Arnés QA temporal — no es parte de la app (imita la cabecera real)
          </p>
        </header>
        <main className="p-3 sm:p-6">
          <div className="mb-4 flex gap-2">
            {TIPOS_QA.map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setTipo(t)}
                className={`rounded-md border px-3 py-1 text-sm ${tipo === t ? "bg-primary text-primary-foreground" : "bg-background"}`}
              >
                {t}
              </button>
            ))}
          </div>
          <PlantillaTipoEditor tipo={tipo} puedeEditar emailUsuario="qa@local.test" />
        </main>
      </div>
    </div>
  );
}
