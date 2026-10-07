import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Bot, User, Check, X, SmilePlus, Meh, Frown } from "lucide-react";
import { format } from "date-fns";
import { es } from "date-fns/locale";
import { cn } from "@/lib/utils";

interface CallLog {
    id: string;
    started_at: string;
    caller_number?: string | null;
    call_type?: string | null;
    status?: string | null;
    duration_seconds?: number | null;
    cost_total_eur?: number | null;
    structured_data?: Record<string, any> | null;
    tool_calls?: Array<{ tool: string; params?: any; result?: any }> | null;
}

interface Props {
    calls?: CallLog[];
    isLoading?: boolean;
    onSelect?: (call: CallLog) => void;
    /**
     * Clases de la tarjeta. Si el llamador le limita el alto (p. ej. `flex-1` dentro de
     * una columna con alto fijo), la cabecera queda fija y las filas hacen scroll por dentro.
     */
    className?: string;
}

function formatDuration(sec: number | null | undefined) {
    if (sec == null) return "—";
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${m}:${s.toString().padStart(2, "0")}`;
}

function getIntent(call: CallLog): string | null {
    const sd = call.structured_data || {};
    return sd.intent || sd.intencion || null;
}

function getSentiment(call: CallLog): string | null {
    const sd = call.structured_data || {};
    return sd.sentiment || sd.sentimiento || null;
}

function getReservaCreada(call: CallLog): boolean {
    const sd = call.structured_data || {};
    if (sd.reserva_creada === true || sd.reservation_created === true) return true;
    if (Array.isArray(call.tool_calls)) {
        return call.tool_calls.some(
            (t) => t.tool === "create_reservation" && t.result && !(t.result as any).error,
        );
    }
    return false;
}

function intentBadgeStyle(intent: string) {
    switch (intent) {
        case "crear":
            return "bg-emerald-500/10 text-emerald-600 border-emerald-500/20";
        case "modificar":
            return "bg-amber-500/10 text-amber-600 border-amber-500/20";
        case "cancelar":
            return "bg-rose-500/10 text-rose-600 border-rose-500/20";
        case "info":
            return "bg-sky-500/10 text-sky-600 border-sky-500/20";
        case "hablar_humano":
            return "bg-violet-500/10 text-violet-600 border-violet-500/20";
        default:
            return "bg-muted text-muted-foreground";
    }
}

function SentimentBadge({ sentiment }: { sentiment: string | null }) {
    if (!sentiment) return <span className="text-xs text-muted-foreground">—</span>;
    const s = sentiment.toLowerCase();
    if (s.startsWith("pos")) {
        return (
            <Badge
                variant="outline"
                className="bg-emerald-500/10 text-emerald-600 border-emerald-500/20 gap-1"
            >
                <SmilePlus className="h-3 w-3" /> Positivo
            </Badge>
        );
    }
    if (s.startsWith("neg")) {
        return (
            <Badge
                variant="outline"
                className="bg-rose-500/10 text-rose-600 border-rose-500/20 gap-1"
            >
                <Frown className="h-3 w-3" /> Negativo
            </Badge>
        );
    }
    return (
        <Badge variant="outline" className="bg-muted text-muted-foreground gap-1">
            <Meh className="h-3 w-3" /> Neutro
        </Badge>
    );
}

export function TelefoniaRecentCallsTable({ calls, isLoading, onSelect, className }: Props) {
    return (
        <Card className={cn("flex flex-col", className)}>
            <CardHeader className="shrink-0">
                <CardTitle>Llamadas recientes</CardTitle>
                <CardDescription>
                    Actualizado en tiempo real. Pulsa una fila para ver el detalle.
                </CardDescription>
            </CardHeader>
            {/* `min-h-0 flex-1 overflow-y-auto`: sin alto limitado crece con las filas,
                como siempre; con alto limitado las filas hacen scroll aquí dentro. */}
            <CardContent className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-0 sm:p-6">
                {isLoading ? (
                    <div className="space-y-2 p-4">
                        {Array.from({ length: 6 }).map((_, i) => (
                            <Skeleton key={i} className="h-10 w-full" />
                        ))}
                    </div>
                ) : !calls || calls.length === 0 ? (
                    <div className="py-12 text-center text-sm text-muted-foreground">
                        No hay llamadas en este periodo.
                    </div>
                ) : (
                    <div className="overflow-x-auto">
                        <Table>
                            <TableHeader>
                                <TableRow>
                                    <TableHead>Fecha</TableHead>
                                    <TableHead>Número</TableHead>
                                    <TableHead>Tipo</TableHead>
                                    <TableHead>Intención</TableHead>
                                    <TableHead>Sentimiento</TableHead>
                                    <TableHead className="text-center">Reserva</TableHead>
                                    <TableHead className="text-right">Duración</TableHead>
                                    <TableHead className="text-right">Coste</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {calls.map((call) => {
                                    const intent = getIntent(call);
                                    const sentiment = getSentiment(call);
                                    const reservaOk = getReservaCreada(call);
                                    return (
                                        <TableRow
                                            key={call.id}
                                            className="cursor-pointer"
                                            onClick={() => onSelect?.(call)}
                                        >
                                            <TableCell className="whitespace-nowrap text-muted-foreground text-xs">
                                                {format(new Date(call.started_at), "dd MMM HH:mm", {
                                                    locale: es,
                                                })}
                                            </TableCell>
                                            <TableCell className="font-mono text-xs">
                                                {call.caller_number || "Oculto"}
                                            </TableCell>
                                            <TableCell>
                                                {call.call_type === "bot" ? (
                                                    <Badge
                                                        variant="outline"
                                                        className="bg-sky-500/10 text-sky-600 border-sky-500/20 gap-1"
                                                    >
                                                        <Bot className="h-3 w-3" /> Bot
                                                    </Badge>
                                                ) : (
                                                    <Badge variant="outline" className="gap-1">
                                                        <User className="h-3 w-3" /> Humano
                                                    </Badge>
                                                )}
                                            </TableCell>
                                            <TableCell>
                                                {intent ? (
                                                    <Badge
                                                        variant="outline"
                                                        className={intentBadgeStyle(intent)}
                                                    >
                                                        {intent}
                                                    </Badge>
                                                ) : (
                                                    <span className="text-xs text-muted-foreground">
                                                        —
                                                    </span>
                                                )}
                                            </TableCell>
                                            <TableCell>
                                                <SentimentBadge sentiment={sentiment} />
                                            </TableCell>
                                            <TableCell className="text-center">
                                                {reservaOk ? (
                                                    <Check className="h-4 w-4 text-emerald-500 inline" />
                                                ) : (
                                                    <X className="h-4 w-4 text-muted-foreground inline" />
                                                )}
                                            </TableCell>
                                            <TableCell className="text-right font-mono text-xs">
                                                {formatDuration(call.duration_seconds ?? null)}
                                            </TableCell>
                                            <TableCell className="text-right font-mono text-xs text-muted-foreground">
                                                {call.cost_total_eur != null
                                                    ? `€${Number(call.cost_total_eur).toFixed(3)}`
                                                    : "—"}
                                            </TableCell>
                                        </TableRow>
                                    );
                                })}
                            </TableBody>
                        </Table>
                    </div>
                )}
            </CardContent>
        </Card>
    );
}

export default TelefoniaRecentCallsTable;
