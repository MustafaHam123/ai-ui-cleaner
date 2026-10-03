const STOPWORDS = new Set([
  "a", "an", "and", "are", "as", "at", "be", "by", "for", "from", "has",
  "in", "is", "it", "of", "on", "or", "that", "the", "this", "to", "was",
  "with", "website", "web", "page", "design", "component", "ui",
]);

export function normalizeText(value: string): string {
  return value
    .normalize("NFKC")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .toLowerCase()
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/[^\p{L}\p{N}+#.-]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function tokenize(value: string): string[] {
  return normalizeText(value)
    .split(" ")
    .filter((token) => token.length > 1 && !STOPWORDS.has(token));
}

function hash(value: string): number {
  let result = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    result ^= value.charCodeAt(index);
    result = Math.imul(result, 16777619);
  }
  return result >>> 0;
}

export function hashedVector(value: string, dimensions = 384): Float64Array {
  const vector = new Float64Array(dimensions);
  const tokens = tokenize(value);
  const features = [...tokens];

  for (const token of tokens) {
    const padded = `^${token}$`;
    for (let index = 0; index <= padded.length - 3; index += 1) {
      features.push(padded.slice(index, index + 3));
    }
  }

  for (const feature of features) {
    const valueHash = hash(feature);
    const bucket = valueHash % dimensions;
    const sign = (valueHash & 1) === 0 ? 1 : -1;
    vector[bucket] += sign;
  }

  let magnitude = 0;
  for (const entry of vector) magnitude += entry * entry;
  magnitude = Math.sqrt(magnitude);
  if (magnitude > 0) {
    for (let index = 0; index < vector.length; index += 1) {
      vector[index] /= magnitude;
    }
  }
  return vector;
}

export function cosineSimilarity(left: Float64Array, right: Float64Array): number {
  let dot = 0;
  for (let index = 0; index < left.length; index += 1) dot += left[index] * right[index];
  return Math.max(0, dot);
}
