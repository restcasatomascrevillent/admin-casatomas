import { AlertTriangle, Info } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import type { CosteFijo, FilaCostePorModelo, FilaFuncionSinRegistro } from "@/hooks/useCostes";
import { fmtFecha, fmtFechaHora } from "./formato";
import {
  calcularAvisosCostes,
  DIAS_SIN_REGISTRO,
  DIAS_VERIFICACION_CADUCA,
} from "./calculos";

interface AvisosCostesProps {
  sinRegistro: FilaFuncionSinRegistro[] | undefined;
  modelos: FilaCostePorModelo[] | undefined;
  fijos: CosteFijo[] | undefined;
  /** `fijos_sin_verificar` de `ia_coste_mes`, como respaldo si la tabla no ha cargado. */
  fijosSinVerificarRpc: number | null;
  /** `now` inyectable para tests. */
  ahora?: Date;
}

/**
 * Los avisos son la parte honesta de la pantalla: dicen en qué NO se puede
 * confiar. Sin ellos, un total bajo se leería como "gasto poco" cuando en
 * realidad significa "no lo estoy midiendo".
 */
export function AvisosCostes({ sinRegistro, modelos, fijos, fijosSinVerificarRpc, ahora }: AvisosCostesProps) {
  const avisos = calcularAvisosCostes({ sinRegistro, modelos, fijos, fijosSinVerificarRpc, ahora });

  if (!avisos.hayAvisos) return null;

  return (
    <div className="space-y-3">
      {avisos.sinInstrumentar.length > 0 && (
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>Hay funciones de IA que todavía no registran su consumo</AlertTitle>
          <AlertDescription>
            <ul className="mt-1 space-y-0.5 text-sm">
              {avisos.sinInstrumentar.map((f) => (
                <li key={f.funcion}>
                  <strong>{f.funcion}</strong>
                  {f.descripcion ? ` — ${f.descripcion}` : ""}
                </li>
              ))}
            </ul>
            <p className="mt-1 text-xs opacity-80">
              Lo que ves aquí NO incluye su coste por función registrado en la app (el gasto real de OpenAI sí lo
              recoge entero). Si no hay gasto real, el coste verdadero es mayor que el de estas cifras.
            </p>
          </AlertDescription>
        </Alert>
      )}

      {avisos.instrumentadasMudas.length > 0 && (
        <Alert>
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>Funciones que deberían registrar y no lo están haciendo</AlertTitle>
          <AlertDescription>
            <ul className="mt-1 space-y-0.5 text-sm">
              {avisos.instrumentadasMudas.map((f) => (
                <li key={f.funcion}>
                  <strong>{f.funcion}</strong>: sin ninguna fila en los últimos {DIAS_SIN_REGISTRO} días
                  {/* `ultima_fila` es un timestamptz, no una fecha: interesa la hora
                      para saber si se cortó a media tarde o lleva días muerto. */}
                  {f.ultima_fila ? ` · última vez ${fmtFechaHora(f.ultima_fila)}` : " · nunca ha registrado nada"}
                </li>
              ))}
            </ul>
            <p className="mt-1 text-xs opacity-80">
              Están marcadas como instrumentadas, así que o nadie las ha usado o el registro está roto. Conviene
              comprobarlo antes de dar el coste por bueno.
            </p>
          </AlertDescription>
        </Alert>
      )}

      {avisos.modelosSinTarifa.length > 0 && (
        <Alert>
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>Modelos usados sin tarifa en el catálogo de precios</AlertTitle>
          <AlertDescription className="text-sm">
            <p>
              {avisos.modelosSinTarifa.join(", ")}: se han registrado sus tokens pero no hay precio en{" "}
              <code className="text-xs">ia_precios</code>, así que su coste sale como «sin datos» y no suma al total.
              No es que sean gratis.
            </p>
          </AlertDescription>
        </Alert>
      )}

      {(avisos.fijosSinVerificar > 0 || avisos.fijosCaducados.length > 0) && (
        <Alert>
          <Info className="h-4 w-4" />
          <AlertTitle>Costes fijos sin verificar o caducados</AlertTitle>
          <AlertDescription className="text-sm">
            {avisos.fijosSinVerificar > 0 && (
              <p>
                {avisos.fijosSinVerificar}{" "}
                {avisos.fijosSinVerificar === 1 ? "concepto fijo no tiene importe" : "conceptos fijos no tienen importe"}{" "}
                verificado, así que no entra en el total mensual.
              </p>
            )}
            {avisos.fijosCaducados.length > 0 && (
              <>
                <p className="mt-1">
                  Verificados hace más de {DIAS_VERIFICACION_CADUCA} días (o sin fecha de verificación):
                </p>
                <ul className="mt-0.5 space-y-0.5">
                  {avisos.fijosCaducados.map((f) => (
                    <li key={f.concepto}>
                      <strong>{f.concepto}</strong>:{" "}
                      {f.verificadoEn ? `${fmtFecha(f.verificadoEn)} (${f.dias} días)` : "nunca verificado"}
                    </li>
                  ))}
                </ul>
              </>
            )}
          </AlertDescription>
        </Alert>
      )}
    </div>
  );
}
