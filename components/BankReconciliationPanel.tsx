'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import {
  AlertTriangle,
  ArrowDownLeft,
  ArrowUpRight,
  Building2,
  CheckCircle2,
  Clock,
  Cpu,
  DollarSign,
  FileText,
  Filter,
  Loader2,
  MailPlus,
  Percent,
  RefreshCw,
  Search,
  ShieldCheck,
  Sparkles,
  UserCheck,
  Wallet,
  X,
} from 'lucide-react';
import {
  INITIAL_DEMO_ALERTS,
  INITIAL_DEMO_PENDING_ORDERS,
} from '@/lib/mock-seed-data';
import {
  AlertStatus,
  BankEmailAlertRecord,
  BankName,
  FinancialSummaryMetrics,
  MovementType,
  PendingPaymentOrder,
} from '@/types/reconciliation';

const usdFormatter = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

function formatUsd(amount: number): string {
  return usdFormatter.format(Number.isFinite(amount) ? amount : 0);
}

function formatDateTime(isoString: string): string {
  const date = new Date(isoString);
  if (Number.isNaN(date.getTime())) {
    return isoString;
  }
  return new Intl.DateTimeFormat('es-ES', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date);
}

const SAMPLE_TEMPLATES: ReadonlyArray<{
  label: string;
  from: string;
  subject: string;
  body: string;
}> = [
  {
    label: 'Citibank Zelle Recibido (Inglés)',
    from: 'alerts@citibank.com',
    subject: 'Citibank® Alert: You received a Zelle® payment',
    body: `<html><body>
      <h2>Citibank® Account Alert</h2>
      <p>You received a Zelle® payment of <strong>$1,450.00</strong> from <strong>ALEJANDRO JOSE PEREZ</strong>.</p>
      <table>
        <tr><td>Amount</td><td>$1,450.00</td></tr>
        <tr><td>From</td><td>ALEJANDRO JOSE PEREZ</td></tr>
        <tr><td>Confirmation Number</td><td>CITI992048112</td></tr>
      </table>
      <p>The money has been deposited into your Citibank checking account.</p>
    </body></html>`,
  },
  {
    label: 'TD Bank Zelle de Tercero / LLC (Inglés)',
    from: 'no-reply@tdbank.com',
    subject: 'TD Bank: Zelle® payment deposited',
    body: `TD Bank Online Banking Alert
Zelle® payment from GLOBAL LOGISTICS HOLDINGS LLC has been deposited into your account.
Amount: $1,850.00
Sender Name: GLOBAL LOGISTICS HOLDINGS LLC
Confirmation Code: TDZ77482910`,
  },
  {
    label: 'Citibank Zelle Recibido (Español)',
    from: 'notificaciones@alerts.citibank.com',
    subject: 'Alerta de Citibank: Recibiste un pago con Zelle®',
    body: `Hola:
Has recibido un pago con Zelle® de GABRIELA CAROLINA MENDEZ por $780.00 en tu cuenta corriente.
Monto: $780.00
Remitente: GABRIELA CAROLINA MENDEZ
Número de confirmación: CITI330194827`,
  },
];

export default function BankReconciliationPanel(): React.JSX.Element {
  const [alerts, setAlerts] = useState<BankEmailAlertRecord[]>([
    ...INITIAL_DEMO_ALERTS,
  ]);
  const [pendingOrders, setPendingOrders] = useState<PendingPaymentOrder[]>([
    ...INITIAL_DEMO_PENDING_ORDERS,
  ]);
  const [dataSourceMode, setDataSourceMode] = useState<
    'POSTGRESQL_LIVE' | 'DEMO_FALLBACK'
  >('DEMO_FALLBACK');

  // Estados de filtros
  const [bankFilter, setBankFilter] = useState<'TODOS' | BankName>('TODOS');
  const [movementFilter, setMovementFilter] = useState<'TODOS' | MovementType>(
    'TODOS'
  );
  const [statusFilter, setStatusFilter] = useState<'TODOS' | AlertStatus>(
    'TODOS'
  );
  const [searchQuery, setSearchQuery] = useState<string>('');

  // Estados de carga y feedback
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [isSyncingImap, setIsSyncingImap] = useState<boolean>(false);
  const [bannerMessage, setBannerMessage] = useState<{
    type: 'success' | 'info' | 'warning' | 'error';
    text: string;
  } | null>(null);

  // Estado del Modal de Conciliación Manual
  const [selectedAlertForMatch, setSelectedAlertForMatch] =
    useState<BankEmailAlertRecord | null>(null);
  const [selectedOrderId, setSelectedOrderId] = useState<string>('');
  const [manualClientName, setManualClientName] = useState<string>('');
  const [manualNotes, setManualNotes] = useState<string>('');
  const [isSubmittingMatch, setIsSubmittingMatch] = useState<boolean>(false);

  // Estado del Modal de Inspección de Correo Crudo
  const [inspectedAlert, setInspectedAlert] =
    useState<BankEmailAlertRecord | null>(null);

  // Estado del Modal de Prueba del Motor de Parseo Híbrido
  const [isSimulatorOpen, setIsSimulatorOpen] = useState<boolean>(false);
  const [simFrom, setSimFrom] = useState<string>(
    SAMPLE_TEMPLATES[0]?.from ?? 'alerts@citibank.com'
  );
  const [simSubject, setSimSubject] = useState<string>(
    SAMPLE_TEMPLATES[0]?.subject ?? ''
  );
  const [simBody, setSimBody] = useState<string>(
    SAMPLE_TEMPLATES[0]?.body ?? ''
  );
  const [isSimulating, setIsSimulating] = useState<boolean>(false);

  const fetchReconciliationData = useCallback(async () => {
    setIsLoading(true);
    try {
      const response = await fetch('/api/reconciliation/alerts', {
        method: 'GET',
        cache: 'no-store',
      });
      if (response.ok) {
        const data = (await response.json()) as {
          ok: boolean;
          mode?: 'POSTGRESQL_LIVE' | 'DEMO_FALLBACK';
          alerts?: BankEmailAlertRecord[];
          pendingOrders?: PendingPaymentOrder[];
        };

        if (data.ok && Array.isArray(data.alerts)) {
          setAlerts(data.alerts);
          if (Array.isArray(data.pendingOrders)) {
            setPendingOrders(data.pendingOrders);
          }
          if (data.mode) {
            setDataSourceMode(data.mode);
          }
        }
      }
    } catch {
      // Mantiene datos locales si ocurre un error de red
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchReconciliationData();
  }, [fetchReconciliationData]);

  // Cálculo de tarjetas de resumen financiero (sobre alertas RECIBIDAS / ENVIADAS)
  const financialMetrics = useMemo<FinancialSummaryMetrics>(() => {
    let totalBrutoRecibido = 0;
    let totalComisionDescontada = 0;
    let totalNetoDisponible = 0;
    let totalBrutoEnviado = 0;
    let pagosConciliadosCount = 0;
    let pagosRevisionManualCount = 0;
    let pagosDetectadosCount = 0;

    for (const alert of alerts) {
      if (alert.tipo_movimiento === 'RECIBIDO') {
        totalBrutoRecibido += alert.monto_bruto;
        totalComisionDescontada += alert.monto_comision;
        totalNetoDisponible += alert.monto_neto;
      } else {
        totalBrutoEnviado += alert.monto_bruto;
      }

      if (alert.estado === 'CONCILIADO') {
        pagosConciliadosCount += 1;
      } else if (alert.estado === 'REVISION_MANUAL') {
        pagosRevisionManualCount += 1;
      } else if (alert.estado === 'DETECTADO') {
        pagosDetectadosCount += 1;
      }
    }

    return {
      totalBrutoRecibido: Math.round(totalBrutoRecibido * 100) / 100,
      totalComisionDescontada: Math.round(totalComisionDescontada * 100) / 100,
      totalNetoDisponible: Math.round(totalNetoDisponible * 100) / 100,
      totalBrutoEnviado: Math.round(totalBrutoEnviado * 100) / 100,
      pagosConciliadosCount,
      pagosRevisionManualCount,
      pagosDetectadosCount,
    };
  }, [alerts]);

  // Filtrado reactivo en cliente (además de soporte en servidor)
  const filteredAlerts = useMemo<BankEmailAlertRecord[]>(() => {
    const normalizedQuery = searchQuery.trim().toLowerCase();

    return alerts.filter((item) => {
      if (bankFilter !== 'TODOS' && item.banco !== bankFilter) {
        return false;
      }
      if (
        movementFilter !== 'TODOS' &&
        item.tipo_movimiento !== movementFilter
      ) {
        return false;
      }
      if (statusFilter !== 'TODOS' && item.estado !== statusFilter) {
        return false;
      }
      if (normalizedQuery.length > 0) {
        const sender = (item.remitente_o_destinatario ?? '').toLowerCase();
        const ref = (item.referencia ?? '').toLowerCase();
        const client = (item.cliente_asignado_nombre ?? '').toLowerCase();
        const msgId = item.message_id.toLowerCase();
        return (
          sender.includes(normalizedQuery) ||
          ref.includes(normalizedQuery) ||
          client.includes(normalizedQuery) ||
          msgId.includes(normalizedQuery)
        );
      }
      return true;
    });
  }, [alerts, bankFilter, movementFilter, statusFilter, searchQuery]);

  // Ejecutar sincronización IMAP contra `/api/cron/sync-bank-alerts`
  const handleSyncImapNow = async (): Promise<void> => {
    setIsSyncingImap(true);
    setBannerMessage(null);

    try {
      const response = await fetch('/api/cron/sync-bank-alerts', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${
            process.env.NEXT_PUBLIC_CRON_PREVIEW_TOKEN ?? ''
          }`,
        },
      });

      const payload = (await response.json()) as {
        ok: boolean;
        insertedCount?: number;
        reconciledCount?: number;
        duplicateCount?: number;
        error?: string;
      };

      if (response.ok && payload.ok) {
        setBannerMessage({
          type: 'success',
          text: `Sincronización IMAP completada: ${payload.insertedCount ?? 0} nuevas alertas insertadas, ${payload.reconciledCount ?? 0} conciliadas automáticamente y ${payload.duplicateCount ?? 0} duplicados omitidos por idempotencia.`,
        });
        await fetchReconciliationData();
      } else {
        // Si no hay servidor IMAP o CRON_SECRET en el entorno local, refrescamos la tabla e informamos
        await fetchReconciliationData();
        setBannerMessage({
          type: 'info',
          text:
            payload.error ??
            'Vista actualizada. Configura IMAP_HOST, IMAP_USER, IMAP_PASS y CRON_SECRET en .env para lectura IMAP en vivo.',
        });
      }
    } catch {
      setBannerMessage({
        type: 'warning',
        text: 'No se pudo conectar al worker IMAP. Verifica las variables de entorno.',
      });
    } finally {
      setIsSyncingImap(false);
    }
  };

  // Abrir modal de conciliación manual pre-seleccionando orden coincidente por monto si existe
  const openManualReconciliationModal = (
    alert: BankEmailAlertRecord
  ): void => {
    setSelectedAlertForMatch(alert);

    const exactAmountOrder = pendingOrders.find(
      (order) =>
        order.estado === 'PENDIENTE' &&
        Math.abs(order.monto_esperado - alert.monto_bruto) < 0.01
    );

    if (exactAmountOrder) {
      setSelectedOrderId(exactAmountOrder.id);
      setManualClientName(exactAmountOrder.cliente_nombre);
    } else {
      setSelectedOrderId('');
      setManualClientName(alert.cliente_asignado_nombre ?? '');
    }

    setManualNotes(
      `Verificado manualmente: Zelle enviado por tercero (${
        alert.remitente_o_destinatario ?? 'Sin nombre'
      }) autorizado por el titular de la cuenta.`
    );
  };

  // Confirmar conciliación manual
  const handleConfirmManualReconciliation = async (
    event: React.FormEvent<HTMLFormElement>
  ): Promise<void> => {
    event.preventDefault();
    if (!selectedAlertForMatch) {
      return;
    }

    const matchedOrder = pendingOrders.find((o) => o.id === selectedOrderId);
    const targetClientName =
      matchedOrder?.cliente_nombre || manualClientName.trim();

    if (!targetClientName) {
      setBannerMessage({
        type: 'error',
        text: 'Selecciona una orden pendiente o ingresa el nombre del cliente titular.',
      });
      return;
    }

    setIsSubmittingMatch(true);
    try {
      const response = await fetch('/api/reconciliation/manual-match', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          alertId: selectedAlertForMatch.id,
          ordenPagoId: selectedOrderId || null,
          clienteNombreManual: targetClientName,
          notasConciliacion: manualNotes.trim(),
        }),
      });

      const result = (await response.json()) as {
        ok: boolean;
        alert?: BankEmailAlertRecord;
        error?: string;
      };

      if (!response.ok || !result.ok) {
        throw new Error(result.error ?? 'Error al conciliar manualmente.');
      }

      // Actualizar estado en el panel
      const nowIso = new Date().toISOString();
      setAlerts((prev) =>
        prev.map((item) =>
          item.id === selectedAlertForMatch.id
            ? {
                ...item,
                estado: 'CONCILIADO',
                orden_pago_id: selectedOrderId || null,
                cliente_asignado_nombre: targetClientName,
                notas_conciliacion:
                  manualNotes.trim() ||
                  `Conciliado manualmente a favor de ${targetClientName}.`,
                conciliado_at: nowIso,
              }
            : item
        )
      );

      if (selectedOrderId) {
        setPendingOrders((prev) =>
          prev.filter((order) => order.id !== selectedOrderId)
        );
      }

      setBannerMessage({
        type: 'success',
        text: `Pago Zelle de ${formatUsd(selectedAlertForMatch.monto_bruto)} (Neto: ${formatUsd(
          selectedAlertForMatch.monto_neto
        )}) conciliado exitosamente a favor de "${targetClientName}".`,
      });
      setSelectedAlertForMatch(null);
    } catch (error: unknown) {
      const msg =
        error instanceof Error
          ? error.message
          : 'Error inesperado al conciliar pago.';
      setBannerMessage({ type: 'error', text: msg });
    } finally {
      setIsSubmittingMatch(false);
    }
  };

  // Ejecutar simulador del motor de parseo híbrido (`lib/bank-parser.ts`)
  const handleRunEmailSimulator = async (
    event: React.FormEvent<HTMLFormElement>
  ): Promise<void> => {
    event.preventDefault();
    setIsSimulating(true);
    setBannerMessage(null);

    try {
      const response = await fetch('/api/reconciliation/alerts', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          fromAddress: simFrom,
          subject: simSubject,
          rawEmailBody: simBody,
        }),
      });

      const result = (await response.json()) as {
        ok: boolean;
        alert?: BankEmailAlertRecord;
        error?: string;
      };

      if (!response.ok || !result.ok || !result.alert) {
        throw new Error(
          result.error ?? 'No se pudo extraer información del correo.'
        );
      }

      const newAlert = result.alert;

      // Si estamos en modo demo, intentar auto-conciliación local contra pendingOrders
      if (dataSourceMode === 'DEMO_FALLBACK' && newAlert.tipo_movimiento === 'RECIBIDO') {
        const exactMatchOrder = pendingOrders.find(
          (o) =>
            o.estado === 'PENDIENTE' &&
            Math.abs(o.monto_esperado - newAlert.monto_bruto) < 0.01 &&
            o.referencia_reportada &&
            newAlert.referencia &&
            o.referencia_reportada.toUpperCase() ===
              newAlert.referencia.toUpperCase()
        );

        const sameAmountOrder = pendingOrders.find(
          (o) =>
            o.estado === 'PENDIENTE' &&
            Math.abs(o.monto_esperado - newAlert.monto_bruto) < 0.01
        );

        if (exactMatchOrder) {
          newAlert.estado = 'CONCILIADO';
          newAlert.orden_pago_id = exactMatchOrder.id;
          newAlert.cliente_asignado_nombre = exactMatchOrder.cliente_nombre;
          newAlert.notas_conciliacion = `Conciliación automática exacta por monto y referencia con orden ${exactMatchOrder.codigo_orden}.`;
          newAlert.conciliado_at = new Date().toISOString();
          setPendingOrders((prev) =>
            prev.filter((o) => o.id !== exactMatchOrder.id)
          );
        } else if (sameAmountOrder) {
          newAlert.estado = 'REVISION_MANUAL';
          newAlert.notas_conciliacion = `Monto exacto (${formatUsd(
            newAlert.monto_bruto
          )}) coincide con orden ${
            sameAmountOrder.codigo_orden
          }, pero el remitente Zelle ("${
            newAlert.remitente_o_destinatario ?? 'Desconocido'
          }") difiere del titular ("${
            sameAmountOrder.cliente_nombre
          }"). Requiere asignación manual.`;
        }
      }

      setAlerts((prev) => [newAlert, ...prev]);
      setIsSimulatorOpen(false);
      setBannerMessage({
        type: 'success',
        text: `Alerta procesada vía ${newAlert.metodo_extraccion}: ${newAlert.banco} | Bruto ${formatUsd(
          newAlert.monto_bruto
        )} | Comisión (4%): ${formatUsd(
          newAlert.monto_comision
        )} | Neto: ${formatUsd(newAlert.monto_neto)}.`,
      });
    } catch (error: unknown) {
      const msg =
        error instanceof Error ? error.message : 'Error al parsear correo.';
      setBannerMessage({ type: 'error', text: msg });
    } finally {
      setIsSimulating(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        {/* Encabezado Principal */}
        <header className="mb-8 flex flex-col gap-4 border-b border-slate-800/80 pb-6 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <div className="flex items-center gap-2.5">
              <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-3 py-1 text-xs font-semibold tracking-wide text-emerald-400">
                <ShieldCheck className="h-3.5 w-3.5" />
                FINTECH TREASURY ENGINE
              </span>
              <span
                className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium ${
                  dataSourceMode === 'POSTGRESQL_LIVE'
                    ? 'border-sky-500/30 bg-sky-500/10 text-sky-300'
                    : 'border-amber-500/30 bg-amber-500/10 text-amber-300'
                }`}
              >
                {dataSourceMode === 'POSTGRESQL_LIVE'
                  ? 'PostgreSQL Pool Activo'
                  : 'Modo Previsualización Interactiva'}
              </span>
            </div>
            <h1 className="mt-2 text-2xl font-bold tracking-tight text-white sm:text-3xl">
              Conciliación Automática Zelle &amp; Transferencias
            </h1>
            <p className="mt-1 text-sm text-slate-400">
              Monitoreo IMAP de Citibank y TD Bank · Extracción Híbrida (Regex +
              AI Fallback) · Retención automática del 4.00% de comisión
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={() => setIsSimulatorOpen(true)}
              className="inline-flex items-center gap-2 rounded-lg border border-slate-700 bg-slate-900 px-4 py-2.5 text-sm font-medium text-slate-200 transition hover:border-slate-600 hover:bg-slate-800"
            >
              <MailPlus className="h-4 w-4 text-sky-400" />
              Probar Parser con Email
            </button>

            <button
              type="button"
              onClick={() => void handleSyncImapNow()}
              disabled={isSyncingImap || isLoading}
              className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white shadow-lg shadow-emerald-950/50 transition hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isSyncingImap ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <RefreshCw className="h-4 w-4" />
              )}
              Sincronizar Ahora
            </button>
          </div>
        </header>

        {/* Notificación de Estado */}
        {bannerMessage && (
          <div
            className={`mb-6 flex items-center justify-between rounded-xl border px-4 py-3 text-sm ${
              bannerMessage.type === 'success'
                ? 'border-emerald-500/40 bg-emerald-950/50 text-emerald-200'
                : bannerMessage.type === 'warning'
                  ? 'border-amber-500/40 bg-amber-950/50 text-amber-200'
                  : bannerMessage.type === 'error'
                    ? 'border-rose-500/40 bg-rose-950/50 text-rose-200'
                    : 'border-sky-500/40 bg-sky-950/50 text-sky-200'
            }`}
          >
            <div className="flex items-center gap-2.5">
              <Sparkles className="h-4 w-4 shrink-0" />
              <span>{bannerMessage.text}</span>
            </div>
            <button
              type="button"
              onClick={() => setBannerMessage(null)}
              className="ml-4 rounded p-1 opacity-70 hover:opacity-100"
              aria-label="Cerrar aviso"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        )}

        {/* Tarjetas de Resumen Financiero (5 KPIs Requeridos) */}
        <section
          aria-label="Resumen Financiero"
          className="mb-8 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5"
        >
          {/* 1. Total Bruto Recibido */}
          <div className="rounded-xl border border-slate-800 bg-slate-900/80 p-5 shadow-sm">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium uppercase tracking-wider text-slate-400">
                Total Bruto Recibido
              </span>
              <span className="rounded-lg bg-sky-500/10 p-2 text-sky-400">
                <DollarSign className="h-4 w-4" />
              </span>
            </div>
            <p className="mt-3 font-mono text-2xl font-bold text-white">
              {formatUsd(financialMetrics.totalBrutoRecibido)}
            </p>
            <p className="mt-1 text-xs text-slate-400">
              Depósitos Zelle / Wire entrantes
            </p>
          </div>

          {/* 2. Total Comisión Descontada (4%) */}
          <div className="rounded-xl border border-slate-800 bg-slate-900/80 p-5 shadow-sm">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium uppercase tracking-wider text-slate-400">
                Comisión Descontada (4%)
              </span>
              <span className="rounded-lg bg-violet-500/10 p-2 text-violet-400">
                <Percent className="h-4 w-4" />
              </span>
            </div>
            <p className="mt-3 font-mono text-2xl font-bold text-violet-300">
              -{formatUsd(financialMetrics.totalComisionDescontada)}
            </p>
            <p className="mt-1 text-xs text-slate-400">
              Calculada en columna GENERATED SQL
            </p>
          </div>

          {/* 3. Total Neto Disponible */}
          <div className="rounded-xl border border-emerald-500/30 bg-gradient-to-br from-emerald-950/40 via-slate-900 to-slate-900 p-5 shadow-sm">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold uppercase tracking-wider text-emerald-300">
                Total Neto Disponible
              </span>
              <span className="rounded-lg bg-emerald-500/20 p-2 text-emerald-400">
                <Wallet className="h-4 w-4" />
              </span>
            </div>
            <p className="mt-3 font-mono text-2xl font-bold text-emerald-400">
              {formatUsd(financialMetrics.totalNetoDisponible)}
            </p>
            <p className="mt-1 text-xs text-emerald-300/70">
              Saldo líquido acreditable a clientes
            </p>
          </div>

          {/* 4. Pagos Conciliados */}
          <div className="rounded-xl border border-slate-800 bg-slate-900/80 p-5 shadow-sm">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium uppercase tracking-wider text-slate-400">
                Pagos Conciliados
              </span>
              <span className="rounded-lg bg-emerald-500/10 p-2 text-emerald-400">
                <CheckCircle2 className="h-4 w-4" />
              </span>
            </div>
            <p className="mt-3 font-mono text-2xl font-bold text-white">
              {financialMetrics.pagosConciliadosCount}
            </p>
            <p className="mt-1 text-xs text-slate-400">
              Match exacto + similitud pg_trgm
            </p>
          </div>

          {/* 5. Pagos en Revisión Manual */}
          <div className="rounded-xl border border-amber-500/30 bg-slate-900/80 p-5 shadow-sm">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium uppercase tracking-wider text-amber-300">
                Revisión Manual
              </span>
              <span className="rounded-lg bg-amber-500/10 p-2 text-amber-400">
                <AlertTriangle className="h-4 w-4" />
              </span>
            </div>
            <p className="mt-3 font-mono text-2xl font-bold text-amber-400">
              {financialMetrics.pagosRevisionManualCount}
            </p>
            <p className="mt-1 text-xs text-slate-400">
              Zelle de terceros o AI Fallback
            </p>
          </div>
        </section>

        {/* Barra de Filtros y Buscador */}
        <section
          aria-label="Filtros de Conciliación"
          className="mb-6 rounded-xl border border-slate-800 bg-slate-900/70 p-4"
        >
          <div className="grid grid-cols-1 gap-4 md:grid-cols-12">
            {/* Buscador por nombre o referencia */}
            <div className="relative md:col-span-5">
              <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Buscar por remitente Zelle, referencia o cliente..."
                className="w-full rounded-lg border border-slate-700 bg-slate-950 py-2 pl-10 pr-4 text-sm text-slate-100 placeholder-slate-500 focus:border-emerald-500 focus:outline-none"
              />
            </div>

            {/* Filtro por Banco */}
            <div className="md:col-span-2">
              <label htmlFor="filter-bank" className="sr-only">
                Banco
              </label>
              <div className="relative">
                <Building2 className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <select
                  id="filter-bank"
                  value={bankFilter}
                  onChange={(e) =>
                    setBankFilter(e.target.value as 'TODOS' | BankName)
                  }
                  className="w-full rounded-lg border border-slate-700 bg-slate-950 py-2 pl-9 pr-3 text-sm text-slate-200 focus:border-emerald-500 focus:outline-none"
                >
                  <option value="TODOS">Todos los Bancos</option>
                  <option value="CITIBANK">Citibank</option>
                  <option value="TD_BANK">TD Bank</option>
                  <option value="OTRO">Otro Banco</option>
                </select>
              </div>
            </div>

            {/* Filtro por Tipo de Movimiento */}
            <div className="md:col-span-2">
              <label htmlFor="filter-movement" className="sr-only">
                Tipo de Movimiento
              </label>
              <select
                id="filter-movement"
                value={movementFilter}
                onChange={(e) =>
                  setMovementFilter(e.target.value as 'TODOS' | MovementType)
                }
                className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200 focus:border-emerald-500 focus:outline-none"
              >
                <option value="TODOS">Recibidos y Enviados</option>
                <option value="RECIBIDO">Recibido (Ingreso)</option>
                <option value="ENVIADO">Enviado (Egreso)</option>
              </select>
            </div>

            {/* Filtro por Estado */}
            <div className="md:col-span-3">
              <label htmlFor="filter-status" className="sr-only">
                Estado de Conciliación
              </label>
              <div className="relative">
                <Filter className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <select
                  id="filter-status"
                  value={statusFilter}
                  onChange={(e) =>
                    setStatusFilter(e.target.value as 'TODOS' | AlertStatus)
                  }
                  className="w-full rounded-lg border border-slate-700 bg-slate-950 py-2 pl-9 pr-3 text-sm text-slate-200 focus:border-emerald-500 focus:outline-none"
                >
                  <option value="TODOS">Todos los Estados</option>
                  <option value="CONCILIADO">Conciliado</option>
                  <option value="REVISION_MANUAL">En Revisión Manual</option>
                  <option value="DETECTADO">Detectado (Sin Orden)</option>
                </select>
              </div>
            </div>
          </div>
        </section>

        {/* Tabla Interactiva de Alertas de Correo y Conciliación */}
        <section className="overflow-hidden rounded-xl border border-slate-800 bg-slate-900/70 shadow-xl">
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-left text-sm">
              <thead>
                <tr className="border-b border-slate-800 bg-slate-950/70 text-xs font-semibold uppercase tracking-wider text-slate-400">
                  <th className="px-4 py-3.5">Banco &amp; Fecha</th>
                  <th className="px-4 py-3.5">Flujo</th>
                  <th className="px-4 py-3.5">
                    Remitente Zelle / Titular Asignado
                  </th>
                  <th className="px-4 py-3.5">Referencia &amp; Motor</th>
                  <th className="px-4 py-3.5 text-right">Monto Bruto</th>
                  <th className="px-4 py-3.5 text-right">Comisión (4%)</th>
                  <th className="px-4 py-3.5 text-right">Monto Neto</th>
                  <th className="px-4 py-3.5">Estado</th>
                  <th className="px-4 py-3.5 text-right">Acciones</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/70">
                {filteredAlerts.length === 0 ? (
                  <tr>
                    <td
                      colSpan={9}
                      className="px-6 py-12 text-center text-slate-400"
                    >
                      No se encontraron alertas bancarias con los filtros
                      seleccionados.
                    </td>
                  </tr>
                ) : (
                  filteredAlerts.map((alert) => (
                    <tr
                      key={alert.id}
                      className="transition hover:bg-slate-800/40"
                    >
                      {/* Banco y Fecha */}
                      <td className="whitespace-nowrap px-4 py-4">
                        <div className="flex items-center gap-2">
                          <span
                            className={`inline-flex items-center rounded-md px-2 py-0.5 text-xs font-bold ${
                              alert.banco === 'CITIBANK'
                                ? 'border border-sky-500/30 bg-sky-500/15 text-sky-300'
                                : alert.banco === 'TD_BANK'
                                  ? 'border border-emerald-500/30 bg-emerald-500/15 text-emerald-300'
                                  : 'border border-slate-600 bg-slate-800 text-slate-300'
                            }`}
                          >
                            {alert.banco === 'CITIBANK'
                              ? 'Citibank'
                              : alert.banco === 'TD_BANK'
                                ? 'TD Bank'
                                : 'Otro'}
                          </span>
                        </div>
                        <p className="mt-1 text-xs text-slate-400">
                          {formatDateTime(alert.fecha_transaccion)}
                        </p>
                      </td>

                      {/* Tipo de Movimiento */}
                      <td className="whitespace-nowrap px-4 py-4">
                        {alert.tipo_movimiento === 'RECIBIDO' ? (
                          <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-2.5 py-1 text-xs font-medium text-emerald-400">
                            <ArrowDownLeft className="h-3.5 w-3.5" />
                            Recibido
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 rounded-full bg-rose-500/10 px-2.5 py-1 text-xs font-medium text-rose-400">
                            <ArrowUpRight className="h-3.5 w-3.5" />
                            Enviado
                          </span>
                        )}
                      </td>

                      {/* Remitente o Destinatario + Cliente Titular */}
                      <td className="max-w-xs px-4 py-4">
                        <div className="font-semibold text-white">
                          {alert.remitente_o_destinatario ?? (
                            <span className="italic text-amber-400">
                              Remitente no identificado
                            </span>
                          )}
                        </div>
                        {alert.cliente_asignado_nombre ? (
                          <div className="mt-1 flex items-center gap-1 text-xs text-emerald-400">
                            <UserCheck className="h-3.5 w-3.5 shrink-0" />
                            <span className="truncate">
                              Titular: {alert.cliente_asignado_nombre}
                            </span>
                          </div>
                        ) : (
                          alert.notas_conciliacion && (
                            <p className="mt-1 line-clamp-2 text-xs text-slate-400">
                              {alert.notas_conciliacion}
                            </p>
                          )
                        )}
                      </td>

                      {/* Referencia y Método de Extracción */}
                      <td className="whitespace-nowrap px-4 py-4">
                        <div className="font-mono text-xs font-medium text-slate-200">
                          {alert.referencia ?? 'SIN-REF'}
                        </div>
                        <span
                          className={`mt-1 inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] font-medium ${
                            alert.metodo_extraccion === 'REGEX'
                              ? 'bg-slate-800 text-slate-300'
                              : 'border border-purple-500/30 bg-purple-500/15 text-purple-300'
                          }`}
                        >
                          <Cpu className="h-3 w-3" />
                          {alert.metodo_extraccion}
                        </span>
                      </td>

                      {/* Monto Bruto */}
                      <td className="whitespace-nowrap px-4 py-4 text-right font-mono font-semibold text-slate-100">
                        {formatUsd(alert.monto_bruto)}
                      </td>

                      {/* Comisión (4%) */}
                      <td className="whitespace-nowrap px-4 py-4 text-right font-mono text-xs text-violet-300">
                        {alert.monto_comision > 0
                          ? `-${formatUsd(alert.monto_comision)} (${alert.porcentaje_comision}%)`
                          : '$0.00'}
                      </td>

                      {/* Monto Neto */}
                      <td className="whitespace-nowrap px-4 py-4 text-right font-mono font-bold text-emerald-400">
                        {formatUsd(alert.monto_neto)}
                      </td>

                      {/* Estado */}
                      <td className="whitespace-nowrap px-4 py-4">
                        {alert.estado === 'CONCILIADO' && (
                          <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/30 bg-emerald-500/15 px-2.5 py-1 text-xs font-semibold text-emerald-300">
                            <CheckCircle2 className="h-3.5 w-3.5" />
                            CONCILIADO
                          </span>
                        )}
                        {alert.estado === 'REVISION_MANUAL' && (
                          <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-500/30 bg-amber-500/15 px-2.5 py-1 text-xs font-semibold text-amber-300">
                            <AlertTriangle className="h-3.5 w-3.5" />
                            REVISIÓN MANUAL
                          </span>
                        )}
                        {alert.estado === 'DETECTADO' && (
                          <span className="inline-flex items-center gap-1.5 rounded-full border border-sky-500/30 bg-sky-500/15 px-2.5 py-1 text-xs font-semibold text-sky-300">
                            <Clock className="h-3.5 w-3.5" />
                            DETECTADO
                          </span>
                        )}
                      </td>

                      {/* Acciones */}
                      <td className="whitespace-nowrap px-4 py-4 text-right">
                        <div className="flex items-center justify-end gap-2">
                          <button
                            type="button"
                            onClick={() => setInspectedAlert(alert)}
                            className="inline-flex items-center gap-1 rounded-lg border border-slate-700 bg-slate-800/80 px-2.5 py-1.5 text-xs font-medium text-slate-300 transition hover:bg-slate-700"
                            title="Ver cuerpo original del correo"
                          >
                            <FileText className="h-3.5 w-3.5" />
                            Email
                          </button>

                          {alert.estado !== 'CONCILIADO' &&
                            alert.tipo_movimiento === 'RECIBIDO' && (
                              <button
                                type="button"
                                onClick={() =>
                                  openManualReconciliationModal(alert)
                                }
                                className="inline-flex items-center gap-1.5 rounded-lg bg-amber-500 px-3 py-1.5 text-xs font-semibold text-slate-950 transition hover:bg-amber-400"
                              >
                                <UserCheck className="h-3.5 w-3.5" />
                                Conciliar Manual
                              </button>
                            )}
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>

        {/* =====================================================================
            MODAL RADIX UI: CONCILIACIÓN MANUAL (ZELLE DE TERCERO -> CLIENTE)
           ===================================================================== */}
        <Dialog.Root
          open={selectedAlertForMatch !== null}
          onOpenChange={(open) => {
            if (!open) {
              setSelectedAlertForMatch(null);
            }
          }}
        >
          <Dialog.Portal>
            <Dialog.Overlay className="fixed inset-0 z-40 bg-slate-950/80 backdrop-blur-sm" />
            <Dialog.Content className="fixed left-1/2 top-1/2 z-50 w-full max-w-xl -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-slate-800 bg-slate-900 p-6 text-slate-100 shadow-2xl">
              <div className="flex items-start justify-between border-b border-slate-800 pb-4">
                <div>
                  <Dialog.Title className="text-lg font-bold text-white">
                    Conciliación Manual de Pago Zelle
                  </Dialog.Title>
                  <Dialog.Description className="mt-1 text-xs text-slate-400">
                    Asigna este depósito cuando el remitente Zelle difiere del
                    nombre del titular registrado en la cuenta.
                  </Dialog.Description>
                </div>
                <Dialog.Close asChild>
                  <button
                    type="button"
                    className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-800 hover:text-white"
                    aria-label="Cerrar"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </Dialog.Close>
              </div>

              {selectedAlertForMatch && (
                <form
                  onSubmit={(e) => void handleConfirmManualReconciliation(e)}
                  className="mt-5 space-y-5"
                >
                  {/* Resumen del Zelle detectado */}
                  <div className="rounded-xl border border-slate-800 bg-slate-950 p-4">
                    <div className="flex items-center justify-between text-xs text-slate-400">
                      <span>
                        Banco: <strong className="text-white">{selectedAlertForMatch.banco}</strong>
                      </span>
                      <span>
                        Ref:{' '}
                        <strong className="font-mono text-white">
                          {selectedAlertForMatch.referencia ?? 'N/A'}
                        </strong>
                      </span>
                    </div>
                    <div className="mt-2 text-sm">
                      <span className="text-slate-400">Remitente en Correo Zelle: </span>
                      <strong className="text-amber-300">
                        {selectedAlertForMatch.remitente_o_destinatario ??
                          'No especificado'}
                      </strong>
                    </div>
                    <div className="mt-3 grid grid-cols-3 gap-2 border-t border-slate-800 pt-3 text-center">
                      <div>
                        <span className="block text-[11px] uppercase text-slate-400">
                          Monto Bruto
                        </span>
                        <span className="font-mono text-sm font-bold text-white">
                          {formatUsd(selectedAlertForMatch.monto_bruto)}
                        </span>
                      </div>
                      <div>
                        <span className="block text-[11px] uppercase text-slate-400">
                          Comisión ({selectedAlertForMatch.porcentaje_comision}%)
                        </span>
                        <span className="font-mono text-sm font-semibold text-violet-300">
                          -{formatUsd(selectedAlertForMatch.monto_comision)}
                        </span>
                      </div>
                      <div>
                        <span className="block text-[11px] uppercase text-emerald-400">
                          Neto a Acreditar
                        </span>
                        <span className="font-mono text-sm font-bold text-emerald-400">
                          {formatUsd(selectedAlertForMatch.monto_neto)}
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* Selección de Orden de Pago Pendiente */}
                  <div>
                    <label
                      htmlFor="select-pending-order"
                      className="block text-xs font-semibold uppercase tracking-wider text-slate-300"
                    >
                      1. Vincular con Orden de Pago Pendiente (Opcional)
                    </label>
                    <select
                      id="select-pending-order"
                      value={selectedOrderId}
                      onChange={(e) => {
                        const orderId = e.target.value;
                        setSelectedOrderId(orderId);
                        const found = pendingOrders.find((o) => o.id === orderId);
                        if (found) {
                          setManualClientName(found.cliente_nombre);
                        }
                      }}
                      className="mt-1.5 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2.5 text-sm text-white focus:border-emerald-500 focus:outline-none"
                    >
                      <option value="">
                        -- Asignación directa sin orden previa --
                      </option>
                      {pendingOrders.map((order) => {
                        const isExactAmount =
                          Math.abs(
                            order.monto_esperado -
                              selectedAlertForMatch.monto_bruto
                          ) < 0.01;
                        return (
                          <option key={order.id} value={order.id}>
                            {isExactAmount ? '★ [MONTO EXACTO] ' : ''}
                            {order.codigo_orden} — {order.cliente_nombre} (
                            {formatUsd(order.monto_esperado)})
                          </option>
                        );
                      })}
                    </select>
                  </div>

                  {/* Nombre del Cliente Titular a acreditar */}
                  <div>
                    <label
                      htmlFor="manual-client-name"
                      className="block text-xs font-semibold uppercase tracking-wider text-slate-300"
                    >
                      2. Cliente / Titular de Cuenta a Acreditar
                    </label>
                    <input
                      id="manual-client-name"
                      type="text"
                      required
                      value={manualClientName}
                      onChange={(e) => setManualClientName(e.target.value)}
                      placeholder="Ej. Roberto Gómez (Comercializadora Gómez)"
                      className="mt-1.5 w-full rounded-lg border border-slate-700 bg-slate-950 px-3.5 py-2 text-sm text-white placeholder-slate-500 focus:border-emerald-500 focus:outline-none"
                    />
                  </div>

                  {/* Nota de Auditoría */}
                  <div>
                    <label
                      htmlFor="manual-audit-notes"
                      className="block text-xs font-semibold uppercase tracking-wider text-slate-300"
                    >
                      3. Justificación / Nota de Auditoría Bancaria
                    </label>
                    <textarea
                      id="manual-audit-notes"
                      rows={3}
                      value={manualNotes}
                      onChange={(e) => setManualNotes(e.target.value)}
                      className="mt-1.5 w-full rounded-lg border border-slate-700 bg-slate-950 px-3.5 py-2 text-sm text-slate-200 focus:border-emerald-500 focus:outline-none"
                    />
                  </div>

                  <div className="flex items-center justify-end gap-3 border-t border-slate-800 pt-4">
                    <Dialog.Close asChild>
                      <button
                        type="button"
                        className="rounded-lg border border-slate-700 px-4 py-2 text-sm font-medium text-slate-300 hover:bg-slate-800"
                      >
                        Cancelar
                      </button>
                    </Dialog.Close>
                    <button
                      type="submit"
                      disabled={isSubmittingMatch}
                      className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-5 py-2 text-sm font-semibold text-white hover:bg-emerald-500 disabled:opacity-60"
                    >
                      {isSubmittingMatch ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <CheckCircle2 className="h-4 w-4" />
                      )}
                      Confirmar Conciliación ({formatUsd(selectedAlertForMatch.monto_neto)} Neto)
                    </button>
                  </div>
                </form>
              )}
            </Dialog.Content>
          </Dialog.Portal>
        </Dialog.Root>

        {/* =====================================================================
            MODAL RADIX UI: INSPECTOR DE CORREO CRUDO (RAW EMAIL BODY)
           ===================================================================== */}
        <Dialog.Root
          open={inspectedAlert !== null}
          onOpenChange={(open) => {
            if (!open) {
              setInspectedAlert(null);
            }
          }}
        >
          <Dialog.Portal>
            <Dialog.Overlay className="fixed inset-0 z-40 bg-slate-950/80 backdrop-blur-sm" />
            <Dialog.Content className="fixed left-1/2 top-1/2 z-50 w-full max-w-lg -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-slate-800 bg-slate-900 p-6 text-slate-100 shadow-2xl">
              <div className="flex items-center justify-between border-b border-slate-800 pb-3">
                <Dialog.Title className="text-base font-bold text-white">
                  Cuerpo Original de la Alerta Bancaria
                </Dialog.Title>
                <Dialog.Close asChild>
                  <button
                    type="button"
                    className="rounded-lg p-1 text-slate-400 hover:bg-slate-800 hover:text-white"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </Dialog.Close>
              </div>
              {inspectedAlert && (
                <div className="mt-4 space-y-3 text-xs">
                  <div className="rounded-lg bg-slate-950 p-3 font-mono text-slate-300">
                    <div>Message-ID: {inspectedAlert.message_id}</div>
                    <div>Método: {inspectedAlert.metodo_extraccion}</div>
                  </div>
                  <pre className="max-h-72 overflow-y-auto whitespace-pre-wrap rounded-lg border border-slate-800 bg-slate-950 p-4 font-mono text-xs leading-relaxed text-slate-200">
                    {inspectedAlert.raw_body ?? 'Sin contenido raw_body.'}
                  </pre>
                </div>
              )}
            </Dialog.Content>
          </Dialog.Portal>
        </Dialog.Root>

        {/* =====================================================================
            MODAL RADIX UI: SIMULADOR DEL MOTOR DE PARSEO HÍBRIDO
           ===================================================================== */}
        <Dialog.Root
          open={isSimulatorOpen}
          onOpenChange={setIsSimulatorOpen}
        >
          <Dialog.Portal>
            <Dialog.Overlay className="fixed inset-0 z-40 bg-slate-950/80 backdrop-blur-sm" />
            <Dialog.Content className="fixed left-1/2 top-1/2 z-50 w-full max-w-2xl -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-slate-800 bg-slate-900 p-6 text-slate-100 shadow-2xl">
              <div className="flex items-start justify-between border-b border-slate-800 pb-4">
                <div>
                  <Dialog.Title className="text-lg font-bold text-white">
                    Simulador en Vivo del Motor Híbrido (Regex + AI Fallback)
                  </Dialog.Title>
                  <Dialog.Description className="mt-1 text-xs text-slate-400">
                    Pega un correo HTML o texto de Citibank / TD Bank para
                    ejecutar <code className="text-sky-300">parseBankAlertEmail()</code> y
                    calcular la comisión del 4%.
                  </Dialog.Description>
                </div>
                <Dialog.Close asChild>
                  <button
                    type="button"
                    className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-800 hover:text-white"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </Dialog.Close>
              </div>

              <form
                onSubmit={(e) => void handleRunEmailSimulator(e)}
                className="mt-4 space-y-4"
              >
                <div className="flex flex-wrap gap-2">
                  {SAMPLE_TEMPLATES.map((tpl, idx) => (
                    <button
                      key={idx}
                      type="button"
                      onClick={() => {
                        setSimFrom(tpl.from);
                        setSimSubject(tpl.subject);
                        setSimBody(tpl.body);
                      }}
                      className="rounded-md border border-slate-700 bg-slate-950 px-2.5 py-1 text-xs font-medium text-sky-300 hover:border-sky-500/50"
                    >
                      Cargar: {tpl.label}
                    </button>
                  ))}
                </div>

                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div>
                    <label className="block text-xs font-medium text-slate-300">
                      Remitente (From)
                    </label>
                    <input
                      type="text"
                      required
                      value={simFrom}
                      onChange={(e) => setSimFrom(e.target.value)}
                      className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-300">
                      Asunto (Subject)
                    </label>
                    <input
                      type="text"
                      required
                      value={simSubject}
                      onChange={(e) => setSimSubject(e.target.value)}
                      className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-300">
                    Cuerpo del Correo (HTML o Texto Plano)
                  </label>
                  <textarea
                    rows={6}
                    required
                    value={simBody}
                    onChange={(e) => setSimBody(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 p-3 font-mono text-xs text-slate-200"
                  />
                </div>

                <div className="flex justify-end gap-3 border-t border-slate-800 pt-4">
                  <Dialog.Close asChild>
                    <button
                      type="button"
                      className="rounded-lg border border-slate-700 px-4 py-2 text-sm text-slate-300 hover:bg-slate-800"
                    >
                      Cerrar
                    </button>
                  </Dialog.Close>
                  <button
                    type="submit"
                    disabled={isSimulating}
                    className="inline-flex items-center gap-2 rounded-lg bg-sky-600 px-5 py-2 text-sm font-semibold text-white hover:bg-sky-500 disabled:opacity-60"
                  >
                    {isSimulating ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Cpu className="h-4 w-4" />
                    )}
                    Ejecutar Parseo e Insertar
                  </button>
                </div>
              </form>
            </Dialog.Content>
          </Dialog.Portal>
        </Dialog.Root>
      </div>
    </div>
  );
}
