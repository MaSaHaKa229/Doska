/**
 * Сид: создаёт первого администратора из переменных окружения, если в базе
 * ещё нет ни одного действующего администратора, и встроенные шаблоны
 * библиотеки. Повторный запуск безопасен.
 *
 *   SEED_ADMIN_LOGIN       логин (по умолчанию admin)
 *   SEED_ADMIN_PASSWORD    начальный пароль (обязателен; не короче 8 символов,
 *                          с буквой и цифрой). Администратор будет обязан
 *                          сменить его при первом входе.
 *   SEED_ADMIN_FULL_NAME   ФИО (по умолчанию «Администратор»)
 *
 * Пароль не выводится в консоль и не пишется в журнал.
 */
import { PrismaClient } from '@prisma/client';
import { checkPasswordPolicy, loginFieldSchema } from '@doska/shared';
import { PasswordHasher } from '../src/auth/password.js';
import { ensureBuiltinTemplates } from '../src/templates/builtin.js';

async function main(): Promise<void> {
  const loginRaw = process.env.SEED_ADMIN_LOGIN || 'admin';
  const password = process.env.SEED_ADMIN_PASSWORD ?? '';
  const fullName = (process.env.SEED_ADMIN_FULL_NAME || 'Администратор').trim().slice(0, 200);

  const loginParsed = loginFieldSchema.safeParse(loginRaw);
  if (!loginParsed.success) {
    throw new Error(`SEED_ADMIN_LOGIN: ${loginParsed.error.issues[0]?.message ?? 'неверный логин'}`);
  }
  const login = loginParsed.data;

  const prisma = new PrismaClient();
  try {
    const existingAdmin = await prisma.user.findFirst({ where: { role: 'ADMIN', deletedAt: null } });
    if (existingAdmin) {
      console.log(`Администратор уже существует (логин: ${existingAdmin.login}) — создание пропущено.`);
      await seedTemplates(prisma);
      return;
    }
    if (!password) {
      throw new Error('Задайте SEED_ADMIN_PASSWORD в .env — начальный пароль первого администратора.');
    }
    const problems = checkPasswordPolicy(password, login);
    if (problems.length > 0) {
      throw new Error(`SEED_ADMIN_PASSWORD не подходит: ${problems.join('; ')}`);
    }
    const taken = await prisma.user.findUnique({ where: { login } });
    if (taken) {
      throw new Error(`Логин «${login}» уже занят пользователем с ролью ${taken.role}. Укажите другой SEED_ADMIN_LOGIN.`);
    }

    const hasher = new PasswordHasher({
      memoryCost: Number(process.env.ARGON2_MEMORY_KIB) || 65_536,
      timeCost: Number(process.env.ARGON2_TIME_COST) || 3,
    });
    const admin = await prisma.user.create({
      data: {
        login,
        fullName,
        role: 'ADMIN',
        passwordHash: await hasher.hash(password),
        mustChangePassword: true,
        color: '#7c3aed',
      },
    });
    await prisma.auditLog.create({
      data: {
        action: 'USER_CREATED',
        actorLogin: 'seed',
        targetType: 'user',
        targetId: admin.id,
        details: { login, role: 'ADMIN', source: 'seed' },
      },
    });
    console.log(`Создан администратор «${login}». При первом входе потребуется сменить пароль.`);
    await seedTemplates(prisma);
  } finally {
    await prisma.$disconnect();
  }
}

/** Встроенные шаблоны библиотеки (их владелец — администратор; сервер тоже досоздаёт их при запуске). */
async function seedTemplates(prisma: PrismaClient): Promise<void> {
  const created = await ensureBuiltinTemplates(prisma);
  if (created) console.log(`Созданы встроенные шаблоны: ${created}.`);
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
