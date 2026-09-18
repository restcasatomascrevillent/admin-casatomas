import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export type VapiAnalyticsPreset =
  | "calls_by_ended_reason"
  | "calls_by_assistant"
  | "calls_over_time"
  | "cost_over_time";

export interface UseVapiAnalyticsParams {
  preset: VapiAnalyticsPreset;
  dateFrom: string; // YYYY-MM-DD or ISO
  dateTo: string;   // YYYY-MM-DD or ISO
  assistantId?: string;
  /** If false, disables the query (e.g. awaiting a date range). Default: true. */
  enabled?: boolean;
}

/**
 * Consumes the `vapi-analytics` Edge Function (secure VAPI proxy).
 * Returns raw VAPI payload — shape depends on the preset.
 */
export function useVapiAnalytics<TData = unknown>({
  preset,
  dateFrom,
  dateTo,
  assistantId,
  enabled = true,
}: UseVapiAnalyticsParams) {
  return useQuery<TData>({
    queryKey: ["vapi-analytics", preset, dateFrom, dateTo, assistantId ?? null],
    enabled: enabled && !!preset && !!dateFrom && !!dateTo,
    staleTime: 5 * 60 * 1000, // 5 min
    gcTime: 10 * 60 * 1000,
    queryFn: async () => {
      const { data, error } = await supabase.functions.invoke("vapi-analytics", {
        body: {
          presetName: preset,
          dateFrom,
          dateTo,
          assistantId,
        },
      });

      if (error) throw error;
      if (data?.error) throw new Error(data.error);

      return data as TData;
    },
  });
}
