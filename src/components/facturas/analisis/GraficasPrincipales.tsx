// «Proveedores con más gasto» (barras horizontales finas en HTML).
//
// Cada proveedor es un BOTÓN (foco visible, nombre accesible, 44 px) que abre
// un menú: ver sus documentos, abrirlo en Compras o llevarlo al explorador.
// «Gasto por mes» ya no es una tarjeta fija: es la gráfica por defecto del
// explorador (Explorador.tsx), que se puede cambiar.
import { useState } from "react";
import { cn } from "@/lib/utils";
import { formatCurrency } from "@/components/facturas/shared/formatters";
import { nombreCorto, resumenProveedores, textoPct, type ProveedorGasto } from "@/lib/facturas/tableroCompras";
import { COLOR_CASA_TOMAS, FilaConMenu, FOCO, SinDatos, Tarjeta, type AccionMenu } from "./piezas";

const VISIBLES = 5;

export function ProveedoresTop({
  proveedores,
  acciones,
  className,
}: {
  proveedores: ProveedorGasto[];
  acciones: (p: ProveedorGasto) => AccionMenu[];
  className?: string;
}) {
  const [todos, setTodos] = useState(false);
  const max = Math.max(1, ...proveedores.map((p) => p.gasto));
  const lista = todos ? proveedores : proveedores.slice(0, VISIBLES);
  return (
    <Tarjeta
      titulo="Proveedores con más gasto"
      subtitulo="Con IVA · % del gasto del periodo"
      resumen={resumenProveedores(proveedores)}
      className={className}
      testId="tarjeta-proveedores"
    >
      {proveedores.length === 0 ? (
        <SinDatos>Ningún proveedor con gasto en este periodo.</SinDatos>
      ) : (
        <>
          <ol className="space-y-0.5" aria-label="Proveedores por gasto" id="lista-proveedores-top">
            {lista.map((p, i) => (
              <li key={`${p.id ?? p.nombre}-${i}`}>
                <FilaConMenu
                  nombre={`${p.nombre}: ${formatCurrency(p.gasto)}${p.pct !== null ? `, ${textoPct(p.pct, false)} del total` : ""}. Opciones`}
                  acciones={acciones(p)}
                  title={p.nombre}
                  className={cn("flex min-h-11 w-full flex-col justify-center gap-1 rounded-md px-1.5 py-1 text-left hover:bg-muted/50 disabled:cursor-default", FOCO)}
                >
                  <span className="flex w-full items-baseline gap-2 text-sm">
                    <span className="line-clamp-2 min-w-0 flex-1 break-words">{nombreCorto(p.nombre)}</span>
                    <span className="shrink-0 tabular-nums">{formatCurrency(p.gasto)}</span>
                    {p.pct !== null && <span className="w-12 shrink-0 text-right text-xs tabular-nums text-muted-foreground">{textoPct(p.pct, false)}</span>}
                  </span>
                  <span className="h-1.5 w-full rounded-full bg-muted/60" aria-hidden>
                    <span className={cn("block h-full rounded-full", COLOR_CASA_TOMAS)} style={{ width: `${(p.gasto / max) * 100}%` }} />
                  </span>
                </FilaConMenu>
              </li>
            ))}
          </ol>
          {proveedores.length > VISIBLES && (
            <button
              type="button"
              onClick={() => setTodos((v) => !v)}
              aria-expanded={todos}
              aria-controls="lista-proveedores-top"
              className={cn("mt-1 inline-flex min-h-11 items-center self-start rounded-md px-1.5 text-sm font-medium text-primary hover:underline", FOCO)}
            >
              {todos ? "Ver solo 5" : `Ver los ${proveedores.length}`}
            </button>
          )}
        </>
      )}
    </Tarjeta>
  );
}
