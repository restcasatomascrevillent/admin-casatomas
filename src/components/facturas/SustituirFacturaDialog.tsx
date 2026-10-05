import { useState } from "react";
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
import type { Sustituible } from "@/lib/facturas/documentoLargo";

const eur = (n: number | null | undefined) =>
  n === null || n === undefined ? "sin total" : `${n.toLocaleString("es-ES", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`;

interface Props {
  sustituible: Sustituible | null;
  onCancelar: () => void;
  onConfirmar: (s: Sustituible) => Promise<void>;
}

/**
 * Confirmación de «Sustituir la existente» (decisión del dueño, 05-oct-2026):
 * enseña la fila que hay ahora (total, nº de líneas, avisos) frente a la
 * nueva antes de reemplazarla EN SITIO (mismo id; copia de auditoría en
 * facturas_sustituciones).
 */
export function SustituirFacturaDialog({ sustituible, onCancelar, onConfirmar }: Props) {
  const [enviando, setEnviando] = useState(false);
  const e = sustituible?.existente;
  const n = sustituible?.nuevo;

  return (
    <AlertDialog open={!!sustituible} onOpenChange={(abierto) => { if (!abierto && !enviando) onCancelar(); }}>
      <AlertDialogContent className="max-h-[90dvh] overflow-y-auto">
        <AlertDialogHeader>
          <AlertDialogTitle>¿Sustituir la factura {e?.numero_documento}?</AlertDialogTitle>
          <AlertDialogDescription>
            Se reemplazan la cabecera y todas las líneas de la factura que ya existe por las del documento que acabas
            de subir. Se conserva el mismo número interno y se guarda una copia de la versión actual.
          </AlertDialogDescription>
        </AlertDialogHeader>
        {e && n && (
          <div className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-2">
            <div className="rounded-md border p-3">
              <p className="mb-1 font-medium">Ahora (factura {e.id})</p>
              <p>{e.proveedor ?? "Proveedor sin leer"} · {e.fecha ?? "sin fecha"}</p>
              <p>Total: <strong>{eur(e.total)}</strong>{e.total_origen === "deducido" ? " (calculado)" : ""}</p>
              <p>Líneas: <strong>{e.lineas}</strong></p>
              <p>
                Avisos: <strong>{e.alertas}</strong>
                {e.alertas_graves > 0 ? <span className="text-destructive"> ({e.alertas_graves} graves)</span> : null}
              </p>
            </div>
            <div className="rounded-md border border-primary/40 bg-primary/5 p-3">
              <p className="mb-1 font-medium">Documento nuevo</p>
              <p>{n.proveedor ?? "Proveedor sin leer"} · {n.fecha}</p>
              <p>Total: <strong>{eur(n.total)}</strong>{n.total_origen === "deducido" ? " (calculado)" : ""}</p>
              <p>Líneas: <strong>{n.lineas}</strong></p>
              <p>Avisos: <strong>{n.alertas}</strong></p>
            </div>
          </div>
        )}
        <AlertDialogFooter className="gap-2">
          <AlertDialogCancel className="h-11 pointer-coarse:h-12" disabled={enviando}>
            No, dejar la que hay
          </AlertDialogCancel>
          <AlertDialogAction
            className="h-11 pointer-coarse:h-12"
            disabled={enviando}
            onClick={async (ev) => {
              ev.preventDefault();
              if (!sustituible) return;
              setEnviando(true);
              try {
                await onConfirmar(sustituible);
              } finally {
                setEnviando(false);
              }
            }}
          >
            {enviando ? <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" /> : null}
            Sí, sustituir
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
