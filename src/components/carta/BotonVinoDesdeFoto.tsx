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
      <Button variant="outline" disabled={leyendo} onClick={() => inputRef.current?.click()}>
        {leyendo ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Camera className="mr-2 h-4 w-4" />}
        {leyendo ? "Leyendo etiqueta…" : "Añadir botella con foto"}
      </Button>
      <Button variant="outline" disabled={leyendo} onClick={() => setLoteAbierto(true)}>
        <Images className="mr-2 h-4 w-4" />
        {enLote ? `Varias botellas (${enLote})` : "Varias botellas"}
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
