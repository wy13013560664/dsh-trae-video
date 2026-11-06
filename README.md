# dsh-trae-video —— TRAE CN 视频生成复刻插件（完整版）

复用 `dsh-our-free-model` 的 Trae 账号凭据，在 DSH 内 + 脱离 DSH 复现 TRAE 的 AI 视频生成。**协议已端到端实测跑通。**

## 状态

| 能力 | 状态 |
|---|---|
| 文生视频（t2v, seedance2-fast） | ✅ **端到端实测跑通**（两段真实视频已落地） |
| 文生图（t2i, seedream_5） | ✅ **实测跑通**（20 秒出图） |
| 图生视频（i2v） | ✅ **实测跑通**（t2i → image_paths → t2v，342 秒） |
| 视频续写（v2v） | ✅ **实测跑通**（video_urls → t2v，483 秒） |
| 多账号轮换 | ✅ 已完成（9 组账号自动选择/冷却） |
| 独立 CLI（单条 + 批量） | ✅ 已完成并跑通 |
| 参数校验 | ✅ 完成（枚举/范围/refs，对齐 tool Schema） |
| 下载地址解析（TOS→签名URL） | ✅ `uri_list` → `url_map` 实测坐实 |
| 进度推送 + 前端 SSE 路由 | ✅ 完成（`/api/trae-video/progress`） |
| ImageX 本地上传 | 🟡 90%（STS 全坐实；RPC 私有协议，非必需路径） |
| 前端进度 UI 组件 | ⏳ 后端已就绪，前端 React 组件待 DSH 插件内嵌 |

## 目录

```
index.js            # cordis 入口 + 能力面导出 + commands + 进度 SSE 路由
cli.mjs             # 独立 CLI（不依赖 DSH，协议 100% 实测，支持单条/批量）
src/constants.js    # 端点/模型/枚举常量
src/credential.js   # 凭据解析 + soloHeaders + 静默续期
src/accounts.js     # 多账号池（读 TRAE_ACCOUNT_*，轮换 + 冷却）
src/video.js        # buildRequestBody + SSE 消费 + 三阶段 generateVideo（t2v/i2v/v2v）
src/image.js        # 文生图（t2i, seedream_5）—— 图生视频上游
src/validate.js     # 参数校验（枚举/范围/refs 数量，对齐二进制 tool Schema）
src/progress.js     # 进度推送中心（SSE，前端进度条后端半边）
src/upload.js       # ImageX 素材上传（STS + sigv4 参考；非必需路径）
cordis.patch.yml    # 挂载点
package.json
```

## 快速开始

### 方式 A：独立 CLI（无需 DSH）

```bash
# 列出所有可用账号
node cli.mjs --list-accounts

# 文生视频（默认 720p / adaptive / 5s）
node cli.mjs "一只橘猫在雪地里奔跑，电影感竖屏" --ratio 9:16 --out /tmp/cat.mp4

# 指定参数
node cli.mjs "金毛犬沙滩奔跑夕阳逆光" --ratio 16:9 --resolution 1080p --duration 8 --out /tmp/dog.mp4

# 图生视频（--image-prompt 先文生图再动起来）
node cli.mjs "让画面动起来，镜头缓缓推进" --image-prompt "雨夜霓虹街道" --out /tmp/i2v.mp4

# 直接指定已有图的 TOS key 做图生视频
node cli.mjs "..." --image-key "tos-cn-i-.../gen_image/xxx_jpeg_1920x1920" --out /tmp/i2v.mp4

# 视频续写（--video-key 指定已有视频 TOS key）
node cli.mjs "延续这段街景，镜头转向街道尽头" --video-key "tos-cn-i-.../gen_video/xxx_mp4" --video-duration-ms 5000 --out /tmp/v2v.mp4

# 批量生成（逗号分隔）
node cli.mjs --prompts "猫,狗,鸟" --out-dir /tmp/videos --ratio 9:16

# 批量生成（从文件，每行一条）
node cli.mjs --batch /tmp/prompts.txt --out-dir /tmp/videos --duration 5
```

### 方式 B：装进 DSH 作为插件

通过 `ctx` 能力面调用：

```js
const { generateVideo } = pluginScope
await generateVideo({
  prompt: '雪地奔跑的猫',
  ratio: '9:16',
  resolution: '720p',
  duration: 5,
}, {
  localPath: '/tmp/out.mp4',
})
```

前端进度订阅（SSE）：

```js
const es = new EventSource('/api/trae-video/progress')
es.addEventListener('progress', (e) => {
  const { stage, payload } = JSON.parse(e.data)
  console.log(stage, payload) // preflight/submit/poll/result/download/write/done
})
```

## 实测协议速查（全部坐实）

```
认证:  Cloud-IDE-JWT <token> + X-Ide-Token + X-Uid + X-App-Id(6eefa01c-...)
生成:  POST /api/ide/v1/tool_text_to_video_stream
       body {model:"seedance2-fast", prompt, resolution?, ratio?, duration?, image_paths?, video_paths?}
       SSE: heartbeat{status} → result{uri,last_frame_url,video_duration} → done{finish_reason}
下载:  POST /api/ide/v1/get_resource_url  body {uri_list:[tos_key]}  →  url_map[tos_key]
上传:  POST /api/ide/v1/get_resource_upload_token  {}  →  STS ImageX 临时凭证
```

完整细节见 `../IMPLEMENTATION-NOTES.md` 与 `../trae-video-gen-analysis.md`。

## 合规

仅用于自有账号/授权测试环境；生成走 Trae `check_estimated_balance` 额度门；凭据来自本机 `~/.dsh/.credentials.yaml`，切勿泄露 token。