# dsh-trae-video 安装指南（跨设备）

打包产物：**`dsh-trae-video-0.2.0.tgz`**（30 KB，15 文件）

## 前置依赖

1. **DeepSeek Harness ≥ 0.2.0-rc.2**（含 `dsh plugin` 命令 / 桌面端）
2. **dsh-our-free-model** —— 提供免费 Trae 账号（本插件出片的凭据）
3. Node.js `^22.19.0 || >=24.0.0`

> 本插件**不依赖** `dsh-plugin-ai-drama` 或 `dsh-drama-trae`，可完全独立安装使用。

## 方式 A：`dsh plugin add`（推荐）

```bash
dsh plugin --profile desktop add ./dsh-trae-video-0.2.0.tgz
# 重启 DSH，侧栏出现「AI 视频生成」
```

## 方式 B：手动 link

```bash
tar -xzf dsh-trae-video-0.2.0.tgz -C ~/Documents/deepseek-harness/default-workspace/
mv ~/Documents/deepseek-harness/default-workspace/package ~/Documents/deepseek-harness/default-workspace/dsh-trae-video

# 在 ~/.dsh/profiles/desktop/package.json 里：
#   1) dependencies:  "dsh-trae-video": "link:<绝对路径>"
#   2) dsh.profile.bundles 数组加 "dsh-trae-video"

cd ~/.dsh/profiles/desktop && pnpm install
```

## 方式 C：仅 CLI（无需 DSH）

```bash
npm install -g ./dsh-trae-video-0.2.0.tgz
trae-video --prompt "雨夜霓虹街道，女主背影，电影感" --ratio 9:16 --duration 5
```

## 四种模式

| 模式 | 说明 | 素材来源 |
|---|---|---|
| `t2v` 文生视频 | prompt → mp4 | 纯文本 |
| `i2v` 图生视频 | 首帧锁定 + prompt | **本地图片**（自动上传）/ t2i 生成图 |
| `v2v` 视频续写 | 已有视频续写 | TOS key |
| `t2i` 文生图 | prompt → 图片 | 纯文本 |

### 图生视频（i2v）的正确链路

界面里选「图生视频」→ 选本地图片 → 自动上传（`biz_type=image` 落图像桶）→ 用同一账号出片。

**注意**：真实人像照片会被 Ark 内容审核拒绝（`InputImageSensitiveContentDetected.PrivacyInformation`），建议用插画、风景、AI 生成图。

## 关键协议（逆向实测，2026-11-04 抓包确认）

| 环节 | 要点 |
|---|---|
| 上传凭证 | `POST /api/ide/v1/get_resource_upload_url` body `{targets:[裸文件名], biz_type:'image'}`；`targets` **只传裸文件名**，服务端自动补 `cn/{uid}/image/` |
| PUT 上传 | `Authorization: {accessKey}:version:v2:{jwt}` + `Content-CRC32: {crc32 小写hex}`；**不要手动设 Content-Length**；成功返回 200 + `{success:0, payload:{hash,key}}` |
| 桶归属 | `biz_type=image` → `zaeny81f73`（i2v 只认它）；`video` → `av28lk49dz`；不传 → `3hx2o39pc4`（会报 invalid userid） |
| 账号绑定 | key 内含上传账号 uid，**上传与出片必须同账号**，跨账号报 invalid userid |
| 生成 | `POST /api/ide/v1/tool_text_to_video_stream`，SSE 三帧 heartbeat → result → done |
| 下载 | `POST /api/ide/v1/get_resource_url` body `{uri_list:[key]}` → `url_map` |

## 验证安装

```bash
# 1. 检查账号池
node cli.mjs --list-accounts

# 2. 文生视频
node cli.mjs --prompt "雨夜霓虹街道，电影感" --ratio 9:16 --duration 5

# 3. 图生视频（本地图片）
node cli.mjs --image /path/to/photo.jpg --prompt "镜头缓缓推进" --ratio 9:16
```

## 已知边界

- 免费账号 Seedance 视频配额会整体耗尽（`4008`/`4040`），此时轮遍全池仍失败
- t2i 配额与 t2v 配额相互独立
- 真实人像图片会被内容审核拦截（合规限制，非技术问题）
- Trae 私有协议无公开文档，字段名靠二进制逆向 + 抓包实测得出

---

## 视频延伸 / 续写（v2v）—— v0.2.0 实测通过

界面「视频续写」模式 → 选本地 mp4（自动上传）→ 填提示词 → 生成。

**与 i2v 的关键差异**：

| 项 | i2v 图生视频 | v2v 视频延伸 |
|---|---|---|
| `biz_type` | `image` | **`video`** |
| 落的桶 | `zaeny81f73/image/` | **`av28lk49dz/video/`** |
| 请求字段 | `image_paths` | **`video_paths`** |
| 额外参数 | — | **`total_input_video_duration_ms`**（输入视频时长，ms） |
| 数量上限 | 9 张 | **3 个** |
| 大小上限 | 单图 10 MiB / 总 100 MiB | **单个 100 MiB** |

实测记录（2026-11-04）：本地 mp4（1.92MB）→ 上传（视频桶）→ 同账号 v2v → 输出 2.11MB / 5s MP4。

CLI 用法：

```bash
# 本地视频直接续写
node cli.mjs --video /path/source.mp4 --prompt "延续镜头，画面继续推进" --duration 5

# 或用已有 TOS key
node cli.mjs --video-key tos-cn-i-av28lk49dz/cn/<uid>/video/xxx_mp4 --prompt "继续推进"
```

**注意**：v2v 输出的是**续写的新片段**，不是把原视频变长。要拼接需要用 ffmpeg 合流。
