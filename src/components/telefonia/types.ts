// Tipos compartidos del módulo de telefonía. Los hooks `useCallLogs` y
// `useCallLogsAnalytics` exportarán tipos equivalentes; estos se declaran aquí
// como fallback para que los componentes tipen correctamente aunque los hooks
// aún no existan.

export interface CallLogsAnalytics {
    totalCalls: number;
    avgDurationSec: number;
    successRate: number; // 0-100
    totalCostEur: number;
    reservasCreadasRate: number;
    transferredRate: number;
    byIntent: { intent: string; count: number }[];
    byEndedReason: { reason: string; count: number }[];
    bySentiment: { sentiment: string; count: number }[];
    byMotivoFallo: { motivo: string; count: number }[];
    callsPerDay: { date: string; count: number; avgDuration: number }[];
    // Opcional: si el hook calcula un periodo previo para deltas
    previous?: Partial<Omit<CallLogsAnalytics, 'previous'>>;
}

export interface CallLogFilters {
    intent?: string;
    sentiment?: string;
    success?: 'pass' | 'fail' | 'all';
    callType?: 'bot' | 'human' | 'all';
}

export interface DateRange {
    dateFrom: Date;
    dateTo: Date;
}

export type PresetRange = 'today' | '7d' | '30d' | '90d' | 'custom';
