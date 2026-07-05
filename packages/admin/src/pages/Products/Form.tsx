import { useState, type FormEvent } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { productsApi, toApiError } from '../../lib/api';
import { useToast } from '../../lib/toast';
import { useAuthStore } from '../../lib/auth-store';
import { Modal } from '../../components/ui/Modal';
import { Button } from '../../components/ui/Button';
import { Input, Textarea } from '../../components/ui/Field';
import type { CreateProductPayload, ProductRow, UpdateProductPayload } from '../../lib/types';
import { toInputDate } from '../../lib/utils';

interface Props {
  open: boolean;
  onClose: () => void;
  /** When provided, edit mode; otherwise create. */
  initial?: ProductRow | null;
}

const EMPTY: CreateProductPayload = {
  skuMaster: '',
  name: '',
  description: '',
  category: '',
  basePrice: 0,
  expiryDate: '',
  totalStock: 0,
  lowStockThreshold: 0,
  imageUrl: '',
  barcode: '',
};

export function ProductFormModal({ open, onClose, initial }: Props) {
  const isEdit = !!initial;
  const toast = useToast();
  const qc = useQueryClient();
  const { user } = useAuthStore();
  const canEditStock = user?.role === 'ADMIN' || user?.role === 'WAREHOUSE_STAFF';

  const [form, setForm] = useState<CreateProductPayload>(() =>
    initial
      ? {
          skuMaster: initial.skuMaster,
          name: initial.name,
          description: initial.description ?? '',
          category: initial.category ?? '',
          basePrice: Number(initial.basePrice),
          expiryDate: toInputDate(initial.expiryDate),
          totalStock: initial.totalStock,
          lowStockThreshold: initial.lowStockThreshold,
          imageUrl: initial.imageUrl ?? '',
          barcode: initial.barcode ?? '',
        }
      : EMPTY,
  );
  const [errors, setErrors] = useState<Record<string, string>>({});

  // Reset form when modal opens for a different product
  // (using key on the modal in the parent is also valid; here we keep it simple)
  // Because parent unmounts this component when closed (Modal returns null when !open),
  // the useState above already initializes correctly per open.

  function set<K extends keyof CreateProductPayload>(key: K, value: CreateProductPayload[K]) {
    setForm((f) => ({ ...f, [key]: value }));
    setErrors((e) => ({ ...e, [key]: '' }));
  }

  function validate(): boolean {
    const e: Record<string, string> = {};
    if (!form.skuMaster.trim()) e.skuMaster = 'SKU is required';
    if (!form.name.trim()) e.name = 'Name is required';
    if (!isEdit && form.basePrice <= 0) e.basePrice = 'Price must be > 0';
    if (form.basePrice < 0) e.basePrice = 'Price cannot be negative';
    if (form.totalStock !== undefined && form.totalStock < 0) e.totalStock = 'Stock cannot be negative';
    if (form.lowStockThreshold !== undefined && form.lowStockThreshold < 0)
      e.lowStockThreshold = 'Threshold cannot be negative';
    setErrors(e);
    return Object.keys(e).length === 0;
  }

  const createMut = useMutation({
    mutationFn: (p: CreateProductPayload) => productsApi.create(p),
    onSuccess: () => {
      toast.success('Product created');
      qc.invalidateQueries({ queryKey: ['products'] });
      qc.invalidateQueries({ queryKey: ['products', 'categories'] });
      onClose();
    },
    onError: (err) => toast.error('Failed to create product', toApiError(err).message),
  });

  const updateMut = useMutation({
    mutationFn: ({ id, p }: { id: string; p: UpdateProductPayload }) =>
      productsApi.update(id, p),
    onSuccess: () => {
      toast.success('Product updated');
      qc.invalidateQueries({ queryKey: ['products'] });
      qc.invalidateQueries({ queryKey: ['products', 'categories'] });
      onClose();
    },
    onError: (err) => toast.error('Failed to update product', toApiError(err).message),
  });

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!validate()) return;

    // Normalize empty strings → undefined so the backend doesn't get "" for optional fields.
    const normalize = (s: string | undefined): string | undefined =>
      !s || s.trim() === '' ? undefined : s.trim();

    if (isEdit && initial) {
      const payload: UpdateProductPayload = {
        name: form.name.trim(),
        description: normalize(form.description),
        category: normalize(form.category),
        basePrice: form.basePrice,
        expiryDate: form.expiryDate === '' ? null : form.expiryDate,
        totalStock: canEditStock ? form.totalStock : undefined,
        lowStockThreshold: form.lowStockThreshold,
        imageUrl: normalize(form.imageUrl),
        barcode: normalize(form.barcode),
      };
      updateMut.mutate({ id: initial.id, p: payload });
    } else {
      const payload: CreateProductPayload = {
        skuMaster: form.skuMaster.trim(),
        name: form.name.trim(),
        description: normalize(form.description),
        category: normalize(form.category),
        basePrice: form.basePrice,
        expiryDate: form.expiryDate === '' ? null : form.expiryDate,
        totalStock: form.totalStock,
        lowStockThreshold: form.lowStockThreshold,
        imageUrl: normalize(form.imageUrl),
        barcode: normalize(form.barcode),
      };
      createMut.mutate(payload);
    }
  }

  const submitting = createMut.isPending || updateMut.isPending;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={isEdit ? `Edit ${initial?.skuMaster}` : 'New product'}
      description={
        isEdit
          ? 'Update product details. Stock changes are logged to the inventory history.'
          : 'Create a new central product. SKU must be unique.'
      }
      size="lg"
      footer={
        <>
          <Button variant="secondary" onClick={onClose} type="button" disabled={submitting}>
            Cancel
          </Button>
          <Button type="submit" form="product-form" loading={submitting}>
            {isEdit ? 'Save changes' : 'Create product'}
          </Button>
        </>
      }
    >
      <form id="product-form" onSubmit={handleSubmit} className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Input
          id="skuMaster"
          label="Master SKU"
          required
          disabled={isEdit}
          value={form.skuMaster}
          onChange={(e) => set('skuMaster', e.target.value)}
          error={errors.skuMaster}
          hint={isEdit ? 'SKU cannot be changed after creation' : 'Unique product identifier'}
        />
        <Input
          id="name"
          label="Name"
          required
          value={form.name}
          onChange={(e) => set('name', e.target.value)}
          error={errors.name}
        />
        <div className="sm:col-span-2">
          <Textarea
            id="description"
            label="Description"
            rows={2}
            value={form.description ?? ''}
            onChange={(e) => set('description', e.target.value)}
          />
        </div>
        <Input
          id="category"
          label="Category"
          value={form.category ?? ''}
          onChange={(e) => set('category', e.target.value)}
        />
        <Input
          id="barcode"
          label="Barcode"
          value={form.barcode ?? ''}
          onChange={(e) => set('barcode', e.target.value)}
        />
        <Input
          id="basePrice"
          label="Base price"
          type="number"
          step="0.01"
          min="0"
          required
          value={form.basePrice}
          onChange={(e) => set('basePrice', Number(e.target.value))}
          error={errors.basePrice}
        />
        <Input
          id="expiryDate"
          label="Expiry date"
          type="date"
          value={form.expiryDate ?? ''}
          onChange={(e) => set('expiryDate', e.target.value)}
          hint="Leave empty if no expiry"
        />
        <Input
          id="totalStock"
          label="Total stock"
          type="number"
          min="0"
          disabled={!canEditStock}
          value={form.totalStock ?? 0}
          onChange={(e) => set('totalStock', Number(e.target.value))}
          error={errors.totalStock}
          hint={canEditStock ? undefined : 'Viewers cannot edit stock'}
        />
        <Input
          id="lowStockThreshold"
          label="Low-stock threshold"
          type="number"
          min="0"
          value={form.lowStockThreshold ?? 0}
          onChange={(e) => set('lowStockThreshold', Number(e.target.value))}
          error={errors.lowStockThreshold}
        />
        <div className="sm:col-span-2">
          <Input
            id="imageUrl"
            label="Image URL"
            value={form.imageUrl ?? ''}
            onChange={(e) => set('imageUrl', e.target.value)}
          />
        </div>
      </form>
    </Modal>
  );
}
