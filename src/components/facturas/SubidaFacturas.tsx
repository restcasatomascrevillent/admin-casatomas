import { useRef, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import {
  Upload, FileText, X, Send, Loader2, CheckCircle2, XCircle, Receipt, Package, AlertTriangle, FileWarning, Copy,
  Camera, FolderOpen, Layers, Replace, RotateCcw, Clock,
} from "lucide-react";
import { Progress } from "@/components/ui/progress";
import { useTamanoElemento } from "@/hooks/useAlturaDisponible";
import { useColaSubida } from "@/hooks/useColaSubida";
import { type ElementoCola, progresoTanda } from "@/lib/facturas/colaSubida";
import type { Sustituible } from "@/lib/facturas/documentoLargo";
import type { PendienteDecidir } from "@/lib/facturas/pendientesDecidir";
import { repartoCargar } from "@/lib/facturas/alturaCargar";
import { SustituirFacturaDialog } from "./SustituirFacturaDialog";

/**
 * Pestaña «Cargar» de Facturas. Solo ENSEÑA la cola global
 * (<ColaSubidaProvider>, montado en App.tsx): lo que se envía sigue
 * procesándose aunque se cambie de pestaña o de sección, y al volver aquí se
 * ve en qué punto va. Ocupa el alto que le da la página (sin scroll de página):
 * zona de subida, barra y botones fijos; la lista hace scroll por dentro.
 */
export function SubidaFacturas() {
  const { cola, estado, pendientes, descartarPendiente, sustituir } = useColaSubida();
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  // Segundo input solo para la cámara de la tablet/móvil (`capture`): abre la
  // cámara directamente en vez del selector de archivos.
  const camaraInputRef = useRef<HTMLInputElement>(null);
  const [aSustituir, setASustituir] = useState<Sustituible | null>(null);
  const [raiz, setRaiz] = useState<HTMLDivElement | null>(null);
  const tamano = useTamanoElemento(raiz);

  const elementos = estado.elementos;
  const seleccionados = elementos.filter((e) => e.fase === "seleccionado");
  const resto = elementos.filter((e) => e.fase !== "seleccionado");
  const terminados = elementos.filter((e) => e.fase === "terminado");
  const fallidosConFichero = terminados.filter((e) => !e.resultado?.success && e.file);
  const progreso = progresoTanda(estado);
  const hayLista = elementos.length > 0 || pendientes.length > 0;
  const reparto = repartoCargar({ alto: tamano?.alto ?? null, hayLista });
  const compacta = reparto.zona === "compacta";

  const anadir = (files: FileList | null) => {
    if (!files || files.length === 0) return;
    // Se copia la lista ANTES de vaciar el input: `files` es una referencia viva.
    const { rechazados } = cola.añadirArchivos(Array.from(files));
    for (const r of rechazados) {
      toast.error(r.motivo.includes("10MB") ? "Archivo demasiado grande" : "Tipo de archivo no permitido", {
        description: `El archivo ${r.nombre} ${r.motivo}`,
      });
    }
    // Limpiar los inputs (permite volver a elegir el mismo archivo).
    if (fileInputRef.current) fileInputRef.current.value = "";
    if (camaraInputRef.current) camaraInputRef.current.value = "";
  };

  const confirmarSustitucion = async (s: Sustituible) => {
    try {
      await sustituir(s);
      setASustituir(null);
    } catch (err) {
      toast.error("No se ha sustituido", { description: err instanceof Error ? err.message : String(err) });
    }
  };

  const botonesSubida = (
    <>
      <Button type="button" className="h-12 gap-2 px-6 text-base" onClick={() => camaraInputRef.current?.click()}>
        <Camera className="h-5 w-5" aria-hidden="true" />
        Hacer foto
      </Button>
      <Button
        type="button"
        variant="outline"
        className="h-12 gap-2 px-6 text-base"
        onClick={() => fileInputRef.current?.click()}
      >
        <FolderOpen className="h-5 w-5" aria-hidden="true" />
        Elegir archivos
      </Button>
    </>
  );

  return (
    <Card ref={setRaiz} className="flex h-full min-h-0 flex-col overflow-hidden">
      <CardHeader className={`shrink-0 px-3 sm:px-6 ${compacta ? "py-3" : "pb-4"}`}>
        <CardTitle className="flex items-center gap-2 text-lg sm:text-2xl">
          <FileText className="h-5 w-5" aria-hidden="true" />
          Subida de Facturas y Albaranes
        </CardTitle>
        {reparto.descripcion && (
          <CardDescription>
            Haz una foto o elige tus facturas o albaranes (PDF o imágenes). Se procesan en segundo plano: puedes seguir
            trabajando en otra sección y te avisamos al terminar. En cuanto se han subido, puedes incluso cerrar la pestaña.
          </CardDescription>
        )}
      </CardHeader>
      <CardContent className="flex min-h-0 flex-1 flex-col gap-3 px-3 pb-3 sm:gap-4 sm:px-6 sm:pb-6">
        {/* Zona de carga: grande sin lista o con alto de sobra; si no, una fila. */}
        <div
          data-zona={reparto.zona}
          className={[
            "shrink-0 rounded-lg border-2 border-dashed transition-all duration-200",
            compacta ? "flex flex-wrap items-center gap-3 px-3 py-2.5" : "p-4 text-center sm:p-8",
            isDragging
              ? "border-primary bg-primary/5 shadow-md"
              : "border-muted-foreground/25 hover:border-primary/50 hover:bg-muted/30",
          ].join(" ")}
          onDragEnter={(e) => { e.preventDefault(); e.stopPropagation(); setIsDragging(true); }}
          onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); }}
          onDragLeave={(e) => { e.preventDefault(); e.stopPropagation(); setIsDragging(false); }}
          onDrop={(e) => {
            e.preventDefault();
            e.stopPropagation();
            setIsDragging(false);
            anadir(e.dataTransfer.files);
          }}
        >
          {compacta ? (
            <>
              <Upload className="hidden h-6 w-6 shrink-0 text-muted-foreground sm:block" aria-hidden="true" />
              <p className="min-w-0 flex-1 basis-40 text-sm text-muted-foreground">
                {isDragging ? "Suelta aquí para añadir" : "Añade más: foto, archivos o arrastrándolos aquí (PDF o imagen, máx. 10MB)."}
              </p>
              <div className="flex flex-wrap gap-2">{botonesSubida}</div>
            </>
          ) : (
            <>
              <Upload
                className={[
                  "mx-auto mb-4 h-10 w-10 transition-all duration-200",
                  isDragging ? "scale-110 text-primary" : "text-muted-foreground",
                ].join(" ")}
                aria-hidden="true"
              />
              <p className="mb-4 text-sm text-muted-foreground">
                {isDragging ? "Suelta aquí para añadir" : "Haz una foto del documento o elige archivos de la galería o de Archivos"}
              </p>
              {/* Dos botones grandes en vez de una zona entera "clicable": en la tablet
                  se toca, no se arrastra. El de la cámara usa `capture` para abrir la
                  cámara trasera directamente; el otro admite PDF y varias imágenes. */}
              <div className="flex flex-col items-stretch justify-center gap-3 sm:flex-row sm:items-center">
                {botonesSubida}
              </div>
              <p className="mt-4 text-xs text-muted-foreground">
                PDF, JPG, PNG o WEBP (máximo 10MB por archivo). En un ordenador también puedes arrastrarlos aquí.
              </p>
            </>
          )}
          <Input
            ref={fileInputRef}
            type="file"
            accept=".pdf,image/jpeg,image/png,image/webp"
            multiple
            className="hidden"
            aria-label="Elegir facturas o albaranes (PDF o imágenes)"
            onChange={(e) => anadir(e.target.files)}
          />
          <Input
            ref={camaraInputRef}
            type="file"
            accept="image/*"
            capture="environment"
            className="hidden"
            aria-label="Hacer una foto de la factura o albarán"
            onChange={(e) => anadir(e.target.files)}
          />
        </div>

        {/* Barra de progreso de la tanda en marcha */}
        {progreso && (
          <div className="shrink-0 space-y-1.5" role="status" aria-live="polite">
            <div className="flex flex-wrap justify-between gap-x-3 text-sm text-muted-foreground">
              <span className="font-medium text-foreground">
                Procesando {progreso.hechos} de {progreso.total}
              </span>
              <span>Sigue aunque cambies de sección: te avisamos al terminar.</span>
            </div>
            <Progress value={progreso.total > 0 ? (progreso.hechos / progreso.total) * 100 : 0} aria-label="Progreso de la subida" />
          </div>
        )}

        {/* Lista: lo único que hace scroll, y solo si no cabe */}
        {hayLista && (
          <div
            role="region"
            aria-label="Documentos de la subida"
            tabIndex={0}
            className="min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {pendientes.length > 0 && (
              <SeccionPendientes
                pendientes={pendientes}
                onSustituir={(p) => setASustituir(p.sustituible)}
                onDescartar={(p) => descartarPendiente(p.trabajoId)}
              />
            )}

            {seleccionados.length > 0 && (
              <section aria-label="Archivos seleccionados" className="space-y-2">
                <h3 className="text-sm font-medium">Archivos seleccionados ({seleccionados.length})</h3>
                <ul className="grid gap-2">
                  {seleccionados.map((e) => (
                    <li key={e.id} className="flex items-center gap-3 rounded-lg bg-muted/50 p-2">
                      <Miniatura e={e} />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium">{e.nombre}</p>
                        <p className="text-xs text-muted-foreground">{(e.tamano / 1024).toFixed(1)} KB</p>
                      </div>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-11 w-11 shrink-0"
                        onClick={() => cola.quitar(e.id)}
                        aria-label={`Quitar ${e.nombre}`}
                      >
                        <X className="h-4 w-4" />
                      </Button>
                    </li>
                  ))}
                </ul>
              </section>
            )}

            {resto.length > 0 && (
              <section aria-label="Documentos enviados" className="space-y-2">
                <h3 className="text-sm font-medium">Enviados</h3>
                <ul className="space-y-2">
                  {[...resto].reverse().map((e) => (
                    <FilaEnviado key={e.id} e={e} onReintentar={() => cola.reintentar(e.id)} />
                  ))}
                </ul>
              </section>
            )}
          </div>
        )}

        {/* Acciones */}
        {(seleccionados.length > 0 || terminados.length > 0) && (
          <div className="flex shrink-0 flex-wrap gap-2">
            {seleccionados.length > 0 && (
              <Button onClick={() => cola.enviar()} className="h-12 min-w-[12rem] flex-[2] text-base">
                <Send className="mr-2 h-4 w-4" aria-hidden="true" />
                Enviar {seleccionados.length} documento{seleccionados.length !== 1 ? "s" : ""}
              </Button>
            )}
            {fallidosConFichero.length > 0 && (
              <Button variant="outline" onClick={() => cola.reintentar()} className="h-12 flex-1">
                Reintentar fallidos
              </Button>
            )}
            {terminados.length > 0 && (
              <Button variant="outline" onClick={() => cola.limpiarTerminados()} className="h-12 flex-1">
                Limpiar terminados
              </Button>
            )}
          </div>
        )}
      </CardContent>
      <SustituirFacturaDialog
        sustituible={aSustituir}
        onCancelar={() => setASustituir(null)}
        onConfirmar={confirmarSustitucion}
      />
    </Card>
  );
}

function Miniatura({ e }: { e: ElementoCola }) {
  return e.preview ? (
    <img src={e.preview} alt="" className="h-11 w-11 shrink-0 rounded object-cover" />
  ) : (
    <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded bg-primary/10">
      <FileText className="h-5 w-5 text-primary" aria-hidden="true" />
    </div>
  );
}

function SeccionPendientes({
  pendientes,
  onSustituir,
  onDescartar,
}: {
  pendientes: PendienteDecidir[];
  onSustituir: (p: PendienteDecidir) => void;
  onDescartar: (p: PendienteDecidir) => void;
}) {
  return (
    <section aria-label="Pendientes de decidir" className="space-y-2 rounded-md border border-blue-500/30 bg-blue-500/5 p-3">
      <h3 className="flex items-center gap-2 text-sm font-medium">
        <Copy className="h-4 w-4 text-blue-600" aria-hidden="true" />
        Pendientes de decidir ({pendientes.length})
      </h3>
      <ul className="space-y-3">
        {pendientes.map((p) => (
          <li key={p.trabajoId} className="space-y-2">
            <p className="text-sm">
              <span className="font-medium">{p.nombre}</span>
              <span className="block text-xs text-muted-foreground">
                Ya existe la factura {p.sustituible.existente.numero_documento} ({p.sustituible.existente.lineas} líneas):
                no se ha creado otra. Si la que hay está mal leída, puedes sustituirla por este documento.
              </span>
            </p>
            <div className="flex flex-wrap gap-2">
              <Button type="button" variant="outline" className="h-11 gap-2" onClick={() => onSustituir(p)}>
                <Replace className="h-4 w-4" aria-hidden="true" />
                Sustituir la existente
              </Button>
              <Button type="button" variant="ghost" className="h-11" onClick={() => onDescartar(p)}>
                Dejar la que hay
              </Button>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

function FilaEnviado({ e, onReintentar }: { e: ElementoCola; onReintentar: () => void }) {
  const r = e.resultado;
  const enMarcha = e.fase !== "terminado";
  return (
    <li className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-md border px-3 py-2">
      {enMarcha ? (
        e.fase === "en_cola" ? (
          <Clock className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        ) : (
          <Loader2 className="h-4 w-4 shrink-0 text-primary motion-safe:animate-spin" aria-hidden="true" />
        )
      ) : !r?.success ? (
        <XCircle className="h-4 w-4 shrink-0 text-destructive" aria-hidden="true" />
      ) : r.duplicado ? (
        // Icono distinto a propósito: un check verde daría a entender que se
        // creó un documento nuevo, y no es el caso.
        <Copy className="h-4 w-4 shrink-0 text-blue-500" aria-hidden="true" />
      ) : (
        <CheckCircle2 className="h-4 w-4 shrink-0 text-green-500" aria-hidden="true" />
      )}
      <span className={`min-w-0 flex-1 truncate text-sm ${!enMarcha && !r?.success ? "text-destructive" : "text-foreground"}`}>
        {e.nombre}
      </span>
      {enMarcha && <span className="text-xs text-muted-foreground">{e.progreso}</span>}
      {r?.success && r.tipo && (
        <span className="flex shrink-0 items-center gap-1">
          {r.tipo === "factura" ? (
            <>
              <Receipt className="h-3 w-3 text-blue-600" aria-hidden="true" />
              <span className="text-xs font-medium text-blue-600">Factura</span>
            </>
          ) : r.tipo === "albaran" ? (
            <>
              <Package className="h-3 w-3 text-green-600" aria-hidden="true" />
              <span className="text-xs font-medium text-green-600">Albarán</span>
            </>
          ) : (
            <span className="text-xs text-muted-foreground">{r.tipo}</span>
          )}
        </span>
      )}
      {r && !r.success && (
        <div className="flex basis-full flex-wrap items-center gap-2 pl-6">
          {r.error && <span className="min-w-0 flex-1 break-words text-xs text-muted-foreground">{r.error}</span>}
          {e.file && (
            <Button type="button" variant="outline" className="h-11 gap-2" onClick={onReintentar} aria-label={`Reintentar ${e.nombre}`}>
              <RotateCcw className="h-4 w-4" aria-hidden="true" />
              Reintentar
            </Button>
          )}
        </div>
      )}
      {/* Los motivos van escritos en la propia fila: con el dedo no hay hover. */}
      {r?.success && r.duplicado && (
        <span className="flex basis-full items-start gap-1 pl-6 text-xs font-medium text-blue-600">
          <Copy className="mt-0.5 h-3 w-3 shrink-0" aria-hidden="true" />
          {r.sustituible
            ? "Ya existía: está arriba, en «Pendientes de decidir»."
            : "Ya existía un documento con el mismo número, proveedor, fecha y total: no se ha creado uno nuevo."}
        </span>
      )}
      {r?.success && r.sustituida && (
        <span className="flex basis-full items-start gap-1 pl-6 text-xs font-medium text-green-700">
          <Replace className="mt-0.5 h-3 w-3 shrink-0" aria-hidden="true" /> Factura existente sustituida por este documento.
        </span>
      )}
      {(e.piezas ?? 0) > 1 && (
        <span className="flex basis-full items-start gap-1 pl-6 text-xs text-muted-foreground">
          <Layers className="mt-0.5 h-3 w-3 shrink-0" aria-hidden="true" />
          {enMarcha ? `Documento largo: se lee en ${e.piezas} trozos en el servidor.` : `Documento largo: leído en ${e.piezas} trozos y unido.`}
        </span>
      )}
      {r?.success && r.archivoGuardado === false && (
        <span className="flex basis-full items-start gap-1 pl-6 text-xs font-medium text-destructive">
          <FileWarning className="mt-0.5 h-3 w-3 shrink-0" aria-hidden="true" /> Los datos se han guardado, pero el fichero original no se ha podido archivar.
        </span>
      )}
      {r?.success && (r.alertas?.length ?? 0) > 0 && (
        <div className="basis-full pl-6 text-xs font-medium text-amber-600">
          <span className="flex items-center gap-1">
            <AlertTriangle className="h-3 w-3 shrink-0" aria-hidden="true" />
            {r.alertas!.length} aviso{r.alertas!.length > 1 ? "s" : ""}
          </span>
          <ul className="mt-0.5 list-disc space-y-0.5 pl-8 font-normal">
            {r.alertas!.map((a, j) => (
              <li key={j}>{a.mensaje}</li>
            ))}
          </ul>
        </div>
      )}
    </li>
  );
}
