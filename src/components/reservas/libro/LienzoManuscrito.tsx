import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef } from "react";
import { cn } from "@/lib/utils";

// ============================================================================
// Renglón para escribir a mano con el lápiz (libro de reservas, 10/11/2026).
// ----------------------------------------------------------------------------
// · Pointer events con presión: el grosor sigue a `pressure` (Apple Pencil).
// · `touch-action: none` y `touchstart`/`touchmove` cancelados (no pasivos):
//   al escribir, la página ni desplaza ni hace zoom.
// · Rechazo de palma: en cuanto se ve un lápiz (`pointerType === "pen"`), el
//   dedo deja de pintar. Sin lápiz (ratón, dedo) pinta cualquiera.
// · Los renglones son fondo CSS: la imagen exportada sale limpia (tinta sobre
//   blanco), recortada a lo escrito.
// ============================================================================

interface Punto {
  x: number;
  y: number;
  p: number;
}

export interface LienzoManuscritoApi {
  borrar: () => void;
  deshacer: () => void;
  /** PNG (data URL) de lo escrito, fondo blanco y recortado; null si está en blanco. */
  exportar: () => string | null;
}

interface Props {
  /** Número de trazos tras cada cambio (para activar/desactivar botones). */
  onCambio?: (trazos: number) => void;
  className?: string;
  /** Separación de los renglones (px). */
  renglon?: number;
}

const TINTA = "#1e293b";

function grosor(p: number): number {
  // Ratón y dedo dan 0 o 0,5: grosor medio. El lápiz va de fino a grueso.
  const presion = p > 0 ? p : 0.5;
  return 1.2 + presion * 3.2;
}

function pintarTrazo(ctx: CanvasRenderingContext2D, trazo: Punto[], escala = 1, dx = 0, dy = 0) {
  ctx.strokeStyle = TINTA;
  ctx.fillStyle = TINTA;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  if (trazo.length === 1) {
    const [a] = trazo;
    ctx.beginPath();
    ctx.arc((a.x - dx) * escala, (a.y - dy) * escala, (grosor(a.p) / 2) * escala, 0, Math.PI * 2);
    ctx.fill();
    return;
  }
  for (let i = 1; i < trazo.length; i++) {
    const a = trazo[i - 1];
    const b = trazo[i];
    ctx.beginPath();
    ctx.lineWidth = grosor((a.p + b.p) / 2) * escala;
    ctx.moveTo((a.x - dx) * escala, (a.y - dy) * escala);
    ctx.lineTo((b.x - dx) * escala, (b.y - dy) * escala);
    ctx.stroke();
  }
}

export const LienzoManuscrito = forwardRef<LienzoManuscritoApi, Props>(function LienzoManuscrito(
  { onCambio, className, renglon = 56 },
  ref,
) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const trazos = useRef<Punto[][]>([]);
  const actual = useRef<{ id: number; trazo: Punto[] } | null>(null);
  const lapizVisto = useRef(false);

  const redibujar = useCallback(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    const dpr = window.devicePixelRatio || 1;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    for (const t of trazos.current) pintarTrazo(ctx, t);
    if (actual.current) pintarTrazo(ctx, actual.current.trazo);
  }, []);

  const avisar = useCallback(() => onCambio?.(trazos.current.length), [onCambio]);

  // Tamaño real del lienzo = el de su caja × devicePixelRatio (trazo nítido).
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ajustar = () => {
      const r = canvas.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      canvas.width = Math.max(1, Math.round(r.width * dpr));
      canvas.height = Math.max(1, Math.round(r.height * dpr));
      redibujar();
    };
    ajustar();
    if (typeof ResizeObserver === "undefined") return;
    const obs = new ResizeObserver(ajustar);
    obs.observe(canvas);
    return () => obs.disconnect();
  }, [redibujar]);

  // iOS: sin esto, un toque largo o el dedo pueden seguir desplazando la hoja.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const cancelar = (e: TouchEvent) => e.preventDefault();
    canvas.addEventListener("touchstart", cancelar, { passive: false });
    canvas.addEventListener("touchmove", cancelar, { passive: false });
    return () => {
      canvas.removeEventListener("touchstart", cancelar);
      canvas.removeEventListener("touchmove", cancelar);
    };
  }, []);

  const punto = (e: React.PointerEvent<HTMLCanvasElement>): Punto => {
    const r = e.currentTarget.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top, p: e.pressure };
  };

  const admite = (e: React.PointerEvent) => {
    if (e.pointerType === "pen") lapizVisto.current = true;
    return !(lapizVisto.current && e.pointerType === "touch");
  };

  const alBajar = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!admite(e) || actual.current) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture?.(e.pointerId);
    actual.current = { id: e.pointerId, trazo: [punto(e)] };
    redibujar();
  };

  const alMover = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!actual.current || actual.current.id !== e.pointerId) return;
    e.preventDefault();
    const eventos = e.nativeEvent.getCoalescedEvents?.() ?? [];
    const r = e.currentTarget.getBoundingClientRect();
    if (eventos.length) {
      for (const c of eventos) actual.current.trazo.push({ x: c.clientX - r.left, y: c.clientY - r.top, p: c.pressure });
    } else {
      actual.current.trazo.push(punto(e));
    }
    redibujar();
  };

  const alSubir = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!actual.current || actual.current.id !== e.pointerId) return;
    trazos.current.push(actual.current.trazo);
    actual.current = null;
    redibujar();
    avisar();
  };

  useImperativeHandle(
    ref,
    () => ({
      borrar: () => {
        trazos.current = [];
        actual.current = null;
        redibujar();
        avisar();
      },
      deshacer: () => {
        trazos.current.pop();
        redibujar();
        avisar();
      },
      exportar: () => {
        const todos = trazos.current;
        if (!todos.length) return null;
        let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
        for (const t of todos) for (const p of t) {
          x0 = Math.min(x0, p.x); y0 = Math.min(y0, p.y); x1 = Math.max(x1, p.x); y1 = Math.max(y1, p.y);
        }
        const margen = 24;
        x0 -= margen; y0 -= margen; x1 += margen; y1 += margen;
        // Escala ~2× para que la IA lea bien la letra, sin pasar de 2000 px de ancho.
        const escala = Math.min(2, 2000 / Math.max(1, x1 - x0));
        const out = document.createElement("canvas");
        out.width = Math.max(1, Math.round((x1 - x0) * escala));
        out.height = Math.max(1, Math.round((y1 - y0) * escala));
        const ctx = out.getContext("2d");
        if (!ctx) return null;
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(0, 0, out.width, out.height);
        for (const t of todos) pintarTrazo(ctx, t, escala, x0, y0);
        return out.toDataURL("image/png");
      },
    }),
    [avisar, redibujar],
  );

  return (
    <canvas
      ref={canvasRef}
      aria-label="Renglón para escribir la reserva a mano"
      className={cn("block h-full w-full cursor-crosshair select-none", className)}
      style={{
        touchAction: "none",
        WebkitUserSelect: "none",
        backgroundImage: `repeating-linear-gradient(to bottom, transparent 0, transparent ${renglon - 1}px, hsl(205 60% 75% / 0.7) ${renglon - 1}px, hsl(205 60% 75% / 0.7) ${renglon}px)`,
      }}
      onPointerDown={alBajar}
      onPointerMove={alMover}
      onPointerUp={alSubir}
      onPointerCancel={alSubir}
      onContextMenu={(e) => e.preventDefault()}
    />
  );
});
