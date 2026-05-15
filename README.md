# AI Video Generator MVP

一个零依赖 Node + FFmpeg MVP：用户输入文字、选择风格模板，后台拆分镜、生成分镜图片、每张 3 秒合成 MP4，前台轮询进度并播放成片。

## 运行

```bash
npm start
```

然后打开：

```text
http://localhost:5174
```

## 部署

这是一个普通 Node Web 服务，需要 FFmpeg。Render 可直接使用 `render.yaml` 创建 Web Service，并挂载持久磁盘保存 `storage/`。

生产环境建议：

```text
PORT=5174
```

API Key 不要写进 Git。部署后进入 `/admin.html` 填写 image2 和阿里百炼 DashScope Key。

## 当前实现范围

- 文本输入
- 风格模板选择
- 本地启发式分镜拆分
- FFmpeg 生成统一画风的 PNG 分镜图
- FFmpeg 合成 MP4
- 任务 ID、FIFO 队列、异步处理、进度轮询
- 每一步进度落盘到 `storage/{jobId}/job.json`
- 后台任务中心：`/admin.html`
- 后台可配置大模型、图片模型、TTS 模型和提示词模块
- 后台可配置短视频内容模块，例如国学、毛选、AI 商业；前台按当前模块展示默认内容，并在分镜提示词中注入模块逻辑
- 后台可上传已授权声音样本，创建 TTS 克隆音色并设为默认音色
- 已接入 `image2` 生图适配器，生成分镜图时优先调用 image2，失败可回退本地图
- 已接入阿里百炼 DashScope TTS 适配器，支持 Qwen 声音复刻和 TTS 配音，失败可回退本地预览音轨
- 完成后在线播放和下载

## 后端接口

```text
GET  /api/health
GET  /api/templates
GET  /api/content-module
POST /api/jobs
GET  /api/jobs/{jobId}
GET  /api/jobs
GET  /api/admin/queue
GET  /api/admin/settings
PUT  /api/admin/models
POST /api/admin/models/test
PUT  /api/admin/prompts
PUT  /api/admin/content-modules
PUT  /api/admin/voices/default
POST /api/admin/voices/clone
```

`POST /api/jobs` 请求体：

```json
{
  "text": "要生成视频的文字",
  "templateId": "tech",
  "contentModuleId": "ai_business"
}
```

`POST /api/admin/voices/clone` 使用 `multipart/form-data`：

```text
name=音色名称
authorized=true
sample=@voice.wav
```

## 后续可替换模块

- `src/storyboard.js`：替换为大模型分镜 JSON 输出
- `src/llm.js`：OpenAI-compatible 大模型分镜适配器，失败时回退到本地分镜
- `src/image-generator.js`：本地占位图和 image2 生图路由
- `src/image2.js`：image2 图片生成适配器，输出统一规整为 1280x720
- `src/video-composer.js`：扩展旁白、字幕文件、转场、配乐
- `src/settings.js`：替换为数据库配置、密钥管理和多租户后台
- `src/tts.js`：TTS 路由和本地回退
- `src/aliyun-tts.js`：阿里百炼声音复刻和非实时 TTS 调用
- `src/storage.js`：替换为 S3、OSS、COS 等对象存储
