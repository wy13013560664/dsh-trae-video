import fs from 'node:fs'
import { loadAccounts } from './src/accounts.js'
import { withAccountRotation } from './src/rotate.js'
import { generateImage } from './src/image.js'
import { generateVideo } from './src/video.js'

const accounts = await loadAccounts()
const t0 = Date.now()
// 1) t2i 出参考图（带轮换）
const img = await withAccountRotation({
  accounts,
  run: (cred) => generateImage(cred, { prompt: '雨夜霓虹街道，一位撑伞的女子背影' }, {}),
  onRetry: ({ ref, kind }) => console.log(`t2i 换号 ${ref} (${kind})`),
})
console.log('t2i uri:', img.result.uri, Math.floor((Date.now()-t0)/1000)+'s')

// 2) i2v 出片（带轮换）
const vid = await withAccountRotation({
  accounts,
  run: (cred) => generateVideo({
    credential: cred,
    params: { prompt: '镜头缓缓推进，雨滴落下，女子转身', ratio: '9:16', resolution: '480p', duration: 5, image_paths: [img.result.uri] },
    localPath: '/tmp/trae-i2v.mp4',
    onProgress: (s) => { if (s === 'result') console.log('i2v result 帧') },
  }),
  onRetry: ({ ref, kind }) => console.log(`i2v 换号 ${ref} (${kind})`),
})
console.log('i2v OK', vid.result.path, vid.result.bytes, Math.floor((Date.now()-t0)/1000)+'s')
process.exit(0)
