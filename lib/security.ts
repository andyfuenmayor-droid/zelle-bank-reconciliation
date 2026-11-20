import crypto from 'node:crypto';
import dns from 'node:dns/promises';
import net from 'node:net';
import { NextRequest, NextResponse } from 'next/server';
import { BusinessUserRole } from '@/types/reconciliation';

export const ADMIN_SESSION_COOKIE = 'zbr_admin_session';
export const CLIENT_SESSION_COOKIE = 'zbr_portal_session';
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 7; // 7 días

export interface AdminSessionPayload {
  type: 'ADMIN';
  userId: string;
  rol: BusinessUserRole;
  negocioId: string;
  exp: number;
}

export interface ClientSessionPayload {
  type: 'CLIENT';
  clienteId: string;
  negocioId: string | null;
  exp: number;
}

type SessionPayload = AdminSessionPayload | ClientSessionPayload;

function getSessionSecretBytes(): Buffer {
  const configured =
    process.env.SESSION_SECRET?.trim() ||
    process.env.CRON_SECRET?.trim() ||
    process.env.DATABASE_URL?.trim() ||
    'zbr-local-dev-ephemeral-session-key';
  return crypto.createHash('sha256').update(`zbr-session-v1:${configured}`).digest();
}

function getEncryptionKeyBytes(): Buffer {
  const configured =
    process.env.APP_ENCRYPTION_KEY?.trim() ||
    process.env.SESSION_SECRET?.trim() ||
    process.env.DATABASE_URL?.trim() ||
    'zbr-local-dev-ephemeral-enc-key';
  return crypto.createHash('sha256').update(`zbr-aes256-v1:${configured}`).digest();
}

export function safeEqualStrings(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');
  if (bufA.length !== bufB.length) {
    return false;
  }
  return crypto.timingSafeEqual(bufA, bufB);
}

function base64UrlEncode(input: Buffer | string): string {
  const buf = typeof input === 'string' ? Buffer.from(input, 'utf8') : input;
  return buf.toString('base64url');
}

function base64UrlDecode(input: string): string {
  return Buffer.from(input, 'base64url').toString('utf8');
}

export function createSignedToken(payload: SessionPayload): string {
  const encodedPayload = base64UrlEncode(JSON.stringify(payload));
  const signature = crypto
    .createHmac('sha256', getSessionSecretBytes())
    .update(encodedPayload)
    .digest('base64url');
  return `${encodedPayload}.${signature}`;
}

export function verifySignedToken<T extends SessionPayload>(
  token: string | undefined | null,
  expectedType: T['type']
): T | null {
  if (!token) {
    return null;
  }
  const parts = token.split('.');
  if (parts.length !== 2) {
    return null;
  }
  const [encodedPayload, providedSig] = parts;
  if (!encodedPayload || !providedSig) {
    return null;
  }

  const expectedSig = crypto
    .createHmac('sha256', getSessionSecretBytes())
    .update(encodedPayload)
    .digest('base64url');

  if (!safeEqualStrings(providedSig, expectedSig)) {
    return null;
  }

  try {
    const parsed = JSON.parse(base64UrlDecode(encodedPayload)) as T;
    if (
      !parsed ||
      parsed.type !== expectedType ||
      typeof parsed.exp !== 'number' ||
      parsed.exp <= Math.floor(Date.now() / 1000)
    ) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

function shouldUseSecureCookie(request?: NextRequest): boolean {
  if (process.env.COOKIE_SECURE === 'false') {
    return false;
  }
  if (request) {
    const proto =
      request.headers.get('x-forwarded-proto') ||
      new URL(request.url).protocol.replace(':', '');
    return proto === 'https';
  }
  return process.env.NODE_ENV === 'production';
}

export function attachAdminSessionCookie(
  response: NextResponse,
  params: { userId: string; rol: BusinessUserRole; negocioId: string },
  request?: NextRequest
): NextResponse {
  const token = createSignedToken({
    type: 'ADMIN',
    userId: params.userId,
    rol: params.rol,
    negocioId: params.negocioId,
    exp: Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS,
  });

  response.cookies.set({
    name: ADMIN_SESSION_COOKIE,
    value: token,
    httpOnly: true,
    sameSite: 'lax',
    secure: shouldUseSecureCookie(request),
    path: '/',
    maxAge: SESSION_TTL_SECONDS,
  });
  return response;
}

export function clearAdminSessionCookie(
  response: NextResponse,
  request?: NextRequest
): NextResponse {
  response.cookies.set({
    name: ADMIN_SESSION_COOKIE,
    value: '',
    httpOnly: true,
    sameSite: 'lax',
    secure: shouldUseSecureCookie(request),
    path: '/',
    maxAge: 0,
  });
  return response;
}

export function attachClientSessionCookie(
  response: NextResponse,
  params: { clienteId: string; negocioId: string | null },
  request?: NextRequest
): NextResponse {
  const token = createSignedToken({
    type: 'CLIENT',
    clienteId: params.clienteId,
    negocioId: params.negocioId,
    exp: Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS,
  });

  response.cookies.set({
    name: CLIENT_SESSION_COOKIE,
    value: token,
    httpOnly: true,
    sameSite: 'lax',
    secure: shouldUseSecureCookie(request),
    path: '/',
    maxAge: SESSION_TTL_SECONDS,
  });
  return response;
}

export function clearClientSessionCookie(
  response: NextResponse,
  request?: NextRequest
): NextResponse {
  response.cookies.set({
    name: CLIENT_SESSION_COOKIE,
    value: '',
    httpOnly: true,
    sameSite: 'lax',
    secure: shouldUseSecureCookie(request),
    path: '/',
    maxAge: 0,
  });
  return response;
}

export function getAdminSession(request: NextRequest): AdminSessionPayload | null {
  const cookieVal = request.cookies.get(ADMIN_SESSION_COOKIE)?.value;
  return verifySignedToken<AdminSessionPayload>(cookieVal, 'ADMIN');
}

export function getClientSession(request: NextRequest): ClientSessionPayload | null {
  const cookieVal = request.cookies.get(CLIENT_SESSION_COOKIE)?.value;
  return verifySignedToken<ClientSessionPayload>(cookieVal, 'CLIENT');
}

export function requireAdminSession(
  request: NextRequest
): { session: AdminSessionPayload; errorResponse: null } | { session: null; errorResponse: NextResponse } {
  const session = getAdminSession(request);
  if (!session) {
    return {
      session: null,
      errorResponse: NextResponse.json(
        { ok: false, error: 'Sesión administrativa expirada o no autorizada. Inicia sesión nuevamente.' },
        { status: 401 }
      ),
    };
  }
  return { session, errorResponse: null };
}

export function requireSuperAdminSession(
  request: NextRequest
): { session: AdminSessionPayload; errorResponse: null } | { session: null; errorResponse: NextResponse } {
  const auth = requireAdminSession(request);
  if (auth.errorResponse) {
    return auth;
  }
  if (auth.session.rol !== 'SUPER_ADMIN') {
    return {
      session: null,
      errorResponse: NextResponse.json(
        { ok: false, error: 'Acceso restringido exclusivamente al Administrador Principal (SUPER_ADMIN).' },
        { status: 403 }
      ),
    };
  }
  return auth;
}

export function resolveAuthorizedNegocioId(
  session: AdminSessionPayload,
  request: NextRequest,
  explicitNegocioId?: string | null
): string {
  if (session.rol !== 'SUPER_ADMIN') {
    return session.negocioId;
  }
  const { searchParams } = new URL(request.url);
  const requested = (
    explicitNegocioId ??
    request.headers.get('x-negocio-id') ??
    searchParams.get('negocioId') ??
    ''
  ).trim();

  if (requested && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(requested)) {
    return requested;
  }
  return session.negocioId;
}

/**
 * Hashing seguro de contraseñas y PINs con scrypt + salt aleatorio de 16 bytes.
 */
export function hashSecretScrypt(plain: string): string {
  const salt = crypto.randomBytes(16).toString('hex');
  const derived = crypto.scryptSync(plain.trim(), salt, 64, {
    N: 16384,
    r: 8,
    p: 1,
  }).toString('hex');
  return `scrypt$${salt}$${derived}`;
}

/**
 * Verifica contraseñas/PINs con soporte retrocompatible para hashes SHA-256 heredados.
 * Indica `needsUpgrade: true` cuando coincide con un hash heredado para migrarlo automáticamente.
 */
export function verifySecretHash(
  plain: string,
  storedHash: string | null | undefined
): { valid: boolean; needsUpgrade: boolean } {
  if (!storedHash || !plain) {
    return { valid: false, needsUpgrade: false };
  }

  const trimmed = plain.trim();

  if (storedHash.startsWith('scrypt$')) {
    const parts = storedHash.split('$');
    if (parts.length !== 3) {
      return { valid: false, needsUpgrade: false };
    }
    const [, salt, expectedHex] = parts;
    if (!salt || !expectedHex) {
      return { valid: false, needsUpgrade: false };
    }
    try {
      const derived = crypto.scryptSync(trimmed, salt, 64, {
        N: 16384,
        r: 8,
        p: 1,
      });
      const expectedBuf = Buffer.from(expectedHex, 'hex');
      if (derived.length !== expectedBuf.length) {
        return { valid: false, needsUpgrade: false };
      }
      return {
        valid: crypto.timingSafeEqual(derived, expectedBuf),
        needsUpgrade: false,
      };
    } catch {
      return { valid: false, needsUpgrade: false };
    }
  }

  // Fallback retrocompatible SHA-256 (para migrar cuentas existentes sin romper logins)
  const legacyHash = crypto.createHash('sha256').update(trimmed).digest('hex');
  const valid = safeEqualStrings(legacyHash, storedHash.trim().toLowerCase());
  return { valid, needsUpgrade: valid };
}

/**
 * Cifrado simétrico autenticado AES-256-GCM para secretos en BD (contraseñas IMAP y API Keys de IA).
 */
export function encryptAtRest(plain: string | null | undefined): string | null {
  const trimmed = (plain ?? '').trim();
  if (!trimmed) {
    return null;
  }
  if (trimmed.startsWith('encv1$')) {
    return trimmed;
  }
  const key = getEncryptionKeyBytes();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(trimmed, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `encv1$${iv.toString('hex')}$${tag.toString('hex')}$${encrypted.toString('hex')}`;
}

export function decryptAtRest(stored: string | null | undefined): string | null {
  const trimmed = (stored ?? '').trim();
  if (!trimmed) {
    return null;
  }
  if (!trimmed.startsWith('encv1$')) {
    // Retrocompatibilidad para registros en texto plano previos a la migración
    return trimmed;
  }
  const parts = trimmed.split('$');
  if (parts.length !== 4) {
    return null;
  }
  const [, ivHex, tagHex, dataHex] = parts;
  try {
    const key = getEncryptionKeyBytes();
    const decipher = crypto.createDecipheriv(
      'aes-256-gcm',
      key,
      Buffer.from(ivHex, 'hex')
    );
    decipher.setAuthTag(Buffer.from(tagHex, 'hex'));
    const decrypted = Buffer.concat([
      decipher.update(Buffer.from(dataHex, 'hex')),
      decipher.final(),
    ]);
    return decrypted.toString('utf8');
  } catch {
    return null;
  }
}

/**
 * Rate Limiter en memoria con ventana deslizante (protección contra fuerza bruta de PIN y abuso de IA).
 */
declare global {
  // eslint-disable-next-line no-var
  var __zbrRateLimitMap: Map<string, number[]> | undefined;
}

function getRateLimitStore(): Map<string, number[]> {
  if (!globalThis.__zbrRateLimitMap) {
    globalThis.__zbrRateLimitMap = new Map<string, number[]>();
  }
  return globalThis.__zbrRateLimitMap;
}

export function getClientIp(request: NextRequest): string {
  const forwarded = request.headers.get('x-forwarded-for');
  if (forwarded) {
    return forwarded.split(',')[0]?.trim() || 'unknown';
  }
  return request.headers.get('x-real-ip')?.trim() || 'unknown';
}

export function checkRateLimit(
  bucketKey: string,
  maxAttempts: number,
  windowMs: number
): { allowed: boolean; retryAfterSec: number } {
  const store = getRateLimitStore();
  const now = Date.now();
  const cutoff = now - windowMs;
  const recent = (store.get(bucketKey) ?? []).filter((ts) => ts > cutoff);

  if (recent.length >= maxAttempts) {
    const oldest = recent[0] ?? now;
    const retryAfterSec = Math.max(1, Math.ceil((oldest + windowMs - now) / 1000));
    store.set(bucketKey, recent);
    return { allowed: false, retryAfterSec };
  }

  recent.push(now);
  store.set(bucketKey, recent);

  // Limpieza ocasional para evitar crecimiento ilimitado de memoria
  if (store.size > 5000) {
    for (const [k, timestamps] of store.entries()) {
      const validTs = timestamps.filter((t) => t > cutoff);
      if (validTs.length === 0) {
        store.delete(k);
      } else {
        store.set(k, validTs);
      }
    }
  }

  return { allowed: true, retryAfterSec: 0 };
}

/**
 * Protección anti-SSRF para hosts y puertos IMAP.
 */
function isPrivateOrReservedIp(ip: string): boolean {
  const version = net.isIP(ip);
  if (version === 4) {
    const parts = ip.split('.').map((p) => Number.parseInt(p, 10));
    if (parts.length !== 4 || parts.some((n) => !Number.isFinite(n))) {
      return true;
    }
    const [a, b] = parts;
    if (a === 0 || a === 10 || a === 127) return true;
    if (a === 169 && b === 254) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 100 && b >= 64 && b <= 127) return true;
    if (a >= 224) return true;
    return false;
  }
  if (version === 6) {
    const low = ip.toLowerCase();
    if (
      low === '::1' ||
      low === '::' ||
      low.startsWith('fc') ||
      low.startsWith('fd') ||
      low.startsWith('fe80') ||
      low.startsWith('::ffff:127.') ||
      low.startsWith('::ffff:10.') ||
      low.startsWith('::ffff:192.168.') ||
      low.startsWith('::ffff:169.254.')
    ) {
      return true;
    }
    return false;
  }
  return true;
}

export async function validateSafeImapTarget(
  host: string,
  port: number
): Promise<{ ok: boolean; error?: string }> {
  const cleanHost = host.trim().toLowerCase();
  if (!cleanHost || cleanHost.length > 253 || /[\s/\\@]/.test(cleanHost)) {
    return { ok: false, error: 'El servidor IMAP especificado no es válido.' };
  }

  if (port !== 993 && port !== 143) {
    return {
      ok: false,
      error: 'Solo se permiten puertos estándar de correo IMAP (993 SSL/TLS o 143 STARTTLS).',
    };
  }

  if (
    cleanHost === 'localhost' ||
    cleanHost.endsWith('.local') ||
    cleanHost.endsWith('.internal')
  ) {
    return {
      ok: false,
      error: 'Bloqueo de seguridad: No se permiten direcciones internas o locales como servidor IMAP.',
    };
  }

  if (net.isIP(cleanHost) !== 0) {
    if (isPrivateOrReservedIp(cleanHost)) {
      return {
        ok: false,
        error: 'Bloqueo de seguridad: No se permiten IPs privadas o de red local como servidor IMAP.',
      };
    }
    return { ok: true };
  }

  try {
    const resolved = await dns.lookup(cleanHost, { all: true });
    if (!resolved || resolved.length === 0) {
      return {
        ok: false,
        error: `No se pudo resolver el dominio IMAP (${cleanHost}).`,
      };
    }
    for (const entry of resolved) {
      if (isPrivateOrReservedIp(entry.address)) {
        return {
          ok: false,
          error: 'Bloqueo de seguridad: El dominio IMAP resuelve a una dirección privada o reservada.',
        };
      }
    }
    return { ok: true };
  } catch {
    return {
      ok: false,
      error: `No se pudo resolver el servidor IMAP (${cleanHost}). Verifica el nombre del host.`,
    };
  }
}

/**
 * Generador criptográfico de códigos únicos (`ORD-2026-XXXXXXXX` / `LIQ-2026-XXXXXXXX`) sin colisiones.
 */
export function generateUniqueCode(prefix: 'ORD' | 'LIQ'): string {
  const year = new Date().getFullYear();
  const suffix = crypto.randomBytes(4).toString('hex').toUpperCase();
  return `${prefix}-${year}-${suffix}`;
}

/**
 * Valida estrictamente imágenes raster permitidas (bloquea SVG y formatos no imagen).
 */
export function isAllowedRasterImageDataUrl(dataUrl: string | null | undefined): boolean {
  if (!dataUrl || dataUrl.length < 100) {
    return false;
  }
  return /^data:image\/(jpeg|jpg|png|webp);base64,[A-Za-z0-9+/=]+$/i.test(dataUrl.trim());
}
