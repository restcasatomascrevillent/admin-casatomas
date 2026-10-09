import { ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useMensualFacturado } from "@/hooks/useFacturacionOficiososia";
import type { CosteFijo, FilaCosteMes, FilaCostePorModelo, FilaFuncionSinRegistro } from "@/hooks/useCostes";
import { fmtEurIa, fmtFechaCorta, textoTipoCambioReal } from "@/lib/facturas/gastoIa";
import { AvisosCostes } from "./AvisosCostes";
import { calcularAvisosCostes, iaUsdMes, TEXTO_ORIGEN } from "./calculos";
import { esNulo, fmtEur, fmtUsd, TEXTO_TIPO_CAMBIO } from "./formato";
import type { ResumenCostesMes } from "./resumenMes";

interface DetallesCostesProps {
  resumen: ResumenCostesMes;
  mes: FilaCosteMes | null | undefined;
  sinRegistro: FilaFuncionSinRegistro[] | undefined;
  modelos: FilaCostePorModelo[] | undefined;
  fijos: CosteFijo[] | undefined;
}

/** Hay algo que avisar (funciones sin instrumentar, modelos sin tarifa, fijos caducados…). */
export function hayAvisosCostes(p: Omit<DetallesCostesProps, "resumen" | "mes">): boolean {
  return calcularAvisosCostes({
    sinRegistro: p.sinRegistro,
    modelos: p.modelos,
    fijos: p.fijos,
    fijosSinVerificarRpc: null,
  }).hayAvisos;
}

function Seccion({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <section className="space-y-1">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{titulo}</h3>
      {children}
    </section>
  );
}

/**
 * Todo lo que matiza las cifras de la pantalla, en un desplegable: real frente
 * a estimado, tipo de cambio, reparto por proceso, y los avisos (funciones sin
 * instrumentar, modelos sin tarifa, fijos sin verificar). Antes eran tarjetas
 * sueltas que se comían la pantalla.
 */
export function DetallesCostes({ resumen, mes, sinRegistro, modelos, fijos }: DetallesCostesProps) {
  const facturado = useMensualFacturado();
  const aviso = hayAvisosCostes({ sinRegistro, modelos, fijos });
  const ia = iaUsdMes(mes);
  const real = resumen.real;

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button type="button" variant="outline" className="min-h-11 gap-1.5" data-testid="boton-detalles">
          Detalles
          {aviso && (
            <span
              className="h-2 w-2 rounded-full bg-amber-500"
              role="img"
              aria-label="Hay avisos"
              data-testid="detalles-aviso"
            />
          )}
          <ChevronDown className="h-4 w-4" aria-hidden />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        className="max-h-[70vh] w-[min(34rem,calc(100vw-2rem))] space-y-4 overflow-y-auto overscroll-contain p-4 text-sm"
      >
        <Seccion titulo="IA: real frente a estimado">
          {real ? (
            <>
              <p>
                Real (OpenAI) hasta el {fmtFechaCorta(resumen.ultimoDiaReal)}:{" "}
                <span className="tabular-nums">{fmtEurIa(resumen.iaRealEur)}</span> · hoy, estimado:{" "}
                <span className="tabular-nums">{fmtEurIa(resumen.iaHoyEur)}</span>. Sin IVA.
              </p>
              <p className="text-xs text-muted-foreground">
                {real.repartoTexto}. {textoTipoCambioReal(real.tipo)}. El real manda; el estimado de abajo solo sirve
                para contrastar.
              </p>
              {resumen.subOtros.length > 0 && (
                <ul className="space-y-0.5 border-l pl-3 text-xs text-muted-foreground" aria-label="Detalle de otros">
                  {resumen.subOtros.map((s) => (
                    <li key={s.clave} className="flex justify-between gap-3">
                      <span>{s.etiqueta} (estimado)</span>
                      <span className="tabular-nums">{fmtEurIa(s.totalEur)}</span>
                    </li>
                  ))}
                </ul>
              )}
              {resumen.sinAsignarEur > 0 && (
                <p className="text-xs text-amber-700 dark:text-amber-400">
                  {fmtEurIa(resumen.sinAsignarEur)} en proyectos de OpenAI sin marcar: no suman al total.
                </p>
              )}
              {resumen.iaAnteriorEur !== null && (
                <p className="text-xs text-muted-foreground">
                  El mes anterior es aproximado (se calcula restando dos ventanas del real); los fijos del mes
                  anterior se suponen iguales.
                </p>
              )}
            </>
          ) : (
            <p className="text-muted-foreground">
              Todavía no hay gasto real de OpenAI sincronizado: las cifras de IA son la estimación de lo registrado en
              la app (tokens × tarifa). {TEXTO_TIPO_CAMBIO}.
            </p>
          )}
          <p className="text-xs text-muted-foreground">
            Estimado registrado en la app este mes: {fmtUsd(mes?.coste_acumulado_usd ?? null)} acumulados · previsión{" "}
            {fmtUsd(ia.usd)} ({TEXTO_ORIGEN[ia.origen]}).
          </p>
        </Seccion>

        {!esNulo(facturado) && (
          <Seccion titulo="Frente a lo facturado">
            <p className="text-xs text-muted-foreground">
              Se factura {fmtEur(facturado)}/mes (último borrador guardado, sin impuestos).
              {!esNulo(resumen.previsionEur) && (
                <>
                  {" "}
                  Con la previsión de coste de {fmtEur(resumen.previsionEur)}, el margen es de{" "}
                  <span className="font-medium tabular-nums text-foreground">
                    {fmtEur(facturado - resumen.previsionEur)}
                  </span>
                  .
                </>
              )}
            </p>
          </Seccion>
        )}

        <Seccion titulo="Avisos">
          {aviso ? (
            <AvisosCostes
              sinRegistro={sinRegistro}
              modelos={modelos}
              fijos={fijos}
              fijosSinVerificarRpc={null}
            />
          ) : (
            <p className="text-xs text-muted-foreground">Sin avisos: todas las funciones registran y los fijos están verificados.</p>
          )}
        </Seccion>
      </PopoverContent>
    </Popover>
  );
}
