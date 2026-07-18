import { useTranslation } from 'react-i18next';
import { Button } from '../ui/Button';
import { Input } from '../ui/Field';
import type { ProductExpiryBatchInput } from '../../lib/types';

interface Props {
  batches: ProductExpiryBatchInput[];
  onChange: (batches: ProductExpiryBatchInput[]) => void;
  disabled?: boolean;
}

const EMPTY_ROW: ProductExpiryBatchInput = { expiryDate: '', quantity: 0 };

export function ProductExpiryEditor({ batches, onChange, disabled }: Props) {
  const { t } = useTranslation();

  function updateRow(index: number, patch: Partial<ProductExpiryBatchInput>) {
    onChange(batches.map((row, i) => (i === index ? { ...row, ...patch } : row)));
  }

  function addRow() {
    onChange([...batches, { ...EMPTY_ROW }]);
  }

  function removeRow(index: number) {
    onChange(batches.filter((_, i) => i !== index));
  }

  const rows = batches.length ? batches : [{ ...EMPTY_ROW }];

  return (
    <div className="space-y-2 sm:col-span-2">
      <div className="flex items-center justify-between gap-2">
        <div>
          <p className="text-sm font-medium text-slate-800">{t('products.expiryBatches')}</p>
          <p className="text-xs text-slate-500">{t('products.expiryBatchesHint')}</p>
        </div>
        {!disabled && (
          <Button type="button" size="sm" variant="secondary" onClick={addRow}>
            {t('products.addExpiry')}
          </Button>
        )}
      </div>
      <div className="space-y-2">
        {rows.map((row, index) => (
          <div
            key={index}
            className="grid grid-cols-1 gap-2 rounded-lg border border-slate-200 p-3 sm:grid-cols-[1fr_120px_auto]"
          >
            <Input
              id={`expiry-${index}`}
              label={t('products.expiryDate')}
              type="date"
              value={row.expiryDate}
              disabled={disabled}
              onChange={(e) => updateRow(index, { expiryDate: e.target.value })}
            />
            <Input
              id={`expiry-qty-${index}`}
              label={t('products.batchQuantity')}
              type="number"
              min="0"
              value={row.quantity ?? 0}
              disabled={disabled}
              onChange={(e) => updateRow(index, { quantity: Number(e.target.value) })}
            />
            {!disabled && rows.length > 1 && (
              <div className="flex items-end">
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  className="text-rose-600 hover:bg-rose-50"
                  onClick={() => removeRow(index)}
                >
                  {t('common.delete')}
                </Button>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
