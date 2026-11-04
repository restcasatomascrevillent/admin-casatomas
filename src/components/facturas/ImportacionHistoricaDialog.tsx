import { useCallback, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { AlertCircle, CheckCircle2, Copy, FolderOpen, History, Loader2, Pause, Play } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  ESTADOS_FINALES,
  type EntradaManifiesto,
  type EstadoImportacion,
  importarEntrada,
  indexarCarpeta,
  lectorCarpeta,
  leerManifiesto,
} from "@/lib/facturas/importacionHistorica";

// ============================================================================
//  Importación histórica (solo administradores), 04/11/2026
// ----------------------------------------------------------------------------
//  Elige una carpeta con manifest.json + json/ + pdf/ y manda las facturas de
//  una en una a `importar-factura-historica`. Pausar y reanudar es seguro: lo
//  ya importado vuelve como «Ya importada» (import_clave). Sin scroll de
//  página: el diálogo tiene alto fijo y solo la tabla hace scroll por dentro.
// ============================================================================

interface Fila {
  entrada: EntradaManifiesto;
  estado: EstadoImportacion;
  facturaId: number | null;
  mensaje: string;
}

type Filtro = "todas" | "pendientes" | "importadas" | "duplicadas" | "errores";

const ETIQUETA: Record<EstadoImportacion, string> = {
  pendiente: "Pendiente",
  procesando: "Importando…",
  importada: "Importada",
  ya_importada: "Ya importada",
  duplicado: "Duplicada",
  error: "Error",
};

const TONO: Record<EstadoImportacion, string> = {
  pendiente: "bg-muted text-muted-foreground",
  procesando: "bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-200",
  importada: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200",
  ya_importada: "bg-emerald-50 text-emerald-700 dark:bg-emerald-900/20 dark:text-emerald-300",
  duplicado: "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200",
  error: "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-200",
};

const pasaFiltro = (f: Fila, filtro: Filtro) => {
  switch (filtro) {
    case "pendientes": return f.estado === "pendiente" || f.estado === "procesando";
    case "importadas": return f.estado === "importada" || f.estado === "ya_importada";
    case "duplicadas": return f.estado === "duplicado";
    case "errores": return f.estado === "error";
    default: return true;
  }
};

const euros = (n: number | null) =>
  n === null ? "—" : n.toLocaleString("es-ES", { style: "currency", currency: "EUR" });

const LOCAL: Record<string, string> = { casa_tomas: "Casa Tomás", touza: "Touza" };

export function ImportacionHistoricaDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const queryClient = useQueryClient();
  const [carpeta, setCarpeta] = useState<{ nombre: string; porRuta: Map<string, File> } | null>(null);
  const [filas, setFilas] = useState<Fila[]>([]);
  const filasRef = useRef<Fila[]>([]);
  const [errorCarpeta, setErrorCarpeta] = useState<string | null>(null);
  const [corriendo, setCorriendo] = useState(false);
  const [pausando, setPausando] = useState(false);
  const pausaRef = useRef(false);
  const [filtro, setFiltro] = useState<Filtro>("todas");
  const inputRef = useRef<HTMLInputElement>(null);

  const ponerFilas = useCallback((nuevas: Fila[]) => {
    filasRef.current = nuevas;
    setFilas(nuevas);
  }, []);
  const actualizar = useCallback((i: number, cambio: Partial<Fila>) => {
    const nuevas = filasRef.current.slice();
    nuevas[i] = { ...nuevas[i], ...cambio };
    ponerFilas(nuevas);
  }, [ponerFilas]);

  const elegirCarpeta = async (lista: FileList | null) => {
    setErrorCarpeta(null);
    if (!lista || lista.length === 0) return;
    const { manifiesto, porRuta } = indexarCarpeta(lista);
    const nombre = ((lista[0] as File & { webkitRelativePath?: string }).webkitRelativePath || "").split("/")[0] || "carpeta";
    try {
      if (!manifiesto) throw new Error("La carpeta no tiene manifest.json");
      const entradas = leerManifiesto(JSON.parse(await manifiesto.text()));
      if (entradas.length === 0) throw new Error("manifest.json está vacío");
      setCarpeta({ nombre, porRuta });
      ponerFilas(entradas.map((entrada) => ({ entrada, estado: "pendiente", facturaId: null, mensaje: "" })));
      setFiltro("todas");
    } catch (e) {
      setCarpeta(null);
      ponerFilas([]);
      setErrorCarpeta(e instanceof Error ? e.message : String(e));
    } finally {
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  const ejecutar = useCallback(async () => {
    if (!carpeta) return;
    pausaRef.current = false;
    setPausando(false);
    setCorriendo(true);
    const lector = lectorCarpeta(carpeta.porRuta);
    const cache = new Map();
    let hechas = 0;
    try {
      for (let i = 0; i < filasRef.current.length; i++) {
        if (pausaRef.current) break;
        const f = filasRef.current[i];
        if (ESTADOS_FINALES.has(f.estado)) continue;
        actualizar(i, { estado: "procesando", mensaje: "" });
        const r = await importarEntrada(f.entrada, lector, cache);
        actualizar(i, { estado: r.estado, facturaId: r.facturaId, mensaje: r.mensaje });
        if (r.estado === "importada") hechas++;
      }
    } finally {
      setCorriendo(false);
      setPausando(false);
      if (hechas > 0) {
        queryClient.invalidateQueries({ queryKey: ["facturas"] });
        queryClient.invalidateQueries({ queryKey: ["albaranes"] });
      }
    }
  }, [carpeta, queryClient, actualizar]);

  const pausar = () => {
    pausaRef.current = true;
    setPausando(true);
  };

  const cuenta = useMemo(() => {
    const c: Record<EstadoImportacion, number> = { pendiente: 0, procesando: 0, importada: 0, ya_importada: 0, duplicado: 0, error: 0 };
    for (const f of filas) c[f.estado]++;
    return c;
  }, [filas]);
  const total = filas.length;
  const terminadas = total - cuenta.pendiente - cuenta.procesando;
  const porHacer = filas.filter((f) => !ESTADOS_FINALES.has(f.estado)).length;
  const visibles = useMemo(
    () => filas.map((f, i) => ({ f, i })).filter(({ f }) => pasaFiltro(f, filtro)),
    [filas, filtro],
  );

  const cerrar = (v: boolean) => {
    if (!v && corriendo) {
      toast.info("Pausa la importación antes de cerrar");
      return;
    }
    onOpenChange(v);
  };

  return (
    <Dialog open={open} onOpenChange={cerrar}>
      <DialogContent className="flex h-[min(92dvh,52rem)] max-w-5xl flex-col gap-3 overflow-hidden">
        <DialogHeader className="shrink-0">
          <DialogTitle className="flex items-center gap-2">
            <History className="h-5 w-5" /> Importación histórica
          </DialogTitle>
          <DialogDescription>
            Facturas ya extraídas (JSON) con su PDF, sin volver a pasar el OCR. Elige la carpeta con{" "}
            <code>manifest.json</code>, <code>json/</code> y <code>pdf/</code>. Se importan de una en una; puedes pausar y
            reanudar cuando quieras (lo ya importado no se repite).
          </DialogDescription>
        </DialogHeader>

        <div className="flex shrink-0 flex-wrap items-center gap-2">
          <input
            ref={inputRef}
            type="file"
            className="hidden"
            multiple
            // webkitdirectory no está en los tipos de React.
            {...({ webkitdirectory: "", directory: "" } as Record<string, string>)}
            onChange={(e) => elegirCarpeta(e.target.files)}
          />
          <Button variant="outline" onClick={() => inputRef.current?.click()} disabled={corriendo}>
            <FolderOpen className="mr-2 h-4 w-4" /> {carpeta ? "Cambiar carpeta" : "Elegir carpeta"}
          </Button>
          {carpeta && (
            <span className="truncate text-sm text-muted-foreground">
              {carpeta.nombre} · {total} factura(s)
            </span>
          )}
          <div className="ml-auto flex items-center gap-2">
            {corriendo ? (
              <Button variant="secondary" onClick={pausar} disabled={pausando}>
                {pausando ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Pause className="mr-2 h-4 w-4" />}
                {pausando ? "Pausando…" : "Pausar"}
              </Button>
            ) : (
              <Button onClick={ejecutar} disabled={!carpeta || porHacer === 0}>
                <Play className="mr-2 h-4 w-4" />
                {terminadas === 0 ? "Importar" : cuenta.error > 0 && porHacer === cuenta.error ? "Reintentar errores" : "Reanudar"}
              </Button>
            )}
          </div>
        </div>

        {errorCarpeta && (
          <div className="flex shrink-0 items-start gap-2 rounded-md border border-red-200 bg-red-50 p-2 text-sm text-red-800 dark:border-red-900 dark:bg-red-950/40 dark:text-red-200">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" /> {errorCarpeta}
          </div>
        )}

        {total > 0 && (
          <div className="shrink-0 space-y-2">
            <Progress value={total ? (terminadas / total) * 100 : 0} />
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
              <span className="font-medium">{terminadas} / {total}</span>
              <span className="flex items-center gap-1 text-emerald-700 dark:text-emerald-300">
                <CheckCircle2 className="h-4 w-4" /> {cuenta.importada} importadas
                {cuenta.ya_importada > 0 && ` · ${cuenta.ya_importada} ya estaban`}
              </span>
              <span className="flex items-center gap-1 text-amber-700 dark:text-amber-300">
                <Copy className="h-4 w-4" /> {cuenta.duplicado} duplicadas
              </span>
              <span className="flex items-center gap-1 text-red-700 dark:text-red-300">
                <AlertCircle className="h-4 w-4" /> {cuenta.error} con error
              </span>
              <div className="ml-auto">
                <Select value={filtro} onValueChange={(v) => setFiltro(v as Filtro)}>
                  <SelectTrigger className="h-8 w-40" aria-label="Filtrar la lista">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="todas">Todas</SelectItem>
                    <SelectItem value="pendientes">Pendientes</SelectItem>
                    <SelectItem value="importadas">Importadas</SelectItem>
                    <SelectItem value="duplicadas">Duplicadas</SelectItem>
                    <SelectItem value="errores">Errores</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>
        )}

        <div className="min-h-0 flex-1 overflow-auto rounded-md border">
          {total === 0 ? (
            <div className="flex h-full items-center justify-center p-6 text-center text-sm text-muted-foreground">
              Elige una carpeta para ver las facturas que se van a importar.
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead className="sticky top-0 z-10 bg-muted/95 text-left text-xs uppercase text-muted-foreground backdrop-blur">
                <tr>
                  <th className="px-2 py-2 font-medium">#</th>
                  <th className="px-2 py-2 font-medium">Proveedor</th>
                  <th className="px-2 py-2 font-medium">Fecha</th>
                  <th className="px-2 py-2 text-right font-medium">Total</th>
                  <th className="hidden px-2 py-2 font-medium sm:table-cell">Local</th>
                  <th className="px-2 py-2 font-medium">Estado</th>
                  <th className="px-2 py-2 font-medium">Detalle</th>
                </tr>
              </thead>
              <tbody>
                {visibles.map(({ f, i }) => (
                  <tr key={f.entrada.clave} className="border-t align-top">
                    <td className="px-2 py-1.5 tabular-nums text-muted-foreground">{i + 1}</td>
                    <td className="max-w-[14rem] truncate px-2 py-1.5" title={f.entrada.clave}>
                      {f.entrada.proveedor ?? "—"}
                    </td>
                    <td className="whitespace-nowrap px-2 py-1.5 tabular-nums">{f.entrada.fecha ?? "—"}</td>
                    <td className="whitespace-nowrap px-2 py-1.5 text-right tabular-nums">{euros(f.entrada.total)}</td>
                    <td className="hidden whitespace-nowrap px-2 py-1.5 sm:table-cell">
                      {f.entrada.local ? LOCAL[f.entrada.local] ?? "—" : "—"}
                    </td>
                    <td className="whitespace-nowrap px-2 py-1.5">
                      <Badge variant="outline" className={`border-transparent ${TONO[f.estado]}`}>
                        {f.estado === "procesando" && <Loader2 className="mr-1 h-3 w-3 animate-spin" />}
                        {ETIQUETA[f.estado]}
                      </Badge>
                    </td>
                    <td className="px-2 py-1.5 text-muted-foreground">
                      <span className="line-clamp-2 break-words" title={f.mensaje}>
                        {f.facturaId ? `Factura ${f.facturaId}${f.mensaje ? " · " : ""}` : ""}
                        {f.mensaje}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
