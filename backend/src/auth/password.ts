import argon2 from 'argon2';
import { randomInt } from 'node:crypto';

export interface PasswordHasherOptions {
  memoryCost: number;
  timeCost: number;
}

/**
 * Хеширование паролей argon2id. Параметры по умолчанию (64 МБ, 3 прохода,
 * 1 поток) соответствуют рекомендациям OWASP и дают ~50–100 мс на сервере.
 */
export class PasswordHasher {
  /** Хеш «пустышки» для выравнивания времени ответа при несуществующем логине. */
  private dummyHash: Promise<string> | null = null;

  constructor(private readonly opts: PasswordHasherOptions) {}

  hash(password: string): Promise<string> {
    return argon2.hash(password, {
      type: argon2.argon2id,
      memoryCost: this.opts.memoryCost,
      timeCost: this.opts.timeCost,
      parallelism: 1,
    });
  }

  async verify(hash: string, password: string): Promise<boolean> {
    try {
      return await argon2.verify(hash, password);
    } catch {
      return false;
    }
  }

  /**
   * Проверка пароля против фиктивного хеша: тратит столько же времени, сколько
   * настоящая проверка, и всегда возвращает false. Не даёт по времени ответа
   * определить, существует ли логин.
   */
  async verifyDummy(password: string): Promise<false> {
    this.dummyHash ??= this.hash('dummy-password-for-timing-0');
    await this.verify(await this.dummyHash, password);
    return false;
  }

  /** Нужно ли перехешировать (параметры изменились) — делается при входе. */
  needsRehash(hash: string): boolean {
    return argon2.needsRehash(hash, {
      memoryCost: this.opts.memoryCost,
      timeCost: this.opts.timeCost,
      parallelism: 1,
    });
  }
}

/** Алфавит временных паролей без похожих символов (0/O, 1/l/I). */
const LETTERS = 'abcdefghijkmnpqrstuvwxyz';
const DIGITS = '23456789';

/**
 * Временный пароль, удобный для печати и ввода школьником: 3 группы по 3–4
 * символа через дефис, например «kmt-48p-qaz7». Энтропия ≈ 50 бит, этого
 * достаточно для одноразового пароля, который нужно сменить при первом входе
 * (подбор ограничен rate limiting и блокировкой учётной записи).
 */
export function generateTempPassword(): string {
  const all = LETTERS + DIGITS;
  const pick = (alphabet: string) => alphabet[randomInt(alphabet.length)] as string;
  for (;;) {
    const groups = [3, 3, 4].map((len) => Array.from({ length: len }, () => pick(all)).join(''));
    const pwd = groups.join('-');
    // Гарантируем наличие и букв, и цифр (требование политики паролей).
    if (/[a-z]/.test(pwd) && /[0-9]/.test(pwd)) return pwd;
  }
}
