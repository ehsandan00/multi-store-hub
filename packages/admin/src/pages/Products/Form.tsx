import { useState, useEffect, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { productsApi, toApiError } from '../../lib/api';
import { useToast } from '../../lib/toast';
import { useAuthStore } from '../../lib/auth-store';
import { Modal } from '../../components/ui/Modal';
import { Button } from '../../components/ui/Button';
import { Input, Textarea, Select } from '../../components/ui/Field';
import { ProductHubPhoto, uploadPendingHubPhoto } from '../../components/products/ProductHubPhoto';
import { ProductExpiryEditor } from '../../components/products/ProductExpiryEditor';
import { BarcodeScannerModal } from '../../components/products/BarcodeScannerModal';
import { ParentProductPicker } from '../../components/products/ParentProductPicker';
import { applyScannedBarcode } from '../../lib/barcode';
import { pickOcrSearchQueries } from '../../lib/ocr';
import type { ScanSource } from '../../lib/product-scan';
import {
  formatVariationAttributes,
  parseVariationAttributesText,
} from '../../lib/variation-attributes';
import type {
  CreateProductPayload,
  ProductExpiryBatchInput,
  ProductRow,
  ProductType,
  UpdateProductPayload,
} from '../../lib/types';
import { toInputDate } from '../../lib/utils';

interface Props {
  open: boolean;
  onClose: () => void;
  initial?: ProductRow | null;
  prefill?: { skuMaster?: string; barcode?: string };
}

type FormState = CreateProductPayload & {
  variationAttributesText: string;
  parentLabel: string;
};

const EMPTY: FormState = {
  skuMaster: '',
  name: '',
  description: '',
  category: '',
  basePrice: 0,
  totalStock: 0,
  lowStockThreshold: 0,
  imageUrl: '',
  barcode: '',
  productType: 'SIMPLE',
  parentId: null,
  variationAttributesText: '',
  parentLabel: '',
};

function batchesFromProduct(initial?: ProductRow | null): ProductExpiryBatchInput[] {
  if (!initial?.expiryBatches?.length) {
    if (initial?.expiryDate) {
      return [{ expiryDate: toInputDate(initial.expiryDate), quantity: initial.totalStock ?? 0 }];
    }
    return [];
  }
  return initial.expiryBatches.map((b) => ({
    expiryDate: toInputDate(b.expiryDate),
    quantity: b.quantity,
  }));
}

function buildForm(initial?: ProductRow | null, prefill?: Props['prefill']): FormState {
  if (initial) {
    const parentLabel =
      initial.parentSku && initial.parentName
        ? `${initial.parentName} (${initial.parentSku})`
        : initial.parentSku ?? '';
    return {
      skuMaster: initial.skuMaster,
      name: initial.name,
      description: initial.description ?? '',
      category: initial.category ?? '',
      basePrice: Number(initial.basePrice),
      totalStock: initial.totalStock ?? 0,
      lowStockThreshold: initial.lowStockThreshold,
      imageUrl: initial.imageUrl ?? '',
      barcode: initial.barcode ?? '',
      productType: initial.productType ?? 'SIMPLE',
      parentId: initial.parentId,
      variationAttributesText: formatVariationAttributes(initial.variationAttributes),
      parentLabel,
    };
  }
  return {
    ...EMPTY,
    skuMaster: prefill?.skuMaster ?? '',
    barcode: prefill?.barcode ?? prefill?.skuMaster ?? '',
  };
}

const PRODUCT_TYPES: ProductType[] = ['SIMPLE', 'VARIABLE', 'VARIATION'];

export function ProductFormModal({ open, onClose, initial, prefill }: Props) {
  const { t } = useTranslation();
  const isEdit = !!initial;
  const toast = useToast();
  const qc = useQueryClient();
  const { user } = useAuthStore();
  const canEditStock = user?.role === 'ADMIN' || user?.role === 'WAREHOUSE_STAFF';

  const [form, setForm] = useState<FormState>(() => buildForm(initial, prefill));
  const [expiryBatches, setExpiryBatches] = useState<ProductExpiryBatchInput[]>(() =>
    batchesFromProduct(initial),
  );
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [scanOpen, setScanOpen] = useState(false);
  const [pendingHubPhoto, setPendingHubPhoto] = useState<File | null>(null);

  useEffect(() => {
    if (!open) return;
    setForm(buildForm(initial, prefill));
    setExpiryBatches(batchesFromProduct(initial));
    setErrors({});
    setPendingHubPhoto(null);
  }, [open, initial?.id, prefill?.skuMaster, prefill?.barcode]);

  const productType = form.productType ?? 'SIMPLE';
  const isVariable = productType === 'VARIABLE';
  const isVariation = productType === 'VARIATION';

  function setFormField<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((f) => ({ ...f, [key]: value }));
    setErrors((e) => ({ ...e, [key]: '' }));
  }

  function setProductType(next: ProductType) {
    setForm((f) => ({
      ...f,
      productType: next,
      parentId: next === 'VARIATION' ? f.parentId : null,
      parentLabel: next === 'VARIATION' ? f.parentLabel : '',
      variationAttributesText: next === 'VARIATION' ? f.variationAttributesText : '',
      totalStock: next === 'VARIABLE' ? 0 : f.totalStock,
    }));
    setErrors({});
  }

  function handleScan(value: string, meta?: { source: ScanSource }) {
    if (meta?.source === 'ocr') {
      const name = pickOcrSearchQueries(value)[0];
      if (name) setFormField('name', name);
      toast.success(t('products.scanNameFilled'));
      return true;
    }
    applyScannedBarcode(value, {
      setSku: (v) => setFormField('skuMaster', v),
      setBarcode: (v) => setFormField('barcode', v),
      currentSku: form.skuMaster,
    });
    toast.success(t('products.scanFilled'));
    return true;
  }

  function validate(): boolean {
    const e: Record<string, string> = {};
    if (!form.skuMaster.trim()) e.skuMaster = t('products.validation.skuRequired');
    if (!form.name.trim()) e.name = t('products.validation.nameRequired');

    if (!isVariable && form.basePrice <= 0) {
      e.basePrice = t('products.validation.pricePositive');
    }
    if (form.basePrice < 0) e.basePrice = t('products.validation.priceNegative');

    if (isVariation) {
      if (!form.parentId) e.parentId = t('products.validation.parentRequired');
      const attrs = parseVariationAttributesText(form.variationAttributesText);
      if (!attrs) e.variationAttributesText = t('products.validation.variationAttributesRequired');
    }

    if (!isVariable && form.totalStock !== undefined && form.totalStock < 0) {
      e.totalStock = t('products.validation.stockNegative');
    }
    if (form.lowStockThreshold !== undefined && form.lowStockThreshold < 0) {
      e.lowStockThreshold = t('products.validation.thresholdNegative');
    }
    setErrors(e);
    return Object.keys(e).length === 0;
  }

  function buildExpiryPayload(): ProductExpiryBatchInput[] {
    return expiryBatches.filter((b) => b.expiryDate.trim() !== '');
  }

  function buildPayload(): CreateProductPayload {
    const normalize = (s: string | undefined): string | undefined =>
      !s || s.trim() === '' ? undefined : s.trim();

    const variationAttributes = isVariation
      ? parseVariationAttributesText(form.variationAttributesText)
      : null;

    return {
      skuMaster: form.skuMaster.trim(),
      name: form.name.trim(),
      description: normalize(form.description),
      category: normalize(form.category),
      basePrice: form.basePrice,
      expiryBatches: buildExpiryPayload(),
      totalStock: isVariable ? form.totalStock ?? 0 : form.totalStock,
      lowStockThreshold: form.lowStockThreshold,
      imageUrl: normalize(form.imageUrl),
      barcode: normalize(form.barcode),
      productType,
      parentId: isVariation ? form.parentId : null,
      variationAttributes,
    };
  }

  const createMut = useMutation({
    mutationFn: async (args: { payload: CreateProductPayload; hubPhoto: File | null }) => {
      const product = await productsApi.create(args.payload);
      if (args.hubPhoto) {
        await uploadPendingHubPhoto(product.id, args.hubPhoto);
      }
      return product;
    },
    onSuccess: (product) => {
      toast.success(t('products.createdSuccess'));
      qc.invalidateQueries({ queryKey: ['products'] });
      qc.invalidateQueries({ queryKey: ['products', 'categories'] });
      qc.invalidateQueries({ queryKey: ['products', product.id] });
      onClose();
    },
    onError: (err) => toast.error(t('products.createFailed'), toApiError(err).message),
  });

  const updateMut = useMutation({
    mutationFn: ({ id, p }: { id: string; p: UpdateProductPayload }) =>
      productsApi.update(id, p),
    onSuccess: () => {
      toast.success(t('products.updatedSuccess'));
      qc.invalidateQueries({ queryKey: ['products'] });
      qc.invalidateQueries({ queryKey: ['products', 'categories'] });
      if (initial?.id) qc.invalidateQueries({ queryKey: ['products', initial.id] });
      onClose();
    },
    onError: (err) => toast.error(t('products.updateFailed'), toApiError(err).message),
  });

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!validate()) return;

    const payload = buildPayload();
    const { skuMaster: _sku, ...updateBody } = payload;

    if (isEdit && initial) {
      updateMut.mutate({ id: initial.id, p: updateBody });
    } else {
      createMut.mutate({ payload, hubPhoto: pendingHubPhoto });
    }
  }

  const submitting = createMut.isPending || updateMut.isPending;

  return (
    <>
      <Modal
        open={open}
        onClose={onClose}
        title={isEdit ? t('products.editTitle', { sku: initial?.skuMaster }) : t('products.newTitle')}
        description={isEdit ? t('products.descEdit') : t('products.descNew')}
        size="lg"
        footer={
          <>
            <Button variant="secondary" onClick={onClose} type="button" disabled={submitting}>
              {t('common.cancel')}
            </Button>
            <Button type="submit" form="product-form" loading={submitting}>
              {isEdit ? t('common.save') : t('products.createProduct')}
            </Button>
          </>
        }
      >
        <form id="product-form" onSubmit={handleSubmit} className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <Select
              id="productType"
              label={t('products.productType')}
              value={productType}
              disabled={isEdit}
              onChange={(e) => setProductType(e.target.value as ProductType)}
              hint={isEdit ? t('products.productTypeLocked') : t('products.productTypeHint')}
            >
              {PRODUCT_TYPES.map((type) => (
                <option key={type} value={type}>
                  {t(`products.productTypes.${type}`, type)}
                </option>
              ))}
            </Select>
          </div>

          {isVariation && (
            <>
              <div className="sm:col-span-2">
                <ParentProductPicker
                  value={form.parentId ?? null}
                  selectedLabel={form.parentLabel}
                  excludeId={initial?.id}
                  onChange={(id, product) => {
                    setFormField('parentId', id);
                    setFormField(
                      'parentLabel',
                      product ? `${product.name} (${product.skuMaster})` : '',
                    );
                  }}
                  error={errors.parentId}
                />
              </div>
              <div className="sm:col-span-2">
                <Input
                  id="variationAttributes"
                  label={t('products.variationAttributes')}
                  required
                  value={form.variationAttributesText}
                  onChange={(e) => setFormField('variationAttributesText', e.target.value)}
                  error={errors.variationAttributesText}
                  placeholder="Color:Red|Size:L"
                  hint={t('products.variationAttributesHint')}
                />
              </div>
            </>
          )}

          {isVariable && (
            <p className="sm:col-span-2 rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600">
              {t('products.variableParentHint')}
            </p>
          )}

          <div className="space-y-2">
            <Input
              id="skuMaster"
              label={t('products.masterSku')}
              required
              disabled={isEdit}
              value={form.skuMaster}
              onChange={(e) => setFormField('skuMaster', e.target.value)}
              error={errors.skuMaster}
              hint={isEdit ? t('products.skuHintEdit') : t('products.skuHintNew')}
            />
          </div>
          <Input
            id="name"
            label={t('products.name')}
            required
            value={form.name}
            onChange={(e) => setFormField('name', e.target.value)}
            error={errors.name}
          />
          <div className="sm:col-span-2">
            <Textarea
              id="description"
              label={t('products.description')}
              rows={2}
              value={form.description ?? ''}
              onChange={(e) => setFormField('description', e.target.value)}
            />
          </div>
          <Input
            id="category"
            label={t('products.category')}
            value={form.category ?? ''}
            onChange={(e) => setFormField('category', e.target.value)}
          />
          <div className="space-y-2">
            <Input
              id="barcode"
              label={t('products.barcode')}
              value={form.barcode ?? ''}
              onChange={(e) => setFormField('barcode', e.target.value)}
            />
          </div>
          <div className="sm:col-span-2 flex flex-wrap gap-2">
            <Button type="button" size="sm" variant="secondary" onClick={() => setScanOpen(true)}>
              {t('products.scanBarcode')}
            </Button>
            <p className="self-center text-xs text-slate-500">{t('products.scanAutoFillHint')}</p>
          </div>
          <Input
            id="basePrice"
            label={t('products.basePrice')}
            type="number"
            step="0.01"
            min="0"
            required={!isVariable}
            value={form.basePrice}
            onChange={(e) => setFormField('basePrice', Number(e.target.value))}
            error={errors.basePrice}
            hint={isVariable ? t('products.variablePriceHint') : undefined}
          />
          {!isVariable && <ProductExpiryEditor batches={expiryBatches} onChange={setExpiryBatches} />}
          {!isVariable && (
            <Input
              id="totalStock"
              label={t('products.totalStock')}
              type="number"
              min="0"
              disabled={!canEditStock}
              value={form.totalStock ?? 0}
              onChange={(e) => setFormField('totalStock', Number(e.target.value))}
              error={errors.totalStock}
              hint={canEditStock ? undefined : t('products.stockViewerHint')}
            />
          )}
          <Input
            id="lowStockThreshold"
            label={t('products.lowStockThreshold')}
            type="number"
            min="0"
            value={form.lowStockThreshold ?? 0}
            onChange={(e) => setFormField('lowStockThreshold', Number(e.target.value))}
            error={errors.lowStockThreshold}
          />
          <div className="sm:col-span-2">
            <Input
              id="imageUrl"
              label={t('products.imageUrl')}
              value={form.imageUrl ?? ''}
              onChange={(e) => setFormField('imageUrl', e.target.value)}
              hint={t('products.imageUrlHint')}
            />
          </div>
          <div className="sm:col-span-2 rounded-lg border border-brand-100 bg-brand-50/40 p-4">
            <ProductHubPhoto
              productId={isEdit ? initial?.id : undefined}
              hasHubPhoto={initial?.hasHubPhoto}
              canEdit={canEditStock || user?.role === 'ADMIN'}
              pendingFile={pendingHubPhoto}
              onPendingFileChange={isEdit ? undefined : setPendingHubPhoto}
            />
          </div>
        </form>
      </Modal>

      <BarcodeScannerModal open={scanOpen} onClose={() => setScanOpen(false)} onScan={handleScan} />
    </>
  );
}
