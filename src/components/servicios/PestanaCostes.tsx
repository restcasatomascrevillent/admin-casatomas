import type { ReactNode } from "react";
import { Wallet } from "lucide-react";
import { CostesIa } from "@/components/costes/CostesIa";
import type { ResumenCostes } from "@/lib/servicios";
import { Bloque } from "./Bloque";
import { DesgloseCostes } from "./DesgloseCostes";

interface Props {
  /** null mientras cargan los servicios (o si no se pueden cargar): entonces va `estadoServicios`. */
  resumen: ResumenCostes | null;
  estadoServicios?: ReactNode;
  eurPorUsd: number;
  costesDisponibles: boolean;
}

/**
 * Super Admin › Servicios › Costes (la antigua pantalla «Costes», dentro de
 * Servicios): de qué proveedor sale el gasto del mes (cuota y uso, con el
 * total) y, debajo, la IA en detalle: por proceso, frente al tope y con el mes
 * anterior. Las cifras de cabecera (mes y año) están en el Resumen.
 */
export function PestanaCostes({ resumen, estadoServicios, eurPorUsd, costesDisponibles }: Props) {
  return (
    <div className="flex min-w-0 flex-col gap-4 pb-2">
      <Bloque
        id="costes-proveedores"
        icono={<Wallet />}
        titulo="Coste de este mes por proveedor"
        descripcion="La cuota de cada plan y lo gastado por uso hasta hoy, en euros."
      >
        {resumen ? <DesgloseCostes resumen={resumen} eurPorUsd={eurPorUsd} costesDisponibles={costesDisponibles} /> : estadoServicios}
      </Bloque>
      <CostesIa previsionTotalEur={resumen?.previsionMesEur ?? null} />
    </div>
  );
}
