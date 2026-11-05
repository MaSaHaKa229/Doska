import pkg from '../node_modules/@prisma/client/index.js';
import { PasswordHasher } from '../backend/src/auth/password.js';

const prisma = new pkg.PrismaClient();
const hasher = new PasswordHasher({ memoryCost: 19456, timeCost: 2 });
async function user(login: string, fullName: string, role: 'TEACHER' | 'STUDENT') {
  const passwordHash = await hasher.hash('Kot12345e2e');
  return prisma.user.upsert({
    where: { login },
    update: { passwordHash, mustChangePassword: false, isBlocked: false },
    create: { login, fullName, role, passwordHash, mustChangePassword: false },
  });
}
const t = await user('e2e.teacher', 'Смирнова Анна Петровна', 'TEACHER');
const s1 = await user('e2e.student1', 'Иванов Иван', 'STUDENT');
const s2 = await user('e2e.student2', 'Петрова Мария', 'STUDENT');
const s3 = await user('e2e.student3', 'Сидоров Олег', 'STUDENT');
let cls = await prisma.class.findFirst({ where: { name: 'E2E-9А' } });
if (!cls) cls = await prisma.class.create({ data: { name: 'E2E-9А' } });
for (const [u, role] of [[t, 'TEACHER'], [s1, 'STUDENT'], [s2, 'STUDENT']] as const) {
  await prisma.classMember.upsert({ where: { classId_userId: { classId: cls.id, userId: u.id } }, update: {}, create: { classId: cls.id, userId: u.id, role } });
}
console.log(JSON.stringify({ classId: cls.id, s3: s3.id }));
await prisma.$disconnect();
