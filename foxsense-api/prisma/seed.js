import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
  console.log('Seeding database...');

  // Create demo users
  const adminPassword = await bcrypt.hash('zm2a-aok10', 12);
  const userPassword = await bcrypt.hash('password123', 12);

  const admin = await prisma.user.upsert({
    where: { email: 'info@geoalpine.net' },
    update: {},
    create: {
      email: 'info@geoalpine.net',
      passwordHash: adminPassword,
      name: '管理者',
      role: 'ADMIN',
    },
  });

  const user = await prisma.user.upsert({
    where: { email: 'user@foxsense.jp' },
    update: {},
    create: {
      email: 'user@foxsense.jp',
      passwordHash: userPassword,
      name: 'テストユーザー',
      role: 'USER',
    },
  });

  console.log('Created users:', { admin: admin.email, user: user.email });
  // Remove old admin if it exists (migration from admin@foxsense.jp)
  await prisma.user.deleteMany({ where: { email: 'admin@foxsense.jp' } });

  // Create demo parent device for user
  const parentDevice = await prisma.parentDevice.upsert({
    where: { deviceId: 'FOXSENSE-001' },
    update: {},
    create: {
      userId: user.id,
      deviceId: 'FOXSENSE-001',
      name: '親機（LTE通信ユニット）',
      location: 'スイカハウス 入口',
      simStatus: 'ACTIVE',
    },
  });

  console.log('Created parent device:', parentDevice.deviceId);

  // Create alert settings
  await prisma.alertSettings.upsert({
    where: { parentId: parentDevice.id },
    update: {},
    create: {
      parentId: parentDevice.id,
      tempMin: 10,
      tempMax: 35,
      humidityMin: 40,
      humidityMax: 85,
      frostWarning: 3,
      frostCritical: 0,
      emailEnabled: true,
      lineEnabled: false,
    },
  });

  // Create demo child devices (userId-owned)
  const childDevices = [
    { deviceId: '1A2B3C01', name: 'スイカハウス 北側', location: '入口から10m' },
    { deviceId: '1A2B3C02', name: 'スイカハウス 南側', location: '換気扇付近' },
    { deviceId: '1A2B3C03', name: 'さくらんぼハウス', location: '中央通路' },
  ];

  for (const child of childDevices) {
    const created = await prisma.childDevice.upsert({
      where: { deviceId: child.deviceId },
      update: {},
      create: {
        userId: user.id,
        ...child,
      },
    });
    // Assign to parent device
    await prisma.deviceAssignment.upsert({
      where: {
        id: `seed-${child.deviceId}`,
      },
      update: {},
      create: {
        id: `seed-${child.deviceId}`,
        parentId: parentDevice.id,
        childId: created.id,
        pairingStatus: 'PAIRED',
      },
    });
  }

  // Create FoxCoin packages (stripePriceId は環境変数から設定)
  const packages = [
    { name: 'スターター',   coins: 30,  stripePriceId: process.env.STRIPE_FOXCOIN_PRICE_30  || null },
    { name: 'スタンダード', coins: 100, stripePriceId: process.env.STRIPE_FOXCOIN_PRICE_100 || null },
    { name: 'プロ',         coins: 200, stripePriceId: process.env.STRIPE_FOXCOIN_PRICE_200 || null },
    { name: 'マックス',     coins: 300, stripePriceId: process.env.STRIPE_FOXCOIN_PRICE_300 || null },
  ];
  for (const pkg of packages) {
    await prisma.foxCoinPackage.upsert({
      where: { id: `pkg-${pkg.coins}` },
      update: { stripePriceId: pkg.stripePriceId },
      create: { id: `pkg-${pkg.coins}`, ...pkg },
    });
  }
  console.log('Created FoxCoin packages:', packages.length);

  // Give user some FoxCoins
  await prisma.foxCoinBalance.upsert({
    where: { userId: user.id },
    update: {},
    create: { userId: user.id, balance: 30, simStatus: 'ACTIVE' },
  });

  console.log('Created child devices:', childDevices.length);

  // Generate sample sensor data (last 24 hours)
  const now = new Date();
  const sensorDataPoints = [];

  for (let i = 144; i >= 0; i--) {
    const timestamp = new Date(now.getTime() - i * 10 * 60 * 1000); // 10min intervals
    const hour = timestamp.getHours();

    // Simulate temperature variation
    const baseTemp = 22;
    const hourlyVariation = Math.sin((hour - 6) * Math.PI / 12) * 8;
    const randomVariation = (Math.random() - 0.5) * 2;
    const temperature = baseTemp + hourlyVariation + randomVariation;

    const baseHumidity = 60;
    const humidity = baseHumidity - hourlyVariation * 1.5 + Math.random() * 5;

    sensorDataPoints.push({
      parentId: parentDevice.id,
      deviceType: 'PARENT',
      temperature: Math.round(temperature * 10) / 10,
      humidity: Math.round(Math.max(20, Math.min(95, humidity)) * 10) / 10,
      battery: 85,
      timestamp,
    });
  }

  // SQLiteではcreateManyでskipDuplicatesが使えないので直接挿入
  for (const data of sensorDataPoints) {
    await prisma.sensorData.create({ data });
  }

  console.log('Created sensor data points:', sensorDataPoints.length);

  console.log('Seeding completed!');
  console.log('\nDemo accounts:');
  console.log('  Admin: info@geoalpine.net / zm2a-aok10');
  console.log('  User:  user@foxsense.jp / password123');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
