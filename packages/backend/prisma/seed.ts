import { PrismaClient, Role, NetworkRoute } from '@prisma/client';
import { hash } from 'bcrypt';
import { encrypt } from '../src/config/crypto.util';

const prisma = new PrismaClient();

const SALT_ROUNDS = 12;

async function main(): Promise<void> {
  console.log('🌱 Seeding Multi-Store Hub…');

  // ─── Users ────────────────────────────────────────────────────────────
  const users = [
    {
      email: 'admin@hub.local',
      fullName: 'Hub Admin',
      password: 'Admin@123',
      role: Role.ADMIN,
    },
    {
      email: 'warehouse@hub.local',
      fullName: 'Warehouse Staff',
      password: 'Warehouse@123',
      role: Role.WAREHOUSE_STAFF,
    },
    {
      email: 'viewer@hub.local',
      fullName: 'Read Only Viewer',
      password: 'Viewer@123',
      role: Role.VIEWER,
    },
  ];

  for (const u of users) {
    const passwordHash = await hash(u.password, SALT_ROUNDS);
    await prisma.user.upsert({
      where: { email: u.email },
      update: { passwordHash, fullName: u.fullName, role: u.role, isActive: true },
      create: { email: u.email, fullName: u.fullName, passwordHash, role: u.role, isActive: true },
    });
    console.log(`  ✓ user ${u.email} (${u.role})`);
  }

  // ─── Example products ─────────────────────────────────────────────────
  const products = [
    {
      skuMaster: 'SKU-0001',
      name: 'Organic Almond 500g',
      description: 'Premium organic almonds, 500g pack.',
      category: 'Snacks',
      basePrice: 12.5,
      totalStock: 240,
      lowStockThreshold: 50,
      expiryDate: new Date(Date.now() + 1000 * 60 * 60 * 24 * 120),
      barcode: '6291234500011',
    },
    {
      skuMaster: 'SKU-0002',
      name: 'Cold-Pressed Olive Oil 750ml',
      description: 'Extra virgin cold-pressed olive oil.',
      category: 'Pantry',
      basePrice: 18.9,
      totalStock: 30,
      lowStockThreshold: 40,
      expiryDate: new Date(Date.now() + 1000 * 60 * 60 * 24 * 60),
      barcode: '6291234500028',
    },
    {
      skuMaster: 'SKU-0003',
      name: 'Saffron 1g Glass Jar',
      description: 'Pure Persian saffron, 1g jar.',
      category: 'Spices',
      basePrice: 9.0,
      totalStock: 5,
      lowStockThreshold: 10,
      expiryDate: null,
      barcode: '6291234500035',
    },
  ];

  const admin = await prisma.user.findUnique({ where: { email: 'admin@hub.local' } });
  if (!admin) throw new Error('Seed admin user missing');

  for (const p of products) {
    const product = await prisma.product.upsert({
      where: { skuMaster: p.skuMaster },
      update: {},
      create: {
        skuMaster: p.skuMaster,
        name: p.name,
        description: p.description,
        category: p.category,
        basePrice: p.basePrice,
        totalStock: p.totalStock,
        lowStockThreshold: p.lowStockThreshold,
        expiryDate: p.expiryDate,
        barcode: p.barcode,
      },
    });

    // Record the initial stock as an IMPORT inventory log (idempotent-ish via upsert check).
    const existing = await prisma.inventoryLog.findFirst({
      where: { productId: product.id, reason: 'IMPORT' },
    });
    if (!existing) {
      await prisma.inventoryLog.create({
        data: {
          productId: product.id,
          changeAmount: p.totalStock,
          reason: 'IMPORT',
          createdByUserId: admin.id,
        },
      });
    }
    console.log(`  ✓ product ${p.skuMaster} (stock=${p.totalStock})`);
  }

  // ─── Example site (encrypted credentials, masked in DB) ───────────────
  if (!process.env.ENCRYPTION_KEY) {
    console.warn('  ! ENCRYPTION_KEY missing — skipping example site credentials encryption.');
  } else {
    const site = await prisma.siteConfig.findFirst({ where: { name: 'Demo IR-hosted store' } });
    if (!site) {
      await prisma.siteConfig.create({
        data: {
          name: 'Demo IR-hosted store',
          baseUrl: 'https://demo-ir-store.example.ir',
          consumerKeyEncrypted: encrypt('ck_demo_consumer_key'),
          consumerSecretEncrypted: encrypt('cs_demo_consumer_secret'),
          networkRoute: NetworkRoute.DIRECT,
          isActive: true,
        },
      });
      console.log('  ✓ site Demo IR-hosted store (DIRECT)');
    }

    const site2 = await prisma.siteConfig.findFirst({ where: { name: 'Demo Foreign store' } });
    if (!site2) {
      await prisma.siteConfig.create({
        data: {
          name: 'Demo Foreign store',
          baseUrl: 'https://demo-foreign-store.example.com',
          consumerKeyEncrypted: encrypt('ck_demo_consumer_key_2'),
          consumerSecretEncrypted: encrypt('cs_demo_consumer_secret_2'),
          networkRoute: NetworkRoute.VIA_FOREIGN_PROXY,
          isActive: true,
        },
      });
      console.log('  ✓ site Demo Foreign store (VIA_FOREIGN_PROXY)');
    }
  }

  console.log('🌱 Seeding complete.');
}

main()
  .catch((err) => {
    console.error('Seed failed:', err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
