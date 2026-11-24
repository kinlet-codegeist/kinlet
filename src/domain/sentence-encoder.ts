// MinishLab potion-base-2M, from the app's static assets. No project text leaves the browser.
export type SentenceEncoder = (text: string) => Float32Array;
const width = 64;
let loaded: Promise<SentenceEncoder> | undefined;

async function loadEncoder(): Promise<SentenceEncoder> {
  // Load the weights as same-resource JS chunks in Forge's sandbox, including when direct fetch is restricted.
  const [{ default: vocab }, { default: encoded }] = await Promise.all([
    import("../assets/potion-2m/vocab.txt?raw"),
    import("../assets/potion-2m/vectors.b64?raw"),
  ]);
  const binary = atob(encoded);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index++)
    bytes[index] = binary.charCodeAt(index);
  const weights = bytes.buffer;
  const tokens = vocab.trimEnd().split(/\r?\n/);
  if (weights.byteLength !== tokens.length * (width + 4))
    throw new Error("The passage-matching model could not be loaded.");
  const ids = new Map(tokens.map((token, index) => [token, index]));
  const scales = new Float32Array(weights, 0, tokens.length);
  const vectors = new Int8Array(weights, tokens.length * 4);

  return (text) => {
    const result = new Float32Array(width);
    const normalized = text
      .toLowerCase()
      .normalize("NFD")
      .replace(/\p{M}/gu, "");
    const words =
      normalized.match(/[\p{L}\p{N}]+|[^\p{L}\p{N}\s\p{C}]/gu) ?? [];
    for (const word of words) {
      if (word.length > 100) continue;
      const pieces: number[] = [];
      for (let start = 0; start < word.length;) {
        let end = word.length,
          id: number | undefined;
        while (end > start) {
          id = ids.get((start ? "##" : "") + word.slice(start, end));
          if (id !== undefined) break;
          end--;
        }
        if (id === undefined) {
          pieces.length = 0;
          break;
        }
        pieces.push(id);
        start = end;
      }
      for (const id of pieces) {
        for (let i = 0; i < width; i++)
          result[i] += vectors[id * width + i] * scales[id];
      }
    }
    const norm = Math.hypot(...result);
    if (norm) for (let i = 0; i < width; i++) result[i] /= norm;
    return result;
  };
}

export function getSentenceEncoder() {
  loaded ??= loadEncoder().catch((error) => {
    loaded = undefined;
    throw error;
  });
  return loaded;
}

export function similarity(left: Float32Array, right: Float32Array) {
  let dot = 0;
  for (let i = 0; i < width; i++) dot += left[i] * right[i];
  return dot;
}
