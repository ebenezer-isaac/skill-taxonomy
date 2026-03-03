/**
 * OpenTelemetry instrumentation types for capturing ATS parsing telemetry.
 *
 * Supports the logs-to-metrics pipeline described in the strategic architecture:
 * - Structured span/log events for unmapped keywords
 * - Count connector configuration for metric aggregation
 * - OTTL (OpenTelemetry Transformation Language) rule definitions
 */

/** Semantic conventions for ATS parsing spans */
export const ATSSemanticConventions = {
  /** Span name for JD keyword extraction */
  SPAN_JD_KEYWORD_EXTRACTION: 'ats.jd.keyword_extraction',
  /** Span name for resume keyword matching */
  SPAN_RESUME_MATCHING: 'ats.resume.keyword_matching',
  /** Attribute for the extracted keyword token */
  ATTR_KEYWORD_TOKEN: 'ats.keyword.token',
  /** Attribute for the normalized form */
  ATTR_KEYWORD_NORMALIZED: 'ats.keyword.normalized',
  /** Attribute for the pass level (2 = exact, 3 = fuzzy) */
  ATTR_PASS_LEVEL: 'ats.pass.level',
  /** Attribute for match result */
  ATTR_MATCH_RESULT: 'ats.match.result',
  /** Attribute for job title context */
  ATTR_JOB_TITLE: 'ats.context.job_title',
  /** Attribute for JD snippet */
  ATTR_JD_SNIPPET: 'ats.context.jd_snippet',
} as const;

/** Match results for keyword parsing */
export type MatchResult = 'matched' | 'miss' | 'fuzzy-match' | 'semantic-match';

/** Configuration for the OpenTelemetry Collector pipeline */
export interface OTelCollectorConfig {
  readonly receivers: {
    readonly otlp: {
      readonly protocols: {
        readonly grpc?: { readonly endpoint: string };
        readonly http?: { readonly endpoint: string };
      };
    };
  };
  readonly processors: {
    readonly batch?: {
      readonly timeout?: string;
      readonly send_batch_size?: number;
    };
    readonly transform?: {
      readonly log_statements: readonly OTTLStatement[];
    };
  };
  readonly connectors: {
    readonly count?: CountConnectorConfig;
  };
  readonly exporters: {
    readonly prometheus?: { readonly endpoint: string };
    readonly otlp?: { readonly endpoint: string };
  };
  readonly service: {
    readonly pipelines: {
      readonly logs?: PipelineConfig;
      readonly metrics?: PipelineConfig;
    };
  };
}

/** OTTL statement for transformation */
export interface OTTLStatement {
  readonly context: 'log' | 'span' | 'metric';
  readonly statements: readonly string[];
  readonly conditions?: readonly string[];
}

/** Count connector configuration for logs-to-metrics */
export interface CountConnectorConfig {
  readonly logs: {
    readonly ats_keyword_miss_total: {
      readonly description: string;
      readonly conditions: readonly string[];
      readonly attributes: readonly CountAttribute[];
    };
  };
}

/** Attribute extraction for count metrics */
export interface CountAttribute {
  readonly key: string;
  readonly default_value?: string;
}

/** Pipeline configuration for OTel Collector */
export interface PipelineConfig {
  readonly receivers: readonly string[];
  readonly processors: readonly string[];
  readonly exporters: readonly string[];
}

/** Instrumented event for keyword miss */
export interface KeywordMissSpanEvent {
  readonly name: 'ats.keyword.miss';
  readonly timestamp: number;
  readonly attributes: {
    readonly [ATSSemanticConventions.ATTR_KEYWORD_TOKEN]: string;
    readonly [ATSSemanticConventions.ATTR_KEYWORD_NORMALIZED]: string;
    readonly [ATSSemanticConventions.ATTR_PASS_LEVEL]: 2 | 3;
    readonly [ATSSemanticConventions.ATTR_JOB_TITLE]?: string;
    readonly [ATSSemanticConventions.ATTR_JD_SNIPPET]?: string;
  };
}

/** Aggregated metric counter from the logs-to-metrics pipeline */
export interface AggregatedMissMetric {
  readonly name: 'ats_keyword_miss_total';
  readonly value: number;
  readonly attributes: {
    readonly keyword: string;
    readonly normalized: string;
  };
  readonly startTime: string;
  readonly endTime: string;
}

/** Generate default OTel Collector config for ATS miss logging */
export function generateDefaultCollectorConfig(): OTelCollectorConfig {
  return {
    receivers: {
      otlp: {
        protocols: {
          grpc: { endpoint: '0.0.0.0:4317' },
          http: { endpoint: '0.0.0.0:4318' },
        },
      },
    },
    processors: {
      batch: {
        timeout: '1s',
        send_batch_size: 1024,
      },
      transform: {
        log_statements: [
          {
            context: 'log',
            conditions: [
              `attributes["${ATSSemanticConventions.ATTR_MATCH_RESULT}"] == "miss"`,
            ],
            statements: [
              // Route misses to the count connector
              'set(attributes["routed_to"], "count")',
            ],
          },
        ],
      },
    },
    connectors: {
      count: {
        logs: {
          ats_keyword_miss_total: {
            description: 'Count of unmatched keywords in ATS parsing',
            conditions: [
              `attributes["${ATSSemanticConventions.ATTR_MATCH_RESULT}"] == "miss"`,
            ],
            attributes: [
              { key: 'keyword', default_value: 'unknown' },
              { key: 'normalized', default_value: 'unknown' },
            ],
          },
        },
      },
    },
    exporters: {
      prometheus: { endpoint: '0.0.0.0:8889' },
    },
    service: {
      pipelines: {
        logs: {
          receivers: ['otlp'],
          processors: ['batch', 'transform'],
          exporters: ['count'],
        },
        metrics: {
          receivers: ['count'],
          processors: ['batch'],
          exporters: ['prometheus'],
        },
      },
    },
  };
}

/** YAML serialization helper for OTel Collector config */
export function serializeCollectorConfigToYAML(config: OTelCollectorConfig): string {
  return toYAML(config);
}

/** Simple YAML serializer (no external deps) */
function toYAML(obj: unknown, indent = 0): string {
  const spaces = '  '.repeat(indent);

  if (obj === null || obj === undefined) {
    return 'null';
  }

  if (typeof obj === 'string') {
    // Quote strings with special characters
    if (obj.includes(':') || obj.includes('#') || obj.includes("'") || obj.includes('"')) {
      return `"${obj.replace(/"/g, '\\"')}"`;
    }
    return obj;
  }

  if (typeof obj === 'number' || typeof obj === 'boolean') {
    return String(obj);
  }

  if (Array.isArray(obj)) {
    if (obj.length === 0) return '[]';
    return obj.map((item) => `${spaces}- ${toYAML(item, indent + 1).trimStart()}`).join('\n');
  }

  if (typeof obj === 'object') {
    const entries = Object.entries(obj);
    if (entries.length === 0) return '{}';
    return entries
      .map(([key, value]) => {
        const valueStr = toYAML(value, indent + 1);
        if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
          return `${spaces}${key}:\n${valueStr}`;
        }
        if (Array.isArray(value)) {
          return `${spaces}${key}:\n${valueStr}`;
        }
        return `${spaces}${key}: ${valueStr}`;
      })
      .join('\n');
  }

  return String(obj);
}
