'use client';

import React, { useCallback, useEffect, useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import {
  Bot,
  Building2,
  Check,
  CheckCircle2,
  Clock,
  Coins,
  Copy,
  DollarSign,
  Eye,
  ImagePlus,
  KeyRound,
  Loader2,
  LogOut,
  RefreshCw,
  ScanLine,
  Send,
  ShieldCheck,
  Sparkles,
  UploadCloud,
  Wallet,
  X,
} from 'lucide-react';
import { buildSampleReceiptBase64 } from '@/lib/mock-seed-data';
import {
  AssignedReceivingAccount,
  ClientAccountRecord,
  ClientPortalWalletSummary,
  CurrencyType,
  ExpectedPlatformType,
  FinancialTransactionRecord,
  PendingPaymentOrder,
} from '@/types/reconciliation';
import { ReceiptAiScanResult } from '@/lib/receipt-scanner';

const STORAGE_CLIENT_KEY = 'fintech_portal_client_id';

const PLATFORM_DISPLAY_META: Record<
  ExpectedPlatformType,
  { label: string; sublabel: string; accentClass: string }
> = {
  CITIBANK: {
    label: 'Citibank Zelle',
    sublabel: 'Transferencia USD',
    accentClass: 'border-sky-500/40 bg-sky-500/10 text-sky-300',
  },
  TD_BANK: {
    label: 'TD Bank Zelle',
    sublabel: 'Transferencia USD',
    accentClass: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300',
  },
  BINANCE_PAY: {
    label: 'Binance Pay',
    sublabel: 'Pay ID / Instantáneo',
    accentClass: 'border-amber-500/40 bg-amber-500/10 text-amber-300',
  },
  BINANCE_P2P: {
    label: 'Binance P2P',
    sublabel: 'Orden C2C Completada',
    accentClass: 'border-yellow-500/40 bg-yellow-500/10 text-yellow-300',
  },
  BINANCE_ONCHAIN: {
    label: 'Depósito Red USDT',
    sublabel: 'TRC20 / BEP20 / ERC20',
    accentClass: 'border-purple-500/40 bg-purple-500/10 text-purple-300',
  },
};

function formatAmount(amount: number, currency: CurrencyType): string {
  const safe = Number.isFinite(amount) ? amount : 0;
  const formatted = new Intl.NumberFormat('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(safe);

  if (currency === 'USDT') {
    return `${formatted} USDT`;
  }
  if (currency === 'VES') {
    return `${formatted} VES`;
  }
  return `$${formatted} USD`;
}

function formatDateTime(isoString: string | null | undefined): string {
  if (!isoString) {
    return 'Reciente';
  }
  const parsed = new Date(isoString);
  if (Number.isNaN(parsed.getTime())) {
    return isoString;
  }
  return new Intl.DateTimeFormat('es-ES', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(parsed);
}

/**
 * Comprime una imagen subida por el cliente usando un `<canvas>` antes de enviarla en Base64.
 */
async function compressImageFileToBase64(file: File): Promise<{
  base64: string;
  mime: string;
}> {
  if (file.type === 'image/svg+xml') {
    const raw = await file.text();
    const encoded = btoa(unescape(encodeURIComponent(raw)));
    return {
      base64: `data:image/svg+xml;base64,${encoded}`,
      mime: 'image/svg+xml',
    };
  }

  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('No se pudo leer el archivo de imagen.'));
    reader.onload = () => {
      const dataUrl = typeof reader.result === 'string' ? reader.result : '';
      if (!dataUrl) {
        reject(new Error('Archivo de imagen vacío.'));
        return;
      }

      const img = new Image();
      img.onerror = () => resolve({ base64: dataUrl, mime: file.type || 'image/png' });
      img.onload = () => {
        const maxWidth = 1080;
        const scale = img.width > maxWidth ? maxWidth / img.width : 1;
        const targetWidth = Math.max(1, Math.round(img.width * scale));
        const targetHeight = Math.max(1, Math.round(img.height * scale));

        const canvas = document.createElement('canvas');
        canvas.width = targetWidth;
        canvas.height = targetHeight;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          resolve({ base64: dataUrl, mime: file.type || 'image/jpeg' });
          return;
        }

        ctx.drawImage(img, 0, 0, targetWidth, targetHeight);
        const compressed = canvas.toDataURL('image/jpeg', 0.82);
        resolve({
          base64: compressed,
          mime: 'image/jpeg',
        });
      };
      img.src = dataUrl;
    };
    reader.readAsDataURL(file);
  });
}

export default function ClientPaymentPortal(): React.JSX.Element {
  const [client, setClient] = useState<ClientAccountRecord | null>(null);
  const [wallet, setWallet] = useState<ClientPortalWalletSummary | null>(null);
  const [orders, setOrders] = useState<PendingPaymentOrder[]>([]);
  const [sourceMode, setSourceMode] = useState<'POSTGRESQL_LIVE' | 'DEMO_FALLBACK'>('DEMO_FALLBACK');
  const [isCheckingSession, setIsCheckingSession] = useState<boolean>(true);
  const [isRefreshing, setIsRefreshing] = useState<boolean>(false);

  // Formulario de Acceso (Credenciales asignadas desde el Panel Principal)
  const [loginEmail, setLoginEmail] = useState<string>('');
  const [loginPin, setLoginPin] = useState<string>('');
  const [isAuthSubmitting, setIsAuthSubmitting] = useState<boolean>(false);
  const [authError, setAuthError] = useState<string | null>(null);

  // Formulario Reportar Pago
  const [selectedAccountId, setSelectedAccountId] = useState<string>('');
  const [plataforma, setPlataforma] = useState<ExpectedPlatformType>('CITIBANK');
  const [moneda, setMoneda] = useState<CurrencyType>('USD');
  const [monto, setMonto] = useState<string>('');
  const [fechaTransferencia, setFechaTransferencia] = useState<string>(() =>
    new Date().toISOString().slice(0, 10)
  );
  const [remitente, setRemitente] = useState<string>('');
  const [referencia, setReferencia] = useState<string>('');
  const [notasCliente, setNotasCliente] = useState<string>('');
  const [receiptBase64, setReceiptBase64] = useState<string>('');
  const [receiptMime, setReceiptMime] = useState<string>('image/jpeg');
  const [isDragging, setIsDragging] = useState<boolean>(false);
  const [isSubmittingReport, setIsSubmittingReport] = useState<boolean>(false);
  const [copiedAccountId, setCopiedAccountId] = useState<string | null>(null);

  // Estados de Escaneo e Identificación con IA
  const [isScanningAi, setIsScanningAi] = useState<boolean>(false);
  const [aiScanSuccess, setAiScanSuccess] = useState<boolean | null>(null);
  const [aiScanMessage, setAiScanMessage] = useState<string | null>(null);
  const [aiScanDetails, setAiScanDetails] = useState<{
    observaciones?: string;
    metodo?: string;
    confianza?: number;
  } | null>(null);
  const [aiDetectedFields, setAiDetectedFields] = useState<{
    monto?: boolean;
    fecha?: boolean;
    remitente?: boolean;
    referencia?: boolean;
    plataforma?: boolean;
    cuenta?: boolean;
  }>({});

  // Feedback del reporte
  const [reportFeedback, setReportFeedback] = useState<{
    type: 'instant' | 'pending' | 'error';
    title: string;
    detail: string;
  } | null>(null);

  // Modal emergente de confirmación de carga exitosa
  const [successOrderModal, setSuccessOrderModal] = useState<{
    order: PendingPaymentOrder;
    instant: boolean;
    tx?: FinancialTransactionRecord | null;
  } | null>(null);

  // Toast flotante de notificación rápida
  const [showToast, setShowToast] = useState<{
    type: 'instant' | 'success' | 'error';
    title: string;
    message: string;
    codigo?: string;
  } | null>(null);

  // Auto-cierre del toast a los 6 segundos
  useEffect(() => {
    if (!showToast) {
      return;
    }
    const timer = setTimeout(() => {
      setShowToast(null);
    }, 6000);
    return () => clearTimeout(timer);
  }, [showToast]);

  // Modal preview de captura en historial
  const [previewOrder, setPreviewOrder] = useState<PendingPaymentOrder | null>(null);

  const applySelectedAccount = useCallback((acc: AssignedReceivingAccount) => {
    setSelectedAccountId(acc.id);
    setPlataforma(acc.plataforma);
    setMoneda(acc.moneda);
  }, []);

  const loadSessionById = useCallback(
    async (clienteId: string) => {
      setIsRefreshing(true);
      try {
        const response = await fetch(
          `/api/portal/auth?clienteId=${encodeURIComponent(clienteId)}`,
          { cache: 'no-store' }
        );
        if (!response.ok) {
          window.localStorage.removeItem(STORAGE_CLIENT_KEY);
          setClient(null);
          return;
        }
        const data = (await response.json()) as {
          ok: boolean;
          mode?: 'POSTGRESQL_LIVE' | 'DEMO_FALLBACK';
          client?: ClientAccountRecord;
          wallet?: ClientPortalWalletSummary;
          orders?: PendingPaymentOrder[];
        };
        if (data.ok && data.client && data.wallet) {
          setClient(data.client);
          setWallet(data.wallet);
          setOrders(data.orders ?? []);
          if (data.mode) {
            setSourceMode(data.mode);
          }
          const assigned = data.client.cuentas_asignadas ?? [];
          if (assigned.length > 0) {
            setSelectedAccountId((prevId) => {
              const matched =
                assigned.find((a) => a.id === prevId) ?? assigned[0];
              if (matched) {
                setPlataforma(matched.plataforma);
                setMoneda(matched.moneda);
                return matched.id;
              }
              return prevId;
            });
          } else {
            setSelectedAccountId('');
          }
        }
      } catch {
        // mantener estado actual si falla red
      } finally {
        setIsRefreshing(false);
        setIsCheckingSession(false);
      }
    },
    []
  );

  useEffect(() => {
    const savedId =
      typeof window !== 'undefined'
        ? window.localStorage.getItem(STORAGE_CLIENT_KEY)
        : null;
    if (savedId) {
      void loadSessionById(savedId);
    } else {
      setIsCheckingSession(false);
    }
  }, [loadSessionById]);

  const handleCopyReceivingAccount = async (
    acc: AssignedReceivingAccount
  ): Promise<void> => {
    try {
      await navigator.clipboard.writeText(acc.cuenta_receptora);
      setCopiedAccountId(acc.id);
      window.setTimeout(() => {
        setCopiedAccountId((curr) => (curr === acc.id ? null : curr));
      }, 2000);
    } catch {
      // ignorar si clipboard no disponible
    }
  };

  const performLogin = async (emailValue: string, pinValue: string): Promise<void> => {
    setIsAuthSubmitting(true);
    setAuthError(null);
    try {
      const response = await fetch('/api/portal/auth', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          action: 'LOGIN',
          email: emailValue,
          pin: pinValue,
        }),
      });
      const data = (await response.json()) as {
        ok: boolean;
        mode?: 'POSTGRESQL_LIVE' | 'DEMO_FALLBACK';
        client?: ClientAccountRecord;
        wallet?: ClientPortalWalletSummary;
        orders?: PendingPaymentOrder[];
        error?: string;
      };
      if (!response.ok || !data.ok || !data.client || !data.wallet) {
        throw new Error(data.error ?? 'Error al iniciar sesión.');
      }

      window.localStorage.setItem(STORAGE_CLIENT_KEY, data.client.id);
      setClient(data.client);
      setWallet(data.wallet);
      setOrders(data.orders ?? []);
      setRemitente('');
      const assigned = data.client.cuentas_asignadas ?? [];
      if (assigned[0]) {
        applySelectedAccount(assigned[0]);
      } else {
        setSelectedAccountId('');
      }
      if (data.mode) {
        setSourceMode(data.mode);
      }
    } catch (err: unknown) {
      setAuthError(err instanceof Error ? err.message : 'Error de autenticación.');
    } finally {
      setIsAuthSubmitting(false);
    }
  };

  const handleLoginSubmit = async (
    event: React.FormEvent<HTMLFormElement>
  ): Promise<void> => {
    event.preventDefault();
    await performLogin(loginEmail, loginPin);
  };

  const handleLogout = (): void => {
    window.localStorage.removeItem(STORAGE_CLIENT_KEY);
    setClient(null);
    setWallet(null);
    setOrders([]);
    setReportFeedback(null);
  };

  const triggerAiScan = useCallback(
    async (base64Image: string): Promise<void> => {
      if (!base64Image) {
        return;
      }
      setIsScanningAi(true);
      setAiScanSuccess(null);
      setAiScanMessage(null);
      setAiScanDetails(null);

      try {
        const response = await fetch('/api/portal/scan-receipt', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            comprobante_base64: base64Image,
            cuentasAsignadas: client?.cuentas_asignadas ?? [],
          }),
        });

        const result = (await response.json()) as {
          ok: boolean;
          detected?: boolean;
          data?: ReceiptAiScanResult;
          message?: string;
          error?: string;
        };

        if (result.ok && result.data) {
          const d = result.data;
          const detectedMap: {
            monto?: boolean;
            fecha?: boolean;
            remitente?: boolean;
            referencia?: boolean;
            plataforma?: boolean;
            cuenta?: boolean;
          } = {};

          if (d.monto !== null && d.monto !== undefined && d.monto > 0) {
            setMonto(d.monto.toFixed(2));
            detectedMap.monto = true;
          }
          if (d.fecha && d.fecha.trim().length > 0) {
            const cleanDate = d.fecha.trim().slice(0, 10);
            if (/^\d{4}-\d{2}-\d{2}$/.test(cleanDate)) {
              setFechaTransferencia(cleanDate);
              detectedMap.fecha = true;
            }
          }
          if (d.moneda) {
            setMoneda(d.moneda);
          }
          if (d.plataforma) {
            setPlataforma(d.plataforma);
            detectedMap.plataforma = true;
          }
          if (d.referencia && d.referencia.trim().length > 0) {
            setReferencia(d.referencia.trim());
            detectedMap.referencia = true;
          }

          // Auto-asignación de la cuenta receptora si coincidió con la cuenta destino o plataforma
          if (d.selected_account_id && client?.cuentas_asignadas) {
            const matched = client.cuentas_asignadas.find(
              (a) => a.id === d.selected_account_id
            );
            if (matched) {
              applySelectedAccount(matched);
              detectedMap.cuenta = true;
            }
          }

          setAiDetectedFields(detectedMap);
          setAiScanSuccess(Boolean(result.detected));
          setAiScanMessage(result.message ?? 'Comprobante analizado con éxito.');
          setAiScanDetails({
            observaciones: d.observaciones,
            metodo: d.metodo_ia,
            confianza: Math.round((d.confianza || 0.9) * 100),
          });
        } else {
          setAiScanSuccess(false);
          setAiScanMessage(
            result.error ??
              'Captura lista. Por favor confirma o completa los datos del pago.'
          );
        }
      } catch (err: unknown) {
        setAiScanSuccess(false);
        setAiScanMessage(
          err instanceof Error
            ? err.message
            : 'Error comunicando con el motor de IA.'
        );
      } finally {
        setIsScanningAi(false);
      }
    },
    [client, applySelectedAccount]
  );

  const handleFilePicked = useCallback(
    async (file: File | undefined): Promise<void> => {
      if (!file) {
        return;
      }
      try {
        const compressed = await compressImageFileToBase64(file);
        setReceiptBase64(compressed.base64);
        setReceiptMime(compressed.mime);
        // Escanear e identificar con IA inmediatamente al cargar la imagen
        await triggerAiScan(compressed.base64);
      } catch (err: unknown) {
        setReportFeedback({
          type: 'error',
          title: 'Error procesando imagen',
          detail: err instanceof Error ? err.message : 'Intenta con otra imagen.',
        });
      }
    },
    [triggerAiScan]
  );

  // Soporte para pegar captura directamente desde el portapapeles (Ctrl + V)
  useEffect(() => {
    const handlePaste = (e: ClipboardEvent): void => {
      if (!client) {
        return;
      }
      const items = e.clipboardData?.items;
      if (!items) {
        return;
      }
      for (let i = 0; i < items.length; i += 1) {
        const item = items[i];
        if (item.type.startsWith('image/')) {
          const file = item.getAsFile();
          if (file) {
            e.preventDefault();
            void handleFilePicked(file);
            break;
          }
        }
      }
    };
    window.addEventListener('paste', handlePaste);
    return () => window.removeEventListener('paste', handlePaste);
  }, [client, handleFilePicked]);

  const handleGenerateSampleCapture = (): void => {
    const sampleAmount = monto.trim() || (moneda === 'USDT' ? '500.00' : '650.00');
    const sampleRef =
      referencia.trim() ||
      (plataforma === 'BINANCE_ONCHAIN' ? 'TX88492011A9F82C1' : 'CITI665091200');
    const sampleSender =
      remitente.trim() || client?.nombre_titular || 'JORGE LUIS VILLAMIZAR';

    const svgDataUrl = buildSampleReceiptBase64({
      plataforma,
      monto: moneda === 'USD' ? `$${sampleAmount}` : sampleAmount,
      moneda,
      remitente: sampleSender,
      referencia: sampleRef,
      fecha: new Date().toISOString().slice(0, 16).replace('T', ' '),
    });
    setReceiptBase64(svgDataUrl);
    setReceiptMime('image/svg+xml');
    void triggerAiScan(svgDataUrl);
  };

  const handleSubmitPaymentReport = async (
    event: React.FormEvent<HTMLFormElement>
  ): Promise<void> => {
    event.preventDefault();
    if (!client) {
      return;
    }

    if (!remitente.trim()) {
      setReportFeedback({
        type: 'error',
        title: 'Nombre de remitente requerido',
        detail:
          'Debes escribir obligatoriamente el nombre o titular de la persona/tercero que realizó la transferencia.',
      });
      return;
    }

    setIsSubmittingReport(true);
    setReportFeedback(null);

    try {
      const response = await fetch('/api/portal/report-payment', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          clienteId: client.id,
          plataforma_esperada: plataforma,
          moneda,
          monto_esperado: Number.parseFloat(monto),
          fecha_transferencia: fechaTransferencia,
          remitente_reportado: remitente,
          referencia_reportada: referencia,
          comprobante_base64: receiptBase64,
          comprobante_mime: receiptMime,
          notas_cliente: notasCliente,
        }),
      });

      const data = (await response.json()) as {
        ok: boolean;
        instantReconciled?: boolean;
        order?: PendingPaymentOrder;
        reconciledTransaction?: FinancialTransactionRecord | null;
        wallet?: ClientPortalWalletSummary;
        error?: string;
      };

      if (!response.ok || !data.ok || !data.order) {
        throw new Error(data.error ?? 'No se pudo enviar el reporte de pago.');
      }

      setOrders((prev) => [data.order as PendingPaymentOrder, ...prev]);
      if (data.wallet) {
        setWallet(data.wallet);
      }

      if (data.instantReconciled && data.reconciledTransaction) {
        const tx = data.reconciledTransaction;
        setReportFeedback({
          type: 'instant',
          title: '¡Pago Conciliado y Acreditado Instantáneamente!',
          detail: `Tu reporte ${data.order.codigo_orden} coincidió de inmediato con el movimiento confirmado en ${tx.plataforma}. Acreditado: ${formatAmount(
            tx.monto_neto,
            tx.moneda
          )} netos (Comisión ${tx.porcentaje_comision}%).`,
        });
        setShowToast({
          type: 'instant',
          title: '¡Pago Conciliado Instantáneamente!',
          message: `Reporte ${data.order.codigo_orden} acreditado a tu saldo disponible.`,
          codigo: data.order.codigo_orden,
        });
      } else {
        setReportFeedback({
          type: 'pending',
          title: `¡Reporte ${data.order.codigo_orden} Registrado con Éxito!`,
          detail:
            'Tu comprobante ha sido recibido correctamente. El motor conciliará y acreditará tu saldo automáticamente en cuanto ingrese la alerta del banco o Binance.',
        });
        setShowToast({
          type: 'success',
          title: '¡Carga Registrada con Éxito!',
          message: `Orden ${data.order.codigo_orden} en verificación bancaria.`,
          codigo: data.order.codigo_orden,
        });
      }

      setSuccessOrderModal({
        order: data.order as PendingPaymentOrder,
        instant: Boolean(data.instantReconciled),
        tx: data.reconciledTransaction,
      });

      setMonto('');
      setRemitente('');
      setReferencia('');
      setNotasCliente('');
      setReceiptBase64('');
      setAiDetectedFields({});
      setAiScanSuccess(null);
      setAiScanMessage(null);
      setAiScanDetails(null);
    } catch (err: unknown) {
      const errMsg =
        err instanceof Error ? err.message : 'Revisa los campos ingresados.';
      setReportFeedback({
        type: 'error',
        title: 'No se pudo registrar el pago',
        detail: errMsg,
      });
      setShowToast({
        type: 'error',
        title: 'Error al enviar reporte',
        message: errMsg,
      });
    } finally {
      setIsSubmittingReport(false);
    }
  };

  if (isCheckingSession) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-950 text-slate-300">
        <div className="flex items-center gap-3 text-sm">
          <Loader2 className="h-5 w-5 animate-spin text-emerald-400" />
          Cargando Portal de Clientes...
        </div>
      </div>
    );
  }

  const assignedAccounts: AssignedReceivingAccount[] =
    client?.cuentas_asignadas ?? [];
  const selectedAccount =
    assignedAccounts.find((a) => a.id === selectedAccountId) ??
    assignedAccounts[0] ??
    null;
  const hasUsdAccount =
    assignedAccounts.some((a) => a.moneda !== 'USDT') ||
    (wallet?.totalBrutoUsd ?? 0) > 0 ||
    assignedAccounts.length === 0;
  const hasUsdtAccount =
    assignedAccounts.some((a) => a.moneda === 'USDT') ||
    (wallet?.totalBrutoUsdt ?? 0) > 0;

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <div className="mx-auto max-w-5xl px-4 py-6 sm:px-6 lg:py-8">
        {/* Top Bar */}
        <header className="mb-6 flex flex-wrap items-center justify-between gap-3 border-b border-slate-800 pb-5">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-3 py-1 text-xs font-semibold text-emerald-400">
                <ShieldCheck className="h-3.5 w-3.5" />
                PORTAL DE AUTOGESTIÓN
              </span>
            </div>
            <h1 className="mt-2 text-xl font-bold text-white sm:text-2xl">
              Reporta tus Pagos Zelle &amp; Binance
            </h1>
            <p className="text-xs text-slate-400 sm:text-sm">
              Sube tu captura para conciliación instantánea y consulta tu saldo neto en USD y USDT
            </p>
          </div>

          {client && (
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handleLogout}
                className="inline-flex items-center gap-1.5 rounded-lg border border-rose-500/30 bg-rose-950/30 px-3 py-2 text-xs font-medium text-rose-300 hover:bg-rose-900/40"
              >
                <LogOut className="h-3.5 w-3.5" />
                Salir
              </button>
            </div>
          )}
        </header>

        {/* =====================================================================
            PASO 1: INICIO DE SESIÓN CON CORREO Y PIN ASIGNADO POR EL ADMINISTRADOR
           ===================================================================== */}
        {!client && (
          <div className="mx-auto max-w-md rounded-2xl border border-slate-800 bg-slate-900/80 p-6 shadow-2xl">
            <div className="mb-5 border-b border-slate-800 pb-4">
              <h2 className="text-lg font-bold text-white">
                Ingresar a mi Billetera
              </h2>
              <p className="mt-1 text-xs text-slate-400">
                Usa el correo electrónico y el PIN de acceso asignado por la administración.
              </p>
            </div>

            {authError && (
              <div className="mb-4 rounded-xl border border-rose-500/40 bg-rose-950/40 px-4 py-3 text-xs text-rose-200">
                {authError}
              </div>
            )}

            <form onSubmit={(e) => void handleLoginSubmit(e)} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold uppercase text-slate-300">
                  Correo Electrónico Registrado
                </label>
                <input
                  type="email"
                  required
                  value={loginEmail}
                  onChange={(e) => setLoginEmail(e.target.value)}
                  placeholder="cliente@empresa.com"
                  className="mt-1.5 w-full rounded-xl border border-slate-700 bg-slate-950 px-3.5 py-2.5 text-sm text-white focus:border-emerald-500 focus:outline-none"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold uppercase text-slate-300">
                  PIN de Acceso (4 a 6 dígitos)
                </label>
                <div className="relative mt-1.5">
                  <KeyRound className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                  <input
                    type="password"
                    inputMode="numeric"
                    pattern="\d{4,6}"
                    maxLength={6}
                    required
                    value={loginPin}
                    onChange={(e) => setLoginPin(e.target.value)}
                    placeholder="••••"
                    className="w-full rounded-xl border border-slate-700 bg-slate-950 py-2.5 pl-10 pr-4 font-mono text-base tracking-widest text-white focus:border-emerald-500 focus:outline-none"
                  />
                </div>
              </div>

              <button
                type="submit"
                disabled={isAuthSubmitting}
                className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-emerald-600 px-5 py-3 text-sm font-semibold text-white shadow-lg shadow-emerald-950/50 transition hover:bg-emerald-500 disabled:opacity-60"
              >
                {isAuthSubmitting ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Wallet className="h-4 w-4" />
                )}
                Entrar a mi Billetera
              </button>

              <p className="rounded-xl border border-slate-800 bg-slate-950/70 px-3.5 py-2.5 text-center text-[11px] leading-relaxed text-slate-400">
                Las cuentas de acceso se crean y gestionan exclusivamente desde el Panel Principal por el administrador.
              </p>
            </form>
          </div>
        )}

        {/* =====================================================================
            PASO 2 Y 3: MI BILLETERA + FORMULARIO REPORTAR PAGO
           ===================================================================== */}
        {client && wallet && (
          <div className="space-y-6">
            {/* Bienvenida y actualización */}
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-800 bg-slate-900/70 px-5 py-4">
              <div>
                <p className="text-xs text-slate-400">Sesión activa</p>
                <h2 className="text-base font-bold text-white sm:text-lg">
                  {client.nombre_titular}
                </h2>
                <p className="text-xs text-slate-400">
                  {hasUsdAccount && hasUsdtAccount
                    ? `Comisión Zelle: ${client.porcentaje_comision_zelle}% · Comisión Binance: ${client.porcentaje_comision_binance}%`
                    : hasUsdtAccount
                      ? `Comisión Binance: ${client.porcentaje_comision_binance}%`
                      : `Comisión Zelle: ${client.porcentaje_comision_zelle}%`}
                </p>
              </div>
              <button
                type="button"
                onClick={() => void loadSessionById(client.id)}
                disabled={isRefreshing}
                className="inline-flex items-center gap-2 rounded-xl border border-slate-700 bg-slate-950 px-3.5 py-2 text-xs font-semibold text-slate-200 hover:border-emerald-500/50 hover:text-white disabled:opacity-60"
              >
                <RefreshCw
                  className={`h-3.5 w-3.5 ${isRefreshing ? 'animate-spin' : ''}`}
                />
                Actualizar Saldo
              </button>
            </div>

            {/* Tarjetas de Saldo + Cuentas Asignadas */}
            <section
              className={`grid grid-cols-1 gap-4 ${
                hasUsdAccount && hasUsdtAccount
                  ? 'sm:grid-cols-2'
                  : 'lg:grid-cols-2'
              }`}
            >
              {hasUsdAccount && (
                <div className="rounded-2xl border border-emerald-500/30 bg-gradient-to-br from-emerald-950/40 via-slate-900 to-slate-900 p-5 shadow-lg">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold uppercase tracking-wider text-emerald-300">
                      Saldo Neto Acreditado en USD (Zelle -{client.porcentaje_comision_zelle}%)
                    </span>
                    <span className="rounded-xl bg-emerald-500/20 p-2 text-emerald-400">
                      <DollarSign className="h-4 w-4" />
                    </span>
                  </div>
                  <p className="mt-3 font-mono text-3xl font-bold text-emerald-400">
                    {formatAmount(wallet.saldoNetoUsd, 'USD')}
                  </p>
                  <div className="mt-2 flex flex-wrap gap-3 text-xs text-slate-400">
                    <span>Bruto: {formatAmount(wallet.totalBrutoUsd, 'USD')}</span>
                    <span>Comisión: -{formatAmount(wallet.totalComisionUsd, 'USD')}</span>
                  </div>
                </div>
              )}

              {hasUsdtAccount && (
                <div className="rounded-2xl border border-amber-500/30 bg-gradient-to-br from-amber-950/30 via-slate-900 to-slate-900 p-5 shadow-lg">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold uppercase tracking-wider text-amber-300">
                      Saldo Neto en USDT (Binance -{client.porcentaje_comision_binance}%)
                    </span>
                    <span className="rounded-xl bg-amber-500/20 p-2 text-amber-400">
                      <Coins className="h-4 w-4" />
                    </span>
                  </div>
                  <p className="mt-3 font-mono text-3xl font-bold text-amber-300">
                    {formatAmount(wallet.saldoNetoUsdt, 'USDT')}
                  </p>
                  <div className="mt-2 flex flex-wrap gap-3 text-xs text-slate-400">
                    <span>Bruto: {formatAmount(wallet.totalBrutoUsdt, 'USDT')}</span>
                    <span>Comisión: -{formatAmount(wallet.totalComisionUsdt, 'USDT')}</span>
                  </div>
                </div>
              )}

              {/* Cuentas Asignadas para Enviar Pagos */}
              <div
                className={`rounded-2xl border border-sky-500/30 bg-gradient-to-br from-sky-950/30 via-slate-900 to-slate-900 p-5 shadow-lg ${
                  hasUsdAccount && hasUsdtAccount ? 'sm:col-span-2' : ''
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold uppercase tracking-wider text-sky-300">
                    Cuentas Asignadas para Enviar Pagos ({assignedAccounts.length})
                  </span>
                  <span className="rounded-xl bg-sky-500/20 p-2 text-sky-400">
                    <Building2 className="h-4 w-4" />
                  </span>
                </div>

                {assignedAccounts.length === 0 ? (
                  <p className="mt-3 text-xs text-amber-300">
                    Aún no tienes cuentas receptoras asignadas. Solicita al administrador que asigne una cuenta en el Panel Principal.
                  </p>
                ) : (
                  <div className="mt-3 space-y-2">
                    {assignedAccounts.map((acc) => {
                      const meta = PLATFORM_DISPLAY_META[acc.plataforma];
                      const isCopied = copiedAccountId === acc.id;
                      return (
                        <div
                          key={acc.id}
                          className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-800 bg-slate-950/90 px-3.5 py-2.5"
                        >
                          <div className="min-w-0">
                            <div className="flex flex-wrap items-center gap-2">
                              <span
                                className={`inline-flex rounded border px-1.5 py-0.5 text-[10px] font-bold ${meta.accentClass}`}
                              >
                                {meta.label}
                              </span>
                              <span className="rounded bg-emerald-500/20 px-1.5 py-0.5 font-mono text-[10px] font-bold text-emerald-300">
                                Moneda: {acc.moneda}
                              </span>
                            </div>
                            <div className="mt-1 text-xs text-slate-400">
                              Enviar pago a:{' '}
                              <span className="font-mono font-bold text-white">
                                {acc.cuenta_receptora}
                              </span>
                            </div>
                          </div>
                          <button
                            type="button"
                            onClick={() => void handleCopyReceivingAccount(acc)}
                            className="inline-flex items-center gap-1 rounded-lg border border-slate-700 bg-slate-900 px-2.5 py-1.5 text-[11px] font-semibold text-slate-200 hover:border-sky-500/60 hover:text-white"
                          >
                            {isCopied ? (
                              <>
                                <Check className="h-3.5 w-3.5 text-emerald-400" />
                                Copiada
                              </>
                            ) : (
                              <>
                                <Copy className="h-3.5 w-3.5 text-sky-400" />
                                Copiar
                              </>
                            )}
                          </button>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </section>

            {/* Feedback inmediato del reporte */}
            {reportFeedback && (
              <div
                className={`rounded-2xl border p-4 shadow-lg transition-all ${
                  reportFeedback.type === 'instant'
                    ? 'animate-pulse border-emerald-400/60 bg-emerald-950/70 text-emerald-100'
                    : reportFeedback.type === 'pending'
                      ? 'border-amber-500/40 bg-amber-950/40 text-amber-100'
                      : 'border-rose-500/40 bg-rose-950/50 text-rose-100'
                }`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-start gap-3">
                    {reportFeedback.type === 'instant' ? (
                      <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-400" />
                    ) : reportFeedback.type === 'pending' ? (
                      <Clock className="mt-0.5 h-5 w-5 shrink-0 text-amber-400" />
                    ) : (
                      <X className="mt-0.5 h-5 w-5 shrink-0 text-rose-400" />
                    )}
                    <div>
                      <h3 className="text-sm font-bold">{reportFeedback.title}</h3>
                      <p className="mt-1 text-xs leading-relaxed opacity-90">
                        {reportFeedback.detail}
                      </p>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => setReportFeedback(null)}
                    className="rounded p-1 opacity-70 hover:opacity-100"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
              </div>
            )}

            {/* Grid Principal: Formulario Reportar Pago + Historial Reciente */}
            <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
              {/* Formulario "Reportar Pago" */}
              <section className="rounded-2xl border border-slate-800 bg-slate-900/80 p-5 shadow-xl lg:col-span-7">
                <div className="mb-4 flex items-center justify-between border-b border-slate-800 pb-3">
                  <div className="flex items-center gap-2">
                    <Send className="h-5 w-5 text-emerald-400" />
                    <h3 className="text-base font-bold text-white">
                      Reportar Nuevo Pago
                    </h3>
                  </div>
                  {sourceMode !== 'POSTGRESQL_LIVE' && (
                    <button
                      type="button"
                      onClick={() => {
                        setPlataforma('BINANCE_ONCHAIN');
                        setMoneda('USDT');
                        setMonto('500.00');
                        setRemitente(client.nombre_titular);
                        setReferencia('TX88492011A9F82C1');
                        setReceiptBase64(
                          buildSampleReceiptBase64({
                            plataforma: 'BINANCE_ONCHAIN',
                            monto: '500.00',
                            moneda: 'USDT',
                            remitente: client.nombre_titular,
                            referencia: 'TX88492011A9F82C1',
                            fecha: new Date()
                              .toISOString()
                              .slice(0, 16)
                              .replace('T', ' '),
                          })
                        );
                        setReceiptMime('image/svg+xml');
                      }}
                      className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-2.5 py-1 text-[11px] font-semibold text-amber-300 hover:bg-amber-500/20"
                    >
                      Probar Match Instantáneo (500 USDT)
                    </button>
                  )}
                </div>

                <form
                  onSubmit={(e) => void handleSubmitPaymentReport(e)}
                  className="space-y-5"
                >
                  {/* ===================================================================
                      PASO 1: CARGA DE COMPROBANTE CON IDENTIFICACIÓN IA (PRIMERO)
                     =================================================================== */}
                  <div className="rounded-2xl border border-emerald-500/40 bg-gradient-to-b from-emerald-950/20 via-slate-950 to-slate-950 p-4 shadow-inner">
                    <div className="flex flex-wrap items-center justify-between gap-2 pb-3">
                      <div className="flex items-center gap-2">
                        <span className="flex h-6 w-6 items-center justify-center rounded-full bg-emerald-500/20 text-xs font-bold text-emerald-400">
                          1
                        </span>
                        <label className="text-xs font-bold uppercase tracking-wider text-emerald-300">
                          Sube la Captura o Comprobante de Pago *
                        </label>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="inline-flex items-center gap-1 rounded-full border border-emerald-400/40 bg-emerald-500/10 px-2.5 py-0.5 text-[11px] font-semibold text-emerald-300">
                          <Sparkles className="h-3 w-3 animate-pulse text-emerald-400" />
                          Identificación con IA Activa
                        </span>
                        {sourceMode !== 'POSTGRESQL_LIVE' && (
                          <button
                            type="button"
                            onClick={handleGenerateSampleCapture}
                            className="inline-flex items-center gap-1 rounded-lg border border-sky-500/40 bg-sky-950/40 px-2 py-0.5 text-[11px] font-semibold text-sky-300 hover:bg-sky-900/40"
                          >
                            <ImagePlus className="h-3 w-3" />
                            Ejemplo IA
                          </button>
                        )}
                      </div>
                    </div>

                    {/* Dropzone / Scanner con animación IA */}
                    <div
                      onDragOver={(e) => {
                        e.preventDefault();
                        setIsDragging(true);
                      }}
                      onDragLeave={() => setIsDragging(false)}
                      onDrop={(e) => {
                        e.preventDefault();
                        setIsDragging(false);
                        const droppedFile = e.dataTransfer.files[0];
                        void handleFilePicked(droppedFile);
                      }}
                      className={`relative overflow-hidden rounded-xl border-2 transition ${
                        isScanningAi
                          ? 'border-emerald-400 bg-emerald-950/30'
                          : isDragging
                            ? 'border-emerald-400 bg-emerald-500/10'
                            : receiptBase64
                              ? 'border-slate-700 bg-slate-950/90'
                              : 'border-dashed border-slate-700 bg-slate-950/60 hover:border-slate-500'
                      }`}
                    >
                      {/* Estado 1: Escaneando con IA */}
                      {isScanningAi && (
                        <div className="flex flex-col items-center justify-center py-8 px-4 text-center">
                          <div className="relative mb-3 flex h-14 w-14 items-center justify-center rounded-2xl bg-emerald-500/20 text-emerald-400 shadow-lg shadow-emerald-950/60">
                            <Bot className="h-7 w-7 animate-bounce" />
                            <span className="absolute -top-1 -right-1 flex h-4 w-4">
                              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
                              <span className="relative inline-flex h-4 w-4 rounded-full bg-emerald-500" />
                            </span>
                          </div>
                          <h4 className="text-sm font-bold text-white">
                            Escaneando comprobante con Inteligencia Artificial...
                          </h4>
                          <p className="mt-1 max-w-md text-xs text-slate-300">
                            Analizando banco, monto exacto, moneda y código de confirmación para autocompletar el formulario.
                          </p>
                          <div className="mt-4 flex items-center gap-2 text-xs font-semibold text-emerald-400">
                            <Loader2 className="h-4 w-4 animate-spin" />
                            Extrayendo datos ópticos estructurados...
                          </div>
                        </div>
                      )}

                      {/* Estado 2: Imagen ya cargada (con o sin IA terminada) */}
                      {!isScanningAi && receiptBase64 && (
                        <div className="p-3.5">
                          <div className="flex flex-col items-center gap-4 sm:flex-row sm:items-start sm:text-left">
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img
                              src={receiptBase64}
                              alt="Comprobante cargado"
                              className="h-28 w-24 shrink-0 rounded-xl border border-slate-700 object-cover shadow-md"
                            />
                            <div className="flex-1 space-y-2 text-left">
                              {aiScanSuccess ? (
                                <div className="rounded-lg border border-emerald-500/40 bg-emerald-950/40 p-2.5">
                                  <div className="flex items-center gap-1.5 text-xs font-bold text-emerald-300">
                                    <Sparkles className="h-3.5 w-3.5 text-emerald-400" />
                                    ¡Comprobante Identificado con IA!
                                    {aiScanDetails?.confianza ? (
                                      <span className="ml-auto rounded bg-emerald-500/20 px-1.5 py-0.2 font-mono text-[10px] text-emerald-300">
                                        Confianza: {aiScanDetails.confianza}%
                                      </span>
                                    ) : null}
                                  </div>
                                  <p className="mt-1 text-[11px] leading-relaxed text-slate-300">
                                    {aiScanDetails?.observaciones ||
                                      'Los datos fueron extraídos y los campos de abajo se completaron automáticamente. Revisa y confirma antes de enviar.'}
                                  </p>
                                </div>
                              ) : (
                                <div>
                                  <p className="text-xs font-semibold text-white">
                                    Captura lista y optimizada ({receiptMime})
                                  </p>
                                  <p className="mt-0.5 text-[11px] text-slate-400">
                                    {aiScanMessage ||
                                      'Por favor completa o confirma los datos en el formulario a continuación.'}
                                  </p>
                                </div>
                              )}

                              <div className="flex flex-wrap items-center gap-2 pt-1">
                                <label className="cursor-pointer rounded-lg border border-slate-700 bg-slate-900 px-3 py-1.5 text-xs font-medium text-slate-200 hover:bg-slate-800">
                                  Cambiar Captura
                                  <input
                                    type="file"
                                    accept="image/*"
                                    className="hidden"
                                    onChange={(e) =>
                                      void handleFilePicked(e.target.files?.[0])
                                    }
                                  />
                                </label>
                                <button
                                  type="button"
                                  onClick={() => void triggerAiScan(receiptBase64)}
                                  className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-500/40 bg-emerald-950/40 px-3 py-1.5 text-xs font-semibold text-emerald-300 hover:bg-emerald-900/50"
                                >
                                  <ScanLine className="h-3.5 w-3.5" />
                                  Re-escanear con IA
                                </button>
                                <button
                                  type="button"
                                  onClick={() => {
                                    setReceiptBase64('');
                                    setAiScanSuccess(null);
                                    setAiScanMessage(null);
                                    setAiScanDetails(null);
                                    setAiDetectedFields({});
                                  }}
                                  className="rounded-lg border border-rose-500/30 px-2.5 py-1.5 text-xs text-rose-300 hover:bg-rose-950/40"
                                >
                                  Quitar
                                </button>
                              </div>
                            </div>
                          </div>
                        </div>
                      )}

                      {/* Estado 3: Sin imagen seleccionada aún */}
                      {!isScanningAi && !receiptBase64 && (
                        <label className="flex cursor-pointer flex-col items-center justify-center p-6 text-center hover:bg-slate-900/40">
                          <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-emerald-500/10 text-emerald-400">
                            <UploadCloud className="h-6 w-6" />
                          </div>
                          <span className="mt-2 text-xs font-bold text-white">
                            Toca para subir o arrastra la captura de tu teléfono
                          </span>
                          <span className="mt-1 text-[11px] text-slate-400">
                            PNG, JPG o WEBP · Puedes pegar directamente con <strong>Ctrl + V</strong>
                          </span>
                          <span className="mt-2 inline-flex items-center gap-1 rounded bg-slate-900 px-2 py-0.5 text-[10px] text-emerald-400">
                            <Sparkles className="h-3 w-3" />
                            La IA leerá los datos y llenará el formulario automáticamente
                          </span>
                          <input
                            type="file"
                            accept="image/*"
                            className="hidden"
                            onChange={(e) =>
                              void handleFilePicked(e.target.files?.[0])
                            }
                          />
                        </label>
                      )}
                    </div>
                  </div>

                  {/* ===================================================================
                      PASO 2: REVISA Y CONFIRMA LOS DATOS (EL USUARIO CONFIRMA)
                     =================================================================== */}
                  <div className="space-y-4 pt-1">
                    <div className="flex items-center justify-between border-b border-slate-800 pb-2">
                      <div className="flex items-center gap-2">
                        <span className="flex h-6 w-6 items-center justify-center rounded-full bg-slate-800 text-xs font-bold text-slate-300">
                          2
                        </span>
                        <h4 className="text-xs font-bold uppercase tracking-wider text-slate-200">
                          Revisa y Confirma los Datos del Pago
                        </h4>
                      </div>
                      <span className="text-[11px] text-slate-400">
                        Campos autollenados editables
                      </span>
                    </div>

                    {/* Selector de Cuentas Asignadas */}
                    <div>
                      <div className="flex items-center justify-between">
                        <label className="block text-xs font-semibold uppercase tracking-wider text-slate-300">
                          Cuenta Asignada donde enviaste el pago *
                        </label>
                        {aiDetectedFields.cuenta && (
                          <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-emerald-400">
                            <Sparkles className="h-3 w-3" />
                            Seleccionada por IA
                          </span>
                        )}
                      </div>

                      {assignedAccounts.length === 0 ? (
                        <div className="mt-2 rounded-xl border border-amber-500/40 bg-amber-950/30 p-3.5 text-xs text-amber-200">
                          No tienes cuentas receptoras asignadas todavía. Solicita al administrador que te asigne la cuenta destino y su moneda desde el Panel Principal.
                        </div>
                      ) : (
                        <div className="mt-2 grid grid-cols-1 gap-2.5 sm:grid-cols-2">
                          {assignedAccounts.map((acc) => {
                            const meta = PLATFORM_DISPLAY_META[acc.plataforma];
                            const isSelected =
                              (selectedAccount?.id ?? '') === acc.id;
                            return (
                              <button
                                key={acc.id}
                                type="button"
                                onClick={() => applySelectedAccount(acc)}
                                className={`rounded-xl border p-3 text-left transition ${
                                  isSelected
                                    ? `${meta.accentClass} ring-2 ring-emerald-400/60`
                                    : 'border-slate-800 bg-slate-950 text-slate-300 hover:border-slate-700'
                                }`}
                              >
                                <div className="flex items-center justify-between gap-2">
                                  <span className="text-xs font-bold">
                                    {acc.alias || meta.label}
                                  </span>
                                  <span className="rounded bg-slate-900/90 px-1.5 py-0.5 font-mono text-[10px] font-bold text-emerald-300">
                                    {acc.moneda}
                                  </span>
                                </div>
                                <div className="mt-1.5 text-[11px] opacity-80">
                                  Enviar a:
                                </div>
                                <div className="mt-0.5 break-all font-mono text-xs font-semibold text-white">
                                  {acc.cuenta_receptora}
                                </div>
                              </button>
                            );
                          })}
                        </div>
                      )}

                      {selectedAccount && (
                        <div className="mt-2 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-sky-500/30 bg-sky-950/20 px-3 py-2 text-xs text-sky-200">
                          <span>
                            Destino seleccionado:{' '}
                            <strong className="font-mono text-white">
                              {selectedAccount.cuenta_receptora}
                            </strong>{' '}
                            · Moneda:{' '}
                            <strong className="font-mono text-emerald-300">
                              {selectedAccount.moneda}
                            </strong>
                          </span>
                          <button
                            type="button"
                            onClick={() =>
                              void handleCopyReceivingAccount(selectedAccount)
                            }
                            className="inline-flex items-center gap-1 rounded border border-sky-500/40 bg-sky-500/10 px-2 py-0.5 text-[11px] font-semibold text-sky-200 hover:bg-sky-500/20"
                          >
                            {copiedAccountId === selectedAccount.id ? (
                              <>
                                <Check className="h-3 w-3 text-emerald-400" />
                                Copiada
                              </>
                            ) : (
                              <>
                                <Copy className="h-3 w-3" />
                                Copiar cuenta
                              </>
                            )}
                          </button>
                        </div>
                      )}
                    </div>

                    {/* Monto, Moneda y Fecha */}
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-12">
                      <div className="sm:col-span-5">
                        <div className="flex items-center justify-between">
                          <label className="block text-xs font-semibold uppercase text-slate-300">
                            Monto Exacto ({moneda}) *
                          </label>
                          {aiDetectedFields.monto && (
                            <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-emerald-400">
                              <Sparkles className="h-3 w-3" />
                              IA Detectado
                            </span>
                          )}
                        </div>
                        <input
                          type="number"
                          step="0.01"
                          min="0.01"
                          required
                          value={monto}
                          onChange={(e) => setMonto(e.target.value)}
                          placeholder="0.00"
                          className={`mt-1.5 w-full rounded-xl border bg-slate-950 px-3.5 py-2.5 font-mono text-base font-bold text-white transition focus:outline-none ${
                            aiDetectedFields.monto
                              ? 'border-emerald-500/60 ring-1 ring-emerald-500/40 focus:border-emerald-400'
                              : 'border-slate-700 focus:border-emerald-500'
                          }`}
                        />
                      </div>
                      <div className="sm:col-span-3">
                        <label className="block text-xs font-semibold uppercase text-slate-300">
                          Moneda
                        </label>
                        <select
                          value={moneda}
                          disabled={Boolean(selectedAccount)}
                          onChange={(e) => setMoneda(e.target.value as CurrencyType)}
                          className="mt-1.5 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2.5 font-mono text-sm text-white focus:border-emerald-500 focus:outline-none disabled:cursor-not-allowed disabled:opacity-80"
                        >
                          <option value="USD">USD</option>
                          <option value="USDT">USDT</option>
                          <option value="VES">VES</option>
                        </select>
                      </div>
                      <div className="sm:col-span-4">
                        <div className="flex items-center justify-between">
                          <label className="block text-xs font-semibold uppercase text-slate-300">
                            Fecha Transferencia *
                          </label>
                          {aiDetectedFields.fecha && (
                            <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-emerald-400">
                              <Sparkles className="h-3 w-3" />
                              IA Detectado
                            </span>
                          )}
                        </div>
                        <input
                          type="date"
                          required
                          value={fechaTransferencia}
                          onChange={(e) => setFechaTransferencia(e.target.value)}
                          className={`mt-1.5 w-full rounded-xl border bg-slate-950 px-3 py-2.5 font-mono text-sm text-white transition focus:outline-none ${
                            aiDetectedFields.fecha
                              ? 'border-emerald-500/60 ring-1 ring-emerald-500/40 focus:border-emerald-400'
                              : 'border-slate-700 focus:border-emerald-500'
                          }`}
                        />
                      </div>
                    </div>

                    {/* Remitente y Referencia */}
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                      <div>
                        <div className="flex items-center justify-between">
                          <label className="block text-xs font-semibold uppercase text-slate-300">
                            3. Nombre del Remitente (Tercero) *
                          </label>
                          <span className="inline-flex items-center gap-1 rounded bg-amber-500/10 px-2 py-0.5 text-[10px] font-semibold text-amber-400 border border-amber-500/30">
                            Obligatorio manual
                          </span>
                        </div>
                        <input
                          type="text"
                          required
                          value={remitente}
                          onChange={(e) => setRemitente(e.target.value)}
                          placeholder={
                            plataforma.startsWith('BINANCE')
                              ? 'Nickname o Pay ID de quien envió'
                              : 'Nombre de la persona que envió el pago'
                          }
                          className="mt-1.5 w-full rounded-xl border border-slate-700 bg-slate-950 px-3.5 py-2.5 text-sm text-white transition focus:border-emerald-500 focus:outline-none"
                        />
                        <p className="mt-1 text-[11px] text-slate-400">
                          Escribe manualmente el nombre o titular de la cuenta que te transfirió.
                        </p>
                      </div>
                      <div>
                        <div className="flex items-center justify-between">
                          <label className="block text-xs font-semibold uppercase text-slate-300">
                            Código Confirmación / Order ID / TxID
                            {plataforma.startsWith('BINANCE') ? (
                              <span className="text-amber-400 font-bold"> *</span>
                            ) : (
                              <span className="ml-1 text-[10px] font-normal lowercase text-slate-400">
                                (opcional si tu banco no lo muestra)
                              </span>
                            )}
                          </label>
                          {aiDetectedFields.referencia && (
                            <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-emerald-400">
                              <Sparkles className="h-3 w-3" />
                              IA Detectado
                            </span>
                          )}
                        </div>
                        <input
                          type="text"
                          required={plataforma.startsWith('BINANCE')}
                          value={referencia}
                          onChange={(e) => setReferencia(e.target.value)}
                          placeholder={
                            plataforma.startsWith('BINANCE')
                              ? '293849201192 o TxID'
                              : 'CITI665091200 (o déjalo en blanco si tu banco no lo muestra)'
                          }
                          className={`mt-1.5 w-full rounded-xl border bg-slate-950 px-3.5 py-2.5 font-mono text-sm text-white transition focus:outline-none ${
                            aiDetectedFields.referencia
                              ? 'border-emerald-500/60 ring-1 ring-emerald-500/40 focus:border-emerald-400'
                              : 'border-slate-700 focus:border-emerald-500'
                          }`}
                        />
                        <p className="mt-1 text-[11px] text-slate-400">
                          {plataforma.startsWith('BINANCE')
                            ? 'Pega el Order ID o TxID de Binance para validación instantánea.'
                            : 'Bancos como Chase, Wells Fargo o Zelle a veces no muestran el código en la pantalla inicial. Si tu comprobante no lo tiene, déjalo en blanco; conciliaremos por Monto ($) y Nombre del Remitente.'}
                        </p>
                      </div>
                    </div>

                    {/* Notas Adicionales */}
                    <div>
                      <label className="block text-xs font-semibold uppercase text-slate-300">
                        Notas Adicionales (Opcional)
                      </label>
                      <input
                        type="text"
                        value={notasCliente}
                        onChange={(e) => setNotasCliente(e.target.value)}
                        placeholder="Ej. Pago de factura #2045 o cuenta de tercero autorizado"
                        className="mt-1.5 w-full rounded-xl border border-slate-700 bg-slate-950 px-3.5 py-2 text-sm text-white focus:border-emerald-500 focus:outline-none"
                      />
                    </div>

                    {/* Mensaje / Alerta visible directamente sobre el botón de envío */}
                    {reportFeedback && (
                      <div
                        className={`rounded-xl border p-3.5 transition-all shadow-lg animate-in fade-in duration-200 ${
                          reportFeedback.type === 'instant'
                            ? 'border-emerald-500/50 bg-emerald-950/80 text-emerald-100 shadow-emerald-950/50'
                            : reportFeedback.type === 'pending'
                              ? 'border-amber-500/50 bg-amber-950/70 text-amber-100 shadow-amber-950/50'
                              : 'border-rose-500/50 bg-rose-950/80 text-rose-100 shadow-rose-950/50'
                        }`}
                      >
                        <div className="flex items-start justify-between gap-2.5">
                          <div className="flex items-start gap-2.5">
                            {reportFeedback.type === 'instant' ? (
                              <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-400" />
                            ) : reportFeedback.type === 'pending' ? (
                              <Clock className="mt-0.5 h-5 w-5 shrink-0 text-amber-400" />
                            ) : (
                              <X className="mt-0.5 h-5 w-5 shrink-0 text-rose-400" />
                            )}
                            <div>
                              <h4 className="text-xs font-bold leading-tight">
                                {reportFeedback.title}
                              </h4>
                              <p className="mt-1 text-xs opacity-90 leading-relaxed">
                                {reportFeedback.detail}
                              </p>
                            </div>
                          </div>
                          <button
                            type="button"
                            onClick={() => setReportFeedback(null)}
                            className="rounded p-1 text-slate-400 hover:text-white"
                          >
                            <X className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </div>
                    )}

                    {!receiptBase64 && (
                      <div className="flex items-center gap-2 rounded-xl border border-slate-800 bg-slate-950/80 p-3 text-xs text-slate-400">
                        <UploadCloud className="h-4 w-4 shrink-0 text-emerald-400" />
                        <span>
                          Sube o arrastra la captura de tu comprobante en el <strong>Paso 1</strong> para habilitar el botón de confirmación.
                        </span>
                      </div>
                    )}

                    {/* Botón de Confirmación y Envío */}
                    <button
                      type="submit"
                      disabled={
                        isSubmittingReport ||
                        isScanningAi ||
                        !receiptBase64 ||
                        assignedAccounts.length === 0
                      }
                      className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 px-5 py-3.5 text-sm font-bold text-white shadow-xl shadow-emerald-950/60 transition hover:from-emerald-500 hover:to-teal-500 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {isSubmittingReport ? (
                        <>
                          <Loader2 className="h-4 w-4 animate-spin" />
                          Enviando y Conciliando Pago...
                        </>
                      ) : isScanningAi ? (
                        <>
                          <Loader2 className="h-4 w-4 animate-spin text-emerald-200" />
                          Identificando con IA...
                        </>
                      ) : (
                        <>
                          <CheckCircle2 className="h-4 w-4" />
                          Confirmar Datos y Conciliar Pago
                        </>
                      )}
                    </button>
                  </div>
                </form>
              </section>

              {/* Historial de Reportes del Cliente */}
              <section className="rounded-2xl border border-slate-800 bg-slate-900/80 p-5 shadow-xl lg:col-span-5">
                <div className="mb-4 flex items-center justify-between border-b border-slate-800 pb-3">
                  <div className="flex items-center gap-2">
                    <Building2 className="h-5 w-5 text-sky-400" />
                    <h3 className="text-base font-bold text-white">
                      Mis Reportes Recientes ({orders.length})
                    </h3>
                  </div>
                </div>

                {orders.length === 0 ? (
                  <div className="rounded-xl border border-slate-800 bg-slate-950 p-6 text-center text-xs text-slate-400">
                    Aún no has reportado pagos. Usa el formulario para subir tu primer comprobante.
                  </div>
                ) : (
                  <div className="max-h-[640px] space-y-3 overflow-y-auto pr-1">
                    {orders.map((order) => {
                      const isConciliado = order.estado === 'CONCILIADO';
                      return (
                        <div
                          key={order.id}
                          className="rounded-xl border border-slate-800 bg-slate-950/90 p-3.5 transition hover:border-slate-700"
                        >
                          <div className="flex items-start justify-between gap-2">
                            <div>
                              <span className="font-mono text-xs font-bold text-sky-300">
                                {order.codigo_orden}
                              </span>
                              <span className="ml-2 rounded bg-slate-800 px-1.5 py-0.5 text-[10px] font-semibold text-slate-300">
                                {order.plataforma_esperada}
                              </span>
                            </div>

                            {isConciliado ? (
                              <span className="inline-flex items-center gap-1 rounded-full border border-emerald-500/40 bg-emerald-500/15 px-2 py-0.5 text-[10px] font-bold text-emerald-300">
                                <CheckCircle2 className="h-3 w-3" />
                                CONCILIADO AUTOMÁTICAMENTE
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1 rounded-full border border-amber-500/40 bg-amber-500/15 px-2 py-0.5 text-[10px] font-bold text-amber-300">
                                <Clock className="h-3 w-3" />
                                VERIFICANDO EN BANCO/BINANCE
                              </span>
                            )}
                          </div>

                          <div className="mt-2 flex items-baseline justify-between">
                            <span className="font-mono text-lg font-bold text-white">
                              {formatAmount(order.monto_esperado, order.moneda)}
                            </span>
                            <span className="font-mono text-xs text-slate-400">
                              Ref: {order.referencia_reportada ?? 'N/A'}
                            </span>
                          </div>

                          <div className="mt-1.5 flex items-center justify-between text-[11px] text-slate-400">
                            <span className="truncate">
                              De: {order.remitente_reportado}
                            </span>
                            <span>
                              {order.fecha_transferencia
                                ? `Fecha pago: ${order.fecha_transferencia}`
                                : formatDateTime(order.created_at)}
                            </span>
                          </div>

                          {order.comprobante_base64 && (
                            <div className="mt-2.5 flex items-center justify-end border-t border-slate-800/70 pt-2">
                              <button
                                type="button"
                                onClick={() => setPreviewOrder(order)}
                                className="inline-flex items-center gap-1 rounded-lg border border-slate-700 bg-slate-900 px-2.5 py-1 text-[11px] font-medium text-slate-200 hover:bg-slate-800"
                              >
                                <Eye className="h-3.5 w-3.5 text-sky-400" />
                                Ver Captura Subida
                              </button>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </section>
            </div>
          </div>
        )}

        {/* Modal Lightbox para ver la captura subida por el cliente */}
        <Dialog.Root
          open={previewOrder !== null}
          onOpenChange={(open) => {
            if (!open) {
              setPreviewOrder(null);
            }
          }}
        >
          <Dialog.Portal>
            <Dialog.Overlay className="fixed inset-0 z-40 bg-slate-950/85 backdrop-blur-sm" />
            <Dialog.Content className="fixed left-1/2 top-1/2 z-50 w-full max-w-lg -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-slate-800 bg-slate-900 p-5 text-slate-100 shadow-2xl">
              <div className="flex items-center justify-between border-b border-slate-800 pb-3">
                <Dialog.Title className="text-base font-bold text-white">
                  Comprobante {previewOrder?.codigo_orden}
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
              {previewOrder?.comprobante_base64 && (
                <div className="mt-4 space-y-3">
                  <div className="flex justify-center rounded-xl border border-slate-800 bg-slate-950 p-3">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={previewOrder.comprobante_base64}
                      alt={`Comprobante ${previewOrder.codigo_orden}`}
                      className="max-h-[460px] rounded-lg object-contain"
                    />
                  </div>
                  <div className="rounded-xl bg-slate-950 p-3 text-xs text-slate-300">
                    <div>
                      Plataforma: <strong>{previewOrder.plataforma_esperada}</strong> · Monto:{' '}
                      <strong>
                        {formatAmount(previewOrder.monto_esperado, previewOrder.moneda)}
                      </strong>
                    </div>
                    <div className="mt-1 font-mono text-slate-400">
                      Referencia: {previewOrder.referencia_reportada}
                    </div>
                  </div>
                </div>
              )}
            </Dialog.Content>
          </Dialog.Portal>
        </Dialog.Root>

        {/* Modal de Confirmación Exitosa tras Cargar / Reportar un Pago */}
        <Dialog.Root
          open={successOrderModal !== null}
          onOpenChange={(open) => {
            if (!open) {
              setSuccessOrderModal(null);
            }
          }}
        >
          <Dialog.Portal>
            <Dialog.Overlay className="fixed inset-0 z-50 bg-slate-950/85 backdrop-blur-md animate-in fade-in duration-200" />
            <Dialog.Content className="fixed left-1/2 top-1/2 z-50 w-full max-w-md -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-slate-700 bg-slate-900 p-6 text-slate-100 shadow-2xl animate-in zoom-in-95 duration-200">
              <div className="flex flex-col items-center text-center">
                {successOrderModal?.instant ? (
                  <div className="relative mb-3 flex h-16 w-16 items-center justify-center rounded-2xl bg-emerald-500/20 text-emerald-400 shadow-lg shadow-emerald-950/60">
                    <CheckCircle2 className="h-9 w-9 text-emerald-400" />
                    <span className="absolute -top-1 -right-1 flex h-4 w-4">
                      <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
                      <span className="relative inline-flex h-4 w-4 rounded-full bg-emerald-500" />
                    </span>
                  </div>
                ) : (
                  <div className="mb-3 flex h-16 w-16 items-center justify-center rounded-2xl bg-amber-500/20 text-amber-400 shadow-lg shadow-amber-950/60">
                    <Clock className="h-9 w-9 text-amber-400 animate-pulse" />
                  </div>
                )}

                <Dialog.Title className="text-lg font-extrabold text-white">
                  {successOrderModal?.instant
                    ? '¡Pago Conciliado Instantáneamente!'
                    : '¡Carga Registrada con Éxito!'}
                </Dialog.Title>

                <Dialog.Description className="mt-1.5 text-xs text-slate-300">
                  {successOrderModal?.instant
                    ? 'Tu comprobante coincidió al instante con el extracto bancario. Tu saldo ha sido acreditado inmediatamente.'
                    : 'Tu comprobante y reporte fueron guardados. El sistema conciliará y acreditará tu saldo de forma automática al recibir la confirmación bancaria.'}
                </Dialog.Description>

                {/* Tarjeta de detalles del pago reportado */}
                {successOrderModal?.order && (
                  <div className="mt-5 w-full space-y-2.5 rounded-xl border border-slate-800 bg-slate-950 p-4 text-left text-xs">
                    <div className="flex items-center justify-between border-b border-slate-800 pb-2">
                      <span className="font-semibold text-slate-400">Código de Orden:</span>
                      <span className="inline-flex items-center gap-1 font-mono font-bold text-emerald-400">
                        {successOrderModal.order.codigo_orden}
                      </span>
                    </div>

                    <div className="flex items-center justify-between border-b border-slate-800 pb-2">
                      <span className="font-semibold text-slate-400">Monto Reportado:</span>
                      <span className="text-sm font-extrabold text-white">
                        {formatAmount(
                          successOrderModal.order.monto_esperado,
                          successOrderModal.order.moneda
                        )}
                      </span>
                    </div>

                    {successOrderModal.order.fecha_transferencia && (
                      <div className="flex items-center justify-between border-b border-slate-800 pb-2">
                        <span className="font-semibold text-slate-400">Fecha Transferencia:</span>
                        <span className="font-mono text-slate-200">
                          {successOrderModal.order.fecha_transferencia}
                        </span>
                      </div>
                    )}

                    <div className="flex items-center justify-between border-b border-slate-800 pb-2">
                      <span className="font-semibold text-slate-400">Destino / Banco:</span>
                      <span className="font-medium text-slate-200">
                        {successOrderModal.order.plataforma_esperada || successOrderModal.order.banco_destino}
                      </span>
                    </div>

                    <div className="flex items-center justify-between border-b border-slate-800 pb-2">
                      <span className="font-semibold text-slate-400">Titular Remitente:</span>
                      <span className="font-medium text-slate-200">
                        {successOrderModal.order.remitente_reportado || successOrderModal.order.nombre_remitente_reportado}
                      </span>
                    </div>

                    {successOrderModal.order.referencia_reportada && (
                      <div className="flex items-center justify-between border-b border-slate-800 pb-2">
                        <span className="font-semibold text-slate-400">Referencia / TxID:</span>
                        <span className="font-mono text-slate-300">
                          {successOrderModal.order.referencia_reportada}
                        </span>
                      </div>
                    )}

                    <div className="flex items-center justify-between pt-1">
                      <span className="font-semibold text-slate-400">Estado:</span>
                      {successOrderModal.instant ? (
                        <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-0.5 text-[11px] font-bold text-emerald-400 border border-emerald-500/30">
                          <CheckCircle2 className="h-3 w-3" /> Conciliado Automáticamente
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/10 px-2 py-0.5 text-[11px] font-bold text-amber-400 border border-amber-500/30">
                          <Clock className="h-3 w-3" /> Verificando en Banco
                        </span>
                      )}
                    </div>
                  </div>
                )}

                <div className="mt-6 flex w-full gap-3">
                  <Dialog.Close asChild>
                    <button
                      type="button"
                      className="w-full rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 py-3 text-sm font-bold text-white shadow-lg shadow-emerald-950/60 transition hover:from-emerald-500 hover:to-teal-500"
                    >
                      Aceptar y Continuar
                    </button>
                  </Dialog.Close>
                </div>
              </div>
            </Dialog.Content>
          </Dialog.Portal>
        </Dialog.Root>

        {/* Toast flotante de notificación rápida */}
        {showToast && (
          <div className="fixed bottom-5 right-5 z-50 flex max-w-sm items-start gap-3 rounded-2xl border border-slate-700 bg-slate-900/95 p-4 text-slate-100 shadow-2xl backdrop-blur-md animate-in slide-in-from-bottom-5 duration-300">
            {showToast.type === 'instant' || showToast.type === 'success' ? (
              <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-400" />
            ) : (
              <X className="mt-0.5 h-5 w-5 shrink-0 text-rose-400" />
            )}
            <div className="flex-1">
              <h5 className="text-xs font-bold text-white">{showToast.title}</h5>
              <p className="mt-0.5 text-xs text-slate-300">{showToast.message}</p>
              {showToast.codigo && (
                <span className="mt-1 inline-block font-mono text-[10px] font-bold text-emerald-400">
                  {showToast.codigo}
                </span>
              )}
            </div>
            <button
              type="button"
              onClick={() => setShowToast(null)}
              className="rounded p-1 text-slate-400 hover:text-white"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
