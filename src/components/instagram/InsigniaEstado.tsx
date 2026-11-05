/**
 * Insignia de estado de la sección Instagram (paleta de la maqueta, ver
 * estados.ts): píldora de 12 px con icono, igual en todas las pestañas.
 *
 *   <InsigniaEstado dominio="encargo" estado={e.estado} />
 *   <InsigniaEstado info={ESTADOS_CALENDARIO.programada} />
 */
import { cn } from "@/lib/utils";
import { ESTILO_TONO, infoEstado, type DominioEstado, type InfoEstado, type TonoEstado } from "./estados";

type Props = { className?: string; sinIcono?: boolean; texto?: string } & (
  | { info: InfoEstado; dominio?: never; estado?: never }
  | { dominio: DominioEstado; estado: string | null | undefined; info?: never }
);

export function InsigniaEstado(props: Props) {
  const i = props.info ?? infoEstado(props.dominio, props.estado);
  const Icono = i.icono;
  return (
    <span
      data-tono={i.tono}
      className={cn(
        "inline-flex h-[22px] shrink-0 items-center gap-1 whitespace-nowrap rounded-full border px-2 text-xs font-medium leading-none",
        ESTILO_TONO[i.tono].insignia,
        props.className,
      )}
    >
      {!props.sinIcono && <Icono className={cn("h-3 w-3 shrink-0", i.gira && "animate-spin")} aria-hidden="true" />}
      {props.texto ?? i.etiqueta}
    </span>
  );
}

/** Punto de color de un tono (cabeceras de columna, leyenda). */
export function PuntoTono({ tono, className }: { tono: TonoEstado; className?: string }) {
  return <span aria-hidden="true" className={cn("inline-block h-2 w-2 shrink-0 rounded-full", ESTILO_TONO[tono].punto, className)} />;
}

/** «CT» / «TZ»: marca en un cuadradito (maqueta, `.marca`). */
export function MarcaMini({ marca, className }: { marca: string; className?: string }) {
  const touza = marca === "touza";
  return (
    <span
      title={touza ? "Touza" : "Casa Tomás"}
      aria-label={touza ? "Touza" : "Casa Tomás"}
      className={cn(
        "inline-grid h-6 w-6 shrink-0 place-items-center rounded-md text-xs font-bold leading-none",
        touza ? "bg-[#0a0a0a] text-[#d49a35]" : "bg-[#394147] text-white",
        className,
      )}
    >
      {touza ? "TZ" : "CT"}
    </span>
  );
}
