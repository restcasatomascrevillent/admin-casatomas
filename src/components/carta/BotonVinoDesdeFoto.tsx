import { useEffect, useRef, useState } from "react";
import { Camera, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { redimensionarFoto } from "./redimensionarFoto";

/** Datos que devuelve la Edge Function `extraer-vino-foto` (campos de `Vinos`). */
export interface DatosVinoFoto {
  nombre: string | null;
  categoria: string | null;
  descripcion: string | null;
  ingredientes: string | null;
  denominacion_origen: string | null;
  ubicacion_region: string | null;
  ubicacion_pais: string | null;
  contiene_sulfitos: boolean;
}

export interface VinoDesdeFoto {
  datos: DatosVinoFoto;
  /** La foto ya redimensionada, para usarla como imagen del vino si se quiere. */
  foto: File;
}

function aDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

interface Props {
  categorias: string[];
  onLeido: (resultado: VinoDesdeFoto) => void;
}

/**
 * Botón «Añadir botella con foto»: abre la cámara (tablet/móvil), manda la
 * foto a `extraer-vino-foto` y devuelve los datos leídos para precargar
 * VinoForm. No guarda nada: el usuario revisa y guarda en el formulario.
 */
export function BotonVinoDesdeFoto({ categorias, onLeido }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [leyendo, setLeyendo] = useState(false);
  // Miniatura de la foto recién hecha mientras se lee la etiqueta.
  const [miniatura, setMiniatura] = useState<string | null>(null);

  // Liberar el object URL al cambiar de miniatura o al desmontar.
  useEffect(() => {
    if (!miniatura) return;
    return () => URL.revokeObjectURL(miniatura);
  }, [miniatura]);

  const procesar = async (file: File) => {
    setLeyendo(true);
    setMiniatura(URL.createObjectURL(file));
    try {
      const r = await redimensionarFoto(file);
      const imagen = await aDataUrl(r.blob);
      // Diagnóstico desde el móvil (chrome://inspect): qué se manda realmente a la IA.
      console.info("[extraer-vino-foto] foto", {
        tipo: file.type || "(vacío)",
        bytesOriginal: file.size,
        original: `${r.original.ancho}x${r.original.alto}`,
        final: `${r.final.ancho}x${r.final.alto}`,
        metodo: r.metodo,
        bytesBase64: imagen.length,
      });
      const { data, error } = await supabase.functions.invoke("extraer-vino-foto", {
        body: { imagen, categorias: categorias.filter(Boolean) },
      });
      if (error || !data?.ok || !data?.vino) {
        throw new Error(data?.error || error?.message || "Respuesta vacía");
      }
      const datos = data.vino as DatosVinoFoto;
      const recibidos = Object.entries(datos)
        .filter(([, v]) => v !== null && v !== "" && v !== false)
        .map(([k]) => k);
      console.info("[extraer-vino-foto] campos recibidos", recibidos);
      if (!datos.nombre) {
        toast.warning("No se ha podido leer el nombre en la etiqueta. Revisa los datos o prueba con una foto más cerca y con luz.");
      }
      const foto = new File([r.blob], "botella.jpg", { type: "image/jpeg" });
      onLeido({ datos, foto });
    } catch (e) {
      console.error("[extraer-vino-foto]", e);
      toast.error("No se pudo leer la etiqueta. Prueba con otra foto o añádelo a mano.");
    } finally {
      setLeyendo(false);
      setMiniatura(null);
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  return (
    <>
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void procesar(file);
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
    </>
  );
}
