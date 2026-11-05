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
import { plural } from "@/components/facturas/shared/formatters";

/**
 * Confirmación antes de «Clasificar N con IA» (QA 05/11/2026): un toque sin
 * querer lanzaba la IA sobre todas las líneas sin clasificar (cuesta dinero y
 * crea productos nuevos). Ahora dice qué va a pasar y pide confirmarlo.
 */
export function ConfirmarClasificarIA({
  abierto,
  lineas,
  onCerrar,
  onConfirmar,
}: {
  abierto: boolean;
  /** Líneas sin clasificar que se mandarán a la IA. */
  lineas: number;
  onCerrar: () => void;
  onConfirmar: () => void;
}) {
  return (
    <AlertDialog open={abierto} onOpenChange={(v) => !v && onCerrar()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>¿Clasificar {plural(lineas, "línea", "líneas")} con IA?</AlertDialogTitle>
          <AlertDialogDescription>
            La IA asignará cada línea sin clasificar a un producto del catálogo y, si no encaja en ninguno, creará uno nuevo. Tarda
            un poco y tiene un coste pequeño de IA. Después podrás corregir lo que no esté bien.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel className="h-11">Cancelar</AlertDialogCancel>
          <AlertDialogAction
            className="h-11"
            onClick={() => {
              onConfirmar();
              onCerrar();
            }}
          >
            Clasificar con IA
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
