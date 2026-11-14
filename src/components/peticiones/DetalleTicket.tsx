import { useEffect, useRef, useState } from "react";
import { Ban, CheckCircle2, ExternalLink, ImageOff, Loader2, Send, ThumbsUp } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { mensajeUsuario } from "@/lib/mensaje-usuario";
import { mensajeErrorUsuarios } from "@/lib/errores-usuarios";
import { urlCaptura, type Peticion } from "@/lib/peticiones";
import { useAnalizarPeticion, useCambiarEstadoPeticion, useEnviarALinear, useMarcarEnAnalisis } from "@/hooks/usePeticiones";
import {
  MAX_MOTIVO_DESCARTE,
  caminoDeRuta,
  etiquetaModulo,
  tipoDispositivo,
  type EstadoPeticion,
} from "../../../supabase/functions/_shared/peticiones";
import { AnalisisTicket } from "./AnalisisTicket";
import { BadgeEstado, BadgePrioridad } from "./EtiquetasPeticion";
import { fechaCorta } from "./utilidades";

interface Props {
  peticion: Peticion | null;
  onCerrar: () => void;
}

function Captura({ ruta }: { ruta: string }) {
  const [url, setUrl] = useState<string | null | undefined>(undefined);
  useEffect(() => {
    let vivo = true;
    void urlCaptura(ruta).then((u) => vivo && setUrl(u));
    return () => {
      vivo = false;
    };
  }, [ruta]);
  if (url === undefined) return <div className="h-40 animate-pulse rounded-md bg-muted" aria-label="Cargando captura" />;
  if (!url) {
    return (
      <p className="flex items-center gap-2 text-sm text-muted-foreground">
        <ImageOff className="h-4 w-4" aria-hidden="true" /> No se ha podido cargar la captura.
      </p>
    );
  }
  return (
    <a href={url} target="_blank" rel="noreferrer" className="block w-fit" title="Abrir la captura en grande">
      <img src={url} alt="Captura que adjuntó" className="max-h-72 rounded-md border object-contain" />
    </a>
  );
}

function DialogoDescartar({ abierto, onCerrar, onConfirmar, guardando }: { abierto: boolean; onCerrar: () => void; onConfirmar: (motivo: string) => void; guardando: boolean }) {
  const [motivo, setMotivo] = useState("");
  const valido = motivo.trim().length >= 3;
  useEffect(() => {
    if (abierto) setMotivo("");
  }, [abierto]);
  return (
    <Dialog open={abierto} onOpenChange={(v) => !v && onCerrar()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Descartar la petición</DialogTitle>
          <DialogDescription>Explica por qué no se va a hacer. Este motivo lo verá quien la envió.</DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          <Label htmlFor="motivo-descarte">Motivo</Label>
          <Textarea
            id="motivo-descarte"
            value={motivo}
            onChange={(e) => setMotivo(e.target.value)}
            maxLength={MAX_MOTIVO_DESCARTE}
            rows={4}
            placeholder="Ej.: Ya se puede hacer desde Reservas › Configuración › Turnos."
            className="text-base"
          />
          <p className="text-right text-xs text-muted-foreground">{motivo.trim().length}/{MAX_MOTIVO_DESCARTE}</p>
        </div>
        <DialogFooter className="gap-2">
          <Button variant="outline" className="h-11" onClick={onCerrar}>Cancelar</Button>
          <Button variant="destructive" className="h-11" disabled={!valido || guardando} onClick={() => onConfirmar(motivo.trim())}>
            Descartar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function DialogoEnviarLinear({ abierto, onCerrar, onConfirmar, enviando, pasaAAceptada }: { abierto: boolean; onCerrar: () => void; onConfirmar: () => void; enviando: boolean; pasaAAceptada: boolean }) {
  return (
    <Dialog open={abierto} onOpenChange={(v) => !v && !enviando && onCerrar()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>¿Enviar este ticket a Linear?</DialogTitle>
          <DialogDescription>
            Se creará una tarea en Linear, en el equipo elegido en Logs › Configuración › Linear, con el resumen, la tarea propuesta,
            los pasos y el prompt para la IA. De quien lo envió solo va su nombre.{pasaAAceptada ? " El ticket pasará a «Aceptada»." : ""}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter className="gap-2">
          <Button variant="outline" className="h-11" onClick={onCerrar} disabled={enviando}>Cancelar</Button>
          <Button className="h-11 gap-2" disabled={enviando} onClick={onConfirmar} data-testid="confirmar-enviar-linear">
            {enviando ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Send className="h-4 w-4" aria-hidden="true" />}
            {enviando ? "Enviando…" : "Enviar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

const ERROR_LINEAR = "No se ha podido enviar a Linear. Prueba otra vez en un momento.";

/** Ficha de un ticket: lo que escribió el usuario, el análisis de la IA y las acciones del super admin. */
export function DetalleTicket({ peticion, onCerrar }: Props) {
  const cambiar = useCambiarEstadoPeticion();
  const analizar = useAnalizarPeticion();
  const enAnalisis = useMarcarEnAnalisis();
  const linear = useEnviarALinear();
  const [descartando, setDescartando] = useState(false);
  const [confirmandoLinear, setConfirmandoLinear] = useState(false);
  const abiertoRef = useRef<string | null>(null);

  // Al abrir: «Recibida» pasa a «En análisis» y, si se quedó sin analizar (se cortó al guardar), se analiza.
  useEffect(() => {
    if (!peticion || abiertoRef.current === peticion.id) return;
    abiertoRef.current = peticion.id;
    if (peticion.estado === "nueva") enAnalisis.mutate(peticion.id);
    if (peticion.analisis_estado === "pendiente") analizar.mutate({ id: peticion.id });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- solo al abrir cada ticket
  }, [peticion?.id]);

  if (!peticion) return null;
  const p = peticion;

  const ponerEstado = (estado: EstadoPeticion, motivo?: string) =>
    cambiar.mutate(
      { id: p.id, estado, motivo },
      {
        onSuccess: () => {
          toast.success(estado === "descartada" ? "Petición descartada" : estado === "hecha" ? "Marcada como hecha" : "Petición aceptada");
          setDescartando(false);
        },
        onError: (e) => toast.error(mensajeUsuario(e, "No se ha podido cambiar el estado. Prueba otra vez.")),
      },
    );

  const reanalizar = () =>
    analizar.mutate(
      { id: p.id, forzar: true },
      {
        onSuccess: (r) => (r.ok ? toast.success("Análisis actualizado") : toast.error(r.error ?? "No se ha podido analizar")),
        onError: async (e) => toast.error(await mensajeErrorUsuarios(e, "No se ha podido analizar. Prueba otra vez en un momento.")),
      },
    );

  const enviarLinear = () =>
    linear.mutate(p.id, {
      onSuccess: (r) => {
        setConfirmandoLinear(false);
        if (!r.ok) {
          toast.error(r.error || ERROR_LINEAR);
          return;
        }
        if (r.destino === "prueba") {
          toast.success(`Prueba hecha: guardado como ${r.identificador ?? "PRUEBA"}`, {
            description: "Linear está en modo prueba: no se ha creado nada en Linear. Para crearlo de verdad, pon el modo real en Logs › Configuración › Linear.",
          });
          return;
        }
        const url = r.url;
        toast.success(r.repetido ? `Ya estaba en Linear: ${r.identificador}` : `Enviado a Linear: ${r.identificador}`, {
          description: r.aceptada ? "El ticket ha pasado a «Aceptada»." : undefined,
          action: url ? { label: "Ver en Linear", onClick: () => window.open(url, "_blank", "noopener,noreferrer") } : undefined,
        });
      },
      onError: async (e) => {
        setConfirmandoLinear(false);
        toast.error(await mensajeErrorUsuarios(e, ERROR_LINEAR));
      },
    });

  const camino = caminoDeRuta(p.ruta);
  const ocupado = cambiar.isPending;
  // Mientras la IA analiza no se envía (la tarea saldría sin la tarea propuesta ni el prompt).
  const iaAnalizando = analizar.isPending || p.analisis_estado === "analizando" || p.analisis_estado === "pendiente";

  return (
    <Sheet open onOpenChange={(v) => !v && onCerrar()}>
      <SheetContent side="right" className="w-full max-w-none overflow-y-auto sm:max-w-2xl" data-testid="detalle-ticket">
        <SheetHeader>
          <SheetTitle className="break-words pr-6">{p.titulo}</SheetTitle>
          <SheetDescription asChild>
            <div className="flex flex-wrap items-center gap-2">
              <BadgeEstado estado={p.estado} />
              <BadgePrioridad prioridad={p.prioridad} />
              <span className="text-sm">{etiquetaModulo(p.modulo)}</span>
            </div>
          </SheetDescription>
        </SheetHeader>

        <div className="mt-4 space-y-5">
          <dl className="grid grid-cols-[auto,1fr] gap-x-3 gap-y-1 text-sm">
            <dt className="text-muted-foreground">De</dt>
            <dd className="break-words">{p.creado_por_nombre ?? "Usuario dado de baja"}{p.creado_por_email && p.creado_por_email !== p.creado_por_nombre ? ` · ${p.creado_por_email}` : ""}</dd>
            <dt className="text-muted-foreground">Enviada</dt>
            <dd>{fechaCorta(p.created_at)}</dd>
            <dt className="text-muted-foreground">Desde</dt>
            <dd className="break-all">
              {camino ? <span className="font-mono text-xs">{camino}</span> : "—"}
              {p.dispositivo ? <span title={p.dispositivo}> · {tipoDispositivo(p.dispositivo)}</span> : null}
            </dd>
            {p.estado === "descartada" && p.motivo_descarte && (
              <>
                <dt className="text-muted-foreground">Motivo</dt>
                <dd>{p.motivo_descarte}</dd>
              </>
            )}
          </dl>

          <section className="space-y-2" aria-labelledby="lo-que-escribio">
            <h3 id="lo-que-escribio" className="text-base font-semibold">Lo que ha escrito</h3>
            <p className="whitespace-pre-wrap break-words rounded-md bg-muted/50 p-3 text-sm">{p.descripcion}</p>
            {p.captura_path && <Captura ruta={p.captura_path} />}
          </section>

          <AnalisisTicket peticion={p} onReanalizar={reanalizar} reanalizando={analizar.isPending} />

          <div className="sticky bottom-0 -mx-6 flex flex-wrap gap-2 border-t bg-background px-6 py-3" role="group" aria-label="Acciones del ticket">
            {p.estado !== "aceptada" && p.estado !== "hecha" && (
              <Button className="h-12 gap-2" disabled={ocupado} onClick={() => ponerEstado("aceptada")}>
                <ThumbsUp className="h-4 w-4" aria-hidden="true" /> Aceptar
              </Button>
            )}
            {p.estado !== "hecha" && (
              <Button variant="outline" className="h-12 gap-2" disabled={ocupado} onClick={() => ponerEstado("hecha")}>
                <CheckCircle2 className="h-4 w-4" aria-hidden="true" /> Marcar hecha
              </Button>
            )}
            {p.estado === "hecha" && (
              <Button variant="outline" className="h-12 gap-2" disabled={ocupado} onClick={() => ponerEstado("aceptada")}>
                <ThumbsUp className="h-4 w-4" aria-hidden="true" /> Reabrir
              </Button>
            )}
            {p.estado !== "descartada" && (
              <Button variant="outline" className="h-12 gap-2 text-destructive hover:text-destructive" disabled={ocupado} onClick={() => setDescartando(true)}>
                <Ban className="h-4 w-4" aria-hidden="true" /> Descartar
              </Button>
            )}
            {p.linear_url ? (
              <Button variant="ghost" className="h-12 gap-2" asChild>
                <a href={p.linear_url} target="_blank" rel="noreferrer" title="Abrir en Linear (otra pestaña)" data-testid="en-linear">
                  <ExternalLink className="h-4 w-4" aria-hidden="true" /> {p.linear_id ? `En Linear: ${p.linear_id}` : "Ver en Linear"}
                </a>
              </Button>
            ) : p.estado !== "descartada" ? (
              <Button
                variant="outline"
                className="h-12 gap-2"
                disabled={iaAnalizando || linear.isPending}
                title={iaAnalizando ? "Espera a que la IA termine de analizarlo" : "Crear una tarea en Linear con este ticket"}
                onClick={() => setConfirmandoLinear(true)}
                data-testid="enviar-linear"
              >
                {linear.isPending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Send className="h-4 w-4" aria-hidden="true" />}
                {linear.isPending ? "Enviando…" : "Enviar a Linear"}
              </Button>
            ) : null}
          </div>
        </div>

        <DialogoDescartar abierto={descartando} onCerrar={() => setDescartando(false)} onConfirmar={(m) => ponerEstado("descartada", m)} guardando={ocupado} />
        <DialogoEnviarLinear
          abierto={confirmandoLinear}
          onCerrar={() => setConfirmandoLinear(false)}
          onConfirmar={enviarLinear}
          enviando={linear.isPending}
          pasaAAceptada={p.estado === "nueva" || p.estado === "en_analisis"}
        />
      </SheetContent>
    </Sheet>
  );
}
