// Alertas de Facturas en Análisis (20261107300000_facturas_alertas):
//   · «Requiere atención»: arriba del tablero, las 5 más importantes; cada una
//     abre un menú (abrir el documento, el
//     proveedor…). «Ver todas» abre los avisos de Facturas (la campana).
//   · MarcaAlerta / MarcasDeGrafica: el aviso dibujado en la propia gráfica.
//     Es un botón (44 px al tocar) que abre su texto: sin «pasar el ratón».
import { useState, type ReactNode } from "react";
import { AlertTriangle, ExternalLink, FileText, ShoppingCart } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { plural } from "@/components/facturas/shared/formatters";
import { TIPO_ICON, abrirAvisosSeccion } from "@/lib/avisos";
import { detalleCortoAlerta, resumenCortoAlerta, tituloCortoAlerta, type AlertaFacturas } from "@/lib/facturas/alertas";
import { FilaConMenu, FOCO, Tarjeta, type AccionMenu } from "./piezas";

const ICONO = "h-4 w-4 text-muted-foreground";
export const MAX_REQUIERE_ATENCION = 5;

/** Qué se puede hacer con una alerta desde Análisis. */
function accionesAlerta(a: AlertaFacturas, onIrA: (enlace: string) => void): AccionMenu[] {
  const d = a.datos;
  const acciones: AccionMenu[] = [];
  if (d.enlace) {
    const esDoc = d.enlace.includes("doc=");
    acciones.push({
      etiqueta: esDoc ? "Abrir el documento" : d.enlace.includes("prov=") ? "Abrir el proveedor en Compras" : "Abrir en Compras",
      icono: esDoc ? <FileText className={ICONO} aria-hidden /> : <ShoppingCart className={ICONO} aria-hidden />,
      onClick: () => onIrA(d.enlace as string),
    });
  }
  if (d.proveedorId !== null && !(d.enlace ?? "").includes("prov=")) {
    acciones.push({
      etiqueta: "Abrir el proveedor en Compras",
      icono: <ExternalLink className={ICONO} aria-hidden />,
      onClick: () => onIrA(`?tab=compras&modo=proveedores&prov=${d.proveedorId}`),
    });
  }
  return acciones;
}

function IconoAlerta({ a, className }: { a: AlertaFacturas; className?: string }) {
  const Icono = TIPO_ICON[a.tipo] ?? AlertTriangle;
  return <Icono className={cn("h-4 w-4 shrink-0", a.prioridad === "alta" ? "text-red-600 dark:text-red-400" : "text-amber-700 dark:text-amber-400", className)} aria-hidden />;
}

export function RequiereAtencion({
  alertas,
  onIrA,
  pendiente,
}: {
  alertas: AlertaFacturas[];
  onIrA: (enlace: string) => void;
  pendiente?: boolean;
}) {
  if (alertas.length === 0) return null;
  const visibles = alertas.slice(0, MAX_REQUIERE_ATENCION);
  const altas = alertas.filter((a) => a.prioridad === "alta").length;
  return (
    <Tarjeta
      titulo="Requiere atención"
      subtitulo={`${plural(alertas.length, "alerta", "alertas")}${altas ? ` · ${plural(altas, "importante", "importantes")}` : ""} · se revisan cada mañana`}
      resumen={`Alertas: ${visibles.map((a) => a.titulo).join("; ")}.`}
      testId="tarjeta-requiere-atencion"
      className="border-amber-300/70 bg-amber-50/40 dark:border-amber-500/30 dark:bg-amber-950/10"
      accion={
        <button
          type="button"
          onClick={() => abrirAvisosSeccion("facturas")}
          className={cn("-mt-1.5 inline-flex min-h-9 items-center rounded-md px-2 text-xs font-medium text-primary hover:bg-muted pointer-coarse:min-h-11", FOCO)}
        >
          Ver todas{alertas.length > visibles.length ? ` (${alertas.length})` : ""}
        </button>
      }
    >
      <ul className="space-y-0.5 @[52rem]:grid @[52rem]:grid-cols-2 @[52rem]:gap-x-6 @[52rem]:space-y-0" aria-label="Alertas que requieren atención">
        {visibles.map((a) => (
          <li key={a.id}>
            <FilaConMenu
              nombre={`${a.prioridad === "alta" ? "Importante: " : ""}${a.titulo}. ${a.mensaje} Opciones`}
              acciones={pendiente ? [] : accionesAlerta(a, onIrA)}
              cabecera={{ titulo: tituloCortoAlerta(a), detalle: detalleCortoAlerta(a) }}
              title={a.mensaje}
              className={cn(
                "grid min-h-11 w-full grid-cols-[auto_minmax(0,1fr)] items-start gap-x-2 rounded-md px-1.5 py-1.5 text-left hover:bg-muted/50 disabled:cursor-default disabled:hover:bg-transparent",
                FOCO,
              )}
            >
              <IconoAlerta a={a} className="mt-0.5" />
              <span className="min-w-0">
                <span className={cn("block text-sm [overflow-wrap:anywhere]", !a.leida && "font-medium")}>
                  {a.prioridad === "alta" && <span className="mr-1 rounded bg-red-500/10 px-1 text-xs font-semibold text-red-700 dark:text-red-400">Importante</span>}
                  {tituloCortoAlerta(a)}
                </span>
                {/* Resumen corto propio, no el mensaje largo recortado (09/11/2026). */}
                <span className="block text-xs text-muted-foreground tabular-nums [overflow-wrap:anywhere]">{resumenCortoAlerta(a)}</span>
              </span>
            </FilaConMenu>
          </li>
        ))}
      </ul>
    </Tarjeta>
  );
}

/** Texto de las alertas de un punto (para el globo, la tira del punto elegido y los lectores de pantalla). */
const textoAlertas = (alertas: AlertaFacturas[]): string => alertas.map((a) => a.titulo).join(" · ");

function ListaTextos({ alertas, onIrA }: { alertas: AlertaFacturas[]; onIrA?: (enlace: string) => void }) {
  return (
    <ul className="space-y-2">
      {alertas.map((a) => (
        <li key={a.id} className="flex gap-2">
          <IconoAlerta a={a} className="mt-0.5" />
          <div className="min-w-0">
            <p className="text-sm font-medium [overflow-wrap:anywhere]">{a.titulo}</p>
            <p className="text-xs text-muted-foreground [overflow-wrap:anywhere]">{a.mensaje}</p>
            {onIrA && a.datos.enlace && (
              <button
                type="button"
                onClick={() => onIrA(a.datos.enlace as string)}
                className={cn("mt-1 inline-flex min-h-9 items-center gap-1 rounded-md px-1.5 text-xs font-medium text-primary hover:bg-muted pointer-coarse:min-h-11", FOCO)}
              >
                <ExternalLink className="h-3.5 w-3.5" aria-hidden />
                {a.datos.enlace.includes("doc=") ? "Abrir el documento" : "Abrir en Compras"}
              </button>
            )}
          </div>
        </li>
      ))}
    </ul>
  );
}

/**
 * Marca de aviso sobre un punto de una gráfica (mes, familia, proveedor): un
 * triángulo ámbar (rojo si alguna es importante) que al tocarlo enseña sus
 * alertas.
 */
export function MarcaAlerta({
  alertas,
  etiqueta,
  onIrA,
  className,
  children,
}: {
  alertas: AlertaFacturas[];
  /** De qué punto es («septiembre de 2026»). */
  etiqueta: string;
  onIrA?: (enlace: string) => void;
  className?: string;
  children?: ReactNode;
}) {
  const [abierto, setAbierto] = useState(false);
  if (alertas.length === 0) return null;
  const alta = alertas.some((a) => a.prioridad === "alta");
  const nombre = `${plural(alertas.length, "alerta", "alertas")} en ${etiqueta}: ${textoAlertas(alertas)}`;
  return (
    <Popover open={abierto} onOpenChange={setAbierto}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={nombre}
          title={nombre}
          data-alerta-marca
          className={cn(
            "relative inline-flex h-6 min-w-6 items-center justify-center gap-0.5 rounded-full px-1 text-xs font-semibold",
            // 44 px de área al tocar sin agrandar el dibujo.
            "after:absolute after:-inset-2.5 after:content-[''] pointer-coarse:after:-inset-3",
            alta ? "bg-red-100 text-red-700 dark:bg-red-500/20 dark:text-red-300" : "bg-amber-100 text-amber-800 dark:bg-amber-500/20 dark:text-amber-300",
            FOCO,
            className,
          )}
        >
          <AlertTriangle className="h-3.5 w-3.5" aria-hidden />
          {children ?? (alertas.length > 1 ? <span className="tabular-nums">{alertas.length}</span> : null)}
        </button>
      </PopoverTrigger>
      <PopoverContent align="center" className="pointer-events-auto w-80 max-w-[calc(100vw-2rem)] p-3" aria-label={`Alertas de ${etiqueta}`} collisionPadding={12}>
        <p className="mb-2 text-xs font-semibold uppercase tracking-[0.06em] text-muted-foreground">{etiqueta}</p>
        <ListaTextos
          alertas={alertas}
          onIrA={
            onIrA
              ? (e) => {
                  setAbierto(false);
                  onIrA(e);
                }
              : undefined
          }
        />
      </PopoverContent>
    </Popover>
  );
}

/**
 * Debajo de una gráfica: un botón por punto con alertas (la versión que se
 * puede tocar y leer de las marcas dibujadas en la gráfica).
 */
export function MarcasDeGrafica({
  puntos,
  onIrA,
}: {
  puntos: { clave: string; etiqueta: string; alertas: AlertaFacturas[] }[];
  onIrA?: (enlace: string) => void;
}) {
  const con = puntos.filter((p) => p.alertas.length > 0);
  if (con.length === 0) return null;
  return (
    <ul className="flex flex-wrap items-center gap-x-3 gap-y-2 pt-1 text-xs" aria-label="Alertas en esta gráfica" data-testid="marcas-alertas">
      {con.map((p) => (
        <li key={p.clave} className="inline-flex min-w-0 items-center gap-1.5">
          <MarcaAlerta alertas={p.alertas} etiqueta={p.etiqueta} onIrA={onIrA} />
          <span className="min-w-0 text-muted-foreground [overflow-wrap:anywhere]" aria-hidden>
            {p.etiqueta}: {tituloCortoAlerta(p.alertas[0])}
            {p.alertas.length > 1 ? ` y ${p.alertas.length - 1} más` : ""}
          </span>
        </li>
      ))}
    </ul>
  );
}
