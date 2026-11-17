import { NextResponse } from 'next/server';
import { executeAllMailboxesSync } from '@/lib/imap-sync';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function POST(): Promise<NextResponse> {
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
