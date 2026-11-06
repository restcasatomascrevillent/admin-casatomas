/**
 * Miniatura de una foto de la biblioteca a partir de su id de pieza
 * («carta:<plato>» o «drive:<id>») o del plato: la usan Campañas (piezas
 * propuestas por la IA) y el Estudio. La de la carta sale de la URL pública
 * del plato (misma consulta y caché que el selector de fotos); la de Drive se
 * pide con la sesión (instagram-drive, acción «miniatura»; misma clave de
 * caché que el selector). Sin foto: un hueco con borde discontinuo.
 */
import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ImageOff, Loader2 } from "lucide-react";
import { driveIdDeFoto, platoIdDeFoto, type MarcaId } from "@/lib/instagram";
import { cn } from "@/lib/utils";
import { miniaturaDrive } from "@/components/marketing/instagram/api";
import { usePlatosConFoto } from "@/components/marketing/instagram/useFotosInstagram";

export interface MiniaturaFotoProps {
  marca: MarcaId;
  /** Id de la foto en la pieza («carta:…», «drive:…»). */
  foto?: string | null;
  /** Plato de la carta (si no hay `foto`, se usa su foto). */
  platoId?: string | null;
  /** Falta la foto: se pinta el hueco discontinuo. */
  falta?: boolean;
  className?: string;
  /** Texto para lectores de pantalla (por defecto, decorativa). */
  alt?: string;
}

function Hueco({ falta, className, cargando }: { falta?: boolean; className?: string; cargando?: boolean }) {
  return (
    <span
      className={cn(
        "flex items-center justify-center overflow-hidden rounded-md bg-muted text-muted-foreground",
        falta && "border border-dashed border-[#9b8a7d] bg-[#f6f3f1]",
        className,
      )}
      aria-hidden="true"
    >
      {cargando ? <Loader2 className="h-4 w-4 animate-spin" /> : <ImageOff className="h-4 w-4" />}
    </span>
  );
}

/** Foto de Drive: se pide con la sesión y se enseña como blob URL. */
function ImagenDrive({ marca, driveId, className }: { marca: MarcaId; driveId: string; className?: string }) {
  const { data, isLoading } = useQuery({
    queryKey: ["instagram_drive_miniatura", driveId],
    queryFn: () => miniaturaDrive(marca, driveId),
    staleTime: Infinity,
    gcTime: 30 * 60 * 1000,
    retry: 1,
  });
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!data) return setUrl(null);
    const u = URL.createObjectURL(data);
    setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [data]);
  if (!url) return <Hueco className={className} cargando={isLoading} />;
  return (
    <span className={cn("block overflow-hidden rounded-md bg-muted", className)}>
      <img src={url} alt="" decoding="async" className="h-full w-full object-cover" />
    </span>
  );
}

/** Foto de la carta: URL pública del bucket «platos». */
function ImagenCarta({ url, className }: { url: string; className?: string }) {
  const [rota, setRota] = useState(false);
  if (rota) return <Hueco className={className} />;
  return (
    <span className={cn("block overflow-hidden rounded-md bg-muted", className)}>
      <img src={url} alt="" loading="lazy" decoding="async" className="h-full w-full object-cover" onError={() => setRota(true)} />
    </span>
  );
}

export function MiniaturaFoto({ marca, foto, platoId, falta, className, alt }: MiniaturaFotoProps) {
  const plato = platoIdDeFoto(foto) ?? (foto ? null : platoId ?? null);
  const driveId = driveIdDeFoto(foto);
  const platos = usePlatosConFoto(marca);
  const urlPlato = plato ? (platos.data ?? []).find((p) => p.id === plato)?.imagen_url ?? null : null;

  if (falta || (!plato && !driveId) || (plato && !urlPlato)) return <Hueco falta={falta || (!plato && !driveId)} className={className} />;
  return (
    <span role={alt ? "img" : undefined} aria-label={alt} className="contents" data-testid="miniatura-foto">
      {plato && urlPlato ? <ImagenCarta url={urlPlato} className={className} /> : <ImagenDrive marca={marca} driveId={driveId as string} className={className} />}
    </span>
  );
}
