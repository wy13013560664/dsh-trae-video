/**
 * dsh-trae-video —— 插件入口（Host 半身）。
 *
 * 复刻 TRAE CN 的 AI 视频生成：复用 our-free-model 的 Trae 账号凭据，
 * 走 api/ide/v1/tool_text_to_video_stream。
 *
 * 能力面：generateVideo（t2v/i2v/v2v）+ generateImage（t2i）+ uploadLocalFile
 * 入口：commands（软访问）+ connection REST 路由（前端数据源）+ 进度 SSE
 *
 * 设计要点：零硬依赖（inject=[]），凭据走 ~/.dsh/.credentials.yaml 文件读取。
 * 协议全部端到端实测（见 recon/IMPLEMENTATION-NOTES.md）。
 * @module index.js
 */

import crypto from 'node:crypto'
import { TRAE, STAGES } from './src/constants.js'
import { soloHeaders, refreshCredential, parseCredential } from './src/credential.js'
import { buildRequestBody, generateVideo, consumeSse, resolveResourceUrls } from './src/video.js'
import { loadAccounts, createAccountPool } from './src/accounts.js'
import { getUploadToken, uploadLocalFile, requestUploadCredential } from './src/upload.js'
import { generateImage } from './src/image.js'
import { createProgressHub } from './src/progress.js'

export const name = 'trae-video'

/** 零硬依赖：凭据走文件读取，commands/connection/webServer 软访问。 */
export const inject = []

export function apply(ctx, config) {
  const logger = ctx.logger ?? console
  const progress = createProgressHub({ logger })
  const jobs = new Map() // taskId -> { id, status, progress, result, error }

  function createJob() {
    const id = crypto.randomUUID()
    const job = { id, status: 'running', startedAt: Date.now(), finishedAt: null, progress: { stage: null }, result: null, error: null }
    jobs.set(id, job)
    return job
  }

  /**
   * 生成视频（t2v / i2v / v2v）。
   */
  /**
   * 判断错误是否属于「配额/限流」类，可轮换账号重试。
   */
  function isQuotaError(e) {
    const msg = String(e?.message || e || '')
    return /quota|exceeded|4008|4040|rate.?limit|429|insufficient|invalid userid/i.test(msg)
  }

  /**
   * 生成视频（t2v / i2v / v2v）。
   * 关键：多账号轮换——遇配额类错误自动换下一个账号，直到成功或轮遍全池。
   */
  async function gen(params) {
    const accounts = await loadAccounts()
    if (accounts.length === 0) {
      throw new Error('trae-video: 未找到 TRAE_ACCOUNT_* 凭据，请先在 our-free-model 里登录 TRAE')
    }
    const usable = accounts.filter(a => !isTraeExpired(a))
    if (usable.length === 0) {
      throw new Error('trae-video: 所有 TRAE 账号均已过期或冷却中')
    }

    const localPath = params.local_path ?? params.localPath ?? `trae-video-${Date.now()}.mp4`
    let lastError = null

    for (let i = 0; i < usable.length; i++) {
      const credential = usable[i]
      try {
        const result = await generateVideo({
          credential,
          params,
          localPath,
          onProgress: (stage, payload) => {
            logger.info(`[trae-video] ${stage}`, payload ?? {})
            progress.progress(stage, payload)
          },
        })
        progress.finish(true, { local_path: result.path, video_duration: result.video_duration, account_uid: credential.uid })
        return result
      } catch (e) {
        lastError = e
        if (isQuotaError(e)) {
          logger.info(`[trae-video] 账号 ${credential.uid} 配额不足，换下一个（${i + 1}/${usable.length}）`)
          continue
        }
        // 非配额错误（如提示词问题）不轮换，直接抛
        break
      }
    }
    progress.finish(false, { error: lastError?.message })
    throw lastError || new Error('trae-video: 所有账号均失败')
  }

  /**
   * 文生图（t2i），同样带账号轮换。
   */
  async function genImage(params) {
    const accounts = await loadAccounts()
    const usable = accounts.filter(a => !isTraeExpired(a))
    if (!usable.length) throw new Error('trae-video: 所有 TRAE 账号均已过期')
    let lastError = null
    for (let i = 0; i < usable.length; i++) {
      const credential = usable[i]
      try {
        const result = await generateImage(credential, params, {})
        return result
      } catch (e) {
        lastError = e
        if (isQuotaError(e)) { logger.info(`[trae-video] t2i 账号 ${credential.uid} 配额不足，换下一个`); continue }
        break
      }
    }
    throw lastError || new Error('trae-video: t2i 所有账号均失败')
  }

  /**
   * 图生视频（i2v）。三条素材来源，优先级：本地文件 > 已有 key > t2i 现生成。
   *
   * 【抓包实测 2026-11-04】本地图可直接做 i2v：上传时必须 `biz_type='image'`
   * （落 zaeny81f73 图像桶），key 内含上传账号 uid，故**上传与出片必须同账号**。
   */
  async function genI2v(params) {
    const localImage = params.local_image_path ?? params.localImagePath
    const providedKey = params.image_paths?.[0]

    if (providedKey) {
      // 已给出 key：直接用（调用方需确保该 key 与出片账号同属）
      return gen({ ...params, image_paths: [providedKey] })
    }

    if (localImage) {
      // 本地图片：先上传拿 key，再用同一账号出片
      const accounts = await loadAccounts()
      const usable = accounts.filter(a => !isTraeExpired(a))
      if (!usable.length) throw new Error('trae-video: 所有 TRAE 账号均已过期')
      let lastErr = null
      for (const credential of usable) {
        try {
          const up = await uploadLocalFile(credential, localImage, { biz_type: 'image' })
          logger.info(`[trae-video] 本地上传 → ${up.uri}`)
          // 同账号出片（关键：跨账号会 invalid userid）
          return await genWithCredential(credential, { ...params, image_paths: [up.uri] })
        } catch (e) {
          lastErr = e
          if (isQuotaError(e) || /invalid userid|sign image|upload/i.test(String(e.message))) {
            logger.info(`[trae-video] i2v 账号 ${credential.uid} 失败，换下一个`)
            continue
          }
          break
        }
      }
      throw lastErr ?? new Error('trae-video: i2v 所有账号均失败')
    }

    // 兜底：t2i 出参考图 → i2v
    const img = await genImage({ prompt: params.image_prompt || params.prompt })
    logger.info(`[trae-video] t2i 参考图: ${img.uri}`)
    return gen({ ...params, image_paths: [img.uri] })
  }

  /**
   * 用指定账号生成视频（不做轮换，供 i2v 保持上传/出片同账号）。
   */
  async function genWithCredential(credential, params) {
    const localPath = params.local_path ?? params.localPath ?? `trae-video-${Date.now()}.mp4`
    try {
      const result = await generateVideo({
        credential,
        params,
        localPath,
        onProgress: (stage, payload) => {
          logger.info(`[trae-video] ${stage}`, payload ?? {})
          progress.progress(stage, payload)
        },
      })
      progress.finish(true, { local_path: result.path, video_duration: result.video_duration, account_uid: credential.uid })
      return result
    } catch (e) {
      progress.finish(false, { error: e.message })
      throw e
    }
  }

  // commands 软注册
  ctx.inject(['commands'], (scoped) => {
    scoped.commands?.register?.({
      id: 'trae-video.generate',
      name: 'trae-video-generate',
      description: 'TRAE 视频生成（prompt → mp4）',
      run: async (args = {}) => {
        const { prompt, local_path, resolution, ratio, duration, image_paths, video_paths } = args
        if (!prompt) return { ok: false, error: 'prompt is required' }
        return gen({ prompt, local_path, resolution, ratio, duration, image_paths, video_paths })
      },
    })
    logger.info?.('trae-video: command "trae-video.generate" registered')
  })

  // connection REST 路由（前端界面数据源）
  ctx.inject(['connection'], (scoped) => {
    const apiBase = '/api/trae-video'
    scoped.connection.fetch.register({
      path: `${apiBase}/accounts`,
      methods: ['POST'],
      requestBody: 'buffered',
      async fetch() {
        try {
          const accounts = await loadAccounts()
          const list = accounts.map(a => ({
            ref: a.ref, uid: a.uid, phone: a.phone || a.nickname || '',
            expired: isTraeExpired(a),
          }))
          return Response.json({ ok: true, accounts: list, total: list.length })
        } catch (e) {
          return Response.json({ ok: false, error: e.message }, { status: 400 })
        }
      },
    })
    scoped.connection.fetch.register({
      path: `${apiBase}/generate`,
      methods: ['POST'],
      requestBody: 'buffered',
      async fetch(request) {
        const input = await readJson(request)
        const job = createJob()

        // mode 分发（gen/genImage/genI2v 内部都带账号轮换）
        let task
        if (input.mode === 't2i') {
          task = genImage({ prompt: input.prompt })
        } else if (input.mode === 'i2v') {
          task = genI2v({
            prompt: input.prompt,
            image_prompt: input.image_prompt,
            image_paths: input.image_paths,          // 已有 key
            local_image_path: input.local_image_path, // 本地图片路径（转发到 /upload 后再出片时用 key）
            resolution: input.resolution,
            ratio: input.ratio,
            duration: input.duration,
          })
        } else if (input.mode === 'v2v') {
          task = gen({
            prompt: input.prompt,
            resolution: input.resolution,
            ratio: input.ratio,
            duration: input.duration,
            video_paths: input.video_paths,
            // 视频续写需要告知输入视频总时长；未给时按常见 5s
            total_input_video_duration_ms: input.total_input_video_duration_ms ?? 5000,
          })
        } else {
          task = gen({ prompt: input.prompt, resolution: input.resolution, ratio: input.ratio, duration: input.duration })
        }

        task.then(result => {
          job.status = 'done'; job.finishedAt = Date.now(); job.result = result
        }).catch(e => {
          job.status = 'failed'; job.finishedAt = Date.now(); job.error = e.message
        })
        return Response.json({ ok: true, taskId: job.id })
      },
    })
    // 本地文件上传：base64 → 临时文件 → TOS key（供 i2v/v2v 素材）
    // 返回 uid：key 内含上传账号 uid，前端出片时必须用同一账号，否则 invalid userid
    scoped.connection.fetch.register({
      path: `${apiBase}/upload`,
      methods: ['POST'],
      requestBody: 'buffered',
      async fetch(request) {
        const { name, data: b64, biz_type } = await readJson(request)
        try {
          if (!name || !b64) return Response.json({ ok: false, error: '缺少 name/data(文件 base64)' }, { status: 400 })
          const fs = await import('node:fs/promises')
          const os = await import('node:os')
          const path = await import('node:path')
          const tmp = path.join(os.tmpdir(), `trae-upload-${Date.now()}-${name}`)
          await fs.writeFile(tmp, Buffer.from(b64, 'base64'))
          const accounts = await loadAccounts()
          const usable = accounts.filter(a => !isTraeExpired(a))
          if (!usable.length) throw new Error('所有 Trae 账号已过期')
          const credential = usable[0]
          const up = await uploadLocalFile(credential, tmp, {
            biz_type: biz_type ?? 'image',
          })
          await fs.unlink(tmp).catch(() => {})
          return Response.json({ ok: true, uri: up.uri, uid: credential.uid })
        } catch (e) {
          return Response.json({ ok: false, error: e.message }, { status: 400 })
        }
      },
    })
    scoped.connection.fetch.register({
      path: `${apiBase}/status`,
      methods: ['POST'],
      requestBody: 'buffered',
      async fetch(request) {
        const { taskId } = await readJson(request)
        const job = jobs.get(taskId)
        if (!job) return Response.json({ ok: false, error: '任务不存在' }, { status: 404 })
        return Response.json({ ok: true, job })
      },
    })
    // 产物列表（供前端展示已生成视频）
    scoped.connection.fetch.register({
      path: `${apiBase}/artifacts`,
      methods: ['POST'],
      requestBody: 'buffered',
      async fetch(request) {
        const { dir } = await readJson(request)
        try {
          const fs = await import('node:fs/promises')
          const path = await import('node:path')
          const list = dir ? await fs.readdir(dir).catch(() => []) : []
          const videos = list.filter(f => /\.(mp4|mov)$/i.test(f)).map(f => path.join(dir, f))
          return Response.json({ ok: true, artifacts: videos, dir })
        } catch (e) {
          return Response.json({ ok: false, error: e.message }, { status: 400 })
        }
      },
    })
    // 系统打开产物
    scoped.connection.fetch.register({
      path: `${apiBase}/open`,
      methods: ['POST'],
      requestBody: 'buffered',
      async fetch(request) {
        const { filePath } = await readJson(request)
        try {
          const fs = await import('node:fs/promises')
          await fs.access(filePath)
          const { spawn } = await import('node:child_process')
          const cmd = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'start' : 'xdg-open'
          const args = process.platform === 'win32' ? ['', filePath] : [filePath]
          spawn(cmd, args, { detached: true, stdio: 'ignore' }).unref()
          return Response.json({ ok: true })
        } catch (e) {
          return Response.json({ ok: false, error: e.message }, { status: 400 })
        }
      },
    })
    logger.info?.('trae-video: REST API mounted at /api/trae-video/*')
  })

  // 进度 SSE（webServer 软访问）
  ctx.inject(['webServer'], (scoped) => {
    const server = scoped.webServer
    scoped.effect(() => server.register({
      kind: 'exact',
      path: '/api/trae-video/progress',
      handler: (req, res) => progress.attach(req, res, progress.latest),
    }), 'trae-video: progress stream')
    logger.info?.('trae-video: progress SSE mounted at /api/trae-video/progress')
  })

  return {
    name,
    generateVideo: gen,
    generateImage,
    buildRequestBody,
    soloHeaders,
    refreshCredential,
    parseCredential,
    consumeSse,
    resolveResourceUrls,
    loadAccounts,
    createAccountPool,
    getUploadToken,
    requestUploadCredential,
    uploadLocalFile,
    progress,
    constants: { TRAE, STAGES },
  }
}

function isTraeExpired(cred) {
  const exp = cred?.expires_at
  if (!exp) return false
  const n = Number(exp)
  if (Number.isNaN(n)) return false
  return Date.now() >= (n > 1e12 ? n : n * 1e3)
}

async function readJson(request) {
  try { return await request.json() } catch { return {} }
}