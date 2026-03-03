/**
 * Telemetry service for capturing ATS parsing misses.
 *
 * Provides instrumentation utilities for the scoring engine to emit
 * structured telemetry events when keywords fail Pass 2/3 matching.
 *
 * Architecture:
 * 1. Application code calls recordKeywordMiss() for unmatched tokens
 * 2. Events are batched and emitted as structured spans/logs
 * 3. OTel Collector transforms logs to metrics via count connector
 * 4. Prometheus stores aggregated miss counts
 * 5. Batch review UI queries highest-frequency misses
 */
import type {
  TelemetryMissEvent,
  AggregatedMiss,
  KeywordMissSpanEvent,
} from '../types';
import { ATSSemanticConventions } from '../types';

/** Configuration for the telemetry service */
export interface TelemetryServiceConfig {
  /** OTLP endpoint for exporting telemetry */
  readonly otlpEndpoint?: string;
  /** Service name for attribution */
  readonly serviceName?: string;
  /** Enable/disable telemetry collection */
  readonly enabled?: boolean;
  /** Batch size before flushing */
  readonly batchSize?: number;
  /** Flush interval in milliseconds */
  readonly flushIntervalMs?: number;
}

/** Default configuration */
const DEFAULT_CONFIG: Required<TelemetryServiceConfig> = {
  otlpEndpoint: 'http://localhost:4318',
  serviceName: 'ats-scoring-engine',
  enabled: true,
  batchSize: 100,
  flushIntervalMs: 5000,
};

/**
 * Telemetry service for capturing and exporting keyword miss events.
 *
 * Uses a local buffer and can export to OTLP-compatible backends.
 * For production, integrate with the actual OpenTelemetry SDK.
 */
export class TelemetryService {
  private readonly config: Required<TelemetryServiceConfig>;
  private readonly eventBuffer: TelemetryMissEvent[] = [];
  private flushTimer: ReturnType<typeof setInterval> | null = null;
  private readonly listeners: Array<(events: readonly TelemetryMissEvent[]) => void> = [];

  constructor(config: TelemetryServiceConfig = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };

    if (this.config.enabled) {
      this.startFlushTimer();
    }
  }

  /**
   * Record a keyword miss event from the parsing engine.
   *
   * Call this when a token fails both Pass 2 (exact match) and
   * Pass 3 (semantic/fuzzy match) checks.
   */
  recordKeywordMiss(params: {
    keyword: string;
    passLevel: 2 | 3;
    jobTitle?: string;
    jobDescriptionSnippet?: string;
  }): void {
    if (!this.config.enabled) return;

    const event: TelemetryMissEvent = {
      keyword: params.keyword,
      passLevel: params.passLevel,
      timestamp: new Date().toISOString(),
      jobTitle: params.jobTitle,
      jobDescriptionSnippet: params.jobDescriptionSnippet?.slice(0, 200),
      normalizedKeyword: this.normalizeKeyword(params.keyword),
    };

    this.eventBuffer.push(event);

    if (this.eventBuffer.length >= this.config.batchSize) {
      this.flush();
    }
  }

  /**
   * Subscribe to miss events for custom processing.
   * Useful for real-time dashboards or alternative storage.
   */
  onMissEvents(listener: (events: readonly TelemetryMissEvent[]) => void): () => void {
    this.listeners.push(listener);
    return () => {
      const idx = this.listeners.indexOf(listener);
      if (idx >= 0) this.listeners.splice(idx, 1);
    };
  }

  /**
   * Flush buffered events to the configured endpoint.
   */
  async flush(): Promise<void> {
    if (this.eventBuffer.length === 0) return;

    const events = this.eventBuffer.splice(0, this.eventBuffer.length);

    // Notify listeners
    for (const listener of this.listeners) {
      try {
        listener(events);
      } catch {
        // Ignore listener errors
      }
    }

    // Export to OTLP if enabled
    if (this.config.otlpEndpoint) {
      await this.exportToOTLP(events);
    }
  }

  /**
   * Aggregate events by keyword for batch review.
   */
  aggregateMisses(events: readonly TelemetryMissEvent[]): readonly AggregatedMiss[] {
    const byKeyword = new Map<string, TelemetryMissEvent[]>();

    for (const event of events) {
      const key = event.normalizedKeyword;
      const existing = byKeyword.get(key);
      if (existing) {
        existing.push(event);
      } else {
        byKeyword.set(key, [event]);
      }
    }

    return [...byKeyword.entries()]
      .map(([keyword, eventList]) => {
        const sorted = [...eventList].sort(
          (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime(),
        );
        return {
          keyword,
          count: eventList.length,
          firstSeen: sorted[0].timestamp,
          lastSeen: sorted[sorted.length - 1].timestamp,
          sampleJobTitles: [...new Set(eventList.map((e) => e.jobTitle).filter(Boolean))] as string[],
          sampleSnippets: [...new Set(eventList.map((e) => e.jobDescriptionSnippet).filter(Boolean))] as string[],
        };
      })
      .sort((a, b) => b.count - a.count);
  }

  /**
   * Get current buffer size (for monitoring).
   */
  getBufferSize(): number {
    return this.eventBuffer.length;
  }

  /**
   * Shutdown the service and flush remaining events.
   */
  async shutdown(): Promise<void> {
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
      this.flushTimer = null;
    }
    await this.flush();
  }

  /**
   * Convert a miss event to the OTel span event format.
   */
  toSpanEvent(event: TelemetryMissEvent): KeywordMissSpanEvent {
    return {
      name: 'ats.keyword.miss',
      timestamp: new Date(event.timestamp).getTime(),
      attributes: {
        [ATSSemanticConventions.ATTR_KEYWORD_TOKEN]: event.keyword,
        [ATSSemanticConventions.ATTR_KEYWORD_NORMALIZED]: event.normalizedKeyword,
        [ATSSemanticConventions.ATTR_PASS_LEVEL]: event.passLevel,
        [ATSSemanticConventions.ATTR_JOB_TITLE]: event.jobTitle,
        [ATSSemanticConventions.ATTR_JD_SNIPPET]: event.jobDescriptionSnippet,
      },
    };
  }

  private normalizeKeyword(keyword: string): string {
    return keyword
      .toLowerCase()
      .trim()
      .replace(/\s+/g, ' ')
      .replace(/[^\w\s\-+#.]/g, '');
  }

  private startFlushTimer(): void {
    this.flushTimer = setInterval(() => {
      this.flush().catch(() => {
        // Ignore flush errors in timer
      });
    }, this.config.flushIntervalMs);
  }

  private async exportToOTLP(events: readonly TelemetryMissEvent[]): Promise<void> {
    // Convert events to OTLP log format
    const otlpPayload = {
      resourceLogs: [
        {
          resource: {
            attributes: [
              { key: 'service.name', value: { stringValue: this.config.serviceName } },
            ],
          },
          scopeLogs: [
            {
              scope: { name: 'ats.keyword.telemetry', version: '1.0.0' },
              logRecords: events.map((event) => ({
                timeUnixNano: new Date(event.timestamp).getTime() * 1_000_000,
                severityNumber: 9, // INFO
                severityText: 'INFO',
                body: { stringValue: `Keyword miss: ${event.keyword}` },
                attributes: [
                  {
                    key: ATSSemanticConventions.ATTR_KEYWORD_TOKEN,
                    value: { stringValue: event.keyword },
                  },
                  {
                    key: ATSSemanticConventions.ATTR_KEYWORD_NORMALIZED,
                    value: { stringValue: event.normalizedKeyword },
                  },
                  {
                    key: ATSSemanticConventions.ATTR_PASS_LEVEL,
                    value: { intValue: event.passLevel },
                  },
                  {
                    key: ATSSemanticConventions.ATTR_MATCH_RESULT,
                    value: { stringValue: 'miss' },
                  },
                  ...(event.jobTitle
                    ? [
                        {
                          key: ATSSemanticConventions.ATTR_JOB_TITLE,
                          value: { stringValue: event.jobTitle },
                        },
                      ]
                    : []),
                  ...(event.jobDescriptionSnippet
                    ? [
                        {
                          key: ATSSemanticConventions.ATTR_JD_SNIPPET,
                          value: { stringValue: event.jobDescriptionSnippet },
                        },
                      ]
                    : []),
                ],
              })),
            },
          ],
        },
      ],
    };

    try {
      const response = await fetch(`${this.config.otlpEndpoint}/v1/logs`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(otlpPayload),
      });

      if (!response.ok) {
        // Log error but don't throw - telemetry should not break the main flow
        console.error(`OTLP export failed: ${response.status} ${response.statusText}`);
      }
    } catch {
      // Silently ignore network errors for telemetry
    }
  }
}

/** Singleton instance for convenience */
let defaultInstance: TelemetryService | null = null;

export function getTelemetryService(config?: TelemetryServiceConfig): TelemetryService {
  if (!defaultInstance || config) {
    defaultInstance = new TelemetryService(config);
  }
  return defaultInstance;
}

export function resetTelemetryService(): void {
  if (defaultInstance) {
    defaultInstance.shutdown().catch(() => {});
    defaultInstance = null;
  }
}
