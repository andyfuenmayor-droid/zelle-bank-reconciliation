import { NextRequest, NextResponse } from 'next/server';
import { ImapFlow } from 'imapflow';
import { resolveRequestNegocioScope } from '@/lib/business-scope';
import { dbQuery, isDatabaseAvailable } from '@/lib/db';
import {
  AssignedReceivingAccount,
  CurrencyType,
  ExpectedPlatformType,
  ImapMailboxRecord,
} from '@/types/reconciliation';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const VALID_PLATFORMS: ReadonlyArray<ExpectedPlatformType> = [
  'CITIBANK',
  'TD_BANK',
  'BINANCE_PAY',
  'BINANCE_P2P',
  'BINANCE_ONCHAIN',
];

const VALID_CURRENCIES: ReadonlyArray<CurrencyType> = ['USD', 'USDT', 'VES'];

function normalizePlatform(value: string | undefined): ExpectedPlatformType {
  const upper = (value ?? '').trim().toUpperCase();
  return VALID_PLATFORMS.includes(upper as ExpectedPlatformType)
    ? (upper as ExpectedPlatformType)
    : 'CITIBANK';
}

function normalizeCurrency(
  value: string | undefined,
  plataforma: ExpectedPlatformType
): CurrencyType {
  const upper = (value ?? '').trim().toUpperCase();
  if (VALID_CURRENCIES.includes(upper as CurrencyType)) {
    return upper as CurrencyType;
  }
  return plataforma.startsWith('BINANCE') ? 'USDT' : 'USD';
}

async function syncClientsAssignedAccountFromMailbox(
  mailbox: ImapMailboxRecord
): Promise<void> {
  const clientsRes = await dbQuery<{
    id: string;
    cuentas_asignadas: AssignedReceivingAccount[] | null;
  }>(
    `
    SELECT id, COALESCE(cuentas_asignadas, '[]'::jsonb) AS cuentas_asignadas
    FROM clientes_titulares
    WHERE jsonb_array_length(COALESCE(cuentas_asignadas, '[]'::jsonb)) > 0;
    `
  );

  const nextPlatform = normalizePlatform(mailbox.plataforma);
  const nextCurrency = normalizeCurrency(mailbox.moneda, nextPlatform);
  const nextCuenta =
    mailbox.cuenta_receptora?.trim() || mailbox.email_address;

  for (const row of clientsRes.rows) {
    if (!Array.isArray(row.cuentas_asignadas)) {
      continue;
    }
    let changed = false;
    const updatedList = row.cuentas_asignadas.map((acc) => {
      if (acc.mailbox_id && acc.mailbox_id === mailbox.id) {
        changed = true;
        return {
          ...acc,
          plataforma: nextPlatform,
          alias: mailbox.alias,
          cuenta_receptora: nextCuenta,
          moneda: nextCurrency,
        };
      }
      return acc;
    });

    if (changed) {
      await dbQuery(
        `
        UPDATE clientes_titulares
        SET cuentas_asignadas = $2::jsonb
        WHERE id = $1::uuid;
        `,
        [row.id, JSON.stringify(updatedList)]
      );
    }
  }
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const dbConnected = await isDatabaseAvailable();
  if (!dbConnected) {
    return NextResponse.json({
      ok: true,
      mailboxes: [],
    });
  }

  try {
    const scope = await resolveRequestNegocioScope(request);
    const res = scope.negocioId
      ? await dbQuery<ImapMailboxRecord>(
          `
          SELECT
            id,
            negocio_id,
            alias,
            email_address,
            imap_host,
            imap_port,
            imap_secure,
            mailbox_folder,
            bancos_monitoreados,
            COALESCE(NULLIF(plataforma, ''), 'CITIBANK') AS plataforma,
            COALESCE(NULLIF(cuenta_receptora, ''), email_address) AS cuenta_receptora,
            COALESCE(NULLIF(moneda, ''), 'USD') AS moneda,
            activo,
            last_sync_at,
            last_sync_status,
            created_at
          FROM imap_monitored_accounts
          WHERE negocio_id = $1::uuid
          ORDER BY created_at DESC;
          `,
          [scope.negocioId]
        )
      : await dbQuery<ImapMailboxRecord>(
          `
          SELECT
            id,
            negocio_id,
            alias,
            email_address,
            imap_host,
            imap_port,
            imap_secure,
            mailbox_folder,
            bancos_monitoreados,
            COALESCE(NULLIF(plataforma, ''), 'CITIBANK') AS plataforma,
            COALESCE(NULLIF(cuenta_receptora, ''), email_address) AS cuenta_receptora,
            COALESCE(NULLIF(moneda, ''), 'USD') AS moneda,
            activo,
            last_sync_at,
            last_sync_status,
            created_at
          FROM imap_monitored_accounts
          ORDER BY created_at DESC;
          `
        );

    return NextResponse.json({
      ok: true,
      mailboxes: res.rows,
    });
  } catch (error: unknown) {
    const message =
      error instanceof Error
        ? error.message
        : 'Error consultando buzones IMAP.';
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}

interface CreateMailboxPayload {
  negocioId?: string;
  mailboxId?: string;
  alias?: string;
  emailAddress?: string;
  imapHost?: string;
  imapPort?: number;
  imapSecure?: boolean;
  imapPassword?: string;
  mailboxFolder?: string;
  bancosMonitoreados?: string;
  plataforma?: ExpectedPlatformType;
  cuentaReceptora?: string;
  moneda?: CurrencyType;
  verifyConnection?: boolean;
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const body = (await request.json()) as CreateMailboxPayload;
    const mailboxId = (body.mailboxId ?? '').trim();
    const alias = (body.alias ?? 'Bandeja Principal Zelle').trim();
    const emailAddress = (body.emailAddress ?? '').trim().toLowerCase();
    const imapHost = (body.imapHost ?? 'imap.gmail.com').trim();
    const imapPort = Number(body.imapPort ?? 993);
    const imapSecure = body.imapSecure !== false;
    const imapPassword = (body.imapPassword ?? '').trim();
    const mailboxFolder = (body.mailboxFolder ?? 'INBOX').trim() || 'INBOX';
    const bancosMonitoreados =
      (body.bancosMonitoreados ?? 'CITIBANK_TD_BINANCE').trim();
    const plataforma = normalizePlatform(body.plataforma);
    const moneda = normalizeCurrency(body.moneda, plataforma);
    const cuentaReceptora =
      (body.cuentaReceptora ?? '').trim() || emailAddress;
    const verifyConnection = body.verifyConnection === true;

    if (!emailAddress || !emailAddress.includes('@') || !imapHost) {
      return NextResponse.json(
        {
          ok: false,
          error:
            'El correo electrónico y el servidor IMAP (Host) son obligatorios.',
        },
        { status: 400 }
      );
    }

    if (!mailboxId && !imapPassword) {
      return NextResponse.json(
        {
          ok: false,
          error:
            'La contraseña de aplicación IMAP es obligatoria al registrar una nueva cuenta.',
        },
        { status: 400 }
      );
    }

    let statusMessage = 'Configurado — listo para sincronizar';

    if (verifyConnection && imapPassword) {
      const client = new ImapFlow({
        host: imapHost,
        port: Number.isFinite(imapPort) ? imapPort : 993,
        secure: imapSecure,
        auth: {
          user: emailAddress,
          pass: imapPassword,
        },
        logger: false,
      });

      try {
        await client.connect();
        await client.logout().catch(() => undefined);
        statusMessage = 'Conexión IMAP verificada con éxito';
      } catch (imapErr: unknown) {
        const errMsg =
          imapErr instanceof Error
            ? imapErr.message
            : 'Fallo de autenticación IMAP';
        return NextResponse.json(
          {
            ok: false,
            error: `No se pudo conectar al servidor IMAP (${imapHost}:${imapPort}): ${errMsg}. Si usas Gmail, asegúrate de usar una "Contraseña de Aplicación" de 16 letras y no tu clave normal.`,
          },
          { status: 422 }
        );
      }
    }

    let savedMailbox: ImapMailboxRecord | undefined;
    const scope = await resolveRequestNegocioScope(request, body.negocioId);

    if (mailboxId) {
      const updateRes = await dbQuery<ImapMailboxRecord>(
        `
        UPDATE imap_monitored_accounts
        SET alias = $2,
            email_address = $3,
            imap_host = $4,
            imap_port = $5,
            imap_secure = $6,
            imap_password = COALESCE(NULLIF($7, ''), imap_password),
            mailbox_folder = $8,
            bancos_monitoreados = $9,
            plataforma = $10,
            cuenta_receptora = $11,
            moneda = $12,
            last_sync_status = CASE
              WHEN $7 <> '' THEN $13
              ELSE last_sync_status
            END
        WHERE id = $1::uuid
        RETURNING
          id,
          negocio_id,
          alias,
          email_address,
          imap_host,
          imap_port,
          imap_secure,
          mailbox_folder,
          bancos_monitoreados,
          plataforma,
          cuenta_receptora,
          moneda,
          activo,
          last_sync_at,
          last_sync_status,
          created_at;
        `,
        [
          mailboxId,
          alias,
          emailAddress,
          imapHost,
          Number.isFinite(imapPort) ? imapPort : 993,
          imapSecure,
          imapPassword,
          mailboxFolder,
          bancosMonitoreados,
          plataforma,
          cuentaReceptora,
          moneda,
          statusMessage,
        ]
      );

      savedMailbox = updateRes.rows[0];
      if (!savedMailbox) {
        return NextResponse.json(
          { ok: false, error: 'Buzón IMAP no encontrado para actualizar.' },
          { status: 404 }
        );
      }
    } else {
      const conflictMb = await dbQuery<{ negocio_id: string | null }>(
        'SELECT negocio_id FROM imap_monitored_accounts WHERE LOWER(email_address) = LOWER($1) LIMIT 1;',
        [emailAddress]
      );
      if (
        conflictMb.rows[0] &&
        conflictMb.rows[0].negocio_id &&
        scope.negocioId &&
        conflictMb.rows[0].negocio_id !== scope.negocioId
      ) {
        return NextResponse.json(
          {
            ok: false,
            error: `El correo ${emailAddress} ya está asignado a otro negocio.`,
          },
          { status: 409 }
        );
      }

      const upsertRes = await dbQuery<ImapMailboxRecord>(
        `
        INSERT INTO imap_monitored_accounts (
          negocio_id,
          alias,
          email_address,
          imap_host,
          imap_port,
          imap_secure,
          imap_password,
          mailbox_folder,
          bancos_monitoreados,
          plataforma,
          cuenta_receptora,
          moneda,
          activo,
          last_sync_status
        )
        VALUES ($1::uuid, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, TRUE, $13)
        ON CONFLICT (email_address) DO UPDATE SET
          negocio_id = COALESCE(imap_monitored_accounts.negocio_id, EXCLUDED.negocio_id),
          alias = EXCLUDED.alias,
          imap_host = EXCLUDED.imap_host,
          imap_port = EXCLUDED.imap_port,
          imap_secure = EXCLUDED.imap_secure,
          imap_password = EXCLUDED.imap_password,
          mailbox_folder = EXCLUDED.mailbox_folder,
          bancos_monitoreados = EXCLUDED.bancos_monitoreados,
          plataforma = EXCLUDED.plataforma,
          cuenta_receptora = EXCLUDED.cuenta_receptora,
          moneda = EXCLUDED.moneda,
          activo = TRUE,
          last_sync_status = EXCLUDED.last_sync_status
        RETURNING
          id,
          negocio_id,
          alias,
          email_address,
          imap_host,
          imap_port,
          imap_secure,
          mailbox_folder,
          bancos_monitoreados,
          plataforma,
          cuenta_receptora,
          moneda,
          activo,
          last_sync_at,
          last_sync_status,
          created_at;
        `,
        [
          scope.negocioId,
          alias,
          emailAddress,
          imapHost,
          Number.isFinite(imapPort) ? imapPort : 993,
          imapSecure,
          imapPassword,
          mailboxFolder,
          bancosMonitoreados,
          plataforma,
          cuentaReceptora,
          moneda,
          statusMessage,
        ]
      );

      savedMailbox = upsertRes.rows[0];
    }

    if (savedMailbox) {
      await syncClientsAssignedAccountFromMailbox(savedMailbox);
    }

    return NextResponse.json({
      ok: true,
      mailbox: savedMailbox,
    });
  } catch (error: unknown) {
    const message =
      error instanceof Error ? error.message : 'Error guardando correo IMAP.';
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest): Promise<NextResponse> {
  const { searchParams } = new URL(request.url);
  const id = searchParams.get('id')?.trim() ?? '';

  if (!id) {
    return NextResponse.json(
      { ok: false, error: 'Se requiere el id del buzón.' },
      { status: 400 }
    );
  }

  try {
    await dbQuery('DELETE FROM imap_monitored_accounts WHERE id = $1::uuid;', [
      id,
    ]);
    return NextResponse.json({ ok: true });
  } catch (error: unknown) {
    const message =
      error instanceof Error ? error.message : 'Error eliminando buzón.';
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
