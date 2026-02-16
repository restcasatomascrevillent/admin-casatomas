import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { useCrearBlacklist } from "@/hooks/useBlacklist";
import { ShieldBan, Phone, Mail, Clock, Users, Loader2 } from "lucide-react";
import { toast } from "sonner";

interface BlacklistModalProps {
  reserva: any | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function BlacklistModal({ reserva, open, onOpenChange }: BlacklistModalProps) {
  const [motivo, setMotivo] = useState("");
  const [tipo, setTipo] = useState<"email" | "telefono">("email");
  const crearBlacklist = useCrearBlacklist();

  useEffect(() => {
    if (reserva && open) {
      setMotivo("");
      setTipo(reserva.email ? "email" : "telefono");
    }
  }, [reserva, open]);

  const handleSubmit = async () => {
    if (!reserva) return;
    const valor = tipo === "email" ? reserva.email : reserva.telefono;
    if (!valor) {
      toast.error("No hay " + tipo + " para esta reserva");
      return;
    }
    await crearBlacklist.mutateAsync({
      tipo,
      valor,
      nombre: reserva.nombre || null,
      motivo: motivo.trim(),
    });
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ShieldBan className="h-5 w-5 text-destructive" />
            Añadir a Lista Negra
          </DialogTitle>
          <DialogDescription>
            Esta persona no podrá realizar futuras reservas.
          </DialogDescription>
        </DialogHeader>

        {reserva && (
          <div className="space-y-4">
            <div className="rounded-lg border bg-muted/30 p-3 space-y-1.5">
              <p className="text-sm font-semibold">{reserva.nombre || "Sin nombre"}</p>
              {reserva.email && (
                <p className="text-xs text-muted-foreground flex items-center gap-1.5">
                  <Mail className="h-3 w-3" /> {reserva.email}
                </p>
              )}
              {reserva.telefono && (
                <p className="text-xs text-muted-foreground flex items-center gap-1.5">
                  <Phone className="h-3 w-3" /> {reserva.telefono}
                </p>
              )}
              <p className="text-xs text-muted-foreground flex items-center gap-1.5">
                <Clock className="h-3 w-3" />
                {typeof reserva.hora === "string" ? reserva.hora.substring(0, 5) : reserva.hora}
                {" · "}
                <Users className="h-3 w-3" /> {reserva.numero_comensales} pax
              </p>
            </div>

            <div className="space-y-2">
              <Label className="text-sm">Bloquear por</Label>
              <Select value={tipo} onValueChange={(v) => setTipo(v as "email" | "telefono")}>
                <SelectTrigger className="h-9">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {reserva.email && <SelectItem value="email">Email: {reserva.email}</SelectItem>}
                  {reserva.telefono && <SelectItem value="telefono">Teléfono: {reserva.telefono}</SelectItem>}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label className="text-sm">Motivo del bloqueo</Label>
              <Textarea
                placeholder="Describe el motivo por el cual esta persona será bloqueada..."
                value={motivo}
                onChange={(e) => setMotivo(e.target.value)}
                rows={3}
              />
            </div>
          </div>
        )}

        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button
            variant="destructive"
            disabled={!motivo.trim() || crearBlacklist.isPending}
            onClick={handleSubmit}
          >
            {crearBlacklist.isPending ? (
              <><Loader2 className="h-4 w-4 animate-spin mr-1" /> Añadiendo...</>
            ) : (
              <><ShieldBan className="h-4 w-4 mr-1" /> Añadir a Lista Negra</>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
