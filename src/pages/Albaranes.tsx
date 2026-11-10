import { useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { format, isToday } from "date-fns";
import { es } from "date-fns/locale";
import { AlertCircle, Camera, CheckCircle2, Copy, Images, Loader2, RefreshCw, XCircle } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  claseEstado,
  hayLeyendo,
  leerMisSubidas,
  subirAlbaran,
  TEXTO_ESTADO,
  TIPOS_ADMITIDOS,
  type ClaseEstado,
  type DepsSubida,
} from "@/lib/facturas/albaranes";

export const CLAVE_MIS_SUBIDAS = "albaranes_mis_subidas";

/** Lo que se está subiendo desde ESTE móvil (antes de que el servidor lo tenga). */
interface EnCurso {
  clave: string;
  nombre: string;
  estado: "subiendo" | "enviado" | "error";
  error?: string;
}

const ICONO: Record<ClaseEstado, typeof CheckCircle2> = {
  leyendo: Loader2,
  recibido: CheckCircle2,
  repetido: Copy,
  fallido: XCircle,
  cancelado: XCircle,
};

const COLOR: Record<ClaseEstado, string> = {
  leyendo: "border-sky-300 bg-sky-50 text-sky-900 dark:border-sky-800 dark:bg-sky-950 dark:text-sky-200",
  recibido: "border-emerald-300 bg-emerald-50 text-emerald-900 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-200",
  repetido: "border-border bg-muted/60 text-foreground/80",
  fallido: "border-destructive/30 bg-destructive/10 text-destructive",
  cancelado: "border-border bg-muted/60 text-muted-foreground",
};

function cuando(fecha: string): string {
  const d = new Date(fecha);
  return isToday(d) ? `Hoy, ${format(d, "HH:mm")}` : format(d, "d MMM, HH:mm", { locale: es });
}

interface Props {
  /** Solo para tests: sustituye la subida real (troceado, Storage, procesar-factura). */
  deps?: DepsSubida;
}

/**
 * «Subir albaranes» (10/11/2026, tipo de usuario «Albaranes»). Pantalla pensada para el móvil: hacer o
 * elegir fotos de albaranes y facturas y ver si llegaron. Quien solo tiene «Facturas · Solo fotos» entra
 * directo aquí y no ve importes ni lo leído (la BD y procesar-factura no se lo dan).
 */
export default function Albaranes({ deps }: Props) {
  const queryClient = useQueryClient();
  const camaraRef = useRef<HTMLInputElement>(null);
  const galeriaRef = useRef<HTMLInputElement>(null);
  const [enCurso, setEnCurso] = useState<EnCurso[]>([]);
  const subiendo = enCurso.some((e) => e.estado === "subiendo");

  const subidas = useQuery({
    queryKey: [CLAVE_MIS_SUBIDAS],
    queryFn: () => leerMisSubidas(),
    // Mientras algo se lee, se refresca solo cada 8 s.
    refetchInterval: (q) => (q.state.data && hayLeyendo(q.state.data) ? 8000 : false),
  });

  const actualizar = (clave: string, cambio: Partial<EnCurso>) =>
    setEnCurso((prev) => prev.map((e) => (e.clave === clave ? { ...e, ...cambio } : e)));

  const subirFicheros = async (lista: FileList | null) => {
    const ficheros = Array.from(lista ?? []);
    if (ficheros.length === 0) return;
    const nuevos = ficheros.map((f, i) => ({ clave: `${Date.now()}-${i}-${f.name}`, nombre: f.name, estado: "subiendo" as const }));
    setEnCurso((prev) => [...nuevos, ...prev].slice(0, 20));
    let bien = 0;
    // Una detrás de otra: con mala cobertura, varias a la vez se cortan todas.
    for (const [i, file] of ficheros.entries()) {
      const { clave } = nuevos[i];
      try {
        await subirAlbaran(file, deps);
        bien++;
        actualizar(clave, { estado: "enviado" });
      } catch (e) {
        actualizar(clave, { estado: "error", error: e instanceof Error ? e.message : "No se pudo subir" });
      }
    }
    if (bien > 0) {
      toast.success(bien === 1 ? "Foto enviada. Se lee sola." : `${bien} fotos enviadas. Se leen solas.`);
      void queryClient.invalidateQueries({ queryKey: [CLAVE_MIS_SUBIDAS] });
    }
    if (bien < ficheros.length) toast.error("Alguna foto no se ha podido subir. Mira abajo el motivo y repítela.");
  };

  const alElegir = (e: React.ChangeEvent<HTMLInputElement>) => {
    const lista = e.target.files;
    void subirFicheros(lista).finally(() => {
      // Permite volver a elegir el mismo fichero.
      e.target.value = "";
    });
  };

  const lista = subidas.data ?? [];

  return (
    <div className="mx-auto flex w-full max-w-xl flex-col gap-5 pb-8">
      <header className="space-y-1">
        <h1 className="text-xl font-semibold">Subir albaranes</h1>
        <p className="text-sm text-muted-foreground">
          Haz una foto por albarán o factura, entera, recta y con luz. Se lee sola y la oficina revisa los datos.
        </p>
      </header>

      <section aria-label="Subir fotos" className="grid gap-3 sm:grid-cols-2">
        <input
          ref={camaraRef}
          type="file"
          accept="image/*"
          capture="environment"
          className="sr-only"
          tabIndex={-1}
          aria-hidden="true"
          onChange={alElegir}
          data-testid="input-camara"
        />
        <input
          ref={galeriaRef}
          type="file"
          accept={TIPOS_ADMITIDOS.join(",")}
          multiple
          className="sr-only"
          tabIndex={-1}
          aria-hidden="true"
          onChange={alElegir}
          data-testid="input-galeria"
        />
        <Button
          type="button"
          size="lg"
          className="h-20 gap-3 text-base"
          disabled={subiendo}
          onClick={() => camaraRef.current?.click()}
        >
          {subiendo ? <Loader2 className="h-6 w-6 animate-spin" aria-hidden="true" /> : <Camera className="h-6 w-6" aria-hidden="true" />}
          {subiendo ? "Subiendo…" : "Hacer foto"}
        </Button>
        <Button
          type="button"
          size="lg"
          variant="outline"
          className="h-20 gap-3 text-base"
          disabled={subiendo}
          onClick={() => galeriaRef.current?.click()}
        >
          <Images className="h-6 w-6" aria-hidden="true" />
          Elegir fotos o PDF
        </Button>
      </section>

      {enCurso.length > 0 && (
        <section aria-label="Enviadas desde este móvil" className="space-y-2">
          <h2 className="text-sm font-medium text-muted-foreground">Ahora</h2>
          <ul className="space-y-2">
            {enCurso.map((e) => (
              <li key={e.clave} className="flex items-start gap-3 rounded-md border bg-card px-3 py-2 text-sm" data-testid="en-curso">
                {e.estado === "subiendo" && <Loader2 className="mt-0.5 h-4 w-4 shrink-0 animate-spin text-muted-foreground" aria-hidden="true" />}
                {e.estado === "enviado" && <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" aria-hidden="true" />}
                {e.estado === "error" && <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" aria-hidden="true" />}
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">{e.nombre}</p>
                  <p className={cn("text-xs", e.estado === "error" ? "text-destructive" : "text-muted-foreground")}>
                    {e.estado === "subiendo" ? "Subiendo…" : e.estado === "enviado" ? "Enviada" : e.error}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section aria-label="Mis últimas subidas" className="space-y-2">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-sm font-medium text-muted-foreground">Mis últimas subidas (14 días)</h2>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-9 gap-1.5"
            onClick={() => void subidas.refetch()}
            disabled={subidas.isFetching}
          >
            <RefreshCw className={cn("h-4 w-4", subidas.isFetching && "animate-spin")} aria-hidden="true" />
            Actualizar
          </Button>
        </div>
        {subidas.isLoading ? (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> Cargando…
          </p>
        ) : subidas.isError ? (
          <p className="text-sm text-destructive">No se ha podido cargar la lista. Pulsa «Actualizar».</p>
        ) : lista.length === 0 ? (
          <p className="rounded-md border border-dashed px-3 py-6 text-center text-sm text-muted-foreground">
            Aún no has subido nada.
          </p>
        ) : (
          <ul className="space-y-2">
            {lista.map((s) => {
              const clase = claseEstado(s.estado);
              const Icono = ICONO[clase];
              return (
                <li key={s.id} className="flex items-start gap-3 rounded-md border bg-card px-3 py-2.5" data-testid="subida">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{s.nombre_original}</p>
                    <p className="text-xs text-muted-foreground">
                      {cuando(s.created_at)}
                      {s.num_paginas && s.num_paginas > 1 ? ` · ${s.num_paginas} páginas` : ""}
                    </p>
                    {clase !== "leyendo" && clase !== "recibido" && (
                      <p className="mt-1 text-xs text-muted-foreground">{TEXTO_ESTADO[clase].detalle}</p>
                    )}
                  </div>
                  <span
                    className={cn("inline-flex shrink-0 items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium", COLOR[clase])}
                    title={TEXTO_ESTADO[clase].detalle}
                  >
                    <Icono className={cn("h-3 w-3", clase === "leyendo" && "animate-spin")} aria-hidden="true" />
                    {TEXTO_ESTADO[clase].etiqueta}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
