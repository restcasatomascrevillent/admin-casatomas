import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { camposLegibles, resumenEntrada } from "@/lib/auditoria";
import type { AuditLogEntry } from "@/hooks/useAuditLog";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";

type Preview = {
  operacion: string;
  actual: Record<string, unknown> | null;
  restaurado: Record<string, unknown> | null;
};
export function RevertirCambioDialog({
  entrada,
  onClose,
}: {
  entrada: AuditLogEntry;
  onClose: () => void;
}) {
  const [preview, setPreview] = useState<Preview | null>(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let active = true;
    setPreview(null);
    setError("");
    setPassword("");
    void supabase.functions
      .invoke("auditoria-revertir", { body: { evento_id: entrada.id } })
      .then(async ({ data, error }) => {
        if (!active) return;
        if (error || !data?.success) {
          const body = await error?.context?.json?.().catch(() => null);
          if (active)
            setError(
              body?.error ?? data?.error ?? "No se pudo preparar la reversión",
            );
        } else setPreview(data.preview);
      })
      .catch(() => {
        if (active) setError("No se pudo preparar la reversión");
      });
    return () => {
      active = false;
    };
  }, [entrada.id]);
  const confirmar = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!preview || busy) return;
    setBusy(true);
    setError("");
    try {
      const { data, error } = await supabase.functions.invoke(
        "auditoria-revertir",
        { body: { evento_id: entrada.id, confirmar: true, email, password } },
      );
      if (error || !data?.success) {
        const body = await error?.context?.json?.().catch(() => null);
        throw new Error(
          body?.error ?? data?.error ?? "No se pudo revertir el cambio",
        );
      }
      toast.success("Cambio revertido y registrado en auditoría");
      window.dispatchEvent(new Event("auditoria-actualizada"));
      onClose();
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "No se pudo revertir el cambio",
      );
    } finally {
      setPassword("");
      setBusy(false);
    }
  };
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !busy) onClose();
      }}
    >
      <DialogContent
        onEscapeKeyDown={(e) => {
          if (busy) e.preventDefault();
        }}
        onPointerDownOutside={(e) => {
          if (busy) e.preventDefault();
        }}
      >
        <DialogHeader>
          <DialogTitle>Revertir cambio</DialogTitle>
          <DialogDescription>
            {resumenEntrada(entrada)}. Comprueba la restauración y valida con
            tus credenciales de superadmin.
          </DialogDescription>
        </DialogHeader>
        {!preview && !error && (
          <p role="status" className="flex items-center gap-2">
            <Loader2 className="h-4 w-4 animate-spin" /> Comprobando el estado
            actual…
          </p>
        )}
        {preview && (
          <div className="rounded-md border p-3 text-sm">
            <p className="mb-2 font-medium">
              {preview.operacion === "eliminar"
                ? "Se eliminará el registro creado"
                : "Se restaurarán estos datos"}
            </p>
            <dl className="max-h-52 space-y-2 overflow-y-auto">
              {camposLegibles(preview.restaurado ?? preview.actual).map((c) => (
                <div key={c.campo}>
                  <dt className="font-medium">{c.etiqueta}</dt>
                  <dd className="break-words text-muted-foreground">
                    {c.valor}
                  </dd>
                </div>
              ))}
            </dl>
          </div>
        )}
        <form onSubmit={confirmar} className="space-y-3">
          <div className="space-y-1">
            <Label htmlFor="reversion-email">
              Usuario / correo de superadmin
            </Label>
            <Input
              id="reversion-email"
              type="email"
              autoComplete="username"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              disabled={busy || !preview}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="reversion-password">Contraseña</Label>
            <Input
              id="reversion-password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              disabled={busy || !preview}
            />
          </div>
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          <div className="flex flex-wrap justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={onClose}
              disabled={busy}
            >
              Cancelar
            </Button>
            <Button
              type="submit"
              variant="destructive"
              disabled={busy || !preview}
            >
              {busy ? "Restaurando…" : "Validar y revertir"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
