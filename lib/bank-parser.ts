import OpenAI from 'openai';
import {
  BankName,
  ExtractionMethod,
  MovementType,
  ParsedBankTransaction,
} from '@/types/reconciliation';

export interface RawBankEmailInput {
  fromAddress: string;
  subject: string;
  textBody?: string | null;
  htmlBody?: string | null;
  receivedDate?: Date | string;
}

interface AiExtractedPayload {
  banco: BankName;
  tipo_movimiento: MovementType;
  monto_bruto: number;
  remitente_o_destinatario: string | null;
  referencia: string | null;
  fecha_transaccion: string | null;
}

/**
 * Limpia el HTML y normaliza entidades y espacios en blanco de correos de Citibank / TD Bank.
 */
export function sanitizeEmailContent(rawHtmlOrText: string): string {
  if (!rawHtmlOrText) {
    return '';
  }

  return rawHtmlOrText
    // Eliminar bloques <style>, <script> y comentarios HTML
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    // Preservar saltos de línea en etiquetas de bloque y tablas bancarias
    .replace(/<\/(p|div|tr|li|h[1-6]|table)>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/td>/gi, ' : ')
    // Eliminar el resto de etiquetas HTML
    .replace(/<[^>]+>/g, ' ')
    // Decodificar entidades HTML comunes en plantillas bancarias
    .replace(/&nbsp;|&#160;/gi, ' ')
    .replace(/&amp;|&#38;/gi, '&')
    .replace(/&#36;/g, '$')
    .replace(/&quot;|&#34;/gi, '"')
    .replace(/&apos;|&#39;/gi, "'")
    .replace(/&reg;|&#174;/gi, '®')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    // Limpiar espacios múltiples por línea
    .split(/\r?\n/)
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter((line) => line.length > 0)
    .join('\n');
}

/**
 * Convierte cadenas monetarias como "$1,250.00", "USD 1,250.50" o "1250.00" a número de 2 decimales.
 */
export function parseUsdAmount(rawAmount: string): number | null {
  const cleaned = rawAmount.replace(/[^0-9.,]/g, '').trim();
  if (!cleaned) {
    return null;
  }

  // Manejo de formato estándar US (1,250.00) vs formato con coma decimal (1.250,00)
  let normalized = cleaned;
  const lastComma = cleaned.lastIndexOf(',');
  const lastDot = cleaned.lastIndexOf('.');

  if (lastComma > lastDot && cleaned.length - lastComma === 3) {
    // Formato europeo/latino eventual: 1.250,50 -> 1250.50
    normalized = cleaned.replace(/\./g, '').replace(',', '.');
  } else {
    // Formato estándar estadounidense: 1,250.50 -> 1250.50
    normalized = cleaned.replace(/,/g, '');
  }

  const parsed = Number.parseFloat(normalized);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return null;
  }

  return Math.round(parsed * 100) / 100;
}

/**
 * Identifica el banco emisor basándose en el dominio del remitente y el contenido del correo.
 */
export function detectBank(fromAddress: string, fullText: string): BankName {
  const source = `${fromAddress} ${fullText}`.toLowerCase();

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

/**
 * Determina si la alerta corresponde a un ingreso (RECIBIDO) o egreso (ENVIADO).
 */
export function detectMovementType(subject: string, cleanBody: string): MovementType {
  const combined = `${subject}\n${cleanBody}`;

  const outgoingPatterns: ReadonlyArray<RegExp> = [
    /\byou\s+sent\s+(?:a\s+zelle[®\s]*payment|money|\$)/i,
    /\bpayment\s+was\s+sent\s+to\b/i,
    /\byour\s+zelle[®\s]*payment\s+to\b/i,
    /\btransfer\s+sent\s+to\b/i,
    /\boutgoing\s+(?:wire|transfer|payment)\b/i,
    /\benviaste\s+(?:un\s+pago|dinero|\$)/i,
    /\bpago\s+enviado\s+a\b/i,
    /\btransferencia\s+enviada\b/i,
    /\bhas\s+enviado\s+(?:un\s+pago|\$)/i,
  ];

  const incomingPatterns: ReadonlyArray<RegExp> = [
    /\byou\s+(?:have\s+)?received\s+(?:a\s+zelle[®\s]*payment|money|a\s+transfer|\$)/i,
    /\bsent\s+you\s+(?:money|\$)/i,
    /\bdeposited\s+into\s+your\s+account\b/i,
    /\bzelle[®\s]*payment\s+from\b/i,
    /\bpayment\s+received\s+from\b/i,
    /\bincoming\s+(?:wire|transfer|deposit)\b/i,
    /\brecibiste\s+(?:un\s+pago|dinero|una\s+transferencia|\$)/i,
    /\bhas\s+recibido\s+(?:un\s+pago|una\s+transferencia|\$)/i,
    /\bte\s+envi[oó]\s+\$/i,
    /\bdep[oó]sito\s+recibido\b/i,
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

  // Por defecto en buzón de recaudación, salvo que indique envío explícito
  return 'RECIBIDO';
}

/**
 * Extrae el monto en USD desde el asunto o cuerpo limpio usando patrones de Citibank y TD Bank.
 */
function extractAmountByRegex(subject: string, cleanBody: string): number | null {
  const combined = `${subject}\n${cleanBody}`;

  const amountRegexes: ReadonlyArray<RegExp> = [
    // Ej: "Amount: $1,250.00" / "Monto: $1,250.00" / "Payment Amount : USD 1,250.00"
    /(?:amount|payment\s+amount|deposit\s+amount|transfer\s+amount|monto|importe)\s*[:\-]?\s*(?:usd\s*)?\$\s*([0-9]{1,3}(?:,[0-9]{3})*(?:\.[0-9]{2})|[0-9]+\.[0-9]{2})/i,
    // Ej: "sent you $1,250.00" / "received $1,250.00" / "payment of $1,250.00" / "recibiste $1,250.00" / "por $1,250.00"
    /(?:sent\s+you|received|payment\s+of|deposit\s+of|you\s+sent|recibiste|enviaste|te\s+envi[oó]|por\s+un\s+monto\s+de|por)\s*(?:usd\s*)?\$\s*([0-9]{1,3}(?:,[0-9]{3})*(?:\.[0-9]{2})|[0-9]+\.[0-9]{2})/i,
    // Ej: "USD 1,250.00"
    /\bUSD\s*([0-9]{1,3}(?:,[0-9]{3})*(?:\.[0-9]{2})|[0-9]+\.[0-9]{2})\b/i,
    // Fallback general para símbolo de dólar con dos decimales
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

/**
 * Limpia el nombre extraído eliminando ruido bancario al final de la frase.
 */
function cleanPartyName(rawName: string): string | null {
  const cleaned = rawName
    .replace(/\b(?:has\s+been\s+deposited|was\s+deposited|into\s+your\s+account|using\s+zelle[®]?|with\s+zelle[®]?|con\s+zelle[®]?|en\s+tu\s+cuenta|por\s+\$[0-9,.]+|of\s+\$[0-9,.]+)\b.*$/i, '')
    .replace(/[\r\n]+/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .replace(/^[:\-\s]+|[:\-.,;\s]+$/g, '')
    .trim();

  if (cleaned.length < 2 || cleaned.length > 100) {
    return null;
  }

  // Evitar falsos positivos con el nombre del propio banco o etiquetas vacías
  if (/^(?:citibank|citi|td\s*bank|zelle|account|confirmation|reference)$/i.test(cleaned)) {
    return null;
  }

  return cleaned;
}

/**
 * Extrae el nombre del remitente (Zelle sender) o destinatario en alertas de Citibank y TD Bank.
 */
function extractCounterpartyByRegex(subject: string, cleanBody: string): string | null {
  const combined = `${subject}\n${cleanBody}`;

  const partyRegexes: ReadonlyArray<RegExp> = [
    // Etiquetas estructuradas en tablas de Citibank / TD Bank
    /(?:from|sender(?:\s+name)?|sent\s+by|received\s+from|remitente|enviado\s+por|de\s+parte\s+de|paid\s+by)\s*:\s*([A-ZÁÉÍÓÚÑa-záéíóúñ0-9][A-ZÁÉÍÓÚÑa-záéíóúñ0-9\s.,&'-]{2,70})/i,
    /(?:to|recipient(?:\s+name)?|sent\s+to|destinatario|para)\s*:\s*([A-ZÁÉÍÓÚÑa-záéíóúñ0-9][A-ZÁÉÍÓÚÑa-záéíóúñ0-9\s.,&'-]{2,70})/i,
    // Citibank / TD Bank Inglés: "CARLOS RODRIGUEZ sent you $1,250.00"
    /(?:^|\n)\s*([A-ZÁÉÍÓÚÑ][A-Za-záéíóúñÁÉÍÓÚÑ0-9\s.,&'-]{2,60}?)\s+(?:has\s+)?sent\s+you\s+(?:\$|money|a\s+zelle)/im,
    // Citibank / TD Bank Inglés: "received a Zelle® payment of $1,250.00 from MARIA GOMEZ" o "Zelle® payment from MARIA GOMEZ"
    /(?:zelle[®]?\s+payment(?:\s+of\s+\$[0-9,.]+)?\s+from|received\s+\$[0-9,.]+\s+from|payment\s+from|transfer\s+from)\s+([A-ZÁÉÍÓÚÑa-záéíóúñ][A-Za-záéíóúñÁÉÍÓÚÑ0-9\s.,&'-]{2,65}?)(?=\s+(?:has\s+been|was|on\s+|for\s+\$|into\s+|confirmation|\.|,|\n|$))/i,
    // Citibank / TD Bank Inglés Saliente: "You sent $500.00 to JOHN SMITH" / "payment to JOHN SMITH"
    /(?:you\s+sent\s+(?:\$[0-9,.]+\s+)?to|zelle[®]?\s+payment\s+to)\s+([A-ZÁÉÍÓÚÑa-záéíóúñ][A-Za-záéíóúñÁÉÍÓÚÑ0-9\s.,&'-]{2,65}?)(?=\s+(?:has\s+been|was|on\s+|\.|,|\n|$))/i,
    // Español: "Recibiste un pago con Zelle de JUAN PEREZ por $500.00" / "Recibiste $500.00 de JUAN PEREZ"
    /(?:pago(?:\s+con\s+zelle[®]?)?\s+de|recibiste\s+\$[0-9,.]+\s+de|transferencia\s+de)\s+([A-ZÁÉÍÓÚÑa-záéíóúñ][A-Za-záéíóúñÁÉÍÓÚÑ0-9\s.,&'-]{2,65}?)(?=\s+(?:por\s+\$|ha\s+sido|fue|en\s+tu|\.|,|\n|$))/i,
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

  return null;
}

/**
 * Extrae el número de confirmación o referencia de Zelle / Transferencia.
 */
function extractReferenceByRegex(subject: string, cleanBody: string): string | null {
  const combined = `${subject}\n${cleanBody}`;

  const referenceRegexes: ReadonlyArray<RegExp> = [
    /(?:confirmation\s*(?:number|code|#|no\.?|id)?|reference\s*(?:number|code|#|no\.?|id)?|transaction\s*(?:id|number|#)|zelle[®]?\s*confirmation|n[uú]mero\s+de\s+(?:confirmaci[oó]n|referencia)|c[oó]digo\s+de\s+(?:confirmaci[oó]n|referencia)|referencia)\s*[:#\-]?\s*([A-Z0-9][A-Z0-9\-]{4,35})/i,
  ];

  for (const regex of referenceRegexes) {
    const match = combined.match(regex);
    if (match && match[1]) {
      const candidate = match[1].trim().toUpperCase();
      // Descartar palabras comunes en inglés/español que no son referencias alfanuméricas reales
      if (!/^(?:NUMBER|CODE|DETAILS|STATUS|PENDING|COMPLETED|RECIBIDO|ENVIADO)$/i.test(candidate)) {
        return candidate;
      }
    }
  }

  return null;
}

/**
 * Type Guard estricto para validar el JSON devuelto por el LLM sin usar `any`.
 */
function isValidAiExtractedPayload(data: unknown): data is AiExtractedPayload {
  if (typeof data !== 'object' || data === null) {
    return false;
  }

  const record = data as Record<string, unknown>;

  const validBanks: ReadonlyArray<string> = ['CITIBANK', 'TD_BANK', 'OTRO'];
  const validMovements: ReadonlyArray<string> = ['RECIBIDO', 'ENVIADO'];

  const hasValidBank = typeof record.banco === 'string' && validBanks.includes(record.banco);
  const hasValidMovement =
    typeof record.tipo_movimiento === 'string' && validMovements.includes(record.tipo_movimiento);
  const hasValidAmount =
    typeof record.monto_bruto === 'number' &&
    Number.isFinite(record.monto_bruto) &&
    record.monto_bruto > 0;
  const hasValidParty =
    record.remitente_o_destinatario === null || typeof record.remitente_o_destinatario === 'string';
  const hasValidRef = record.referencia === null || typeof record.referencia === 'string';
  const hasValidDate =
    record.fecha_transaccion === null || typeof record.fecha_transaccion === 'string';

  return (
    hasValidBank &&
    hasValidMovement &&
    hasValidAmount &&
    hasValidParty &&
    hasValidRef &&
    hasValidDate
  );
}

/**
 * CAPA 2 (AI Fallback): Extrae datos estructurados del correo usando OpenAI o Anthropic
 * cuando el formato del correo cambia o la Capa 1 (Regex) no logra capturar monto y remitente.
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

  const systemInstruction = `Eres un extractor financiero determinístico para conciliación bancaria de Zelle y transferencias en Citibank y TD Bank.
Analiza el correo de alerta bancaria y devuelve ÚNICAMENTE un objeto JSON estricto con esta estructura exacta:
{
  "banco": "CITIBANK" | "TD_BANK" | "OTRO",
  "tipo_movimiento": "RECIBIDO" | "ENVIADO",
  "monto_bruto": number (monto exacto en USD con hasta 2 decimales, ej. 1250.00),
  "remitente_o_destinatario": string | null (nombre completo de quien envía el Zelle o destinatario),
  "referencia": string | null (número de confirmación o referencia bancaria),
  "fecha_transaccion": string | null (fecha en formato ISO 8601)
}`;

  // Opción 1: OpenAI SDK con Structured Outputs
  if (process.env.OPENAI_API_KEY) {
    try {
      const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
      const completion = await openai.chat.completions.create({
        model: process.env.OPENAI_MODEL ?? 'gpt-4o-mini',
        temperature: 0,
        response_format: {
          type: 'json_schema',
          json_schema: {
            name: 'bank_email_alert_extraction',
            strict: true,
            schema: {
              type: 'object',
              additionalProperties: false,
              required: [
                'banco',
                'tipo_movimiento',
                'monto_bruto',
                'remitente_o_destinatario',
                'referencia',
                'fecha_transaccion',
              ],
              properties: {
                banco: {
                  type: 'string',
                  enum: ['CITIBANK', 'TD_BANK', 'OTRO'],
                },
                tipo_movimiento: {
                  type: 'string',
                  enum: ['RECIBIDO', 'ENVIADO'],
                },
                monto_bruto: {
                  type: 'number',
                },
                remitente_o_destinatario: {
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
      const errMessage = error instanceof Error ? error.message : 'Error desconocido en OpenAI';
      console.error('[BankParser AI Fallback - OpenAI Error]:', errMessage);
    }
  }

  // Opción 2: Anthropic Messages API (Claude)
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
          const contentBlocks = (payload as { content: Array<{ type?: string; text?: string }> })
            .content;
          const textBlock = contentBlocks.find((b) => b.type === 'text' && typeof b.text === 'string');
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
      const errMessage = error instanceof Error ? error.message : 'Error desconocido en Anthropic';
      console.error('[BankParser AI Fallback - Anthropic Error]:', errMessage);
    }
  }

  return null;
}

/**
 * Motor Principal de Parseo Híbrido:
 * 1. Ejecuta Capa 1 (Regex de baja latencia sobre texto/HTML sanitizado).
 * 2. Si falta el monto o el remitente/destinatario, dispara Capa 2 (AI Fallback).
 */
export async function parseBankAlertEmail(
  input: RawBankEmailInput
): Promise<ParsedBankTransaction | null> {
  const rawSource = input.htmlBody && input.htmlBody.trim().length > 0
    ? `${input.textBody ?? ''}\n${input.htmlBody}`
    : (input.textBody ?? '');

  const cleanBody = sanitizeEmailContent(rawSource);
  const defaultIsoDate =
    input.receivedDate instanceof Date
      ? input.receivedDate.toISOString()
      : typeof input.receivedDate === 'string' && !Number.isNaN(Date.parse(input.receivedDate))
        ? new Date(input.receivedDate).toISOString()
        : new Date().toISOString();

  // --- CAPA 1: Extracción por Expresiones Regulares ---
  const regexBank = detectBank(input.fromAddress, `${input.subject}\n${cleanBody}`);
  const regexMovement = detectMovementType(input.subject, cleanBody);
  const regexAmount = extractAmountByRegex(input.subject, cleanBody);
  const regexCounterparty = extractCounterpartyByRegex(input.subject, cleanBody);
  const regexReference = extractReferenceByRegex(input.subject, cleanBody);

  const hasReliableRegexExtraction =
    regexAmount !== null &&
    regexAmount > 0 &&
    regexCounterparty !== null &&
    regexCounterparty.length >= 3;

  if (hasReliableRegexExtraction && regexAmount !== null) {
    return {
      banco: regexBank,
      tipo_movimiento: regexMovement,
      monto_bruto: regexAmount,
      remitente_o_destinatario: regexCounterparty,
      referencia: regexReference,
      fecha_transaccion: defaultIsoDate,
      metodo_extraccion: 'REGEX',
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

    const method: ExtractionMethod = 'AI_FALLBACK';

    return {
      banco: aiResult.banco !== 'OTRO' ? aiResult.banco : regexBank,
      tipo_movimiento: aiResult.tipo_movimiento,
      monto_bruto: Math.round(aiResult.monto_bruto * 100) / 100,
      remitente_o_destinatario: aiResult.remitente_o_destinatario ?? regexCounterparty,
      referencia: aiResult.referencia ?? regexReference,
      fecha_transaccion: validIsoDate,
      metodo_extraccion: method,
      confianza: 0.85,
    };
  }

  // Si el LLM no está configurado pero Regex capturó un monto válido (aunque sin remitente claro),
  // devolvemos el registro para que entre en estado REVISION_MANUAL y nunca se pierda un depósito.
  if (regexAmount !== null && regexAmount > 0) {
    return {
      banco: regexBank,
      tipo_movimiento: regexMovement,
      monto_bruto: regexAmount,
      remitente_o_destinatario: regexCounterparty,
      referencia: regexReference,
      fecha_transaccion: defaultIsoDate,
      metodo_extraccion: 'REGEX',
      confianza: 0.6,
    };
  }

  return null;
}
