const MAX_SCENES = 8;
const MIN_SCENES = 3;
const DEFAULT_DURATION = 3;

export function createStoryboard(inputText, template) {
  const cleanText = normalizeText(inputText);
  const chunks = splitIntoChunks(cleanText);
  const selectedChunks = chunks.slice(0, MAX_SCENES);

  while (selectedChunks.length < MIN_SCENES) {
    selectedChunks.push(chunks[selectedChunks.length % chunks.length] ?? cleanText);
  }

  return selectedChunks.map((chunk, index) => {
    const subtitle = toSubtitle(chunk);
    return {
      index: index + 1,
      duration: DEFAULT_DURATION,
      narration: chunk,
      subtitle,
      visualDescription: buildVisualDescription(chunk, index, template),
      imageUrl: null
    };
  });
}

function normalizeText(value) {
  return String(value ?? "")
    .replace(/\r/g, "\n")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function splitIntoChunks(text) {
  if (!text) {
    return [];
  }

  const paragraphs = text.split(/\n+/).map((part) => part.trim()).filter(Boolean);
  const sentenceLike = paragraphs.flatMap((paragraph) => {
    const parts = paragraph.match(/[^。！？!?；;]+[。！？!?；;]?/g);
    return parts ? parts.map((part) => part.trim()).filter(Boolean) : [paragraph];
  });

  const chunks = [];
  let buffer = "";

  for (const sentence of sentenceLike) {
    const next = buffer ? `${buffer}${sentence}` : sentence;
    if (next.length <= 42) {
      buffer = next;
      continue;
    }

    if (buffer) {
      chunks.push(buffer);
    }

    if (sentence.length > 58) {
      chunks.push(...splitLongSentence(sentence, 46));
      buffer = "";
    } else {
      buffer = sentence;
    }
  }

  if (buffer) {
    chunks.push(buffer);
  }

  return chunks.length ? chunks : [text.slice(0, 80)];
}

function splitLongSentence(sentence, size) {
  const result = [];
  for (let index = 0; index < sentence.length; index += size) {
    result.push(sentence.slice(index, index + size));
  }
  return result;
}

function toSubtitle(chunk) {
  const compact = chunk.replace(/\s+/g, "");
  return compact.length > 34 ? `${compact.slice(0, 34)}...` : compact;
}

function buildVisualDescription(chunk, index, template) {
  const motif = [
    "开场建立氛围，主体居中，背景留出字幕空间",
    "近景聚焦关键意象，画面有明确层次",
    "用光线或山水线条承接情绪变化",
    "形成转折感，主体和背景产生对比",
    "收束主题，画面稳定且有结束感"
  ][index % 5];

  return `${template.stylePrompt}; ${motif}; 内容主题：${chunk}`;
}
