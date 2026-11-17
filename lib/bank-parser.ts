export {
  buildDedupKey,
  detectBank,
  detectCurrency,
  detectMovementType,
  parseBankAlertEmail,
  parseUsdAmount,
  sanitizeEmailContent,
  verifyReceiptWithVisionOcr,
} from '@/lib/email-parser';

export type {
  RawBankEmailInput,
  VisionOcrVerificationInput,
} from '@/lib/email-parser';
