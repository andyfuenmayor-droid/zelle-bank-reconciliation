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
import {
  AssignedReceivingAccount,
  ClientAccountRecord,
  ClientLiquidationRecord,
  ClientPortalWalletSummary,
  CurrencyType,
  ExpectedPlatformType,
  FinancialTransactionRecord,
  PendingPaymentOrder,
} from '@/types/reconciliation';
import { ReceiptAiScanResult } from '@/lib/receipt-scanner';
import ThemeToggle from '@/components/ThemeToggle';

const STORAGE_CLIENT_KEY = 'fintech_portal_client_id';

const PLATFORM_DISPLAY_META: Record<
  ExpectedPlatformType,
  { label: string; sublabel: string; accentClass: string }
> = {
  CITIBANK: {
    label: 'Citibank Zelle',
    sublabel: 'Transferencia USD',
    accentClass:
      'border-stone-300 bg-stone-100 text-stone-700 dark:border-stone-700 dark:bg-stone-800/80 dark:text-stone-300',
  },
  TD_BANK: {
    label: 'TD Bank Zelle',
    sublabel: 'Transferencia USD',
    accentClass:
      'border-emerald-700/25 bg-emerald-50 text-emerald-800 dark:border-emerald-500/30 dark:bg-emerald-950/40 dark:text-emerald-400',
  },
  BINANCE_PAY: {
    label: 'Binance Pay',
    sublabel: 'Pay ID / Instantáneo',
    accentClass:
      'border-amber-700/25 bg-amber-50 text-amber-800 dark:border-amber-500/30 dark:bg-amber-950/40 dark:text-amber-400',
  },
  BINANCE_P2P: {
    label: 'Binance P2P',
    sublabel: 'Orden C2C Completada',
    accentClass:
      'border-amber-700/25 bg-amber-50/70 text-amber-800 dark:border-amber-500/30 dark:bg-amber-950/30 dark:text-amber-400',
  },
  BINANCE_ONCHAIN: {
    label: 'Depósito Red USDT',
    sublabel: 'TRC20 / BEP20 / ERC20',
    accentClass:
      'border-stone-300 bg-stone-100 text-stone-700 dark:border-stone-700 dark:bg-stone-800/80 dark:text-stone-300',
  },
};

function formatAmount(amount: number, currency: CurrencyType): string {
  const safe = Number.isFinite(amount) ? amount : 0;
  const sign = safe < 0 ? '-' : '';
  const formatted = new Intl.NumberFormat('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Math.abs(safe));

  if (currency === 'USDT') {
    return `${sign}${formatted} USDT`;
  }
  if (currency === 'VES') {
    return `${sign}${formatted} VES`;
  }
  return `${sign}$${formatted} USD`;
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
        const maxWidth = 1440;
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
        const compressed = canvas.toDataURL('image/jpeg', 0.9);
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
  const [liquidations, setLiquidations] = useState<ClientLiquidationRecord[]>([]);
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
  const [fechaTransferencia, setFechaTransferencia] = useState<string>(() => {
    try {
      return new Intl.DateTimeFormat('en-CA', {
        timeZone: 'America/Caracas',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      }).format(new Date());
    } catch {
      return new Date().toISOString().slice(0, 10);
    }
  });
  const [remitente, setRemitente] = useState<string>('');
  const [remitenteMismatchError, setRemitenteMismatchError] = useState<string | null>(null);
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
  const [showAllRecentCards, setShowAllRecentCards] = useState<boolean>(true);
  const [reportFilterStatus, setReportFilterStatus] = useState<
    'TODOS' | 'CONCILIADO' | 'DIRECTA' | 'PENDIENTE'
  >('TODOS');
  const [reportSearchQuery, setReportSearchQuery] = useState<string>('');
  const [copiedSummaryReport, setCopiedSummaryReport] = useState<boolean>(false);
  const [selectedReportCycleId, setSelectedReportCycleId] =
    useState<string>('ACTIVO');
  const [archivedReportOrders, setArchivedReportOrders] = useState<
    PendingPaymentOrder[]
  >([]);
  const [isLoadingReportCycle, setIsLoadingReportCycle] =
    useState<boolean>(false);

  const handleSelectReportCycle = useCallback(
    async (cycleId: string): Promise<void> => {
      setSelectedReportCycleId(cycleId);
      setReportFilterStatus('TODOS');
      setReportSearchQuery('');
      if (cycleId === 'ACTIVO') {
        setArchivedReportOrders([]);
        return;
      }
      setIsLoadingReportCycle(true);
      try {
        const res = await fetch(
          `/api/reconciliation/liquidations/items?liquidacionId=${encodeURIComponent(
            cycleId
          )}`,
          { cache: 'no-store', credentials: 'same-origin' }
        );
        const data = (await res.json()) as {
          ok: boolean;
          items?: PendingPaymentOrder[];
        };
        if (res.ok && data.ok) {
          setArchivedReportOrders(data.items ?? []);
        } else {
          setArchivedReportOrders([]);
        }
      } catch {
        setArchivedReportOrders([]);
      } finally {
        setIsLoadingReportCycle(false);
      }
    },
    []
  );

  // Modal de detalle de ciclos pasados / liquidaciones cerradas (con acceso a capturas archivadas)
  const [selectedLiquidationModal, setSelectedLiquidationModal] =
    useState<ClientLiquidationRecord | null>(null);
  const [liqDetailItems, setLiqDetailItems] = useState<PendingPaymentOrder[]>([]);
  const [liqDetailSummary, setLiqDetailSummary] = useState<{
    totalCount: number;
    portalCount: number;
    directCount: number;
    totalBruto: number;
    totalComision: number;
    totalNeto: number;
  } | null>(null);
  const [isLoadingLiqDetail, setIsLoadingLiqDetail] = useState<boolean>(false);
  const [liqDetailError, setLiqDetailError] = useState<string | null>(null);
  const [liqDetailSearch, setLiqDetailSearch] = useState<string>('');
  const [copiedLiqDetailSummary, setCopiedLiqDetailSummary] =
    useState<boolean>(false);

  const openLiquidationCycleDetail = useCallback(
    async (liq: ClientLiquidationRecord): Promise<void> => {
      setSelectedLiquidationModal(liq);
      setLiqDetailItems([]);
      setLiqDetailSummary(null);
      setLiqDetailError(null);
      setLiqDetailSearch('');
      setCopiedLiqDetailSummary(false);
      setIsLoadingLiqDetail(true);

      try {
        const res = await fetch(
          `/api/reconciliation/liquidations/items?liquidacionId=${encodeURIComponent(
            liq.id
          )}`,
          { cache: 'no-store', credentials: 'same-origin' }
        );
        const data = (await res.json()) as {
          ok: boolean;
          items?: PendingPaymentOrder[];
          summary?: {
            totalCount: number;
            portalCount: number;
            directCount: number;
            totalBruto: number;
            totalComision: number;
            totalNeto: number;
          };
          error?: string;
        };
        if (!res.ok || !data.ok) {
          throw new Error(
            data.error ?? 'No se pudo cargar el historial del ciclo liquidado.'
          );
        }
        setLiqDetailItems(data.items ?? []);
        setLiqDetailSummary(data.summary ?? null);
      } catch (err: unknown) {
        setLiqDetailError(
          err instanceof Error
            ? err.message
            : 'Error cargando pagos archivados del ciclo.'
        );
      } finally {
        setIsLoadingLiqDetail(false);
      }
    },
    []
  );

  const applySelectedAccount = useCallback((acc: AssignedReceivingAccount) => {
    setSelectedAccountId(acc.id);
    setPlataforma(acc.plataforma);
    setMoneda(acc.moneda);
  }, []);

  const loadSessionById = useCallback(
    async (_clienteId?: string) => {
      void _clienteId;
      setIsRefreshing(true);
      try {
        const response = await fetch('/api/portal/auth', {
          cache: 'no-store',
          credentials: 'same-origin',
        });
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
          liquidaciones?: ClientLiquidationRecord[];
        };
        if (data.ok && data.client && data.wallet) {
          setClient(data.client);
          setWallet(data.wallet);
          setOrders(data.orders ?? []);
          setLiquidations(data.liquidaciones ?? []);
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
    void loadSessionById();
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
      const requestInit: RequestInit = {
        method: 'POST',
        credentials: 'same-origin',
        cache: 'no-store',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          action: 'LOGIN',
          email: emailValue,
          pin: pinValue,
        }),
      };

      let response: Response;
      try {
        response = await fetch('/api/portal/auth', requestInit);
      } catch {
        // Reintento automático ante corte momentáneo de red o reconexión del servidor
        await new Promise((resolve) => window.setTimeout(resolve, 700));
        response = await fetch('/api/portal/auth', requestInit);
      }

      const rawText = await response.text();
      let data: {
        ok: boolean;
        mode?: 'POSTGRESQL_LIVE' | 'DEMO_FALLBACK';
        client?: ClientAccountRecord;
        wallet?: ClientPortalWalletSummary;
        orders?: PendingPaymentOrder[];
        liquidaciones?: ClientLiquidationRecord[];
        error?: string;
      };
      try {
        data = JSON.parse(rawText);
      } catch {
        throw new Error(
          response.status >= 500
            ? 'El servidor está reiniciando o temporalmente ocupado. Intenta nuevamente en unos segundos.'
            : 'Respuesta inesperada del servidor al iniciar sesión.'
        );
      }

      if (!response.ok || !data.ok || !data.client || !data.wallet) {
        throw new Error(data.error ?? 'Error al iniciar sesión.');
      }

      window.localStorage.setItem(STORAGE_CLIENT_KEY, data.client.id);
      setClient(data.client);
      setWallet(data.wallet);
      setOrders(data.orders ?? []);
      setLiquidations(data.liquidaciones ?? []);
      setRemitente('');
      const assigned = data.client.cuentas_asignadas ?? [];
      if (assigned[0]) {
        applySelectedAccount(assigned[0]);
      } else {
        setSelectedAccountId('');
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Error de autenticación.';
      const isNetworkError =
        msg.toLowerCase().includes('failed to fetch') ||
        msg.toLowerCase().includes('networkerror') ||
        msg.toLowerCase().includes('load failed');
      setAuthError(
        isNetworkError
          ? 'No se pudo conectar con el servidor. Recarga la página o intenta nuevamente en unos segundos.'
          : msg
      );
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
    void fetch('/api/portal/auth', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'LOGOUT' }),
    }).catch(() => undefined);
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
        const scanRequestInit: RequestInit = {
          method: 'POST',
          credentials: 'same-origin',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            comprobante_base64: base64Image,
            cuentasAsignadas: client?.cuentas_asignadas ?? [],
          }),
        };

        let response: Response;
        try {
          response = await fetch('/api/portal/scan-receipt', scanRequestInit);
        } catch {
          // Reintento automático ante corte momentáneo de señal móvil en Safari/iOS ("Load failed")
          await new Promise((resolve) => window.setTimeout(resolve, 800));
          response = await fetch('/api/portal/scan-receipt', scanRequestInit);
        }

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
          } else {
            setReferencia('');
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
      if (!file.type.startsWith('image/')) {
        setReportFeedback({
          type: 'error',
          title: 'Archivo inválido (Captura obligatoria)',
          detail: 'Debes subir un archivo de imagen válido (PNG, JPG o WEBP) con la captura del comprobante.',
        });
        return;
      }
      try {
        const compressed = await compressImageFileToBase64(file);
        setReceiptBase64(compressed.base64);
        setReceiptMime(compressed.mime);
        setReportFeedback(null);
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

  const handleSubmitPaymentReport = async (
    event: React.FormEvent<HTMLFormElement>
  ): Promise<void> => {
    event.preventDefault();
    if (!client) {
      return;
    }

    if (
      !receiptBase64 ||
      receiptBase64.length < 100 ||
      !receiptBase64.startsWith('data:image/')
    ) {
      setReportFeedback({
        type: 'error',
        title: 'Captura de comprobante obligatoria',
        detail:
          'Es obligatorio subir o pegar la captura de pantalla del comprobante de pago en el Paso 1 antes de enviar el reporte.',
      });
      setShowToast({
        type: 'error',
        title: 'Falta la captura del pago',
        message: 'Debes adjuntar obligatoriamente la imagen del comprobante en el Paso 1.',
      });
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
    setRemitenteMismatchError(null);

    try {
      const response = await fetch('/api/portal/report-payment', {
        method: 'POST',
        credentials: 'same-origin',
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
        code?: string;
        similarityPercent?: number;
        instantReconciled?: boolean;
        order?: PendingPaymentOrder;
        reconciledTransaction?: FinancialTransactionRecord | null;
        nameMatchPercent?: number | null;
        wallet?: ClientPortalWalletSummary;
        error?: string;
      };

      if (!response.ok || !data.ok || !data.order) {
        if (data.code === 'NAME_MISMATCH') {
          const mismatchMsg =
            data.error ??
            'El nombre del remitente no coincide con el correo bancario recibido. Corrígelo y vuelve a enviar.';
          setRemitenteMismatchError(mismatchMsg);
          setReportFeedback({
            type: 'error',
            title: `Nombre del remitente no coincide (${data.similarityPercent ?? 0}%)`,
            detail: mismatchMsg,
          });
          setShowToast({
            type: 'error',
            title: 'Corrige el nombre del remitente',
            message: mismatchMsg,
          });
          return;
        }
        throw new Error(data.error ?? 'No se pudo enviar el reporte de pago.');
      }

      setOrders((prev) => [data.order as PendingPaymentOrder, ...prev]);
      if (data.wallet) {
        setWallet(data.wallet);
      }

      if (data.instantReconciled && data.reconciledTransaction) {
        const tx = data.reconciledTransaction;
        const pctNote =
          typeof data.nameMatchPercent === 'number'
            ? ` Coincidencia de nombre verificada: ${data.nameMatchPercent}%.`
            : '';
        setReportFeedback({
          type: 'instant',
          title: '¡Pago Conciliado y Acreditado Instantáneamente!',
          detail: `Tu reporte ${data.order.codigo_orden} coincidió de inmediato con el movimiento confirmado en ${tx.plataforma}. Acreditado: ${formatAmount(
            tx.monto_neto,
            tx.moneda
          )} netos (Comisión ${tx.porcentaje_comision}%).${pctNote}`,
        });
        setShowToast({
          type: 'instant',
          title: '¡Pago Conciliado Instantáneamente!',
          message: `Reporte ${data.order.codigo_orden} acreditado a tu saldo disponible.${pctNote}`,
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
      <div className="flex min-h-screen items-center justify-center bg-[#FAF9F6] text-stone-600 dark:bg-[#121110] dark:text-stone-400">
        <div className="flex items-center gap-3 text-sm font-medium">
          <Loader2 className="h-4 w-4 animate-spin text-stone-500" strokeWidth={1.5} />
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
    <div className="min-h-screen bg-[#FAF9F6] text-stone-900 dark:bg-[#121110] dark:text-stone-100">
      <div className="mx-auto max-w-5xl px-4 py-6 sm:px-6 lg:py-8">
        {/* Cabecera Editorial del Portal */}
        <header className="mb-6 flex flex-wrap items-center justify-between gap-3 border-b border-stone-200 pb-5 dark:border-stone-800">
          <div>
            <p className="text-[11px] font-medium uppercase tracking-widest text-amber-700 dark:text-amber-500">
              ConciliarCuenta · Portal de Clientes
            </p>
            <h1 className="mt-1 font-serif text-2xl font-medium tracking-tight text-stone-900 sm:text-3xl dark:text-stone-100">
              Libreta Digital de Pagos
            </h1>
            <p className="mt-0.5 text-xs text-stone-500 sm:text-sm dark:text-stone-400">
              Reporta tus comprobantes Zelle y Binance para conciliación automática y consulta tu saldo neto.
            </p>
          </div>

          <div className="flex items-center gap-2">
            <ThemeToggle />
            {client && (
              <button
                type="button"
                onClick={handleLogout}
                className="inline-flex items-center gap-1.5 rounded-lg border border-rose-700/25 bg-rose-50 px-3 py-2 text-xs font-medium text-rose-700 transition hover:bg-rose-100 dark:border-rose-500/35 dark:bg-rose-950/40 dark:text-rose-400 dark:hover:bg-rose-950/70"
              >
                <LogOut className="h-3.5 w-3.5" strokeWidth={1.5} />
                Salir
              </button>
            )}
          </div>
        </header>

        {/* =====================================================================
            PASO 1: INICIO DE SESIÓN CON CORREO Y PIN ASIGNADO
           ===================================================================== */}
        {!client && (
          <div className="mx-auto my-8 max-w-md rounded-xl border border-stone-200/90 bg-white p-6 shadow-sm sm:p-8 dark:border-stone-800 dark:bg-[#1C1A18]">
            <div className="mb-6 border-b border-stone-200 pb-4 dark:border-stone-800">
              <p className="text-[11px] font-medium uppercase tracking-widest text-amber-700 dark:text-amber-500">
                Acceso Privado
              </p>
              <h2 className="mt-1 font-serif text-2xl font-medium tracking-tight text-stone-900 dark:text-stone-100">
                Ingresar a mi Billetera
              </h2>
              <p className="mt-1 text-xs text-stone-500 dark:text-stone-400">
                Usa el correo electrónico y el PIN de acceso asignado por la administración.
              </p>
            </div>

            {authError && (
              <div className="mb-4 rounded-lg border border-rose-700/25 bg-rose-50 px-4 py-3 text-xs text-rose-700 dark:border-rose-500/35 dark:bg-rose-950/40 dark:text-rose-400">
                {authError}
              </div>
            )}

            <form onSubmit={(e) => void handleLoginSubmit(e)} className="space-y-4">
              <div>
                <label className="block text-[11px] font-medium uppercase tracking-wider text-stone-500 dark:text-stone-400">
                  Correo Electrónico Registrado
                </label>
                <input
                  type="email"
                  required
                  value={loginEmail}
                  onChange={(e) => setLoginEmail(e.target.value)}
                  placeholder="cliente@empresa.com"
                  className="mt-1.5 w-full rounded-lg border border-stone-200 bg-[#FAF9F6] px-3.5 py-3 text-sm text-stone-900 placeholder-stone-400 focus:border-amber-700 focus:outline-none dark:border-stone-800 dark:bg-[#121110] dark:text-stone-100 dark:placeholder-stone-500 dark:focus:border-amber-500"
                />
              </div>
              <div>
                <label className="block text-[11px] font-medium uppercase tracking-wider text-stone-500 dark:text-stone-400">
                  PIN de Acceso (4 a 6 dígitos)
                </label>
                <div className="relative mt-1.5">
                  <KeyRound className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-stone-400" strokeWidth={1.5} />
                  <input
                    type="password"
                    inputMode="numeric"
                    pattern="\d{4,6}"
                    maxLength={6}
                    required
                    value={loginPin}
                    onChange={(e) => setLoginPin(e.target.value)}
                    placeholder="••••"
                    className="w-full rounded-lg border border-stone-200 bg-[#FAF9F6] py-3 pl-10 pr-4 font-mono text-base tracking-widest text-stone-900 placeholder-stone-400 focus:border-amber-700 focus:outline-none dark:border-stone-800 dark:bg-[#121110] dark:text-stone-100 dark:placeholder-stone-500 dark:focus:border-amber-500"
                  />
                </div>
              </div>

              <button
                type="submit"
                disabled={isAuthSubmitting}
                className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-stone-900 px-5 py-3 text-sm font-medium text-stone-50 shadow-sm transition hover:bg-stone-800 disabled:opacity-60 dark:bg-stone-100 dark:text-stone-950 dark:hover:bg-white"
              >
                {isAuthSubmitting ? (
                  <Loader2 className="h-4 w-4 animate-spin" strokeWidth={1.5} />
                ) : (
                  <Wallet className="h-4 w-4" strokeWidth={1.5} />
                )}
                Entrar a mi Billetera
              </button>

              <p className="rounded-lg border border-stone-200/80 bg-[#FAF9F6] px-3.5 py-2.5 text-center text-[11px] leading-relaxed text-stone-500 dark:border-stone-800 dark:bg-[#121110] dark:text-stone-400">
                Las cuentas de acceso se crean y gestionan exclusivamente desde el Panel Principal por el administrador.
              </p>
            </form>
          </div>
        )}

        {/* =====================================================================
            PASO 2 Y 3: LIBRETA DIGITAL (BILLETERA) + FORMULARIO REPORTAR PAGO
           ===================================================================== */}
        {client && wallet && (
          <div className="space-y-6">
            {/* Cabecera tipo Libreta Digital */}
            <section className="overflow-hidden rounded-xl border border-stone-200/90 bg-white shadow-sm dark:border-stone-800 dark:bg-[#1C1A18]">
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-stone-200 px-5 py-4 dark:border-stone-800">
                <div>
                  <p className="text-[11px] font-medium uppercase tracking-wider text-stone-500 dark:text-stone-400">
                    Titular de Libreta · Ciclo #{liquidations.length + 1} Activo
                  </p>
                  <h2 className="mt-0.5 font-serif text-xl font-medium tracking-tight text-stone-900 sm:text-2xl dark:text-stone-100">
                    {client.nombre_titular}
                  </h2>
                  <p className="mt-0.5 font-mono text-xs tabular-nums text-stone-500 dark:text-stone-400">
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
                  className="inline-flex items-center gap-2 rounded-lg border border-stone-200 bg-[#FAF9F6] px-3.5 py-2 text-xs font-medium text-stone-700 transition hover:border-stone-300 hover:bg-stone-100 disabled:opacity-60 dark:border-stone-800 dark:bg-[#121110] dark:text-stone-200 dark:hover:bg-stone-900"
                >
                  <RefreshCw
                    className={`h-3.5 w-3.5 text-stone-400 ${isRefreshing ? 'animate-spin' : ''}`}
                    strokeWidth={1.5}
                  />
                  Actualizar Saldo
                </button>
              </div>

              {/* Saldos Hero + Cuentas Asignadas */}
              <div
                className={`grid grid-cols-1 divide-y divide-stone-200 dark:divide-stone-800 ${
                  hasUsdAccount && hasUsdtAccount
                    ? 'sm:grid-cols-2 sm:divide-x sm:divide-y-0'
                    : 'lg:grid-cols-2 lg:divide-x lg:divide-y-0'
                }`}
              >
                {hasUsdAccount && (
                  <div className="p-5 sm:p-6">
                    <div className="flex items-center justify-between">
                      <span className="text-[11px] font-medium uppercase tracking-wider text-stone-500 dark:text-stone-400">
                        Saldo Pendiente USD
                      </span>
                      <DollarSign className="h-4 w-4 text-stone-400 dark:text-stone-500" strokeWidth={1.5} />
                    </div>
                    <p
                      className={`mt-2 font-serif text-3xl font-medium tracking-tight tabular-nums sm:text-4xl ${
                        wallet.saldoNetoUsd < 0
                          ? 'text-rose-700 dark:text-rose-400'
                          : wallet.saldoNetoUsd > 0
                            ? 'text-emerald-700 dark:text-emerald-400'
                            : 'text-stone-900 dark:text-stone-100'
                      }`}
                    >
                      {formatAmount(wallet.saldoNetoUsd, 'USD')}
                    </p>
                    {wallet.saldoNetoUsd < 0 && (
                      <p className="mt-1 text-xs font-medium text-rose-700 dark:text-rose-400">
                        Saldo en contra por adelanto de liquidación (se descontará de tus próximos pagos).
                      </p>
                    )}
                    <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 font-mono text-xs tabular-nums text-stone-500 dark:text-stone-400">
                      <span>
                        Acreditado:{' '}
                        <strong className="text-stone-900 dark:text-stone-100">
                          {formatAmount(
                            wallet.totalAcreditadoUsd ??
                              wallet.saldoNetoUsd + (wallet.totalLiquidadoUsd ?? 0),
                            'USD'
                          )}
                        </strong>
                      </span>
                      {(wallet.totalLiquidadoUsd ?? 0) > 0 && (
                        <span>
                          Liquidado:{' '}
                          <strong className="text-rose-700 dark:text-rose-400">
                            -{formatAmount(wallet.totalLiquidadoUsd ?? 0, 'USD')}
                          </strong>
                        </span>
                      )}
                      <span>Comisión: -{formatAmount(wallet.totalComisionUsd, 'USD')}</span>
                    </div>
                  </div>
                )}

                {hasUsdtAccount && (
                  <div className="p-5 sm:p-6">
                    <div className="flex items-center justify-between">
                      <span className="text-[11px] font-medium uppercase tracking-wider text-stone-500 dark:text-stone-400">
                        Saldo Pendiente USDT
                      </span>
                      <Coins className="h-4 w-4 text-stone-400 dark:text-stone-500" strokeWidth={1.5} />
                    </div>
                    <p
                      className={`mt-2 font-serif text-3xl font-medium tracking-tight tabular-nums sm:text-4xl ${
                        wallet.saldoNetoUsdt < 0
                          ? 'text-rose-700 dark:text-rose-400'
                          : wallet.saldoNetoUsdt > 0
                            ? 'text-emerald-700 dark:text-emerald-400'
                            : 'text-stone-900 dark:text-stone-100'
                      }`}
                    >
                      {formatAmount(wallet.saldoNetoUsdt, 'USDT')}
                    </p>
                    <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 font-mono text-xs tabular-nums text-stone-500 dark:text-stone-400">
                      <span>
                        Acreditado:{' '}
                        <strong className="text-stone-900 dark:text-stone-100">
                          {formatAmount(
                            wallet.totalAcreditadoUsdt ??
                              wallet.saldoNetoUsdt + (wallet.totalLiquidadoUsdt ?? 0),
                            'USDT'
                          )}
                        </strong>
                      </span>
                      {(wallet.totalLiquidadoUsdt ?? 0) > 0 && (
                        <span>
                          Liquidado:{' '}
                          <strong className="text-rose-700 dark:text-rose-400">
                            -{formatAmount(wallet.totalLiquidadoUsdt ?? 0, 'USDT')}
                          </strong>
                        </span>
                      )}
                      <span>Comisión: -{formatAmount(wallet.totalComisionUsdt, 'USDT')}</span>
                    </div>
                  </div>
                )}

                {/* Cuentas Asignadas para Enviar Pagos */}
                <div
                  className={`p-5 sm:p-6 ${
                    hasUsdAccount && hasUsdtAccount
                      ? 'border-t border-stone-200 sm:col-span-2 dark:border-stone-800'
                      : ''
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] font-medium uppercase tracking-wider text-stone-500 dark:text-stone-400">
                      Cuentas Asignadas para Enviar ({assignedAccounts.length})
                    </span>
                    <Building2 className="h-4 w-4 text-stone-400 dark:text-stone-500" strokeWidth={1.5} />
                  </div>

                  {assignedAccounts.length === 0 ? (
                    <p className="mt-3 text-xs text-amber-700 dark:text-amber-400">
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
                            className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-stone-200/80 bg-[#FAF9F6] px-3.5 py-2.5 dark:border-stone-800 dark:bg-[#121110]"
                          >
                            <div className="min-w-0">
                              <div className="flex flex-wrap items-center gap-1.5">
                                <span
                                  className={`inline-flex rounded border px-1.5 py-0.5 text-[10px] font-medium ${meta.accentClass}`}
                                >
                                  {meta.label}
                                </span>
                                <span className="rounded bg-stone-200/80 px-1.5 py-0.5 font-mono text-[10px] font-medium text-stone-700 dark:bg-stone-800 dark:text-stone-300">
                                  {acc.moneda}
                                </span>
                              </div>
                              <div className="mt-1 text-xs text-stone-500 dark:text-stone-400">
                                Enviar a:{' '}
                                <span className="break-all font-mono font-semibold text-stone-900 dark:text-stone-100">
                                  {acc.cuenta_receptora}
                                </span>
                              </div>
                            </div>
                            <button
                              type="button"
                              onClick={() => void handleCopyReceivingAccount(acc)}
                              className="inline-flex items-center gap-1 rounded-md border border-stone-200 bg-white px-2.5 py-1.5 text-[11px] font-medium text-stone-700 transition hover:bg-stone-100 dark:border-stone-800 dark:bg-[#1C1A18] dark:text-stone-200"
                            >
                              {isCopied ? (
                                <>
                                  <Check className="h-3.5 w-3.5 text-emerald-700 dark:text-emerald-400" strokeWidth={1.5} />
                                  Copiada
                                </>
                              ) : (
                                <>
                                  <Copy className="h-3.5 w-3.5 text-stone-400" strokeWidth={1.5} />
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
              </div>
            </section>

            {/* Feedback inmediato del reporte */}
            {reportFeedback && (
              <div
                className={`rounded-xl border p-4 shadow-sm transition-all ${
                  reportFeedback.type === 'instant'
                    ? 'border-emerald-700/25 bg-emerald-50 text-emerald-900 dark:border-emerald-500/35 dark:bg-emerald-950/40 dark:text-emerald-200'
                    : reportFeedback.type === 'pending'
                      ? 'border-amber-700/25 bg-amber-50 text-amber-900 dark:border-amber-500/35 dark:bg-amber-950/40 dark:text-amber-200'
                      : 'border-rose-700/25 bg-rose-50 text-rose-900 dark:border-rose-500/35 dark:bg-rose-950/40 dark:text-rose-200'
                }`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-start gap-3">
                    {reportFeedback.type === 'instant' ? (
                      <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-700 dark:text-emerald-400" strokeWidth={1.5} />
                    ) : reportFeedback.type === 'pending' ? (
                      <Clock className="mt-0.5 h-5 w-5 shrink-0 text-amber-700 dark:text-amber-400" strokeWidth={1.5} />
                    ) : (
                      <X className="mt-0.5 h-5 w-5 shrink-0 text-rose-700 dark:text-rose-400" strokeWidth={1.5} />
                    )}
                    <div>
                      <h3 className="text-sm font-semibold">{reportFeedback.title}</h3>
                      <p className="mt-1 whitespace-pre-line text-xs leading-relaxed opacity-90">
                        {reportFeedback.detail}
                      </p>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => setReportFeedback(null)}
                    className="rounded p-1 opacity-70 hover:opacity-100"
                  >
                    <X className="h-4 w-4" strokeWidth={1.5} />
                  </button>
                </div>
              </div>
            )}

            {/* Grid Principal: Formulario Reportar Pago + Historial Reciente */}
            <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
              {/* Formulario "Reportar Pago" */}
              <section className="rounded-xl border border-stone-200/90 bg-white p-5 shadow-sm lg:col-span-7 dark:border-stone-800 dark:bg-[#1C1A18]">
                <div className="mb-4 flex items-center justify-between border-b border-stone-200 pb-3 dark:border-stone-800">
                  <div className="flex items-center gap-2">
                    <Send className="h-4 w-4 text-stone-400 dark:text-stone-500" strokeWidth={1.5} />
                    <h3 className="font-serif text-lg font-medium tracking-tight text-stone-900 dark:text-stone-100">
                      Reportar Nuevo Pago
                    </h3>
                  </div>
                  <span className="inline-flex items-center gap-1 rounded-full border border-amber-700/25 bg-amber-50 px-2.5 py-0.5 text-[11px] font-medium text-amber-800 dark:border-amber-500/35 dark:bg-amber-950/40 dark:text-amber-400">
                    Captura Obligatoria
                  </span>
                </div>

                <form
                  onSubmit={(e) => void handleSubmitPaymentReport(e)}
                  className="space-y-5"
                >
                  {/* ===================================================================
                      PASO 1: ZONA DE CARGA IA OCR (PRIMERO)
                     =================================================================== */}
                  <div className="rounded-xl border border-stone-200 bg-[#FAF9F6] p-4 dark:border-stone-800 dark:bg-[#121110]">
                    <div className="flex flex-wrap items-center justify-between gap-2 pb-3">
                      <div className="flex items-center gap-2">
                        <span className="flex h-6 w-6 items-center justify-center rounded-full bg-stone-900 font-mono text-xs font-semibold text-stone-50 dark:bg-stone-100 dark:text-stone-950">
                          1
                        </span>
                        <label className="text-xs font-semibold uppercase tracking-wider text-stone-800 dark:text-stone-200">
                          Sube la Captura o Comprobante *
                        </label>
                      </div>
                      <span className="inline-flex items-center gap-1 rounded-full border border-stone-200 bg-white px-2.5 py-0.5 text-[11px] font-medium text-stone-600 dark:border-stone-800 dark:bg-[#1C1A18] dark:text-stone-400">
                        <Sparkles className="h-3 w-3 text-amber-700 dark:text-amber-500" strokeWidth={1.5} />
                        IA OCR Activa
                      </span>
                    </div>

                    {/* Dropzone / Scanner */}
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
                          ? 'border-amber-700 bg-amber-50/40 dark:border-amber-500 dark:bg-amber-950/20'
                          : isDragging
                            ? 'border-amber-700 bg-amber-50/50 dark:border-amber-500 dark:bg-amber-950/25'
                            : receiptBase64
                              ? 'border-stone-200 bg-white dark:border-stone-800 dark:bg-[#1C1A18]'
                              : 'border-dashed border-stone-300 bg-white hover:border-amber-700/60 dark:border-stone-700 dark:bg-[#1C1A18] dark:hover:border-amber-500/60'
                      }`}
                    >
                      {/* Estado 1: Escaneando con IA */}
                      {isScanningAi && (
                        <div className="flex flex-col items-center justify-center px-4 py-8 text-center">
                          <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-xl border border-amber-700/25 bg-amber-50 text-amber-700 dark:border-amber-500/35 dark:bg-amber-950/40 dark:text-amber-400">
                            <Bot className="h-6 w-6" strokeWidth={1.5} />
                          </div>
                          <h4 className="font-serif text-base font-medium text-stone-900 dark:text-stone-100">
                            Escaneando comprobante con Inteligencia Artificial...
                          </h4>
                          <p className="mt-1 max-w-md text-xs text-stone-500 dark:text-stone-400">
                            Analizando banco, monto exacto, moneda y código de confirmación para autocompletar el formulario.
                          </p>
                          <div className="mt-4 flex items-center gap-2 text-xs font-medium text-amber-700 dark:text-amber-400">
                            <Loader2 className="h-4 w-4 animate-spin" strokeWidth={1.5} />
                            Extrayendo datos ópticos estructurados...
                          </div>
                        </div>
                      )}

                      {/* Estado 2: Imagen ya cargada */}
                      {!isScanningAi && receiptBase64 && (
                        <div className="p-3.5">
                          <div className="flex flex-col items-center gap-4 sm:flex-row sm:items-start sm:text-left">
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img
                              src={receiptBase64}
                              alt="Comprobante cargado"
                              className="h-28 w-24 shrink-0 rounded-lg border border-stone-200 object-cover dark:border-stone-800"
                            />
                            <div className="flex-1 space-y-2 text-left">
                              {aiScanSuccess ? (
                                <div className="rounded-lg border border-emerald-700/20 bg-emerald-50 p-2.5 dark:border-emerald-500/30 dark:bg-emerald-950/35">
                                  <div className="flex items-center gap-1.5 text-xs font-semibold text-emerald-800 dark:text-emerald-300">
                                    <Sparkles className="h-3.5 w-3.5" strokeWidth={1.5} />
                                    Comprobante Identificado con IA
                                    {aiScanDetails?.confianza ? (
                                      <span className="ml-auto rounded bg-white/80 px-1.5 py-0.5 font-mono text-[10px] tabular-nums text-emerald-700 dark:bg-stone-900 dark:text-emerald-400">
                                        {aiScanDetails.confianza}%
                                      </span>
                                    ) : null}
                                  </div>
                                  <p className="mt-1 text-[11px] leading-relaxed text-stone-700 dark:text-stone-300">
                                    {aiScanDetails?.observaciones ||
                                      'Los datos fueron extraídos y los campos de abajo se completaron automáticamente. Revisa y confirma antes de enviar.'}
                                  </p>
                                </div>
                              ) : (
                                <div>
                                  <p className="text-xs font-semibold text-stone-900 dark:text-stone-100">
                                    Captura lista y optimizada ({receiptMime})
                                  </p>
                                  <p className="mt-0.5 text-[11px] text-stone-500 dark:text-stone-400">
                                    {aiScanMessage ||
                                      'Por favor completa o confirma los datos en el formulario a continuación.'}
                                  </p>
                                </div>
                              )}

                              <div className="flex flex-wrap items-center gap-2 pt-1">
                                <label className="cursor-pointer rounded-lg border border-stone-200 bg-[#FAF9F6] px-3 py-1.5 text-xs font-medium text-stone-700 hover:bg-stone-100 dark:border-stone-800 dark:bg-[#121110] dark:text-stone-200">
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
                                  className="inline-flex items-center gap-1.5 rounded-lg border border-stone-200 bg-[#FAF9F6] px-3 py-1.5 text-xs font-medium text-stone-700 hover:bg-stone-100 dark:border-stone-800 dark:bg-[#121110] dark:text-stone-200"
                                >
                                  <ScanLine className="h-3.5 w-3.5 text-stone-400" strokeWidth={1.5} />
                                  Re-escanear
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
                                  className="rounded-lg border border-rose-700/25 bg-rose-50 px-2.5 py-1.5 text-xs font-medium text-rose-700 hover:bg-rose-100 dark:border-rose-500/35 dark:bg-rose-950/40 dark:text-rose-400"
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
                        <label className="flex cursor-pointer flex-col items-center justify-center p-6 text-center transition hover:bg-[#FAF9F6]/80 dark:hover:bg-stone-900/40">
                          <div className="flex h-11 w-11 items-center justify-center rounded-xl border border-stone-200 bg-[#FAF9F6] text-stone-500 dark:border-stone-800 dark:bg-[#121110] dark:text-stone-400">
                            <UploadCloud className="h-5 w-5" strokeWidth={1.5} />
                          </div>
                          <span className="mt-2.5 text-xs font-semibold text-stone-900 dark:text-stone-100">
                            Toca para subir o arrastra la captura de tu teléfono
                          </span>
                          <span className="mt-1 text-[11px] text-stone-500 dark:text-stone-400">
                            PNG, JPG o WEBP · También puedes pegar directamente con{' '}
                            <strong className="font-mono text-stone-700 dark:text-stone-300">Ctrl + V</strong>
                          </span>
                          <span className="mt-2 inline-flex items-center gap-1 rounded-full border border-stone-200 bg-[#FAF9F6] px-2.5 py-0.5 text-[10px] font-medium text-stone-600 dark:border-stone-800 dark:bg-[#121110] dark:text-stone-400">
                            <Sparkles className="h-3 w-3 text-amber-700 dark:text-amber-500" strokeWidth={1.5} />
                            La IA leerá los datos y completará el formulario automáticamente
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
                      PASO 2: REVISA Y CONFIRMA LOS DATOS
                     =================================================================== */}
                  <div className="space-y-4 pt-1">
                    <div className="flex items-center justify-between border-b border-stone-200 pb-2 dark:border-stone-800">
                      <div className="flex items-center gap-2">
                        <span className="flex h-6 w-6 items-center justify-center rounded-full border border-stone-300 font-mono text-xs font-semibold text-stone-700 dark:border-stone-700 dark:text-stone-300">
                          2
                        </span>
                        <h4 className="text-xs font-semibold uppercase tracking-wider text-stone-800 dark:text-stone-200">
                          Revisa y Confirma los Datos del Pago
                        </h4>
                      </div>
                      <span className="text-[11px] text-stone-500 dark:text-stone-400">
                        Editables
                      </span>
                    </div>

                    {/* Selector de Cuentas Asignadas */}
                    <div>
                      <div className="flex items-center justify-between">
                        <label className="block text-[11px] font-medium uppercase tracking-wider text-stone-500 dark:text-stone-400">
                          Cuenta Asignada donde enviaste el pago *
                        </label>
                        {aiDetectedFields.cuenta && (
                          <span className="inline-flex items-center gap-1 text-[10px] font-medium text-emerald-700 dark:text-emerald-400">
                            <Sparkles className="h-3 w-3" strokeWidth={1.5} />
                            Detectada por IA
                          </span>
                        )}
                      </div>

                      {assignedAccounts.length === 0 ? (
                        <div className="mt-2 rounded-lg border border-amber-700/25 bg-amber-50 p-3.5 text-xs text-amber-800 dark:border-amber-500/35 dark:bg-amber-950/35 dark:text-amber-300">
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
                                    ? 'border-amber-700 bg-amber-50/50 ring-1 ring-amber-700/40 dark:border-amber-500 dark:bg-amber-950/25 dark:ring-amber-500/40'
                                    : 'border-stone-200 bg-[#FAF9F6] text-stone-700 hover:border-stone-300 dark:border-stone-800 dark:bg-[#121110] dark:text-stone-300'
                                }`}
                              >
                                <div className="flex items-center justify-between gap-2">
                                  <span className="text-xs font-semibold text-stone-900 dark:text-stone-100">
                                    {acc.alias || meta.label}
                                  </span>
                                  <span className="rounded bg-stone-200/80 px-1.5 py-0.5 font-mono text-[10px] font-medium text-stone-700 dark:bg-stone-800 dark:text-stone-300">
                                    {acc.moneda}
                                  </span>
                                </div>
                                <div className="mt-1.5 text-[10px] uppercase tracking-wider text-stone-400">
                                  Enviar a
                                </div>
                                <div className="mt-0.5 break-all font-mono text-xs font-medium text-stone-800 dark:text-stone-200">
                                  {acc.cuenta_receptora}
                                </div>
                              </button>
                            );
                          })}
                        </div>
                      )}

                      {selectedAccount && (
                        <div className="mt-2 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-stone-200 bg-[#FAF9F6] px-3 py-2 text-xs text-stone-600 dark:border-stone-800 dark:bg-[#121110] dark:text-stone-300">
                          <span>
                            Destino:{' '}
                            <strong className="font-mono text-stone-900 dark:text-stone-100">
                              {selectedAccount.cuenta_receptora}
                            </strong>{' '}
                            · <strong className="font-mono">{selectedAccount.moneda}</strong>
                          </span>
                          <button
                            type="button"
                            onClick={() =>
                              void handleCopyReceivingAccount(selectedAccount)
                            }
                            className="inline-flex items-center gap-1 rounded border border-stone-200 bg-white px-2 py-0.5 text-[11px] font-medium text-stone-700 hover:bg-stone-100 dark:border-stone-800 dark:bg-[#1C1A18] dark:text-stone-200"
                          >
                            {copiedAccountId === selectedAccount.id ? (
                              <>
                                <Check className="h-3 w-3 text-emerald-700 dark:text-emerald-400" strokeWidth={1.5} />
                                Copiada
                              </>
                            ) : (
                              <>
                                <Copy className="h-3 w-3 text-stone-400" strokeWidth={1.5} />
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
                          <label className="block text-[11px] font-medium uppercase tracking-wider text-stone-500 dark:text-stone-400">
                            Monto Exacto ({moneda}) *
                          </label>
                          {aiDetectedFields.monto && (
                            <span className="inline-flex items-center gap-1 text-[10px] font-medium text-emerald-700 dark:text-emerald-400">
                              <Sparkles className="h-3 w-3" strokeWidth={1.5} />
                              IA
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
                          className={`mt-1.5 w-full rounded-lg border bg-[#FAF9F6] px-3.5 py-2.5 font-mono text-base font-semibold tabular-nums text-stone-900 transition focus:outline-none dark:bg-[#121110] dark:text-stone-100 ${
                            aiDetectedFields.monto
                              ? 'border-emerald-700/50 focus:border-emerald-700 dark:border-emerald-500/60'
                              : 'border-stone-200 focus:border-amber-700 dark:border-stone-800 dark:focus:border-amber-500'
                          }`}
                        />
                      </div>
                      <div className="sm:col-span-3">
                        <label className="block text-[11px] font-medium uppercase tracking-wider text-stone-500 dark:text-stone-400">
                          Moneda
                        </label>
                        <select
                          value={moneda}
                          disabled={Boolean(selectedAccount)}
                          onChange={(e) => setMoneda(e.target.value as CurrencyType)}
                          className="mt-1.5 w-full rounded-lg border border-stone-200 bg-[#FAF9F6] px-3 py-2.5 font-mono text-sm text-stone-900 focus:border-amber-700 focus:outline-none disabled:cursor-not-allowed disabled:opacity-70 dark:border-stone-800 dark:bg-[#121110] dark:text-stone-100"
                        >
                          <option value="USD">USD</option>
                          <option value="USDT">USDT</option>
                          <option value="VES">VES</option>
                        </select>
                      </div>
                      <div className="sm:col-span-4">
                        <div className="flex items-center justify-between">
                          <label className="block text-[11px] font-medium uppercase tracking-wider text-stone-500 dark:text-stone-400">
                            Fecha Transferencia *
                          </label>
                          {aiDetectedFields.fecha && (
                            <span className="inline-flex items-center gap-1 text-[10px] font-medium text-emerald-700 dark:text-emerald-400">
                              <Sparkles className="h-3 w-3" strokeWidth={1.5} />
                              IA
                            </span>
                          )}
                        </div>
                        <input
                          type="date"
                          required
                          value={fechaTransferencia}
                          onChange={(e) => setFechaTransferencia(e.target.value)}
                          className={`mt-1.5 w-full rounded-lg border bg-[#FAF9F6] px-3 py-2.5 font-mono text-sm text-stone-900 transition focus:outline-none dark:bg-[#121110] dark:text-stone-100 ${
                            aiDetectedFields.fecha
                              ? 'border-emerald-700/50 focus:border-emerald-700 dark:border-emerald-500/60'
                              : 'border-stone-200 focus:border-amber-700 dark:border-stone-800 dark:focus:border-amber-500'
                          }`}
                        />
                      </div>
                    </div>

                    {/* Remitente y Referencia */}
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                      <div>
                        <div className="flex items-center justify-between">
                          <label className="block text-[11px] font-medium uppercase tracking-wider text-stone-500 dark:text-stone-400">
                            Nombre del Remitente *
                          </label>
                          <span className="rounded border border-amber-700/25 bg-amber-50 px-1.5 py-0.5 text-[10px] font-medium text-amber-800 dark:border-amber-500/35 dark:bg-amber-950/40 dark:text-amber-400">
                            Manual
                          </span>
                        </div>
                        <input
                          type="text"
                          required
                          value={remitente}
                          onChange={(e) => {
                            setRemitente(e.target.value);
                            if (remitenteMismatchError) {
                              setRemitenteMismatchError(null);
                            }
                          }}
                          placeholder={
                            plataforma.startsWith('BINANCE')
                              ? 'Nickname o Pay ID de quien envió'
                              : 'Nombre de la persona que envió el pago'
                          }
                          className={`mt-1.5 w-full rounded-lg border bg-[#FAF9F6] px-3.5 py-2.5 text-sm text-stone-900 placeholder-stone-400 transition focus:outline-none dark:bg-[#121110] dark:text-stone-100 dark:placeholder-stone-500 ${
                            remitenteMismatchError
                              ? 'border-rose-700 ring-1 ring-rose-700/30 dark:border-rose-500'
                              : 'border-stone-200 focus:border-amber-700 dark:border-stone-800 dark:focus:border-amber-500'
                          }`}
                        />
                        {remitenteMismatchError ? (
                          <p className="mt-1.5 rounded-lg border border-rose-700/25 bg-rose-50 px-2.5 py-1.5 text-[11px] font-medium text-rose-700 dark:border-rose-500/35 dark:bg-rose-950/40 dark:text-rose-400">
                            {remitenteMismatchError}
                          </p>
                        ) : (
                          <p className="mt-1 text-[11px] text-stone-500 dark:text-stone-400">
                            Escribe manualmente el nombre o titular de la cuenta que te transfirió.
                          </p>
                        )}
                      </div>
                      <div>
                        <div className="flex items-center justify-between">
                          <label className="block text-[11px] font-medium uppercase tracking-wider text-stone-500 dark:text-stone-400">
                            Referencia / Order ID / TxID
                            {plataforma.startsWith('BINANCE') ? (
                              <span className="font-bold text-amber-700 dark:text-amber-500"> *</span>
                            ) : (
                              <span className="ml-1 font-normal normal-case text-stone-400">
                                (opcional si no aparece)
                              </span>
                            )}
                          </label>
                          {aiDetectedFields.referencia && (
                            <span className="inline-flex items-center gap-1 text-[10px] font-medium text-emerald-700 dark:text-emerald-400">
                              <Sparkles className="h-3 w-3" strokeWidth={1.5} />
                              IA
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
                              : 'CITI665091200 (o en blanco si no lo muestra)'
                          }
                          className={`mt-1.5 w-full rounded-lg border bg-[#FAF9F6] px-3.5 py-2.5 font-mono text-sm text-stone-900 placeholder-stone-400 transition focus:outline-none dark:bg-[#121110] dark:text-stone-100 dark:placeholder-stone-500 ${
                            aiDetectedFields.referencia
                              ? 'border-emerald-700/50 focus:border-emerald-700 dark:border-emerald-500/60'
                              : 'border-stone-200 focus:border-amber-700 dark:border-stone-800 dark:focus:border-amber-500'
                          }`}
                        />
                        <p className="mt-1 text-[11px] text-stone-500 dark:text-stone-400">
                          {plataforma.startsWith('BINANCE')
                            ? 'Pega el Order ID o TxID de Binance para validación instantánea.'
                            : 'Si tu comprobante no muestra código de confirmación, déjalo en blanco; conciliaremos por Monto y Remitente.'}
                        </p>
                      </div>
                    </div>

                    {/* Notas Adicionales */}
                    <div>
                      <label className="block text-[11px] font-medium uppercase tracking-wider text-stone-500 dark:text-stone-400">
                        Notas Adicionales (Opcional)
                      </label>
                      <input
                        type="text"
                        value={notasCliente}
                        onChange={(e) => setNotasCliente(e.target.value)}
                        placeholder="Ej. Pago de factura #2045 o cuenta de tercero autorizado"
                        className="mt-1.5 w-full rounded-lg border border-stone-200 bg-[#FAF9F6] px-3.5 py-2 text-sm text-stone-900 placeholder-stone-400 focus:border-amber-700 focus:outline-none dark:border-stone-800 dark:bg-[#121110] dark:text-stone-100 dark:placeholder-stone-500"
                      />
                    </div>

                    {/* Alerta visible directamente sobre el botón de envío */}
                    {reportFeedback && (
                      <div
                        className={`rounded-xl border p-3.5 transition-all ${
                          reportFeedback.type === 'instant'
                            ? 'border-emerald-700/25 bg-emerald-50 text-emerald-900 dark:border-emerald-500/35 dark:bg-emerald-950/40 dark:text-emerald-200'
                            : reportFeedback.type === 'pending'
                              ? 'border-amber-700/25 bg-amber-50 text-amber-900 dark:border-amber-500/35 dark:bg-amber-950/40 dark:text-amber-200'
                              : 'border-rose-700/25 bg-rose-50 text-rose-900 dark:border-rose-500/35 dark:bg-rose-950/40 dark:text-rose-200'
                        }`}
                      >
                        <div className="flex items-start justify-between gap-2.5">
                          <div className="flex items-start gap-2.5">
                            {reportFeedback.type === 'instant' ? (
                              <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-700 dark:text-emerald-400" strokeWidth={1.5} />
                            ) : reportFeedback.type === 'pending' ? (
                              <Clock className="mt-0.5 h-5 w-5 shrink-0 text-amber-700 dark:text-amber-400" strokeWidth={1.5} />
                            ) : (
                              <X className="mt-0.5 h-5 w-5 shrink-0 text-rose-700 dark:text-rose-400" strokeWidth={1.5} />
                            )}
                            <div>
                              <h4 className="text-xs font-semibold leading-tight">
                                {reportFeedback.title}
                              </h4>
                              <p className="mt-1 whitespace-pre-line text-xs leading-relaxed opacity-90">
                                {reportFeedback.detail}
                              </p>
                            </div>
                          </div>
                          <button
                            type="button"
                            onClick={() => setReportFeedback(null)}
                            className="rounded p-1 opacity-70 hover:opacity-100"
                          >
                            <X className="h-3.5 w-3.5" strokeWidth={1.5} />
                          </button>
                        </div>
                      </div>
                    )}

                    {!receiptBase64 && (
                      <div className="flex items-center gap-2.5 rounded-lg border border-amber-700/25 bg-amber-50 p-3 text-xs text-amber-900 dark:border-amber-500/35 dark:bg-amber-950/35 dark:text-amber-300">
                        <UploadCloud className="h-4 w-4 shrink-0 text-amber-700 dark:text-amber-400" strokeWidth={1.5} />
                        <span>
                          <strong>Captura obligatoria:</strong> Sube, arrastra o pega la imagen de tu comprobante en el <strong>Paso 1</strong> para enviar el reporte.
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
                      className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-stone-900 px-5 py-3 text-sm font-medium text-stone-50 shadow-sm transition hover:bg-stone-800 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-stone-100 dark:text-stone-950 dark:hover:bg-white"
                    >
                      {isSubmittingReport ? (
                        <>
                          <Loader2 className="h-4 w-4 animate-spin" strokeWidth={1.5} />
                          Enviando y Conciliando Pago...
                        </>
                      ) : isScanningAi ? (
                        <>
                          <Loader2 className="h-4 w-4 animate-spin" strokeWidth={1.5} />
                          Identificando con IA...
                        </>
                      ) : (
                        <>
                          <CheckCircle2 className="h-4 w-4" strokeWidth={1.5} />
                          Confirmar Datos y Conciliar Pago
                        </>
                      )}
                    </button>
                  </div>
                </form>
              </section>

              {/* Historial Reciente del Cliente */}
              <section className="rounded-xl border border-stone-200/90 bg-white p-5 shadow-sm lg:col-span-5 dark:border-stone-800 dark:bg-[#1C1A18]">
                <div className="mb-4 flex flex-wrap items-center justify-between gap-2 border-b border-stone-200 pb-3 dark:border-stone-800">
                  <div className="flex items-center gap-2">
                    <Building2 className="h-4 w-4 text-stone-400 dark:text-stone-500" strokeWidth={1.5} />
                    <h3 className="font-serif text-lg font-medium tracking-tight text-stone-900 dark:text-stone-100">
                      Mis Reportes ({orders.length})
                    </h3>
                    <span className="rounded-full border border-emerald-700/20 bg-emerald-50 px-2 py-0.5 text-[10px] font-medium text-emerald-700 dark:border-emerald-500/30 dark:bg-emerald-950/40 dark:text-emerald-400">
                      Ciclo #{liquidations.length + 1}
                    </span>
                  </div>
                  {orders.length > 50 && (
                    <button
                      type="button"
                      onClick={() => setShowAllRecentCards((prev) => !prev)}
                      className="rounded-md border border-stone-200 bg-[#FAF9F6] px-2.5 py-1 text-[11px] font-medium text-stone-700 hover:bg-stone-100 dark:border-stone-800 dark:bg-[#121110] dark:text-stone-300"
                    >
                      {showAllRecentCards
                        ? `Mostrando ${orders.length} · Ver 50`
                        : `Ver Todos (${orders.length})`}
                    </button>
                  )}
                </div>

                {orders.length === 0 ? (
                  <div className="rounded-lg border border-stone-200 bg-[#FAF9F6] p-6 text-center text-xs text-stone-500 dark:border-stone-800 dark:bg-[#121110] dark:text-stone-400">
                    {liquidations.length > 0 ? (
                      <div className="space-y-1">
                        <p className="font-semibold text-emerald-700 dark:text-emerald-400">
                          Ciclo actual en cero comprobantes
                        </p>
                        <p>
                          Tus capturas anteriores fueron saldadas en tu liquidación más reciente. Los nuevos pagos que reportes iniciarán tu nuevo ciclo.
                        </p>
                      </div>
                    ) : (
                      'Aún no has reportado pagos en el ciclo actual. Usa el formulario para subir tu comprobante.'
                    )}
                  </div>
                ) : (
                  <div className="max-h-[680px] space-y-2.5 overflow-y-auto pr-1">
                    {(showAllRecentCards ? orders : orders.slice(0, 50)).map((order, idx) => {
                      const isConciliado = order.estado === 'CONCILIADO';
                      const isDirectAdmin = order.origen_registro === 'ADMIN_DIRECTA';
                      const feePct = Number(
                        order.tx_porcentaje_comision ??
                          client.porcentaje_comision_zelle ??
                          4
                      );
                      const brutoVal = Number(order.tx_monto_bruto ?? order.monto_esperado);
                      const comisionVal = Number(
                        order.tx_monto_comision ??
                          Math.round(((brutoVal * feePct) / 100) * 100) / 100
                      );
                      const netoVal = Number(
                        order.tx_monto_neto ??
                          Math.round((brutoVal - comisionVal) * 100) / 100
                      );

                      return (
                        <div
                          key={order.id}
                          className="rounded-lg border border-stone-200/90 bg-[#FAF9F6] p-3.5 transition hover:border-stone-300 dark:border-stone-800 dark:bg-[#121110] dark:hover:border-stone-700"
                        >
                          <div className="flex flex-wrap items-start justify-between gap-2">
                            <div className="flex flex-wrap items-center gap-1.5">
                              <span className="font-mono text-[10px] text-stone-400">
                                #{idx + 1}
                              </span>
                              <span className="font-mono text-xs font-semibold text-stone-900 dark:text-stone-100">
                                {order.codigo_orden}
                              </span>
                              <span className="rounded border border-stone-200 bg-white px-1.5 py-0.5 text-[10px] font-medium text-stone-600 dark:border-stone-800 dark:bg-[#1C1A18] dark:text-stone-400">
                                {order.plataforma_esperada}
                              </span>
                              {isDirectAdmin && (
                                <span className="inline-flex items-center gap-1 rounded-full border border-stone-300 bg-stone-100 px-2 py-0.5 text-[10px] font-medium text-stone-700 dark:border-stone-700 dark:bg-stone-800 dark:text-stone-300">
                                  <ShieldCheck className="h-3 w-3" strokeWidth={1.5} />
                                  Directa
                                </span>
                              )}
                            </div>

                            {isConciliado ? (
                              <span className="inline-flex items-center gap-1 rounded-full border border-emerald-700/20 bg-emerald-50 px-2 py-0.5 text-[10px] font-medium text-emerald-700 dark:border-emerald-500/30 dark:bg-emerald-950/40 dark:text-emerald-400">
                                <CheckCircle2 className="h-3 w-3" strokeWidth={1.5} />
                                CONCILIADO
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1 rounded-full border border-amber-700/25 bg-amber-50 px-2 py-0.5 text-[10px] font-medium text-amber-800 dark:border-amber-500/35 dark:bg-amber-950/40 dark:text-amber-400">
                                <Clock className="h-3 w-3" strokeWidth={1.5} />
                                PENDIENTE
                              </span>
                            )}
                          </div>

                          <div className="mt-2 flex items-baseline justify-between gap-2">
                            <span className="font-mono text-base font-semibold tabular-nums text-stone-900 dark:text-stone-100">
                              {formatAmount(order.monto_esperado, order.moneda)}
                            </span>
                            <span className="truncate font-mono text-[11px] text-stone-500 dark:text-stone-400">
                              Ref: {order.referencia_reportada ?? 'N/A'}
                            </span>
                          </div>

                          <div className="mt-1 flex flex-wrap items-center justify-between gap-1 text-[11px] text-stone-500 dark:text-stone-400">
                            <span className="truncate">
                              De: <strong className="font-medium text-stone-700 dark:text-stone-300">{order.remitente_reportado}</strong>
                            </span>
                            <span className="font-mono text-[10px] tabular-nums">
                              {order.tx_fecha_correo
                                ? formatDateTime(order.tx_fecha_correo)
                                : order.fecha_transferencia
                                  ? order.fecha_transferencia
                                  : formatDateTime(order.created_at)}
                            </span>
                          </div>

                          <div className="mt-2 rounded-md border border-stone-200/80 bg-white px-2.5 py-1.5 text-[11px] dark:border-stone-800 dark:bg-[#1C1A18]">
                            {isConciliado ? (
                              <div className="flex flex-wrap items-center justify-between gap-1 text-stone-600 dark:text-stone-400">
                                <span className="font-mono tabular-nums">
                                  Bruto ${brutoVal.toFixed(2)} · Com -${comisionVal.toFixed(2)}
                                </span>
                                <span className="font-mono font-semibold tabular-nums text-emerald-700 dark:text-emerald-400">
                                  Neto +${netoVal.toFixed(2)} {order.moneda}
                                </span>
                              </div>
                            ) : (
                              <div className="text-amber-700 dark:text-amber-400">
                                En espera de correo bancario para acreditar saldo neto
                              </div>
                            )}
                          </div>

                          {order.has_capture || order.comprobante_base64 ? (
                            <div className="mt-2 flex items-center justify-end border-t border-stone-200/80 pt-2 dark:border-stone-800">
                              <button
                                type="button"
                                onClick={async () => {
                                  if (!order.comprobante_base64) {
                                    try {
                                      const res = await fetch(`/api/reconciliation/capture?orderId=${encodeURIComponent(order.id)}`);
                                      if (res.ok) {
                                        const capData = await res.json();
                                        if (capData.comprobante_base64) {
                                          order.comprobante_base64 = capData.comprobante_base64;
                                        }
                                      }
                                    } catch {
                                      // Silently fail
                                    }
                                  }
                                  setPreviewOrder({ ...order });
                                }}
                                className="inline-flex items-center gap-1 rounded-md border border-stone-200 bg-white px-2.5 py-1 text-[11px] font-medium text-stone-700 hover:bg-stone-100 dark:border-stone-800 dark:bg-[#1C1A18] dark:text-stone-200"
                              >
                                <Eye className="h-3.5 w-3.5 text-stone-400" strokeWidth={1.5} />
                                Ver Comprobante
                              </button>
                            </div>
                          ) : isDirectAdmin ? (
                            <div className="mt-2 flex items-center border-t border-stone-200/80 pt-2 text-[11px] text-stone-500 dark:border-stone-800 dark:text-stone-400">
                              <span className="inline-flex items-center gap-1">
                                <ShieldCheck className="h-3.5 w-3.5 text-stone-400" strokeWidth={1.5} />
                                Acreditado directamente por administración
                              </span>
                            </div>
                          ) : null}
                        </div>
                      );
                    })}
                  </div>
                )}
              </section>
            </div>

            {/* Reporte Adicional: Resumen Corto de Cada Comprobante y Conciliación Directa (Todos los Registros) */}
            {(() => {
              const feeDefault = Number(client.porcentaje_comision_zelle ?? 4);
              const isViewingArchivedCycle = selectedReportCycleId !== 'ACTIVO';
              const activeSelectedLiq = isViewingArchivedCycle
                ? liquidations.find((l) => l.id === selectedReportCycleId) ?? null
                : null;
              const reportSourceOrders = isViewingArchivedCycle
                ? archivedReportOrders
                : orders;
              const activeCycleLabel = isViewingArchivedCycle
                ? `${
                    activeSelectedLiq?.numero_ciclo
                      ? `Ciclo #${activeSelectedLiq.numero_ciclo}`
                      : 'Ciclo Cerrado'
                  }${
                    activeSelectedLiq
                      ? ` (${activeSelectedLiq.codigo_liquidacion})`
                      : ''
                  }`
                : `Ciclo #${liquidations.length + 1} (Actual)`;

              const isSettledOrder = (o: PendingPaymentOrder): boolean =>
                o.estado === 'CONCILIADO' || o.estado === 'LIQUIDADO';

              const filteredReportOrders = reportSourceOrders.filter((o) => {
                if (reportFilterStatus === 'CONCILIADO' && !isSettledOrder(o)) {
                  return false;
                }
                if (
                  reportFilterStatus === 'DIRECTA' &&
                  o.origen_registro !== 'ADMIN_DIRECTA'
                ) {
                  return false;
                }
                if (reportFilterStatus === 'PENDIENTE' && isSettledOrder(o)) {
                  return false;
                }
                if (reportSearchQuery.trim()) {
                  const q = reportSearchQuery.trim().toLowerCase();
                  return (
                    o.codigo_orden.toLowerCase().includes(q) ||
                    (o.remitente_reportado || '').toLowerCase().includes(q) ||
                    (o.tx_remitente_correo || '').toLowerCase().includes(q) ||
                    (o.referencia_reportada || '').toLowerCase().includes(q) ||
                    (o.tx_referencia_correo || '').toLowerCase().includes(q) ||
                    (o.origen_registro === 'ADMIN_DIRECTA' &&
                      'conciliacion directa admin'.includes(q))
                  );
                }
                return true;
              });

              const conciliadosTotalCount = reportSourceOrders.filter((o) =>
                isSettledOrder(o)
              ).length;
              const directAdminCount = reportSourceOrders.filter(
                (o) => o.origen_registro === 'ADMIN_DIRECTA'
              ).length;
              const capturasConciliadasCount =
                conciliadosTotalCount - directAdminCount;
              const pendientesTotalCount =
                reportSourceOrders.length - conciliadosTotalCount;

              let sumBruto = 0;
              let sumComision = 0;
              let sumNeto = 0;
              let filteredConciliadosCount = 0;
              let filteredDirectCount = 0;
              for (const o of filteredReportOrders) {
                if (o.origen_registro === 'ADMIN_DIRECTA') {
                  filteredDirectCount += 1;
                }
                if (isSettledOrder(o)) {
                  filteredConciliadosCount += 1;
                  const b = Number(o.tx_monto_bruto ?? o.monto_esperado);
                  const f = Number(o.tx_porcentaje_comision ?? feeDefault);
                  const c = Number(
                    o.tx_monto_comision ?? Math.round(((b * f) / 100) * 100) / 100
                  );
                  const n = Number(
                    o.tx_monto_neto ?? Math.round((b - c) * 100) / 100
                  );
                  sumBruto += b;
                  sumComision += c;
                  sumNeto += n;
                }
              }
              sumBruto = Math.round(sumBruto * 100) / 100;
              sumComision = Math.round(sumComision * 100) / 100;
              sumNeto = Math.round(sumNeto * 100) / 100;

              const walletTotalAcreditadoUsd = Number(
                wallet.totalAcreditadoUsd ??
                  wallet.saldoNetoUsd + (wallet.totalLiquidadoUsd ?? 0)
              );
              const walletTotalLiquidadoUsd = Number(
                wallet.totalLiquidadoUsd ?? 0
              );
              const walletSaldoPendienteUsd = Number(wallet.saldoNetoUsd ?? 0);
              const saldoAnteriorRestanteUsd =
                Math.round((walletSaldoPendienteUsd - sumNeto) * 100) / 100;

              const handleCopyShortSummary = async (): Promise<void> => {
                const directSuffix =
                  filteredDirectCount > 0
                    ? ` · incluye ${filteredDirectCount} conciliación(es) directa(s) por Admin`
                    : '';
                const lines: string[] = [
                  `RESUMEN DE PAGOS Y CONCILIACIONES (${activeCycleLabel}) - ${client.nombre_titular.toUpperCase()}`,
                  `${activeCycleLabel}: ${filteredReportOrders.length} registro(s) (${filteredConciliadosCount} conciliados, ${filteredReportOrders.length - filteredConciliadosCount} pendientes${directSuffix})`,
                  `Totales ciclo -> Bruto: $${sumBruto.toFixed(2)} USD | Comisión: -$${sumComision.toFixed(2)} USD | Neto: +$${sumNeto.toFixed(2)} USD`,
                  ...(!isViewingArchivedCycle && walletTotalLiquidadoUsd > 0
                    ? [
                        `Balance Total -> Conciliado Neto: $${walletTotalAcreditadoUsd.toFixed(2)} USD − Liquidado: -$${walletTotalLiquidadoUsd.toFixed(2)} USD = Saldo Pendiente: $${walletSaldoPendienteUsd.toFixed(2)} USD`,
                      ]
                    : []),
                  `------------------------------------------------------------`,
                ];
                filteredReportOrders.forEach((o, i) => {
                  const isConc = isSettledOrder(o);
                  const isDirect = o.origen_registro === 'ADMIN_DIRECTA';
                  const b = Number(o.tx_monto_bruto ?? o.monto_esperado);
                  const f = Number(o.tx_porcentaje_comision ?? feeDefault);
                  const c = Number(
                    o.tx_monto_comision ?? Math.round(((b * f) / 100) * 100) / 100
                  );
                  const n = Number(
                    o.tx_monto_neto ?? Math.round((b - c) * 100) / 100
                  );
                  const dateLabel = formatDateTime(o.tx_fecha_correo ?? o.created_at);
                  const refLabel = o.referencia_reportada || o.tx_referencia_correo || 'SIN-REF';
                  const originTag = isDirect ? ' [Conciliación Directa]' : '';
                  lines.push(
                    `${i + 1}. ${o.codigo_orden}${originTag} | ${dateLabel} | De: ${o.remitente_reportado} | Ref: ${refLabel} | Bruto: $${b.toFixed(2)} | Neto: ${isConc ? `$${n.toFixed(2)}` : 'PENDIENTE'} (${o.estado})`
                  );
                });
                try {
                  await navigator.clipboard.writeText(lines.join('\n'));
                  setCopiedSummaryReport(true);
                  window.setTimeout(() => setCopiedSummaryReport(false), 2500);
                } catch {
                  // ignore
                }
              };

              return (
                <section className="mt-6 rounded-xl border border-stone-200/90 bg-white p-5 shadow-sm dark:border-stone-800 dark:bg-[#1C1A18]">
                  <div className="mb-4 flex flex-wrap items-center justify-between gap-3 border-b border-stone-200 pb-4 dark:border-stone-800">
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <CheckCircle2 className="h-4 w-4 text-stone-400 dark:text-stone-500" strokeWidth={1.5} />
                        <h3 className="font-serif text-lg font-medium tracking-tight text-stone-900 dark:text-stone-100">
                          Historial Unificado de Pagos ({reportSourceOrders.length})
                        </h3>
                        <span
                          className={`rounded-full border px-2.5 py-0.5 text-[11px] font-medium ${
                            isViewingArchivedCycle
                              ? 'border-amber-700/25 bg-amber-50 text-amber-800 dark:border-amber-500/35 dark:bg-amber-950/40 dark:text-amber-400'
                              : 'border-emerald-700/20 bg-emerald-50 text-emerald-700 dark:border-emerald-500/30 dark:bg-emerald-950/40 dark:text-emerald-400'
                          }`}
                        >
                          {activeCycleLabel}
                        </span>
                      </div>
                      <p className="mt-0.5 text-xs text-stone-500 dark:text-stone-400">
                        Comprobantes reportados en el portal y conciliaciones directas acreditadas por administración.
                      </p>
                    </div>

                    <div className="flex flex-wrap items-center gap-2">
                      {liquidations.length > 0 && (() => {
                        const activeCycleNeto = Math.round(
                          orders.reduce((acc, o) => {
                            if (o.estado !== 'CONCILIADO' && o.estado !== 'LIQUIDADO') {
                              return acc;
                            }
                            const b = Number(o.tx_monto_bruto ?? o.monto_esperado);
                            const f = Number(o.tx_porcentaje_comision ?? feeDefault);
                            const c = Number(
                              o.tx_monto_comision ?? Math.round(((b * f) / 100) * 100) / 100
                            );
                            const n = Number(
                              o.tx_monto_neto ?? Math.round((b - c) * 100) / 100
                            );
                            return acc + n;
                          }, 0) * 100
                        ) / 100;

                        return (
                          <div className="inline-flex items-center gap-1.5 rounded-lg border border-stone-200 bg-[#FAF9F6] px-3 py-1.5 dark:border-stone-800 dark:bg-[#121110]">
                            <span className="text-[11px] font-medium uppercase tracking-wider text-amber-700 dark:text-amber-500">
                              Ciclo:
                            </span>
                            <select
                              value={selectedReportCycleId}
                              onChange={(e) =>
                                void handleSelectReportCycle(e.target.value)
                              }
                              className="max-w-[230px] bg-transparent text-xs font-medium text-stone-900 focus:outline-none cursor-pointer dark:text-stone-100"
                            >
                              <option value="ACTIVO">
                                Ciclo #{liquidations.length + 1} (Activo · {orders.length} reg. · Neto ${activeCycleNeto.toFixed(2)})
                              </option>
                              {liquidations.map((liq) => {
                                const pagosCount = Number(liq.ciclo_pagos_count ?? 0);
                                const netoTotal = Number(liq.ciclo_neto_total ?? 0);
                                return (
                                  <option key={liq.id} value={liq.id}>
                                    {liq.numero_ciclo
                                      ? `Ciclo #${liq.numero_ciclo}`
                                      : 'Ciclo Cerrado'}{' '}
                                    · {pagosCount} pagos · Neto{' '}
                                    {formatAmount(netoTotal, liq.moneda)} · Liq -
                                    {formatAmount(Number(liq.monto_liquidado ?? 0), liq.moneda)} (
                                    {new Date(liq.created_at).toLocaleDateString('es-ES', {
                                      day: '2-digit',
                                      month: 'short',
                                    })}
                                    )
                                  </option>
                                );
                              })}
                            </select>
                          </div>
                        );
                      })()}

                      <button
                        type="button"
                        onClick={() => void handleCopyShortSummary()}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-stone-200 bg-[#FAF9F6] px-3 py-1.5 text-xs font-medium text-stone-700 transition hover:bg-stone-100 dark:border-stone-800 dark:bg-[#121110] dark:text-stone-200 dark:hover:bg-stone-900"
                      >
                        {copiedSummaryReport ? (
                          <>
                            <Check className="h-3.5 w-3.5 text-emerald-700 dark:text-emerald-400" strokeWidth={1.5} />
                            Resumen Copiado
                          </>
                        ) : (
                          <>
                            <Copy className="h-3.5 w-3.5 text-stone-400" strokeWidth={1.5} />
                            Copiar Resumen ({filteredReportOrders.length})
                          </>
                        )}
                      </button>
                    </div>
                  </div>

                  {isLoadingReportCycle ? (
                    <div className="flex items-center justify-center gap-2 py-10 text-xs text-stone-500 dark:text-stone-400">
                      <Loader2 className="h-4 w-4 animate-spin" strokeWidth={1.5} />
                      Cargando registros del ciclo seleccionado...
                    </div>
                  ) : null}

                  {/* Resumen de Cierre cuando se consulta un Ciclo Liquidado */}
                  {isViewingArchivedCycle && activeSelectedLiq && (
                    <div className="mb-4 grid grid-cols-1 divide-y divide-stone-200 rounded-lg border border-stone-200 bg-[#FAF9F6] sm:grid-cols-3 sm:divide-x sm:divide-y-0 dark:divide-stone-800 dark:border-stone-800 dark:bg-[#121110]">
                      <div className="px-3.5 py-2.5">
                        <span className="text-[10px] font-medium uppercase tracking-wider text-amber-700 dark:text-amber-500">
                          Saldo al Cierre ({activeSelectedLiq.numero_ciclo ? `Ciclo #${activeSelectedLiq.numero_ciclo}` : activeSelectedLiq.codigo_liquidacion})
                        </span>
                        <p className="mt-0.5 font-mono text-sm font-semibold tabular-nums text-stone-900 dark:text-stone-100">
                          {formatAmount(Number(activeSelectedLiq.saldo_anterior ?? 0), activeSelectedLiq.moneda)}
                        </p>
                        <span className="font-mono text-[10px] tabular-nums text-stone-500 dark:text-stone-400">
                          {Number(activeSelectedLiq.ciclo_pagos_count ?? reportSourceOrders.length)} pagos · Neto ciclo{' '}
                          {formatAmount(Number(activeSelectedLiq.ciclo_neto_total ?? sumNeto), activeSelectedLiq.moneda)}
                        </span>
                      </div>
                      <div className="px-3.5 py-2.5">
                        <span className="text-[10px] font-medium uppercase tracking-wider text-stone-500 dark:text-stone-400">
                          Monto Liquidado
                        </span>
                        <p className="mt-0.5 font-mono text-sm font-semibold tabular-nums text-rose-700 dark:text-rose-400">
                          -{formatAmount(Number(activeSelectedLiq.monto_liquidado ?? 0), activeSelectedLiq.moneda)}
                        </p>
                        <span className="font-mono text-[10px] tabular-nums text-stone-500 dark:text-stone-400">
                          {activeSelectedLiq.codigo_liquidacion} · {formatDateTime(activeSelectedLiq.created_at)}
                        </span>
                      </div>
                      <div className="px-3.5 py-2.5">
                        <span className="text-[10px] font-medium uppercase tracking-wider text-stone-500 dark:text-stone-400">
                          Saldo Restante tras Cierre
                        </span>
                        <p
                          className={`mt-0.5 font-mono text-sm font-semibold tabular-nums ${
                            Number(activeSelectedLiq.saldo_restante ?? 0) < 0
                              ? 'text-rose-700 dark:text-rose-400'
                              : 'text-emerald-700 dark:text-emerald-400'
                          }`}
                        >
                          {formatAmount(Number(activeSelectedLiq.saldo_restante ?? 0), activeSelectedLiq.moneda)}
                        </p>
                        <span className="text-[10px] text-stone-500 dark:text-stone-400">
                          Transferido al siguiente ciclo
                        </span>
                      </div>
                    </div>
                  )}

                  {/* Resumen de Balance Acumulado */}
                  {!isViewingArchivedCycle && walletTotalLiquidadoUsd > 0 && (
                    <div className="mb-4 grid grid-cols-1 divide-y divide-stone-200 rounded-lg border border-stone-200 bg-[#FAF9F6] sm:grid-cols-3 sm:divide-x sm:divide-y-0 dark:divide-stone-800 dark:border-stone-800 dark:bg-[#121110]">
                      <div className="px-3.5 py-2.5">
                        <span className="text-[10px] font-medium uppercase tracking-wider text-stone-500 dark:text-stone-400">
                          Total Conciliado Neto
                        </span>
                        <p className="mt-0.5 font-mono text-sm font-semibold tabular-nums text-stone-900 dark:text-stone-100">
                          ${walletTotalAcreditadoUsd.toFixed(2)} USD
                        </p>
                      </div>
                      <div className="px-3.5 py-2.5">
                        <span className="text-[10px] font-medium uppercase tracking-wider text-stone-500 dark:text-stone-400">
                          Menos Total Liquidado
                        </span>
                        <p className="mt-0.5 font-mono text-sm font-semibold tabular-nums text-rose-700 dark:text-rose-400">
                          -${walletTotalLiquidadoUsd.toFixed(2)} USD
                        </p>
                      </div>
                      <div className="px-3.5 py-2.5">
                        <span className="text-[10px] font-medium uppercase tracking-wider text-stone-500 dark:text-stone-400">
                          Saldo Pendiente Total
                        </span>
                        <p
                          className={`mt-0.5 font-mono text-sm font-semibold tabular-nums ${
                            walletSaldoPendienteUsd < 0
                              ? 'text-rose-700 dark:text-rose-400'
                              : 'text-emerald-700 dark:text-emerald-400'
                          }`}
                        >
                          {formatAmount(walletSaldoPendienteUsd, 'USD')}
                        </p>
                        {Math.abs(saldoAnteriorRestanteUsd) >= 0.01 && (
                          <span className="font-mono text-[10px] tabular-nums text-stone-500 dark:text-stone-400">
                            Saldo ant. {formatAmount(saldoAnteriorRestanteUsd, 'USD')} + Ciclo +${sumNeto.toFixed(2)}
                          </span>
                        )}
                      </div>
                    </div>
                  )}

                  {/* Tarjetas de Totales Rápidos del Reporte */}
                  <div className="mb-4 grid grid-cols-2 divide-y divide-stone-200 rounded-lg border border-stone-200 bg-[#FAF9F6] sm:grid-cols-4 sm:divide-x sm:divide-y-0 dark:divide-stone-800 dark:border-stone-800 dark:bg-[#121110]">
                    <div className="p-3">
                      <span className="text-[10px] font-medium uppercase tracking-wider text-stone-500 dark:text-stone-400">
                        Total Pagos
                      </span>
                      <p className="mt-1 font-mono text-lg font-semibold tabular-nums text-stone-900 dark:text-stone-100">
                        {reportSourceOrders.length}
                      </p>
                      <span className="text-[11px] text-stone-500 dark:text-stone-400">
                        {directAdminCount > 0
                          ? `${capturasConciliadasCount} capturas + ${directAdminCount} directos`
                          : `${conciliadosTotalCount} conc. · ${pendientesTotalCount} pend.`}
                      </span>
                    </div>

                    <div className="p-3">
                      <span className="text-[10px] font-medium uppercase tracking-wider text-stone-500 dark:text-stone-400">
                        Bruto Conciliado
                      </span>
                      <p className="mt-1 font-mono text-lg font-semibold tabular-nums text-stone-900 dark:text-stone-100">
                        ${sumBruto.toFixed(2)} USD
                      </p>
                      <span className="text-[11px] text-stone-500 dark:text-stone-400">
                        Verificados ({filteredConciliadosCount})
                      </span>
                    </div>

                    <div className="p-3">
                      <span className="text-[10px] font-medium uppercase tracking-wider text-stone-500 dark:text-stone-400">
                        Comisión ({feeDefault}%)
                      </span>
                      <p className="mt-1 font-mono text-lg font-semibold tabular-nums text-stone-900 dark:text-stone-100">
                        -${sumComision.toFixed(2)} USD
                      </p>
                      <span className="text-[11px] text-stone-500 dark:text-stone-400">
                        Descuento aplicado
                      </span>
                    </div>

                    <div className="p-3">
                      <span className="text-[10px] font-medium uppercase tracking-wider text-stone-500 dark:text-stone-400">
                        Neto Acreditado
                      </span>
                      <p className="mt-1 font-mono text-lg font-semibold tabular-nums text-emerald-700 dark:text-emerald-400">
                        +${sumNeto.toFixed(2)} USD
                      </p>
                      <span className="text-[11px] text-stone-500 dark:text-stone-400">
                        Saldo líquido del ciclo
                      </span>
                    </div>
                  </div>

                  {/* Controles de Filtro y Búsqueda */}
                  <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                    <div className="flex flex-wrap gap-1.5">
                      <button
                        type="button"
                        onClick={() => setReportFilterStatus('TODOS')}
                        className={`rounded-full border px-3 py-1 text-xs font-medium transition ${
                          reportFilterStatus === 'TODOS'
                            ? 'border-stone-900 bg-stone-900 text-stone-50 dark:border-stone-100 dark:bg-stone-100 dark:text-stone-950'
                            : 'border-stone-200 bg-[#FAF9F6] text-stone-600 hover:border-stone-300 dark:border-stone-800 dark:bg-[#121110] dark:text-stone-400'
                        }`}
                      >
                        Todos ({reportSourceOrders.length})
                      </button>
                      <button
                        type="button"
                        onClick={() => setReportFilterStatus('CONCILIADO')}
                        className={`rounded-full border px-3 py-1 text-xs font-medium transition ${
                          reportFilterStatus === 'CONCILIADO'
                            ? 'border-emerald-700 bg-emerald-700 text-white dark:border-emerald-500 dark:bg-emerald-500/20 dark:text-emerald-300'
                            : 'border-stone-200 bg-[#FAF9F6] text-stone-600 hover:border-emerald-700/40 dark:border-stone-800 dark:bg-[#121110] dark:text-stone-400'
                        }`}
                      >
                        Conciliados ({conciliadosTotalCount})
                      </button>
                      {directAdminCount > 0 && (
                        <button
                          type="button"
                          onClick={() => setReportFilterStatus('DIRECTA')}
                          className={`rounded-full border px-3 py-1 text-xs font-medium transition ${
                            reportFilterStatus === 'DIRECTA'
                              ? 'border-stone-900 bg-stone-900 text-stone-50 dark:border-stone-100 dark:bg-stone-100 dark:text-stone-950'
                              : 'border-stone-200 bg-[#FAF9F6] text-stone-600 hover:border-stone-300 dark:border-stone-800 dark:bg-[#121110] dark:text-stone-400'
                          }`}
                        >
                          Directas ({directAdminCount})
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => setReportFilterStatus('PENDIENTE')}
                        className={`rounded-full border px-3 py-1 text-xs font-medium transition ${
                          reportFilterStatus === 'PENDIENTE'
                            ? 'border-amber-700 bg-amber-700 text-white dark:border-amber-500 dark:bg-amber-500/20 dark:text-amber-300'
                            : 'border-stone-200 bg-[#FAF9F6] text-stone-600 hover:border-amber-700/40 dark:border-stone-800 dark:bg-[#121110] dark:text-stone-400'
                        }`}
                      >
                        Pendientes ({pendientesTotalCount})
                      </button>
                    </div>

                    <input
                      type="text"
                      value={reportSearchQuery}
                      onChange={(e) => setReportSearchQuery(e.target.value)}
                      placeholder="Filtrar por nombre, referencia u orden..."
                      className="w-full max-w-xs rounded-lg border border-stone-200 bg-[#FAF9F6] px-3 py-1.5 text-xs text-stone-900 placeholder-stone-400 focus:border-amber-700 focus:outline-none dark:border-stone-800 dark:bg-[#121110] dark:text-stone-100 dark:placeholder-stone-500"
                    />
                  </div>

                  {/* Vista Móvil 100% Sin Scroll Horizontal (< md) */}
                  <div className="space-y-2.5 md:hidden">
                    {filteredReportOrders.length === 0 ? (
                      <div className="rounded-lg border border-stone-200 bg-[#FAF9F6] p-6 text-center text-xs text-stone-500 dark:border-stone-800 dark:bg-[#121110] dark:text-stone-400">
                        No hay comprobantes que coincidan con el filtro seleccionado.
                      </div>
                    ) : (
                      filteredReportOrders.map((o, idx) => {
                        const isConc = isSettledOrder(o);
                        const isDirect = o.origen_registro === 'ADMIN_DIRECTA';
                        const b = Number(o.tx_monto_bruto ?? o.monto_esperado);
                        const f = Number(o.tx_porcentaje_comision ?? feeDefault);
                        const c = Number(
                          o.tx_monto_comision ?? Math.round(((b * f) / 100) * 100) / 100
                        );
                        const n = Number(
                          o.tx_monto_neto ?? Math.round((b - c) * 100) / 100
                        );

                        return (
                          <div
                            key={o.id}
                            className="rounded-lg border border-stone-200 bg-[#FAF9F6] p-3.5 text-xs dark:border-stone-800 dark:bg-[#121110]"
                          >
                            <div className="flex items-start justify-between gap-2">
                              <div className="min-w-0">
                                <div className="flex flex-wrap items-center gap-1.5">
                                  <span className="font-mono text-[10px] text-stone-400">#{idx + 1}</span>
                                  <span className="font-mono font-semibold text-stone-900 dark:text-stone-100">
                                    {o.codigo_orden}
                                  </span>
                                  {isDirect && (
                                    <span className="rounded border border-stone-300 bg-stone-100 px-1.5 py-0.5 text-[9px] font-medium uppercase text-stone-700 dark:border-stone-700 dark:bg-stone-800 dark:text-stone-300">
                                      Directa
                                    </span>
                                  )}
                                </div>
                                <p className="mt-1 font-medium text-stone-900 dark:text-stone-100">
                                  {o.remitente_reportado}
                                </p>
                                <p className="font-mono text-[11px] text-stone-500 dark:text-stone-400">
                                  Ref: {o.referencia_reportada || 'SIN-REF'} · {formatDateTime(o.tx_fecha_correo ?? o.created_at)}
                                </p>
                              </div>
                              <div className="shrink-0 text-right">
                                <p className="font-mono text-sm font-semibold tabular-nums text-stone-900 dark:text-stone-100">
                                  {isConc ? `+$${n.toFixed(2)}` : `$${b.toFixed(2)}`}
                                </p>
                                <span
                                  className={`mt-1 inline-flex rounded-full border px-2 py-0.5 text-[10px] font-medium ${
                                    isConc
                                      ? 'border-emerald-700/20 bg-emerald-50 text-emerald-700 dark:border-emerald-500/30 dark:bg-emerald-950/40 dark:text-emerald-400'
                                      : 'border-amber-700/25 bg-amber-50 text-amber-800 dark:border-amber-500/35 dark:bg-amber-950/40 dark:text-amber-400'
                                  }`}
                                >
                                  {isConc ? 'Conciliado' : 'Pendiente'}
                                </span>
                              </div>
                            </div>
                            <div className="mt-2.5 flex items-center justify-between border-t border-stone-200/80 pt-2 dark:border-stone-800">
                              <span className="font-mono text-[11px] tabular-nums text-stone-500 dark:text-stone-400">
                                Bruto ${b.toFixed(2)} · Com {isConc ? `-$${c.toFixed(2)}` : '$0.00'}
                              </span>
                              {o.has_capture || o.comprobante_base64 ? (
                                <button
                                  type="button"
                                  onClick={async () => {
                                    if (!o.comprobante_base64) {
                                      try {
                                        const res = await fetch(
                                          `/api/reconciliation/capture?orderId=${encodeURIComponent(o.id)}`
                                        );
                                        if (res.ok) {
                                          const capData = await res.json();
                                          if (capData.comprobante_base64) {
                                            o.comprobante_base64 = capData.comprobante_base64;
                                          }
                                        }
                                      } catch {
                                        // ignore
                                      }
                                    }
                                    setPreviewOrder({ ...o });
                                  }}
                                  className="inline-flex items-center gap-1 rounded border border-stone-200 bg-white px-2.5 py-1 text-[11px] font-medium text-stone-700 dark:border-stone-800 dark:bg-[#1C1A18] dark:text-stone-200"
                                >
                                  <Eye className="h-3 w-3 text-stone-400" strokeWidth={1.5} />
                                  Ver Comprobante
                                </button>
                              ) : isDirect ? (
                                <span className="text-[10px] text-stone-500">Asignado por Admin</span>
                              ) : null}
                            </div>
                          </div>
                        );
                      })
                    )}
                  </div>

                  {/* Vista Escritorio (md+) */}
                  <div className="hidden max-h-[640px] overflow-auto rounded-lg border border-stone-200 md:block dark:border-stone-800">
                    <table className="w-full border-collapse text-left text-xs">
                      <thead className="sticky top-0 z-10 border-b border-stone-200 bg-[#FAF9F6] text-[11px] font-medium uppercase tracking-wider text-stone-500 dark:border-stone-800 dark:bg-[#121110] dark:text-stone-400">
                        <tr>
                          <th className="px-3 py-2.5">#</th>
                          <th className="px-3 py-2.5">Orden &amp; Fecha</th>
                          <th className="px-3 py-2.5">Remitente</th>
                          <th className="px-3 py-2.5">Referencia</th>
                          <th className="px-3 py-2.5">Detalle</th>
                          <th className="px-3 py-2.5 text-right">Bruto</th>
                          <th className="px-3 py-2.5 text-right">Comisión</th>
                          <th className="px-3 py-2.5 text-right">Neto</th>
                          <th className="px-3 py-2.5 text-center">Estado</th>
                          <th className="px-3 py-2.5 text-right">Comprobante</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-stone-200/80 bg-white dark:divide-stone-800 dark:bg-[#1C1A18]">
                        {filteredReportOrders.length === 0 ? (
                          <tr>
                            <td colSpan={10} className="px-6 py-8 text-center text-stone-500 dark:text-stone-400">
                              No hay comprobantes que coincidan con el filtro seleccionado.
                            </td>
                          </tr>
                        ) : (
                          filteredReportOrders.map((o, idx) => {
                            const isConc = isSettledOrder(o);
                            const isDirect = o.origen_registro === 'ADMIN_DIRECTA';
                            const isBinanceRow =
                              (o.plataforma_esperada || '').startsWith('BINANCE') ||
                              o.moneda === 'USDT';
                            const b = Number(o.tx_monto_bruto ?? o.monto_esperado);
                            const f = Number(o.tx_porcentaje_comision ?? feeDefault);
                            const c = Number(
                              o.tx_monto_comision ?? Math.round(((b * f) / 100) * 100) / 100
                            );
                            const n = Number(
                              o.tx_monto_neto ?? Math.round((b - c) * 100) / 100
                            );

                            return (
                              <tr
                                key={o.id}
                                className="transition hover:bg-[#FAF9F6] dark:hover:bg-stone-900/50"
                              >
                                <td className="px-3 py-2.5 font-mono tabular-nums text-stone-400">
                                  {idx + 1}
                                </td>
                                <td className="whitespace-nowrap px-3 py-2.5">
                                  <div className="flex items-center gap-1.5">
                                    <span className="font-mono font-semibold text-stone-900 dark:text-stone-100">
                                      {o.codigo_orden}
                                    </span>
                                    {isDirect && (
                                      <span className="inline-flex items-center rounded border border-stone-300 bg-stone-100 px-1.5 py-0.5 text-[9px] font-medium uppercase text-stone-600 dark:border-stone-700 dark:bg-stone-800 dark:text-stone-300">
                                        Directa
                                      </span>
                                    )}
                                  </div>
                                  <div className="font-mono text-[10px] tabular-nums text-stone-500 dark:text-stone-400">
                                    {formatDateTime(o.tx_fecha_correo ?? o.created_at)}
                                  </div>
                                </td>
                                <td className="px-3 py-2.5">
                                  <div className="font-medium text-stone-900 dark:text-stone-100">
                                    {o.remitente_reportado}
                                  </div>
                                  {o.tx_remitente_correo &&
                                    o.tx_remitente_correo.toLowerCase() !==
                                      (o.remitente_reportado || '').toLowerCase() && (
                                      <div className="text-[11px] text-stone-500 dark:text-stone-400">
                                        Correo: {o.tx_remitente_correo}
                                      </div>
                                    )}
                                </td>
                                <td className="whitespace-nowrap px-3 py-2.5 font-mono">
                                  <div className="text-stone-800 dark:text-stone-200">
                                    {o.referencia_reportada || 'SIN-REF'}
                                  </div>
                                  {o.tx_referencia_correo &&
                                    o.tx_referencia_correo !== o.referencia_reportada && (
                                      <div className="text-[10px] text-stone-500 dark:text-stone-400">
                                        Banco: {o.tx_referencia_correo}
                                      </div>
                                    )}
                                </td>
                                <td className="px-3 py-2.5 text-stone-600 dark:text-stone-400">
                                  {isConc ? (
                                    <span>
                                      {isDirect
                                        ? `Conciliación directa (${o.plataforma_esperada})`
                                        : isBinanceRow
                                          ? 'Pago Binance verificado'
                                          : 'Pago Zelle verificado'}
                                    </span>
                                  ) : (
                                    <span className="text-amber-700 dark:text-amber-400">
                                      Esperando correo del banco
                                    </span>
                                  )}
                                </td>
                                <td className="whitespace-nowrap px-3 py-2.5 text-right font-mono font-semibold tabular-nums text-stone-900 dark:text-stone-100">
                                  ${b.toFixed(2)}
                                </td>
                                <td className="whitespace-nowrap px-3 py-2.5 text-right font-mono tabular-nums text-stone-500 dark:text-stone-400">
                                  {isConc ? `-$${c.toFixed(2)}` : '$0.00'}
                                </td>
                                <td className="whitespace-nowrap px-3 py-2.5 text-right font-mono font-semibold tabular-nums">
                                  {isConc ? (
                                    <span className="text-emerald-700 dark:text-emerald-400">+${n.toFixed(2)}</span>
                                  ) : (
                                    <span className="text-stone-400">—</span>
                                  )}
                                </td>
                                <td className="whitespace-nowrap px-3 py-2.5 text-center">
                                  {isConc ? (
                                    <span className="inline-flex items-center rounded-full border border-emerald-700/20 bg-emerald-50 px-2 py-0.5 text-[10px] font-medium text-emerald-700 dark:border-emerald-500/30 dark:bg-emerald-950/40 dark:text-emerald-400">
                                      Conciliado
                                    </span>
                                  ) : (
                                    <span className="inline-flex items-center rounded-full border border-amber-700/25 bg-amber-50 px-2 py-0.5 text-[10px] font-medium text-amber-800 dark:border-amber-500/35 dark:bg-amber-950/40 dark:text-amber-400">
                                      Pendiente
                                    </span>
                                  )}
                                </td>
                                <td className="whitespace-nowrap px-3 py-2.5 text-right">
                                  {o.has_capture || o.comprobante_base64 ? (
                                    <button
                                      type="button"
                                      onClick={async () => {
                                        if (!o.comprobante_base64) {
                                          try {
                                            const res = await fetch(
                                              `/api/reconciliation/capture?orderId=${encodeURIComponent(o.id)}`
                                            );
                                            if (res.ok) {
                                              const capData = await res.json();
                                              if (capData.comprobante_base64) {
                                                o.comprobante_base64 = capData.comprobante_base64;
                                              }
                                            }
                                          } catch {
                                            // ignore
                                          }
                                        }
                                        setPreviewOrder({ ...o });
                                      }}
                                      className="inline-flex items-center gap-1 rounded border border-stone-200 bg-[#FAF9F6] px-2 py-1 text-[11px] font-medium text-stone-700 hover:bg-stone-100 dark:border-stone-800 dark:bg-[#121110] dark:text-stone-200"
                                    >
                                      <Eye className="h-3 w-3 text-stone-400" strokeWidth={1.5} />
                                      Ver
                                    </button>
                                  ) : isDirect ? (
                                    <span className="inline-flex items-center gap-1 rounded border border-stone-200 bg-[#FAF9F6] px-2 py-0.5 text-[10px] font-medium text-stone-600 dark:border-stone-800 dark:bg-[#121110] dark:text-stone-400">
                                      <ShieldCheck className="h-3 w-3" strokeWidth={1.5} />
                                      Admin
                                    </span>
                                  ) : (
                                    <span className="text-[11px] text-stone-400">—</span>
                                  )}
                                </td>
                              </tr>
                            );
                          })
                        )}
                      </tbody>
                      {filteredReportOrders.length > 0 && (
                        <tfoot>
                          <tr className="border-t border-stone-200 bg-[#FAF9F6] text-xs font-semibold dark:border-stone-800 dark:bg-[#121110]">
                            <td colSpan={5} className="px-3 py-3 text-stone-600 dark:text-stone-400">
                              TOTALES {activeCycleLabel.toUpperCase()} ({filteredReportOrders.length} reg. · {filteredConciliadosCount} conc.)
                            </td>
                            <td className="whitespace-nowrap px-3 py-3 text-right font-mono tabular-nums text-stone-900 dark:text-stone-100">
                              ${sumBruto.toFixed(2)}
                            </td>
                            <td className="whitespace-nowrap px-3 py-3 text-right font-mono tabular-nums text-stone-600 dark:text-stone-400">
                              -${sumComision.toFixed(2)}
                            </td>
                            <td className="whitespace-nowrap px-3 py-3 text-right font-mono tabular-nums text-emerald-700 dark:text-emerald-400">
                              +${sumNeto.toFixed(2)}
                            </td>
                            <td colSpan={2} className="px-3 py-3 text-right text-[11px] font-normal text-stone-500 dark:text-stone-400">
                              {filteredReportOrders.length - filteredConciliadosCount > 0
                                ? `${filteredReportOrders.length - filteredConciliadosCount} pend.`
                                : '100% verificado'}
                            </td>
                          </tr>
                        </tfoot>
                      )}
                    </table>
                  </div>
                </section>
              );
            })()}

            {/* Historial de Liquidaciones Recibidas por el Cliente */}
            <section className="mt-6 rounded-xl border border-stone-200/90 bg-white p-5 shadow-sm dark:border-stone-800 dark:bg-[#1C1A18]">
              <div className="mb-4 flex flex-wrap items-center justify-between gap-3 border-b border-stone-200 pb-3 dark:border-stone-800">
                <div className="flex items-center gap-2">
                  <Coins className="h-4 w-4 text-stone-400 dark:text-stone-500" strokeWidth={1.5} />
                  <div>
                    <h3 className="font-serif text-lg font-medium tracking-tight text-stone-900 dark:text-stone-100">
                      Historial de Liquidaciones ({liquidations.length})
                    </h3>
                    <p className="text-xs text-stone-500 dark:text-stone-400">
                      Registro de liquidaciones pagadas a tu favor o a terceros autorizados, con motivo y deducción de saldo.
                    </p>
                  </div>
                </div>
              </div>

              {liquidations.length === 0 ? (
                <div className="rounded-lg border border-stone-200 bg-[#FAF9F6] p-6 text-center text-xs text-stone-500 dark:border-stone-800 dark:bg-[#121110] dark:text-stone-400">
                  Aún no se han procesado liquidaciones para tu cuenta. Tu saldo acumulado está disponible para ser liquidado.
                </div>
              ) : (
                <>
                  {/* Móvil: Tarjetas sin scroll horizontal */}
                  <div className="space-y-2.5 md:hidden">
                    {liquidations.map((liq) => (
                      <div
                        key={liq.id}
                        className="rounded-lg border border-stone-200 bg-[#FAF9F6] p-3.5 text-xs dark:border-stone-800 dark:bg-[#121110]"
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div>
                            <div className="flex flex-wrap items-center gap-1.5">
                              {liq.numero_ciclo && (
                                <span className="inline-flex rounded-full border border-amber-700/25 bg-amber-50 px-2 py-0.5 text-[10px] font-medium text-amber-800 dark:border-amber-500/35 dark:bg-amber-950/40 dark:text-amber-400">
                                  Ciclo #{liq.numero_ciclo}
                                </span>
                              )}
                              <span className="font-mono font-semibold text-stone-900 dark:text-stone-100">
                                {liq.codigo_liquidacion}
                              </span>
                            </div>
                            <p className="mt-1 font-medium text-stone-800 dark:text-stone-200">
                              {liq.destinatario_beneficiario}
                            </p>
                            <p className="text-[11px] text-stone-500 dark:text-stone-400">
                              {liq.motivo_concepto} · {formatDateTime(liq.created_at)}
                            </p>
                          </div>
                          <div className="shrink-0 text-right font-mono tabular-nums">
                            <p className="text-sm font-semibold text-rose-700 dark:text-rose-400">
                              -{formatAmount(liq.monto_liquidado, liq.moneda)}
                            </p>
                            <p
                              className={`text-[11px] font-medium ${
                                liq.saldo_restante < 0
                                  ? 'text-rose-700 dark:text-rose-400'
                                  : 'text-emerald-700 dark:text-emerald-400'
                              }`}
                            >
                              Rest: {formatAmount(liq.saldo_restante, liq.moneda)}
                            </p>
                          </div>
                        </div>
                        <div className="mt-2.5 flex items-center justify-between border-t border-stone-200/80 pt-2 dark:border-stone-800">
                          <span className="font-mono text-[11px] tabular-nums text-stone-500 dark:text-stone-400">
                            {Number(liq.ciclo_pagos_count ?? 0)} pagos · {liq.metodo_pago_salida}
                          </span>
                          <button
                            type="button"
                            onClick={() => void openLiquidationCycleDetail(liq)}
                            className="inline-flex items-center gap-1 rounded border border-stone-200 bg-white px-2.5 py-1 text-[11px] font-medium text-stone-700 dark:border-stone-800 dark:bg-[#1C1A18] dark:text-stone-200"
                          >
                            <Eye className="h-3 w-3 text-stone-400" strokeWidth={1.5} />
                            Ver Pagos
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>

                  {/* Escritorio: Tabla limpia */}
                  <div className="hidden overflow-x-auto md:block">
                    <table className="w-full border-collapse text-left text-sm table-auto">
                      <thead>
                        <tr className="border-b border-stone-200 bg-[#FAF9F6] text-[11px] font-medium uppercase tracking-wider text-stone-500 dark:border-stone-800 dark:bg-[#121110] dark:text-stone-400">
                          <th className="px-4 py-2.5">Código &amp; Fecha</th>
                          <th className="px-4 py-2.5">Destinatario</th>
                          <th className="px-4 py-2.5">Motivo</th>
                          <th className="px-4 py-2.5">Método &amp; Ref.</th>
                          <th className="px-4 py-2.5 text-right">Totales del Ciclo</th>
                          <th className="px-4 py-2.5 text-right">Liquidado</th>
                          <th className="px-4 py-2.5 text-right">Saldo Restante</th>
                          <th className="px-4 py-2.5 text-right">Archivo</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-stone-200/80 dark:divide-stone-800">
                        {liquidations.map((liq) => (
                          <tr key={liq.id} className="transition hover:bg-[#FAF9F6] dark:hover:bg-stone-900/50">
                            <td className="px-4 py-3 font-mono text-xs">
                              <div className="flex flex-wrap items-center gap-1.5">
                                {liq.numero_ciclo && (
                                  <span className="inline-flex rounded-full border border-amber-700/25 bg-amber-50 px-2 py-0.5 font-sans text-[10px] font-medium text-amber-800 dark:border-amber-500/35 dark:bg-amber-950/40 dark:text-amber-400">
                                    Ciclo #{liq.numero_ciclo}
                                  </span>
                                )}
                                <span className="font-semibold text-stone-900 dark:text-stone-100">
                                  {liq.codigo_liquidacion}
                                </span>
                              </div>
                              <div className="mt-0.5 font-mono text-[11px] tabular-nums text-stone-500 dark:text-stone-400">
                                {formatDateTime(liq.created_at)}
                              </div>
                            </td>
                            <td className="px-4 py-3 text-xs font-medium text-stone-800 dark:text-stone-200">
                              {liq.destinatario_beneficiario}
                            </td>
                            <td className="max-w-xs truncate px-4 py-3 text-xs text-stone-600 dark:text-stone-400" title={liq.motivo_concepto}>
                              {liq.motivo_concepto}
                            </td>
                            <td className="px-4 py-3 text-xs">
                              <span className="inline-flex rounded border border-stone-200 bg-[#FAF9F6] px-2 py-0.5 text-[10px] font-medium text-stone-700 dark:border-stone-800 dark:bg-[#121110] dark:text-stone-300">
                                {liq.metodo_pago_salida}
                              </span>
                              {liq.referencia_salida && (
                                <div className="mt-0.5 font-mono text-[11px] text-stone-500 dark:text-stone-400">
                                  Ref: {liq.referencia_salida}
                                </div>
                              )}
                            </td>
                            <td className="whitespace-nowrap px-4 py-3 text-right font-mono text-xs tabular-nums">
                              <div className="font-semibold text-stone-900 dark:text-stone-100">
                                Neto: {formatAmount(Number(liq.ciclo_neto_total ?? 0), liq.moneda)}
                              </div>
                              <div className="text-[10px] text-stone-500 dark:text-stone-400">
                                {Number(liq.ciclo_pagos_count ?? 0)} pagos · Bruto{' '}
                                {formatAmount(Number(liq.ciclo_bruto_total ?? 0), liq.moneda)} · Com -
                                {formatAmount(Number(liq.ciclo_comision_total ?? 0), liq.moneda)}
                              </div>
                            </td>
                            <td className="px-4 py-3 text-right font-mono text-sm font-semibold tabular-nums text-rose-700 dark:text-rose-400">
                              -{formatAmount(liq.monto_liquidado, liq.moneda)}
                            </td>
                            <td
                              className={`px-4 py-3 text-right font-mono text-xs font-semibold tabular-nums ${
                                liq.saldo_restante < 0
                                  ? 'text-rose-700 dark:text-rose-400'
                                  : 'text-emerald-700 dark:text-emerald-400'
                              }`}
                            >
                              {formatAmount(liq.saldo_restante, liq.moneda)}
                            </td>
                            <td className="px-4 py-3 text-right">
                              <button
                                type="button"
                                onClick={() => void openLiquidationCycleDetail(liq)}
                                className="inline-flex items-center gap-1.5 rounded-lg border border-stone-200 bg-[#FAF9F6] px-2.5 py-1.5 text-[11px] font-medium text-stone-700 transition hover:bg-stone-100 cursor-pointer dark:border-stone-800 dark:bg-[#121110] dark:text-stone-200 dark:hover:bg-stone-900"
                              >
                                <Eye className="h-3.5 w-3.5 text-stone-400" strokeWidth={1.5} />
                                Ver Pagos
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </>
              )}
            </section>
          </div>
        )}

        {/* Modal de Archivo Histórico: Pagos y Capturas de un Ciclo Liquidado */}
        <Dialog.Root
          open={selectedLiquidationModal !== null}
          onOpenChange={(open) => {
            if (!open) {
              setSelectedLiquidationModal(null);
            }
          }}
        >
          <Dialog.Portal>
            <Dialog.Overlay className="fixed inset-0 z-40 bg-stone-950/50 backdrop-blur-sm" />
            <Dialog.Content className="fixed left-1/2 top-1/2 z-40 flex max-h-[90vh] w-[95vw] max-w-5xl -translate-x-1/2 -translate-y-1/2 flex-col rounded-xl border border-stone-200/90 bg-white p-5 text-stone-900 shadow-2xl dark:border-stone-800 dark:bg-[#1C1A18] dark:text-stone-100">
              <div className="flex flex-wrap items-start justify-between gap-3 border-b border-stone-200 pb-3 dark:border-stone-800">
                <div>
                  <Dialog.Title className="flex items-center gap-2 font-serif text-xl font-medium tracking-tight text-stone-900 dark:text-stone-100">
                    <Coins className="h-5 w-5 text-stone-400" strokeWidth={1.5} />
                    {selectedLiquidationModal?.numero_ciclo
                      ? `Ciclo #${selectedLiquidationModal.numero_ciclo} (Cerrado) · `
                      : 'Archivo de Ciclo Cerrado · '}
                    {selectedLiquidationModal?.codigo_liquidacion}
                  </Dialog.Title>
                  <Dialog.Description className="mt-0.5 text-xs text-stone-500 dark:text-stone-400">
                    Liquidado el {formatDateTime(selectedLiquidationModal?.created_at)} · Pagado:{' '}
                    <strong className="font-mono text-rose-700 dark:text-rose-400">
                      -{selectedLiquidationModal ? formatAmount(selectedLiquidationModal.monto_liquidado, selectedLiquidationModal.moneda) : ''}
                    </strong>{' '}
                    · Saldo restante:{' '}
                    <strong
                      className={`font-mono ${
                        (selectedLiquidationModal?.saldo_restante ?? 0) < 0
                          ? 'text-rose-700 dark:text-rose-400'
                          : 'text-emerald-700 dark:text-emerald-400'
                      }`}
                    >
                      {selectedLiquidationModal ? formatAmount(selectedLiquidationModal.saldo_restante, selectedLiquidationModal.moneda) : ''}
                    </strong>
                  </Dialog.Description>
                </div>
                <Dialog.Close asChild>
                  <button
                    type="button"
                    className="rounded-lg p-1.5 text-stone-400 hover:bg-stone-100 hover:text-stone-700 dark:hover:bg-stone-800 dark:hover:text-stone-200"
                  >
                    <X className="h-4 w-4" strokeWidth={1.5} />
                  </button>
                </Dialog.Close>
              </div>

              {isLoadingLiqDetail ? (
                <div className="flex items-center justify-center gap-2 py-16 text-sm text-stone-500 dark:text-stone-400">
                  <Loader2 className="h-5 w-5 animate-spin" strokeWidth={1.5} />
                  Cargando pagos y capturas archivadas de este ciclo...
                </div>
              ) : liqDetailError ? (
                <div className="my-6 rounded-xl border border-rose-700/25 bg-rose-50 p-4 text-xs text-rose-700 dark:border-rose-500/35 dark:bg-rose-950/40 dark:text-rose-400">
                  {liqDetailError}
                </div>
              ) : (
                (() => {
                  const q = liqDetailSearch.trim().toLowerCase();
                  const filteredItems = q
                    ? liqDetailItems.filter(
                        (item) =>
                          item.codigo_orden.toLowerCase().includes(q) ||
                          (item.remitente_reportado || '').toLowerCase().includes(q) ||
                          (item.tx_remitente_correo || '').toLowerCase().includes(q) ||
                          (item.referencia_reportada || '').toLowerCase().includes(q) ||
                          (item.tx_referencia_correo || '').toLowerCase().includes(q)
                      )
                    : liqDetailItems;

                  const handleCopyCycleSummary = async (): Promise<void> => {
                    if (!selectedLiquidationModal) return;
                    const cycleTag = selectedLiquidationModal.numero_ciclo
                      ? `CICLO #${selectedLiquidationModal.numero_ciclo} · `
                      : '';
                    const lines: string[] = [
                      `ARCHIVO ${cycleTag}${selectedLiquidationModal.codigo_liquidacion} - ${selectedLiquidationModal.cliente_nombre.toUpperCase()}`,
                      `Fecha liquidación: ${formatDateTime(selectedLiquidationModal.created_at)} | Pagado: -${formatAmount(selectedLiquidationModal.monto_liquidado, selectedLiquidationModal.moneda)} | Saldo restante: ${formatAmount(selectedLiquidationModal.saldo_restante, selectedLiquidationModal.moneda)}`,
                      `Pagos archivados: ${filteredItems.length} | Bruto: $${(liqDetailSummary?.totalBruto ?? 0).toFixed(2)} | Comisión: -$${(liqDetailSummary?.totalComision ?? 0).toFixed(2)} | Neto: $${(liqDetailSummary?.totalNeto ?? 0).toFixed(2)}`,
                      `------------------------------------------------------------`,
                    ];
                    filteredItems.forEach((o, i) => {
                      const b = Number(o.tx_monto_bruto ?? o.monto_esperado);
                      const n = Number(o.tx_monto_neto ?? 0);
                      const dateLbl = formatDateTime(o.tx_fecha_correo ?? o.created_at);
                      const refLbl = o.tx_referencia_correo || o.referencia_reportada || 'SIN-REF';
                      const tag = o.origen_registro === 'ADMIN_DIRECTA' ? ' [Directa]' : '';
                      lines.push(
                        `${i + 1}. ${o.codigo_orden}${tag} | ${dateLbl} | ${o.tx_remitente_correo || o.remitente_reportado} | Ref: ${refLbl} | Bruto: $${b.toFixed(2)} | Neto: $${n.toFixed(2)}`
                      );
                    });
                    try {
                      await navigator.clipboard.writeText(lines.join('\n'));
                      setCopiedLiqDetailSummary(true);
                      window.setTimeout(() => setCopiedLiqDetailSummary(false), 2500);
                    } catch {
                      // ignore
                    }
                  };

                  return (
                    <div className="mt-4 flex min-h-0 flex-1 flex-col gap-3">
                      {liqDetailSummary && (
                        <div className="grid grid-cols-2 divide-y divide-stone-200 rounded-lg border border-stone-200 bg-[#FAF9F6] sm:grid-cols-4 sm:divide-x sm:divide-y-0 dark:divide-stone-800 dark:border-stone-800 dark:bg-[#121110]">
                          <div className="p-2.5">
                            <span className="text-[10px] font-medium uppercase tracking-wider text-stone-500 dark:text-stone-400">
                              Pagos Archivados
                            </span>
                            <p className="mt-0.5 font-mono text-base font-semibold tabular-nums text-stone-900 dark:text-stone-100">
                              {liqDetailSummary.totalCount}
                            </p>
                            <span className="text-[10px] text-stone-500 dark:text-stone-400">
                              {liqDetailSummary.portalCount} capturas · {liqDetailSummary.directCount} directos
                            </span>
                          </div>
                          <div className="p-2.5">
                            <span className="text-[10px] font-medium uppercase tracking-wider text-stone-500 dark:text-stone-400">
                              Bruto del Ciclo
                            </span>
                            <p className="mt-0.5 font-mono text-base font-semibold tabular-nums text-stone-900 dark:text-stone-100">
                              ${liqDetailSummary.totalBruto.toFixed(2)}
                            </p>
                          </div>
                          <div className="p-2.5">
                            <span className="text-[10px] font-medium uppercase tracking-wider text-stone-500 dark:text-stone-400">
                              Comisión Retenida
                            </span>
                            <p className="mt-0.5 font-mono text-base font-semibold tabular-nums text-stone-900 dark:text-stone-100">
                              -${liqDetailSummary.totalComision.toFixed(2)}
                            </p>
                          </div>
                          <div className="p-2.5">
                            <span className="text-[10px] font-medium uppercase tracking-wider text-stone-500 dark:text-stone-400">
                              Neto del Ciclo
                            </span>
                            <p className="mt-0.5 font-mono text-base font-semibold tabular-nums text-emerald-700 dark:text-emerald-400">
                              +${liqDetailSummary.totalNeto.toFixed(2)}
                            </p>
                          </div>
                        </div>
                      )}

                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <input
                          type="text"
                          value={liqDetailSearch}
                          onChange={(e) => setLiqDetailSearch(e.target.value)}
                          placeholder="Buscar por nombre, código ORD- o referencia..."
                          className="w-full max-w-md rounded-lg border border-stone-200 bg-[#FAF9F6] px-3 py-1.5 text-xs text-stone-900 placeholder-stone-400 focus:border-amber-700 focus:outline-none dark:border-stone-800 dark:bg-[#121110] dark:text-stone-100 dark:placeholder-stone-500"
                        />
                        <button
                          type="button"
                          onClick={() => void handleCopyCycleSummary()}
                          className="inline-flex items-center gap-1.5 rounded-lg border border-stone-200 bg-[#FAF9F6] px-3 py-1.5 text-xs font-medium text-stone-700 hover:bg-stone-100 dark:border-stone-800 dark:bg-[#121110] dark:text-stone-200"
                        >
                          {copiedLiqDetailSummary ? (
                            <>
                              <Check className="h-3.5 w-3.5 text-emerald-700 dark:text-emerald-400" strokeWidth={1.5} />
                              Copiado
                            </>
                          ) : (
                            <>
                              <Copy className="h-3.5 w-3.5 text-stone-400" strokeWidth={1.5} />
                              Copiar Resumen ({filteredItems.length})
                            </>
                          )}
                        </button>
                      </div>

                      <div className="min-h-0 flex-1 overflow-auto rounded-lg border border-stone-200 dark:border-stone-800">
                        <table className="w-full border-collapse text-left text-xs">
                          <thead className="sticky top-0 z-10 border-b border-stone-200 bg-[#FAF9F6] text-[10px] font-medium uppercase tracking-wider text-stone-500 dark:border-stone-800 dark:bg-[#121110] dark:text-stone-400">
                            <tr>
                              <th className="px-3 py-2">#</th>
                              <th className="px-3 py-2">Orden &amp; Fecha</th>
                              <th className="px-3 py-2">Remitente</th>
                              <th className="px-3 py-2">Referencia</th>
                              <th className="px-3 py-2 text-right">Bruto</th>
                              <th className="px-3 py-2 text-right">Comisión</th>
                              <th className="px-3 py-2 text-right">Neto</th>
                              <th className="px-3 py-2 text-right">Captura</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-stone-200/80 bg-white dark:divide-stone-800 dark:bg-[#1C1A18]">
                            {filteredItems.length === 0 ? (
                              <tr>
                                <td colSpan={8} className="px-4 py-8 text-center text-stone-500 dark:text-stone-400">
                                  No hay pagos archivados que coincidan con tu búsqueda.
                                </td>
                              </tr>
                            ) : (
                              filteredItems.map((o, idx) => {
                                const isDirect = o.origen_registro === 'ADMIN_DIRECTA';
                                const b = Number(o.tx_monto_bruto ?? o.monto_esperado);
                                const c = Number(o.tx_monto_comision ?? 0);
                                const n = Number(o.tx_monto_neto ?? 0);
                                return (
                                  <tr key={o.id} className="hover:bg-[#FAF9F6] dark:hover:bg-stone-900/50">
                                    <td className="px-3 py-2 font-mono tabular-nums text-stone-400">
                                      {idx + 1}
                                    </td>
                                    <td className="whitespace-nowrap px-3 py-2">
                                      <span className="font-mono font-semibold text-stone-900 dark:text-stone-100">
                                        {o.codigo_orden}
                                      </span>
                                      {isDirect && (
                                        <span className="ml-1.5 rounded border border-stone-300 bg-stone-100 px-1 py-0.5 text-[9px] font-medium uppercase text-stone-600 dark:border-stone-700 dark:bg-stone-800 dark:text-stone-300">
                                          Directa
                                        </span>
                                      )}
                                      <div className="font-mono text-[10px] tabular-nums text-stone-500 dark:text-stone-400">
                                        {formatDateTime(o.tx_fecha_correo ?? o.created_at)}
                                      </div>
                                    </td>
                                    <td className="px-3 py-2">
                                      <div className="font-medium text-stone-900 dark:text-stone-100">
                                        {o.tx_remitente_correo || o.remitente_reportado}
                                      </div>
                                      {o.tx_remitente_correo &&
                                        o.remitente_reportado &&
                                        o.tx_remitente_correo.toLowerCase() !==
                                          o.remitente_reportado.toLowerCase() && (
                                          <div className="text-[10px] text-stone-500 dark:text-stone-400">
                                            Reportado: {o.remitente_reportado}
                                          </div>
                                        )}
                                    </td>
                                    <td className="whitespace-nowrap px-3 py-2 font-mono">
                                      <div className="text-stone-800 dark:text-stone-200">
                                        {o.tx_referencia_correo || o.referencia_reportada || 'SIN-REF'}
                                      </div>
                                      {o.tx_referencia_correo &&
                                        o.referencia_reportada &&
                                        o.tx_referencia_correo !== o.referencia_reportada && (
                                          <div className="text-[10px] text-stone-500 dark:text-stone-400">
                                            En orden: {o.referencia_reportada}
                                          </div>
                                        )}
                                    </td>
                                    <td className="whitespace-nowrap px-3 py-2 text-right font-mono tabular-nums text-stone-900 dark:text-stone-100">
                                      ${b.toFixed(2)}
                                    </td>
                                    <td className="whitespace-nowrap px-3 py-2 text-right font-mono tabular-nums text-stone-500 dark:text-stone-400">
                                      -${c.toFixed(2)}
                                    </td>
                                    <td className="whitespace-nowrap px-3 py-2 text-right font-mono font-semibold tabular-nums text-emerald-700 dark:text-emerald-400">
                                      +${n.toFixed(2)}
                                    </td>
                                    <td className="whitespace-nowrap px-3 py-2 text-right">
                                      {o.has_capture || o.comprobante_base64 ? (
                                        <button
                                          type="button"
                                          onClick={async () => {
                                            if (!o.comprobante_base64) {
                                              try {
                                                const res = await fetch(
                                                  `/api/reconciliation/capture?orderId=${encodeURIComponent(o.id)}`,
                                                  { credentials: 'same-origin' }
                                                );
                                                if (res.ok) {
                                                  const capData = await res.json();
                                                  if (capData.comprobante_base64) {
                                                    o.comprobante_base64 = capData.comprobante_base64;
                                                  }
                                                }
                                              } catch {
                                                // ignore
                                              }
                                            }
                                            setPreviewOrder({ ...o });
                                          }}
                                          className="inline-flex items-center gap-1 rounded border border-stone-200 bg-[#FAF9F6] px-2 py-1 text-[11px] font-medium text-stone-700 hover:bg-stone-100 dark:border-stone-800 dark:bg-[#121110] dark:text-stone-200"
                                        >
                                          <Eye className="h-3 w-3 text-stone-400" strokeWidth={1.5} />
                                          Ver
                                        </button>
                                      ) : (
                                        <span className="text-[10px] text-stone-400">
                                          Admin Directa
                                        </span>
                                      )}
                                    </td>
                                  </tr>
                                );
                              })
                            )}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  );
                })()
              )}
            </Dialog.Content>
          </Dialog.Portal>
        </Dialog.Root>

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
            <Dialog.Overlay className="fixed inset-0 z-50 bg-stone-950/50 backdrop-blur-sm" />
            <Dialog.Content className="fixed left-1/2 top-1/2 z-50 w-[94vw] max-w-lg -translate-x-1/2 -translate-y-1/2 rounded-xl border border-stone-200/90 bg-white p-5 text-stone-900 shadow-2xl dark:border-stone-800 dark:bg-[#1C1A18] dark:text-stone-100">
              <div className="flex items-center justify-between border-b border-stone-200 pb-3 dark:border-stone-800">
                <Dialog.Title className="font-serif text-lg font-medium tracking-tight text-stone-900 dark:text-stone-100">
                  Comprobante {previewOrder?.codigo_orden}
                </Dialog.Title>
                <Dialog.Close asChild>
                  <button
                    type="button"
                    className="rounded-lg p-1 text-stone-400 hover:bg-stone-100 hover:text-stone-700 dark:hover:bg-stone-800 dark:hover:text-stone-200"
                  >
                    <X className="h-4 w-4" strokeWidth={1.5} />
                  </button>
                </Dialog.Close>
              </div>
              {previewOrder?.comprobante_base64 && (
                <div className="mt-4 space-y-3">
                  <div className="flex justify-center rounded-xl border border-stone-200 bg-[#FAF9F6] p-3 dark:border-stone-800 dark:bg-[#121110]">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={previewOrder.comprobante_base64}
                      alt={`Comprobante ${previewOrder.codigo_orden}`}
                      className="max-h-[460px] rounded-lg object-contain"
                    />
                  </div>
                  <div className="rounded-xl border border-stone-200 bg-[#FAF9F6] p-3 text-xs text-stone-600 dark:border-stone-800 dark:bg-[#121110] dark:text-stone-300">
                    <div>
                      Plataforma: <strong className="text-stone-900 dark:text-stone-100">{previewOrder.plataforma_esperada}</strong> · Monto:{' '}
                      <strong className="font-mono tabular-nums text-stone-900 dark:text-stone-100">
                        {formatAmount(previewOrder.monto_esperado, previewOrder.moneda)}
                      </strong>
                    </div>
                    <div className="mt-1 font-mono text-stone-500 dark:text-stone-400">
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
            <Dialog.Overlay className="fixed inset-0 z-50 bg-stone-950/50 backdrop-blur-sm" />
            <Dialog.Content className="fixed left-1/2 top-1/2 z-50 w-[94vw] max-w-md -translate-x-1/2 -translate-y-1/2 rounded-xl border border-stone-200/90 bg-white p-6 text-stone-900 shadow-2xl dark:border-stone-800 dark:bg-[#1C1A18] dark:text-stone-100">
              <div className="flex flex-col items-center text-center">
                {successOrderModal?.instant ? (
                  <div className="mb-3 flex h-14 w-14 items-center justify-center rounded-xl border border-emerald-700/20 bg-emerald-50 text-emerald-700 dark:border-emerald-500/30 dark:bg-emerald-950/40 dark:text-emerald-400">
                    <CheckCircle2 className="h-7 w-7" strokeWidth={1.5} />
                  </div>
                ) : (
                  <div className="mb-3 flex h-14 w-14 items-center justify-center rounded-xl border border-amber-700/25 bg-amber-50 text-amber-700 dark:border-amber-500/35 dark:bg-amber-950/40 dark:text-amber-400">
                    <Clock className="h-7 w-7" strokeWidth={1.5} />
                  </div>
                )}

                <Dialog.Title className="font-serif text-xl font-medium tracking-tight text-stone-900 dark:text-stone-100">
                  {successOrderModal?.instant
                    ? 'Pago Conciliado Instantáneamente'
                    : 'Carga Registrada con Éxito'}
                </Dialog.Title>

                <Dialog.Description className="mt-1.5 text-xs text-stone-500 dark:text-stone-400">
                  {successOrderModal?.instant
                    ? 'Tu comprobante coincidió al instante con el extracto bancario. Tu saldo ha sido acreditado inmediatamente.'
                    : 'Tu comprobante y reporte fueron guardados. El sistema conciliará y acreditará tu saldo de forma automática al recibir la confirmación bancaria.'}
                </Dialog.Description>

                {/* Tarjeta de detalles del pago reportado */}
                {successOrderModal?.order && (
                  <div className="mt-5 w-full space-y-2.5 rounded-xl border border-stone-200 bg-[#FAF9F6] p-4 text-left text-xs dark:border-stone-800 dark:bg-[#121110]">
                    <div className="flex items-center justify-between border-b border-stone-200 pb-2 dark:border-stone-800">
                      <span className="text-stone-500 dark:text-stone-400">Código de Orden:</span>
                      <span className="font-mono font-semibold text-stone-900 dark:text-stone-100">
                        {successOrderModal.order.codigo_orden}
                      </span>
                    </div>

                    <div className="flex items-center justify-between border-b border-stone-200 pb-2 dark:border-stone-800">
                      <span className="text-stone-500 dark:text-stone-400">Monto Reportado:</span>
                      <span className="font-mono text-sm font-semibold tabular-nums text-stone-900 dark:text-stone-100">
                        {formatAmount(
                          successOrderModal.order.monto_esperado,
                          successOrderModal.order.moneda
                        )}
                      </span>
                    </div>

                    {successOrderModal.order.fecha_transferencia && (
                      <div className="flex items-center justify-between border-b border-stone-200 pb-2 dark:border-stone-800">
                        <span className="text-stone-500 dark:text-stone-400">Fecha Transferencia:</span>
                        <span className="font-mono tabular-nums text-stone-800 dark:text-stone-200">
                          {successOrderModal.order.fecha_transferencia}
                        </span>
                      </div>
                    )}

                    <div className="flex items-center justify-between border-b border-stone-200 pb-2 dark:border-stone-800">
                      <span className="text-stone-500 dark:text-stone-400">Destino / Banco:</span>
                      <span className="font-medium text-stone-800 dark:text-stone-200">
                        {successOrderModal.order.plataforma_esperada || successOrderModal.order.banco_destino}
                      </span>
                    </div>

                    <div className="flex items-center justify-between border-b border-stone-200 pb-2 dark:border-stone-800">
                      <span className="text-stone-500 dark:text-stone-400">Titular Remitente:</span>
                      <span className="font-medium text-stone-800 dark:text-stone-200">
                        {successOrderModal.order.remitente_reportado || successOrderModal.order.nombre_remitente_reportado}
                      </span>
                    </div>

                    {successOrderModal.order.referencia_reportada && (
                      <div className="flex items-center justify-between border-b border-stone-200 pb-2 dark:border-stone-800">
                        <span className="text-stone-500 dark:text-stone-400">Referencia / TxID:</span>
                        <span className="font-mono text-stone-700 dark:text-stone-300">
                          {successOrderModal.order.referencia_reportada}
                        </span>
                      </div>
                    )}

                    <div className="flex items-center justify-between pt-1">
                      <span className="text-stone-500 dark:text-stone-400">Estado:</span>
                      {successOrderModal.instant ? (
                        <span className="inline-flex items-center gap-1 rounded-full border border-emerald-700/20 bg-emerald-50 px-2 py-0.5 text-[11px] font-medium text-emerald-700 dark:border-emerald-500/30 dark:bg-emerald-950/40 dark:text-emerald-400">
                          <CheckCircle2 className="h-3 w-3" strokeWidth={1.5} /> Conciliado
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 rounded-full border border-amber-700/25 bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-800 dark:border-amber-500/35 dark:bg-amber-950/40 dark:text-amber-400">
                          <Clock className="h-3 w-3" strokeWidth={1.5} /> Verificando en Banco
                        </span>
                      )}
                    </div>
                  </div>
                )}

                <div className="mt-6 flex w-full gap-3">
                  <Dialog.Close asChild>
                    <button
                      type="button"
                      className="w-full rounded-lg bg-stone-900 py-2.5 text-sm font-medium text-stone-50 shadow-sm transition hover:bg-stone-800 dark:bg-stone-100 dark:text-stone-950 dark:hover:bg-white"
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
          <div className="fixed bottom-5 right-5 z-50 flex max-w-sm items-start gap-3 rounded-xl border border-stone-200/90 bg-white p-4 text-stone-900 shadow-xl dark:border-stone-800 dark:bg-[#1C1A18] dark:text-stone-100">
            {showToast.type === 'instant' || showToast.type === 'success' ? (
              <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-700 dark:text-emerald-400" strokeWidth={1.5} />
            ) : (
              <X className="mt-0.5 h-5 w-5 shrink-0 text-rose-700 dark:text-rose-400" strokeWidth={1.5} />
            )}
            <div className="flex-1">
              <h5 className="text-xs font-semibold text-stone-900 dark:text-stone-100">{showToast.title}</h5>
              <p className="mt-0.5 text-xs text-stone-500 dark:text-stone-400">{showToast.message}</p>
              {showToast.codigo && (
                <span className="mt-1 inline-block font-mono text-[10px] font-semibold text-emerald-700 dark:text-emerald-400">
                  {showToast.codigo}
                </span>
              )}
            </div>
            <button
              type="button"
              onClick={() => setShowToast(null)}
              className="rounded p-1 text-stone-400 hover:text-stone-700 dark:hover:text-stone-200"
            >
              <X className="h-3.5 w-3.5" strokeWidth={1.5} />
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
