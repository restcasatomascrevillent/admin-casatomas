import { useEffect, useRef, useState } from "react";
import { Camera, Images, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { leerVinoDeFoto, type VinoDesdeFoto } from "./leerVinoFoto";
import { LoteVinosDialog } from "./LoteVinosFoto";
import { useLoteVinos, type FilaLote } from "./useLoteVinos";

export type { DatosVinoFoto, VinoDesdeFoto } from "./leerVinoFoto";

interface Props {
  categorias: string[];
  onLeido: (resultado: VinoDesdeFoto) => void;
}

/**
 * «Añadir botella con foto»: abre la cámara, manda la foto a `extraer-vino-foto`
 * y abre VinoForm precargado (una sola foto, como siempre).
 * «Varias»: cola de fotos que se leen de 2 en 2; cada una se revisa y guarda
 * en VinoForm. Nada se guarda sin pasar por el formulario.
 */
export function BotonVinoDesdeFoto({ categorias, onLeido }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [leyendo, setLeyendo] = useState(false);
  // Miniatura de la foto recién hecha mientras se lee la etiqueta.
  const [miniatura, setMiniatura] = useState<string | null>(null);

  const lote = useLoteVinos(categorias);
  const [loteAbierto, setLoteAbierto] = useState(false);
  // Fila cuyo formulario está abierto: el diálogo del lote se oculta mientras.
  const [filaEnForm, setFilaEnForm] = useState<string | null>(null);

  // Liberar el object URL al cambiar de miniatura o al desmontar.
  useEffect(() => {
    if (!miniatura) return;
    return () => URL.revokeObjectURL(miniatura);
  }, [miniatura]);

  const procesar = async (file: File) => {
    setLeyendo(true);
    setMiniatura(URL.createObjectURL(file));
    try {
      const resultado = await leerVinoDeFoto(file, categorias);
      if (!resultado.datos.nombre) {
        toast.warning("No se ha podido leer el nombre en la etiqueta. Revisa los datos o prueba con una foto más cerca y con luz.");
      }
      if (resultado.avisoFoto) toast.message(resultado.avisoFoto);
      onLeido(resultado);
    } catch (e) {
      console.error("[extraer-vino-foto]", e);
      toast.error("No se pudo leer la etiqueta. Prueba con otra foto o añádelo a mano.");
    } finally {
      setLeyendo(false);
      setMiniatura(null);
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  const abrirFila = (fila: FilaLote) => {
    if (!fila.resultado) return;
    setFilaEnForm(fila.id);
    onLeido({
      ...fila.resultado,
      alGuardar: () => lote.marcarGuardado(fila.id),
      alCerrar: () => setFilaEnForm(null),
    });
  };

  const enLote = lote.filas.length;

  return (
    <>
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={(e) => {
          const archivos = Array.from(e.target.files ?? []);
          if (archivos.length > 1) {
            // Algunos móviles dejan elegir varias aunque se pida cámara: van al lote.
            lote.añadir(archivos);
            setLoteAbierto(true);
            e.target.value = "";
          } else if (archivos[0]) {
            void procesar(archivos[0]);
          }
        }}
      />
      {leyendo && miniatura && (
        <img
          src={miniatura}
          alt="Foto de la botella"
          className="h-10 w-10 shrink-0 rounded-md border object-cover"
        />
      )}
      {/* Con su texto también en el móvil (02/11/2026: solo iconos «no eran nada intuitivos»): la
          barra de Vinos es una rejilla de 2 columnas (TabCarta), así que ya no ensancha la página a
          390 px (QA F-05). En el móvil el texto corto; desde `sm`, el largo. */}
      <Button
        variant="outline"
        className="min-w-0 flex-1 px-3 sm:flex-none sm:px-4"
        disabled={leyendo}
        onClick={() => inputRef.current?.click()}
        title={leyendo ? "Leyendo etiqueta…" : "Añadir botella con foto"}
        aria-label={leyendo ? "Leyendo etiqueta…" : "Añadir botella con foto"}
      >
        {leyendo ? <Loader2 className="mr-2 h-4 w-4 shrink-0 animate-spin" /> : <Camera className="mr-2 h-4 w-4 shrink-0" />}
        <span className="truncate sm:hidden">{leyendo ? "Leyendo…" : "Desde foto"}</span>
        <span className="hidden truncate sm:inline">{leyendo ? "Leyendo etiqueta…" : "Añadir botella con foto"}</span>
      </Button>
      <Button
        variant="outline"
        className="min-w-0 flex-1 px-3 sm:flex-none sm:px-4"
        disabled={leyendo}
        onClick={() => setLoteAbierto(true)}
        title={enLote ? `Varias botellas (${enLote})` : "Varias botellas"}
      >
        <Images className="mr-2 h-4 w-4 shrink-0" />
        <span className="truncate">Varias botellas</span>
        {enLote > 0 && <span className="ml-1 shrink-0 tabular-nums">{`(${enLote})`}</span>}
      </Button>
      <LoteVinosDialog
        open={loteAbierto && filaEnForm === null}
        onOpenChange={setLoteAbierto}
        lote={lote}
        onAbrirFila={abrirFila}
      />
    </>
  );
}
