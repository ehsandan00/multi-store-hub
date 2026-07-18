export const MATCHING_QUEUE_NAME = 'product-matching';

export const MATCHING_MAX_FILE_BYTES = 5 * 1024 * 1024; // 5 MB
export const MATCHING_MAX_ROWS = 2000;
export const MATCHING_CLAUDE_BATCH_SIZE = 10;

/** One row parsed from a site product export (xlsx/csv). */
export interface SiteProductRow {
  row: number;
  siteTitle: string;
  siteSku?: string;
  siteProductId?: string;
}

export type MatchTier = 'definite' | 'review' | 'reject';

export interface FuzzyMatchCandidate {
  productId: string;
  skuMaster: string;
  hubName: string;
  score: number;
  tier: MatchTier;
}

export interface MatchSuggestionRow {
  row: number;
  siteTitle: string;
  siteSku?: string;
  siteProductId?: string;
  productId: string;
  skuMaster: string;
  hubName: string;
  matchConfidence: number;
  tier: MatchTier;
  matchAiReasoning?: string;
  mappingId?: string;
}

export interface MatchingPreview {
  jobId: string;
  fileName: string;
  status: string;
  totalRows: number;
  suggestedCount: number;
  reviewCount: number;
  rejectedCount: number;
  aiReviewCount: number;
  errors: { row: number; message: string }[];
  suggestions: MatchSuggestionRow[];
}

export interface MatchingReport {
  suggested: number;
  review: number;
  rejected: number;
  aiReviewed: number;
  errors: { row: number; message: string }[];
  orphanRows?: { siteTitle: string; siteSku?: string; siteProductId?: string }[];
  startedAt: string;
  finishedAt: string;
}
