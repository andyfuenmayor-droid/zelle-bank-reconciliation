import { NextRequest, NextResponse } from 'next/server';
import { scanReceiptWithAi } from '@/lib/receipt-scanner';
import { AssignedReceivingAccount } from '@/types/reconciliation';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

interface ScanReceiptRequestBody {
  comprobante_base64?: string;
  cuentasAsignadas?: AssignedReceivingAccount[];
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const body = (await request.json()) as ScanReceiptRequestBody;
    const comprobanteBase64 = (body.comprobante_base64 ?? '').trim();
    const cuentasAsignadas = Array.isArray(body.cuentasAsignadas)
      ? body.cuentasAsignadas
      : [];

    if (!comprobanteBase64) {
      return NextResponse.json(
        {
          ok: false,
          error: 'Debes proporcionar una imagen de comprobante en formato Base64.',
        },
        { status: 400 }
      );
    }

    const scanResult = await scanReceiptWithAi({
      comprobanteBase64,
      cuentasAsignadas,
    });

    return NextResponse.json(scanResult, { status: 200 });
  } catch (err: unknown) {
    const errorMsg =
      err instanceof Error ? err.message : 'Error inesperado escaneando comprobante';
    console.error('[API /api/portal/scan-receipt Error]:', errorMsg);

    return NextResponse.json(
      {
        ok: false,
        detected: false,
        error: errorMsg,
      },
      { status: 500 }
    );
  }
}
