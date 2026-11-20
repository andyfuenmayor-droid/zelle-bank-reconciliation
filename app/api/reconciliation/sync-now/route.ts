import { NextRequest, NextResponse } from 'next/server';
import { executeUnifiedMultiChannelSync } from '@/lib/imap-sync';
import {
  requireAdminSession,
  resolveAuthorizedNegocioId,
} from '@/lib/security';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function POST(request: NextRequest): Promise<NextResponse> {
  const auth = requireAdminSession(request);
  if (auth.errorResponse) {
    return auth.errorResponse;
  }

  try {
    const negocioId = resolveAuthorizedNegocioId(auth.session, request);
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
