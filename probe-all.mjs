import { loadAccounts } from './src/accounts.js'
import { soloHeaders } from './src/credential.js'
import { TRAE, PATHS, VIDEO_MODEL } from './src/constants.js'
const accounts = await loadAccounts()
const out = []
for (const acc of accounts) {
  try {
    const res = await fetch(`${TRAE.agentHost}${PATHS.textToVideoStream}`, {
      method:'POST', headers: soloHeaders(acc,{stream:true}),
      body: JSON.stringify({ model: VIDEO_MODEL, prompt: 'a cat' }),
    })
    if (!res.ok) { out.push([acc.ref, 'HTTP'+res.status]); continue }
    const reader = res.body.getReader()
    let seen=''
    const deadline = Date.now()+4000
    while (Date.now() < deadline) {
      const { value, done } = await reader.read(); if (done) break
      seen += new TextDecoder().decode(value)
      if (/event:\s*(error|result|done)/.test(seen)) break
    }
    await reader.cancel().catch(()=>{})
    const code = /code\\\\?":?(\d+)/.exec(seen)?.[0] ?? (/event: error/.test(seen) ? 'error' : seen ? 'streaming' : 'empty')
    out.push([acc.ref, code])
  } catch(e) { out.push([acc.ref, 'ERR:'+e.message.slice(0,40)]) }
}
for (const [r,c] of out) console.log(r, c)
console.log('---- 总结 ----')
const ok = out.filter(([,c])=>!String(c).includes('4008') && !String(c).includes('error'))
console.log('可用账号', ok.length, '/', out.length)
process.exit(0)
