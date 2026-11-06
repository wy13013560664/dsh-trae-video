/**
 * 图生视频单次实测脚本：同账号上传 + 出片，账号轮换保证 key 归属一致。
 */
import fs from 'node:fs'
import { loadAccounts } from './src/accounts.js'
import { uploadLocalFile } from './src/upload.js'
import { generateVideo } from './src/video.js'

const IMG = '/tmp/user-input-img.jpg'
const isQuota = (e) => /quota|exceeded|4008|4040/i.test(String(e?.message || e))

const accounts = await loadAccounts()
console.log(`账号池 ${accounts.length} 个，图片 ${IMG}`)

const touched = new Set()
let lastErr = null

for (const cred of accounts) {
  if (touched.has(cred.uid)) continue
  touched.add(cred.uid)
  try {
    // ① 先用这个账号上传（biz_type=image → zaeny81f73 桶）
    const up = await uploadLocalFile(cred, IMG, { filename: `i2v-${cred.uid}.jpg`, biz_type: 'image' })
    console.log(`[${cred.uid}] 上传成功 → ${up.uri}`)

    // ② 同一个账号立刻出片（key 归属一致）
    const t0 = Date.now()
    const v = await generateVideo({
      credential: cred,
      params: {
        prompt: '她缓缓转头看向镜头，长发随风轻扬，眼神温柔，电影质感光影，缓慢推镜',
        image_paths: [up.uri],
        ratio: '16:9',
        resolution: '720p',
        duration: 5,
      },
      localPath: '/tmp/i2v-result.mp4',
    })
    console.log(`\n🎉 图生视频成功！账号 ${cred.uid}，耗时 ${Math.round((Date.now() - t0) / 1000)}s`)
    console.log(`   产物: ${v.path} (${v.video_duration}s)`)
    process.exit(0)
  } catch (e) {
    lastErr = e
    const msg = String(e.message || '')
    if (isQuota(e)) {
      console.log(`[${cred.uid}] 视频配额不足，换账号`)
      continue
    }
    console.log(`[${cred.uid}] 其他错误: ${msg.slice(0, 160)}`)
  }
}

console.log(`\n全部账号失败。最后一次错误：${lastErr?.message?.slice(0, 200)}`)
