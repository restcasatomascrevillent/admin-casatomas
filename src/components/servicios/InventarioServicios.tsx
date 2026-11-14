import { BadgeCheck, ClipboardList, ExternalLink, Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { FilaInventario, Inventario } from "@/lib/costesServicios";
import { TEXTO_CATEGORIA, formatearEur } from "@/lib/servicios";
import { cn } from "@/lib/utils";
import { Bloque } from "./Bloque";

interface Props {
  inventario: Inventario;
  /** «Confirmar precio» (o «Cambiar», si ya está confirmado). */
  onConfirmar: (proveedor: string) => void;
}

function EstadoPrecio({ f }: { f: FilaInventario }) {
  if (f.estado === "confirmado") {
    return (
      <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-800 dark:text-emerald-300">
        <BadgeCheck className="h-4 w-4 shrink-0" aria-hidden="true" />
        {f.confirmadoEn ? `Confirmado el ${f.confirmadoEn}` : "Confirmado"}
      </span>
    );
  }
  return (
    <span className="inline-flex rounded-full border border-amber-300 bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-950 dark:border-amber-800 dark:bg-amber-950/50 dark:text-amber-100">
      {f.estado === "sin_precio" ? "Sin precio" : "Por confirmar"}
    </span>
  );
}

function BotonConfirmar({ f, onConfirmar, compacto = false }: { f: FilaInventario; onConfirmar: (p: string) => void; compacto?: boolean }) {
  const pendiente = f.estado !== "confirmado";
  return (
    <Button
      type="button"
      variant={pendiente ? "default" : "ghost"}
      size="sm"
      className={cn("gap-1.5", compacto ? "h-9 px-2" : "h-10")}
      onClick={() => onConfirmar(f.proveedor)}
    >
      {pendiente ? <BadgeCheck className="h-4 w-4" aria-hidden="true" /> : <Pencil className="h-4 w-4" aria-hidden="true" />}
      <span className={cn(!pendiente && compacto && "sr-only")}>{pendiente ? "Confirmar precio" : "Cambiar"}</span>
      <span className="sr-only">{pendiente ? ` de ${f.nombre}` : ` el precio de ${f.nombre}`}</span>
    </Button>
  );
}

function EnlacePrecio({ f }: { f: FilaInventario }) {
  if (!f.fuentePrecio) return null;
  return (
    <a href={f.fuentePrecio} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground">
      Precios oficiales<ExternalLink className="h-3 w-3" aria-hidden="true" />
      <span className="sr-only"> de {f.nombre} (se abre en otra pestaña)</span>
    </a>
  );
}

/**
 * Servicios › Costes › «Qué tenemos contratado» (13/11/2026, paso 1 del
 * encargo): cada servicio en uso con para qué lo usamos, su plan, lo que
 * cuesta fijo al mes y al año y si el precio está comprobado. «Confirmar
 * precio» abre el plan y el precio para revisarlos contra su página oficial o
 * la factura. En el móvil, una tarjeta por servicio; desde md, tabla.
 */
export function InventarioServicios({ inventario, onConfirmar }: Props) {
  const { filas, porConfirmar } = inventario;
  return (
    <Bloque
      id="costes-inventario"
      icono={<ClipboardList />}
      titulo={porConfirmar ? `Qué tenemos contratado: ${porConfirmar} ${porConfirmar === 1 ? "precio por confirmar" : "precios por confirmar"}` : "Qué tenemos contratado"}
      descripcion="Cada servicio, para qué lo usamos, su plan y lo que cuesta fijo. Cuando compruebes un precio en su página o en la factura, pulsa «Confirmar precio»."
    >
      <ul className="min-w-0 space-y-2 md:hidden" aria-label="Servicios contratados">
        {filas.map((f) => (
          <li key={f.proveedor} className="min-w-0 rounded-lg border p-3" data-inventario={f.proveedor} data-estado={f.estado}>
            <div className="flex min-w-0 items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="break-words text-sm font-semibold text-foreground">{f.nombre}</p>
                {f.paraQue && <p className="break-words text-xs text-muted-foreground">{f.paraQue}</p>}
              </div>
              <EstadoPrecio f={f} />
            </div>
            <dl className="mt-2 grid min-w-0 grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-sm">
              <dt className="text-muted-foreground">Plan</dt>
              <dd className="min-w-0 break-words">{f.plan || "sin dato"}</dd>
              <dt className="text-muted-foreground">Al mes</dt>
              <dd className="min-w-0 break-words tabular-nums">{f.textoMes}</dd>
              {f.textoAnio && (
                <>
                  <dt className="text-muted-foreground">Al año</dt>
                  <dd className="min-w-0 break-words tabular-nums">{f.textoAnio}</dd>
                </>
              )}
            </dl>
            <div className="mt-2 flex min-w-0 flex-wrap items-center justify-between gap-2">
              <EnlacePrecio f={f} />
              <BotonConfirmar f={f} onConfirmar={onConfirmar} />
            </div>
          </li>
        ))}
      </ul>

      <div className="hidden min-w-0 overflow-x-auto rounded-md border md:block">
        <table className="w-full min-w-[44rem] text-sm">
          <caption className="sr-only">Servicios contratados: para qué, plan y precio fijo</caption>
          <thead className="bg-muted/50 text-xs text-muted-foreground">
            <tr>
              <th scope="col" className="px-3 py-2 text-left font-medium">Servicio</th>
              <th scope="col" className="px-3 py-2 text-left font-medium">Para qué</th>
              <th scope="col" className="px-3 py-2 text-left font-medium">Plan</th>
              <th scope="col" className="px-3 py-2 text-right font-medium">Al mes</th>
              <th scope="col" className="px-3 py-2 text-right font-medium">Al año</th>
              <th scope="col" className="px-3 py-2 text-left font-medium">Precio</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border/60">
            {filas.map((f) => (
              <tr key={f.proveedor} data-inventario={f.proveedor} data-estado={f.estado}>
                <th scope="row" className="px-3 py-2 text-left align-top font-medium text-foreground">
                  {f.nombre}
                  {TEXTO_CATEGORIA[f.categoria] && <span className="block text-xs font-normal text-muted-foreground">{TEXTO_CATEGORIA[f.categoria]}</span>}
                </th>
                <td className="max-w-[16rem] px-3 py-2 align-top text-muted-foreground">{f.paraQue ?? "—"}</td>
                <td className="px-3 py-2 align-top">{f.plan || "sin dato"}</td>
                <td className="px-3 py-2 text-right align-top tabular-nums">{f.textoMes}</td>
                <td className="px-3 py-2 text-right align-top tabular-nums text-muted-foreground">{f.textoAnio ?? "—"}</td>
                <td className="px-3 py-2 align-top">
                  <div className="flex min-w-0 flex-col items-start gap-1">
                    <div className="flex min-w-0 flex-wrap items-center gap-1">
                      <EstadoPrecio f={f} />
                      <BotonConfirmar f={f} onConfirmar={onConfirmar} compacto />
                    </div>
                    <EnlacePrecio f={f} />
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-muted-foreground" data-testid="inventario-total">
        Cuotas fijas: {formatearEur(inventario.cuotasMesEur)} al mes · {formatearEur(inventario.cuotasAnioEur)} al año. Lo que no tiene precio no suma; lo que se paga por uso está en «Gasto de este mes por proveedor».
      </p>
    </Bloque>
  );
}
