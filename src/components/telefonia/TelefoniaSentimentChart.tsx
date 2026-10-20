import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer, Legend } from "recharts";
import type { CallLogsAnalytics } from "./types";

interface Props {
    data?: CallLogsAnalytics["bySentiment"];
    isLoading?: boolean;
}

const SENTIMENT_META: Record<string, { label: string; color: string }> = {
    positivo: { label: "Positivo", color: "hsl(142 71% 45%)" },
    positive: { label: "Positivo", color: "hsl(142 71% 45%)" },
    neutro: { label: "Neutro", color: "hsl(215 20% 55%)" },
    neutral: { label: "Neutro", color: "hsl(215 20% 55%)" },
    negativo: { label: "Negativo", color: "hsl(0 84% 60%)" },
    negative: { label: "Negativo", color: "hsl(0 84% 60%)" },
};

export function TelefoniaSentimentChart({ data, isLoading }: Props) {
    const chartData = (data || []).map((d) => {
        const meta = SENTIMENT_META[d.sentiment.toLowerCase()] || {
            label: d.sentiment,
            color: "hsl(215 20% 65%)",
        };
        return { name: meta.label, value: d.count, color: meta.color };
    });
    const total = chartData.reduce((s, d) => s + d.value, 0);
    const hasData = total > 0;

    return (
        <Card>
            <CardHeader>
                <CardTitle>Sentimiento</CardTitle>
                <CardDescription>Tono detectado por el asistente</CardDescription>
            </CardHeader>
            <CardContent>
                {isLoading ? (
                    <Skeleton className="h-[260px] w-full" />
                ) : !hasData ? (
                    <div className="h-[260px] flex items-center justify-center text-sm text-muted-foreground">
                        Sin datos de sentimiento.
                    </div>
                ) : (
                    <div className="h-[260px] w-full relative">
                        <ResponsiveContainer width="100%" height="100%">
                            <PieChart>
                                <Pie
                                    data={chartData}
                                    dataKey="value"
                                    nameKey="name"
                                    cx="50%"
                                    cy="50%"
                                    innerRadius={60}
                                    outerRadius={95}
                                    paddingAngle={2}
                                    stroke="hsl(var(--background))"
                                    strokeWidth={2}
                                >
                                    {chartData.map((entry, i) => (
                                        <Cell key={i} fill={entry.color} />
                                    ))}
                                </Pie>
                                <Tooltip
                                    contentStyle={{
                                        background: "hsl(var(--popover))",
                                        border: "1px solid hsl(var(--border))",
                                        borderRadius: 8,
                                        fontSize: 12,
                                        color: "hsl(var(--popover-foreground))",
                                    }}
                                    formatter={(v: number, n: string) => [
                                        `${v} (${((v / total) * 100).toFixed(1)}%)`,
                                        n,
                                    ]}
                                />
                                <Legend
                                    verticalAlign="bottom"
                                    iconType="circle"
                                    wrapperStyle={{ fontSize: 12 }}
                                />
                            </PieChart>
                        </ResponsiveContainer>
                        <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none mt-[-20px]">
                            <span className="text-2xl font-bold">{total}</span>
                            <span className="text-xs text-muted-foreground">llamadas</span>
                        </div>
                    </div>
                )}
            </CardContent>
        </Card>
    );
}

export default TelefoniaSentimentChart;
