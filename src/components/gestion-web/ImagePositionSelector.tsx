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
  const [containerHeight, setContainerHeight] = useState(0);

  // El marco visible tiene una altura fija (proporción de tarjeta ~16:9 → 25% del contenedor)
  const FRAME_HEIGHT_PERCENT = 25;

  useEffect(() => {
    setPosition(currentPosition);
  }, [currentPosition, open]);

  useEffect(() => {
    if (containerRef.current) {
      setContainerHeight(containerRef.current.clientHeight);
    }
  }, [open]);

  const calculatePosition = useCallback((clientY: number) => {
    if (!containerRef.current) return;

    const rect = containerRef.current.getBoundingClientRect();
    const relativeY = clientY - rect.top;
    const containerH = rect.height;
    
    // Limitar para que el frame no se salga de la imagen
    const minY = FRAME_HEIGHT_PERCENT / 2;
    const maxY = 100 - FRAME_HEIGHT_PERCENT / 2;
    
    const rawPercent = (relativeY / containerH) * 100;
    const clampedPercent = Math.max(minY, Math.min(maxY, rawPercent));
    
    setPosition(clampedPercent);
  }, []);

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
    onPositionChange(position);
    onOpenChange(false);
  };

  // Calcular posición del frame
  const frameTop = position - FRAME_HEIGHT_PERCENT / 2;

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
          className="relative w-full h-[60vh] overflow-hidden cursor-ns-resize select-none"
          onMouseDown={handleMouseDown}
          onTouchStart={handleTouchStart}
          onTouchMove={handleTouchMove}
          onTouchEnd={handleTouchEnd}
        >
          {/* Imagen de fondo fija */}
          <img
            src={imageUrl}
            alt="Imagen completa"
            className="absolute inset-0 w-full h-full object-cover"
            draggable={false}
          />

          {/* Overlay oscuro superior */}
          <div 
            className="absolute top-0 left-0 right-0 bg-black/60 transition-all duration-75 pointer-events-none"
            style={{ height: `${Math.max(0, frameTop)}%` }}
          />

          {/* Overlay oscuro inferior */}
          <div 
            className="absolute bottom-0 left-0 right-0 bg-black/60 transition-all duration-75 pointer-events-none"
            style={{ height: `${Math.max(0, 100 - frameTop - FRAME_HEIGHT_PERCENT)}%` }}
          />

          {/* Marco visible (transparente con borde) */}
          <div 
            className="absolute left-0 right-0 border-2 border-white/90 transition-all duration-75 pointer-events-none"
            style={{
              top: `${frameTop}%`,
              height: `${FRAME_HEIGHT_PERCENT}%`,
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
