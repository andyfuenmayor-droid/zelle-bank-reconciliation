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
  ShieldCheck,
  Sparkles,
  Trash2,
  UserCheck,
  UserPlus,
  Users,
  Wallet,
  X,
} from 'lucide-react';
import LandingPageView from '@/components/LandingPageView';
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
  return `$${formatted}`;
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
        badgeClass: 'border-sky-500/30 bg-sky-500/15 text-sky-300',
      };
    case 'TD_BANK':
      return {
        label: 'TD Bank',
        badgeClass: 'border-emerald-500/30 bg-emerald-500/15 text-emerald-300',
      };
    case 'BINANCE_PAY':
      return {
        label: 'Binance Pay',
        badgeClass: 'border-amber-500/30 bg-amber-500/15 text-amber-300',
      };
    case 'BINANCE_P2P':
      return {
        label: 'Binance P2P',
        badgeClass: 'border-yellow-500/30 bg-yellow-500/15 text-yellow-300',
      };
    case 'BINANCE_ONCHAIN':
      return {
        label: 'Depósito Red',
        badgeClass: 'border-purple-500/30 bg-purple-500/15 text-purple-300',
      };
    default:
      return {
        label: 'Otro',
        badgeClass: 'border-slate-600 bg-slate-800 text-slate-300',
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

  // Tolerancia de 1 carácter por lectura OCR en códigos de confirmación de 8-9 caracteres
  // (ej. "Ik9lpx0ib" vs "BACLK9LPX0IB", "Ibllortmf" vs "BACLBLLORTMF", "rjsnfkdk9" vs "BACRJSNFKDQ9")
  if (cleanOrder.length >= 8 && cleanTx.length >= cleanOrder.length) {
    const txSuffix = cleanTx.slice(-cleanOrder.length);
    if (levenshteinDistance(cleanOrder, txSuffix) <= 1) {
      return true;
    }
  }

  return false;
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

  const fetchAllData = useCallback(async () => {
    if (!currentBusinessUser || !activeNegocioId) {
      return;
    }

    setIsLoading(true);
    try {
      const reqHeaders = buildScopeHeaders(false);
      const [alertsRes, clientsRes, mailboxesRes, authRes, liqRes] = await Promise.all([
        fetch('/api/reconciliation/alerts', {
          cache: 'no-store',
          headers: reqHeaders,
        }),
        fetch('/api/reconciliation/clients', {
          cache: 'no-store',
          headers: reqHeaders,
        }),
        fetch('/api/reconciliation/mailboxes', {
          cache: 'no-store',
          headers: reqHeaders,
        }),
        fetch(
          `/api/auth/business?userId=${encodeURIComponent(currentBusinessUser.id)}`,
          { cache: 'no-store' }
        ),
        fetch('/api/reconciliation/liquidations', {
          cache: 'no-store',
          headers: reqHeaders,
        }),
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
          setCurrentBusinessUser(aData.user);
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
  }, [activeNegocioId, buildScopeHeaders, currentBusinessUser]);

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

      const savedUserId = window.localStorage.getItem(STORAGE_BUSINESS_USER_KEY);
      if (!savedUserId) {
        if (active) {
          setIsCheckingAuth(false);
        }
        return;
      }

      try {
        const res = await fetch(
          `/api/auth/business?userId=${encodeURIComponent(savedUserId)}`,
          { cache: 'no-store' }
        );
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
    if (currentBusinessUser && activeNegocioId) {
      void fetchAllData();
      void fetchAiSettings();
    }
  }, [currentBusinessUser, activeNegocioId, fetchAllData, fetchAiSettings]);

  // Métricas separadas para Bloque Zelle (USD) y Bloque Binance (USDT)
  // REGLA FINANCIERA: Los totales financieros principales calculan EXCLUSIVAMENTE
  // los pagos CONCILIADOS (item.estado === 'CONCILIADO' && item.tipo_movimiento === 'RECIBIDO').
  // Las alertas en DETECTADO o REVISION_MANUAL aún no pertenecen a ningún cliente
  // y por ende no devengan comisiones ni constituyen fondos acreditables.
  const financialMetrics = useMemo<FinancialSummaryMetrics>(() => {
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
  }, [alerts]);

  // Desglose vivo de Titulares / Clientes con Fondos Conciliados Reales
  const clientsWithReconciledFunds = useMemo(() => {
    return clients.map((c) => {
      const clientAlerts = alerts.filter(
        (a) =>
          a.estado === 'CONCILIADO' &&
          a.tipo_movimiento === 'RECIBIDO' &&
          (a.cliente_id === c.id ||
            (a.cliente_asignado_nombre &&
              a.cliente_asignado_nombre.trim().toLowerCase() ===
                c.nombre_titular.trim().toLowerCase()))
      );

      const brutoUsd = clientAlerts
        .filter((a) => a.moneda !== 'USDT')
        .reduce((sum, a) => sum + a.monto_bruto, 0);
      const comisionUsd = clientAlerts
        .filter((a) => a.moneda !== 'USDT')
        .reduce((sum, a) => sum + a.monto_comision, 0);
      const netoUsd = clientAlerts
        .filter((a) => a.moneda !== 'USDT')
        .reduce((sum, a) => sum + a.monto_neto, 0);

      const brutoUsdt = clientAlerts
        .filter((a) => a.moneda === 'USDT')
        .reduce((sum, a) => sum + a.monto_bruto, 0);
      const comisionUsdt = clientAlerts
        .filter((a) => a.moneda === 'USDT')
        .reduce((sum, a) => sum + a.monto_comision, 0);
      const netoUsdt = clientAlerts
        .filter((a) => a.moneda === 'USDT')
        .reduce((sum, a) => sum + a.monto_neto, 0);

      const count = clientAlerts.length;

      return {
        ...c,
        total_bruto_usd: count > 0 ? Math.round(brutoUsd * 100) / 100 : c.total_bruto_usd,
        total_comision_usd: count > 0 ? Math.round(comisionUsd * 100) / 100 : c.total_comision_usd,
        total_neto_usd: count > 0 ? Math.round(netoUsd * 100) / 100 : c.total_neto_usd,
        total_bruto_usdt: count > 0 ? Math.round(brutoUsdt * 100) / 100 : c.total_bruto_usdt,
        total_comision_usdt: count > 0 ? Math.round(comisionUsdt * 100) / 100 : c.total_comision_usdt,
        total_neto_usdt: count > 0 ? Math.round(netoUsdt * 100) / 100 : c.total_neto_usdt,
        pagos_conciliados_count: count > 0 ? count : c.pagos_conciliados_count,
      };
    });
  }, [clients, alerts]);

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
        (a) => a.estado !== 'CONCILIADO' && a.tipo_movimiento === 'RECIBIDO'
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
    // Buscar si existe algún correo DETECTADO del mismo monto y moneda que coincida por referencia o remitente
    const candidateTx = alerts.find(
      (a) =>
        a.estado !== 'CONCILIADO' &&
        a.tipo_movimiento === 'RECIBIDO' &&
        a.moneda === order.moneda &&
        Math.abs(a.monto_bruto - order.monto_esperado) < 0.01 &&
        (referencesMatch(order.referencia_reportada, a.referencia) ||
          calculateSenderSimilarity(
            order.remitente_reportado || order.nombre_remitente_reportado || '',
            a.remitente_o_contraparte || ''
          ) >= 0.65)
    );
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

    const maxAvailable =
      liqMoneda === 'USDT'
        ? (selectedClientForLiq.saldo_disponible_usdt ?? selectedClientForLiq.total_neto_usdt)
        : (selectedClientForLiq.saldo_disponible_usd ?? selectedClientForLiq.total_neto_usd);

    if (amount > maxAvailable + 0.009) {
      setLiquidationFeedback({
        ok: false,
        message: `Monto insuficiente: El monto a liquidar ($${amount.toFixed(2)}) supera el saldo disponible actual ($${maxAvailable.toFixed(2)} ${liqMoneda}).`,
      });
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
    const matchingTx =
      alerts.find(
        (t) =>
          t.orden_conciliada_id === order.id ||
          (t.moneda === order.moneda &&
            Math.abs(t.monto_bruto - order.monto_esperado) < 0.01 &&
            (referencesMatch(order.referencia_reportada, t.referencia) ||
              calculateSenderSimilarity(
                order.remitente_reportado || order.nombre_remitente_reportado || '',
                t.remitente_o_contraparte || ''
              ) >= 0.35))
      ) ?? null;

    setLightboxData({
      title: `Captura Subida en Portal · ${order.codigo_orden}`,
      comprobanteBase64: captureBase64,
      order,
      tx: matchingTx,
    });
  };

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
    setCurrentBusinessUser(null);
    setBusinessUsers([]);
    setActiveNegocioId('');
    setAlerts([]);
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
      <div className="flex min-h-screen items-center justify-center bg-slate-950 text-slate-300">
        <div className="flex items-center gap-3 text-sm">
          <Loader2 className="h-5 w-5 animate-spin text-emerald-400" />
          Cargando Plataforma ConciliaPay...
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
            <Dialog.Overlay className="fixed inset-0 z-40 bg-slate-950/85 backdrop-blur-sm" />
            <Dialog.Content className="fixed left-1/2 top-1/2 z-50 w-[92vw] max-w-md -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-slate-800 bg-slate-900 p-6 text-slate-100 shadow-2xl">
              <div className="flex items-start justify-between border-b border-slate-800 pb-4">
                <div>
                  <Dialog.Title className="flex items-center gap-2 text-lg font-bold text-white">
                    <Lock className="h-4 w-4 text-emerald-400" />
                    Acceso de Usuarios y Negocios
                  </Dialog.Title>
                  <Dialog.Description className="mt-1 text-xs text-slate-400">
                    Ingresa con el correo y la contraseña asignados a tu negocio.
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

              {loginError && (
                <div className="mt-4 rounded-xl border border-rose-500/40 bg-rose-950/50 px-3.5 py-2.5 text-xs text-rose-200">
                  {loginError}
                </div>
              )}

              <form
                onSubmit={(e) => void handleBusinessLoginSubmit(e)}
                className="mt-4 space-y-4"
              >
                <div>
                  <label className="block text-xs font-semibold uppercase text-slate-300">
                    Correo Electrónico *
                  </label>
                  <input
                    type="email"
                    required
                    value={loginEmail}
                    onChange={(e) => setLoginEmail(e.target.value)}
                    placeholder="usuario@tunegocio.com"
                    className="mt-1.5 w-full rounded-xl border border-slate-700 bg-slate-950 px-3.5 py-2.5 text-sm text-white focus:border-emerald-500 focus:outline-none"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold uppercase text-slate-300">
                    Contraseña *
                  </label>
                  <input
                    type="password"
                    required
                    value={loginPassword}
                    onChange={(e) => setLoginPassword(e.target.value)}
                    placeholder="••••••••"
                    className="mt-1.5 w-full rounded-xl border border-slate-700 bg-slate-950 px-3.5 py-2.5 text-sm text-white focus:border-emerald-500 focus:outline-none"
                  />
                </div>

                <button
                  type="submit"
                  disabled={isSubmittingLogin}
                  className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-emerald-600 px-5 py-3 text-sm font-bold text-white shadow-lg shadow-emerald-950/50 transition hover:bg-emerald-500 disabled:opacity-60"
                >
                  {isSubmittingLogin ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <LogIn className="h-4 w-4" />
                  )}
                  Entrar al Panel del Negocio
                </button>

                <div className="border-t border-slate-800 pt-3 text-center text-[11px] text-slate-400">
                  ¿Eres cliente final reportando un comprobante?{' '}
                  <Link
                    href="/portal"
                    className="font-semibold text-sky-400 hover:text-sky-300"
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
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <div className="mx-auto w-full max-w-[1920px] px-2 py-6 sm:px-4 lg:px-6">
        {/* Encabezado Principal */}
        <header className="mb-6 flex flex-col gap-4 border-b border-slate-800/80 pb-6 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <div className="flex flex-wrap items-center gap-2.5">
              <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-3 py-1 text-xs font-semibold tracking-wide text-emerald-400">
                <ShieldCheck className="h-3.5 w-3.5" />
                MULTI-CHANNEL FINTECH ENGINE
              </span>
              <span className="inline-flex items-center gap-1.5 rounded-full border border-violet-500/30 bg-violet-500/15 px-3 py-1 text-xs font-semibold text-violet-200">
                <Briefcase className="h-3.5 w-3.5 text-violet-400" />
                {activeBusinessRecord?.nombre_negocio ?? 'Negocio Activo'}
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
                  ? `${mailboxes.length} correo(s) IMAP`
                  : 'Sin correo IMAP configurado'}
              </span>
            </div>
            <h1 className="mt-2 text-2xl font-bold tracking-tight text-white sm:text-3xl">
              Conciliación Multi-Canal: Zelle &amp; Binance
            </h1>
            <p className="mt-1 text-sm text-slate-400">
              Operador: <strong className="text-slate-200">{currentBusinessUser.nombre_usuario}</strong> ({currentBusinessUser.email}) · Citibank, TD Bank &amp; Binance
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {currentBusinessUser.rol === 'SUPER_ADMIN' &&
              businessUsers.length > 1 && (
                <select
                  value={activeNegocioId}
                  onChange={(e) => handleSwitchBusinessScope(e.target.value)}
                  aria-label="Seleccionar negocio activo"
                  className="rounded-lg border border-violet-500/40 bg-slate-900 px-3 py-2 text-xs font-semibold text-violet-200 focus:border-violet-400 focus:outline-none"
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
              onClick={() => setIsPreviewingLanding(true)}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-xs font-medium text-sky-300 transition hover:border-sky-500/50 hover:bg-slate-800"
            >
              <Globe className="h-3.5 w-3.5" />
              Ver Landing Page
            </button>

            <Link
              href="/portal"
              className="inline-flex items-center gap-1.5 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs font-semibold text-amber-300 transition hover:bg-amber-500/20"
            >
              <ExternalLink className="h-3.5 w-3.5" />
              Portal Clientes (/portal)
            </Link>

            <button
              type="button"
              onClick={() => void handleCopyPortalLink()}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-xs font-medium text-slate-300 transition hover:border-slate-600 hover:text-white"
              title="Copiar enlace del Portal de Clientes"
            >
              {portalLinkCopied ? (
                <>
                  <Check className="h-3.5 w-3.5 text-emerald-400" />
                  Link Copiado
                </>
              ) : (
                <>
                  <Copy className="h-3.5 w-3.5" />
                  Copiar Link Portal
                </>
              )}
            </button>

            <button
              type="button"
              onClick={openCreateClientModal}
              className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-500/40 bg-emerald-950/40 px-3 py-2 text-xs font-medium text-emerald-300 transition hover:bg-emerald-900/50"
            >
              <UserPlus className="h-3.5 w-3.5" />
              + Crear Acceso Cliente
            </button>

            <button
              type="button"
              onClick={() => setIsSimulatorOpen(true)}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-xs font-medium text-slate-200 transition hover:border-slate-600 hover:bg-slate-800"
            >
              <MailPlus className="h-3.5 w-3.5 text-sky-400" />
              Simular Email
            </button>

            <button
              type="button"
              onClick={() => void handleSyncImapNow()}
              disabled={isSyncingImap || isLoading}
              className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-xs font-semibold text-white shadow-lg shadow-emerald-950/50 transition hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isSyncingImap ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <RefreshCw className="h-3.5 w-3.5" />
              )}
              Sincronizar IMAP + Binance
            </button>

            <button
              type="button"
              onClick={handleBusinessLogout}
              className="inline-flex items-center gap-1.5 rounded-lg border border-rose-500/30 bg-rose-950/30 px-3 py-2 text-xs font-medium text-rose-300 hover:bg-rose-900/40"
            >
              <LogOut className="h-3.5 w-3.5" />
              Salir
            </button>
          </div>
        </header>

        {/* Navegación de Pestañas Principales */}
        <div className="mb-6 flex flex-wrap gap-2 border-b border-slate-800 pb-3">
          <button
            type="button"
            onClick={() => {
              setActiveTab('ALERTS');
              setMovementFilter('RECIBIDO');
            }}
            className={`inline-flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold transition ${
              activeTab === 'ALERTS'
                ? 'bg-emerald-600 text-white shadow-md shadow-emerald-950/50'
                : 'bg-slate-900 text-slate-300 hover:bg-slate-800'
            }`}
          >
            <DollarSign className="h-4 w-4" />
            1. Transacciones y Conciliación ({receivedAlertsCount})
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('EXPENSES')}
            className={`inline-flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold transition ${
              activeTab === 'EXPENSES'
                ? 'bg-rose-600 text-white shadow-md shadow-rose-950/50'
                : 'bg-slate-900 text-rose-300/80 hover:bg-slate-800'
            }`}
          >
            <CreditCard className="h-4 w-4 text-rose-400" />
            2. Egresos / Gastos Personales y Salidas ({sentAlertsCount})
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
            3. Clientes, Saldos y Órdenes ({clients.length} / {pendingOrders.length})
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('LIQUIDATIONS')}
            className={`inline-flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold transition ${
              activeTab === 'LIQUIDATIONS'
                ? 'bg-emerald-600 text-white shadow-md shadow-emerald-950/50'
                : 'bg-slate-900 text-slate-300 hover:bg-slate-800'
            }`}
          >
            <Coins className="h-4 w-4 text-emerald-400" />
            4. Liquidaciones ({liquidations.length})
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
            5. Correos IMAP Monitoreados ({mailboxes.length})
          </button>

          {currentBusinessUser.rol === 'SUPER_ADMIN' && (
            <button
              type="button"
              onClick={() => setActiveTab('BUSINESS_USERS')}
              className={`inline-flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold transition ${
                activeTab === 'BUSINESS_USERS'
                  ? 'bg-emerald-600 text-white shadow-md shadow-emerald-950/50'
                  : 'bg-slate-900 text-slate-300 hover:bg-slate-800'
              }`}
            >
              <Briefcase className="h-4 w-4" />
              6. Usuarios y Negocios ({businessUsers.length})
            </button>
          )}
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

        {/* =====================================================================
            TARJETAS SUPERIORES SEPARADAS: BLOQUE ZELLE (USD) + BLOQUE BINANCE (USDT)
           ===================================================================== */}
        <section
          aria-label="Resumen Financiero Multi-Canal"
          className="mb-8 grid grid-cols-1 gap-5 lg:grid-cols-2"
        >
          {/* Bloque Zelle (Citibank + TD Bank en USD) */}
          <div className="rounded-2xl border border-sky-500/25 bg-gradient-to-br from-slate-900 via-slate-900 to-sky-950/30 p-5 shadow-lg">
            <div className="mb-4 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="rounded-lg bg-sky-500/15 p-2 text-sky-400">
                  <Building2 className="h-4 w-4" />
                </span>
                <div>
                  <h2 className="text-sm font-bold text-white">
                    Bloque Zelle (Citibank + TD Bank)
                  </h2>
                  <p className="text-[11px] text-slate-400">
                    Total Conciliado Acreditado · Comisiones Reales
                  </p>
                </div>
              </div>
              <span className="rounded-full border border-sky-500/30 bg-sky-500/10 px-2.5 py-0.5 font-mono text-[11px] font-semibold text-sky-300">
                USD
              </span>
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <div className="rounded-xl border border-slate-800 bg-slate-950/80 p-3.5">
                <span className="text-[11px] font-medium uppercase text-slate-400">
                  Bruto Conciliado
                </span>
                <p className="mt-1.5 font-mono text-lg font-bold text-white">
                  {formatMoney(financialMetrics.zelleBrutoRecibidoUsd, 'USD')}
                </p>
                <span className="text-[10px] text-emerald-400/90 font-medium">
                  {financialMetrics.pagosConciliadosCount} pagos conciliados
                </span>
              </div>

              <div className="rounded-xl border border-slate-800 bg-slate-950/80 p-3.5">
                <span className="text-[11px] font-medium uppercase text-slate-400">
                  Comisión Retenida
                </span>
                <p className="mt-1.5 font-mono text-lg font-bold text-violet-300">
                  -{formatMoney(financialMetrics.zelleComisionRetenidaUsd, 'USD')}
                </p>
                <span className="text-[10px] text-slate-500">
                  Cobrada sobre conciliados
                </span>
              </div>

              <div className="rounded-xl border border-emerald-500/30 bg-emerald-950/30 p-3.5">
                <span className="text-[11px] font-semibold uppercase text-emerald-300">
                  Neto Liquidable
                </span>
                <p className="mt-1.5 font-mono text-lg font-bold text-emerald-400">
                  {formatMoney(financialMetrics.zelleNetoLiquidableUsd, 'USD')}
                </p>
                <span className="text-[10px] text-emerald-300/70">
                  Acreditable a Clientes
                </span>
              </div>
            </div>

            {/* Desglose de Titular(es) Beneficiarios del Saldo Acreditado */}
            {clientsWithReconciledFunds.some((c) => c.total_neto_usd > 0 || c.pagos_conciliados_count > 0) && (
              <div className="mt-3.5 rounded-xl border border-emerald-500/30 bg-emerald-950/25 p-3.5">
                <div className="mb-2 flex items-center justify-between">
                  <div className="flex items-center gap-1.5 text-xs font-bold text-emerald-300">
                    <UserCheck className="h-4 w-4 text-emerald-400" />
                    <span>¿De quién es este dinero? Titular(es) Acreditados:</span>
                  </div>
                  <span className="text-[10px] text-slate-400">
                    Click para filtrar movimientos
                  </span>
                </div>

                <div className="space-y-2">
                  {clientsWithReconciledFunds
                    .filter((c) => c.total_neto_usd > 0 || c.pagos_conciliados_count > 0)
                    .map((client) => {
                      const isSelected = selectedClientFilter === client.id;
                      return (
                        <div
                          key={client.id}
                          onClick={() =>
                            setSelectedClientFilter(
                              isSelected ? 'TODOS' : client.id
                            )
                          }
                          className={`flex items-center justify-between rounded-lg p-2.5 transition-all cursor-pointer border ${
                            isSelected
                              ? 'border-emerald-400 bg-emerald-500/25 ring-1 ring-emerald-400 shadow-md'
                              : 'border-slate-800 bg-slate-900/90 hover:border-emerald-500/50 hover:bg-slate-900'
                          }`}
                          title={`Click para filtrar solo las transacciones de ${client.nombre_titular}`}
                        >
                          <div className="flex items-center gap-2.5">
                            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-emerald-500/20 font-mono text-xs font-bold text-emerald-300 ring-1 ring-emerald-500/40">
                              {client.nombre_titular.slice(0, 2).toUpperCase()}
                            </div>
                            <div>
                              <div className="flex items-center gap-2">
                                <span className="text-xs font-bold text-white">
                                  {client.nombre_titular}
                                </span>
                                <span className="rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.2 text-[10px] font-semibold text-emerald-300">
                                  {client.pagos_conciliados_count} pagos conciliados
                                </span>
                              </div>
                              <p className="text-[11px] text-slate-400">
                                Bruto: <strong className="text-slate-200">{formatMoney(client.total_bruto_usd, 'USD')}</strong> · Com ({client.porcentaje_comision_zelle}%): <span className="text-violet-300">-{formatMoney(client.total_comision_usd, 'USD')}</span>
                              </p>
                            </div>
                          </div>

                          <div className="text-right pl-3">
                            <div className="font-mono text-sm font-bold text-emerald-400">
                              {formatMoney(client.total_neto_usd, 'USD')}
                            </div>
                            <div className="text-[10px] text-slate-400 font-medium">
                              Neto Acreditable
                            </div>
                          </div>
                        </div>
                      );
                    })}
                </div>
              </div>
            )}

            {financialMetrics.zellePorConciliarUsd > 0 && (
              <div className="mt-3.5 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-sky-500/20 bg-sky-950/30 px-3.5 py-2 text-xs text-sky-200/90">
                <div className="flex items-center gap-2">
                  <Clock className="h-4 w-4 text-sky-400 shrink-0" />
                  <span>
                    <strong className="font-semibold text-white">En espera por conciliar:</strong> {formatMoney(financialMetrics.zellePorConciliarUsd, 'USD')} ({financialMetrics.pagosRevisionManualCount + financialMetrics.pagosDetectadosCount} correos)
                  </span>
                </div>
                <span className="text-[11px] text-sky-300/70">
                  Sin cliente asignado · Comisión 0% hasta conciliar
                </span>
              </div>
            )}
          </div>

          {/* Bloque Binance (Pay + P2P + On-Chain en USDT) */}
          <div className="rounded-2xl border border-amber-500/25 bg-gradient-to-br from-slate-900 via-slate-900 to-amber-950/25 p-5 shadow-lg">
            <div className="mb-4 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="rounded-lg bg-amber-500/15 p-2 text-amber-400">
                  <Coins className="h-4 w-4" />
                </span>
                <div>
                  <h2 className="text-sm font-bold text-white">
                    Bloque Binance (Pay + P2P + On-Chain)
                  </h2>
                  <p className="text-[11px] text-slate-400">
                    Total Conciliado USDT · Comisiones Reales
                  </p>
                </div>
              </div>
              <span className="rounded-full border border-amber-500/30 bg-amber-500/10 px-2.5 py-0.5 font-mono text-[11px] font-semibold text-amber-300">
                USDT
              </span>
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <div className="rounded-xl border border-slate-800 bg-slate-950/80 p-3.5">
                <span className="text-[11px] font-medium uppercase text-slate-400">
                  Total USDT Conciliado
                </span>
                <p className="mt-1.5 font-mono text-lg font-bold text-white">
                  {formatMoney(financialMetrics.binanceRecibidoUsdt, 'USDT')}
                </p>
                <span className="text-[10px] text-amber-300/80">
                  Recibido y conciliado
                </span>
              </div>

              <div className="rounded-xl border border-slate-800 bg-slate-950/80 p-3.5">
                <span className="text-[11px] font-medium uppercase text-slate-400">
                  Comisión Retenida USDT
                </span>
                <p className="mt-1.5 font-mono text-lg font-bold text-violet-300">
                  -{formatMoney(financialMetrics.binanceComisionRetenidaUsdt, 'USDT')}
                </p>
                <span className="text-[10px] text-slate-500">
                  Fee cobrado sobre conciliados
                </span>
              </div>

              <div className="rounded-xl border border-amber-500/30 bg-amber-950/25 p-3.5">
                <span className="text-[11px] font-semibold uppercase text-amber-300">
                  Neto USDT Liquidable
                </span>
                <p className="mt-1.5 font-mono text-lg font-bold text-amber-300">
                  {formatMoney(financialMetrics.binanceNetoDisponibleUsdt, 'USDT')}
                </p>
                <span className="text-[10px] text-amber-300/70">
                  Saldo líquido USDT
                </span>
              </div>
            </div>

            {/* Desglose de Titular(es) en USDT */}
            {clientsWithReconciledFunds.some((c) => c.total_neto_usdt > 0) && (
              <div className="mt-3.5 rounded-xl border border-amber-500/30 bg-amber-950/25 p-3.5">
                <div className="mb-2 flex items-center justify-between">
                  <div className="flex items-center gap-1.5 text-xs font-bold text-amber-300">
                    <UserCheck className="h-4 w-4 text-amber-400" />
                    <span>Titular(es) Acreditados en USDT:</span>
                  </div>
                  <span className="text-[10px] text-slate-400">
                    Click para filtrar por cliente
                  </span>
                </div>

                <div className="space-y-2">
                  {clientsWithReconciledFunds
                    .filter((c) => c.total_neto_usdt > 0)
                    .map((client) => {
                      const isSelected = selectedClientFilter === client.id;
                      return (
                        <div
                          key={client.id}
                          onClick={() =>
                            setSelectedClientFilter(
                              isSelected ? 'TODOS' : client.id
                            )
                          }
                          className={`flex items-center justify-between rounded-lg p-2.5 transition-all cursor-pointer border ${
                            isSelected
                              ? 'border-amber-400 bg-amber-500/25 ring-1 ring-amber-400 shadow-md'
                              : 'border-slate-800 bg-slate-900/90 hover:border-amber-500/50 hover:bg-slate-900'
                          }`}
                        >
                          <div className="flex items-center gap-2.5">
                            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-amber-500/20 font-mono text-xs font-bold text-amber-300 ring-1 ring-amber-500/40">
                              {client.nombre_titular.slice(0, 2).toUpperCase()}
                            </div>
                            <div>
                              <div className="text-xs font-bold text-white">
                                {client.nombre_titular}
                              </div>
                              <p className="text-[11px] text-slate-400">
                                Fee ({client.porcentaje_comision_binance}%): <span className="text-violet-300">-{formatMoney(client.total_comision_usdt, 'USDT')}</span>
                              </p>
                            </div>
                          </div>
                          <div className="text-right pl-3">
                            <div className="font-mono text-sm font-bold text-amber-300">
                              {formatMoney(client.total_neto_usdt, 'USDT')}
                            </div>
                            <div className="text-[10px] text-slate-400">
                              Neto USDT
                            </div>
                          </div>
                        </div>
                      );
                    })}
                </div>
              </div>
            )}

            {financialMetrics.binancePorConciliarUsdt > 0 && (
              <div className="mt-3.5 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-amber-500/20 bg-amber-950/30 px-3.5 py-2 text-xs text-amber-200/90">
                <div className="flex items-center gap-2">
                  <Clock className="h-4 w-4 text-amber-400 shrink-0" />
                  <span>
                    <strong className="font-semibold text-white">En espera por conciliar:</strong> {formatMoney(financialMetrics.binancePorConciliarUsdt, 'USDT')}
                  </span>
                </div>
                <span className="text-[11px] text-amber-300/70">
                  Sin cliente asignado · Fee 0% hasta conciliar
                </span>
              </div>
            )}
          </div>
        </section>

        {/* Barra de Estado de Conciliación con Filtros Rápidos Clickeables */}
        <div className="mb-6 flex flex-wrap items-center gap-3 text-xs">
          <button
            type="button"
            onClick={() => {
              setActiveTab('ALERTS');
              setStatusFilter((prev) =>
                prev === 'CONCILIADO' ? 'TODOS' : 'CONCILIADO'
              );
            }}
            className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 font-semibold transition cursor-pointer ${
              statusFilter === 'CONCILIADO' && activeTab === 'ALERTS'
                ? 'border-emerald-400 bg-emerald-500/25 text-emerald-200 ring-2 ring-emerald-500/40 shadow-lg'
                : 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300 hover:bg-emerald-500/20'
            }`}
            title="Clic para filtrar únicamente pagos conciliados"
          >
            <CheckCircle2 className="h-3.5 w-3.5" />
            Conciliados: {financialMetrics.pagosConciliadosCount}
          </button>

          <button
            type="button"
            onClick={() => {
              setActiveTab('ALERTS');
              setStatusFilter((prev) =>
                prev === 'REVISION_MANUAL' ? 'TODOS' : 'REVISION_MANUAL'
              );
            }}
            className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 font-semibold transition cursor-pointer ${
              statusFilter === 'REVISION_MANUAL' && activeTab === 'ALERTS'
                ? 'border-amber-400 bg-amber-500/25 text-amber-100 ring-2 ring-amber-500/40 shadow-lg'
                : 'border-amber-500/30 bg-amber-500/10 text-amber-300 hover:bg-amber-500/20'
            }`}
            title="Clic para filtrar únicamente pagos en revisión manual"
          >
            <AlertTriangle className="h-3.5 w-3.5" />
            Revisión Manual: {financialMetrics.pagosRevisionManualCount}
          </button>

          <button
            type="button"
            onClick={() => {
              setActiveTab('ALERTS');
              setStatusFilter((prev) =>
                prev === 'DETECTADO' ? 'TODOS' : 'DETECTADO'
              );
            }}
            className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 font-semibold transition cursor-pointer ${
              statusFilter === 'DETECTADO' && activeTab === 'ALERTS'
                ? 'border-sky-400 bg-sky-500/25 text-sky-100 ring-2 ring-sky-500/40 shadow-lg'
                : 'border-sky-500/30 bg-sky-500/10 text-sky-300 hover:bg-sky-500/20'
            }`}
            title="Clic para filtrar pagos detectados sin orden vinculada"
          >
            <Clock className="h-3.5 w-3.5" />
            Detectados (Sin Orden): {financialMetrics.pagosDetectadosCount}
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('CLIENTS')}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-900 px-3 py-1.5 font-medium text-slate-300 transition hover:bg-slate-800 cursor-pointer"
            title="Clic para ir a la pestaña de clientes y órdenes pendientes"
          >
            <Wallet className="h-3.5 w-3.5 text-slate-400" />
            Órdenes Pendientes en Portal: {pendingOrders.length}
          </button>

          {selectedClientFilter !== 'TODOS' && (
            <div className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-500/40 bg-emerald-500/20 px-3 py-1.5 font-semibold text-emerald-200 text-xs shadow-md">
              <UserCheck className="h-3.5 w-3.5 text-emerald-400 shrink-0" />
              <span>
                Filtrando por:{' '}
                <strong className="text-white">
                  {selectedClientFilter === 'SIN_ASIGNAR'
                    ? 'Sin Asignar (En Espera)'
                    : clients.find((c) => c.id === selectedClientFilter)?.nombre_titular ?? selectedClientFilter}
                </strong>
              </span>
              <button
                type="button"
                onClick={() => setSelectedClientFilter('TODOS')}
                className="ml-1 rounded bg-emerald-500/30 px-1.5 py-0.5 text-[10px] text-white hover:bg-emerald-500/50 cursor-pointer"
                title="Quitar filtro de cliente"
              >
                ✕ Limpiar
              </button>
            </div>
          )}

          {statusFilter !== 'TODOS' && (
            <button
              type="button"
              onClick={() => setStatusFilter('TODOS')}
              className="text-[11px] font-medium text-slate-400 underline hover:text-white cursor-pointer"
            >
              (Mostrar Todos Estados)
            </button>
          )}
        </div>

        {/* =====================================================================
            PESTAÑA 1: TABLA DE TRANSACCIONES Y CONCILIACIÓN MULTICANAL
           ===================================================================== */}
        {activeTab === 'ALERTS' && (
          <>
            <section
              aria-label="Filtros de Conciliación"
              className="mb-6 rounded-xl border border-slate-800 bg-slate-900/70 p-4"
            >
              <div className="grid grid-cols-1 gap-4 md:grid-cols-12">
                <div className="relative md:col-span-4">
                  <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Buscar por remitente, TxID, referencia..."
                    className="w-full rounded-lg border border-slate-700 bg-slate-950 py-2 pl-10 pr-4 text-sm text-slate-100 placeholder-slate-500 focus:border-emerald-500 focus:outline-none"
                  />
                </div>

                {/* Filtro por Cliente Titular */}
                <div className="md:col-span-3">
                  <div className="relative">
                    <UserCheck className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-emerald-400" />
                    <select
                      value={selectedClientFilter}
                      onChange={(e) => setSelectedClientFilter(e.target.value)}
                      className="w-full rounded-lg border border-slate-700 bg-slate-950 py-2 pl-9 pr-3 text-sm text-slate-200 focus:border-emerald-500 focus:outline-none font-medium"
                    >
                      <option value="TODOS">Todos los Titulares</option>
                      <option value="SIN_ASIGNAR">⚠️ Sin Cliente (En Espera)</option>
                      {clients.map((c) => (
                        <option key={c.id} value={c.id}>
                          👤 {c.nombre_titular} ({formatMoney(c.total_neto_usd, 'USD')} neto)
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                <div className="md:col-span-2">
                  <div className="relative">
                    <Building2 className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                    <select
                      value={platformFilter}
                      onChange={(e) =>
                        setPlatformFilter(e.target.value as 'TODOS' | PlatformType)
                      }
                      className="w-full rounded-lg border border-slate-700 bg-slate-950 py-2 pl-9 pr-3 text-sm text-slate-200 focus:border-emerald-500 focus:outline-none"
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

                <div className="md:col-span-1">
                  <select
                    value={movementFilter}
                    onChange={(e) =>
                      setMovementFilter(
                        e.target.value as 'TODOS' | MovementType
                      )
                    }
                    className="w-full rounded-lg border border-slate-700 bg-slate-950 px-2 py-2 text-sm text-slate-200 focus:border-emerald-500 focus:outline-none"
                  >
                    <option value="TODOS">Flujos</option>
                    <option value="RECIBIDO">Recibido</option>
                    <option value="ENVIADO">Enviado</option>
                  </select>
                </div>

                <div className="md:col-span-2">
                  <div className="relative">
                    <Filter className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                    <select
                      value={statusFilter}
                      onChange={(e) =>
                        setStatusFilter(e.target.value as 'TODOS' | AlertStatus)
                      }
                      className="w-full rounded-lg border border-slate-700 bg-slate-950 py-2 pl-9 pr-3 text-sm text-slate-200 focus:border-emerald-500 focus:outline-none"
                    >
                      <option value="TODOS">Todos Estados</option>
                      <option value="CONCILIADO">Conciliado</option>
                      <option value="REVISION_MANUAL">Revisión Manual</option>
                      <option value="DETECTADO">Detectado</option>
                    </select>
                  </div>
                </div>
              </div>
            </section>

            {/* Barra de Acciones Masivas por Lote (Bulk Actions) */}
            {selectedAlertIds.length > 0 && (
              <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-emerald-500/40 bg-emerald-950/80 p-4 shadow-xl shadow-emerald-950/50">
                <div className="flex items-center gap-3">
                  <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-emerald-500/20 font-mono text-sm font-bold text-emerald-300 ring-1 ring-emerald-500/30">
                    {selectedAlertIds.length}
                  </span>
                  <div>
                    <p className="text-sm font-bold text-white">
                      {selectedAlertIds.length} pagos seleccionados para asignación en lote
                    </p>
                    <p className="text-xs text-emerald-300">
                      Monto total bruto:{' '}
                      <strong className="font-mono text-white">
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
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setBatchTargetClient('');
                      setBatchNotes('Asignación masiva por lote (auditoría)');
                      setIsBatchModalOpen(true);
                    }}
                    className="inline-flex items-center gap-2 rounded-lg bg-emerald-500 px-4 py-2 text-xs font-bold text-slate-950 shadow-md transition hover:bg-emerald-400"
                  >
                    <UserCheck className="h-4 w-4" />
                    Asignar pagos seleccionados al cliente...
                  </button>
                  <button
                    type="button"
                    onClick={() => setSelectedAlertIds([])}
                    className="rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-xs font-medium text-slate-300 hover:bg-slate-800"
                  >
                    Deseleccionar todos
                  </button>
                </div>
              </div>
            )}

            {/* =================================================================
                SECCIÓN: CAPTURAS ENVIADAS POR EL CLIENTE PENDIENTES (SIN CORREO DEL BANCO)
               ================================================================= */}
            {pendingOrders.length > 0 && (
              <section
                aria-label="Capturas Enviadas por el Cliente Pendientes de Confirmar"
                className="mb-6 overflow-hidden rounded-xl border border-amber-500/40 bg-gradient-to-br from-slate-900 via-slate-900 to-amber-950/20 shadow-xl"
              >
                <div className="flex flex-wrap items-center justify-between gap-3 border-b border-amber-500/25 bg-amber-950/30 px-4 py-3">
                  <div className="flex items-center gap-2.5">
                    <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-amber-500/20 font-mono text-xs font-bold text-amber-300 ring-1 ring-amber-400/40">
                      {pendingOrders.length}
                    </span>
                    <div>
                      <h3 className="text-sm font-bold text-white">
                        Capturas Enviadas por el Cliente en Espera de Confirmación Manual ({pendingOrders.length})
                      </h3>
                      <p className="text-xs text-amber-200/80">
                        Estos comprobantes fueron subidos desde el portal del cliente pero no llegó el correo del banco o no coincidió automáticamente. Puedes ver la captura, confirmarlos manualmente o descartar duplicados.
                      </p>
                    </div>
                  </div>
                </div>

                <div className="overflow-x-auto">
                  <table className="w-full border-collapse text-left text-xs table-auto">
                    <thead>
                      <tr className="border-b border-slate-800 bg-slate-950/70 font-semibold uppercase tracking-wider text-slate-400">
                        <th className="px-3 py-2.5">#</th>
                        <th className="px-3 py-2.5">Orden &amp; Fecha Envío</th>
                        <th className="px-3 py-2.5">Cliente Titular</th>
                        <th className="px-3 py-2.5">Remitente Reportado</th>
                        <th className="px-3 py-2.5">Referencia Reportada</th>
                        <th className="px-3 py-2.5">Diagnóstico / Estado Correo</th>
                        <th className="px-3 py-2.5 text-right">Monto Bruto</th>
                        <th className="px-3 py-2.5 text-right">Comisión</th>
                        <th className="px-3 py-2.5 text-right">Neto a Acreditar</th>
                        <th className="px-3 py-2.5 text-right">Captura &amp; Confirmación Manual</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-800/70">
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
                        const detectedSameAmountTx = alerts.find(
                          (a) =>
                            a.estado !== 'CONCILIADO' &&
                            a.tipo_movimiento === 'RECIBIDO' &&
                            a.plataforma === order.plataforma_esperada &&
                            a.moneda === order.moneda &&
                            Math.abs(a.monto_bruto - order.monto_esperado) < 0.01
                        );
                        const orderPlatformBadge = getPlatformBadgeMeta(
                          order.plataforma_esperada
                        );

                        return (
                          <tr
                            key={order.id}
                            className="transition hover:bg-slate-800/40"
                          >
                            <td className="whitespace-nowrap px-3 py-2.5 font-mono text-slate-400">
                              {idx + 1}
                            </td>
                            <td className="whitespace-nowrap px-3 py-2.5">
                              <div className="flex items-center gap-1.5">
                                <span className="font-mono font-bold text-sky-300">
                                  {order.codigo_orden}
                                </span>
                                <span
                                  className={`inline-flex items-center rounded border px-1.5 py-0.2 text-[10px] font-bold ${orderPlatformBadge.badgeClass}`}
                                >
                                  {orderPlatformBadge.label}
                                </span>
                              </div>
                              {order.fecha_transferencia ? (
                                <div className="text-[11px] font-semibold text-amber-300">
                                  Fecha captura: {order.fecha_transferencia}
                                </div>
                              ) : null}
                              <div className="text-[10px] text-slate-400">
                                Subido: {formatDateTime(order.created_at)}
                              </div>
                            </td>
                            <td className="whitespace-nowrap px-3 py-2.5 font-semibold text-emerald-300">
                              {order.cliente_nombre}
                            </td>
                            <td className="px-3 py-2.5 font-semibold text-white">
                              {order.remitente_reportado ||
                                order.nombre_remitente_reportado ||
                                'Sin remitente'}
                            </td>
                            <td className="whitespace-nowrap px-3 py-2.5 font-mono font-semibold text-amber-300">
                              {order.referencia_reportada || 'SIN-REF'}
                            </td>
                            <td className="px-3 py-2.5 max-w-[300px]">
                              {alreadyReconciledTx ? (
                                <span className="inline-flex items-center gap-1 rounded-md border border-rose-500/40 bg-rose-950/60 px-2 py-0.5 text-[11px] font-semibold text-rose-200">
                                  <AlertTriangle className="h-3 w-3 shrink-0 text-rose-400" />
                                  Ref. ya conciliada en {alreadyReconciledTx.codigo_orden || alreadyReconciledTx.referencia} (Duplicado)
                                </span>
                              ) : duplicatePendingCount > 0 ? (
                                <span className="inline-flex items-center gap-1 rounded-md border border-amber-500/40 bg-amber-950/60 px-2 py-0.5 text-[11px] font-semibold text-amber-200">
                                  <AlertTriangle className="h-3 w-3 shrink-0 text-amber-400" />
                                  Ref. repetida en otra orden pendiente
                                </span>
                              ) : order.notas_cliente ? (
                                <span className="inline-flex items-start gap-1.5 rounded-md border border-sky-500/35 bg-sky-950/40 px-2 py-1 text-[11px] leading-snug text-sky-200">
                                  <Clock className="h-3.5 w-3.5 shrink-0 text-sky-400 mt-0.5" />
                                  <span>{order.notas_cliente}</span>
                                </span>
                              ) : detectedSameAmountTx ? (
                                <span className="inline-flex items-center gap-1 rounded-md border border-sky-500/40 bg-sky-950/60 px-2 py-0.5 text-[11px] font-semibold text-sky-200">
                                  <Clock className="h-3 w-3 shrink-0 text-sky-400" />
                                  Sin correo exacto · Hay correo DETECTADO de {formatMoney(order.monto_esperado, order.moneda)}
                                </span>
                              ) : (
                                <span className="inline-flex items-center gap-1 rounded-md border border-slate-700 bg-slate-900 px-2 py-0.5 text-[11px] text-slate-300">
                                  <Clock className="h-3 w-3 shrink-0 text-amber-400" />
                                  No llegó correo del banco · Confirmación manual
                                </span>
                              )}
                            </td>
                            <td className="whitespace-nowrap px-3 py-2.5 text-right font-mono font-bold text-white">
                              {formatMoney(order.monto_esperado, order.moneda)}
                            </td>
                            <td className="whitespace-nowrap px-3 py-2.5 text-right font-mono text-violet-300">
                              -{formatMoney(comision, order.moneda)} ({feePct}%)
                            </td>
                            <td className="whitespace-nowrap px-3 py-2.5 text-right font-mono font-bold text-emerald-400">
                              {formatMoney(neto, order.moneda)}
                            </td>
                            <td className="whitespace-nowrap px-3 py-2.5 text-right">
                              <div className="flex items-center justify-end gap-1.5">
                                {(order.has_capture || order.comprobante_base64) && (
                                  <button
                                    type="button"
                                    onClick={() => void openLightboxForOrder(order)}
                                    className="inline-flex items-center gap-1 rounded-md border border-sky-500/40 bg-sky-500/15 px-2.5 py-1 text-[11px] font-semibold text-sky-300 transition hover:bg-sky-500/25 cursor-pointer"
                                    title="Ver la captura subida por el cliente"
                                  >
                                    <Eye className="h-3.5 w-3.5" />
                                    Ver Captura
                                  </button>
                                )}
                                <button
                                  type="button"
                                  onClick={() => openManualOrderConfirmModal(order)}
                                  className="inline-flex items-center gap-1 rounded-md bg-emerald-600 px-2.5 py-1 text-[11px] font-semibold text-white transition hover:bg-emerald-500 cursor-pointer shadow-sm"
                                  title="Confirmar manualmente y acreditar saldo al cliente"
                                >
                                  <CheckCircle2 className="h-3.5 w-3.5" />
                                  Confirmar Manual
                                </button>
                                <button
                                  type="button"
                                  disabled={isRejectingOrderId === order.id}
                                  onClick={() => void handleRejectPendingOrder(order)}
                                  className="inline-flex items-center gap-1 rounded-md border border-rose-500/40 bg-rose-500/15 px-2 py-1 text-[11px] font-semibold text-rose-300 transition hover:bg-rose-500/30 disabled:opacity-50 cursor-pointer"
                                  title="Descartar orden pendiente duplicada o inválida"
                                >
                                  <Trash2 className="h-3.5 w-3.5" />
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
              </section>
            )}

            <section className="overflow-hidden rounded-xl border border-slate-800 bg-slate-900/70 shadow-xl">
              <div className="overflow-x-auto xl:overflow-x-visible">
                <table className="w-full border-collapse text-left text-sm table-auto">
                  <thead>
                    <tr className="border-b border-slate-800 bg-slate-950/70 text-xs font-semibold uppercase tracking-wider text-slate-400">
                      <th className="w-10 px-2.5 py-3 text-center">
                        <input
                          type="checkbox"
                          checked={
                            eligibleAlertsForBatch.length > 0 &&
                            eligibleAlertsForBatch.every((a) =>
                              selectedAlertIds.includes(a.id)
                            )
                          }
                          onChange={toggleSelectAllEligible}
                          className="h-4 w-4 rounded border-slate-700 bg-slate-900 text-emerald-600 focus:ring-emerald-500 cursor-pointer"
                          title="Seleccionar / deseleccionar todos los pagos elegibles para lote"
                        />
                      </th>
                      <th className="px-2.5 py-3">Canal</th>
                      <th className="px-2.5 py-3">Fecha y Hora Correo</th>
                      <th className="px-2 py-3">Flujo</th>
                      <th className="px-2.5 py-3">
                        Enviado por (Correo)
                      </th>
                      <th className="px-2.5 py-3">
                        Referencia correo
                      </th>
                      <th className="px-2.5 py-3">
                        Titular / Subdetalle Correo
                      </th>
                      <th className="px-2.5 py-3">
                        Reportado como (Cliente) / Alerta
                      </th>
                      <th className="px-2.5 py-3">
                        Referencia Reportada
                      </th>
                      <th className="px-2.5 py-3 text-right">Monto Bruto ($)</th>
                      <th className="px-2.5 py-3 text-right">Comisión</th>
                      <th className="px-2.5 py-3 text-right">Monto Neto ($)</th>
                      <th className="px-2 py-3">Estado</th>
                      <th className="px-2.5 py-3 text-right">
                        Captura &amp; Acciones
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/70">
                    {filteredAlerts.length === 0 ? (
                      <tr>
                        <td
                          colSpan={14}
                          className="px-6 py-12 text-center text-slate-400"
                        >
                          No se encontraron transacciones con los filtros
                          seleccionados.
                        </td>
                      </tr>
                    ) : (
                      filteredAlerts.map((alert) => {
                        const badge = getPlatformBadgeMeta(alert.plataforma);
                        const candidateOrder = findAssociatedCaptureOrder(alert);
                        const hasCapture = Boolean(
                          alert.has_capture ||
                          alert.comprobante_base64 ||
                          candidateOrder?.has_capture ||
                          candidateOrder?.comprobante_base64
                        );
                        const isSelected = selectedAlertIds.includes(alert.id);
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
                        // Solo marcar disparidad real si la similitud fonética/token es baja (< 0.65)
                        // Y tampoco está respaldada por coincidencia de referencia + al menos 1 nombre/apellido (>= 0.40)
                        const hasNameDisparity = Boolean(
                          reportedSender &&
                            alert.remitente_o_contraparte &&
                            senderSimilarity < 0.65 &&
                            !(isRefVerified && senderSimilarity >= 0.4)
                        );

                        return (
                          <tr
                            key={alert.id}
                            className={`transition hover:bg-slate-800/40 ${
                              isSelected ? 'bg-emerald-950/25' : ''
                            }`}
                          >
                            <td className="w-9 px-2 py-3 text-center">
                              {alert.estado !== 'CONCILIADO' &&
                              alert.tipo_movimiento === 'RECIBIDO' ? (
                                <input
                                  type="checkbox"
                                  checked={isSelected}
                                  onChange={() => toggleSelectAlert(alert.id)}
                                  className="h-4 w-4 rounded border-slate-700 bg-slate-900 text-emerald-600 focus:ring-emerald-500 cursor-pointer"
                                />
                              ) : (
                                <span className="inline-block h-4 w-4 text-slate-700">-</span>
                              )}
                            </td>

                            {/* 1. Canal */}
                            <td className="whitespace-nowrap px-2.5 py-3">
                              <span
                                className={`inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-bold ${badge.badgeClass}`}
                              >
                                {badge.label}
                              </span>
                            </td>

                            {/* 2. Fecha y Hora Correo */}
                            <td
                              className="whitespace-nowrap px-2.5 py-3 text-xs font-medium text-slate-300"
                              title="Fecha y hora exacta entregada por el correo bancario"
                            >
                              {formatDateTime(alert.fecha_transaccion)}
                            </td>

                            {/* 3. Flujo */}
                            <td className="whitespace-nowrap px-2 py-3">
                              {alert.tipo_movimiento === 'RECIBIDO' ? (
                                <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-0.5 text-xs font-medium text-emerald-400">
                                  <ArrowDownLeft className="h-3 w-3" />
                                  Recibido
                                </span>
                              ) : (
                                <span className="inline-flex items-center gap-1 rounded-full bg-rose-500/10 px-2 py-0.5 text-xs font-medium text-rose-400">
                                  <ArrowUpRight className="h-3 w-3" />
                                  Enviado
                                </span>
                              )}
                            </td>

                            {/* 4. Enviado por (Correo) */}
                            <td className="px-2.5 py-3 max-w-[180px] 2xl:max-w-[220px]">
                              <div
                                className="font-semibold text-white truncate text-xs"
                                title={alert.remitente_o_contraparte || ''}
                              >
                                {alert.remitente_o_contraparte || (
                                  <span className="italic text-amber-400">
                                    Remitente no identificado
                                  </span>
                                )}
                              </div>
                            </td>

                            {/* 5. Referencia correo */}
                            <td className="whitespace-nowrap px-2.5 py-3 font-mono text-xs font-semibold text-slate-200">
                              {alert.referencia || 'SIN-REF'}
                            </td>

                            {/* 6. Titular / Subdetalle Correo */}
                            <td className="px-2.5 py-3 max-w-[180px]">
                              {alert.cliente_asignado_nombre ? (
                                <div className="flex items-center gap-1 text-xs text-emerald-400">
                                  <UserCheck className="h-3.5 w-3.5 shrink-0" />
                                  <span className="truncate font-semibold">
                                    Titular: {alert.cliente_asignado_nombre}
                                  </span>
                                </div>
                              ) : (
                                <div className="flex items-center gap-1 text-[11px] text-slate-400">
                                  <Clock className="h-3 w-3 shrink-0 text-slate-500" />
                                  <span className="truncate">Sin cliente (En espera de orden)</span>
                                </div>
                              )}
                            </td>

                            {/* 7. Reportado como (Cliente) / Alerta */}
                            <td className="px-2.5 py-3 max-w-[250px] 2xl:max-w-xs">
                              {reportedSender ? (
                                <div className="text-xs">
                                  <div className="flex flex-wrap items-center gap-1">
                                    <span
                                      className={`font-semibold truncate ${
                                        hasNameDisparity
                                          ? 'text-amber-300'
                                          : 'text-sky-200'
                                      }`}
                                      title={reportedSender}
                                    >
                                      {reportedSender}
                                    </span>
                                    {reportedCode && (
                                      <span className="font-mono text-[10px] font-semibold text-sky-400">
                                        | {reportedCode}
                                      </span>
                                    )}
                                  </div>
                                  {hasNameDisparity && (
                                    <span className="mt-1 inline-flex items-center gap-1 rounded-md border border-amber-400/50 bg-amber-950/90 px-2 py-0.5 text-[11px] font-semibold text-amber-200 shadow-sm">
                                      <AlertTriangle className="h-3 w-3 shrink-0 text-amber-400" />
                                      Diferencia de nombre
                                    </span>
                                  )}
                                </div>
                              ) : (
                                <span className="text-xs italic text-slate-500">
                                  Sin reporte del cliente aún
                                </span>
                              )}
                            </td>

                            {/* 8. Referencia Reportada */}
                            <td className="whitespace-nowrap px-2.5 py-3 font-mono text-xs">
                              {reportedRef ? (
                                <span className="font-semibold text-sky-300">
                                  {reportedRef}
                                </span>
                              ) : (
                                <span className="text-slate-500">—</span>
                              )}
                            </td>

                            {/* 9. Monto Bruto ($) */}
                            <td className="whitespace-nowrap px-2.5 py-3 text-right font-mono font-semibold text-slate-100">
                              {formatMoney(alert.monto_bruto, alert.moneda)}
                            </td>

                            {/* 10. Comisión */}
                            <td className="whitespace-nowrap px-2.5 py-3 text-right font-mono text-xs">
                              {alert.estado === 'CONCILIADO' ? (
                                <span className="text-violet-300">
                                  {alert.monto_comision > 0
                                    ? `-${formatMoney(alert.monto_comision, alert.moneda)} (${alert.porcentaje_comision}%)`
                                    : formatMoney(0, alert.moneda)}
                                </span>
                              ) : (
                                <span className="text-slate-400">
                                  {formatMoney(0, alert.moneda)}
                                </span>
                              )}
                            </td>

                            {/* 11. Monto Neto ($) */}
                            <td className="whitespace-nowrap px-2.5 py-3 text-right font-mono font-bold">
                              {alert.estado === 'CONCILIADO' ? (
                                <span className="text-emerald-400">
                                  {formatMoney(alert.monto_neto, alert.moneda)}
                                </span>
                              ) : (
                                <span className="text-slate-300 font-normal">
                                  {formatMoney(alert.monto_bruto, alert.moneda)}
                                </span>
                              )}
                            </td>

                            <td className="whitespace-nowrap px-2.5 py-3">
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

                            <td className="whitespace-nowrap px-3 py-3 text-right">
                              <div className="flex items-center justify-end gap-1.5">
                                {hasCapture && (
                                  <button
                                    type="button"
                                    onClick={() => openLightboxForTx(alert)}
                                    className="inline-flex items-center gap-1 rounded-md border border-sky-500/40 bg-sky-500/15 px-2 py-1 text-[11px] font-semibold text-sky-300 transition hover:bg-sky-500/25 cursor-pointer"
                                    title="Ver Captura subida por el cliente lado a lado"
                                  >
                                    <ImageIcon className="h-3 w-3" />
                                    Ver Captura
                                  </button>
                                )}

                                <button
                                  type="button"
                                  onClick={() => setInspectedAlert(alert)}
                                  className="inline-flex items-center gap-1 rounded-md border border-slate-700 bg-slate-800/80 px-2 py-1 text-[11px] font-medium text-slate-300 transition hover:bg-slate-700 cursor-pointer"
                                >
                                  <FileText className="h-3 w-3" />
                                  Payload
                                </button>

                                {alert.estado !== 'CONCILIADO' &&
                                  alert.tipo_movimiento === 'RECIBIDO' && (
                                    <button
                                      type="button"
                                      onClick={() =>
                                        openManualReconciliationModal(
                                          alert,
                                          candidateOrder
                                        )
                                      }
                                      className="inline-flex items-center gap-1 rounded-md bg-amber-500 px-2.5 py-1 text-[11px] font-semibold text-slate-950 transition hover:bg-amber-400 cursor-pointer"
                                    >
                                      <UserCheck className="h-3 w-3" />
                                      Conciliar
                                    </button>
                                  )}

                                {alert.estado === 'CONCILIADO' && (
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setAlertToRevert(alert);
                                      setRevertReason('');
                                    }}
                                    className="inline-flex items-center gap-1 rounded-md border border-rose-500/40 bg-rose-500/15 px-2 py-1 text-[11px] font-semibold text-rose-300 transition hover:bg-rose-500/30 cursor-pointer"
                                    title="Deshacer o revertir conciliación por error"
                                  >
                                    <RotateCcw className="h-3 w-3" />
                                    Deshacer
                                  </button>
                                )}
                              </div>
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
            </section>
          </>
        )}

        {/* =====================================================================
            PESTAÑA: EGRESOS / GASTOS PERSONALES Y SALIDAS (TIPO_MOVIMIENTO = ENVIADO)
           ===================================================================== */}
        {activeTab === 'EXPENSES' && (
          <div className="space-y-6">
            {/* Encabezado y Métricas de Egresos */}
            <div className="rounded-2xl border border-rose-500/25 bg-gradient-to-br from-slate-900 via-slate-900 to-rose-950/25 p-5 shadow-lg">
              <div className="flex flex-wrap items-center justify-between gap-4">
                <div className="flex items-center gap-3">
                  <div className="rounded-xl bg-rose-500/15 p-3 text-rose-400">
                    <CreditCard className="h-6 w-6" />
                  </div>
                  <div>
                    <h2 className="text-base font-bold text-white">
                      Egresos, Gastos Personales y Salidas Operativas
                    </h2>
                    <p className="text-xs text-slate-400">
                      Compras con tarjeta de débito (*0545), transferencias salientes y gastos del operador. Separados para mantener 100% limpia la conciliación de clientes.
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-3">
                  <div className="rounded-xl border border-slate-800 bg-slate-950 px-4 py-2.5 text-right font-mono">
                    <span className="block text-[10px] uppercase tracking-wider text-slate-400">
                      Total Salidas USD
                    </span>
                    <span className="text-lg font-bold text-rose-300">
                      -{formatMoney(totalExpensesUsd, 'USD')}
                    </span>
                  </div>
                  <div className="rounded-xl border border-slate-800 bg-slate-950 px-4 py-2.5 text-right font-mono">
                    <span className="block text-[10px] uppercase tracking-wider text-slate-400">
                      Cantidad de Operaciones
                    </span>
                    <span className="text-lg font-bold text-white">
                      {sentAlertsCount}
                    </span>
                  </div>
                </div>
              </div>
            </div>

            {/* Buscador de Egresos */}
            <div className="flex items-center gap-3 rounded-xl border border-slate-800 bg-slate-900/70 p-4">
              <div className="relative flex-1">
                <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Buscar gasto por comercio, tarjeta, TxID o destinatario..."
                  className="w-full rounded-lg border border-slate-700 bg-slate-950 py-2 pl-10 pr-4 text-sm text-slate-100 placeholder-slate-500 focus:border-rose-500 focus:outline-none"
                />
              </div>
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => setSearchQuery('')}
                  className="text-xs text-slate-400 hover:text-white"
                >
                  Limpiar búsqueda
                </button>
              )}
            </div>

            {/* Tabla de Egresos */}
            <div className="overflow-hidden rounded-xl border border-slate-800 bg-slate-900/70 shadow-xl">
              <div className="overflow-x-auto xl:overflow-x-visible">
                <table className="w-full border-collapse text-left text-sm table-auto">
                  <thead>
                    <tr className="border-b border-slate-800 bg-slate-950/70 text-xs font-semibold uppercase tracking-wider text-slate-400">
                      <th className="px-3 py-3">Fecha &amp; Canal</th>
                      <th className="px-2.5 py-3">Tipo de Salida</th>
                      <th className="px-3 py-3">Destinatario / Comercio / Tarjeta</th>
                      <th className="px-3 py-3">Referencia / TxID</th>
                      <th className="px-3 py-3 text-right">Monto Gastado</th>
                      <th className="px-3 py-3 text-right">Detalles</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/70">
                    {expensesAlerts.length === 0 ? (
                      <tr>
                        <td colSpan={6} className="px-6 py-12 text-center text-slate-400">
                          No se registraron egresos o gastos que coincidan con la búsqueda.
                        </td>
                      </tr>
                    ) : (
                      expensesAlerts.map((expense) => {
                        const badge = getPlatformBadgeMeta(expense.plataforma);
                        return (
                          <tr key={expense.id} className="transition hover:bg-slate-800/40">
                            <td className="whitespace-nowrap px-3 py-3">
                              <span
                                className={`inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-bold ${badge.badgeClass}`}
                              >
                                {badge.label}
                              </span>
                              <p className="mt-1 text-xs text-slate-400">
                                {formatDateTime(expense.fecha_transaccion)}
                              </p>
                            </td>
                            <td className="whitespace-nowrap px-2.5 py-3">
                              <span className="inline-flex items-center gap-1 rounded-full border border-rose-500/30 bg-rose-500/10 px-2 py-0.5 text-xs font-medium text-rose-300">
                                <ArrowUpRight className="h-3 w-3" />
                                ENVIADO / SALIDA
                              </span>
                            </td>
                            <td className="px-3 py-3">
                              <p className="font-semibold text-white">
                                {expense.remitente_o_contraparte || 'No especificado'}
                              </p>
                              {expense.nota_auditoria && (
                                <p className="mt-0.5 text-[11px] text-slate-400">
                                  {expense.nota_auditoria}
                                </p>
                              )}
                            </td>
                            <td className="whitespace-nowrap px-3 py-3 font-mono text-xs text-slate-300">
                              {expense.referencia || 'SIN-REF'}
                            </td>
                            <td className="whitespace-nowrap px-3 py-3 text-right font-mono text-base font-bold text-rose-300">
                              -{formatMoney(expense.monto_bruto, expense.moneda)}
                            </td>
                            <td className="whitespace-nowrap px-3 py-3 text-right">
                              <button
                                type="button"
                                onClick={() => setInspectedAlert(expense)}
                                className="inline-flex items-center gap-1 rounded-md border border-slate-700 bg-slate-800/80 px-2.5 py-1 text-xs font-medium text-slate-300 transition hover:bg-slate-700 cursor-pointer"
                              >
                                <FileText className="h-3.5 w-3.5" />
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
          <div className="space-y-8">
            <div className="flex flex-col justify-between gap-4 rounded-xl border border-slate-800 bg-slate-900/70 p-5 sm:flex-row sm:items-center">
              <div>
                <h2 className="text-lg font-bold text-white">
                  Directorio de Clientes y Cuentas de Acceso al Portal
                </h2>
                <p className="mt-1 text-xs text-slate-400">
                  Cada cliente ingresa a `/portal` con su Correo y PIN para reportar los pagos de terceros que recibe y consultar su saldo neto liquidable en USD y USDT.
                </p>
              </div>
              <div className="flex flex-wrap gap-3">
                <button
                  type="button"
                  onClick={() => setIsNewOrderModalOpen(true)}
                  className="inline-flex items-center gap-2 rounded-lg border border-sky-500/40 bg-sky-950/40 px-4 py-2 text-sm font-semibold text-sky-300 hover:bg-sky-900/50"
                >
                  <FilePlus2 className="h-4 w-4" />
                  + Registrar Orden Esperada
                </button>
                <button
                  type="button"
                  onClick={openCreateClientModal}
                  className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-500"
                >
                  <UserPlus className="h-4 w-4" />
                  + Nueva Cuenta de Acceso
                </button>
              </div>
            </div>

            {lastPortalCredentials && (
              <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-emerald-500/40 bg-emerald-950/30 px-4 py-3 text-xs text-emerald-200">
                <div>
                  <strong>Último acceso asignado ({lastPortalCredentials.nombre}):</strong>{' '}
                  Correo <code className="text-white">{lastPortalCredentials.email}</code>
                  {lastPortalCredentials.pin && (
                    <>
                      {' '}· PIN <code className="text-white">{lastPortalCredentials.pin}</code>
                    </>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => void handleCopyPortalCredentials(lastPortalCredentials)}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-400/40 bg-emerald-500/15 px-3 py-1.5 font-semibold text-emerald-200 hover:bg-emerald-500/25"
                >
                  <Copy className="h-3.5 w-3.5" />
                  Copiar Link + Credenciales
                </button>
              </div>
            )}

            {/* Tabla de Cuentas de Clientes */}
            <div className="overflow-hidden rounded-xl border border-slate-800 bg-slate-900/70 shadow-xl">
              <div className="border-b border-slate-800 bg-slate-950/60 px-5 py-3.5">
                <h3 className="text-sm font-bold uppercase tracking-wider text-slate-300">
                  Cuentas de Clientes Registrados ({clients.length})
                </h3>
              </div>
              <div className="overflow-x-auto xl:overflow-x-visible">
                <table className="w-full border-collapse text-left text-sm table-auto">
                  <thead>
                    <tr className="border-b border-slate-800 bg-slate-950/40 text-xs font-semibold uppercase tracking-wider text-slate-400">
                      <th className="px-4 py-3">Cliente / Titular</th>
                      <th className="px-4 py-3">Correo &amp; Acceso Portal</th>
                      <th className="px-4 py-3">Cuentas Asignadas (Destino &amp; Moneda)</th>
                      <th className="px-4 py-3 text-center">Fees (Zelle / Bin.)</th>
                      <th className="px-4 py-3 text-right">Total Acreditado</th>
                      <th className="px-4 py-3 text-right">Total Liquidado</th>
                      <th className="px-4 py-3 text-right">Saldo Disponible</th>
                      <th className="px-4 py-3 text-right">Acciones</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/70">
                    {clients.length === 0 ? (
                      <tr>
                        <td
                          colSpan={8}
                          className="px-6 py-10 text-center text-slate-400"
                        >
                          Aún no hay cuentas de clientes registradas. Haz clic en &quot;+ Nueva Cuenta de Acceso&quot; para crear un usuario y asignarle su PIN del portal.
                        </td>
                      </tr>
                    ) : (
                      clients.map((c) => {
                        const dispUsd = c.saldo_disponible_usd ?? Math.max(0, c.total_neto_usd - (c.total_liquidado_usd ?? 0));
                        const dispUsdt = c.saldo_disponible_usdt ?? Math.max(0, c.total_neto_usdt - (c.total_liquidado_usdt ?? 0));
                        return (
                          <tr key={c.id} className="hover:bg-slate-800/40">
                            <td className="px-4 py-3.5 font-semibold text-white">
                              {c.nombre_titular}
                              <div className="text-xs font-normal text-slate-400">
                                {c.pagos_conciliados_count} pago(s) conciliado(s)
                              </div>
                            </td>
                            <td className="px-4 py-3.5 text-xs text-slate-300">
                              <div>{c.email ?? c.email_contacto ?? 'Sin email'}</div>
                              <div className="mt-1 flex items-center gap-2">
                                {c.tiene_pin_configurado ? (
                                  <span className="inline-flex items-center gap-1 rounded-full border border-emerald-500/30 bg-emerald-500/15 px-2 py-0.5 text-[10px] font-semibold text-emerald-300">
                                    <KeyRound className="h-2.5 w-2.5" />
                                    PIN Activo
                                  </span>
                                ) : (
                                  <span className="inline-flex items-center gap-1 rounded-full border border-amber-500/30 bg-amber-500/15 px-2 py-0.5 text-[10px] font-semibold text-amber-300">
                                    Sin PIN
                                  </span>
                                )}
                                {c.telefono && (
                                  <span className="text-slate-400">{c.telefono}</span>
                                )}
                              </div>
                            </td>
                            <td className="px-4 py-3.5 text-xs text-slate-300">
                              {c.cuentas_asignadas && c.cuentas_asignadas.length > 0 ? (
                                <div className="space-y-1.5">
                                  {c.cuentas_asignadas.map((acc) => {
                                    const badge = getPlatformBadgeMeta(acc.plataforma);
                                    return (
                                      <div
                                        key={acc.id}
                                        className="flex flex-wrap items-center gap-1.5 rounded-lg border border-slate-800 bg-slate-950/90 px-2.5 py-1.5"
                                      >
                                        <span
                                          className={`inline-flex rounded border px-1.5 py-0.5 text-[10px] font-semibold ${badge.badgeClass}`}
                                        >
                                          {badge.label}
                                        </span>
                                        <span className="font-mono text-[11px] font-semibold text-white">
                                          {acc.cuenta_receptora}
                                        </span>
                                        <span className="rounded bg-slate-800 px-1.5 py-0.5 font-mono text-[10px] font-bold text-emerald-300">
                                          {acc.moneda}
                                        </span>
                                      </div>
                                    );
                                  })}
                                </div>
                              ) : (
                                <span className="text-[11px] text-amber-300">
                                  Sin cuentas asignadas (usa Editar)
                                </span>
                              )}
                            </td>
                            <td className="px-4 py-3.5 text-center font-mono text-xs text-violet-300">
                              {c.porcentaje_comision_zelle}% / {c.porcentaje_comision_binance}%
                            </td>
                            <td className="px-4 py-3.5 text-right font-mono text-xs text-slate-200">
                              <div>{formatMoney(c.total_neto_usd, 'USD')}</div>
                              {c.total_neto_usdt > 0 && (
                                <div className="text-amber-300">{formatMoney(c.total_neto_usdt, 'USDT')}</div>
                              )}
                            </td>
                            <td className="px-4 py-3.5 text-right font-mono text-xs text-rose-300">
                              <div>{formatMoney(c.total_liquidado_usd ?? 0, 'USD')}</div>
                              {(c.total_liquidado_usdt ?? 0) > 0 && (
                                <div className="text-rose-400">{formatMoney(c.total_liquidado_usdt ?? 0, 'USDT')}</div>
                              )}
                              <div className="text-[10px] text-slate-400 font-normal">
                                {c.liquidaciones_count ?? 0} liquidación(es)
                              </div>
                            </td>
                            <td className="px-4 py-3.5 text-right font-mono font-bold">
                              <div className="text-sm text-emerald-400">
                                {formatMoney(dispUsd, 'USD')}
                              </div>
                              {c.total_neto_usdt > 0 && (
                                <div className="text-xs text-amber-300">
                                  {formatMoney(dispUsdt, 'USDT')}
                                </div>
                              )}
                            </td>
                            <td className="whitespace-nowrap px-4 py-3.5 text-right">
                              <div className="flex items-center justify-end gap-1.5">
                                <button
                                  type="button"
                                  onClick={() => openLiquidationModal(c)}
                                  className="inline-flex items-center gap-1 rounded-lg border border-emerald-500/50 bg-emerald-600/30 px-2.5 py-1.5 text-xs font-semibold text-emerald-200 hover:bg-emerald-600 hover:text-white transition shadow-sm"
                                  title="Liquidar saldo a favor del cliente o de un tercero"
                                >
                                  <Coins className="h-3.5 w-3.5 text-emerald-400" />
                                  Liquidar
                                </button>
                                <button
                                  type="button"
                                  onClick={() => openEditClientModal(c)}
                                  className="inline-flex items-center gap-1 rounded-lg border border-slate-700 bg-slate-800 px-2.5 py-1.5 text-xs font-medium text-slate-200 hover:bg-slate-700"
                                >
                                  <KeyRound className="h-3 w-3 text-emerald-400" />
                                  Editar / PIN
                                </button>
                                <button
                                  type="button"
                                  onClick={() =>
                                    void handleDeleteClient(c.id, c.nombre_titular)
                                  }
                                  className="rounded-lg p-1.5 text-slate-400 hover:bg-rose-950/60 hover:text-rose-300"
                                  title="Eliminar cliente"
                                >
                                  <Trash2 className="h-3.5 w-3.5" />
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
            <div className="overflow-hidden rounded-xl border border-slate-800 bg-slate-900/70 shadow-xl">
              <div className="border-b border-slate-800 bg-slate-950/60 px-5 py-3.5">
                <h3 className="text-sm font-bold uppercase tracking-wider text-slate-300">
                  Órdenes / Reportes de Pago Pendientes ({pendingOrders.length})
                </h3>
              </div>
              <div className="overflow-x-auto xl:overflow-x-visible">
                <table className="w-full border-collapse text-left text-sm table-auto">
                  <thead>
                    <tr className="border-b border-slate-800 bg-slate-950/40 text-xs font-semibold uppercase tracking-wider text-slate-400">
                      <th className="px-4 py-3">Código Orden</th>
                      <th className="px-4 py-3">Cliente Titular</th>
                      <th className="px-4 py-3">Remitente Reportado</th>
                      <th className="px-4 py-3">Plataforma</th>
                      <th className="px-4 py-3">Referencia</th>
                      <th className="px-4 py-3 text-right">Monto Esperado</th>
                      <th className="px-4 py-3 text-right">Comprobante</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/70">
                    {pendingOrders.length === 0 ? (
                      <tr>
                        <td
                          colSpan={7}
                          className="px-6 py-8 text-center text-slate-400"
                        >
                          No hay órdenes de pago pendientes en este momento.
                        </td>
                      </tr>
                    ) : (
                      pendingOrders.map((o) => {
                        const badge = getPlatformBadgeMeta(o.plataforma_esperada);
                        return (
                          <tr key={o.id} className="hover:bg-slate-800/40">
                            <td className="px-4 py-3 font-mono text-xs font-bold text-sky-300">
                              {o.codigo_orden}
                            </td>
                            <td className="px-4 py-3 font-medium text-white">
                              {o.cliente_nombre}
                            </td>
                            <td className="px-4 py-3 text-slate-300">
                              {o.remitente_reportado || o.nombre_remitente_reportado}
                            </td>
                            <td className="px-4 py-3">
                              <span
                                className={`inline-flex rounded border px-2 py-0.5 text-[11px] font-semibold ${badge.badgeClass}`}
                              >
                                {badge.label}
                              </span>
                            </td>
                            <td className="px-4 py-3 font-mono text-xs text-slate-400">
                              {o.referencia_reportada ?? 'SIN-REF'}
                            </td>
                            <td className="px-4 py-3 text-right font-mono font-bold text-emerald-400">
                              {formatMoney(o.monto_esperado, o.moneda)}
                            </td>
                            <td className="px-4 py-3 text-right">
                              <div className="flex items-center justify-end gap-1.5">
                                {o.has_capture || o.comprobante_base64 ? (
                                  <button
                                    type="button"
                                    onClick={() => void openLightboxForOrder(o)}
                                    className="inline-flex items-center gap-1 rounded-lg border border-sky-500/40 bg-sky-500/15 px-2.5 py-1 text-xs font-semibold text-sky-300 hover:bg-sky-500/25 cursor-pointer"
                                  >
                                    <Eye className="h-3.5 w-3.5" />
                                    Ver Captura
                                  </button>
                                ) : (
                                  <span className="text-xs text-slate-500">
                                    Sin imagen
                                  </span>
                                )}
                                <button
                                  type="button"
                                  onClick={() => openManualOrderConfirmModal(o)}
                                  className="inline-flex items-center gap-1 rounded-lg bg-emerald-600 px-2.5 py-1 text-xs font-semibold text-white hover:bg-emerald-500 cursor-pointer"
                                >
                                  <CheckCircle2 className="h-3.5 w-3.5" />
                                  Confirmar Manual
                                </button>
                                <button
                                  type="button"
                                  disabled={isRejectingOrderId === o.id}
                                  onClick={() => void handleRejectPendingOrder(o)}
                                  className="inline-flex items-center gap-1 rounded-lg border border-rose-500/40 bg-rose-500/15 px-2.5 py-1 text-xs font-semibold text-rose-300 hover:bg-rose-500/30 disabled:opacity-50 cursor-pointer"
                                >
                                  <Trash2 className="h-3.5 w-3.5" />
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
          <div className="space-y-6">
            {/* Cabecera y Métricas de Liquidación */}
            <div className="flex flex-col justify-between gap-4 rounded-xl border border-slate-800 bg-slate-900/70 p-5 sm:flex-row sm:items-center">
              <div>
                <div className="flex items-center gap-2 text-emerald-400">
                  <Coins className="h-5 w-5" />
                  <h2 className="text-lg font-bold text-white">
                    Liquidaciones y Pagos Realizados
                  </h2>
                </div>
                <p className="mt-1 text-xs text-slate-400">
                  Registra liquidaciones parciales o totales de saldos acreditados a clientes o a las cuentas de terceros que indiquen, con motivos y deducción automática.
                </p>
              </div>

              <button
                type="button"
                onClick={() => openLiquidationModal()}
                className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white shadow-lg shadow-emerald-950/60 hover:bg-emerald-500"
              >
                <Plus className="h-4 w-4" />
                + Registrar Liquidación
              </button>
            </div>

            {/* Tarjetas de Métricas de Liquidación */}
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-4">
                <span className="text-xs font-semibold uppercase tracking-wider text-slate-400">
                  Total Liquidado USD
                </span>
                <p className="mt-2 font-mono text-2xl font-bold text-emerald-400">
                  {formatMoney(totalLiquidadoUsd, 'USD')}
                </p>
                <span className="text-[11px] text-slate-400">
                  Salidas pagadas en Zelle / Bancario / Efectivo
                </span>
              </div>

              <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-4">
                <span className="text-xs font-semibold uppercase tracking-wider text-slate-400">
                  Total Liquidado USDT
                </span>
                <p className="mt-2 font-mono text-2xl font-bold text-amber-300">
                  {formatMoney(totalLiquidadoUsdt, 'USDT')}
                </p>
                <span className="text-[11px] text-slate-400">
                  Salidas Binance Pay / P2P / On-Chain
                </span>
              </div>

              <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-4">
                <span className="text-xs font-semibold uppercase tracking-wider text-slate-400">
                  Operaciones de Liquidación
                </span>
                <p className="mt-2 font-mono text-2xl font-bold text-sky-400">
                  {liquidations.length}
                </p>
                <span className="text-[11px] text-slate-400">
                  Liquidaciones registradas con deducción de saldo
                </span>
              </div>
            </div>

            {/* Barra de Filtros */}
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-800 bg-slate-900/40 p-3">
              <div className="relative min-w-[240px] flex-1">
                <Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-500" />
                <input
                  type="text"
                  value={liqSearch}
                  onChange={(e) => setLiqSearch(e.target.value)}
                  placeholder="Buscar por código, cliente, destinatario o motivo..."
                  className="w-full rounded-lg border border-slate-700 bg-slate-950 py-2 pl-9 pr-4 text-xs text-white placeholder-slate-500 focus:border-emerald-500 focus:outline-none"
                />
              </div>

              <div className="flex items-center gap-2">
                <span className="text-xs text-slate-400">Método:</span>
                <select
                  value={liqMethodFilter}
                  onChange={(e) => setLiqMethodFilter(e.target.value)}
                  className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-1.5 text-xs text-slate-200 focus:border-emerald-500 focus:outline-none"
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
            <div className="overflow-hidden rounded-xl border border-slate-800 bg-slate-900/70 shadow-xl">
              <div className="border-b border-slate-800 bg-slate-950/60 px-5 py-3.5">
                <h3 className="text-sm font-bold uppercase tracking-wider text-slate-300">
                  Historial de Liquidaciones ({filteredLiquidations.length})
                </h3>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full border-collapse text-left text-sm table-auto">
                  <thead>
                    <tr className="border-b border-slate-800 bg-slate-950/40 text-xs font-semibold uppercase tracking-wider text-slate-400">
                      <th className="px-4 py-3">Código &amp; Fecha</th>
                      <th className="px-4 py-3">Cliente Titular</th>
                      <th className="px-4 py-3">Destinatario / Beneficiario</th>
                      <th className="px-4 py-3">Motivo / Concepto</th>
                      <th className="px-4 py-3">Método &amp; Referencia</th>
                      <th className="px-4 py-3 text-right">Monto Liquidado</th>
                      <th className="px-4 py-3 text-right">Saldo Antes → Después</th>
                      <th className="px-4 py-3 text-center">Operador</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/70">
                    {filteredLiquidations.length === 0 ? (
                      <tr>
                        <td
                          colSpan={8}
                          className="px-6 py-12 text-center text-slate-400"
                        >
                          No se encontraron liquidaciones registradas. Haz clic en &quot;+ Registrar Liquidación&quot; para liquidar el saldo de un cliente.
                        </td>
                      </tr>
                    ) : (
                      filteredLiquidations.map((liq) => (
                        <tr key={liq.id} className="hover:bg-slate-800/40">
                          <td className="px-4 py-3.5 font-mono text-xs">
                            <span className="font-bold text-emerald-400">
                              {liq.codigo_liquidacion}
                            </span>
                            <div className="text-[11px] text-slate-400 font-sans">
                              {new Date(liq.created_at).toLocaleString('es-ES', {
                                dateStyle: 'short',
                                timeStyle: 'short',
                              })}
                            </div>
                          </td>
                          <td className="px-4 py-3.5 font-semibold text-white">
                            {liq.cliente_nombre}
                          </td>
                          <td className="px-4 py-3.5 text-xs text-slate-200">
                            <div className="font-medium text-sky-300">{liq.destinatario_beneficiario}</div>
                          </td>
                          <td className="px-4 py-3.5 text-xs text-slate-300 max-w-xs truncate" title={liq.motivo_concepto}>
                            {liq.motivo_concepto}
                          </td>
                          <td className="px-4 py-3.5 text-xs">
                            <span className="inline-flex rounded border border-slate-700 bg-slate-800 px-2 py-0.5 text-[10px] font-semibold text-slate-200">
                              {liq.metodo_pago_salida}
                            </span>
                            {liq.referencia_salida && (
                              <div className="mt-1 font-mono text-[11px] text-slate-400">
                                Ref: {liq.referencia_salida}
                              </div>
                            )}
                          </td>
                          <td className="px-4 py-3.5 text-right font-mono font-bold text-rose-400 text-sm">
                            -{formatMoney(liq.monto_liquidado, liq.moneda)}
                          </td>
                          <td className="px-4 py-3.5 text-right font-mono text-xs">
                            <span className="text-slate-400">
                              {formatMoney(liq.saldo_anterior, liq.moneda)}
                            </span>{' '}
                            <span className="text-slate-500">→</span>{' '}
                            <span className="font-bold text-emerald-400">
                              {formatMoney(liq.saldo_restante, liq.moneda)}
                            </span>
                          </td>
                          <td className="px-4 py-3.5 text-center text-xs text-slate-400">
                            {liq.liquidado_por || 'ADMIN'}
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
            PESTAÑA 5: CORREOS IMAP MONITOREADOS
           ===================================================================== */}
        {activeTab === 'MAILBOXES' && (
          <div className="grid grid-cols-1 gap-8 lg:grid-cols-12">
            <div className="rounded-xl border border-slate-800 bg-slate-900/80 p-6 lg:col-span-7">
              <div className="flex items-center justify-between gap-2.5 border-b border-slate-800 pb-4">
                <div className="flex items-center gap-2.5">
                  <Mail className="h-5 w-5 text-emerald-400" />
                  <div>
                    <h2 className="text-lg font-bold text-white">
                      {editingMailboxId
                        ? 'Editar Cuenta Receptora y Correo Monitoreado'
                        : 'Conectar Correo que Recibe Alertas (Zelle + Binance)'}
                    </h2>
                    <p className="text-xs text-slate-400">
                      Define el correo monitoreado, la cuenta exacta a la que envían el pago y su moneda (`USD` o `USDT`).
                    </p>
                  </div>
                </div>
                {editingMailboxId && (
                  <button
                    type="button"
                    onClick={resetMailboxForm}
                    className="rounded-lg border border-slate-700 px-3 py-1.5 text-xs font-medium text-slate-300 hover:bg-slate-800"
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
                      Gmail / Workspace (imap.gmail.com)
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setMailboxHost('outlook.office365.com');
                        setMailboxPort('993');
                      }}
                      className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-1.5 text-xs font-medium text-sky-300 hover:border-sky-500"
                    >
                      Outlook / Office 365
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setMailboxHost('imap.secureserver.net');
                        setMailboxPort('993');
                      }}
                      className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-1.5 text-xs font-medium text-sky-300 hover:border-sky-500"
                    >
                      GoDaddy Workspace
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
                      className="mt-1.5 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-semibold uppercase text-slate-300">
                      Canales Monitoreados
                    </label>
                    <select
                      value={mailboxBanks}
                      onChange={(e) => setMailboxBanks(e.target.value)}
                      className="mt-1.5 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white"
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

                <div className="rounded-xl border border-emerald-500/30 bg-emerald-950/15 p-3.5">
                  <div className="mb-2 text-[11px] font-bold uppercase tracking-wider text-emerald-300">
                    Datos visibles para el cliente en el Portal (/portal)
                  </div>
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-12">
                    <div className="sm:col-span-4">
                      <label className="block text-[11px] font-semibold uppercase text-slate-300">
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
                        className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-2.5 py-2 text-xs text-white"
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
                      <label className="block text-[11px] font-semibold uppercase text-slate-300">
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
                        className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-2.5 py-2 font-mono text-xs text-white"
                      />
                    </div>
                    <div className="sm:col-span-3">
                      <label className="block text-[11px] font-semibold uppercase text-slate-300">
                        Moneda
                      </label>
                      <select
                        value={mailboxCurrency}
                        onChange={(e) =>
                          setMailboxCurrency(e.target.value as CurrencyType)
                        }
                        className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-2.5 py-2 font-mono text-xs text-white"
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
                    <label className="block text-xs font-semibold uppercase text-slate-300">
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
                      className="mt-1.5 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-semibold uppercase text-slate-300">
                      Contraseña IMAP / App Password{' '}
                      {editingMailboxId ? '(Opcional al editar)' : ''}
                    </label>
                    <div className="relative mt-1.5">
                      <KeyRound className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
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
                        className="w-full rounded-lg border border-slate-700 bg-slate-950 py-2 pl-9 pr-3 font-mono text-sm text-white"
                      />
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                  <div>
                    <label className="block text-xs font-semibold uppercase text-slate-300">
                      Servidor IMAP
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
                    ) : editingMailboxId ? (
                      <Pencil className="h-4 w-4" />
                    ) : (
                      <Plus className="h-4 w-4" />
                    )}
                    {editingMailboxId
                      ? 'Guardar Cambios de la Cuenta Receptora'
                      : 'Guardar y Conectar Correo IMAP'}
                  </button>
                </div>
              </form>
            </div>

            <div className="space-y-6 lg:col-span-5">
              <div className="rounded-xl border border-slate-800 bg-slate-900/80 p-5">
                <h3 className="text-sm font-bold uppercase tracking-wider text-slate-300">
                  Correos Activos Monitoreados ({mailboxes.length})
                </h3>

                {mailboxes.length === 0 ? (
                  <p className="mt-3 text-xs text-slate-400">
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
                          className="flex items-start justify-between gap-2 rounded-lg border border-slate-800 bg-slate-950 p-3.5"
                        >
                          <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="h-2 w-2 rounded-full bg-emerald-400" />
                              <span className="font-semibold text-white">
                                {mb.email_address}
                              </span>
                              <span
                                className={`inline-flex rounded border px-1.5 py-0.5 text-[10px] font-semibold ${badge.badgeClass}`}
                              >
                                {badge.label}
                              </span>
                              <span className="rounded bg-emerald-500/20 px-1.5 py-0.5 font-mono text-[10px] font-bold text-emerald-300">
                                {curr}
                              </span>
                            </div>
                            <p className="mt-1 text-xs text-sky-300">
                              Enviar a:{' '}
                              <span className="font-mono font-semibold text-white">
                                {dest}
                              </span>
                            </p>
                            <p className="mt-0.5 text-xs text-slate-400">
                              {mb.alias} · {mb.imap_host}:{mb.imap_port} (
                              {mb.mailbox_folder})
                            </p>
                            <p className="mt-1 text-[11px] text-emerald-400">
                              Estado: {mb.last_sync_status ?? 'Listo'} · Última
                              vez: {formatDateTime(mb.last_sync_at)}
                            </p>
                          </div>
                          <div className="flex items-center gap-1">
                            <button
                              type="button"
                              onClick={() => openEditMailbox(mb)}
                              className="inline-flex items-center gap-1 rounded border border-slate-700 bg-slate-900 px-2 py-1 text-[11px] font-medium text-slate-200 hover:bg-slate-800"
                              title="Editar Cuenta / Moneda"
                            >
                              <Pencil className="h-3 w-3 text-sky-400" />
                              Editar
                            </button>
                            <button
                              type="button"
                              onClick={() => void handleDeleteMailbox(mb.id)}
                              className="rounded p-1.5 text-slate-400 hover:bg-rose-950/60 hover:text-rose-300"
                              title="Eliminar buzón"
                            >
                              <Trash2 className="h-4 w-4" />
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              <div className="rounded-xl border border-sky-500/30 bg-sky-950/20 p-5">
                <div className="flex items-center gap-2 text-sky-300">
                  <HelpCircle className="h-5 w-5" />
                  <h3 className="text-sm font-bold">
                    Idempotencia Cruzada (Binance API + Email)
                  </h3>
                </div>
                <ol className="mt-3 list-decimal space-y-2.5 pl-4 text-xs leading-relaxed text-slate-300">
                  <li>
                    <strong>Correos Oficiales Soportados:</strong> Citibank (`@citibank.com`), TD Bank (`@tdbank.com` / `@td.com`) y Binance (`@binance.com`, `@directmail.binance.com`).
                  </li>
                  <li>
                    <strong>Binance API Oficial:</strong> Configura{' '}
                    <code>BINANCE_API_KEY</code> y{' '}
                    <code>BINANCE_API_SECRET</code> en <code>.env</code> para consultar Pay, P2P y Depósitos On-Chain en paralelo.
                  </li>
                  <li>
                    <strong>Cero Duplicados:</strong> Ambos canales generan la misma llave{' '}
                    <code>dedup_key</code> (<code>PLATAFORMA:REFERENCIA:MONTO</code>) con{' '}
                    <code>ON CONFLICT DO NOTHING</code>.
                  </li>
                </ol>
              </div>
            </div>
          </div>
        )}

        {/* =====================================================================
            PESTAÑA 4: USUARIOS Y CUENTAS PARA DISTINTOS NEGOCIOS
           ===================================================================== */}
        {activeTab === 'BUSINESS_USERS' &&
          currentBusinessUser.rol === 'SUPER_ADMIN' && (
            <div className="space-y-6">
              <div className="flex flex-col justify-between gap-4 rounded-xl border border-slate-800 bg-slate-900/70 p-5 sm:flex-row sm:items-center">
                <div>
                  <h2 className="text-lg font-bold text-white">
                    Cuentas de Acceso para Distintos Negocios
                  </h2>
                  <p className="mt-1 text-xs text-slate-400">
                    Crea usuarios independientes para cada negocio o comercio. Cada negocio inicia sesión en el panel con sus propios buzones IMAP, clientes y movimientos aislados.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={openCreateBusinessUserModal}
                  className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-500"
                >
                  <Plus className="h-4 w-4" />
                  + Nueva Cuenta de Negocio
                </button>
              </div>

              {lastBusinessCredentials && (
                <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-emerald-500/40 bg-emerald-950/30 px-4 py-3 text-xs text-emerald-200">
                  <div>
                    <strong>
                      Última cuenta creada ({lastBusinessCredentials.negocio}):
                    </strong>{' '}
                    Correo <code className="text-white">{lastBusinessCredentials.email}</code>
                    {lastBusinessCredentials.password && (
                      <>
                        {' '}
                        · Contraseña{' '}
                        <code className="text-white">
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
                    className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-400/40 bg-emerald-500/15 px-3 py-1.5 font-semibold text-emerald-200 hover:bg-emerald-500/25"
                  >
                    <Copy className="h-3.5 w-3.5" />
                    Copiar Acceso del Negocio
                  </button>
                </div>
              )}

              <div className="overflow-hidden rounded-xl border border-slate-800 bg-slate-900/70 shadow-xl">
                <div className="border-b border-slate-800 bg-slate-950/60 px-5 py-3.5">
                  <h3 className="text-sm font-bold uppercase tracking-wider text-slate-300">
                    Negocios Registrados ({businessUsers.length})
                  </h3>
                </div>
                <div className="overflow-x-auto xl:overflow-x-visible">
                  <table className="w-full border-collapse text-left text-sm table-auto">
                    <thead>
                      <tr className="border-b border-slate-800 bg-slate-950/40 text-xs font-semibold uppercase tracking-wider text-slate-400">
                        <th className="px-4 py-3">Negocio / Empresa</th>
                        <th className="px-4 py-3">Usuario &amp; Correo Login</th>
                        <th className="px-4 py-3">Rol</th>
                        <th className="px-4 py-3">Entorno Aislado</th>
                        <th className="px-4 py-3">Último Ingreso</th>
                        <th className="px-4 py-3 text-right">Acciones</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-800/70">
                      {businessUsers.map((biz) => {
                        const isActiveScope = activeNegocioId === biz.id;
                        return (
                          <tr key={biz.id} className="hover:bg-slate-800/40">
                            <td className="px-4 py-3.5">
                              <div className="flex items-center gap-2 font-semibold text-white">
                                <Briefcase className="h-4 w-4 text-violet-400" />
                                {biz.nombre_negocio}
                                {isActiveScope && (
                                  <span className="rounded-full border border-emerald-500/40 bg-emerald-500/15 px-2 py-0.5 text-[10px] font-bold text-emerald-300">
                                    Viendo ahora
                                  </span>
                                )}
                              </div>
                            </td>
                            <td className="px-4 py-3.5 text-xs text-slate-300">
                              <div className="font-medium text-white">
                                {biz.nombre_usuario}
                              </div>
                              <div className="font-mono text-[11px] text-sky-300">
                                {biz.email}
                              </div>
                              {biz.telefono && (
                                <div className="text-[11px] text-slate-400">
                                  {biz.telefono}
                                </div>
                              )}
                            </td>
                            <td className="px-4 py-3.5">
                              <span
                                className={`inline-flex rounded-full border px-2 py-0.5 text-[10px] font-bold ${
                                  biz.rol === 'SUPER_ADMIN'
                                    ? 'border-violet-500/40 bg-violet-500/15 text-violet-300'
                                    : 'border-sky-500/40 bg-sky-500/15 text-sky-300'
                                }`}
                              >
                                {biz.rol === 'SUPER_ADMIN'
                                  ? 'SUPER ADMIN'
                                  : 'NEGOCIO'}
                              </span>
                            </td>
                            <td className="px-4 py-3.5 text-xs text-slate-300">
                              {biz.mailboxes_count ?? 0} correo(s) ·{' '}
                              {biz.clients_count ?? 0} cliente(s) ·{' '}
                              {biz.transactions_count ?? 0} mov.
                            </td>
                            <td className="px-4 py-3.5 text-xs text-slate-400">
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
                                    className="inline-flex items-center gap-1 rounded-lg border border-violet-500/40 bg-violet-500/15 px-2.5 py-1.5 text-xs font-semibold text-violet-200 hover:bg-violet-500/25"
                                  >
                                    Ver Panel
                                  </button>
                                )}
                                <button
                                  type="button"
                                  onClick={() => openEditBusinessUserModal(biz)}
                                  className="inline-flex items-center gap-1 rounded-lg border border-slate-700 bg-slate-800 px-2.5 py-1.5 text-xs font-medium text-slate-200 hover:bg-slate-700"
                                >
                                  <KeyRound className="h-3 w-3 text-emerald-400" />
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
                                    className="rounded-lg p-1.5 text-slate-400 hover:bg-rose-950/60 hover:text-rose-300"
                                    title="Eliminar negocio"
                                  >
                                    <Trash2 className="h-3.5 w-3.5" />
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
              <div className="rounded-xl border border-slate-800 bg-slate-900/70 p-5 shadow-xl space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800 pb-3">
                  <div className="flex items-center gap-2.5">
                    <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-emerald-500/10 text-emerald-400">
                      <Bot className="h-5 w-5" />
                    </div>
                    <div>
                      <h3 className="text-sm font-bold text-white">
                        Motor de Inteligencia Artificial (Visión OCR de Comprobantes)
                      </h3>
                      <p className="text-xs text-slate-400">
                        Compatible con Google Gemini (Gratis), Groq Cloud (Gratis) u OpenAI. Lee capturas Zelle y Binance y rellena los campos automáticamente.
                      </p>
                    </div>
                  </div>
                  <div>
                    {aiSettings?.hasGeminiKey ? (
                      <span className="inline-flex items-center gap-1.5 rounded-full border border-sky-500/40 bg-sky-500/10 px-3 py-1 text-xs font-semibold text-sky-300">
                        <span className="h-2 w-2 rounded-full bg-sky-400 animate-pulse" />
                        Google Gemini Activo ({aiSettings.geminiModel ?? 'gemini-3.5-flash-lite'}) · {aiSettings.geminiKeyPreview}
                      </span>
                    ) : aiSettings?.hasGroqKey ? (
                      <span className="inline-flex items-center gap-1.5 rounded-full border border-orange-500/40 bg-orange-500/10 px-3 py-1 text-xs font-semibold text-orange-300">
                        <span className="h-2 w-2 rounded-full bg-orange-400 animate-pulse" />
                        Groq Vision Activo ({aiSettings.groqModel ?? 'llama-3.2'}) · {aiSettings.groqKeyPreview}
                      </span>
                    ) : aiSettings?.hasOpenAiKey ? (
                      <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/40 bg-emerald-500/10 px-3 py-1 text-xs font-semibold text-emerald-400">
                        <span className="h-2 w-2 rounded-full bg-emerald-400 animate-pulse" />
                        OpenAI Vision Activo ({aiSettings.openAiModel}) · {aiSettings.openAiKeyPreview}
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-500/40 bg-amber-500/10 px-3 py-1 text-xs font-semibold text-amber-300">
                        <AlertCircle className="h-3.5 w-3.5" />
                        Sin API Key configurada (Modo Manual / Vectorial)
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
                      <label className="block text-[11px] font-semibold uppercase tracking-wider text-slate-300 mb-1.5">
                        Proveedor de Inteligencia Artificial
                      </label>
                      <select
                        value={selectedAiProvider}
                        onChange={(e) =>
                          setSelectedAiProvider(
                            e.target.value as 'gemini' | 'openai' | 'groq'
                          )
                        }
                        className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2.5 text-xs font-semibold text-white focus:border-emerald-500 focus:outline-none"
                      >
                        <option value="gemini">
                          ⭐ Google Gemini (100% Gratis - Recomendado)
                        </option>
                        <option value="groq">
                          ⚡ Groq Cloud (Llama 3.2 Vision - Gratuito)
                        </option>
                        <option value="openai">
                          🤖 OpenAI (gpt-4o-mini - De Pago)
                        </option>
                      </select>
                    </div>

                    <div className="sm:col-span-5">
                      <div className="flex items-center justify-between mb-1.5">
                        <label className="block text-[11px] font-semibold uppercase tracking-wider text-slate-300">
                          {selectedAiProvider === 'gemini'
                            ? 'Clave de Google Gemini (AI Studio)'
                            : selectedAiProvider === 'groq'
                              ? 'Clave de Groq API (gsk_...)'
                              : 'Clave de OpenAI API (sk-proj-...)'}
                        </label>
                        <span className="text-[10px] text-slate-400">
                          {selectedAiProvider === 'gemini' ? 'Empieza por AQ. o AIzaSy...' : selectedAiProvider === 'groq' ? 'Empieza por gsk_...' : 'Empieza por sk-...'}
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
                        className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3.5 py-2.5 text-xs text-white placeholder-slate-500 focus:border-emerald-500 focus:outline-none"
                      />
                    </div>

                    <div className="sm:col-span-3 flex items-end gap-2">
                      <button
                        type="button"
                        onClick={() => void handleVerifyAiKey()}
                        disabled={isVerifyingAiConfig || isSavingAiConfig || !openAiInputKey.trim()}
                        className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-sky-500/40 bg-sky-950/40 px-3 py-2.5 text-xs font-semibold text-sky-300 shadow-md shadow-sky-950/40 hover:bg-sky-900/50 disabled:opacity-50"
                      >
                        {isVerifyingAiConfig ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <CheckCircle2 className="h-3.5 w-3.5" />
                        )}
                        Probar
                      </button>
                      <button
                        type="submit"
                        disabled={isSavingAiConfig || isVerifyingAiConfig || !openAiInputKey.trim()}
                        className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-2.5 text-xs font-semibold text-white shadow-md shadow-emerald-950/40 hover:bg-emerald-500 disabled:opacity-50"
                      >
                        {isSavingAiConfig ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <Sparkles className="h-3.5 w-3.5" />
                        )}
                        Guardar
                      </button>
                    </div>
                  </div>

                  {/* Feedback de verificación en vivo */}
                  {verifyFeedback && (
                    <div
                      className={`rounded-lg border px-3.5 py-2 text-xs flex items-center gap-2 ${
                        verifyFeedback.ok
                          ? 'border-emerald-500/40 bg-emerald-950/40 text-emerald-200'
                          : 'border-rose-500/40 bg-rose-950/40 text-rose-200'
                      }`}
                    >
                      {verifyFeedback.ok ? (
                        <CheckCircle2 className="h-4 w-4 text-emerald-400 shrink-0" />
                      ) : (
                        <AlertTriangle className="h-4 w-4 text-rose-400 shrink-0" />
                      )}
                      <span>{verifyFeedback.message}</span>
                    </div>
                  )}

                  {/* Enlaces de ayuda para obtener API keys gratis */}
                  <div className="flex flex-wrap items-center gap-3 pt-1 text-[11px] text-slate-400">
                    <span className="font-semibold text-slate-300">¿No tienes clave?</span>
                    {selectedAiProvider === 'gemini' && (
                      <a
                        href="https://aistudio.google.com/app/apikey"
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1 font-semibold text-sky-400 hover:text-sky-300 underline"
                      >
                        <ExternalLink className="h-3 w-3" />
                        Obtener API Key GRATIS en Google AI Studio (sin tarjeta de crédito)
                      </a>
                    )}
                    {selectedAiProvider === 'groq' && (
                      <a
                        href="https://console.groq.com/keys"
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1 font-semibold text-orange-400 hover:text-orange-300 underline"
                      >
                        <ExternalLink className="h-3 w-3" />
                        Obtener API Key GRATIS en Groq Cloud (Llama 3.2 Vision)
                      </a>
                    )}
                    {selectedAiProvider === 'openai' && (
                      <a
                        href="https://platform.openai.com/api-keys"
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1 font-semibold text-emerald-400 hover:text-emerald-300 underline"
                      >
                        <ExternalLink className="h-3 w-3" />
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
            <Dialog.Overlay className="fixed inset-0 z-40 bg-slate-950/85 backdrop-blur-sm" />
            <Dialog.Content className="fixed left-1/2 top-1/2 z-50 max-h-[92vh] w-[95vw] max-w-5xl -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-2xl border border-slate-800 bg-slate-900 p-6 text-slate-100 shadow-2xl">
              <div className="flex items-start justify-between border-b border-slate-800 pb-4">
                <div>
                  <Dialog.Title className="text-lg font-bold text-white">
                    {lightboxData?.title}
                  </Dialog.Title>
                  <Dialog.Description className="mt-1 text-xs text-slate-400">
                    Comparativa visual entre el comprobante subido por el cliente y los datos extraídos por el motor bancario / Binance API.
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
                      <div className="flex items-center justify-between text-xs font-semibold uppercase tracking-wider text-sky-300">
                        <span>Comprobante Subido en Portal</span>
                        {lightboxData.order?.codigo_orden && (
                          <span className="font-mono">
                            {lightboxData.order.codigo_orden}
                          </span>
                        )}
                      </div>
                      <div className="flex min-h-[340px] items-center justify-center rounded-xl border border-slate-800 bg-slate-950 p-3">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={lightboxData.comprobanteBase64}
                          alt="Captura del cliente"
                          className="max-h-[480px] w-auto rounded-lg object-contain"
                        />
                      </div>
                      {lightboxData.order?.datos_ocr_extraidos && (
                        <div className="rounded-xl border border-slate-800 bg-slate-950 p-3 text-xs">
                          <div className="font-semibold text-slate-200">
                            Validación OCR / Metadatos:
                          </div>
                          <div className="mt-1 text-slate-400">
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
                          <div className="rounded-xl border border-rose-500/60 bg-rose-950/40 p-4 text-xs">
                            <div className="flex items-start gap-3">
                              <AlertTriangle className="h-5 w-5 shrink-0 text-rose-400 mt-0.5" />
                              <div className="space-y-1.5">
                                <p className="font-bold text-rose-200">
                                  ⚠️ ALERTA DE DISPARIDAD CRÍTICA DE REMITENTE (Similitud: {Math.round(senderSimilarityScore * 100)}%)
                                </p>
                                <p className="text-slate-300">
                                  El nombre reportado por el cliente en el comprobante (<strong className="text-amber-300">&quot;{reportedSenderName}&quot;</strong>) 
                                  no coincide con el remitente extraído del correo bancario (<strong className="text-white">&quot;{channelSenderName}&quot;</strong>), 
                                  y las referencias (<span className="font-mono text-amber-200">{orderReference || 'SIN-REF'}</span> vs <span className="font-mono text-emerald-200">{channelReference}</span>) no concuerdan.
                                </p>
                                <p className="text-rose-300/90 font-medium">
                                  Precaución: No concilie esta fila a ciegas para evitar cruces indebidos de dinero entre personas distintas.
                                </p>

                                {legitimateMatchingTx && (
                                  <div className="mt-3 rounded-lg border border-emerald-500/40 bg-emerald-950/60 p-3">
                                    <div className="flex flex-col gap-2.5 sm:flex-row sm:items-center sm:justify-between">
                                      <div>
                                        <p className="font-bold text-emerald-300">
                                          Transacción Bancaria Legítima Encontrada:
                                        </p>
                                        <p className="mt-0.5 text-slate-200">
                                          <strong>{legitimateMatchingTx.remitente_o_contraparte}</strong> ·{' '}
                                          <span className="font-mono text-emerald-400 font-semibold">{formatMoney(legitimateMatchingTx.monto_bruto, legitimateMatchingTx.moneda)}</span> ·{' '}
                                          <span className="font-mono text-slate-400">Ref: {legitimateMatchingTx.referencia}</span> ({legitimateMatchingTx.estado})
                                        </p>
                                      </div>
                                      <button
                                        type="button"
                                        onClick={() => {
                                          setLightboxData((prev) => (prev ? { ...prev, tx: legitimateMatchingTx } : null));
                                        }}
                                        className="inline-flex shrink-0 items-center gap-1 rounded-md bg-emerald-600 px-3 py-1.5 text-xs font-bold text-white transition hover:bg-emerald-500 cursor-pointer shadow-md"
                                      >
                                        <CheckCircle2 className="h-3.5 w-3.5" />
                                        Ver Este Pago Coincidente
                                      </button>
                                    </div>
                                  </div>
                                )}
                              </div>
                            </div>
                          </div>
                        )}

                        {lightboxData.order && (
                        <div className="rounded-xl border border-sky-500/30 bg-sky-950/20 p-4">
                          <h4 className="text-xs font-bold uppercase tracking-wider text-sky-300">
                            Datos Reportados por el Cliente
                          </h4>
                          <dl className="mt-3 grid grid-cols-2 gap-3 text-xs">
                            <div>
                              <dt className="text-slate-400">Cliente Titular</dt>
                              <dd className="mt-0.5 font-semibold text-white">
                                {lightboxData.order.cliente_nombre}
                              </dd>
                            </div>
                            <div>
                              <dt className="text-slate-400">Canal Esperado</dt>
                              <dd className="mt-0.5 font-semibold text-white">
                                {lightboxData.order.plataforma_esperada}
                              </dd>
                            </div>
                            <div>
                              <dt className="text-slate-400">Monto Reportado</dt>
                              <dd className="mt-0.5 font-mono font-bold text-emerald-400">
                                {formatMoney(
                                  lightboxData.order.monto_esperado,
                                  lightboxData.order.moneda
                                )}
                              </dd>
                            </div>
                            <div>
                              <dt className="text-slate-400">Referencia Reportada</dt>
                              <dd className="mt-0.5 font-mono text-white">
                                {lightboxData.order.referencia_reportada}
                              </dd>
                            </div>
                            <div className="col-span-2">
                              <dt className="text-slate-400">Remitente Reportado</dt>
                              <dd className="mt-0.5 font-semibold text-amber-300">
                                {lightboxData.order.remitente_reportado ||
                                  lightboxData.order.nombre_remitente_reportado}
                              </dd>
                            </div>
                            {lightboxData.order.fecha_transferencia && (
                              <div className="col-span-2">
                                <dt className="text-slate-400">Fecha de Transferencia (Comprobante)</dt>
                                <dd className="mt-0.5 font-mono font-semibold text-sky-300">
                                  {lightboxData.order.fecha_transferencia}
                                </dd>
                              </div>
                            )}
                          </dl>
                        </div>
                      )}

                      {lightboxData.tx ? (
                        <div className="rounded-xl border border-emerald-500/30 bg-slate-950 p-4">
                          <h4 className="text-xs font-bold uppercase tracking-wider text-emerald-300">
                            Datos Extraídos del Canal ({lightboxData.tx.origen_deteccion})
                          </h4>
                          <dl className="mt-3 grid grid-cols-2 gap-3 text-xs">
                            <div>
                              <dt className="text-slate-400">Plataforma Real</dt>
                              <dd className="mt-0.5 font-semibold text-white">
                                {lightboxData.tx.plataforma}
                              </dd>
                            </div>
                            <div>
                              <dt className="text-slate-400">Estado Actual</dt>
                              <dd className="mt-0.5 font-semibold text-amber-300">
                                {lightboxData.tx.estado}
                              </dd>
                            </div>
                            <div>
                              <dt className="text-slate-400">Monto Bruto Real</dt>
                              <dd className="mt-0.5 font-mono font-bold text-white">
                                {formatMoney(
                                  lightboxData.tx.monto_bruto,
                                  lightboxData.tx.moneda
                                )}
                              </dd>
                            </div>
                            <div>
                              <dt className="text-slate-400">Referencia Real</dt>
                              <dd className="mt-0.5 font-mono text-emerald-300">
                                {lightboxData.tx.referencia}
                              </dd>
                            </div>
                            <div className="col-span-2">
                              <dt className="text-slate-400">
                                Remitente / Contraparte Real
                              </dt>
                              <dd className="mt-0.5 font-semibold text-white">
                                {lightboxData.tx.remitente_o_contraparte}
                              </dd>
                            </div>
                            <div className="col-span-2">
                              <dt className="text-slate-400">Dedup Key</dt>
                              <dd className="mt-0.5 break-all font-mono text-[11px] text-slate-400">
                                {lightboxData.tx.dedup_key}
                              </dd>
                            </div>
                          </dl>
                          {lightboxData.tx.nota_auditoria && (
                            <p className="mt-3 rounded-lg bg-slate-900 p-2.5 text-xs text-slate-300">
                              {lightboxData.tx.nota_auditoria}
                            </p>
                          )}
                        </div>
                      ) : (
                        <div className="rounded-xl border border-slate-800 bg-slate-950 p-4 text-xs text-slate-400">
                          Aún no ha ingresado una transacción bancaria o de Binance que coincida con esta orden pendiente.
                        </div>
                      )}
                    </div>

                    <div className="flex justify-end gap-3 border-t border-slate-800 pt-4">
                      <Dialog.Close asChild>
                        <button
                          type="button"
                          className="rounded-lg border border-slate-700 px-4 py-2 text-xs font-medium text-slate-300 hover:bg-slate-800"
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
                              className="inline-flex items-center gap-1.5 rounded-lg border border-rose-500/40 bg-rose-500/15 px-4 py-2 text-xs font-bold text-rose-300 hover:bg-rose-500/30 cursor-pointer"
                            >
                              <Trash2 className="h-4 w-4" />
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
                              className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-4 py-2 text-xs font-bold text-white hover:bg-emerald-500 cursor-pointer"
                            >
                              <CheckCircle2 className="h-4 w-4" />
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
                            className="inline-flex items-center gap-1.5 rounded-lg bg-amber-500 px-4 py-2 text-xs font-bold text-slate-950 hover:bg-amber-400"
                          >
                            <UserCheck className="h-4 w-4" />
                            Conciliar Manualmente
                          </button>
                        )}

                      {lightboxData.tx &&
                        lightboxData.tx.estado === 'CONCILIADO' && (
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
                            className="inline-flex items-center gap-1.5 rounded-lg border border-rose-500/40 bg-rose-500/15 px-4 py-2 text-xs font-bold text-rose-300 hover:bg-rose-500/30"
                          >
                            <RotateCcw className="h-4 w-4" />
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
            <Dialog.Overlay className="fixed inset-0 z-40 bg-slate-950/85 backdrop-blur-sm" />
            <Dialog.Content className="fixed left-1/2 top-1/2 z-50 w-[95vw] max-w-xl -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-emerald-500/40 bg-slate-900 p-6 text-slate-100 shadow-2xl">
              <div className="flex items-start justify-between border-b border-slate-800 pb-4">
                <div>
                  <Dialog.Title className="text-lg font-bold text-white">
                    Confirmar Manualmente Captura del Cliente
                  </Dialog.Title>
                  <Dialog.Description className="mt-1 text-xs text-slate-400">
                    Aprueba y acredita esta orden enviada desde el portal aunque no haya llegado el correo del banco, o vincúlala con un correo DETECTADO.
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
                      <div className="rounded-xl border border-rose-500/50 bg-rose-950/50 p-3.5 text-xs text-rose-200">
                        <div className="flex items-start gap-2.5">
                          <AlertTriangle className="h-4 w-4 shrink-0 text-rose-400 mt-0.5" />
                          <div>
                            <p className="font-bold text-rose-200">
                              ⚠️ Atención: Referencia ya conciliada previamente
                            </p>
                            <p className="mt-0.5 text-slate-300">
                              La referencia <strong className="font-mono text-white">{selectedOrderForManualConfirm.referencia_reportada}</strong> ya fue conciliada y acreditada en el pago de <strong>{alreadyReconciledTx.remitente_o_contraparte}</strong> ({formatMoney(alreadyReconciledTx.monto_bruto, alreadyReconciledTx.moneda)} · Ref: <span className="font-mono">{alreadyReconciledTx.referencia}</span>). Si esta captura es repetida, te recomendamos usar <strong>&quot;Descartar&quot;</strong> para no acreditar el saldo dos veces.
                            </p>
                          </div>
                        </div>
                      </div>
                    )}

                    <div className="rounded-xl border border-slate-800 bg-slate-950 p-4 text-xs space-y-2.5">
                      <div className="flex items-center justify-between">
                        <span className="text-slate-400">
                          Orden:{' '}
                          <strong className="font-mono text-sky-300">
                            {selectedOrderForManualConfirm.codigo_orden}
                          </strong>
                        </span>
                        <span className="text-slate-400">
                          Cliente Titular:{' '}
                          <strong className="text-emerald-300">
                            {selectedOrderForManualConfirm.cliente_nombre}
                          </strong>
                        </span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-slate-400">
                          Remitente Reportado:{' '}
                          <strong className="text-white">
                            {selectedOrderForManualConfirm.remitente_reportado ||
                              selectedOrderForManualConfirm.nombre_remitente_reportado}
                          </strong>
                        </span>
                        <span className="text-slate-400">
                          Ref:{' '}
                          <strong className="font-mono text-amber-300">
                            {selectedOrderForManualConfirm.referencia_reportada || 'SIN-REF'}
                          </strong>
                        </span>
                      </div>

                      <div className="grid grid-cols-3 gap-2 border-t border-slate-800 pt-3 text-center">
                        <div>
                          <span className="block text-[11px] uppercase text-slate-400">
                            Monto Bruto
                          </span>
                          <span className="font-mono text-sm font-bold text-white">
                            {formatMoney(
                              selectedOrderForManualConfirm.monto_esperado,
                              selectedOrderForManualConfirm.moneda
                            )}
                          </span>
                        </div>
                        <div>
                          <span className="block text-[11px] uppercase text-slate-400">
                            Comisión ({feePct}%)
                          </span>
                          <span className="font-mono text-sm font-semibold text-violet-300">
                            -{formatMoney(comision, selectedOrderForManualConfirm.moneda)}
                          </span>
                        </div>
                        <div>
                          <span className="block text-[11px] uppercase text-emerald-400">
                            Neto a Acreditar
                          </span>
                          <span className="font-mono text-sm font-bold text-emerald-400">
                            {formatMoney(neto, selectedOrderForManualConfirm.moneda)}
                          </span>
                        </div>
                      </div>
                    </div>

                    <div>
                      <label className="block text-xs font-semibold uppercase tracking-wider text-slate-300">
                        Modo de Confirmación
                      </label>
                      <select
                        value={orderConfirmLinkedTxId}
                        onChange={(e) => setOrderConfirmLinkedTxId(e.target.value)}
                        className="mt-1.5 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2.5 text-xs text-white focus:border-emerald-500 focus:outline-none"
                      >
                        <option value="">
                          ✅ Acreditar directamente sin correo del banco (Confirmación Manual por Captura)
                        </option>
                        {availableUnreconciledTxs.map((tx) => {
                          const isSameAmt =
                            Math.abs(
                              tx.monto_bruto -
                                selectedOrderForManualConfirm.monto_esperado
                            ) < 0.01;
                          return (
                            <option key={tx.id} value={tx.id}>
                              {isSameAmt ? '★ [MISMO MONTO] ' : ''}
                              Vincular con correo DETECTADO: {tx.remitente_o_contraparte} ·{' '}
                              {formatMoney(tx.monto_bruto, tx.moneda)} · Ref: {tx.referencia} (
                              {formatDateTime(tx.fecha_transaccion)})
                            </option>
                          );
                        })}
                      </select>
                    </div>

                    <div>
                      <label className="block text-xs font-semibold uppercase tracking-wider text-slate-300">
                        Nota de Auditoría
                      </label>
                      <textarea
                        rows={2}
                        value={orderConfirmNotes}
                        onChange={(e) => setOrderConfirmNotes(e.target.value)}
                        className="mt-1.5 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-xs text-slate-200 focus:border-emerald-500 focus:outline-none"
                      />
                    </div>

                    <div className="flex items-center justify-end gap-3 border-t border-slate-800 pt-4">
                      <Dialog.Close asChild>
                        <button
                          type="button"
                          className="rounded-lg border border-slate-700 px-4 py-2 text-xs font-medium text-slate-300 hover:bg-slate-800"
                        >
                          Cancelar
                        </button>
                      </Dialog.Close>
                      <button
                        type="submit"
                        disabled={isSubmittingOrderConfirm}
                        className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-5 py-2 text-xs font-bold text-white hover:bg-emerald-500 disabled:opacity-60 cursor-pointer"
                      >
                        {isSubmittingOrderConfirm ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <CheckCircle2 className="h-4 w-4" />
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
            <Dialog.Overlay className="fixed inset-0 z-40 bg-slate-950/80 backdrop-blur-sm" />
            <Dialog.Content className="fixed left-1/2 top-1/2 z-50 max-h-[90vh] w-[95vw] max-w-2xl -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-2xl border border-slate-800 bg-slate-900 p-6 text-slate-100 shadow-2xl">
              <div className="flex items-start justify-between border-b border-slate-800 pb-4">
                <div>
                  <Dialog.Title className="text-lg font-bold text-white">
                    {editingClientId
                      ? 'Editar Cuenta y PIN de Acceso'
                      : 'Crear Cuenta de Acceso al Portal'}
                  </Dialog.Title>
                  <Dialog.Description className="mt-1 text-xs text-slate-400">
                    Define el correo, el PIN de ingreso en /portal, los porcentajes de comisión y las cuentas receptoras asignadas a este cliente.
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
                    Nombre del Cliente / Titular *
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
                      Correo de Acceso al Portal *
                    </label>
                    <input
                      type="email"
                      required
                      value={newClientEmail}
                      onChange={(e) => setNewClientEmail(e.target.value)}
                      placeholder="cliente@correo.com"
                      className="mt-1.5 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold uppercase text-slate-300">
                      WhatsApp / Teléfono
                    </label>
                    <input
                      type="text"
                      value={newClientPhone}
                      onChange={(e) => setNewClientPhone(e.target.value)}
                      placeholder="+1 305..."
                      className="mt-1.5 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white"
                    />
                  </div>
                </div>

                <div>
                  <div className="flex items-center justify-between">
                    <label className="block text-xs font-semibold uppercase text-slate-300">
                      PIN de Acceso (4 a 6 dígitos) {editingClientId ? '(Opcional al editar)' : '*'}
                    </label>
                    <button
                      type="button"
                      onClick={handleGenerateRandomPin}
                      className="text-[11px] font-semibold text-emerald-400 hover:text-emerald-300"
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
                    className="mt-1.5 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 font-mono text-sm tracking-widest text-white"
                  />
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-semibold uppercase text-slate-300">
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
                      className="mt-1.5 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 font-mono text-sm text-white"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold uppercase text-slate-300">
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
                      className="mt-1.5 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 font-mono text-sm text-white"
                    />
                  </div>
                </div>

                {/* Cuentas Receptoras Asignadas */}
                <div className="rounded-xl border border-slate-800 bg-slate-950/70 p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <h4 className="text-xs font-bold uppercase tracking-wider text-emerald-300">
                        Cuentas Receptoras Asignadas (A qué cuenta envía y Moneda)
                      </h4>
                      <p className="mt-0.5 text-[11px] text-slate-400">
                        El cliente verá únicamente estas cuentas en /portal para saber a dónde enviar y en qué moneda.
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={handleAddCustomAssignedAccount}
                      className="inline-flex items-center gap-1 rounded-lg border border-emerald-500/40 bg-emerald-500/15 px-2.5 py-1 text-[11px] font-semibold text-emerald-300 hover:bg-emerald-500/25"
                    >
                      <Plus className="h-3.5 w-3.5" />
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
                                  ? 'border-emerald-500/50 bg-emerald-500/20 text-emerald-200'
                                  : 'border-slate-700 bg-slate-900 text-slate-400 hover:border-slate-500'
                              }`}
                            >
                              <Check
                                className={`h-3 w-3 ${
                                  assigned ? 'opacity-100' : 'opacity-25'
                                }`}
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
                    <p className="mt-3 rounded-lg border border-dashed border-slate-800 px-3 py-2.5 text-center text-[11px] text-slate-400">
                      No hay cuentas asignadas todavía. Selecciona un buzón de arriba o haz clic en &quot;Agregar Cuenta&quot;.
                    </p>
                  ) : (
                    <div className="mt-3 space-y-2.5">
                      {newClientAssignedAccounts.map((acc, idx) => (
                        <div
                          key={acc.id}
                          className="grid grid-cols-1 gap-2 rounded-lg border border-slate-800 bg-slate-900/90 p-2.5 sm:grid-cols-12 sm:items-end"
                        >
                          <div className="sm:col-span-3">
                            <label className="block text-[10px] font-semibold uppercase text-slate-400">
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
                              className="mt-1 w-full rounded border border-slate-700 bg-slate-950 px-2 py-1.5 text-xs text-white"
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
                            <label className="block text-[10px] font-semibold uppercase text-slate-400">
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
                              className="mt-1 w-full rounded border border-slate-700 bg-slate-950 px-2.5 py-1.5 font-mono text-xs text-white"
                            />
                          </div>
                          <div className="sm:col-span-2">
                            <label className="block text-[10px] font-semibold uppercase text-slate-400">
                              Moneda
                            </label>
                            <select
                              value={acc.moneda}
                              onChange={(e) =>
                                handleUpdateAssignedAccount(idx, {
                                  moneda: e.target.value as CurrencyType,
                                })
                              }
                              className="mt-1 w-full rounded border border-slate-700 bg-slate-950 px-2 py-1.5 font-mono text-xs text-white"
                            >
                              <option value="USD">USD</option>
                              <option value="USDT">USDT</option>
                              <option value="VES">VES</option>
                            </select>
                          </div>
                          <div className="flex items-end gap-1.5 sm:col-span-3">
                            <div className="flex-1">
                              <label className="block text-[10px] font-semibold uppercase text-slate-400">
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
                                className="mt-1 w-full rounded border border-slate-700 bg-slate-950 px-2 py-1.5 text-xs text-white"
                              />
                            </div>
                            <button
                              type="button"
                              onClick={() => handleRemoveAssignedAccount(idx)}
                              className="rounded border border-slate-700 p-1.5 text-slate-400 hover:border-rose-500/50 hover:text-rose-300"
                              title="Quitar cuenta"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
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
            <Dialog.Overlay className="fixed inset-0 z-40 bg-slate-950/80 backdrop-blur-sm" />
            <Dialog.Content className="fixed left-1/2 top-1/2 z-50 w-full max-w-lg -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-slate-800 bg-slate-900 p-6 text-slate-100 shadow-2xl">
              <div className="flex items-start justify-between border-b border-slate-800 pb-4">
                <div>
                  <Dialog.Title className="text-lg font-bold text-white">
                    Registrar Orden de Pago Esperada
                  </Dialog.Title>
                  <Dialog.Description className="mt-1 text-xs text-slate-400">
                    Registra una orden Zelle o Binance esperada para conciliación automática.
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
                    Remitente Zelle o Nickname Binance
                  </label>
                  <input
                    type="text"
                    value={orderZelleSender}
                    onChange={(e) => setOrderZelleSender(e.target.value)}
                    placeholder="Ej. ALEJANDRO JOSE PEREZ o CarlosMendoza_Pay"
                    className="mt-1.5 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white"
                  />
                </div>

                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div>
                    <label className="block text-xs font-semibold uppercase text-slate-300">
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
                      className="mt-1.5 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white"
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
                    <label className="block text-xs font-semibold uppercase text-slate-300">
                      Moneda
                    </label>
                    <select
                      value={orderCurrency}
                      onChange={(e) =>
                        setOrderCurrency(e.target.value as CurrencyType)
                      }
                      className="mt-1.5 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 font-mono text-sm text-white"
                    >
                      <option value="USD">USD</option>
                      <option value="USDT">USDT</option>
                    </select>
                  </div>
                </div>

                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div>
                    <label className="block text-xs font-semibold uppercase text-slate-300">
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
                      className="mt-1.5 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 font-mono text-sm text-white"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-semibold uppercase text-slate-300">
                      Referencia / Order ID / TxID
                    </label>
                    <input
                      type="text"
                      value={orderReference}
                      onChange={(e) => setOrderReference(e.target.value)}
                      placeholder="CITI992048112 o 293849201192"
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
            <Dialog.Overlay className="fixed inset-0 z-40 bg-slate-950/80 backdrop-blur-sm" />
            <Dialog.Content className="fixed left-1/2 top-1/2 z-50 w-full max-w-xl -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-slate-800 bg-slate-900 p-6 text-slate-100 shadow-2xl">
              <div className="flex items-start justify-between border-b border-slate-800 pb-4">
                <div>
                  <Dialog.Title className="text-lg font-bold text-white">
                    Conciliación Manual Multi-Canal
                  </Dialog.Title>
                  <Dialog.Description className="mt-1 text-xs text-slate-400">
                    Asigna este depósito Zelle o Binance a su orden pendiente o cliente titular.
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
                        Plataforma:{' '}
                        <strong className="text-white">
                          {selectedAlertForMatch.plataforma}
                        </strong>
                      </span>
                      <span>
                        Ref:{' '}
                        <strong className="font-mono text-white">
                          {selectedAlertForMatch.referencia || 'N/A'}
                        </strong>
                      </span>
                    </div>
                    <div className="mt-2 text-sm">
                      <span className="text-slate-400">Contraparte: </span>
                      <strong className="text-amber-300">
                        {selectedAlertForMatch.remitente_o_contraparte}
                      </strong>
                    </div>
                    <div className="mt-3 grid grid-cols-3 gap-2 border-t border-slate-800 pt-3 text-center">
                      <div>
                        <span className="block text-[11px] uppercase text-slate-400">
                          Monto Bruto
                        </span>
                        <span className="font-mono text-sm font-bold text-white">
                          {formatMoney(
                            selectedAlertForMatch.monto_bruto,
                            selectedAlertForMatch.moneda
                          )}
                        </span>
                      </div>
                      <div>
                        <span className="block text-[11px] uppercase text-slate-400">
                          Comisión ({selectedAlertForMatch.porcentaje_comision}%)
                        </span>
                        <span className="font-mono text-sm font-semibold text-violet-300">
                          -
                          {formatMoney(
                            selectedAlertForMatch.monto_comision,
                            selectedAlertForMatch.moneda
                          )}
                        </span>
                      </div>
                      <div>
                        <span className="block text-[11px] uppercase text-emerald-400">
                          Neto a Acreditar
                        </span>
                        <span className="font-mono text-sm font-bold text-emerald-400">
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
                      className="block text-xs font-semibold uppercase tracking-wider text-slate-300"
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
                      className="mt-1.5 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2.5 text-sm text-white focus:border-emerald-500 focus:outline-none"
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
                            {isExactAmount ? '★ [MONTO EXACTO] ' : ''}
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
                    {!selectedOrderId && selectedAlertForMatch && (
                      <div className="mt-2 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-200">
                        <strong>⚠️ Regla de Conciliación:</strong> Estás por asignar directamente sin una orden de pago reportada. Un pago solo puede conciliarse a quien realmente lo haya enviado. El remitente bancario (<strong>{selectedAlertForMatch.remitente_o_contraparte}</strong>) debe coincidir con el cliente o estar en su lista de remitentes autorizados. Si es un tercero nuevo, el cliente debe reportar el comprobante desde su portal.
                      </div>
                    )}
                  </div>

                  <div>
                    <label
                      htmlFor="manual-audit-notes"
                      className="block text-xs font-semibold uppercase tracking-wider text-slate-300"
                    >
                      3. Justificación / Nota de Auditoría
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
            <Dialog.Overlay className="fixed inset-0 z-40 bg-slate-950/80 backdrop-blur-sm" />
            <Dialog.Content className="fixed left-1/2 top-1/2 z-50 w-full max-w-lg -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-slate-800 bg-slate-900 p-6 text-slate-100 shadow-2xl">
              <div className="flex items-center justify-between border-b border-slate-800 pb-3">
                <Dialog.Title className="text-base font-bold text-white">
                  Payload Original &amp; Llave de Idempotencia
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
                  <div className="space-y-1 rounded-lg bg-slate-950 p-3 font-mono text-slate-300">
                    <div>External ID: {inspectedAlert.external_unique_id}</div>
                    <div className="text-emerald-400">
                      Dedup Key: {inspectedAlert.dedup_key}
                    </div>
                    <div>Origen: {inspectedAlert.origen_deteccion}</div>
                  </div>
                  <pre className="max-h-72 overflow-y-auto whitespace-pre-wrap rounded-lg border border-slate-800 bg-slate-950 p-4 font-mono text-xs leading-relaxed text-slate-200">
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
            <Dialog.Overlay className="fixed inset-0 z-40 bg-slate-950/80 backdrop-blur-sm" />
            <Dialog.Content className="fixed left-1/2 top-1/2 z-50 w-full max-w-2xl -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-slate-800 bg-slate-900 p-6 text-slate-100 shadow-2xl">
              <div className="flex items-start justify-between border-b border-slate-800 pb-4">
                <div>
                  <Dialog.Title className="text-lg font-bold text-white">
                    Simulador Multi-Canal (Zelle + Binance Pay / P2P / On-Chain)
                  </Dialog.Title>
                  <Dialog.Description className="mt-1 text-xs text-slate-400">
                    Prueba en vivo{' '}
                    <code className="text-sky-300">parseBankAlertEmail()</code>{' '}
                    e idempotencia cruzada por <code>dedup_key</code>.
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
                      {tpl.label}
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
            <Dialog.Overlay className="fixed inset-0 z-40 bg-slate-950/80 backdrop-blur-sm" />
            <Dialog.Content className="fixed left-1/2 top-1/2 z-50 w-[94vw] max-w-lg -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-slate-800 bg-slate-900 p-6 text-slate-100 shadow-2xl">
              <div className="flex items-start justify-between border-b border-slate-800 pb-4">
                <div>
                  <Dialog.Title className="text-lg font-bold text-white">
                    {editingBusinessUserId
                      ? 'Editar Cuenta de Negocio y Clave'
                      : 'Crear Cuenta Nueva para Negocio'}
                  </Dialog.Title>
                  <Dialog.Description className="mt-1 text-xs text-slate-400">
                    Define el negocio, correo y contraseña para su acceso independiente al panel de conciliación.
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
                onSubmit={(e) => void handleSaveBusinessUser(e)}
                className="mt-4 space-y-4"
              >
                <div>
                  <label className="block text-xs font-semibold uppercase text-slate-300">
                    Nombre del Negocio / Empresa *
                  </label>
                  <input
                    type="text"
                    required
                    value={bizName}
                    onChange={(e) => setBizName(e.target.value)}
                    placeholder="Ej. Inversiones Caribe LLC"
                    className="mt-1.5 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white"
                  />
                </div>

                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div>
                    <label className="block text-xs font-semibold uppercase text-slate-300">
                      Nombre del Usuario Responsable *
                    </label>
                    <input
                      type="text"
                      required
                      value={bizOwnerName}
                      onChange={(e) => setBizOwnerName(e.target.value)}
                      placeholder="Ej. María González"
                      className="mt-1.5 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold uppercase text-slate-300">
                      Teléfono / WhatsApp
                    </label>
                    <input
                      type="text"
                      value={bizPhone}
                      onChange={(e) => setBizPhone(e.target.value)}
                      placeholder="+1 305..."
                      className="mt-1.5 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div>
                    <label className="block text-xs font-semibold uppercase text-slate-300">
                      Correo de Inicio de Sesión *
                    </label>
                    <input
                      type="email"
                      required
                      value={bizEmail}
                      onChange={(e) => setBizEmail(e.target.value)}
                      placeholder="admin@negocio.com"
                      className="mt-1.5 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-semibold uppercase text-slate-300">
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
                      className="mt-1.5 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white disabled:opacity-60"
                    >
                      <option value="NEGOCIO">Negocio Independiente</option>
                      <option value="SUPER_ADMIN">Super Admin</option>
                    </select>
                  </div>
                </div>

                <div>
                  <div className="flex items-center justify-between">
                    <label className="block text-xs font-semibold uppercase text-slate-300">
                      Contraseña de Acceso{' '}
                      {editingBusinessUserId ? '(Opcional al editar)' : '*'}
                    </label>
                    <button
                      type="button"
                      onClick={handleGenerateRandomBizPassword}
                      className="text-[11px] font-semibold text-emerald-400 hover:text-emerald-300"
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
                    className="mt-1.5 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 font-mono text-sm text-white"
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
                    disabled={isSavingBusinessUser}
                    className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-5 py-2 text-sm font-semibold text-white hover:bg-emerald-500 disabled:opacity-60"
                  >
                    {isSavingBusinessUser ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Briefcase className="h-4 w-4" />
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
            <Dialog.Overlay className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-sm" />
            <Dialog.Content className="fixed left-1/2 top-1/2 z-50 w-full max-w-lg -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-rose-500/30 bg-slate-900 p-6 shadow-2xl">
              <div className="flex items-center justify-between border-b border-slate-800 pb-3">
                <div className="flex items-center gap-2 text-rose-400">
                  <RotateCcw className="h-5 w-5" />
                  <Dialog.Title className="text-lg font-bold text-white">
                    Deshacer Conciliación
                  </Dialog.Title>
                </div>
                <Dialog.Close asChild>
                  <button
                    type="button"
                    className="rounded-lg p-1 text-slate-400 hover:bg-slate-800 hover:text-white"
                  >
                    <X className="h-5 w-5" />
                  </button>
                </Dialog.Close>
              </div>

              {alertToRevert && (
                <form
                  onSubmit={handleConfirmRevertReconciliation}
                  className="mt-4 space-y-4"
                >
                  <div className="rounded-xl border border-rose-500/20 bg-rose-500/10 p-4 text-xs text-rose-200">
                    <p className="font-semibold text-rose-300">
                      ¿Estás seguro de que deseas revertir esta conciliación?
                    </p>
                    <p className="mt-1 text-slate-300">
                      Esta acción devolverá la transacción al estado de{' '}
                      <strong>REVISIÓN MANUAL</strong>, desvinculará la orden de
                      pago (si existe), recalculará inmediatamente el saldo del
                      cliente y eliminará el remitente aprendido si fue
                      agregado por esta operación.
                    </p>
                  </div>

                  <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-4 text-xs">
                    <div className="grid grid-cols-2 gap-3 text-slate-300">
                      <div>
                        <span className="block text-slate-500">Canal / Banco:</span>
                        <span className="font-medium text-white">
                          {alertToRevert.plataforma}
                        </span>
                      </div>
                      <div>
                        <span className="block text-slate-500">
                          Referencia / TxID:
                        </span>
                        <span className="font-mono font-medium text-white">
                          {alertToRevert.referencia || 'N/A'}
                        </span>
                      </div>
                      <div>
                        <span className="block text-slate-500">Remitente:</span>
                        <span className="font-medium text-white">
                          {alertToRevert.remitente_o_contraparte}
                        </span>
                      </div>
                      <div>
                        <span className="block text-slate-500">
                          Cliente Acreditado:
                        </span>
                        <span className="font-semibold text-amber-400">
                          {alertToRevert.cliente_asignado_nombre || 'N/A'}
                        </span>
                      </div>
                      <div className="col-span-2 flex items-center justify-between border-t border-slate-800 pt-2 font-mono">
                        <span className="text-slate-400">Monto Acreditado:</span>
                        <span className="text-base font-bold text-emerald-400">
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
                      className="block text-xs font-semibold uppercase tracking-wider text-slate-300"
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
                      className="mt-1.5 w-full rounded-lg border border-slate-700 bg-slate-950 px-3.5 py-2 text-sm text-slate-200 placeholder-slate-500 focus:border-rose-500 focus:outline-none"
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
                      disabled={isSubmittingRevert}
                      className="inline-flex items-center gap-2 rounded-lg bg-rose-600 px-5 py-2 text-sm font-semibold text-white hover:bg-rose-500 disabled:opacity-60"
                    >
                      {isSubmittingRevert ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <RotateCcw className="h-4 w-4" />
                      )}
                      Confirmar Reversión
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
            <Dialog.Overlay className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-sm" />
            <Dialog.Content className="fixed left-1/2 top-1/2 z-50 w-full max-w-lg -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-emerald-500/30 bg-slate-900 p-6 shadow-2xl">
              <div className="flex items-center justify-between border-b border-slate-800 pb-3">
                <div className="flex items-center gap-2 text-emerald-400">
                  <UserCheck className="h-5 w-5" />
                  <Dialog.Title className="text-lg font-bold text-white">
                    Asignación Masiva por Lote
                  </Dialog.Title>
                </div>
                <Dialog.Close asChild>
                  <button
                    type="button"
                    className="rounded-lg p-1 text-slate-400 hover:bg-slate-800 hover:text-white"
                  >
                    <X className="h-5 w-5" />
                  </button>
                </Dialog.Close>
              </div>

              <form
                onSubmit={handleConfirmBatchReconciliation}
                className="mt-4 space-y-4"
              >
                <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/10 p-3.5 text-xs text-emerald-200">
                  <p className="font-semibold text-emerald-300">
                    Estás por adjudicar {selectedAlertIds.length} pagos seleccionados.
                  </p>
                  <p className="mt-1 text-slate-300">
                    Monto total a conciliar:{' '}
                    <strong className="font-mono text-emerald-400">
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
                    className="block text-xs font-semibold uppercase tracking-wider text-slate-300"
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
                    className="mt-1.5 w-full rounded-lg border border-slate-700 bg-slate-950 px-3.5 py-2 text-sm text-white placeholder-slate-500 focus:border-emerald-500 focus:outline-none"
                  />
                  <p className="mt-1 text-[11px] text-slate-400">
                    Selecciona de la lista de clientes registrados o escribe el nombre exacto.
                  </p>
                </div>

                <div>
                  <label
                    htmlFor="batch-notes"
                    className="block text-xs font-semibold uppercase tracking-wider text-slate-300"
                  >
                    Motivo / Nota de Auditoría
                  </label>
                  <textarea
                    id="batch-notes"
                    rows={2}
                    value={batchNotes}
                    onChange={(e) => setBatchNotes(e.target.value)}
                    placeholder="Ej. Asignación masiva autorizada por comprobantes históricos"
                    className="mt-1.5 w-full rounded-lg border border-slate-700 bg-slate-950 px-3.5 py-2 text-sm text-slate-200 placeholder-slate-500 focus:border-emerald-500 focus:outline-none"
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
                    disabled={isSubmittingBatch}
                    className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-5 py-2 text-sm font-semibold text-white hover:bg-emerald-500 disabled:opacity-60"
                  >
                    {isSubmittingBatch ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <CheckCircle2 className="h-4 w-4" />
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
            <Dialog.Overlay className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-sm" />
            <Dialog.Content className="fixed left-1/2 top-1/2 z-50 w-full max-w-lg -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-emerald-500/40 bg-slate-900 p-6 shadow-2xl">
              <div className="flex items-center justify-between border-b border-slate-800 pb-3">
                <div className="flex items-center gap-2 text-emerald-400">
                  <Coins className="h-5 w-5" />
                  <Dialog.Title className="text-lg font-bold text-white">
                    Registrar Liquidación de Fondos
                  </Dialog.Title>
                </div>
                <Dialog.Close asChild>
                  <button
                    type="button"
                    className="rounded-lg p-1 text-slate-400 hover:bg-slate-800 hover:text-white"
                  >
                    <X className="h-5 w-5" />
                  </button>
                </Dialog.Close>
              </div>

              {liquidationFeedback && (
                <div
                  className={`mt-4 rounded-xl border p-3.5 text-xs ${
                    liquidationFeedback.ok
                      ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300'
                      : 'border-rose-500/30 bg-rose-500/10 text-rose-300'
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
                    className="block text-xs font-semibold uppercase tracking-wider text-slate-300"
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
                    className="mt-1.5 w-full rounded-lg border border-slate-700 bg-slate-950 px-3.5 py-2 text-sm text-white focus:border-emerald-500 focus:outline-none"
                  >
                    {clients.map((c) => {
                      const disp = c.saldo_disponible_usd ?? Math.max(0, c.total_neto_usd - (c.total_liquidado_usd ?? 0));
                      return (
                        <option key={c.id} value={c.id}>
                          {c.nombre_titular} — Saldo Disponible: ${disp.toFixed(2)} USD
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
                      : (selectedClientForLiq.saldo_disponible_usd ?? Math.max(0, selectedClientForLiq.total_neto_usd - (selectedClientForLiq.total_liquidado_usd ?? 0)));
                  const numInput = parseFloat(liqMonto) || 0;
                  const remaining = Math.max(0, Math.round((maxAvail - numInput) * 100) / 100);
                  const isOver = numInput > maxAvail + 0.009;

                  return (
                    <div className="rounded-xl border border-slate-800 bg-slate-950/80 p-3.5 text-xs space-y-2">
                      <div className="flex justify-between items-center text-slate-400">
                        <span>Saldo Disponible Actual:</span>
                        <span className="font-mono font-bold text-white text-sm">
                          ${maxAvail.toFixed(2)} {liqMoneda}
                        </span>
                      </div>
                      <div className="flex justify-between items-center text-slate-400">
                        <span>Monto a Liquidar:</span>
                        <span className="font-mono font-bold text-rose-400 text-sm">
                          -${numInput.toFixed(2)} {liqMoneda}
                        </span>
                      </div>
                      <div className="border-t border-slate-800 pt-1.5 flex justify-between items-center">
                        <span className="font-semibold text-slate-300">Saldo Restante Resultante:</span>
                        <span className={`font-mono font-bold text-base ${isOver ? 'text-rose-400' : 'text-emerald-400'}`}>
                          ${remaining.toFixed(2)} {liqMoneda}
                        </span>
                      </div>
                      {isOver && (
                        <p className="text-[11px] font-semibold text-rose-400">
                          ⚠️ El monto a liquidar supera el saldo disponible actual.
                        </p>
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
                        className="block text-xs font-semibold uppercase tracking-wider text-slate-300"
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
                                : (selectedClientForLiq.saldo_disponible_usd ?? Math.max(0, selectedClientForLiq.total_neto_usd - (selectedClientForLiq.total_liquidado_usd ?? 0)));
                            setLiqMonto(maxAvail.toFixed(2));
                          }}
                          className="text-[10px] text-emerald-400 hover:underline font-semibold"
                        >
                          Liquidar Todo
                        </button>
                      )}
                    </div>
                    <div className="relative mt-1.5">
                      <span className="absolute left-3 top-2 text-slate-400 font-mono text-sm">$</span>
                      <input
                        id="liq-amount"
                        type="number"
                        step="0.01"
                        min="0.01"
                        required
                        value={liqMonto}
                        onChange={(e) => setLiqMonto(e.target.value)}
                        placeholder="Ej. 2000.00"
                        className="w-full rounded-lg border border-slate-700 bg-slate-950 py-2 pl-7 pr-3 font-mono text-sm text-white placeholder-slate-500 focus:border-emerald-500 focus:outline-none"
                      />
                    </div>
                  </div>

                  <div>
                    <label
                      htmlFor="liq-currency"
                      className="block text-xs font-semibold uppercase tracking-wider text-slate-300"
                    >
                      Moneda
                    </label>
                    <select
                      id="liq-currency"
                      value={liqMoneda}
                      onChange={(e) => setLiqMoneda(e.target.value as CurrencyType)}
                      className="mt-1.5 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white focus:border-emerald-500 focus:outline-none"
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
                    className="block text-xs font-semibold uppercase tracking-wider text-slate-300"
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
                    className="mt-1.5 w-full rounded-lg border border-slate-700 bg-slate-950 px-3.5 py-2 text-sm text-white placeholder-slate-500 focus:border-emerald-500 focus:outline-none"
                  />
                  <p className="mt-1 text-[11px] text-slate-400">
                    Nombre o cuenta de la persona que recibe el dinero.
                  </p>
                </div>

                {/* Motivo o Concepto */}
                <div>
                  <label
                    htmlFor="liq-motivo"
                    className="block text-xs font-semibold uppercase tracking-wider text-slate-300"
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
                    className="mt-1.5 w-full rounded-lg border border-slate-700 bg-slate-950 px-3.5 py-2 text-sm text-white placeholder-slate-500 focus:border-emerald-500 focus:outline-none"
                  />
                </div>

                {/* Método y Referencia de Salida */}
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label
                      htmlFor="liq-metodo"
                      className="block text-xs font-semibold uppercase tracking-wider text-slate-300"
                    >
                      Método de Salida
                    </label>
                    <select
                      id="liq-metodo"
                      value={liqMetodo}
                      onChange={(e) => setLiqMetodo(e.target.value as LiquidationPaymentMethod)}
                      className="mt-1.5 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-xs text-white focus:border-emerald-500 focus:outline-none"
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
                      className="block text-xs font-semibold uppercase tracking-wider text-slate-300"
                    >
                      Referencia de Salida
                    </label>
                    <input
                      id="liq-ref"
                      type="text"
                      value={liqReferencia}
                      onChange={(e) => setLiqReferencia(e.target.value)}
                      placeholder="Ej. 6475855297 / TxID"
                      className="mt-1.5 w-full rounded-lg border border-slate-700 bg-slate-950 px-3.5 py-2 text-xs font-mono text-white placeholder-slate-500 focus:border-emerald-500 focus:outline-none"
                    />
                  </div>
                </div>

                {/* Checkbox Archivar ciclo actual */}
                <div className="rounded-xl border border-slate-800 bg-slate-950/70 p-3">
                  <label className="flex items-start gap-2.5 cursor-pointer text-xs text-slate-300">
                    <input
                      type="checkbox"
                      checked={liqArchivar}
                      onChange={(e) => setLiqArchivar(e.target.checked)}
                      className="mt-0.5 rounded border-slate-700 text-emerald-600 focus:ring-emerald-500"
                    />
                    <div>
                      <span className="font-semibold text-white">
                        Archivar comprobantes del ciclo actual
                      </span>
                      <p className="mt-0.5 text-[11px] text-slate-400">
                        Cierra las capturas conciliadas previas para que el portal del cliente quede con cero historial de capturas activas en el nuevo ciclo.
                      </p>
                    </div>
                  </label>
                </div>

                {/* Botones de acción */}
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
                    disabled={isSubmittingLiquidation}
                    className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-5 py-2 text-sm font-semibold text-white hover:bg-emerald-500 disabled:opacity-60"
                  >
                    {isSubmittingLiquidation ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <CheckCircle2 className="h-4 w-4" />
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
