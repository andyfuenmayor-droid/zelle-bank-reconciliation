import { NextRequest, NextResponse } from 'next/server';
import { isDatabaseAvailable, withTransaction } from '@/lib/db';
import { getDemoStore } from '@/lib/mock-seed-data';
import { FinancialTransactionRecord } from '@/types/reconciliation';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface BatchMatchPayload {
  alertIds?: string[];
  clienteId?: string;
  clienteNombreManual?: string;
  notasConciliacion?: string;
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const body = (await request.json()) as BatchMatchPayload;
    const alertIds = Array.isArray(body.alertIds)
      ? body.alertIds.map((id) => id.trim()).filter(Boolean)
      : [];
    const clienteNombreManual = body.clienteNombreManual?.trim() ?? '';
    const clienteId = body.clienteId?.trim() ?? '';
    const notasConciliacion =
      body.notasConciliacion?.trim() || 'Asignación masiva por lote (auditoría)';

    if (alertIds.length === 0) {
      return NextResponse.json(
        { ok: false, error: 'Debe seleccionar al menos una transacción para conciliar por lote.' },
        { status: 400 }
      );
    }

    if (!clienteNombreManual && !clienteId) {
      return NextResponse.json(
        { ok: false, error: 'Debe seleccionar o especificar un cliente titular destino.' },
        { status: 400 }
      );
    }

    const dbConnected = await isDatabaseAvailable();

    if (!dbConnected) {
      const store = getDemoStore();
      let matchedCount = 0;
      let totalNeto = 0;

      for (const id of alertIds) {
        const tx = store.transactions.find((t) => t.id === id);
        if (tx && tx.estado !== 'CONCILIADO') {
          tx.estado = 'CONCILIADO';
          tx.cliente_id = clienteId || 'demo-client-id';
          tx.cliente_asignado_nombre = clienteNombreManual || 'Cliente Demo';
          tx.conciliado_at = new Date().toISOString();
          tx.nota_auditoria = `Asignación por lote en modo Demo: ${notasConciliacion}`;
          matchedCount += 1;
          totalNeto += tx.monto_neto;
        }
      }

      return NextResponse.json({
        ok: true,
        mode: 'DEMO_FALLBACK',
        matchedCount,
        totalNeto,
        message: `Se asignaron ${matchedCount} transacciones en modo Demo a favor de "${clienteNombreManual}".`,
      });
    }

    const result = await withTransaction<{
      matchedCount: number;
      totalBruto: number;
      totalNeto: number;
      clienteNombre: string;
    }>(async (client) => {
      // 1. Resolver el cliente titular
      let resolvedClientId = clienteId;
      let resolvedClientName = clienteNombreManual;
      let feeZelle = 4.0;
      let feeBinance = 1.5;

      const clientLookup = await client.query<{
        id: string;
        nombre_titular: string;
        porcentaje_comision_zelle: number | null;
        porcentaje_comision_binance: number | null;
        porcentaje_comision: number | null;
      }>(
        clienteId
          ? `
            SELECT id, nombre_titular, porcentaje_comision_zelle, porcentaje_comision_binance, porcentaje_comision
            FROM clientes_titulares
            WHERE id = $1::uuid
            LIMIT 1;
          `
          : `
            SELECT id, nombre_titular, porcentaje_comision_zelle, porcentaje_comision_binance, porcentaje_comision
            FROM clientes_titulares
            WHERE UPPER(TRIM(nombre_titular)) = UPPER(TRIM($1))
            LIMIT 1;
          `,
        clienteId ? [clienteId] : [clienteNombreManual]
      );

      const foundClient = clientLookup.rows[0];
      if (!foundClient) {
        throw new Error(
          `El cliente titular "${clienteNombreManual || clienteId}" no existe en el sistema.`
        );
      }

      resolvedClientId = foundClient.id;
      resolvedClientName = foundClient.nombre_titular;
      feeZelle = Number(foundClient.porcentaje_comision_zelle ?? foundClient.porcentaje_comision ?? 4.0);
      feeBinance = Number(foundClient.porcentaje_comision_binance ?? 1.5);

      let matchedCount = 0;
      let totalBruto = 0;
      let totalNeto = 0;
      const sendersToLearn = new Set<string>();

      // 2. Procesar transacciones en lote
      for (const alertId of alertIds) {
        const txRes = await client.query<FinancialTransactionRecord>(
          `
          SELECT *
          FROM financial_transactions_reconciliation
          WHERE id = $1::uuid
          FOR UPDATE;
          `,
          [alertId]
        );

        const currentTx = txRes.rows[0];
        if (!currentTx) {
          continue;
        }

        if (currentTx.estado === 'CONCILIADO') {
          continue; // Ya conciliado previamente, omitir
        }

        const isBinance = currentTx.plataforma.startsWith('BINANCE');
        const effectiveFee = isBinance ? feeBinance : feeZelle;

        const auditLog = `Asignación masiva por lote al cliente titular "${resolvedClientName}" (${effectiveFee}% com) el ${new Date().toISOString().slice(0, 16)}. Motivo: ${notasConciliacion}`;

        await client.query(
          `
          UPDATE financial_transactions_reconciliation
          SET estado = 'CONCILIADO',
              cliente_id = $1::uuid,
              cliente_asignado_nombre = $2,
              porcentaje_comision = $3,
              nota_auditoria = $4,
              conciliado_at = NOW()
          WHERE id = $5::uuid;
          `,
          [resolvedClientId, resolvedClientName, effectiveFee, auditLog, alertId]
        );

        matchedCount += 1;
        totalBruto += Number(currentTx.monto_bruto);
        const commissionAmt = (Number(currentTx.monto_bruto) * effectiveFee) / 100;
        totalNeto += Number(currentTx.monto_bruto) - commissionAmt;

        const sender = (currentTx.remitente_o_contraparte ?? '').trim();
        if (sender.length >= 3 && !sender.toLowerCase().startsWith('tarjeta')) {
          sendersToLearn.add(sender);
        }
      }

      // 3. Auto-aprendizaje: agregar remitentes de los pagos autorizados al cliente
      for (const s of sendersToLearn) {
        await client.query(
          `
          UPDATE clientes_titulares
          SET remitentes_autorizados = ARRAY_APPEND(
            COALESCE(remitentes_autorizados, ARRAY[]::text[]),
            $1
          )
          WHERE id = $2::uuid
            AND NOT ($1 = ANY(COALESCE(remitentes_autorizados, ARRAY[]::text[])));
          `,
          [s, resolvedClientId]
        ).catch(() => undefined);
      }

      return {
        matchedCount,
        totalBruto,
        totalNeto,
        clienteNombre: resolvedClientName,
      };
    });

    return NextResponse.json({
      ok: true,
      matchedCount: result.matchedCount,
      totalBruto: result.totalBruto,
      totalNeto: result.totalNeto,
      clienteNombre: result.clienteNombre,
      message: `Se asignaron ${result.matchedCount} pagos exitosamente a favor de "${result.clienteNombre}". Saldo neto total acreditado: $${result.totalNeto.toFixed(2)} USD.`,
    });
  } catch (error: unknown) {
    const message =
      error instanceof Error
        ? error.message
        : 'Error inesperado durante la asignación masiva de transacciones.';
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
