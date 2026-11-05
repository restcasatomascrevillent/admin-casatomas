/**
 * Pestaña «Encargos» de Instagram (fase 4, maqueta «Encargos»): tablero por
 * columnas (Pedido, En curso, Para revisar, Aprobado, Publicado y, a
 * petición, Cancelados), filtro por marca, «Pedir un vídeo o una pieza» y la
 * ficha de cada encargo. Lo ven el restaurante (Marketing) y la agencia
 * (Instagram · Agencia); cada uno con sus botones. Regla del panel: sin
 * scroll de página; cada columna hace scroll por dentro.
 * Ver docs/instagram-encargos.md.
 */
import { useEffect, useMemo, useState } from "react";
import { Bell, Bot, CalendarDays, Clapperboard, Eye, Image as ImageIcon, Loader2, MessageSquare, Plus, Smartphone, UserRound } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { MarcaId } from "@/lib/instagram";
import { activarAvisosPush, pushDisponible } from "@/components/carta/potente/pushVideo";
import { mensajeErrorEncargo } from "./api";
import { FichaEncargo } from "./FichaEncargo";
import { FormularioEncargo } from "./FormularioEncargo";
import {
  CLASE_ESTADO,
  COLUMNA_CERRADOS,
  COLUMNAS,
  esperaA,
  fechaCorta,
  formularioDesdeEncargo,
  hoyMadrid,
  NOMBRE_ESTADO,
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
        "flex w-full flex-col gap-1 rounded-md border bg-background p-2 text-left text-xs shadow-sm transition-colors hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        meToca && "border-amber-400 ring-1 ring-amber-300",
      )}
    >
      {e.estado !== "para_revisar" && e.estado !== "aprobado" && e.estado !== "publicado" && (
        <span className={cn("w-fit rounded-full px-1.5 py-px text-[10px] font-medium", CLASE_ESTADO[e.estado])}>{NOMBRE_ESTADO[e.estado]}</span>
      )}
      {meToca && (
        <span className="flex items-center gap-1 font-medium text-amber-800">
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
        <span className="ml-auto font-mono text-[10px] text-muted-foreground">{referencia(e.numero)}</span>
      </span>
    </button>
  );
}

export function EncargosInstagram({ className, onAbrirPieza, encargoInicial = null }: EncargosInstagramProps) {
  const roles = useRolesEncargos();
  const { data: encargos = [], isLoading, error } = useEncargos(!roles.cargando && (roles.restaurante || roles.agencia));
  const { data: ajustes } = useAjustesEncargos();
  const [marca, setMarca] = useState<"todas" | MarcaId>("todas");
  const [verCancelados, setVerCancelados] = useState(false);
  const [abiertoId, setAbiertoId] = useState<string | null>(encargoInicial);
  const [formulario, setFormulario] = useState<{ abierto: boolean; inicial: { encargo: Encargo; datos: DatosFormulario } | null }>({ abierto: false, inicial: null });

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
          {(["todas", "casa-tomas", "touza"] as const).map((m) => (
            <Button key={m} type="button" size="sm" variant={marca === m ? "secondary" : "ghost"} aria-pressed={marca === m} className="h-7 px-2 text-xs" onClick={() => setMarca(m)}>
              {m === "todas" ? "Todas" : NOMBRE_MARCA[m]}
            </Button>
          ))}
          {cancelados > 0 && (
            <Button type="button" size="sm" variant={verCancelados ? "secondary" : "ghost"} aria-pressed={verCancelados} className="h-7 px-2 text-xs" onClick={() => setVerCancelados((v) => !v)}>
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
            <Button type="button" size="sm" onClick={() => setFormulario({ abierto: true, inicial: null })}>
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
      ) : (
        <div
          className={cn("grid min-h-0 flex-1 auto-cols-[minmax(14rem,1fr)] grid-flow-col gap-2 overflow-x-auto pb-1")}
          data-testid="tablero-encargos"
        >
          {columnas.map((c) => {
            const lista = visibles.filter((e) => c.estados.includes(e.estado));
            return (
              <section key={c.id} aria-label={c.nombre} className="flex min-h-0 flex-col rounded-md border bg-muted/30">
                <h3 className="flex shrink-0 items-center gap-1.5 border-b px-2 py-1.5 text-xs font-semibold">
                  <span className={cn("h-2 w-2 rounded-full", c.color)} aria-hidden="true" />
                  {c.nombre}
                  <span className="ml-auto rounded-full bg-background px-1.5 text-[10px] font-medium text-muted-foreground">{lista.length}</span>
                </h3>
                <ul className="min-h-0 flex-1 space-y-1.5 overflow-y-auto overscroll-contain p-1.5">
                  {lista.map((e) => (
                    <li key={e.id}>
                      <Tarjeta e={e} roles={roles} onAbrir={() => setAbiertoId(e.id)} />
                    </li>
                  ))}
                  {lista.length === 0 && <li className="p-2 text-center text-[11px] text-muted-foreground">Nada aquí</li>}
                </ul>
              </section>
            );
          })}
        </div>
      )}

      {encargos.length === 0 && !isLoading && !error && roles.restaurante && (
        <p className="flex shrink-0 items-center gap-1 text-xs text-muted-foreground">
          <MessageSquare className="h-3.5 w-3.5" aria-hidden="true" />
          Pide aquí cualquier pieza o vídeo: automático con una plantilla o hecho a mano por Oficiosos.
        </p>
      )}

      <FichaEncargo encargo={abierto} roles={roles} onCerrar={() => setAbiertoId(null)} onEditar={editar} onAbrirPieza={onAbrirPieza} />
      {/* Solo montado al abrirlo: así no carga la biblioteca de Drive si no se pide nada. */}
      {roles.restaurante && formulario.abierto && (
        <FormularioEncargo
          abierto={formulario.abierto}
          onAbierto={(v) => setFormulario((f) => ({ ...f, abierto: v }))}
          inicial={formulario.inicial}
          ajustes={ajustes ?? { plazo_dias_laborables: 5, rondas_incluidas: 2, cupo_mensual: null }}
          onHecho={(id) => setAbiertoId(id)}
        />
      )}
    </div>
  );
}
