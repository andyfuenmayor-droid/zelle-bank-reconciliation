import { NextRequest, NextResponse } from 'next/server';
import { ImapFlow } from 'imapflow';
import { dbQuery, isDatabaseAvailable } from '@/lib/db';
import { ImapMailboxRecord } from '@/types/reconciliation';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(): Promise<NextResponse> {
  const dbConnected = await isDatabaseAvailable();
  if (!dbConnected) {
    return NextResponse.json({
      ok: true,
      mailboxes: [],
    });
  }

  try {
    const res = await dbQuery<ImapMailboxRecord>(
      `
      SELECT
        id,
        alias,
        email_address,
        imap_host,
        imap_port,
        imap_secure,
        mailbox_folder,
        bancos_monitoreados,
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
  alias?: string;
  emailAddress?: string;
  imapHost?: string;
  imapPort?: number;
  imapSecure?: boolean;
  imapPassword?: string;
  mailboxFolder?: string;
  bancosMonitoreados?: string;
  verifyConnection?: boolean;
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const body = (await request.json()) as CreateMailboxPayload;
    const alias = (body.alias ?? 'Bandeja Principal Zelle').trim();
    const emailAddress = (body.emailAddress ?? '').trim().toLowerCase();
    const imapHost = (body.imapHost ?? 'imap.gmail.com').trim();
    const imapPort = Number(body.imapPort ?? 993);
    const imapSecure = body.imapSecure !== false;
    const imapPassword = (body.imapPassword ?? '').trim();
    const mailboxFolder = (body.mailboxFolder ?? 'INBOX').trim() || 'INBOX';
    const bancosMonitoreados =
      (body.bancosMonitoreados ?? 'CITIBANK_Y_TD_BANK').trim();
    const verifyConnection = body.verifyConnection === true;

    if (!emailAddress || !emailAddress.includes('@') || !imapPassword || !imapHost) {
      return NextResponse.json(
        {
          ok: false,
          error:
            'El correo electrónico, el servidor IMAP (Host) y la contraseña de aplicación son obligatorios.',
        },
        { status: 400 }
      );
    }

    let statusMessage = 'Configurado — listo para sincronizar';

    if (verifyConnection) {
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

    const upsertRes = await dbQuery<ImapMailboxRecord>(
      `
      INSERT INTO imap_monitored_accounts (
        alias,
        email_address,
        imap_host,
        imap_port,
        imap_secure,
        imap_password,
        mailbox_folder,
        bancos_monitoreados,
        activo,
        last_sync_status
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, TRUE, $9)
      ON CONFLICT (email_address) DO UPDATE SET
        alias = EXCLUDED.alias,
        imap_host = EXCLUDED.imap_host,
        imap_port = EXCLUDED.imap_port,
        imap_secure = EXCLUDED.imap_secure,
        imap_password = EXCLUDED.imap_password,
        mailbox_folder = EXCLUDED.mailbox_folder,
        bancos_monitoreados = EXCLUDED.bancos_monitoreados,
        activo = TRUE,
        last_sync_status = EXCLUDED.last_sync_status
      RETURNING
        id,
        alias,
        email_address,
        imap_host,
        imap_port,
        imap_secure,
        mailbox_folder,
        bancos_monitoreados,
        activo,
        last_sync_at,
        last_sync_status,
        created_at;
      `,
      [
        alias,
        emailAddress,
        imapHost,
        Number.isFinite(imapPort) ? imapPort : 993,
        imapSecure,
        imapPassword,
        mailboxFolder,
        bancosMonitoreados,
        statusMessage,
      ]
    );

    return NextResponse.json({
      ok: true,
      mailbox: upsertRes.rows[0],
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
