import { mkdir, stat } from "node:fs/promises";
import path from "node:path";
import { templates } from "../src/templates.js";
import { createStoryboard } from "../src/storyboard.js";
import { generateSceneImage } from "../src/image-generator.js";
import { composeVideo } from "../src/video-composer.js";

const dir = "tmp-test";
await mkdir(dir, { recursive: true });

const scenes = createStoryboard(
  "真正的改变不是突然发生的。它来自每天重复的小动作。当你把注意力放回过程，机会才会出现。",
  templates[0]
).slice(0, 3);

const imagePaths = [];
for (const scene of scenes) {
  const outputPath = path.join(dir, `scene-${scene.index}.png`);
  await generateSceneImage({
    scene,
    template: templates[0],
    outputPath
  });
  imagePaths.push(outputPath);
}

const outputPath = path.join(dir, "video.mp4");
await composeVideo({
  scenes,
  imagePaths,
  outputPath,
  workDir: dir
});

const videoStat = await stat(outputPath);
console.log(
  JSON.stringify({
    scenes: scenes.length,
    images: imagePaths.length,
    video: outputPath,
    bytes: videoStat.size
  })
);
