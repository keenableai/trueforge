'use client';

import { useEffect, useState } from 'react';

import { useOptionalAgentMetricsServer, useOptionalAgentSessionsServer } from '../../server/ServerContext.js';
import type {
  AgentMetricMeter,
  AgentMetricPoint,
  AgentMetricsServer,
  AgentSessionsServer,
} from '../../server/types.js';
import { DEFAULT_SESSION_TIME_WINDOW_MS } from '../../utils/sessionShareUrl.js';

const SPARKLINE_WINDOW_MS = 14 * 24 * 60 * 60 * 1000;
const CHART_NAME = 'sessions_cost_over_time';

export type AgentLibraryDailyPoint = {
  timestamp: string;
  value: number;
};

export type AgentLibraryUsageStats = {
  totalSessions: number | null;
  totalCostUsd: number | null;
  costPerSessionUsd: number | null;
  dailyPoints: AgentLibraryDailyPoint[] | null;
  lastRunAt: string | null;
};

function meterValue(meters: readonly AgentMetricMeter[], name: string): number | null {
  const match = meters.find(meter => meter.name === name);
  return match == null || !Number.isFinite(match.aggregateValue) ? null : match.aggregateValue;
}

function chartPoints(points: readonly AgentMetricPoint[] | undefined): AgentLibraryDailyPoint[] | null {
  if (points == null) return null;
  return points.map(point => ({
    timestamp: point.timestamp,
    value: Number.isFinite(point.value) ? point.value : 0,
  }));
}

async function loadUsageForAgent({
  agentId,
  metrics,
  sessions,
  metersStart,
  metersEnd,
  sparklineStart,
  sparklineEnd,
}: {
  agentId: string;
  metrics: AgentMetricsServer | null;
  sessions: AgentSessionsServer | null;
  metersStart: string;
  metersEnd: string;
  sparklineStart: string;
  sparklineEnd: string;
}): Promise<AgentLibraryUsageStats> {
  const metersPromise =
    metrics == null
      ? Promise.resolve({ ok: false as const })
      : metrics
          .getMeters({
            agentId,
            startTimestamp: metersStart,
            endTimestamp: metersEnd,
          })
          .then(
            meters => ({ ok: true as const, meters }),
            () => ({ ok: false as const }),
          );

  const chartPromise =
    metrics == null
      ? Promise.resolve({ ok: false as const })
      : metrics
          .getChartData({
            agentId,
            startTimestamp: sparklineStart,
            endTimestamp: sparklineEnd,
            chartName: CHART_NAME,
          })
          .then(
            data => ({ ok: true as const, data }),
            () => ({ ok: false as const }),
          );

  const lastSessionPromise =
    sessions == null
      ? Promise.resolve(null)
      : sessions.listSessions({ agentId, limit: 1, order: 'desc' }).then(
          page => page.data[0] ?? null,
          () => null,
        );

  const [metersResult, chartResult, lastSession] = await Promise.all([metersPromise, chartPromise, lastSessionPromise]);

  const meters = metersResult.ok ? metersResult.meters : [];
  const dailyPoints = chartResult.ok ? chartPoints(chartResult.data.graphs[0]?.graphLines[0]?.values) : null;

  return {
    totalSessions: metersResult.ok ? meterValue(meters, 'total_sessions') : null,
    totalCostUsd: metersResult.ok ? meterValue(meters, 'total_cost_in_usd') : null,
    costPerSessionUsd: metersResult.ok ? meterValue(meters, 'cost_per_session_in_usd') : null,
    dailyPoints,
    lastRunAt: lastSession?.lastActivityAt ?? null,
  };
}

/**
 * Loads per-agent spend/session meters, a 14d cost sparkline, and last-run
 * for the visible library page. One request set per agent id (N+1 by design).
 */
export function useAgentLibraryUsageStats({
  agentIdsKey,
  enabled,
  refreshKey,
}: {
  /** Stable `\0`-joined agent ids for the current page. */
  agentIdsKey: string;
  enabled: boolean;
  refreshKey: number;
}): {
  usageByAgentId: Map<string, AgentLibraryUsageStats>;
  isLoading: boolean;
  metricsEnabled: boolean;
  lastRunEnabled: boolean;
} {
  const metrics = useOptionalAgentMetricsServer();
  const sessions = useOptionalAgentSessionsServer();
  const metricsEnabled = metrics != null;
  const lastRunEnabled = sessions != null;
  const [usageByAgentId, setUsageByAgentId] = useState<Map<string, AgentLibraryUsageStats>>(() => new Map());
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    const agentIds = agentIdsKey.length === 0 ? [] : agentIdsKey.split('\0');
    if (!enabled || agentIds.length === 0 || (metrics == null && sessions == null)) {
      setUsageByAgentId(new Map());
      setIsLoading(false);
      return;
    }

    let cancelled = false;
    setIsLoading(true);
    setUsageByAgentId(new Map());

    const now = Date.now();
    const metersEnd = new Date(now).toISOString();
    const metersStart = new Date(now - DEFAULT_SESSION_TIME_WINDOW_MS).toISOString();
    const sparklineStart = new Date(now - SPARKLINE_WINDOW_MS).toISOString();

    void Promise.all(
      agentIds.map(async agentId => {
        const stats = await loadUsageForAgent({
          agentId,
          metrics,
          sessions,
          metersStart,
          metersEnd,
          sparklineStart,
          sparklineEnd: metersEnd,
        });
        return [agentId, stats] as const;
      }),
    )
      .then(entries => {
        if (cancelled) return;
        setUsageByAgentId(new Map(entries));
        setIsLoading(false);
      })
      .catch(() => {
        if (cancelled) return;
        setUsageByAgentId(new Map());
        setIsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [agentIdsKey, enabled, metrics, refreshKey, sessions]);

  return { usageByAgentId, isLoading, metricsEnabled, lastRunEnabled };
}
