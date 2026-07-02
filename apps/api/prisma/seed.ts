import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcrypt';

const prisma = new PrismaClient();

const DEFAULT_EXPENSE_CATEGORIES = [
  { name: 'Alimentación', color: '#f59e0b', icon: '🍽️' },
  { name: 'Transporte', color: '#3b82f6', icon: '🚌' },
  { name: 'Vivienda', color: '#8b5cf6', icon: '🏠' },
  { name: 'Servicios', color: '#06b6d4', icon: '💡' },
  { name: 'Suscripciones', color: '#ec4899', icon: '📺' },
  { name: 'Salud', color: '#10b981', icon: '⚕️' },
  { name: 'Ocio', color: '#f97316', icon: '🎉' },
  { name: 'Otros gastos', color: '#6b7280', icon: '📦' },
];

const DEFAULT_INCOME_CATEGORIES = [
  { name: 'Sueldo', color: '#22c55e', icon: '💼' },
  { name: 'Freelance', color: '#84cc16', icon: '🧑‍💻' },
  { name: 'Otros ingresos', color: '#14b8a6', icon: '➕' },
];

async function main() {
  const email = 'demo@myfinance.app';
  const passwordHash = await bcrypt.hash('demo1234', 10);

  const user = await prisma.user.upsert({
    where: { email },
    update: {},
    create: { email, passwordHash, name: 'Usuario Demo' },
  });

  for (const cat of DEFAULT_EXPENSE_CATEGORIES) {
    await prisma.category.upsert({
      where: { userId_name_type: { userId: user.id, name: cat.name, type: 'EXPENSE' } },
      update: {},
      create: { ...cat, type: 'EXPENSE', userId: user.id },
    });
  }
  for (const cat of DEFAULT_INCOME_CATEGORIES) {
    await prisma.category.upsert({
      where: { userId_name_type: { userId: user.id, name: cat.name, type: 'INCOME' } },
      update: {},
      create: { ...cat, type: 'INCOME', userId: user.id },
    });
  }

  console.log(`Seed listo. Usuario demo: ${email} / demo1234`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
