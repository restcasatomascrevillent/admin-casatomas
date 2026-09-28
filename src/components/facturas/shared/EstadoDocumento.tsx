import { AlertTriangle, CheckCircle2, EyeOff } from "lucide-react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import type { AlertaValidacion } from "@/hooks/useFacturas";
import { INSIGNIA } from "./tabla";

// ---------------------------------------------------------------------------
// Estado de lectura de un documento
// ---------------------------------------------------------------------------
// Antes esto eran dos insignias sueltas pegadas al numero de documento:
//
//   · `BadgeAlertas`      un triangulo y un numero ("⚠ 1"). No decia QUE
//     pasaba. El albaran 2509134 de Joselito trae 12 jamones a 9.316,67 €/ud
//     = 111.800 € sobre un total de 120.580 €: un error de lectura del OCR de
//     seis cifras, escondido detras de un icono de 12 px. El dueño lo dijo
//     tal cual: "un importe de 120.580 € en un restaurante deberia saltar a
//     la vista, no esconderse tras un icono".
//   · `BadgeSinVerificar`  decia "Sin revisar" pero no decia que hacer, y no
//     llevaba a ningun sitio.
//
// Ahora las dos van juntas en su propia columna y la insignia de aviso lleva
// el PROBLEMA escrito ("IVA no cuadra", "Precio extremo"). El mensaje completo
// que genero `validar_cordura_factura` sigue en el tooltip. Y "Sin revisar" es
// un boton: abre el mismo dialogo donde esta el interruptor "Marcar como
// verificada", que era lo unico que faltaba para cerrar el circulo.

/**
 * Etiqueta corta de cada codigo de `validar_cordura_factura`. Van cortas a
 * proposito: la columna mide ~104 px en la franja estrecha y la insignia no
 * puede romper a dos lineas sin descuadrar el alto de la fila. El texto
 * completo del aviso se lee en el tooltip.
 */
const ETIQUETAS_ALERTA: Record<string, string> = {
  iva_incoherente: "IVA no cuadra",
  descuadre_cabecera: "No cuadra",
  descuadre_linea: "Línea mal",
  precio_unitario_extremo: "Precio extremo",
  precio_atipico_historico: "Precio atípico",
  precio_atipico_pagina: "Precio atípico",
  total_documento_extremo: "Total enorme",
  total_documento_irrisorio: "Total ínfimo",
};

/** Codigo desconocido: se enseña el codigo en limpio antes que un numero suelto. */
export const etiquetaAlerta = (codigo: string): string =>
  ETIQUETAS_ALERTA[codigo] ?? codigo.replace(/_/g, " ");

interface EstadoDocumentoProps {
  alertas: AlertaValidacion[];
  verificada: boolean;
  /** Abre el dialogo de edicion, que es donde se marca como verificada. */
  onRevisar: () => void;
  /** En las tarjetas hay sitio de sobra: se pintan todas las alertas. */
  compacto?: boolean;
}

export function EstadoDocumento({ alertas, verificada, onRevisar, compacto = true }: EstadoDocumentoProps) {
  const lista = alertas ?? [];
  const graves = lista.filter((a) => a.severidad === "alta");
  // En la tabla solo cabe una insignia de aviso; el resto se resume en "+N".
  const visibles = compacto ? lista.slice(0, 1) : lista;
  const ocultas = lista.length - visibles.length;

  return (
    <div className="flex flex-col items-start gap-1">
      {visibles.map((a, i) => {
        const color =
          a.severidad === "alta"
            ? "border-red-200 bg-red-50 text-red-700"
            : "border-amber-200 bg-amber-50 text-amber-700";
        return (
          <TooltipProvider key={i}>
            <Tooltip>
              <TooltipTrigger asChild>
                <span onClick={(e) => e.stopPropagation()} className={`${INSIGNIA} ${color}`}>
                  <AlertTriangle className="h-3 w-3 shrink-0" />
                  {etiquetaAlerta(a.codigo)}
                  {ocultas > 0 && i === visibles.length - 1 && <span className="opacity-70">+{ocultas}</span>}
                </span>
              </TooltipTrigger>
              <TooltipContent className="max-w-xs">
                <p className="mb-1 font-semibold">
                  {graves.length > 0 ? "Importes que no cuadran" : "Importes que conviene revisar"}
                </p>
                <ul className="list-disc space-y-1 pl-4 text-xs">
                  {lista.slice(0, 4).map((x, j) => (
                    <li key={j}>{x.mensaje}</li>
                  ))}
                </ul>
                {lista.length > 4 && <p className="mt-1 text-xs opacity-70">y {lista.length - 4} más…</p>}
                <p className="mt-2 text-xs opacity-80">
                  Lo leyó el OCR: comprueba el documento original y corrígelo en "Editar".
                </p>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        );
      })}

      {verificada ? (
        <span className={`${INSIGNIA} border-emerald-200 bg-emerald-50 text-emerald-700`}>
          <CheckCircle2 className="h-3 w-3 shrink-0" />
          Revisada
        </span>
      ) : (
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onRevisar();
                }}
                className={`${INSIGNIA} border-slate-200 bg-slate-50 text-slate-600 transition-colors hover:border-slate-300 hover:bg-slate-100 hover:text-slate-900`}
              >
                <EyeOff className="h-3 w-3 shrink-0" />
                Sin revisar
              </button>
            </TooltipTrigger>
            <TooltipContent className="max-w-xs">
              <p>
                Nadie ha comprobado todavía que lo leído coincide con el papel. Pulsa para abrirlo y, si está
                bien, activa "Marcar como verificada".
              </p>
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      )}
    </div>
  );
}

export type FiltroRevision = "todos" | "avisos" | "sin_revisar";

/**
 * Resumen de la pestaña, y a la vez su filtro.
 *
 * Antes el pie de la tabla decia solo "5 total", que no invita a nada. Con los
 * datos reales de produccion —5 documentos, NINGUNO verificado, 2 con avisos y
 * siete meses sin subir nada— la pregunta que uno se hace al abrir la pantalla
 * es "¿que me falta por mirar?", y no habia forma de responderla sin recorrer
 * los documentos de uno en uno. Los contadores son botones: filtran.
 */
export function ResumenRevision({
  total,
  conAvisos,
  sinRevisar,
  filtro,
  onFiltro,
}: {
  total: number;
  conAvisos: number;
  sinRevisar: number;
  filtro: FiltroRevision;
  onFiltro: (f: FiltroRevision) => void;
}) {
  const chip = (activo: boolean, tono: string) =>
    `inline-flex h-8 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-md border px-2.5 text-xs font-medium transition-colors ${
      activo ? tono : "border-border/60 bg-background text-muted-foreground hover:bg-muted/60"
    }`;

  return (
    <div className="flex shrink-0 items-center gap-2">
      <button
        type="button"
        onClick={() => onFiltro("todos")}
        className={chip(filtro === "todos", "border-primary/40 bg-primary/10 text-primary")}
        title="Ver todos los documentos"
      >
        <span className="tabular-nums">{total}</span> en total
      </button>
      {conAvisos > 0 && (
        <button
          type="button"
          onClick={() => onFiltro(filtro === "avisos" ? "todos" : "avisos")}
          className={chip(filtro === "avisos", "border-red-300 bg-red-50 text-red-700")}
          title="Solo los documentos cuyos importes no cuadran"
        >
          <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
          <span className="tabular-nums">{conAvisos}</span> con avisos
        </button>
      )}
      {sinRevisar > 0 && (
        <button
          type="button"
          onClick={() => onFiltro(filtro === "sin_revisar" ? "todos" : "sin_revisar")}
          className={chip(filtro === "sin_revisar", "border-slate-300 bg-slate-100 text-slate-800")}
          title="Solo los documentos que nadie ha comprobado todavía"
        >
          <EyeOff className="h-3.5 w-3.5 shrink-0" />
          <span className="tabular-nums">{sinRevisar}</span> sin revisar
        </button>
      )}
    </div>
  );
}
