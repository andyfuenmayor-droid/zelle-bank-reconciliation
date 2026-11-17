import { NextRequest, NextResponse } from 'next/server';
import { executeAllMailboxesSync } from '@/lib/imap-sync';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

function isAuthorizedCronRequest(request: NextRequest): boolean {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret || cronSecret.trim().length === 0) {
    return false;
  }

  const authHeader = request.headers.get('authorization');
  if (!authHeader) {
    return false;
  }

  return authHeader === `Bearer ${cronSecret}`;
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  if (!isAuthorizedCronRequest(request)) {
    return NextResponse.json(
      {
        ok: false,
        error:
          'No autorizado. Header Authorization: Bearer <CRON_SECRET> inválido o ausente.',
      },
      { status: 401 }
    );
  }

  try {
    const summary = await executeAllMailboxesSync();
    return NextResponse.json({
      ok: true,
      syncedAt: new Date().toISOString(),
      ...summary,
    });
  } catch (error: unknown) {
    const message =
      error instanceof Error
        ? error.message
        : 'Error interno durante sincronización IMAP.';

    return NextResponse.json(
      {
        ok: false,
        error: message,
      },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  return GET(request);
}
