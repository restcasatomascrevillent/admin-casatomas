import { useRef, useState } from "react";
import { Loader2, Mail } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useCanAccessSection } from "@/hooks/useUserRole";
import { Button } from "@/components/ui/button";
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

const ERROR_GENERICO = "No se pudo reenviar el correo. Vuelve a intentarlo.";

/**
 * Ante un 4xx/5xx supabase-js solo da «Edge Function returned a non-2xx status
 * code»: el motivo legible (p. ej. «falta RESEND_API_KEY…») viene en el cuerpo
 * de la respuesta, en `mensaje`.
 */
async function mensajeDelServidor(error: unknown): Promise<string | null> {
  const contexto = (error as { context?: unknown } | null)?.context;
  if (!contexto || typeof (contexto as Response).json !== "function") return null;
  try {
    const cuerpo = (await (contexto as Response).clone().json()) as { mensaje?: unknown };
    return typeof cuerpo?.mensaje === "string" && cuerpo.mensaje.trim() ? cuerpo.mensaje : null;
  } catch {
    return null;
  }
}

interface Props {
  id: string;
  codigo: string;
  email: string;
  /** Tras reenviarlo: recargar la compra para que «Correo enviado» se actualice. */
  onEnviado: () => void;
}

/**
 * «Reenviar correo al cliente» de un cheque comprado en la web y pagado
 * (acción `reenviar_email` de la función `cheques-regalo-admin`): vuelve a
 * mandar el correo con el mismo código y su PDF. Pide confirmación y necesita
 * permiso de edición de Cheques (lo vuelve a comprobar el servidor).
 */
export function ReenviarCorreoCliente({ id, codigo, email, onEnviado }: Props) {
  const { canAccess: puedeEditar } = useCanAccessSection("cheques", "edit");
  const [confirmando, setConfirmando] = useState(false);
  const [enviando, setEnviando] = useState(false);
  // Una clave por envío: si se corta la red y se repite, el servidor no manda dos correos.
  const clave = useRef<string | null>(null);

  if (!puedeEditar) return null;

  async function reenviar() {
    setConfirmando(false);
    setEnviando(true);
    clave.current ??= crypto.randomUUID();
    try {
      const { data, error } = await supabase.functions.invoke("cheques-regalo-admin", {
        body: { accion: "reenviar_email", id, clave_envio: clave.current },
      });
      if (error) {
        const mensaje = await mensajeDelServidor(error);
        // Con respuesta del servidor ya se sabe qué pasó; sin ella (red), se
        // guarda la clave por si el correo llegó a salir.
        if (mensaje) clave.current = null;
        toast.error(mensaje ?? ERROR_GENERICO);
        return;
      }
      clave.current = null;
      if (data?.email_enviado !== true) {
        toast.error(typeof data?.mensaje === "string" ? data.mensaje : ERROR_GENERICO);
        return;
      }
      toast.success(`Correo reenviado a ${email}.`, typeof data.aviso === "string" ? { description: data.aviso } : undefined);
      onEnviado();
    } catch {
      toast.error(ERROR_GENERICO);
    } finally {
      setEnviando(false);
    }
  }

  return (
    <>
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <Button variant="outline" disabled={enviando} onClick={() => setConfirmando(true)}>
          {enviando ? <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" /> : <Mail className="mr-2 h-4 w-4" aria-hidden="true" />}
          {enviando ? "Reenviando…" : "Reenviar correo al cliente"}
        </Button>
        <p className="text-xs text-muted-foreground">Vuelve a mandar el cheque y su PDF al comprador, con el mismo código.</p>
      </div>
      <AlertDialog open={confirmando} onOpenChange={setConfirmando}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Reenviar el correo al cliente?</AlertDialogTitle>
            <AlertDialogDescription className="break-words">
              Se enviará otra vez el correo con el cheque {codigo} y su PDF a {email}. El código no cambia.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>No, volver</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                void reenviar();
              }}
            >
              Sí, reenviar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
