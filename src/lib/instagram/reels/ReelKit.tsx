/**
 * ReelKit: el reel pintado en un instante t. Port a TSX de
 * marca-base/reel-kit.jsx (Photo, TransitionFX, ShotText, Closing, Premium,
 * EndFade, Piece) leyendo la configuración por props y no de window.
 *
 * TODO es función pura de (reel, t): sin estado, sin efectos, sin
 * Math.random ni Date, sin animaciones ni transiciones CSS. El mismo t da
 * siempre el mismo DOM, así que la vista previa del panel (que solo mueve t)
 * y el render a MP4 de la fase 6 (que fija t = n / 30 y captura) ven lo mismo.
 *
 * Cambios respecto al original, a propósito:
 * - el logo de Casa Tomás es el PNG blanco del panel (antes, el negro con
 *   filter: invert(1)): mismo resultado;
 * - teléfono, @ y «EST. 2023 · CREVILLENTE» salen de DATOS_MARCA_REEL;
 * - en el rótulo «letters» cada palabra va en un bloque que no se parte (el
 *   original podía cortar una palabra a media línea);
 * - una escena sin foto pinta un hueco oscuro (opcionalmente rotulado);
 * - los textos llevan data-campo (como las imágenes) para medirlos en el render.
 */
import type { CSSProperties, ReactElement, ReactNode } from "react";
import {
  ALTO_REEL,
  ANCHO_REEL,
  Easing,
  MOVIMIENTO,
  SALIDA_ROTULO_POR_DEFECTO,
  TRANSICION_POR_DEFECTO,
  ZONA_SEGURA_REEL,
  calcularTiempos,
  clamp,
  interpolate,
  progreso,
  type TiemposReel,
} from "./motor.js";
import { DATOS_MARCA_REEL, TEMAS_REEL, cssFuentesReel, type TemaReel } from "./marca.js";
import { crearResolverFotos, type ResolverFoto } from "./fotos.js";
import type { EncuadreReel, ReelPieza, RotuloReel, TransicionReel } from "./esquema.js";

const W = ANCHO_REEL;
const H = ALTO_REEL;
const { entrar, suavizar, saltar } = MOVIMIENTO;
/** Los pares [inicio, fin] del esquema (con strict apagado, zod los tipa como opcionales). */
const par = (v: unknown) => v as readonly [number, number];

/** Un plano de foto: cada escena y el cierre. */
interface Plano {
  id: string;
  nombre: string;
  foto?: string;
  encuadre: EncuadreReel;
  transicion?: TransicionReel;
  rotulo?: RotuloReel;
}

interface Ctx {
  reel: ReelPieza;
  t: number;
  tiempos: TiemposReel;
  planos: Plano[];
  /** [inicio, fin] de cada plano (escenas + cierre). */
  tramos: Array<[number, number]>;
  tema: TemaReel;
  trIn: number;
  trOut: number;
  salida: number;
  urlFoto: ResolverFoto;
  baseRecursos: string;
  marcarHuecos: boolean;
}

// ── Foto ─────────────────────────────────────────────────────────────────────

function Foto({ c, i }: { c: Ctx; i: number }) {
  const { t, trIn, trOut } = c;
  const plano = c.planos[i];
  const siguiente = c.planos[i + 1];
  const [inicio, fin] = c.tramos[i];
  if (t < inicio - trIn || t > fin + trOut + 0.05) return null;
  const tr = i === 0 ? undefined : plano.transicion;
  const pin = tr ? suavizar(t, inicio - trIn, inicio + trOut) : 1;
  const pout = siguiente ? suavizar(t, fin - trIn, fin + trOut) : 0;
  const d = progreso(t, inicio - trIn, fin + trOut);
  const e = plano.encuadre;
  let s = interpolate([0, 1], par(e.zoom), Easing.linear)(d);
  let x = e.desplazamientoX ? interpolate([0, 1], par(e.desplazamientoX), Easing.linear)(d) : 0;
  let y = e.desplazamientoY ? interpolate([0, 1], par(e.desplazamientoY), Easing.linear)(d) : 0;
  let op = 1;
  let blur = 0;
  let brillo = 1;
  let recorte = "none";
  switch (tr) {
    case "zoom":
      op = pin;
      s *= 1 + 0.22 * (1 - pin);
      blur += 14 * (1 - pin);
      break;
    case "wipe":
      recorte = `inset(${(1 - pin) * 100}% 0 0 0)`;
      y += 140 * (1 - pin);
      break;
    case "push":
      x += (1 - pin) * W;
      break;
    case "iris":
      recorte = `circle(${pin * 80}% at 50% 55%)`;
      break;
    case "flash":
    case "blur":
      op = pin;
      s *= 1 + 0.06 * (1 - pin);
      break;
    case "rise":
      op = pin;
      y += 260 * (1 - pin);
      blur += 10 * (1 - pin);
      break;
    case "glass":
      recorte = `inset(0 ${(1 - pin) * 50}% 0 ${(1 - pin) * 50}%)`;
      s *= 1 + 0.08 * (1 - pin);
      break;
    case "dissolve":
      op = pin;
      blur += 18 * (1 - pin);
      s *= 1 - 0.05 * (1 - pin);
      break;
  }
  if (siguiente) {
    switch (siguiente.transicion) {
      case "zoom":
        s *= 1 + 0.35 * pout;
        blur += 12 * pout;
        break;
      case "wipe":
        y -= 160 * pout;
        brillo -= 0.3 * pout;
        break;
      case "push":
        x -= pout * W * 0.35;
        brillo -= 0.45 * pout;
        break;
      case "iris":
        s *= 1 + 0.1 * pout;
        brillo -= 0.35 * pout;
        break;
      case "blur":
        blur += 26 * pout;
        brillo -= 0.4 * pout;
        break;
      case "rise":
        y -= 180 * pout;
        brillo -= 0.4 * pout;
        break;
      case "glass":
        s *= 1 - 0.06 * pout;
        brillo -= 0.5 * pout;
        break;
      case "dissolve":
        s *= 1 + 0.08 * pout;
        blur += 10 * pout;
        break;
    }
  }
  const url = plano.foto ? c.urlFoto(plano.foto) : undefined;
  const estiloImagen: CSSProperties = {
    position: "absolute",
    left: -40,
    top: -40,
    width: W + 80,
    height: H + 80,
    transformOrigin: e.origen ?? "50% 50%",
    transform: `translate(${x}px,${y}px) scale(${s})`,
    filter: `blur(${blur}px) brightness(${brillo})`,
  };
  return (
    <div data-plano={plano.id} style={{ position: "absolute", inset: 0, opacity: op, clipPath: recorte, overflow: "hidden" }}>
      {url ? (
        <img
          src={url}
          alt=""
          draggable={false}
          style={{
            ...estiloImagen,
            objectFit: "cover",
            objectPosition: e.paneo ? `${interpolate([0, 1], par(e.paneo), Easing.linear)(d)}% 50%` : e.pos,
          }}
        />
      ) : (
        <div style={{ ...estiloImagen, background: "radial-gradient(ellipse at 50% 40%, #2a2f33 0%, #121416 60%, #0A0A0A 100%)" }}>
          {c.marcarHuecos && (
            <div
              style={{
                position: "absolute",
                left: 0,
                right: 0,
                top: "42%",
                textAlign: "center",
                font: `500 34px ${c.tema.texto}`,
                letterSpacing: ".2em",
                textTransform: "uppercase",
                color: "rgba(255,255,255,.35)",
              }}
            >
              Sin foto · {plano.nombre}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Efectos de transición ────────────────────────────────────────────────────

function EfectosTransicion({ c }: { c: Ctx }) {
  const { t, tema, trIn, trOut } = c;
  const out: ReactNode[] = [];
  c.planos.forEach((pl, i) => {
    if (i === 0 || !pl.transicion) return;
    const corte = c.tramos[i][0];
    const p = suavizar(t, corte - trIn, corte + trOut);
    if (p <= 0 || p >= 1) return;
    const k = `tr-${pl.id}`;
    if (pl.transicion === "wipe")
      out.push(<div key={k} style={{ position: "absolute", left: 0, right: 0, top: (1 - p) * H - 3, height: 6, background: tema.oro, boxShadow: `0 0 40px 8px ${tema.oroClaro}99` }} />);
    if (pl.transicion === "flash")
      out.push(
        <div
          key={k}
          style={{
            position: "absolute",
            inset: 0,
            background: `radial-gradient(circle at 60% 40%, rgba(255,226,160,.95), ${tema.oro}8c 45%, ${tema.oro}00 80%)`,
            opacity: Math.sin(Math.PI * p),
            mixBlendMode: "screen",
          }}
        />,
      );
    if (pl.transicion === "glass") {
      const hw = (1 - p) * 50;
      const linea: CSSProperties = { position: "absolute", top: 0, bottom: 0, width: 3, background: tema.oroClaro, boxShadow: `0 0 30px 6px ${tema.oro}99`, opacity: Math.sin(Math.PI * p) };
      out.push(
        <div key={k} style={{ position: "absolute", inset: 0 }}>
          <div style={{ ...linea, left: `${hw}%` }} />
          <div style={{ ...linea, right: `${hw}%` }} />
        </div>,
      );
    }
    if (pl.transicion === "iris")
      out.push(
        <div
          key={k}
          style={{
            position: "absolute",
            left: "50%",
            top: "55%",
            width: p * 3600,
            height: p * 3600,
            marginLeft: -p * 1800,
            marginTop: -p * 1800,
            borderRadius: "50%",
            border: `4px solid ${tema.oroClaro}`,
            opacity: 1 - p,
          }}
        />,
      );
  });
  return <>{out}</>;
}

// ── Rótulos ──────────────────────────────────────────────────────────────────

function Mascara({ p, children, style }: { p: number; children: ReactNode; style?: CSSProperties }) {
  return (
    <div style={{ overflow: "hidden", paddingBottom: "0.12em", ...style }}>
      <div style={{ transform: `translateY(${(1 - p) * 115}%)` }}>{children}</div>
    </div>
  );
}

function Marca({ c, w, style }: { c: Ctx; w: number; style?: CSSProperties }) {
  if (c.reel.marca === "touza") {
    return (
      <div data-campo="marca" style={{ font: `700 ${w * 0.36}px/0.85 ${c.tema.titular}`, letterSpacing: "-.03em", color: "#fff", ...style }}>
        TOUZA
      </div>
    );
  }
  return (
    <img
      data-campo="marca"
      src={`${c.baseRecursos}/logos/casa-tomas-logo-blanco.png`}
      alt="Casa Tomás"
      draggable={false}
      style={{ width: w, filter: "drop-shadow(0 10px 30px rgba(0,0,0,.5))", ...style }}
    />
  );
}

function Rotulo({ c, i }: { c: Ctx; i: number }) {
  const { t, tema: th } = c;
  const r = c.planos[i].rotulo;
  const [inicio, fin] = c.tramos[i];
  if (!r || t < inicio || t > fin) return null;
  const o = 1 - suavizar(t, fin - c.salida, fin - 0.05);
  const fs = r.tamano ?? 1;
  const sombra = "0 4px 30px rgba(0,0,0,.45)";
  const ante = (p: number, extra?: CSSProperties) =>
    r.antetitulo ? (
      <div data-campo="antetitulo" style={{ font: `600 28px ${th.texto}`, letterSpacing: ".35em", textTransform: "uppercase", color: th.oroClaro, opacity: p, ...extra }}>
        {r.antetitulo}
      </div>
    ) : null;
  const titulo = r.titulo ?? "";
  switch (r.estilo) {
    case "intro": {
      const a = entrar(t, inicio + 0.3, 1.3);
      const b = entrar(t, inicio + 1.0, 1.4);
      return (
        <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", opacity: o, transform: `scale(${1 + 0.06 * (1 - o)})` }}>
          <div style={{ clipPath: `inset(0 ${(1 - a) * 100}% 0 0)`, opacity: 0.3 + 0.7 * a }}>
            <Marca c={c} w={660} />
          </div>
          {r.antetitulo && (
            <div
              data-campo="antetitulo"
              style={{ marginTop: 56, font: `500 30px ${th.texto}`, textTransform: "uppercase", color: th.oroClaro, letterSpacing: `${0.8 - 0.5 * b}em`, opacity: b }}
            >
              {r.antetitulo}
            </div>
          )}
        </div>
      );
    }
    case "hook": {
      const palabras = titulo.split(" ");
      return (
        <div style={{ position: "absolute", left: 80, right: 80, top: 0, bottom: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", textAlign: "center", color: "#fff", opacity: o, textShadow: sombra }}>
          {ante(entrar(t, inicio + 0.2, 0.8), { marginBottom: 30 })}
          <div data-campo="titulo" style={{ font: `${th.pesoTitular} ${140 * fs}px/1.02 ${th.titular}`, display: "flex", flexWrap: "wrap", justifyContent: "center", columnGap: ".25em" }}>
            {palabras.map((w, k) => {
              const p = saltar(t, inicio + 0.35 + k * 0.14, 0.7);
              return (
                <span key={k} style={{ display: "inline-block", transform: `scale(${p})`, opacity: clamp(p, 0, 1) }}>
                  {w}
                </span>
              );
            })}
          </div>
          {r.sub && (
            <div data-campo="sub" style={{ marginTop: 30, font: `italic 400 56px ${th.titular}`, opacity: entrar(t, inicio + 1.1) }}>
              {r.sub}
            </div>
          )}
        </div>
      );
    }
    case "mask": {
      const a = entrar(t, inicio + 0.5, 1.1);
      const b = entrar(t, inicio + 0.85, 1.1);
      const l = suavizar(t, inicio + 1.0, inicio + 2.0);
      return (
        <div style={{ position: "absolute", left: 80, right: 80, bottom: 400, color: "#fff", opacity: o, transform: `translateY(${-30 * (1 - o)}px)` }}>
          <Mascara p={a}>
            <div data-campo="titulo" style={{ font: `italic 400 ${150 * fs}px/1 ${th.titular}`, letterSpacing: "-.02em", textShadow: sombra }}>
              {titulo}
            </div>
          </Mascara>
          <div style={{ display: "flex", alignItems: "center", gap: 28, marginTop: 18 }}>
            <div style={{ width: 140 * l, height: 3, background: th.oro, flex: "0 0 auto" }} />
            {r.sub && (
              <Mascara p={b}>
                <div data-campo="sub" style={{ font: `${th.pesoTitular} 58px ${th.titular}`, textShadow: sombra }}>
                  {r.sub}
                </div>
              </Mascara>
            )}
          </div>
        </div>
      );
    }
    case "box": {
      const e = entrar(t, inicio + 0.5, 0.9);
      const l = suavizar(t, inicio + 0.5, inicio + 1.4);
      const a = entrar(t, inicio + 0.8);
      const b = entrar(t, inicio + 1.0);
      return (
        <div
          style={{
            position: "absolute",
            left: 80,
            right: 80,
            bottom: 380,
            textAlign: "center",
            color: "#fff",
            opacity: o,
            padding: "44px 32px 50px",
            borderRadius: 8,
            background: `rgba(${th.caja},${0.62 * e})`,
            backdropFilter: `blur(${10 * e}px)`,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 24, opacity: e }}>
            <div style={{ width: 90 * l, height: 2, background: th.oroClaro }} />
            {ante(1)}
            <div style={{ width: 90 * l, height: 2, background: th.oroClaro }} />
          </div>
          <Mascara p={a} style={{ marginTop: 30 }}>
            <div data-campo="titulo" style={{ font: `${th.pesoTitular} ${120 * fs}px/1.02 ${th.titular}` }}>
              {titulo}
            </div>
          </Mascara>
          {r.sub && (
            <Mascara p={b}>
              <div data-campo="sub" style={{ font: `italic 400 68px/1.1 ${th.titular}`, color: "rgba(255,255,255,.92)" }}>
                {r.sub}
              </div>
            </Mascara>
          )}
        </div>
      );
    }
    case "letters": {
      // Mismo ritmo que el original (35 ms por carácter, espacios incluidos),
      // pero cada palabra en un bloque que no se parte.
      let k = 0;
      const trozos = titulo.split(/( )/u);
      return (
        <div
          style={{
            position: "absolute",
            left: 80,
            right: 80,
            bottom: 420,
            textAlign: "center",
            font: `italic 400 ${78 * fs}px/1.25 ${th.titular}`,
            color: "#fff",
            opacity: o,
            textShadow: "0 2px 24px rgba(0,0,0,.7)",
          }}
        >
          {ante(entrar(t, inicio + 0.3), { fontStyle: "normal", marginBottom: 24 })}
          <div data-campo="titulo">
            {trozos.map((trozo, j) => {
              const letras = [...trozo].map((ch) => {
                const p = entrar(t, inicio + 0.5 + k++ * 0.035, 0.6);
                return (
                  <span key={k} style={{ opacity: p, filter: `blur(${(1 - p) * 8}px)`, display: "inline-block", whiteSpace: "pre", transform: `translateY(${(1 - p) * 16}px)` }}>
                    {ch}
                  </span>
                );
              });
              return trozo === " " ? (
                <span key={`e${j}`}>{letras}</span>
              ) : (
                <span key={`p${j}`} style={{ display: "inline-block", whiteSpace: "nowrap" }}>
                  {letras}
                </span>
              );
            })}
          </div>
        </div>
      );
    }
    case "pill": {
      const pildora = saltar(t, inicio + 0.5, 0.6);
      const a = entrar(t, inicio + 0.8, 1.0);
      const b = entrar(t, inicio + 0.95, 1.0);
      const derecha = r.alinear !== "izquierda";
      const signo = derecha ? 1 : -1;
      return (
        <div
          style={{
            position: "absolute",
            left: 80,
            right: 80,
            bottom: 400,
            display: "flex",
            flexDirection: "column",
            alignItems: derecha ? "flex-end" : "flex-start",
            textAlign: derecha ? "right" : "left",
            color: "#fff",
            opacity: o,
          }}
        >
          <div
            data-campo="antetitulo"
            style={{
              transform: `scale(${pildora})`,
              transformOrigin: derecha ? "right center" : "left center",
              background: th.ctaFondo,
              color: th.ctaTexto,
              borderRadius: 9999,
              padding: "14px 34px",
              font: `600 28px ${th.texto}`,
              letterSpacing: ".18em",
              textTransform: "uppercase",
            }}
          >
            {r.antetitulo}
          </div>
          <div style={{ marginTop: 34, font: `${th.pesoTitular} ${112 * fs}px/1.04 ${th.titular}`, textShadow: sombra }}>
            <div data-campo="titulo" style={{ opacity: a, transform: `translateX(${signo * (1 - a) * 120}px)` }}>
              {titulo}
            </div>
            {r.sub && (
              <div data-campo="sub" style={{ opacity: b, transform: `translateX(${signo * (1 - b) * 120}px)`, fontStyle: "italic", fontWeight: 400 }}>
                {r.sub}
              </div>
            )}
          </div>
        </div>
      );
    }
    case "number": {
      const e = entrar(t, inicio + 0.5, 0.8);
      const cc = entrar(t, inicio + 1.4, 0.9);
      return (
        <div style={{ position: "absolute", left: 80, right: 80, top: 0, bottom: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", textAlign: "center", color: "#fff", opacity: o, textShadow: "0 4px 40px rgba(0,0,0,.55)" }}>
          {ante(e, { letterSpacing: ".5em", paddingLeft: ".5em" })}
          <div data-campo="titulo" style={{ display: "flex", font: `700 ${280 * fs}px/1 ${th.titular}`, color: th.oroClaro, marginTop: 10 }}>
            {[...titulo].map((d, k) => (
              <Mascara key={k} p={entrar(t, inicio + 0.6 + k * 0.12, 0.9)}>
                <span style={{ whiteSpace: "pre" }}>{d}</span>
              </Mascara>
            ))}
          </div>
          {r.sub && (
            <div data-campo="sub" style={{ marginTop: 20, font: `italic 400 60px ${th.titular}`, opacity: cc, transform: `translateY(${(1 - cc) * 24}px)` }}>
              {r.sub}
            </div>
          )}
        </div>
      );
    }
    case "label": {
      const barra = suavizar(t, inicio + 0.4, inicio + 1.2);
      const a = entrar(t, inicio + 0.7, 1.0);
      const b = entrar(t, inicio + 1.0, 1.0);
      return (
        <div style={{ position: "absolute", left: 80, right: 80, bottom: 400, display: "flex", gap: 30, color: "#fff", opacity: o, textShadow: sombra }}>
          <div style={{ width: 5, background: th.oro, transform: `scaleY(${barra})`, transformOrigin: "bottom", flex: "0 0 auto" }} />
          <div>
            {ante(entrar(t, inicio + 0.5), { marginBottom: 16 })}
            <Mascara p={a}>
              <div data-campo="titulo" style={{ font: `${th.pesoTitular} ${100 * fs}px/1.05 ${th.titular}` }}>
                {titulo}
              </div>
            </Mascara>
            {r.sub && (
              <div data-campo="sub" style={{ marginTop: 12, font: `400 36px ${th.texto}`, letterSpacing: ".08em", color: "rgba(255,255,255,.85)", opacity: b }}>
                {r.sub}
              </div>
            )}
          </div>
        </div>
      );
    }
  }
  return null;
}

// ── Cierre, marco y fundido final ────────────────────────────────────────────

function Cierre({ c }: { c: Ctx }) {
  const { t, tema: th } = c;
  const inicio = c.tiempos.inicioCierre;
  if (t < inicio) return null;
  const ci = c.reel.cierre;
  const velo = suavizar(t, inicio, inicio + 1.0);
  const a = entrar(t, inicio + 0.5, 1.2);
  const palabras = ci.frase.split(" ");
  const cta = saltar(t, inicio + 2.2, 0.7);
  const datos = entrar(t, inicio + 2.6, 0.8);
  const brillo = 0.5 + 0.5 * Math.sin(Math.max(0, t - inicio - 3) * 3);
  return (
    <div style={{ position: "absolute", inset: 0 }}>
      <div style={{ position: "absolute", inset: 0, background: `rgba(${th.velo},.74)`, opacity: velo }} />
      <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", textAlign: "center", padding: "0 110px" }}>
        <div style={{ opacity: a, transform: `scale(${0.9 + 0.1 * a})`, clipPath: `circle(${a * 75}% at 50% 40%)` }}>
          <Marca c={c} w={560} />
        </div>
        <div data-campo="frase" style={{ marginTop: 70, font: `italic 400 ${ci.tamanoFrase ?? 52}px/1.45 ${th.titular}`, color: "#fff", maxWidth: 860 }}>
          {palabras.map((w, k) => {
            const p = entrar(t, inicio + 1.1 + k * 0.08, 0.7);
            return (
              <span key={k} style={{ display: "inline-block", marginRight: ".28em", opacity: 0.15 + 0.85 * p, transform: `translateY(${(1 - p) * 18}px)` }}>
                {w}
              </span>
            );
          })}
        </div>
        <div
          data-campo="cta"
          style={{
            marginTop: 84,
            transform: `scale(${cta})`,
            display: "inline-flex",
            alignItems: "center",
            height: 124,
            padding: "0 86px",
            borderRadius: 9999,
            background: th.ctaFondo,
            color: th.ctaTexto,
            font: `${th.pesoTitular} 46px ${th.titular}`,
            boxShadow: `0 0 0 ${14 * brillo}px ${th.oro}40`,
          }}
        >
          {ci.cta}
        </div>
        <div data-campo="datos" style={{ marginTop: 44, opacity: datos, transform: `translateY(${(1 - datos) * 20}px)`, font: `400 32px ${th.texto}`, color: "rgba(255,255,255,.85)" }}>
          {ci.datos ?? DATOS_MARCA_REEL[c.reel.marca].datosCierre}
        </div>
      </div>
    </div>
  );
}

/** Marco oro y rótulo superior de Touza (Premium de reel-kit). */
function MarcoPremium({ c }: { c: Ctx }) {
  const { t, tema: th } = c;
  const total = c.tiempos.total;
  const d = suavizar(t, 0.4, 2.2);
  const fuera = 1 - suavizar(t, total - 1.2, total - 0.3);
  const linea = (st: CSSProperties) => <div style={{ position: "absolute", background: th.oro, opacity: 0.7 * fuera, ...st }} />;
  const rotulo = DATOS_MARCA_REEL[c.reel.marca].rotuloMarco;
  return (
    <>
      <div style={{ position: "absolute", inset: 0, background: "radial-gradient(ellipse 75% 60% at 50% 45%, rgba(0,0,0,0) 40%, rgba(0,0,0,.65) 100%)" }} />
      {linea({ left: 48, top: 48, width: (W - 96) * d, height: 1.5 })}
      {linea({ right: 48, bottom: 48, width: (W - 96) * d, height: 1.5 })}
      {linea({ left: 48, top: 48, width: 1.5, height: (H - 96) * d })}
      {linea({ right: 48, bottom: 48, width: 1.5, height: (H - 96) * d })}
      {rotulo && (
        <div
          data-campo="marco"
          style={{ position: "absolute", top: 92, left: 0, right: 0, textAlign: "center", font: `500 22px ${th.texto}`, letterSpacing: ".6em", paddingLeft: ".6em", color: th.oroClaro, opacity: entrar(t, 1.6, 1.2) * fuera }}
        >
          {rotulo}
        </div>
      )}
    </>
  );
}

function FundidoFinal({ c }: { c: Ctx }) {
  const total = c.tiempos.total;
  const p = suavizar(c.t, total - 0.6, total);
  return p > 0 ? <div style={{ position: "absolute", inset: 0, background: "#0A0A0A", opacity: p }} /> : null;
}

/** Recuadro de la zona segura de Instagram (220 arriba, 320 abajo, 64 a los lados). */
export function ZonaSeguraReel() {
  return (
    <div
      data-zona-segura=""
      style={{
        position: "absolute",
        left: ZONA_SEGURA_REEL.lados,
        right: ZONA_SEGURA_REEL.lados,
        top: ZONA_SEGURA_REEL.arriba,
        bottom: ZONA_SEGURA_REEL.abajo,
        border: "3px dashed rgba(255,0,120,.6)",
        pointerEvents: "none",
      }}
    />
  );
}

// ── API pública ──────────────────────────────────────────────────────────────

export interface OpcionesPintarReel {
  /** id de foto → URL. Por defecto, solo las muestras (crearResolverFotos). */
  urlFoto?: ResolverFoto;
  /** Base de fuentes, logos y muestras (por defecto "/instagram"). */
  baseRecursos?: string;
  /** Pinta el recuadro de la zona segura (solo vista previa, nunca en el MP4). */
  zonaSegura?: boolean;
  /** Mete un <style> con las @font-face (por defecto, sí). */
  incluirFuentes?: boolean;
  /** Rotula «Sin foto» en las escenas sin foto (por defecto, sí). */
  marcarHuecos?: boolean;
}

export interface ReelEnInstanteProps extends OpcionesPintarReel {
  reel: ReelPieza;
  /** Instante en segundos (se limita a [0, duración]). */
  t: number;
}

/** El lienzo 1080×1920 del reel en el instante t. Componente puro: mismo (reel, t) → mismo DOM. */
export function ReelEnInstante({ reel, t: tPedido, urlFoto, baseRecursos = "/instagram", zonaSegura = false, incluirFuentes = true, marcarHuecos = true }: ReelEnInstanteProps) {
  const tiempos = calcularTiempos(reel);
  const t = clamp(Number.isFinite(tPedido) ? tPedido : 0, 0, tiempos.total);
  const ci = reel.cierre;
  const planos: Plano[] = [
    ...reel.escenas,
    { id: "cierre", nombre: "Cierre", foto: ci.foto, encuadre: ci.encuadre, transicion: ci.transicion },
  ];
  const c: Ctx = {
    reel,
    t,
    tiempos,
    planos,
    tramos: [...tiempos.tramos, [tiempos.inicioCierre, tiempos.total]],
    tema: TEMAS_REEL[reel.marca],
    trIn: reel.transicion_s?.entrada ?? TRANSICION_POR_DEFECTO.entrada,
    trOut: reel.transicion_s?.salida ?? TRANSICION_POR_DEFECTO.salida,
    salida: reel.salidaRotulo_s ?? SALIDA_ROTULO_POR_DEFECTO,
    urlFoto: urlFoto ?? crearResolverFotos(baseRecursos),
    baseRecursos: baseRecursos.replace(/\/+$/, ""),
    marcarHuecos,
  };
  const apertura = suavizar(t, 0, 0.7);
  return (
    <div
      data-reel=""
      data-reel-t={t.toFixed(4)}
      style={{ position: "relative", width: W, height: H, background: "#0A0A0A", overflow: "hidden", fontKerning: "normal" }}
    >
      {incluirFuentes && <style>{cssFuentesReel(c.baseRecursos)}</style>}
      <div style={{ position: "absolute", inset: 0, opacity: apertura }}>
        {planos.map((pl, i) => (
          <Foto key={pl.id} c={c} i={i} />
        ))}
      </div>
      <div style={{ position: "absolute", inset: 0, background: "linear-gradient(180deg,rgba(0,0,0,.4) 0%,rgba(0,0,0,0) 24%,rgba(0,0,0,0) 45%,rgba(0,0,0,.75) 100%)" }} />
      <EfectosTransicion c={c} />
      {reel.marca === "touza" && <MarcoPremium c={c} />}
      {reel.escenas.map((e, i) => (
        <Rotulo key={e.id} c={c} i={i} />
      ))}
      <Cierre c={c} />
      <FundidoFinal c={c} />
      {zonaSegura && <ZonaSeguraReel />}
    </div>
  );
}

/**
 * Función pura para el render futuro: el reel en el instante t como elemento
 * React (renderToStaticMarkup, o montarlo y capturar). La fase 6 la llamará
 * con t = n / 30 para cada fotograma n.
 */
export function pintarReelEnInstante(reel: ReelPieza, t: number, opciones: OpcionesPintarReel = {}): ReactElement {
  return <ReelEnInstante reel={reel} t={t} {...opciones} />;
}
