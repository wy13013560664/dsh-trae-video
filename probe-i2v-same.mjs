import { loadAccounts } from './src/accounts.js'
import { withAccountRotation } from './src/rotate.js'
import { generateImage } from './src/image.js'
import { generateVideo } from './src/video.js'

const accounts = await loadAccounts()
const t0 = Date.now()
// 同一账号：t2i → i2v 全用 cred
const out = await withAccountRotation({
  accounts,
  run: async (cred) => {
    const img = await generateImage(cred, { prompt: '雨夜霓虹街道，一位撑伞的女子背影' }, {})
    console.log('t2i', cred.ref, img.uri, Math.floor((Date.now()-t0)/1000)+'s')
    const vid = await generateVideo({
      credential: cred,
      params: { prompt: '镜头缓缓推进，雨滴落下，女子转身', ratio: '9:16', resolution: '480p', duration: 5, image_paths: [img.uri] },
      localPath: '/tmp/trae-i2v-same.mp4',
    })
    return vid
  },
  onRetry: ({ ref, kind, error }) => console.log(`换号 ${ref} (${kind}) ${error.message.slice(0,80)}`),
})
console.log('i2v OK', out.result.path, out.result.bytes, 'attempts', out.attempts, Math.floor((Date.now()-t0)/1000)+'s')
process.exit(0)
