/**
 * Pestaña «Encargos» de Instagram (fase 4, maqueta «Encargos»): tablero por
 * columnas (Pedido, En curso, Para revisar, Aprobado, Publicado y, a
 * petición, Cancelados), filtro por marca, «Pedir un vídeo o una pieza» y la
 * ficha de cada encargo. Lo ven el restaurante (Marketing) y la agencia
 * (Instagram · Agencia); cada uno con sus botones. Regla del panel: sin
 * scroll de página; cada columna hace scroll por dentro.
 * Ver docs/instagram-encargos.md.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { Bell, Bot, CalendarDays, Clapperboard, Eye, Image as ImageIcon, Loader2, MessageSquare, Plus, Smartphone, UserRound } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { InsigniaEstado } from "@/components/instagram/InsigniaEstado";
import { cn } from "@/lib/utils";
import type { MarcaId } from "@/lib/instagram";
import { activarAvisosPush, pushDisponible } from "@/components/carta/potente/pushVideo";
import { mensajeErrorEncargo } from "./api";
import { FichaEncargo } from "./FichaEncargo";
import { FormularioEncargo } from "./FormularioEncargo";
import {
  COLUMNA_CERRADOS,
  COLUMNAS,
  esperaA,
  fechaCorta,
  formularioDesdeEncargo,
  hoyMadrid,
  NOMBRE_MARCA,
  NOMBRE_MODO,
  pendientes,
  referencia,
  type AdjuntoEncargo,
  type DatosFormulario,
  type Encargo,
} from "./logica";
import { useAjustesEncargos, useEncargos, useRolesEncargos } from "./useEncargos";

const ICONO_FORMATO = { reel: Clapperboard, post: ImageIcon, story: Smartphone } as const;

export interface EncargosInstagramProps {
  className?: string;
  /** Abre una pieza automática de imagen en «Crear». */
  onAbrirPieza?: (piezaId: string) => void;
  /** Encargo que se abre al entrar (?encargo=<id>, p. ej. desde una notificación). */
  encargoInicial?: string | null;
  /**
   * Marca de la barra de pestañas de la página. Si se pasa, manda ella y no se
   * enseñan los botones de marca propios de la pestaña.
   */
  marca?: MarcaId | "todas";
  /** Abre «Pedir un vídeo o una pieza» (cada `clave` nueva), con datos de partida si los hay. */
  pedir?: { clave: number; datos?: Partial<DatosFormulario> } | null;
}

function Tarjeta({ e, onAbrir, roles }: { e: Encargo; onAbrir: () => void; roles: { restaurante: boolean; agencia: boolean } }) {
  const Icono = ICONO_FORMATO[e.formato];
  const espera = esperaA(e);
  const meToca = (espera === "restaurante" && roles.restaurante) || (espera === "agencia" && roles.agencia);
  const retrasado = !!e.fecha_deseada && e.fecha_deseada < hoyMadrid() && !["aprobado", "publicado", "cancelado"].includes(e.estado);
  return (
    <button
      type="button"
      onClick={onAbrir}
      data-testid="tarjeta-encargo"
      data-estado={e.estado}
      className={cn(
        "flex w-full flex-col gap-1 rounded-lg border bg-background p-2 text-left text-xs shadow-sm transition-colors hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        meToca && "border-[rgb(231_176_8/0.7)] shadow-[inset_3px_0_0_#e7b008]",
      )}
    >
      {e.estado !== "para_revisar" && e.estado !== "aprobado" && e.estado !== "publicado" && (
        <InsigniaEstado dominio="encargo" estado={e.estado} className="w-fit" />
      )}
      {meToca && (
        <span className="flex items-center gap-1 font-semibold text-[#5c4500]">
          <Eye className="h-3 w-3" aria-hidden="true" />
          {espera === "restaurante" ? (e.estado === "rechazado" ? "Revisa el motivo" : "Te toca revisarlo") : "Esperando a Oficiosos"}
        </span>
      )}
      <strong className="line-clamp-2 text-sm">{e.titulo}</strong>
      <span className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-muted-foreground">
        <span>{NOMBRE_MARCA[e.marca]}</span>·
        <span className="inline-flex items-center gap-0.5">
          <Icono className="h-3 w-3" aria-hidden="true" />
          {e.formato === "reel" ? "Vídeo" : e.formato === "post" ? "Post" : "Story"}
        </span>
        ·
        <span className="inline-flex items-center gap-0.5">
          {e.modo === "automatico" ? <Bot className="h-3 w-3" aria-hidden="true" /> : <UserRound className="h-3 w-3" aria-hidden="true" />}
          {NOMBRE_MODO[e.modo]}
        </span>
      </span>
      <span className={cn("inline-flex items-center gap-1", retrasado ? "font-medium text-red-700" : "text-muted-foreground")}>
        <CalendarDays className="h-3 w-3" aria-hidden="true" />
        {e.estado === "publicado" ? "Publicado" : `Para el ${fechaCorta(e.fecha_deseada)}`}
        {retrasado && " · con retraso"}
        <span className="ml-auto font-mono text-xs text-muted-foreground">{referencia(e.numero)}</span>
      </span>
    </button>
  );
}

export function EncargosInstagram({ className, onAbrirPieza, encargoInicial = null, marca: marcaPagina, pedir = null }: EncargosInstagramProps) {
  const roles = useRolesEncargos();
  const { data: encargos = [], isLoading, error } = useEncargos(!roles.cargando && (roles.restaurante || roles.agencia));
  const { data: ajustes } = useAjustesEncargos();
  const [marcaPropia, setMarca] = useState<"todas" | MarcaId>("todas");
  const marca = marcaPagina ?? marcaPropia;
  const [verCancelados, setVerCancelados] = useState(false);
  const [abiertoId, setAbiertoId] = useState<string | null>(encargoInicial);
  const [formulario, setFormulario] = useState<{
    abierto: boolean;
    inicial: { encargo: Encargo; datos: DatosFormulario } | null;
    datos?: Partial<DatosFormulario> | null;
  }>({ abierto: false, inicial: null });

  // «Pedir un vídeo o una pieza» desde fuera (Estudio, Campañas).
  const clavePedir = useRef<number | null>(null);
  useEffect(() => {
    if (!pedir || clavePedir.current === pedir.clave) return;
    clavePedir.current = pedir.clave;
    setFormulario({ abierto: true, inicial: null, datos: pedir.datos ?? null });
  }, [pedir]);

  useEffect(() => {
    if (encargoInicial) setAbiertoId(encargoInicial);
  }, [encargoInicial]);

  const visibles = useMemo(() => encargos.filter((e) => marca === "todas" || e.marca === marca), [encargos, marca]);
  const columnas = verCancelados ? [...COLUMNAS, COLUMNA_CERRADOS] : COLUMNAS;
  const abierto = encargos.find((e) => e.id === abiertoId) ?? null;
  const mes = hoyMadrid().slice(0, 7);
  const delMes = encargos.filter((e) => (e.enviado_at ?? e.created_at).slice(0, 7) === mes && e.estado !== "borrador").length;
  const esperan = pendientes(encargos, roles);
  const cancelados = encargos.filter((e) => e.estado === "cancelado").length;

  const editar = (e: Encargo, adjuntos: AdjuntoEncargo[]) => {
    setAbiertoId(null);
    setFormulario({ abierto: true, inicial: { encargo: e, datos: formularioDesdeEncargo(e, adjuntos) } });
  };

  async function avisarme() {
    const r = await activarAvisosPush();
    if (r.ok) toast.success("Avisos activados en este dispositivo");
    else toast.error("No se pudieron activar los avisos", { description: "motivo" in r ? r.motivo : undefined });
  }

  if (!roles.cargando && !roles.restaurante && !roles.agencia) {
    return <p className="p-4 text-sm text-muted-foreground">No tienes permiso para ver los encargos de Instagram.</p>;
  }

  return (
    <div className={cn("flex h-full min-h-0 flex-col gap-2", className)} data-testid="encargos-instagram">
      <div className="flex shrink-0 flex-wrap items-center gap-2">
        <p className="text-sm text-muted-foreground" data-testid="resumen-encargos">
          <b className="text-foreground">{delMes}</b> {delMes === 1 ? "encargo" : "encargos"} este mes · <b className="text-foreground">{esperan}</b>{" "}
          {esperan === 1 ? "espera" : "esperan"} {roles.agencia && !roles.restaurante ? "a Oficiosos" : "tu revisión"}
        </p>
        <div role="group" aria-label="Marca" className="flex gap-1">
          {(marcaPagina ? [] : (["todas", "casa-tomas", "touza"] as const)).map((m) => (
            <Button key={m} type="button" size="sm" variant={marca === m ? "secondary" : "ghost"} aria-pressed={marca === m} className="h-8 px-2 text-xs" onClick={() => setMarca(m)}>
              {m === "todas" ? "Todas" : NOMBRE_MARCA[m]}
            </Button>
          ))}
          {cancelados > 0 && (
            <Button type="button" size="sm" variant={verCancelados ? "secondary" : "ghost"} aria-pressed={verCancelados} className="h-8 px-2 text-xs" onClick={() => setVerCancelados((v) => !v)}>
              Cancelados ({cancelados})
            </Button>
          )}
        </div>
        <div className="ml-auto flex gap-2">
          {"ok" in pushDisponible() && (
            <Button type="button" size="sm" variant="ghost" onClick={() => void avisarme()} title="Recibe un aviso en este dispositivo en cada cambio">
              <Bell className="mr-1 h-4 w-4" aria-hidden="true" />
              Avisarme
            </Button>
          )}
          {roles.restaurante && (
            <Button type="button" size="sm" onClick={() => setFormulario({ abierto: true, inicial: null, datos: null })}>
              <Plus className="mr-1 h-4 w-4" aria-hidden="true" />
              Pedir un vídeo o una pieza
            </Button>
          )}
        </div>
      </div>

      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {mensajeErrorEncargo(error)}
        </p>
      ) : isLoading || roles.cargando ? (
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" aria-label="Cargando" />
      ) : encargos.length === 0 && roles.restaurante ? (
        <div className="flex min-h-0 flex-1 items-center justify-center p-4" data-testid="encargos-vacio">
          <div className="max-w-sm space-y-3 rounded-xl border border-dashed bg-card p-6 text-center">
            <MessageSquare className="mx-auto h-6 w-6 text-muted-foreground" aria-hidden="true" />
            <p className="font-medium">Pide tu primer vídeo o pieza</p>
            <p className="text-sm text-muted-foreground">Automático con una plantilla o hecho a mano por Oficiosos. Aquí verás en qué punto está cada encargo.</p>
            <Button type="button" onClick={() => setFormulario({ abierto: true, inicial: null, datos: null })}>
              <Plus className="mr-1 h-4 w-4" aria-hidden="true" />
              Pedir un vídeo o una pieza
            </Button>
          </div>
        </div>
      ) : (
        <div
          className={cn("grid min-h-0 flex-1 auto-cols-[minmax(10.75rem,1fr)] xl:auto-cols-[minmax(11.5rem,1fr)] grid-flow-col gap-2 overflow-x-auto pb-1")}
          data-testid="tablero-encargos"
        >
          {columnas.map((c) => {
            const lista = visibles.filter((e) => c.estados.includes(e.estado));
            return (
              <section key={c.id} aria-label={c.nombre} className="flex min-h-0 flex-col rounded-md border bg-muted/30">
                <h3 className="flex shrink-0 items-center gap-1.5 border-b px-2 py-1.5 text-xs font-semibold">
                  <span className={cn("h-2 w-2 rounded-full", c.color)} aria-hidden="true" />
                  {c.nombre}
                  <span className="ml-auto rounded-full bg-background px-1.5 text-xs font-medium text-muted-foreground">{lista.length}</span>
                </h3>
                <ul className="min-h-0 flex-1 space-y-1.5 overflow-y-auto overscroll-contain p-1.5">
                  {lista.map((e) => (
                    <li key={e.id}>
                      <Tarjeta e={e} roles={roles} onAbrir={() => setAbiertoId(e.id)} />
                    </li>
                  ))}
                  {lista.length === 0 && <li className="p-2 text-center text-xs text-muted-foreground">Nada aquí</li>}
                </ul>
              </section>
            );
          })}
        </div>
      )}


      <FichaEncargo encargo={abierto} roles={roles} onCerrar={() => setAbiertoId(null)} onEditar={editar} onAbrirPieza={onAbrirPieza} />
      {/* Solo montado al abrirlo: así no carga la biblioteca de Drive si no se pide nada. */}
      {roles.restaurante && formulario.abierto && (
        <FormularioEncargo
          abierto={formulario.abierto}
          onAbierto={(v) => setFormulario((f) => ({ ...f, abierto: v }))}
          inicial={formulario.inicial}
          datosIniciales={formulario.datos ?? null}
          ajustes={ajustes ?? { plazo_dias_laborables: 5, rondas_incluidas: 2, cupo_mensual: null }}
          onHecho={(id) => setAbiertoId(id)}
        />
      )}
    </div>
  );
}
