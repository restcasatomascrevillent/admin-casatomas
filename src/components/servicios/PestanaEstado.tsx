import type { ComponentType, SVGProps } from "react";
import {
  AlertOctagon,
  AlertTriangle,
  ChevronRight,
  Clock,
  ExternalLink,
  KeyRound,
  CheckCircle2,
  HelpCircle,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { iconoCategoria } from "./iconosServicio";
import {
  type AnilloEstado,
  type DestinoPendiente,
  type EstadoInstalacion,
  type EstadoServicio,
  type FichaEstado,
  type Pendiente,
  type ResumenCostes,
  TEXTO_ESTADO,
  formatearEur,
  formatearPorcentaje,
  haceCuanto,
  titularEstado,
} from "@/lib/servicios";

/**
 * Colores de cada estado (mismos tonos que el semáforo de las barras: 700 sobre
 * fondo 50, contraste ≥ 4,5:1). El estado también va en palabras: nunca solo color.
 */
const TONO: Record<EstadoServicio, { trazo: string; punto: string; texto: string; borde: string; fondo: string; disco: string }> = {
  rojo: {
    trazo: "stroke-red-600",
    punto: "bg-red-600",
    texto: "text-red-800 dark:text-red-300",
    borde: "border-red-300 dark:border-red-800",
    fondo: "border-red-200 bg-red-50 dark:border-red-900 dark:bg-red-950/40",
    disco: "bg-red-600 text-white",
  },
  ambar: {
    trazo: "stroke-amber-500",
    punto: "bg-amber-500",
    texto: "text-amber-900 dark:text-amber-300",
    borde: "border-amber-300 dark:border-amber-800",
    fondo: "border-amber-200 bg-amber-50 dark:border-amber-900 dark:bg-amber-950/40",
    disco: "bg-amber-500 text-white",
  },
  verde: {
    trazo: "stroke-emerald-600",
    punto: "bg-emerald-600",
    texto: "text-emerald-800 dark:text-emerald-300",
    borde: "border-border",
    fondo: "border-emerald-200 bg-emerald-50 dark:border-emerald-900 dark:bg-emerald-950/40",
    disco: "bg-emerald-600 text-white",
  },
  gris: {
    trazo: "stroke-slate-400",
    punto: "bg-slate-400",
    texto: "text-muted-foreground",
    borde: "border-border",
    fondo: "border-border bg-muted/40",
    disco: "bg-slate-400 text-white",
  },
};

type Icono = ComponentType<SVGProps<SVGSVGElement>>;


const ICONO_GENERAL: Record<EstadoServicio, Icono> = { rojo: AlertOctagon, ambar: AlertTriangle, verde: CheckCircle2, gris: HelpCircle };

/** Icono del centro cuando el servicio no tiene ninguna métrica con límite. */
function iconoSinLimite(f: FichaEstado): Icono {
  if (f.motivo === "Falta la clave" || f.motivo === "Clave rechazada") return KeyRound;
  if (f.estado === "rojo") return AlertOctagon;
  if (f.estado === "ambar") return f.motivo.startsWith("Renueva") ? Clock : AlertTriangle;
  if (f.estado === "verde") return CheckCircle2;
  return f.motivo === "Se mira en su panel" ? ExternalLink : Clock;
}

/** «58%», «<1%», «157%», «>999%». */
const textoAnillo = (p: number) => (p > 0 && p < 1 ? "<1%" : p >= 1000 ? ">999%" : `${Math.round(p)}%`);

/**
 * Un anillo de consumo: el arco es el % de la métrica (lleno a partir del 100 %), con el color de
 * su semáforo. `grande`: el único anillo de la ficha. La cifra encoge con 3 o más dígitos para
 * no salirse del círculo («157%» se salía, 09/11/2026).
 */
function Anillo({ anillo, grande }: { anillo: AnilloEstado; grande: boolean }) {
  const tono = TONO[anillo.semaforo];
  const r = 26;
  const c = 2 * Math.PI * r;
  const p = Math.max(0, anillo.porcentaje);
  const texto = textoAnillo(p);
  const largo = texto.length >= 4;
  return (
    <span className={cn("relative flex shrink-0 items-center justify-center", grande ? "h-14 w-14 sm:h-16 sm:w-16" : "h-11 w-11 sm:h-12 sm:w-12")}>
      <svg viewBox="0 0 64 64" className="absolute inset-0 h-full w-full -rotate-90" aria-hidden="true">
        <circle cx="32" cy="32" r={r} fill="none" strokeWidth={grande ? 6 : 7} className="stroke-muted" />
        <circle
          cx="32"
          cy="32"
          r={r}
          fill="none"
          strokeWidth={grande ? 6 : 7}
          strokeLinecap="round"
          className={tono.trazo}
          strokeDasharray={`${(Math.min(100, p) / 100) * c} ${c}`}
        />
      </svg>
      <span
        className={cn(
          "relative font-bold tabular-nums leading-none tracking-tight",
          grande ? (largo ? "text-xs sm:text-[13px]" : "text-sm") : largo ? "text-[9px] sm:text-[10px]" : "text-[11px] sm:text-xs",
          anillo.semaforo === "verde" ? "text-foreground" : tono.texto,
        )}
      >
        {texto}
      </span>
    </span>
  );
}

/** «Visitas: 26 % (257218 de 1.000.000 peticiones)». */
const detalleAnillo = (a: AnilloEstado) =>
  `${a.etiqueta}: ${formatearPorcentaje(a.porcentaje)}${a.textoValor && a.textoLimite ? ` (${a.textoValor} de ${a.textoLimite})` : ""}`;

/** Los anillos de la ficha: uno grande si solo hay uno; si no, hasta tres pequeños con su nombre debajo. */
function Anillos({ ficha }: { ficha: FichaEstado }) {
  if (ficha.anillos.length === 0) {
    const IconoCentro = iconoSinLimite(ficha);
    return (
      <span className="flex h-14 w-14 items-center justify-center rounded-full bg-muted/60 sm:h-16 sm:w-16" aria-hidden="true">
        <IconoCentro className={cn("h-6 w-6 sm:h-7 sm:w-7", TONO[ficha.estado].texto)} />
      </span>
    );
  }
  const solo = ficha.anillos.length === 1;
  // Dentro de un botón solo cabe contenido de frase: spans, sin lista. Lo que dicen va en el
  // nombre accesible del botón.
  return (
    <span className={cn("flex w-full min-w-0 justify-center", !solo && "gap-1.5 sm:gap-2")} aria-hidden="true" data-anillos={ficha.anillos.length}>
      {ficha.anillos.map((a, i) => (
        // En el móvil (fichas de ~140 px) caben dos con su nombre; el tercero, desde sm.
        <span
          key={a.clave}
          className={cn("min-w-0 flex-1 flex-col items-center gap-1", solo ? "flex" : "max-w-[5rem]", i >= 2 ? "hidden sm:flex" : "flex")}
          title={detalleAnillo(a)}
          data-anillo={a.clave}
        >
          <Anillo anillo={a} grande={solo} />
          {!solo && <span className="line-clamp-2 w-full break-words text-center text-[10px] leading-tight text-muted-foreground sm:text-[11px]">{a.corta}</span>}
        </span>
      ))}
    </span>
  );
}

function Ficha({ ficha, onAbrir }: { ficha: FichaEstado; onAbrir: (proveedor: string) => void }) {
  const tono = TONO[ficha.estado];
  const IconoCat = iconoCategoria(ficha.categoria);
  const resumenAnillos = ficha.anillos.map(detalleAnillo).join(". ");
  const resumenDatos = ficha.datos.map((d) => d.completo).join(". ");
  return (
    <li className="min-w-0" data-ficha={ficha.proveedor} data-estado={ficha.estado}>
      {/* Un solo control por ficha: el nombre accesible lo dice todo (estado, anillos y datos). */}
      <button
        type="button"
        onClick={() => onAbrir(ficha.proveedor)}
        title={[resumenAnillos, resumenDatos].filter(Boolean).join("\n") || ficha.nombreCompleto}
        aria-label={`${ficha.nombreCompleto}: ${TEXTO_ESTADO[ficha.estado]}, ${ficha.motivo}.${resumenAnillos ? ` ${resumenAnillos}.` : ""}${resumenDatos ? ` ${resumenDatos}.` : ""} Ver detalle`}
        className={cn(
          "flex h-full w-full min-w-0 flex-col items-center gap-2 rounded-xl border-2 bg-card p-3 text-center transition hover:-translate-y-0.5 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(38,59%,45%)] focus-visible:ring-offset-2",
          tono.borde,
        )}
      >
        <span className="flex w-full min-w-0 items-center gap-1.5">
          <IconoCat className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          <span className="min-w-0 flex-1 truncate text-left text-sm font-semibold text-foreground">{ficha.nombre}</span>
          <span className={cn("h-2.5 w-2.5 shrink-0 rounded-full", tono.punto)} aria-hidden="true" />
        </span>
        <Anillos ficha={ficha} />
        <span className={cn("text-sm font-semibold leading-tight", tono.texto)}>{ficha.motivo}</span>
        {ficha.anillos.length === 1 && (
          <span className="line-clamp-1 w-full text-xs text-muted-foreground">{ficha.anillos[0].etiqueta}</span>
        )}
        {ficha.datos.length > 0 && (
          <span className="mt-auto flex w-full min-w-0 flex-col gap-1 border-t border-border/60 pt-2 text-[11px] sm:gap-0.5 sm:text-xs" aria-hidden="true" data-datos={ficha.datos.length}>
            {ficha.datos.map((d) => (
              <span key={d.clave} className="flex min-w-0 items-baseline justify-between gap-2" data-dato={d.clave} title={d.completo}>
                <span className="min-w-0 break-words text-left leading-tight text-muted-foreground">{d.corta}</span>
                <span className="shrink-0 font-medium tabular-nums text-foreground">{d.texto}</span>
              </span>
            ))}
          </span>
        )}
      </button>
    </li>
  );
}

const ORDEN_CUENTA: EstadoServicio[] = ["rojo", "ambar", "verde", "gris"];
const PLURAL_ESTADO: Record<EstadoServicio, [string, string]> = {
  rojo: ["urgente", "urgentes"],
  ambar: ["aviso", "avisos"],
  verde: ["bien", "bien"],
  gris: ["sin datos", "sin datos"],
};

interface Props {
  estado: EstadoInstalacion;
  resumen: ResumenCostes;
  pendientes: Pendiente[];
  /** La lectura más reciente (ISO), para «hace 5 min». */
  ultima: string | null;
  cargandoLecturas: boolean;
  onAbrir: (proveedor: string) => void;
  onIr: (destino: DestinoPendiente) => void;
}

/**
 * Super Admin › Servicios › Estado (06/11/2026, petición del dueño: «muy visual,
 * que de primera vista sepas el estado de la instalación completa», sin tanto
 * texto). Arriba, el semáforo de toda la instalación con el recuento por
 * colores y el gasto del mes; debajo, una ficha por servicio con un anillo de su
 * consumo más alto y dos o tres palabras (la ficha lleva a su tarjeta); y, solo
 * si hay algo, una línea por cosa que mirar.
 */
export function PestanaEstado({ estado, resumen, pendientes, ultima, cargandoLecturas, onAbrir, onIr }: Props) {
  const tono = TONO[estado.general];
  const IconoGeneral = ICONO_GENERAL[estado.general];
  const mirar = pendientes.filter((p) => p.gravedad !== "info");
  const porRevisar = pendientes.filter((p) => p.gravedad === "info");
  const sinNada = estado.fichas.length === 0;
  const conDatos = estado.fichas.filter((f) => f.estado !== "gris");
  const sinDatos = estado.fichas.filter((f) => f.estado === "gris");
  const titular = cargandoLecturas && estado.cuenta.verde + estado.cuenta.ambar + estado.cuenta.rojo === 0 ? "Leyendo el estado…" : titularEstado(estado);

  return (
    <div className="flex min-w-0 flex-col gap-4 pb-2">
      <section
        aria-labelledby="estado-titular"
        data-testid="estado-general"
        data-estado={estado.general}
        className={cn("flex min-w-0 flex-col gap-4 rounded-2xl border p-4 sm:flex-row sm:items-center sm:p-5", tono.fondo)}
      >
        <div className="flex min-w-0 flex-1 items-center gap-4">
          <span className={cn("flex h-14 w-14 shrink-0 items-center justify-center rounded-full shadow-sm sm:h-16 sm:w-16", tono.disco)} aria-hidden="true">
            <IconoGeneral className="h-8 w-8 sm:h-9 sm:w-9" />
          </span>
          <div className="min-w-0">
            <h2 id="estado-titular" className="text-xl font-bold leading-tight text-foreground sm:text-2xl">{titular}</h2>
            <ul className="mt-2 flex min-w-0 flex-wrap gap-1.5" aria-label="Servicios por estado">
              {ORDEN_CUENTA.filter((e) => estado.cuenta[e] > 0).map((e) => (
                <li key={e} className="inline-flex items-center gap-1.5 rounded-full bg-background/80 px-2.5 py-1 text-xs font-medium text-foreground shadow-sm">
                  <span className={cn("h-2 w-2 rounded-full", TONO[e].punto)} aria-hidden="true" />
                  <span className="tabular-nums">{estado.cuenta[e]}</span> {PLURAL_ESTADO[e][estado.cuenta[e] === 1 ? 0 : 1]}
                </li>
              ))}
            </ul>
          </div>
        </div>
        <div className="flex min-w-0 items-end justify-between gap-4 border-t border-foreground/10 pt-3 sm:block sm:border-l sm:border-t-0 sm:pl-5 sm:pt-0 sm:text-right" data-testid="estado-gasto">
          <div>
            <p className="text-xs font-medium text-muted-foreground">Gasto este mes</p>
            <p className="text-2xl font-bold tabular-nums leading-tight text-foreground">{formatearEur(resumen.totalMesEur)}</p>
          </div>
          <p className="text-xs tabular-nums text-muted-foreground">≈ {formatearEur(resumen.previsionMesEur)} a fin de mes</p>
        </div>
      </section>

      {sinNada ? (
        <p className="rounded-xl border bg-card p-4 text-sm text-muted-foreground">No hay ningún servicio en uso. Añádelos en «Configurar».</p>
      ) : (
        <>
          {conDatos.length > 0 && (
            <ul className="grid min-w-0 grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 2xl:grid-cols-6" aria-label="Estado de cada servicio">
              {conDatos.map((f) => <Ficha key={f.proveedor} ficha={f} onAbrir={onAbrir} />)}
            </ul>
          )}
          {/* Sin datos todavía (aún no se ha leído): no es un estado que vigilar, así que van en
              pequeño, sin ocupar una fila de fichas. Los que no tienen lectura automática ya no llegan
              aquí (10/11/2026); mientras se lee, tampoco se sabe cuáles son, así que no se enseña. */}
          {sinDatos.length > 0 && !cargandoLecturas && (
            <div className="flex min-w-0 flex-wrap items-center gap-2" data-testid="estado-sin-datos">
              <span className="text-xs font-medium text-muted-foreground">Sin datos todavía:</span>
              <ul className="flex min-w-0 flex-wrap gap-2" aria-label="Servicios sin datos todavía">
                {sinDatos.map((f) => {
                  const IconoCat = iconoCategoria(f.categoria);
                  return (
                    <li key={f.proveedor} data-ficha={f.proveedor} data-estado={f.estado}>
                      <button
                        type="button"
                        onClick={() => onAbrir(f.proveedor)}
                        title={f.motivo}
                        aria-label={`${f.nombreCompleto}: ${f.motivo}. Ver detalle`}
                        className="inline-flex min-h-11 items-center gap-1.5 rounded-full border bg-card px-3 text-sm text-foreground transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(38,59%,45%)]"
                      >
                        <IconoCat className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                        {f.nombre}
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}
        </>
      )}

      {mirar.length > 0 && (
        <section aria-labelledby="estado-mirar" className="min-w-0">
          <h3 id="estado-mirar" className="mb-2 text-sm font-semibold text-foreground">Qué mirar</h3>
          <ul className="min-w-0 divide-y divide-border/60 overflow-hidden rounded-xl border bg-card">
            {mirar.map((p) => {
              const t = TONO[p.gravedad === "rojo" ? "rojo" : "ambar"];
              const Icono = p.gravedad === "rojo" ? AlertOctagon : AlertTriangle;
              return (
                <li key={p.clave} data-pendiente={p.clave} data-gravedad={p.gravedad}>
                  <button
                    type="button"
                    onClick={() => onIr(p.destino)}
                    className="flex min-h-12 w-full min-w-0 items-center gap-3 px-3 py-2.5 text-left transition-colors hover:bg-muted/60 focus-visible:bg-muted/60 focus-visible:outline-none"
                  >
                    <Icono className={cn("h-5 w-5 shrink-0", t.texto)} aria-hidden="true" />
                    <span className="min-w-0 flex-1 break-words text-sm text-foreground">
                      <span className="sr-only">{p.gravedad === "rojo" ? "Urgente" : "Aviso"}: </span>
                      {p.titulo}
                    </span>
                    <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      <p className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
        <span role="status">{cargandoLecturas ? "Leyendo el consumo…" : `Última lectura ${haceCuanto(ultima)}`}</span>
        {porRevisar.map((p) => (
          <button
            key={p.clave}
            type="button"
            data-pendiente={p.clave}
            onClick={() => onIr(p.destino)}
            className="min-h-11 text-left underline underline-offset-2 hover:text-foreground sm:min-h-0"
          >
            {p.titulo}
          </button>
        ))}
      </p>
    </div>
  );
}
