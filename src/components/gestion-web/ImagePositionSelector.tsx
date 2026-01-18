import { useState, useRef, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Check, Move } from "lucide-react";
import { MOBILE_PREVIEW_IMAGE_ASPECT_RATIO } from "./previewConstants";

interface ImagePositionSelectorProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  imageUrl: string;
  currentPosition: number; // 0-100 (porcentaje Y)
  onPositionChange: (position: number) => void;
}

export function ImagePositionSelector({
  open,
  onOpenChange,
  imageUrl,
  currentPosition,
  onPositionChange,
}: ImagePositionSelectorProps) {
  const [position, setPosition] = useState(currentPosition);
  const [isDragging, setIsDragging] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const imageRef = useRef<HTMLImageElement>(null);
  const [imageBounds, setImageBounds] = useState({ top: 0, left: 0, width: 0, height: 0 });

  // El marco visible debe representar lo que se verá en el preview móvil (object-cover)
  const CARD_ASPECT_RATIO = MOBILE_PREVIEW_IMAGE_ASPECT_RATIO;

  // Altura (en % de la imagen) que realmente se verá en la tarjeta (depende del aspect ratio)
  const [frameHeightPercent, setFrameHeightPercent] = useState(25);

  useEffect(() => {
    // currentPosition está en el formato que usa CSS object-position (0-100)
    // Convertimos a la posición del centro del frame (en % de la imagen) para dibujar el marco correctamente.
    const center = frameHeightPercent >= 99.999
      ? 50
      : (currentPosition / 100) * (100 - frameHeightPercent) + frameHeightPercent / 2;

    setPosition(center);
  }, [currentPosition, open, frameHeightPercent]);

  // Calcular los bounds de la imagen dentro del contenedor
  const updateImageBounds = useCallback(() => {
    if (imageRef.current && containerRef.current) {
      const containerRect = containerRef.current.getBoundingClientRect();
      const imageRect = imageRef.current.getBoundingClientRect();

      setImageBounds({
        top: imageRect.top - containerRect.top,
        left: imageRect.left - containerRect.left,
        width: imageRect.width,
        height: imageRect.height,
      });

      // Calcular qué % de alto de la imagen se ve en la tarjeta con object-cover
      // Si la imagen es más "estrecha" que el contenedor (ratio menor), se recorta en vertical.
      const naturalW = imageRef.current.naturalWidth || imageRect.width;
      const naturalH = imageRef.current.naturalHeight || imageRect.height;
      const imageAspect = naturalH ? naturalW / naturalH : CARD_ASPECT_RATIO;

      const visibleFraction = imageAspect < CARD_ASPECT_RATIO ? imageAspect / CARD_ASPECT_RATIO : 1;
      setFrameHeightPercent(Math.max(1, Math.min(100, visibleFraction * 100)));
    }
  }, [CARD_ASPECT_RATIO]);

  useEffect(() => {
    if (open) {
      // Pequeño delay para que la imagen se cargue
      const timer = setTimeout(updateImageBounds, 100);
      return () => clearTimeout(timer);
    }
  }, [open, updateImageBounds]);

  const calculatePosition = useCallback((clientY: number) => {
    if (!containerRef.current || imageBounds.height === 0) return;

    const containerRect = containerRef.current.getBoundingClientRect();

    // Calcular posición relativa a la imagen, no al contenedor
    const relativeToImage = clientY - containerRect.top - imageBounds.top;
    const imageHeight = imageBounds.height;

    // Limitar para que el frame no se salga de la imagen
    const minY = frameHeightPercent / 2;
    const maxY = 100 - frameHeightPercent / 2;

    const rawPercent = (relativeToImage / imageHeight) * 100;
    const clampedPercent = Math.max(minY, Math.min(maxY, rawPercent));

    setPosition(clampedPercent);
  }, [imageBounds, frameHeightPercent]);

  const handleMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    setIsDragging(true);
    calculatePosition(e.clientY);
  };

  const handleMouseMove = useCallback((e: MouseEvent) => {
    if (isDragging) {
      calculatePosition(e.clientY);
    }
  }, [isDragging, calculatePosition]);

  const handleMouseUp = useCallback(() => {
    setIsDragging(false);
  }, []);

  useEffect(() => {
    if (isDragging) {
      window.addEventListener('mousemove', handleMouseMove);
      window.addEventListener('mouseup', handleMouseUp);
      return () => {
        window.removeEventListener('mousemove', handleMouseMove);
        window.removeEventListener('mouseup', handleMouseUp);
      };
    }
  }, [isDragging, handleMouseMove, handleMouseUp]);

  // Touch events
  const handleTouchStart = (e: React.TouchEvent) => {
    setIsDragging(true);
    calculatePosition(e.touches[0].clientY);
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    if (isDragging) {
      e.preventDefault();
      calculatePosition(e.touches[0].clientY);
    }
  };

  const handleTouchEnd = () => {
    setIsDragging(false);
  };

  const handleConfirm = () => {
    // position = centro del frame (en % de la imagen)
    // objectPosition necesita un valor 0-100 que representa el alineado de la imagen dentro del contenedor.
    if (frameHeightPercent >= 99.999) {
      onPositionChange(50);
      onOpenChange(false);
      return;
    }

    const frameTop = position - frameHeightPercent / 2;
    const normalizedPosition = (frameTop / (100 - frameHeightPercent)) * 100;

    onPositionChange(Math.round(Math.max(0, Math.min(100, normalizedPosition))));
    onOpenChange(false);
  };

  // Calcular posición del frame relativa a la imagen
  const frameTopPercent = position - frameHeightPercent / 2;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl p-0 overflow-hidden">
        <DialogHeader className="p-4 pb-2">
          <DialogTitle className="flex items-center gap-2">
            <Move className="w-5 h-5" />
            Posicionar imagen
          </DialogTitle>
          <p className="text-sm text-muted-foreground">
            Arrastra el recuadro para elegir qué parte de la imagen se verá en la tarjeta
          </p>
        </DialogHeader>

        <div 
          ref={containerRef}
          className="relative w-full h-[70vh] overflow-hidden cursor-ns-resize select-none bg-zinc-900 flex items-center justify-center"
          onMouseDown={handleMouseDown}
          onTouchStart={handleTouchStart}
          onTouchMove={handleTouchMove}
          onTouchEnd={handleTouchEnd}
        >
          {/* Imagen de fondo fija - 100% visible */}
          <img
            ref={imageRef}
            src={imageUrl}
            alt="Imagen completa"
            className="max-w-full max-h-full object-contain"
            draggable={false}
            onLoad={updateImageBounds}
          />

          {/* Overlays y frame solo si tenemos los bounds de la imagen */}
          {imageBounds.width > 0 && (
            <>
              {/* Overlay oscuro superior - ajustado a la imagen */}
              <div 
                className="absolute bg-black/60 transition-all duration-75 pointer-events-none"
                style={{ 
                  top: imageBounds.top,
                  left: imageBounds.left,
                  width: imageBounds.width,
                  height: `${Math.max(0, frameTopPercent) * imageBounds.height / 100}px`,
                }}
              />

              {/* Overlay oscuro inferior - ajustado a la imagen */}
              <div 
                className="absolute bg-black/60 transition-all duration-75 pointer-events-none"
                style={{ 
                  bottom: containerRef.current ? containerRef.current.clientHeight - imageBounds.top - imageBounds.height : 0,
                  left: imageBounds.left,
                  width: imageBounds.width,
                  height: `${Math.max(0, 100 - frameTopPercent - frameHeightPercent) * imageBounds.height / 100}px`,
                }}
              />

              {/* Marco visible (transparente con borde) - ajustado a la imagen */}
              <div 
                className="absolute border-2 border-white transition-all duration-75 pointer-events-none"
                style={{
                  top: imageBounds.top + (frameTopPercent * imageBounds.height / 100),
                  left: imageBounds.left,
                  width: imageBounds.width,
                  height: `${frameHeightPercent * imageBounds.height / 100}px`,
                }}
              >
                {/* Líneas de guía horizontales */}
                <div className="absolute top-1/3 left-0 right-0 border-t border-white/30" />
                <div className="absolute top-2/3 left-0 right-0 border-t border-white/30" />
                
                {/* Esquinas decorativas */}
                <div className="absolute -top-0.5 -left-0.5 w-4 h-4 border-t-2 border-l-2 border-white" />
                <div className="absolute -top-0.5 -right-0.5 w-4 h-4 border-t-2 border-r-2 border-white" />
                <div className="absolute -bottom-0.5 -left-0.5 w-4 h-4 border-b-2 border-l-2 border-white" />
                <div className="absolute -bottom-0.5 -right-0.5 w-4 h-4 border-b-2 border-r-2 border-white" />

                {/* Indicador central */}
                <div className="absolute inset-0 flex items-center justify-center">
                  <div className={`bg-black/50 text-white px-3 py-1.5 rounded-full text-sm font-medium flex items-center gap-2 backdrop-blur-sm transition-opacity ${isDragging ? 'opacity-100' : 'opacity-70'}`}>
                    <Move className="w-4 h-4" />
                    {isDragging ? 'Suelta para fijar' : 'Arrastra arriba/abajo'}
                  </div>
                </div>
              </div>
            </>
          )}
        </div>

        <DialogFooter className="p-4 pt-2 flex gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button onClick={handleConfirm} className="gap-2">
            <Check className="w-4 h-4" />
            Aplicar posición
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
