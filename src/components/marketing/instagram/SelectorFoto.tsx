import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Check, ImagePlus, Loader2, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { cn } from "@/lib/utils";
import {
  FORMATOS,
  TIPOS_FOTO,
  escalaParaCubrir,
  esAptaPara,
  urlRecurso,
  type Foto,
  type FormatoId,
  type MarcaId,
  type Plantilla,
  type TipoFoto,
} from "@/lib/instagram";
import { borrarFotoBiblioteca, piezasQueUsanFoto } from "./fotosSubidas";
import { SubirFotoDialog } from "./SubirFotoDialog";
import { CLAVE_FOTOS, useFotosInstagram } from "./useFotosInstagram";

const NOMBRE_FORMATO: Record<FormatoId, string> = { post: "un post", story: "una story" };

/** Por qué una foto no se puede usar (o null si se puede). Misma regla que validarPieza. */
export function motivoNoApta(foto: Foto, formato: FormatoId, plantilla?: Pick<Plantilla, "tiposFoto">): string | null {
  if (plantilla?.tiposFoto?.length && !plantilla.tiposFoto.includes(foto.tipo)) {
    return `Esta plantilla no usa fotos de tipo «${foto.tipo}».`;
  }
  if (!esAptaPara(foto, formato)) {
    const f = FORMATOS[formato];
    const ampliar = Math.round((escalaParaCubrir(foto.ancho, foto.alto, f.ancho, f.alto) - 1) * 100);
    const forma = foto.ancho > foto.alto ? "Es apaisada" : "Es pequeña";
    return `${forma} (${foto.ancho}×${foto.alto}): para ${NOMBRE_FORMATO[formato]} habría que ampliarla un ${ampliar} % y se vería borrosa.`;
  }
  return null;
}

/** Tipo con el que se abre «Subir foto»: el primero que admite la plantilla (o «plato»). */
function tipoPorDefecto(plantilla?: Pick<Plantilla, "tiposFoto">): TipoFoto {
  const t = plantilla?.tiposFoto?.[0];
  return (TIPOS_FOTO as readonly string[]).includes(t ?? "") ? (t as TipoFoto) : "plato";
}

interface Props {
  marca: MarcaId;
  formato: FormatoId;
  plantilla?: Plantilla;
  valor: string;
  onCambio: (id: string) => void;
  baseFotos: string;
  conProblema?: boolean;
}

/** Borrado pendiente de confirmar: la foto y cuántas piezas la usan (null = no se sabe aún). */
interface Borrado {
  foto: Foto;
  usos: number | null;
}

export function SelectorFoto({ marca, formato, plantilla, valor, onCambio, baseFotos, conProblema }: Props) {
  const qc = useQueryClient();
  // Catálogo estático + fotos subidas desde el panel (tabla instagram_fotos).
  const { fotos } = useFotosInstagram(marca);
  // En el móvil no hay «title» al pasar el ratón: al tocar una foto que no vale se explica debajo.
  const [aviso, setAviso] = useState<string | null>(null);
  const [subir, setSubir] = useState(false);
  const [borrado, setBorrado] = useState<Borrado | null>(null);
  const [borrando, setBorrando] = useState(false);

  const pedirBorrar = (foto: Foto) => {
    setBorrado({ foto, usos: null });
    void piezasQueUsanFoto(foto.id).then((usos) => setBorrado((b) => (b && b.foto.id === foto.id ? { ...b, usos: usos ?? 0 } : b)));
  };

  const borrar = async () => {
    if (!borrado) return;
    const { foto } = borrado;
    setBorrando(true);
    try {
      const { aviso: avisoBorrado } = await borrarFotoBiblioteca(foto);
      qc.setQueryData<Foto[]>(CLAVE_FOTOS, (antes) => (antes ?? []).filter((f) => f.id !== foto.id));
      void qc.invalidateQueries({ queryKey: CLAVE_FOTOS });
      if (valor === foto.id) onCambio("");
      if (avisoBorrado) toast.warning("Foto borrada de la biblioteca", { description: avisoBorrado });
      else toast.success("Foto borrada");
      setBorrado(null);
    } catch (e) {
      toast.error("No se ha podido borrar la foto", { description: (e as Error).message });
    } finally {
      setBorrando(false);
    }
  };

  return (
    <fieldset className={cn("rounded-md", conProblema && "ring-2 ring-destructive ring-offset-2")} aria-describedby="ayuda-foto">
      <legend className="text-sm font-medium">Foto</legend>
      <div className="mb-2 flex items-start justify-between gap-2">
        <p id="ayuda-foto" className="text-xs text-muted-foreground">
          Las fotos en gris no sirven para este formato o plantilla: tócalas para ver por qué.
        </p>
        <Button type="button" variant="outline" size="sm" onClick={() => setSubir(true)} className="h-7 shrink-0 px-2 pointer-coarse:min-h-11">
          <ImagePlus className="mr-1 h-4 w-4" aria-hidden="true" />
          Subir foto
        </Button>
      </div>
      <div role="radiogroup" aria-label="Foto" className="grid grid-cols-4 gap-1.5 sm:grid-cols-5 lg:grid-cols-3 xl:grid-cols-4">
        {fotos.map((foto) => {
          const motivo = motivoNoApta(foto, formato, plantilla);
          const elegida = valor === foto.id;
          const descripcion = foto.descripcion || "Foto subida";
          return (
            <div key={foto.id} className="relative">
              <button
                type="button"
                role="radio"
                aria-checked={elegida}
                aria-disabled={motivo ? true : undefined}
                title={motivo ?? descripcion}
                aria-label={`${foto.subida ? "Subida. " : ""}${descripcion}${motivo ? ` No disponible: ${motivo}` : ""}`}
                data-testid={`foto-${foto.id}`}
                // aria-disabled (no `disabled`): sigue siendo enfocable y el lector de pantalla lee el motivo.
                onClick={() => {
                  if (motivo) return setAviso(motivo);
                  setAviso(null);
                  onCambio(foto.id);
                }}
                className={cn(
                  "relative block aspect-[4/5] w-full overflow-hidden rounded-md border bg-muted transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1",
                  elegida ? "border-primary ring-2 ring-primary" : "border-border hover:border-primary/60",
                  motivo && "cursor-not-allowed opacity-40 grayscale",
                )}
              >
                <img
                  src={urlRecurso(baseFotos, foto.ruta)}
                  alt=""
                  loading="lazy"
                  decoding="async"
                  className="h-full w-full object-cover"
                />
                {foto.subida && (
                  <span className="absolute bottom-1 left-1 rounded bg-background/90 px-1 text-[10px] font-medium leading-4 text-foreground" aria-hidden="true">
                    Subida
                  </span>
                )}
                {elegida && (
                  <span className="absolute right-1 top-1 rounded-full bg-primary p-0.5 text-primary-foreground" aria-hidden="true">
                    <Check className="h-3 w-3" />
                  </span>
                )}
              </button>
              {foto.subida && (
                <button
                  type="button"
                  onClick={() => pedirBorrar(foto)}
                  aria-label={`Borrar la foto subida «${descripcion}»`}
                  title="Borrar esta foto"
                  className="absolute left-1 top-1 rounded-full bg-background/90 p-1 text-destructive shadow-sm hover:bg-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <Trash2 className="h-3 w-3" aria-hidden="true" />
                </button>
              )}
            </div>
          );
        })}
      </div>
      {aviso && (
        <p role="status" className="mt-1 text-xs text-muted-foreground">
          {aviso}
        </p>
      )}
      {valor && (() => {
        const elegida = fotos.find((f) => f.id === valor);
        const motivo = elegida ? motivoNoApta(elegida, formato, plantilla) : null;
        return motivo ? <p className="mt-1 text-xs text-destructive">La foto elegida no vale: {motivo}</p> : null;
      })()}

      <SubirFotoDialog
        abierto={subir}
        onAbierto={setSubir}
        marca={marca}
        tipoInicial={tipoPorDefecto(plantilla)}
        onSubida={(foto) => {
          if (foto.marca !== marca) return;
          setAviso(null);
          onCambio(foto.id);
        }}
      />

      <AlertDialog open={!!borrado} onOpenChange={(v) => !v && !borrando && setBorrado(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Borrar esta foto?</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2">
                <p>Se quita de la biblioteca y se borra el archivo. No se puede deshacer.</p>
                {borrado?.usos === null && <p className="text-muted-foreground">Comprobando si alguna pieza la usa…</p>}
                {!!borrado?.usos && (
                  <p className="font-medium text-amber-700" data-testid="aviso-foto-en-uso">
                    {borrado.usos === 1 ? "La usa 1 pieza guardada" : `La usan ${borrado.usos} piezas guardadas`}: no podrás volver a generarla sin
                    elegir otra foto. Las ya publicadas en Instagram no cambian.
                  </p>
                )}
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={borrando}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={borrando}
              onClick={(e) => {
                e.preventDefault();
                void borrar();
              }}
            >
              {borrando && <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />}
              Borrar foto
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </fieldset>
  );
}
