import { writeFile } from "node:fs/promises";
import path from "node:path";
import { runFfmpeg } from "./ffmpeg.js";

export async function composeVideo({ scenes, imagePaths, outputPath, workDir, narrationAudioPath = null }) {
  const concatPath = path.join(workDir, "concat.txt");
  const concatBody = imagePaths
    .map((imagePath, index) => {
      const normalized = path.resolve(imagePath).replaceAll("\\", "/").replaceAll("'", "'\\''");
      return `file '${normalized}'\nduration ${scenes[index].duration}`;
    })
    .join("\n");
  const lastPath = path.resolve(imagePaths.at(-1)).replaceAll("\\", "/").replaceAll("'", "'\\''");
  await writeFile(concatPath, `${concatBody}\nfile '${lastPath}'\n`, "utf8");

  const totalDuration = scenes.reduce((sum, scene) => sum + scene.duration, 0);

  const baseArgs = [
    "-y",
    "-f",
    "concat",
    "-safe",
    "0",
    "-i",
    concatPath
  ];

  if (narrationAudioPath) {
    await runFfmpeg([
      ...baseArgs,
      "-i",
      path.resolve(narrationAudioPath),
      "-f",
      "lavfi",
      "-t",
      String(totalDuration),
      "-i",
      "sine=frequency=176:sample_rate=44100",
      "-filter_complex",
      "[0:v]fps=30,format=yuv420p[v];[1:a]volume=0.9[narr];[2:a]volume=0.025[bgm];[narr][bgm]amix=inputs=2:duration=shortest:normalize=0[aout]",
      "-map",
      "[v]",
      "-map",
      "[aout]",
      "-shortest",
      "-c:v",
      "libx264",
      "-preset",
      "veryfast",
      "-c:a",
      "aac",
      "-movflags",
      "+faststart",
      path.resolve(outputPath)
    ]);
    return;
  }

  await runFfmpeg([
    ...baseArgs,
    "-f",
    "lavfi",
    "-t",
    String(totalDuration),
    "-i",
    "sine=frequency=220:sample_rate=44100",
    "-vf",
    "fps=30,format=yuv420p",
    "-af",
    "volume=0.025",
    "-shortest",
    "-c:v",
    "libx264",
    "-preset",
    "veryfast",
    "-c:a",
    "aac",
    "-movflags",
    "+faststart",
    path.resolve(outputPath)
  ]);
}
