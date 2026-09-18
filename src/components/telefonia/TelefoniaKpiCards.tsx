import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
    Phone,
    CheckCircle2,
    Clock,
    Euro,
    CalendarCheck,
    UserRoundCog,
    TrendingUp,
    TrendingDown,
    Minus,
} from "lucide-react";
import type { CallLogsAnalytics } from "./types";

interface Props {
    analytics?: CallLogsAnalytics;
    isLoading?: boolean;
}

function formatDuration(sec: number) {
    if (!sec || !isFinite(sec)) return "—";
    const m = Math.floor(sec / 60);
    const s = Math.round(sec % 60);
    return `${m}:${s.toString().padStart(2, "0")}`;
}

function formatEur(v: number) {
    return new Intl.NumberFormat("es-ES", {
        style: "currency",
        currency: "EUR",
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
    }).format(v || 0);
}

function formatPct(v: number) {
    return `${(v || 0).toFixed(1)}%`;
}

function Delta({
    current,
    previous,
    invert = false,
    format = "pct",
}: {
    current?: number;
    previous?: number;
    invert?: boolean;
    format?: "pct" | "number";
}) {
    if (previous === undefined || current === undefined) {
        return <span className="text-xs text-muted-foreground">—</span>;
    }
    if (previous === 0 && current === 0) {
        return (
            <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                <Minus className="h-3 w-3" /> sin cambios
            </span>
        );
    }
    const diff = current - previous;
    const pct = previous !== 0 ? (diff / previous) * 100 : 100;
    const isUp = diff > 0;
    const good = invert ? !isUp : isUp;
    const Icon = isUp ? TrendingUp : TrendingDown;
    const color = good ? "text-emerald-500" : "text-rose-500";
    const text =
        format === "pct"
            ? `${isUp ? "+" : ""}${pct.toFixed(1)}%`
            : `${isUp ? "+" : ""}${diff.toFixed(0)}`;
    return (
        <span className={`inline-flex items-center gap-1 text-xs font-medium ${color}`}>
            <Icon className="h-3 w-3" /> {text}
        </span>
    );
}

interface KpiItem {
    title: string;
    value: string;
    icon: React.ElementType;
    delta?: React.ReactNode;
    hint?: string;
}

export function TelefoniaKpiCards({ analytics, isLoading }: Props) {
    if (isLoading || !analytics) {
        return (
            <div className="grid gap-4 grid-cols-2 md:grid-cols-3 lg:grid-cols-6">
                {Array.from({ length: 6 }).map((_, i) => (
                    <Card key={i}>
                        <CardHeader className="pb-2">
                            <Skeleton className="h-4 w-24" />
                        </CardHeader>
                        <CardContent className="space-y-2">
                            <Skeleton className="h-7 w-16" />
                            <Skeleton className="h-3 w-20" />
                        </CardContent>
                    </Card>
                ))}
            </div>
        );
    }

    const prev = analytics.previous;

    const items: KpiItem[] = [
        {
            title: "Total llamadas",
            value: analytics.totalCalls.toLocaleString("es-ES"),
            icon: Phone,
            delta: <Delta current={analytics.totalCalls} previous={prev?.totalCalls} format="pct" />,
            hint: "en el periodo",
        },
        {
            title: "% éxito",
            value: formatPct(analytics.successRate),
            icon: CheckCircle2,
            delta: <Delta current={analytics.successRate} previous={prev?.successRate} format="pct" />,
            hint: "llamadas resueltas",
        },
        {
            title: "Duración media",
            value: formatDuration(analytics.avgDurationSec),
            icon: Clock,
            delta: (
                <Delta
                    current={analytics.avgDurationSec}
                    previous={prev?.avgDurationSec}
                    format="pct"
                    invert
                />
            ),
            hint: "min:seg por llamada",
        },
        {
            title: "Coste total",
            value: formatEur(analytics.totalCostEur),
            icon: Euro,
            delta: (
                <Delta
                    current={analytics.totalCostEur}
                    previous={prev?.totalCostEur}
                    format="pct"
                    invert
                />
            ),
            hint: "facturado VAPI",
        },
        {
            title: "Reservas creadas",
            value: formatPct(analytics.reservasCreadasRate),
            icon: CalendarCheck,
            delta: (
                <Delta
                    current={analytics.reservasCreadasRate}
                    previous={prev?.reservasCreadasRate}
                    format="pct"
                />
            ),
            hint: "% llamadas → reserva",
        },
        {
            title: "Transferidas",
            value: formatPct(analytics.transferredRate),
            icon: UserRoundCog,
            delta: (
                <Delta
                    current={analytics.transferredRate}
                    previous={prev?.transferredRate}
                    format="pct"
                    invert
                />
            ),
            hint: "% pasadas a humano",
        },
    ];

    return (
        <div className="grid gap-4 grid-cols-2 md:grid-cols-3 lg:grid-cols-6">
            {items.map((item) => {
                const Icon = item.icon;
                return (
                    <Card key={item.title}>
                        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                            <CardTitle className="text-xs sm:text-sm font-medium text-muted-foreground">
                                {item.title}
                            </CardTitle>
                            <Icon className="h-4 w-4 text-muted-foreground" />
                        </CardHeader>
                        <CardContent>
                            <div className="text-2xl font-bold tracking-tight">{item.value}</div>
                            <div className="flex items-center justify-between mt-1 gap-2 flex-wrap">
                                {item.delta}
                                {item.hint && (
                                    <span className="text-[11px] text-muted-foreground truncate">
                                        {item.hint}
                                    </span>
                                )}
                            </div>
                        </CardContent>
                    </Card>
                );
            })}
        </div>
    );
}

export default TelefoniaKpiCards;
