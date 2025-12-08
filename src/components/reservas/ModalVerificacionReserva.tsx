import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { format } from "date-fns";
import { es } from "date-fns/locale";
import { CalendarIcon, Loader2, CheckCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import { useEspaciosReserva } from "@/hooks/useEspaciosReserva";

interface Reservation {
  id: string;
  fecha: string;
  hora: string;
  numero_comensales: number;
  estado: string;
  notas_cliente: string | null;
  nombre: string;
  telefono: string;
  email: string | null;
  sala_id: string;
  espacios_reserva: {
    nombre: string;
  } | null;
}

interface ModalVerificacionReservaProps {
  reserva: Reservation | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess: () => void;
}

const HORARIOS_DISPONIBLES = [
  "13:00",
  "13:30",
  "14:00",
  "14:30",
  "15:00",
  "15:30",
  "20:30",
  "21:00",
  "21:30",
  "22:00",
  "22:30",
];

export function ModalVerificacionReserva({ 
  reserva, 
  open, 
  onOpenChange, 
  onSuccess 
}: ModalVerificacionReservaProps) {
  const { data: espacios } = useEspaciosReserva();
  const [saving, setSaving] = useState(false);
  
  // Form state
  const [nombre, setNombre] = useState("");
  const [telefono, setTelefono] = useState("");
  const [email, setEmail] = useState("");
  const [fecha, setFecha] = useState<Date | undefined>(undefined);
  const [hora, setHora] = useState("");
  const [numComensales, setNumComensales] = useState(1);
  const [salaId, setSalaId] = useState("");
  const [notas, setNotas] = useState("");

  // Sync form state when reserva changes
  const initializeForm = () => {
    if (reserva) {
      setNombre(reserva.nombre || "");
      setTelefono(reserva.telefono || "");
      setEmail(reserva.email || "");
      setFecha(reserva.fecha ? new Date(reserva.fecha) : undefined);
      setHora(reserva.hora || "");
      setNumComensales(reserva.numero_comensales || 1);
      setSalaId(reserva.sala_id || "");
      setNotas(reserva.notas_cliente || "");
    }
  };

  // Initialize when modal opens
  const handleOpenChange = (isOpen: boolean) => {
    if (isOpen && reserva) {
      initializeForm();
    }
    onOpenChange(isOpen);
  };

  const handleVerificar = async () => {
    if (!reserva) return;
    
    if (!nombre.trim() || !telefono.trim() || !fecha || !hora || !salaId) {
      toast.error("Por favor completa todos los campos obligatorios");
      return;
    }

    setSaving(true);
    try {
      const updatedData = {
        nombre: nombre.trim(),
        telefono: telefono.trim(),
        email: email.trim() || null,
        fecha: format(fecha, "yyyy-MM-dd"),
        hora,
        numero_comensales: numComensales,
        sala_id: salaId,
        notas_cliente: notas.trim() || null,
        estado: "verificada",
      };

      const { error } = await supabase
        .from("reservas")
        .update(updatedData)
        .eq("id", reserva.id);

      if (error) {
        toast.error("Error al verificar la reserva");
        console.error(error);
        return;
      }

      toast.success("Reserva verificada correctamente");

      // Enviar webhook
      supabase.functions.invoke('notify-reservation-change', {
        body: { ...reserva, ...updatedData }
      }).catch(err => console.error('Error notifying webhook:', err));

      onOpenChange(false);
      onSuccess();
    } finally {
      setSaving(false);
    }
  };

  if (!reserva) return null;

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Verificar Reserva</DialogTitle>
        </DialogHeader>

        <div className="space-y-6 py-4">
          {/* Información del Cliente */}
          <div className="space-y-4">
            <h4 className="text-sm font-medium text-muted-foreground">Información del Cliente</h4>
            
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="nombre">Nombre *</Label>
                <Input
                  id="nombre"
                  value={nombre}
                  onChange={(e) => setNombre(e.target.value)}
                  placeholder="Nombre del cliente"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="telefono">Teléfono *</Label>
                <Input
                  id="telefono"
                  value={telefono}
                  onChange={(e) => setTelefono(e.target.value)}
                  placeholder="Teléfono"
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="email@ejemplo.com"
              />
            </div>
          </div>

          {/* Detalles de la Reserva */}
          <div className="space-y-4">
            <h4 className="text-sm font-medium text-muted-foreground">Detalles de la Reserva</h4>
            
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Fecha *</Label>
                <Popover>
                  <PopoverTrigger asChild>
                    <Button
                      variant="outline"
                      className={cn(
                        "w-full justify-start text-left font-normal",
                        !fecha && "text-muted-foreground"
                      )}
                    >
                      <CalendarIcon className="mr-2 h-4 w-4" />
                      {fecha ? format(fecha, "d MMM yyyy", { locale: es }) : "Seleccionar"}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0" align="start">
                    <Calendar
                      mode="single"
                      selected={fecha}
                      onSelect={setFecha}
                      initialFocus
                      className="pointer-events-auto"
                    />
                  </PopoverContent>
                </Popover>
              </div>

              <div className="space-y-2">
                <Label>Hora *</Label>
                <Select value={hora} onValueChange={setHora}>
                  <SelectTrigger>
                    <SelectValue placeholder="Seleccionar hora" />
                  </SelectTrigger>
                  <SelectContent>
                    {HORARIOS_DISPONIBLES.map((h) => (
                      <SelectItem key={h} value={h}>
                        {h}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="comensales">Nº Comensales *</Label>
                <Input
                  id="comensales"
                  type="number"
                  min={1}
                  value={numComensales}
                  onChange={(e) => setNumComensales(parseInt(e.target.value) || 1)}
                />
              </div>

              <div className="space-y-2">
                <Label>Sala *</Label>
                <Select value={salaId} onValueChange={setSalaId}>
                  <SelectTrigger>
                    <SelectValue placeholder="Seleccionar sala" />
                  </SelectTrigger>
                  <SelectContent>
                    {espacios?.map((e) => (
                      <SelectItem key={e.id} value={e.id}>
                        {e.nombre}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="notas">Notas del cliente</Label>
              <Textarea
                id="notas"
                value={notas}
                onChange={(e) => setNotas(e.target.value)}
                placeholder="Notas o peticiones especiales..."
                rows={3}
              />
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancelar
          </Button>
          <Button onClick={handleVerificar} disabled={saving}>
            {saving ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <CheckCircle className="mr-2 h-4 w-4" />
            )}
            Verificar Reserva
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
