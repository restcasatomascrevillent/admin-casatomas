import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { CalendarDays } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { agruparPorDia, inicioSemana, textoEstado, type ArchivoSubido, type DiaSubidas } from "@/lib/facturas/subidasSemana";

const DIA_CORTO = new Intl.DateTimeFormat("es-ES", { weekday: "short" });
const DIA_LARGO = new Intl.DateTimeFormat("es-ES", { weekday: "long", day: "numeric", month: "long" });
const HORA = new Intl.DateTimeFormat("es-ES", { hour: "2-digit", minute: "2-digit" });

const TONO: Record<ReturnType<typeof textoEstado>["tono"], string> = {
  ok: "text-emerald-700 dark:text-emerald-300",
  aviso: "text-amber-700 dark:text-amber-300",
  error: "text-red-700 dark:text-red-300",
  neutro: "text-muted-foreground",
};

/** Archivos subidos desde hace 6 días (quien solo sube ve los suyos: lo filtra la RLS). */
function useArchivosSemana(version: number) {
  // Se recalcula al cambiar de día (el panel puede quedarse abierto de un día para otro).
  const desde = inicioSemana().toISOString();
  return useQuery({
    queryKey: ["facturas-archivos-semana", desde, version],
    staleTime: 60_000,
    refetchInterval: 120_000,
    queryFn: async (): Promise<ArchivoSubido[]> => {
      const { data, error } = await supabase
        .from("ocr_trabajos")
        .select("id, nombre_original, created_at, estado, factura_id")
        .gte("created_at", desde)
        .order("created_at", { ascending: false })
        .limit(1000);
      if (error) throw error;
      return (data ?? []).map((t) => ({
        id: t.id,
        nombre: t.nombre_original,
        subido: t.created_at,
        estado: t.estado,
        facturaId: t.factura_id,
      }));
    },
  });
}

/**
 * Calendario de una semana en «Cargar» (dueño, 14/11/2026): hoy el último y
 * los 6 anteriores, cada día con cuántos archivos se subieron. Al tocar un día
 * sale la lista con el NOMBRE DEL ARCHIVO subido. Una sola fila: la página no
 * hace scroll; la lista del día hace scroll dentro de su ventanita.
 * `version` cambia cuando termina un envío, para volver a contar.
 * `conEnlace`: «Ver» lleva a Compras (solo quien puede consultarlas).
 */
export function CalendarioSubidas({ version = 0, conEnlace = true }: { version?: number; conEnlace?: boolean }) {
  const q = useArchivosSemana(version);
  const dias = useMemo(() => agruparPorDia(q.data ?? []), [q.data]);
  const total = dias.reduce((n, d) => n + d.archivos.length, 0);

  return (
    <section aria-label="Archivos subidos esta semana" className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1.5">
      <h3 className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
        <CalendarDays className="h-3.5 w-3.5" aria-hidden="true" />
        Subidos en 7 días{q.data ? `: ${total}` : ""}
      </h3>
      <ol className="grid min-w-0 flex-1 grid-cols-7 gap-1 sm:max-w-md">
        {dias.map((d) => (
          <li key={d.clave}>
            <Dia dia={d} cargando={q.isLoading} conEnlace={conEnlace} />
          </li>
        ))}
      </ol>
      {q.isError && <p className="w-full text-xs text-destructive">No se ha podido contar lo subido.</p>}
    </section>
  );
}

function Dia({ dia, cargando, conEnlace }: { dia: DiaSubidas; cargando: boolean; conEnlace: boolean }) {
  const [abierto, setAbierto] = useState(false);
  const n = dia.archivos.length;
  const nombreDia = dia.esHoy ? "Hoy" : DIA_CORTO.format(dia.fecha).replace(".", "");
  return (
    <Popover open={abierto} onOpenChange={setAbierto}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={`${dia.esHoy ? "Hoy, " : ""}${DIA_LARGO.format(dia.fecha)}: ${n} archivo${n === 1 ? "" : "s"} subido${n === 1 ? "" : "s"}`}
          className={cn(
            "flex h-11 w-full flex-col items-center justify-center rounded-md border text-xs leading-tight transition-colors",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            dia.esHoy ? "border-gold" : "border-border",
            n > 0 ? "bg-muted/40 hover:bg-muted" : "text-muted-foreground hover:bg-muted/40",
            abierto && "bg-muted",
          )}
        >
          <span className="capitalize">{nombreDia} {dia.fecha.getDate()}</span>
          <span className={cn("tabular-nums", n > 0 ? "text-sm font-semibold text-foreground" : "")}>{cargando ? "·" : n}</span>
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" collisionPadding={12} className="w-[min(22rem,calc(100vw-1.5rem))] p-3">
        <p className="mb-2 text-sm font-semibold first-letter:uppercase">
          {DIA_LARGO.format(dia.fecha)} · {n} archivo{n === 1 ? "" : "s"}
        </p>
        {n === 0 ? (
          <p className="text-sm text-muted-foreground">Ese día no se subió ningún archivo.</p>
        ) : (
          <ul className="max-h-72 divide-y divide-border/60 overflow-y-auto overscroll-contain" aria-label="Archivos subidos ese día">
            {dia.archivos.map((a) => {
              const e = textoEstado(a.estado);
              return (
                <li key={a.id} className="flex items-baseline gap-2 py-1.5 text-sm">
                  <span className="shrink-0 tabular-nums text-xs text-muted-foreground">{HORA.format(new Date(a.subido))}</span>
                  <span className="min-w-0 flex-1 break-all">{a.nombre}</span>
                  {a.facturaId && conEnlace ? (
                    <Link
                      to={`/facturas?tab=compras&modo=documentos&doc=${a.facturaId}`}
                      onClick={() => setAbierto(false)}
                      className={cn("shrink-0 text-xs underline-offset-2 hover:underline", TONO[e.tono])}
                    >
                      {e.texto} · Ver
                    </Link>
                  ) : (
                    <span className={cn("shrink-0 text-xs", TONO[e.tono])}>{e.texto}</span>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </PopoverContent>
    </Popover>
  );
}
