import crypto from 'node:crypto';
import { dbQuery } from '@/lib/db';
import {
  AssignedReceivingAccount,
  CurrencyType,
  ExpectedPlatformType,
} from '@/types/reconciliation';

const VALID_PLATFORMS: ReadonlyArray<ExpectedPlatformType> = [
  'CITIBANK',
  'TD_BANK',
  'BINANCE_PAY',
  'BINANCE_P2P',
  'BINANCE_ONCHAIN',
];

const VALID_CURRENCIES: ReadonlyArray<CurrencyType> = ['USD', 'USDT', 'VES'];

export function normalizePlatformType(value: unknown): ExpectedPlatformType {
  const upper = typeof value === 'string' ? value.trim().toUpperCase() : '';
  return VALID_PLATFORMS.includes(upper as ExpectedPlatformType)
    ? (upper as ExpectedPlatformType)
    : 'CITIBANK';
}

export function normalizeCurrencyType(
  value: unknown,
  plataforma: ExpectedPlatformType
): CurrencyType {
  const upper = typeof value === 'string' ? value.trim().toUpperCase() : '';
  if (VALID_CURRENCIES.includes(upper as CurrencyType)) {
    return upper as CurrencyType;
  }
  return plataforma.startsWith('BINANCE') ? 'USDT' : 'USD';
}

export function defaultPlatformLabel(plataforma: ExpectedPlatformType): string {
  switch (plataforma) {
    case 'CITIBANK':
      return 'Citibank Zelle';
    case 'TD_BANK':
      return 'TD Bank Zelle';
    case 'BINANCE_PAY':
      return 'Binance Pay';
    case 'BINANCE_P2P':
      return 'Binance P2P';
    case 'BINANCE_ONCHAIN':
      return 'Binance On-Chain';
  }
}

export function normalizeAssignedAccounts(
  raw: unknown
): AssignedReceivingAccount[] {
  let list: unknown[] = [];
  if (Array.isArray(raw)) {
    list = raw;
  } else if (typeof raw === 'string' && raw.trim().startsWith('[')) {
    try {
      const parsed: unknown = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        list = parsed;
      }
    } catch {
      list = [];
    }
  }

  const normalized: AssignedReceivingAccount[] = [];
  for (const item of list) {
    if (!item || typeof item !== 'object') {
      continue;
    }
    const obj = item as Record<string, unknown>;
    const cuentaReceptora =
      typeof obj.cuenta_receptora === 'string'
        ? obj.cuenta_receptora.trim()
        : '';
    if (!cuentaReceptora) {
      continue;
    }
    const plataforma = normalizePlatformType(obj.plataforma);
    const moneda = normalizeCurrencyType(obj.moneda, plataforma);
    const alias =
      typeof obj.alias === 'string' && obj.alias.trim()
        ? obj.alias.trim()
        : defaultPlatformLabel(plataforma);
    const mailboxId =
      typeof obj.mailbox_id === 'string' && obj.mailbox_id.trim()
        ? obj.mailbox_id.trim()
        : null;
    const id =
      typeof obj.id === 'string' && obj.id.trim()
        ? obj.id.trim()
        : mailboxId ?? crypto.randomUUID();

    normalized.push({
      id,
      mailbox_id: mailboxId,
      plataforma,
      alias,
      cuenta_receptora: cuentaReceptora,
      moneda,
    });
  }
  return normalized;
}

interface ActiveMailboxRow {
  id: string;
  alias: string;
  email_address: string;
  plataforma: string | null;
  cuenta_receptora: string | null;
  moneda: string | null;
}

/**
 * Obtiene las cuentas receptoras activas definidas en `imap_monitored_accounts`.
 */
export async function getActiveMailboxAssignedAccounts(
  negocioId?: string | null
): Promise<AssignedReceivingAccount[]> {
  const res = negocioId
    ? await dbQuery<ActiveMailboxRow>(
        `
        SELECT
          id,
          alias,
          email_address,
          COALESCE(NULLIF(plataforma, ''), 'CITIBANK') AS plataforma,
          COALESCE(NULLIF(cuenta_receptora, ''), email_address) AS cuenta_receptora,
          COALESCE(NULLIF(moneda, ''), 'USD') AS moneda
        FROM imap_monitored_accounts
        WHERE activo = TRUE
          AND (negocio_id = $1::uuid OR negocio_id IS NULL)
        ORDER BY created_at ASC;
        `,
        [negocioId]
      )
    : await dbQuery<ActiveMailboxRow>(
        `
        SELECT
          id,
          alias,
          email_address,
          COALESCE(NULLIF(plataforma, ''), 'CITIBANK') AS plataforma,
          COALESCE(NULLIF(cuenta_receptora, ''), email_address) AS cuenta_receptora,
          COALESCE(NULLIF(moneda, ''), 'USD') AS moneda
        FROM imap_monitored_accounts
        WHERE activo = TRUE
        ORDER BY created_at ASC;
        `
      );

  return res.rows.map((mb) => {
    const plataforma = normalizePlatformType(mb.plataforma);
    const moneda = normalizeCurrencyType(mb.moneda, plataforma);
    return {
      id: mb.id,
      mailbox_id: mb.id,
      plataforma,
      alias: mb.alias || defaultPlatformLabel(plataforma),
      cuenta_receptora: (mb.cuenta_receptora ?? mb.email_address).trim(),
      moneda,
    };
  });
}

/**
 * Resuelve las cuentas asignadas del cliente, usando las cuentas activas del panel
 * cuando el cliente aún no tiene asignaciones explícitas y manteniendo sincronizados los vínculos a buzones.
 */
export function resolveClientAssignedAccounts(
  rawClientAccounts: unknown,
  activeMailboxAccounts: ReadonlyArray<AssignedReceivingAccount>
): AssignedReceivingAccount[] {
  const parsed = normalizeAssignedAccounts(rawClientAccounts);
  if (parsed.length === 0) {
    return activeMailboxAccounts.map((acc) => ({ ...acc }));
  }

  const byMailboxId = new Map<string, AssignedReceivingAccount>();
  for (const mbAcc of activeMailboxAccounts) {
    if (mbAcc.mailbox_id) {
      byMailboxId.set(mbAcc.mailbox_id, mbAcc);
    }
  }

  return parsed.map((acc) => {
    if (acc.mailbox_id) {
      const liveMb = byMailboxId.get(acc.mailbox_id);
      if (liveMb) {
        return {
          ...acc,
          plataforma: liveMb.plataforma,
          alias: acc.alias || liveMb.alias,
          cuenta_receptora: liveMb.cuenta_receptora,
          moneda: liveMb.moneda,
        };
      }
    }
    return acc;
  });
}
