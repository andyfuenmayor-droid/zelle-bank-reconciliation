'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import * as Dialog from '@radix-ui/react-dialog';
import {
  AlertCircle,
  AlertTriangle,
  ArrowDownLeft,
  ArrowUpRight,
  Bot,
  Briefcase,
  Building2,
  Check,
  CheckCircle2,
  ChevronDown,
  Clock,
  Coins,
  Copy,
  Cpu,
  CreditCard,
  DollarSign,
  ExternalLink,
  Eye,
  FilePlus2,
  FileText,
  Filter,
  Globe,
  HelpCircle,
  ImageIcon,
  Inbox,
  KeyRound,
  Loader2,
  Lock,
  LogIn,
  LogOut,
  Mail,
  MailPlus,
  Pencil,
  Plus,
  RefreshCw,
  RotateCcw,
  Search,
  Server,
  Sparkles,
  Trash2,
  UserCheck,
  UserPlus,
  Users,
  Wallet,
  X,
} from 'lucide-react';
import LandingPageView from '@/components/LandingPageView';
import ThemeToggle from '@/components/ThemeToggle';
import {
  AlertStatus,
  AssignedReceivingAccount,
  BankEmailAlertRecord,
  BusinessUserRecord,
  BusinessUserRole,
  ClientAccountRecord,
  ClientLiquidationRecord,
  CurrencyType,
  ExpectedPlatformType,
  FinancialSummaryMetrics,
  ImapMailboxRecord,
  LiquidationPaymentMethod,
  MovementType,
  PendingPaymentOrder,
  PlatformType,
} from '@/types/reconciliation';

const STORAGE_BUSINESS_USER_KEY = 'fintech_business_user_id';
const STORAGE_ACTIVE_NEGOCIO_KEY = 'fintech_active_negocio_id';

type ActiveTab =
  | 'ALERTS'
  | 'EXPENSES'
  | 'CLIENTS'
  | 'LIQUIDATIONS'
  | 'MAILBOXES'
  | 'BUSINESS_USERS';

interface LightboxContext {
  title: string;
  comprobanteBase64: string;
  order: PendingPaymentOrder | null;
  tx: BankEmailAlertRecord | null;
}

function formatMoney(amount: number, currency: CurrencyType | string = 'USD'): string {
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
  return `${sign}$${formatted}`;
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

function getPlatformBadgeMeta(platform: PlatformType): {
  label: string;
  badgeClass: string;
} {
  switch (platform) {
    case 'CITIBANK':
      return {
        label: 'Citibank',
        badgeClass:
          'border-stone-300 bg-stone-100 text-stone-700 dark:border-stone-700 dark:bg-stone-800/80 dark:text-stone-300',
      };
    case 'TD_BANK':
      return {
        label: 'TD Bank',
        badgeClass:
          'border-emerald-700/25 bg-emerald-50 text-emerald-800 dark:border-emerald-500/30 dark:bg-emerald-950/40 dark:text-emerald-400',
      };
    case 'BINANCE_PAY':
      return {
        label: 'Binance Pay',
        badgeClass:
          'border-amber-700/25 bg-amber-50 text-amber-800 dark:border-amber-500/30 dark:bg-amber-950/40 dark:text-amber-400',
      };
    case 'BINANCE_P2P':
      return {
        label: 'Binance P2P',
        badgeClass:
          'border-amber-700/25 bg-amber-50/70 text-amber-800 dark:border-amber-500/30 dark:bg-amber-950/30 dark:text-amber-400',
      };
    case 'BINANCE_ONCHAIN':
      return {
        label: 'Depósito Red',
        badgeClass:
          'border-stone-300 bg-stone-100 text-stone-700 dark:border-stone-700 dark:bg-stone-800/80 dark:text-stone-300',
      };
    default:
      return {
        label: 'Otro',
        badgeClass:
          'border-stone-300 bg-stone-100 text-stone-600 dark:border-stone-700 dark:bg-stone-800 dark:text-stone-400',
      };
  }
}

function platformDefaultLabel(platform: ExpectedPlatformType): string {
  switch (platform) {
    case 'CITIBANK':
      return 'Citibank Zelle';
    case 'TD_BANK':
      return 'TD Bank Zelle';
    case 'BINANCE_PAY':
      return 'Binance Pay';
    case 'BINANCE_P2P':
      return 'Binance P2P';
    case 'BINANCE_ONCHAIN':
      return 'Depósito Red USDT';
  }
}

function platformDefaultCurrency(platform: ExpectedPlatformType): CurrencyType {
  return platform.startsWith('BINANCE') ? 'USDT' : 'USD';
}

function mapMailboxesToAssignedAccounts(
  list: ReadonlyArray<ImapMailboxRecord>
): AssignedReceivingAccount[] {
  return list
    .filter((mb) => mb.activo)
    .map((mb) => {
      const plat: ExpectedPlatformType = mb.plataforma ?? 'CITIBANK';
      const curr: CurrencyType = mb.moneda ?? platformDefaultCurrency(plat);
      return {
        id: mb.id,
        mailbox_id: mb.id,
        plataforma: plat,
        alias: mb.alias || platformDefaultLabel(plat),
        cuenta_receptora: mb.cuenta_receptora || mb.email_address,
        moneda: curr,
      };
    });
}

function normalizeCleanText(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim();
}

function levenshteinDistance(s1: string, s2: string): number {
  const m = s1.length;
  const n = s2.length;
  if (m === 0) return n;
  if (n === 0) return m;
  const dp: number[][] = Array.from({ length: m + 1 }, () =>
    new Array<number>(n + 1).fill(0)
  );
  for (let i = 0; i <= m; i++) dp[i]![0] = i;
  for (let j = 0; j <= n; j++) dp[0]![j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = s1[i - 1] === s2[j - 1] ? 0 : 1;
      dp[i]![j] = Math.min(
        dp[i - 1]![j]! + 1,
        dp[i]![j - 1]! + 1,
        dp[i - 1]![j - 1]! + cost
      );
      if (
        i > 1 &&
        j > 1 &&
        s1[i - 1] === s2[j - 2] &&
        s1[i - 2] === s2[j - 1]
      ) {
        dp[i]![j] = Math.min(dp[i]![j]!, dp[i - 2]![j - 2]! + 1);
      }
    }
  }
  return dp[m]![n]!;
}

const CORPORATE_STOP_WORDS = new Set([
  'corp',
  'corporation',
  'llc',
  'inc',
  'ca',
  'sa',
  'ltd',
  'cia',
  'co',
]);

function tokenSimilarityScore(t1: string, t2: string): number {
  if (!t1 || !t2) return 0;
  if (t1 === t2) return 1.0;

  // Inicial de 1 letra (ej. "J" en "J Fernandez" concuerda con "Jaison", "A" en "Roberto A" o "Juan A")
  if (t1.length === 1 && t2.length >= 2 && t2.startsWith(t1)) return 0.9;
  if (t2.length === 1 && t1.length >= 2 && t1.startsWith(t2)) return 0.9;

  // Prefijo o plural (ej. "solution" vs "solutions", "sarai" vs "sarais")
  if (
    t1.length >= 3 &&
    t2.length >= 3 &&
    (t2.startsWith(t1) || t1.startsWith(t2))
  ) {
    return 0.92;
  }

  // Transposición exacta de letras (ej. "jhon" vs "john")
  if (
    t1.length === t2.length &&
    t1.length >= 3 &&
    t1.split('').sort().join('') === t2.split('').sort().join('')
  ) {
    return 0.95;
  }

  // Variación fonética o de tipeo (ej. "enderbeth" vs "enderberth", "johandry" vs "jhandry",
  // "wuilliams" vs "william", "arima" vs "aroma"/"arina", "lfs" vs "les", "haber" vs "hebert")
  const maxLen = Math.max(t1.length, t2.length);
  if (maxLen >= 3) {
    const dist = levenshteinDistance(t1, t2);
    const ratio = 1 - dist / maxLen;
    if (maxLen === 3 && dist === 1) return 0.78;
    if (ratio >= 0.66) return ratio;
  }

  return 0;
}

function calculateSenderSimilarity(a: string, b: string): number {
  const normA = normalizeCleanText(a).replace(/[^a-z0-9\s]/g, ' ');
  const normB = normalizeCleanText(b).replace(/[^a-z0-9\s]/g, ' ');
  if (!normA || !normB) return 0;
  if (normA === normB) return 1;
  if (normA.includes(normB) || normB.includes(normA)) return 0.9;

  const rawTokensA = normA.split(/\s+/).filter(Boolean);
  const rawTokensB = normB.split(/\s+/).filter(Boolean);
  const tokensA = rawTokensA.filter((t) => !CORPORATE_STOP_WORDS.has(t));
  const tokensB = rawTokensB.filter((t) => !CORPORATE_STOP_WORDS.has(t));
  const listA = tokensA.length > 0 ? tokensA : rawTokensA;
  const listB = tokensB.length > 0 ? tokensB : rawTokensB;
  if (listA.length === 0 || listB.length === 0) return 0;

  let matchedScoreSum = 0;
  let strongMatchedTokens = 0;
  for (const tA of listA) {
    let bestForToken = 0;
    for (const tB of listB) {
      const s = tokenSimilarityScore(tA, tB);
      if (s > bestForToken) bestForToken = s;
    }
    if (bestForToken >= 0.66) {
      matchedScoreSum += bestForToken;
      strongMatchedTokens++;
    }
  }

  const firstTokenScore =
    listA[0] && listB[0] ? tokenSimilarityScore(listA[0], listB[0]) : 0;

  // Si ambos nombres tienen >=2 palabras, solo comparten 1 apellido y el primer nombre no tiene ninguna similitud
  // (ej. "Yeilyn Villalobos" vs "Andry Villalobos"), devolver 0.45 (coincide 1 apellido, pero requiere validar referencia)
  if (
    listA.length >= 2 &&
    listB.length >= 2 &&
    strongMatchedTokens === 1 &&
    firstTokenScore < 0.66
  ) {
    return 0.45;
  }

  return Math.min(1, (2 * matchedScoreSum) / (listA.length + listB.length));
}

function referencesMatch(
  orderRef: string | null | undefined,
  txRef: string | null | undefined
): boolean {
  if (!orderRef || !txRef) return false;
  const cleanOrder = orderRef.toUpperCase().replace(/[^A-Z0-9]/g, '');
  const cleanTx = txRef.toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (cleanOrder.length < 4 || cleanTx.length < 4) return false;
  const genericList = [
    'SINREF',
    'NOREF',
    'NA',
    'NONE',
    'NULL',
    'CITIBANK',
    'ZELLE',
    'PAGO',
    'TRANSFERENCIA',
    'BANKOFAMERICA',
  ];
  if (genericList.includes(cleanOrder) || genericList.includes(cleanTx)) {
    return false;
  }

  if (
    cleanOrder === cleanTx ||
    cleanTx.includes(cleanOrder) ||
    cleanOrder.includes(cleanTx) ||
    (cleanOrder.length >= 6 &&
      cleanTx.length >= 6 &&
      cleanTx.endsWith(cleanOrder.slice(-6))) ||
    (cleanOrder.length >= 8 &&
      cleanTx.length >= 8 &&
      cleanTx.endsWith(cleanOrder.slice(-8)))
  ) {
    return true;
  }

  // Tolerancia de 1 carácter por lectura OCR en códigos largos (>= 8 caracteres):
  // cubre sustitución (ej. "j4b3143dk" vs "BACJ4B3I43DK"), 1 letra extra insertada
  // (ej. "WFCT22VQRNYPS" vs "WFCT22VQRNYS") o 1 letra omitida.
  if (cleanOrder.length >= 8 && cleanTx.length >= 8) {
    if (
      Math.abs(cleanOrder.length - cleanTx.length) <= 1 &&
      levenshteinDistance(cleanOrder, cleanTx) <= 1
    ) {
      return true;
    }
    if (cleanTx.length >= cleanOrder.length) {
      const txSuffix = cleanTx.slice(-cleanOrder.length);
      if (levenshteinDistance(cleanOrder, txSuffix) <= 1) {
        return true;
      }
    }
    if (cleanOrder.length >= 9 && cleanTx.length >= cleanOrder.length - 1) {
      const txSuffixShort = cleanTx.slice(-(cleanOrder.length - 1));
      if (levenshteinDistance(cleanOrder, txSuffixShort) <= 1) {
        return true;
      }
    }
  }

  return false;
}

function isSpecificAlphanumericBankRef(ref: string | null | undefined): boolean {
  if (!ref) return false;
  const clean = ref.toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (clean.length < 5) return false;
  if (/^[0-9]+$/.test(clean)) return false;
  const genericList = [
    'SINREF',
    'NOREF',
    'NA',
    'NONE',
    'NULL',
    'CITIBANK',
    'TDBANK',
    'WELLSFARGO',
    'ZELLE',
    'PAGO',
    'TRANSFERENCIA',
    'BANKOFAMERICA',
    'COMPROBANTE',
  ];
  return !genericList.includes(clean);
}

function getDateDistanceDaysVe(
  txTimestamp: string | null | undefined,
  orderDateYmd: string | null | undefined
): number {
  if (!txTimestamp || !orderDateYmd || !/^\d{4}-\d{2}-\d{2}$/.test(orderDateYmd.trim())) {
    return 9999;
  }
  const d = new Date(txTimestamp);
  if (Number.isNaN(d.getTime())) {
    return 9999;
  }
  try {
    const txYmd = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/Caracas',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(d);
    const t1 = Date.parse(`${txYmd}T12:00:00Z`);
    const t2 = Date.parse(`${orderDateYmd.trim()}T12:00:00Z`);
    if (Number.isNaN(t1) || Number.isNaN(t2)) return 9999;
    return Math.abs(Math.round((t1 - t2) / 86400000));
  } catch {
    return 9999;
  }
}

function findBestCandidateTxForOrder(
  order: PendingPaymentOrder,
  alertsList: BankEmailAlertRecord[]
): {
  tx: BankEmailAlertRecord | null;
  matchType: 'LINKED' | 'REF' | 'SENDER' | 'NONE';
  sameAmountCount: number;
} {
  const linked = alertsList.find((t) => t.orden_conciliada_id === order.id) ?? null;
  if (linked) {
    return { tx: linked, matchType: 'LINKED', sameAmountCount: 1 };
  }

  const eligible = alertsList.filter(
    (a) =>
      a.estado !== 'CONCILIADO' &&
      a.estado !== 'DESCARTADO' &&
      !a.liquidado_at &&
      a.tipo_movimiento === 'RECIBIDO' &&
      a.moneda === order.moneda &&
      Math.abs(a.monto_bruto - order.monto_esperado) < 0.01
  );

  if (eligible.length === 0) {
    return { tx: null, matchType: 'NONE', sameAmountCount: 0 };
  }

  const orderSender =
    order.remitente_reportado || order.nombre_remitente_reportado || '';

  // Prioridad 1: Coincidencia de referencia bancaria (exacta, sufijo o tolerancia OCR 1 carácter)
  const refMatches = eligible
    .filter((a) => referencesMatch(order.referencia_reportada, a.referencia))
    .map((a) => ({
      tx: a,
      dayDiff: getDateDistanceDaysVe(a.fecha_transaccion, order.fecha_transferencia),
      sim: calculateSenderSimilarity(orderSender, a.remitente_o_contraparte || ''),
    }))
    .sort((a, b) => {
      if (a.dayDiff !== b.dayDiff) return a.dayDiff - b.dayDiff;
      if (b.sim !== a.sim) return b.sim - a.sim;
      return new Date(a.tx.fecha_transaccion).getTime() - new Date(b.tx.fecha_transaccion).getTime();
    });

  if (refMatches.length > 0 && refMatches[0]) {
    return {
      tx: refMatches[0].tx,
      matchType: 'REF',
      sameAmountCount: eligible.length,
    };
  }

  // Si la orden tiene una referencia bancaria alfanumérica específica que NO coincide con ningún correo,
  // NO asumir otro correo del mismo remitente con referencia distinta (evita cruzar pagos de fechas diferentes).
  if (isSpecificAlphanumericBankRef(order.referencia_reportada)) {
    return { tx: null, matchType: 'NONE', sameAmountCount: eligible.length };
  }

  // Prioridad 2: Coincidencia por remitente (>= 0.65) desempatando SIEMPRE por cercanía a fecha_transferencia
  const senderMatches = eligible
    .map((a) => ({
      tx: a,
      dayDiff: getDateDistanceDaysVe(a.fecha_transaccion, order.fecha_transferencia),
      sim: calculateSenderSimilarity(orderSender, a.remitente_o_contraparte || ''),
    }))
    .filter((c) => c.sim >= 0.65)
    .sort((a, b) => {
      if (a.dayDiff !== b.dayDiff) return a.dayDiff - b.dayDiff;
      if (b.sim !== a.sim) return b.sim - a.sim;
      return new Date(a.tx.fecha_transaccion).getTime() - new Date(b.tx.fecha_transaccion).getTime();
    });

  if (senderMatches.length > 0 && senderMatches[0]) {
    return {
      tx: senderMatches[0].tx,
      matchType: 'SENDER',
      sameAmountCount: eligible.length,
    };
  }

  return { tx: null, matchType: 'NONE', sameAmountCount: eligible.length };
}

const SAMPLE_TEMPLATES: ReadonlyArray<{
  label: string;
  from: string;
  subject: string;
  body: string;
}> = [
  {
    label: 'Citibank Zelle (Inglés)',
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
    label: 'TD Bank Zelle LLC (Inglés)',
    from: 'no-reply@tdbank.com',
    subject: 'TD Bank: Zelle® payment deposited',
    body: `TD Bank Online Banking Alert
Zelle® payment from GLOBAL LOGISTICS HOLDINGS LLC has been deposited into your account.
Amount: $1,850.00
Sender Name: GLOBAL LOGISTICS HOLDINGS LLC
Confirmation Code: TDZ77482910`,
  },
  {
    label: 'Citibank Zelle (Español)',
    from: 'notificaciones@alerts.citibank.com',
    subject: 'Alerta de Citibank: Recibiste un pago con Zelle®',
    body: `Hola:
Has recibido un pago con Zelle® de GABRIELA CAROLINA MENDEZ por $780.00 en tu cuenta corriente.
Monto: $780.00
Remitente: GABRIELA CAROLINA MENDEZ
Número de confirmación: CITI330194827`,
  },
  {
    label: 'Binance Pay Recibido (USDT)',
    from: 'do-not-reply@binance.com',
    subject: 'Binance Pay: You have received 320.00 USDT',
    body: `Binance Pay Notification
You have received 320.00 USDT via Binance Pay.
From: CarlosMendoza_Pay
Amount: 320.00 USDT
Transaction ID: 293849208877`,
  },
  {
    label: 'Binance P2P Completado (USDT)',
    from: 'directmail.binance.com <do-not-reply@directmail.binance.com>',
    subject: '[Binance] P2P Order Completed - 206649182736999',
    body: `Binance P2P Order Completed
Order Type: BUY
Amount: 640.00 USDT
Counterparty: AndesExchange_VE
Order Number: 206649182736999`,
  },
  {
    label: 'Binance On-Chain Depósito TRC20',
    from: 'do-not-reply@binance.com',
    subject: '[Binance] Deposit Confirmed - 500.00 USDT',
    body: `Deposit Confirmed
Your deposit of 500.00 USDT has been credited to your Binance spot wallet.
Network: TRX (TRC20)
TxID: TX88492011A9F82C1`,
  },
];

export default function BankReconciliationPanel(): React.JSX.Element {
  // Autenticación y Multi-Negocio
  const [currentBusinessUser, setCurrentBusinessUser] =
    useState<BusinessUserRecord | null>(null);
  const [businessUsers, setBusinessUsers] = useState<BusinessUserRecord[]>([]);
  const [activeNegocioId, setActiveNegocioId] = useState<string>('');
  const [isCheckingAuth, setIsCheckingAuth] = useState<boolean>(true);
  const [isLoginModalOpen, setIsLoginModalOpen] = useState<boolean>(false);
  const [loginEmail, setLoginEmail] = useState<string>('');
  const [loginPassword, setLoginPassword] = useState<string>('');
  const [loginError, setLoginError] = useState<string | null>(null);
  const [isSubmittingLogin, setIsSubmittingLogin] = useState<boolean>(false);
  const [isPreviewingLanding, setIsPreviewingLanding] = useState<boolean>(false);

  // Modal Crear / Editar Cuenta de Negocio
  const [isBusinessUserModalOpen, setIsBusinessUserModalOpen] =
    useState<boolean>(false);
  const [editingBusinessUserId, setEditingBusinessUserId] = useState<
    string | null
  >(null);
  const [bizName, setBizName] = useState<string>('');
  const [bizOwnerName, setBizOwnerName] = useState<string>('');
  const [bizEmail, setBizEmail] = useState<string>('');
  const [bizPhone, setBizPhone] = useState<string>('');
  const [bizPassword, setBizPassword] = useState<string>('');
  const [bizRole, setBizRole] = useState<BusinessUserRole>('NEGOCIO');
  const [isSavingBusinessUser, setIsSavingBusinessUser] =
    useState<boolean>(false);
  const [lastBusinessCredentials, setLastBusinessCredentials] = useState<{
    negocio: string;
    email: string;
    password: string;
  } | null>(null);

  const [activeTab, setActiveTab] = useState<ActiveTab>('ALERTS');

  const [alerts, setAlerts] = useState<BankEmailAlertRecord[]>([]);
  const [serverSummaryMetrics, setServerSummaryMetrics] =
    useState<FinancialSummaryMetrics | null>(null);
  const [pendingOrders, setPendingOrders] = useState<PendingPaymentOrder[]>([]);
  const [clients, setClients] = useState<ClientAccountRecord[]>([]);
  const [liquidations, setLiquidations] = useState<ClientLiquidationRecord[]>([]);
  const [mailboxes, setMailboxes] = useState<ImapMailboxRecord[]>([]);
  const [dataSourceMode, setDataSourceMode] = useState<
    'POSTGRESQL_LIVE' | 'DEMO_FALLBACK'
  >('DEMO_FALLBACK');

  // Filtros
  const [platformFilter, setPlatformFilter] = useState<'TODOS' | PlatformType>(
    'TODOS'
  );
  const [movementFilter, setMovementFilter] = useState<'TODOS' | MovementType>(
    'RECIBIDO'
  );
  const [statusFilter, setStatusFilter] = useState<'TODOS' | AlertStatus>(
    'TODOS'
  );
  const [showLiquidatedHistory, setShowLiquidatedHistory] =
    useState<boolean>(false);
  const [selectedCycleFilter, setSelectedCycleFilter] =
    useState<string>('ACTIVO');
  const [showDiscardedHistory, setShowDiscardedHistory] =
    useState<boolean>(false);
  const [selectedClientFilter, setSelectedClientFilter] = useState<string>('TODOS');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [liqSearch, setLiqSearch] = useState<string>('');
  const [liqMethodFilter, setLiqMethodFilter] = useState<string>('TODOS');

  // Selección por Lotes (Bulk Actions)
  const [selectedAlertIds, setSelectedAlertIds] = useState<string[]>([]);
  const [isBatchModalOpen, setIsBatchModalOpen] = useState<boolean>(false);
  const [batchTargetClient, setBatchTargetClient] = useState<string>('');
  const [batchNotes, setBatchNotes] = useState<string>('');
  const [isSubmittingBatch, setIsSubmittingBatch] = useState<boolean>(false);

  // Estados UI / Feedback
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [isSyncingImap, setIsSyncingImap] = useState<boolean>(false);
  const [portalLinkCopied, setPortalLinkCopied] = useState<boolean>(false);
  const [bannerMessage, setBannerMessage] = useState<{
    type: 'success' | 'info' | 'warning' | 'error';
    text: string;
  } | null>(null);

  // Modal Conciliación Manual
  const [selectedAlertForMatch, setSelectedAlertForMatch] =
    useState<BankEmailAlertRecord | null>(null);
  const [selectedOrderId, setSelectedOrderId] = useState<string>('');
  const [manualClientName, setManualClientName] = useState<string>('');
  const [manualNotes, setManualNotes] = useState<string>('');
  const [isSubmittingMatch, setIsSubmittingMatch] = useState<boolean>(false);

  // Modal Confirmación Manual de Orden / Captura del Cliente (Sin Correo Bancario o Vinculando Correo)
  const [selectedOrderForManualConfirm, setSelectedOrderForManualConfirm] =
    useState<PendingPaymentOrder | null>(null);
  const [orderConfirmLinkedTxId, setOrderConfirmLinkedTxId] =
    useState<string>('');
  const [orderConfirmNotes, setOrderConfirmNotes] = useState<string>('');
  const [isSubmittingOrderConfirm, setIsSubmittingOrderConfirm] =
    useState<boolean>(false);
  const [isRejectingOrderId, setIsRejectingOrderId] = useState<string | null>(
    null
  );

  // Modal Reversión / Deshacer Conciliación
  const [alertToRevert, setAlertToRevert] =
    useState<BankEmailAlertRecord | null>(null);
  const [revertReason, setRevertReason] = useState<string>('');
  const [isSubmittingRevert, setIsSubmittingRevert] = useState<boolean>(false);

  // Modal Eliminar / Descartar Correos Propios o Ajenos a la Conciliación
  const [alertsToDiscard, setAlertsToDiscard] = useState<BankEmailAlertRecord[]>([]);
  const [discardReason, setDiscardReason] = useState<string>(
    'Correo propio / no corresponde a conciliación'
  );
  const [isSubmittingDiscard, setIsSubmittingDiscard] = useState<boolean>(false);
  const [restoringAlertId, setRestoringAlertId] = useState<string | null>(null);

  // Modal Inspector Crudo / Payload
  const [inspectedAlert, setInspectedAlert] =
    useState<BankEmailAlertRecord | null>(null);

  // Lightbox Visor de Captura Lado a Lado
  const [lightboxData, setLightboxData] = useState<LightboxContext | null>(
    null
  );

  // Modal Simulador Multi-Canal
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

  // Modal Crear / Editar Cliente y Credenciales del Portal
  const [isNewClientModalOpen, setIsNewClientModalOpen] =
    useState<boolean>(false);
  const [editingClientId, setEditingClientId] = useState<string | null>(null);
  const [newClientName, setNewClientName] = useState<string>('');
  const [newClientEmail, setNewClientEmail] = useState<string>('');
  const [newClientPhone, setNewClientPhone] = useState<string>('');
  const [newClientPin, setNewClientPin] = useState<string>('');
  const [newClientFeeZelle, setNewClientFeeZelle] = useState<string>('4.00');
  const [newClientFeeBinance, setNewClientFeeBinance] =
    useState<string>('1.50');
  const [newClientAssignedAccounts, setNewClientAssignedAccounts] = useState<
    AssignedReceivingAccount[]
  >([]);
  const [isSavingClient, setIsSavingClient] = useState<boolean>(false);
  const [lastPortalCredentials, setLastPortalCredentials] = useState<{
    nombre: string;
    email: string;
    pin: string;
  } | null>(null);

  // Modal y Gestión de Liquidaciones de Clientes
  const [isLiquidationModalOpen, setIsLiquidationModalOpen] = useState<boolean>(false);
  const [selectedClientForLiq, setSelectedClientForLiq] = useState<ClientAccountRecord | null>(null);
  const [liqMonto, setLiqMonto] = useState<string>('');
  const [liqMoneda, setLiqMoneda] = useState<CurrencyType>('USD');
  const [liqDestinatario, setLiqDestinatario] = useState<string>('');
  const [liqMotivo, setLiqMotivo] = useState<string>('');
  const [liqMetodo, setLiqMetodo] = useState<LiquidationPaymentMethod>('ZELLE');
  const [liqReferencia, setLiqReferencia] = useState<string>('');
  const [liqNotas, setLiqNotas] = useState<string>('');
  const [liqArchivar, setLiqArchivar] = useState<boolean>(true);
  const [isSubmittingLiquidation, setIsSubmittingLiquidation] = useState<boolean>(false);
  const [liquidationFeedback, setLiquidationFeedback] = useState<{
    ok: boolean;
    message: string;
  } | null>(null);

  // Modal de Auditoría de Ciclo Cerrado (Pagos y Capturas de una Liquidación)
  const [inspectedLiquidation, setInspectedLiquidation] =
    useState<ClientLiquidationRecord | null>(null);
  const [adminLiqItems, setAdminLiqItems] = useState<PendingPaymentOrder[]>([]);
  const [adminLiqSummary, setAdminLiqSummary] = useState<{
    totalCount: number;
    portalCount: number;
    directCount: number;
    totalBruto: number;
    totalComision: number;
    totalNeto: number;
  } | null>(null);
  const [isLoadingAdminLiqItems, setIsLoadingAdminLiqItems] =
    useState<boolean>(false);
  const [adminLiqItemsError, setAdminLiqItemsError] = useState<string | null>(
    null
  );
  const [adminLiqSearch, setAdminLiqSearch] = useState<string>('');

  // Estado exclusivamente visual (Cinta Financiera, Menú Acciones, Inspector Drawer bajo demanda)
  const [activeFinanceChannel, setActiveFinanceChannel] = useState<
    'ZELLE' | 'BINANCE'
  >('ZELLE');
  const [isActionsMenuOpen, setIsActionsMenuOpen] = useState<boolean>(false);
  const [selectedInspectorAlertId, setSelectedInspectorAlertId] = useState<
    string | null
  >(null);
  const [inspectorPreviewBase64, setInspectorPreviewBase64] = useState<
    string | null
  >(null);
  const [isLoadingInspectorPreview, setIsLoadingInspectorPreview] =
    useState<boolean>(false);
  const [isInspectorDrawerOpen, setIsInspectorDrawerOpen] =
    useState<boolean>(false);
  const [isPendingCapturesCollapsed, setIsPendingCapturesCollapsed] =
    useState<boolean>(false);
  const [copiedRefId, setCopiedRefId] = useState<string | null>(null);

  const openAdminLiquidationDetail = async (
    liq: ClientLiquidationRecord
  ): Promise<void> => {
    setInspectedLiquidation(liq);
    setAdminLiqItems([]);
    setAdminLiqSummary(null);
    setAdminLiqItemsError(null);
    setAdminLiqSearch('');
    setIsLoadingAdminLiqItems(true);

    try {
      const res = await fetch(
        `/api/reconciliation/liquidations/items?liquidacionId=${encodeURIComponent(
          liq.id
        )}`,
        {
          cache: 'no-store',
          credentials: 'same-origin',
          headers: buildScopeHeaders(false),
        }
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
          data.error ?? 'No se pudo cargar el detalle de pagos de esta liquidación.'
        );
      }
      setAdminLiqItems(data.items ?? []);
      setAdminLiqSummary(data.summary ?? null);
    } catch (err: unknown) {
      setAdminLiqItemsError(
        err instanceof Error
          ? err.message
          : 'Error consultando el historial archivado.'
      );
    } finally {
      setIsLoadingAdminLiqItems(false);
    }
  };

  // Modal Crear Orden Esperada
  const [isNewOrderModalOpen, setIsNewOrderModalOpen] =
    useState<boolean>(false);
  const [orderClientName, setOrderClientName] = useState<string>('');
  const [orderZelleSender, setOrderZelleSender] = useState<string>('');
  const [orderBank, setOrderBank] = useState<ExpectedPlatformType>('CITIBANK');
  const [orderCurrency, setOrderCurrency] = useState<CurrencyType>('USD');
  const [orderAmount, setOrderAmount] = useState<string>('');
  const [orderReference, setOrderReference] = useState<string>('');
  const [isSavingOrder, setIsSavingOrder] = useState<boolean>(false);

  // Formulario Buzón IMAP / Cuenta Receptora Monitoreada
  const [editingMailboxId, setEditingMailboxId] = useState<string | null>(null);
  const [mailboxAlias, setMailboxAlias] = useState<string>(
    'Buzón Principal Alertas Citibank, TD Bank & Binance'
  );
  const [mailboxEmail, setMailboxEmail] = useState<string>('');
  const [mailboxPassword, setMailboxPassword] = useState<string>('');
  const [mailboxHost, setMailboxHost] = useState<string>('imap.gmail.com');
  const [mailboxPort, setMailboxPort] = useState<string>('993');
  const [mailboxFolder, setMailboxFolder] = useState<string>('INBOX');
  const [mailboxBanks, setMailboxBanks] = useState<string>(
    'CITIBANK_TD_BINANCE'
  );
  const [mailboxPlatform, setMailboxPlatform] =
    useState<ExpectedPlatformType>('CITIBANK');
  const [mailboxReceivingAccount, setMailboxReceivingAccount] =
    useState<string>('');
  const [mailboxCurrency, setMailboxCurrency] = useState<CurrencyType>('USD');
  const [verifyImapBeforeSave, setVerifyImapBeforeSave] =
    useState<boolean>(true);
  const [isSavingMailbox, setIsSavingMailbox] = useState<boolean>(false);

  // Estados de Configuración de Inteligencia Artificial
  const [aiSettings, setAiSettings] = useState<{
    hasOpenAiKey: boolean;
    openAiKeyPreview: string;
    openAiModel: string;
    hasGeminiKey: boolean;
    geminiKeyPreview: string;
    geminiModel?: string;
    hasGroqKey?: boolean;
    groqKeyPreview?: string;
    groqModel?: string;
    aiProvider: string;
  } | null>(null);
  const [selectedAiProvider, setSelectedAiProvider] = useState<'gemini' | 'openai' | 'groq'>('gemini');
  const [openAiInputKey, setOpenAiInputKey] = useState<string>('');
  const [isSavingAiConfig, setIsSavingAiConfig] = useState<boolean>(false);
  const [isVerifyingAiConfig, setIsVerifyingAiConfig] = useState<boolean>(false);
  const [verifyFeedback, setVerifyFeedback] = useState<{
    ok: boolean;
    message: string;
  } | null>(null);

  const buildScopeHeaders = useCallback(
    (isJson = false): Record<string, string> => {
      const headers: Record<string, string> = {};
      if (isJson) {
        headers['content-type'] = 'application/json';
      }
      if (activeNegocioId) {
        headers['x-negocio-id'] = activeNegocioId;
      }
      return headers;
    },
    [activeNegocioId]
  );

  const currentBusinessUserId = currentBusinessUser?.id ?? '';
  const currentBusinessUserRol = currentBusinessUser?.rol ?? '';

  const fetchAllData = useCallback(async () => {
    if (!currentBusinessUserId || !activeNegocioId) {
      return;
    }

    setIsLoading(true);
    try {
      const reqHeaders = buildScopeHeaders(false);
      const alertQueryParams = new URLSearchParams();
      if (
        selectedCycleFilter !== 'ACTIVO' &&
        selectedCycleFilter !== 'TODOS'
      ) {
        alertQueryParams.set('liquidacionId', selectedCycleFilter);
      } else if (selectedCycleFilter === 'TODOS' || showLiquidatedHistory) {
        alertQueryParams.set('includeLiquidated', '1');
      }
      if (showDiscardedHistory) {
        alertQueryParams.set('includeDiscarded', '1');
      }
      const alertQueryStr = alertQueryParams.toString();
      const alertsUrl = alertQueryStr
        ? `/api/reconciliation/alerts?${alertQueryStr}`
        : '/api/reconciliation/alerts';
      const [alertsRes, clientsRes, mailboxesRes, authRes, liqRes] = await Promise.all([
        fetch(alertsUrl, {
          cache: 'no-store',
          credentials: 'same-origin',
          headers: reqHeaders,
        }),
        fetch('/api/reconciliation/clients', {
          cache: 'no-store',
          credentials: 'same-origin',
          headers: reqHeaders,
        }),
        fetch('/api/reconciliation/mailboxes', {
          cache: 'no-store',
          credentials: 'same-origin',
          headers: reqHeaders,
        }),
        fetch('/api/auth/business', {
          cache: 'no-store',
          credentials: 'same-origin',
        }),
        fetch('/api/reconciliation/liquidations', {
          cache: 'no-store',
          credentials: 'same-origin',
          headers: reqHeaders,
        }),
      ]);

      if (alertsRes.status === 401 || authRes.status === 401) {
        if (typeof window !== 'undefined') {
          window.localStorage.removeItem(STORAGE_BUSINESS_USER_KEY);
          window.localStorage.removeItem(STORAGE_ACTIVE_NEGOCIO_KEY);
        }
        setCurrentBusinessUser(null);
        setIsLoginModalOpen(true);
        return;
      }

      if (alertsRes.ok) {
        const data = (await alertsRes.json()) as {
          ok: boolean;
          mode?: 'POSTGRESQL_LIVE' | 'DEMO_FALLBACK';
          alerts?: BankEmailAlertRecord[];
          pendingOrders?: PendingPaymentOrder[];
          summaryMetrics?: FinancialSummaryMetrics | null;
        };
        if (data.ok && Array.isArray(data.alerts)) {
          setAlerts(data.alerts);
          setServerSummaryMetrics(data.summaryMetrics ?? null);
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

      if (authRes.ok) {
        const aData = (await authRes.json()) as {
          ok: boolean;
          user?: BusinessUserRecord;
          businessUsers?: BusinessUserRecord[];
        };
        if (aData.ok && aData.user) {
          const nextUser = aData.user;
          setCurrentBusinessUser((prev) => {
            if (
              prev &&
              prev.id === nextUser.id &&
              prev.email === nextUser.email &&
              prev.nombre_negocio === nextUser.nombre_negocio &&
              prev.rol === nextUser.rol &&
              prev.activo === nextUser.activo
            ) {
              return prev;
            }
            return nextUser;
          });
          if (Array.isArray(aData.businessUsers)) {
            setBusinessUsers(aData.businessUsers);
          }
        }
      }

      if (liqRes.ok) {
        const lData = (await liqRes.json()) as {
          ok: boolean;
          liquidaciones?: ClientLiquidationRecord[];
        };
        if (lData.ok && Array.isArray(lData.liquidaciones)) {
          setLiquidations(lData.liquidaciones);
        }
      }
    } catch {
      // Mantener estado actual si falla red
    } finally {
      setIsLoading(false);
    }
  }, [activeNegocioId, buildScopeHeaders, currentBusinessUserId, showLiquidatedHistory, selectedCycleFilter, showDiscardedHistory]);

  // Restaurar sesión de negocio desde localStorage y revisar ?login=1
  useEffect(() => {
    let active = true;
    const restoreSession = async (): Promise<void> => {
      if (typeof window === 'undefined') {
        return;
      }
      const params = new URLSearchParams(window.location.search);
      if (params.get('login') === '1') {
        setIsLoginModalOpen(true);
      }

      try {
        const res = await fetch('/api/auth/business', { cache: 'no-store' });
        if (!res.ok) {
          window.localStorage.removeItem(STORAGE_BUSINESS_USER_KEY);
          window.localStorage.removeItem(STORAGE_ACTIVE_NEGOCIO_KEY);
          return;
        }
        const data = (await res.json()) as {
          ok: boolean;
          mode?: 'POSTGRESQL_LIVE' | 'DEMO_FALLBACK';
          user?: BusinessUserRecord;
          businessUsers?: BusinessUserRecord[];
        };
        if (active && data.ok && data.user) {
          setCurrentBusinessUser(data.user);
          const list = data.businessUsers ?? [data.user];
          setBusinessUsers(list);
          const savedScope = window.localStorage.getItem(
            STORAGE_ACTIVE_NEGOCIO_KEY
          );
          const validScope =
            data.user.rol === 'SUPER_ADMIN' &&
            savedScope &&
            list.some((b) => b.id === savedScope)
              ? savedScope
              : data.user.id;
          setActiveNegocioId(validScope);
          if (data.mode) {
            setDataSourceMode(data.mode);
          }
        }
      } catch {
        // Ignorar error de red al restaurar sesión
      } finally {
        if (active) {
          setIsCheckingAuth(false);
        }
      }
    };

    void restoreSession();
    return () => {
      active = false;
    };
  }, []);

  const fetchAiSettings = useCallback(async () => {
    try {
      const res = await fetch('/api/admin/settings', { cache: 'no-store' });
      if (res.ok) {
        const data = (await res.json()) as {
          ok: boolean;
          hasOpenAiKey: boolean;
          openAiKeyPreview: string;
          openAiModel: string;
          hasGeminiKey: boolean;
          geminiKeyPreview: string;
          geminiModel?: string;
          hasGroqKey?: boolean;
          groqKeyPreview?: string;
          groqModel?: string;
          aiProvider: string;
        };
        if (data.ok) {
          setAiSettings(data);
          if (data.aiProvider === 'gemini' || data.aiProvider === 'openai' || data.aiProvider === 'groq') {
            setSelectedAiProvider(data.aiProvider);
          }
        }
      }
    } catch {
      // ignorar en fallo de red
    }
  }, []);

  const handleSaveAiConfig = async (
    e: React.FormEvent<HTMLFormElement>
  ): Promise<void> => {
    e.preventDefault();
    if (!openAiInputKey.trim()) {
      return;
    }
    setIsSavingAiConfig(true);
    try {
      const payload: Record<string, string> = {
        ai_provider: selectedAiProvider,
      };

      if (selectedAiProvider === 'gemini') {
        payload.gemini_api_key = openAiInputKey.trim();
        payload.gemini_model = 'gemini-3.5-flash-lite';
      } else if (selectedAiProvider === 'groq') {
        payload.groq_api_key = openAiInputKey.trim();
        payload.groq_model = 'llama-3.2-11b-vision-preview';
      } else {
        payload.openai_api_key = openAiInputKey.trim();
        payload.openai_model = 'gpt-4o-mini';
      }

      const res = await fetch('/api/admin/settings', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = (await res.json()) as {
        ok: boolean;
        message?: string;
        error?: string;
      };
      if (res.ok && data.ok) {
        await fetchAiSettings();
        setOpenAiInputKey('');
        const providerName =
          selectedAiProvider === 'gemini'
            ? 'Google Gemini (Gratis)'
            : selectedAiProvider === 'groq'
              ? 'Groq Cloud (Gratis)'
              : 'OpenAI Vision';
        setBannerMessage({
          type: 'success',
          text: `¡Clave de ${providerName} guardada con éxito! La lectura automática con IA en el portal de clientes está activa.`,
        });
      } else {
        setBannerMessage({
          type: 'error',
          text: data.error ?? 'No se pudo guardar la clave de IA.',
        });
      }
    } catch (err: unknown) {
      setBannerMessage({
        type: 'error',
        text:
          err instanceof Error
            ? err.message
            : 'Error guardando configuración de IA.',
      });
    } finally {
      setIsSavingAiConfig(false);
    }
  };

  const handleVerifyAiKey = async (): Promise<void> => {
    if (!openAiInputKey.trim()) {
      setBannerMessage({
        type: 'warning',
        text: 'Ingresa una clave para verificar antes de probar.',
      });
      return;
    }
    setIsVerifyingAiConfig(true);
    setVerifyFeedback(null);
    try {
      const payload: Record<string, string> = {
        action: 'VERIFY',
        ai_provider: selectedAiProvider,
      };

      if (selectedAiProvider === 'gemini') {
        payload.gemini_api_key = openAiInputKey.trim();
      } else if (selectedAiProvider === 'groq') {
        payload.groq_api_key = openAiInputKey.trim();
      } else {
        payload.openai_api_key = openAiInputKey.trim();
      }

      const res = await fetch('/api/admin/settings', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = (await res.json()) as {
        ok: boolean;
        message?: string;
        error?: string;
      };

      if (res.ok && data.ok) {
        setVerifyFeedback({
          ok: true,
          message: data.message ?? '¡Clave válida y verificada en vivo con éxito!',
        });
      } else {
        setVerifyFeedback({
          ok: false,
          message: data.error ?? data.message ?? 'Error verificando la clave.',
        });
      }
    } catch (err: unknown) {
      setVerifyFeedback({
        ok: false,
        message:
          err instanceof Error
            ? err.message
            : 'Error conectando con el servicio de verificación.',
      });
    } finally {
      setIsVerifyingAiConfig(false);
    }
  };

  useEffect(() => {
    if (currentBusinessUserId && activeNegocioId) {
      void fetchAllData();
      if (currentBusinessUserRol === 'SUPER_ADMIN') {
        void fetchAiSettings();
      }
    }
  }, [
    currentBusinessUserId,
    currentBusinessUserRol,
    activeNegocioId,
    fetchAllData,
    fetchAiSettings,
  ]);

  // Métricas separadas para Bloque Zelle (USD) y Bloque Binance (USDT)
  // Prioriza el agregado exacto calculado en SQL sin truncamiento de LIMIT 250.
  const financialMetrics = useMemo<FinancialSummaryMetrics>(() => {
    if (serverSummaryMetrics) {
      return serverSummaryMetrics;
    }

    let zelleBrutoConciliadoUsd = 0;
    let zelleComisionRetenidaUsd = 0;
    let zelleNetoLiquidableUsd = 0;
    let zellePorConciliarUsd = 0;
    let zelleBrutoEnviadoUsd = 0;

    let binanceConciliadoUsdt = 0;
    let binanceComisionRetenidaUsdt = 0;
    let binanceNetoDisponibleUsdt = 0;
    let binancePorConciliarUsdt = 0;
    let binanceEnviadoUsdt = 0;

    let pagosConciliadosCount = 0;
    let pagosRevisionManualCount = 0;
    let pagosDetectadosCount = 0;

    for (const item of alerts) {
      if (item.estado === 'DESCARTADO') {
        continue;
      }
      const isBinance =
        item.plataforma.startsWith('BINANCE') || item.moneda === 'USDT';

      if (isBinance) {
        if (item.tipo_movimiento === 'RECIBIDO') {
          if (item.estado === 'CONCILIADO') {
            binanceConciliadoUsdt += item.monto_bruto;
            binanceComisionRetenidaUsdt += item.monto_comision;
            binanceNetoDisponibleUsdt += item.monto_neto;
          } else {
            binancePorConciliarUsdt += item.monto_bruto;
          }
        } else {
          binanceEnviadoUsdt += item.monto_bruto;
        }
      } else {
        if (item.tipo_movimiento === 'RECIBIDO') {
          if (item.estado === 'CONCILIADO') {
            zelleBrutoConciliadoUsd += item.monto_bruto;
            zelleComisionRetenidaUsd += item.monto_comision;
            zelleNetoLiquidableUsd += item.monto_neto;
          } else {
            zellePorConciliarUsd += item.monto_bruto;
          }
        } else {
          zelleBrutoEnviadoUsd += item.monto_bruto;
        }
      }

      if (item.estado === 'CONCILIADO') {
        pagosConciliadosCount += 1;
      } else if (item.estado === 'REVISION_MANUAL') {
        pagosRevisionManualCount += 1;
      } else if (item.estado === 'DETECTADO') {
        pagosDetectadosCount += 1;
      }
    }

    const round = (val: number): number => Math.round(val * 100) / 100;

    return {
      zelleBrutoRecibidoUsd: round(zelleBrutoConciliadoUsd),
      zelleComisionRetenidaUsd: round(zelleComisionRetenidaUsd),
      zelleNetoLiquidableUsd: round(zelleNetoLiquidableUsd),
      zellePorConciliarUsd: round(zellePorConciliarUsd),
      zelleBrutoEnviadoUsd: round(zelleBrutoEnviadoUsd),
      binanceRecibidoUsdt: round(binanceConciliadoUsdt),
      binanceComisionRetenidaUsdt: round(binanceComisionRetenidaUsdt),
      binanceEnviadoUsdt: round(binanceEnviadoUsdt),
      binanceNetoDisponibleUsdt: round(binanceNetoDisponibleUsdt),
      binancePorConciliarUsdt: round(binancePorConciliarUsdt),
      totalBrutoRecibido: round(zelleBrutoConciliadoUsd + binanceConciliadoUsdt),
      totalComisionDescontada: round(
        zelleComisionRetenidaUsd + binanceComisionRetenidaUsdt
      ),
      totalNetoDisponible: round(
        zelleNetoLiquidableUsd + binanceNetoDisponibleUsdt
      ),
      totalBrutoEnviado: round(zelleBrutoEnviadoUsd + binanceEnviadoUsdt),
      pagosConciliadosCount,
      pagosRevisionManualCount,
      pagosDetectadosCount,
    };
  }, [alerts, serverSummaryMetrics]);

  // Desglose vivo de Titulares / Clientes usando los totales autoritativos calculados en PostgreSQL (sin truncamiento)
  const clientsWithReconciledFunds = useMemo(() => {
    return clients;
  }, [clients]);

  const filteredAlerts = useMemo<BankEmailAlertRecord[]>(() => {
    const normalizedQuery = searchQuery.trim().toLowerCase();

    return alerts.filter((item) => {
      if (platformFilter !== 'TODOS' && item.plataforma !== platformFilter) {
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
      if (selectedClientFilter === 'SIN_ASIGNAR') {
        if (item.estado === 'CONCILIADO' || item.cliente_id !== null) {
          return false;
        }
      } else if (selectedClientFilter !== 'TODOS') {
        const targetClient = clients.find((c) => c.id === selectedClientFilter);
        const matchesClient =
          item.cliente_id === selectedClientFilter ||
          (item.cliente_asignado_nombre &&
            targetClient &&
            item.cliente_asignado_nombre.trim().toLowerCase() ===
              targetClient.nombre_titular.trim().toLowerCase());
        if (!matchesClient) {
          return false;
        }
      }
      if (normalizedQuery.length > 0) {
        const sender = (item.remitente_o_contraparte ?? '').toLowerCase();
        const ref = (item.referencia ?? '').toLowerCase();
        const client = (item.cliente_asignado_nombre ?? '').toLowerCase();
        const dedup = (item.dedup_key ?? '').toLowerCase();
        return (
          sender.includes(normalizedQuery) ||
          ref.includes(normalizedQuery) ||
          client.includes(normalizedQuery) ||
          dedup.includes(normalizedQuery)
        );
      }
      return true;
    });
  }, [alerts, platformFilter, movementFilter, statusFilter, searchQuery, selectedClientFilter, clients]);

  const visibleTableTotals = useMemo(() => {
    let conciliadosCount = 0;
    let pendientesCount = 0;
    let brutoAllUsd = 0;
    let brutoConciliadoUsd = 0;
    let comisionUsd = 0;
    let netoUsd = 0;
    let brutoPendienteUsd = 0;

    let brutoAllUsdt = 0;
    let brutoConciliadoUsdt = 0;
    let comisionUsdt = 0;
    let netoUsdt = 0;
    let brutoPendienteUsdt = 0;

    for (const item of filteredAlerts) {
      if (item.estado === 'DESCARTADO') {
        continue;
      }
      const isUsdt =
        item.moneda === 'USDT' || item.plataforma.startsWith('BINANCE');
      const bruto = Number(item.monto_bruto ?? 0);
      const com = Number(item.monto_comision ?? 0);
      const neto = Number(item.monto_neto ?? 0);

      if (isUsdt) {
        brutoAllUsdt += bruto;
      } else {
        brutoAllUsd += bruto;
      }

      if (item.estado === 'CONCILIADO') {
        conciliadosCount += 1;
        if (isUsdt) {
          brutoConciliadoUsdt += bruto;
          comisionUsdt += com;
          netoUsdt += neto;
        } else {
          brutoConciliadoUsd += bruto;
          comisionUsd += com;
          netoUsd += neto;
        }
      } else {
        pendientesCount += 1;
        if (isUsdt) {
          brutoPendienteUsdt += bruto;
        } else {
          brutoPendienteUsd += bruto;
        }
      }
    }

    const r = (v: number) => Math.round(v * 100) / 100;
    return {
      totalRows: filteredAlerts.length,
      conciliadosCount,
      pendientesCount,
      brutoAllUsd: r(brutoAllUsd),
      brutoConciliadoUsd: r(brutoConciliadoUsd),
      comisionUsd: r(comisionUsd),
      netoUsd: r(netoUsd),
      brutoPendienteUsd: r(brutoPendienteUsd),
      brutoAllUsdt: r(brutoAllUsdt),
      brutoConciliadoUsdt: r(brutoConciliadoUsdt),
      comisionUsdt: r(comisionUsdt),
      netoUsdt: r(netoUsdt),
      brutoPendienteUsdt: r(brutoPendienteUsdt),
    };
  }, [filteredAlerts]);

  const receivedAlertsCount = useMemo(
    () => alerts.filter((a) => a.tipo_movimiento === 'RECIBIDO').length,
    [alerts]
  );

  const sentAlertsCount = useMemo(
    () => alerts.filter((a) => a.tipo_movimiento === 'ENVIADO').length,
    [alerts]
  );

  const totalExpensesUsd = useMemo(
    () =>
      alerts
        .filter((a) => a.tipo_movimiento === 'ENVIADO' && a.moneda === 'USD')
        .reduce((sum, a) => sum + a.monto_bruto, 0),
    [alerts]
  );

  const expensesAlerts = useMemo<BankEmailAlertRecord[]>(() => {
    const normalizedQuery = searchQuery.trim().toLowerCase();
    return alerts.filter((item) => {
      if (item.tipo_movimiento !== 'ENVIADO') {
        return false;
      }
      if (normalizedQuery.length > 0) {
        const sender = (item.remitente_o_contraparte ?? '').toLowerCase();
        const ref = (item.referencia ?? '').toLowerCase();
        const client = (item.cliente_asignado_nombre ?? '').toLowerCase();
        return (
          sender.includes(normalizedQuery) ||
          ref.includes(normalizedQuery) ||
          client.includes(normalizedQuery)
        );
      }
      return true;
    });
  }, [alerts, searchQuery]);

  const eligibleAlertsForBatch = useMemo(
    () =>
      filteredAlerts.filter(
        (a) =>
          a.estado !== 'CONCILIADO' &&
          a.estado !== 'DESCARTADO' &&
          !a.liquidado_at
      ),
    [filteredAlerts]
  );

  const totalLiquidadoUsd = useMemo(() => {
    return liquidations
      .filter((l) => l.moneda !== 'USDT')
      .reduce((sum, l) => sum + Number(l.monto_liquidado || 0), 0);
  }, [liquidations]);

  const totalLiquidadoUsdt = useMemo(() => {
    return liquidations
      .filter((l) => l.moneda === 'USDT')
      .reduce((sum, l) => sum + Number(l.monto_liquidado || 0), 0);
  }, [liquidations]);

  const filteredLiquidations = useMemo(() => {
    return liquidations.filter((l) => {
      if (liqMethodFilter !== 'TODOS' && l.metodo_pago_salida !== liqMethodFilter) {
        return false;
      }
      if (liqSearch.trim()) {
        const q = liqSearch.trim().toLowerCase();
        const matchCode = l.codigo_liquidacion.toLowerCase().includes(q);
        const matchClient = l.cliente_nombre.toLowerCase().includes(q);
        const matchDest = l.destinatario_beneficiario.toLowerCase().includes(q);
        const matchMotivo = l.motivo_concepto.toLowerCase().includes(q);
        const matchRef = (l.referencia_salida || '').toLowerCase().includes(q);
        return matchCode || matchClient || matchDest || matchMotivo || matchRef;
      }
      return true;
    });
  }, [liquidations, liqMethodFilter, liqSearch]);

  const toggleSelectAlert = (id: string): void => {
    setSelectedAlertIds((prev) =>
      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]
    );
  };

  const toggleSelectAllEligible = (): void => {
    const eligibleIds = eligibleAlertsForBatch.map((a) => a.id);
    const allSelected =
      eligibleIds.length > 0 &&
      eligibleIds.every((id) => selectedAlertIds.includes(id));
    if (allSelected) {
      setSelectedAlertIds((prev) =>
        prev.filter((id) => !eligibleIds.includes(id))
      );
    } else {
      setSelectedAlertIds((prev) => Array.from(new Set([...prev, ...eligibleIds])));
    }
  };

  // Busca orden vinculada o candidata legítima (con captura) asociada a una transacción
  const findAssociatedCaptureOrder = useCallback(
    (tx: BankEmailAlertRecord): PendingPaymentOrder | null => {
      // 1. Si la transacción ya está vinculada a una orden en base de datos, usar exclusivamente los datos de esa orden
      if (tx.orden_conciliada_id) {
        const linked = pendingOrders.find((o) => o.id === tx.orden_conciliada_id);
        if (linked) return linked;

        return {
          id: tx.orden_conciliada_id,
          codigo_orden: tx.codigo_orden ?? 'ORD-CONCILIADA',
          cliente_id: tx.cliente_id ?? '',
          cliente_nombre: tx.cliente_asignado_nombre ?? '',
          cliente_email: '',
          plataforma_esperada: (tx.plataforma === 'OTRO'
            ? 'CITIBANK'
            : tx.plataforma) as ExpectedPlatformType,
          banco_destino: (tx.plataforma === 'OTRO'
            ? 'CITIBANK'
            : tx.plataforma) as ExpectedPlatformType,
          moneda: tx.moneda,
          monto_esperado: tx.monto_reportado ?? tx.monto_bruto,
          remitente_reportado:
            tx.remitente_reportado ?? tx.remitente_o_contraparte ?? '',
          nombre_remitente_reportado:
            tx.remitente_reportado ?? tx.remitente_o_contraparte ?? '',
          referencia_reportada: tx.referencia_reportada ?? null,
          has_capture: Boolean(tx.has_capture || tx.comprobante_base64),
          comprobante_base64: tx.comprobante_base64 ?? null,
          comprobante_mime: tx.comprobante_mime ?? 'image/jpeg',
          datos_ocr_extraidos: tx.datos_ocr_extraidos ?? null,
          estado: 'CONCILIADO',
          transaccion_conciliada_id: tx.id,
          notas_cliente: null,
          created_at: tx.fecha_reportada ?? tx.conciliado_at ?? tx.created_at,
          updated_at: tx.conciliado_at ?? tx.created_at,
        };
      }

      // Si ya está CONCILIADO sin orden vinculada, no tomar órdenes pendientes ajenas
      if (tx.estado === 'CONCILIADO') {
        return null;
      }

      // 2. Filtrar órdenes pendientes del mismo monto y moneda
      const sameAmountOrders = pendingOrders.filter(
        (o) =>
          o.moneda === tx.moneda &&
          Math.abs(o.monto_esperado - tx.monto_bruto) < 0.01
      );
      if (sameAmountOrders.length === 0) {
        return null;
      }

      // 2a. Prioridad 1: Coincidencia de referencia bancaria exacta o substring
      const refMatch = sameAmountOrders.find((o) =>
        referencesMatch(o.referencia_reportada, tx.referencia)
      );
      if (refMatch) {
        return refMatch;
      }

      // 2b. Prioridad 2: Coincidencia de remitente legítima (similitud >= 0.70),
      // SOLO si la orden pendiente NO tiene una referencia bancaria alfanumérica que contradiga la del correo
      // (evita que una orden pendiente de otra fecha como n2gukw9y9 del 21/10 aparezca en un correo DETECTADO del 06/11)
      const senderCandidates = sameAmountOrders
        .filter((o) => {
          const cleanOrdRef = (o.referencia_reportada || '')
            .toUpperCase()
            .replace(/[^A-Z0-9]/g, '');
          const isGenericOrNumeric =
            !cleanOrdRef ||
            cleanOrdRef.length < 4 ||
            /^[0-9]{8,14}$/.test(cleanOrdRef) ||
            ['SINREF', 'NOREF', 'NA', 'NONE', 'NULL', 'BANKOFAMERICA'].includes(
              cleanOrdRef
            );
          return (
            isGenericOrNumeric ||
            referencesMatch(o.referencia_reportada, tx.referencia)
          );
        })
        .map((o) => ({
          order: o,
          similarity: calculateSenderSimilarity(
            o.remitente_reportado || o.nombre_remitente_reportado || '',
            tx.remitente_o_contraparte || ''
          ),
        }))
        .filter((c) => c.similarity >= 0.7)
        .sort((a, b) => b.similarity - a.similarity);

      if (senderCandidates.length > 0 && senderCandidates[0]) {
        return senderCandidates[0].order;
      }

      // Jamás asociar una captura de un tercero no relacionado a ciegas
      return null;
    },
    [pendingOrders]
  );

  const handleCopyPortalLink = async (): Promise<void> => {
    try {
      const portalUrl = `${window.location.origin}/portal`;
      await navigator.clipboard.writeText(portalUrl);
      setPortalLinkCopied(true);
      setTimeout(() => setPortalLinkCopied(false), 2500);
    } catch {
      setBannerMessage({
        type: 'info',
        text: `Portal disponible en: ${window.location.origin}/portal`,
      });
    }
  };

  // Sincronización Multi-Canal (IMAP + Binance API)
  const handleSyncImapNow = async (): Promise<void> => {
    setIsSyncingImap(true);
    setBannerMessage(null);

    try {
      const response = await fetch('/api/reconciliation/sync-now', {
        method: 'POST',
        headers: buildScopeHeaders(false),
      });

      const payload = (await response.json()) as {
        ok: boolean;
        mailboxesProcessed?: number;
        binanceApiConfigured?: boolean;
        binanceFetchedCount?: number;
        insertedCount?: number;
        reconciledCount?: number;
        duplicateCount?: number;
        errors?: string[];
        error?: string;
      };

      await fetchAllData();

      if (response.ok && payload.ok) {
        if (
          (payload.mailboxesProcessed ?? 0) === 0 &&
          !payload.binanceApiConfigured
        ) {
          setBannerMessage({
            type: 'warning',
            text:
              payload.errors?.[0] ??
              'Configura al menos un correo IMAP o las credenciales de Binance API.',
          });
        } else if (payload.errors && payload.errors.length > 0) {
          setBannerMessage({
            type: 'warning',
            text: `Sincronización completada con avisos (${payload.insertedCount ?? 0} nuevos, ${payload.reconciledCount ?? 0} conciliados): ${payload.errors.join(' | ')}`,
          });
        } else {
          setBannerMessage({
            type: 'success',
            text: `Sincronización Multi-Canal completada (${payload.mailboxesProcessed ?? 0} buzón/es IMAP · Binance API: ${payload.binanceFetchedCount ?? 0} mov.): ${payload.insertedCount ?? 0} nuevos, ${payload.reconciledCount ?? 0} conciliados y ${payload.duplicateCount ?? 0} duplicados omitidos por dedup_key.`,
          });
        }
      } else {
        setBannerMessage({
          type: 'error',
          text: payload.error ?? 'Error al sincronizar canales.',
        });
      }
    } catch {
      setBannerMessage({
        type: 'warning',
        text: 'No se pudo conectar al motor de sincronización.',
      });
    } finally {
      setIsSyncingImap(false);
    }
  };

  const openManualReconciliationModal = (
    alert: BankEmailAlertRecord,
    preselectedOrder?: PendingPaymentOrder | null
  ): void => {
    setSelectedAlertForMatch(alert);

    const candidateOrder =
      preselectedOrder ?? findAssociatedCaptureOrder(alert);

    if (candidateOrder) {
      setSelectedOrderId(candidateOrder.id);
      setManualClientName(candidateOrder.cliente_nombre);
    } else {
      setSelectedOrderId('');
      setManualClientName(
        alert.cliente_asignado_nombre ?? clients[0]?.nombre_titular ?? ''
      );
    }

    setManualNotes(
      `Verificado manualmente (${alert.plataforma}): pago de (${
        alert.remitente_o_contraparte ?? 'Sin nombre'
      }) acreditado tras revisar comprobante.`
    );
  };

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

    // Regla de seguridad: Un pago no se puede conciliar a quien no lo haya enviado.
    // Si no hay orden de pago vinculada, verificar que el remitente bancario coincida con el cliente o sus autorizados.
    if (!selectedOrderId) {
      const bankSender = (selectedAlertForMatch.remitente_o_contraparte || '').toLowerCase().trim();
      const targetName = targetClientName.toLowerCase().trim();
      const isDirectMatch =
        bankSender === targetName ||
        bankSender.includes(targetName) ||
        targetName.includes(bankSender);

      if (!isDirectMatch) {
        const found = clients.find((c) => c.nombre_titular.toLowerCase().trim() === targetName);
        const authList = (found?.remitentes_autorizados || []).map((s) => s.toLowerCase().trim());
        const isAuth = authList.some(
          (a) => a === bankSender || bankSender.includes(a) || a.includes(bankSender)
        );

        if (!isAuth) {
          setBannerMessage({
            type: 'error',
            text: `Bloqueo de seguridad: No se puede conciliar este pago a "${targetClientName}". El remitente bancario registrado es "${selectedAlertForMatch.remitente_o_contraparte}". El cliente debe ingresar al portal y reportar la orden con su comprobante para poder vincularlo.`,
          });
          return;
        }
      }
    }

    setIsSubmittingMatch(true);
    try {
      const response = await fetch('/api/reconciliation/manual-match', {
        method: 'POST',
        headers: buildScopeHeaders(true),
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
        text: `Pago de ${formatMoney(
          selectedAlertForMatch.monto_bruto,
          selectedAlertForMatch.moneda
        )} (Neto: ${formatMoney(
          result.alert?.monto_neto ?? selectedAlertForMatch.monto_neto,
          selectedAlertForMatch.moneda
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

  const openManualOrderConfirmModal = (order: PendingPaymentOrder): void => {
    setSelectedOrderForManualConfirm(order);
    const { tx: candidateTx } = findBestCandidateTxForOrder(order, alerts);
    setOrderConfirmLinkedTxId(candidateTx ? candidateTx.id : '');
    setOrderConfirmNotes(
      `Confirmado manualmente por el administrador tras verificar comprobante de ${
        order.remitente_reportado ||
        order.nombre_remitente_reportado ||
        order.cliente_nombre
      } (${order.codigo_orden}).`
    );
  };

  const handleConfirmOrderManually = async (
    event: React.FormEvent<HTMLFormElement>
  ): Promise<void> => {
    event.preventDefault();
    if (!selectedOrderForManualConfirm) {
      return;
    }

    setIsSubmittingOrderConfirm(true);
    try {
      const payload = orderConfirmLinkedTxId
        ? {
            action: 'MATCH_TX' as const,
            alertId: orderConfirmLinkedTxId,
            ordenPagoId: selectedOrderForManualConfirm.id,
            clienteNombreManual: selectedOrderForManualConfirm.cliente_nombre,
            notasConciliacion: orderConfirmNotes.trim(),
          }
        : {
            action: 'APPROVE_ORDER_WITHOUT_EMAIL' as const,
            ordenPagoId: selectedOrderForManualConfirm.id,
            clienteNombreManual: selectedOrderForManualConfirm.cliente_nombre,
            notasConciliacion: orderConfirmNotes.trim(),
          };

      const response = await fetch('/api/reconciliation/manual-match', {
        method: 'POST',
        headers: buildScopeHeaders(true),
        body: JSON.stringify(payload),
      });

      const result = (await response.json()) as {
        ok: boolean;
        alert?: BankEmailAlertRecord;
        error?: string;
      };

      if (!response.ok || !result.ok) {
        throw new Error(
          result.error ?? 'Error al confirmar manualmente la captura.'
        );
      }

      await fetchAllData();

      setBannerMessage({
        type: 'success',
        text: `Orden ${selectedOrderForManualConfirm.codigo_orden} (${formatMoney(
          selectedOrderForManualConfirm.monto_esperado,
          selectedOrderForManualConfirm.moneda
        )}) confirmada y acreditada manualmente a favor de "${selectedOrderForManualConfirm.cliente_nombre}".`,
      });
      setSelectedOrderForManualConfirm(null);
    } catch (error: unknown) {
      const msg =
        error instanceof Error
          ? error.message
          : 'Error inesperado al confirmar la orden.';
      setBannerMessage({ type: 'error', text: msg });
    } finally {
      setIsSubmittingOrderConfirm(false);
    }
  };

  const handleRejectPendingOrder = async (
    order: PendingPaymentOrder
  ): Promise<void> => {
    const confirmed = window.confirm(
      `¿Descartar y eliminar la orden pendiente ${order.codigo_orden} (${
        order.remitente_reportado || order.cliente_nombre
      } · ${formatMoney(order.monto_esperado, order.moneda)} · Ref: ${
        order.referencia_reportada || 'SIN-REF'
      })?\n\nUsa esta opción si la captura es duplicada o inválida para que no quede pendiente en el portal del cliente.`
    );
    if (!confirmed) {
      return;
    }

    setIsRejectingOrderId(order.id);
    try {
      const response = await fetch('/api/reconciliation/manual-match', {
        method: 'POST',
        headers: buildScopeHeaders(true),
        body: JSON.stringify({
          action: 'REJECT_PENDING_ORDER',
          ordenPagoId: order.id,
        }),
      });

      const result = (await response.json()) as {
        ok: boolean;
        error?: string;
      };

      if (!response.ok || !result.ok) {
        throw new Error(
          result.error ?? 'No se pudo descartar la orden pendiente.'
        );
      }

      await fetchAllData();
      setBannerMessage({
        type: 'info',
        text: `Orden pendiente ${order.codigo_orden} descartada y retirada de pendientes.`,
      });
    } catch (error: unknown) {
      const msg =
        error instanceof Error
          ? error.message
          : 'Error al descartar la orden pendiente.';
      setBannerMessage({ type: 'error', text: msg });
    } finally {
      setIsRejectingOrderId(null);
    }
  };

  const handleConfirmRevertReconciliation = async (
    event: React.FormEvent<HTMLFormElement>
  ): Promise<void> => {
    event.preventDefault();
    if (!alertToRevert) {
      return;
    }

    setIsSubmittingRevert(true);
    try {
      const response = await fetch('/api/reconciliation/revert', {
        method: 'POST',
        headers: buildScopeHeaders(true),
        body: JSON.stringify({
          alertId: alertToRevert.id,
          motivo: revertReason.trim() || 'Reversión manual por el administrador',
        }),
      });

      const result = (await response.json()) as {
        ok: boolean;
        alert?: BankEmailAlertRecord;
        error?: string;
      };

      if (!response.ok || !result.ok) {
        throw new Error(result.error ?? 'Error al revertir la conciliación.');
      }

      await fetchAllData();

      setBannerMessage({
        type: 'success',
        text: `Conciliación de ${formatMoney(
          alertToRevert.monto_bruto,
          alertToRevert.moneda
        )} revertida exitosamente. El saldo del cliente ha sido recalculado.`,
      });
      setAlertToRevert(null);
      setRevertReason('');
    } catch (error: unknown) {
      const msg =
        error instanceof Error
          ? error.message
          : 'Error inesperado al revertir conciliación.';
      setBannerMessage({ type: 'error', text: msg });
    } finally {
      setIsSubmittingRevert(false);
    }
  };

  const openDiscardModalForAlerts = (targets: BankEmailAlertRecord[]): void => {
    const valid = targets.filter(
      (a) =>
        a.estado !== 'CONCILIADO' &&
        a.estado !== 'DESCARTADO' &&
        !a.liquidado_at
    );
    if (valid.length === 0) {
      setBannerMessage({
        type: 'warning',
        text: 'Solo se pueden eliminar correos que no estén conciliados ni liquidados.',
      });
      return;
    }
    setAlertsToDiscard(valid);
    setDiscardReason('Correo propio / no corresponde a conciliación');
  };

  const handleConfirmDiscardAlerts = async (
    event: React.FormEvent<HTMLFormElement>
  ): Promise<void> => {
    event.preventDefault();
    if (alertsToDiscard.length === 0) {
      return;
    }
    setIsSubmittingDiscard(true);
    try {
      const targetIds = alertsToDiscard.map((a) => a.id);
      const response = await fetch('/api/reconciliation/alerts', {
        method: 'DELETE',
        headers: buildScopeHeaders(true),
        body: JSON.stringify({
          alertIds: targetIds,
          reason:
            discardReason.trim() ||
            'Correo propio / no corresponde a conciliación',
        }),
      });
      const result = (await response.json()) as {
        ok: boolean;
        discardedCount?: number;
        discardedIds?: string[];
        error?: string;
      };
      if (!response.ok || !result.ok) {
        throw new Error(
          result.error ?? 'No se pudieron eliminar los correos seleccionados.'
        );
      }
      const discardedSet = new Set(result.discardedIds ?? targetIds);
      setSelectedAlertIds((prev) => prev.filter((id) => !discardedSet.has(id)));
      setAlertsToDiscard([]);
      await fetchAllData();
      setBannerMessage({
        type: 'success',
        text:
          (result.discardedCount ?? targetIds.length) === 1
            ? 'Correo eliminado de la lista activa (no volverá a importarse en futuras sincronizaciones IMAP).'
            : `${result.discardedCount ?? targetIds.length} correos eliminados de la lista activa (no volverán a importarse en futuras sincronizaciones IMAP).`,
      });
    } catch (error: unknown) {
      const msg =
        error instanceof Error
          ? error.message
          : 'Error inesperado al eliminar correos.';
      setBannerMessage({ type: 'error', text: msg });
    } finally {
      setIsSubmittingDiscard(false);
    }
  };

  const handleRestoreDiscardedAlert = async (
    alert: BankEmailAlertRecord
  ): Promise<void> => {
    setRestoringAlertId(alert.id);
    try {
      const response = await fetch('/api/reconciliation/alerts', {
        method: 'PATCH',
        headers: buildScopeHeaders(true),
        body: JSON.stringify({
          action: 'RESTORE',
          alertId: alert.id,
        }),
      });
      const result = (await response.json()) as {
        ok: boolean;
        error?: string;
      };
      if (!response.ok || !result.ok) {
        throw new Error(result.error ?? 'No se pudo restaurar el correo.');
      }
      await fetchAllData();
      setBannerMessage({
        type: 'success',
        text: `Correo (${alert.remitente_o_contraparte} · ${formatMoney(alert.monto_bruto, alert.moneda)}) restaurado a la lista activa.`,
      });
    } catch (error: unknown) {
      const msg =
        error instanceof Error
          ? error.message
          : 'Error inesperado al restaurar correo.';
      setBannerMessage({ type: 'error', text: msg });
    } finally {
      setRestoringAlertId(null);
    }
  };

  const handleConfirmBatchReconciliation = async (
    event: React.FormEvent<HTMLFormElement>
  ): Promise<void> => {
    event.preventDefault();
    if (selectedAlertIds.length === 0) {
      setBannerMessage({
        type: 'error',
        text: 'Selecciona al menos una transacción para conciliar por lote.',
      });
      return;
    }

    if (!batchTargetClient.trim()) {
      setBannerMessage({
        type: 'error',
        text: 'Selecciona un cliente titular para asignar las transacciones.',
      });
      return;
    }

    setIsSubmittingBatch(true);
    try {
      const response = await fetch('/api/reconciliation/batch-match', {
        method: 'POST',
        headers: buildScopeHeaders(true),
        body: JSON.stringify({
          alertIds: selectedAlertIds,
          clienteNombreManual: batchTargetClient.trim(),
          notasConciliacion: batchNotes.trim(),
        }),
      });

      const result = (await response.json()) as {
        ok: boolean;
        matchedCount?: number;
        totalNeto?: number;
        error?: string;
      };

      if (!response.ok || !result.ok) {
        throw new Error(result.error ?? 'Error al conciliar transacciones por lote.');
      }

      await fetchAllData();

      setBannerMessage({
        type: 'success',
        text: `Asignación por lote exitosa: ${result.matchedCount ?? selectedAlertIds.length} pagos asignados a favor de "${batchTargetClient}". Saldo acreditado: $${(result.totalNeto ?? 0).toFixed(2)} USD.`,
      });

      setSelectedAlertIds([]);
      setIsBatchModalOpen(false);
      setBatchTargetClient('');
      setBatchNotes('');
    } catch (error: unknown) {
      const msg =
        error instanceof Error
          ? error.message
          : 'Error inesperado al conciliar por lote.';
      setBannerMessage({ type: 'error', text: msg });
    } finally {
      setIsSubmittingBatch(false);
    }
  };

  const openCreateClientModal = (): void => {
    setEditingClientId(null);
    setNewClientName('');
    setNewClientEmail('');
    setNewClientPhone('');
    setNewClientPin(String(Math.floor(1000 + Math.random() * 9000)));
    setNewClientFeeZelle('4.00');
    setNewClientFeeBinance('1.50');
    setNewClientAssignedAccounts(mapMailboxesToAssignedAccounts(mailboxes));
    setIsNewClientModalOpen(true);
  };

  const openEditClientModal = (client: ClientAccountRecord): void => {
    setEditingClientId(client.id);
    setNewClientName(client.nombre_titular);
    setNewClientEmail(client.email ?? client.email_contacto ?? '');
    setNewClientPhone(client.telefono ?? '');
    setNewClientPin('');
    setNewClientFeeZelle(String(client.porcentaje_comision_zelle ?? 4.0));
    setNewClientFeeBinance(String(client.porcentaje_comision_binance ?? 1.5));
    const existingAssigned =
      client.cuentas_asignadas && client.cuentas_asignadas.length > 0
        ? client.cuentas_asignadas.map((acc) => ({ ...acc }))
        : mapMailboxesToAssignedAccounts(mailboxes);
    setNewClientAssignedAccounts(existingAssigned);
    setIsNewClientModalOpen(true);
  };

  const openLiquidationModal = (client?: ClientAccountRecord): void => {
    const target = client ?? clients[0] ?? null;
    setSelectedClientForLiq(target);
    setLiqMonto('');
    setLiqMoneda('USD');
    setLiqDestinatario(target ? `A favor de ${target.nombre_titular}` : '');
    setLiqMotivo('Liquidación solicitada por cliente');
    setLiqMetodo('ZELLE');
    setLiqReferencia('');
    setLiqNotas('');
    setLiqArchivar(true);
    setLiquidationFeedback(null);
    setIsLiquidationModalOpen(true);
  };

  const handleCreateLiquidation = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    if (!selectedClientForLiq) {
      setLiquidationFeedback({ ok: false, message: 'Debe seleccionar un cliente para liquidar.' });
      return;
    }

    const amount = parseFloat(liqMonto);
    if (!Number.isFinite(amount) || amount <= 0) {
      setLiquidationFeedback({ ok: false, message: 'Ingresa un monto válido mayor a 0.' });
      return;
    }

    if (!liqDestinatario.trim()) {
      setLiquidationFeedback({ ok: false, message: 'Ingresa el destinatario o beneficiario del pago.' });
      return;
    }

    if (!liqMotivo.trim()) {
      setLiquidationFeedback({ ok: false, message: 'Ingresa el motivo o concepto de la liquidación.' });
      return;
    }

    setIsSubmittingLiquidation(true);
    setLiquidationFeedback(null);

    try {
      const res = await fetch('/api/reconciliation/liquidations', {
        method: 'POST',
        headers: buildScopeHeaders(true),
        body: JSON.stringify({
          cliente_id: selectedClientForLiq.id,
          monto_liquidado: amount,
          moneda: liqMoneda,
          destinatario_beneficiario: liqDestinatario.trim(),
          motivo_concepto: liqMotivo.trim(),
          metodo_pago_salida: liqMetodo,
          referencia_salida: liqReferencia.trim() || null,
          liquidado_por: currentBusinessUser?.nombre_usuario || currentBusinessUser?.nombre_negocio || 'ADMINISTRADOR',
          notas_operador: liqNotas.trim() || null,
          archivar_comprobantes: liqArchivar,
          permitir_saldo_negativo: true,
        }),
      });

      const data = (await res.json()) as {
        ok: boolean;
        error?: string;
        mensaje?: string;
        liquidacion?: ClientLiquidationRecord;
      };

      if (!res.ok || !data.ok) {
        throw new Error(data.error || 'Error al procesar la liquidación.');
      }

      setBannerMessage({
        type: 'success',
        text: data.mensaje || `Liquidación ${data.liquidacion?.codigo_liquidacion} procesada con éxito.`,
      });
      setIsLiquidationModalOpen(false);
      await fetchAllData();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Error al procesar liquidación.';
      setLiquidationFeedback({ ok: false, message: msg });
    } finally {
      setIsSubmittingLiquidation(false);
    }
  };

  const handleToggleMailboxAssignment = (mb: ImapMailboxRecord): void => {
    setNewClientAssignedAccounts((prev) => {
      const exists = prev.some(
        (acc) => acc.mailbox_id === mb.id || acc.id === mb.id
      );
      if (exists) {
        return prev.filter(
          (acc) => acc.mailbox_id !== mb.id && acc.id !== mb.id
        );
      }
      const plat: ExpectedPlatformType = mb.plataforma ?? 'CITIBANK';
      const curr: CurrencyType = mb.moneda ?? platformDefaultCurrency(plat);
      return [
        ...prev,
        {
          id: mb.id,
          mailbox_id: mb.id,
          plataforma: plat,
          alias: mb.alias || platformDefaultLabel(plat),
          cuenta_receptora: mb.cuenta_receptora || mb.email_address,
          moneda: curr,
        },
      ];
    });
  };

  const handleAddCustomAssignedAccount = (): void => {
    setNewClientAssignedAccounts((prev) => [
      ...prev,
      {
        id: `custom-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
        mailbox_id: null,
        plataforma: 'CITIBANK',
        alias: 'Citibank Zelle',
        cuenta_receptora: '',
        moneda: 'USD',
      },
    ]);
  };

  const handleUpdateAssignedAccount = (
    index: number,
    patch: Partial<AssignedReceivingAccount>
  ): void => {
    setNewClientAssignedAccounts((prev) =>
      prev.map((acc, idx) => {
        if (idx !== index) {
          return acc;
        }
        const nextPlatform = patch.plataforma ?? acc.plataforma;
        const autoCurrency =
          patch.plataforma !== undefined && patch.moneda === undefined
            ? platformDefaultCurrency(patch.plataforma)
            : patch.moneda ?? acc.moneda;
        const autoAlias =
          patch.plataforma !== undefined &&
          (!acc.alias || acc.alias === platformDefaultLabel(acc.plataforma))
            ? platformDefaultLabel(patch.plataforma)
            : patch.alias ?? acc.alias;
        return {
          ...acc,
          ...patch,
          plataforma: nextPlatform,
          moneda: autoCurrency,
          alias: autoAlias,
        };
      })
    );
  };

  const handleRemoveAssignedAccount = (index: number): void => {
    setNewClientAssignedAccounts((prev) => prev.filter((_, idx) => idx !== index));
  };

  const handleGenerateRandomPin = (): void => {
    setNewClientPin(String(Math.floor(1000 + Math.random() * 9000)));
  };

  const handleDeleteClient = async (id: string, nombre: string): Promise<void> => {
    try {
      const res = await fetch(
        `/api/reconciliation/clients?id=${encodeURIComponent(id)}`,
        { method: 'DELETE' }
      );
      if (res.ok) {
        await fetchAllData();
        setBannerMessage({
          type: 'info',
          text: `Cuenta de acceso "${nombre}" eliminada.`,
        });
      }
    } catch {
      // ignorar
    }
  };

  const handleCopyPortalCredentials = async (creds: {
    nombre: string;
    email: string;
    pin: string;
  }): Promise<void> => {
    try {
      const portalUrl = `${window.location.origin}/portal`;
      const text = `Acceso al Portal de Pagos:\nLink: ${portalUrl}\nCorreo: ${creds.email}${
        creds.pin ? `\nPIN: ${creds.pin}` : ''
      }`;
      await navigator.clipboard.writeText(text);
      setBannerMessage({
        type: 'success',
        text: `Credenciales de "${creds.nombre}" copiadas al portapapeles.`,
      });
    } catch {
      // ignorar si el navegador bloquea clipboard
    }
  };

  const handleCreateClient = async (
    event: React.FormEvent<HTMLFormElement>
  ): Promise<void> => {
    event.preventDefault();
    setIsSavingClient(true);
    setBannerMessage(null);

    const isEditing = editingClientId !== null;
    const savedName = newClientName.trim();
    const savedEmail = newClientEmail.trim().toLowerCase();
    const savedPin = newClientPin.trim();
    const validAssignedAccounts = newClientAssignedAccounts
      .map((acc) => ({
        ...acc,
        alias: acc.alias.trim() || platformDefaultLabel(acc.plataforma),
        cuenta_receptora: acc.cuenta_receptora.trim(),
      }))
      .filter((acc) => acc.cuenta_receptora.length > 0);

    try {
      const response = await fetch('/api/reconciliation/clients', {
        method: 'POST',
        headers: buildScopeHeaders(true),
        body: JSON.stringify({
          action: isEditing ? 'UPDATE_CLIENT' : 'CREATE_CLIENT',
          negocioId: activeNegocioId || undefined,
          clientId: editingClientId ?? undefined,
          nombreTitular: savedName,
          emailContacto: savedEmail,
          telefono: newClientPhone,
          pin: savedPin,
          porcentajeComisionZelle: Number.parseFloat(newClientFeeZelle || '4.00'),
          porcentajeComisionBinance: Number.parseFloat(
            newClientFeeBinance || '1.50'
          ),
          cuentasAsignadas: validAssignedAccounts,
        }),
      });

      const data = (await response.json()) as {
        ok: boolean;
        error?: string;
      };

      if (!response.ok || !data.ok) {
        throw new Error(data.error ?? 'No se pudo guardar la cuenta del cliente.');
      }

      await fetchAllData();
      setIsNewClientModalOpen(false);
      setEditingClientId(null);
      setNewClientName('');
      setNewClientEmail('');
      setNewClientPhone('');
      setNewClientPin('');
      setNewClientFeeZelle('4.00');
      setNewClientFeeBinance('1.50');
      setNewClientAssignedAccounts([]);

      setLastPortalCredentials({
        nombre: savedName,
        email: savedEmail,
        pin: savedPin,
      });

      setBannerMessage({
        type: 'success',
        text: `${isEditing ? 'Cuenta actualizada' : 'Cuenta de acceso creada'} para "${savedName}" (Correo: ${savedEmail}${
          savedPin ? ` · PIN: ${savedPin}` : ''
        }).`,
      });
    } catch (error: unknown) {
      const msg =
        error instanceof Error ? error.message : 'Error al guardar cliente.';
      setBannerMessage({ type: 'error', text: msg });
    } finally {
      setIsSavingClient(false);
    }
  };

  const handleCreateOrder = async (
    event: React.FormEvent<HTMLFormElement>
  ): Promise<void> => {
    event.preventDefault();
    setIsSavingOrder(true);
    setBannerMessage(null);

    try {
      const response = await fetch('/api/reconciliation/clients', {
        method: 'POST',
        headers: buildScopeHeaders(true),
        body: JSON.stringify({
          action: 'CREATE_ORDER',
          negocioId: activeNegocioId || undefined,
          clienteNombre: orderClientName,
          nombreRemitenteReportado: orderZelleSender || orderClientName,
          plataformaEsperada: orderBank,
          bancoDestino: orderBank,
          moneda: orderCurrency,
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
        text: `Orden de pago esperada por ${formatMoney(
          Number.parseFloat(orderAmount),
          orderCurrency
        )} registrada.${
          (data.autoReconciledCount ?? 0) > 0
            ? ' ¡Se hizo match inmediato con una transacción ya recibida!'
            : ' Cuando ingrese el movimiento del banco o Binance se conciliará automáticamente.'
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

  const resetMailboxForm = (): void => {
    setEditingMailboxId(null);
    setMailboxAlias('Buzón Principal Alertas Citibank, TD Bank & Binance');
    setMailboxEmail('');
    setMailboxPassword('');
    setMailboxHost('imap.gmail.com');
    setMailboxPort('993');
    setMailboxFolder('INBOX');
    setMailboxBanks('CITIBANK_TD_BINANCE');
    setMailboxPlatform('CITIBANK');
    setMailboxReceivingAccount('');
    setMailboxCurrency('USD');
    setVerifyImapBeforeSave(true);
  };

  const openEditMailbox = (mb: ImapMailboxRecord): void => {
    const plat: ExpectedPlatformType = mb.plataforma ?? 'CITIBANK';
    const curr: CurrencyType = mb.moneda ?? platformDefaultCurrency(plat);
    setEditingMailboxId(mb.id);
    setMailboxAlias(mb.alias);
    setMailboxEmail(mb.email_address);
    setMailboxPassword('');
    setMailboxHost(mb.imap_host);
    setMailboxPort(String(mb.imap_port));
    setMailboxFolder(mb.mailbox_folder);
    setMailboxBanks(mb.bancos_monitoreados);
    setMailboxPlatform(plat);
    setMailboxReceivingAccount(mb.cuenta_receptora || mb.email_address);
    setMailboxCurrency(curr);
    setVerifyImapBeforeSave(false);
  };

  const handleSaveMailbox = async (
    event: React.FormEvent<HTMLFormElement>
  ): Promise<void> => {
    event.preventDefault();
    setIsSavingMailbox(true);
    setBannerMessage(null);

    const resolvedReceivingAccount =
      mailboxReceivingAccount.trim() || mailboxEmail.trim();

    try {
      const response = await fetch('/api/reconciliation/mailboxes', {
        method: 'POST',
        headers: buildScopeHeaders(true),
        body: JSON.stringify({
          negocioId: activeNegocioId || undefined,
          mailboxId: editingMailboxId ?? undefined,
          alias: mailboxAlias,
          emailAddress: mailboxEmail,
          imapHost: mailboxHost,
          imapPort: Number.parseInt(mailboxPort, 10),
          imapSecure: true,
          imapPassword: mailboxPassword,
          mailboxFolder,
          bancosMonitoreados: mailboxBanks,
          plataforma: mailboxPlatform,
          cuentaReceptora: resolvedReceivingAccount,
          moneda: mailboxCurrency,
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

      const wasEditing = editingMailboxId !== null;
      const savedTarget = resolvedReceivingAccount;
      const savedCurr = mailboxCurrency;

      await fetchAllData();
      resetMailboxForm();
      setBannerMessage({
        type: 'success',
        text: wasEditing
          ? `Cuenta receptora "${savedTarget}" (${savedCurr}) actualizada exitosamente.`
          : `Correo "${mailboxEmail}" conectado exitosamente (${savedTarget} · ${savedCurr}).`,
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
      // ignorar
    }
  };

  const handleRunEmailSimulator = async (
    event: React.FormEvent<HTMLFormElement>
  ): Promise<void> => {
    event.preventDefault();
    setIsSimulating(true);
    setBannerMessage(null);

    try {
      const response = await fetch('/api/reconciliation/alerts', {
        method: 'POST',
        headers: buildScopeHeaders(true),
        body: JSON.stringify({
          negocioId: activeNegocioId || undefined,
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
        text: `Alerta procesada vía ${newAlert.origen_deteccion}: ${newAlert.plataforma} | Bruto ${formatMoney(
          newAlert.monto_bruto,
          newAlert.moneda
        )} | Comisión (${newAlert.porcentaje_comision}%): ${formatMoney(
          newAlert.monto_comision,
          newAlert.moneda
        )} | Neto: ${formatMoney(newAlert.monto_neto, newAlert.moneda)} | Estado: ${newAlert.estado}.`,
      });
    } catch (error: unknown) {
      const msg =
        error instanceof Error ? error.message : 'Error al parsear correo.';
      setBannerMessage({ type: 'error', text: msg });
    } finally {
      setIsSimulating(false);
    }
  };

  const fetchCaptureBase64 = async (
    orderId?: string | null,
    txId?: string | null
  ): Promise<string | null> => {
    try {
      const param = orderId
        ? `orderId=${encodeURIComponent(orderId)}`
        : `txId=${encodeURIComponent(txId ?? '')}`;
      const res = await fetch(`/api/reconciliation/capture?${param}`);
      if (!res.ok) return null;
      const data = await res.json();
      return data.comprobante_base64 ?? null;
    } catch {
      return null;
    }
  };

  const openLightboxForTx = async (tx: BankEmailAlertRecord): Promise<void> => {
    const linkedOrCandidateOrder = findAssociatedCaptureOrder(tx);
    let captureBase64 =
      tx.comprobante_base64 ?? linkedOrCandidateOrder?.comprobante_base64 ?? '';
    if (!captureBase64) {
      const orderIdToFetch = tx.orden_conciliada_id ?? linkedOrCandidateOrder?.id;
      const fetched = await fetchCaptureBase64(orderIdToFetch, tx.id);
      if (fetched) {
        captureBase64 = fetched;
        tx.comprobante_base64 = fetched;
        if (linkedOrCandidateOrder) {
          linkedOrCandidateOrder.comprobante_base64 = fetched;
        }
      }
    }
    if (!captureBase64) {
      return;
    }
    setLightboxData({
      title: `Auditoría de Comprobante · ${tx.codigo_orden ?? linkedOrCandidateOrder?.codigo_orden ?? tx.referencia}`,
      comprobanteBase64: captureBase64,
      order: linkedOrCandidateOrder,
      tx,
    });
  };

  const openLightboxForOrder = async (order: PendingPaymentOrder): Promise<void> => {
    let captureBase64 = order.comprobante_base64 ?? '';
    if (!captureBase64) {
      const fetched = await fetchCaptureBase64(order.id, null);
      if (fetched) {
        captureBase64 = fetched;
        order.comprobante_base64 = fetched;
      }
    }
    if (!captureBase64) {
      return;
    }
    const { tx: matchingTx } = findBestCandidateTxForOrder(order, alerts);

    setLightboxData({
      title: `Captura Subida en Portal · ${order.codigo_orden}`,
      comprobanteBase64: captureBase64,
      order,
      tx: matchingTx,
    });
  };

  // Inspector Drawer bajo demanda (solo presentación y vista previa perezosa al abrir)
  const selectedInspectorAlert = useMemo<BankEmailAlertRecord | null>(() => {
    if (!selectedInspectorAlertId) return null;
    return (
      filteredAlerts.find((a) => a.id === selectedInspectorAlertId) ??
      alerts.find((a) => a.id === selectedInspectorAlertId) ??
      null
    );
  }, [filteredAlerts, alerts, selectedInspectorAlertId]);

  const handleCopyReference = useCallback((alertId: string, refText: string) => {
    if (!refText || refText === 'SIN-REF') return;
    if (typeof navigator !== 'undefined' && navigator.clipboard) {
      void navigator.clipboard.writeText(refText).then(() => {
        setCopiedRefId(alertId);
        window.setTimeout(() => {
          setCopiedRefId((prev) => (prev === alertId ? null : prev));
        }, 1500);
      });
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    if (!isInspectorDrawerOpen || !selectedInspectorAlert) {
      setInspectorPreviewBase64(null);
      setIsLoadingInspectorPreview(false);
      return;
    }

    const candidateOrder = findAssociatedCaptureOrder(selectedInspectorAlert);
    const hasExisting =
      selectedInspectorAlert.comprobante_base64 ??
      candidateOrder?.comprobante_base64 ??
      null;

    if (hasExisting) {
      setInspectorPreviewBase64(hasExisting);
      setIsLoadingInspectorPreview(false);
      return;
    }

    const hasCaptureFlag = Boolean(
      selectedInspectorAlert.has_capture ||
        candidateOrder?.has_capture ||
        selectedInspectorAlert.orden_conciliada_id
    );

    if (!hasCaptureFlag) {
      setInspectorPreviewBase64(null);
      setIsLoadingInspectorPreview(false);
      return;
    }

    setInspectorPreviewBase64(null);
    setIsLoadingInspectorPreview(true);
    const orderIdToFetch =
      selectedInspectorAlert.orden_conciliada_id ?? candidateOrder?.id ?? null;

    void fetchCaptureBase64(orderIdToFetch, selectedInspectorAlert.id).then(
      (fetched) => {
        if (cancelled) return;
        setInspectorPreviewBase64(fetched);
        setIsLoadingInspectorPreview(false);
      }
    );

    return () => {
      cancelled = true;
    };
  }, [isInspectorDrawerOpen, selectedInspectorAlert, findAssociatedCaptureOrder]);

  // =========================================================================
  // HANDLERS: LOGIN DE USUARIOS / NEGOCIOS Y GESTIÓN MULTI-NEGOCIO
  // =========================================================================
  const handleBusinessLoginSubmit = async (
    event: React.FormEvent<HTMLFormElement>
  ): Promise<void> => {
    event.preventDefault();
    setIsSubmittingLogin(true);
    setLoginError(null);

    try {
      const response = await fetch('/api/auth/business', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          action: 'LOGIN',
          email: loginEmail.trim().toLowerCase(),
          password: loginPassword,
        }),
      });

      const data = (await response.json()) as {
        ok: boolean;
        mode?: 'POSTGRESQL_LIVE' | 'DEMO_FALLBACK';
        user?: BusinessUserRecord;
        businessUsers?: BusinessUserRecord[];
        error?: string;
      };

      if (!response.ok || !data.ok || !data.user) {
        throw new Error(data.error ?? 'Error al iniciar sesión.');
      }

      if (typeof window !== 'undefined') {
        window.localStorage.setItem(STORAGE_BUSINESS_USER_KEY, data.user.id);
        window.localStorage.setItem(STORAGE_ACTIVE_NEGOCIO_KEY, data.user.id);
        if (window.location.search.includes('login=')) {
          window.history.replaceState({}, '', window.location.pathname);
        }
      }

      setCurrentBusinessUser(data.user);
      setBusinessUsers(data.businessUsers ?? [data.user]);
      setActiveNegocioId(data.user.id);
      if (data.mode) {
        setDataSourceMode(data.mode);
      }
      setLoginPassword('');
      setIsLoginModalOpen(false);
      setIsPreviewingLanding(false);
      setActiveTab('ALERTS');
    } catch (error: unknown) {
      setLoginError(
        error instanceof Error ? error.message : 'Error de autenticación.'
      );
    } finally {
      setIsSubmittingLogin(false);
    }
  };

  const handleBusinessLogout = (): void => {
    if (typeof window !== 'undefined') {
      window.localStorage.removeItem(STORAGE_BUSINESS_USER_KEY);
      window.localStorage.removeItem(STORAGE_ACTIVE_NEGOCIO_KEY);
    }
    void fetch('/api/auth/business', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'LOGOUT' }),
    }).catch(() => undefined);
    setCurrentBusinessUser(null);
    setBusinessUsers([]);
    setActiveNegocioId('');
    setAlerts([]);
    setServerSummaryMetrics(null);
    setPendingOrders([]);
    setClients([]);
    setMailboxes([]);
    setIsPreviewingLanding(false);
    setBannerMessage(null);
  };

  const handleSwitchBusinessScope = (nextNegocioId: string): void => {
    setActiveNegocioId(nextNegocioId);
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(STORAGE_ACTIVE_NEGOCIO_KEY, nextNegocioId);
    }
    resetMailboxForm();
  };

  const openCreateBusinessUserModal = (): void => {
    setEditingBusinessUserId(null);
    setBizName('');
    setBizOwnerName('');
    setBizEmail('');
    setBizPhone('');
    setBizPassword(`Biz${Math.floor(1000 + Math.random() * 9000)}!`);
    setBizRole('NEGOCIO');
    setIsBusinessUserModalOpen(true);
  };

  const openEditBusinessUserModal = (user: BusinessUserRecord): void => {
    setEditingBusinessUserId(user.id);
    setBizName(user.nombre_negocio);
    setBizOwnerName(user.nombre_usuario);
    setBizEmail(user.email);
    setBizPhone(user.telefono ?? '');
    setBizPassword('');
    setBizRole(user.rol);
    setIsBusinessUserModalOpen(true);
  };

  const handleGenerateRandomBizPassword = (): void => {
    setBizPassword(`Neg${Math.floor(10000 + Math.random() * 89999)}`);
  };

  const handleSaveBusinessUser = async (
    event: React.FormEvent<HTMLFormElement>
  ): Promise<void> => {
    event.preventDefault();
    setIsSavingBusinessUser(true);
    setBannerMessage(null);

    const isEditing = editingBusinessUserId !== null;
    const savedNegocio = bizName.trim();
    const savedEmail = bizEmail.trim().toLowerCase();
    const savedPassword = bizPassword.trim();

    try {
      const response = await fetch('/api/auth/business', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          action: isEditing ? 'UPDATE_BUSINESS_USER' : 'CREATE_BUSINESS_USER',
          userId: editingBusinessUserId ?? undefined,
          nombreNegocio: savedNegocio,
          nombreUsuario: bizOwnerName.trim(),
          email: savedEmail,
          telefono: bizPhone,
          password: savedPassword,
          rol: bizRole,
        }),
      });

      const data = (await response.json()) as {
        ok: boolean;
        user?: BusinessUserRecord;
        businessUsers?: BusinessUserRecord[];
        error?: string;
      };

      if (!response.ok || !data.ok) {
        throw new Error(
          data.error ?? 'No se pudo guardar la cuenta del negocio.'
        );
      }

      if (Array.isArray(data.businessUsers)) {
        setBusinessUsers(data.businessUsers);
      }
      if (data.user && data.user.id === currentBusinessUser?.id) {
        setCurrentBusinessUser(data.user);
      }

      setIsBusinessUserModalOpen(false);
      setEditingBusinessUserId(null);
      setBizName('');
      setBizOwnerName('');
      setBizEmail('');
      setBizPhone('');
      setBizPassword('');

      if (!isEditing || savedPassword) {
        setLastBusinessCredentials({
          negocio: savedNegocio,
          email: savedEmail,
          password: savedPassword,
        });
      }

      setBannerMessage({
        type: 'success',
        text: `${isEditing ? 'Cuenta de negocio actualizada' : 'Nueva cuenta creada'} para "${savedNegocio}" (${savedEmail}).`,
      });
    } catch (error: unknown) {
      setBannerMessage({
        type: 'error',
        text:
          error instanceof Error
            ? error.message
            : 'Error guardando usuario de negocio.',
      });
    } finally {
      setIsSavingBusinessUser(false);
    }
  };

  const handleDeleteBusinessUser = async (
    id: string,
    nombreNegocio: string
  ): Promise<void> => {
    try {
      const res = await fetch(
        `/api/auth/business?id=${encodeURIComponent(id)}`,
        { method: 'DELETE' }
      );
      const data = (await res.json()) as { ok: boolean; error?: string };
      if (!res.ok || !data.ok) {
        throw new Error(data.error ?? 'No se pudo eliminar el negocio.');
      }

      if (activeNegocioId === id && currentBusinessUser) {
        handleSwitchBusinessScope(currentBusinessUser.id);
      }
      await fetchAllData();
      setBannerMessage({
        type: 'info',
        text: `Cuenta del negocio "${nombreNegocio}" eliminada.`,
      });
    } catch (error: unknown) {
      setBannerMessage({
        type: 'error',
        text:
          error instanceof Error ? error.message : 'Error eliminando negocio.',
      });
    }
  };

  const handleCopyBusinessCredentials = async (creds: {
    negocio: string;
    email: string;
    password: string;
  }): Promise<void> => {
    try {
      const panelUrl = `${window.location.origin}/?login=1`;
      const text = `Acceso al Panel de Negocio (${creds.negocio}):\nLink: ${panelUrl}\nCorreo: ${creds.email}${
        creds.password ? `\nContraseña: ${creds.password}` : ''
      }`;
      await navigator.clipboard.writeText(text);
      setBannerMessage({
        type: 'success',
        text: `Credenciales del negocio "${creds.negocio}" copiadas al portapapeles.`,
      });
    } catch {
      // ignorar si clipboard no disponible
    }
  };

  const activeBusinessRecord =
    businessUsers.find((b) => b.id === activeNegocioId) ?? currentBusinessUser;

  if (isCheckingAuth) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#FAF9F6] text-stone-600 dark:bg-[#121110] dark:text-stone-400">
        <div className="flex items-center gap-3 text-sm font-medium">
          <Loader2 className="h-4 w-4 animate-spin text-stone-500 dark:text-stone-400" strokeWidth={1.5} />
          Cargando ConciliarCuenta...
        </div>
      </div>
    );
  }

  if (!currentBusinessUser || isPreviewingLanding) {
    return (
      <>
        <LandingPageView
          onOpenLoginModal={() => {
            setLoginError(null);
            setIsLoginModalOpen(true);
          }}
          isAuthenticated={Boolean(currentBusinessUser)}
          onBackToDashboard={() => setIsPreviewingLanding(false)}
        />

        {/* Modal Login de Usuario / Negocio */}
        <Dialog.Root
          open={isLoginModalOpen}
          onOpenChange={(open) => {
            setIsLoginModalOpen(open);
            if (!open) {
              setLoginError(null);
            }
          }}
        >
          <Dialog.Portal>
            <Dialog.Overlay className="fixed inset-0 z-40 bg-stone-950/50 backdrop-blur-sm" />
            <Dialog.Content className="fixed left-1/2 top-1/2 z-50 w-[92vw] max-w-md -translate-x-1/2 -translate-y-1/2 rounded-xl border border-stone-200/90 bg-white p-6 text-stone-900 shadow-lg dark:border-stone-800 dark:bg-[#1C1A18] dark:text-stone-100">
              <div className="flex items-start justify-between border-b border-stone-200 pb-4 dark:border-stone-800">
                <div>
                  <p className="text-[11px] font-medium uppercase tracking-widest text-amber-700 dark:text-amber-500">
                    ConciliarCuenta · Acceso Corporativo
                  </p>
                  <Dialog.Title className="mt-1 flex items-center gap-2 font-serif text-xl font-medium tracking-tight text-stone-900 dark:text-stone-100">
                    <Lock className="h-4 w-4 text-stone-400 dark:text-stone-500" strokeWidth={1.5} />
                    Acceso de Usuarios y Negocios
                  </Dialog.Title>
                  <Dialog.Description className="mt-1 text-xs text-stone-500 dark:text-stone-400">
                    Ingresa con el correo y la contraseña asignados a tu negocio.
                  </Dialog.Description>
                </div>
                <div className="flex items-center gap-1.5">
                  <ThemeToggle />
                  <Dialog.Close asChild>
                    <button
                      type="button"
                      className="rounded-lg p-1.5 text-stone-400 transition hover:bg-stone-100 hover:text-stone-700 dark:text-stone-500 dark:hover:bg-stone-800 dark:hover:text-stone-200"
                    >
                      <X className="h-4 w-4" strokeWidth={1.5} />
                    </button>
                  </Dialog.Close>
                </div>
              </div>

              {loginError && (
                <div className="mt-4 rounded-lg border border-rose-700/25 bg-rose-50 px-3.5 py-2.5 text-xs text-rose-700 dark:border-rose-500/30 dark:bg-rose-950/40 dark:text-rose-400">
                  {loginError}
                </div>
              )}

              <form
                onSubmit={(e) => void handleBusinessLoginSubmit(e)}
                className="mt-5 space-y-4"
              >
                <div>
                  <label className="block text-[11px] font-medium uppercase tracking-wider text-stone-500 dark:text-stone-400">
                    Correo Electrónico *
                  </label>
                  <input
                    type="email"
                    required
                    value={loginEmail}
                    onChange={(e) => setLoginEmail(e.target.value)}
                    placeholder="usuario@tunegocio.com"
                    className="mt-1.5 w-full rounded-lg border border-stone-200 bg-[#FAF9F6] px-3.5 py-2.5 text-sm text-stone-900 placeholder-stone-400 focus:border-amber-700 focus:outline-none dark:border-stone-800 dark:bg-[#121110] dark:text-stone-100 dark:placeholder-stone-500 dark:focus:border-amber-500"
                  />
                </div>

                <div>
                  <label className="block text-[11px] font-medium uppercase tracking-wider text-stone-500 dark:text-stone-400">
                    Contraseña *
                  </label>
                  <input
                    type="password"
                    required
                    value={loginPassword}
                    onChange={(e) => setLoginPassword(e.target.value)}
                    placeholder="••••••••"
                    className="mt-1.5 w-full rounded-lg border border-stone-200 bg-[#FAF9F6] px-3.5 py-2.5 text-sm text-stone-900 placeholder-stone-400 focus:border-amber-700 focus:outline-none dark:border-stone-800 dark:bg-[#121110] dark:text-stone-100 dark:placeholder-stone-500 dark:focus:border-amber-500"
                  />
                </div>

                <button
                  type="submit"
                  disabled={isSubmittingLogin}
                  className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-stone-900 px-5 py-2.5 text-sm font-medium text-stone-50 shadow-sm transition hover:bg-stone-800 disabled:opacity-60 dark:bg-stone-100 dark:text-stone-950 dark:hover:bg-white"
                >
                  {isSubmittingLogin ? (
                    <Loader2 className="h-4 w-4 animate-spin" strokeWidth={1.5} />
                  ) : (
                    <LogIn className="h-4 w-4" strokeWidth={1.5} />
                  )}
                  Entrar al Panel del Negocio
                </button>

                <div className="border-t border-stone-200 pt-3.5 text-center text-xs text-stone-500 dark:border-stone-800 dark:text-stone-400">
                  ¿Eres cliente final reportando un comprobante?{' '}
                  <Link
                    href="/portal"
                    className="font-medium text-amber-700 underline-offset-4 hover:underline dark:text-amber-500"
                  >
                    Ir al Portal de Clientes
                  </Link>
                </div>
              </form>
            </Dialog.Content>
          </Dialog.Portal>
        </Dialog.Root>
      </>
    );
  }

  return (
    <div className="min-h-screen bg-[#FAF9F6] text-stone-900 dark:bg-[#121110] dark:text-stone-100">
      <div className="mx-auto w-full max-w-[1680px] px-3 py-5 sm:px-6 lg:px-8">
        {/* Cabecera Editorial Limpia */}
        <header className="mb-5 border-b border-stone-200 dark:border-stone-800">
          <div className="flex flex-col gap-4 pb-4 lg:flex-row lg:items-center lg:justify-between">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
                <h1 className="font-serif text-2xl font-medium tracking-tight text-stone-900 sm:text-[28px] dark:text-stone-100">
                  ConciliarCuenta
                </h1>
                <span className="hidden h-4 w-px bg-stone-200 sm:inline-block dark:bg-stone-800" />
                <span
                  className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[11px] font-medium ${
                    dataSourceMode === 'POSTGRESQL_LIVE'
                      ? 'border-emerald-700/20 bg-emerald-50 text-emerald-700 dark:border-emerald-500/30 dark:bg-emerald-950/40 dark:text-emerald-400'
                      : 'border-amber-700/20 bg-amber-50 text-amber-700 dark:border-amber-500/30 dark:bg-amber-950/40 dark:text-amber-400'
                  }`}
                >
                  <span
                    className={`h-1.5 w-1.5 rounded-full ${
                      dataSourceMode === 'POSTGRESQL_LIVE'
                        ? 'bg-emerald-700 dark:bg-emerald-400'
                        : 'bg-amber-700 dark:bg-amber-400'
                    }`}
                  />
                  {dataSourceMode === 'POSTGRESQL_LIVE'
                    ? 'PostgreSQL Activo'
                    : 'Previsualización'}
                </span>
                <span className="inline-flex items-center gap-1.5 rounded-full border border-stone-200/90 bg-white px-2.5 py-0.5 font-mono text-[11px] tabular-nums text-stone-600 dark:border-stone-800 dark:bg-[#1C1A18] dark:text-stone-400">
                  <Mail className="h-3 w-3 text-stone-400 dark:text-stone-500" strokeWidth={1.5} />
                  {mailboxes.length > 0
                    ? `${mailboxes.length} IMAP`
                    : 'Sin IMAP'}
                </span>
                <span className="inline-flex items-center gap-1.5 text-xs text-stone-500 dark:text-stone-400">
                  <Briefcase className="h-3.5 w-3.5 text-stone-400 dark:text-stone-500" strokeWidth={1.5} />
                  <span className="font-medium text-stone-700 dark:text-stone-300">
                    {activeBusinessRecord?.nombre_negocio ?? 'Negocio Activo'}
                  </span>
                </span>
              </div>
              <p className="mt-1 text-xs text-stone-500 dark:text-stone-400">
                Operador:{' '}
                <span className="font-medium text-stone-700 dark:text-stone-300">
                  {currentBusinessUser.nombre_usuario}
                </span>{' '}
                <span className="hidden sm:inline">
                  ({currentBusinessUser.email}) · Citibank, TD Bank &amp; Binance
                </span>
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {currentBusinessUser.rol === 'SUPER_ADMIN' &&
                businessUsers.length > 1 && (
                  <select
                    value={activeNegocioId}
                    onChange={(e) => handleSwitchBusinessScope(e.target.value)}
                    aria-label="Seleccionar negocio activo"
                    className="rounded-lg border border-stone-200/90 bg-white px-3 py-2 text-xs font-medium text-stone-800 focus:border-amber-700 focus:outline-none dark:border-stone-800 dark:bg-[#1C1A18] dark:text-stone-200 dark:focus:border-amber-500"
                  >
                    {businessUsers.map((biz) => (
                      <option key={biz.id} value={biz.id}>
                        Negocio: {biz.nombre_negocio}
                      </option>
                    ))}
                  </select>
                )}

              <button
                type="button"
                onClick={() => void handleSyncImapNow()}
                disabled={isSyncingImap || isLoading}
                className="inline-flex items-center gap-2 rounded-lg bg-stone-900 px-3.5 py-2 text-xs font-medium text-stone-50 shadow-sm transition hover:bg-stone-800 disabled:cursor-not-allowed disabled:opacity-60 dark:bg-stone-100 dark:text-stone-950 dark:hover:bg-white"
              >
                {isSyncingImap ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={1.5} />
                ) : (
                  <RefreshCw className="h-3.5 w-3.5" strokeWidth={1.5} />
                )}
                Sincronizar IMAP + Binance
              </button>

              <ThemeToggle />

              {/* Menú Desplegable Acciones */}
              <div className="relative">
                <button
                  type="button"
                  onClick={() => setIsActionsMenuOpen((prev) => !prev)}
                  aria-expanded={isActionsMenuOpen}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-stone-200/90 bg-white px-3 py-2 text-xs font-medium text-stone-700 shadow-sm transition hover:border-stone-300 hover:bg-stone-50 dark:border-stone-800 dark:bg-[#1C1A18] dark:text-stone-200 dark:hover:border-stone-700 dark:hover:bg-stone-900"
                >
                  Acciones
                  <ChevronDown
                    className={`h-3.5 w-3.5 text-stone-400 transition-transform ${
                      isActionsMenuOpen ? 'rotate-180' : ''
                    }`}
                    strokeWidth={1.5}
                  />
                </button>

                {isActionsMenuOpen && (
                  <>
                    <div
                      className="fixed inset-0 z-30"
                      onClick={() => setIsActionsMenuOpen(false)}
                    />
                    <div className="absolute right-0 z-40 mt-2 w-56 rounded-xl border border-stone-200/90 bg-white p-1.5 shadow-lg dark:border-stone-800 dark:bg-[#1C1A18]">
                      <Link
                        href="/portal"
                        onClick={() => setIsActionsMenuOpen(false)}
                        className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-xs font-medium text-stone-700 transition hover:bg-stone-100 dark:text-stone-200 dark:hover:bg-stone-800/80"
                      >
                        <ExternalLink className="h-3.5 w-3.5 text-stone-400 dark:text-stone-500" strokeWidth={1.5} />
                        Portal Clientes (/portal)
                      </Link>

                      <button
                        type="button"
                        onClick={() => {
                          setIsActionsMenuOpen(false);
                          void handleCopyPortalLink();
                        }}
                        className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-xs font-medium text-stone-700 transition hover:bg-stone-100 dark:text-stone-200 dark:hover:bg-stone-800/80"
                      >
                        {portalLinkCopied ? (
                          <Check className="h-3.5 w-3.5 text-emerald-700 dark:text-emerald-400" strokeWidth={1.5} />
                        ) : (
                          <Copy className="h-3.5 w-3.5 text-stone-400 dark:text-stone-500" strokeWidth={1.5} />
                        )}
                        {portalLinkCopied ? 'Link Copiado' : 'Copiar Link Portal'}
                      </button>

                      <button
                        type="button"
                        onClick={() => {
                          setIsActionsMenuOpen(false);
                          openCreateClientModal();
                        }}
                        className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-xs font-medium text-stone-700 transition hover:bg-stone-100 dark:text-stone-200 dark:hover:bg-stone-800/80"
                      >
                        <UserPlus className="h-3.5 w-3.5 text-stone-400 dark:text-stone-500" strokeWidth={1.5} />
                        Crear Acceso Cliente
                      </button>

                      <button
                        type="button"
                        onClick={() => {
                          setIsActionsMenuOpen(false);
                          setIsSimulatorOpen(true);
                        }}
                        className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-xs font-medium text-stone-700 transition hover:bg-stone-100 dark:text-stone-200 dark:hover:bg-stone-800/80"
                      >
                        <MailPlus className="h-3.5 w-3.5 text-stone-400 dark:text-stone-500" strokeWidth={1.5} />
                        Simular Email
                      </button>

                      <button
                        type="button"
                        onClick={() => {
                          setIsActionsMenuOpen(false);
                          setIsPreviewingLanding(true);
                        }}
                        className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-xs font-medium text-stone-700 transition hover:bg-stone-100 dark:text-stone-200 dark:hover:bg-stone-800/80"
                      >
                        <Globe className="h-3.5 w-3.5 text-stone-400 dark:text-stone-500" strokeWidth={1.5} />
                        Ver Landing Page
                      </button>

                      <div className="my-1 border-t border-stone-200 dark:border-stone-800" />

                      <button
                        type="button"
                        onClick={() => {
                          setIsActionsMenuOpen(false);
                          handleBusinessLogout();
                        }}
                        className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-xs font-medium text-rose-700 transition hover:bg-rose-50 dark:text-rose-400 dark:hover:bg-rose-950/40"
                      >
                        <LogOut className="h-3.5 w-3.5" strokeWidth={1.5} />
                        Salir
                      </button>
                    </div>
                  </>
                )}
              </div>
            </div>
          </div>

          {/* Fila Inferior: Navegación Editorial por Pestañas */}
          <nav
            aria-label="Secciones del panel"
            className="-mb-px flex items-center gap-6 overflow-x-auto"
          >
            <button
              type="button"
              onClick={() => {
                setActiveTab('ALERTS');
                setMovementFilter('RECIBIDO');
              }}
              className={`inline-flex shrink-0 items-center gap-2 border-b-2 pb-3 pt-1 text-sm font-medium transition ${
                activeTab === 'ALERTS'
                  ? 'border-amber-700 text-stone-900 dark:border-amber-500 dark:text-stone-100'
                  : 'border-transparent text-stone-500 hover:border-stone-300 hover:text-stone-800 dark:text-stone-400 dark:hover:border-stone-700 dark:hover:text-stone-200'
              }`}
            >
              <DollarSign className="h-4 w-4 text-stone-400 dark:text-stone-500" strokeWidth={1.5} />
              <span>Transacciones</span>
              <span className="rounded-md bg-stone-100 px-1.5 py-0.5 font-mono text-[11px] tabular-nums text-stone-600 dark:bg-stone-800 dark:text-stone-400">
                {receivedAlertsCount}
              </span>
            </button>

            <button
              type="button"
              onClick={() => setActiveTab('EXPENSES')}
              className={`inline-flex shrink-0 items-center gap-2 border-b-2 pb-3 pt-1 text-sm font-medium transition ${
                activeTab === 'EXPENSES'
                  ? 'border-amber-700 text-stone-900 dark:border-amber-500 dark:text-stone-100'
                  : 'border-transparent text-stone-500 hover:border-stone-300 hover:text-stone-800 dark:text-stone-400 dark:hover:border-stone-700 dark:hover:text-stone-200'
              }`}
            >
              <CreditCard className="h-4 w-4 text-stone-400 dark:text-stone-500" strokeWidth={1.5} />
              <span>Egresos</span>
              <span className="rounded-md bg-stone-100 px-1.5 py-0.5 font-mono text-[11px] tabular-nums text-stone-600 dark:bg-stone-800 dark:text-stone-400">
                {sentAlertsCount}
              </span>
            </button>

            <button
              type="button"
              onClick={() => setActiveTab('CLIENTS')}
              className={`inline-flex shrink-0 items-center gap-2 border-b-2 pb-3 pt-1 text-sm font-medium transition ${
                activeTab === 'CLIENTS'
                  ? 'border-amber-700 text-stone-900 dark:border-amber-500 dark:text-stone-100'
                  : 'border-transparent text-stone-500 hover:border-stone-300 hover:text-stone-800 dark:text-stone-400 dark:hover:border-stone-700 dark:hover:text-stone-200'
              }`}
            >
              <Users className="h-4 w-4 text-stone-400 dark:text-stone-500" strokeWidth={1.5} />
              <span>Clientes</span>
              <span className="rounded-md bg-stone-100 px-1.5 py-0.5 font-mono text-[11px] tabular-nums text-stone-600 dark:bg-stone-800 dark:text-stone-400">
                {clients.length}/{pendingOrders.length}
              </span>
            </button>

            <button
              type="button"
              onClick={() => setActiveTab('LIQUIDATIONS')}
              className={`inline-flex shrink-0 items-center gap-2 border-b-2 pb-3 pt-1 text-sm font-medium transition ${
                activeTab === 'LIQUIDATIONS'
                  ? 'border-amber-700 text-stone-900 dark:border-amber-500 dark:text-stone-100'
                  : 'border-transparent text-stone-500 hover:border-stone-300 hover:text-stone-800 dark:text-stone-400 dark:hover:border-stone-700 dark:hover:text-stone-200'
              }`}
            >
              <Coins className="h-4 w-4 text-stone-400 dark:text-stone-500" strokeWidth={1.5} />
              <span>Liquidaciones</span>
              <span className="rounded-md bg-stone-100 px-1.5 py-0.5 font-mono text-[11px] tabular-nums text-stone-600 dark:bg-stone-800 dark:text-stone-400">
                {liquidations.length}
              </span>
            </button>

            <button
              type="button"
              onClick={() => setActiveTab('MAILBOXES')}
              className={`inline-flex shrink-0 items-center gap-2 border-b-2 pb-3 pt-1 text-sm font-medium transition ${
                activeTab === 'MAILBOXES'
                  ? 'border-amber-700 text-stone-900 dark:border-amber-500 dark:text-stone-100'
                  : 'border-transparent text-stone-500 hover:border-stone-300 hover:text-stone-800 dark:text-stone-400 dark:hover:border-stone-700 dark:hover:text-stone-200'
              }`}
            >
              <Inbox className="h-4 w-4 text-stone-400 dark:text-stone-500" strokeWidth={1.5} />
              <span>IMAP</span>
              <span className="rounded-md bg-stone-100 px-1.5 py-0.5 font-mono text-[11px] tabular-nums text-stone-600 dark:bg-stone-800 dark:text-stone-400">
                {mailboxes.length}
              </span>
            </button>

            {currentBusinessUser.rol === 'SUPER_ADMIN' && (
              <button
                type="button"
                onClick={() => setActiveTab('BUSINESS_USERS')}
                className={`inline-flex shrink-0 items-center gap-2 border-b-2 pb-3 pt-1 text-sm font-medium transition ${
                  activeTab === 'BUSINESS_USERS'
                    ? 'border-amber-700 text-stone-900 dark:border-amber-500 dark:text-stone-100'
                    : 'border-transparent text-stone-500 hover:border-stone-300 hover:text-stone-800 dark:text-stone-400 dark:hover:border-stone-700 dark:hover:text-stone-200'
                }`}
              >
                <Briefcase className="h-4 w-4 text-stone-400 dark:text-stone-500" strokeWidth={1.5} />
                <span>Usuarios</span>
                <span className="rounded-md bg-stone-100 px-1.5 py-0.5 font-mono text-[11px] tabular-nums text-stone-600 dark:bg-stone-800 dark:text-stone-400">
                  {businessUsers.length}
                </span>
              </button>
            )}
          </nav>
        </header>

        {/* Notificación de Estado */}
        {bannerMessage && (
          <div
            className={`mb-5 flex items-center justify-between rounded-xl border px-4 py-3 text-sm ${
              bannerMessage.type === 'success'
                ? 'border-emerald-700/20 bg-emerald-50 text-emerald-800 dark:border-emerald-500/30 dark:bg-emerald-950/40 dark:text-emerald-300'
                : bannerMessage.type === 'warning'
                  ? 'border-amber-700/25 bg-amber-50 text-amber-800 dark:border-amber-500/30 dark:bg-amber-950/40 dark:text-amber-300'
                  : bannerMessage.type === 'error'
                    ? 'border-rose-700/25 bg-rose-50 text-rose-800 dark:border-rose-500/30 dark:bg-rose-950/40 dark:text-rose-300'
                    : 'border-stone-200/90 bg-white text-stone-700 dark:border-stone-800 dark:bg-[#1C1A18] dark:text-stone-200'
            }`}
          >
            <div className="flex items-center gap-2.5">
              <Sparkles className="h-4 w-4 shrink-0 opacity-80" strokeWidth={1.5} />
              <span>{bannerMessage.text}</span>
            </div>
            <button
              type="button"
              onClick={() => setBannerMessage(null)}
              className="ml-4 rounded p-1 opacity-70 transition hover:opacity-100"
              aria-label="Cerrar aviso"
            >
              <X className="h-4 w-4" strokeWidth={1.5} />
            </button>
          </div>
        )}

        {/* =====================================================================
            CINTA FINANCIERA COMPACTA MULTI-CANAL (ZELLE USD / BINANCE USDT)
           ===================================================================== */}
        <section
          aria-label="Resumen Financiero Multi-Canal"
          className="mb-5 rounded-xl border border-stone-200/90 bg-white shadow-sm dark:border-stone-800 dark:bg-[#1C1A18]"
        >
          {/* Barra Superior de Canal */}
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-stone-200/80 px-4 py-3 dark:border-stone-800">
            <div className="inline-flex items-center rounded-lg border border-stone-200/90 bg-[#FAF9F6] p-0.5 dark:border-stone-800 dark:bg-[#121110]">
              <button
                type="button"
                onClick={() => setActiveFinanceChannel('ZELLE')}
                className={`inline-flex items-center gap-2 rounded-md px-3 py-1.5 text-xs font-medium transition ${
                  activeFinanceChannel === 'ZELLE'
                    ? 'bg-stone-900 text-stone-50 shadow-sm dark:bg-stone-100 dark:text-stone-950'
                    : 'text-stone-600 hover:text-stone-900 dark:text-stone-400 dark:hover:text-stone-100'
                }`}
              >
                <Building2 className="h-3.5 w-3.5" strokeWidth={1.5} />
                <span>Zelle USD</span>
                <span className="font-mono text-[11px] tabular-nums opacity-80">
                  {formatMoney(financialMetrics.zelleNetoLiquidableUsd, 'USD')}
                </span>
              </button>
              <button
                type="button"
                onClick={() => setActiveFinanceChannel('BINANCE')}
                className={`inline-flex items-center gap-2 rounded-md px-3 py-1.5 text-xs font-medium transition ${
                  activeFinanceChannel === 'BINANCE'
                    ? 'bg-stone-900 text-stone-50 shadow-sm dark:bg-stone-100 dark:text-stone-950'
                    : 'text-stone-600 hover:text-stone-900 dark:text-stone-400 dark:hover:text-stone-100'
                }`}
              >
                <Coins className="h-3.5 w-3.5" strokeWidth={1.5} />
                <span>Binance USDT</span>
                <span className="font-mono text-[11px] tabular-nums opacity-80">
                  {formatMoney(financialMetrics.binanceNetoDisponibleUsdt, 'USDT')}
                </span>
              </button>
            </div>

            <div className="text-xs text-stone-500 dark:text-stone-400">
              {activeFinanceChannel === 'ZELLE'
                ? 'Citibank & TD Bank · Conciliado histórico y saldo por liquidar'
                : 'Binance Pay, P2P & Depósitos Red · Conciliado USDT'}
            </div>
          </div>

          {/* Barra Unificada de 4 KPIs */}
          {activeFinanceChannel === 'ZELLE' ? (
            <>
              <div className="grid grid-cols-2 divide-y divide-stone-200 sm:grid-cols-4 sm:divide-x sm:divide-y-0 dark:divide-stone-800">
                <div className="px-4 py-3.5 sm:px-5">
                  <span className="text-[11px] font-medium uppercase tracking-wider text-stone-500 dark:text-stone-400">
                    Neto Conciliado
                  </span>
                  <p className="mt-1 font-mono text-xl font-semibold tracking-tight tabular-nums text-stone-900 dark:text-stone-100">
                    {formatMoney(
                      financialMetrics.zelleNetoAcumuladoUsd ??
                        financialMetrics.zelleNetoLiquidableUsd,
                      'USD'
                    )}
                  </p>
                  <p className="mt-0.5 font-mono text-[11px] tabular-nums text-stone-500 dark:text-stone-400">
                    Bruto {formatMoney(financialMetrics.zelleBrutoRecibidoUsd, 'USD')} ·{' '}
                    {financialMetrics.pagosConciliadosHistoricoCount ??
                      financialMetrics.pagosConciliadosCount}{' '}
                    pagos
                  </p>
                </div>

                <div className="px-4 py-3.5 sm:px-5">
                  <span className="text-[11px] font-medium uppercase tracking-wider text-stone-500 dark:text-stone-400">
                    Comisión
                  </span>
                  <p className="mt-1 font-mono text-xl font-semibold tracking-tight tabular-nums text-stone-900 dark:text-stone-100">
                    -{formatMoney(financialMetrics.zelleComisionRetenidaUsd, 'USD')}
                  </p>
                  <p className="mt-0.5 font-mono text-[11px] tabular-nums text-stone-500 dark:text-stone-400">
                    Ciclo actual: -
                    {formatMoney(financialMetrics.zelleCicloComisionUsd ?? 0, 'USD')}
                  </p>
                </div>

                <div className="px-4 py-3.5 sm:px-5">
                  <span className="text-[11px] font-medium uppercase tracking-wider text-stone-500 dark:text-stone-400">
                    Total Liquidado
                  </span>
                  <p className="mt-1 font-mono text-xl font-semibold tracking-tight tabular-nums text-stone-900 dark:text-stone-100">
                    -{formatMoney(financialMetrics.zelleLiquidadoUsd ?? 0, 'USD')}
                  </p>
                  <p className="mt-0.5 text-[11px] text-stone-500 dark:text-stone-400">
                    Ya pagado a titulares
                  </p>
                </div>

                <div className="px-4 py-3.5 sm:px-5">
                  <span className="text-[11px] font-medium uppercase tracking-wider text-stone-500 dark:text-stone-400">
                    Saldo Pendiente
                  </span>
                  <p
                    className={`mt-1 font-serif text-2xl font-medium tracking-tight tabular-nums ${
                      financialMetrics.zelleNetoLiquidableUsd < 0
                        ? 'text-rose-700 dark:text-rose-400'
                        : financialMetrics.zelleNetoLiquidableUsd > 0
                          ? 'text-emerald-700 dark:text-emerald-400'
                          : 'text-stone-900 dark:text-stone-100'
                    }`}
                  >
                    {formatMoney(financialMetrics.zelleNetoLiquidableUsd, 'USD')}
                  </p>
                  <p className="mt-0.5 font-mono text-[11px] tabular-nums text-stone-500 dark:text-stone-400">
                    Ciclo activo: +
                    {formatMoney(financialMetrics.zelleCicloNetoUsd ?? 0, 'USD')}
                  </p>
                </div>
              </div>

              {/* Línea Compacta: Titulares Acreditados + En Espera por Conciliar */}
              {(clientsWithReconciledFunds.some(
                (c) => c.total_neto_usd > 0 || c.pagos_conciliados_count > 0
              ) ||
                financialMetrics.zellePorConciliarUsd > 0) && (
                <div className="flex flex-wrap items-center justify-between gap-3 border-t border-stone-200/80 bg-[#FAF9F6]/60 px-4 py-2.5 dark:border-stone-800 dark:bg-[#121110]/50">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="inline-flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wider text-stone-500 dark:text-stone-400">
                      <UserCheck className="h-3.5 w-3.5 text-stone-400 dark:text-stone-500" strokeWidth={1.5} />
                      Titulares:
                    </span>
                    {clientsWithReconciledFunds
                      .filter(
                        (c) =>
                          c.total_neto_usd > 0 || c.pagos_conciliados_count > 0
                      )
                      .map((client) => {
                        const isSelected = selectedClientFilter === client.id;
                        const clientLiquidadoUsd = Number(
                          client.total_liquidado_usd ?? 0
                        );
                        const clientSaldoPendienteUsd =
                          Math.round(
                            Number(
                              client.saldo_disponible_usd ??
                                client.total_neto_usd - clientLiquidadoUsd
                            ) * 100
                          ) / 100;
                        return (
                          <button
                            key={client.id}
                            type="button"
                            onClick={() =>
                              setSelectedClientFilter(
                                isSelected ? 'TODOS' : client.id
                              )
                            }
                            title={`Filtrar movimientos de ${client.nombre_titular} · Conciliado ${formatMoney(client.total_neto_usd, 'USD')} · Liquidado ${formatMoney(clientLiquidadoUsd, 'USD')}`}
                            className={`inline-flex items-center gap-2 rounded-full border px-2.5 py-1 text-xs transition ${
                              isSelected
                                ? 'border-amber-700 bg-amber-50 text-stone-900 dark:border-amber-500 dark:bg-amber-950/40 dark:text-stone-100'
                                : 'border-stone-200/90 bg-white text-stone-700 hover:border-stone-300 dark:border-stone-800 dark:bg-[#1C1A18] dark:text-stone-300 dark:hover:border-stone-700'
                            }`}
                          >
                            <span className="font-medium">
                              {client.nombre_titular}
                            </span>
                            <span className="text-[10px] text-stone-400 dark:text-stone-500">
                              ({client.pagos_conciliados_count})
                            </span>
                            <span
                              className={`font-mono text-xs font-semibold tabular-nums ${
                                clientSaldoPendienteUsd < 0
                                  ? 'text-rose-700 dark:text-rose-400'
                                  : clientSaldoPendienteUsd > 0
                                    ? 'text-emerald-700 dark:text-emerald-400'
                                    : 'text-stone-600 dark:text-stone-400'
                              }`}
                            >
                              {formatMoney(clientSaldoPendienteUsd, 'USD')}
                            </span>
                          </button>
                        );
                      })}
                  </div>

                  {financialMetrics.zellePorConciliarUsd > 0 && (
                    <div className="inline-flex items-center gap-2 text-xs text-amber-700 dark:text-amber-400">
                      <Clock className="h-3.5 w-3.5 shrink-0" strokeWidth={1.5} />
                      <span>
                        En espera por conciliar:{' '}
                        <strong className="font-mono font-semibold tabular-nums">
                          {formatMoney(financialMetrics.zellePorConciliarUsd, 'USD')}
                        </strong>{' '}
                        <span className="font-mono text-[11px] tabular-nums text-stone-500 dark:text-stone-400">
                          (
                          {financialMetrics.pagosRevisionManualCount +
                            financialMetrics.pagosDetectadosCount}{' '}
                          correos)
                        </span>
                      </span>
                    </div>
                  )}
                </div>
              )}
            </>
          ) : (
            <>
              <div className="grid grid-cols-2 divide-y divide-stone-200 sm:grid-cols-4 sm:divide-x sm:divide-y-0 dark:divide-stone-800">
                <div className="px-4 py-3.5 sm:px-5">
                  <span className="text-[11px] font-medium uppercase tracking-wider text-stone-500 dark:text-stone-400">
                    Neto Conciliado
                  </span>
                  <p className="mt-1 font-mono text-xl font-semibold tracking-tight tabular-nums text-stone-900 dark:text-stone-100">
                    {formatMoney(
                      financialMetrics.binanceNetoAcumuladoUsdt ??
                        financialMetrics.binanceNetoDisponibleUsdt,
                      'USDT'
                    )}
                  </p>
                  <p className="mt-0.5 font-mono text-[11px] tabular-nums text-stone-500 dark:text-stone-400">
                    Bruto {formatMoney(financialMetrics.binanceRecibidoUsdt, 'USDT')}
                  </p>
                </div>

                <div className="px-4 py-3.5 sm:px-5">
                  <span className="text-[11px] font-medium uppercase tracking-wider text-stone-500 dark:text-stone-400">
                    Comisión
                  </span>
                  <p className="mt-1 font-mono text-xl font-semibold tracking-tight tabular-nums text-stone-900 dark:text-stone-100">
                    -{formatMoney(financialMetrics.binanceComisionRetenidaUsdt, 'USDT')}
                  </p>
                  <p className="mt-0.5 text-[11px] text-stone-500 dark:text-stone-400">
                    Fee sobre conciliados
                  </p>
                </div>

                <div className="px-4 py-3.5 sm:px-5">
                  <span className="text-[11px] font-medium uppercase tracking-wider text-stone-500 dark:text-stone-400">
                    Total Liquidado
                  </span>
                  <p className="mt-1 font-mono text-xl font-semibold tracking-tight tabular-nums text-stone-900 dark:text-stone-100">
                    -{formatMoney(financialMetrics.binanceLiquidadoUsdt ?? 0, 'USDT')}
                  </p>
                  <p className="mt-0.5 text-[11px] text-stone-500 dark:text-stone-400">
                    Ya pagado en USDT
                  </p>
                </div>

                <div className="px-4 py-3.5 sm:px-5">
                  <span className="text-[11px] font-medium uppercase tracking-wider text-stone-500 dark:text-stone-400">
                    Saldo Pendiente
                  </span>
                  <p
                    className={`mt-1 font-serif text-2xl font-medium tracking-tight tabular-nums ${
                      financialMetrics.binanceNetoDisponibleUsdt < 0
                        ? 'text-rose-700 dark:text-rose-400'
                        : financialMetrics.binanceNetoDisponibleUsdt > 0
                          ? 'text-emerald-700 dark:text-emerald-400'
                          : 'text-stone-900 dark:text-stone-100'
                    }`}
                  >
                    {formatMoney(financialMetrics.binanceNetoDisponibleUsdt, 'USDT')}
                  </p>
                  <p className="mt-0.5 text-[11px] text-stone-500 dark:text-stone-400">
                    Conciliado − Liquidado
                  </p>
                </div>
              </div>

              {(clientsWithReconciledFunds.some((c) => c.total_neto_usdt > 0) ||
                financialMetrics.binancePorConciliarUsdt > 0) && (
                <div className="flex flex-wrap items-center justify-between gap-3 border-t border-stone-200/80 bg-[#FAF9F6]/60 px-4 py-2.5 dark:border-stone-800 dark:bg-[#121110]/50">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="inline-flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wider text-stone-500 dark:text-stone-400">
                      <UserCheck className="h-3.5 w-3.5 text-stone-400 dark:text-stone-500" strokeWidth={1.5} />
                      Titulares USDT:
                    </span>
                    {clientsWithReconciledFunds
                      .filter((c) => c.total_neto_usdt > 0)
                      .map((client) => {
                        const isSelected = selectedClientFilter === client.id;
                        const clientLiquidadoUsdt = Number(
                          client.total_liquidado_usdt ?? 0
                        );
                        const clientSaldoPendienteUsdt =
                          Math.round(
                            Number(
                              client.saldo_disponible_usdt ??
                                client.total_neto_usdt - clientLiquidadoUsdt
                            ) * 100
                          ) / 100;
                        return (
                          <button
                            key={client.id}
                            type="button"
                            onClick={() =>
                              setSelectedClientFilter(
                                isSelected ? 'TODOS' : client.id
                              )
                            }
                            className={`inline-flex items-center gap-2 rounded-full border px-2.5 py-1 text-xs transition ${
                              isSelected
                                ? 'border-amber-700 bg-amber-50 text-stone-900 dark:border-amber-500 dark:bg-amber-950/40 dark:text-stone-100'
                                : 'border-stone-200/90 bg-white text-stone-700 hover:border-stone-300 dark:border-stone-800 dark:bg-[#1C1A18] dark:text-stone-300 dark:hover:border-stone-700'
                            }`}
                          >
                            <span className="font-medium">
                              {client.nombre_titular}
                            </span>
                            <span
                              className={`font-mono text-xs font-semibold tabular-nums ${
                                clientSaldoPendienteUsdt < 0
                                  ? 'text-rose-700 dark:text-rose-400'
                                  : clientSaldoPendienteUsdt > 0
                                    ? 'text-emerald-700 dark:text-emerald-400'
                                    : 'text-stone-600 dark:text-stone-400'
                              }`}
                            >
                              {formatMoney(clientSaldoPendienteUsdt, 'USDT')}
                            </span>
                          </button>
                        );
                      })}
                  </div>

                  {financialMetrics.binancePorConciliarUsdt > 0 && (
                    <div className="inline-flex items-center gap-2 text-xs text-amber-700 dark:text-amber-400">
                      <Clock className="h-3.5 w-3.5 shrink-0" strokeWidth={1.5} />
                      <span>
                        En espera por conciliar:{' '}
                        <strong className="font-mono font-semibold tabular-nums">
                          {formatMoney(financialMetrics.binancePorConciliarUsdt, 'USDT')}
                        </strong>
                      </span>
                    </div>
                  )}
                </div>
              )}
            </>
          )}
        </section>

        {/* Barra de Estado de Conciliación (Control Principal de Estado, sin duplicar select) */}
        <div className="mb-4 flex flex-wrap items-center gap-2 text-xs">
          <button
            type="button"
            onClick={() => {
              setActiveTab('ALERTS');
              setStatusFilter('TODOS');
            }}
            className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 font-medium transition cursor-pointer ${
              statusFilter === 'TODOS' && activeTab === 'ALERTS'
                ? 'border-stone-900 bg-stone-900 text-stone-50 dark:border-stone-200 dark:bg-stone-100 dark:text-stone-950'
                : 'border-stone-200/90 bg-white text-stone-700 hover:border-stone-300 dark:border-stone-800 dark:bg-[#1C1A18] dark:text-stone-300 dark:hover:border-stone-700'
            }`}
            title="Mostrar todos los estados"
          >
            <span>Todos</span>
          </button>

          <button
            type="button"
            onClick={() => {
              setActiveTab('ALERTS');
              setStatusFilter((prev) =>
                prev === 'CONCILIADO' ? 'TODOS' : 'CONCILIADO'
              );
            }}
            className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 font-medium transition cursor-pointer ${
              statusFilter === 'CONCILIADO' && activeTab === 'ALERTS'
                ? 'border-emerald-700 bg-emerald-700 text-white dark:border-emerald-500 dark:bg-emerald-500/20 dark:text-emerald-300'
                : 'border-stone-200/90 bg-white text-stone-700 hover:border-emerald-700/40 dark:border-stone-800 dark:bg-[#1C1A18] dark:text-stone-300 dark:hover:border-emerald-500/40'
            }`}
            title="Filtrar únicamente pagos conciliados"
          >
            <CheckCircle2
              className={`h-3.5 w-3.5 ${
                statusFilter === 'CONCILIADO' && activeTab === 'ALERTS'
                  ? 'text-current'
                  : 'text-emerald-700 dark:text-emerald-400'
              }`}
              strokeWidth={1.5}
            />
            <span>Conciliados</span>
            <span className="font-mono tabular-nums opacity-80">
              {financialMetrics.pagosConciliadosCount}
            </span>
          </button>

          <button
            type="button"
            onClick={() => {
              setActiveTab('ALERTS');
              setStatusFilter((prev) =>
                prev === 'REVISION_MANUAL' ? 'TODOS' : 'REVISION_MANUAL'
              );
            }}
            className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 font-medium transition cursor-pointer ${
              statusFilter === 'REVISION_MANUAL' && activeTab === 'ALERTS'
                ? 'border-amber-700 bg-amber-700 text-white dark:border-amber-500 dark:bg-amber-500/20 dark:text-amber-300'
                : 'border-stone-200/90 bg-white text-stone-700 hover:border-amber-700/40 dark:border-stone-800 dark:bg-[#1C1A18] dark:text-stone-300 dark:hover:border-amber-500/40'
            }`}
            title="Filtrar únicamente pagos en revisión manual"
          >
            <AlertTriangle
              className={`h-3.5 w-3.5 ${
                statusFilter === 'REVISION_MANUAL' && activeTab === 'ALERTS'
                  ? 'text-current'
                  : 'text-amber-700 dark:text-amber-400'
              }`}
              strokeWidth={1.5}
            />
            <span>Revisión Manual</span>
            <span className="font-mono tabular-nums opacity-80">
              {financialMetrics.pagosRevisionManualCount}
            </span>
          </button>

          <button
            type="button"
            onClick={() => {
              setActiveTab('ALERTS');
              setStatusFilter((prev) =>
                prev === 'DETECTADO' ? 'TODOS' : 'DETECTADO'
              );
            }}
            className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 font-medium transition cursor-pointer ${
              statusFilter === 'DETECTADO' && activeTab === 'ALERTS'
                ? 'border-amber-700 bg-amber-700 text-white dark:border-amber-500 dark:bg-amber-500/20 dark:text-amber-300'
                : 'border-stone-200/90 bg-white text-stone-700 hover:border-amber-700/40 dark:border-stone-800 dark:bg-[#1C1A18] dark:text-stone-300 dark:hover:border-amber-500/40'
            }`}
            title="Filtrar pagos detectados sin orden vinculada"
          >
            <Clock
              className={`h-3.5 w-3.5 ${
                statusFilter === 'DETECTADO' && activeTab === 'ALERTS'
                  ? 'text-current'
                  : 'text-amber-700 dark:text-amber-400'
              }`}
              strokeWidth={1.5}
            />
            <span>Detectados</span>
            <span className="font-mono tabular-nums opacity-80">
              {financialMetrics.pagosDetectadosCount}
            </span>
          </button>

          {showDiscardedHistory && (
            <button
              type="button"
              onClick={() => {
                setActiveTab('ALERTS');
                setStatusFilter((prev) =>
                  prev === 'DESCARTADO' ? 'TODOS' : 'DESCARTADO'
                );
              }}
              className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 font-medium transition cursor-pointer ${
                statusFilter === 'DESCARTADO' && activeTab === 'ALERTS'
                  ? 'border-rose-700 bg-rose-700 text-white dark:border-rose-500 dark:bg-rose-500/20 dark:text-rose-300'
                  : 'border-rose-700/25 bg-rose-50/70 text-rose-700 hover:border-rose-700/40 dark:border-rose-500/35 dark:bg-rose-950/30 dark:text-rose-400'
              }`}
              title="Filtrar únicamente correos eliminados o descartados"
            >
              <Trash2 className="h-3.5 w-3.5" strokeWidth={1.5} />
              <span>Eliminados</span>
            </button>
          )}

          <button
            type="button"
            onClick={() => setActiveTab('CLIENTS')}
            className="inline-flex items-center gap-1.5 rounded-full border border-stone-200/90 bg-white px-3 py-1 font-medium text-stone-700 transition hover:border-stone-300 hover:bg-stone-50 cursor-pointer dark:border-stone-800 dark:bg-[#1C1A18] dark:text-stone-300 dark:hover:border-stone-700"
            title="Ir a la pestaña de clientes y órdenes pendientes"
          >
            <Wallet className="h-3.5 w-3.5 text-stone-400 dark:text-stone-500" strokeWidth={1.5} />
            <span>Órdenes Pendientes</span>
            <span className="font-mono tabular-nums opacity-80">
              {pendingOrders.length}
            </span>
          </button>

          {selectedClientFilter !== 'TODOS' && (
            <div className="inline-flex items-center gap-1.5 rounded-full border border-amber-700/30 bg-amber-50 px-2.5 py-1 text-xs font-medium text-amber-900 dark:border-amber-500/40 dark:bg-amber-950/40 dark:text-amber-300">
              <UserCheck className="h-3.5 w-3.5 shrink-0" strokeWidth={1.5} />
              <span>
                {selectedClientFilter === 'SIN_ASIGNAR'
                  ? 'Sin Asignar'
                  : clients.find((c) => c.id === selectedClientFilter)?.nombre_titular ?? selectedClientFilter}
              </span>
              <button
                type="button"
                onClick={() => setSelectedClientFilter('TODOS')}
                className="ml-0.5 rounded-full p-0.5 text-amber-800 transition hover:bg-amber-700/15 cursor-pointer dark:text-amber-200 dark:hover:bg-amber-500/20"
                title="Quitar filtro de titular"
              >
                <X className="h-3 w-3" strokeWidth={1.5} />
              </button>
            </div>
          )}
        </div>

        {/* =====================================================================
            PESTAÑA 1: LEDGER EDITORIAL DE ANCHO COMPLETO + DRAWER BAJO DEMANDA
           ===================================================================== */}
        {activeTab === 'ALERTS' && (
          <>
            {(() => {
              const hasActiveFilters = Boolean(
                searchQuery.trim() ||
                  selectedClientFilter !== 'TODOS' ||
                  platformFilter !== 'TODOS' ||
                  movementFilter !== 'RECIBIDO' ||
                  statusFilter !== 'TODOS' ||
                  selectedCycleFilter !== 'ACTIVO' ||
                  showDiscardedHistory
              );
              const selectedCycleLiq =
                selectedCycleFilter !== 'ACTIVO' &&
                selectedCycleFilter !== 'TODOS'
                  ? liquidations.find((l) => l.id === selectedCycleFilter) ?? null
                  : null;

              return (
                <section
                  aria-label="Filtros de Conciliación"
                  className="mb-4 rounded-xl border border-stone-200/90 bg-white px-4 py-3 shadow-sm dark:border-stone-800 dark:bg-[#1C1A18]"
                >
                  {/* Fila 1: Búsqueda + Titular + Plataforma + Flujo */}
                  <div className="grid grid-cols-1 gap-2.5 md:grid-cols-12">
                    <div className="relative md:col-span-5">
                      <Search
                        className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-stone-400 dark:text-stone-500"
                        strokeWidth={1.5}
                      />
                      <input
                        type="text"
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        placeholder="Buscar por remitente, TxID, referencia..."
                        className="w-full rounded-lg border border-stone-200 bg-[#FAF9F6] py-1.5 pl-9 pr-8 text-sm text-stone-900 placeholder-stone-400 focus:border-amber-700 focus:outline-none dark:border-stone-800 dark:bg-[#121110] dark:text-stone-100 dark:placeholder-stone-500 dark:focus:border-amber-500"
                      />
                      {searchQuery.length > 0 && (
                        <button
                          type="button"
                          onClick={() => setSearchQuery('')}
                          className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded p-0.5 text-stone-400 transition hover:bg-stone-200/70 hover:text-stone-700 cursor-pointer dark:hover:bg-stone-800 dark:hover:text-stone-200"
                          title="Limpiar búsqueda"
                          aria-label="Limpiar búsqueda"
                        >
                          <X className="h-3.5 w-3.5" strokeWidth={1.5} />
                        </button>
                      )}
                    </div>

                    <div className="md:col-span-3">
                      <div className="relative">
                        <UserCheck
                          className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-stone-400 dark:text-stone-500"
                          strokeWidth={1.5}
                        />
                        <select
                          value={selectedClientFilter}
                          onChange={(e) => setSelectedClientFilter(e.target.value)}
                          className="w-full rounded-lg border border-stone-200 bg-[#FAF9F6] py-1.5 pl-9 pr-3 text-sm font-medium text-stone-800 focus:border-amber-700 focus:outline-none dark:border-stone-800 dark:bg-[#121110] dark:text-stone-200 dark:focus:border-amber-500"
                        >
                          <option value="TODOS">Todos los Titulares</option>
                          <option value="SIN_ASIGNAR">Sin Cliente (En Espera)</option>
                          {clients.map((c) => {
                            const cSaldo =
                              Math.round(
                                Number(
                                  c.saldo_disponible_usd ??
                                    c.total_neto_usd - (c.total_liquidado_usd ?? 0)
                                ) * 100
                              ) / 100;
                            return (
                              <option key={c.id} value={c.id}>
                                {c.nombre_titular} ({formatMoney(cSaldo, 'USD')})
                              </option>
                            );
                          })}
                        </select>
                      </div>
                    </div>

                    <div className="md:col-span-2">
                      <div className="relative">
                        <Building2
                          className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-stone-400 dark:text-stone-500"
                          strokeWidth={1.5}
                        />
                        <select
                          value={platformFilter}
                          onChange={(e) =>
                            setPlatformFilter(e.target.value as 'TODOS' | PlatformType)
                          }
                          className="w-full rounded-lg border border-stone-200 bg-[#FAF9F6] py-1.5 pl-9 pr-3 text-sm text-stone-800 focus:border-amber-700 focus:outline-none dark:border-stone-800 dark:bg-[#121110] dark:text-stone-200 dark:focus:border-amber-500"
                        >
                          <option value="TODOS">Todas Plataformas</option>
                          <option value="CITIBANK">Citibank (Zelle)</option>
                          <option value="TD_BANK">TD Bank (Zelle)</option>
                          <option value="BINANCE_PAY">Binance Pay</option>
                          <option value="BINANCE_P2P">Binance P2P</option>
                          <option value="BINANCE_ONCHAIN">
                            Depósitos Red (On-Chain)
                          </option>
                          <option value="OTRO">Otro</option>
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
                        className="w-full rounded-lg border border-stone-200 bg-[#FAF9F6] px-3 py-1.5 text-sm text-stone-800 focus:border-amber-700 focus:outline-none dark:border-stone-800 dark:bg-[#121110] dark:text-stone-200 dark:focus:border-amber-500"
                      >
                        <option value="TODOS">Todos los Flujos</option>
                        <option value="RECIBIDO">Solo Recibidos</option>
                        <option value="ENVIADO">Solo Enviados</option>
                      </select>
                    </div>
                  </div>

                  {/* Fila 2: Selector Unificado de Ciclo + Eliminados + Resumen Inline cuando hay filtros */}
                  <div className="mt-2.5 flex flex-wrap items-center justify-between gap-2 border-t border-stone-200/80 pt-2.5 dark:border-stone-800">
                    <div className="flex flex-wrap items-center gap-2">
                      <div className="inline-flex items-center gap-1.5 rounded-lg border border-stone-200 bg-[#FAF9F6] px-2.5 py-1 dark:border-stone-800 dark:bg-[#121110]">
                        <Filter
                          className="h-3.5 w-3.5 text-amber-700 dark:text-amber-500"
                          strokeWidth={1.5}
                        />
                        <span className="text-[11px] font-medium uppercase tracking-wider text-stone-500 dark:text-stone-400">
                          Ciclo:
                        </span>
                        <select
                          value={selectedCycleFilter}
                          onChange={(e) => {
                            const val = e.target.value;
                            setSelectedCycleFilter(val);
                            setShowLiquidatedHistory(val !== 'ACTIVO');
                          }}
                          className="max-w-[280px] bg-transparent text-xs font-medium text-stone-800 focus:outline-none cursor-pointer dark:text-stone-200"
                        >
                          <option value="ACTIVO">
                            Ciclo Actual (Activo) · {financialMetrics.pagosConciliadosCount} conc. · Neto{' '}
                            {formatMoney(financialMetrics.zelleCicloNetoUsd ?? 0, 'USD')}
                          </option>
                          <option value="TODOS">Todos los Ciclos (Activo + Historial Liquidado)</option>
                          {liquidations
                            .filter(
                              (l) =>
                                selectedClientFilter === 'TODOS' ||
                                selectedClientFilter === 'SIN_ASIGNAR' ||
                                l.cliente_id === selectedClientFilter
                            )
                            .map((l) => {
                              const pagosCount = Number(l.ciclo_pagos_count ?? 0);
                              const netoTotal = Number(l.ciclo_neto_total ?? 0);
                              const liqTotal = Number(l.monto_liquidado ?? 0);
                              return (
                                <option key={l.id} value={l.id}>
                                  {l.numero_ciclo ? `Ciclo #${l.numero_ciclo}` : 'Ciclo'} ·{' '}
                                  {l.cliente_nombre} · {pagosCount} pagos · Neto{' '}
                                  {formatMoney(netoTotal, l.moneda)} · Liq -
                                  {formatMoney(liqTotal, l.moneda)} (
                                  {new Date(l.created_at).toLocaleDateString('es-ES', {
                                    day: '2-digit',
                                    month: 'short',
                                  })}
                                  )
                                </option>
                              );
                            })}
                        </select>
                      </div>

                      <button
                        type="button"
                        onClick={() => {
                          setShowDiscardedHistory((prev) => {
                            const next = !prev;
                            if (!next && statusFilter === 'DESCARTADO') {
                              setStatusFilter('TODOS');
                            }
                            return next;
                          });
                        }}
                        className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs font-medium transition cursor-pointer ${
                          showDiscardedHistory
                            ? 'border-rose-700/35 bg-rose-50 text-rose-700 dark:border-rose-500/40 dark:bg-rose-950/40 dark:text-rose-400'
                            : 'border-stone-200 bg-[#FAF9F6] text-stone-600 hover:border-stone-300 hover:text-stone-900 dark:border-stone-800 dark:bg-[#121110] dark:text-stone-300 dark:hover:border-stone-700'
                        }`}
                      >
                        <Trash2 className="h-3.5 w-3.5" strokeWidth={1.5} />
                        {showDiscardedHistory ? 'Ocultar Eliminados' : 'Eliminados'}
                      </button>

                      {hasActiveFilters && (
                        <button
                          type="button"
                          onClick={() => {
                            setSearchQuery('');
                            setSelectedClientFilter('TODOS');
                            setPlatformFilter('TODOS');
                            setMovementFilter('RECIBIDO');
                            setStatusFilter('TODOS');
                            setSelectedCycleFilter('ACTIVO');
                            setShowLiquidatedHistory(false);
                            setShowDiscardedHistory(false);
                          }}
                          className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-medium text-stone-500 transition hover:bg-stone-100 hover:text-stone-900 cursor-pointer dark:text-stone-400 dark:hover:bg-stone-800 dark:hover:text-stone-100"
                        >
                          <RotateCcw className="h-3 w-3" strokeWidth={1.5} />
                          Limpiar filtros
                        </button>
                      )}
                    </div>

                    {/* Resumen Compacto Inline (sin duplicar la Cinta Financiera) */}
                    {!selectedCycleLiq && (
                      <div className="flex flex-wrap items-center gap-3 font-mono text-[11px] tabular-nums text-stone-500 dark:text-stone-400">
                        <span>
                          Vista:{' '}
                          <strong className="text-stone-900 dark:text-stone-100">
                            {visibleTableTotals.conciliadosCount}
                          </strong>{' '}
                          conc. / {visibleTableTotals.totalRows} filas
                        </span>
                        {visibleTableTotals.brutoPendienteUsd > 0 && (
                          <span className="text-amber-700 dark:text-amber-400">
                            Por conciliar:{' '}
                            <strong>
                              {formatMoney(visibleTableTotals.brutoPendienteUsd, 'USD')}
                            </strong>
                          </span>
                        )}
                        {hasActiveFilters && (
                          <span className="text-emerald-700 dark:text-emerald-400">
                            Neto vista:{' '}
                            <strong>{formatMoney(visibleTableTotals.netoUsd, 'USD')}</strong>
                          </span>
                        )}
                      </div>
                    )}
                  </div>

                  {/* Banda Detallada SOLO cuando se audita un Ciclo Histórico específico */}
                  {selectedCycleLiq &&
                    (() => {
                      const isUsdtCycle = selectedCycleLiq.moneda === 'USDT';
                      const cyclePagos =
                        Number(selectedCycleLiq.ciclo_pagos_count ?? 0) || alerts.length;
                      const cycleBruto = Number(selectedCycleLiq.ciclo_bruto_total ?? 0);
                      const cycleComision = Number(selectedCycleLiq.ciclo_comision_total ?? 0);
                      const cycleNeto = Number(selectedCycleLiq.ciclo_neto_total ?? 0);
                      const viewBruto = isUsdtCycle
                        ? visibleTableTotals.brutoConciliadoUsdt
                        : visibleTableTotals.brutoConciliadoUsd;
                      const viewCom = isUsdtCycle
                        ? visibleTableTotals.comisionUsdt
                        : visibleTableTotals.comisionUsd;
                      const viewNeto = isUsdtCycle
                        ? visibleTableTotals.netoUsdt
                        : visibleTableTotals.netoUsd;
                      const isSubFiltered = visibleTableTotals.totalRows !== cyclePagos;
                      const cycleRestante = Number(selectedCycleLiq.saldo_restante ?? 0);

                      return (
                        <div className="mt-3 grid grid-cols-2 divide-y divide-stone-200 rounded-lg border border-stone-200/90 bg-[#FAF9F6]/70 sm:grid-cols-5 sm:divide-x sm:divide-y-0 dark:divide-stone-800 dark:border-stone-800 dark:bg-[#121110]/60">
                          <div className="px-3 py-2">
                            <span className="text-[10px] font-medium uppercase tracking-wider text-amber-700 dark:text-amber-500">
                              {selectedCycleLiq.numero_ciclo
                                ? `Ciclo #${selectedCycleLiq.numero_ciclo} · ${selectedCycleLiq.cliente_nombre}`
                                : selectedCycleLiq.cliente_nombre}
                            </span>
                            <p className="mt-0.5 font-mono text-sm font-semibold tabular-nums text-stone-900 dark:text-stone-100">
                              {cyclePagos} pagos
                            </p>
                            <span className="font-mono text-[10px] text-stone-500 dark:text-stone-400">
                              {isSubFiltered
                                ? `En vista: ${visibleTableTotals.totalRows} de ${cyclePagos}`
                                : selectedCycleLiq.codigo_liquidacion}
                            </span>
                          </div>

                          <div className="px-3 py-2">
                            <span className="text-[10px] font-medium uppercase tracking-wider text-stone-500 dark:text-stone-400">
                              Bruto del Ciclo
                            </span>
                            <p className="mt-0.5 font-mono text-sm font-semibold tabular-nums text-stone-900 dark:text-stone-100">
                              {formatMoney(cycleBruto, selectedCycleLiq.moneda)}
                            </p>
                            {isSubFiltered && (
                              <span className="font-mono text-[10px] text-amber-700 dark:text-amber-400">
                                En vista: {formatMoney(viewBruto, selectedCycleLiq.moneda)}
                              </span>
                            )}
                          </div>

                          <div className="px-3 py-2">
                            <span className="text-[10px] font-medium uppercase tracking-wider text-stone-500 dark:text-stone-400">
                              Comisión del Ciclo
                            </span>
                            <p className="mt-0.5 font-mono text-sm font-semibold tabular-nums text-stone-900 dark:text-stone-100">
                              -{formatMoney(cycleComision, selectedCycleLiq.moneda)}
                            </p>
                            {isSubFiltered && (
                              <span className="font-mono text-[10px] text-amber-700 dark:text-amber-400">
                                En vista: -{formatMoney(viewCom, selectedCycleLiq.moneda)}
                              </span>
                            )}
                          </div>

                          <div className="px-3 py-2">
                            <span className="text-[10px] font-medium uppercase tracking-wider text-stone-500 dark:text-stone-400">
                              Neto del Ciclo
                            </span>
                            <p className="mt-0.5 font-mono text-sm font-semibold tabular-nums text-emerald-700 dark:text-emerald-400">
                              {formatMoney(cycleNeto, selectedCycleLiq.moneda)}
                            </p>
                            {isSubFiltered && (
                              <span className="font-mono text-[10px] text-amber-700 dark:text-amber-400">
                                En vista: {formatMoney(viewNeto, selectedCycleLiq.moneda)}
                              </span>
                            )}
                          </div>

                          <div className="px-3 py-2">
                            <span className="text-[10px] font-medium uppercase tracking-wider text-stone-500 dark:text-stone-400">
                              Liquidado / Restante
                            </span>
                            <p className="mt-0.5 font-mono text-sm font-semibold tabular-nums text-stone-900 dark:text-stone-100">
                              -{formatMoney(Number(selectedCycleLiq.monto_liquidado ?? 0), selectedCycleLiq.moneda)}
                            </p>
                            <span
                              className={`font-mono text-[10px] tabular-nums ${
                                cycleRestante < 0
                                  ? 'text-rose-700 dark:text-rose-400'
                                  : 'text-emerald-700 dark:text-emerald-400'
                              }`}
                            >
                              Restante: {formatMoney(cycleRestante, selectedCycleLiq.moneda)}
                            </span>
                          </div>
                        </div>
                      );
                    })()}
                </section>
              );
            })()}

            {/* =================================================================
                SECCIÓN COLAPSABLE: CAPTURAS ENVIADAS POR EL CLIENTE PENDIENTES
               ================================================================= */}
            {pendingOrders.length > 0 && (
              <section
                aria-label="Capturas Enviadas por el Cliente Pendientes de Confirmar"
                className="mb-4 overflow-hidden rounded-xl border border-amber-700/25 bg-white shadow-sm dark:border-amber-500/30 dark:bg-[#1C1A18]"
              >
                <div className="flex flex-wrap items-center justify-between gap-3 border-b border-amber-700/15 bg-amber-50/70 px-4 py-2.5 dark:border-amber-500/20 dark:bg-amber-950/20">
                  <div className="flex items-center gap-2.5">
                    <span className="flex h-6 w-6 items-center justify-center rounded-md border border-amber-700/30 bg-white font-mono text-xs font-semibold tabular-nums text-amber-800 dark:border-amber-500/40 dark:bg-[#121110] dark:text-amber-400">
                      {pendingOrders.length}
                    </span>
                    <div>
                      <h3 className="text-xs font-semibold uppercase tracking-wide text-stone-900 dark:text-stone-100">
                        Capturas Enviadas por el Cliente en Espera de Confirmación Manual
                      </h3>
                      {!isPendingCapturesCollapsed && (
                        <p className="text-[11px] text-stone-600 dark:text-stone-400">
                          Comprobantes subidos desde el portal que aún no conciliaron automáticamente.
                        </p>
                      )}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => setIsPendingCapturesCollapsed((prev) => !prev)}
                    className="inline-flex items-center gap-1 rounded-md border border-amber-700/25 bg-white/80 px-2.5 py-1 text-[11px] font-medium text-amber-900 transition hover:bg-white cursor-pointer dark:border-amber-500/30 dark:bg-[#121110]/70 dark:text-amber-300 dark:hover:bg-[#121110]"
                  >
                    <span>{isPendingCapturesCollapsed ? 'Mostrar' : 'Contraer'}</span>
                    <ChevronDown
                      className={`h-3.5 w-3.5 transition-transform ${
                        isPendingCapturesCollapsed ? '' : 'rotate-180'
                      }`}
                      strokeWidth={1.5}
                    />
                  </button>
                </div>

                {!isPendingCapturesCollapsed && (
                <div className="overflow-x-auto">
                  <table className="w-full border-collapse text-left text-xs table-auto">
                    <thead>
                      <tr className="border-b border-stone-200 bg-[#FAF9F6] text-[11px] font-medium uppercase tracking-wider text-stone-500 dark:border-stone-800 dark:bg-[#121110] dark:text-stone-400">
                        <th className="px-3 py-2.5">#</th>
                        <th className="px-3 py-2.5">Orden &amp; Fecha</th>
                        <th className="px-3 py-2.5">Titular</th>
                        <th className="px-3 py-2.5">Remitente</th>
                        <th className="px-3 py-2.5">Referencia</th>
                        <th className="px-3 py-2.5">Diagnóstico</th>
                        <th className="px-3 py-2.5 text-right">Bruto</th>
                        <th className="px-3 py-2.5 text-right">Comisión</th>
                        <th className="px-3 py-2.5 text-right">Neto</th>
                        <th className="px-3 py-2.5 text-right">Acciones</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-stone-200/80 dark:divide-stone-800">
                      {pendingOrders.map((order, idx) => {
                        const clientObj = clients.find(
                          (c) =>
                            c.id === order.cliente_id ||
                            c.nombre_titular.trim().toLowerCase() ===
                              (order.cliente_nombre || '').trim().toLowerCase()
                        );
                        const feePct = (order.plataforma_esperada || 'CITIBANK').startsWith(
                          'BINANCE'
                        )
                          ? (clientObj?.porcentaje_comision_binance ?? 1.5)
                          : (clientObj?.porcentaje_comision_zelle ?? 4.0);
                        const comision =
                          Math.round(order.monto_esperado * (feePct / 100) * 100) / 100;
                        const neto =
                          Math.round((order.monto_esperado - comision) * 100) / 100;

                        const alreadyReconciledTx = alerts.find(
                          (a) =>
                            a.estado === 'CONCILIADO' &&
                            referencesMatch(order.referencia_reportada, a.referencia)
                        );
                        const duplicatePendingCount = pendingOrders.filter(
                          (other) =>
                            other.id !== order.id &&
                            referencesMatch(
                              order.referencia_reportada,
                              other.referencia_reportada
                            )
                        ).length;
                        const candidateMatch = findBestCandidateTxForOrder(
                          order,
                          alerts
                        );
                        const bestMatchedTx = candidateMatch.tx;
                        const bestMatchType = candidateMatch.matchType;
                        const sameAmountCount = candidateMatch.sameAmountCount;
                        const orderPlatformBadge = getPlatformBadgeMeta(
                          order.plataforma_esperada
                        );

                        return (
                          <tr
                            key={order.id}
                            className="transition hover:bg-[#FAF9F6] dark:hover:bg-stone-900/50"
                          >
                            <td className="whitespace-nowrap px-3 py-2.5 font-mono tabular-nums text-stone-400">
                              {idx + 1}
                            </td>
                            <td className="whitespace-nowrap px-3 py-2.5">
                              <div className="flex items-center gap-1.5">
                                <span className="font-mono font-semibold text-stone-900 dark:text-stone-100">
                                  {order.codigo_orden}
                                </span>
                                <span
                                  className={`inline-flex items-center rounded border px-1.5 py-0.5 text-[10px] font-medium ${orderPlatformBadge.badgeClass}`}
                                >
                                  {orderPlatformBadge.label}
                                </span>
                              </div>
                              {order.fecha_transferencia ? (
                                <div className="font-mono text-[11px] tabular-nums text-amber-700 dark:text-amber-400">
                                  Fecha captura: {order.fecha_transferencia}
                                </div>
                              ) : null}
                              <div className="font-mono text-[10px] tabular-nums text-stone-500 dark:text-stone-400">
                                Subido: {formatDateTime(order.created_at)}
                              </div>
                            </td>
                            <td className="whitespace-nowrap px-3 py-2.5 font-medium text-stone-900 dark:text-stone-100">
                              {order.cliente_nombre}
                            </td>
                            <td className="px-3 py-2.5 font-medium text-stone-800 dark:text-stone-200">
                              {order.remitente_reportado ||
                                order.nombre_remitente_reportado ||
                                'Sin remitente'}
                            </td>
                            <td className="whitespace-nowrap px-3 py-2.5 font-mono font-medium text-stone-700 dark:text-stone-300">
                              {order.referencia_reportada || 'SIN-REF'}
                            </td>
                            <td className="max-w-[280px] px-3 py-2.5">
                              {alreadyReconciledTx ? (
                                <span className="inline-flex items-center gap-1 rounded-md border border-rose-700/25 bg-rose-50 px-2 py-0.5 text-[11px] font-medium text-rose-700 dark:border-rose-500/35 dark:bg-rose-950/40 dark:text-rose-400">
                                  <AlertTriangle className="h-3 w-3 shrink-0" strokeWidth={1.5} />
                                  Ref. ya conciliada en {alreadyReconciledTx.codigo_orden || alreadyReconciledTx.referencia} (Duplicado)
                                </span>
                              ) : duplicatePendingCount > 0 ? (
                                <span className="inline-flex items-center gap-1 rounded-md border border-amber-700/25 bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-800 dark:border-amber-500/35 dark:bg-amber-950/40 dark:text-amber-400">
                                  <AlertTriangle className="h-3 w-3 shrink-0" strokeWidth={1.5} />
                                  Ref. repetida en otra orden pendiente
                                </span>
                              ) : order.notas_cliente ? (
                                <span className="inline-flex items-start gap-1.5 rounded-md border border-stone-200 bg-[#FAF9F6] px-2 py-1 text-[11px] leading-snug text-stone-700 dark:border-stone-800 dark:bg-[#121110] dark:text-stone-300">
                                  <Clock className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-700 dark:text-amber-400" strokeWidth={1.5} />
                                  <span>{order.notas_cliente}</span>
                                </span>
                              ) : bestMatchedTx ? (
                                <span className="inline-flex items-center gap-1 rounded-md border border-emerald-700/25 bg-emerald-50 px-2 py-0.5 text-[11px] font-medium text-emerald-800 dark:border-emerald-500/35 dark:bg-emerald-950/40 dark:text-emerald-400">
                                  <CheckCircle2 className="h-3 w-3 shrink-0" strokeWidth={1.5} />
                                  {bestMatchType === 'REF'
                                    ? `Coincide por ref.: ${bestMatchedTx.remitente_o_contraparte} (${bestMatchedTx.referencia})`
                                    : `Coincide por nombre y fecha: ${bestMatchedTx.remitente_o_contraparte} (${bestMatchedTx.referencia})`}
                                </span>
                              ) : sameAmountCount > 0 ? (
                                <span className="inline-flex items-center gap-1 rounded-md border border-amber-700/25 bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-800 dark:border-amber-500/35 dark:bg-amber-950/40 dark:text-amber-400">
                                  <Clock className="h-3 w-3 shrink-0" strokeWidth={1.5} />
                                  Sin coincidencia exacta · Hay {sameAmountCount} correo(s) de {formatMoney(order.monto_esperado, order.moneda)}
                                </span>
                              ) : (
                                <span className="inline-flex items-center gap-1 rounded-md border border-stone-200 bg-[#FAF9F6] px-2 py-0.5 text-[11px] text-stone-600 dark:border-stone-800 dark:bg-[#121110] dark:text-stone-400">
                                  <Clock className="h-3 w-3 shrink-0 text-amber-700 dark:text-amber-400" strokeWidth={1.5} />
                                  Sin correo del banco · Confirmación manual
                                </span>
                              )}
                            </td>
                            <td className="whitespace-nowrap px-3 py-2.5 text-right font-mono font-semibold tabular-nums text-stone-900 dark:text-stone-100">
                              {formatMoney(order.monto_esperado, order.moneda)}
                            </td>
                            <td className="whitespace-nowrap px-3 py-2.5 text-right font-mono tabular-nums text-stone-500 dark:text-stone-400">
                              -{formatMoney(comision, order.moneda)} ({feePct}%)
                            </td>
                            <td className="whitespace-nowrap px-3 py-2.5 text-right font-mono font-semibold tabular-nums text-emerald-700 dark:text-emerald-400">
                              {formatMoney(neto, order.moneda)}
                            </td>
                            <td className="whitespace-nowrap px-3 py-2.5 text-right">
                              <div className="flex items-center justify-end gap-1.5">
                                {(order.has_capture || order.comprobante_base64) && (
                                  <button
                                    type="button"
                                    onClick={() => void openLightboxForOrder(order)}
                                    className="inline-flex items-center gap-1 rounded-md border border-stone-200 bg-[#FAF9F6] px-2 py-1 text-[11px] font-medium text-stone-700 transition hover:border-stone-300 hover:bg-stone-100 cursor-pointer dark:border-stone-800 dark:bg-[#121110] dark:text-stone-200 dark:hover:border-stone-700"
                                    title="Ver la captura subida por el cliente"
                                  >
                                    <Eye className="h-3 w-3" strokeWidth={1.5} />
                                    Captura
                                  </button>
                                )}
                                <button
                                  type="button"
                                  onClick={() => openManualOrderConfirmModal(order)}
                                  className="inline-flex items-center gap-1 rounded-md bg-stone-900 px-2.5 py-1 text-[11px] font-medium text-stone-50 transition hover:bg-stone-800 cursor-pointer dark:bg-stone-100 dark:text-stone-950 dark:hover:bg-white"
                                  title="Confirmar manualmente y acreditar saldo al cliente"
                                >
                                  <CheckCircle2 className="h-3 w-3" strokeWidth={1.5} />
                                  Confirmar
                                </button>
                                <button
                                  type="button"
                                  disabled={isRejectingOrderId === order.id}
                                  onClick={() => void handleRejectPendingOrder(order)}
                                  className="inline-flex items-center gap-1 rounded-md border border-rose-700/25 bg-rose-50 px-2 py-1 text-[11px] font-medium text-rose-700 transition hover:bg-rose-100 disabled:opacity-50 cursor-pointer dark:border-rose-500/35 dark:bg-rose-950/40 dark:text-rose-400 dark:hover:bg-rose-950/70"
                                  title="Descartar orden pendiente duplicada o inválida"
                                >
                                  <Trash2 className="h-3 w-3" strokeWidth={1.5} />
                                  Descartar
                                </button>
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                )}
              </section>
            )}

            {/* =================================================================
                LEDGER EDITORIAL DE ANCHO COMPLETO (100% ESCRITORIO / TARJETAS MÓVIL)
               ================================================================= */}
            <section
              aria-label="Lista de Movimientos Bancarios"
              className="overflow-hidden rounded-xl border border-stone-200/90 bg-white shadow-sm dark:border-stone-800 dark:bg-[#1C1A18]"
            >
              {/* Cabecera del Ledger */}
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-stone-200 bg-[#FAF9F6] px-4 py-2.5 dark:border-stone-800 dark:bg-[#121110]">
                <div className="flex items-center gap-3">
                  <input
                    type="checkbox"
                    checked={
                      eligibleAlertsForBatch.length > 0 &&
                      eligibleAlertsForBatch.every((a) =>
                        selectedAlertIds.includes(a.id)
                      )
                    }
                    onChange={toggleSelectAllEligible}
                    className="h-4 w-4 rounded border-stone-300 text-stone-900 focus:ring-amber-700 cursor-pointer lg:hidden dark:border-stone-700 dark:bg-stone-900"
                    title="Seleccionar / deseleccionar todos los pagos elegibles para lote"
                  />
                  <span className="text-xs font-medium uppercase tracking-wider text-stone-600 dark:text-stone-300">
                    Movimientos ({filteredAlerts.length})
                  </span>
                  {selectedAlertIds.length > 0 && (
                    <span className="inline-flex items-center rounded-full border border-amber-700/30 bg-amber-50 px-2 py-0.5 font-mono text-[11px] font-medium tabular-nums text-amber-800 dark:border-amber-500/35 dark:bg-amber-950/40 dark:text-amber-300">
                      {selectedAlertIds.length} en lote
                    </span>
                  )}
                </div>
                <span className="hidden text-[11px] text-stone-500 sm:inline dark:text-stone-400">
                  Haz clic en cualquier fila para abrir el detalle completo
                </span>
              </div>

              {filteredAlerts.length === 0 ? (
                <div className="px-6 py-14 text-center text-sm text-stone-500 dark:text-stone-400">
                  No se encontraron transacciones con los filtros seleccionados.
                </div>
              ) : (
                <>
                  {/* VISTA ESCRITORIO (lg+): Tabla Editorial 8 Columnas (100% Ancho) */}
                  <div className="hidden overflow-x-auto lg:block">
                    <table className="w-full border-collapse text-left">
                      <thead>
                        <tr className="border-b border-stone-200 bg-[#FAF9F6]/80 text-[11px] font-medium uppercase tracking-wider text-stone-500 dark:border-stone-800 dark:bg-[#121110]/80 dark:text-stone-400">
                          <th className="w-10 px-3 py-2.5 text-center">
                            <input
                              type="checkbox"
                              checked={
                                eligibleAlertsForBatch.length > 0 &&
                                eligibleAlertsForBatch.every((a) =>
                                  selectedAlertIds.includes(a.id)
                                )
                              }
                              onChange={toggleSelectAllEligible}
                              className="h-4 w-4 rounded border-stone-300 text-stone-900 focus:ring-amber-700 cursor-pointer dark:border-stone-700 dark:bg-stone-900"
                              title="Seleccionar / deseleccionar todos los pagos elegibles para lote"
                            />
                          </th>
                          <th className="px-3 py-2.5">Canal / Fecha</th>
                          <th className="px-3 py-2.5">Remitente / Referencia</th>
                          <th className="px-3 py-2.5">Titular / Orden</th>
                          <th className="px-3 py-2.5 text-right">Bruto / Com.</th>
                          <th className="px-3 py-2.5 text-right">Neto</th>
                          <th className="px-3 py-2.5">Estado</th>
                          <th className="px-3 py-2.5 text-right">Acciones</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-stone-200/80 dark:divide-stone-800/90">
                        {filteredAlerts.map((alert) => {
                          const badge = getPlatformBadgeMeta(alert.plataforma);
                          const candidateOrder = findAssociatedCaptureOrder(alert);
                          const hasCapture = Boolean(
                            alert.has_capture ||
                              alert.comprobante_base64 ||
                              candidateOrder?.has_capture ||
                              candidateOrder?.comprobante_base64
                          );
                          const isBatchSelected = selectedAlertIds.includes(alert.id);
                          const isInspected =
                            isInspectorDrawerOpen &&
                            selectedInspectorAlert?.id === alert.id;
                          const reportedSender =
                            alert.remitente_reportado ||
                            candidateOrder?.remitente_reportado ||
                            candidateOrder?.nombre_remitente_reportado ||
                            null;
                          const reportedCode =
                            alert.codigo_orden || candidateOrder?.codigo_orden || null;
                          const reportedRef =
                            alert.referencia_reportada ||
                            candidateOrder?.referencia_reportada ||
                            null;
                          const senderSimilarity =
                            reportedSender && alert.remitente_o_contraparte
                              ? calculateSenderSimilarity(
                                  reportedSender,
                                  alert.remitente_o_contraparte
                                )
                              : 1;
                          const isRefVerified = referencesMatch(
                            reportedRef,
                            alert.referencia
                          );
                          const hasNameDisparity = Boolean(
                            reportedSender &&
                              alert.remitente_o_contraparte &&
                              senderSimilarity < 0.65 &&
                              !(isRefVerified && senderSimilarity >= 0.4)
                          );
                          const canBatchSelect =
                            alert.estado !== 'CONCILIADO' &&
                            alert.estado !== 'DESCARTADO' &&
                            !alert.liquidado_at;
                          const isPendingRow =
                            !alert.liquidado_at &&
                            (alert.estado === 'DETECTADO' ||
                              alert.estado === 'REVISION_MANUAL');

                          return (
                            <tr
                              key={alert.id}
                              onClick={() => {
                                setSelectedInspectorAlertId(alert.id);
                                setIsInspectorDrawerOpen(true);
                              }}
                              className={`group transition cursor-pointer ${
                                isInspected
                                  ? 'bg-amber-50/50 dark:bg-amber-950/25'
                                  : isBatchSelected
                                    ? 'bg-stone-100/80 dark:bg-stone-800/40'
                                    : 'hover:bg-[#FAF9F6] dark:hover:bg-stone-900/50'
                              } ${
                                isPendingRow
                                  ? 'shadow-[inset_2px_0_0_0_rgba(180,83,9,0.5)] dark:shadow-[inset_2px_0_0_0_rgba(245,158,11,0.45)]'
                                  : ''
                              }`}
                            >
                              {/* 1. Checkbox Lote */}
                              <td
                                className="px-3 py-2.5 text-center"
                                onClick={(e) => e.stopPropagation()}
                              >
                                {canBatchSelect ? (
                                  <input
                                    type="checkbox"
                                    checked={isBatchSelected}
                                    onClick={(e) => e.stopPropagation()}
                                    onChange={() => toggleSelectAlert(alert.id)}
                                    className="h-4 w-4 rounded border-stone-300 text-stone-900 focus:ring-amber-700 cursor-pointer dark:border-stone-700 dark:bg-stone-900"
                                  />
                                ) : (
                                  <span className="text-xs text-stone-300 dark:text-stone-700">
                                    ·
                                  </span>
                                )}
                              </td>

                              {/* 2. Canal & Fecha */}
                              <td className="whitespace-nowrap px-3 py-2.5">
                                <div className="flex items-center gap-1.5">
                                  <span
                                    className={`inline-flex items-center rounded border px-1.5 py-0.5 text-[10px] font-medium ${badge.badgeClass}`}
                                  >
                                    {badge.label}
                                  </span>
                                  {alert.tipo_movimiento === 'RECIBIDO' ? (
                                    <span
                                      title="Pago Recibido"
                                      className="inline-flex items-center text-emerald-700 dark:text-emerald-400"
                                    >
                                      <ArrowDownLeft className="h-3.5 w-3.5" strokeWidth={1.75} />
                                    </span>
                                  ) : (
                                    <span
                                      title="Salida / Enviado"
                                      className="inline-flex items-center text-rose-700 dark:text-rose-400"
                                    >
                                      <ArrowUpRight className="h-3.5 w-3.5" strokeWidth={1.75} />
                                    </span>
                                  )}
                                </div>
                                <div className="mt-0.5 font-mono text-[11px] tabular-nums text-stone-500 dark:text-stone-400">
                                  {formatDateTime(alert.fecha_transaccion)}
                                </div>
                              </td>

                              {/* 3. Remitente & Referencia con copia rápida */}
                              <td className="max-w-[260px] px-3 py-2.5">
                                <div className="flex items-center gap-1.5">
                                  <span className="truncate text-[13px] font-medium text-stone-900 dark:text-stone-100">
                                    {alert.remitente_o_contraparte || (
                                      <span className="italic text-amber-700 dark:text-amber-400">
                                        Remitente no identificado
                                      </span>
                                    )}
                                  </span>
                                  {hasNameDisparity && (
                                    <span
                                      title={`Reportado en portal como: ${reportedSender}`}
                                      className="inline-flex shrink-0 items-center gap-0.5 rounded border border-amber-700/30 bg-amber-50 px-1.5 py-0.5 text-[10px] font-medium text-amber-800 dark:border-amber-500/35 dark:bg-amber-950/40 dark:text-amber-400"
                                    >
                                      <AlertTriangle className="h-2.5 w-2.5" strokeWidth={1.75} />
                                      Nombre
                                    </span>
                                  )}
                                </div>
                                <div className="mt-0.5 flex items-center gap-1.5">
                                  <span className="truncate font-mono text-[11px] text-stone-500 dark:text-stone-400">
                                    {alert.referencia || 'SIN-REF'}
                                  </span>
                                  {alert.referencia && alert.referencia !== 'SIN-REF' && (
                                    <button
                                      type="button"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        handleCopyReference(alert.id, alert.referencia || '');
                                      }}
                                      className={`inline-flex shrink-0 items-center rounded p-0.5 transition cursor-pointer ${
                                        copiedRefId === alert.id
                                          ? 'text-emerald-700 dark:text-emerald-400'
                                          : 'text-stone-400 opacity-0 hover:bg-stone-200/70 hover:text-stone-700 group-hover:opacity-100 dark:text-stone-500 dark:hover:bg-stone-800 dark:hover:text-stone-200'
                                      }`}
                                      title={
                                        copiedRefId === alert.id
                                          ? 'Referencia copiada'
                                          : 'Copiar referencia'
                                      }
                                    >
                                      {copiedRefId === alert.id ? (
                                        <Check className="h-3 w-3" strokeWidth={2} />
                                      ) : (
                                        <Copy className="h-3 w-3" strokeWidth={1.5} />
                                      )}
                                    </button>
                                  )}
                                </div>
                              </td>

                              {/* 4. Titular / Orden */}
                              <td className="whitespace-nowrap px-3 py-2.5">
                                {alert.cliente_asignado_nombre ? (
                                  <div className="inline-flex items-center gap-1.5 text-xs font-medium text-stone-800 dark:text-stone-200">
                                    <UserCheck
                                      className="h-3.5 w-3.5 shrink-0 text-emerald-700 dark:text-emerald-400"
                                      strokeWidth={1.5}
                                    />
                                    <span>{alert.cliente_asignado_nombre}</span>
                                  </div>
                                ) : (
                                  <span className="text-xs text-stone-400 dark:text-stone-500">
                                    Sin asignar
                                  </span>
                                )}
                                {reportedCode && (
                                  <div className="mt-0.5 font-mono text-[10px] text-stone-500 dark:text-stone-400">
                                    {reportedCode}
                                  </div>
                                )}
                              </td>

                              {/* 5. Bruto / Comisión */}
                              <td className="whitespace-nowrap px-3 py-2.5 text-right font-mono tabular-nums">
                                <div className="text-xs text-stone-700 dark:text-stone-300">
                                  {formatMoney(alert.monto_bruto, alert.moneda)}
                                </div>
                                {alert.estado === 'CONCILIADO' &&
                                  alert.monto_comision > 0 && (
                                    <div className="mt-0.5 text-[10px] text-stone-500 dark:text-stone-400">
                                      -{formatMoney(alert.monto_comision, alert.moneda)} ({alert.porcentaje_comision}%)
                                    </div>
                                  )}
                              </td>

                              {/* 6. Neto */}
                              <td className="whitespace-nowrap px-3 py-2.5 text-right font-mono text-[13px] font-semibold tabular-nums tracking-tight">
                                <span
                                  className={
                                    alert.tipo_movimiento === 'ENVIADO'
                                      ? 'text-rose-700 dark:text-rose-400'
                                      : alert.estado === 'CONCILIADO'
                                        ? 'text-emerald-700 dark:text-emerald-400'
                                        : 'text-stone-900 dark:text-stone-100'
                                  }
                                >
                                  {alert.estado === 'CONCILIADO'
                                    ? formatMoney(alert.monto_neto, alert.moneda)
                                    : formatMoney(alert.monto_bruto, alert.moneda)}
                                </span>
                              </td>

                              {/* 7. Estado */}
                              <td className="whitespace-nowrap px-3 py-2.5">
                                {alert.liquidado_at ? (
                                  <span className="inline-flex items-center rounded-full border border-stone-300 bg-stone-100 px-2 py-0.5 text-[10px] font-medium text-stone-700 dark:border-stone-700 dark:bg-stone-800 dark:text-stone-300">
                                    {alert.numero_ciclo
                                      ? `CICLO #${alert.numero_ciclo}`
                                      : 'LIQUIDADO'}
                                  </span>
                                ) : alert.estado === 'CONCILIADO' ? (
                                  <span className="inline-flex items-center rounded-full border border-emerald-700/20 bg-emerald-50 px-2 py-0.5 text-[10px] font-medium text-emerald-700 dark:border-emerald-500/30 dark:bg-emerald-950/40 dark:text-emerald-400">
                                    CONCILIADO
                                  </span>
                                ) : alert.estado === 'REVISION_MANUAL' ? (
                                  <span className="inline-flex items-center rounded-full border border-amber-700/25 bg-amber-50 px-2 py-0.5 text-[10px] font-medium text-amber-800 dark:border-amber-500/35 dark:bg-amber-950/40 dark:text-amber-400">
                                    REVISIÓN MANUAL
                                  </span>
                                ) : alert.estado === 'DETECTADO' ? (
                                  <span className="inline-flex items-center rounded-full border border-amber-700/25 bg-amber-50/70 px-2 py-0.5 text-[10px] font-medium text-amber-800 dark:border-amber-500/30 dark:bg-amber-950/30 dark:text-amber-400">
                                    DETECTADO
                                  </span>
                                ) : (
                                  <span className="inline-flex items-center rounded-full border border-rose-700/25 bg-rose-50 px-2 py-0.5 text-[10px] font-medium text-rose-700 dark:border-rose-500/35 dark:bg-rose-950/40 dark:text-rose-400">
                                    ELIMINADO
                                  </span>
                                )}
                              </td>

                              {/* 8. Acciones Directas Inline (1 clic, stopPropagation) */}
                              <td
                                className="whitespace-nowrap px-3 py-2.5 text-right"
                                onClick={(e) => e.stopPropagation()}
                              >
                                <div className="inline-flex items-center justify-end gap-1">
                                  {alert.estado !== 'CONCILIADO' &&
                                    alert.estado !== 'DESCARTADO' &&
                                    !alert.liquidado_at &&
                                    alert.tipo_movimiento === 'RECIBIDO' && (
                                      <button
                                        type="button"
                                        onClick={() =>
                                          openManualReconciliationModal(
                                            alert,
                                            candidateOrder
                                          )
                                        }
                                        className="inline-flex items-center gap-1 rounded-md border border-amber-700/35 bg-amber-50/80 px-2.5 py-1 text-[11px] font-medium text-amber-900 transition hover:border-amber-700 hover:bg-amber-700 hover:text-white cursor-pointer dark:border-amber-500/35 dark:bg-amber-950/35 dark:text-amber-300 dark:hover:border-amber-500 dark:hover:bg-amber-500 dark:hover:text-stone-950"
                                        title="Conciliar y acreditar este movimiento"
                                      >
                                        Conciliar
                                      </button>
                                    )}

                                  {hasCapture && (
                                    <button
                                      type="button"
                                      onClick={() => void openLightboxForTx(alert)}
                                      className="inline-flex items-center gap-1 rounded-md border border-stone-200 bg-white px-2 py-1 text-[11px] font-medium text-stone-700 transition hover:border-stone-300 hover:bg-stone-50 cursor-pointer dark:border-stone-800 dark:bg-[#121110] dark:text-stone-300 dark:hover:border-stone-700 dark:hover:text-stone-100"
                                      title="Ver comprobante en visor completo"
                                    >
                                      <ImageIcon className="h-3.5 w-3.5 text-stone-400 dark:text-stone-400" strokeWidth={1.5} />
                                      <span className="hidden xl:inline">Captura</span>
                                    </button>
                                  )}

                                  <button
                                    type="button"
                                    onClick={() => setInspectedAlert(alert)}
                                    className="inline-flex items-center justify-center rounded-md border border-stone-200 bg-white p-1.5 text-stone-500 transition hover:border-stone-300 hover:bg-stone-50 hover:text-stone-900 cursor-pointer dark:border-stone-800 dark:bg-[#121110] dark:text-stone-400 dark:hover:border-stone-700 dark:hover:text-stone-100"
                                    title="Ver correo / payload original"
                                    aria-label="Ver payload"
                                  >
                                    <FileText className="h-3.5 w-3.5" strokeWidth={1.5} />
                                  </button>

                                  {alert.estado === 'CONCILIADO' && !alert.liquidado_at && (
                                    <button
                                      type="button"
                                      onClick={() => {
                                        setAlertToRevert(alert);
                                        setRevertReason('');
                                      }}
                                      className="inline-flex items-center justify-center rounded-md border border-stone-200 bg-white p-1.5 text-stone-500 transition hover:border-rose-700/35 hover:bg-rose-50 hover:text-rose-700 cursor-pointer dark:border-stone-800 dark:bg-[#121110] dark:text-stone-400 dark:hover:border-rose-500/40 dark:hover:bg-rose-950/40 dark:hover:text-rose-400"
                                      title="Deshacer conciliación"
                                      aria-label="Deshacer conciliación"
                                    >
                                      <RotateCcw className="h-3.5 w-3.5" strokeWidth={1.5} />
                                    </button>
                                  )}

                                  {alert.estado !== 'CONCILIADO' &&
                                    alert.estado !== 'DESCARTADO' &&
                                    !alert.liquidado_at && (
                                      <button
                                        type="button"
                                        onClick={() => openDiscardModalForAlerts([alert])}
                                        className="inline-flex items-center justify-center rounded-md border border-stone-200 bg-white p-1.5 text-stone-500 transition hover:border-rose-700/35 hover:bg-rose-50 hover:text-rose-700 cursor-pointer dark:border-stone-800 dark:bg-[#121110] dark:text-stone-400 dark:hover:border-rose-500/40 dark:hover:bg-rose-950/40 dark:hover:text-rose-400"
                                        title="Eliminar / descartar correo"
                                        aria-label="Eliminar movimiento"
                                      >
                                        <Trash2 className="h-3.5 w-3.5" strokeWidth={1.5} />
                                      </button>
                                    )}

                                  {alert.estado === 'DESCARTADO' && (
                                    <button
                                      type="button"
                                      disabled={restoringAlertId === alert.id}
                                      onClick={() => void handleRestoreDiscardedAlert(alert)}
                                      className="inline-flex items-center gap-1 rounded-md border border-emerald-700/25 bg-emerald-50 px-2 py-1 text-[11px] font-medium text-emerald-700 transition hover:bg-emerald-100 disabled:opacity-50 cursor-pointer dark:border-emerald-500/35 dark:bg-emerald-950/40 dark:text-emerald-400"
                                      title="Restaurar movimiento"
                                    >
                                      {restoringAlertId === alert.id ? (
                                        <Loader2 className="h-3 w-3 animate-spin" strokeWidth={1.5} />
                                      ) : (
                                        <RotateCcw className="h-3 w-3" strokeWidth={1.5} />
                                      )}
                                      Restaurar
                                    </button>
                                  )}
                                </div>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>

                  {/* VISTA MÓVIL / TABLET (< lg): Tarjetas Limpias sin Scroll Horizontal */}
                  <div className="divide-y divide-stone-200/80 lg:hidden dark:divide-stone-800">
                    {filteredAlerts.map((alert) => {
                      const badge = getPlatformBadgeMeta(alert.plataforma);
                      const candidateOrder = findAssociatedCaptureOrder(alert);
                      const hasCapture = Boolean(
                        alert.has_capture ||
                          alert.comprobante_base64 ||
                          candidateOrder?.has_capture ||
                          candidateOrder?.comprobante_base64
                      );
                      const isBatchSelected = selectedAlertIds.includes(alert.id);
                      const canBatchSelect =
                        alert.estado !== 'CONCILIADO' &&
                        alert.estado !== 'DESCARTADO' &&
                        !alert.liquidado_at;

                      return (
                        <div
                          key={alert.id}
                          role="button"
                          tabIndex={0}
                          onClick={() => {
                            setSelectedInspectorAlertId(alert.id);
                            setIsInspectorDrawerOpen(true);
                          }}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' || e.key === ' ') {
                              e.preventDefault();
                              setSelectedInspectorAlertId(alert.id);
                              setIsInspectorDrawerOpen(true);
                            }
                          }}
                          className={`flex items-start gap-3 px-4 py-3 transition cursor-pointer ${
                            isBatchSelected
                              ? 'bg-stone-100/80 dark:bg-stone-800/40'
                              : 'hover:bg-[#FAF9F6] dark:hover:bg-stone-900/50'
                          }`}
                        >
                          <div
                            className="pt-0.5"
                            onClick={(e) => e.stopPropagation()}
                          >
                            {canBatchSelect ? (
                              <input
                                type="checkbox"
                                checked={isBatchSelected}
                                onClick={(e) => e.stopPropagation()}
                                onChange={() => toggleSelectAlert(alert.id)}
                                className="h-4 w-4 rounded border-stone-300 text-stone-900 focus:ring-amber-700 cursor-pointer dark:border-stone-700 dark:bg-stone-900"
                              />
                            ) : (
                              <span className="inline-flex h-4 w-4 items-center justify-center text-xs text-stone-300 dark:text-stone-700">
                                ·
                              </span>
                            )}
                          </div>

                          <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-center gap-1.5">
                              <span
                                className={`inline-flex items-center rounded border px-1.5 py-0.5 text-[10px] font-medium ${badge.badgeClass}`}
                              >
                                {badge.label}
                              </span>
                              <span className="font-mono text-[11px] tabular-nums text-stone-500 dark:text-stone-400">
                                {formatDateTime(alert.fecha_transaccion)}
                              </span>
                            </div>
                            <p className="mt-1 truncate text-sm font-medium text-stone-900 dark:text-stone-100">
                              {alert.remitente_o_contraparte || 'Remitente no identificado'}
                            </p>
                            <div className="mt-0.5 flex flex-wrap items-center gap-2 text-xs">
                              <span className="font-mono text-[11px] text-stone-500 dark:text-stone-400">
                                {alert.referencia || 'SIN-REF'}
                              </span>
                              {alert.cliente_asignado_nombre && (
                                <span className="inline-flex items-center gap-1 text-stone-700 dark:text-stone-300">
                                  <UserCheck className="h-3 w-3 text-emerald-700 dark:text-emerald-400" strokeWidth={1.5} />
                                  {alert.cliente_asignado_nombre}
                                </span>
                              )}
                              {hasCapture && (
                                <ImageIcon className="h-3 w-3 text-stone-400" strokeWidth={1.5} />
                              )}
                            </div>
                          </div>

                          <div className="flex shrink-0 flex-col items-end gap-1.5 text-right">
                            <span
                              className={`font-mono text-sm font-semibold tabular-nums ${
                                alert.tipo_movimiento === 'ENVIADO'
                                  ? 'text-rose-700 dark:text-rose-400'
                                  : alert.estado === 'CONCILIADO'
                                    ? 'text-emerald-700 dark:text-emerald-400'
                                    : 'text-stone-900 dark:text-stone-100'
                              }`}
                            >
                              {alert.estado === 'CONCILIADO'
                                ? formatMoney(alert.monto_neto, alert.moneda)
                                : formatMoney(alert.monto_bruto, alert.moneda)}
                            </span>
                            <div
                              className="flex items-center gap-1.5"
                              onClick={(e) => e.stopPropagation()}
                            >
                              {alert.estado !== 'CONCILIADO' &&
                              alert.estado !== 'DESCARTADO' &&
                              !alert.liquidado_at &&
                              alert.tipo_movimiento === 'RECIBIDO' ? (
                                <button
                                  type="button"
                                  onClick={() =>
                                    openManualReconciliationModal(
                                      alert,
                                      candidateOrder
                                    )
                                  }
                                  className="rounded-md border border-amber-700/35 bg-amber-50 px-2 py-0.5 text-[10px] font-medium text-amber-900 dark:border-amber-500/35 dark:bg-amber-950/35 dark:text-amber-300"
                                >
                                  Conciliar
                                </button>
                              ) : (
                                <span className="rounded-full border border-stone-200 px-2 py-0.5 text-[10px] font-medium text-stone-600 dark:border-stone-700 dark:text-stone-400">
                                  {alert.liquidado_at
                                    ? alert.numero_ciclo
                                      ? `CICLO #${alert.numero_ciclo}`
                                      : 'LIQUIDADO'
                                    : alert.estado}
                                </span>
                              )}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </>
              )}

              {/* Pie de Totales en Vista */}
              {filteredAlerts.length > 0 && (
                <div className="flex flex-wrap items-center justify-between gap-3 border-t border-stone-200 bg-[#FAF9F6] px-4 py-2.5 text-xs dark:border-stone-800 dark:bg-[#121110]">
                  <div className="font-medium text-stone-600 dark:text-stone-400">
                    Totales en vista ({visibleTableTotals.totalRows} reg. ·{' '}
                    {visibleTableTotals.conciliadosCount} conc.)
                  </div>
                  <div className="flex flex-wrap items-center gap-4 font-mono tabular-nums">
                    <div>
                      <span className="text-[10px] uppercase text-stone-500 dark:text-stone-400">Bruto </span>
                      <strong className="text-stone-900 dark:text-stone-100">
                        {formatMoney(visibleTableTotals.brutoAllUsd, 'USD')}
                      </strong>
                      {visibleTableTotals.brutoAllUsdt > 0 && (
                        <span className="ml-1.5 text-[11px] text-stone-500 dark:text-stone-400">
                          / {formatMoney(visibleTableTotals.brutoAllUsdt, 'USDT')}
                        </span>
                      )}
                    </div>
                    <div>
                      <span className="text-[10px] uppercase text-stone-500 dark:text-stone-400">Com. </span>
                      <span className="text-stone-700 dark:text-stone-300">
                        -{formatMoney(visibleTableTotals.comisionUsd, 'USD')}
                      </span>
                    </div>
                    <div>
                      <span className="text-[10px] uppercase text-stone-500 dark:text-stone-400">Neto </span>
                      <strong className="text-emerald-700 dark:text-emerald-400">
                        {formatMoney(visibleTableTotals.netoUsd, 'USD')}
                      </strong>
                      {visibleTableTotals.netoUsdt > 0 && (
                        <span className="ml-1.5 text-[11px] text-emerald-700 dark:text-emerald-400">
                          / {formatMoney(visibleTableTotals.netoUsdt, 'USDT')}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              )}
            </section>

            {/* Barra Flotante Inferior de Acciones Masivas por Lote (siempre accesible en scroll) */}
            {selectedAlertIds.length > 0 && (
              <div className="sticky bottom-4 z-30 mt-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-stone-900/20 bg-stone-900/95 px-4 py-3 text-stone-50 shadow-xl backdrop-blur-sm dark:border-stone-700 dark:bg-[#1C1A18]/95 dark:text-stone-100">
                <div className="flex items-center gap-3">
                  <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-stone-800 font-mono text-xs font-semibold tabular-nums text-stone-100">
                    {selectedAlertIds.length}
                  </span>
                  <div>
                    <p className="text-sm font-medium">
                      {selectedAlertIds.length} movimientos seleccionados para lote
                    </p>
                    <p className="text-xs text-stone-300 dark:text-stone-400">
                      Monto total bruto:{' '}
                      <strong className="font-mono tabular-nums text-white dark:text-stone-100">
                        $
                        {alerts
                          .filter((a) => selectedAlertIds.includes(a.id))
                          .reduce((sum, a) => sum + a.monto_bruto, 0)
                          .toFixed(2)}{' '}
                        USD
                      </strong>
                    </p>
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      const receivedOnlyIds = alerts
                        .filter(
                          (a) =>
                            selectedAlertIds.includes(a.id) &&
                            a.tipo_movimiento === 'RECIBIDO'
                        )
                        .map((a) => a.id);
                      if (receivedOnlyIds.length === 0) {
                        setBannerMessage({
                          type: 'warning',
                          text: 'Solo se pueden asignar al cliente pagos de tipo RECIBIDO. Los correos ENVIADOS solo pueden eliminarse.',
                        });
                        return;
                      }
                      if (receivedOnlyIds.length !== selectedAlertIds.length) {
                        setSelectedAlertIds(receivedOnlyIds);
                      }
                      setBatchTargetClient('');
                      setBatchNotes('Asignación masiva por lote (auditoría)');
                      setIsBatchModalOpen(true);
                    }}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-stone-100 px-3.5 py-2 text-xs font-medium text-stone-950 transition hover:bg-white cursor-pointer"
                  >
                    <UserCheck className="h-3.5 w-3.5" strokeWidth={1.5} />
                    Asignar seleccionados al cliente
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      const selectedRecords = alerts.filter((a) =>
                        selectedAlertIds.includes(a.id)
                      );
                      openDiscardModalForAlerts(selectedRecords);
                    }}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-rose-500/40 bg-rose-700 px-3.5 py-2 text-xs font-medium text-white transition hover:bg-rose-600 cursor-pointer"
                  >
                    <Trash2 className="h-3.5 w-3.5" strokeWidth={1.5} />
                    Eliminar ({selectedAlertIds.length})
                  </button>
                  <button
                    type="button"
                    onClick={() => setSelectedAlertIds([])}
                    className="rounded-lg border border-stone-700 px-3 py-2 text-xs font-medium text-stone-300 transition hover:bg-stone-800 cursor-pointer"
                  >
                    Cancelar
                  </button>
                </div>
              </div>
            )}

            {/* Inspector Slide-Over Drawer (Escritorio derecho / Móvil Bottom Sheet) bajo demanda */}
            <Dialog.Root
              open={isInspectorDrawerOpen && Boolean(selectedInspectorAlert)}
              onOpenChange={setIsInspectorDrawerOpen}
            >
              <Dialog.Portal>
                <Dialog.Overlay className="fixed inset-0 z-40 bg-stone-950/45 backdrop-blur-[2px]" />
                <Dialog.Content className="fixed inset-x-0 bottom-0 z-50 flex max-h-[88vh] flex-col overflow-hidden rounded-t-2xl border-t border-stone-200 bg-white text-stone-900 shadow-2xl focus:outline-none lg:inset-y-0 lg:left-auto lg:right-0 lg:max-h-none lg:w-full lg:max-w-md lg:rounded-none lg:border-l lg:border-t-0 dark:border-stone-800 dark:bg-[#1C1A18] dark:text-stone-100">
                  {selectedInspectorAlert &&
                    (() => {
                      const alert = selectedInspectorAlert;
                      const badge = getPlatformBadgeMeta(alert.plataforma);
                      const candidateOrder = findAssociatedCaptureOrder(alert);
                      const hasCapture = Boolean(
                        alert.has_capture ||
                          alert.comprobante_base64 ||
                          candidateOrder?.has_capture ||
                          candidateOrder?.comprobante_base64
                      );
                      const reportedSender =
                        alert.remitente_reportado ||
                        candidateOrder?.remitente_reportado ||
                        candidateOrder?.nombre_remitente_reportado ||
                        null;
                      const reportedCode =
                        alert.codigo_orden || candidateOrder?.codigo_orden || null;
                      const reportedRef =
                        alert.referencia_reportada ||
                        candidateOrder?.referencia_reportada ||
                        null;
                      const senderSimilarity =
                        reportedSender && alert.remitente_o_contraparte
                          ? calculateSenderSimilarity(
                              reportedSender,
                              alert.remitente_o_contraparte
                            )
                          : 1;
                      const isRefVerified = referencesMatch(
                        reportedRef,
                        alert.referencia
                      );
                      const hasNameDisparity = Boolean(
                        reportedSender &&
                          alert.remitente_o_contraparte &&
                          senderSimilarity < 0.65 &&
                          !(isRefVerified && senderSimilarity >= 0.4)
                      );

                      return (
                        <>
                          {/* Manija táctil móvil */}
                          <div className="mx-auto mt-2.5 h-1 w-10 shrink-0 rounded-full bg-stone-300 lg:hidden dark:bg-stone-700" />

                          {/* Cabecera fija del Drawer */}
                          <div className="shrink-0 border-b border-stone-200 px-5 py-4 dark:border-stone-800">
                            <div className="flex items-start justify-between gap-3">
                              <div className="min-w-0">
                                <div className="flex flex-wrap items-center gap-2">
                                  <span
                                    className={`inline-flex items-center rounded border px-2 py-0.5 text-[10px] font-medium ${badge.badgeClass}`}
                                  >
                                    {badge.label}
                                  </span>
                                  {alert.tipo_movimiento === 'RECIBIDO' ? (
                                    <span className="inline-flex items-center gap-0.5 text-xs font-medium text-emerald-700 dark:text-emerald-400">
                                      <ArrowDownLeft className="h-3.5 w-3.5" strokeWidth={1.5} />
                                      Recibido
                                    </span>
                                  ) : (
                                    <span className="inline-flex items-center gap-0.5 text-xs font-medium text-rose-700 dark:text-rose-400">
                                      <ArrowUpRight className="h-3.5 w-3.5" strokeWidth={1.5} />
                                      Enviado
                                    </span>
                                  )}
                                  {alert.liquidado_at ? (
                                    <span className="rounded-full border border-stone-300 bg-stone-100 px-2 py-0.5 text-[10px] font-medium text-stone-700 dark:border-stone-700 dark:bg-stone-800 dark:text-stone-300">
                                      {alert.numero_ciclo
                                        ? `CICLO #${alert.numero_ciclo}`
                                        : 'LIQUIDADO'}
                                    </span>
                                  ) : alert.estado === 'CONCILIADO' ? (
                                    <span className="rounded-full border border-emerald-700/20 bg-emerald-50 px-2 py-0.5 text-[10px] font-medium text-emerald-700 dark:border-emerald-500/30 dark:bg-emerald-950/40 dark:text-emerald-400">
                                      CONCILIADO
                                    </span>
                                  ) : alert.estado === 'DESCARTADO' ? (
                                    <span className="rounded-full border border-rose-700/25 bg-rose-50 px-2 py-0.5 text-[10px] font-medium text-rose-700 dark:border-rose-500/35 dark:bg-rose-950/40 dark:text-rose-400">
                                      ELIMINADO
                                    </span>
                                  ) : (
                                    <span className="rounded-full border border-amber-700/25 bg-amber-50 px-2 py-0.5 text-[10px] font-medium text-amber-800 dark:border-amber-500/35 dark:bg-amber-950/40 dark:text-amber-400">
                                      {alert.estado === 'REVISION_MANUAL'
                                        ? 'REVISIÓN MANUAL'
                                        : 'DETECTADO'}
                                    </span>
                                  )}
                                </div>
                                <Dialog.Title className="mt-2 font-serif text-xl font-medium tracking-tight text-stone-900 dark:text-stone-100">
                                  {alert.remitente_o_contraparte || 'Remitente no identificado'}
                                </Dialog.Title>
                                <Dialog.Description className="mt-0.5 flex items-center gap-1.5 font-mono text-xs tabular-nums text-stone-500 dark:text-stone-400">
                                  <span>{formatDateTime(alert.fecha_transaccion)}</span>
                                  <span>·</span>
                                  <span className="font-semibold text-stone-700 dark:text-stone-300">
                                    {alert.referencia || 'SIN-REF'}
                                  </span>
                                  {alert.referencia && alert.referencia !== 'SIN-REF' && (
                                    <button
                                      type="button"
                                      onClick={() =>
                                        handleCopyReference(alert.id, alert.referencia || '')
                                      }
                                      className="rounded p-0.5 text-stone-400 transition hover:bg-stone-100 hover:text-stone-700 cursor-pointer dark:hover:bg-stone-800 dark:hover:text-stone-200"
                                      title="Copiar referencia"
                                    >
                                      {copiedRefId === alert.id ? (
                                        <Check className="h-3.5 w-3.5 text-emerald-700 dark:text-emerald-400" strokeWidth={2} />
                                      ) : (
                                        <Copy className="h-3.5 w-3.5" strokeWidth={1.5} />
                                      )}
                                    </button>
                                  )}
                                </Dialog.Description>
                              </div>
                              <Dialog.Close asChild>
                                <button
                                  type="button"
                                  className="rounded-lg p-1.5 text-stone-400 transition hover:bg-stone-100 hover:text-stone-900 cursor-pointer dark:hover:bg-stone-800 dark:hover:text-stone-100"
                                  aria-label="Cerrar detalle"
                                >
                                  <X className="h-4 w-4" strokeWidth={1.5} />
                                </button>
                              </Dialog.Close>
                            </div>
                          </div>

                          {/* Cuerpo scrolleable del Drawer */}
                          <div className="flex-1 space-y-4 overflow-y-auto px-5 py-4">
                            {/* Desglose Financiero */}
                            <div className="grid grid-cols-3 divide-x divide-stone-200 rounded-lg border border-stone-200 bg-[#FAF9F6] dark:divide-stone-800 dark:border-stone-800 dark:bg-[#121110]">
                              <div className="px-3 py-2.5">
                                <span className="text-[10px] font-medium uppercase tracking-wider text-stone-500 dark:text-stone-400">
                                  Bruto
                                </span>
                                <p className="mt-0.5 font-mono text-sm font-semibold tabular-nums text-stone-900 dark:text-stone-100">
                                  {formatMoney(alert.monto_bruto, alert.moneda)}
                                </p>
                              </div>
                              <div className="px-3 py-2.5">
                                <span className="text-[10px] font-medium uppercase tracking-wider text-stone-500 dark:text-stone-400">
                                  Comisión
                                </span>
                                <p className="mt-0.5 font-mono text-sm font-semibold tabular-nums text-stone-900 dark:text-stone-100">
                                  {alert.estado === 'CONCILIADO' && alert.monto_comision > 0
                                    ? `-${formatMoney(alert.monto_comision, alert.moneda)}`
                                    : formatMoney(0, alert.moneda)}
                                </p>
                                {alert.estado === 'CONCILIADO' && (
                                  <span className="font-mono text-[10px] text-stone-500 dark:text-stone-400">
                                    {alert.porcentaje_comision}%
                                  </span>
                                )}
                              </div>
                              <div className="px-3 py-2.5">
                                <span className="text-[10px] font-medium uppercase tracking-wider text-stone-500 dark:text-stone-400">
                                  Neto
                                </span>
                                <p
                                  className={`mt-0.5 font-mono text-sm font-semibold tabular-nums ${
                                    alert.estado === 'CONCILIADO'
                                      ? 'text-emerald-700 dark:text-emerald-400'
                                      : 'text-stone-900 dark:text-stone-100'
                                  }`}
                                >
                                  {alert.estado === 'CONCILIADO'
                                    ? formatMoney(alert.monto_neto, alert.moneda)
                                    : formatMoney(alert.monto_bruto, alert.moneda)}
                                </p>
                              </div>
                            </div>

                            {/* Titular & Orden */}
                            <dl className="grid grid-cols-2 gap-3 text-xs">
                              <div className="rounded-lg border border-stone-200/80 bg-[#FAF9F6] p-3 dark:border-stone-800 dark:bg-[#121110]">
                                <dt className="text-[10px] font-medium uppercase tracking-wider text-stone-500 dark:text-stone-400">
                                  Titular Asignado
                                </dt>
                                <dd className="mt-1 font-medium text-stone-900 dark:text-stone-100">
                                  {alert.cliente_asignado_nombre ? (
                                    <span className="inline-flex items-center gap-1.5 text-emerald-700 dark:text-emerald-400">
                                      <UserCheck className="h-3.5 w-3.5" strokeWidth={1.5} />
                                      {alert.cliente_asignado_nombre}
                                    </span>
                                  ) : (
                                    <span className="text-stone-400 dark:text-stone-500">
                                      En espera de orden
                                    </span>
                                  )}
                                </dd>
                              </div>

                              <div className="rounded-lg border border-stone-200/80 bg-[#FAF9F6] p-3 dark:border-stone-800 dark:bg-[#121110]">
                                <dt className="text-[10px] font-medium uppercase tracking-wider text-stone-500 dark:text-stone-400">
                                  Orden / Liquidación
                                </dt>
                                <dd className="mt-1 font-mono text-stone-800 dark:text-stone-200">
                                  {reportedCode ?? '—'}
                                  {alert.codigo_liquidacion && (
                                    <span className="block text-[10px] text-amber-700 dark:text-amber-400">
                                      {alert.codigo_liquidacion}
                                    </span>
                                  )}
                                </dd>
                              </div>
                            </dl>

                            {/* Comparativa Reporte Cliente */}
                            <div className="rounded-lg border border-stone-200/80 bg-[#FAF9F6] p-3.5 text-xs dark:border-stone-800 dark:bg-[#121110]">
                              <div className="flex items-center justify-between">
                                <span className="text-[10px] font-medium uppercase tracking-wider text-stone-500 dark:text-stone-400">
                                  Reporte del Cliente (Portal)
                                </span>
                                {hasNameDisparity && (
                                  <span className="inline-flex items-center gap-1 rounded border border-amber-700/30 bg-amber-50 px-1.5 py-0.5 text-[10px] font-medium text-amber-800 dark:border-amber-500/35 dark:bg-amber-950/40 dark:text-amber-400">
                                    <AlertTriangle className="h-3 w-3" strokeWidth={1.5} />
                                    Diferencia de nombre
                                  </span>
                                )}
                              </div>
                              {reportedSender || reportedRef ? (
                                <div className="mt-2 grid grid-cols-2 gap-2">
                                  <div>
                                    <span className="text-[10px] text-stone-500 dark:text-stone-400">
                                      Remitente reportado
                                    </span>
                                    <p className="font-medium text-stone-900 dark:text-stone-100">
                                      {reportedSender ?? '—'}
                                    </p>
                                  </div>
                                  <div>
                                    <span className="text-[10px] text-stone-500 dark:text-stone-400">
                                      Ref. reportada
                                    </span>
                                    <p className="font-mono font-medium text-stone-900 dark:text-stone-100">
                                      {reportedRef ?? '—'}
                                    </p>
                                  </div>
                                </div>
                              ) : (
                                <p className="mt-1.5 italic text-stone-400 dark:text-stone-500">
                                  Sin reporte del cliente asociado aún.
                                </p>
                              )}
                              {alert.nota_auditoria && (
                                <p className="mt-2 border-t border-stone-200 pt-2 text-[11px] text-stone-600 dark:border-stone-800 dark:text-stone-400">
                                  Nota: {alert.nota_auditoria}
                                </p>
                              )}
                            </div>

                            {/* Comprobante proporcionado en formato vertical */}
                            {hasCapture && (
                              <div className="rounded-lg border border-stone-200/80 bg-[#FAF9F6] p-3.5 dark:border-stone-800 dark:bg-[#121110]">
                                <div className="mb-2.5 flex items-center justify-between">
                                  <span className="text-[10px] font-medium uppercase tracking-wider text-stone-500 dark:text-stone-400">
                                    Comprobante del Cliente
                                  </span>
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setIsInspectorDrawerOpen(false);
                                      void openLightboxForTx(alert);
                                    }}
                                    className="inline-flex items-center gap-1 text-[11px] font-medium text-amber-700 hover:underline dark:text-amber-500 cursor-pointer"
                                  >
                                    <Eye className="h-3 w-3" strokeWidth={1.5} />
                                    Ampliar en Visor
                                  </button>
                                </div>
                                {isLoadingInspectorPreview ? (
                                  <div className="flex h-40 items-center justify-center rounded-lg border border-dashed border-stone-300 text-xs text-stone-400 dark:border-stone-700">
                                    <Loader2 className="mr-2 h-4 w-4 animate-spin" strokeWidth={1.5} />
                                    Cargando comprobante...
                                  </div>
                                ) : inspectorPreviewBase64 ? (
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setIsInspectorDrawerOpen(false);
                                      void openLightboxForTx(alert);
                                    }}
                                    className="mx-auto block max-w-[240px] overflow-hidden rounded-lg border border-stone-200 bg-white shadow-sm transition hover:border-amber-700/50 cursor-pointer dark:border-stone-700"
                                  >
                                    <img
                                      src={inspectorPreviewBase64}
                                      alt="Vista previa de comprobante"
                                      className="max-h-72 w-auto object-contain"
                                    />
                                  </button>
                                ) : (
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setIsInspectorDrawerOpen(false);
                                      void openLightboxForTx(alert);
                                    }}
                                    className="flex w-full items-center justify-center gap-2 rounded-md border border-dashed border-stone-300 py-5 text-xs font-medium text-stone-600 transition hover:border-amber-700 hover:text-stone-900 dark:border-stone-700 dark:text-stone-400 dark:hover:text-stone-100 cursor-pointer"
                                  >
                                    <ImageIcon className="h-4 w-4" strokeWidth={1.5} />
                                    Abrir captura en visor completo
                                  </button>
                                )}
                              </div>
                            )}
                          </div>

                          {/* Pie fijo con acciones del Drawer */}
                          <div className="flex shrink-0 flex-wrap items-center gap-2 border-t border-stone-200 bg-[#FAF9F6] px-5 py-3.5 dark:border-stone-800 dark:bg-[#121110]">
                            {alert.estado !== 'CONCILIADO' &&
                              alert.estado !== 'DESCARTADO' &&
                              !alert.liquidado_at &&
                              alert.tipo_movimiento === 'RECIBIDO' && (
                                <button
                                  type="button"
                                  onClick={() => {
                                    setIsInspectorDrawerOpen(false);
                                    openManualReconciliationModal(
                                      alert,
                                      candidateOrder
                                    );
                                  }}
                                  className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-stone-900 px-3.5 py-2 text-xs font-medium text-stone-50 shadow-sm transition hover:bg-stone-800 cursor-pointer dark:bg-stone-100 dark:text-stone-950 dark:hover:bg-white"
                                >
                                  <UserCheck className="h-3.5 w-3.5" strokeWidth={1.5} />
                                  Conciliar
                                </button>
                              )}
                            {hasCapture && (
                              <button
                                type="button"
                                onClick={() => {
                                  setIsInspectorDrawerOpen(false);
                                  void openLightboxForTx(alert);
                                }}
                                className="inline-flex items-center gap-1.5 rounded-lg border border-stone-200 bg-white px-3 py-2 text-xs font-medium text-stone-700 transition hover:bg-stone-50 cursor-pointer dark:border-stone-800 dark:bg-[#1C1A18] dark:text-stone-200 dark:hover:bg-stone-900"
                              >
                                <ImageIcon className="h-3.5 w-3.5 text-stone-400" strokeWidth={1.5} />
                                Captura
                              </button>
                            )}
                            <button
                              type="button"
                              onClick={() => {
                                setIsInspectorDrawerOpen(false);
                                setInspectedAlert(alert);
                              }}
                              className="inline-flex items-center gap-1.5 rounded-lg border border-stone-200 bg-white px-3 py-2 text-xs font-medium text-stone-700 transition hover:bg-stone-50 cursor-pointer dark:border-stone-800 dark:bg-[#1C1A18] dark:text-stone-200 dark:hover:bg-stone-900"
                            >
                              <FileText className="h-3.5 w-3.5 text-stone-400" strokeWidth={1.5} />
                              Payload
                            </button>
                            {alert.estado === 'CONCILIADO' && !alert.liquidado_at && (
                              <button
                                type="button"
                                onClick={() => {
                                  setIsInspectorDrawerOpen(false);
                                  setAlertToRevert(alert);
                                  setRevertReason('');
                                }}
                                className="inline-flex items-center gap-1.5 rounded-lg border border-rose-700/25 bg-rose-50 px-3 py-2 text-xs font-medium text-rose-700 transition hover:bg-rose-100 cursor-pointer dark:border-rose-500/35 dark:bg-rose-950/40 dark:text-rose-400 dark:hover:bg-rose-950/70"
                              >
                                <RotateCcw className="h-3.5 w-3.5" strokeWidth={1.5} />
                                Deshacer
                              </button>
                            )}
                            {alert.estado !== 'CONCILIADO' &&
                              alert.estado !== 'DESCARTADO' &&
                              !alert.liquidado_at && (
                                <button
                                  type="button"
                                  onClick={() => {
                                    setIsInspectorDrawerOpen(false);
                                    openDiscardModalForAlerts([alert]);
                                  }}
                                  className="inline-flex items-center gap-1.5 rounded-lg border border-rose-700/25 bg-rose-50 px-3 py-2 text-xs font-medium text-rose-700 transition hover:bg-rose-100 cursor-pointer dark:border-rose-500/35 dark:bg-rose-950/40 dark:text-rose-400 dark:hover:bg-rose-950/70"
                                >
                                  <Trash2 className="h-3.5 w-3.5" strokeWidth={1.5} />
                                  Eliminar
                                </button>
                              )}
                            {alert.estado === 'DESCARTADO' && (
                              <button
                                type="button"
                                disabled={restoringAlertId === alert.id}
                                onClick={() => {
                                  setIsInspectorDrawerOpen(false);
                                  void handleRestoreDiscardedAlert(alert);
                                }}
                                className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-700/25 bg-emerald-50 px-3 py-2 text-xs font-medium text-emerald-700 transition hover:bg-emerald-100 disabled:opacity-50 cursor-pointer dark:border-emerald-500/35 dark:bg-emerald-950/40 dark:text-emerald-400"
                              >
                                <RotateCcw className="h-3.5 w-3.5" strokeWidth={1.5} />
                                Restaurar
                              </button>
                            )}
                          </div>
                        </>
                      );
                    })()}
                </Dialog.Content>
              </Dialog.Portal>
            </Dialog.Root>
          </>
        )}

        {/* =====================================================================
            PESTAÑA: EGRESOS / GASTOS PERSONALES Y SALIDAS (TIPO_MOVIMIENTO = ENVIADO)
           ===================================================================== */}
        {activeTab === 'EXPENSES' && (
          <div className="space-y-5">
            {/* Encabezado y Métricas de Egresos */}
            <div className="rounded-xl border border-stone-200/90 bg-white p-5 shadow-sm dark:border-stone-800 dark:bg-[#1C1A18]">
              <div className="flex flex-wrap items-center justify-between gap-4">
                <div className="flex items-center gap-3">
                  <div className="rounded-lg border border-rose-700/20 bg-rose-50 p-2.5 text-rose-700 dark:border-rose-500/30 dark:bg-rose-950/40 dark:text-rose-400">
                    <CreditCard className="h-5 w-5" strokeWidth={1.5} />
                  </div>
                  <div>
                    <h2 className="font-serif text-lg font-medium tracking-tight text-stone-900 dark:text-stone-100">
                      Egresos, Gastos Personales y Salidas Operativas
                    </h2>
                    <p className="text-xs text-stone-500 dark:text-stone-400">
                      Compras con tarjeta de débito (*0545), transferencias salientes y gastos del operador. Separados de la conciliación de clientes.
                    </p>
                  </div>
                </div>

                <div className="grid grid-cols-2 divide-x divide-stone-200 rounded-lg border border-stone-200/90 bg-[#FAF9F6] dark:divide-stone-800 dark:border-stone-800 dark:bg-[#121110]">
                  <div className="px-4 py-2.5 text-right">
                    <span className="block text-[10px] font-medium uppercase tracking-wider text-stone-500 dark:text-stone-400">
                      Total Salidas USD
                    </span>
                    <span className="font-mono text-base font-semibold tabular-nums text-rose-700 dark:text-rose-400">
                      -{formatMoney(totalExpensesUsd, 'USD')}
                    </span>
                  </div>
                  <div className="px-4 py-2.5 text-right">
                    <span className="block text-[10px] font-medium uppercase tracking-wider text-stone-500 dark:text-stone-400">
                      Operaciones
                    </span>
                    <span className="font-mono text-base font-semibold tabular-nums text-stone-900 dark:text-stone-100">
                      {sentAlertsCount}
                    </span>
                  </div>
                </div>
              </div>
            </div>

            {/* Buscador de Egresos */}
            <div className="flex items-center gap-3 rounded-xl border border-stone-200/90 bg-white p-3.5 shadow-sm dark:border-stone-800 dark:bg-[#1C1A18]">
              <div className="relative flex-1">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-stone-400" strokeWidth={1.5} />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Buscar gasto por comercio, tarjeta, TxID o destinatario..."
                  className="w-full rounded-lg border border-stone-200 bg-[#FAF9F6] py-2 pl-9 pr-4 text-sm text-stone-900 placeholder-stone-400 focus:border-amber-700 focus:outline-none dark:border-stone-800 dark:bg-[#121110] dark:text-stone-100 dark:placeholder-stone-500 dark:focus:border-amber-500"
                />
              </div>
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => setSearchQuery('')}
                  className="text-xs font-medium text-stone-500 hover:text-stone-900 dark:text-stone-400 dark:hover:text-stone-100"
                >
                  Limpiar
                </button>
              )}
            </div>

            {/* Tabla de Egresos */}
            <div className="overflow-hidden rounded-xl border border-stone-200/90 bg-white shadow-sm dark:border-stone-800 dark:bg-[#1C1A18]">
              <div className="overflow-x-auto">
                <table className="w-full border-collapse text-left text-sm table-auto">
                  <thead>
                    <tr className="border-b border-stone-200 bg-[#FAF9F6] text-[11px] font-medium uppercase tracking-wider text-stone-500 dark:border-stone-800 dark:bg-[#121110] dark:text-stone-400">
                      <th className="px-4 py-3">Fecha &amp; Canal</th>
                      <th className="px-3 py-3">Tipo de Salida</th>
                      <th className="px-4 py-3">Destinatario / Comercio / Tarjeta</th>
                      <th className="px-4 py-3">Referencia / TxID</th>
                      <th className="px-4 py-3 text-right">Monto Gastado</th>
                      <th className="px-4 py-3 text-right">Detalles</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-stone-200/80 dark:divide-stone-800">
                    {expensesAlerts.length === 0 ? (
                      <tr>
                        <td colSpan={6} className="px-6 py-12 text-center text-stone-500 dark:text-stone-400">
                          No se registraron egresos o gastos que coincidan con la búsqueda.
                        </td>
                      </tr>
                    ) : (
                      expensesAlerts.map((expense) => {
                        const badge = getPlatformBadgeMeta(expense.plataforma);
                        return (
                          <tr key={expense.id} className="transition hover:bg-[#FAF9F6] dark:hover:bg-stone-900/50">
                            <td className="whitespace-nowrap px-4 py-3">
                              <span
                                className={`inline-flex items-center rounded border px-2 py-0.5 text-[11px] font-medium ${badge.badgeClass}`}
                              >
                                {badge.label}
                              </span>
                              <p className="mt-1 font-mono text-xs tabular-nums text-stone-500 dark:text-stone-400">
                                {formatDateTime(expense.fecha_transaccion)}
                              </p>
                            </td>
                            <td className="whitespace-nowrap px-3 py-3">
                              <span className="inline-flex items-center gap-1 rounded-full border border-rose-700/25 bg-rose-50 px-2.5 py-0.5 text-[11px] font-medium text-rose-700 dark:border-rose-500/35 dark:bg-rose-950/40 dark:text-rose-400">
                                <ArrowUpRight className="h-3 w-3" strokeWidth={1.5} />
                                ENVIADO / SALIDA
                              </span>
                            </td>
                            <td className="px-4 py-3">
                              <p className="font-medium text-stone-900 dark:text-stone-100">
                                {expense.remitente_o_contraparte || 'No especificado'}
                              </p>
                              {expense.nota_auditoria && (
                                <p className="mt-0.5 text-[11px] text-stone-500 dark:text-stone-400">
                                  {expense.nota_auditoria}
                                </p>
                              )}
                            </td>
                            <td className="whitespace-nowrap px-4 py-3 font-mono text-xs text-stone-600 dark:text-stone-400">
                              {expense.referencia || 'SIN-REF'}
                            </td>
                            <td className="whitespace-nowrap px-4 py-3 text-right font-mono text-sm font-semibold tabular-nums text-rose-700 dark:text-rose-400">
                              -{formatMoney(expense.monto_bruto, expense.moneda)}
                            </td>
                            <td className="whitespace-nowrap px-4 py-3 text-right">
                              <button
                                type="button"
                                onClick={() => setInspectedAlert(expense)}
                                className="inline-flex items-center gap-1 rounded-md border border-stone-200 bg-[#FAF9F6] px-2.5 py-1 text-xs font-medium text-stone-700 transition hover:bg-stone-100 cursor-pointer dark:border-stone-800 dark:bg-[#121110] dark:text-stone-300 dark:hover:bg-stone-900"
                              >
                                <FileText className="h-3.5 w-3.5 text-stone-400" strokeWidth={1.5} />
                                Payload
                              </button>
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* =====================================================================
            PESTAÑA 2: CUENTAS DE CLIENTES Y ÓRDENES PENDIENTES
           ===================================================================== */}
        {activeTab === 'CLIENTS' && (
          <div className="space-y-6">
            <div className="flex flex-col justify-between gap-4 rounded-xl border border-stone-200/90 bg-white p-5 shadow-sm sm:flex-row sm:items-center dark:border-stone-800 dark:bg-[#1C1A18]">
              <div>
                <h2 className="font-serif text-lg font-medium tracking-tight text-stone-900 dark:text-stone-100">
                  Directorio de Clientes y Cuentas de Acceso al Portal
                </h2>
                <p className="mt-1 text-xs text-stone-500 dark:text-stone-400">
                  Cada cliente ingresa a `/portal` con su Correo y PIN para reportar los pagos de terceros que recibe y consultar su saldo neto liquidable en USD y USDT.
                </p>
              </div>
              <div className="flex flex-wrap gap-2.5">
                <button
                  type="button"
                  onClick={() => setIsNewOrderModalOpen(true)}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-stone-200 bg-[#FAF9F6] px-3.5 py-2 text-xs font-medium text-stone-800 transition hover:bg-stone-100 dark:border-stone-800 dark:bg-[#121110] dark:text-stone-200 dark:hover:bg-stone-900"
                >
                  <FilePlus2 className="h-3.5 w-3.5 text-stone-400" strokeWidth={1.5} />
                  Registrar Orden Esperada
                </button>
                <button
                  type="button"
                  onClick={openCreateClientModal}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-stone-900 px-3.5 py-2 text-xs font-medium text-stone-50 shadow-sm transition hover:bg-stone-800 dark:bg-stone-100 dark:text-stone-950 dark:hover:bg-white"
                >
                  <UserPlus className="h-3.5 w-3.5" strokeWidth={1.5} />
                  Nueva Cuenta de Acceso
                </button>
              </div>
            </div>

            {lastPortalCredentials && (
              <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-emerald-700/20 bg-emerald-50 px-4 py-3 text-xs text-emerald-900 dark:border-emerald-500/30 dark:bg-emerald-950/30 dark:text-emerald-300">
                <div>
                  <strong>Último acceso asignado ({lastPortalCredentials.nombre}):</strong>{' '}
                  Correo <code className="font-mono font-semibold">{lastPortalCredentials.email}</code>
                  {lastPortalCredentials.pin && (
                    <>
                      {' '}· PIN <code className="font-mono font-semibold">{lastPortalCredentials.pin}</code>
                    </>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => void handleCopyPortalCredentials(lastPortalCredentials)}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-700/30 bg-white px-3 py-1.5 font-medium text-emerald-800 transition hover:bg-emerald-50 dark:border-emerald-500/40 dark:bg-[#1C1A18] dark:text-emerald-300"
                >
                  <Copy className="h-3.5 w-3.5" strokeWidth={1.5} />
                  Copiar Link + Credenciales
                </button>
              </div>
            )}

            {/* Tabla de Cuentas de Clientes */}
            <div className="overflow-hidden rounded-xl border border-stone-200/90 bg-white shadow-sm dark:border-stone-800 dark:bg-[#1C1A18]">
              <div className="border-b border-stone-200 bg-[#FAF9F6] px-5 py-3 dark:border-stone-800 dark:bg-[#121110]">
                <h3 className="text-xs font-medium uppercase tracking-wider text-stone-500 dark:text-stone-400">
                  Cuentas de Clientes Registrados ({clients.length})
                </h3>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full border-collapse text-left text-sm table-auto">
                  <thead>
                    <tr className="border-b border-stone-200 bg-[#FAF9F6]/60 text-[11px] font-medium uppercase tracking-wider text-stone-500 dark:border-stone-800 dark:bg-[#121110]/60 dark:text-stone-400">
                      <th className="px-4 py-3">Cliente / Titular</th>
                      <th className="px-4 py-3">Correo &amp; Acceso Portal</th>
                      <th className="px-4 py-3">Cuentas Asignadas</th>
                      <th className="px-4 py-3 text-center">Fees (Zelle / Bin.)</th>
                      <th className="px-4 py-3 text-right">Acreditado</th>
                      <th className="px-4 py-3 text-right">Liquidado</th>
                      <th className="px-4 py-3 text-right">Saldo Disponible</th>
                      <th className="px-4 py-3 text-right">Acciones</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-stone-200/80 dark:divide-stone-800">
                    {clients.length === 0 ? (
                      <tr>
                        <td
                          colSpan={8}
                          className="px-6 py-10 text-center text-stone-500 dark:text-stone-400"
                        >
                          Aún no hay cuentas de clientes registradas. Haz clic en &quot;Nueva Cuenta de Acceso&quot; para crear un usuario y asignarle su PIN del portal.
                        </td>
                      </tr>
                    ) : (
                      clients.map((c) => {
                        const dispUsd = c.saldo_disponible_usd ?? Math.round((c.total_neto_usd - (c.total_liquidado_usd ?? 0)) * 100) / 100;
                        const dispUsdt = c.saldo_disponible_usdt ?? Math.round((c.total_neto_usdt - (c.total_liquidado_usdt ?? 0)) * 100) / 100;
                        return (
                          <tr key={c.id} className="transition hover:bg-[#FAF9F6] dark:hover:bg-stone-900/50">
                            <td className="px-4 py-3.5 font-semibold text-stone-900 dark:text-stone-100">
                              {c.nombre_titular}
                              <div className="text-xs font-normal text-stone-500 dark:text-stone-400">
                                {c.pagos_conciliados_count} pago(s) conciliado(s)
                              </div>
                            </td>
                            <td className="px-4 py-3.5 text-xs text-stone-600 dark:text-stone-300">
                              <div>{c.email ?? c.email_contacto ?? 'Sin email'}</div>
                              <div className="mt-1 flex items-center gap-2">
                                {c.tiene_pin_configurado ? (
                                  <span className="inline-flex items-center gap-1 rounded-full border border-emerald-700/20 bg-emerald-50 px-2 py-0.5 text-[10px] font-medium text-emerald-700 dark:border-emerald-500/30 dark:bg-emerald-950/40 dark:text-emerald-400">
                                    <KeyRound className="h-2.5 w-2.5" strokeWidth={1.5} />
                                    PIN Activo
                                  </span>
                                ) : (
                                  <span className="inline-flex items-center gap-1 rounded-full border border-amber-700/25 bg-amber-50 px-2 py-0.5 text-[10px] font-medium text-amber-800 dark:border-amber-500/30 dark:bg-amber-950/40 dark:text-amber-400">
                                    Sin PIN
                                  </span>
                                )}
                                {c.telefono && (
                                  <span className="text-stone-400">{c.telefono}</span>
                                )}
                              </div>
                            </td>
                            <td className="px-4 py-3.5 text-xs text-stone-600 dark:text-stone-300">
                              {c.cuentas_asignadas && c.cuentas_asignadas.length > 0 ? (
                                <div className="space-y-1.5">
                                  {c.cuentas_asignadas.map((acc) => {
                                    const badge = getPlatformBadgeMeta(acc.plataforma);
                                    return (
                                      <div
                                        key={acc.id}
                                        className="flex flex-wrap items-center gap-1.5 rounded-lg border border-stone-200/80 bg-[#FAF9F6] px-2.5 py-1 dark:border-stone-800 dark:bg-[#121110]"
                                      >
                                        <span
                                          className={`inline-flex rounded border px-1.5 py-0.5 text-[10px] font-medium ${badge.badgeClass}`}
                                        >
                                          {badge.label}
                                        </span>
                                        <span className="font-mono text-[11px] font-medium text-stone-900 dark:text-stone-100">
                                          {acc.cuenta_receptora}
                                        </span>
                                        <span className="rounded bg-stone-200/80 px-1.5 py-0.5 font-mono text-[10px] font-medium text-stone-700 dark:bg-stone-800 dark:text-stone-300">
                                          {acc.moneda}
                                        </span>
                                      </div>
                                    );
                                  })}
                                </div>
                              ) : (
                                <span className="text-[11px] text-amber-700 dark:text-amber-400">
                                  Sin cuentas asignadas (usa Editar)
                                </span>
                              )}
                            </td>
                            <td className="px-4 py-3.5 text-center font-mono text-xs tabular-nums text-stone-600 dark:text-stone-400">
                              {c.porcentaje_comision_zelle}% / {c.porcentaje_comision_binance}%
                            </td>
                            <td className="px-4 py-3.5 text-right font-mono text-xs tabular-nums text-stone-900 dark:text-stone-100">
                              <div>{formatMoney(c.total_neto_usd, 'USD')}</div>
                              {c.total_neto_usdt > 0 && (
                                <div className="text-stone-500 dark:text-stone-400">{formatMoney(c.total_neto_usdt, 'USDT')}</div>
                              )}
                            </td>
                            <td className="px-4 py-3.5 text-right font-mono text-xs tabular-nums text-stone-700 dark:text-stone-300">
                              <div>{formatMoney(c.total_liquidado_usd ?? 0, 'USD')}</div>
                              {(c.total_liquidado_usdt ?? 0) > 0 && (
                                <div>{formatMoney(c.total_liquidado_usdt ?? 0, 'USDT')}</div>
                              )}
                              <div className="font-sans text-[10px] text-stone-400">
                                {c.liquidaciones_count ?? 0} liq.
                              </div>
                            </td>
                            <td className="px-4 py-3.5 text-right font-mono font-semibold tabular-nums">
                              <div
                                className={`text-sm ${
                                  dispUsd < 0
                                    ? 'text-rose-700 dark:text-rose-400'
                                    : dispUsd > 0
                                      ? 'text-emerald-700 dark:text-emerald-400'
                                      : 'text-stone-900 dark:text-stone-100'
                                }`}
                              >
                                {formatMoney(dispUsd, 'USD')}
                              </div>
                              {c.total_neto_usdt > 0 && (
                                <div
                                  className={`text-xs ${
                                    dispUsdt < 0
                                      ? 'text-rose-700 dark:text-rose-400'
                                      : dispUsdt > 0
                                        ? 'text-emerald-700 dark:text-emerald-400'
                                        : 'text-stone-500'
                                  }`}
                                >
                                  {formatMoney(dispUsdt, 'USDT')}
                                </div>
                              )}
                            </td>
                            <td className="whitespace-nowrap px-4 py-3.5 text-right">
                              <div className="flex items-center justify-end gap-1.5">
                                <button
                                  type="button"
                                  onClick={() => openLiquidationModal(c)}
                                  className="inline-flex items-center gap-1 rounded-lg bg-stone-900 px-2.5 py-1.5 text-xs font-medium text-stone-50 transition hover:bg-stone-800 dark:bg-stone-100 dark:text-stone-950 dark:hover:bg-white"
                                  title="Liquidar saldo a favor del cliente o de un tercero"
                                >
                                  <Coins className="h-3.5 w-3.5" strokeWidth={1.5} />
                                  Liquidar
                                </button>
                                <button
                                  type="button"
                                  onClick={() => openEditClientModal(c)}
                                  className="inline-flex items-center gap-1 rounded-lg border border-stone-200 bg-[#FAF9F6] px-2.5 py-1.5 text-xs font-medium text-stone-700 transition hover:bg-stone-100 dark:border-stone-800 dark:bg-[#121110] dark:text-stone-200 dark:hover:bg-stone-900"
                                >
                                  <KeyRound className="h-3 w-3 text-stone-400" strokeWidth={1.5} />
                                  Editar
                                </button>
                                <button
                                  type="button"
                                  onClick={() =>
                                    void handleDeleteClient(c.id, c.nombre_titular)
                                  }
                                  className="rounded-lg p-1.5 text-stone-400 transition hover:bg-rose-50 hover:text-rose-700 dark:hover:bg-rose-950/40 dark:hover:text-rose-400"
                                  title="Eliminar cliente"
                                >
                                  <Trash2 className="h-3.5 w-3.5" strokeWidth={1.5} />
                                </button>
                              </div>
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Tabla de Órdenes de Pago Pendientes (Reportadas en el Portal) */}
            <div className="overflow-hidden rounded-xl border border-stone-200/90 bg-white shadow-sm dark:border-stone-800 dark:bg-[#1C1A18]">
              <div className="border-b border-stone-200 bg-[#FAF9F6] px-5 py-3 dark:border-stone-800 dark:bg-[#121110]">
                <h3 className="text-xs font-medium uppercase tracking-wider text-stone-500 dark:text-stone-400">
                  Órdenes / Reportes de Pago Pendientes ({pendingOrders.length})
                </h3>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full border-collapse text-left text-sm table-auto">
                  <thead>
                    <tr className="border-b border-stone-200 bg-[#FAF9F6]/60 text-[11px] font-medium uppercase tracking-wider text-stone-500 dark:border-stone-800 dark:bg-[#121110]/60 dark:text-stone-400">
                      <th className="px-4 py-3">Código Orden</th>
                      <th className="px-4 py-3">Cliente Titular</th>
                      <th className="px-4 py-3">Remitente Reportado</th>
                      <th className="px-4 py-3">Plataforma</th>
                      <th className="px-4 py-3">Referencia</th>
                      <th className="px-4 py-3 text-right">Monto Esperado</th>
                      <th className="px-4 py-3 text-right">Comprobante</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-stone-200/80 dark:divide-stone-800">
                    {pendingOrders.length === 0 ? (
                      <tr>
                        <td
                          colSpan={7}
                          className="px-6 py-8 text-center text-stone-500 dark:text-stone-400"
                        >
                          No hay órdenes de pago pendientes en este momento.
                        </td>
                      </tr>
                    ) : (
                      pendingOrders.map((o) => {
                        const badge = getPlatformBadgeMeta(o.plataforma_esperada);
                        return (
                          <tr key={o.id} className="transition hover:bg-[#FAF9F6] dark:hover:bg-stone-900/50">
                            <td className="px-4 py-3 font-mono text-xs font-semibold text-stone-900 dark:text-stone-100">
                              {o.codigo_orden}
                            </td>
                            <td className="px-4 py-3 font-medium text-stone-900 dark:text-stone-100">
                              {o.cliente_nombre}
                            </td>
                            <td className="px-4 py-3 text-stone-600 dark:text-stone-300">
                              {o.remitente_reportado || o.nombre_remitente_reportado}
                            </td>
                            <td className="px-4 py-3">
                              <span
                                className={`inline-flex rounded border px-2 py-0.5 text-[11px] font-medium ${badge.badgeClass}`}
                              >
                                {badge.label}
                              </span>
                            </td>
                            <td className="px-4 py-3 font-mono text-xs text-stone-600 dark:text-stone-400">
                              {o.referencia_reportada ?? 'SIN-REF'}
                            </td>
                            <td className="px-4 py-3 text-right font-mono font-semibold tabular-nums text-stone-900 dark:text-stone-100">
                              {formatMoney(o.monto_esperado, o.moneda)}
                            </td>
                            <td className="px-4 py-3 text-right">
                              <div className="flex items-center justify-end gap-1.5">
                                {o.has_capture || o.comprobante_base64 ? (
                                  <button
                                    type="button"
                                    onClick={() => void openLightboxForOrder(o)}
                                    className="inline-flex items-center gap-1 rounded-md border border-stone-200 bg-[#FAF9F6] px-2.5 py-1 text-xs font-medium text-stone-700 hover:bg-stone-100 cursor-pointer dark:border-stone-800 dark:bg-[#121110] dark:text-stone-200"
                                  >
                                    <Eye className="h-3.5 w-3.5 text-stone-400" strokeWidth={1.5} />
                                    Ver Captura
                                  </button>
                                ) : (
                                  <span className="text-xs text-stone-400">
                                    Sin imagen
                                  </span>
                                )}
                                <button
                                  type="button"
                                  onClick={() => openManualOrderConfirmModal(o)}
                                  className="inline-flex items-center gap-1 rounded-md bg-stone-900 px-2.5 py-1 text-xs font-medium text-stone-50 hover:bg-stone-800 cursor-pointer dark:bg-stone-100 dark:text-stone-950 dark:hover:bg-white"
                                >
                                  <CheckCircle2 className="h-3.5 w-3.5" strokeWidth={1.5} />
                                  Confirmar
                                </button>
                                <button
                                  type="button"
                                  disabled={isRejectingOrderId === o.id}
                                  onClick={() => void handleRejectPendingOrder(o)}
                                  className="inline-flex items-center gap-1 rounded-md border border-rose-700/25 bg-rose-50 px-2.5 py-1 text-xs font-medium text-rose-700 hover:bg-rose-100 disabled:opacity-50 cursor-pointer dark:border-rose-500/35 dark:bg-rose-950/40 dark:text-rose-400"
                                >
                                  <Trash2 className="h-3.5 w-3.5" strokeWidth={1.5} />
                                  Descartar
                                </button>
                              </div>
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* =====================================================================
            PESTAÑA 4: GESTIÓN DE LIQUIDACIONES Y PAGOS A CLIENTES O TERCEROS
           ===================================================================== */}
        {activeTab === 'LIQUIDATIONS' && (
          <div className="space-y-5">
            {/* Cabecera y Métricas de Liquidación */}
            <div className="flex flex-col justify-between gap-4 rounded-xl border border-stone-200/90 bg-white p-5 shadow-sm sm:flex-row sm:items-center dark:border-stone-800 dark:bg-[#1C1A18]">
              <div>
                <div className="flex items-center gap-2">
                  <Coins className="h-5 w-5 text-stone-400 dark:text-stone-500" strokeWidth={1.5} />
                  <h2 className="font-serif text-lg font-medium tracking-tight text-stone-900 dark:text-stone-100">
                    Liquidaciones y Pagos Realizados
                  </h2>
                </div>
                <p className="mt-1 text-xs text-stone-500 dark:text-stone-400">
                  Registra liquidaciones parciales, totales o adelantos sobre saldos acreditados a clientes o terceros, con deducción y cierre de ciclo.
                </p>
              </div>

              <button
                type="button"
                onClick={() => openLiquidationModal()}
                className="inline-flex items-center gap-1.5 rounded-lg bg-stone-900 px-4 py-2 text-xs font-medium text-stone-50 shadow-sm transition hover:bg-stone-800 dark:bg-stone-100 dark:text-stone-950 dark:hover:bg-white"
              >
                <Plus className="h-4 w-4" strokeWidth={1.5} />
                Registrar Liquidación
              </button>
            </div>

            {/* Tarjetas de Métricas de Liquidación */}
            <div className="grid grid-cols-1 divide-y divide-stone-200 rounded-xl border border-stone-200/90 bg-white shadow-sm sm:grid-cols-3 sm:divide-x sm:divide-y-0 dark:divide-stone-800 dark:border-stone-800 dark:bg-[#1C1A18]">
              <div className="p-4 sm:px-5">
                <span className="text-[11px] font-medium uppercase tracking-wider text-stone-500 dark:text-stone-400">
                  Total Liquidado USD
                </span>
                <p className="mt-1.5 font-mono text-2xl font-semibold tracking-tight tabular-nums text-stone-900 dark:text-stone-100">
                  {formatMoney(totalLiquidadoUsd, 'USD')}
                </p>
                <span className="text-[11px] text-stone-500 dark:text-stone-400">
                  Salidas pagadas en Zelle / Bancario / Efectivo
                </span>
              </div>

              <div className="p-4 sm:px-5">
                <span className="text-[11px] font-medium uppercase tracking-wider text-stone-500 dark:text-stone-400">
                  Total Liquidado USDT
                </span>
                <p className="mt-1.5 font-mono text-2xl font-semibold tracking-tight tabular-nums text-stone-900 dark:text-stone-100">
                  {formatMoney(totalLiquidadoUsdt, 'USDT')}
                </p>
                <span className="text-[11px] text-stone-500 dark:text-stone-400">
                  Salidas Binance Pay / P2P / On-Chain
                </span>
              </div>

              <div className="p-4 sm:px-5">
                <span className="text-[11px] font-medium uppercase tracking-wider text-stone-500 dark:text-stone-400">
                  Operaciones de Liquidación
                </span>
                <p className="mt-1.5 font-mono text-2xl font-semibold tracking-tight tabular-nums text-stone-900 dark:text-stone-100">
                  {liquidations.length}
                </p>
                <span className="text-[11px] text-stone-500 dark:text-stone-400">
                  Liquidaciones registradas con deducción de saldo
                </span>
              </div>
            </div>

            {/* Barra de Filtros */}
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-stone-200/90 bg-white p-3.5 shadow-sm dark:border-stone-800 dark:bg-[#1C1A18]">
              <div className="relative min-w-[240px] flex-1">
                <Search className="absolute left-3 top-2.5 h-4 w-4 text-stone-400" strokeWidth={1.5} />
                <input
                  type="text"
                  value={liqSearch}
                  onChange={(e) => setLiqSearch(e.target.value)}
                  placeholder="Buscar por código, cliente, destinatario o motivo..."
                  className="w-full rounded-lg border border-stone-200 bg-[#FAF9F6] py-2 pl-9 pr-4 text-xs text-stone-900 placeholder-stone-400 focus:border-amber-700 focus:outline-none dark:border-stone-800 dark:bg-[#121110] dark:text-stone-100 dark:placeholder-stone-500 dark:focus:border-amber-500"
                />
              </div>

              <div className="flex items-center gap-2">
                <span className="text-xs text-stone-500 dark:text-stone-400">Método:</span>
                <select
                  value={liqMethodFilter}
                  onChange={(e) => setLiqMethodFilter(e.target.value)}
                  className="rounded-lg border border-stone-200 bg-[#FAF9F6] px-3 py-1.5 text-xs text-stone-800 focus:border-amber-700 focus:outline-none dark:border-stone-800 dark:bg-[#121110] dark:text-stone-200 dark:focus:border-amber-500"
                >
                  <option value="TODOS">Todos los Métodos</option>
                  <option value="ZELLE">Zelle</option>
                  <option value="PAGO_MOVIL">Pago Móvil</option>
                  <option value="BINANCE_USDT">Binance USDT</option>
                  <option value="TRANSFERENCIA_BANCARIA">Transferencia Bancaria</option>
                  <option value="EFECTIVO">Efectivo</option>
                  <option value="OTRO">Otro</option>
                </select>
              </div>
            </div>

            {/* Tabla de Liquidaciones */}
            <div className="overflow-hidden rounded-xl border border-stone-200/90 bg-white shadow-sm dark:border-stone-800 dark:bg-[#1C1A18]">
              <div className="border-b border-stone-200 bg-[#FAF9F6] px-5 py-3 dark:border-stone-800 dark:bg-[#121110]">
                <h3 className="text-xs font-medium uppercase tracking-wider text-stone-500 dark:text-stone-400">
                  Historial de Liquidaciones ({filteredLiquidations.length})
                </h3>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full border-collapse text-left text-sm table-auto">
                  <thead>
                    <tr className="border-b border-stone-200 bg-[#FAF9F6]/60 text-[11px] font-medium uppercase tracking-wider text-stone-500 dark:border-stone-800 dark:bg-[#121110]/60 dark:text-stone-400">
                      <th className="px-4 py-3">Código &amp; Fecha</th>
                      <th className="px-4 py-3">Cliente Titular</th>
                      <th className="px-4 py-3">Destinatario</th>
                      <th className="px-4 py-3">Motivo / Concepto</th>
                      <th className="px-4 py-3">Método &amp; Ref.</th>
                      <th className="px-4 py-3 text-right">Totales del Ciclo</th>
                      <th className="px-4 py-3 text-right">Liquidado</th>
                      <th className="px-4 py-3 text-right">Saldo Antes → Después</th>
                      <th className="px-4 py-3 text-center">Operador</th>
                      <th className="px-4 py-3 text-right">Archivo</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-stone-200/80 dark:divide-stone-800">
                    {filteredLiquidations.length === 0 ? (
                      <tr>
                        <td
                          colSpan={10}
                          className="px-6 py-12 text-center text-stone-500 dark:text-stone-400"
                        >
                          No se encontraron liquidaciones registradas. Haz clic en &quot;Registrar Liquidación&quot; para liquidar el saldo de un cliente.
                        </td>
                      </tr>
                    ) : (
                      filteredLiquidations.map((liq) => (
                        <tr key={liq.id} className="transition hover:bg-[#FAF9F6] dark:hover:bg-stone-900/50">
                          <td className="px-4 py-3.5 font-mono text-xs">
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
                              {new Date(liq.created_at).toLocaleString('es-ES', {
                                dateStyle: 'short',
                                timeStyle: 'short',
                              })}
                            </div>
                          </td>
                          <td className="px-4 py-3.5 font-semibold text-stone-900 dark:text-stone-100">
                            {liq.cliente_nombre}
                          </td>
                          <td className="px-4 py-3.5 text-xs font-medium text-stone-700 dark:text-stone-300">
                            {liq.destinatario_beneficiario}
                          </td>
                          <td className="max-w-xs truncate px-4 py-3.5 text-xs text-stone-600 dark:text-stone-400" title={liq.motivo_concepto}>
                            {liq.motivo_concepto}
                          </td>
                          <td className="px-4 py-3.5 text-xs">
                            <span className="inline-flex rounded border border-stone-200 bg-[#FAF9F6] px-2 py-0.5 text-[10px] font-medium text-stone-700 dark:border-stone-800 dark:bg-[#121110] dark:text-stone-300">
                              {liq.metodo_pago_salida}
                            </span>
                            {liq.referencia_salida && (
                              <div className="mt-1 font-mono text-[11px] text-stone-500 dark:text-stone-400">
                                Ref: {liq.referencia_salida}
                              </div>
                            )}
                          </td>
                          <td className="whitespace-nowrap px-4 py-3.5 text-right font-mono text-xs tabular-nums">
                            <div className="font-semibold text-stone-900 dark:text-stone-100">
                              Neto: {formatMoney(Number(liq.ciclo_neto_total ?? 0), liq.moneda)}
                            </div>
                            <div className="text-[10px] text-stone-500 dark:text-stone-400">
                              {Number(liq.ciclo_pagos_count ?? 0)} pagos · Bruto{' '}
                              {formatMoney(Number(liq.ciclo_bruto_total ?? 0), liq.moneda)} · Com -
                              {formatMoney(Number(liq.ciclo_comision_total ?? 0), liq.moneda)}
                            </div>
                          </td>
                          <td className="px-4 py-3.5 text-right font-mono text-sm font-semibold tabular-nums text-rose-700 dark:text-rose-400">
                            -{formatMoney(liq.monto_liquidado, liq.moneda)}
                          </td>
                          <td className="px-4 py-3.5 text-right font-mono text-xs tabular-nums">
                            <span className="text-stone-500 dark:text-stone-400">
                              {formatMoney(liq.saldo_anterior, liq.moneda)}
                            </span>{' '}
                            <span className="text-stone-400">→</span>{' '}
                            <span
                              className={`font-semibold ${
                                liq.saldo_restante < 0
                                  ? 'text-rose-700 dark:text-rose-400'
                                  : liq.saldo_restante > 0
                                    ? 'text-emerald-700 dark:text-emerald-400'
                                    : 'text-stone-900 dark:text-stone-100'
                              }`}
                            >
                              {formatMoney(liq.saldo_restante, liq.moneda)}
                            </span>
                          </td>
                          <td className="px-4 py-3.5 text-center text-xs text-stone-500 dark:text-stone-400">
                            {liq.liquidado_por || 'ADMIN'}
                          </td>
                          <td className="px-4 py-3.5 text-right">
                            <button
                              type="button"
                              onClick={() => void openAdminLiquidationDetail(liq)}
                              className="inline-flex items-center gap-1.5 rounded-lg border border-stone-200 bg-[#FAF9F6] px-2.5 py-1.5 text-[11px] font-medium text-stone-700 transition hover:bg-stone-100 cursor-pointer dark:border-stone-800 dark:bg-[#121110] dark:text-stone-200 dark:hover:bg-stone-900"
                            >
                              <ImageIcon className="h-3.5 w-3.5 text-stone-400" strokeWidth={1.5} />
                              Ver Pagos
                            </button>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Modal Auditoría de Ciclo Cerrado (Admin) */}
            <Dialog.Root
              open={inspectedLiquidation !== null}
              onOpenChange={(open) => {
                if (!open) {
                  setInspectedLiquidation(null);
                }
              }}
            >
              <Dialog.Portal>
                <Dialog.Overlay className="fixed inset-0 z-40 bg-stone-950/50 backdrop-blur-sm" />
                <Dialog.Content className="fixed left-1/2 top-1/2 z-40 flex max-h-[90vh] w-[95vw] max-w-6xl -translate-x-1/2 -translate-y-1/2 flex-col rounded-xl border border-stone-200/90 bg-white p-6 text-stone-900 shadow-2xl dark:border-stone-800 dark:bg-[#1C1A18] dark:text-stone-100">
                  <div className="flex flex-wrap items-start justify-between gap-3 border-b border-stone-200 pb-4 dark:border-stone-800">
                    <div>
                      <Dialog.Title className="flex items-center gap-2 font-serif text-xl font-medium tracking-tight text-stone-900 dark:text-stone-100">
                        <Coins className="h-5 w-5 text-stone-400" strokeWidth={1.5} />
                        {inspectedLiquidation?.numero_ciclo
                          ? `Ciclo #${inspectedLiquidation.numero_ciclo} · `
                          : 'Detalle del Ciclo Liquidado · '}
                        {inspectedLiquidation?.codigo_liquidacion} ({inspectedLiquidation?.cliente_nombre})
                      </Dialog.Title>
                      <Dialog.Description className="mt-1 text-xs text-stone-500 dark:text-stone-400">
                        Liquidado:{' '}
                        <strong className="font-mono text-rose-700 dark:text-rose-400">
                          -{inspectedLiquidation ? formatMoney(inspectedLiquidation.monto_liquidado, inspectedLiquidation.moneda) : ''}
                        </strong>{' '}
                        · Saldo Antes → Después:{' '}
                        <span className="font-mono text-stone-700 dark:text-stone-300">
                          {inspectedLiquidation ? formatMoney(inspectedLiquidation.saldo_anterior, inspectedLiquidation.moneda) : ''}
                        </span>{' '}
                        →{' '}
                        <strong
                          className={`font-mono ${
                            (inspectedLiquidation?.saldo_restante ?? 0) < 0
                              ? 'text-rose-700 dark:text-rose-400'
                              : 'text-emerald-700 dark:text-emerald-400'
                          }`}
                        >
                          {inspectedLiquidation ? formatMoney(inspectedLiquidation.saldo_restante, inspectedLiquidation.moneda) : ''}
                        </strong>
                      </Dialog.Description>
                    </div>
                    <Dialog.Close asChild>
                      <button
                        type="button"
                        className="rounded-lg p-1.5 text-stone-400 hover:bg-stone-100 hover:text-stone-700 cursor-pointer dark:hover:bg-stone-800 dark:hover:text-stone-200"
                      >
                        <X className="h-4 w-4" strokeWidth={1.5} />
                      </button>
                    </Dialog.Close>
                  </div>

                  {isLoadingAdminLiqItems ? (
                    <div className="flex items-center justify-center gap-2 py-16 text-sm text-stone-500 dark:text-stone-400">
                      <RefreshCw className="h-4 w-4 animate-spin" strokeWidth={1.5} />
                      Cargando pagos y capturas archivadas...
                    </div>
                  ) : adminLiqItemsError ? (
                    <div className="my-6 rounded-xl border border-rose-700/25 bg-rose-50 p-4 text-xs text-rose-700 dark:border-rose-500/35 dark:bg-rose-950/40 dark:text-rose-400">
                      {adminLiqItemsError}
                    </div>
                  ) : (
                    (() => {
                      const q = adminLiqSearch.trim().toLowerCase();
                      const filtered = q
                        ? adminLiqItems.filter(
                            (item) =>
                              item.codigo_orden.toLowerCase().includes(q) ||
                              (item.remitente_reportado || '').toLowerCase().includes(q) ||
                              (item.tx_remitente_correo || '').toLowerCase().includes(q) ||
                              (item.referencia_reportada || '').toLowerCase().includes(q) ||
                              (item.tx_referencia_correo || '').toLowerCase().includes(q)
                          )
                        : adminLiqItems;

                      return (
                        <div className="mt-4 flex min-h-0 flex-1 flex-col gap-3">
                          {adminLiqSummary && (
                            <div className="grid grid-cols-2 divide-y divide-stone-200 rounded-lg border border-stone-200 bg-[#FAF9F6] sm:grid-cols-4 sm:divide-x sm:divide-y-0 dark:divide-stone-800 dark:border-stone-800 dark:bg-[#121110]">
                              <div className="p-3">
                                <span className="text-[10px] font-medium uppercase tracking-wider text-stone-500 dark:text-stone-400">
                                  Pagos del Ciclo
                                </span>
                                <p className="mt-1 font-mono text-lg font-semibold tabular-nums text-stone-900 dark:text-stone-100">
                                  {adminLiqSummary.totalCount}
                                </p>
                                <span className="text-[11px] text-stone-500 dark:text-stone-400">
                                  {adminLiqSummary.portalCount} capturas · {adminLiqSummary.directCount} directos
                                </span>
                              </div>
                              <div className="p-3">
                                <span className="text-[10px] font-medium uppercase tracking-wider text-stone-500 dark:text-stone-400">
                                  Bruto Archivado
                                </span>
                                <p className="mt-1 font-mono text-lg font-semibold tabular-nums text-stone-900 dark:text-stone-100">
                                  {formatMoney(adminLiqSummary.totalBruto, inspectedLiquidation?.moneda ?? 'USD')}
                                </p>
                              </div>
                              <div className="p-3">
                                <span className="text-[10px] font-medium uppercase tracking-wider text-stone-500 dark:text-stone-400">
                                  Comisión Retenida
                                </span>
                                <p className="mt-1 font-mono text-lg font-semibold tabular-nums text-stone-900 dark:text-stone-100">
                                  -{formatMoney(adminLiqSummary.totalComision, inspectedLiquidation?.moneda ?? 'USD')}
                                </p>
                              </div>
                              <div className="p-3">
                                <span className="text-[10px] font-medium uppercase tracking-wider text-stone-500 dark:text-stone-400">
                                  Neto Acreditado
                                </span>
                                <p className="mt-1 font-mono text-lg font-semibold tabular-nums text-emerald-700 dark:text-emerald-400">
                                  {formatMoney(adminLiqSummary.totalNeto, inspectedLiquidation?.moneda ?? 'USD')}
                                </p>
                              </div>
                            </div>
                          )}

                          <div className="flex items-center justify-between gap-3">
                            <input
                              type="text"
                              value={adminLiqSearch}
                              onChange={(e) => setAdminLiqSearch(e.target.value)}
                              placeholder="Buscar por remitente, ORD-, referencia bancaria o reportada..."
                              className="w-full max-w-md rounded-lg border border-stone-200 bg-[#FAF9F6] px-3 py-2 text-xs text-stone-900 placeholder-stone-400 focus:border-amber-700 focus:outline-none dark:border-stone-800 dark:bg-[#121110] dark:text-stone-100 dark:placeholder-stone-500 dark:focus:border-amber-500"
                            />
                            <span className="font-mono text-xs tabular-nums text-stone-500 dark:text-stone-400">
                              Mostrando {filtered.length} de {adminLiqItems.length}
                            </span>
                          </div>

                          <div className="min-h-0 flex-1 overflow-auto rounded-lg border border-stone-200 dark:border-stone-800">
                            <table className="w-full border-collapse text-left text-xs">
                              <thead className="sticky top-0 z-10 border-b border-stone-200 bg-[#FAF9F6] text-[11px] font-medium uppercase tracking-wider text-stone-500 dark:border-stone-800 dark:bg-[#121110] dark:text-stone-400">
                                <tr>
                                  <th className="px-3 py-2.5">#</th>
                                  <th className="px-3 py-2.5">Orden &amp; Fecha</th>
                                  <th className="px-3 py-2.5">Remitente</th>
                                  <th className="px-3 py-2.5">Referencia</th>
                                  <th className="px-3 py-2.5 text-right">Bruto</th>
                                  <th className="px-3 py-2.5 text-right">Comisión</th>
                                  <th className="px-3 py-2.5 text-right">Neto</th>
                                  <th className="px-3 py-2.5 text-right">Captura</th>
                                </tr>
                              </thead>
                              <tbody className="divide-y divide-stone-200/80 bg-white dark:divide-stone-800 dark:bg-[#1C1A18]">
                                {filtered.length === 0 ? (
                                  <tr>
                                    <td colSpan={8} className="px-6 py-8 text-center text-stone-500 dark:text-stone-400">
                                      No se encontraron pagos en este ciclo con ese criterio.
                                    </td>
                                  </tr>
                                ) : (
                                  filtered.map((o, idx) => {
                                    const isDirect = o.origen_registro === 'ADMIN_DIRECTA';
                                    const b = Number(o.tx_monto_bruto ?? o.monto_esperado);
                                    const c = Number(o.tx_monto_comision ?? 0);
                                    const n = Number(o.tx_monto_neto ?? 0);
                                    return (
                                      <tr key={o.id} className="hover:bg-[#FAF9F6] dark:hover:bg-stone-900/50">
                                        <td className="px-3 py-2.5 font-mono tabular-nums text-stone-400">
                                          {idx + 1}
                                        </td>
                                        <td className="whitespace-nowrap px-3 py-2.5">
                                          <span className="font-mono font-semibold text-stone-900 dark:text-stone-100">
                                            {o.codigo_orden}
                                          </span>
                                          {isDirect && (
                                            <span className="ml-1.5 rounded border border-stone-300 bg-stone-100 px-1.5 py-0.5 text-[9px] font-medium uppercase text-stone-600 dark:border-stone-700 dark:bg-stone-800 dark:text-stone-300">
                                              Directa
                                            </span>
                                          )}
                                          <div className="font-mono text-[10px] tabular-nums text-stone-500 dark:text-stone-400">
                                            {formatDateTime(o.tx_fecha_correo ?? o.created_at)}
                                          </div>
                                        </td>
                                        <td className="px-3 py-2.5">
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
                                        <td className="whitespace-nowrap px-3 py-2.5 font-mono">
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
                                        <td className="whitespace-nowrap px-3 py-2.5 text-right font-mono tabular-nums text-stone-900 dark:text-stone-100">
                                          {formatMoney(b, o.moneda)}
                                        </td>
                                        <td className="whitespace-nowrap px-3 py-2.5 text-right font-mono tabular-nums text-stone-500 dark:text-stone-400">
                                          -{formatMoney(c, o.moneda)}
                                        </td>
                                        <td className="whitespace-nowrap px-3 py-2.5 text-right font-mono font-semibold tabular-nums text-emerald-700 dark:text-emerald-400">
                                          {formatMoney(n, o.moneda)}
                                        </td>
                                        <td className="whitespace-nowrap px-3 py-2.5 text-right">
                                          {o.has_capture || o.comprobante_base64 ? (
                                            <button
                                              type="button"
                                              onClick={() => void openLightboxForOrder(o)}
                                              className="inline-flex items-center gap-1 rounded-md border border-stone-200 bg-[#FAF9F6] px-2 py-1 text-[11px] font-medium text-stone-700 hover:bg-stone-100 cursor-pointer dark:border-stone-800 dark:bg-[#121110] dark:text-stone-200"
                                            >
                                              <ImageIcon className="h-3 w-3 text-stone-400" strokeWidth={1.5} />
                                              Ver Captura
                                            </button>
                                          ) : (
                                            <span className="text-[10px] text-stone-400">
                                              Sin captura
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
          </div>
        )}

        {/* =====================================================================
            PESTAÑA 5: CORREOS IMAP MONITOREADOS
           ===================================================================== */}
        {activeTab === 'MAILBOXES' && (
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
            <div className="rounded-xl border border-stone-200/90 bg-white p-6 shadow-sm lg:col-span-7 dark:border-stone-800 dark:bg-[#1C1A18]">
              <div className="flex items-center justify-between gap-2.5 border-b border-stone-200 pb-4 dark:border-stone-800">
                <div className="flex items-center gap-2.5">
                  <Mail className="h-5 w-5 text-stone-400 dark:text-stone-500" strokeWidth={1.5} />
                  <div>
                    <h2 className="font-serif text-lg font-medium tracking-tight text-stone-900 dark:text-stone-100">
                      {editingMailboxId
                        ? 'Editar Cuenta Receptora y Correo Monitoreado'
                        : 'Conectar Correo que Recibe Alertas (Zelle + Binance)'}
                    </h2>
                    <p className="text-xs text-stone-500 dark:text-stone-400">
                      Define el correo monitoreado, la cuenta exacta a la que envían el pago y su moneda (`USD` o `USDT`).
                    </p>
                  </div>
                </div>
                {editingMailboxId && (
                  <button
                    type="button"
                    onClick={resetMailboxForm}
                    className="rounded-lg border border-stone-200 px-3 py-1.5 text-xs font-medium text-stone-600 hover:bg-stone-100 dark:border-stone-800 dark:text-stone-300 dark:hover:bg-stone-900"
                  >
                    Cancelar edición
                  </button>
                )}
              </div>

              <form
                onSubmit={(e) => void handleSaveMailbox(e)}
                className="mt-5 space-y-4"
              >
                <div>
                  <span className="block text-[11px] font-medium uppercase tracking-wider text-stone-500 dark:text-stone-400">
                    Autocompletar Servidor según tu Correo
                  </span>
                  <div className="mt-2 flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        setMailboxHost('imap.gmail.com');
                        setMailboxPort('993');
                      }}
                      className="rounded-lg border border-stone-200 bg-[#FAF9F6] px-3 py-1.5 text-xs font-medium text-stone-700 transition hover:border-amber-700 dark:border-stone-800 dark:bg-[#121110] dark:text-stone-300 dark:hover:border-amber-500"
                    >
                      Gmail / Workspace (imap.gmail.com)
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setMailboxHost('outlook.office365.com');
                        setMailboxPort('993');
                      }}
                      className="rounded-lg border border-stone-200 bg-[#FAF9F6] px-3 py-1.5 text-xs font-medium text-stone-700 transition hover:border-amber-700 dark:border-stone-800 dark:bg-[#121110] dark:text-stone-300 dark:hover:border-amber-500"
                    >
                      Outlook / Office 365
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setMailboxHost('imap.secureserver.net');
                        setMailboxPort('993');
                      }}
                      className="rounded-lg border border-stone-200 bg-[#FAF9F6] px-3 py-1.5 text-xs font-medium text-stone-700 transition hover:border-amber-700 dark:border-stone-800 dark:bg-[#121110] dark:text-stone-300 dark:hover:border-amber-500"
                    >
                      GoDaddy Workspace
                    </button>
                  </div>
                </div>

                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <div>
                    <label className="block text-[11px] font-medium uppercase tracking-wider text-stone-500 dark:text-stone-400">
                      Nombre / Alias de la Cuenta
                    </label>
                    <input
                      type="text"
                      required
                      value={mailboxAlias}
                      onChange={(e) => setMailboxAlias(e.target.value)}
                      className="mt-1.5 w-full rounded-lg border border-stone-200 bg-[#FAF9F6] px-3 py-2 text-sm text-stone-900 focus:border-amber-700 focus:outline-none dark:border-stone-800 dark:bg-[#121110] dark:text-stone-100 dark:focus:border-amber-500"
                    />
                  </div>

                  <div>
                    <label className="block text-[11px] font-medium uppercase tracking-wider text-stone-500 dark:text-stone-400">
                      Canales Monitoreados
                    </label>
                    <select
                      value={mailboxBanks}
                      onChange={(e) => setMailboxBanks(e.target.value)}
                      className="mt-1.5 w-full rounded-lg border border-stone-200 bg-[#FAF9F6] px-3 py-2 text-sm text-stone-900 focus:border-amber-700 focus:outline-none dark:border-stone-800 dark:bg-[#121110] dark:text-stone-100 dark:focus:border-amber-500"
                    >
                      <option value="CITIBANK_TD_BINANCE">
                        Citibank, TD Bank y Binance (Todos)
                      </option>
                      <option value="CITIBANK_Y_TD_BANK">
                        Solo Citibank y TD Bank
                      </option>
                      <option value="SOLO_CITIBANK">Solo Citibank</option>
                      <option value="SOLO_BINANCE">Solo Binance</option>
                    </select>
                  </div>
                </div>

                <div className="rounded-xl border border-stone-200 bg-[#FAF9F6] p-3.5 dark:border-stone-800 dark:bg-[#121110]">
                  <div className="mb-2 text-[11px] font-medium uppercase tracking-wider text-amber-700 dark:text-amber-500">
                    Datos visibles para el cliente en el Portal (/portal)
                  </div>
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-12">
                    <div className="sm:col-span-4">
                      <label className="block text-[11px] font-medium uppercase text-stone-500 dark:text-stone-400">
                        Plataforma Principal
                      </label>
                      <select
                        value={mailboxPlatform}
                        onChange={(e) => {
                          const nextPlat = e.target
                            .value as ExpectedPlatformType;
                          setMailboxPlatform(nextPlat);
                          setMailboxCurrency(platformDefaultCurrency(nextPlat));
                        }}
                        className="mt-1 w-full rounded-lg border border-stone-200 bg-white px-2.5 py-2 text-xs text-stone-900 focus:border-amber-700 focus:outline-none dark:border-stone-800 dark:bg-[#1C1A18] dark:text-stone-100"
                      >
                        <option value="CITIBANK">Citibank Zelle</option>
                        <option value="TD_BANK">TD Bank Zelle</option>
                        <option value="BINANCE_PAY">Binance Pay</option>
                        <option value="BINANCE_P2P">Binance P2P</option>
                        <option value="BINANCE_ONCHAIN">
                          Binance On-Chain
                        </option>
                      </select>
                    </div>
                    <div className="sm:col-span-5">
                      <label className="block text-[11px] font-medium uppercase text-stone-500 dark:text-stone-400">
                        Cuenta a la que envían el pago
                      </label>
                      <input
                        type="text"
                        value={mailboxReceivingAccount}
                        onChange={(e) =>
                          setMailboxReceivingAccount(e.target.value)
                        }
                        placeholder={
                          mailboxEmail || 'Ej. pagos@empresa.com o Pay ID'
                        }
                        className="mt-1 w-full rounded-lg border border-stone-200 bg-white px-2.5 py-2 font-mono text-xs text-stone-900 focus:border-amber-700 focus:outline-none dark:border-stone-800 dark:bg-[#1C1A18] dark:text-stone-100"
                      />
                    </div>
                    <div className="sm:col-span-3">
                      <label className="block text-[11px] font-medium uppercase text-stone-500 dark:text-stone-400">
                        Moneda
                      </label>
                      <select
                        value={mailboxCurrency}
                        onChange={(e) =>
                          setMailboxCurrency(e.target.value as CurrencyType)
                        }
                        className="mt-1 w-full rounded-lg border border-stone-200 bg-white px-2.5 py-2 font-mono text-xs text-stone-900 focus:border-amber-700 focus:outline-none dark:border-stone-800 dark:bg-[#1C1A18] dark:text-stone-100"
                      >
                        <option value="USD">USD</option>
                        <option value="USDT">USDT</option>
                        <option value="VES">VES</option>
                      </select>
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <div>
                    <label className="block text-[11px] font-medium uppercase tracking-wider text-stone-500 dark:text-stone-400">
                      Correo Electrónico a Monitorear
                    </label>
                    <input
                      type="email"
                      required
                      value={mailboxEmail}
                      onChange={(e) => {
                        const val = e.target.value;
                        setMailboxEmail(val);
                        if (!mailboxReceivingAccount) {
                          setMailboxReceivingAccount(val);
                        }
                      }}
                      placeholder="alertas-fintech@gmail.com"
                      className="mt-1.5 w-full rounded-lg border border-stone-200 bg-[#FAF9F6] px-3 py-2 text-sm text-stone-900 focus:border-amber-700 focus:outline-none dark:border-stone-800 dark:bg-[#121110] dark:text-stone-100"
                    />
                  </div>

                  <div>
                    <label className="block text-[11px] font-medium uppercase tracking-wider text-stone-500 dark:text-stone-400">
                      Contraseña IMAP / App Password{' '}
                      {editingMailboxId ? '(Opcional)' : ''}
                    </label>
                    <div className="relative mt-1.5">
                      <KeyRound className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-stone-400" strokeWidth={1.5} />
                      <input
                        type="password"
                        required={!editingMailboxId}
                        value={mailboxPassword}
                        onChange={(e) => setMailboxPassword(e.target.value)}
                        placeholder={
                          editingMailboxId
                            ? 'Dejar vacío para mantener contraseña actual'
                            : 'xxxx xxxx xxxx xxxx'
                        }
                        className="w-full rounded-lg border border-stone-200 bg-[#FAF9F6] py-2 pl-9 pr-3 font-mono text-sm text-stone-900 focus:border-amber-700 focus:outline-none dark:border-stone-800 dark:bg-[#121110] dark:text-stone-100"
                      />
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                  <div>
                    <label className="block text-[11px] font-medium uppercase tracking-wider text-stone-500 dark:text-stone-400">
                      Servidor IMAP
                    </label>
                    <div className="relative mt-1.5">
                      <Server className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-stone-400" strokeWidth={1.5} />
                      <input
                        type="text"
                        required
                        value={mailboxHost}
                        onChange={(e) => setMailboxHost(e.target.value)}
                        className="w-full rounded-lg border border-stone-200 bg-[#FAF9F6] py-2 pl-9 pr-3 font-mono text-xs text-stone-900 focus:border-amber-700 focus:outline-none dark:border-stone-800 dark:bg-[#121110] dark:text-stone-100"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="block text-[11px] font-medium uppercase tracking-wider text-stone-500 dark:text-stone-400">
                      Puerto SSL
                    </label>
                    <input
                      type="number"
                      required
                      value={mailboxPort}
                      onChange={(e) => setMailboxPort(e.target.value)}
                      className="mt-1.5 w-full rounded-lg border border-stone-200 bg-[#FAF9F6] px-3 py-2 font-mono text-xs text-stone-900 focus:border-amber-700 focus:outline-none dark:border-stone-800 dark:bg-[#121110] dark:text-stone-100"
                    />
                  </div>

                  <div>
                    <label className="block text-[11px] font-medium uppercase tracking-wider text-stone-500 dark:text-stone-400">
                      Carpeta
                    </label>
                    <input
                      type="text"
                      required
                      value={mailboxFolder}
                      onChange={(e) => setMailboxFolder(e.target.value)}
                      className="mt-1.5 w-full rounded-lg border border-stone-200 bg-[#FAF9F6] px-3 py-2 font-mono text-xs text-stone-900 focus:border-amber-700 focus:outline-none dark:border-stone-800 dark:bg-[#121110] dark:text-stone-100"
                    />
                  </div>
                </div>

                <label className="flex items-center gap-2 pt-1 text-xs text-stone-600 dark:text-stone-400">
                  <input
                    type="checkbox"
                    checked={verifyImapBeforeSave}
                    onChange={(e) => setVerifyImapBeforeSave(e.target.checked)}
                    className="h-4 w-4 rounded border-stone-300 text-stone-900 dark:border-stone-700 dark:bg-stone-900"
                  />
                  Probar conexión IMAP en vivo antes de guardar (recomendado)
                </label>

                <div className="pt-2">
                  <button
                    type="submit"
                    disabled={isSavingMailbox}
                    className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-stone-900 px-5 py-2.5 text-sm font-medium text-stone-50 shadow-sm transition hover:bg-stone-800 disabled:opacity-60 dark:bg-stone-100 dark:text-stone-950 dark:hover:bg-white"
                  >
                    {isSavingMailbox ? (
                      <Loader2 className="h-4 w-4 animate-spin" strokeWidth={1.5} />
                    ) : editingMailboxId ? (
                      <Pencil className="h-4 w-4" strokeWidth={1.5} />
                    ) : (
                      <Plus className="h-4 w-4" strokeWidth={1.5} />
                    )}
                    {editingMailboxId
                      ? 'Guardar Cambios de la Cuenta Receptora'
                      : 'Guardar y Conectar Correo IMAP'}
                  </button>
                </div>
              </form>
            </div>

            <div className="space-y-5 lg:col-span-5">
              <div className="rounded-xl border border-stone-200/90 bg-white p-5 shadow-sm dark:border-stone-800 dark:bg-[#1C1A18]">
                <h3 className="text-xs font-medium uppercase tracking-wider text-stone-500 dark:text-stone-400">
                  Correos Activos Monitoreados ({mailboxes.length})
                </h3>

                {mailboxes.length === 0 ? (
                  <p className="mt-3 text-xs text-stone-500 dark:text-stone-400">
                    Todavía no hay ningún buzón IMAP conectado.
                  </p>
                ) : (
                  <div className="mt-4 space-y-3">
                    {mailboxes.map((mb) => {
                      const plat = mb.plataforma ?? 'CITIBANK';
                      const curr = mb.moneda ?? platformDefaultCurrency(plat);
                      const dest = mb.cuenta_receptora || mb.email_address;
                      const badge = getPlatformBadgeMeta(plat);

                      return (
                        <div
                          key={mb.id}
                          className="flex items-start justify-between gap-2 rounded-lg border border-stone-200/80 bg-[#FAF9F6] p-3.5 dark:border-stone-800 dark:bg-[#121110]"
                        >
                          <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="h-2 w-2 rounded-full bg-emerald-700 dark:bg-emerald-400" />
                              <span className="font-medium text-stone-900 dark:text-stone-100">
                                {mb.email_address}
                              </span>
                              <span
                                className={`inline-flex rounded border px-1.5 py-0.5 text-[10px] font-medium ${badge.badgeClass}`}
                              >
                                {badge.label}
                              </span>
                              <span className="rounded bg-stone-200/80 px-1.5 py-0.5 font-mono text-[10px] font-medium text-stone-700 dark:bg-stone-800 dark:text-stone-300">
                                {curr}
                              </span>
                            </div>
                            <p className="mt-1 text-xs text-stone-600 dark:text-stone-400">
                              Enviar a:{' '}
                              <span className="font-mono font-semibold text-stone-900 dark:text-stone-100">
                                {dest}
                              </span>
                            </p>
                            <p className="mt-0.5 text-xs text-stone-500 dark:text-stone-400">
                              {mb.alias} · {mb.imap_host}:{mb.imap_port} (
                              {mb.mailbox_folder})
                            </p>
                            <p className="mt-1 text-[11px] text-emerald-700 dark:text-emerald-400">
                              Estado: {mb.last_sync_status ?? 'Listo'} · Última
                              vez: {formatDateTime(mb.last_sync_at)}
                            </p>
                          </div>
                          <div className="flex items-center gap-1">
                            <button
                              type="button"
                              onClick={() => openEditMailbox(mb)}
                              className="inline-flex items-center gap-1 rounded-md border border-stone-200 bg-white px-2 py-1 text-[11px] font-medium text-stone-700 hover:bg-stone-100 dark:border-stone-800 dark:bg-[#1C1A18] dark:text-stone-200"
                              title="Editar Cuenta / Moneda"
                            >
                              <Pencil className="h-3 w-3 text-stone-400" strokeWidth={1.5} />
                              Editar
                            </button>
                            <button
                              type="button"
                              onClick={() => void handleDeleteMailbox(mb.id)}
                              className="rounded-md p-1.5 text-stone-400 hover:bg-rose-50 hover:text-rose-700 dark:hover:bg-rose-950/40 dark:hover:text-rose-400"
                              title="Eliminar buzón"
                            >
                              <Trash2 className="h-4 w-4" strokeWidth={1.5} />
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              <div className="rounded-xl border border-stone-200/90 bg-white p-5 shadow-sm dark:border-stone-800 dark:bg-[#1C1A18]">
                <div className="flex items-center gap-2 text-stone-900 dark:text-stone-100">
                  <HelpCircle className="h-4 w-4 text-amber-700 dark:text-amber-500" strokeWidth={1.5} />
                  <h3 className="text-sm font-semibold">
                    Idempotencia Cruzada (Binance API + Email)
                  </h3>
                </div>
                <ol className="mt-3 list-decimal space-y-2 pl-4 text-xs leading-relaxed text-stone-600 dark:text-stone-400">
                  <li>
                    <strong className="text-stone-800 dark:text-stone-200">Correos Oficiales Soportados:</strong> Citibank (`@citibank.com`), TD Bank (`@tdbank.com` / `@td.com`) y Binance (`@binance.com`, `@directmail.binance.com`).
                  </li>
                  <li>
                    <strong className="text-stone-800 dark:text-stone-200">Binance API Oficial:</strong> Configura{' '}
                    <code className="font-mono">BINANCE_API_KEY</code> y{' '}
                    <code className="font-mono">BINANCE_API_SECRET</code> en <code className="font-mono">.env</code> para consultar Pay, P2P y Depósitos On-Chain en paralelo.
                  </li>
                  <li>
                    <strong className="text-stone-800 dark:text-stone-200">Cero Duplicados:</strong> Ambos canales generan la misma llave{' '}
                    <code className="font-mono">dedup_key</code> (<code className="font-mono">PLATAFORMA:REFERENCIA:MONTO</code>) con{' '}
                    <code className="font-mono">ON CONFLICT DO NOTHING</code>.
                  </li>
                </ol>
              </div>
            </div>
          </div>
        )}

        {/* =====================================================================
            PESTAÑA 6: USUARIOS Y CUENTAS PARA DISTINTOS NEGOCIOS
           ===================================================================== */}
        {activeTab === 'BUSINESS_USERS' &&
          currentBusinessUser.rol === 'SUPER_ADMIN' && (
            <div className="space-y-5">
              <div className="flex flex-col justify-between gap-4 rounded-xl border border-stone-200/90 bg-white p-5 shadow-sm sm:flex-row sm:items-center dark:border-stone-800 dark:bg-[#1C1A18]">
                <div>
                  <h2 className="font-serif text-lg font-medium tracking-tight text-stone-900 dark:text-stone-100">
                    Cuentas de Acceso para Distintos Negocios
                  </h2>
                  <p className="mt-1 text-xs text-stone-500 dark:text-stone-400">
                    Crea usuarios independientes para cada negocio o comercio. Cada negocio inicia sesión en el panel con sus propios buzones IMAP, clientes y movimientos aislados.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={openCreateBusinessUserModal}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-stone-900 px-4 py-2 text-xs font-medium text-stone-50 shadow-sm transition hover:bg-stone-800 dark:bg-stone-100 dark:text-stone-950 dark:hover:bg-white"
                >
                  <Plus className="h-4 w-4" strokeWidth={1.5} />
                  Nueva Cuenta de Negocio
                </button>
              </div>

              {lastBusinessCredentials && (
                <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-emerald-700/20 bg-emerald-50 px-4 py-3 text-xs text-emerald-900 dark:border-emerald-500/30 dark:bg-emerald-950/30 dark:text-emerald-300">
                  <div>
                    <strong>
                      Última cuenta creada ({lastBusinessCredentials.negocio}):
                    </strong>{' '}
                    Correo <code className="font-mono font-semibold">{lastBusinessCredentials.email}</code>
                    {lastBusinessCredentials.password && (
                      <>
                        {' '}
                        · Contraseña{' '}
                        <code className="font-mono font-semibold">
                          {lastBusinessCredentials.password}
                        </code>
                      </>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={() =>
                      void handleCopyBusinessCredentials(lastBusinessCredentials)
                    }
                    className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-700/30 bg-white px-3 py-1.5 font-medium text-emerald-800 hover:bg-emerald-50 dark:border-emerald-500/40 dark:bg-[#1C1A18] dark:text-emerald-300"
                  >
                    <Copy className="h-3.5 w-3.5" strokeWidth={1.5} />
                    Copiar Acceso del Negocio
                  </button>
                </div>
              )}

              <div className="overflow-hidden rounded-xl border border-stone-200/90 bg-white shadow-sm dark:border-stone-800 dark:bg-[#1C1A18]">
                <div className="border-b border-stone-200 bg-[#FAF9F6] px-5 py-3 dark:border-stone-800 dark:bg-[#121110]">
                  <h3 className="text-xs font-medium uppercase tracking-wider text-stone-500 dark:text-stone-400">
                    Negocios Registrados ({businessUsers.length})
                  </h3>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full border-collapse text-left text-sm table-auto">
                    <thead>
                      <tr className="border-b border-stone-200 bg-[#FAF9F6]/60 text-[11px] font-medium uppercase tracking-wider text-stone-500 dark:border-stone-800 dark:bg-[#121110]/60 dark:text-stone-400">
                        <th className="px-4 py-3">Negocio / Empresa</th>
                        <th className="px-4 py-3">Usuario &amp; Correo Login</th>
                        <th className="px-4 py-3">Rol</th>
                        <th className="px-4 py-3">Entorno Aislado</th>
                        <th className="px-4 py-3">Último Ingreso</th>
                        <th className="px-4 py-3 text-right">Acciones</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-stone-200/80 dark:divide-stone-800">
                      {businessUsers.map((biz) => {
                        const isActiveScope = activeNegocioId === biz.id;
                        return (
                          <tr key={biz.id} className="transition hover:bg-[#FAF9F6] dark:hover:bg-stone-900/50">
                            <td className="px-4 py-3.5">
                              <div className="flex items-center gap-2 font-semibold text-stone-900 dark:text-stone-100">
                                <Briefcase className="h-4 w-4 text-stone-400" strokeWidth={1.5} />
                                {biz.nombre_negocio}
                                {isActiveScope && (
                                  <span className="rounded-full border border-emerald-700/20 bg-emerald-50 px-2 py-0.5 text-[10px] font-medium text-emerald-700 dark:border-emerald-500/30 dark:bg-emerald-950/40 dark:text-emerald-400">
                                    Viendo ahora
                                  </span>
                                )}
                              </div>
                            </td>
                            <td className="px-4 py-3.5 text-xs text-stone-600 dark:text-stone-300">
                              <div className="font-medium text-stone-900 dark:text-stone-100">
                                {biz.nombre_usuario}
                              </div>
                              <div className="font-mono text-[11px] text-stone-500 dark:text-stone-400">
                                {biz.email}
                              </div>
                              {biz.telefono && (
                                <div className="text-[11px] text-stone-400">
                                  {biz.telefono}
                                </div>
                              )}
                            </td>
                            <td className="px-4 py-3.5">
                              <span
                                className={`inline-flex rounded-full border px-2 py-0.5 text-[10px] font-medium ${
                                  biz.rol === 'SUPER_ADMIN'
                                    ? 'border-amber-700/25 bg-amber-50 text-amber-800 dark:border-amber-500/35 dark:bg-amber-950/40 dark:text-amber-400'
                                    : 'border-stone-200 bg-[#FAF9F6] text-stone-700 dark:border-stone-800 dark:bg-[#121110] dark:text-stone-300'
                                }`}
                              >
                                {biz.rol === 'SUPER_ADMIN'
                                  ? 'SUPER ADMIN'
                                  : 'NEGOCIO'}
                              </span>
                            </td>
                            <td className="px-4 py-3.5 font-mono text-xs tabular-nums text-stone-600 dark:text-stone-400">
                              {biz.mailboxes_count ?? 0} correo(s) ·{' '}
                              {biz.clients_count ?? 0} cliente(s) ·{' '}
                              {biz.transactions_count ?? 0} mov.
                            </td>
                            <td className="px-4 py-3.5 font-mono text-xs tabular-nums text-stone-500 dark:text-stone-400">
                              {biz.last_login_at
                                ? formatDateTime(biz.last_login_at)
                                : 'Sin ingresos aún'}
                            </td>
                            <td className="whitespace-nowrap px-4 py-3.5 text-right">
                              <div className="flex items-center justify-end gap-1.5">
                                {!isActiveScope && (
                                  <button
                                    type="button"
                                    onClick={() => {
                                      handleSwitchBusinessScope(biz.id);
                                      setActiveTab('ALERTS');
                                    }}
                                    className="inline-flex items-center gap-1 rounded-lg bg-stone-900 px-2.5 py-1.5 text-xs font-medium text-stone-50 hover:bg-stone-800 dark:bg-stone-100 dark:text-stone-950 dark:hover:bg-white"
                                  >
                                    Ver Panel
                                  </button>
                                )}
                                <button
                                  type="button"
                                  onClick={() => openEditBusinessUserModal(biz)}
                                  className="inline-flex items-center gap-1 rounded-lg border border-stone-200 bg-[#FAF9F6] px-2.5 py-1.5 text-xs font-medium text-stone-700 hover:bg-stone-100 dark:border-stone-800 dark:bg-[#121110] dark:text-stone-200"
                                >
                                  <KeyRound className="h-3 w-3 text-stone-400" strokeWidth={1.5} />
                                  Editar / Clave
                                </button>
                                {biz.rol !== 'SUPER_ADMIN' && (
                                  <button
                                    type="button"
                                    onClick={() =>
                                      void handleDeleteBusinessUser(
                                        biz.id,
                                        biz.nombre_negocio
                                      )
                                    }
                                    className="rounded-lg p-1.5 text-stone-400 hover:bg-rose-50 hover:text-rose-700 dark:hover:bg-rose-950/40 dark:hover:text-rose-400"
                                    title="Eliminar negocio"
                                  >
                                    <Trash2 className="h-3.5 w-3.5" strokeWidth={1.5} />
                                  </button>
                                )}
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Tarjeta de Configuración de Motor IA / Visión OCR Multi-Proveedor */}
              <div className="space-y-4 rounded-xl border border-stone-200/90 bg-white p-5 shadow-sm dark:border-stone-800 dark:bg-[#1C1A18]">
                <div className="flex flex-wrap items-center justify-between gap-3 border-b border-stone-200 pb-3 dark:border-stone-800">
                  <div className="flex items-center gap-2.5">
                    <div className="flex h-9 w-9 items-center justify-center rounded-lg border border-stone-200 bg-[#FAF9F6] text-stone-500 dark:border-stone-800 dark:bg-[#121110] dark:text-stone-400">
                      <Bot className="h-5 w-5" strokeWidth={1.5} />
                    </div>
                    <div>
                      <h3 className="font-serif text-base font-medium text-stone-900 dark:text-stone-100">
                        Motor de Inteligencia Artificial (Visión OCR de Comprobantes)
                      </h3>
                      <p className="text-xs text-stone-500 dark:text-stone-400">
                        Compatible con Google Gemini, Groq Cloud u OpenAI. Lee capturas Zelle y Binance y rellena los campos automáticamente.
                      </p>
                    </div>
                  </div>
                  <div>
                    {aiSettings?.hasGeminiKey ? (
                      <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-700/20 bg-emerald-50 px-3 py-1 text-xs font-medium text-emerald-700 dark:border-emerald-500/30 dark:bg-emerald-950/40 dark:text-emerald-400">
                        <span className="h-1.5 w-1.5 rounded-full bg-emerald-700 dark:bg-emerald-400" />
                        Google Gemini Activo ({aiSettings.geminiModel ?? 'gemini-3.5-flash-lite'}) · {aiSettings.geminiKeyPreview}
                      </span>
                    ) : aiSettings?.hasGroqKey ? (
                      <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-700/20 bg-emerald-50 px-3 py-1 text-xs font-medium text-emerald-700 dark:border-emerald-500/30 dark:bg-emerald-950/40 dark:text-emerald-400">
                        <span className="h-1.5 w-1.5 rounded-full bg-emerald-700 dark:bg-emerald-400" />
                        Groq Vision Activo ({aiSettings.groqModel ?? 'llama-3.2'}) · {aiSettings.groqKeyPreview}
                      </span>
                    ) : aiSettings?.hasOpenAiKey ? (
                      <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-700/20 bg-emerald-50 px-3 py-1 text-xs font-medium text-emerald-700 dark:border-emerald-500/30 dark:bg-emerald-950/40 dark:text-emerald-400">
                        <span className="h-1.5 w-1.5 rounded-full bg-emerald-700 dark:bg-emerald-400" />
                        OpenAI Vision Activo ({aiSettings.openAiModel}) · {aiSettings.openAiKeyPreview}
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-700/25 bg-amber-50 px-3 py-1 text-xs font-medium text-amber-800 dark:border-amber-500/35 dark:bg-amber-950/40 dark:text-amber-400">
                        <AlertCircle className="h-3.5 w-3.5" strokeWidth={1.5} />
                        Sin API Key configurada (Modo Manual)
                      </span>
                    )}
                  </div>
                </div>

                <form
                  onSubmit={(e) => void handleSaveAiConfig(e)}
                  className="space-y-3"
                >
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-12">
                    <div className="sm:col-span-4">
                      <label className="mb-1.5 block text-[11px] font-medium uppercase tracking-wider text-stone-500 dark:text-stone-400">
                        Proveedor de Inteligencia Artificial
                      </label>
                      <select
                        value={selectedAiProvider}
                        onChange={(e) =>
                          setSelectedAiProvider(
                            e.target.value as 'gemini' | 'openai' | 'groq'
                          )
                        }
                        className="w-full rounded-lg border border-stone-200 bg-[#FAF9F6] px-3 py-2.5 text-xs font-medium text-stone-900 focus:border-amber-700 focus:outline-none dark:border-stone-800 dark:bg-[#121110] dark:text-stone-100"
                      >
                        <option value="gemini">
                          Google Gemini (Gratis - Recomendado)
                        </option>
                        <option value="groq">
                          Groq Cloud (Llama 3.2 Vision - Gratuito)
                        </option>
                        <option value="openai">
                          OpenAI (gpt-4o-mini - De Pago)
                        </option>
                      </select>
                    </div>

                    <div className="sm:col-span-5">
                      <div className="mb-1.5 flex items-center justify-between">
                        <label className="block text-[11px] font-medium uppercase tracking-wider text-stone-500 dark:text-stone-400">
                          {selectedAiProvider === 'gemini'
                            ? 'Clave de Google Gemini (AI Studio)'
                            : selectedAiProvider === 'groq'
                              ? 'Clave de Groq API (gsk_...)'
                              : 'Clave de OpenAI API (sk-proj-...)'}
                        </label>
                        <span className="font-mono text-[10px] text-stone-400">
                          {selectedAiProvider === 'gemini' ? 'AQ. o AIzaSy...' : selectedAiProvider === 'groq' ? 'gsk_...' : 'sk-...'}
                        </span>
                      </div>
                      <input
                        type="password"
                        value={openAiInputKey}
                        onChange={(e) => {
                          const val = e.target.value;
                          setOpenAiInputKey(val);
                          setVerifyFeedback(null);
                          const trimmed = val.trim();
                          if (trimmed.startsWith('AIzaSy') || trimmed.startsWith('AQ.')) {
                            setSelectedAiProvider('gemini');
                          } else if (trimmed.startsWith('gsk_')) {
                            setSelectedAiProvider('groq');
                          } else if (trimmed.startsWith('sk-')) {
                            setSelectedAiProvider('openai');
                          }
                        }}
                        placeholder={
                          selectedAiProvider === 'gemini'
                            ? aiSettings?.hasGeminiKey
                              ? `Actualizar clave Gemini (${aiSettings.geminiKeyPreview})`
                              : 'Pega tu clave AQ... o AIzaSy...'
                            : selectedAiProvider === 'groq'
                              ? aiSettings?.hasGroqKey
                                ? `Actualizar clave Groq (${aiSettings.groqKeyPreview})`
                                : 'Pega tu clave gsk_...'
                              : aiSettings?.hasOpenAiKey
                                ? `Actualizar clave OpenAI (${aiSettings.openAiKeyPreview})`
                                : 'Pega tu clave sk-proj-...'
                        }
                        className="w-full rounded-lg border border-stone-200 bg-[#FAF9F6] px-3.5 py-2.5 text-xs text-stone-900 placeholder-stone-400 focus:border-amber-700 focus:outline-none dark:border-stone-800 dark:bg-[#121110] dark:text-stone-100 dark:placeholder-stone-500"
                      />
                    </div>

                    <div className="flex items-end gap-2 sm:col-span-3">
                      <button
                        type="button"
                        onClick={() => void handleVerifyAiKey()}
                        disabled={isVerifyingAiConfig || isSavingAiConfig || !openAiInputKey.trim()}
                        className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-stone-200 bg-[#FAF9F6] px-3 py-2.5 text-xs font-medium text-stone-800 hover:bg-stone-100 disabled:opacity-50 dark:border-stone-800 dark:bg-[#121110] dark:text-stone-200 dark:hover:bg-stone-900"
                      >
                        {isVerifyingAiConfig ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={1.5} />
                        ) : (
                          <CheckCircle2 className="h-3.5 w-3.5 text-stone-400" strokeWidth={1.5} />
                        )}
                        Probar
                      </button>
                      <button
                        type="submit"
                        disabled={isSavingAiConfig || isVerifyingAiConfig || !openAiInputKey.trim()}
                        className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-stone-900 px-3 py-2.5 text-xs font-medium text-stone-50 hover:bg-stone-800 disabled:opacity-50 dark:bg-stone-100 dark:text-stone-950 dark:hover:bg-white"
                      >
                        {isSavingAiConfig ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={1.5} />
                        ) : (
                          <Sparkles className="h-3.5 w-3.5" strokeWidth={1.5} />
                        )}
                        Guardar
                      </button>
                    </div>
                  </div>

                  {/* Feedback de verificación en vivo */}
                  {verifyFeedback && (
                    <div
                      className={`flex items-center gap-2 rounded-lg border px-3.5 py-2 text-xs ${
                        verifyFeedback.ok
                          ? 'border-emerald-700/20 bg-emerald-50 text-emerald-800 dark:border-emerald-500/30 dark:bg-emerald-950/40 dark:text-emerald-300'
                          : 'border-rose-700/25 bg-rose-50 text-rose-700 dark:border-rose-500/35 dark:bg-rose-950/40 dark:text-rose-400'
                      }`}
                    >
                      {verifyFeedback.ok ? (
                        <CheckCircle2 className="h-4 w-4 shrink-0" strokeWidth={1.5} />
                      ) : (
                        <AlertTriangle className="h-4 w-4 shrink-0" strokeWidth={1.5} />
                      )}
                      <span>{verifyFeedback.message}</span>
                    </div>
                  )}

                  {/* Enlaces de ayuda */}
                  <div className="flex flex-wrap items-center gap-3 pt-1 text-[11px] text-stone-500 dark:text-stone-400">
                    <span className="font-medium text-stone-700 dark:text-stone-300">¿No tienes clave?</span>
                    {selectedAiProvider === 'gemini' && (
                      <a
                        href="https://aistudio.google.com/app/apikey"
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1 font-medium text-amber-700 underline underline-offset-4 dark:text-amber-500"
                      >
                        <ExternalLink className="h-3 w-3" strokeWidth={1.5} />
                        Obtener API Key en Google AI Studio
                      </a>
                    )}
                    {selectedAiProvider === 'groq' && (
                      <a
                        href="https://console.groq.com/keys"
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1 font-medium text-amber-700 underline underline-offset-4 dark:text-amber-500"
                      >
                        <ExternalLink className="h-3 w-3" strokeWidth={1.5} />
                        Obtener API Key en Groq Cloud
                      </a>
                    )}
                    {selectedAiProvider === 'openai' && (
                      <a
                        href="https://platform.openai.com/api-keys"
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1 font-medium text-amber-700 underline underline-offset-4 dark:text-amber-500"
                      >
                        <ExternalLink className="h-3 w-3" strokeWidth={1.5} />
                        Crear API Key en OpenAI Platform
                      </a>
                    )}
                  </div>
                </form>
              </div>
            </div>
          )}

        {/* =====================================================================
            MODAL LIGHTBOX: VISOR DE CAPTURA LADO A LADO CON DATOS EXTRAÍDOS
           ===================================================================== */}
        <Dialog.Root
          open={lightboxData !== null}
          onOpenChange={(open) => {
            if (!open) {
              setLightboxData(null);
            }
          }}
        >
          <Dialog.Portal>
            <Dialog.Overlay className="fixed inset-0 z-40 bg-stone-950/50 backdrop-blur-sm" />
            <Dialog.Content className="fixed left-1/2 top-1/2 z-50 max-h-[92vh] w-[95vw] max-w-5xl -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-xl border border-stone-200/90 bg-white p-6 text-stone-900 shadow-2xl dark:border-stone-800 dark:bg-[#1C1A18] dark:text-stone-100">
              <div className="flex items-start justify-between border-b border-stone-200 pb-4 dark:border-stone-800">
                <div>
                  <Dialog.Title className="font-serif text-xl font-medium tracking-tight text-stone-900 dark:text-stone-100">
                    {lightboxData?.title}
                  </Dialog.Title>
                  <Dialog.Description className="mt-1 text-xs text-stone-500 dark:text-stone-400">
                    Comparativa visual entre el comprobante subido por el cliente y los datos extraídos por el motor bancario / Binance API.
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

              {lightboxData && (() => {
                const reportedSenderName =
                  lightboxData.order?.remitente_reportado ||
                  lightboxData.order?.nombre_remitente_reportado ||
                  '';
                const channelSenderName =
                  lightboxData.tx?.remitente_o_contraparte || '';
                const orderReference =
                  lightboxData.order?.referencia_reportada || '';
                const channelReference =
                  lightboxData.tx?.referencia || '';

                const isReferenceMatched = referencesMatch(
                  orderReference,
                  channelReference
                );
                const senderSimilarityScore =
                  reportedSenderName && channelSenderName
                    ? calculateSenderSimilarity(
                        reportedSenderName,
                        channelSenderName
                      )
                    : 1;

                const hasCriticalDisparity = Boolean(
                  lightboxData.order &&
                    lightboxData.tx &&
                    !isReferenceMatched &&
                    senderSimilarityScore < 0.4
                );

                const legitimateMatchingTx = hasCriticalDisparity
                  ? alerts.find(
                      (a) =>
                        a.tipo_movimiento === 'RECIBIDO' &&
                        a.id !== lightboxData.tx?.id &&
                        Math.abs(
                          a.monto_bruto -
                            (lightboxData.order?.monto_esperado ?? 0)
                        ) < 0.01 &&
                        (referencesMatch(orderReference, a.referencia) ||
                          calculateSenderSimilarity(
                            reportedSenderName,
                            a.remitente_o_contraparte || ''
                          ) >= 0.38)
                    ) ?? null
                  : null;

                return (
                  <div className="mt-5 grid grid-cols-1 gap-6 lg:grid-cols-12">
                    {/* Lado Izquierdo: Captura Subida */}
                    <div className="space-y-3 lg:col-span-6">
                      <div className="flex items-center justify-between text-[11px] font-medium uppercase tracking-wider text-stone-500 dark:text-stone-400">
                        <span>Comprobante Subido en Portal</span>
                        {lightboxData.order?.codigo_orden && (
                          <span className="font-mono text-stone-700 dark:text-stone-300">
                            {lightboxData.order.codigo_orden}
                          </span>
                        )}
                      </div>
                      <div className="flex min-h-[340px] items-center justify-center rounded-xl border border-stone-200 bg-[#FAF9F6] p-3 dark:border-stone-800 dark:bg-[#121110]">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={lightboxData.comprobanteBase64}
                          alt="Captura del cliente"
                          className="max-h-[480px] w-auto rounded-lg object-contain"
                        />
                      </div>
                      {lightboxData.order?.datos_ocr_extraidos && (
                        <div className="rounded-xl border border-stone-200 bg-[#FAF9F6] p-3 text-xs dark:border-stone-800 dark:bg-[#121110]">
                          <div className="font-medium text-stone-800 dark:text-stone-200">
                            Validación OCR / Metadatos:
                          </div>
                          <div className="mt-1 text-stone-500 dark:text-stone-400">
                            {lightboxData.order.datos_ocr_extraidos.observaciones ??
                              `Detectado: ${lightboxData.order.datos_ocr_extraidos.monto_detectado ?? ''} ${lightboxData.order.datos_ocr_extraidos.moneda_detectada ?? ''} · Ref: ${lightboxData.order.datos_ocr_extraidos.referencia_detectada ?? 'N/A'}`}
                          </div>
                        </div>
                      )}
                    </div>

                    {/* Lado Derecho: Comparativa de Datos */}
                    <div className="flex flex-col justify-between space-y-4 lg:col-span-6">
                      <div className="space-y-4">
                        {hasCriticalDisparity && (
                          <div className="rounded-xl border border-rose-700/30 bg-rose-50 p-4 text-xs dark:border-rose-500/40 dark:bg-rose-950/35">
                            <div className="flex items-start gap-3">
                              <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-rose-700 dark:text-rose-400" strokeWidth={1.5} />
                              <div className="space-y-1.5">
                                <p className="font-semibold text-rose-800 dark:text-rose-300">
                                  ALERTA DE DISPARIDAD CRÍTICA DE REMITENTE (Similitud: {Math.round(senderSimilarityScore * 100)}%)
                                </p>
                                <p className="text-stone-700 dark:text-stone-300">
                                  El nombre reportado por el cliente en el comprobante (<strong className="text-amber-800 dark:text-amber-400">&quot;{reportedSenderName}&quot;</strong>)
                                  no coincide con el remitente extraído del correo bancario (<strong className="text-stone-900 dark:text-stone-100">&quot;{channelSenderName}&quot;</strong>),
                                  y las referencias (<span className="font-mono">{orderReference || 'SIN-REF'}</span> vs <span className="font-mono">{channelReference}</span>) no concuerdan.
                                </p>
                                <p className="font-medium text-rose-700 dark:text-rose-400">
                                  Precaución: No concilie esta fila a ciegas para evitar cruces indebidos de dinero entre personas distintas.
                                </p>

                                {legitimateMatchingTx && (
                                  <div className="mt-3 rounded-lg border border-emerald-700/25 bg-white p-3 dark:border-emerald-500/35 dark:bg-[#1C1A18]">
                                    <div className="flex flex-col gap-2.5 sm:flex-row sm:items-center sm:justify-between">
                                      <div>
                                        <p className="font-semibold text-emerald-700 dark:text-emerald-400">
                                          Transacción Bancaria Legítima Encontrada:
                                        </p>
                                        <p className="mt-0.5 text-stone-700 dark:text-stone-300">
                                          <strong>{legitimateMatchingTx.remitente_o_contraparte}</strong> ·{' '}
                                          <span className="font-mono font-semibold text-emerald-700 dark:text-emerald-400">{formatMoney(legitimateMatchingTx.monto_bruto, legitimateMatchingTx.moneda)}</span> ·{' '}
                                          <span className="font-mono text-stone-500">Ref: {legitimateMatchingTx.referencia}</span> ({legitimateMatchingTx.estado})
                                        </p>
                                      </div>
                                      <button
                                        type="button"
                                        onClick={() => {
                                          setLightboxData((prev) => (prev ? { ...prev, tx: legitimateMatchingTx } : null));
                                        }}
                                        className="inline-flex shrink-0 items-center gap-1 rounded-md bg-stone-900 px-3 py-1.5 text-xs font-medium text-stone-50 transition hover:bg-stone-800 cursor-pointer dark:bg-stone-100 dark:text-stone-950"
                                      >
                                        <CheckCircle2 className="h-3.5 w-3.5" strokeWidth={1.5} />
                                        Ver Pago Coincidente
                                      </button>
                                    </div>
                                  </div>
                                )}
                              </div>
                            </div>
                          </div>
                        )}

                        {lightboxData.order && (
                        <div className="rounded-xl border border-stone-200 bg-[#FAF9F6] p-4 dark:border-stone-800 dark:bg-[#121110]">
                          <h4 className="text-[11px] font-medium uppercase tracking-wider text-amber-700 dark:text-amber-500">
                            Datos Reportados por el Cliente
                          </h4>
                          <dl className="mt-3 grid grid-cols-2 gap-3 text-xs">
                            <div>
                              <dt className="text-stone-500 dark:text-stone-400">Cliente Titular</dt>
                              <dd className="mt-0.5 font-semibold text-stone-900 dark:text-stone-100">
                                {lightboxData.order.cliente_nombre}
                              </dd>
                            </div>
                            <div>
                              <dt className="text-stone-500 dark:text-stone-400">Canal Esperado</dt>
                              <dd className="mt-0.5 font-semibold text-stone-900 dark:text-stone-100">
                                {lightboxData.order.plataforma_esperada}
                              </dd>
                            </div>
                            <div>
                              <dt className="text-stone-500 dark:text-stone-400">Monto Reportado</dt>
                              <dd className="mt-0.5 font-mono font-semibold tabular-nums text-emerald-700 dark:text-emerald-400">
                                {formatMoney(
                                  lightboxData.order.monto_esperado,
                                  lightboxData.order.moneda
                                )}
                              </dd>
                            </div>
                            <div>
                              <dt className="text-stone-500 dark:text-stone-400">Referencia Reportada</dt>
                              <dd className="mt-0.5 font-mono text-stone-900 dark:text-stone-100">
                                {lightboxData.order.referencia_reportada}
                              </dd>
                            </div>
                            <div className="col-span-2">
                              <dt className="text-stone-500 dark:text-stone-400">Remitente Reportado</dt>
                              <dd className="mt-0.5 font-semibold text-stone-900 dark:text-stone-100">
                                {lightboxData.order.remitente_reportado ||
                                  lightboxData.order.nombre_remitente_reportado}
                              </dd>
                            </div>
                            {lightboxData.order.fecha_transferencia && (
                              <div className="col-span-2">
                                <dt className="text-stone-500 dark:text-stone-400">Fecha de Transferencia (Comprobante)</dt>
                                <dd className="mt-0.5 font-mono font-medium tabular-nums text-stone-900 dark:text-stone-100">
                                  {lightboxData.order.fecha_transferencia}
                                </dd>
                              </div>
                            )}
                          </dl>
                        </div>
                      )}

                      {lightboxData.tx ? (
                        <div className="rounded-xl border border-stone-200 bg-[#FAF9F6] p-4 dark:border-stone-800 dark:bg-[#121110]">
                          <h4 className="text-[11px] font-medium uppercase tracking-wider text-emerald-700 dark:text-emerald-400">
                            Datos Extraídos del Canal ({lightboxData.tx.origen_deteccion})
                          </h4>
                          <dl className="mt-3 grid grid-cols-2 gap-3 text-xs">
                            <div>
                              <dt className="text-stone-500 dark:text-stone-400">Plataforma Real</dt>
                              <dd className="mt-0.5 font-semibold text-stone-900 dark:text-stone-100">
                                {lightboxData.tx.plataforma}
                              </dd>
                            </div>
                            <div>
                              <dt className="text-stone-500 dark:text-stone-400">Estado Actual</dt>
                              <dd className="mt-0.5 font-semibold text-amber-700 dark:text-amber-400">
                                {lightboxData.tx.estado}
                              </dd>
                            </div>
                            <div>
                              <dt className="text-stone-500 dark:text-stone-400">Monto Bruto Real</dt>
                              <dd className="mt-0.5 font-mono font-semibold tabular-nums text-stone-900 dark:text-stone-100">
                                {formatMoney(
                                  lightboxData.tx.monto_bruto,
                                  lightboxData.tx.moneda
                                )}
                              </dd>
                            </div>
                            <div>
                              <dt className="text-stone-500 dark:text-stone-400">Referencia Real</dt>
                              <dd className="mt-0.5 font-mono font-semibold text-emerald-700 dark:text-emerald-400">
                                {lightboxData.tx.referencia}
                              </dd>
                            </div>
                            <div className="col-span-2">
                              <dt className="text-stone-500 dark:text-stone-400">
                                Remitente / Contraparte Real
                              </dt>
                              <dd className="mt-0.5 font-semibold text-stone-900 dark:text-stone-100">
                                {lightboxData.tx.remitente_o_contraparte}
                              </dd>
                            </div>
                            <div className="col-span-2">
                              <dt className="text-stone-500 dark:text-stone-400">Dedup Key</dt>
                              <dd className="mt-0.5 break-all font-mono text-[11px] text-stone-500 dark:text-stone-400">
                                {lightboxData.tx.dedup_key}
                              </dd>
                            </div>
                          </dl>
                          {lightboxData.tx.nota_auditoria && (
                            <p className="mt-3 rounded-lg border border-stone-200 bg-white p-2.5 text-xs text-stone-600 dark:border-stone-800 dark:bg-[#1C1A18] dark:text-stone-300">
                              {lightboxData.tx.nota_auditoria}
                            </p>
                          )}
                        </div>
                      ) : (
                        <div className="rounded-xl border border-stone-200 bg-[#FAF9F6] p-4 text-xs text-stone-500 dark:border-stone-800 dark:bg-[#121110] dark:text-stone-400">
                          Aún no ha ingresado una transacción bancaria o de Binance que coincida con esta orden pendiente.
                        </div>
                      )}
                    </div>

                    <div className="flex flex-wrap justify-end gap-2.5 border-t border-stone-200 pt-4 dark:border-stone-800">
                      <Dialog.Close asChild>
                        <button
                          type="button"
                          className="rounded-lg border border-stone-200 px-4 py-2 text-xs font-medium text-stone-700 hover:bg-stone-100 dark:border-stone-800 dark:text-stone-300 dark:hover:bg-stone-900"
                        >
                          Cerrar Visor
                        </button>
                      </Dialog.Close>
                      {!lightboxData.tx &&
                        lightboxData.order &&
                        lightboxData.order.estado === 'PENDIENTE' && (
                          <>
                            <button
                              type="button"
                              onClick={() => {
                                const targetOrder = lightboxData.order;
                                setLightboxData(null);
                                if (targetOrder) {
                                  void handleRejectPendingOrder(targetOrder);
                                }
                              }}
                              className="inline-flex items-center gap-1.5 rounded-lg border border-rose-700/25 bg-rose-50 px-4 py-2 text-xs font-medium text-rose-700 hover:bg-rose-100 cursor-pointer dark:border-rose-500/35 dark:bg-rose-950/40 dark:text-rose-400"
                            >
                              <Trash2 className="h-3.5 w-3.5" strokeWidth={1.5} />
                              Descartar Orden
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                const targetOrder = lightboxData.order;
                                setLightboxData(null);
                                if (targetOrder) {
                                  openManualOrderConfirmModal(targetOrder);
                                }
                              }}
                              className="inline-flex items-center gap-1.5 rounded-lg bg-stone-900 px-4 py-2 text-xs font-medium text-stone-50 hover:bg-stone-800 cursor-pointer dark:bg-stone-100 dark:text-stone-950 dark:hover:bg-white"
                            >
                              <CheckCircle2 className="h-3.5 w-3.5" strokeWidth={1.5} />
                              Confirmar Manualmente (Sin Correo)
                            </button>
                          </>
                        )}

                      {lightboxData.tx &&
                        lightboxData.tx.estado !== 'CONCILIADO' &&
                        lightboxData.tx.tipo_movimiento === 'RECIBIDO' && (
                          <button
                            type="button"
                            onClick={() => {
                              const targetTx = lightboxData.tx;
                              const targetOrder = lightboxData.order;
                              setLightboxData(null);
                              if (targetTx) {
                                openManualReconciliationModal(
                                  targetTx,
                                  targetOrder
                                );
                              }
                            }}
                            className="inline-flex items-center gap-1.5 rounded-lg bg-stone-900 px-4 py-2 text-xs font-medium text-stone-50 hover:bg-stone-800 dark:bg-stone-100 dark:text-stone-950 dark:hover:bg-white"
                          >
                            <UserCheck className="h-3.5 w-3.5" strokeWidth={1.5} />
                            Conciliar Manualmente
                          </button>
                        )}

                      {lightboxData.tx &&
                        lightboxData.tx.estado === 'CONCILIADO' &&
                        !lightboxData.tx.liquidado_at && (
                          <button
                            type="button"
                            onClick={() => {
                              const targetTx = lightboxData.tx;
                              setLightboxData(null);
                              if (targetTx) {
                                setAlertToRevert(targetTx);
                                setRevertReason('');
                              }
                            }}
                            className="inline-flex items-center gap-1.5 rounded-lg border border-rose-700/25 bg-rose-50 px-4 py-2 text-xs font-medium text-rose-700 hover:bg-rose-100 dark:border-rose-500/35 dark:bg-rose-950/40 dark:text-rose-400"
                          >
                            <RotateCcw className="h-3.5 w-3.5" strokeWidth={1.5} />
                            Deshacer Conciliación
                          </button>
                        )}
                    </div>
                  </div>
                </div>
                );
              })()}
            </Dialog.Content>
          </Dialog.Portal>
        </Dialog.Root>

        {/* =====================================================================
            MODAL: CONFIRMACIÓN MANUAL DE CAPTURA ENVIADA POR EL CLIENTE (SIN CORREO)
           ===================================================================== */}
        <Dialog.Root
          open={selectedOrderForManualConfirm !== null}
          onOpenChange={(open) => {
            if (!open) {
              setSelectedOrderForManualConfirm(null);
            }
          }}
        >
          <Dialog.Portal>
            <Dialog.Overlay className="fixed inset-0 z-40 bg-stone-950/50 backdrop-blur-sm" />
            <Dialog.Content className="fixed left-1/2 top-1/2 z-50 w-[95vw] max-w-xl -translate-x-1/2 -translate-y-1/2 rounded-xl border border-stone-200/90 bg-white p-6 text-stone-900 shadow-2xl dark:border-stone-800 dark:bg-[#1C1A18] dark:text-stone-100">
              <div className="flex items-start justify-between border-b border-stone-200 pb-4 dark:border-stone-800">
                <div>
                  <Dialog.Title className="font-serif text-xl font-medium tracking-tight text-stone-900 dark:text-stone-100">
                    Confirmar Manualmente Captura del Cliente
                  </Dialog.Title>
                  <Dialog.Description className="mt-1 text-xs text-stone-500 dark:text-stone-400">
                    Aprueba y acredita esta orden enviada desde el portal aunque no haya llegado el correo del banco, o vincúlala con un correo DETECTADO.
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

              {selectedOrderForManualConfirm && (() => {
                const clientObj = clients.find(
                  (c) =>
                    c.id === selectedOrderForManualConfirm.cliente_id ||
                    c.nombre_titular.trim().toLowerCase() ===
                      (selectedOrderForManualConfirm.cliente_nombre || '').trim().toLowerCase()
                );
                const feePct = (
                  selectedOrderForManualConfirm.plataforma_esperada || 'CITIBANK'
                ).startsWith('BINANCE')
                  ? (clientObj?.porcentaje_comision_binance ?? 1.5)
                  : (clientObj?.porcentaje_comision_zelle ?? 4.0);
                const comision =
                  Math.round(
                    selectedOrderForManualConfirm.monto_esperado * (feePct / 100) * 100
                  ) / 100;
                const neto =
                  Math.round(
                    (selectedOrderForManualConfirm.monto_esperado - comision) * 100
                  ) / 100;

                const alreadyReconciledTx = alerts.find(
                  (a) =>
                    a.estado === 'CONCILIADO' &&
                    referencesMatch(
                      selectedOrderForManualConfirm.referencia_reportada,
                      a.referencia
                    )
                );

                const availableUnreconciledTxs = alerts.filter(
                  (a) =>
                    a.estado !== 'CONCILIADO' &&
                    a.tipo_movimiento === 'RECIBIDO' &&
                    a.moneda === selectedOrderForManualConfirm.moneda
                );

                return (
                  <form
                    onSubmit={(e) => void handleConfirmOrderManually(e)}
                    className="mt-5 space-y-4"
                  >
                    {alreadyReconciledTx && (
                      <div className="rounded-xl border border-rose-700/25 bg-rose-50 p-3.5 text-xs text-rose-800 dark:border-rose-500/35 dark:bg-rose-950/40 dark:text-rose-300">
                        <div className="flex items-start gap-2.5">
                          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-rose-700 dark:text-rose-400" strokeWidth={1.5} />
                          <div>
                            <p className="font-semibold">
                              Atención: Referencia ya conciliada previamente
                            </p>
                            <p className="mt-0.5 text-stone-700 dark:text-stone-300">
                              La referencia <strong className="font-mono">{selectedOrderForManualConfirm.referencia_reportada}</strong> ya fue conciliada y acreditada en el pago de <strong>{alreadyReconciledTx.remitente_o_contraparte}</strong> ({formatMoney(alreadyReconciledTx.monto_bruto, alreadyReconciledTx.moneda)} · Ref: <span className="font-mono">{alreadyReconciledTx.referencia}</span>). Si esta captura es repetida, usa <strong>&quot;Descartar&quot;</strong> para no acreditar el saldo dos veces.
                            </p>
                          </div>
                        </div>
                      </div>
                    )}

                    <div className="space-y-2.5 rounded-xl border border-stone-200 bg-[#FAF9F6] p-4 text-xs dark:border-stone-800 dark:bg-[#121110]">
                      <div className="flex items-center justify-between">
                        <span className="text-stone-500 dark:text-stone-400">
                          Orden:{' '}
                          <strong className="font-mono text-stone-900 dark:text-stone-100">
                            {selectedOrderForManualConfirm.codigo_orden}
                          </strong>
                        </span>
                        <span className="text-stone-500 dark:text-stone-400">
                          Cliente Titular:{' '}
                          <strong className="text-emerald-700 dark:text-emerald-400">
                            {selectedOrderForManualConfirm.cliente_nombre}
                          </strong>
                        </span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-stone-500 dark:text-stone-400">
                          Remitente Reportado:{' '}
                          <strong className="text-stone-900 dark:text-stone-100">
                            {selectedOrderForManualConfirm.remitente_reportado ||
                              selectedOrderForManualConfirm.nombre_remitente_reportado}
                          </strong>
                        </span>
                        <span className="text-stone-500 dark:text-stone-400">
                          Ref:{' '}
                          <strong className="font-mono text-amber-700 dark:text-amber-400">
                            {selectedOrderForManualConfirm.referencia_reportada || 'SIN-REF'}
                          </strong>
                        </span>
                      </div>

                      <div className="grid grid-cols-3 divide-x divide-stone-200 border-t border-stone-200 pt-3 text-center dark:divide-stone-800 dark:border-stone-800">
                        <div>
                          <span className="block text-[10px] uppercase tracking-wider text-stone-500">
                            Monto Bruto
                          </span>
                          <span className="font-mono text-sm font-semibold tabular-nums text-stone-900 dark:text-stone-100">
                            {formatMoney(
                              selectedOrderForManualConfirm.monto_esperado,
                              selectedOrderForManualConfirm.moneda
                            )}
                          </span>
                        </div>
                        <div>
                          <span className="block text-[10px] uppercase tracking-wider text-stone-500">
                            Comisión ({feePct}%)
                          </span>
                          <span className="font-mono text-sm font-semibold tabular-nums text-stone-700 dark:text-stone-300">
                            -{formatMoney(comision, selectedOrderForManualConfirm.moneda)}
                          </span>
                        </div>
                        <div>
                          <span className="block text-[10px] uppercase tracking-wider text-emerald-700 dark:text-emerald-400">
                            Neto a Acreditar
                          </span>
                          <span className="font-mono text-sm font-semibold tabular-nums text-emerald-700 dark:text-emerald-400">
                            {formatMoney(neto, selectedOrderForManualConfirm.moneda)}
                          </span>
                        </div>
                      </div>
                    </div>

                    <div>
                      <label className="block text-[11px] font-medium uppercase tracking-wider text-stone-500 dark:text-stone-400">
                        Modo de Confirmación
                      </label>
                      <select
                        value={orderConfirmLinkedTxId}
                        onChange={(e) => setOrderConfirmLinkedTxId(e.target.value)}
                        className="mt-1.5 w-full rounded-lg border border-stone-200 bg-[#FAF9F6] px-3 py-2.5 text-xs text-stone-900 focus:border-amber-700 focus:outline-none dark:border-stone-800 dark:bg-[#121110] dark:text-stone-100"
                      >
                        <option value="">
                          Acreditar directamente sin correo del banco (Confirmación Manual por Captura)
                        </option>
                        {availableUnreconciledTxs.map((tx) => {
                          const isSameAmt =
                            Math.abs(
                              tx.monto_bruto -
                                selectedOrderForManualConfirm.monto_esperado
                            ) < 0.01;
                          return (
                            <option key={tx.id} value={tx.id}>
                              {isSameAmt ? '[MISMO MONTO] ' : ''}
                              Vincular con correo DETECTADO: {tx.remitente_o_contraparte} ·{' '}
                              {formatMoney(tx.monto_bruto, tx.moneda)} · Ref: {tx.referencia} (
                              {formatDateTime(tx.fecha_transaccion)})
                            </option>
                          );
                        })}
                      </select>
                    </div>

                    <div>
                      <label className="block text-[11px] font-medium uppercase tracking-wider text-stone-500 dark:text-stone-400">
                        Nota de Auditoría
                      </label>
                      <textarea
                        rows={2}
                        value={orderConfirmNotes}
                        onChange={(e) => setOrderConfirmNotes(e.target.value)}
                        className="mt-1.5 w-full rounded-lg border border-stone-200 bg-[#FAF9F6] px-3 py-2 text-xs text-stone-900 focus:border-amber-700 focus:outline-none dark:border-stone-800 dark:bg-[#121110] dark:text-stone-100"
                      />
                    </div>

                    <div className="flex items-center justify-end gap-3 border-t border-stone-200 pt-4 dark:border-stone-800">
                      <Dialog.Close asChild>
                        <button
                          type="button"
                          className="rounded-lg border border-stone-200 px-4 py-2 text-xs font-medium text-stone-700 hover:bg-stone-100 dark:border-stone-800 dark:text-stone-300 dark:hover:bg-stone-900"
                        >
                          Cancelar
                        </button>
                      </Dialog.Close>
                      <button
                        type="submit"
                        disabled={isSubmittingOrderConfirm}
                        className="inline-flex items-center gap-2 rounded-lg bg-stone-900 px-5 py-2 text-xs font-medium text-stone-50 hover:bg-stone-800 disabled:opacity-60 cursor-pointer dark:bg-stone-100 dark:text-stone-950 dark:hover:bg-white"
                      >
                        {isSubmittingOrderConfirm ? (
                          <Loader2 className="h-4 w-4 animate-spin" strokeWidth={1.5} />
                        ) : (
                          <CheckCircle2 className="h-4 w-4" strokeWidth={1.5} />
                        )}
                        Confirmar y Acreditar ({formatMoney(neto, selectedOrderForManualConfirm.moneda)})
                      </button>
                    </div>
                  </form>
                );
              })()}
            </Dialog.Content>
          </Dialog.Portal>
        </Dialog.Root>

        {/* =====================================================================
            MODAL: CREAR / EDITAR CUENTA DE ACCESO DE CLIENTE
           ===================================================================== */}
        <Dialog.Root
          open={isNewClientModalOpen}
          onOpenChange={(open) => {
            setIsNewClientModalOpen(open);
            if (!open) {
              setEditingClientId(null);
            }
          }}
        >
          <Dialog.Portal>
            <Dialog.Overlay className="fixed inset-0 z-40 bg-stone-950/50 backdrop-blur-sm" />
            <Dialog.Content className="fixed left-1/2 top-1/2 z-50 max-h-[90vh] w-[95vw] max-w-2xl -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-xl border border-stone-200/90 bg-white p-6 text-stone-900 shadow-2xl dark:border-stone-800 dark:bg-[#1C1A18] dark:text-stone-100">
              <div className="flex items-start justify-between border-b border-stone-200 pb-4 dark:border-stone-800">
                <div>
                  <Dialog.Title className="font-serif text-xl font-medium tracking-tight text-stone-900 dark:text-stone-100">
                    {editingClientId
                      ? 'Editar Cuenta y PIN de Acceso'
                      : 'Crear Cuenta de Acceso al Portal'}
                  </Dialog.Title>
                  <Dialog.Description className="mt-1 text-xs text-stone-500 dark:text-stone-400">
                    Define el correo, el PIN de ingreso en /portal, los porcentajes de comisión y las cuentas receptoras asignadas a este cliente.
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

              <form
                onSubmit={(e) => void handleCreateClient(e)}
                className="mt-4 space-y-4"
              >
                <div>
                  <label className="block text-[11px] font-medium uppercase tracking-wider text-stone-500 dark:text-stone-400">
                    Nombre del Cliente / Titular *
                  </label>
                  <input
                    type="text"
                    required
                    value={newClientName}
                    onChange={(e) => setNewClientName(e.target.value)}
                    placeholder="Ej. ALEJANDRO JOSE PEREZ"
                    className="mt-1.5 w-full rounded-lg border border-stone-200 bg-[#FAF9F6] px-3 py-2 text-sm text-stone-900 focus:border-amber-700 focus:outline-none dark:border-stone-800 dark:bg-[#121110] dark:text-stone-100"
                  />
                </div>

                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div>
                    <label className="block text-[11px] font-medium uppercase tracking-wider text-stone-500 dark:text-stone-400">
                      Correo de Acceso al Portal *
                    </label>
                    <input
                      type="email"
                      required
                      value={newClientEmail}
                      onChange={(e) => setNewClientEmail(e.target.value)}
                      placeholder="cliente@correo.com"
                      className="mt-1.5 w-full rounded-lg border border-stone-200 bg-[#FAF9F6] px-3 py-2 text-sm text-stone-900 focus:border-amber-700 focus:outline-none dark:border-stone-800 dark:bg-[#121110] dark:text-stone-100"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-medium uppercase tracking-wider text-stone-500 dark:text-stone-400">
                      WhatsApp / Teléfono
                    </label>
                    <input
                      type="text"
                      value={newClientPhone}
                      onChange={(e) => setNewClientPhone(e.target.value)}
                      placeholder="+1 305..."
                      className="mt-1.5 w-full rounded-lg border border-stone-200 bg-[#FAF9F6] px-3 py-2 text-sm text-stone-900 focus:border-amber-700 focus:outline-none dark:border-stone-800 dark:bg-[#121110] dark:text-stone-100"
                    />
                  </div>
                </div>

                <div>
                  <div className="flex items-center justify-between">
                    <label className="block text-[11px] font-medium uppercase tracking-wider text-stone-500 dark:text-stone-400">
                      PIN de Acceso (4 a 6 dígitos) {editingClientId ? '(Opcional al editar)' : '*'}
                    </label>
                    <button
                      type="button"
                      onClick={handleGenerateRandomPin}
                      className="text-[11px] font-medium text-amber-700 hover:underline dark:text-amber-500"
                    >
                      Generar PIN aleatorio
                    </button>
                  </div>
                  <input
                    type="text"
                    inputMode="numeric"
                    pattern="\d{4,6}"
                    maxLength={6}
                    required={!editingClientId}
                    value={newClientPin}
                    onChange={(e) => setNewClientPin(e.target.value)}
                    placeholder={
                      editingClientId
                        ? 'Dejar vacío para mantener PIN actual'
                        : 'Ej. 4829'
                    }
                    className="mt-1.5 w-full rounded-lg border border-stone-200 bg-[#FAF9F6] px-3 py-2 font-mono text-sm tracking-widest text-stone-900 focus:border-amber-700 focus:outline-none dark:border-stone-800 dark:bg-[#121110] dark:text-stone-100"
                  />
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[11px] font-medium uppercase tracking-wider text-stone-500 dark:text-stone-400">
                      Comisión Zelle (%)
                    </label>
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      max="100"
                      required
                      value={newClientFeeZelle}
                      onChange={(e) => setNewClientFeeZelle(e.target.value)}
                      className="mt-1.5 w-full rounded-lg border border-stone-200 bg-[#FAF9F6] px-3 py-2 font-mono text-sm text-stone-900 focus:border-amber-700 focus:outline-none dark:border-stone-800 dark:bg-[#121110] dark:text-stone-100"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-medium uppercase tracking-wider text-stone-500 dark:text-stone-400">
                      Comisión Binance (%)
                    </label>
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      max="100"
                      required
                      value={newClientFeeBinance}
                      onChange={(e) => setNewClientFeeBinance(e.target.value)}
                      className="mt-1.5 w-full rounded-lg border border-stone-200 bg-[#FAF9F6] px-3 py-2 font-mono text-sm text-stone-900 focus:border-amber-700 focus:outline-none dark:border-stone-800 dark:bg-[#121110] dark:text-stone-100"
                    />
                  </div>
                </div>

                {/* Cuentas Receptoras Asignadas */}
                <div className="rounded-xl border border-stone-200 bg-[#FAF9F6] p-4 dark:border-stone-800 dark:bg-[#121110]">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <h4 className="text-[11px] font-medium uppercase tracking-wider text-amber-700 dark:text-amber-500">
                        Cuentas Receptoras Asignadas (Destino y Moneda)
                      </h4>
                      <p className="mt-0.5 text-[11px] text-stone-500 dark:text-stone-400">
                        El cliente verá únicamente estas cuentas en /portal para saber a dónde enviar y en qué moneda.
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={handleAddCustomAssignedAccount}
                      className="inline-flex items-center gap-1 rounded-lg border border-stone-200 bg-white px-2.5 py-1 text-[11px] font-medium text-stone-800 hover:bg-stone-100 dark:border-stone-800 dark:bg-[#1C1A18] dark:text-stone-200"
                    >
                      <Plus className="h-3.5 w-3.5" strokeWidth={1.5} />
                      Agregar Cuenta
                    </button>
                  </div>

                  {mailboxes.length > 0 && (
                    <div className="mt-3 flex flex-wrap gap-2">
                      {mailboxes
                        .filter((mb) => mb.activo)
                        .map((mb) => {
                          const assigned = newClientAssignedAccounts.some(
                            (acc) =>
                              acc.mailbox_id === mb.id || acc.id === mb.id
                          );
                          const curr =
                            mb.moneda ??
                            platformDefaultCurrency(
                              mb.plataforma ?? 'CITIBANK'
                            );
                          const dest = mb.cuenta_receptora || mb.email_address;
                          return (
                            <button
                              key={mb.id}
                              type="button"
                              onClick={() => handleToggleMailboxAssignment(mb)}
                              className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-[11px] font-medium transition ${
                                assigned
                                  ? 'border-emerald-700/30 bg-emerald-50 text-emerald-800 dark:border-emerald-500/40 dark:bg-emerald-950/40 dark:text-emerald-300'
                                  : 'border-stone-200 bg-white text-stone-600 hover:border-stone-300 dark:border-stone-800 dark:bg-[#1C1A18] dark:text-stone-400'
                              }`}
                            >
                              <Check
                                className={`h-3 w-3 ${
                                  assigned ? 'opacity-100' : 'opacity-25'
                                }`}
                                strokeWidth={1.5}
                              />
                              <span>
                                {platformDefaultLabel(
                                  mb.plataforma ?? 'CITIBANK'
                                )}
                                : {dest} ({curr})
                              </span>
                            </button>
                          );
                        })}
                    </div>
                  )}

                  {newClientAssignedAccounts.length === 0 ? (
                    <p className="mt-3 rounded-lg border border-dashed border-stone-300 px-3 py-2.5 text-center text-[11px] text-stone-500 dark:border-stone-700 dark:text-stone-400">
                      No hay cuentas asignadas todavía. Selecciona un buzón de arriba o haz clic en &quot;Agregar Cuenta&quot;.
                    </p>
                  ) : (
                    <div className="mt-3 space-y-2.5">
                      {newClientAssignedAccounts.map((acc, idx) => (
                        <div
                          key={acc.id}
                          className="grid grid-cols-1 gap-2 rounded-lg border border-stone-200 bg-white p-2.5 sm:grid-cols-12 sm:items-end dark:border-stone-800 dark:bg-[#1C1A18]"
                        >
                          <div className="sm:col-span-3">
                            <label className="block text-[10px] font-medium uppercase text-stone-500">
                              Plataforma
                            </label>
                            <select
                              value={acc.plataforma}
                              onChange={(e) =>
                                handleUpdateAssignedAccount(idx, {
                                  plataforma: e.target
                                    .value as ExpectedPlatformType,
                                })
                              }
                              className="mt-1 w-full rounded border border-stone-200 bg-[#FAF9F6] px-2 py-1.5 text-xs text-stone-900 dark:border-stone-800 dark:bg-[#121110] dark:text-stone-100"
                            >
                              <option value="CITIBANK">Citibank Zelle</option>
                              <option value="TD_BANK">TD Bank Zelle</option>
                              <option value="BINANCE_PAY">Binance Pay</option>
                              <option value="BINANCE_P2P">Binance P2P</option>
                              <option value="BINANCE_ONCHAIN">
                                Red USDT
                              </option>
                            </select>
                          </div>
                          <div className="sm:col-span-4">
                            <label className="block text-[10px] font-medium uppercase text-stone-500">
                              Cuenta a enviar (Correo / Pay ID / Wallet)
                            </label>
                            <input
                              type="text"
                              required
                              value={acc.cuenta_receptora}
                              onChange={(e) =>
                                handleUpdateAssignedAccount(idx, {
                                  cuenta_receptora: e.target.value,
                                })
                              }
                              placeholder="ej. pagos@correo.com"
                              className="mt-1 w-full rounded border border-stone-200 bg-[#FAF9F6] px-2.5 py-1.5 font-mono text-xs text-stone-900 dark:border-stone-800 dark:bg-[#121110] dark:text-stone-100"
                            />
                          </div>
                          <div className="sm:col-span-2">
                            <label className="block text-[10px] font-medium uppercase text-stone-500">
                              Moneda
                            </label>
                            <select
                              value={acc.moneda}
                              onChange={(e) =>
                                handleUpdateAssignedAccount(idx, {
                                  moneda: e.target.value as CurrencyType,
                                })
                              }
                              className="mt-1 w-full rounded border border-stone-200 bg-[#FAF9F6] px-2 py-1.5 font-mono text-xs text-stone-900 dark:border-stone-800 dark:bg-[#121110] dark:text-stone-100"
                            >
                              <option value="USD">USD</option>
                              <option value="USDT">USDT</option>
                              <option value="VES">VES</option>
                            </select>
                          </div>
                          <div className="flex items-end gap-1.5 sm:col-span-3">
                            <div className="flex-1">
                              <label className="block text-[10px] font-medium uppercase text-stone-500">
                                Etiqueta visible
                              </label>
                              <input
                                type="text"
                                value={acc.alias}
                                onChange={(e) =>
                                  handleUpdateAssignedAccount(idx, {
                                    alias: e.target.value,
                                  })
                                }
                                placeholder="Citibank Zelle"
                                className="mt-1 w-full rounded border border-stone-200 bg-[#FAF9F6] px-2 py-1.5 text-xs text-stone-900 dark:border-stone-800 dark:bg-[#121110] dark:text-stone-100"
                              />
                            </div>
                            <button
                              type="button"
                              onClick={() => handleRemoveAssignedAccount(idx)}
                              className="rounded border border-stone-200 p-1.5 text-stone-400 hover:border-rose-700/35 hover:text-rose-700 dark:border-stone-800 dark:hover:text-rose-400"
                              title="Quitar cuenta"
                            >
                              <Trash2 className="h-3.5 w-3.5" strokeWidth={1.5} />
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                <div className="flex justify-end gap-3 border-t border-stone-200 pt-4 dark:border-stone-800">
                  <Dialog.Close asChild>
                    <button
                      type="button"
                      className="rounded-lg border border-stone-200 px-4 py-2 text-xs font-medium text-stone-700 hover:bg-stone-100 dark:border-stone-800 dark:text-stone-300 dark:hover:bg-stone-900"
                    >
                      Cancelar
                    </button>
                  </Dialog.Close>
                  <button
                    type="submit"
                    disabled={isSavingClient}
                    className="inline-flex items-center gap-2 rounded-lg bg-stone-900 px-5 py-2 text-xs font-medium text-stone-50 hover:bg-stone-800 disabled:opacity-60 dark:bg-stone-100 dark:text-stone-950 dark:hover:bg-white"
                  >
                    {isSavingClient ? (
                      <Loader2 className="h-4 w-4 animate-spin" strokeWidth={1.5} />
                    ) : (
                      <UserPlus className="h-4 w-4" strokeWidth={1.5} />
                    )}
                    {editingClientId ? 'Actualizar Cuenta y PIN' : 'Crear Cuenta de Acceso'}
                  </button>
                </div>
              </form>
            </Dialog.Content>
          </Dialog.Portal>
        </Dialog.Root>

        {/* =====================================================================
            MODAL: CREAR ORDEN / REPORTE DE PAGO ESPERADO
           ===================================================================== */}
        <Dialog.Root
          open={isNewOrderModalOpen}
          onOpenChange={setIsNewOrderModalOpen}
        >
          <Dialog.Portal>
            <Dialog.Overlay className="fixed inset-0 z-40 bg-stone-950/50 backdrop-blur-sm" />
            <Dialog.Content className="fixed left-1/2 top-1/2 z-50 w-[94vw] max-w-lg -translate-x-1/2 -translate-y-1/2 rounded-xl border border-stone-200/90 bg-white p-6 text-stone-900 shadow-2xl dark:border-stone-800 dark:bg-[#1C1A18] dark:text-stone-100">
              <div className="flex items-start justify-between border-b border-stone-200 pb-4 dark:border-stone-800">
                <div>
                  <Dialog.Title className="font-serif text-xl font-medium tracking-tight text-stone-900 dark:text-stone-100">
                    Registrar Orden de Pago Esperada
                  </Dialog.Title>
                  <Dialog.Description className="mt-1 text-xs text-stone-500 dark:text-stone-400">
                    Registra una orden Zelle o Binance esperada para conciliación automática.
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

              <form
                onSubmit={(e) => void handleCreateOrder(e)}
                className="mt-4 space-y-4"
              >
                <div>
                  <label className="block text-[11px] font-medium uppercase tracking-wider text-stone-500 dark:text-stone-400">
                    Cliente Titular *
                  </label>
                  <input
                    type="text"
                    required
                    list="registered-clients-list"
                    value={orderClientName}
                    onChange={(e) => setOrderClientName(e.target.value)}
                    placeholder="Selecciona o escribe el nombre del cliente"
                    className="mt-1.5 w-full rounded-lg border border-stone-200 bg-[#FAF9F6] px-3 py-2 text-sm text-stone-900 focus:border-amber-700 focus:outline-none dark:border-stone-800 dark:bg-[#121110] dark:text-stone-100"
                  />
                  <datalist id="registered-clients-list">
                    {clients.map((c) => (
                      <option key={c.id} value={c.nombre_titular} />
                    ))}
                  </datalist>
                </div>

                <div>
                  <label className="block text-[11px] font-medium uppercase tracking-wider text-stone-500 dark:text-stone-400">
                    Remitente Zelle o Nickname Binance
                  </label>
                  <input
                    type="text"
                    value={orderZelleSender}
                    onChange={(e) => setOrderZelleSender(e.target.value)}
                    placeholder="Ej. ALEJANDRO JOSE PEREZ o CarlosMendoza_Pay"
                    className="mt-1.5 w-full rounded-lg border border-stone-200 bg-[#FAF9F6] px-3 py-2 text-sm text-stone-900 focus:border-amber-700 focus:outline-none dark:border-stone-800 dark:bg-[#121110] dark:text-stone-100"
                  />
                </div>

                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div>
                    <label className="block text-[11px] font-medium uppercase tracking-wider text-stone-500 dark:text-stone-400">
                      Plataforma Destino
                    </label>
                    <select
                      value={orderBank}
                      onChange={(e) => {
                        const val = e.target.value as ExpectedPlatformType;
                        setOrderBank(val);
                        setOrderCurrency(
                          val.startsWith('BINANCE') ? 'USDT' : 'USD'
                        );
                      }}
                      className="mt-1.5 w-full rounded-lg border border-stone-200 bg-[#FAF9F6] px-3 py-2 text-sm text-stone-900 focus:border-amber-700 focus:outline-none dark:border-stone-800 dark:bg-[#121110] dark:text-stone-100"
                    >
                      <option value="CITIBANK">Citibank Zelle</option>
                      <option value="TD_BANK">TD Bank Zelle</option>
                      <option value="BINANCE_PAY">Binance Pay</option>
                      <option value="BINANCE_P2P">Binance P2P</option>
                      <option value="BINANCE_ONCHAIN">
                        Binance On-Chain (TRC20/BEP20)
                      </option>
                    </select>
                  </div>

                  <div>
                    <label className="block text-[11px] font-medium uppercase tracking-wider text-stone-500 dark:text-stone-400">
                      Moneda
                    </label>
                    <select
                      value={orderCurrency}
                      onChange={(e) =>
                        setOrderCurrency(e.target.value as CurrencyType)
                      }
                      className="mt-1.5 w-full rounded-lg border border-stone-200 bg-[#FAF9F6] px-3 py-2 font-mono text-sm text-stone-900 focus:border-amber-700 focus:outline-none dark:border-stone-800 dark:bg-[#121110] dark:text-stone-100"
                    >
                      <option value="USD">USD</option>
                      <option value="USDT">USDT</option>
                    </select>
                  </div>
                </div>

                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div>
                    <label className="block text-[11px] font-medium uppercase tracking-wider text-stone-500 dark:text-stone-400">
                      Monto Exacto ({orderCurrency}) *
                    </label>
                    <input
                      type="number"
                      step="0.01"
                      min="0.01"
                      required
                      value={orderAmount}
                      onChange={(e) => setOrderAmount(e.target.value)}
                      placeholder="1450.00"
                      className="mt-1.5 w-full rounded-lg border border-stone-200 bg-[#FAF9F6] px-3 py-2 font-mono text-sm text-stone-900 focus:border-amber-700 focus:outline-none dark:border-stone-800 dark:bg-[#121110] dark:text-stone-100"
                    />
                  </div>

                  <div>
                    <label className="block text-[11px] font-medium uppercase tracking-wider text-stone-500 dark:text-stone-400">
                      Referencia / Order ID / TxID
                    </label>
                    <input
                      type="text"
                      value={orderReference}
                      onChange={(e) => setOrderReference(e.target.value)}
                      placeholder="CITI992048112 o 293849201192"
                      className="mt-1.5 w-full rounded-lg border border-stone-200 bg-[#FAF9F6] px-3 py-2 font-mono text-xs text-stone-900 focus:border-amber-700 focus:outline-none dark:border-stone-800 dark:bg-[#121110] dark:text-stone-100"
                    />
                  </div>
                </div>

                <div className="flex justify-end gap-3 border-t border-stone-200 pt-4 dark:border-stone-800">
                  <Dialog.Close asChild>
                    <button
                      type="button"
                      className="rounded-lg border border-stone-200 px-4 py-2 text-xs font-medium text-stone-700 hover:bg-stone-100 dark:border-stone-800 dark:text-stone-300 dark:hover:bg-stone-900"
                    >
                      Cancelar
                    </button>
                  </Dialog.Close>
                  <button
                    type="submit"
                    disabled={isSavingOrder}
                    className="inline-flex items-center gap-2 rounded-lg bg-stone-900 px-5 py-2 text-xs font-medium text-stone-50 hover:bg-stone-800 disabled:opacity-60 dark:bg-stone-100 dark:text-stone-950 dark:hover:bg-white"
                  >
                    {isSavingOrder ? (
                      <Loader2 className="h-4 w-4 animate-spin" strokeWidth={1.5} />
                    ) : (
                      <FilePlus2 className="h-4 w-4" strokeWidth={1.5} />
                    )}
                    Guardar Orden y Conciliar
                  </button>
                </div>
              </form>
            </Dialog.Content>
          </Dialog.Portal>
        </Dialog.Root>

        {/* =====================================================================
            MODAL: CONCILIACIÓN MANUAL
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
            <Dialog.Overlay className="fixed inset-0 z-40 bg-stone-950/50 backdrop-blur-sm" />
            <Dialog.Content className="fixed left-1/2 top-1/2 z-50 w-[94vw] max-w-xl -translate-x-1/2 -translate-y-1/2 rounded-xl border border-stone-200/90 bg-white p-6 text-stone-900 shadow-2xl dark:border-stone-800 dark:bg-[#1C1A18] dark:text-stone-100">
              <div className="flex items-start justify-between border-b border-stone-200 pb-4 dark:border-stone-800">
                <div>
                  <Dialog.Title className="font-serif text-xl font-medium tracking-tight text-stone-900 dark:text-stone-100">
                    Conciliación Manual Multi-Canal
                  </Dialog.Title>
                  <Dialog.Description className="mt-1 text-xs text-stone-500 dark:text-stone-400">
                    Asigna este depósito Zelle o Binance a su orden pendiente o cliente titular.
                  </Dialog.Description>
                </div>
                <Dialog.Close asChild>
                  <button
                    type="button"
                    className="rounded-lg p-1.5 text-stone-400 hover:bg-stone-100 hover:text-stone-700 dark:hover:bg-stone-800 dark:hover:text-stone-200"
                    aria-label="Cerrar"
                  >
                    <X className="h-4 w-4" strokeWidth={1.5} />
                  </button>
                </Dialog.Close>
              </div>

              {selectedAlertForMatch && (
                <form
                  onSubmit={(e) => void handleConfirmManualReconciliation(e)}
                  className="mt-5 space-y-4"
                >
                  <div className="rounded-xl border border-stone-200 bg-[#FAF9F6] p-4 dark:border-stone-800 dark:bg-[#121110]">
                    <div className="flex items-center justify-between text-xs text-stone-500 dark:text-stone-400">
                      <span>
                        Plataforma:{' '}
                        <strong className="text-stone-900 dark:text-stone-100">
                          {selectedAlertForMatch.plataforma}
                        </strong>
                      </span>
                      <span>
                        Ref:{' '}
                        <strong className="font-mono text-stone-900 dark:text-stone-100">
                          {selectedAlertForMatch.referencia || 'N/A'}
                        </strong>
                      </span>
                    </div>
                    <div className="mt-2 text-sm">
                      <span className="text-stone-500 dark:text-stone-400">Contraparte: </span>
                      <strong className="text-stone-900 dark:text-stone-100">
                        {selectedAlertForMatch.remitente_o_contraparte}
                      </strong>
                    </div>
                    <div className="mt-3 grid grid-cols-3 divide-x divide-stone-200 border-t border-stone-200 pt-3 text-center dark:divide-stone-800 dark:border-stone-800">
                      <div>
                        <span className="block text-[10px] uppercase tracking-wider text-stone-500">
                          Monto Bruto
                        </span>
                        <span className="font-mono text-sm font-semibold tabular-nums text-stone-900 dark:text-stone-100">
                          {formatMoney(
                            selectedAlertForMatch.monto_bruto,
                            selectedAlertForMatch.moneda
                          )}
                        </span>
                      </div>
                      <div>
                        <span className="block text-[10px] uppercase tracking-wider text-stone-500">
                          Comisión ({selectedAlertForMatch.porcentaje_comision}%)
                        </span>
                        <span className="font-mono text-sm font-semibold tabular-nums text-stone-700 dark:text-stone-300">
                          -
                          {formatMoney(
                            selectedAlertForMatch.monto_comision,
                            selectedAlertForMatch.moneda
                          )}
                        </span>
                      </div>
                      <div>
                        <span className="block text-[10px] uppercase tracking-wider text-emerald-700 dark:text-emerald-400">
                          Neto a Acreditar
                        </span>
                        <span className="font-mono text-sm font-semibold tabular-nums text-emerald-700 dark:text-emerald-400">
                          {formatMoney(
                            selectedAlertForMatch.monto_neto,
                            selectedAlertForMatch.moneda
                          )}
                        </span>
                      </div>
                    </div>
                  </div>

                  <div>
                    <label
                      htmlFor="select-pending-order"
                      className="block text-[11px] font-medium uppercase tracking-wider text-stone-500 dark:text-stone-400"
                    >
                      1. Vincular con Orden Pendiente (Opcional)
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
                      className="mt-1.5 w-full rounded-lg border border-stone-200 bg-[#FAF9F6] px-3 py-2.5 text-sm text-stone-900 focus:border-amber-700 focus:outline-none dark:border-stone-800 dark:bg-[#121110] dark:text-stone-100"
                    >
                      <option value="">
                        -- Asignación directa a un cliente --
                      </option>
                      {pendingOrders.map((order) => {
                        const isExactAmount =
                          order.moneda === selectedAlertForMatch.moneda &&
                          Math.abs(
                            order.monto_esperado -
                              selectedAlertForMatch.monto_bruto
                          ) < 0.01;
                        return (
                          <option key={order.id} value={order.id}>
                            {isExactAmount ? '[MONTO EXACTO] ' : ''}
                            {order.codigo_orden} — {order.cliente_nombre} (
                            {formatMoney(order.monto_esperado, order.moneda)})
                          </option>
                        );
                      })}
                    </select>
                  </div>

                  <div>
                    <label
                      htmlFor="manual-client-name"
                      className="block text-[11px] font-medium uppercase tracking-wider text-stone-500 dark:text-stone-400"
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
                      className="mt-1.5 w-full rounded-lg border border-stone-200 bg-[#FAF9F6] px-3.5 py-2 text-sm text-stone-900 placeholder-stone-400 focus:border-amber-700 focus:outline-none dark:border-stone-800 dark:bg-[#121110] dark:text-stone-100 dark:placeholder-stone-500"
                    />
                    {!selectedOrderId && selectedAlertForMatch && (
                      <div className="mt-2 flex items-start gap-2 rounded-lg border border-amber-700/25 bg-amber-50 p-3 text-xs text-amber-900 dark:border-amber-500/35 dark:bg-amber-950/35 dark:text-amber-300">
                        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-700 dark:text-amber-400" strokeWidth={1.5} />
                        <span>
                          <strong>Regla de Conciliación:</strong> Estás por asignar directamente sin una orden de pago reportada. El remitente bancario (<strong>{selectedAlertForMatch.remitente_o_contraparte}</strong>) debe coincidir con el cliente o estar en su lista de remitentes autorizados.
                        </span>
                      </div>
                    )}
                  </div>

                  <div>
                    <label
                      htmlFor="manual-audit-notes"
                      className="block text-[11px] font-medium uppercase tracking-wider text-stone-500 dark:text-stone-400"
                    >
                      3. Justificación / Nota de Auditoría
                    </label>
                    <textarea
                      id="manual-audit-notes"
                      rows={3}
                      value={manualNotes}
                      onChange={(e) => setManualNotes(e.target.value)}
                      className="mt-1.5 w-full rounded-lg border border-stone-200 bg-[#FAF9F6] px-3.5 py-2 text-sm text-stone-900 focus:border-amber-700 focus:outline-none dark:border-stone-800 dark:bg-[#121110] dark:text-stone-100"
                    />
                  </div>

                  <div className="flex items-center justify-end gap-3 border-t border-stone-200 pt-4 dark:border-stone-800">
                    <Dialog.Close asChild>
                      <button
                        type="button"
                        className="rounded-lg border border-stone-200 px-4 py-2 text-xs font-medium text-stone-700 hover:bg-stone-100 dark:border-stone-800 dark:text-stone-300 dark:hover:bg-stone-900"
                      >
                        Cancelar
                      </button>
                    </Dialog.Close>
                    <button
                      type="submit"
                      disabled={isSubmittingMatch}
                      className="inline-flex items-center gap-2 rounded-lg bg-stone-900 px-5 py-2 text-xs font-medium text-stone-50 hover:bg-stone-800 disabled:opacity-60 dark:bg-stone-100 dark:text-stone-950 dark:hover:bg-white"
                    >
                      {isSubmittingMatch ? (
                        <Loader2 className="h-4 w-4 animate-spin" strokeWidth={1.5} />
                      ) : (
                        <CheckCircle2 className="h-4 w-4" strokeWidth={1.5} />
                      )}
                      Confirmar Conciliación (
                      {formatMoney(
                        selectedAlertForMatch.monto_neto,
                        selectedAlertForMatch.moneda
                      )}
                      )
                    </button>
                  </div>
                </form>
              )}
            </Dialog.Content>
          </Dialog.Portal>
        </Dialog.Root>

        {/* =====================================================================
            MODAL: INSPECTOR DE PAYLOAD / CORREO CRUDO
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
            <Dialog.Overlay className="fixed inset-0 z-40 bg-stone-950/50 backdrop-blur-sm" />
            <Dialog.Content className="fixed left-1/2 top-1/2 z-50 w-[94vw] max-w-lg -translate-x-1/2 -translate-y-1/2 rounded-xl border border-stone-200/90 bg-white p-6 text-stone-900 shadow-2xl dark:border-stone-800 dark:bg-[#1C1A18] dark:text-stone-100">
              <div className="flex items-center justify-between border-b border-stone-200 pb-3 dark:border-stone-800">
                <Dialog.Title className="font-serif text-lg font-medium tracking-tight text-stone-900 dark:text-stone-100">
                  Payload Original &amp; Llave de Idempotencia
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
              {inspectedAlert && (
                <div className="mt-4 space-y-3 text-xs">
                  <div className="space-y-1 rounded-lg border border-stone-200 bg-[#FAF9F6] p-3 font-mono text-stone-700 dark:border-stone-800 dark:bg-[#121110] dark:text-stone-300">
                    <div>External ID: {inspectedAlert.external_unique_id}</div>
                    <div className="text-emerald-700 dark:text-emerald-400">
                      Dedup Key: {inspectedAlert.dedup_key}
                    </div>
                    <div>Origen: {inspectedAlert.origen_deteccion}</div>
                  </div>
                  <pre className="max-h-72 overflow-y-auto whitespace-pre-wrap rounded-lg border border-stone-200 bg-[#FAF9F6] p-4 font-mono text-xs leading-relaxed text-stone-800 dark:border-stone-800 dark:bg-[#121110] dark:text-stone-200">
                    {inspectedAlert.raw_body ??
                      JSON.stringify(inspectedAlert.raw_payload, null, 2)}
                  </pre>
                </div>
              )}
            </Dialog.Content>
          </Dialog.Portal>
        </Dialog.Root>

        {/* =====================================================================
            MODAL: SIMULADOR MULTICANAL (ZELLE + BINANCE)
           ===================================================================== */}
        <Dialog.Root open={isSimulatorOpen} onOpenChange={setIsSimulatorOpen}>
          <Dialog.Portal>
            <Dialog.Overlay className="fixed inset-0 z-40 bg-stone-950/50 backdrop-blur-sm" />
            <Dialog.Content className="fixed left-1/2 top-1/2 z-50 w-[94vw] max-w-2xl -translate-x-1/2 -translate-y-1/2 rounded-xl border border-stone-200/90 bg-white p-6 text-stone-900 shadow-2xl dark:border-stone-800 dark:bg-[#1C1A18] dark:text-stone-100">
              <div className="flex items-start justify-between border-b border-stone-200 pb-4 dark:border-stone-800">
                <div>
                  <Dialog.Title className="font-serif text-xl font-medium tracking-tight text-stone-900 dark:text-stone-100">
                    Simulador Multi-Canal (Zelle + Binance Pay / P2P / On-Chain)
                  </Dialog.Title>
                  <Dialog.Description className="mt-1 text-xs text-stone-500 dark:text-stone-400">
                    Prueba en vivo{' '}
                    <code className="font-mono text-amber-700 dark:text-amber-500">parseBankAlertEmail()</code>{' '}
                    e idempotencia cruzada por <code className="font-mono">dedup_key</code>.
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
                      className="rounded-md border border-stone-200 bg-[#FAF9F6] px-2.5 py-1 text-xs font-medium text-stone-700 hover:border-amber-700 dark:border-stone-800 dark:bg-[#121110] dark:text-stone-300 dark:hover:border-amber-500"
                    >
                      {tpl.label}
                    </button>
                  ))}
                </div>

                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div>
                    <label className="block text-[11px] font-medium uppercase tracking-wider text-stone-500 dark:text-stone-400">
                      Remitente (From)
                    </label>
                    <input
                      type="text"
                      required
                      value={simFrom}
                      onChange={(e) => setSimFrom(e.target.value)}
                      className="mt-1 w-full rounded-lg border border-stone-200 bg-[#FAF9F6] px-3 py-2 text-sm text-stone-900 focus:border-amber-700 focus:outline-none dark:border-stone-800 dark:bg-[#121110] dark:text-stone-100"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-medium uppercase tracking-wider text-stone-500 dark:text-stone-400">
                      Asunto (Subject)
                    </label>
                    <input
                      type="text"
                      required
                      value={simSubject}
                      onChange={(e) => setSimSubject(e.target.value)}
                      className="mt-1 w-full rounded-lg border border-stone-200 bg-[#FAF9F6] px-3 py-2 text-sm text-stone-900 focus:border-amber-700 focus:outline-none dark:border-stone-800 dark:bg-[#121110] dark:text-stone-100"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-[11px] font-medium uppercase tracking-wider text-stone-500 dark:text-stone-400">
                    Cuerpo del Correo (HTML o Texto Plano)
                  </label>
                  <textarea
                    rows={6}
                    required
                    value={simBody}
                    onChange={(e) => setSimBody(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-stone-200 bg-[#FAF9F6] p-3 font-mono text-xs text-stone-900 focus:border-amber-700 focus:outline-none dark:border-stone-800 dark:bg-[#121110] dark:text-stone-100"
                  />
                </div>

                <div className="flex justify-end gap-3 border-t border-stone-200 pt-4 dark:border-stone-800">
                  <Dialog.Close asChild>
                    <button
                      type="button"
                      className="rounded-lg border border-stone-200 px-4 py-2 text-xs font-medium text-stone-700 hover:bg-stone-100 dark:border-stone-800 dark:text-stone-300 dark:hover:bg-stone-900"
                    >
                      Cerrar
                    </button>
                  </Dialog.Close>
                  <button
                    type="submit"
                    disabled={isSimulating}
                    className="inline-flex items-center gap-2 rounded-lg bg-stone-900 px-5 py-2 text-xs font-medium text-stone-50 hover:bg-stone-800 disabled:opacity-60 dark:bg-stone-100 dark:text-stone-950 dark:hover:bg-white"
                  >
                    {isSimulating ? (
                      <Loader2 className="h-4 w-4 animate-spin" strokeWidth={1.5} />
                    ) : (
                      <Cpu className="h-4 w-4" strokeWidth={1.5} />
                    )}
                    Ejecutar Parseo e Insertar
                  </button>
                </div>
              </form>
            </Dialog.Content>
          </Dialog.Portal>
        </Dialog.Root>

        {/* =====================================================================
            MODAL: CREAR / EDITAR CUENTA DE NEGOCIO
           ===================================================================== */}
        <Dialog.Root
          open={isBusinessUserModalOpen}
          onOpenChange={(open) => {
            setIsBusinessUserModalOpen(open);
            if (!open) {
              setEditingBusinessUserId(null);
            }
          }}
        >
          <Dialog.Portal>
            <Dialog.Overlay className="fixed inset-0 z-40 bg-stone-950/50 backdrop-blur-sm" />
            <Dialog.Content className="fixed left-1/2 top-1/2 z-50 w-[94vw] max-w-lg -translate-x-1/2 -translate-y-1/2 rounded-xl border border-stone-200/90 bg-white p-6 text-stone-900 shadow-2xl dark:border-stone-800 dark:bg-[#1C1A18] dark:text-stone-100">
              <div className="flex items-start justify-between border-b border-stone-200 pb-4 dark:border-stone-800">
                <div>
                  <Dialog.Title className="font-serif text-xl font-medium tracking-tight text-stone-900 dark:text-stone-100">
                    {editingBusinessUserId
                      ? 'Editar Cuenta de Negocio y Clave'
                      : 'Crear Cuenta Nueva para Negocio'}
                  </Dialog.Title>
                  <Dialog.Description className="mt-1 text-xs text-stone-500 dark:text-stone-400">
                    Define el negocio, correo y contraseña para su acceso independiente al panel de conciliación.
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

              <form
                onSubmit={(e) => void handleSaveBusinessUser(e)}
                className="mt-4 space-y-4"
              >
                <div>
                  <label className="block text-[11px] font-medium uppercase tracking-wider text-stone-500 dark:text-stone-400">
                    Nombre del Negocio / Empresa *
                  </label>
                  <input
                    type="text"
                    required
                    value={bizName}
                    onChange={(e) => setBizName(e.target.value)}
                    placeholder="Ej. Inversiones Caribe LLC"
                    className="mt-1.5 w-full rounded-lg border border-stone-200 bg-[#FAF9F6] px-3 py-2 text-sm text-stone-900 focus:border-amber-700 focus:outline-none dark:border-stone-800 dark:bg-[#121110] dark:text-stone-100"
                  />
                </div>

                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div>
                    <label className="block text-[11px] font-medium uppercase tracking-wider text-stone-500 dark:text-stone-400">
                      Nombre del Usuario Responsable *
                    </label>
                    <input
                      type="text"
                      required
                      value={bizOwnerName}
                      onChange={(e) => setBizOwnerName(e.target.value)}
                      placeholder="Ej. María González"
                      className="mt-1.5 w-full rounded-lg border border-stone-200 bg-[#FAF9F6] px-3 py-2 text-sm text-stone-900 focus:border-amber-700 focus:outline-none dark:border-stone-800 dark:bg-[#121110] dark:text-stone-100"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-medium uppercase tracking-wider text-stone-500 dark:text-stone-400">
                      Teléfono / WhatsApp
                    </label>
                    <input
                      type="text"
                      value={bizPhone}
                      onChange={(e) => setBizPhone(e.target.value)}
                      placeholder="+1 305..."
                      className="mt-1.5 w-full rounded-lg border border-stone-200 bg-[#FAF9F6] px-3 py-2 text-sm text-stone-900 focus:border-amber-700 focus:outline-none dark:border-stone-800 dark:bg-[#121110] dark:text-stone-100"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div>
                    <label className="block text-[11px] font-medium uppercase tracking-wider text-stone-500 dark:text-stone-400">
                      Correo de Inicio de Sesión *
                    </label>
                    <input
                      type="email"
                      required
                      value={bizEmail}
                      onChange={(e) => setBizEmail(e.target.value)}
                      placeholder="admin@negocio.com"
                      className="mt-1.5 w-full rounded-lg border border-stone-200 bg-[#FAF9F6] px-3 py-2 text-sm text-stone-900 focus:border-amber-700 focus:outline-none dark:border-stone-800 dark:bg-[#121110] dark:text-stone-100"
                    />
                  </div>

                  <div>
                    <label className="block text-[11px] font-medium uppercase tracking-wider text-stone-500 dark:text-stone-400">
                      Tipo de Cuenta
                    </label>
                    <select
                      value={bizRole}
                      disabled={
                        editingBusinessUserId !== null && bizRole === 'SUPER_ADMIN'
                      }
                      onChange={(e) =>
                        setBizRole(e.target.value as BusinessUserRole)
                      }
                      className="mt-1.5 w-full rounded-lg border border-stone-200 bg-[#FAF9F6] px-3 py-2 text-sm text-stone-900 disabled:opacity-60 dark:border-stone-800 dark:bg-[#121110] dark:text-stone-100"
                    >
                      <option value="NEGOCIO">Negocio Independiente</option>
                      <option value="SUPER_ADMIN">Super Admin</option>
                    </select>
                  </div>
                </div>

                <div>
                  <div className="flex items-center justify-between">
                    <label className="block text-[11px] font-medium uppercase tracking-wider text-stone-500 dark:text-stone-400">
                      Contraseña de Acceso{' '}
                      {editingBusinessUserId ? '(Opcional al editar)' : '*'}
                    </label>
                    <button
                      type="button"
                      onClick={handleGenerateRandomBizPassword}
                      className="text-[11px] font-medium text-amber-700 hover:underline dark:text-amber-500"
                    >
                      Generar clave aleatoria
                    </button>
                  </div>
                  <input
                    type="text"
                    required={!editingBusinessUserId}
                    minLength={editingBusinessUserId && !bizPassword ? undefined : 4}
                    value={bizPassword}
                    onChange={(e) => setBizPassword(e.target.value)}
                    placeholder={
                      editingBusinessUserId
                        ? 'Dejar vacío para mantener contraseña actual'
                        : 'Mínimo 4 caracteres'
                    }
                    className="mt-1.5 w-full rounded-lg border border-stone-200 bg-[#FAF9F6] px-3 py-2 font-mono text-sm text-stone-900 focus:border-amber-700 focus:outline-none dark:border-stone-800 dark:bg-[#121110] dark:text-stone-100"
                  />
                </div>

                <div className="flex justify-end gap-3 border-t border-stone-200 pt-4 dark:border-stone-800">
                  <Dialog.Close asChild>
                    <button
                      type="button"
                      className="rounded-lg border border-stone-200 px-4 py-2 text-xs font-medium text-stone-700 hover:bg-stone-100 dark:border-stone-800 dark:text-stone-300 dark:hover:bg-stone-900"
                    >
                      Cancelar
                    </button>
                  </Dialog.Close>
                  <button
                    type="submit"
                    disabled={isSavingBusinessUser}
                    className="inline-flex items-center gap-2 rounded-lg bg-stone-900 px-5 py-2 text-xs font-medium text-stone-50 hover:bg-stone-800 disabled:opacity-60 dark:bg-stone-100 dark:text-stone-950 dark:hover:bg-white"
                  >
                    {isSavingBusinessUser ? (
                      <Loader2 className="h-4 w-4 animate-spin" strokeWidth={1.5} />
                    ) : (
                      <Briefcase className="h-4 w-4" strokeWidth={1.5} />
                    )}
                    {editingBusinessUserId
                      ? 'Guardar Cambios'
                      : 'Crear Cuenta de Negocio'}
                  </button>
                </div>
              </form>
            </Dialog.Content>
          </Dialog.Portal>
        </Dialog.Root>

        {/* Modal Reversión / Deshacer Conciliación */}
        <Dialog.Root
          open={alertToRevert !== null}
          onOpenChange={(open) => {
            if (!open) {
              setAlertToRevert(null);
              setRevertReason('');
            }
          }}
        >
          <Dialog.Portal>
            <Dialog.Overlay className="fixed inset-0 z-50 bg-stone-950/50 backdrop-blur-sm" />
            <Dialog.Content className="fixed left-1/2 top-1/2 z-50 w-[94vw] max-w-lg -translate-x-1/2 -translate-y-1/2 rounded-xl border border-stone-200/90 bg-white p-6 text-stone-900 shadow-2xl dark:border-stone-800 dark:bg-[#1C1A18] dark:text-stone-100">
              <div className="flex items-center justify-between border-b border-stone-200 pb-3 dark:border-stone-800">
                <div className="flex items-center gap-2 text-rose-700 dark:text-rose-400">
                  <RotateCcw className="h-4 w-4" strokeWidth={1.5} />
                  <Dialog.Title className="font-serif text-xl font-medium tracking-tight text-stone-900 dark:text-stone-100">
                    Deshacer Conciliación
                  </Dialog.Title>
                </div>
                <Dialog.Close asChild>
                  <button
                    type="button"
                    className="rounded-lg p-1 text-stone-400 hover:bg-stone-100 hover:text-stone-700 dark:hover:bg-stone-800 dark:hover:text-stone-200"
                  >
                    <X className="h-4 w-4" strokeWidth={1.5} />
                  </button>
                </Dialog.Close>
              </div>

              {alertToRevert && (
                <form
                  onSubmit={handleConfirmRevertReconciliation}
                  className="mt-4 space-y-4"
                >
                  <div className="rounded-xl border border-rose-700/25 bg-rose-50 p-4 text-xs text-rose-800 dark:border-rose-500/35 dark:bg-rose-950/35 dark:text-rose-300">
                    <p className="font-semibold">
                      ¿Estás seguro de que deseas revertir esta conciliación?
                    </p>
                    <p className="mt-1 text-stone-700 dark:text-stone-300">
                      Esta acción devolverá la transacción al estado de{' '}
                      <strong>REVISIÓN MANUAL</strong>, desvinculará la orden de
                      pago (si existe), recalculará inmediatamente el saldo del
                      cliente y eliminará el remitente aprendido si fue
                      agregado por esta operación.
                    </p>
                  </div>

                  <div className="rounded-xl border border-stone-200 bg-[#FAF9F6] p-4 text-xs dark:border-stone-800 dark:bg-[#121110]">
                    <div className="grid grid-cols-2 gap-3 text-stone-600 dark:text-stone-300">
                      <div>
                        <span className="block text-stone-400">Canal / Banco:</span>
                        <span className="font-medium text-stone-900 dark:text-stone-100">
                          {alertToRevert.plataforma}
                        </span>
                      </div>
                      <div>
                        <span className="block text-stone-400">
                          Referencia / TxID:
                        </span>
                        <span className="font-mono font-medium text-stone-900 dark:text-stone-100">
                          {alertToRevert.referencia || 'N/A'}
                        </span>
                      </div>
                      <div>
                        <span className="block text-stone-400">Remitente:</span>
                        <span className="font-medium text-stone-900 dark:text-stone-100">
                          {alertToRevert.remitente_o_contraparte}
                        </span>
                      </div>
                      <div>
                        <span className="block text-stone-400">
                          Cliente Acreditado:
                        </span>
                        <span className="font-semibold text-amber-700 dark:text-amber-400">
                          {alertToRevert.cliente_asignado_nombre || 'N/A'}
                        </span>
                      </div>
                      <div className="col-span-2 flex items-center justify-between border-t border-stone-200 pt-2 font-mono dark:border-stone-800">
                        <span className="text-stone-500">Monto Acreditado:</span>
                        <span className="text-base font-semibold tabular-nums text-emerald-700 dark:text-emerald-400">
                          {formatMoney(
                            alertToRevert.monto_neto,
                            alertToRevert.moneda
                          )}
                        </span>
                      </div>
                    </div>
                  </div>

                  <div>
                    <label
                      htmlFor="revert-reason"
                      className="block text-[11px] font-medium uppercase tracking-wider text-stone-500 dark:text-stone-400"
                    >
                      Motivo de la Reversión *
                    </label>
                    <textarea
                      id="revert-reason"
                      required
                      rows={2}
                      value={revertReason}
                      onChange={(e) => setRevertReason(e.target.value)}
                      placeholder="Ej. Conciliado por error al cliente equivocado, comprobante duplicado, etc."
                      className="mt-1.5 w-full rounded-lg border border-stone-200 bg-[#FAF9F6] px-3.5 py-2 text-sm text-stone-900 placeholder-stone-400 focus:border-rose-700 focus:outline-none dark:border-stone-800 dark:bg-[#121110] dark:text-stone-100 dark:placeholder-stone-500"
                    />
                  </div>

                  <div className="flex items-center justify-end gap-3 border-t border-stone-200 pt-4 dark:border-stone-800">
                    <Dialog.Close asChild>
                      <button
                        type="button"
                        className="rounded-lg border border-stone-200 px-4 py-2 text-xs font-medium text-stone-700 hover:bg-stone-100 dark:border-stone-800 dark:text-stone-300 dark:hover:bg-stone-900"
                      >
                        Cancelar
                      </button>
                    </Dialog.Close>
                    <button
                      type="submit"
                      disabled={isSubmittingRevert}
                      className="inline-flex items-center gap-2 rounded-lg bg-rose-700 px-5 py-2 text-xs font-medium text-white hover:bg-rose-800 disabled:opacity-60"
                    >
                      {isSubmittingRevert ? (
                        <Loader2 className="h-4 w-4 animate-spin" strokeWidth={1.5} />
                      ) : (
                        <RotateCcw className="h-4 w-4" strokeWidth={1.5} />
                      )}
                      Confirmar Reversión
                    </button>
                  </div>
                </form>
              )}
            </Dialog.Content>
          </Dialog.Portal>
        </Dialog.Root>

        {/* Modal Eliminar / Descartar Correos Propios o Ajenos a la Conciliación */}
        <Dialog.Root
          open={alertsToDiscard.length > 0}
          onOpenChange={(open) => {
            if (!open && !isSubmittingDiscard) {
              setAlertsToDiscard([]);
            }
          }}
        >
          <Dialog.Portal>
            <Dialog.Overlay className="fixed inset-0 z-50 bg-stone-950/50 backdrop-blur-sm" />
            <Dialog.Content className="fixed left-1/2 top-1/2 z-50 w-[94vw] max-w-lg -translate-x-1/2 -translate-y-1/2 rounded-xl border border-stone-200/90 bg-white p-6 text-stone-900 shadow-2xl dark:border-stone-800 dark:bg-[#1C1A18] dark:text-stone-100">
              <div className="flex items-start justify-between border-b border-stone-200 pb-4 dark:border-stone-800">
                <div className="flex items-center gap-2.5">
                  <div className="flex h-9 w-9 items-center justify-center rounded-lg border border-rose-700/20 bg-rose-50 text-rose-700 dark:border-rose-500/30 dark:bg-rose-950/40 dark:text-rose-400">
                    <Trash2 className="h-4 w-4" strokeWidth={1.5} />
                  </div>
                  <div>
                    <Dialog.Title className="font-serif text-lg font-medium tracking-tight text-stone-900 dark:text-stone-100">
                      {alertsToDiscard.length === 1
                        ? 'Eliminar Correo de la Lista Activa'
                        : `Eliminar ${alertsToDiscard.length} Correos Seleccionados`}
                    </Dialog.Title>
                    <Dialog.Description className="mt-0.5 text-xs text-stone-500 dark:text-stone-400">
                      Correos propios o transferencias que nadie va a confirmar
                    </Dialog.Description>
                  </div>
                </div>
                <Dialog.Close asChild>
                  <button
                    type="button"
                    className="rounded-lg p-1 text-stone-400 hover:bg-stone-100 hover:text-stone-700 dark:hover:bg-stone-800 dark:hover:text-stone-200"
                  >
                    <X className="h-4 w-4" strokeWidth={1.5} />
                  </button>
                </Dialog.Close>
              </div>

              {alertsToDiscard.length > 0 && (
                <form
                  onSubmit={(e) => void handleConfirmDiscardAlerts(e)}
                  className="mt-4 space-y-4"
                >
                  {alertsToDiscard.length === 1 ? (
                    <div className="space-y-1.5 rounded-xl border border-stone-200 bg-[#FAF9F6] p-3.5 text-xs dark:border-stone-800 dark:bg-[#121110]">
                      <div className="flex justify-between">
                        <span className="text-stone-500">Remitente:</span>
                        <span className="font-semibold text-stone-900 dark:text-stone-100">
                          {alertsToDiscard[0]?.remitente_o_contraparte || 'Desconocido'}
                        </span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-stone-500">Referencia:</span>
                        <span className="font-mono text-stone-700 dark:text-stone-300">
                          {alertsToDiscard[0]?.referencia || 'SIN-REF'}
                        </span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-stone-500">Fecha Correo:</span>
                        <span className="font-mono tabular-nums text-stone-700 dark:text-stone-300">
                          {formatDateTime(alertsToDiscard[0]?.fecha_transaccion ?? null)}
                        </span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-stone-500">Monto:</span>
                        <span className="font-mono font-semibold tabular-nums text-rose-700 dark:text-rose-400">
                          {formatMoney(
                            alertsToDiscard[0]?.monto_bruto ?? 0,
                            alertsToDiscard[0]?.moneda ?? 'USD'
                          )}
                        </span>
                      </div>
                    </div>
                  ) : (
                    <div className="space-y-2 rounded-xl border border-stone-200 bg-[#FAF9F6] p-3.5 text-xs dark:border-stone-800 dark:bg-[#121110]">
                      <div className="flex items-center justify-between">
                        <span className="text-stone-500">Cantidad seleccionada:</span>
                        <span className="font-semibold text-stone-900 dark:text-stone-100">
                          {alertsToDiscard.length} correos sin conciliar
                        </span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-stone-500">Monto total excluido:</span>
                        <span className="font-mono font-semibold tabular-nums text-rose-700 dark:text-rose-400">
                          $
                          {alertsToDiscard
                            .reduce((acc, item) => acc + Number(item.monto_bruto || 0), 0)
                            .toFixed(2)}
                        </span>
                      </div>
                      <div className="max-h-28 space-y-1 overflow-y-auto border-t border-stone-200 pt-2 dark:border-stone-800">
                        {alertsToDiscard.map((item) => (
                          <div
                            key={item.id}
                            className="flex items-center justify-between text-[11px] text-stone-600 dark:text-stone-300"
                          >
                            <span className="truncate pr-2">
                              {item.remitente_o_contraparte} · {item.referencia || 'SIN-REF'}
                            </span>
                            <span className="font-mono font-semibold tabular-nums text-stone-900 dark:text-stone-100">
                              {formatMoney(item.monto_bruto, item.moneda)}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  <div>
                    <label
                      htmlFor="discard-reason"
                      className="block text-[11px] font-medium uppercase tracking-wider text-stone-500 dark:text-stone-400"
                    >
                      Motivo de eliminación
                    </label>
                    <div className="mt-1.5 flex flex-wrap gap-1.5">
                      {[
                        'Correo propio / transferencia personal',
                        'No corresponde a conciliación',
                        'Transferencia interna sin cliente',
                      ].map((preset) => (
                        <button
                          key={preset}
                          type="button"
                          onClick={() => setDiscardReason(preset)}
                          className={`rounded-full border px-2.5 py-1 text-[11px] transition cursor-pointer ${
                            discardReason === preset
                              ? 'border-rose-700/35 bg-rose-50 text-rose-700 dark:border-rose-500/40 dark:bg-rose-950/40 dark:text-rose-300'
                              : 'border-stone-200 bg-[#FAF9F6] text-stone-600 hover:border-stone-300 dark:border-stone-800 dark:bg-[#121110] dark:text-stone-400'
                          }`}
                        >
                          {preset}
                        </button>
                      ))}
                    </div>
                    <input
                      id="discard-reason"
                      type="text"
                      value={discardReason}
                      onChange={(e) => setDiscardReason(e.target.value)}
                      placeholder="Ej. Transferencia propia, no pertenece a ningún cliente..."
                      className="mt-2 w-full rounded-lg border border-stone-200 bg-[#FAF9F6] px-3.5 py-2 text-sm text-stone-900 placeholder-stone-400 focus:border-rose-700 focus:outline-none dark:border-stone-800 dark:bg-[#121110] dark:text-stone-100 dark:placeholder-stone-500"
                    />
                  </div>

                  <p className="rounded-lg border border-stone-200 bg-[#FAF9F6] p-2.5 text-[11px] leading-relaxed text-stone-500 dark:border-stone-800 dark:bg-[#121110] dark:text-stone-400">
                    El correo desaparecerá de la lista activa y de los totales pendientes, y el sincronizador IMAP <strong className="text-stone-700 dark:text-stone-200">no volverá a descargarlo</strong>. Si lo necesitas en el futuro, podrás restaurarlo desde <strong className="text-stone-700 dark:text-stone-200">«Eliminados»</strong>.
                  </p>

                  <div className="flex items-center justify-end gap-3 border-t border-stone-200 pt-4 dark:border-stone-800">
                    <Dialog.Close asChild>
                      <button
                        type="button"
                        className="rounded-lg border border-stone-200 px-4 py-2 text-xs font-medium text-stone-700 hover:bg-stone-100 cursor-pointer dark:border-stone-800 dark:text-stone-300 dark:hover:bg-stone-900"
                      >
                        Cancelar
                      </button>
                    </Dialog.Close>
                    <button
                      type="submit"
                      disabled={isSubmittingDiscard}
                      className="inline-flex items-center gap-2 rounded-lg bg-rose-700 px-5 py-2 text-xs font-medium text-white hover:bg-rose-800 disabled:opacity-60 cursor-pointer"
                    >
                      {isSubmittingDiscard ? (
                        <Loader2 className="h-4 w-4 animate-spin" strokeWidth={1.5} />
                      ) : (
                        <Trash2 className="h-4 w-4" strokeWidth={1.5} />
                      )}
                      Confirmar Eliminación
                    </button>
                  </div>
                </form>
              )}
            </Dialog.Content>
          </Dialog.Portal>
        </Dialog.Root>

        {/* Modal Conciliación Masiva por Lote */}
        <Dialog.Root
          open={isBatchModalOpen}
          onOpenChange={(open) => {
            setIsBatchModalOpen(open);
            if (!open) {
              setBatchTargetClient('');
            }
          }}
        >
          <Dialog.Portal>
            <Dialog.Overlay className="fixed inset-0 z-50 bg-stone-950/50 backdrop-blur-sm" />
            <Dialog.Content className="fixed left-1/2 top-1/2 z-50 w-[94vw] max-w-lg -translate-x-1/2 -translate-y-1/2 rounded-xl border border-stone-200/90 bg-white p-6 text-stone-900 shadow-2xl dark:border-stone-800 dark:bg-[#1C1A18] dark:text-stone-100">
              <div className="flex items-center justify-between border-b border-stone-200 pb-3 dark:border-stone-800">
                <div className="flex items-center gap-2">
                  <UserCheck className="h-4 w-4 text-stone-400" strokeWidth={1.5} />
                  <Dialog.Title className="font-serif text-xl font-medium tracking-tight text-stone-900 dark:text-stone-100">
                    Asignación Masiva por Lote
                  </Dialog.Title>
                </div>
                <Dialog.Close asChild>
                  <button
                    type="button"
                    className="rounded-lg p-1 text-stone-400 hover:bg-stone-100 hover:text-stone-700 dark:hover:bg-stone-800 dark:hover:text-stone-200"
                  >
                    <X className="h-4 w-4" strokeWidth={1.5} />
                  </button>
                </Dialog.Close>
              </div>

              <form
                onSubmit={handleConfirmBatchReconciliation}
                className="mt-4 space-y-4"
              >
                <div className="rounded-xl border border-emerald-700/20 bg-emerald-50 p-3.5 text-xs text-emerald-900 dark:border-emerald-500/30 dark:bg-emerald-950/35 dark:text-emerald-300">
                  <p className="font-semibold">
                    Estás por adjudicar {selectedAlertIds.length} pagos seleccionados.
                  </p>
                  <p className="mt-1 text-stone-700 dark:text-stone-300">
                    Monto total a conciliar:{' '}
                    <strong className="font-mono tabular-nums text-emerald-700 dark:text-emerald-400">
                      $
                      {alerts
                        .filter((a) => selectedAlertIds.includes(a.id))
                        .reduce((sum, a) => sum + a.monto_bruto, 0)
                        .toFixed(2)}{' '}
                      USD
                    </strong>
                    . El saldo del cliente seleccionado se actualizará automáticamente y los remitentes bancarios serán agregados a su lista autorizada.
                  </p>
                </div>

                <div>
                  <label
                    htmlFor="batch-client-select"
                    className="block text-[11px] font-medium uppercase tracking-wider text-stone-500 dark:text-stone-400"
                  >
                    Cliente Titular a Acreditar *
                  </label>
                  <input
                    id="batch-client-select"
                    type="text"
                    required
                    list="registered-clients-list"
                    value={batchTargetClient}
                    onChange={(e) => setBatchTargetClient(e.target.value)}
                    placeholder="Escribe o selecciona un cliente registrado"
                    className="mt-1.5 w-full rounded-lg border border-stone-200 bg-[#FAF9F6] px-3.5 py-2 text-sm text-stone-900 placeholder-stone-400 focus:border-amber-700 focus:outline-none dark:border-stone-800 dark:bg-[#121110] dark:text-stone-100 dark:placeholder-stone-500"
                  />
                  <p className="mt-1 text-[11px] text-stone-500 dark:text-stone-400">
                    Selecciona de la lista de clientes registrados o escribe el nombre exacto.
                  </p>
                </div>

                <div>
                  <label
                    htmlFor="batch-notes"
                    className="block text-[11px] font-medium uppercase tracking-wider text-stone-500 dark:text-stone-400"
                  >
                    Motivo / Nota de Auditoría
                  </label>
                  <textarea
                    id="batch-notes"
                    rows={2}
                    value={batchNotes}
                    onChange={(e) => setBatchNotes(e.target.value)}
                    placeholder="Ej. Asignación masiva autorizada por comprobantes históricos"
                    className="mt-1.5 w-full rounded-lg border border-stone-200 bg-[#FAF9F6] px-3.5 py-2 text-sm text-stone-900 placeholder-stone-400 focus:border-amber-700 focus:outline-none dark:border-stone-800 dark:bg-[#121110] dark:text-stone-100 dark:placeholder-stone-500"
                  />
                </div>

                <div className="flex items-center justify-end gap-3 border-t border-stone-200 pt-4 dark:border-stone-800">
                  <Dialog.Close asChild>
                    <button
                      type="button"
                      className="rounded-lg border border-stone-200 px-4 py-2 text-xs font-medium text-stone-700 hover:bg-stone-100 dark:border-stone-800 dark:text-stone-300 dark:hover:bg-stone-900"
                    >
                      Cancelar
                    </button>
                  </Dialog.Close>
                  <button
                    type="submit"
                    disabled={isSubmittingBatch}
                    className="inline-flex items-center gap-2 rounded-lg bg-stone-900 px-5 py-2 text-xs font-medium text-stone-50 hover:bg-stone-800 disabled:opacity-60 dark:bg-stone-100 dark:text-stone-950 dark:hover:bg-white"
                  >
                    {isSubmittingBatch ? (
                      <Loader2 className="h-4 w-4 animate-spin" strokeWidth={1.5} />
                    ) : (
                      <CheckCircle2 className="h-4 w-4" strokeWidth={1.5} />
                    )}
                    Confirmar Asignación ({selectedAlertIds.length} Pagos)
                  </button>
                </div>
              </form>
            </Dialog.Content>
          </Dialog.Portal>
        </Dialog.Root>

        {/* Modal Registrar Liquidación de Fondos a Cliente o Tercero */}
        <Dialog.Root
          open={isLiquidationModalOpen}
          onOpenChange={(open) => {
            setIsLiquidationModalOpen(open);
            if (!open) {
              setLiquidationFeedback(null);
            }
          }}
        >
          <Dialog.Portal>
            <Dialog.Overlay className="fixed inset-0 z-50 bg-stone-950/50 backdrop-blur-sm" />
            <Dialog.Content className="fixed left-1/2 top-1/2 z-50 max-h-[92vh] w-[94vw] max-w-lg -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-xl border border-stone-200/90 bg-white p-6 text-stone-900 shadow-2xl dark:border-stone-800 dark:bg-[#1C1A18] dark:text-stone-100">
              <div className="flex items-center justify-between border-b border-stone-200 pb-3 dark:border-stone-800">
                <div className="flex items-center gap-2">
                  <Coins className="h-4 w-4 text-stone-400" strokeWidth={1.5} />
                  <Dialog.Title className="font-serif text-xl font-medium tracking-tight text-stone-900 dark:text-stone-100">
                    Registrar Liquidación de Fondos
                  </Dialog.Title>
                </div>
                <Dialog.Close asChild>
                  <button
                    type="button"
                    className="rounded-lg p-1 text-stone-400 hover:bg-stone-100 hover:text-stone-700 dark:hover:bg-stone-800 dark:hover:text-stone-200"
                  >
                    <X className="h-4 w-4" strokeWidth={1.5} />
                  </button>
                </Dialog.Close>
              </div>

              {liquidationFeedback && (
                <div
                  className={`mt-4 rounded-xl border p-3.5 text-xs ${
                    liquidationFeedback.ok
                      ? 'border-emerald-700/20 bg-emerald-50 text-emerald-800 dark:border-emerald-500/30 dark:bg-emerald-950/40 dark:text-emerald-300'
                      : 'border-rose-700/25 bg-rose-50 text-rose-700 dark:border-rose-500/35 dark:bg-rose-950/40 dark:text-rose-400'
                  }`}
                >
                  {liquidationFeedback.message}
                </div>
              )}

              <form onSubmit={handleCreateLiquidation} className="mt-4 space-y-4">
                {/* Selector de Cliente */}
                <div>
                  <label
                    htmlFor="liq-client-select"
                    className="block text-[11px] font-medium uppercase tracking-wider text-stone-500 dark:text-stone-400"
                  >
                    Cliente Titular *
                  </label>
                  <select
                    id="liq-client-select"
                    required
                    value={selectedClientForLiq?.id ?? ''}
                    onChange={(e) => {
                      const found = clients.find((c) => c.id === e.target.value) ?? null;
                      setSelectedClientForLiq(found);
                      if (found) {
                        setLiqDestinatario(`A favor de ${found.nombre_titular}`);
                      }
                    }}
                    className="mt-1.5 w-full rounded-lg border border-stone-200 bg-[#FAF9F6] px-3.5 py-2 text-sm text-stone-900 focus:border-amber-700 focus:outline-none dark:border-stone-800 dark:bg-[#121110] dark:text-stone-100"
                  >
                    {clients.map((c) => {
                      const disp = c.saldo_disponible_usd ?? Math.round((c.total_neto_usd - (c.total_liquidado_usd ?? 0)) * 100) / 100;
                      return (
                        <option key={c.id} value={c.id}>
                          {c.nombre_titular} — Saldo Disponible: {formatMoney(disp, 'USD')} USD
                        </option>
                      );
                    })}
                  </select>
                </div>

                {/* Tarjeta de Cálculo Dinámico en Vivo */}
                {selectedClientForLiq && (() => {
                  const maxAvail =
                    liqMoneda === 'USDT'
                      ? (selectedClientForLiq.saldo_disponible_usdt ?? selectedClientForLiq.total_neto_usdt)
                      : (selectedClientForLiq.saldo_disponible_usd ?? Math.round((selectedClientForLiq.total_neto_usd - (selectedClientForLiq.total_liquidado_usd ?? 0)) * 100) / 100);
                  const numInput = parseFloat(liqMonto) || 0;
                  const remaining = Math.round((maxAvail - numInput) * 100) / 100;
                  const isOver = remaining < -0.009;

                  return (
                    <div className="space-y-2 rounded-xl border border-stone-200 bg-[#FAF9F6] p-3.5 text-xs dark:border-stone-800 dark:bg-[#121110]">
                      <div className="flex items-center justify-between text-stone-500 dark:text-stone-400">
                        <span>Saldo Disponible Actual:</span>
                        <span className={`font-mono text-sm font-semibold tabular-nums ${maxAvail < 0 ? 'text-rose-700 dark:text-rose-400' : 'text-stone-900 dark:text-stone-100'}`}>
                          {formatMoney(maxAvail, liqMoneda)} {liqMoneda === 'USD' ? 'USD' : ''}
                        </span>
                      </div>
                      <div className="flex items-center justify-between text-stone-500 dark:text-stone-400">
                        <span>Monto a Liquidar:</span>
                        <span className="font-mono text-sm font-semibold tabular-nums text-rose-700 dark:text-rose-400">
                          -{formatMoney(numInput, liqMoneda)} {liqMoneda === 'USD' ? 'USD' : ''}
                        </span>
                      </div>
                      <div className="flex items-center justify-between border-t border-stone-200 pt-1.5 dark:border-stone-800">
                        <span className="font-medium text-stone-700 dark:text-stone-300">
                          {isOver ? 'Saldo en Contra Resultante (Adelanto):' : 'Saldo Restante Resultante:'}
                        </span>
                        <span className={`font-mono text-base font-semibold tabular-nums ${isOver ? 'text-rose-700 dark:text-rose-400' : 'text-emerald-700 dark:text-emerald-400'}`}>
                          {formatMoney(remaining, liqMoneda)} {liqMoneda === 'USD' ? 'USD' : ''}
                        </span>
                      </div>
                      {isOver && (
                        <div className="flex items-start gap-2 rounded-lg border border-amber-700/25 bg-amber-50 px-2.5 py-2 text-[11px] font-medium text-amber-900 dark:border-amber-500/35 dark:bg-amber-950/35 dark:text-amber-300">
                          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-700 dark:text-amber-400" strokeWidth={1.5} />
                          <span>
                            Liquidación por encima del saldo actual (+{formatMoney(Math.abs(remaining), liqMoneda)} de adelanto/cuadre). Permitido: el cliente quedará con saldo negativo de{' '}
                            <strong className="font-mono text-rose-700 dark:text-rose-400">{formatMoney(remaining, liqMoneda)}</strong> y se descontará automáticamente de sus próximos pagos conciliados.
                          </span>
                        </div>
                      )}
                    </div>
                  );
                })()}

                {/* Fila Monto y Moneda */}
                <div className="grid grid-cols-3 gap-3">
                  <div className="col-span-2">
                    <div className="flex items-center justify-between">
                      <label
                        htmlFor="liq-amount"
                        className="block text-[11px] font-medium uppercase tracking-wider text-stone-500 dark:text-stone-400"
                      >
                        Monto a Liquidar *
                      </label>
                      {selectedClientForLiq && (
                        <button
                          type="button"
                          onClick={() => {
                            const maxAvail =
                              liqMoneda === 'USDT'
                                ? (selectedClientForLiq.saldo_disponible_usdt ?? selectedClientForLiq.total_neto_usdt)
                                : (selectedClientForLiq.saldo_disponible_usd ?? Math.round((selectedClientForLiq.total_neto_usd - (selectedClientForLiq.total_liquidado_usd ?? 0)) * 100) / 100);
                            setLiqMonto(Math.max(0, maxAvail).toFixed(2));
                          }}
                          className="text-[11px] font-medium text-amber-700 hover:underline dark:text-amber-500"
                        >
                          Liquidar Todo
                        </button>
                      )}
                    </div>
                    <div className="relative mt-1.5">
                      <span className="absolute left-3 top-2 font-mono text-sm text-stone-400">$</span>
                      <input
                        id="liq-amount"
                        type="number"
                        step="0.01"
                        min="0.01"
                        required
                        value={liqMonto}
                        onChange={(e) => setLiqMonto(e.target.value)}
                        placeholder="Ej. 2000.00"
                        className="w-full rounded-lg border border-stone-200 bg-[#FAF9F6] py-2 pl-7 pr-3 font-mono text-sm text-stone-900 placeholder-stone-400 focus:border-amber-700 focus:outline-none dark:border-stone-800 dark:bg-[#121110] dark:text-stone-100"
                      />
                    </div>
                  </div>

                  <div>
                    <label
                      htmlFor="liq-currency"
                      className="block text-[11px] font-medium uppercase tracking-wider text-stone-500 dark:text-stone-400"
                    >
                      Moneda
                    </label>
                    <select
                      id="liq-currency"
                      value={liqMoneda}
                      onChange={(e) => setLiqMoneda(e.target.value as CurrencyType)}
                      className="mt-1.5 w-full rounded-lg border border-stone-200 bg-[#FAF9F6] px-3 py-2 text-sm text-stone-900 focus:border-amber-700 focus:outline-none dark:border-stone-800 dark:bg-[#121110] dark:text-stone-100"
                    >
                      <option value="USD">USD</option>
                      <option value="USDT">USDT</option>
                    </select>
                  </div>
                </div>

                {/* Destinatario / A favor de */}
                <div>
                  <label
                    htmlFor="liq-dest"
                    className="block text-[11px] font-medium uppercase tracking-wider text-stone-500 dark:text-stone-400"
                  >
                    Destinatario / Beneficiario del Pago *
                  </label>
                  <input
                    id="liq-dest"
                    type="text"
                    required
                    value={liqDestinatario}
                    onChange={(e) => setLiqDestinatario(e.target.value)}
                    placeholder="Ej. A equis persona / Carlos Perez (0414-1234567)"
                    className="mt-1.5 w-full rounded-lg border border-stone-200 bg-[#FAF9F6] px-3.5 py-2 text-sm text-stone-900 placeholder-stone-400 focus:border-amber-700 focus:outline-none dark:border-stone-800 dark:bg-[#121110] dark:text-stone-100"
                  />
                  <p className="mt-1 text-[11px] text-stone-500 dark:text-stone-400">
                    Nombre o cuenta de la persona que recibe el dinero.
                  </p>
                </div>

                {/* Motivo o Concepto */}
                <div>
                  <label
                    htmlFor="liq-motivo"
                    className="block text-[11px] font-medium uppercase tracking-wider text-stone-500 dark:text-stone-400"
                  >
                    Motivo / Concepto de Liquidación *
                  </label>
                  <input
                    id="liq-motivo"
                    type="text"
                    required
                    value={liqMotivo}
                    onChange={(e) => setLiqMotivo(e.target.value)}
                    placeholder="Ej. Liquidación solicitada por WhatsApp / Pago a proveedor"
                    className="mt-1.5 w-full rounded-lg border border-stone-200 bg-[#FAF9F6] px-3.5 py-2 text-sm text-stone-900 placeholder-stone-400 focus:border-amber-700 focus:outline-none dark:border-stone-800 dark:bg-[#121110] dark:text-stone-100"
                  />
                </div>

                {/* Método y Referencia de Salida */}
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label
                      htmlFor="liq-metodo"
                      className="block text-[11px] font-medium uppercase tracking-wider text-stone-500 dark:text-stone-400"
                    >
                      Método de Salida
                    </label>
                    <select
                      id="liq-metodo"
                      value={liqMetodo}
                      onChange={(e) => setLiqMetodo(e.target.value as LiquidationPaymentMethod)}
                      className="mt-1.5 w-full rounded-lg border border-stone-200 bg-[#FAF9F6] px-3 py-2 text-xs text-stone-900 focus:border-amber-700 focus:outline-none dark:border-stone-800 dark:bg-[#121110] dark:text-stone-100"
                    >
                      <option value="ZELLE">Zelle</option>
                      <option value="PAGO_MOVIL">Pago Móvil</option>
                      <option value="BINANCE_USDT">Binance USDT</option>
                      <option value="TRANSFERENCIA_BANCARIA">Transferencia Bancaria</option>
                      <option value="EFECTIVO">Efectivo</option>
                      <option value="OTRO">Otro</option>
                    </select>
                  </div>

                  <div>
                    <label
                      htmlFor="liq-ref"
                      className="block text-[11px] font-medium uppercase tracking-wider text-stone-500 dark:text-stone-400"
                    >
                      Referencia de Salida
                    </label>
                    <input
                      id="liq-ref"
                      type="text"
                      value={liqReferencia}
                      onChange={(e) => setLiqReferencia(e.target.value)}
                      placeholder="Ej. 6475855297 / TxID"
                      className="mt-1.5 w-full rounded-lg border border-stone-200 bg-[#FAF9F6] px-3.5 py-2 font-mono text-xs text-stone-900 placeholder-stone-400 focus:border-amber-700 focus:outline-none dark:border-stone-800 dark:bg-[#121110] dark:text-stone-100"
                    />
                  </div>
                </div>

                {/* Checkbox Archivar ciclo actual */}
                <div className="rounded-xl border border-stone-200 bg-[#FAF9F6] p-3 dark:border-stone-800 dark:bg-[#121110]">
                  <label className="flex cursor-pointer items-start gap-2.5 text-xs text-stone-600 dark:text-stone-300">
                    <input
                      type="checkbox"
                      checked={liqArchivar}
                      onChange={(e) => setLiqArchivar(e.target.checked)}
                      className="mt-0.5 rounded border-stone-300 text-stone-900 dark:border-stone-700 dark:bg-stone-900"
                    />
                    <div>
                      <span className="font-medium text-stone-900 dark:text-stone-100">
                        Archivar comprobantes del ciclo actual
                      </span>
                      <p className="mt-0.5 text-[11px] text-stone-500 dark:text-stone-400">
                        Cierra las capturas conciliadas previas para que el portal del cliente quede con cero historial de capturas activas en el nuevo ciclo.
                      </p>
                    </div>
                  </label>
                </div>

                {/* Botones de acción */}
                <div className="flex items-center justify-end gap-3 border-t border-stone-200 pt-4 dark:border-stone-800">
                  <Dialog.Close asChild>
                    <button
                      type="button"
                      className="rounded-lg border border-stone-200 px-4 py-2 text-xs font-medium text-stone-700 hover:bg-stone-100 dark:border-stone-800 dark:text-stone-300 dark:hover:bg-stone-900"
                    >
                      Cancelar
                    </button>
                  </Dialog.Close>
                  <button
                    type="submit"
                    disabled={isSubmittingLiquidation}
                    className="inline-flex items-center gap-2 rounded-lg bg-stone-900 px-5 py-2 text-xs font-medium text-stone-50 hover:bg-stone-800 disabled:opacity-60 dark:bg-stone-100 dark:text-stone-950 dark:hover:bg-white"
                  >
                    {isSubmittingLiquidation ? (
                      <Loader2 className="h-4 w-4 animate-spin" strokeWidth={1.5} />
                    ) : (
                      <CheckCircle2 className="h-4 w-4" strokeWidth={1.5} />
                    )}
                    Confirmar Liquidación
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
