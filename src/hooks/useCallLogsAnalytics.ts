import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export interface CallLogsAnalyticsInput {
  dateFrom: string; // ISO timestamptz
  dateTo: string; // ISO timestamptz
  callType?: "bot" | "human";
}

export interface CountByKey<K extends string = string> {
  count: number;
}

export interface ByIntentItem {
  intent: string;
  count: number;
}
export interface ByEndedReasonItem {
  reason: string;
  count: number;
}
export interface BySentimentItem {
  sentiment: string;
  count: number;
}
export interface ByMotivoFalloItem {
  motivo: string;
  count: number;
}
export interface CallsPerDayItem {
  date: string; // YYYY-MM-DD
  count: number;
  avgDuration: number;
}

export interface CallLogsAnalytics {
  totalCalls: number;
  avgDurationSec: number;
  successRate: number; // 0-100
  totalCostEur: number;
  reservasCreadasRate: number;
  transferredRate: number;
  byIntent: ByIntentItem[];
  byEndedReason: ByEndedReasonItem[];
  bySentiment: BySentimentItem[];
  byMotivoFallo: ByMotivoFalloItem[];
  callsPerDay: CallsPerDayItem[];
}

const EMPTY_ANALYTICS: CallLogsAnalytics = {
  totalCalls: 0,
  avgDurationSec: 0,
  successRate: 0,
  totalCostEur: 0,
  reservasCreadasRate: 0,
  transferredRate: 0,
  byIntent: [],
  byEndedReason: [],
  bySentiment: [],
  byMotivoFallo: [],
  callsPerDay: [],
};

export function useCallLogsAnalytics(input: CallLogsAnalyticsInput) {
  const { dateFrom, dateTo, callType } = input;

  const query = useQuery<CallLogsAnalytics>({
    queryKey: ["call_logs_analytics", { dateFrom, dateTo, callType }],
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_call_logs_analytics", {
        p_date_from: dateFrom,
        p_date_to: dateTo,
        p_call_type: callType ?? null,
      });

      if (error) throw error;
      if (!data) return EMPTY_ANALYTICS;

      // RPC returns jsonb → already a plain object
      const raw = data as Partial<CallLogsAnalytics>;
      return {
        totalCalls: Number(raw.totalCalls ?? 0),
        avgDurationSec: Number(raw.avgDurationSec ?? 0),
        successRate: Number(raw.successRate ?? 0),
        totalCostEur: Number(raw.totalCostEur ?? 0),
        reservasCreadasRate: Number(raw.reservasCreadasRate ?? 0),
        transferredRate: Number(raw.transferredRate ?? 0),
        byIntent: (raw.byIntent ?? []) as ByIntentItem[],
        byEndedReason: (raw.byEndedReason ?? []) as ByEndedReasonItem[],
        bySentiment: (raw.bySentiment ?? []) as BySentimentItem[],
        byMotivoFallo: (raw.byMotivoFallo ?? []) as ByMotivoFalloItem[],
        callsPerDay: (raw.callsPerDay ?? []) as CallsPerDayItem[],
      };
    },
    enabled: Boolean(dateFrom && dateTo),
  });

  return {
    data: query.data ?? EMPTY_ANALYTICS,
    isLoading: query.isLoading,
    error: query.error as Error | null,
    refetch: query.refetch,
  };
}
