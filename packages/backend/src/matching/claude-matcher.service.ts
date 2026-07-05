import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Environment } from '../config/env.validation';
import type { FuzzyMatchCandidate } from './matching.types';

export interface ClaudePair {
  siteTitle: string;
  hubName: string;
  skuMaster: string;
}

export interface ClaudeMatchResult {
  sameProduct: boolean;
  confidence: number;
  reasoning: string;
}

/**
 * Optional Stage-2 matcher: sends ambiguous pairs to Anthropic Claude in
 * batches. When ANTHROPIC_API_KEY is empty the service is a no-op and the
 * caller keeps fuzzy scores only.
 */
@Injectable()
export class ClaudeMatcherService {
  private readonly logger = new Logger(ClaudeMatcherService.name);

  constructor(private readonly config: ConfigService<Environment, true>) {}

  isEnabled(): boolean {
    return Boolean(this.config.get('ANTHROPIC_API_KEY', { infer: true })?.trim());
  }

  async reviewPairs(pairs: ClaudePair[]): Promise<ClaudeMatchResult[]> {
    if (pairs.length === 0) return [];
    const apiKey = this.config.get('ANTHROPIC_API_KEY', { infer: true })?.trim();
    if (!apiKey) {
      return pairs.map(() => ({
        sameProduct: false,
        confidence: 0,
        reasoning: 'AI review skipped (ANTHROPIC_API_KEY not configured)',
      }));
    }

    const model = this.config.get('MATCH_CLAUDE_MODEL', { infer: true });
    const lines = pairs
      .map(
        (p, i) =>
          `${i + 1}. Site: "${p.siteTitle}" | Hub: "${p.hubName}" (SKU ${p.skuMaster})`,
      )
      .join('\n');

    const body = {
      model,
      max_tokens: 1024,
      messages: [
        {
          role: 'user',
          content:
            'You help match WooCommerce product titles to a central warehouse catalog. ' +
            'For each numbered pair below, decide if they refer to the same physical product ' +
            '(same item sold under slightly different titles). Reply ONLY with a JSON array, ' +
            'one object per pair, in order: ' +
            '[{"sameProduct":boolean,"confidence":0-100,"reasoning":"brief"}].\n\n' +
            lines,
        },
      ],
    };

    try {
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(`Anthropic HTTP ${res.status}: ${text.slice(0, 200)}`);
      }
      const data = (await res.json()) as {
        content?: { type: string; text?: string }[];
      };
      const raw = data.content?.find((c) => c.type === 'text')?.text ?? '[]';
      const parsed = JSON.parse(this.extractJsonArray(raw)) as ClaudeMatchResult[];
      if (!Array.isArray(parsed) || parsed.length !== pairs.length) {
        throw new Error('Unexpected Claude response shape');
      }
      return parsed.map((r) => ({
        sameProduct: Boolean(r.sameProduct),
        confidence: Number(r.confidence) || 0,
        reasoning: String(r.reasoning ?? '').slice(0, 500),
      }));
    } catch (err) {
      this.logger.warn(`Claude batch failed: ${(err as Error).message}`);
      return pairs.map(() => ({
        sameProduct: false,
        confidence: 0,
        reasoning: `AI review failed: ${(err as Error).message}`,
      }));
    }
  }

  private extractJsonArray(text: string): string {
    const start = text.indexOf('[');
    const end = text.lastIndexOf(']');
    if (start >= 0 && end > start) return text.slice(start, end + 1);
    return text;
  }
}

/** Score a site title against hub catalog entries using fuzzball. */
export function scoreSiteTitleAgainstCatalog(
  siteTitle: string,
  hubProducts: { id: string; skuMaster: string; name: string }[],
  definiteThreshold: number,
  rejectThreshold: number,
  ratioFn: (a: string, b: string) => number,
): FuzzyMatchCandidate | null {
  const normalizedSite = siteTitle.trim().toLowerCase();
  if (!normalizedSite) return null;

  let best: FuzzyMatchCandidate | null = null;
  for (const p of hubProducts) {
    const score = ratioFn(normalizedSite, p.name.trim().toLowerCase());
    if (!best || score > best.score) {
      let tier: FuzzyMatchCandidate['tier'] = 'review';
      if (score >= definiteThreshold) tier = 'definite';
      else if (score < rejectThreshold) tier = 'reject';
      best = {
        productId: p.id,
        skuMaster: p.skuMaster,
        hubName: p.name,
        score,
        tier,
      };
    }
  }
  return best;
}
