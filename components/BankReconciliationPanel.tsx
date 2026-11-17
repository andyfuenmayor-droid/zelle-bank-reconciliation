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
  FilePlus2,
  FileText,
  Filter,
  HelpCircle,
  Inbox,
  KeyRound,
  Loader2,
  Mail,
  MailPlus,
  Percent,
  Plus,
  RefreshCw,
  Search,
  Server,
  ShieldCheck,
  Sparkles,
  Trash2,
  UserCheck,
  UserPlus,
  Users,
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
  ClientAccountRecord,
  FinancialSummaryMetrics,
  ImapMailboxRecord,
  MovementType,
  PendingPaymentOrder,
} from '@/types/reconciliation';

type ActiveTab = 'ALERTS' | 'CLIENTS' | 'MAILBOXES';

const usdFormatter = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

function formatUsd(amount: number): string {
  return usdFormatter.format(Number.isFinite(amount) ? amount : 0);
}

function formatDateTime(isoString: string | null): string {
  if (!isoString) {
    return 'Nunca';
  }
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
  const [activeTab, setActiveTab] = useState<ActiveTab>('ALERTS');

  const [alerts, setAlerts] = useState<BankEmailAlertRecord[]>([
    ...INITIAL_DEMO_ALERTS,
  ]);
  const [pendingOrders, setPendingOrders] = useState<PendingPaymentOrder[]>([
    ...INITIAL_DEMO_PENDING_ORDERS,
  ]);
  const [clients, setClients] = useState<ClientAccountRecord[]>([]);
  const [mailboxes, setMailboxes] = useState<ImapMailboxRecord[]>([]);
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

  // Estados para Crear Cuenta de Cliente (Titular)
  const [isNewClientModalOpen, setIsNewClientModalOpen] =
    useState<boolean>(false);
  const [newClientName, setNewClientName] = useState<string>('');
  const [newClientEmail, setNewClientEmail] = useState<string>('');
  const [newClientPhone, setNewClientPhone] = useState<string>('');
  const [newClientZelleSenders, setNewClientZelleSenders] =
    useState<string>('');
  const [newClientFee, setNewClientFee] = useState<string>('4.00');
  const [isSavingClient, setIsSavingClient] = useState<boolean>(false);

  // Estados para Crear Orden / Reporte de Pago Esperado
  const [isNewOrderModalOpen, setIsNewOrderModalOpen] =
    useState<boolean>(false);
  const [orderClientName, setOrderClientName] = useState<string>('');
  const [orderClientEmail, setOrderClientEmail] = useState<string>('');
  const [orderZelleSender, setOrderZelleSender] = useState<string>('');
  const [orderBank, setOrderBank] = useState<BankName>('CITIBANK');
  const [orderAmount, setOrderAmount] = useState<string>('');
  const [orderReference, setOrderReference] = useState<string>('');
  const [isSavingOrder, setIsSavingOrder] = useState<boolean>(false);

  // Estados para Agregar Correo IMAP a Monitorear
  const [mailboxAlias, setMailboxAlias] = useState<string>(
    'Buzón Principal Alertas Citibank & TD Bank'
  );
  const [mailboxEmail, setMailboxEmail] = useState<string>('');
  const [mailboxPassword, setMailboxPassword] = useState<string>('');
  const [mailboxHost, setMailboxHost] = useState<string>('imap.gmail.com');
  const [mailboxPort, setMailboxPort] = useState<string>('993');
  const [mailboxFolder, setMailboxFolder] = useState<string>('INBOX');
  const [mailboxBanks, setMailboxBanks] = useState<string>(
    'CITIBANK_Y_TD_BANK'
  );
  const [verifyImapBeforeSave, setVerifyImapBeforeSave] =
    useState<boolean>(true);
  const [isSavingMailbox, setIsSavingMailbox] = useState<boolean>(false);

  const fetchAllData = useCallback(async () => {
    setIsLoading(true);
    try {
      const [alertsRes, clientsRes, mailboxesRes] = await Promise.all([
        fetch('/api/reconciliation/alerts', { cache: 'no-store' }),
        fetch('/api/reconciliation/clients', { cache: 'no-store' }),
        fetch('/api/reconciliation/mailboxes', { cache: 'no-store' }),
      ]);

      if (alertsRes.ok) {
        const data = (await alertsRes.json()) as {
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

      if (clientsRes.ok) {
        const cData = (await clientsRes.json()) as {
          ok: boolean;
          clients?: ClientAccountRecord[];
          pendingOrders?: PendingPaymentOrder[];
        };
        if (cData.ok && Array.isArray(cData.clients)) {
          setClients(cData.clients);
        }
      }

      if (mailboxesRes.ok) {
        const mData = (await mailboxesRes.json()) as {
          ok: boolean;
          mailboxes?: ImapMailboxRecord[];
        };
        if (mData.ok && Array.isArray(mData.mailboxes)) {
          setMailboxes(mData.mailboxes);
        }
      }
    } catch {
      // Mantiene estado previo si hay corte de red
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchAllData();
  }, [fetchAllData]);

  // Cálculo de tarjetas de resumen financiero
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

  // Botón "Sincronizar Ahora" usando el endpoint interno `/api/reconciliation/sync-now`
  const handleSyncImapNow = async (): Promise<void> => {
    setIsSyncingImap(true);
    setBannerMessage(null);

    try {
      const response = await fetch('/api/reconciliation/sync-now', {
        method: 'POST',
      });

      const payload = (await response.json()) as {
        ok: boolean;
        mailboxesProcessed?: number;
        insertedCount?: number;
        reconciledCount?: number;
        duplicateCount?: number;
        errors?: string[];
        error?: string;
      };

      await fetchAllData();

      if (response.ok && payload.ok) {
        if ((payload.mailboxesProcessed ?? 0) === 0) {
          setActiveTab('MAILBOXES');
          setBannerMessage({
            type: 'warning',
            text:
              payload.errors?.[0] ??
              'Primero agrega el correo IMAP que recibe las alertas de Citibank / TD Bank en la pestaña "3. Correos IMAP".',
          });
        } else if (payload.errors && payload.errors.length > 0) {
          setBannerMessage({
            type: 'warning',
            text: `Sincronización con avisos: ${payload.errors.join(' | ')}`,
          });
        } else {
          setBannerMessage({
            type: 'success',
            text: `Sincronización IMAP completada (${payload.mailboxesProcessed} buzón/es): ${payload.insertedCount ?? 0} nuevas alertas leídas, ${payload.reconciledCount ?? 0} conciliadas automáticamente y ${payload.duplicateCount ?? 0} duplicados omitidos.`,
          });
        }
      } else {
        setBannerMessage({
          type: 'error',
          text: payload.error ?? 'Error al sincronizar buzones IMAP.',
        });
      }
    } catch {
      setBannerMessage({
        type: 'warning',
        text: 'No se pudo conectar al motor IMAP.',
      });
    } finally {
      setIsSyncingImap(false);
    }
  };

  // Abrir modal de conciliación manual
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
      setManualClientName(
        alert.cliente_asignado_nombre ?? clients[0]?.nombre_titular ?? ''
      );
    }

    setManualNotes(
      `Verificado manualmente: Zelle enviado por (${
        alert.remitente_o_destinatario ?? 'Sin nombre'
      }) acreditado a la cuenta del cliente.`
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
        text: 'Selecciona un cliente titular o ingresa su nombre.',
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

      await fetchAllData();

      setBannerMessage({
        type: 'success',
        text: `Pago Zelle de ${formatUsd(
          selectedAlertForMatch.monto_bruto
        )} (Neto: ${formatUsd(
          selectedAlertForMatch.monto_neto
        )}) conciliado a favor de "${targetClientName}".`,
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

  // Crear nuevo Cliente (Titular de Cuenta)
  const handleCreateClient = async (
    event: React.FormEvent<HTMLFormElement>
  ): Promise<void> => {
    event.preventDefault();
    setIsSavingClient(true);
    setBannerMessage(null);

    try {
      const response = await fetch('/api/reconciliation/clients', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          action: 'CREATE_CLIENT',
          nombreTitular: newClientName,
          emailContacto: newClientEmail,
          telefono: newClientPhone,
          remitentesZelleHabituales: newClientZelleSenders,
          porcentajeComision: Number.parseFloat(newClientFee || '4.00'),
        }),
      });

      const data = (await response.json()) as {
        ok: boolean;
        autoReconciledCount?: number;
        error?: string;
      };

      if (!response.ok || !data.ok) {
        throw new Error(data.error ?? 'No se pudo crear el cliente.');
      }

      await fetchAllData();
      setIsNewClientModalOpen(false);
      setNewClientName('');
      setNewClientEmail('');
      setNewClientPhone('');
      setNewClientZelleSenders('');
      setNewClientFee('4.00');

      setBannerMessage({
        type: 'success',
        text: `Cuenta de cliente "${newClientName}" creada con éxito.${
          (data.autoReconciledCount ?? 0) > 0
            ? ` ¡Además se conciliaron automáticamente ${data.autoReconciledCount} pago(s) Zelle que ya habían llegado de su remitente!`
            : ''
        }`,
      });
    } catch (error: unknown) {
      const msg =
        error instanceof Error ? error.message : 'Error al crear cliente.';
      setBannerMessage({ type: 'error', text: msg });
    } finally {
      setIsSavingClient(false);
    }
  };

  // Crear nueva Orden / Reporte de Pago Esperado
  const handleCreateOrder = async (
    event: React.FormEvent<HTMLFormElement>
  ): Promise<void> => {
    event.preventDefault();
    setIsSavingOrder(true);
    setBannerMessage(null);

    try {
      const response = await fetch('/api/reconciliation/clients', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          action: 'CREATE_ORDER',
          clienteNombre: orderClientName,
          clienteEmail: orderClientEmail,
          nombreRemitenteReportado: orderZelleSender || orderClientName,
          bancoDestino: orderBank,
          montoEsperado: Number.parseFloat(orderAmount),
          referenciaReportada: orderReference,
        }),
      });

      const data = (await response.json()) as {
        ok: boolean;
        autoReconciledCount?: number;
        error?: string;
      };

      if (!response.ok || !data.ok) {
        throw new Error(data.error ?? 'No se pudo crear la orden de pago.');
      }

      await fetchAllData();
      setIsNewOrderModalOpen(false);
      setOrderAmount('');
      setOrderReference('');
      setOrderZelleSender('');

      setBannerMessage({
        type: 'success',
        text: `Orden de pago esperada por ${formatUsd(
          Number.parseFloat(orderAmount)
        )} registrada.${
          (data.autoReconciledCount ?? 0) > 0
            ? ` ¡Se hizo match inmediato con un pago Zelle ya recibido en tabla!`
            : ' Cuando entre el correo de Citibank/TD Bank se conciliará automáticamente.'
        }`,
      });
    } catch (error: unknown) {
      const msg =
        error instanceof Error ? error.message : 'Error al crear orden.';
      setBannerMessage({ type: 'error', text: msg });
    } finally {
      setIsSavingOrder(false);
    }
  };

  // Guardar Buzón de Correo IMAP
  const handleSaveMailbox = async (
    event: React.FormEvent<HTMLFormElement>
  ): Promise<void> => {
    event.preventDefault();
    setIsSavingMailbox(true);
    setBannerMessage(null);

    try {
      const response = await fetch('/api/reconciliation/mailboxes', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          alias: mailboxAlias,
          emailAddress: mailboxEmail,
          imapHost: mailboxHost,
          imapPort: Number.parseInt(mailboxPort, 10),
          imapSecure: true,
          imapPassword: mailboxPassword,
          mailboxFolder,
          bancosMonitoreados: mailboxBanks,
          verifyConnection: verifyImapBeforeSave,
        }),
      });

      const data = (await response.json()) as {
        ok: boolean;
        error?: string;
      };

      if (!response.ok || !data.ok) {
        throw new Error(
          data.error ?? 'No se pudo guardar la configuración IMAP.'
        );
      }

      await fetchAllData();
      setMailboxPassword('');
      setBannerMessage({
        type: 'success',
        text: `Correo "${mailboxEmail}" conectado exitosamente. Ya puedes usar "Sincronizar Ahora" para leer las alertas de Citibank y TD Bank.`,
      });
    } catch (error: unknown) {
      const msg =
        error instanceof Error
          ? error.message
          : 'Error configurando correo IMAP.';
      setBannerMessage({ type: 'error', text: msg });
    } finally {
      setIsSavingMailbox(false);
    }
  };

  const handleDeleteMailbox = async (id: string): Promise<void> => {
    try {
      await fetch(`/api/reconciliation/mailboxes?id=${encodeURIComponent(id)}`, {
        method: 'DELETE',
      });
      await fetchAllData();
    } catch {
      // ignore
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

      await fetchAllData();
      setIsSimulatorOpen(false);
      setActiveTab('ALERTS');

      const newAlert = result.alert;
      setBannerMessage({
        type: 'success',
        text: `Alerta procesada vía ${newAlert.metodo_extraccion}: ${newAlert.banco} | Bruto ${formatUsd(
          newAlert.monto_bruto
        )} | Comisión (${newAlert.porcentaje_comision}%): ${formatUsd(
          newAlert.monto_comision
        )} | Neto: ${formatUsd(newAlert.monto_neto)} | Estado: ${newAlert.estado}.`,
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
        <header className="mb-6 flex flex-col gap-4 border-b border-slate-800/80 pb-6 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <div className="flex flex-wrap items-center gap-2.5">
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
              <span className="inline-flex items-center gap-1 rounded-full border border-slate-700 bg-slate-900 px-2.5 py-0.5 text-xs text-slate-300">
                <Mail className="h-3 w-3 text-emerald-400" />
                {mailboxes.length > 0
                  ? `${mailboxes.length} correo(s) IMAP monitoreado(s)`
                  : 'Sin correo IMAP configurado'}
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

          <div className="flex flex-wrap items-center gap-2.5">
            <button
              type="button"
              onClick={() => setIsNewClientModalOpen(true)}
              className="inline-flex items-center gap-2 rounded-lg border border-emerald-500/40 bg-emerald-950/40 px-3.5 py-2.5 text-sm font-medium text-emerald-300 transition hover:bg-emerald-900/50"
            >
              <UserPlus className="h-4 w-4" />
              + Crear Cliente
            </button>

            <button
              type="button"
              onClick={() => setIsSimulatorOpen(true)}
              className="inline-flex items-center gap-2 rounded-lg border border-slate-700 bg-slate-900 px-3.5 py-2.5 text-sm font-medium text-slate-200 transition hover:border-slate-600 hover:bg-slate-800"
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

        {/* Navegación de Pestañas Principales */}
        <div className="mb-6 flex flex-wrap gap-2 border-b border-slate-800 pb-3">
          <button
            type="button"
            onClick={() => setActiveTab('ALERTS')}
            className={`inline-flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold transition ${
              activeTab === 'ALERTS'
                ? 'bg-emerald-600 text-white shadow-md shadow-emerald-950/50'
                : 'bg-slate-900 text-slate-300 hover:bg-slate-800'
            }`}
          >
            <DollarSign className="h-4 w-4" />
            1. Alertas y Conciliación ({alerts.length})
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('CLIENTS')}
            className={`inline-flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold transition ${
              activeTab === 'CLIENTS'
                ? 'bg-emerald-600 text-white shadow-md shadow-emerald-950/50'
                : 'bg-slate-900 text-slate-300 hover:bg-slate-800'
            }`}
          >
            <Users className="h-4 w-4" />
            2. Cuentas de Clientes y Órdenes ({clients.length})
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('MAILBOXES')}
            className={`inline-flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold transition ${
              activeTab === 'MAILBOXES'
                ? 'bg-emerald-600 text-white shadow-md shadow-emerald-950/50'
                : 'bg-slate-900 text-slate-300 hover:bg-slate-800'
            }`}
          >
            <Inbox className="h-4 w-4" />
            3. Correos IMAP Monitoreados ({mailboxes.length})
          </button>
        </div>

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

        {/* =====================================================================
            PESTAÑA 1: TABLA DE ALERTAS Y CONCILIACIÓN
           ===================================================================== */}
        {activeTab === 'ALERTS' && (
          <>
            <section
              aria-label="Filtros de Conciliación"
              className="mb-6 rounded-xl border border-slate-800 bg-slate-900/70 p-4"
            >
              <div className="grid grid-cols-1 gap-4 md:grid-cols-12">
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

                <div className="md:col-span-2">
                  <div className="relative">
                    <Building2 className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                    <select
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

                <div className="md:col-span-2">
                  <select
                    value={movementFilter}
                    onChange={(e) =>
                      setMovementFilter(
                        e.target.value as 'TODOS' | MovementType
                      )
                    }
                    className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200 focus:border-emerald-500 focus:outline-none"
                  >
                    <option value="TODOS">Recibidos y Enviados</option>
                    <option value="RECIBIDO">Recibido (Ingreso)</option>
                    <option value="ENVIADO">Enviado (Egreso)</option>
                  </select>
                </div>

                <div className="md:col-span-3">
                  <div className="relative">
                    <Filter className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                    <select
                      value={statusFilter}
                      onChange={(e) =>
                        setStatusFilter(e.target.value as 'TODOS' | AlertStatus)
                      }
                      className="w-full rounded-lg border border-slate-700 bg-slate-950 py-2 pl-9 pr-3 text-sm text-slate-200 focus:border-emerald-500 focus:outline-none"
                    >
                      <option value="TODOS">Todos los Estados</option>
                      <option value="CONCILIADO">Conciliado</option>
                      <option value="REVISION_MANUAL">
                        En Revisión Manual
                      </option>
                      <option value="DETECTADO">Detectado (Sin Orden)</option>
                    </select>
                  </div>
                </div>
              </div>
            </section>

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
                          <td className="whitespace-nowrap px-4 py-4">
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
                            <p className="mt-1 text-xs text-slate-400">
                              {formatDateTime(alert.fecha_transaccion)}
                            </p>
                          </td>

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

                          <td className="whitespace-nowrap px-4 py-4 text-right font-mono font-semibold text-slate-100">
                            {formatUsd(alert.monto_bruto)}
                          </td>

                          <td className="whitespace-nowrap px-4 py-4 text-right font-mono text-xs text-violet-300">
                            {alert.monto_comision > 0
                              ? `-${formatUsd(alert.monto_comision)} (${alert.porcentaje_comision}%)`
                              : '$0.00'}
                          </td>

                          <td className="whitespace-nowrap px-4 py-4 text-right font-mono font-bold text-emerald-400">
                            {formatUsd(alert.monto_neto)}
                          </td>

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

                          <td className="whitespace-nowrap px-4 py-4 text-right">
                            <div className="flex items-center justify-end gap-2">
                              <button
                                type="button"
                                onClick={() => setInspectedAlert(alert)}
                                className="inline-flex items-center gap-1 rounded-lg border border-slate-700 bg-slate-800/80 px-2.5 py-1.5 text-xs font-medium text-slate-300 transition hover:bg-slate-700"
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
          </>
        )}

        {/* =====================================================================
            PESTAÑA 2: CUENTAS DE CLIENTES (USUARIOS) Y ÓRDENES DE PAGO
           ===================================================================== */}
        {activeTab === 'CLIENTS' && (
          <div className="space-y-8">
            <div className="flex flex-col justify-between gap-4 rounded-xl border border-slate-800 bg-slate-900/70 p-5 sm:flex-row sm:items-center">
              <div>
                <h2 className="text-lg font-bold text-white">
                  Directorio de Clientes (Titulares) y Remitentes Zelle Autorizados
                </h2>
                <p className="mt-1 text-xs text-slate-400">
                  Cuando registras un cliente y los nombres desde los cuales envía Zelle (ej. su propio nombre, esposa o LLC), cualquier pago entrante de esos remitentes se concilia y acredita automáticamente a su saldo neto.
                </p>
              </div>
              <div className="flex flex-wrap gap-3">
                <button
                  type="button"
                  onClick={() => setIsNewOrderModalOpen(true)}
                  className="inline-flex items-center gap-2 rounded-lg border border-sky-500/40 bg-sky-950/40 px-4 py-2 text-sm font-semibold text-sky-300 hover:bg-sky-900/50"
                >
                  <FilePlus2 className="h-4 w-4" />
                  + Registrar Orden de Pago Esperada
                </button>
                <button
                  type="button"
                  onClick={() => setIsNewClientModalOpen(true)}
                  className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-500"
                >
                  <UserPlus className="h-4 w-4" />
                  + Nueva Cuenta de Cliente
                </button>
              </div>
            </div>

            {/* Tabla de Cuentas de Clientes y Saldos */}
            <div className="overflow-hidden rounded-xl border border-slate-800 bg-slate-900/70 shadow-xl">
              <div className="border-b border-slate-800 bg-slate-950/60 px-5 py-3.5">
                <h3 className="text-sm font-bold uppercase tracking-wider text-slate-300">
                  Cuentas de Usuarios / Clientes Registrados ({clients.length})
                </h3>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full border-collapse text-left text-sm">
                  <thead>
                    <tr className="border-b border-slate-800 bg-slate-950/40 text-xs font-semibold uppercase tracking-wider text-slate-400">
                      <th className="px-4 py-3">Cliente / Titular</th>
                      <th className="px-4 py-3">Contacto</th>
                      <th className="px-4 py-3">
                        Remitentes Zelle Reconocidos Automáticamente
                      </th>
                      <th className="px-4 py-3 text-center">% Comisión</th>
                      <th className="px-4 py-3 text-right">Bruto Recibido</th>
                      <th className="px-4 py-3 text-right">Comisión Retenida</th>
                      <th className="px-4 py-3 text-right">
                        Saldo Neto a Favor
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/70">
                    {clients.length === 0 ? (
                      <tr>
                        <td
                          colSpan={7}
                          className="px-6 py-10 text-center text-slate-400"
                        >
                          Aún no has creado cuentas de clientes. Haz clic en{' '}
                          <strong className="text-emerald-400">
                            &quot;+ Nueva Cuenta de Cliente&quot;
                          </strong>{' '}
                          para registrar tu primer titular (por ejemplo,{' '}
                          <code className="text-sky-300">
                            ALEJANDRO JOSE PEREZ
                          </code>
                          ).
                        </td>
                      </tr>
                    ) : (
                      clients.map((c) => (
                        <tr key={c.id} className="hover:bg-slate-800/40">
                          <td className="px-4 py-3.5 font-semibold text-white">
                            {c.nombre_titular}
                            <div className="text-xs font-normal text-slate-400">
                              {c.pagos_conciliados_count} pago(s) conciliado(s)
                            </div>
                          </td>
                          <td className="px-4 py-3.5 text-xs text-slate-300">
                            <div>{c.email_contacto ?? 'Sin email'}</div>
                            <div className="text-slate-400">
                              {c.telefono ?? ''}
                            </div>
                          </td>
                          <td className="max-w-xs px-4 py-3.5 text-xs text-amber-300">
                            {c.remitentes_zelle_habituales || c.nombre_titular}
                          </td>
                          <td className="px-4 py-3.5 text-center font-mono text-xs text-violet-300">
                            {c.porcentaje_comision}%
                          </td>
                          <td className="px-4 py-3.5 text-right font-mono text-slate-200">
                            {formatUsd(c.total_bruto_conciliado)}
                          </td>
                          <td className="px-4 py-3.5 text-right font-mono text-xs text-violet-300">
                            -{formatUsd(c.total_comision_retenida)}
                          </td>
                          <td className="px-4 py-3.5 text-right font-mono font-bold text-emerald-400">
                            {formatUsd(c.total_neto_disponible)}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Tabla de Órdenes de Pago Pendientes */}
            <div className="overflow-hidden rounded-xl border border-slate-800 bg-slate-900/70 shadow-xl">
              <div className="border-b border-slate-800 bg-slate-950/60 px-5 py-3.5">
                <h3 className="text-sm font-bold uppercase tracking-wider text-slate-300">
                  Órdenes / Reportes de Pago Pendientes de Recibir (
                  {pendingOrders.length})
                </h3>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full border-collapse text-left text-sm">
                  <thead>
                    <tr className="border-b border-slate-800 bg-slate-950/40 text-xs font-semibold uppercase tracking-wider text-slate-400">
                      <th className="px-4 py-3">Código Orden</th>
                      <th className="px-4 py-3">Cliente Titular</th>
                      <th className="px-4 py-3">Remitente Zelle Reportado</th>
                      <th className="px-4 py-3">Banco Destino</th>
                      <th className="px-4 py-3">Referencia Esperada</th>
                      <th className="px-4 py-3 text-right">Monto Esperado</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/70">
                    {pendingOrders.length === 0 ? (
                      <tr>
                        <td
                          colSpan={6}
                          className="px-6 py-8 text-center text-slate-400"
                        >
                          No hay órdenes de pago pendientes en este momento.
                        </td>
                      </tr>
                    ) : (
                      pendingOrders.map((o) => (
                        <tr key={o.id} className="hover:bg-slate-800/40">
                          <td className="px-4 py-3 font-mono text-xs font-bold text-sky-300">
                            {o.codigo_orden}
                          </td>
                          <td className="px-4 py-3 font-medium text-white">
                            {o.cliente_nombre}
                          </td>
                          <td className="px-4 py-3 text-slate-300">
                            {o.nombre_remitente_reportado}
                          </td>
                          <td className="px-4 py-3 text-xs text-slate-300">
                            {o.banco_destino}
                          </td>
                          <td className="px-4 py-3 font-mono text-xs text-slate-400">
                            {o.referencia_reportada ?? 'Cualquiera / Por Nombre'}
                          </td>
                          <td className="px-4 py-3 text-right font-mono font-bold text-emerald-400">
                            {formatUsd(o.monto_esperado)}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* =====================================================================
            PESTAÑA 3: CORREOS IMAP MONITOREADOS (CITIBANK / TD BANK)
           ===================================================================== */}
        {activeTab === 'MAILBOXES' && (
          <div className="grid grid-cols-1 gap-8 lg:grid-cols-12">
            {/* Columna Izquierda: Formulario para conectar el correo */}
            <div className="rounded-xl border border-slate-800 bg-slate-900/80 p-6 lg:col-span-7">
              <div className="flex items-center gap-2.5 border-b border-slate-800 pb-4">
                <Mail className="h-5 w-5 text-emerald-400" />
                <div>
                  <h2 className="text-lg font-bold text-white">
                    Conectar Correo que Recibe las Alertas de Zelle
                  </h2>
                  <p className="text-xs text-slate-400">
                    Agrega aquí el correo electrónico donde Citibank y/o TD Bank
                    te envían los avisos de depósito Zelle.
                  </p>
                </div>
              </div>

              <form
                onSubmit={(e) => void handleSaveMailbox(e)}
                className="mt-5 space-y-4"
              >
                {/* Botones rápidos de proveedor */}
                <div>
                  <span className="block text-xs font-semibold uppercase tracking-wider text-slate-400">
                    Autocompletar Servidor según tu Correo:
                  </span>
                  <div className="mt-2 flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        setMailboxHost('imap.gmail.com');
                        setMailboxPort('993');
                      }}
                      className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-1.5 text-xs font-medium text-sky-300 hover:border-sky-500"
                    >
                      Gmail / Google Workspace (imap.gmail.com)
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setMailboxHost('outlook.office365.com');
                        setMailboxPort('993');
                      }}
                      className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-1.5 text-xs font-medium text-sky-300 hover:border-sky-500"
                    >
                      Outlook / Hotmail (outlook.office365.com)
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setMailboxHost('imap.secureserver.net');
                        setMailboxPort('993');
                      }}
                      className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-1.5 text-xs font-medium text-sky-300 hover:border-sky-500"
                    >
                      GoDaddy Workspace (imap.secureserver.net)
                    </button>
                  </div>
                </div>

                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <div>
                    <label className="block text-xs font-semibold uppercase text-slate-300">
                      Nombre / Alias de la Cuenta
                    </label>
                    <input
                      type="text"
                      required
                      value={mailboxAlias}
                      onChange={(e) => setMailboxAlias(e.target.value)}
                      placeholder="Ej. Correo Principal Citibank Zelle"
                      className="mt-1.5 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-semibold uppercase text-slate-300">
                      Bancos que llegan a este correo
                    </label>
                    <select
                      value={mailboxBanks}
                      onChange={(e) => setMailboxBanks(e.target.value)}
                      className="mt-1.5 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white"
                    >
                      <option value="CITIBANK_Y_TD_BANK">
                        Citibank y TD Bank (Ambos)
                      </option>
                      <option value="SOLO_CITIBANK">Solo Citibank</option>
                      <option value="SOLO_TD_BANK">Solo TD Bank</option>
                    </select>
                  </div>
                </div>

                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <div>
                    <label className="block text-xs font-semibold uppercase text-slate-300">
                      Correo Electrónico a Monitorear
                    </label>
                    <input
                      type="email"
                      required
                      value={mailboxEmail}
                      onChange={(e) => setMailboxEmail(e.target.value)}
                      placeholder="tucorreo-alertas@gmail.com"
                      className="mt-1.5 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-semibold uppercase text-slate-300">
                      Contraseña IMAP / App Password (16 letras)
                    </label>
                    <div className="relative mt-1.5">
                      <KeyRound className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                      <input
                        type="password"
                        required
                        value={mailboxPassword}
                        onChange={(e) => setMailboxPassword(e.target.value)}
                        placeholder="xxxx xxxx xxxx xxxx"
                        className="w-full rounded-lg border border-slate-700 bg-slate-950 py-2 pl-9 pr-3 font-mono text-sm text-white"
                      />
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                  <div>
                    <label className="block text-xs font-semibold uppercase text-slate-300">
                      Servidor IMAP (Host)
                    </label>
                    <div className="relative mt-1.5">
                      <Server className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                      <input
                        type="text"
                        required
                        value={mailboxHost}
                        onChange={(e) => setMailboxHost(e.target.value)}
                        className="w-full rounded-lg border border-slate-700 bg-slate-950 py-2 pl-9 pr-3 font-mono text-xs text-white"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="block text-xs font-semibold uppercase text-slate-300">
                      Puerto SSL
                    </label>
                    <input
                      type="number"
                      required
                      value={mailboxPort}
                      onChange={(e) => setMailboxPort(e.target.value)}
                      className="mt-1.5 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 font-mono text-xs text-white"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-semibold uppercase text-slate-300">
                      Carpeta
                    </label>
                    <input
                      type="text"
                      required
                      value={mailboxFolder}
                      onChange={(e) => setMailboxFolder(e.target.value)}
                      className="mt-1.5 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 font-mono text-xs text-white"
                    />
                  </div>
                </div>

                <label className="flex items-center gap-2 pt-1 text-xs text-slate-300">
                  <input
                    type="checkbox"
                    checked={verifyImapBeforeSave}
                    onChange={(e) => setVerifyImapBeforeSave(e.target.checked)}
                    className="h-4 w-4 rounded border-slate-700 bg-slate-950 text-emerald-500"
                  />
                  Probar conexión IMAP en vivo antes de guardar (recomendado)
                </label>

                <div className="pt-2">
                  <button
                    type="submit"
                    disabled={isSavingMailbox}
                    className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-emerald-600 px-5 py-3 text-sm font-semibold text-white shadow-lg shadow-emerald-950/50 transition hover:bg-emerald-500 disabled:opacity-60"
                  >
                    {isSavingMailbox ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Plus className="h-4 w-4" />
                    )}
                    Guardar y Conectar Correo IMAP
                  </button>
                </div>
              </form>
            </div>

            {/* Columna Derecha: Guía + Correos Conectados */}
            <div className="space-y-6 lg:col-span-5">
              {/* Lista de Correos Monitoreados */}
              <div className="rounded-xl border border-slate-800 bg-slate-900/80 p-5">
                <h3 className="text-sm font-bold uppercase tracking-wider text-slate-300">
                  Correos Activos Monitoreados ({mailboxes.length})
                </h3>

                {mailboxes.length === 0 ? (
                  <p className="mt-3 text-xs text-slate-400">
                    Todavía no hay ningún correo conectado. Completa el
                    formulario de la izquierda para empezar a leer correos de
                    Citibank y TD Bank automáticamente.
                  </p>
                ) : (
                  <div className="mt-4 space-y-3">
                    {mailboxes.map((mb) => (
                      <div
                        key={mb.id}
                        className="flex items-start justify-between rounded-lg border border-slate-800 bg-slate-950 p-3.5"
                      >
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="h-2 w-2 rounded-full bg-emerald-400" />
                            <span className="font-semibold text-white">
                              {mb.email_address}
                            </span>
                          </div>
                          <p className="mt-0.5 text-xs text-slate-400">
                            {mb.alias} · {mb.imap_host}:{mb.imap_port} (
                            {mb.mailbox_folder})
                          </p>
                          <p className="mt-1 text-[11px] text-emerald-400">
                            Estado: {mb.last_sync_status ?? 'Listo'} · Última
                            vez: {formatDateTime(mb.last_sync_at)}
                          </p>
                        </div>
                        <button
                          type="button"
                          onClick={() => void handleDeleteMailbox(mb.id)}
                          className="rounded p-1.5 text-slate-400 hover:bg-rose-950/60 hover:text-rose-300"
                          title="Eliminar buzón"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Guía rápida explicativa */}
              <div className="rounded-xl border border-sky-500/30 bg-sky-950/20 p-5">
                <div className="flex items-center gap-2 text-sky-300">
                  <HelpCircle className="h-5 w-5" />
                  <h3 className="text-sm font-bold">
                    ¿Cómo sé cuál correo voy a monitorear?
                  </h3>
                </div>
                <ol className="mt-3 list-decimal space-y-2.5 pl-4 text-xs leading-relaxed text-slate-300">
                  <li>
                    <strong>Es el correo donde tu banco envía los avisos:</strong>{' '}
                    Entra a tu banca en línea de <strong>Citibank</strong> y/o{' '}
                    <strong>TD Bank</strong> &rarr; sección{' '}
                    <em>Profile / Alerts &amp; Notifications / Zelle® Settings</em>.
                    El email que tengas afiliado ahí para recibir alertas de
                    depósito es el que debes poner aquí.
                  </li>
                  <li>
                    <strong>Recomendación FinTech:</strong> Puedes usar ese mismo
                    correo o crear una regla de reenvío automático en tu correo
                    hacia una bandeja dedicada (por ejemplo, un Gmail exclusivo
                    para alertas bancarias).
                  </li>
                  <li>
                    <strong>Si el correo es Gmail:</strong> En tu cuenta de
                    Google ve a{' '}
                    <em>Seguridad &rarr; Verificación en 2 pasos &rarr; Contraseñas de aplicaciones</em>,
                    crea una clave de 16 letras y pégala en el campo{' '}
                    <strong>Contraseña IMAP</strong>.
                  </li>
                </ol>
              </div>
            </div>
          </div>
        )}

        {/* =====================================================================
            MODAL RADIX UI: CREAR NUEVA CUENTA DE CLIENTE (TITULAR)
           ===================================================================== */}
        <Dialog.Root
          open={isNewClientModalOpen}
          onOpenChange={setIsNewClientModalOpen}
        >
          <Dialog.Portal>
            <Dialog.Overlay className="fixed inset-0 z-40 bg-slate-950/80 backdrop-blur-sm" />
            <Dialog.Content className="fixed left-1/2 top-1/2 z-50 w-full max-w-lg -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-slate-800 bg-slate-900 p-6 text-slate-100 shadow-2xl">
              <div className="flex items-start justify-between border-b border-slate-800 pb-4">
                <div>
                  <Dialog.Title className="text-lg font-bold text-white">
                    Crear Cuenta de Cliente / Titular
                  </Dialog.Title>
                  <Dialog.Description className="mt-1 text-xs text-slate-400">
                    Registra al cliente y los nombres de Zelle desde donde envía
                    pagos para conciliación automática.
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
                onSubmit={(e) => void handleCreateClient(e)}
                className="mt-4 space-y-4"
              >
                <div>
                  <label className="block text-xs font-semibold uppercase text-slate-300">
                    Nombre del Cliente / Titular de Cuenta *
                  </label>
                  <input
                    type="text"
                    required
                    value={newClientName}
                    onChange={(e) => setNewClientName(e.target.value)}
                    placeholder="Ej. ALEJANDRO JOSE PEREZ"
                    className="mt-1.5 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white"
                  />
                </div>

                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div>
                    <label className="block text-xs font-semibold uppercase text-slate-300">
                      Correo del Cliente
                    </label>
                    <input
                      type="email"
                      value={newClientEmail}
                      onChange={(e) => setNewClientEmail(e.target.value)}
                      placeholder="cliente@correo.com"
                      className="mt-1.5 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold uppercase text-slate-300">
                      Teléfono / WhatsApp
                    </label>
                    <input
                      type="text"
                      value={newClientPhone}
                      onChange={(e) => setNewClientPhone(e.target.value)}
                      placeholder="+1 305 000 0000"
                      className="mt-1.5 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-semibold uppercase text-slate-300">
                    Nombres de Remitentes Zelle Asociados (Separados por coma)
                  </label>
                  <input
                    type="text"
                    value={newClientZelleSenders}
                    onChange={(e) => setNewClientZelleSenders(e.target.value)}
                    placeholder="Ej. ALEJANDRO JOSE PEREZ, INVERSIONES PEREZ LLC"
                    className="mt-1.5 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white"
                  />
                  <p className="mt-1 text-[11px] text-slate-400">
                    Si el banco reporta un Zelle de cualquiera de estos nombres,
                    el sistema lo conciliará automáticamente a favor de este
                    cliente.
                  </p>
                </div>

                <div>
                  <label className="block text-xs font-semibold uppercase text-slate-300">
                    Porcentaje de Comisión de Manejo (%)
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    max="100"
                    required
                    value={newClientFee}
                    onChange={(e) => setNewClientFee(e.target.value)}
                    className="mt-1.5 w-40 rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 font-mono text-sm text-white"
                  />
                </div>

                <div className="flex justify-end gap-3 border-t border-slate-800 pt-4">
                  <Dialog.Close asChild>
                    <button
                      type="button"
                      className="rounded-lg border border-slate-700 px-4 py-2 text-sm text-slate-300 hover:bg-slate-800"
                    >
                      Cancelar
                    </button>
                  </Dialog.Close>
                  <button
                    type="submit"
                    disabled={isSavingClient}
                    className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-5 py-2 text-sm font-semibold text-white hover:bg-emerald-500 disabled:opacity-60"
                  >
                    {isSavingClient ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <UserPlus className="h-4 w-4" />
                    )}
                    Guardar Cuenta de Cliente
                  </button>
                </div>
              </form>
            </Dialog.Content>
          </Dialog.Portal>
        </Dialog.Root>

        {/* =====================================================================
            MODAL RADIX UI: CREAR ORDEN / REPORTE DE PAGO ESPERADO
           ===================================================================== */}
        <Dialog.Root
          open={isNewOrderModalOpen}
          onOpenChange={setIsNewOrderModalOpen}
        >
          <Dialog.Portal>
            <Dialog.Overlay className="fixed inset-0 z-40 bg-slate-950/80 backdrop-blur-sm" />
            <Dialog.Content className="fixed left-1/2 top-1/2 z-50 w-full max-w-lg -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-slate-800 bg-slate-900 p-6 text-slate-100 shadow-2xl">
              <div className="flex items-start justify-between border-b border-slate-800 pb-4">
                <div>
                  <Dialog.Title className="text-lg font-bold text-white">
                    Registrar Orden / Reporte de Pago Esperado
                  </Dialog.Title>
                  <Dialog.Description className="mt-1 text-xs text-slate-400">
                    Registra un pago reportado por un usuario para que se
                    concilie automáticamente por monto y referencia/nombre.
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
                onSubmit={(e) => void handleCreateOrder(e)}
                className="mt-4 space-y-4"
              >
                <div>
                  <label className="block text-xs font-semibold uppercase text-slate-300">
                    Cliente Titular *
                  </label>
                  <input
                    type="text"
                    required
                    list="registered-clients-list"
                    value={orderClientName}
                    onChange={(e) => setOrderClientName(e.target.value)}
                    placeholder="Selecciona o escribe el nombre del cliente"
                    className="mt-1.5 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white"
                  />
                  <datalist id="registered-clients-list">
                    {clients.map((c) => (
                      <option key={c.id} value={c.nombre_titular} />
                    ))}
                  </datalist>
                </div>

                <div>
                  <label className="block text-xs font-semibold uppercase text-slate-300">
                    Nombre en la Cuenta Zelle que Envía el Pago
                  </label>
                  <input
                    type="text"
                    value={orderZelleSender}
                    onChange={(e) => setOrderZelleSender(e.target.value)}
                    placeholder="Ej. ALEJANDRO JOSE PEREZ"
                    className="mt-1.5 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white"
                  />
                </div>

                <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                  <div>
                    <label className="block text-xs font-semibold uppercase text-slate-300">
                      Banco Destino
                    </label>
                    <select
                      value={orderBank}
                      onChange={(e) => setOrderBank(e.target.value as BankName)}
                      className="mt-1.5 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white"
                    >
                      <option value="CITIBANK">Citibank</option>
                      <option value="TD_BANK">TD Bank</option>
                    </select>
                  </div>

                  <div>
                    <label className="block text-xs font-semibold uppercase text-slate-300">
                      Monto Exacto (USD) *
                    </label>
                    <input
                      type="number"
                      step="0.01"
                      min="0.01"
                      required
                      value={orderAmount}
                      onChange={(e) => setOrderAmount(e.target.value)}
                      placeholder="1450.00"
                      className="mt-1.5 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 font-mono text-sm text-white"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-semibold uppercase text-slate-300">
                      Referencia (Opcional)
                    </label>
                    <input
                      type="text"
                      value={orderReference}
                      onChange={(e) => setOrderReference(e.target.value)}
                      placeholder="CITI992048112"
                      className="mt-1.5 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 font-mono text-xs text-white"
                    />
                  </div>
                </div>

                <div className="flex justify-end gap-3 border-t border-slate-800 pt-4">
                  <Dialog.Close asChild>
                    <button
                      type="button"
                      className="rounded-lg border border-slate-700 px-4 py-2 text-sm text-slate-300 hover:bg-slate-800"
                    >
                      Cancelar
                    </button>
                  </Dialog.Close>
                  <button
                    type="submit"
                    disabled={isSavingOrder}
                    className="inline-flex items-center gap-2 rounded-lg bg-sky-600 px-5 py-2 text-sm font-semibold text-white hover:bg-sky-500 disabled:opacity-60"
                  >
                    {isSavingOrder ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <FilePlus2 className="h-4 w-4" />
                    )}
                    Guardar Orden y Conciliar
                  </button>
                </div>
              </form>
            </Dialog.Content>
          </Dialog.Portal>
        </Dialog.Root>

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
                  <div className="rounded-xl border border-slate-800 bg-slate-950 p-4">
                    <div className="flex items-center justify-between text-xs text-slate-400">
                      <span>
                        Banco:{' '}
                        <strong className="text-white">
                          {selectedAlertForMatch.banco}
                        </strong>
                      </span>
                      <span>
                        Ref:{' '}
                        <strong className="font-mono text-white">
                          {selectedAlertForMatch.referencia ?? 'N/A'}
                        </strong>
                      </span>
                    </div>
                    <div className="mt-2 text-sm">
                      <span className="text-slate-400">
                        Remitente en Correo Zelle:{' '}
                      </span>
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
                        const found = pendingOrders.find(
                          (o) => o.id === orderId
                        );
                        if (found) {
                          setManualClientName(found.cliente_nombre);
                        }
                      }}
                      className="mt-1.5 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2.5 text-sm text-white focus:border-emerald-500 focus:outline-none"
                    >
                      <option value="">
                        -- Asignación directa a un cliente --
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
                      list="registered-clients-list"
                      value={manualClientName}
                      onChange={(e) => setManualClientName(e.target.value)}
                      placeholder="Selecciona un cliente registrado o escribe su nombre"
                      className="mt-1.5 w-full rounded-lg border border-slate-700 bg-slate-950 px-3.5 py-2 text-sm text-white placeholder-slate-500 focus:border-emerald-500 focus:outline-none"
                    />
                  </div>

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
                      Confirmar Conciliación (
                      {formatUsd(selectedAlertForMatch.monto_neto)} Neto)
                    </button>
                  </div>
                </form>
              )}
            </Dialog.Content>
          </Dialog.Portal>
        </Dialog.Root>

        {/* =====================================================================
            MODAL RADIX UI: INSPECTOR DE CORREO CRUDO
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
        <Dialog.Root open={isSimulatorOpen} onOpenChange={setIsSimulatorOpen}>
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
                    ejecutar{' '}
                    <code className="text-sky-300">parseBankAlertEmail()</code>{' '}
                    y calcular la comisión del 4%.
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
