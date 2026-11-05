import { useRef, useState } from "react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import {
  Upload, FileText, X, Send, Loader2, CheckCircle2, XCircle, AlertTriangle, Copy,
  Camera, FolderOpen, Replace, RotateCcw, Clock, Image as ImageIcon, File as FileIcon,
  Layers, ChevronUp, ChevronDown, FilePlus2, Ungroup,
} from "lucide-react";
import { Progress } from "@/components/ui/progress";
import { useColaSubida } from "@/hooks/useColaSubida";
import {
  type CausaRechazo,
  type ElementoCola,
  POSICION_AVISOS,
  progresoTanda,
  puedeCancelar,
  puedeReintentar,
  puedeVolverASubir,
} from "@/lib/facturas/colaSubida";
import type { PendienteDecidir } from "@/lib/facturas/pendientesDecidir";
import {
  claseFichero,
  ETIQUETA_TIPO,
  formatoTamano,
  lineaEstado,
  type NivelFila,
  ordenarPorGravedad,
  tipoDocumento,
} from "@/lib/facturas/resultadosCarga";
import { cn } from "@/lib/utils";
import { FotoExistente } from "./AvisoDuplicadoDialog";
import { CosteLecturaDocumento } from "./CosteLecturaDocumento";
import { SustituirFacturaDialog } from "./SustituirFacturaDialog";
import { useCanAccessSection } from "@/hooks/useUserRole";
import { useDecisionDuplicado } from "./useDecisionDuplicado";

/** Título del aviso de un fichero que no se admite. */
const TITULO_RECHAZO: Record<CausaRechazo, string> = {
  tipo: "Tipo de archivo no permitido",
  tamano: "Archivo demasiado grande",
  vacio: "Archivo vacío",
};

/** Dónde se ve el documento ya guardado (la pestaña Compras, en Documentos). */
const RUTA_COMPRAS = "/facturas?tab=compras";
/** «Ver»: abre ESE documento en Compras › Documentos (sin id, solo Compras). */
const rutaDocumento = (id: number | undefined) => (id ? `${RUTA_COMPRAS}&modo=documentos&doc=${id}` : RUTA_COMPRAS);

/**
 * Dorado de marca: solo para la acción principal de la pantalla. Oscurecido a
 * 34 % de luminosidad (05/11/2026): con texto blanco da 5,3:1 (el de 45 %
 * daba 3,3:1, por debajo del 4,5:1 de WCAG AA).
 */
const DORADO = "bg-[hsl(38,59%,34%)] text-white hover:bg-[hsl(38,59%,28%)] focus-visible:ring-[hsl(38,59%,34%)]";

/**
 * Pestaña «Cargar» de Facturas. Solo ENSEÑA la cola global
 * (<ColaSubidaProvider>, montado en App.tsx): lo que se envía sigue
 * procesándose aunque se cambie de pestaña o de sección, y al volver aquí se
 * ve en qué punto va. Estilo plano (como el chat de «IA»): sin tarjeta
 * exterior, filas con separador fino y el dorado solo en «Enviar». Ocupa el
 * alto que le da la página (sin scroll de página): zona de subida, barra y
 * botones fijos; la lista hace scroll por dentro.
 */
export function SubidaFacturas() {
  const { cola, estado, pendientes, descartarPendiente, sustituir, anadirPagina } = useColaSubida();
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  // Segundo input solo para la cámara de la tablet/móvil (`capture`): abre la
  // cámara directamente en vez del selector de archivos.
  const camaraInputRef = useRef<HTMLInputElement>(null);
  const { decision, setDecision, cancelar, dejar, confirmar: confirmarDecision } = useDecisionDuplicado({
    sustituir,
    anadirPagina,
    descartar: descartarPendiente,
  });
  /** Fotos marcadas para unirlas como UN documento. */
  const [marcados, setMarcados] = useState<Set<string>>(() => new Set());

  const elementos = estado.elementos;
  const seleccionados = elementos.filter((e) => e.fase === "seleccionado");
  const resto = ordenarPorGravedad(elementos.filter((e) => e.fase !== "seleccionado"));
  const terminados = elementos.filter((e) => e.fase === "terminado");
  const reintentables = terminados.filter(puedeReintentar);
  const cancelarEnvio = async (e: ElementoCola) => {
    const r = await cola.cancelar(e.id);
    if (r.ok === false) toast.error(`No se ha cancelado ${e.nombre}`, { description: r.motivo, position: POSICION_AVISOS });
  };
  const progreso = progresoTanda(estado);
  const hayLista = elementos.length > 0 || pendientes.length > 0;
  const compacta = hayLista; // con algo en la cola, la zona de subida es una fila ligera

  const anadir = (files: FileList | null) => {
    if (!files || files.length === 0) return;
    // Se copia la lista ANTES de vaciar el input: `files` es una referencia viva.
    const { rechazados } = cola.añadirArchivos(Array.from(files));
    for (const r of rechazados) {
      toast.error(TITULO_RECHAZO[r.causa], { description: `El archivo ${r.nombre} ${r.motivo}`, position: POSICION_AVISOS });
    }
    // Limpiar los inputs (permite volver a elegir el mismo archivo).
    if (fileInputRef.current) fileInputRef.current.value = "";
    if (camaraInputRef.current) camaraInputRef.current.value = "";
  };

  const marcables = seleccionados.filter((e) => e.fotos || claseFichero(e) === "imagen");
  const marcadosVigentes = marcables.filter((e) => marcados.has(e.id));
  const alternarMarca = (id: string) =>
    setMarcados((prev) => {
      const nuevo = new Set(prev);
      if (nuevo.has(id)) nuevo.delete(id);
      else nuevo.add(id);
      return nuevo;
    });
  const unirMarcados = () => {
    const r = cola.unir(marcadosVigentes.map((e) => e.id));
    if ("error" in r) {
      toast.error("No se han unido", { description: r.error });
      return;
    }
    setMarcados(new Set());
  };

  const botonesSubida = (
    <>
      <Button
        type="button"
        variant={hayLista ? "outline" : "default"}
        className={cn("h-11 gap-2 px-5", !hayLista && DORADO)}
        onClick={() => camaraInputRef.current?.click()}
      >
        <Camera className="h-4 w-4" aria-hidden="true" />
        Hacer foto
      </Button>
      <Button type="button" variant="outline" className="h-11 gap-2 px-5" onClick={() => fileInputRef.current?.click()}>
        <FolderOpen className="h-4 w-4" aria-hidden="true" />
        Elegir archivos
      </Button>
    </>
  );

  return (
    <div
      className="flex h-full min-h-0 flex-col gap-3"
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
        // Con algo en la cola: una fila ligera para añadir más.
        <div
          data-zona="compacta"
          className={cn(
            "flex shrink-0 flex-wrap items-center gap-2 rounded-lg px-1 transition-colors",
            isDragging && "bg-muted ring-1 ring-[hsl(38,59%,45%)]",
          )}
        >
          <p className="min-w-0 flex-1 basis-40 text-sm text-muted-foreground">
            {isDragging ? "Suelta aquí para añadir" : "Añade más: foto, archivos o arrastrándolos aquí (PDF o imagen, máx. 10MB)."}
          </p>
          <div className="flex flex-wrap gap-2" data-tour="facturas-cargar-botones">{botonesSubida}</div>
        </div>
      ) : (
        // Cola vacía: la zona de soltar es la propia superficie, centrada y de tamaño razonable.
        <div className="flex min-h-0 flex-1 items-center justify-center">
          <div
            data-zona="amplia"
            className={cn(
              "w-full max-w-xl rounded-2xl border border-dashed px-6 py-10 text-center transition-colors sm:py-14",
              isDragging ? "border-[hsl(38,59%,45%)] bg-muted/60" : "border-border bg-muted/20",
            )}
          >
            <Upload
              className={cn("mx-auto mb-4 h-9 w-9 transition-transform", isDragging ? "scale-110 text-foreground" : "text-muted-foreground")}
              aria-hidden="true"
            />
            <p className="mb-1 text-base font-medium">
              {isDragging ? "Suelta aquí para añadir" : "Sube facturas y albaranes"}
            </p>
            <p className="mb-6 text-sm text-muted-foreground">
              Haz una foto o elige archivos de la galería o de Archivos.
            </p>
            {/* Dos botones grandes en vez de una zona entera "clicable": en la tablet
                se toca, no se arrastra. El de la cámara usa `capture` para abrir la
                cámara trasera directamente; el otro admite PDF y varias imágenes. */}
            <div className="flex flex-col items-stretch justify-center gap-2 sm:flex-row sm:items-center sm:gap-3" data-tour="facturas-cargar-botones">
              {botonesSubida}
            </div>
            <p className="mt-6 text-xs text-muted-foreground">
              PDF, JPG, PNG o WEBP (máximo 10MB por archivo). En un ordenador también puedes arrastrarlos aquí.
            </p>
          </div>
        </div>
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

      {/* Barra de progreso de la tanda en marcha */}
      {progreso && (
        <div className="shrink-0 space-y-1.5" role="status" aria-live="polite">
          <div className="flex flex-wrap justify-between gap-x-3 text-sm text-muted-foreground">
            <span className="font-medium text-foreground">
              Procesando {progreso.hechos} de {progreso.total}
            </span>
            <span className="text-xs">Sigue aunque cambies de sección: te avisamos al terminar.</span>
          </div>
          <Progress
            className="h-1.5"
            value={progreso.total > 0 ? (progreso.hechos / progreso.total) * 100 : 0}
            aria-label="Progreso de la subida"
          />
        </div>
      )}

      {/* Lista: lo único que hace scroll, y solo si no cabe */}
      {hayLista && (
        <div
          role="region"
          aria-label="Documentos de la subida"
          tabIndex={0}
          className="min-h-0 flex-1 space-y-5 overflow-y-auto overscroll-contain focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {pendientes.length > 0 && (
            <SeccionPendientes
              pendientes={pendientes}
              onDecidir={(p) =>
                setDecision(p.anadible ? { tipo: "anadir", a: p.anadible } : p.sustituible ? { tipo: "sustituir", s: p.sustituible } : null)}
              onDescartar={(p) => descartarPendiente(p.trabajoId)}
            />
          )}

          {seleccionados.length > 0 && (
            <section aria-label="Archivos seleccionados">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="text-xs font-medium text-muted-foreground">Archivos seleccionados ({seleccionados.length})</h3>
                {marcables.length >= 2 && (
                  <p className="text-xs text-muted-foreground">
                    ¿Varias fotos del mismo documento? Márcalas y únelas: se leen como páginas 1, 2, 3…
                  </p>
                )}
              </div>
              {marcadosVigentes.length >= 2 && (
                <Button type="button" variant="outline" className="my-2 h-11 gap-2" onClick={unirMarcados}>
                  <Layers className="h-4 w-4" aria-hidden="true" />
                  Unir {marcadosVigentes.length} fotos como un documento (páginas 1–{
                    marcadosVigentes.reduce((n, e) => n + (e.fotos?.length ?? 1), 0)
                  })
                </Button>
              )}
              <ul className="divide-y divide-border/60">
                {seleccionados.map((e) => (
                  <li key={e.id} className="flex items-center gap-3 py-2">
                    {marcables.includes(e) && (
                      <input
                        type="checkbox"
                        className="h-5 w-5 shrink-0 accent-[hsl(38,59%,45%)]"
                        checked={marcados.has(e.id)}
                        onChange={() => alternarMarca(e.id)}
                        aria-label={`Marcar ${e.nombre} para unirla con otras fotos`}
                      />
                    )}
                    <Miniatura e={e} />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{e.nombre}</p>
                      <p className="text-xs text-muted-foreground">
                        {e.fotos ? `Un documento de ${e.fotos.length} páginas · ` : ""}
                        {formatoTamano(e.tamano)}
                      </p>
                      {e.fotos && (
                        <PaginasGrupo
                          e={e}
                          onMover={(desde, hasta) => cola.moverPagina(e.id, desde, hasta)}
                          onSeparar={() => cola.separar(e.id)}
                        />
                      )}
                    </div>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-11 w-11 shrink-0 text-muted-foreground hover:text-foreground"
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
            <section aria-label="Documentos enviados">
              <h3 className="text-xs font-medium text-muted-foreground">Enviados</h3>
              <ul className="divide-y divide-border/60">
                {resto.map((e) => (
                  <FilaEnviado
                    key={e.id}
                    e={e}
                    onReintentar={() => cola.reintentar(e.id)}
                    onVolverASubir={() => cola.volverASubir(e.id)}
                    onCancelar={() => void cancelarEnvio(e)}
                  />
                ))}
              </ul>
            </section>
          )}
        </div>
      )}

      {/* Acciones: «Enviar» (dorado) fijo abajo; el resto, ligeros */}
      {(seleccionados.length > 0 || terminados.length > 0) && (
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          {seleccionados.length > 0 && (
            <Button onClick={() => cola.enviar()} className={cn("h-12 min-w-[12rem] flex-[2] text-base", DORADO)}>
              <Send className="mr-2 h-4 w-4" aria-hidden="true" />
              Enviar {seleccionados.length} documento{seleccionados.length !== 1 ? "s" : ""}
            </Button>
          )}
          {reintentables.length > 0 && (
            <Button variant="ghost" onClick={() => cola.reintentar()} className="h-11 flex-1 text-muted-foreground hover:text-foreground">
              Reintentar fallidos
            </Button>
          )}
          {terminados.length > 0 && (
            <Button variant="ghost" onClick={() => cola.limpiarTerminados()} className="h-11 flex-1 text-muted-foreground hover:text-foreground">
              Limpiar terminados
            </Button>
          )}
        </div>
      )}
      <SustituirFacturaDialog
        decision={decision}
        onCancelar={cancelar}
        onDejar={dejar}
        onConfirmar={confirmarDecision}
      />
    </div>
  );
}

/** Miniatura real si es imagen; si no, un icono según el tipo de fichero. */
function Miniatura({ e }: { e: ElementoCola }) {
  if (e.preview) return <img src={e.preview} alt="" className="h-11 w-11 shrink-0 rounded-md object-cover" />;
  const clase = claseFichero(e);
  const Icono = clase === "pdf" ? FileText : clase === "imagen" ? ImageIcon : FileIcon;
  return (
    <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
      <Icono className="h-5 w-5" aria-hidden="true" />
    </div>
  );
}

/**
 * Páginas de unas fotos unidas: arrastrar para ordenar (ratón) o flechas
 * (tablet y teclado). La primera es la página 1.
 */
function PaginasGrupo({
  e,
  onMover,
  onSeparar,
}: {
  e: ElementoCola;
  onMover: (desde: number, hasta: number) => void;
  onSeparar: () => void;
}) {
  const [arrastrando, setArrastrando] = useState<number | null>(null);
  const fotos = e.fotos ?? [];
  return (
    <div className="mt-1.5 space-y-1.5">
      <ol className="flex flex-wrap gap-2" aria-label={`Orden de las páginas de ${e.nombre}`}>
        {fotos.map((f, i) => (
          <li
            key={`${f.name}-${f.size}-${f.lastModified}-${i}`}
            draggable
            onDragStart={(ev) => {
              ev.stopPropagation();
              setArrastrando(i);
            }}
            onDragOver={(ev) => {
              ev.preventDefault();
              ev.stopPropagation();
            }}
            onDrop={(ev) => {
              ev.preventDefault();
              ev.stopPropagation();
              if (arrastrando !== null) onMover(arrastrando, i);
              setArrastrando(null);
            }}
            onDragEnd={() => setArrastrando(null)}
            className={cn(
              "flex cursor-grab items-center gap-1 rounded-md border bg-background p-1 active:cursor-grabbing",
              arrastrando === i && "opacity-50",
            )}
          >
            {e.previews?.[i] ? (
              <img src={e.previews[i]} alt="" className="h-10 w-10 rounded object-cover" />
            ) : (
              <ImageIcon className="h-5 w-5 text-muted-foreground" aria-hidden="true" />
            )}
            <span className="px-0.5 text-xs font-medium">Pág. {i + 1}</span>
            {/* Objetivo táctil de 44 × 44 px (antes 18 px: imposible con el dedo). */}
            <span className="flex">
              <button
                type="button"
                className="inline-flex h-11 w-11 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-30"
                disabled={i === 0}
                onClick={() => onMover(i, i - 1)}
                aria-label={`Subir la página ${i + 1} (${f.name})`}
              >
                <ChevronUp className="h-4 w-4" aria-hidden="true" />
              </button>
              <button
                type="button"
                className="inline-flex h-11 w-11 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-30"
                disabled={i === fotos.length - 1}
                onClick={() => onMover(i, i + 1)}
                aria-label={`Bajar la página ${i + 1} (${f.name})`}
              >
                <ChevronDown className="h-4 w-4" aria-hidden="true" />
              </button>
            </span>
          </li>
        ))}
      </ol>
      <Button type="button" variant="ghost" size="sm" className="h-9 gap-1.5 px-2 text-muted-foreground" onClick={onSeparar}>
        <Ungroup className="h-4 w-4" aria-hidden="true" />
        Separar
      </Button>
    </div>
  );
}

function SeccionPendientes({
  pendientes,
  onDecidir,
  onDescartar,
}: {
  pendientes: PendienteDecidir[];
  onDecidir: (p: PendienteDecidir) => void;
  onDescartar: (p: PendienteDecidir) => void;
}) {
  // Sustituir o añadir página cambia una factura: solo con permiso de edición (QA C-09).
  const { canAccess: puedeEditar } = useCanAccessSection("facturas", "edit");
  return (
    <section aria-label="Pendientes de decidir">
      <h3 className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
        <Copy className="h-3.5 w-3.5 text-blue-500" aria-hidden="true" />
        Pendientes de decidir ({pendientes.length})
      </h3>
      <ul className="divide-y divide-border/60">
        {pendientes.map((p) => (
          <li key={p.trabajoId} className="space-y-2 py-3">
            <p className="text-sm">
              <span className="font-medium">{p.nombre}</span>
              {p.anadible ? (
                <span className="block text-xs text-muted-foreground">
                  Es la página {p.anadible.pagina.actual} de {p.anadible.pagina.total} de la factura{" "}
                  {p.anadible.existente.numero_documento}, que ya existe con {p.anadible.existente.lineas} líneas. Añádela
                  para completarla (no se borra nada).
                </span>
              ) : p.sustituible ? (
                <span className="block text-xs text-muted-foreground">
                  Ya existe la factura {p.sustituible.existente.numero_documento} ({p.sustituible.existente.lineas} líneas):
                  no se ha creado otra. Si la que hay está mal leída, puedes sustituirla por este documento.
                </span>
              ) : null}
            </p>
            <div className="flex flex-wrap gap-2">
              {!puedeEditar ? null : p.anadible ? (
                <Button type="button" variant="outline" className="h-11 gap-2" onClick={() => onDecidir(p)}>
                  <FilePlus2 className="h-4 w-4" aria-hidden="true" />
                  Añadir como página {p.anadible.pagina.actual} a la factura {p.anadible.existente.numero_documento}
                </Button>
              ) : (
                <Button type="button" variant="outline" className="h-11 gap-2" onClick={() => onDecidir(p)}>
                  <Replace className="h-4 w-4" aria-hidden="true" />
                  Sustituir la existente
                </Button>
              )}
              {p.sustituible?.existente?.id ? (
                <div className="min-w-0">
                  <FotoExistente id={p.sustituible.existente.id} />
                </div>
              ) : null}
              <Button type="button" variant="ghost" className="h-11 text-muted-foreground hover:text-foreground" onClick={() => onDescartar(p)}>
                {/* Una página suelta no «deja» nada: se decide no añadirla. */}
                {p.anadible ? "No añadirla" : "Dejar la que hay"}
              </Button>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

function IconoEstado({ nivel, e }: { nivel: NivelFila; e: ElementoCola }) {
  const base = "mt-0.5 h-4 w-4 shrink-0";
  const r = e.resultado;
  // Guardado pero SIN original: en rojo (hay que guardar una copia a mano).
  if (r?.success && r.archivoGuardado === false) return <XCircle className={cn(base, "text-destructive")} aria-hidden="true" />;
  // Sigue (o se quedó parado) en el servidor: reloj, no rojo.
  if (e.lento || (r && !r.success && (r.sigueEnServidor || r.parado))) {
    return <Clock className={cn(base, "text-amber-600 dark:text-amber-400")} aria-hidden="true" />;
  }
  switch (nivel) {
    case "marcha":
      return e.fase === "en_cola" ? (
        <Clock className={cn(base, "text-muted-foreground")} aria-hidden="true" />
      ) : (
        <Loader2 className={cn(base, "text-muted-foreground motion-safe:animate-spin")} aria-hidden="true" />
      );
    case "fallido":
      return <XCircle className={cn(base, "text-destructive")} aria-hidden="true" />;
    case "aviso":
      return <AlertTriangle className={cn(base, "text-amber-600 dark:text-amber-400")} aria-hidden="true" />;
    case "duplicado":
      // Icono distinto a propósito: un check verde daría a entender que se
      // creó un documento nuevo, y no es el caso.
      return <Copy className={cn(base, "text-blue-500")} aria-hidden="true" />;
    default:
      return <CheckCircle2 className={cn(base, "text-green-600 dark:text-green-500")} aria-hidden="true" />;
  }
}

/**
 * Un documento enviado: icono de estado, nombre (+ tipo), UNA línea de estado
 * y sus acciones: «Reintentar» (si ya tiene trabajo en el servidor, reanuda
 * ESE trabajo), «Volver a subir» (el servidor ya no tiene sus ficheros),
 * cancelar mientras está en marcha y «Ver» al terminar.
 */
function FilaEnviado({
  e,
  onReintentar,
  onVolverASubir,
  onCancelar,
}: {
  e: ElementoCola;
  onReintentar: () => void;
  onVolverASubir: () => void;
  onCancelar: () => void;
}) {
  const r = e.resultado;
  const linea = lineaEstado(e);
  const tipo = r?.success ? tipoDocumento(r) : null;
  const sinOriginal = !!r?.success && r.archivoGuardado === false;
  const enServidor = !!r && !r.success && (r.parado || r.sigueEnServidor);
  // En marcha (menos el camino síncrono) o parado en el servidor: se puede cancelar / quitar.
  const cancelable = (e.fase !== "terminado" && puedeCancelar(e)) || (enServidor && !!e.trabajoId);
  return (
    <li data-nivel={linea.nivel} className="flex items-start gap-3 py-2.5">
      <IconoEstado nivel={linea.nivel} e={e} />
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <span className="min-w-0 truncate text-sm font-medium">{e.nombre}</span>
          {tipo && <span className="shrink-0 text-xs text-muted-foreground">{ETIQUETA_TIPO[tipo]}</span>}
        </div>
        <p className={cn("break-words text-xs", sinOriginal ? "font-medium text-destructive" : "text-muted-foreground")}>
          {linea.texto}
          {/* Lo que costó leerlo (también si resultó duplicado: la lectura se pagó igual). */}
          {r?.success && r.costeUsd !== undefined && (
            <>
              {" · "}
              <CosteLecturaDocumento costeUsd={r.costeUsd} />
            </>
          )}
        </p>
      </div>
      {puedeReintentar(e) && (
        <Button
          type="button"
          variant="ghost"
          className="h-11 shrink-0 gap-1.5 px-3 text-muted-foreground hover:text-foreground"
          onClick={onReintentar}
          aria-label={`Reintentar ${e.nombre}`}
        >
          <RotateCcw className="h-4 w-4" aria-hidden="true" />
          Reintentar
        </Button>
      )}
      {puedeVolverASubir(e) && (
        <Button
          type="button"
          variant="ghost"
          className="h-11 shrink-0 gap-1.5 px-3 text-muted-foreground hover:text-foreground"
          onClick={onVolverASubir}
          aria-label={`Volver a subir ${e.nombre}`}
        >
          <Upload className="h-4 w-4" aria-hidden="true" />
          Volver a subir
        </Button>
      )}
      {cancelable && (
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-11 w-11 shrink-0 text-muted-foreground hover:text-foreground"
          onClick={onCancelar}
          aria-label={e.fase === "terminado" ? `Quitar ${e.nombre} del servidor` : `Cancelar ${e.nombre}`}
          title={e.fase === "terminado" ? "Quitar (se descarta en el servidor)" : "Cancelar el envío"}
        >
          <X className="h-4 w-4" aria-hidden="true" />
        </Button>
      )}
      {r?.success && (
        <Link
          to={rutaDocumento(r.facturaId)}
          aria-label={`Ver ${e.nombre}`}
          className="inline-flex h-11 shrink-0 items-center rounded-md px-3 text-sm font-medium text-foreground underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          Ver
        </Link>
      )}
    </li>
  );
}
