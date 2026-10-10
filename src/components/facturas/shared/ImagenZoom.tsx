import { useCallback, useEffect, useRef, useState } from "react";
import { Maximize2, Minus, Plus, RotateCw, ScanLine } from "lucide-react";

/**
 * Imagen con zoom y arrastre, sin librerías (transform + pointer events).
 *   - Rueda del ratón: zoom centrado en el puntero. Con `requiereCtrl` solo si se mantiene Ctrl
 *     (o tras hacer clic en la imagen), para no secuestrar el scroll de la ficha.
 *   - Pellizco con dos dedos, arrastre con ratón o un dedo, doble clic / doble toque: ajustar <-> 2×.
 *   - Botones flotantes (44 px): − / % / + / Ajustar / Girar 90° / Pantalla completa (opcional).
 *   - Teclado con el foco en la imagen: + − 0 R y flechas.
 * Escala 1 = la foto entera dentro del recuadro («Ajustar»); el % mostrado es el real sobre el original.
 */

const PASO = 1.5;
const DOBLE = 2;
const BOTON =
  "inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-md text-foreground hover:bg-muted focus:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-40";

interface Vista {
  s: number;
  x: number;
  y: number;
  /** Grados (0/90/180/270). */
  r: number;
  /** Se ha pedido «100 %» (tamaño real). */
  real: boolean;
}
const INICIAL: Vista = { s: 1, x: 0, y: 0, r: 0, real: false };

export interface ImagenZoomProps {
  src: string;
  alt: string;
  className?: string;
  /** Rueda solo con Ctrl o tras hacer clic en la imagen (para la vista dentro de la ficha). */
  requiereCtrl?: boolean;
  /** Si se pasa, añade un botón «pantalla completa» a la barra. */
  onPantallaCompleta?: () => void;
  lazy?: boolean;
  /** La imagen aún no ha cargado: se oculta (el padre pinta su marcador). */
  oculta?: boolean;
  onLoad?: () => void;
  onError?: () => void;
}

export function ImagenZoom({ src, alt, className = "", requiereCtrl = false, onPantallaCompleta, lazy, oculta, onLoad, onError }: ImagenZoomProps) {
  const marco = useRef<HTMLDivElement>(null);
  const [vista, setVista] = useState<Vista>(INICIAL);
  const vistaRef = useRef<Vista>(INICIAL);
  const dims = useRef({ cw: 0, ch: 0, nw: 0, nh: 0 });
  const [, setDimsTick] = useState(0);
  const punteros = useRef(new Map<number, { x: number; y: number }>());
  const gesto = useRef({ movido: 0, multi: false });
  const ultimoToque = useRef({ t: 0, x: 0, y: 0 });
  const activo = useRef(false);

  /** Escala de «ajustar» (foto entera dentro del recuadro) para un giro dado. */
  const ajuste = (r: number) => {
    const { cw, ch, nw, nh } = dims.current;
    if (!cw || !ch || !nw || !nh) return 1;
    const [rw, rh] = r % 180 ? [nh, nw] : [nw, nh];
    return Math.min(cw / rw, ch / rh);
  };
  const maxEscala = (r: number) => Math.min(16, Math.max(4, 3 / ajuste(r)));

  /** Recorta la vista: sin pasarse de zoom y sin sacar la imagen del recuadro. */
  const limitar = (v: Vista): Vista => {
    const { cw, ch, nw, nh } = dims.current;
    const s = Math.min(maxEscala(v.r), Math.max(1, v.s));
    const f = ajuste(v.r);
    const [rw, rh] = v.r % 180 ? [nh, nw] : [nw, nh];
    const mx = Math.max(0, (rw * f * s - cw) / 2);
    const my = Math.max(0, (rh * f * s - ch) / 2);
    return { ...v, s, x: Math.min(mx, Math.max(-mx, v.x)), y: Math.min(my, Math.max(-my, v.y)) };
  };
  // `limitar` solo lee refs: se llama por ref para que `aplicar` sea estable.
  const limitarRef = useRef(limitar);
  limitarRef.current = limitar;
  const aplicar = useCallback((v: Vista) => {
    const l = limitarRef.current(v);
    vistaRef.current = l;
    setVista(l);
  }, []);

  /** Nueva escala manteniendo fijo el punto (px, py) medido desde el centro del recuadro. */
  const zoomEn = (sNueva: number, px: number, py: number) => {
    const base = vistaRef.current;
    const s = Math.min(maxEscala(base.r), Math.max(1, sNueva));
    const k = s / base.s;
    aplicar({ ...base, s, x: px - (px - base.x) * k, y: py - (py - base.y) * k, real: false });
  };
  const alternarDoble = (px: number, py: number) => {
    if (vistaRef.current.s > 1.05) aplicar({ ...vistaRef.current, s: 1, x: 0, y: 0, real: false });
    else zoomEn(DOBLE, px, py);
  };
  const relativo = (cx: number, cy: number) => {
    const b = marco.current?.getBoundingClientRect();
    return b ? { px: cx - (b.left + b.width / 2), py: cy - (b.top + b.height / 2) } : { px: 0, py: 0 };
  };

  // Tamaño del recuadro (se recalcula al girar la tablet o al abrir el visor).
  useEffect(() => {
    const el = marco.current;
    if (!el) return;
    const medir = () => {
      dims.current.cw = el.clientWidth;
      dims.current.ch = el.clientHeight;
      setDimsTick((n) => n + 1);
      aplicar(vistaRef.current);
    };
    medir();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(medir);
    ro.observe(el);
    return () => ro.disconnect();
  }, [aplicar]);

  // Rueda: listener nativo no pasivo (React registra `onWheel` como pasivo y no deja `preventDefault`).
  useEffect(() => {
    const el = marco.current;
    if (!el) return;
    const alRueda = (e: WheelEvent) => {
      if (requiereCtrl && !e.ctrlKey && !activo.current) return; // la ficha sigue su scroll
      e.preventDefault();
      const dy = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
      // Pellizco de trackpad (Ctrl + deltas pequeños): más sensible; muesca de rueda (±100): ~1,3× por muesca.
      const k = Math.exp(-dy * (e.ctrlKey && Math.abs(dy) < 50 ? 0.01 : 0.0025));
      const { px, py } = relativo(e.clientX, e.clientY);
      zoomEn(vistaRef.current.s * k, px, py);
    };
    el.addEventListener("wheel", alRueda, { passive: false });
    return () => el.removeEventListener("wheel", alRueda);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requiereCtrl]);

  const alPulsar = (e: React.PointerEvent) => {
    activo.current = true;
    marco.current?.setPointerCapture?.(e.pointerId);
    punteros.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (punteros.current.size === 1) gesto.current = { movido: 0, multi: false };
    else gesto.current.multi = true;
  };
  const alMover = (e: React.PointerEvent) => {
    const previo = punteros.current.get(e.pointerId);
    if (!previo) return;
    const actual = { x: e.clientX, y: e.clientY };
    const v = vistaRef.current;
    if (punteros.current.size >= 2) {
      const otro = [...punteros.current.entries()].find(([id]) => id !== e.pointerId)![1];
      const d0 = Math.hypot(previo.x - otro.x, previo.y - otro.y) || 1;
      const d1 = Math.hypot(actual.x - otro.x, actual.y - otro.y) || 1;
      const m0 = relativo((previo.x + otro.x) / 2, (previo.y + otro.y) / 2);
      const m1 = relativo((actual.x + otro.x) / 2, (actual.y + otro.y) / 2);
      const s = Math.min(maxEscala(v.r), Math.max(1, v.s * (d1 / d0)));
      const k = s / v.s;
      aplicar({ ...v, s, x: m0.px - (m0.px - v.x) * k + (m1.px - m0.px), y: m0.py - (m0.py - v.y) * k + (m1.py - m0.py), real: false });
    } else {
      const dx = actual.x - previo.x;
      const dy = actual.y - previo.y;
      gesto.current.movido += Math.abs(dx) + Math.abs(dy);
      if (v.s > 1) aplicar({ ...v, x: v.x + dx, y: v.y + dy });
      else if (e.pointerType === "touch" && requiereCtrl) {
        // Sin zoom, un dedo sobre la foto sigue desplazando la ficha (el recuadro bloquea el gesto nativo).
        let p = marco.current?.parentElement ?? null;
        while (p && !(p.scrollHeight > p.clientHeight && /(auto|scroll)/.test(getComputedStyle(p).overflowY))) p = p.parentElement;
        p?.scrollBy(0, -dy);
      }
    }
    punteros.current.set(e.pointerId, actual);
  };
  const alSoltar = (e: React.PointerEvent) => {
    const estaba = punteros.current.delete(e.pointerId);
    if (!estaba || e.type === "pointercancel") return;
    // Doble toque (el ratón usa `onDoubleClick`).
    if (e.pointerType === "touch" && !gesto.current.multi && gesto.current.movido < 10 && punteros.current.size === 0) {
      const t = Date.now();
      const u = ultimoToque.current;
      if (t - u.t < 320 && Math.hypot(e.clientX - u.x, e.clientY - u.y) < 30) {
        const { px, py } = relativo(e.clientX, e.clientY);
        alternarDoble(px, py);
        ultimoToque.current = { t: 0, x: 0, y: 0 };
      } else ultimoToque.current = { t, x: e.clientX, y: e.clientY };
    }
  };

  const f = ajuste(vista.r);
  const centro = (mult: number) => zoomEn(vistaRef.current.s * mult, 0, 0);
  const ajustar = () => aplicar({ ...vistaRef.current, s: 1, x: 0, y: 0, real: false });
  const girar = () => aplicar({ s: 1, x: 0, y: 0, r: (vistaRef.current.r + 90) % 360, real: false });
  const alternarReal = () => {
    if (vistaRef.current.real) return ajustar();
    const s = Math.max(1, 1 / ajuste(vistaRef.current.r));
    aplicar({ ...vistaRef.current, s, x: 0, y: 0, real: true });
  };
  const porcentaje = Math.round(f * vista.s * 100);

  const alTeclear = (e: React.KeyboardEvent) => {
    const v = vistaRef.current;
    const mover = (dx: number, dy: number) => {
      e.preventDefault();
      aplicar({ ...v, x: v.x + dx, y: v.y + dy });
    };
    if (e.key === "+" || e.key === "=") { e.preventDefault(); centro(PASO); }
    else if (e.key === "-" || e.key === "_") { e.preventDefault(); centro(1 / PASO); }
    else if (e.key === "0") { e.preventDefault(); ajustar(); }
    else if (e.key === "r" || e.key === "R") { e.preventDefault(); girar(); }
    else if (e.key === "ArrowLeft") mover(60, 0);
    else if (e.key === "ArrowRight") mover(-60, 0);
    else if (e.key === "ArrowUp") mover(0, 60);
    else if (e.key === "ArrowDown") mover(0, -60);
  };

  const { nw, nh } = dims.current;
  const ancho = nw ? nw * f : 1;
  const alto = nh ? nh * f : 1;

  return (
    <div className={`relative overflow-hidden rounded-md border bg-muted/40 ${className}`}>
      <div
        ref={marco}
        data-testid="zoom-marco"
        tabIndex={0}
        role="group"
        aria-label="Imagen ampliable. Más y menos para el zoom, cero para ajustar, R para girar, flechas para moverse"
        className={`absolute inset-0 touch-none select-none focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring ${vista.s > 1 ? "cursor-grab active:cursor-grabbing" : "cursor-zoom-in"}`}
        style={{ touchAction: "none" }}
        onPointerDown={alPulsar}
        onPointerMove={alMover}
        onPointerUp={alSoltar}
        onPointerCancel={alSoltar}
        onPointerLeave={(e) => {
          if (e.pointerType === "mouse") activo.current = false;
        }}
        onBlur={() => {
          activo.current = false;
        }}
        onDoubleClick={(e) => {
          const { px, py } = relativo(e.clientX, e.clientY);
          alternarDoble(px, py);
        }}
        onKeyDown={alTeclear}
      >
        <img
          src={src}
          alt={alt}
          draggable={false}
          loading={lazy ? "lazy" : undefined}
          data-testid="zoom-lienzo"
          onLoad={(e) => {
            dims.current.nw = e.currentTarget.naturalWidth;
            dims.current.nh = e.currentTarget.naturalHeight;
            setDimsTick((n) => n + 1);
            aplicar(vistaRef.current);
            onLoad?.();
          }}
          onError={onError}
          className={`pointer-events-none absolute left-1/2 top-1/2 max-w-none select-none ${oculta ? "opacity-0" : ""}`}
          style={{
            width: ancho,
            height: alto,
            transform: `translate(-50%, -50%) translate(${vista.x}px, ${vista.y}px) scale(${vista.s}) rotate(${vista.r}deg)`,
            transformOrigin: "center",
            willChange: "transform",
          }}
        />
      </div>
      <div
        role="toolbar"
        aria-label="Zoom del documento original"
        className="absolute bottom-2 left-1/2 flex max-w-[calc(100%-1rem)] -translate-x-1/2 items-center gap-0.5 rounded-lg border bg-background/90 p-0.5 shadow-md backdrop-blur"
      >
        <button type="button" className={BOTON} aria-label="Alejar" title="Alejar" disabled={vista.s <= 1} onClick={() => centro(1 / PASO)}>
          <Minus className="h-5 w-5" aria-hidden="true" />
        </button>
        <button
          type="button"
          onClick={alternarReal}
          aria-label={vista.real ? "Ajustar a la pantalla" : "Ver al 100 %"}
          title={vista.real ? "Ajustar a la pantalla" : "Ver al 100 %"}
          aria-pressed={vista.real}
          className="inline-flex h-11 min-w-14 items-center justify-center rounded-md px-1 text-sm font-medium tabular-nums hover:bg-muted focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {porcentaje} %
        </button>
        <button type="button" className={BOTON} aria-label="Ampliar" title="Ampliar" disabled={vista.s >= maxEscala(vista.r)} onClick={() => centro(PASO)}>
          <Plus className="h-5 w-5" aria-hidden="true" />
        </button>
        <button type="button" className={BOTON} aria-label="Ajustar a la vista" title="Ajustar" onClick={ajustar}>
          <ScanLine className="h-5 w-5" aria-hidden="true" />
        </button>
        <button type="button" className={BOTON} aria-label="Girar 90 grados" title="Girar 90°" onClick={girar}>
          <RotateCw className="h-5 w-5" aria-hidden="true" />
        </button>
        {onPantallaCompleta && (
          <button type="button" className={BOTON} aria-label="Ver el original a pantalla completa" title="Pantalla completa" onClick={onPantallaCompleta}>
            <Maximize2 className="h-5 w-5" aria-hidden="true" />
          </button>
        )}
      </div>
    </div>
  );
}
