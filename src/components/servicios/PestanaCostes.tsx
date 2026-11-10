import type { ReactNode } from "react";
import { Wallet } from "lucide-react";
import { CostesIa } from "@/components/costes/CostesIa";
import type { CosteFaltante } from "@/lib/informeServicios";
import type { ResumenCostes, ServicioContratado } from "@/lib/servicios";
import { Bloque } from "./Bloque";
import { CostesFaltantes } from "./CostesFaltantes";
import { DesgloseCostes } from "./DesgloseCostes";
import { InformeMensual } from "./InformeMensual";

interface Props {
  /** null mientras cargan los servicios (o si no se pueden cargar): entonces va `estadoServicios`. */
  resumen: ResumenCostes | null;
  estadoServicios?: ReactNode;
  eurPorUsd: number;
  costesDisponibles: boolean;
  /** Servicios en uso (para el informe mensual). */
  enUso: ServicioContratado[];
  faltantes: CosteFaltante[];
  cargandoFaltantes: boolean;
  /** false si falta 20261122153000 (sin costes por mes ni informe). */
  costesMesDisponible: boolean;
  onPonerPrecio: (proveedor: string) => void;
  onMeterCoste: (proveedor: string, mes: string) => void;
}

/**
 * Super Admin › Servicios › Costes (la antigua pantalla «Costes», dentro de
 * Servicios): arriba, lo que falta por meter (10/11/2026); luego de qué
 * proveedor sale el gasto del mes (cuota y uso, con el total), el informe
 * mensual descargable y, debajo, la IA en detalle: por proceso, frente al tope
 * y con el mes anterior. Las cifras de cabecera (mes y año) están en Estado.
 */
export function PestanaCostes({
  resumen, estadoServicios, eurPorUsd, costesDisponibles, enUso, faltantes, cargandoFaltantes, costesMesDisponible, onPonerPrecio, onMeterCoste,
}: Props) {
  return (
    <div className="flex min-w-0 flex-col gap-4 pb-2">
      {resumen && costesDisponibles && (
        <CostesFaltantes
          faltantes={faltantes}
          cargando={cargandoFaltantes}
          disponible={costesMesDisponible}
          onPonerPrecio={onPonerPrecio}
          onMeterCoste={onMeterCoste}
        />
      )}
      <Bloque
        id="costes-proveedores"
        icono={<Wallet />}
        titulo="Coste de este mes por proveedor"
        descripcion="La cuota de cada plan y lo gastado por uso hasta hoy, en euros."
      >
        {resumen ? <DesgloseCostes resumen={resumen} eurPorUsd={eurPorUsd} costesDisponibles={costesDisponibles} /> : estadoServicios}
      </Bloque>
      {resumen && costesDisponibles && <InformeMensual servicios={enUso} eurPorUsd={eurPorUsd} onMeterCoste={onMeterCoste} />}
      <CostesIa previsionTotalEur={resumen?.previsionMesEur ?? null} />
    </div>
  );
}
