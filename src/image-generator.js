import path from "node:path";
import { runFfmpeg } from "./ffmpeg.js";
import { generateImage2 } from "./image2.js";

const WIDTH = 1280;
const HEIGHT = 720;
const FONT_FILE = "C\\:/Windows/Fonts/msyh.ttc";

export async function generateSceneImage({ scene, template, outputPath, settings = null, contentModule = null }) {
  const imageConfig = settings?.models?.image;
  if (imageConfig?.enabled && imageConfig.provider === "image2") {
    try {
      const prompt = buildImage2Prompt({ scene, template, settings, contentModule });
      return await generateImage2({
        prompt,
        modelConfig: imageConfig,
        outputPath
      });
    } catch (error) {
      if (imageConfig.fallbackLocal === false) {
        throw error;
      }
      await generateLocalSceneImage({ scene, template, outputPath });
      return {
        provider: "image2",
        model: imageConfig.model,
        mode: "local-fallback",
        error: error.message
      };
    }
  }

  await generateLocalSceneImage({ scene, template, outputPath });
  return {
    provider: "local-ffmpeg",
    model: "local-preview-image",
    mode: "local-preview"
  };
}

async function generateLocalSceneImage({ scene, template, outputPath }) {
  const colors = template.colors;
  const title = wrapText(scene.subtitle, 15).slice(0, 2);
  const promptLine = wrapText(scene.visualDescription.split("内容主题：")[0], 28).slice(0, 2);
  const filters = [
    `drawbox=x=0:y=0:w=${WIDTH}:h=${HEIGHT}:color=0x${colors.background}:t=fill`,
    ...templateBackground(template),
    `drawbox=x=74:y=70:w=1132:h=580:color=0x${colors.surface}@0.82:t=fill`,
    `drawbox=x=74:y=70:w=1132:h=580:color=0x${colors.accent}:t=6`,
    `drawtext=fontfile='${FONT_FILE}':text='${escapeDrawtext(template.name)}':x=98:y=96:fontsize=30:fontcolor=0x${colors.secondary}`,
    `drawtext=fontfile='${FONT_FILE}':text='${escapeDrawtext(String(scene.index).padStart(2, "0"))}':x=1110:y=96:fontsize=34:fontcolor=0x${colors.accent}`,
    ...title.map((line, index) => {
      const y = 248 + index * 72;
      return `drawtext=fontfile='${FONT_FILE}':text='${escapeDrawtext(line)}':x=(w-text_w)/2:y=${y}:fontsize=54:fontcolor=0x${colors.text}:line_spacing=12`;
    }),
    ...promptLine.map((line, index) => {
      const y = 454 + index * 36;
      return `drawtext=fontfile='${FONT_FILE}':text='${escapeDrawtext(line)}':x=(w-text_w)/2:y=${y}:fontsize=24:fontcolor=0x${colors.secondary}`;
    }),
    `drawbox=x=150:y=585:w=980:h=1:color=0x${colors.accent}@0.8:t=fill`
  ];

  await runFfmpeg([
    "-y",
    "-f",
    "lavfi",
    "-i",
    `color=c=0x${colors.background}:s=${WIDTH}x${HEIGHT}:d=1`,
    "-vf",
    filters.join(","),
    "-frames:v",
    "1",
    path.resolve(outputPath)
  ]);
}

function buildImage2Prompt({ scene, template, settings, contentModule }) {
  const prompt = settings?.prompts?.find((item) => item.id === "image")?.prompt ?? "";
  return [
    prompt,
    contentModule?.prompt ? `Content module rule: ${contentModule.prompt}` : "",
    `Video template: ${template.name}`,
    `Unified style: ${template.stylePrompt}`,
    "Aspect ratio: 16:9. Output should work as a video storyboard frame.",
    "Do not render readable subtitles or watermarks inside the image.",
    `Scene ${scene.index}: ${scene.visualDescription}`,
    `Narration context: ${scene.narration}`
  ]
    .filter(Boolean)
    .join("\n");
}

function templateBackground(template) {
  const { colors, id } = template;

  if (id === "tech") {
    return [
      `drawgrid=width=80:height=80:thickness=1:color=0x${colors.secondary}@0.28`,
      `drawbox=x=0:y=520:w=1280:h=200:color=0x${colors.accent}@0.12:t=fill`,
      `drawbox=x=190:y=146:w=900:h=2:color=0x${colors.accent}@0.55:t=fill`,
      `drawbox=x=190:y=558:w=900:h=2:color=0x${colors.accent}@0.55:t=fill`
    ];
  }

  if (id === "mao") {
    return [
      `drawbox=x=0:y=0:w=1280:h=150:color=0x${colors.accent}@0.65:t=fill`,
      `drawbox=x=0:y=570:w=1280:h=150:color=0x${colors.primary}@0.32:t=fill`,
      `drawbox=x=100:y=120:w=1080:h=12:color=0x${colors.secondary}@0.85:t=fill`,
      `drawbox=x=100:y=588:w=1080:h=12:color=0x${colors.secondary}@0.85:t=fill`
    ];
  }

  if (id === "guofeng") {
    return [
      `drawbox=x=0:y=0:w=1280:h=720:color=0x${colors.surface}@0.32:t=fill`,
      `drawbox=x=0:y=612:w=1280:h=108:color=0x${colors.accent}@0.12:t=fill`,
      `drawbox=x=126:y=132:w=1028:h=2:color=0x${colors.secondary}@0.65:t=fill`,
      `drawbox=x=126:y=586:w=1028:h=2:color=0x${colors.secondary}@0.65:t=fill`
    ];
  }

  return [
    `drawbox=x=0:y=0:w=1280:h=720:color=0x${colors.surface}@0.28:t=fill`,
    `drawbox=x=0:y=575:w=1280:h=145:color=0x${colors.accent}@0.12:t=fill`,
    `drawbox=x=128:y=150:w=1024:h=2:color=0x${colors.secondary}@0.45:t=fill`,
    `drawbox=x=128:y=570:w=1024:h=2:color=0x${colors.secondary}@0.45:t=fill`
  ];
}

function wrapText(value, maxLength) {
  const source = String(value ?? "").replace(/\s+/g, "");
  const lines = [];
  for (let index = 0; index < source.length; index += maxLength) {
    lines.push(source.slice(index, index + maxLength));
  }
  return lines.length ? lines : [""];
}

function escapeDrawtext(value) {
  return String(value)
    .replaceAll("\\", "\\\\")
    .replaceAll(":", "\\:")
    .replaceAll("'", "\\'")
    .replaceAll("%", "\\%")
    .replaceAll(",", "\\,")
    .replaceAll("[", "\\[")
    .replaceAll("]", "\\]");
}
