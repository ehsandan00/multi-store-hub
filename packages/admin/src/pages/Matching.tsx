import { useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { matchingApi, sitesApi, toApiError } from '../lib/api';
import { useAuthStore } from '../lib/auth-store';
import { useToast } from '../lib/toast';
import { Button } from '../components/ui/Button';
import { Badge } from '../components/ui/Badge';
import { Spinner } from '../components/ui/Spinner';
import { Select } from '../components/ui/Field';
import type { MatchingPreview } from '../lib/types';

/**
 * Phase 5: AI product matching review UI.
 * Admin uploads a site product export → fuzzy (+ optional Claude) scoring →
 * suggestions land as PENDING_REVIEW mappings. Nothing is auto-approved.
 */
export function MatchingPage() {
  const { user } = useAuthStore();
  const toast = useToast();
  const qc = useQueryClient();
  const isAdmin = user?.role === 'ADMIN';
  const fileRef = useRef<HTMLInputElement>(null);

  const [siteId, setSiteId] = useState('');
  const [preview, setPreview] = useState<MatchingPreview | null>(null);
  const [page, setPage] = useState(1);

  const sitesQ = useQuery({
    queryKey: ['sites', { page: 1, pageSize: 100 }],
    queryFn: () => sitesApi.list(1, 100),
  });

  const suggestionsQ = useQuery({
    queryKey: ['matching-suggestions', { siteId: siteId || undefined, page }],
    queryFn: () =>
      matchingApi.listSuggestions({
        siteId: siteId || undefined,
        status: 'PENDING_REVIEW',
        page,
        pageSize: 25,
      }),
  });

  const analyzeMut = useMutation({
    mutationFn: ({ sid, file }: { sid: string; file: File }) => matchingApi.analyze(sid, file),
    onSuccess: (res) => {
      setPreview(res);
      toast.success('Analysis complete', `${res.suggestedCount + res.reviewCount} suggestion(s)`);
      qc.invalidateQueries({ queryKey: ['matching-suggestions'] });
    },
    onError: (err) => toast.error('Analysis failed', toApiError(err).message),
  });

  const approveMut = useMutation({
    mutationFn: (id: string) => matchingApi.approve(id),
    onSuccess: () => {
      toast.success('Mapping approved');
      qc.invalidateQueries({ queryKey: ['matching-suggestions'] });
    },
    onError: (err) => toast.error('Approve failed', toApiError(err).message),
  });

  const rejectMut = useMutation({
    mutationFn: (id: string) => matchingApi.reject(id),
    onSuccess: () => {
      toast.success('Suggestion rejected');
      qc.invalidateQueries({ queryKey: ['matching-suggestions'] });
    },
    onError: (err) => toast.error('Reject failed', toApiError(err).message),
  });

  const bulkMut = useMutation({
    mutationFn: () => matchingApi.bulkApprove(siteId || undefined),
    onSuccess: (res) => {
      toast.success('Bulk approve', `${res.approved} mapping(s) approved`);
      qc.invalidateQueries({ queryKey: ['matching-suggestions'] });
    },
    onError: (err) => toast.error('Bulk approve failed', toApiError(err).message),
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-slate-900 sm:text-2xl">Product Matching</h1>
        <p className="mt-1 text-sm text-slate-500">
          Match site product titles to hub SKUs using fuzzy scoring and optional Claude review.
          All suggestions require admin approval before sync uses them.
        </p>
      </div>

      {isAdmin && (
        <div className="card space-y-3 p-4">
          <h2 className="text-sm font-semibold text-slate-800">Analyze site export</h2>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
            <Select
              label="Site"
              value={siteId}
              onChange={(e) => setSiteId(e.target.value)}
              className="sm:min-w-[220px]"
            >
              <option value="">Select site…</option>
              {sitesQ.data?.data.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </Select>
            <div>
              <input
                ref={fileRef}
                type="file"
                accept=".csv,.xlsx,.xls"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f && siteId) analyzeMut.mutate({ sid: siteId, file: f });
                  e.target.value = '';
                }}
              />
              <Button
                type="button"
                loading={analyzeMut.isPending}
                disabled={!siteId}
                onClick={() => fileRef.current?.click()}
              >
                Upload & analyze
              </Button>
            </div>
            <Button
              type="button"
              variant="secondary"
              loading={bulkMut.isPending}
              onClick={() => bulkMut.mutate()}
            >
              Bulk approve ≥95%
            </Button>
          </div>
          {preview && (
            <p className="text-xs text-slate-600">
              Last run: {preview.suggestedCount} definite · {preview.reviewCount} review ·{' '}
              {preview.rejectedCount} rejected · {preview.aiReviewCount} AI-reviewed
            </p>
          )}
        </div>
      )}

      <section className="space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
          Pending suggestions
        </h2>
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Site</th>
                <th>Site title</th>
                <th>Hub SKU</th>
                <th>Hub name</th>
                <th>Confidence</th>
                <th>AI reasoning</th>
                {isAdmin && <th>Actions</th>}
              </tr>
            </thead>
            <tbody>
              {suggestionsQ.isLoading && (
                <tr>
                  <td colSpan={isAdmin ? 7 : 6} className="py-8 text-center">
                    <Spinner className="mx-auto h-5 w-5" />
                  </td>
                </tr>
              )}
              {suggestionsQ.data?.data.map((row) => (
                <tr key={row.id}>
                  <td>{row.site.name}</td>
                  <td className="max-w-[200px] truncate">{row.siteSpecificTitle ?? '—'}</td>
                  <td className="font-mono text-xs">{row.product.skuMaster}</td>
                  <td className="max-w-[180px] truncate">{row.product.name}</td>
                  <td>
                    <Badge tone={row.matchConfidence && row.matchConfidence >= 90 ? 'green' : 'amber'}>
                      {row.matchConfidence?.toFixed(0) ?? '—'}%
                    </Badge>
                  </td>
                  <td className="max-w-[240px] truncate text-xs text-slate-500">
                    {row.matchAiReasoning ?? '—'}
                  </td>
                  {isAdmin && (
                    <td className="space-x-1 whitespace-nowrap">
                      <Button
                        size="sm"
                        variant="secondary"
                        loading={approveMut.isPending}
                        onClick={() => approveMut.mutate(row.id)}
                      >
                        Approve
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        loading={rejectMut.isPending}
                        onClick={() => rejectMut.mutate(row.id)}
                      >
                        Reject
                      </Button>
                    </td>
                  )}
                </tr>
              ))}
              {suggestionsQ.data && suggestionsQ.data.data.length === 0 && (
                <tr>
                  <td colSpan={isAdmin ? 7 : 6} className="py-8 text-center text-slate-400">
                    No pending suggestions. Upload a site export to start matching.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        {suggestionsQ.data && suggestionsQ.data.total > 25 && (
          <div className="flex justify-end gap-2">
            <Button size="sm" variant="secondary" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
              Prev
            </Button>
            <Button
              size="sm"
              variant="secondary"
              disabled={page * 25 >= suggestionsQ.data.total}
              onClick={() => setPage((p) => p + 1)}
            >
              Next
            </Button>
          </div>
        )}
      </section>
    </div>
  );
}
