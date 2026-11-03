import { useMemo, useState } from "react";
import { AlertTriangle, Loader2, RefreshCw, Server } from "lucide-react";
import { toast } from "sonner";
import { SuperAdminLayout } from "@/components/SuperAdminLayout";
import { Button } from "@/components/ui/button";
import { ChipSemaforo } from "@/components/servicios/BarraConsumo";
import { DialogoEditarServicio } from "@/components/servicios/DialogoEditarServicio";
import { TarjetaServicio } from "@/components/servicios/TarjetaServicio";
import { useAlturaDisponible } from "@/hooks/useAlturaDisponible";
import { useActualizarLecturas, useLecturasServicios, useServiciosContratados } from "@/hooks/useServicios";
import { type LecturaServicio, type ServicioContratado, haceCuanto } from "@/lib/servicios";
import { cn } from "@/lib/utils";

/** Suelo (px) del alto: por debajo (teclado abierto, ventana muy baja) vuelve el scroll de página. */
const ALTURA_MINIMA_SERVICIOS = 360;
const ORDEN = ["vercel", "supabase", "github", "resend", "stripe"];
const posicion = (p: string) => (ORDEN.includes(p) ? ORDEN.indexOf(p) : ORDEN.length);

/**
 * Super Admin › Servicios: una tarjeta por servicio contratado con su plan,
 * precio, renovación, enlace al panel del proveedor y el consumo frente al
 * límite del plan (barra, % y semáforo). Las lecturas las hace la Edge
 * Function `servicios-uso` (caché de 15 min); «Actualizar» la fuerza.
 */
export default function SuperAdminServicios() {
  const servicios = useServiciosContratados();
  const disponible = servicios.data?.disponible === true;
  const lecturas = useLecturasServicios(disponible);
  const actualizar = useActualizarLecturas();
  const [editando, setEditando] = useState<ServicioContratado | null>(null);
  const [actualizando, setActualizando] = useState<string | null>(null);
  // Alto de la pantalla (regla del dueño, 2026-10-07): la página no hace scroll, el bloque sí.
  const [raiz, setRaiz] = useState<HTMLDivElement | null>(null);
  const alto = useAlturaDisponible(raiz, ALTURA_MINIMA_SERVICIOS);

  const lista = useMemo(
    () => (servicios.data?.disponible ? [...servicios.data.servicios].sort((a, b) => posicion(a.proveedor) - posicion(b.proveedor) || a.nombre.localeCompare(b.nombre, "es")) : []),
    [servicios.data],
  );
  const porProveedor = useMemo(() => new Map<string, LecturaServicio>((lecturas.data?.lecturas ?? []).map((l) => [l.proveedor, l])), [lecturas.data]);
  const ultima = useMemo(() => {
    const fechas = (lecturas.data?.lecturas ?? []).map((l) => l.tomado_en).filter(Boolean).sort();
    return fechas.length ? fechas[fechas.length - 1] : null;
  }, [lecturas.data]);

  const pedirActualizacion = async (servicio?: ServicioContratado) => {
    setActualizando(servicio?.proveedor ?? "todos");
    try {
      const r = await actualizar.mutateAsync(servicio?.proveedor);
      if (r.errorFuncion) toast.error(r.errorFuncion);
      else toast.success(servicio ? `${servicio.nombre}: consumo actualizado` : "Consumo actualizado");
    } catch {
      toast.error("No se pudo actualizar el consumo.");
    } finally {
      setActualizando(null);
    }
  };

  return (
    <SuperAdminLayout>
      <div
        ref={setRaiz}
        className="flex min-w-0 flex-col gap-4 overflow-y-auto overscroll-contain"
        style={alto ? { height: alto } : undefined}
      >
        <header className="flex min-w-0 flex-wrap items-start justify-between gap-3">
          <div className="flex min-w-0 flex-1 items-center gap-3">
            <Server className="h-6 w-6 shrink-0 text-destructive sm:h-8 sm:w-8" aria-hidden="true" />
            <div className="min-w-0">
              <h1 className="text-2xl font-bold text-foreground">Servicios</h1>
              <p className="text-sm text-muted-foreground">Lo que tenemos contratado y cuánto llevamos gastado de cada plan.</p>
            </div>
          </div>
          {disponible && (
            <div className="flex w-full min-w-0 flex-col gap-1 sm:w-auto sm:items-end">
              <Button
                type="button"
                className="h-11 w-full gap-2 sm:w-auto"
                onClick={() => void pedirActualizacion()}
                disabled={actualizando !== null || lecturas.isLoading}
              >
                <RefreshCw className={cn("h-4 w-4", actualizando === "todos" && "animate-spin")} aria-hidden="true" />
                Actualizar todo ahora
              </Button>
              <p className="text-xs text-muted-foreground" role="status">
                {lecturas.isLoading ? "Leyendo el consumo…" : `Última lectura: ${haceCuanto(ultima)}`}
              </p>
            </div>
          )}
        </header>

        <p className="flex min-w-0 flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <span>Semáforo del consumo:</span>
          <ChipSemaforo estado="verde">Bien: menos del 70 %</ChipSemaforo>
          <ChipSemaforo estado="ambar">Cerca del límite: 70–90 %</ChipSemaforo>
          <ChipSemaforo estado="rojo">Al límite: más del 90 %</ChipSemaforo>
        </p>

        {lecturas.data?.errorFuncion && (
          <p role="alert" className="flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            <span>
              {lecturas.data.errorFuncion}
              {lecturas.data.lecturas.length > 0 ? " Se muestran las últimas lecturas guardadas." : ""}
            </span>
          </p>
        )}

        {servicios.isLoading ? (
          <p className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" /> Cargando los servicios…
          </p>
        ) : servicios.isError ? (
          <div role="alert" className="space-y-3 rounded-md border border-destructive/40 bg-destructive/5 p-4 text-sm text-destructive">
            <p>No se pudieron cargar los servicios: {servicios.error instanceof Error ? servicios.error.message : "error desconocido"}.</p>
            <Button type="button" variant="outline" className="h-11" onClick={() => void servicios.refetch()}>Reintentar</Button>
          </div>
        ) : !disponible ? (
          <p role="alert" className="rounded-md border border-amber-300 bg-amber-50 p-4 text-sm text-amber-950">
            Falta aplicar en Supabase la migración de Servicios (20261103120000_servicios_contratados). Cuando esté, aquí saldrán los servicios.
          </p>
        ) : (
          <div className="grid min-w-0 grid-cols-1 gap-4 pb-2 xl:grid-cols-2">
            {lista.map((s) => (
              <TarjetaServicio
                key={s.proveedor}
                servicio={s}
                lectura={porProveedor.get(s.proveedor) ?? null}
                cargando={lecturas.isLoading}
                actualizando={actualizando === s.proveedor || actualizando === "todos"}
                onActualizar={() => void pedirActualizacion(s)}
                onEditar={() => setEditando(s)}
              />
            ))}
          </div>
        )}
      </div>
      <DialogoEditarServicio servicio={editando} onCerrar={() => setEditando(null)} />
    </SuperAdminLayout>
  );
}
