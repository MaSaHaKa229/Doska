import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { SignJWT, jwtVerify, errors as joseErrors } from 'jose';
import type { UserRole } from '@prisma/client';

/**
 * Токены:
 *  - access — JWT (HS256), живёт 15 мин, содержит id пользователя, роль,
 *    признак обязательной смены пароля и id семьи refresh-токенов (sid);
 *  - refresh — 256 случайных бит (непрозрачная строка); в БД — только SHA-256.
 */

const ISSUER = 'doska';
const AUDIENCE = 'doska-api';

export interface AccessClaims {
  /** id пользователя */
  sub: string;
  role: UserRole;
  /** true — пользователь обязан сменить временный пароль */
  pwd: boolean;
  /** id семьи refresh-токенов (= сессия устройства) */
  sid: string;
  /** время выпуска, секунды */
  iat: number;
  exp: number;
}

export class TokenService {
  constructor(
    private readonly secret: Uint8Array,
    readonly accessTtlSeconds: number,
    readonly refreshTtlSeconds: number,
  ) {}

  async signAccess(claims: { sub: string; role: UserRole; pwd: boolean; sid: string }): Promise<string> {
    return new SignJWT({ role: claims.role, pwd: claims.pwd, sid: claims.sid })
      .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
      .setSubject(claims.sub)
      .setIssuer(ISSUER)
      .setAudience(AUDIENCE)
      .setIssuedAt()
      .setJti(randomUUID())
      .setExpirationTime(`${this.accessTtlSeconds}s`)
      .sign(this.secret);
  }

  /** Проверка access-токена. null — токен недействителен; 'expired' — истёк. */
  async verifyAccess(token: string): Promise<AccessClaims | 'expired' | null> {
    try {
      const { payload } = await jwtVerify(token, this.secret, {
        issuer: ISSUER,
        audience: AUDIENCE,
        algorithms: ['HS256'],
      });
      const { sub, role, pwd, sid, iat, exp } = payload as Record<string, unknown>;
      if (
        typeof sub !== 'string' ||
        (role !== 'ADMIN' && role !== 'TEACHER' && role !== 'STUDENT') ||
        typeof pwd !== 'boolean' ||
        typeof sid !== 'string' ||
        typeof iat !== 'number' ||
        typeof exp !== 'number'
      ) {
        return null;
      }
      return { sub, role, pwd, sid, iat, exp };
    } catch (err) {
      if (err instanceof joseErrors.JWTExpired) return 'expired';
      return null;
    }
  }

  generateRefreshToken(): { token: string; hash: string } {
    const token = randomBytes(32).toString('base64url');
    return { token, hash: hashToken(token) };
  }
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/** Случайный CSRF-токен (double submit cookie). */
export function generateCsrfToken(): string {
  return randomBytes(24).toString('base64url');
}
