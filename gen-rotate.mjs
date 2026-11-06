#!/usr/bin/env node
/**
 * 多账号轮换生成器：提交 → SSE 收结果 → 换签名 URL → 落盘。
 * 遇到 4040/4008/3003 之类错误自动换下一个账号重试。
 *
 * 用法: node gen-rotate.mjs "<prompt>" [--ratio 9:16] [--resolution 720p] [--duration 5] [--out /path/a.mp4] [--max-accounts N]
 */
import fs from 'node:fs'
import path from 'node:path'
import { loadAccounts } from './src/accounts.js'
import { soloHeaders } from './src/credential.js'
import { consumeSse, extractVideoUri, extractLastFrameUri, resolveResourceUrls } from './src/video.js'
import { normalizeParams } from './src/validate.js'
import { buildRequestBody } from './src/video.js'
import { TRAE, PATHS, MAX_VIDEO_BYTES } from './src/constants.js'

function parseArgs(argv) {
  const args = { _: [], flags: {} }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a.startsWith('--')) {
      const key = a.slice(2)
      const next = argv[i + 1]
      if (next !== undefined && !next.startsWith('--')) { args.flags[key] = next; i++ }
      else args.flags[key] = true
    } else args._.push(a)
  }
  return args
}

const args = parseArgs(process.argv.slice(2))
const prompt = args._.join(' ') || (args.flags.prompt ? String(args.flags.prompt) : '')
if (!prompt) { console.error('need prompt'); process.exit(1) }

const params = normalizeParams({
  prompt,
  ratio: args.flags.ratio,
  resolution: args.flags.resolution,
  duration: args.flags.duration !== undefined ? Number(args.flags.duration) : 5,
})
const body = buildRequestBody(params)
const outPath = path.resolve(args.flags.out || `trae-${Date.now()}.mp4`)
const maxAccounts = Number(args.flags['max-accounts'] || 32)

const accounts = await loadAccounts()
console.log(`账号池 ${accounts.length} 个 | ${body.resolution}/${body.ratio}/${body.duration}s`)

let attempts = 0
for (const acc of accounts) {
  if (attempts >= maxAccounts) break
  attempts++
  const t0 = Date.now()
  process.stdout.write(`\n[${attempts}] ${acc.uid} ... `)
  try {
    const res = await fetch(`${TRAE.agentHost}${PATHS.textToVideoStream}`, {
      method: 'POST', headers: soloHeaders(acc, { stream: true }), body: JSON.stringify(body),
    })
    if (!res.ok) { console.log(`HTTP ${res.status}`); continue }

    let uri, lastFrame, videoDuration, hb = 0
    for await (const frame of consumeSse(res)) {
      if (frame.event === 'heartbeat') {
        hb++
        if (hb % 20 === 1) process.stdout.write(`.${Math.floor((Date.now() - t0) / 1000)}s`)
        continue
      }
      if (frame.event === 'result') {
        uri = extractVideoUri(frame) ?? uri
        lastFrame = extractLastFrameUri(frame) ?? lastFrame
        videoDuration = frame.data?.video_duration ?? videoDuration
        process.stdout.write(` [result ${videoDuration}s]`)
        continue
      }
      if (frame.event === 'done') break
      if (frame.event === 'error') {
        const msg = String(frame.data?.message ?? JSON.stringify(frame.data))
        if (/quota|4040|4008|3003/i.test(msg)) { console.log(` ✗ ${msg.slice(0, 120)}`); break }
        throw new Error(msg.slice(0, 500))
      }
    }
    if (!uri) { console.log(' ✗ no uri'); continue }

    const urlMap = await resolveResourceUrls(acc, [uri], { host: TRAE.agentHost })
    const dl = urlMap[uri]
    if (!dl) { console.log(' ✗ no download url'); continue }
    const r = await fetch(dl)
    const buf = Buffer.from(await r.arrayBuffer())
    if (buf.length > MAX_VIDEO_BYTES) { console.log(' ✗ >100MiB'); continue }
    await fs.promises.mkdir(path.dirname(outPath), { recursive: true })
    await fs.promises.writeFile(outPath, buf)
    console.log(`\n✅ ${outPath} (${buf.length} bytes, ${Math.floor((Date.now() - t0) / 1000)}s) uri=${uri}`)
    if (lastFrame) console.log(`last_frame=${lastFrame}`)
    process.exit(0)
  } catch (e) {
    console.log(` ✗ ${e.message.slice(0, 200)}`)
  }
}
console.error('\n❌ 所有尝试账号都失败')
process.exit(2)
