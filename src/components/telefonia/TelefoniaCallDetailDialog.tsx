import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Bot, User, Euro, Info, ListFilter, ExternalLink, SquarePen } from "lucide-react";
import { format } from "date-fns";
import { es } from "date-fns/locale";
import { Link } from "react-router-dom";
import { useCanAccessSection } from "@/hooks/useUserRole";
import { useEdicionReserva } from "@/hooks/useEdicionReserva";

interface CallLog {
    id: string;
    started_at: string;
    caller_number?: string | null;
    call_type?: "bot" | "human" | null;
    status?: string | null;
    duration_seconds?: number | null;
    summary?: string | null;
    ended_reason?: string | null;
    cost_total_eur?: number | null;
    cost_breakdown?: Record<string, any> | null;
    tool_calls?: Array<{ tool: string; params?: any; result?: any; timestamp?: string }> | null;
    structured_data?: Record<string, any> | null;
    reserva_id?: string | null;
}

interface Props {
    call: CallLog | null;
    onClose: () => void;
}

const ENDED_REASON_LABELS: Record<string, { label: string; className: string }> = {
    "customer-ended-call": { label: "Cliente colgó", className: "bg-muted text-muted-foreground" },
    "assistant-ended-call": {
        label: "Bot despidió",
        className: "bg-sky-500/10 text-sky-600 border-sky-500/20",
    },
    "silence-timed-out": {
        label: "Silencio",
        className: "bg-amber-500/10 text-amber-600 border-amber-500/20",
    },
    "pipeline-error": {
        label: "Error pipeline",
        className: "bg-rose-500/10 text-rose-600 border-rose-500/20",
    },
    "assistant-request-returned-error": {
        label: "Webhook devolvió error",
        className: "bg-rose-500/10 text-rose-600 border-rose-500/20",
    },
};

const COST_COMPONENT_LABELS: Record<string, string> = {
    model: "Modelo IA",
    transcriber: "Transcripción",
    voice: "Voz (ElevenLabs)",
    vapi: "VAPI",
    telephony: "Telefonía",
};

function formatDuration(sec: number | null | undefined) {
    if (sec == null) return "—";
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${m}:${s.toString().padStart(2, "0")}`;
}

export function TelefoniaCallDetailDialog({ call, onClose }: Props) {
    // Editar la reserva que salió de la llamada (2026-09-30). El enlace «Ver
    // reserva creada» lleva a `/reservas?reserva=<id>`, pero esa página no abre
    // nada con ese parámetro: el editor se abre aquí mismo.
    const { canAccess: puedeEditar } = useCanAccessSection("reservas", "edit");
    const { editarReserva, dialogoEdicion } = useEdicionReserva();
    const reservaId: string | undefined =
        call?.reserva_id ||
        (call?.structured_data as any)?.reserva_id ||
        (call?.tool_calls || []).find((t) => t.tool === "create_reservation" && (t.result as any)?.id)
            ?.result?.id;

    return (
        <>
        <Dialog open={!!call} onOpenChange={(open) => !open && onClose()}>
            <DialogContent className="max-w-3xl max-h-[85dvh] flex flex-col">
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2">
                        Detalle de llamada
                        {call?.call_type === "bot" ? (
                            <Badge
                                variant="outline"
                                className="bg-sky-500/10 text-sky-600 border-sky-500/20"
                            >
                                <Bot className="h-3 w-3 mr-1" /> Bot
                            </Badge>
                        ) : (
                            <Badge variant="outline">
                                <User className="h-3 w-3 mr-1" /> Humano
                            </Badge>
                        )}
                    </DialogTitle>
                    <DialogDescription>
                        {call && (
                            <span className="flex flex-wrap gap-x-3 gap-y-1 text-xs">
                                <span>
                                    Número:{" "}
                                    <span className="font-mono text-foreground">
                                        {call.caller_number || "Oculto"}
                                    </span>
                                </span>
                                <span>
                                    Fecha:{" "}
                                    <span className="text-foreground">
                                        {format(new Date(call.started_at), "dd/MM/yyyy HH:mm", {
                                            locale: es,
                                        })}
                                    </span>
                                </span>
                                <span>
                                    Duración:{" "}
                                    <span className="text-foreground">
                                        {formatDuration(call.duration_seconds ?? null)}
                                    </span>
                                </span>
                            </span>
                        )}
                    </DialogDescription>
                </DialogHeader>

                <ScrollArea className="flex-1 mt-2 pr-2">
                    <div className="space-y-5">
                        {/* Coste */}
                        {call?.cost_total_eur != null && (
                            <section className="space-y-2">
                                <h4 className="font-semibold flex items-center gap-2 text-sm">
                                    <Euro className="w-4 h-4" /> Coste de la llamada
                                </h4>
                                <div className="flex flex-wrap gap-3 items-center">
                                    <span className="text-xl font-bold">
                                        €{Number(call.cost_total_eur).toFixed(4)}
                                    </span>
                                    {call.ended_reason &&
                                        (() => {
                                            const r = ENDED_REASON_LABELS[call.ended_reason];
                                            return (
                                                <Badge
                                                    variant="outline"
                                                    className={
                                                        r?.className ||
                                                        "bg-muted text-muted-foreground"
                                                    }
                                                >
                                                    {r?.label || call.ended_reason}
                                                </Badge>
                                            );
                                        })()}
                                </div>
                                {call.cost_breakdown &&
                                    Object.keys(call.cost_breakdown).length > 0 && (
                                        <div className="rounded-md border overflow-hidden text-xs">
                                            <div className="grid grid-cols-2 bg-muted/60 px-3 py-2 font-medium">
                                                <div>Componente</div>
                                                <div className="text-right">Coste</div>
                                            </div>
                                            {Object.entries(
                                                call.cost_breakdown as Record<string, any>,
                                            ).map(([key, val]) => (
                                                <div
                                                    key={key}
                                                    className="grid grid-cols-2 px-3 py-1.5 border-t"
                                                >
                                                    <div className="text-muted-foreground">
                                                        {COST_COMPONENT_LABELS[key] || key}
                                                    </div>
                                                    <div className="text-right font-mono">
                                                        €
                                                        {Number(val?.cost_eur || 0).toFixed(4)}
                                                    </div>
                                                </div>
                                            ))}
                                        </div>
                                    )}
                            </section>
                        )}

                        {/* Resumen */}
                        {call?.summary && (
                            <section className="space-y-2">
                                <h4 className="font-semibold flex items-center gap-2 text-sm">
                                    <Info className="w-4 h-4" /> Resumen del asistente
                                </h4>
                                <p className="text-sm bg-muted/60 p-3 rounded-md">
                                    {call.summary}
                                </p>
                            </section>
                        )}

                        {/* Structured data */}
                        {call?.structured_data &&
                            Object.keys(call.structured_data).length > 0 && (
                                <section className="space-y-2">
                                    <h4 className="font-semibold text-sm">Datos estructurados</h4>
                                    <pre className="text-xs bg-muted/60 p-3 rounded-md overflow-x-auto">
                                        {JSON.stringify(call.structured_data, null, 2)}
                                    </pre>
                                </section>
                            )}

                        {/* Tool calls */}
                        {call?.call_type === "bot" && (
                            <section className="space-y-2">
                                <h4 className="font-semibold flex items-center gap-2 text-sm">
                                    <ListFilter className="w-4 h-4" /> Herramientas usadas
                                </h4>
                                {!call.tool_calls || call.tool_calls.length === 0 ? (
                                    <p className="text-sm text-muted-foreground italic">
                                        El asistente no utilizó ninguna herramienta.
                                    </p>
                                ) : (
                                    <div className="space-y-3">
                                        {call.tool_calls.map((tool, idx) => (
                                            <div
                                                key={idx}
                                                className="border rounded-md overflow-hidden text-xs"
                                            >
                                                <div className="bg-muted/60 px-3 py-2 border-b flex justify-between items-center">
                                                    <span className="font-mono font-medium text-primary">
                                                        {tool.tool}
                                                    </span>
                                                    {tool.timestamp && (
                                                        <span className="text-xs text-muted-foreground">
                                                            {format(
                                                                new Date(tool.timestamp),
                                                                "HH:mm:ss",
                                                            )}
                                                        </span>
                                                    )}
                                                </div>
                                                <div className="p-3 border-b border-dashed space-y-1">
                                                    <span className="text-[10px] pointer-coarse:text-xs uppercase tracking-wider text-muted-foreground">
                                                        Parámetros
                                                    </span>
                                                    <pre className="font-mono overflow-x-auto">
                                                        {JSON.stringify(tool.params || {}, null, 2)}
                                                    </pre>
                                                </div>
                                                <div className="p-3 space-y-1">
                                                    <span className="text-[10px] pointer-coarse:text-xs uppercase tracking-wider text-muted-foreground">
                                                        Resultado
                                                    </span>
                                                    <pre className="font-mono overflow-x-auto">
                                                        {typeof tool.result === "string"
                                                            ? tool.result
                                                            : JSON.stringify(tool.result, null, 2)}
                                                    </pre>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </section>
                        )}

                        {/* Link reserva */}
                        {reservaId && (
                            <section className="flex flex-wrap gap-2">
                                <Button asChild variant="outline" size="sm" className="h-11 px-4">
                                    <Link to={`/reservas?reserva=${reservaId}`}>
                                        <ExternalLink className="w-4 h-4 mr-2" />
                                        Ver reserva creada
                                    </Link>
                                </Button>
                                {/* Sin «Editar» en Reservas no sale (06/11/2026: se oculta, no se desactiva). */}
                                {puedeEditar && (
                                    <Button
                                        variant="outline"
                                        size="sm"
                                        className="h-11 px-4"
                                        onClick={() => editarReserva(reservaId)}
                                    >
                                        <SquarePen className="w-4 h-4 mr-2" />
                                        Editar reserva
                                    </Button>
                                )}
                            </section>
                        )}
                    </div>
                </ScrollArea>
            </DialogContent>
        </Dialog>
        {/* Editor de la reserva de la llamada. `null` hasta que se pide. */}
        {dialogoEdicion}
        </>
    );
}

export default TelefoniaCallDetailDialog;
