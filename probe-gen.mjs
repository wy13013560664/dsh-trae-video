import fs from 'node:fs'
import { loadAccounts, createAccountPool } from './src/accounts.js'
import { soloHeaders } from './src/credential.js'
import { TRAE, PATHS, VIDEO_MODEL } from './src/constants.js'
const ref = process.argv[2] || 'TRAE_ACCOUNT_F0273C7A'
const accounts = await loadAccounts()
const acc = accounts.find(a => a.ref === ref)
console.log('use', acc.ref, acc.uid)
const t0 = Date.now()
const res = await fetch(`${TRAE.agentHost}${PATHS.textToVideoStream}`, {
  method:'POST', headers: soloHeaders(acc,{stream:true}),
  body: JSON.stringify({ model: VIDEO_MODEL, prompt:'雨夜霓虹街道，镜头缓推，电影感', ratio:'9:16', resolution:'720p', duration:5 }),
})
console.log('submit', res.status)
const reader = res.body.getReader(); const dec = new TextDecoder(); let buf=''
let uri
const deadline = Date.now() + 600000
while (Date.now() < deadline) {
  const { value, done } = await reader.read(); if (done) break
  buf += dec.decode(value, { stream: true })
  const frames = buf.split(/\r?\n\r?\n/); buf = frames.pop() ?? ''
  for (const f of frames) {
    const ev = {}; for (const line of f.split(/\r?\n/)) {
      if (line.startsWith('event:')) ev.event = line.slice(6).trim()
      else if (line.startsWith('data:')) ev.data = line.slice(5).trim()
    }
    if (!ev.data) continue
    let d; try { d = JSON.parse(ev.data) } catch { d = ev.data }
    if (ev.event === 'heartbeat') { console.log('hb', Math.floor((Date.now()-t0)/1000)+'s'); continue }
    console.log('EVT', ev.event, JSON.stringify(d).slice(0,300))
    if (ev.event === 'result' && d?.uri) uri = d.uri
    if (ev.event === 'error') { console.log('FAILED'); process.exit(1) }
    if (ev.event === 'done') break
  }
  if (uri) break
}
if (!uri) { console.log('no uri'); process.exit(1) }
const r2 = await fetch(`${TRAE.agentHost}${PATHS.getResourceUrl}`, { method:'POST', headers: soloHeaders(acc,{stream:false}), body: JSON.stringify({ uri_list:[uri] }) })
const j = await r2.json()
const url = j.url_map?.[uri]
console.log('dl url', url?.slice(0,120))
const dl = await fetch(url)
const buf2 = Buffer.from(await dl.arrayBuffer())
const out = `/tmp/trae-gen-${Date.now()}.mp4`
fs.writeFileSync(out, buf2)
console.log('OK', out, buf2.length, 'bytes', Math.floor((Date.now()-t0)/1000)+'s')
process.exit(0)
