import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import type { Cobro, CobroEntrada, ListasControl } from "@/hooks/useControlExcel";
import { Campo, SelectLista } from "./campos";
import { eur, hoyIso, importeDeTexto, textoDeImporte } from "./formato";

/** `null` = guardado (o hay que recargar): se cierra. Un texto = el error a enseñar en el diálogo. */
export type Guardar<T> = (datos: T) => Promise<string | null>;

interface PropsCobro {
  abierto: boolean;
  /** El cobro a editar; null = uno nuevo. */
  cobro: Cobro | null;
  listas: ListasControl;
  onGuardar: Guardar<CobroEntrada>;
  onCerrar: () => void;
}

/**
 * Alta o edición de un cobro del cliente (una fila de la hoja COBROS). Lo que
 * se calcula solo (pendiente, estado, avisos) no se pide: lo da el Excel.
 */
export function DialogoCobro({ abierto, cobro, listas, onGuardar, onCerrar }: PropsCobro) {
  const [tipo, setTipo] = useState("");
  const [detalle, setDetalle] = useState("");
  const [pactado, setPactado] = useState("");
  const [fechaPrevista, setFechaPrevista] = useState("");
  const [cobrado, setCobrado] = useState("");
  const [fechaCobro, setFechaCobro] = useState("");
  const [recibidoPor, setRecibidoPor] = useState("");
  const [metodo, setMetodo] = useState("");
  const [notas, setNotas] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);

  useEffect(() => {
    if (!abierto) return;
    setTipo(cobro?.tipo ?? "");
    setDetalle(cobro?.detalle ?? "");
    setPactado(textoDeImporte(cobro?.pactado));
    setFechaPrevista(cobro?.fechaPrevista ?? "");
    setCobrado(textoDeImporte(cobro?.cobrado));
    setFechaCobro(cobro?.fechaCobro ?? "");
    setRecibidoPor(cobro?.recibidoPor ?? "");
    setMetodo(cobro?.metodo ?? "");
    setNotas(cobro?.notas ?? "");
    setError(null);
    setGuardando(false);
  }, [abierto, cobro]);

  const enviar = async (e: React.FormEvent) => {
    e.preventDefault();
    const nPactado = importeDeTexto(pactado);
    const nCobrado = importeDeTexto(cobrado);
    if (!tipo) return setError("Elige el tipo de cobro.");
    if (nPactado === "invalido" || nPactado == null || nPactado <= 0) return setError("Escribe el importe pactado (más de 0), por ejemplo 800 o 12,50.");
    if (nCobrado === "invalido") return setError("El importe cobrado no es válido. Ejemplo: 800 o 12,50.");
    setError(null);
    setGuardando(true);
    const fallo = await onGuardar({
      ...(cobro ? { fila: cobro.fila } : {}),
      tipo,
      detalle: detalle.trim(),
      pactado: nPactado,
      fechaPrevista: fechaPrevista || null,
      cobrado: nCobrado,
      fechaCobro: fechaCobro || null,
      recibidoPor,
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
          <DialogTitle>{cobro ? "Editar cobro" : "Nuevo cobro"}</DialogTitle>
          <DialogDescription>Instalación, mensualidad y reembolso de gastos van en cobros distintos, aunque el cliente lo pague todo junto.</DialogDescription>
        </DialogHeader>
        <form className="flex min-w-0 flex-col gap-3" onSubmit={(e) => void enviar(e)} noValidate>
          <div className="grid min-w-0 gap-3 sm:grid-cols-2">
            <Campo id="cobro-tipo" etiqueta="Tipo de cobro">
              <SelectLista id="cobro-tipo" valor={tipo} onCambio={setTipo} opciones={listas.tiposCobro} />
            </Campo>
            <Campo id="cobro-detalle" etiqueta="Mes / detalle">
              <Input id="cobro-detalle" className="h-11" maxLength={200} placeholder="Noviembre, instalación inicial…" value={detalle} onChange={(e) => setDetalle(e.target.value)} />
            </Campo>
            <Campo id="cobro-pactado" etiqueta="Importe pactado (€)">
              <Input id="cobro-pactado" className="h-11" inputMode="decimal" autoComplete="off" placeholder="0,00" value={pactado} onChange={(e) => setPactado(e.target.value)} />
            </Campo>
            <Campo id="cobro-prevista" etiqueta="Fecha prevista">
              <Input id="cobro-prevista" className="h-11" type="date" value={fechaPrevista} onChange={(e) => setFechaPrevista(e.target.value)} />
            </Campo>
          </div>
          <fieldset className="min-w-0 rounded-lg border p-3">
            <legend className="px-1 text-sm font-medium">Cuando se cobra</legend>
            <div className="grid min-w-0 gap-3 sm:grid-cols-2">
              <Campo id="cobro-cobrado" etiqueta="Cobrado (€)">
                <Input id="cobro-cobrado" className="h-11" inputMode="decimal" autoComplete="off" placeholder="Sin cobrar" value={cobrado} onChange={(e) => setCobrado(e.target.value)} />
              </Campo>
              <Campo id="cobro-fecha" etiqueta="Fecha de cobro">
                <Input id="cobro-fecha" className="h-11" type="date" value={fechaCobro} onChange={(e) => setFechaCobro(e.target.value)} />
              </Campo>
              <Campo id="cobro-recibido" etiqueta="Recibido por">
                <SelectLista id="cobro-recibido" valor={recibidoPor} onCambio={setRecibidoPor} opciones={listas.receptores} vacio="Sin indicar" />
              </Campo>
              <Campo id="cobro-metodo" etiqueta="Método">
                <SelectLista id="cobro-metodo" valor={metodo} onCambio={setMetodo} opciones={listas.metodos} vacio="Sin indicar" />
              </Campo>
            </div>
          </fieldset>
          <Campo id="cobro-notas" etiqueta="Notas (opcional)">
            <Input id="cobro-notas" className="h-11" maxLength={500} value={notas} onChange={(e) => setNotas(e.target.value)} />
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

interface PropsMarcar {
  /** El cobro que se da por cobrado; null = cerrado. */
  cobro: Cobro | null;
  listas: ListasControl;
  onGuardar: Guardar<CobroEntrada>;
  onCerrar: () => void;
}

/**
 * «Marcar cobrado»: da el cobro por pagado entero (cobrado = pactado) con fecha
 * de hoy. Solo pregunta quién lo ha recibido (el Excel avisa si falta).
 */
export function DialogoMarcarCobrado({ cobro, listas, onGuardar, onCerrar }: PropsMarcar) {
  const [recibidoPor, setRecibidoPor] = useState("");
  const [fechaCobro, setFechaCobro] = useState("");
  const [metodo, setMetodo] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);

  useEffect(() => {
    if (!cobro) return;
    setRecibidoPor(cobro.recibidoPor);
    setFechaCobro(cobro.fechaCobro ?? hoyIso());
    setMetodo(cobro.metodo);
    setError(null);
    setGuardando(false);
  }, [cobro]);

  const enviar = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!cobro) return;
    if (!recibidoPor) return setError("Indica quién ha recibido el dinero.");
    if (!fechaCobro) return setError("Indica la fecha de cobro.");
    setError(null);
    setGuardando(true);
    const fallo = await onGuardar({
      fila: cobro.fila,
      tipo: cobro.tipo,
      detalle: cobro.detalle,
      pactado: cobro.pactado,
      fechaPrevista: cobro.fechaPrevista,
      cobrado: cobro.pactado,
      fechaCobro,
      recibidoPor,
      metodo,
      notas: cobro.notas,
    });
    setGuardando(false);
    if (fallo) setError(fallo);
    else onCerrar();
  };

  return (
    <Dialog open={!!cobro} onOpenChange={(v) => !v && !guardando && onCerrar()}>
      <DialogContent className="max-h-[90dvh] w-[calc(100vw-2rem)] max-w-md overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Marcar cobrado</DialogTitle>
          <DialogDescription className="break-words">
            {cobro ? `${[cobro.tipo, cobro.detalle].filter(Boolean).join(" · ")}: se apunta como cobrado entero, ${eur(cobro.pactado)}.` : ""}
          </DialogDescription>
        </DialogHeader>
        <form className="flex min-w-0 flex-col gap-3" onSubmit={(e) => void enviar(e)} noValidate>
          <Campo id="marcar-recibido" etiqueta="Recibido por">
            <SelectLista id="marcar-recibido" valor={recibidoPor} onCambio={setRecibidoPor} opciones={listas.receptores} />
          </Campo>
          <div className="grid min-w-0 gap-3 sm:grid-cols-2">
            <Campo id="marcar-fecha" etiqueta="Fecha de cobro">
              <Input id="marcar-fecha" className="h-11" type="date" value={fechaCobro} onChange={(e) => setFechaCobro(e.target.value)} />
            </Campo>
            <Campo id="marcar-metodo" etiqueta="Método">
              <SelectLista id="marcar-metodo" valor={metodo} onCambio={setMetodo} opciones={listas.metodos} vacio="Sin indicar" />
            </Campo>
          </div>
          {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
          <DialogFooter className="gap-2 sm:gap-2">
            <Button type="button" variant="outline" className="h-11" onClick={onCerrar} disabled={guardando}>Cancelar</Button>
            <Button type="submit" className="h-11 gap-2" disabled={guardando}>
              {guardando && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
              Marcar cobrado
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
