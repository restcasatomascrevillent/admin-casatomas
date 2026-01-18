import { useState, useRef, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Check, Move } from "lucide-react";

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
  const [imageLoaded, setImageLoaded] = useState(false);
  const [imageDimensions, setImageDimensions] = useState({ width: 0, height: 0 });

  // Aspect ratio de la tarjeta (aproximadamente 16:9)
  const CARD_ASPECT_RATIO = 16 / 9;

  useEffect(() => {
    setPosition(currentPosition);
  }, [currentPosition, open]);

  const handleImageLoad = () => {
    if (imageRef.current) {
      setImageDimensions({
        width: imageRef.current.naturalWidth,
        height: imageRef.current.naturalHeight,
      });
      setImageLoaded(true);
    }
  };

  const calculatePosition = useCallback((clientY: number) => {
    if (!containerRef.current || !imageLoaded) return;

    const rect = containerRef.current.getBoundingClientRect();
    const containerHeight = rect.height;
    const imageHeight = imageDimensions.height;
    const displayedImageHeight = containerRef.current.querySelector('img')?.clientHeight || 0;
    
    // Calcular el rango de movimiento
    const viewportHeight = containerHeight * 0.4; // La ventana visible es 40% del contenedor
    const maxOffset = displayedImageHeight - viewportHeight;
    
    if (maxOffset <= 0) {
      setPosition(50);
      return;
    }

    const relativeY = clientY - rect.top;
    const percentage = Math.max(0, Math.min(100, (relativeY / containerHeight) * 100));
    setPosition(percentage);
  }, [imageLoaded, imageDimensions.height]);

  const handleMouseDown = (e: React.MouseEvent) => {
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
      calculatePosition(e.touches[0].clientY);
    }
  };

  const handleTouchEnd = () => {
    setIsDragging(false);
  };

  const handleConfirm = () => {
    onPositionChange(position);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl p-0 overflow-hidden">
        <DialogHeader className="p-4 pb-2">
          <DialogTitle className="flex items-center gap-2">
            <Move className="w-5 h-5" />
            Posicionar imagen
          </DialogTitle>
          <p className="text-sm text-muted-foreground">
            Arrastra verticalmente para elegir qué parte de la imagen se verá en la tarjeta
          </p>
        </DialogHeader>

        <div 
          ref={containerRef}
          className="relative w-full h-[60vh] overflow-hidden cursor-ns-resize select-none bg-black/90"
          onMouseDown={handleMouseDown}
          onTouchStart={handleTouchStart}
          onTouchMove={handleTouchMove}
          onTouchEnd={handleTouchEnd}
        >
          {/* Imagen de fondo completa con opacidad */}
          <img
            ref={imageRef}
            src={imageUrl}
            alt="Imagen completa"
            className="w-full h-auto min-h-full object-cover opacity-30"
            style={{
              objectPosition: `center ${position}%`,
            }}
            onLoad={handleImageLoad}
            draggable={false}
          />

          {/* Overlay superior oscuro */}
          <div 
            className="absolute top-0 left-0 right-0 bg-black/70 transition-all duration-75"
            style={{
              height: `${Math.max(0, position - 20)}%`,
            }}
          />

          {/* Ventana visible (rectángulo con la parte seleccionada) */}
          <div 
            className="absolute left-4 right-4 border-2 border-white rounded-lg overflow-hidden shadow-2xl transition-all duration-75"
            style={{
              top: `${Math.max(5, position - 20)}%`,
              height: '40%',
            }}
          >
            <img
              src={imageUrl}
              alt="Parte visible"
              className="w-full h-full object-cover"
              style={{
                objectPosition: `center ${position}%`,
              }}
              draggable={false}
            />
            
            {/* Indicador de arrastre */}
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
              <div className="bg-black/50 text-white px-3 py-1.5 rounded-full text-sm font-medium flex items-center gap-2 backdrop-blur-sm">
                <Move className="w-4 h-4" />
                {isDragging ? 'Suelta para confirmar' : 'Arrastra para mover'}
              </div>
            </div>

            {/* Bordes decorativos */}
            <div className="absolute top-0 left-0 w-4 h-4 border-t-2 border-l-2 border-white rounded-tl-lg" />
            <div className="absolute top-0 right-0 w-4 h-4 border-t-2 border-r-2 border-white rounded-tr-lg" />
            <div className="absolute bottom-0 left-0 w-4 h-4 border-b-2 border-l-2 border-white rounded-bl-lg" />
            <div className="absolute bottom-0 right-0 w-4 h-4 border-b-2 border-r-2 border-white rounded-br-lg" />
          </div>

          {/* Overlay inferior oscuro */}
          <div 
            className="absolute bottom-0 left-0 right-0 bg-black/70 transition-all duration-75"
            style={{
              height: `${Math.max(0, 100 - position - 20)}%`,
            }}
          />
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
