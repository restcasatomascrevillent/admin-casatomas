import { useCallback, useEffect, useState } from "react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Loader2 } from "lucide-react";
import {
  type Anadible,
  type Esperado,
  FacturaCambiada,
  leerResumenFactura,
  motivoBloqueo,
  type ResumenExistente,
  type Sustituible,
} from "@/lib/facturas/documentoLargo";

const eur = (n: number | null | undefined) =>
  n === null || n === undefined ? "sin total" : `${n.toLocaleString("es-ES", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`;

/** «2026-10-01» → «01/10/2026» (lo demás, tal cual). */
const fechaEs =(f: string | null | undefined) =>
  f && /^\d{4}-\d{2}-\d{2}/.test(f) ? f.slice(0, 10).split("-").reverse().join("/") : f ?? null;

/** Qué se va a hacer con el documento nuevo. */
export type DecisionDuplicado = { tipo: "sustituir"; s: Sustituible } | { tipo: "anadir"; a: Anadible };

interface Props {
  /** Compatibilidad: solo «Sustituir». */
  sustituible?: Sustituible | null;
  decision?: DecisionDuplicado | null;
  /** Cerrar sin decidir («Decidir luego», Escape): sigue pendiente. */
  onCancelar: () => void;
  /**
   * «No, dejar la que hay» / «No añadirla»: decide NO usar el documento nuevo
   * (lo descarta). Sin esta prop, el botón solo cierra (compatibilidad).
   */
  onDejar?: () => void;
  /** Confirmado con lo que el usuario ve AHORA (`esperado`). Lanza FacturaCambiada si la factura cambió. */
  onConfirmar: (esperado: Esperado) => Promise<void>;
  /** Relectura de la existente (tests). */
  leerResumen?: (id: number) => Promise<ResumenExistente | null>;
}

/**
 * Confirmación de «Sustituir la existente» (decisión del dueño, 05-oct-2026)
 * y de «Añadir como página x» (revisión del 10/10/2026). Al abrirse RELEE la
 * factura existente (líneas, avisos, updated_at) en vez de enseñar la foto de
 * cuando se detectó el duplicado, y confirma con eso. No deja sustituir si la
 * existente aún se está guardando o no tiene líneas; si el servidor aborta
 * porque la factura cambió, lo dice, la vuelve a leer y deja confirmar de nuevo.
 */
export function SustituirFacturaDialog({
  sustituible,
  decision: decisionProp,
  onCancelar,
  onDejar,
  onConfirmar,
  leerResumen = leerResumenFactura,
}: Props) {
  const decision: DecisionDuplicado | null = decisionProp ?? (sustituible ? { tipo: "sustituir", s: sustituible } : null);
  const oferta = decision ? (decision.tipo === "sustituir" ? decision.s : decision.a) : null;
  const [enviando, setEnviando] = useState(false);
  const [actual, setActual] = useState<ResumenExistente | null>(null);
  const [cargando, setCargando] = useState(false);
  const [aviso, setAviso] = useState<string | null>(null);
  const idExistente = oferta?.existente.id ?? null;
  const trabajo = oferta?.trabajo_id ?? null;

  const releer = useCallback(async () => {
    if (idExistente === null) return;
    setCargando(true);
    try {
      setActual(await leerResumen(idExistente));
    } catch {
      setActual(null);
    } finally {
      setCargando(false);
    }
  }, [idExistente, leerResumen]);

  useEffect(() => {
    setAviso(null);
    setActual(null);
    if (idExistente !== null) void releer();
  }, [idExistente, trabajo, releer]);

  // Sin la RPC (migración sin aplicar) se enseña lo que se vio al detectarlo.
  const e = actual ?? oferta?.existente;
  const n = oferta?.nuevo;
  const operacion = decision?.tipo ?? "sustituir";
  const bloqueo = e ? motivoBloqueo(e, operacion) : null;
  const pagina = decision?.tipo === "anadir" ? decision.a.pagina : null;

  return (
    <AlertDialog open={!!decision} onOpenChange={(abierto) => { if (!abierto && !enviando) onCancelar(); }}>
      <AlertDialogContent className="max-h-[90dvh] overflow-y-auto">
        <AlertDialogHeader>
          <AlertDialogTitle>
            {pagina
              ? `¿Añadir como página ${pagina.actual} de ${pagina.total} a la factura ${e?.numero_documento}?`
              : `¿Sustituir la factura ${e?.numero_documento}?`}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {pagina
              ? "Se añaden las líneas del documento que acabas de subir a la factura que ya existe, sin borrar las suyas, " +
                "y se recalculan los importes. Se guarda una copia de la versión actual."
              : "Se reemplazan la cabecera y todas las líneas de la factura que ya existe por las del documento que acabas " +
                "de subir. Se conserva el mismo número interno y se guarda una copia de la versión actual."}
          </AlertDialogDescription>
        </AlertDialogHeader>
        {e && n && (
          <div className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-2">
            <div className="rounded-md border p-3" aria-busy={cargando}>
              <p className="mb-1 font-medium">Ahora (factura {e.id})</p>
              <p>{e.proveedor ?? "Proveedor sin leer"} · {fechaEs(e.fecha) ?? "sin fecha"}</p>
              <p>Total: <strong>{eur(e.total)}</strong>{e.total_origen === "deducido" ? " (calculado)" : ""}</p>
              <p>Líneas: <strong>{e.lineas}</strong></p>
              <p>
                Avisos: <strong>{e.alertas}</strong>
                {e.alertas_graves > 0 ? <span className="text-destructive"> ({e.alertas_graves} graves)</span> : null}
              </p>
            </div>
            <div className="rounded-md border border-primary/40 bg-primary/5 p-3">
              <p className="mb-1 font-medium">{pagina ? `Página ${pagina.actual} nueva` : "Documento nuevo"}</p>
              <p>{n.proveedor ?? "Proveedor sin leer"} · {fechaEs(n.fecha) ?? "sin fecha"}</p>
              <p>Total: <strong>{eur(n.total)}</strong>{n.total_origen === "deducido" ? " (calculado)" : ""}</p>
              <p>Líneas: <strong>{n.lineas}</strong></p>
              <p>Avisos: <strong>{n.alertas}</strong></p>
            </div>
          </div>
        )}
        {(aviso || bloqueo) && (
          <p role="alert" className="rounded-md bg-amber-50 p-3 text-sm text-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
            {aviso ?? bloqueo}
          </p>
        )}
        <AlertDialogFooter className="flex-col-reverse gap-2 sm:flex-row sm:flex-wrap sm:space-x-0">
          {/* Cerrar sin decidir: sigue en «Pendientes de decidir». */}
          <AlertDialogCancel
            className="mt-0 h-11 border-transparent text-muted-foreground shadow-none pointer-coarse:h-12 sm:mr-auto"
            disabled={enviando}
          >
            Decidir luego
          </AlertDialogCancel>
          {/* Decidir que NO: se descarta el documento nuevo (deja de estar pendiente). */}
          <AlertDialogCancel className="mt-0 h-11 pointer-coarse:h-12" disabled={enviando} onClick={() => onDejar?.()}>
            {pagina ? "No añadirla" : "No, dejar la que hay"}
          </AlertDialogCancel>
          <AlertDialogAction
            className="h-11 pointer-coarse:h-12"
            disabled={enviando || cargando || !!bloqueo || !e}
            onClick={async (ev) => {
              ev.preventDefault();
              if (!decision || !e) return;
              setEnviando(true);
              setAviso(null);
              try {
                await onConfirmar({ lineas: e.lineas, updated_at: e.updated_at ?? null });
              } catch (err) {
                // Se queda abierto con el motivo; si la factura cambió, se relee para confirmar de nuevo.
                setAviso(err instanceof Error ? err.message : String(err));
                if (err instanceof FacturaCambiada) await releer();
              } finally {
                setEnviando(false);
              }
            }}
          >
            {enviando ? <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" /> : null}
            {pagina ? "Sí, añadir la página" : "Sí, sustituir"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
