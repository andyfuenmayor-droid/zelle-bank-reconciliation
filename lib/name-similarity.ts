const BUSINESS_STOP_WORDS = new Set([
  'llc',
  'inc',
  'corp',
  'corporation',
  'company',
  'co',
  'ltd',
  'sa',
  'ca',
  'srl',
  'de',
  'del',
  'la',
  'las',
  'los',
  'el',
  'y',
  'the',
  'and',
]);

export function normalizePersonName(raw: string | null | undefined): string {
  return (raw ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function tokenizeName(normalized: string): string[] {
  const all = normalized.split(' ').filter(Boolean);
  const filtered = all.filter((w) => !BUSINESS_STOP_WORDS.has(w));
  return filtered.length > 0 ? filtered : all;
}

function levenshteinDistance(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  const prev = new Array<number>(b.length + 1);
  const curr = new Array<number>(b.length + 1);
  for (let j = 0; j <= b.length; j += 1) {
    prev[j] = j;
  }

  for (let i = 1; i <= a.length; i += 1) {
    curr[0] = i;
    const chA = a.charCodeAt(i - 1);
    for (let j = 1; j <= b.length; j += 1) {
      const cost = chA === b.charCodeAt(j - 1) ? 0 : 1;
      curr[j] = Math.min(
        prev[j] + 1,
        curr[j - 1] + 1,
        prev[j - 1] + cost
      );
    }
    for (let j = 0; j <= b.length; j += 1) {
      prev[j] = curr[j];
    }
  }
  return prev[b.length];
}

function stringSimilarity(a: string, b: string): number {
  if (!a || !b) return 0;
  if (a === b) return 1;
  const maxLen = Math.max(a.length, b.length);
  if (maxLen === 0) return 1;
  return Math.max(0, 1 - levenshteinDistance(a, b) / maxLen);
}

function tokenPairSimilarity(t1: string, t2: string): number {
  if (t1 === t2) return 1;
  // Inicial vs nombre completo (ej. "j" vs "jason")
  if (
    (t1.length === 1 && t2.startsWith(t1)) ||
    (t2.length === 1 && t1.startsWith(t2))
  ) {
    return 0.85;
  }
  // Prefijo de al menos 3 letras (ej. "william" vs "williams")
  const minLen = Math.min(t1.length, t2.length);
  if (minLen >= 3 && (t1.startsWith(t2) || t2.startsWith(t1))) {
    return Math.max(0.88, stringSimilarity(t1, t2));
  }
  return stringSimilarity(t1, t2);
}

/**
 * Calcula un porcentaje de coincidencia (0 a 100) entre el nombre reportado por el cliente
 * y el nombre del remitente registrado en el correo bancario.
 */
export function computeNameMatchScore(
  reportedNameRaw: string | null | undefined,
  bankSenderNameRaw: string | null | undefined
): {
  similarityPercent: number;
  matched: boolean;
  matchLevel: 'EXACTO' | 'ALTO' | 'PARCIAL' | 'BAJO';
  detail: string;
} {
  const normA = normalizePersonName(reportedNameRaw);
  const normB = normalizePersonName(bankSenderNameRaw);

  if (!normA || !normB) {
    return {
      similarityPercent: 0,
      matched: false,
      matchLevel: 'BAJO',
      detail: 'No se pudo comparar porque falta alguno de los nombres.',
    };
  }

  if (normA === normB) {
    return {
      similarityPercent: 100,
      matched: true,
      matchLevel: 'EXACTO',
      detail: 'El nombre escrito coincide exactamente (100%) con el correo del banco.',
    };
  }

  const tokensA = tokenizeName(normA);
  const tokensB = tokenizeName(normB);

  const wholeSim = stringSimilarity(normA, normB);

  // Mejor emparejamiento bidireccional entre tokens (tolera orden invertido o segundo nombre)
  const scoreFrom = (src: string[], dst: string[]): number => {
    if (src.length === 0 || dst.length === 0) return 0;
    let total = 0;
    for (const s of src) {
      let best = 0;
      for (const d of dst) {
        const sim = tokenPairSimilarity(s, d);
        if (sim > best) best = sim;
      }
      total += best;
    }
    return total / src.length;
  };

  const forward = scoreFrom(tokensA, tokensB);
  const backward = scoreFrom(tokensB, tokensA);
  const maxDir = Math.max(forward, backward);
  const minDir = Math.min(forward, backward);

  // Si todos los tokens del nombre más corto están en el más largo (ej. "Jose Garcia" vs "Jose Manuel Garcia")
  const subsetBonus =
    maxDir >= 0.92 && minDir >= 0.65
      ? 0.72 * maxDir + 0.28 * minDir
      : 0.55 * maxDir + 0.45 * minDir;

  const combined = Math.max(wholeSim, subsetBonus);
  const similarityPercent = Math.max(
    0,
    Math.min(100, Math.round(combined * 100))
  );

  let matchLevel: 'EXACTO' | 'ALTO' | 'PARCIAL' | 'BAJO';
  let detail: string;
  if (similarityPercent >= 95) {
    matchLevel = 'EXACTO';
    detail = `Coincidencia prácticamente exacta (${similarityPercent}%) con el correo bancario.`;
  } else if (similarityPercent >= 75) {
    matchLevel = 'ALTO';
    detail = `Coincidencia alta (${similarityPercent}%) con el remitente del correo bancario.`;
  } else if (similarityPercent >= 50) {
    matchLevel = 'PARCIAL';
    detail = `Coincidencia parcial (${similarityPercent}%). Verifica si el titular del correo difiere ligeramente.`;
  } else {
    matchLevel = 'BAJO';
    detail = `Coincidencia baja (${similarityPercent}%). El nombre escrito difiere del remitente registrado en el correo del banco.`;
  }

  return {
    similarityPercent,
    matched: similarityPercent >= 70,
    matchLevel,
    detail,
  };
}
