import type { ReactNode } from "react";
import { AlertTriangle, Info } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { TiraCifras } from "@/components/panel/TiraCifras";
import { EstadoErrorCarga } from "@/components/EstadoErrorCarga";
import { esSinMigracionLogs, useComportamiento, type Comportamiento, type Entorno } from "@/hooks/useLogsWeb";
import { useSerieTrafico } from "@/hooks/useTraficoWeb";
import { fmtDecimal1, fmtNumero, fmtPct, SIN_DATOS } from "../formato";
import {
  DEFINICIONES,
  DIAS_SEMANA_CORTOS,
  etapasEmbudo,
  NOMBRE_CONTACTO,
  NOMBRE_CONTENIDO,
  NOMBRE_DISPOSITIVO,
  NOMBRE_OPERACION,
  NOMBRE_ORIGEN,
  SESIONES_MINIMAS_FIABLES,
  tasa,
  variacion,
} from "./definiciones";

/** Etiqueta con la definición de la métrica en un tooltip (la misma en todas las pantallas). */
function Def({ children, definicion }: { children: ReactNode; definicion: string }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="inline-flex cursor-help items-center gap-1 underline decoration-dotted underline-offset-2">
          {children}
          <Info className="h-3 w-3 text-muted-foreground" aria-hidden />
        </span>
      </TooltipTrigger>
      <TooltipContent className="max-w-xs text-xs">{definicion}</TooltipContent>
    </Tooltip>
  );
}

const delta = (a: number | null | undefined, b: number | null | undefined) => {
  const v = variacion(a, b);
  return v === null ? "vs anterior sin datos" : `vs anterior ${fmtPct(v, true)}`;
};

interface FilaBarra {
  clave: string;
  etiqueta: ReactNode;
  valor: number;
  detalle?: ReactNode;
}

function Barras({ filas, vacio = SIN_DATOS }: { filas: FilaBarra[]; vacio?: string }) {
  if (!filas.length) return <p className="py-3 text-center text-sm italic text-muted-foreground">{vacio}</p>;
  const max = Math.max(...filas.map((f) => f.valor), 1);
  return (
    <ul className="space-y-2.5">
      {filas.map((f) => (
        <li key={f.clave} className="text-xs">
          <div className="flex items-baseline justify-between gap-2">
            <span className="min-w-0 truncate" title={typeof f.etiqueta === "string" ? f.etiqueta : undefined}>{f.etiqueta}</span>
            <span className="shrink-0 tabular-nums text-muted-foreground">
              <span className="text-foreground">{fmtNumero(f.valor)}</span>
              {f.detalle ? <> · {f.detalle}</> : null}
            </span>
          </div>
          <div className="mt-1 h-1.5 w-full rounded-full bg-muted" aria-hidden>
            <div className="h-1.5 rounded-full" style={{ width: `${(100 * f.valor) / max}%`, background: "var(--viz-1)" }} />
          </div>
        </li>
      ))}
    </ul>
  );
}

function Bloque({ titulo, definicion, children, className }: { titulo: string; definicion?: string; children: ReactNode; className?: string }) {
  return (
    <Card variante="plana" className={className}>
      <CardHeader className="px-0 pb-2">
        <CardTitle className="text-sm font-medium">{definicion ? <Def definicion={definicion}>{titulo}</Def> : titulo}</CardTitle>
      </CardHeader>
      <CardContent className="px-0">{children}</CardContent>
    </Card>
  );
}

function Embudos({ c }: { c: Comportamiento }) {
  return (
    <div className="grid gap-4 md:grid-cols-2">
      {c.embudos.map((e) => {
        const etapas = etapasEmbudo(e, e.operacion);
        const abandono = Math.max(e.inicio - e.fin, 0);
        return (
          <Bloque key={e.operacion} titulo={`Embudo · ${NOMBRE_OPERACION[e.operacion] ?? e.operacion}`} definicion={DEFINICIONES.embudo}>
            <ol className="space-y-2" data-testid={`embudo-${e.operacion}`}>
              {etapas.map((et) => (
                <li key={et.clave} className="text-xs">
                  <div className="flex items-baseline justify-between gap-2">
                    <span>{et.etiqueta}</span>
                    <span className="tabular-nums">
                      <span className="font-medium">{fmtNumero(et.valor)}</span>
                      {et.pasoPct !== null && <span className="text-muted-foreground"> · {fmtPct(et.pasoPct)} del paso anterior</span>}
                    </span>
                  </div>
                  <div className="mt-1 h-2 w-full rounded bg-muted" aria-hidden>
                    <div className="h-2 rounded" style={{ width: `${e.entrada ? (100 * et.valor) / e.entrada : 0}%`, background: et.clave === "fin" ? "var(--viz-2, var(--viz-1))" : "var(--viz-1)" }} />
                  </div>
                </li>
              ))}
            </ol>
            <p className="mt-2 text-xs text-muted-foreground">
              Conversión {fmtPct(tasa(e.fin, e.entrada))} de las sesiones ·{" "}
              <Def definicion={DEFINICIONES.abandono}>abandono estimado {fmtNumero(abandono)}</Def>
              {e.operacion === "reserva" && e.rechazos > 0 && ` · ${e.rechazos} rechazos del servidor`}
            </p>
          </Bloque>
        );
      })}
    </div>
  );
}

function Horas({ c }: { c: Comportamiento }) {
  const max = Math.max(...c.horas.map((h) => h.sesiones), 1);
  const maxDia = Math.max(...c.dias_semana.map((d) => d.sesiones), 1);
  return (
    <Bloque titulo="Franjas horarias (hora de Madrid)">
      <div className="flex h-24 items-end gap-[2px]" role="img" aria-label="Sesiones por hora del día">
        {c.horas.map((h) => (
          <div key={h.hora} className="flex h-full flex-1 flex-col items-center justify-end" title={`${h.hora}:00 · ${h.sesiones} sesiones`}>
            <div className="w-full rounded-t-sm" style={{ height: `${(100 * h.sesiones) / max}%`, minHeight: h.sesiones ? 2 : 0, background: "var(--viz-1)" }} />
          </div>
        ))}
      </div>
      <div className="mt-1 flex justify-between text-[10px] text-muted-foreground"><span>0 h</span><span>6 h</span><span>12 h</span><span>18 h</span><span>23 h</span></div>
      <div className="mt-3 grid grid-cols-7 gap-1 text-center text-[10px]">
        {c.dias_semana.map((d) => (
          <div key={d.dia} title={`${d.sesiones} sesiones`}>
            <div className="mx-auto h-8 w-full rounded-sm" style={{ opacity: 0.15 + (0.85 * d.sesiones) / maxDia, background: "var(--viz-1)" }} />
            <span className="text-muted-foreground">{DIAS_SEMANA_CORTOS[d.dia - 1]} · {d.sesiones}</span>
          </div>
        ))}
      </div>
    </Bloque>
  );
}

export interface ComportamientoWebProps {
  desde: string;
  hasta: string;
  entorno: Entorno;
  incluirInternos?: boolean;
  /** Para Tráfico web: un aviso más corto arriba. */
  contexto?: "trafico" | "logs";
}

/**
 * Estadísticas de comportamiento de un periodo (RPC web_comportamiento). La
 * cobertura se compara con las visitas de Vercel del mismo periodo (la misma
 * consulta que la serie de Tráfico web).
 */
export function ComportamientoWeb({ desde, hasta, entorno, incluirInternos = false, contexto = "logs" }: ComportamientoWebProps) {
  const q = useComportamiento(desde, hasta, entorno, incluirInternos);
  const vercel = useSerieTrafico("casa-tomas-story", desde, hasta);

  if (q.isError) {
    if (esSinMigracionLogs(q.error)) {
      return <p role="alert" className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950">Falta aplicar la migración de Logs (20261118100000_logs_web) para ver el comportamiento.</p>;
    }
    return <EstadoErrorCarga titulo="el comportamiento de los visitantes" error={q.error} onReintentar={() => q.refetch()} />;
  }
  if (q.isLoading || !q.data) {
    return <div className="space-y-3"><Skeleton className="h-16" /><Skeleton className="h-48" /></div>;
  }
  const c = q.data;
  const r = c.resumen;
  const a = c.anterior;
  // Sin días con dato de Vercel (p. ej. «hoy», que Vercel aún no ha cerrado) es «sin datos», no 0.
  const diasVercel = (vercel.data ?? []).filter((f) => f.visitas !== null && f.visitas !== undefined);
  const visitasVercel = diasVercel.length ? diasVercel.reduce((s, f) => s + (f.visitas ?? 0), 0) : null;
  const cobertura = tasa(r.paginas_vistas, visitasVercel);
  const pocas = r.sesiones < SESIONES_MINIMAS_FIABLES;

  if (r.sesiones === 0) {
    return (
      <div className="space-y-2 text-sm text-muted-foreground" data-testid="comportamiento-vacio">
        <p>No hay sesiones con consentimiento entre el {desde} y el {hasta} ({c.periodo.zona}).</p>
        <p className="text-xs">
          {c.datos_desde ? `Hay datos desde el ${new Date(c.datos_desde).toLocaleDateString("es-ES")}.` : "Todavía no ha llegado ninguna sesión: los datos empiezan con la primera visita que acepte «Estadísticas» tras publicar la web con el rastreador."}
          {" "}{DEFINICIONES.sesiones}
        </p>
      </div>
    );
  }

  const contenidosPorTipo = Object.entries(NOMBRE_CONTENIDO)
    .map(([tipo, nombre]) => ({ tipo, nombre, filas: c.contenidos.filter((x) => x.tipo === tipo) }))
    .filter((g) => g.filas.length > 0);

  return (
    <div className="space-y-5" data-testid="comportamiento-web">
      <div className="space-y-1">
        <TiraCifras
          cifras={[
            { etiqueta: "Sesiones", valor: fmtNumero(r.sesiones), detalle: delta(r.sesiones, a.sesiones) },
            { etiqueta: "Visitantes estimados", valor: fmtNumero(r.visitantes_estimados), detalle: "navegadores, no personas" },
            { etiqueta: "Páginas por sesión", valor: fmtDecimal1(r.paginas_por_sesion), detalle: delta(r.paginas_por_sesion, a.paginas_por_sesion) },
            { etiqueta: "Tiempo activo (mediana)", valor: r.tiempo_activo_mediana_s == null ? SIN_DATOS : `${fmtDecimal1(r.tiempo_activo_mediana_s)} s`, detalle: delta(r.tiempo_activo_mediana_s, a.tiempo_activo_mediana_s) },
            { etiqueta: "Conversiones", valor: fmtNumero(r.conversiones), detalle: `${fmtPct(tasa(r.sesiones_con_conversion, r.sesiones))} de sesiones · ${delta(r.conversiones, a.conversiones)}` },
            { etiqueta: "Sesiones con error", valor: fmtNumero(r.sesiones_con_error), tono: r.sesiones_con_error > 0 ? "ambar" : undefined, detalle: fmtPct(tasa(r.sesiones_con_error, r.sesiones)) },
          ]}
        />
        <p className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
          <Def definicion={DEFINICIONES.cobertura}>
            Cobertura: {fmtNumero(r.paginas_vistas)} páginas vistas con consentimiento de {fmtNumero(visitasVercel)} en Vercel ({fmtPct(cobertura)})
          </Def>
          <Def definicion={DEFINICIONES.visitantes}>¿Visitantes?</Def>
          <Def definicion={DEFINICIONES.excluido}>
            Excluidas: {c.excluidas.bots} de bots · {c.excluidas.internas_pruebas} internas o de prueba{c.excluidas.incluidas_internas ? " (incluidas)" : ""}
          </Def>
          <span>Periodo anterior: {a.sesiones} sesiones · hora de Madrid</span>
        </p>
        {pocas && (
          <p className="flex items-center gap-1.5 text-xs text-amber-700 dark:text-amber-400">
            <AlertTriangle className="h-3.5 w-3.5" aria-hidden /> Muestra pequeña ({r.sesiones} sesiones): orientativo, sin tendencias.
          </p>
        )}
        {contexto === "trafico" && (
          <p className="text-xs text-muted-foreground">{DEFINICIONES.sesiones}</p>
        )}
      </div>

      <Embudos c={c} />
      <p className="-mt-3 text-xs text-muted-foreground">
        <Def definicion={DEFINICIONES.operacionesBd}>
          Referencia de la base de datos (todos los visitantes): {c.operaciones_bd.reservas_web} solicitudes de reserva web ·{" "}
          {c.operaciones_bd.reservas_confirmadas} confirmadas por el restaurante · {c.operaciones_bd.cheques_web} cheques pagados
        </Def>
      </p>

      <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
        <Bloque titulo="Páginas más vistas">
          <Barras filas={c.paginas.slice(0, 8).map((p) => ({ clave: p.ruta, etiqueta: p.ruta, valor: p.vistas, detalle: `${fmtDecimal1(p.tiempo_medio_s)} s · scroll ${fmtDecimal1(p.scroll_medio)} %` }))} />
        </Bloque>
        {contenidosPorTipo.slice(0, 4).map((g) => (
          <Bloque key={g.tipo} titulo={`${g.nombre} con más interés`}>
            <Barras filas={g.filas.slice(0, 6).map((f) => ({ clave: f.objetivo, etiqueta: f.objetivo, valor: f.n, detalle: `${f.sesiones} ses.` }))} />
          </Bloque>
        ))}
        <Bloque titulo="Botones y enlaces más usados">
          <Barras filas={c.clics.slice(0, 8).map((f) => ({ clave: `${f.tipo}-${f.objetivo}-${f.accion}`, etiqueta: f.tipo === "contacto" ? `${NOMBRE_CONTACTO[f.accion ?? ""] ?? f.accion}: ${f.objetivo}` : f.objetivo, valor: f.n, detalle: `${f.sesiones} ses.` }))} />
        </Bloque>
        <Bloque titulo="Contacto (clics, no llamadas confirmadas)">
          <Barras filas={c.contactos.map((f) => ({ clave: f.accion, etiqueta: NOMBRE_CONTACTO[f.accion] ?? f.accion, valor: f.n, detalle: `${f.sesiones} ses.` }))} />
        </Bloque>
        <Bloque titulo="Procedencia" definicion={DEFINICIONES.procedencia}>
          <Barras filas={c.origenes.map((o) => ({ clave: o.origen_tipo, etiqueta: NOMBRE_ORIGEN[o.origen_tipo] ?? o.origen_tipo, valor: o.sesiones, detalle: `${fmtPct(tasa(o.sesiones_con_conversion, o.sesiones))} convierte` }))} />
        </Bloque>
        <Bloque titulo="Campañas y QR identificables">
          <Barras
            vacio="Ninguna visita con ?qr= o utm_* en el periodo"
            filas={c.campanas.filter((x) => x.origen_tipo === "campana" || x.origen_tipo === "qr").map((x) => ({
              clave: `${x.origen_tipo}-${x.nombre}`, etiqueta: `${NOMBRE_ORIGEN[x.origen_tipo]}: ${x.nombre ?? "(sin nombre)"}`, valor: x.sesiones,
              detalle: `${x.inicios} inicios · ${x.sesiones_con_conversion} conv.`,
            }))}
          />
        </Bloque>
        <Bloque titulo="Dispositivos">
          <Barras filas={c.dispositivos.map((d) => ({ clave: d.dispositivo, etiqueta: NOMBRE_DISPOSITIVO[d.dispositivo] ?? d.dispositivo, valor: d.sesiones, detalle: `${fmtPct(tasa(d.sesiones_con_conversion, d.sesiones))} convierte` }))} />
        </Bloque>
        <Horas c={c} />
        <Bloque titulo="Tiempo de actividad por sesión" definicion={DEFINICIONES.tiempoActivo}>
          <Barras filas={[
            { clave: "a", etiqueta: "Menos de 10 s", valor: c.tiempo.menos_10s },
            { clave: "b", etiqueta: "10 s – 1 min", valor: c.tiempo.de_10s_a_1m },
            { clave: "c", etiqueta: "1 – 3 min", valor: c.tiempo.de_1m_a_3m },
            { clave: "d", etiqueta: "Más de 3 min", valor: c.tiempo.mas_3m },
          ]} />
        </Bloque>
        <Bloque titulo="Profundidad de scroll por página vista" definicion={DEFINICIONES.scroll}>
          <Barras filas={[
            { clave: "a", etiqueta: "Menos del 25 %", valor: c.scroll.hasta_25 },
            { clave: "b", etiqueta: "25 – 50 %", valor: c.scroll.de_25_a_50 },
            { clave: "c", etiqueta: "50 – 75 %", valor: c.scroll.de_50_a_75 },
            { clave: "d", etiqueta: "75 – 100 %", valor: c.scroll.de_75_a_100 },
          ]} />
        </Bloque>
        <Bloque titulo="Recorridos frecuentes (3 primeras páginas)">
          <Barras filas={c.recorridos.map((x) => ({ clave: x.recorrido, etiqueta: x.recorrido, valor: x.sesiones }))} />
        </Bloque>
        <Bloque titulo="Últimas páginas observadas" definicion={DEFINICIONES.ultimaPagina}>
          <Barras filas={c.ultimas_paginas.map((x) => ({ clave: x.ruta, etiqueta: x.ruta, valor: x.sesiones }))} />
        </Bloque>
        <Bloque titulo="Búsquedas y filtros de la carta">
          <p className="mb-2 text-xs text-muted-foreground">
            {c.busquedas.total} búsquedas en {c.busquedas.sesiones} sesiones · {c.busquedas.sin_resultados} sin resultados (el texto buscado no se guarda)
          </p>
          <Barras filas={c.filtros.slice(0, 6).map((f) => ({ clave: `${f.objetivo}-${f.accion}`, etiqueta: f.objetivo, valor: f.n }))} />
        </Bloque>
        <Bloque titulo="Errores por página">
          <Barras vacio="Sin errores en las sesiones del periodo" filas={c.errores_por_ruta.slice(0, 8).map((e) => ({ clave: `${e.ruta}-${e.tipo}`, etiqueta: `${e.ruta} · ${e.tipo.replace("error_", "")}`, valor: e.n, detalle: `${e.sesiones} ses.` }))} />
        </Bloque>
        <Bloque titulo="Errores por operación">
          <Barras vacio="Sin peticiones fallidas ni rechazos" filas={c.errores_por_operacion.map((e) => ({ clave: e.operacion, etiqueta: e.operacion, valor: e.n, detalle: `${e.sesiones} ses.` }))} />
        </Bloque>
        <Bloque titulo="Formularios">
          <Barras filas={c.formularios.map((f) => ({ clave: f.objetivo, etiqueta: f.objetivo, valor: f.inicios, detalle: `${f.envios} envíos · ${f.abandonos} abandonos est. · ${f.errores_validacion} errores de validación` }))} />
        </Bloque>
      </div>
    </div>
  );
}
