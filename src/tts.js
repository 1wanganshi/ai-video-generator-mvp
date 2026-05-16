import path from "node:path";
import { runFfmpeg } from "./ffmpeg.js";
import { synthesizeAliyunNarration } from "./aliyun-tts.js";

export async function synthesizeNarration({ scenes, settings, outputPath }) {
  const tts = settings.models.tts;
  const voices = settings.voices ?? [];
  const contentModule = settings.currentContentModule ?? null;
  const voiceId = contentModule?.voiceId || tts.defaultVoiceId;
  const voice = voices.find((item) => item.id === voiceId) ?? voices.find((item) => item.id === tts.defaultVoiceId) ?? voices[0];
  const totalDuration = scenes.reduce((sum, scene) => sum + scene.duration, 0);

  if (!tts.enabled || !voice) {
    return null;
  }

  if (tts.provider === "aliyun-dashscope") {
    try {
      const promptSet = (contentModule?.promptSets ?? []).find((item) => item.id === contentModule?.promptSetId);
      const prompt = [settings.prompts.find((item) => item.id === "tts")?.prompt ?? "", promptSet?.ttsPrompt ?? ""]
        .filter(Boolean)
        .join("\n");
      const result = await synthesizeAliyunNarration({
        scenes,
        modelConfig: tts,
        voice,
        prompt,
        outputPath
      });
      return {
        path: outputPath,
        duration: totalDuration,
        textLength: scenes.reduce((sum, scene) => sum + scene.narration.length, 0),
        mode: "aliyun-dashscope",
        ...result
      };
    } catch (error) {
      if (tts.fallbackLocal === false) {
        throw error;
      }
      const fallback = await synthesizeLocalPreview({ scenes, voice, outputPath, totalDuration });
      return {
        ...fallback,
        provider: "aliyun-dashscope",
        mode: "local-fallback",
        error: error.message
      };
    }
  }

  return synthesizeLocalPreview({ scenes, voice, outputPath, totalDuration });
}

async function synthesizeLocalPreview({ scenes, voice, outputPath, totalDuration }) {
  const frequency = Number(voice.baseFrequency ?? 220);
  const volume = voice.type === "cloned" ? "0.11" : "0.08";

  await runFfmpeg([
    "-y",
    "-f",
    "lavfi",
    "-t",
    String(totalDuration),
    "-i",
    `sine=frequency=${frequency}:sample_rate=44100`,
    "-af",
    `volume=${volume}`,
    "-c:a",
    "pcm_s16le",
    path.resolve(outputPath)
  ]);

  return {
    path: outputPath,
    provider: "local-ffmpeg",
    model: "local-preview-voice",
    voiceId: voice.id,
    voiceName: voice.name,
    voiceType: voice.type,
    duration: totalDuration,
    textLength: scenes.reduce((sum, scene) => sum + scene.narration.length, 0),
    mode: "local-preview"
  };
}
