#!/usr/bin/env node
/**
 * dsh-trae-video CLI —— 脱离 DSH 独立运行（协议已端到端实测）。
 *
 * 单条：
 *   node cli.mjs "一只橘猫在雪地里奔跑，电影感竖屏" --ratio 9:16 --out /tmp/cat.mp4
 *   node cli.mjs "..." --image-prompt "雨夜霓虹" --out /tmp/i2v.mp4          (图生视频)
 *   node cli.mjs "..." --video-key "tos-..." --video-duration-ms 5000        (视频续写)
 *
 * 批量：
 *   node cli.mjs --prompts "p1,p2,p3" --out-dir /tmp/videos                  (逗号分隔)
 *   node cli.mjs --batch /path/prompts.txt --out-dir /tmp/videos             (每行一条)
 *
 * 其它：
 *   node cli.mjs --list-accounts
 *
 * 依赖：~/.dsh/.credentials.yaml 里的 TRAE_ACCOUNT_*（our-free-model 登录后自动生成）。
 * @module cli.mjs
 */

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadAccounts, createAccountPool } from './src/accounts.js'
import { soloHeaders } from './src/credential.js'
import { buildRequestBody, consumeSse, extractVideoUri, extractLastFrameUri, resolveResourceUrls } from './src/video.js'
import { generateImage } from './src/image.js'
import { normalizeParams } from './src/validate.js'
import { TRAE, PATHS, VIDEO_MODEL, MAX_VIDEO_BYTES } from './src/constants.js'

const DIR = path.dirname(fileURLToPath(import.meta.url))

function parseArgs(argv) {
  const args = { _: [], flags: {} }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a.startsWith('--')) {
      const key = a.slice(2)
      const next = argv[i + 1]
      if (next !== undefined && !next.startsWith('--')) {
        args.flags[key] = next
        i++
      } else {
        args.flags[key] = true
      }
    } else {
      args._.push(a)
    }
  }
  return args
}

async function listAccounts() {
  const accounts = await loadAccounts()
  console.log(`共 ${accounts.length} 个 TRAE 账号：`)
  for (const a of accounts) {
    console.log(`  ${a.ref}  uid=${a.uid}  phone=${a.phone ?? '-'}  expires_at=${a.expires_at} ${isExpiredStr(a) ? '(已过期)' : ''}`)
  }
}

function isExpiredStr(cred) {
  const exp = cred?.expires_at
  if (!exp) return false
  const n = Number(exp)
  if (Number.isNaN(n)) return false
  return Date.now() >= (n > 1e12 ? n : n * 1e3)
}

/** 把 --prompts / --batch 解析成 prompt 列表。 */
function resolvePrompts(args) {
  const list = []
  const inline = args._.slice() // 位置参数全部视为 prompt
  // --prompts 逗号分隔
  if (args.flags.prompts) {
    list.push(...String(args.flags.prompts).split(',').map((s) => s.trim()).filter(Boolean))
  }
  // --batch 从文件读（每行一条，跳过空行与 # 注释）
  if (args.flags.batch) {
    const txt = fs.readFileSync(args.flags.batch, 'utf8')
    for (const line of txt.split(/\r?\n/)) {
      const s = line.trim()
      if (s && !s.startsWith('#')) list.push(s)
    }
  }
  if (inline.length > 0) list.push(...inline.filter((s) => s && !s.startsWith('-')))
  return list
}

/**
 * 生成单条视频，返回 { path, bytes, last_frame_uri }。
 * 不 process.exit，便于批量循环。
 */
async function generateOne(credential, prompt, args, idx, total) {
  const host = TRAE.agentHost
  const label = total > 1 ? `[${idx + 1}/${total}] ` : ''

  // 组装参数
  const raw = {
    prompt,
    ...(args.flags.ratio ? { ratio: args.flags.ratio } : {}),
    ...(args.flags.resolution ? { resolution: args.flags.resolution } : {}),
    ...(args.flags.duration !== undefined ? { duration: Number(args.flags.duration) } : {}),
  }
  // 图生视频
  if (args.flags['image-prompt']) {
    console.log(`${label}文生图素材: ${args.flags['image-prompt']}`)
    const { uri } = await generateImage(credential, { prompt: args.flags['image-prompt'] }, { host })
    raw.image_paths = [uri]
    console.log(`${label}图 key: ${uri}`)
  }
  if (args.flags['image-key']) raw.image_paths = [args.flags['image-key']]
  // 视频续写
  if (args.flags['video-key']) {
    raw.video_paths = [args.flags['video-key']]
    if (args.flags['video-duration-ms'] !== undefined) {
      raw.total_input_video_duration_ms = Number(args.flags['video-duration-ms'])
    }
  }

  const normalized = normalizeParams(raw)
  const body = buildRequestBody(normalized)

  const outPath = args.flags.out
    ? (total > 1 ? `${args.flags.out}-${idx + 1}` : args.flags.out)
    : (args.flags['out-dir']
      ? path.join(args.flags['out-dir'], `trae-${Date.now()}-${idx + 1}.mp4`)
      : path.join(DIR, `trae-${Date.now()}.mp4`))

  console.log(`${label}账号 uid=${credential.uid} phone=${credential.phone ?? '-'}`)
  console.log(`${label}提交: model=${VIDEO_MODEL} ${body.resolution}/${body.ratio}/${body.duration}s`)
  console.log(`${label}prompt: ${prompt}`)
  const t0 = Date.now()

  const res = await fetch(`${host}${PATHS.textToVideoStream}`, {
    method: 'POST',
    headers: soloHeaders(credential, { stream: true }),
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    const t = await res.text().catch(() => '')
    throw new Error(`提交失败 HTTP ${res.status}: ${t.slice(0, 400)}`)
  }

  let uri
  let lastFrameUri
  let videoDuration
  let sawHeartbeat = 0
  for await (const frame of consumeSse(res)) {
    if (frame.event === 'heartbeat') {
      sawHeartbeat++
      if (sawHeartbeat % 20 === 1) {
        const s = Math.floor((Date.now() - t0) / 1000)
        process.stdout.write(`\r${label}生成中... ${s}s`)
      }
      continue
    }
    if (frame.event === 'result') {
      uri = extractVideoUri(frame) ?? uri
      lastFrameUri = extractLastFrameUri(frame) ?? lastFrameUri
      videoDuration = frame.data?.video_duration ?? videoDuration
      process.stdout.write(`\n${label}✅ result ${videoDuration}s\n`)
      continue
    }
    if (frame.event === 'done') break
    if (frame.event === 'error' || frame.data?.code === 4008) {
      throw new Error(JSON.stringify(frame).slice(0, 300))
    }
  }
  if (!uri) throw new Error('未返回产物 URI')

  const urlMap = await resolveResourceUrls(credential, [uri], { host })
  const dlUrl = urlMap[uri]
  if (!dlUrl) throw new Error('url_map 缺少下载地址')
  const dl = await fetch(dlUrl)
  const buffer = Buffer.from(await dl.arrayBuffer())
  if (buffer.length > MAX_VIDEO_BYTES) throw new Error('超过 100 MiB 上限')

  const finalPath = /\.[a-z0-9]{2,5}$/i.test(outPath) ? outPath : `${outPath}.mp4`
  await fs.promises.mkdir(path.dirname(path.resolve(finalPath)), { recursive: true })
  await fs.promises.writeFile(finalPath, buffer)
  const elapsed = Math.floor((Date.now() - t0) / 1000)
  console.log(`\n${label}✅ 完成: ${finalPath} (${buffer.length} bytes, ${elapsed}s)`)
  return { path: finalPath, bytes: buffer.length, last_frame_uri: lastFrameUri, video_duration: videoDuration }
}

async function main() {
  const args = parseArgs(process.argv.slice(2))

  if (args.flags['list-accounts'] || args.flags['list']) {
    await listAccounts()
    return
  }

  const prompts = resolvePrompts(args)
  if (prompts.length === 0) {
    console.error('用法: node cli.mjs "<prompt>" [--ratio 9:16] [--out /path/out.mp4]')
    console.error('      node cli.mjs --prompts "p1,p2" --out-dir /tmp/videos')
    console.error('      node cli.mjs --batch list.txt --out-dir /tmp/videos')
    console.error('      node cli.mjs --list-accounts')
    process.exit(1)
  }

  const accounts = await loadAccounts()
  if (accounts.length === 0) {
    console.error('未找到 TRAE_ACCOUNT_* 凭据，请先在 our-free-model 里登录 TRAE')
    process.exit(1)
  }
  const pool = createAccountPool(accounts)
  const credential = pool.next(new Set())
  if (!credential) {
    console.error('所有 TRAE 账号均已过期或冷却中')
    process.exit(1)
  }

  const total = prompts.length
  const results = []
  for (let i = 0; i < total; i++) {
    try {
      results.push(await generateOne(credential, prompts[i], args, i, total))
    } catch (e) {
      console.error(`\n[${i + 1}/${total}] ❌ ${e.message}`)
      results.push({ error: e.message })
    }
  }
  const ok = results.filter((r) => r.path)
  const fail = results.filter((r) => r.error)
  console.log(`\n=== 批量完成: ${ok.length}/${total} 成功 ===`)
  for (const r of ok) console.log(`  ✅ ${r.path}`)
  for (const r of fail) console.log(`  ❌ ${r.error}`)
}

main().catch((e) => {
  console.error('[cli] 错误:', e.message)
  process.exit(1)
})