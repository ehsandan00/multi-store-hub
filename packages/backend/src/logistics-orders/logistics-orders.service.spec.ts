import { BadRequestException, NotFoundException } from '@nestjs/common';
import { LogisticsOrdersService } from './logistics-orders.service';

describe('LogisticsOrdersService', () => {
  const products = [
    { id: '11111111-1111-4111-8111-111111111111', name: 'محصول اول', skuMaster: 'SKU-1' },
    { id: '22222222-2222-4222-8222-222222222222', name: 'محصول دوم', skuMaster: 'SKU-2' },
  ];

  function makePrisma() {
    const tx = {
      product: {
        findMany: jest.fn().mockResolvedValue(products),
      },
      user: {
        findFirst: jest.fn().mockResolvedValue({ id: 'employee-id' }),
      },
      logisticsOrder: {
        create: jest.fn(async ({ data }: any) => ({
          id: 'order-id',
          ...data,
          createdAt: new Date(),
          updatedAt: new Date(),
          createdBy: { id: 'user-id', fullName: 'Admin', email: 'admin@hub.local' },
          items: data.items.create.map((item: any) => ({ id: `item-${item.productId}`, ...item })),
        })),
        findUnique: jest.fn().mockResolvedValue({ id: 'order-id' }),
        update: jest.fn(async ({ data }: any) => ({
          id: 'order-id',
          orderNumber: 'LG-1',
          receiverName: 'Test',
          phone: '0912',
          city: 'Tehran',
          ...data,
          items: [],
        })),
        count: jest.fn().mockResolvedValue(1),
        findMany: jest.fn().mockResolvedValue([]),
      },
    };
    const prisma = {
      ...tx,
      $transaction: jest.fn(async (arg: any) => {
        if (typeof arg === 'function') return arg(tx);
        return Promise.all(arg);
      }),
    };
    return { prisma, tx };
  }

  it('creates multiple product lines, combines repeated products, and never changes stock', async () => {
    const { prisma, tx } = makePrisma();
    const service = new LogisticsOrdersService(prisma as never);

    const result = await service.create(
      {
        receiverName: ' علی ',
        employeeId: '33333333-3333-4333-8333-333333333333',
        phone: ' 09120000000 ',
        city: ' تهران ',
        status: 'NEED_PRODUCT',
        items: [
          { productId: products[0]!.id, quantity: 1 },
          { productId: products[0]!.id, quantity: 2 },
          { productId: products[1]!.id, quantity: 1 },
        ],
      },
      { id: 'user-id', email: 'admin@hub.local', role: 'ADMIN' },
    );

    const createData = tx.logisticsOrder.create.mock.calls[0]![0].data;
    expect(createData.receiverName).toBe('علی');
    expect(createData.employeeId).toBe('employee-id');
    expect(createData.items.create).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ productId: products[0]!.id, quantity: 3 }),
        expect.objectContaining({ productId: products[1]!.id, quantity: 1 }),
      ]),
    );
    expect(result.itemCount).toBe(4);
    expect((tx.product as any).update).toBeUndefined();
  });

  it('rejects an order if a selected product no longer exists', async () => {
    const { prisma, tx } = makePrisma();
    tx.product.findMany.mockResolvedValueOnce([]);
    const service = new LogisticsOrdersService(prisma as never);

    await expect(
      service.create(
        {
          receiverName: 'Ali',
          employeeId: '33333333-3333-4333-8333-333333333333',
          phone: '0912',
          city: 'Tehran',
          status: 'SENT',
          items: [{ productId: products[0]!.id, quantity: 1 }],
        },
        { id: 'user-id', email: 'admin@hub.local', role: 'ADMIN' },
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('lists with status and text filters', async () => {
    const { prisma, tx } = makePrisma();
    const service = new LogisticsOrdersService(prisma as never);

    await service.list({ status: 'SENT', search: 'تهران', page: 2, pageSize: 10 });

    expect(tx.logisticsOrder.count).toHaveBeenCalledWith({
      where: expect.objectContaining({ status: 'SENT', OR: expect.any(Array) }),
    });
    expect(tx.logisticsOrder.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ skip: 10, take: 10 }),
    );
  });

  it('updates status and reports missing orders', async () => {
    const { prisma, tx } = makePrisma();
    const service = new LogisticsOrdersService(prisma as never);

    await expect(service.updateStatus('order-id', 'CANCELED')).resolves.toEqual(
      expect.objectContaining({ status: 'CANCELED' }),
    );

    tx.logisticsOrder.findUnique.mockResolvedValueOnce(null);
    await expect(service.updateStatus('missing', 'SENT')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});
