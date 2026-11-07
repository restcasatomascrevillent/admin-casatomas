import { useEffect } from "react";
import { ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { LecturaServicio, ServicioContratado } from "@/lib/servicios";
import { TarjetaServicio } from "./TarjetaServicio";

interface Props {
  enUso: ServicioContratado[];
  /** Cuántos están quitados («no lo usamos»): se gestionan en Configurar. */
  quitados: number;
  porProveedor: Map<string, LecturaServicio>;
  sinLector: Set<string>;
  eurPorUsd: number;
  cargando: boolean;
  /** Proveedor que se está actualizando o «todos». */
  actualizando: string | null;
  onActualizar: (s: ServicioContratado) => void;
  onEditar: (s: ServicioContratado) => void;
  /** Tarjeta a la que llevar la vista (desde «Ver» del Resumen). */
  foco: string | null;
  onFocoHecho: () => void;
  onIrConfigurar: () => void;
}

/**
 * Super Admin › Servicios › Servicios: una tarjeta por servicio en uso con su
 * plan, precio, gasto por uso del mes y el consumo frente al límite (barra, %
 * y semáforo). Lo quitado no sale aquí: está en Configurar.
 */
export function PestanaServicios({
  enUso, quitados, porProveedor, sinLector, eurPorUsd, cargando, actualizando, onActualizar, onEditar, foco, onFocoHecho, onIrConfigurar,
}: Props) {
  // «Ver» desde el Resumen: lleva a la tarjeta y la deja enfocada (borde dorado).
  useEffect(() => {
    if (!foco) return;
    const id = window.requestAnimationFrame(() => {
      const tarjeta = document.getElementById(`tarjeta-${foco}`);
      tarjeta?.scrollIntoView?.({ block: "start", behavior: "smooth" });
      tarjeta?.focus({ preventScroll: true });
      onFocoHecho();
    });
    return () => window.cancelAnimationFrame(id);
  }, [foco, onFocoHecho]);

  return (
    <div className="flex min-w-0 flex-col gap-4 pb-2">
      {enUso.length === 0 ? (
        <p className="rounded-lg border bg-card p-4 text-sm text-muted-foreground">No hay ningún servicio en uso. Añádelos o vuelve a ponerlos en «Configurar».</p>
      ) : (
        <div className="grid min-w-0 grid-cols-1 gap-4 xl:grid-cols-2">
          {enUso.map((s) => (
            <TarjetaServicio
              key={s.proveedor}
              servicio={s}
              lectura={porProveedor.get(s.proveedor) ?? null}
              cargando={cargando}
              actualizando={actualizando === s.proveedor || actualizando === "todos"}
              sinLector={sinLector.has(s.proveedor)}
              eurPorUsd={eurPorUsd}
              onActualizar={() => onActualizar(s)}
              onEditar={() => onEditar(s)}
            />
          ))}
        </div>
      )}

      {quitados > 0 && (
        <div className="flex min-w-0 flex-wrap items-center justify-between gap-2 rounded-lg border border-dashed p-3 text-sm text-muted-foreground">
          <span className="min-w-0 flex-[1_1_14rem]">
            {quitados === 1 ? "Hay 1 servicio quitado" : `Hay ${quitados} servicios quitados`}: no se leen ni suman al coste.
          </span>
          <Button type="button" variant="ghost" size="sm" className="gap-1 px-2" onClick={onIrConfigurar}>
            Verlos en Configurar
            <ArrowRight className="h-4 w-4" aria-hidden="true" />
          </Button>
        </div>
      )}
    </div>
  );
}
