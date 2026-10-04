/** Bounded streaming reads shared by ingestion and image retrieval. */
export async function readBoundedBody(message: { headers: Headers; body: ReadableStream<Uint8Array> | null }, maximum: number): Promise<Uint8Array> {
  if (!Number.isSafeInteger(maximum) || maximum <= 0) throw new Error("Invalid body size limit");
  if (Number(message.headers.get("content-length") ?? 0) > maximum) throw new RangeError("Body exceeds size limit");
  if (!message.body) return new Uint8Array();
  const reader = message.body.getReader();
  const parts: Uint8Array[] = []; let size = 0;
  try {
    while (true) {
      const chunk = await reader.read(); if (chunk.done) break;
      size += chunk.value.length;
      if (size > maximum) throw new RangeError("Body exceeds size limit");
      parts.push(chunk.value);
    }
  } finally { await reader.cancel(); }
  const output = new Uint8Array(size); let offset = 0;
  for (const part of parts) { output.set(part, offset); offset += part.length; }
  return output;
}

export function imageSignatureMatches(bytes: Uint8Array, mime: string): boolean {
  const begins = (...values: number[]) => values.every((v, i) => bytes[i] === v);
  const ascii = (start: number, value: string) => [...value].every((v, i) => bytes[start + i] === v.charCodeAt(0));
  if (mime === "image/png") return begins(137, 80, 78, 71, 13, 10, 26, 10);
  if (mime === "image/jpeg") return begins(255, 216, 255);
  if (mime === "image/gif") return ascii(0, "GIF87a") || ascii(0, "GIF89a");
  if (mime === "image/webp") return ascii(0, "RIFF") && ascii(8, "WEBP");
  return false;
}
