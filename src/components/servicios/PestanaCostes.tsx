import type { ReactNode } from "react";
import { Wallet } from "lucide-react";
import { CostesIa } from "@/components/costes/CostesIa";
import { GastoLecturaManuscrita } from "./GastoLecturaManuscrita";
import type { AvisoPlan, Inventario } from "@/lib/costesServicios";
import type { CosteFaltante } from "@/lib/informeServicios";
import type { ResumenCostes, ServicioContratado } from "@/lib/servicios";
import { AvisosPlanGratis } from "./AvisosPlanGratis";
import { Bloque } from "./Bloque";
import { CostesFaltantes } from "./CostesFaltantes";
import { DesgloseCostes } from "./DesgloseCostes";
import { IaPorFuncion } from "./IaPorFuncion";
import { InformeMensual } from "./InformeMensual";
import { InventarioServicios } from "./InventarioServicios";
import { ResumenMesCostes } from "./ResumenMesCostes";

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
  // 13/11/2026 («Pasos para saber el precio de todos los servicios y de las IAs»)
  /** Total del mes anterior (null: sin datos de ese mes). */
  anteriorEur?: number | null;
  cargandoAnterior?: boolean;
  /** «AAAA-MM-01» del mes en curso y del anterior. */
  mesActual?: string;
  textoMes?: string;
  textoMesAnterior?: string;
  avisosPlan?: AvisoPlan[];
  inventario?: Inventario | null;
  /** De pago por uso sin lectura automática: su gasto se mete a mano. */
  sinLectura?: Array<{ proveedor: string; nombre: string }>;
  onConfirmarPrecio?: (proveedor: string) => void;
}

/**
 * Super Admin › Servicios › Costes (la antigua pantalla «Costes», dentro de
 * Servicios). Desde el 13/11/2026 («Pasos para saber el precio de todos los
 * servicios y de las IAs»), de arriba abajo:
 *   1. Este mes, en euros: llevamos, previsión a fin de mes y mes anterior.
 *   2. Antes de pasar del plan gratis: cada límite, qué pasaría y el plan siguiente.
 *   3. Costes por meter (10/11/2026).
 *   4. Gasto de este mes por proveedor (con lo metido a mano y lo que no tiene lectura).
 *   5. Qué tenemos contratado: para qué, plan, precio fijo y «Confirmar precio».
 *   6. Cuánto cuesta cada cosa y la IA función por función.
 *   7. OpenAI por proceso (lo facturado de verdad), el informe mensual y la
 *      lectura de reservas escritas a mano.
 */
export function PestanaCostes({
  resumen, estadoServicios, eurPorUsd, costesDisponibles, enUso, faltantes, cargandoFaltantes, costesMesDisponible, onPonerPrecio, onMeterCoste,
  anteriorEur = null, cargandoAnterior = false, mesActual, textoMes = "este mes", textoMesAnterior = "Mes anterior", avisosPlan = [], inventario = null,
  sinLectura = [], onConfirmarPrecio,
}: Props) {
  const listo = !!resumen && costesDisponibles;
  return (
    <div className="flex min-w-0 flex-col gap-4 pb-2">
      {listo && (
        <ResumenMesCostes
          resumen={resumen}
          anteriorEur={anteriorEur}
          textoMes={textoMes}
          textoMesAnterior={textoMesAnterior}
          cargandoAnterior={cargandoAnterior}
          eurPorUsd={eurPorUsd}
        />
      )}
      {listo && <AvisosPlanGratis avisos={avisosPlan} />}
      {listo && (
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
        descripcion="La cuota de cada plan y lo gastado por uso hasta hoy, en euros. Si se ha metido a mano lo de este mes, manda eso."
      >
        {resumen ? (
          <DesgloseCostes
            resumen={resumen}
            eurPorUsd={eurPorUsd}
            costesDisponibles={costesDisponibles}
            sinLectura={costesMesDisponible ? sinLectura : []}
            textoMesCorto={textoMes.replace(/ de \d{4}$/, "")}
            onMeterCoste={mesActual && costesMesDisponible ? (p) => onMeterCoste(p, mesActual) : undefined}
          />
        ) : estadoServicios}
      </Bloque>
      {listo && inventario && onConfirmarPrecio && <InventarioServicios inventario={inventario} onConfirmar={onConfirmarPrecio} />}
      <IaPorFuncion eurPorUsd={eurPorUsd} />
      <CostesIa previsionTotalEur={resumen?.previsionMesEur ?? null} />
      {listo && <InformeMensual servicios={enUso} eurPorUsd={eurPorUsd} onMeterCoste={onMeterCoste} />}
      <GastoLecturaManuscrita eurPorUsd={eurPorUsd} />
    </div>
  );
}
