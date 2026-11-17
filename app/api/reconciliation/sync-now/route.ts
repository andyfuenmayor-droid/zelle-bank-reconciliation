import { NextRequest, NextResponse } from 'next/server';
import { executeUnifiedMultiChannelSync } from '@/lib/imap-sync';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const negocioId = request.headers.get('x-negocio-id')?.trim() || null;
    const summary = await executeUnifiedMultiChannelSync(negocioId);
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
