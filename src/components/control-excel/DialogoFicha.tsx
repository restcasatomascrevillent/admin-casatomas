import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import type { FichaCliente, ListasControl } from "@/hooks/useControlExcel";
import { Campo, SelectLista } from "./campos";
import type { Guardar } from "./DialogoCobro";
import { importeDeTexto, textoDeImporte } from "./formato";

interface Props {
  abierto: boolean;
  cliente: string;
  ficha: FichaCliente;
  listas: ListasControl;
  onGuardar: Guardar<FichaCliente>;
  onCerrar: () => void;
}

/** Lo pactado con el cliente: su fila de la hoja CLIENTES (el nombre no se cambia desde aquí). */
export function DialogoFicha({ abierto, cliente, ficha, listas, onGuardar, onCerrar }: Props) {
  const [estado, setEstado] = useState("");
  const [desde, setDesde] = useState("");
  const [instalacion, setInstalacion] = useState("");
  const [cuota, setCuota] = useState("");
  const [dia, setDia] = useState("");
  const [notas, setNotas] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);

  useEffect(() => {
    if (!abierto) return;
    setEstado(ficha.estado);
    setDesde(ficha.desde ?? "");
    setInstalacion(textoDeImporte(ficha.instalacionPactada));
    setCuota(textoDeImporte(ficha.cuotaPactada));
    setDia(ficha.diaCobro == null ? "" : String(ficha.diaCobro));
    setNotas(ficha.notas);
    setError(null);
    setGuardando(false);
  }, [abierto, ficha]);

  const enviar = async (e: React.FormEvent) => {
    e.preventDefault();
    const nInstalacion = importeDeTexto(instalacion);
    const nCuota = importeDeTexto(cuota);
    const nDia = dia.trim() === "" ? null : Number(dia);
    if (!estado) return setError("Elige el estado del cliente.");
    if (nInstalacion === "invalido" || nCuota === "invalido") return setError("Revisa los importes. Ejemplo: 1700 o 12,50.");
    if (nDia != null && (!Number.isInteger(nDia) || nDia < 1 || nDia > 31)) return setError("El día de cobro tiene que estar entre 1 y 31.");
    setError(null);
    setGuardando(true);
    const fallo = await onGuardar({ estado, desde: desde || null, instalacionPactada: nInstalacion, cuotaPactada: nCuota, diaCobro: nDia, notas: notas.trim() });
    setGuardando(false);
    if (fallo) setError(fallo);
    else onCerrar();
  };

  return (
    <Dialog open={abierto} onOpenChange={(v) => !v && !guardando && onCerrar()}>
      <DialogContent className="max-h-[90dvh] w-[calc(100vw-2rem)] max-w-lg overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Ficha de {cliente}</DialogTitle>
          <DialogDescription>Lo pactado con el cliente. Lo cobrado y lo pendiente se calculan con los cobros.</DialogDescription>
        </DialogHeader>
        <form className="flex min-w-0 flex-col gap-3" onSubmit={(e) => void enviar(e)} noValidate>
          <div className="grid min-w-0 gap-3 sm:grid-cols-2">
            <Campo id="ficha-estado" etiqueta="Estado">
              <SelectLista id="ficha-estado" valor={estado} onCambio={setEstado} opciones={listas.estados} />
            </Campo>
            <Campo id="ficha-desde" etiqueta="Cliente desde">
              <Input id="ficha-desde" className="h-11" type="date" value={desde} onChange={(e) => setDesde(e.target.value)} />
            </Campo>
            <Campo id="ficha-instalacion" etiqueta="Instalación pactada (€)">
              <Input id="ficha-instalacion" className="h-11" inputMode="decimal" autoComplete="off" placeholder="0,00" value={instalacion} onChange={(e) => setInstalacion(e.target.value)} />
            </Campo>
            <Campo id="ficha-cuota" etiqueta="Cuota pactada (€ al mes)">
              <Input id="ficha-cuota" className="h-11" inputMode="decimal" autoComplete="off" placeholder="0,00" value={cuota} onChange={(e) => setCuota(e.target.value)} />
            </Campo>
            <Campo id="ficha-dia" etiqueta="Día de cobro (1–31)">
              <Input id="ficha-dia" className="h-11" inputMode="numeric" autoComplete="off" maxLength={2} value={dia} onChange={(e) => setDia(e.target.value)} />
            </Campo>
          </div>
          <Campo id="ficha-notas" etiqueta="Notas">
            <Textarea id="ficha-notas" maxLength={500} rows={3} value={notas} onChange={(e) => setNotas(e.target.value)} />
          </Campo>
          {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
          <DialogFooter className="gap-2 sm:gap-2">
            <Button type="button" variant="outline" className="h-11" onClick={onCerrar} disabled={guardando}>Cancelar</Button>
            <Button type="submit" className="h-11 gap-2" disabled={guardando}>
              {guardando && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
              Guardar en el Excel
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
