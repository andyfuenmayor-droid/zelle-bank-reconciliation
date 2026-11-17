import { NextRequest, NextResponse } from 'next/server';
import { executeUnifiedMultiChannelSync } from '@/lib/imap-sync';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

function isAuthorizedCronRequest(request: NextRequest): boolean {
  const cronSecret = process.env.CRON_SECRET?.trim();
  if (!cronSecret) {
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
    const summary = await executeUnifiedMultiChannelSync();
    return NextResponse.json({
      ok: true,
      syncedAt: new Date().toISOString(),
      ...summary,
    });
  } catch (error: unknown) {
    const message =
      error instanceof Error
        ? error.message
        : 'Error interno durante sincronización multi-canal.';

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
