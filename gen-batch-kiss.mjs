#!/usr/bin/env node
/**
 * 批量变体生成：顺序跑多条 prompt，每条内部多账号轮换（复用 gen-rotate.mjs 的逻辑）。
 */
import { spawn } from 'node:child_process'

const jobs = [
  {
    prompt: '两位年轻美女面部特写，嘴唇已经贴在一起深情接吻，轻柔闭眼，柔光暖调，浅景深电影质感，镜头缓慢环绕',
    out: 'kiss-lip-lock.mp4',
    ratio: '9:16', resolution: '720p', duration: '5',
  },
  {
    prompt: '雨夜落地窗前，两位美女相拥接吻，霓虹灯光映在侧脸，雨水沿玻璃流下，浪漫电影感，浅景深',
    out: 'kiss-rain.mp4',
    ratio: '9:16', resolution: '720p', duration: '5',
  },
  {
    prompt: '日落海边，两位年轻美女额头相抵后缓缓靠近接吻，海风吹动长发，金色逆光，唯美浪漫，电影级画面',
    out: 'kiss-sunset.mp4',
    ratio: '9:16', resolution: '720p', duration: '5',
  },
]

for (const j of jobs) {
  console.log(`\n===== ${j.out} =====`)
  await new Promise((resolve) => {
    const p = spawn(process.execPath, [
      'gen-rotate.mjs', j.prompt,
      '--ratio', j.ratio, '--resolution', j.resolution, '--duration', j.duration,
      '--out', `/Users/wangyuan/Documents/wangguan/out/${j.out}`,
    ], { stdio: 'inherit', cwd: import.meta.dirname })
    p.on('exit', (code) => { console.log(`-> ${j.out} exit ${code}`); resolve() })
  })
}
console.log('\n全部完成')
