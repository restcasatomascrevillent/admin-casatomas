import { KeyRound } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { FormularioCambioContrasena } from "./FormularioCambioContrasena";

/**
 * Solo el cambio de la PROPIA contraseña, en un diálogo (Super Admin › Usuarios,
 * «Cambiar mi contraseña»). Mismo formulario que «Mi cuenta». Al cambiarla se cierra.
 */
export function DialogoCambiarContrasena({
  open,
  onOpenChange,
  email,
  nombre,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  email?: string | null;
  nombre?: string;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[calc(100vw-1rem)] max-w-[calc(100vw-1rem)] rounded-xl p-4 sm:max-w-md sm:p-6">
        <DialogHeader className="text-left">
          <DialogTitle className="flex items-center gap-2">
            <KeyRound className="h-5 w-5 shrink-0" aria-hidden="true" />
            Cambiar mi contraseña
          </DialogTitle>
          <DialogDescription className="break-words [overflow-wrap:anywhere]">
            {nombre ? `La de tu cuenta (${nombre}). ` : ""}Para confirmar que eres tú, escribe primero la contraseña actual.
          </DialogDescription>
        </DialogHeader>
        <FormularioCambioContrasena email={email} autoFocus onCambiada={() => onOpenChange(false)} onCancelar={() => onOpenChange(false)} />
      </DialogContent>
    </Dialog>
  );
}
