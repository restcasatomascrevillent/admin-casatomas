import { useEffect, useRef, useState } from "react";
import { Camera, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";

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

const LADO_MAX = 1024;

/** Redimensiona a ~1024px de lado mayor y la pasa a JPEG 0.8 (ahorra tokens y subida). */
async function redimensionar(file: File): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  const escala = Math.min(1, LADO_MAX / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * escala);
  canvas.height = Math.round(bitmap.height * escala);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas no disponible");
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  return await new Promise<Blob>((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("No se pudo comprimir la foto"))), "image/jpeg", 0.8),
  );
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
      const blob = await redimensionar(file);
      const imagen = await aDataUrl(blob);
      const { data, error } = await supabase.functions.invoke("extraer-vino-foto", {
        body: { imagen, categorias: categorias.filter(Boolean) },
      });
      if (error || !data?.ok || !data?.vino) {
        throw new Error(data?.error || error?.message || "Respuesta vacía");
      }
      const foto = new File([blob], "botella.jpg", { type: "image/jpeg" });
      onLeido({ datos: data.vino as DatosVinoFoto, foto });
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
