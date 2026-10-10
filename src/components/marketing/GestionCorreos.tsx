import { useMemo } from "react";
import { useNewsletterSuscriptores } from "@/hooks/useNewsletterSuscriptores";
import { TiraCifras } from "@/components/panel/TiraCifras";
import { ListaSuscriptores } from "./ListaSuscriptores";
import { SincronizacionResend } from "./SincronizacionResend";
import { contarEmailsActivos } from "@/lib/newsletter/resend";

export function GestionCorreos() {
  // Activos y bajas en una sola consulta (se refresca sola cada minuto). Las
  // bajas las escriben newsletter-baja y resend-webhook con fecha_baja y
  // origen_baja; el personal no da de baja ni reactiva a nadie.
  const { suscriptores, totalSuscriptores, bajas, totalBajas, isLoading, error } = useNewsletterSuscriptores();
  // Para que la lista de envío se actualice sola si no cuadra (SincronizacionResend).
  const activosDistintos = useMemo(() => contarEmailsActivos(suscriptores), [suscriptores]);
  const activosParaLista = isLoading ? undefined : error ? null : activosDistintos;

  return (
    // Llena el alto que le da Marketing.tsx (mide el alto de la pantalla y la pestaña hace scroll por dentro).
    // Una sola columna sin tarjetas: la tira de cifras y la línea «Lista de envío» van con su alto natural y la
    // lista de suscriptores toma el que sobra, con el scroll DENTRO de la lista y no en la página. El suelo
    // (`min-h-[16rem]`) evita que la lista se aplaste en ventanas muy bajas: ahí la pestaña hace scroll.
    <div className="flex h-full flex-col gap-3">
      <TiraCifras
        data-testid="cifras-suscriptores"
        className="shrink-0"
        cifras={[
          { etiqueta: "Suscriptores activos", valor: isLoading ? "—" : totalSuscriptores, detalle: "reciben la newsletter" },
          { etiqueta: "Dados de baja", valor: isLoading ? "—" : totalBajas, detalle: "no reciben nada" },
        ]}
      />

      <div data-testid="tarjeta-lista-suscriptores" className="flex min-h-[16rem] flex-1 flex-col">
        <ListaSuscriptores activos={suscriptores} bajas={bajas} isLoading={isLoading} />
      </div>

      {/* Fase 2: lista de envío (conexión con Resend Marketing, newsletter-sync-resend), en una línea. */}
      <SincronizacionResend activos={activosParaLista} compacta />
    </div>
  );
}
