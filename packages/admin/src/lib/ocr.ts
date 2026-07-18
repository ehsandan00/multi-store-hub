/** Pick the most useful lines from OCR output for product-name search. */
export function pickOcrSearchQueries(rawText: string): string[] {
  const lines = rawText
    .split(/[\n\r]+/)
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter((line) => line.length >= 3)
    .filter((line) => /[\p{L}]/u.test(line))
    .filter((line) => !/^[\d\s./\\\-–—]+$/.test(line));

  const unique = [...new Set(lines)].sort((a, b) => b.length - a.length);
  const queries = unique.slice(0, 6);

  const collapsed = rawText.replace(/\s+/g, ' ').trim();
  if (
    collapsed.length >= 4 &&
    /[\p{L}]/u.test(collapsed) &&
    !queries.includes(collapsed) &&
    !collapsed.includes('\n')
  ) {
    queries.push(collapsed.slice(0, 120));
  }

  return queries;
}

let workerPromise: ReturnType<typeof loadOcrWorker> | null = null;

async function loadOcrWorker() {
  const { createWorker } = await import('tesseract.js');
  const worker = await createWorker('fas+eng', 1, { logger: () => undefined });
  return worker;
}

async function getOcrWorker() {
  workerPromise ??= loadOcrWorker();
  return workerPromise;
}

/** Read visible text from a photo (works on phone over http — no live camera needed). */
export async function extractTextFromImageFile(file: File): Promise<string> {
  const worker = await getOcrWorker();
  const { data } = await worker.recognize(file);
  return data.text ?? '';
}
