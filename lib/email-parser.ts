import OpenAI from 'openai';
import {
  CurrencyType,
  DetectionOrigin,
  ExtractionMethod,
  MovementType,
  OcrExtractionData,
  ParsedBankTransaction,
  PlatformType,
} from '@/types/reconciliation';

export interface RawBankEmailInput {
  fromAddress: string;
  subject: string;
  textBody?: string | null;
  htmlBody?: string | null;
  receivedDate?: Date | string;
}

export interface VisionOcrVerificationInput {
  comprobanteBase64: string;
  plataformaEsperada: PlatformType;
  moneda: CurrencyType;
  montoEsperado: number;
  remitenteReportado: string;
  referenciaReportada: string;
}

interface AiExtractedPayload {
  plataforma: PlatformType;
  moneda: CurrencyType;
  tipo_movimiento: MovementType;
  monto_bruto: number;
  remitente_o_contraparte: string | null;
  referencia: string | null;
  fecha_transaccion: string | null;
}

/**
 * Construye la llave determinística de idempotencia cruzada (`PLATAFORMA:REFERENCIA_LIMPIA:MONTO`)
 * compartida por el motor IMAP y el cliente oficial de Binance API.
 */
export function buildDedupKey(
  plataforma: PlatformType,
  referencia: string | null | undefined,
  montoBruto: number
): string {
  const cleanRef =
    (referencia ?? '')
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, '') || 'NOREF';
  const normalizedAmount = Number.isFinite(montoBruto)
    ? (Math.round(montoBruto * 100) / 100).toFixed(2)
    : '0.00';

  return `${plataforma}:${cleanRef}:${normalizedAmount}`.slice(0, 180);
}

/**
 * Limpia el HTML y normaliza entidades, etiquetas en tabla y espacios de correos Citibank / TD Bank / Binance.
 */
export function sanitizeEmailContent(rawHtmlOrText: string): string {
  if (!rawHtmlOrText) {
    return '';
  }

  const rawLines = rawHtmlOrText
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<\/(p|div|tr|li|h[1-6]|table)>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/td>/gi, ' : ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;|&#160;/gi, ' ')
    .replace(/&amp;|&#38;/gi, '&')
    .replace(/&#36;/g, '$')
    .replace(/&quot;|&#34;/gi, '"')
    .replace(/&apos;|&#39;/gi, "'")
    .replace(/&reg;|&#174;/gi, '®')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .split(/\r?\n/)
    .map((line) =>
      line
        .replace(/\s+/g, ' ')
        .replace(/^[:\s]+|[:\s]+$/g, '')
        .trim()
    )
    .filter((line) => line.length > 0 && !/^[:\-\s]+$/.test(line));

  const labelOnlyRegex =
    /^(?:name|from|sender(?:\s+name)?|sent\s+by|received\s+from|to|sent\s+to|recipient(?:\s+name)?|amount|payment\s+amount|deposit\s+amount|transfer\s+amount|monto|importe|transaction\s*(?:id|number|hash)|confirmation\s*(?:number|code|id)?|reference\s*(?:number|code|id)?|order\s*(?:number|no\.?|id)|prepay\s*id|pay\s*id|txid|txhash|deposited\s+into|remitente|destinatario|referencia|n[uú]mero\s+de\s+(?:confirmaci[oó]n|referencia|orden)|counterparty(?:\s+nickname)?|buyer|seller|network|red)$/i;

  const collapsedLines: string[] = [];
  for (let i = 0; i < rawLines.length; i += 1) {
    const current = rawLines[i];
    if (!current) {
      continue;
    }
    const next = rawLines[i + 1];
    if (next && labelOnlyRegex.test(current) && !labelOnlyRegex.test(next)) {
      collapsedLines.push(`${current}: ${next}`);
      i += 1;
    } else {
      collapsedLines.push(current);
    }
  }

  return collapsedLines.join('\n');
}

/**
 * Convierte cadenas monetarias como "$1,250.00", "USD 1,250.50" o "500.00 USDT" a número de 2 decimales.
 */
export function parseUsdAmount(rawAmount: string): number | null {
  const cleaned = rawAmount.replace(/[^0-9.,]/g, '').trim();
  if (!cleaned) {
    return null;
  }

  let normalized = cleaned;
  const lastComma = cleaned.lastIndexOf(',');
  const lastDot = cleaned.lastIndexOf('.');

  if (lastComma > lastDot && cleaned.length - lastComma === 3) {
    normalized = cleaned.replace(/\./g, '').replace(',', '.');
  } else {
    normalized = cleaned.replace(/,/g, '');
  }

  const parsed = Number.parseFloat(normalized);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return null;
  }

  return Math.round(parsed * 100) / 100;
}

/**
 * Identifica la plataforma emisora y moneda esperada basándose en remitente y contenido.
 */
export function detectBank(fromAddress: string, fullText: string): PlatformType {
  const source = `${fromAddress} ${fullText}`.toLowerCase();

  if (
    source.includes('binance.com') ||
    source.includes('directmail.binance.com') ||
    source.includes('post.binance.com') ||
    /\bbinance\s*(pay|p2p|deposit|order|alert|c2c)\b/i.test(source)
  ) {
    if (
      /\bp2p\b/i.test(source) ||
      /\bc2c\b/i.test(source) ||
      /\border\s*(?:completed|released|number)\b/i.test(source) ||
      /\borden\s+p2p\b/i.test(source) ||
      /\b(?:counterparty|contraparte|buyer|seller)\b/i.test(source)
    ) {
      return 'BINANCE_P2P';
    }

    if (
      /\b(?:txid|txhash|transaction\s+hash|trc20|erc20|bep20|bsc|tron|blockchain|on-?chain)\b/i.test(
        source
      ) ||
      /\b(?:deposit\s+confirmed|dep[oó]sito\s+confirmado|network\s*:)\b/i.test(source)
    ) {
      return 'BINANCE_ONCHAIN';
    }

    return 'BINANCE_PAY';
  }

  if (
    source.includes('citibank.com') ||
    source.includes('citi.com') ||
    /\bcitibank\b/i.test(source) ||
    /\bciti®?\s*(online|bank|alert)/i.test(source)
  ) {
    return 'CITIBANK';
  }

  if (
    source.includes('tdbank.com') ||
    source.includes('@td.com') ||
    /\btd\s*bank\b/i.test(source) ||
    /\btd\s*online\s*banking\b/i.test(source)
  ) {
    return 'TD_BANK';
  }

  return 'OTRO';
}

export function detectCurrency(
  plataforma: PlatformType,
  subject: string,
  cleanBody: string
): CurrencyType {
  const combined = `${subject}\n${cleanBody}`;

  if (/\b(?:USDT|USDC|FDUSD|BUSD)\b/i.test(combined)) {
    return 'USDT';
  }
  if (/\bVES\b/i.test(combined)) {
    return 'VES';
  }
  if (
    plataforma === 'BINANCE_PAY' ||
    plataforma === 'BINANCE_P2P' ||
    plataforma === 'BINANCE_ONCHAIN'
  ) {
    if (/\$\s*[0-9]+/.test(combined) && /\bUSD\b/i.test(combined)) {
      return 'USD';
    }
    return 'USDT';
  }

  return 'USD';
}

/**
 * Determina si la alerta corresponde a un ingreso (RECIBIDO) o egreso (ENVIADO).
 */
export function detectMovementType(subject: string, cleanBody: string): MovementType {
  const combined = `${subject}\n${cleanBody}`;

  const outgoingPatterns: ReadonlyArray<RegExp> = [
    /\byou\s+sent\s+(?:a\s+zelle\s*[®\s]*payment|money|\$|[0-9])/i,
    /\bwe\s+sent\s+your\s+zelle\s*[®\s]*payment\b/i,
    /\bpayment\s+was\s+sent\s+to\b/i,
    /\byour\s+zelle\s*[®\s]*payment\s+to\b/i,
    /\btransfer\s+sent\s+to\b/i,
    /\boutgoing\s+(?:wire|transfer|payment)\b/i,
    /\bmade\s+on\s+your\s+debit\s+card\b/i,
    /\ba\s+debit\s+card\s+was\s+not\s+present\b/i,
    /\bdebit\s+card\b[\s\S]{0,80}\btransaction\b/i,
    /\bwithdrawal\s+(?:successful|confirmed|completed)\b/i,
    /\bretiro\s+(?:exitoso|confirmado|completado)\b/i,
    /\byou\s+(?:have\s+)?paid\b/i,
    /\border\s+type\s*:\s*sell\b/i,
    /\btipo\s+de\s+orden\s*:\s*venta\b/i,
    /\benviaste\s+(?:un\s+pago|dinero|\$|[0-9])/i,
    /\bpago\s+enviado\s+a\b/i,
    /\btransferencia\s+enviada\b/i,
    /\bhas\s+enviado\s+(?:un\s+pago|\$|[0-9])/i,
  ];

  const incomingPatterns: ReadonlyArray<RegExp> = [
    /\byou(?:'ve|\s+have)?\s+received\s+(?:a\s+zelle\s*[®\s]*payment|a\s+binance\s+pay\s+payment|money|a\s+transfer|\$|[0-9])/i,
    /\bsent\s+you\s+(?:money|\$|[0-9])/i,
    /\bdeposited\s+into\s+your\s+account\b/i,
    /\bdeposit\s+(?:confirmed|successful|completed)\b/i,
    /\bdep[oó]sito\s+(?:confirmado|exitoso|recibido)\b/i,
    /\bzelle[®\s]*payment\s+from\b/i,
    /\bpayment\s+received\s+from\b/i,
    /\bincoming\s+(?:wire|transfer|deposit)\b/i,
    /\border\s+type\s*:\s*buy\b/i,
    /\btipo\s+de\s+orden\s*:\s*compra\b/i,
    /\brecibiste\s+(?:un\s+pago|dinero|una\s+transferencia|\$|[0-9])/i,
    /\bhas\s+recibido\s+(?:un\s+pago|una\s+transferencia|\$|[0-9])/i,
    /\bte\s+envi[oó]\s+\$/i,
  ];

  for (const pattern of incomingPatterns) {
    if (pattern.test(combined)) {
      return 'RECIBIDO';
    }
  }

  for (const pattern of outgoingPatterns) {
    if (pattern.test(combined)) {
      return 'ENVIADO';
    }
  }

  return 'RECIBIDO';
}

/**
 * Extrae el monto en USD / USDT / VES desde asunto y cuerpo limpio.
 */
function extractAmountByRegex(subject: string, cleanBody: string): number | null {
  const combined = `${subject}\n${cleanBody}`;

  const amountRegexes: ReadonlyArray<RegExp> = [
    // Cripto / Binance: "500.00 USDT", "1,250.50 USDC", "Amount: 350.00 USDT"
    /(?:amount|quantity|total|monto|importe|recibiste|received|deposit(?:ed)?|sent\s+you)\s*[:\-]?\s*([0-9]{1,3}(?:,[0-9]{3})*(?:\.[0-9]{1,8})?|[0-9]+(?:\.[0-9]{1,8})?)\s*(?:USDT|USDC|FDUSD|BUSD|VES)\b/i,
    /\b([0-9]{1,3}(?:,[0-9]{3})*(?:\.[0-9]{1,8})?|[0-9]+(?:\.[0-9]{1,8})?)\s*(?:USDT|USDC|FDUSD|BUSD|VES)\b/i,
    // Etiquetas bancarias USD: "Amount: $1,250.00" / "Monto: $1,250.00"
    /(?:amount|payment\s+amount|deposit\s+amount|transfer\s+amount|monto|importe)\s*[:\-]?\s*(?:usd\s*)?\$\s*([0-9]{1,3}(?:,[0-9]{3})*(?:\.[0-9]{2})|[0-9]+\.[0-9]{2})/i,
    // Frases bancarias: "sent you $1,250.00" / "received $1,250.00" / "recibiste $1,250.00"
    /(?:sent\s+you|received|payment\s+of|deposit\s+of|you\s+sent|recibiste|enviaste|te\s+envi[oó]|por\s+un\s+monto\s+de|por)\s*(?:usd\s*)?\$\s*([0-9]{1,3}(?:,[0-9]{3})*(?:\.[0-9]{2})|[0-9]+\.[0-9]{2})/i,
    // "USD 1,250.00"
    /\bUSD\s*([0-9]{1,3}(?:,[0-9]{3})*(?:\.[0-9]{2})|[0-9]+\.[0-9]{2})\b/i,
    // Fallback símbolo de dólar con dos decimales
    /\$\s*([0-9]{1,3}(?:,[0-9]{3})*\.[0-9]{2}|[0-9]+\.[0-9]{2})\b/,
  ];

  for (const regex of amountRegexes) {
    const match = combined.match(regex);
    if (match && match[1]) {
      const parsed = parseUsdAmount(match[1]);
      if (parsed !== null) {
        return parsed;
      }
    }
  }

  return null;
}

function cleanPartyName(rawName: string): string | null {
  const cleaned = rawName
    .replace(
      /\b(?:has\s+been\s+deposited|was\s+deposited|into\s+your\s+account|using\s+zelle[®]?|with\s+zelle[®]?|con\s+zelle[®]?|en\s+tu\s+cuenta|por\s+\$[0-9,.]+|of\s+\$[0-9,.]+|via\s+binance\s+pay|en\s+binance)\b.*$/i,
      ''
    )
    .replace(/[\r\n]+/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .replace(/^[:\-\s]+|[:\-.,;\s]+$/g, '')
    .trim();

  if (cleaned.length < 2 || cleaned.length > 100) {
    return null;
  }

  if (
    /^(?:citibank|citi|td\s*bank|zelle|binance|binance\s*pay|account|confirmation|reference)$/i.test(
      cleaned
    )
  ) {
    return null;
  }

  return cleaned;
}

function extractCounterpartyByRegex(
  plataforma: PlatformType,
  subject: string,
  cleanBody: string
): string | null {
  const combined = `${subject}\n${cleanBody}`;

  const partyRegexes: ReadonlyArray<RegExp> = [
    // Etiquetas estructuradas Citibank / TD Bank / Binance Pay / P2P
    /(?:from|sender(?:\s+name)?|name|sent\s+by|received\s+from|counterparty(?:\s+nickname)?|buyer|seller|payer|nickname|remitente|enviado\s+por|de\s+parte\s+de|contraparte|comprador|vendedor|paid\s+by)\s*:\s*([A-ZÁÉÍÓÚÑa-záéíóúñ0-9@._][A-ZÁÉÍÓÚÑa-záéíóúñ0-9\s.,&'@_()\-]{2,80})/i,
    /(?:to|recipient(?:\s+name)?|sent\s+to|destinatario|para)\s*:\s*([A-ZÁÉÍÓÚÑa-záéíóúñ0-9@._][A-ZÁÉÍÓÚÑa-záéíóúñ0-9\s.,&'@_()\-]{2,80})/i,
    // Binance Pay: "You received 250.00 USDT from CryptoTrader_VE"
    /(?:received|recibiste)\s+[0-9,.]+\s*(?:USDT|USDC|USD|VES)\s+(?:from|de)\s+([A-ZÁÉÍÓÚÑa-záéíóúñ0-9@._\- ]{2,65}?)(?=\s*(?:\(|via|en\s+|on\s+|order|txid|transaction|\.|,|\n|$))/i,
    // Citibank / TD Bank Inglés: "CARLOS RODRIGUEZ sent you $1,250.00"
    /(?:^|\n)\s*([A-ZÁÉÍÓÚÑ][A-Za-záéíóúñÁÉÍÓÚÑ0-9\s.,&'-]{2,60}?)\s+(?:has\s+)?sent\s+you\s+(?:\$|money|a\s+zelle)/im,
    // Citibank / TD Bank Inglés: "You've received a Zelle ® payment from Agrominerales Ca"
    /(?:zelle\s*[®]?\s*payment(?:\s+of\s+\$[0-9,.]+)?\s+from|received\s+\$[0-9,.]+\s+from|payment\s+from|transfer\s+from)\s+([A-ZÁÉÍÓÚÑa-záéíóúñ0-9][A-Za-záéíóúñÁÉÍÓÚÑ0-9\s.,&'-]{2,65}?)(?=\s+(?:has\s+been|was|on\s+|for\s+\$|into\s+|confirmation|\.|,|\n|$))/i,
    // Saliente Inglés: "You sent $50.00 to Andys Fuenmayor" / "Zelle ® payment to Andys Fuenmayor"
    /(?:you\s+sent\s+(?:\$[0-9,.]+\s+)?to|zelle\s*[®]?\s*payment\s+to)\s+([A-ZÁÉÍÓÚÑa-záéíóúñ0-9][A-Za-záéíóúñÁÉÍÓÚÑ0-9\s.,&'-]{2,65}?)(?=\s+(?:has\s+been|was|on\s+|\.|,|\n|$))/i,
    // Español: "Recibiste un pago con Zelle de JUAN PEREZ por $500.00"
    /(?:pago(?:\s+con\s+(?:zelle\s*[®]?|binance\s+pay))?\s+de|recibiste\s+(?:\$?[0-9,.]+(?:\s*USDT)?)\s+de|transferencia\s+de)\s+([A-ZÁÉÍÓÚÑa-záéíóúñ0-9@._\- ][A-Za-záéíóúñÁÉÍÓÚÑ0-9\s.,&'@_\-]{2,65}?)(?=\s+(?:por\s+\$|por\s+[0-9]|ha\s+sido|fue|en\s+tu|\.|,|\n|$))/i,
    // Español: "JUAN PEREZ te envió $500.00"
    /(?:^|\n)\s*([A-ZÁÉÍÓÚÑ][A-Za-záéíóúñÁÉÍÓÚÑ0-9\s.,&'-]{2,60}?)\s+te\s+envi[oó]\s+\$/im,
  ];

  for (const regex of partyRegexes) {
    const match = combined.match(regex);
    if (match && match[1]) {
      const firstLine = match[1].split('\n')[0] ?? '';
      const cleaned = cleanPartyName(firstLine);
      if (cleaned) {
        return cleaned;
      }
    }
  }

  // En depósitos On-Chain, muchas alertas solo muestran red/dirección y TxID sin nombre de persona
  if (plataforma === 'BINANCE_ONCHAIN') {
    const networkMatch = combined.match(
      /(?:network|red)\s*[:\-]?\s*([A-Z0-9\-() ]{3,25})/i
    );
    const addrMatch = combined.match(/(?:address|direcci[oó]n)\s*[:\-]?\s*([A-Za-z0-9]{10,64})/i);
    if (networkMatch?.[1]) {
      return `On-Chain (${networkMatch[1].trim()})`;
    }
    if (addrMatch?.[1]) {
      const addr = addrMatch[1].trim();
      return `Wallet ${addr.slice(0, 6)}...${addr.slice(-4)}`;
    }
  }

  // En alertas de tarjeta de débito Citibank sin comercio explícito
  if (/\bdebit\s+card\b/i.test(combined)) {
    const cardMatch = combined.match(
      /(?:debit\s+card\s+ending\s+in|account\s+ending\s+in)\s*[:\-]?\s*(\d{4})/i
    );
    if (cardMatch?.[1]) {
      return `Tarjeta Débito (*${cardMatch[1]})`;
    }
    return 'Compra Tarjeta Débito';
  }

  return null;
}

/**
 * Extrae el número de confirmación Zelle, Order ID de Binance Pay/P2P o TxID On-Chain.
 */
function extractReferenceByRegex(subject: string, cleanBody: string): string | null {
  const combined = `${subject}\n${cleanBody}`;

  const referenceRegexes: ReadonlyArray<{ regex: RegExp; requireDigitIfUnpunctuated: boolean }> = [
    {
      regex:
        /(?:transaction\s*(?:id|number|hash|#)|confirmation\s*(?:number|code|#|no\.?|id)|reference\s*(?:number|code|#|no\.?|id)|order\s*(?:number|no\.?|id|#)|prepay\s*id|pay\s*id|txid|txhash|zelle\s*[®]?\s*confirmation|n[uú]mero\s+de\s+(?:confirmaci[oó]n|referencia|orden)|c[oó]digo\s+de\s+(?:confirmaci[oó]n|referencia)|id\s+de\s+(?:transacci[oó]n|orden))\s*(?:[:#\-\n]+\s*|\s+)([A-Z0-9][A-Z0-9\-]{4,80})/i,
      requireDigitIfUnpunctuated: false,
    },
    {
      regex: /(?:confirmation|referencia)\s*[:#]\s*([A-Z0-9][A-Z0-9\-]{4,80})/i,
      requireDigitIfUnpunctuated: false,
    },
    {
      regex: /(?:confirmation|referencia)\s+([A-Z0-9][A-Z0-9\-]{5,80})/i,
      requireDigitIfUnpunctuated: true,
    },
  ];

  for (const entry of referenceRegexes) {
    const match = combined.match(entry.regex);
    if (match && match[1]) {
      const candidate = match[1].trim().toUpperCase();
      if (entry.requireDigitIfUnpunctuated && !/\d/.test(candidate)) {
        continue;
      }
      if (
        !/^(?:NUMBER|CODE|DETAILS|STATUS|PENDING|COMPLETED|RECIBIDO|ENVIADO|CONFIRMED|AMOUNT|NAME|ZELLE|ACCOUNT|EMAIL|DATE)$/i.test(
          candidate
        )
      ) {
        return candidate;
      }
    }
  }

  return null;
}

function isValidAiExtractedPayload(data: unknown): data is AiExtractedPayload {
  if (typeof data !== 'object' || data === null) {
    return false;
  }

  const record = data as Record<string, unknown>;

  const validPlatforms: ReadonlyArray<string> = [
    'CITIBANK',
    'TD_BANK',
    'BINANCE_PAY',
    'BINANCE_P2P',
    'BINANCE_ONCHAIN',
    'OTRO',
  ];
  const validCurrencies: ReadonlyArray<string> = ['USD', 'USDT', 'VES'];
  const validMovements: ReadonlyArray<string> = ['RECIBIDO', 'ENVIADO'];

  const hasValidPlatform =
    typeof record.plataforma === 'string' && validPlatforms.includes(record.plataforma);
  const hasValidCurrency =
    typeof record.moneda === 'string' && validCurrencies.includes(record.moneda);
  const hasValidMovement =
    typeof record.tipo_movimiento === 'string' && validMovements.includes(record.tipo_movimiento);
  const hasValidAmount =
    typeof record.monto_bruto === 'number' &&
    Number.isFinite(record.monto_bruto) &&
    record.monto_bruto > 0;
  const hasValidParty =
    record.remitente_o_contraparte === null ||
    typeof record.remitente_o_contraparte === 'string';
  const hasValidRef = record.referencia === null || typeof record.referencia === 'string';
  const hasValidDate =
    record.fecha_transaccion === null || typeof record.fecha_transaccion === 'string';

  return (
    hasValidPlatform &&
    hasValidCurrency &&
    hasValidMovement &&
    hasValidAmount &&
    hasValidParty &&
    hasValidRef &&
    hasValidDate
  );
}

/**
 * CAPA 2 (AI Fallback): Extrae datos estructurados del correo usando OpenAI o Anthropic.
 */
async function extractWithAiFallback(
  input: RawBankEmailInput,
  cleanBody: string
): Promise<AiExtractedPayload | null> {
  const promptContent = [
    `From: ${input.fromAddress}`,
    `Subject: ${input.subject}`,
    `Received Date: ${
      input.receivedDate instanceof Date
        ? input.receivedDate.toISOString()
        : input.receivedDate ?? new Date().toISOString()
    }`,
    `Body:\n${cleanBody.slice(0, 6000)}`,
  ].join('\n');

  const systemInstruction = `Eres un extractor financiero determinístico para conciliación multicanal de Zelle (Citibank / TD Bank) y Binance (Pay / P2P / On-Chain).
Analiza el correo de alerta y devuelve ÚNICAMENTE un objeto JSON estricto con esta estructura exacta:
{
  "plataforma": "CITIBANK" | "TD_BANK" | "BINANCE_PAY" | "BINANCE_P2P" | "BINANCE_ONCHAIN" | "OTRO",
  "moneda": "USD" | "USDT" | "VES",
  "tipo_movimiento": "RECIBIDO" | "ENVIADO",
  "monto_bruto": number (monto exacto con hasta 2 decimales, ej. 1250.00),
  "remitente_o_contraparte": string | null (nombre en Zelle, nickname en Binance o red/dirección),
  "referencia": string | null (confirmación Zelle, Order ID, Pay Transaction ID o TxID),
  "fecha_transaccion": string | null (ISO 8601)
}`;

  if (process.env.OPENAI_API_KEY) {
    try {
      const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
      const completion = await openai.chat.completions.create({
        model: process.env.OPENAI_MODEL ?? 'gpt-4o-mini',
        temperature: 0,
        response_format: {
          type: 'json_schema',
          json_schema: {
            name: 'multi_channel_alert_extraction',
            strict: true,
            schema: {
              type: 'object',
              additionalProperties: false,
              required: [
                'plataforma',
                'moneda',
                'tipo_movimiento',
                'monto_bruto',
                'remitente_o_contraparte',
                'referencia',
                'fecha_transaccion',
              ],
              properties: {
                plataforma: {
                  type: 'string',
                  enum: [
                    'CITIBANK',
                    'TD_BANK',
                    'BINANCE_PAY',
                    'BINANCE_P2P',
                    'BINANCE_ONCHAIN',
                    'OTRO',
                  ],
                },
                moneda: {
                  type: 'string',
                  enum: ['USD', 'USDT', 'VES'],
                },
                tipo_movimiento: {
                  type: 'string',
                  enum: ['RECIBIDO', 'ENVIADO'],
                },
                monto_bruto: {
                  type: 'number',
                },
                remitente_o_contraparte: {
                  type: ['string', 'null'],
                },
                referencia: {
                  type: ['string', 'null'],
                },
                fecha_transaccion: {
                  type: ['string', 'null'],
                },
              },
            },
          },
        },
        messages: [
          { role: 'system', content: systemInstruction },
          { role: 'user', content: promptContent },
        ],
      });

      const rawJson = completion.choices[0]?.message?.content;
      if (rawJson) {
        const parsed: unknown = JSON.parse(rawJson);
        if (isValidAiExtractedPayload(parsed)) {
          return parsed;
        }
      }
    } catch (error: unknown) {
      const errMessage =
        error instanceof Error ? error.message : 'Error desconocido en OpenAI';
      console.error('[EmailParser AI Fallback - OpenAI Error]:', errMessage);
    }
  }

  if (process.env.ANTHROPIC_API_KEY) {
    try {
      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-api-key': process.env.ANTHROPIC_API_KEY,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: process.env.ANTHROPIC_MODEL ?? 'claude-3-5-haiku-latest',
          max_tokens: 512,
          temperature: 0,
          system: systemInstruction,
          messages: [{ role: 'user', content: promptContent }],
        }),
      });

      if (response.ok) {
        const payload: unknown = await response.json();
        if (
          typeof payload === 'object' &&
          payload !== null &&
          'content' in payload &&
          Array.isArray((payload as { content: unknown }).content)
        ) {
          const contentBlocks = (
            payload as { content: Array<{ type?: string; text?: string }> }
          ).content;
          const textBlock = contentBlocks.find(
            (b) => b.type === 'text' && typeof b.text === 'string'
          );
          if (textBlock?.text) {
            const jsonMatch = textBlock.text.match(/\{[\s\S]*\}/);
            if (jsonMatch) {
              const parsed: unknown = JSON.parse(jsonMatch[0]);
              if (isValidAiExtractedPayload(parsed)) {
                return parsed;
              }
            }
          }
        }
      }
    } catch (error: unknown) {
      const errMessage =
        error instanceof Error ? error.message : 'Error desconocido en Anthropic';
      console.error('[EmailParser AI Fallback - Anthropic Error]:', errMessage);
    }
  }

  return null;
}

/**
 * Motor Principal de Parseo Híbrido Multi-Canal (Citibank, TD Bank y Binance Pay/P2P/On-Chain).
 */
export async function parseBankAlertEmail(
  input: RawBankEmailInput
): Promise<ParsedBankTransaction | null> {
  const rawSource =
    input.htmlBody && input.htmlBody.trim().length > 0
      ? `${input.textBody ?? ''}\n${input.htmlBody}`
      : input.textBody ?? '';

  const cleanBody = sanitizeEmailContent(rawSource);
  const defaultIsoDate =
    input.receivedDate instanceof Date
      ? input.receivedDate.toISOString()
      : typeof input.receivedDate === 'string' && !Number.isNaN(Date.parse(input.receivedDate))
        ? new Date(input.receivedDate).toISOString()
        : new Date().toISOString();

  // --- CAPA 1: Extracción por Expresiones Regulares ---
  const regexPlatform = detectBank(input.fromAddress, `${input.subject}\n${cleanBody}`);
  const regexCurrency = detectCurrency(regexPlatform, input.subject, cleanBody);
  const regexMovement = detectMovementType(input.subject, cleanBody);
  const regexAmount = extractAmountByRegex(input.subject, cleanBody);
  const regexCounterparty = extractCounterpartyByRegex(
    regexPlatform,
    input.subject,
    cleanBody
  );
  const regexReference = extractReferenceByRegex(input.subject, cleanBody);

  const hasReliableRegexExtraction =
    regexAmount !== null &&
    regexAmount > 0 &&
    regexCounterparty !== null &&
    regexCounterparty.length >= 3;

  if (hasReliableRegexExtraction && regexAmount !== null) {
    const origen: DetectionOrigin = 'EMAIL_REGEX';
    const metodo: ExtractionMethod = 'REGEX';
    return {
      plataforma: regexPlatform,
      banco: regexPlatform,
      moneda: regexCurrency,
      tipo_movimiento: regexMovement,
      monto_bruto: regexAmount,
      remitente_o_destinatario: regexCounterparty,
      remitente_o_contraparte: regexCounterparty,
      referencia: regexReference,
      fecha_transaccion: defaultIsoDate,
      metodo_extraccion: metodo,
      origen_deteccion: origen,
      dedup_key: buildDedupKey(regexPlatform, regexReference, regexAmount),
      confianza: regexReference ? 0.98 : 0.9,
    };
  }

  // --- CAPA 2: Fallback con Inteligencia Artificial (LLM JSON Estructurado) ---
  const aiResult = await extractWithAiFallback(input, cleanBody);
  if (aiResult) {
    const validIsoDate =
      aiResult.fecha_transaccion && !Number.isNaN(Date.parse(aiResult.fecha_transaccion))
        ? new Date(aiResult.fecha_transaccion).toISOString()
        : defaultIsoDate;

    const resolvedPlatform: PlatformType =
      aiResult.plataforma !== 'OTRO' ? aiResult.plataforma : regexPlatform;
    const resolvedAmount = Math.round(aiResult.monto_bruto * 100) / 100;
    const resolvedRef = aiResult.referencia ?? regexReference;
    const resolvedParty = aiResult.remitente_o_contraparte ?? regexCounterparty;

    return {
      plataforma: resolvedPlatform,
      banco: resolvedPlatform,
      moneda: aiResult.moneda,
      tipo_movimiento: aiResult.tipo_movimiento,
      monto_bruto: resolvedAmount,
      remitente_o_destinatario: resolvedParty,
      remitente_o_contraparte: resolvedParty ?? 'Desconocido',
      referencia: resolvedRef,
      fecha_transaccion: validIsoDate,
      metodo_extraccion: 'AI_FALLBACK',
      origen_deteccion: 'EMAIL_AI',
      dedup_key: buildDedupKey(resolvedPlatform, resolvedRef, resolvedAmount),
      confianza: 0.85,
    };
  }

  // Si Regex capturó un monto válido (aunque sin remitente claro), registrar para REVISION_MANUAL
  if (regexAmount !== null && regexAmount > 0) {
    return {
      plataforma: regexPlatform,
      banco: regexPlatform,
      moneda: regexCurrency,
      tipo_movimiento: regexMovement,
      monto_bruto: regexAmount,
      remitente_o_destinatario: regexCounterparty,
      remitente_o_contraparte: regexCounterparty ?? 'Desconocido',
      referencia: regexReference,
      fecha_transaccion: defaultIsoDate,
      metodo_extraccion: 'REGEX',
      origen_deteccion: 'EMAIL_REGEX',
      dedup_key: buildDedupKey(regexPlatform, regexReference, regexAmount),
      confianza: 0.6,
    };
  }

  return null;
}

function isValidVisionOcrResponse(data: unknown): data is {
  monto_detectado: number | null;
  moneda_detectada: string | null;
  referencia_detectada: string | null;
  remitente_detectado: string | null;
  plataforma_detectada: string | null;
  confianza_ocr: number;
  observaciones: string;
} {
  if (typeof data !== 'object' || data === null) {
    return false;
  }
  const r = data as Record<string, unknown>;
  return (
    (r.monto_detectado === null || typeof r.monto_detectado === 'number') &&
    (r.moneda_detectada === null || typeof r.moneda_detectada === 'string') &&
    (r.referencia_detectada === null || typeof r.referencia_detectada === 'string') &&
    (r.remitente_detectado === null || typeof r.remitente_detectado === 'string') &&
    (r.plataforma_detectada === null || typeof r.plataforma_detectada === 'string') &&
    typeof r.confianza_ocr === 'number' &&
    typeof r.observaciones === 'string'
  );
}

/**
 * Valida opcionalmente la captura de pago subida por el cliente usando OpenAI Vision (`gpt-4o-mini`).
 * Si `OPENAI_API_KEY` no está configurada o la imagen no es raster, devuelve validación básica sin bloquear.
 */
export async function verifyReceiptWithVisionOcr(
  input: VisionOcrVerificationInput
): Promise<OcrExtractionData> {
  const isRasterDataUrl = /^data:image\/(png|jpeg|jpg|webp|gif);base64,/i.test(
    input.comprobanteBase64
  );

  if (!process.env.OPENAI_API_KEY || !isRasterDataUrl) {
    return {
      monto_detectado: input.montoEsperado,
      moneda_detectada: input.moneda,
      referencia_detectada: input.referenciaReportada,
      remitente_detectado: input.remitenteReportado,
      plataforma_detectada: input.plataformaEsperada,
      coincide_con_reporte: true,
      confianza_ocr: 0.5,
      observaciones: !process.env.OPENAI_API_KEY
        ? 'Validación visual AI omitida (OPENAI_API_KEY no configurada); captura almacenada para auditoría.'
        : 'Captura vector/archivo adjuntada correctamente para auditoría.',
    };
  }

  try {
    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const completion = await openai.chat.completions.create({
      model: process.env.OPENAI_MODEL ?? 'gpt-4o-mini',
      temperature: 0,
      max_tokens: 400,
      response_format: {
        type: 'json_schema',
        json_schema: {
          name: 'receipt_vision_ocr',
          strict: true,
          schema: {
            type: 'object',
            additionalProperties: false,
            required: [
              'monto_detectado',
              'moneda_detectada',
              'referencia_detectada',
              'remitente_detectado',
              'plataforma_detectada',
              'confianza_ocr',
              'observaciones',
            ],
            properties: {
              monto_detectado: { type: ['number', 'null'] },
              moneda_detectada: { type: ['string', 'null'] },
              referencia_detectada: { type: ['string', 'null'] },
              remitente_detectado: { type: ['string', 'null'] },
              plataforma_detectada: { type: ['string', 'null'] },
              confianza_ocr: { type: 'number' },
              observaciones: { type: 'string' },
            },
          },
        },
      },
      messages: [
        {
          role: 'system',
          content:
            'Eres un auditor OCR FinTech. Extrae de la captura de pago Zelle o Binance el monto, moneda, código de referencia/Order ID/TxID, remitente y plataforma.',
        },
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text: `Verifica esta captura contra lo reportado por el cliente: Plataforma=${input.plataformaEsperada}, Moneda=${input.moneda}, Monto=${input.montoEsperado}, Remitente=${input.remitenteReportado}, Referencia=${input.referenciaReportada}.`,
            },
            {
              type: 'image_url',
              image_url: {
                url: input.comprobanteBase64,
                detail: 'low',
              },
            },
          ],
        },
      ],
    });

    const rawJson = completion.choices[0]?.message?.content;
    if (rawJson) {
      const parsed: unknown = JSON.parse(rawJson);
      if (isValidVisionOcrResponse(parsed)) {
        const amountMatches =
          parsed.monto_detectado === null ||
          Math.abs(parsed.monto_detectado - input.montoEsperado) < 0.05;
        const cleanReportedRef = input.referenciaReportada
          .toUpperCase()
          .replace(/[^A-Z0-9]/g, '');
        const cleanOcrRef = (parsed.referencia_detectada ?? '')
          .toUpperCase()
          .replace(/[^A-Z0-9]/g, '');
        const refMatches =
          !cleanOcrRef ||
          !cleanReportedRef ||
          cleanOcrRef === cleanReportedRef ||
          (cleanOcrRef.length >= 6 &&
            cleanReportedRef.length >= 6 &&
            cleanOcrRef.slice(-6) === cleanReportedRef.slice(-6));

        return {
          ...parsed,
          coincide_con_reporte: amountMatches && refMatches,
        };
      }
    }
  } catch (error: unknown) {
    const errMsg =
      error instanceof Error ? error.message : 'Error ejecutando Vision OCR';
    console.error('[Receipt Vision OCR Error]:', errMsg);
  }

  return {
    monto_detectado: null,
    moneda_detectada: input.moneda,
    referencia_detectada: null,
    remitente_detectado: null,
    plataforma_detectada: input.plataformaEsperada,
    coincide_con_reporte: true,
    confianza_ocr: 0.4,
    observaciones: 'No se pudo completar OCR automático; captura guardada para revisión.',
  };
}
