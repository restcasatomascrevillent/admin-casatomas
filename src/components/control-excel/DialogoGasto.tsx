import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import type { Gasto, GastoEntrada, ListasControl } from "@/hooks/useControlExcel";
import { Campo, SelectLista } from "./campos";
import type { Guardar } from "./DialogoCobro";
import { hoyIso, importeDeTexto, textoDeImporte } from "./formato";

interface Props {
  abierto: boolean;
  /** El gasto a editar; null = uno nuevo. */
  gasto: Gasto | null;
  listas: ListasControl;
  onGuardar: Guardar<GastoEntrada>;
  onCerrar: () => void;
}

/**
 * Alta o edición de un gasto adelantado por el cliente (IA, hosting, dominio…):
 * una fila de la hoja GASTOS CLIENTES. «¿Repercutir?» decide si cuenta como
 * coste por recuperar.
 */
export function DialogoGasto({ abierto, gasto, listas, onGuardar, onCerrar }: Props) {
  const [proveedor, setProveedor] = useState("");
  const [tipo, setTipo] = useState("");
  const [detalle, setDetalle] = useState("");
  const [importe, setImporte] = useState("");
  const [fecha, setFecha] = useState("");
  const [pagadoPor, setPagadoPor] = useState("");
  const [repercutir, setRepercutir] = useState("");
  const [metodo, setMetodo] = useState("");
  const [notas, setNotas] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);

  useEffect(() => {
    if (!abierto) return;
    setProveedor(gasto?.proveedor ?? "");
    setTipo(gasto?.tipo ?? "");
    setDetalle(gasto?.detalle ?? "");
    setImporte(textoDeImporte(gasto?.importe));
    setFecha(gasto ? gasto.fecha ?? "" : hoyIso());
    setPagadoPor(gasto?.pagadoPor ?? "");
    setRepercutir(gasto?.repercutir ?? "");
    setMetodo(gasto?.metodo ?? "");
    setNotas(gasto?.notas ?? "");
    setError(null);
    setGuardando(false);
  }, [abierto, gasto]);

  const enviar = async (e: React.FormEvent) => {
    e.preventDefault();
    const n = importeDeTexto(importe);
    if (!proveedor.trim()) return setError("Escribe el proveedor (OpenAI, Vercel, Hostinger…).");
    if (n === "invalido") return setError("El importe no es válido. Ejemplo: 21,47.");
    setError(null);
    setGuardando(true);
    const fallo = await onGuardar({
      ...(gasto ? { fila: gasto.fila } : {}),
      proveedor: proveedor.trim(),
      tipo,
      detalle: detalle.trim(),
      importe: n,
      fecha: fecha || null,
      pagadoPor,
      repercutir,
      metodo,
      notas: notas.trim(),
    });
    setGuardando(false);
    if (fallo) setError(fallo);
    else onCerrar();
  };

  return (
    <Dialog open={abierto} onOpenChange={(v) => !v && !guardando && onCerrar()}>
      <DialogContent className="max-h-[90dvh] w-[calc(100vw-2rem)] max-w-lg overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{gasto ? "Editar gasto" : "Nuevo gasto"}</DialogTitle>
          <DialogDescription>Lo que se ha pagado por este cliente (IA, hosting, dominio…). Si se le va a cobrar, marca «Sí» en repercutir.</DialogDescription>
        </DialogHeader>
        <form className="flex min-w-0 flex-col gap-3" onSubmit={(e) => void enviar(e)} noValidate>
          <div className="grid min-w-0 gap-3 sm:grid-cols-2">
            <Campo id="gasto-proveedor" etiqueta="Proveedor">
              <Input id="gasto-proveedor" className="h-11" maxLength={120} placeholder="OpenAI, Vercel…" value={proveedor} onChange={(e) => setProveedor(e.target.value)} />
            </Campo>
            <Campo id="gasto-tipo" etiqueta="Tipo de gasto">
              <SelectLista id="gasto-tipo" valor={tipo} onCambio={setTipo} opciones={listas.tiposGasto} vacio="Sin indicar" />
            </Campo>
            <Campo id="gasto-detalle" etiqueta="Periodo / detalle">
              <Input id="gasto-detalle" className="h-11" maxLength={200} placeholder="Noviembre…" value={detalle} onChange={(e) => setDetalle(e.target.value)} />
            </Campo>
            <Campo id="gasto-importe" etiqueta="Importe (€)">
              <Input id="gasto-importe" className="h-11" inputMode="decimal" autoComplete="off" placeholder="0,00" value={importe} onChange={(e) => setImporte(e.target.value)} />
            </Campo>
            <Campo id="gasto-fecha" etiqueta="Fecha de pago">
              <Input id="gasto-fecha" className="h-11" type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} />
            </Campo>
            <Campo id="gasto-pagado" etiqueta="Pagado por">
              <SelectLista id="gasto-pagado" valor={pagadoPor} onCambio={setPagadoPor} opciones={listas.pagadores} vacio="Sin indicar" />
            </Campo>
            <Campo id="gasto-repercutir" etiqueta="¿Repercutir al cliente?">
              <SelectLista id="gasto-repercutir" valor={repercutir} onCambio={setRepercutir} opciones={listas.repercutir} vacio="Sin decidir" />
            </Campo>
            <Campo id="gasto-metodo" etiqueta="Método">
              <SelectLista id="gasto-metodo" valor={metodo} onCambio={setMetodo} opciones={listas.metodosGasto} vacio="Sin indicar" />
            </Campo>
          </div>
          <Campo id="gasto-notas" etiqueta="Notas (opcional)">
            <Input id="gasto-notas" className="h-11" maxLength={500} value={notas} onChange={(e) => setNotas(e.target.value)} />
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
