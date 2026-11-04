import { useEffect, useId, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Check, ImagePlus, Loader2, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { MARCAS_IDS, MAX_DESCRIPCION_FOTO, NOMBRE_TIPO_FOTO, TIPOS_FOTO, type Foto, type MarcaId, type TipoFoto } from "@/lib/instagram";
import { ACEPTA_FOTO, ErrorFoto, aptitudFoto, convertirFoto, type FotoConvertida } from "./convertirFoto";
import { subirFotoBiblioteca } from "./fotosSubidas";
import { CLAVE_FOTOS } from "./useFotosInstagram";
import { NOMBRE_MARCA_CORTO } from "./HistorialPiezas";

interface Props {
  abierto: boolean;
  onAbierto: (v: boolean) => void;
  /** Marca de la pieza: la que sale por defecto. */
  marca: MarcaId;
  /** Tipo por defecto (p. ej., el primero que admite la plantilla). */
  tipoInicial?: TipoFoto;
  /** Se llama con la foto ya subida y guardada. */
  onSubida: (foto: Foto) => void;
}

function Apto({ si, texto }: { si: boolean; texto: string }) {
  return (
    <span className={cn("inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs", si ? "border-emerald-600/40 text-emerald-700" : "border-muted-foreground/30 text-muted-foreground")}>
      {si ? <Check className="h-3 w-3" aria-hidden="true" /> : <X className="h-3 w-3" aria-hidden="true" />}
      {texto}: {si ? "sirve" : "no sirve"}
    </span>
  );
}

/**
 * «Subir foto» a la biblioteca: el navegador la prepara (orientación, ≤ 2560 px,
 * JPEG sRGB, ≤ 8 MB), enseña la vista previa con sus medidas y para qué
 * formatos sirve, y la sube con la sesión del usuario.
 */
export function SubirFotoDialog({ abierto, onAbierto, marca: marcaInicial, tipoInicial = "plato", onSubida }: Props) {
  const qc = useQueryClient();
  const idBase = useId();
  const entrada = useRef<HTMLInputElement>(null);
  const [foto, setFoto] = useState<FotoConvertida | null>(null);
  const [vista, setVista] = useState<string | null>(null);
  const [preparando, setPreparando] = useState(false);
  const [subiendo, setSubiendo] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [marca, setMarca] = useState<MarcaId>(marcaInicial);
  const [tipo, setTipo] = useState<TipoFoto>(tipoInicial);
  const [descripcion, setDescripcion] = useState("");

  // Al abrir: la marca y el tipo de la pieza; al cerrar: se limpia todo.
  useEffect(() => {
    if (abierto) {
      setMarca(marcaInicial);
      setTipo(tipoInicial);
    } else {
      setFoto(null);
      setError(null);
      setDescripcion("");
    }
  }, [abierto, marcaInicial, tipoInicial]);

  // URL de la vista previa (se libera al cambiar de foto o cerrar).
  useEffect(() => {
    if (!foto) return setVista(null);
    const url = URL.createObjectURL(foto.blob);
    setVista(url);
    return () => URL.revokeObjectURL(url);
  }, [foto]);

  const elegir = async (fichero: File | undefined) => {
    if (!fichero) return;
    setError(null);
    setFoto(null);
    setPreparando(true);
    try {
      setFoto(await convertirFoto(fichero));
    } catch (e) {
      setError(e instanceof ErrorFoto ? e.message : "No se ha podido preparar la foto.");
    } finally {
      setPreparando(false);
      if (entrada.current) entrada.current.value = "";
    }
  };

  const subir = async () => {
    if (!foto) return;
    setSubiendo(true);
    const aviso = toast.loading("Subiendo la foto…");
    try {
      const nueva = await subirFotoBiblioteca({ blob: foto.blob, marca, tipo, descripcion, ancho: foto.ancho, alto: foto.alto });
      // Aparece ya en el selector (antes de volver a leer la tabla) y queda elegida.
      qc.setQueryData<Foto[]>(CLAVE_FOTOS, (antes) => [nueva, ...(antes ?? []).filter((f) => f.id !== nueva.id)]);
      void qc.invalidateQueries({ queryKey: CLAVE_FOTOS });
      toast.success(marca === marcaInicial ? "Foto subida y elegida" : `Foto subida a la biblioteca de ${NOMBRE_MARCA_CORTO[marca]}`, { id: aviso });
      onSubida(nueva);
      onAbierto(false);
    } catch (e) {
      toast.error("No se ha podido subir la foto", { id: aviso, description: (e as Error).message });
    } finally {
      setSubiendo(false);
    }
  };

  const aptitud = foto ? aptitudFoto(foto.ancho, foto.alto) : null;
  const ocupado = preparando || subiendo;

  return (
    <Dialog open={abierto} onOpenChange={(v) => !subiendo && onAbierto(v)}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Subir foto a la biblioteca</DialogTitle>
          <DialogDescription>JPEG, PNG o WebP (HEIC si tu navegador lo abre). Se prepara aquí: se endereza, se deja en 2560 px como mucho y se guarda en JPEG.</DialogDescription>
        </DialogHeader>

        <input
          ref={entrada}
          type="file"
          accept={ACEPTA_FOTO}
          className="sr-only"
          aria-label="Archivo de la foto"
          data-testid="entrada-foto"
          onChange={(e) => void elegir(e.target.files?.[0])}
        />

        <div className="space-y-3">
          <div className="flex items-center gap-3">
            <Button type="button" variant="outline" onClick={() => entrada.current?.click()} disabled={ocupado}>
              {preparando ? <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" /> : <ImagePlus className="mr-2 h-4 w-4" aria-hidden="true" />}
              {foto ? "Elegir otra" : "Elegir foto"}
            </Button>
            {preparando && <span className="text-sm text-muted-foreground">Preparando la foto…</span>}
          </div>

          {error && (
            <p role="alert" className="rounded-md border border-destructive/40 bg-destructive/5 p-2 text-sm text-destructive">
              {error}
            </p>
          )}

          {foto && vista && aptitud && (
            <div className="flex gap-3">
              <img src={vista} alt="Vista previa de la foto" className="h-36 w-28 shrink-0 rounded-md border object-cover" />
              <div className="min-w-0 space-y-2 text-sm">
                <p data-testid="medidas-foto">
                  <span className="font-medium tabular-nums">
                    {foto.ancho}×{foto.alto} px
                  </span>
                  {(foto.ancho !== foto.anchoOriginal || foto.alto !== foto.altoOriginal) && (
                    <span className="text-muted-foreground">
                      {" "}
                      (era {foto.anchoOriginal}×{foto.altoOriginal})
                    </span>
                  )}
                  <span className="text-muted-foreground"> · {(foto.blob.size / 1048576).toFixed(1)} MB</span>
                </p>
                <div className="flex flex-wrap gap-1.5">
                  <Apto si={aptitud.post} texto="Post 1080×1350" />
                  <Apto si={aptitud.story} texto="Story 1080×1920" />
                </div>
                {aptitud.mensaje && (
                  <p className={cn("flex items-start gap-1.5 text-xs", aptitud.post || aptitud.story ? "text-muted-foreground" : "text-amber-700")} data-testid="aviso-aptitud">
                    <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                    <span>{aptitud.mensaje}</span>
                  </p>
                )}
              </div>
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label htmlFor={`${idBase}-marca`}>Marca</Label>
              <Select value={marca} onValueChange={(v) => setMarca(v as MarcaId)} disabled={subiendo}>
                <SelectTrigger id={`${idBase}-marca`}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {MARCAS_IDS.map((m) => (
                    <SelectItem key={m} value={m}>
                      {NOMBRE_MARCA_CORTO[m]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label htmlFor={`${idBase}-tipo`}>Tipo</Label>
              <Select value={tipo} onValueChange={(v) => setTipo(v as TipoFoto)} disabled={subiendo}>
                <SelectTrigger id={`${idBase}-tipo`}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {TIPOS_FOTO.map((t) => (
                    <SelectItem key={t} value={t}>
                      {NOMBRE_TIPO_FOTO[t]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="space-y-1">
            <div className="flex items-baseline justify-between">
              <Label htmlFor={`${idBase}-descripcion`}>Descripción corta</Label>
              <span className="text-xs tabular-nums text-muted-foreground">
                {descripcion.length}/{MAX_DESCRIPCION_FOTO}
              </span>
            </div>
            <Input
              id={`${idBase}-descripcion`}
              value={descripcion}
              maxLength={MAX_DESCRIPCION_FOTO}
              placeholder="Ej.: Chuleta trinchada sobre plato oscuro"
              onChange={(e) => setDescripcion(e.target.value)}
              disabled={subiendo}
            />
          </div>
        </div>

        <DialogFooter>
          <Button type="button" variant="ghost" onClick={() => onAbierto(false)} disabled={subiendo}>
            Cancelar
          </Button>
          <Button type="button" onClick={() => void subir()} disabled={!foto || ocupado}>
            {subiendo && <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />}
            Subir
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
