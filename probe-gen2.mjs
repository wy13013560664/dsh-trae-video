import fs from 'node:fs'
import { loadAccounts } from './src/accounts.js'
import { soloHeaders } from './src/credential.js'
import { TRAE, PATHS } from './src/constants.js'

const refs = process.argv.slice(2)
const accounts = await loadAccounts()

async function run(ref) {
  const acc = accounts.find(a => a.ref === ref)
  const t0 = Date.now()
  const res = await fetch(`${TRAE.agentHost}${PATHS.textToVideoStream}`, {
    method:'POST', headers: soloHeaders(acc,{stream:true}),
    body: JSON.stringify({ model:'seedance2-fast', prompt:'橙猫在雪地奔跑，电影感', ratio:'9:16', resolution:'480p', duration:5 }),
  })
  if (!res.ok) return console.log(ref, 'HTTP', res.status)
  const reader = res.body.getReader(); const dec=new TextDecoder(); let buf=''
  let uri, last=''
  while (true) {
    const { value, done } = await reader.read(); if (done) break
    buf += dec.decode(value,{stream:true})
    const frames = buf.split(/\r?\n\r?\n/); buf = frames.pop() ?? ''
    for (const f of frames) {
      const ev={}; for (const l of f.split(/\r?\n/)) { if(l.startsWith('event:')) ev.event=l.slice(6).trim(); else if(l.startsWith('data:')) ev.data=l.slice(5).trim() }
      if(!ev.data) continue
      let d; try{d=JSON.parse(ev.data)}catch{d=ev.data}
      if (ev.event==='heartbeat') { last = Math.floor((Date.now()-t0)/1000); continue }
      console.log(ref, 'EVT', ev.event, JSON.stringify(d).slice(0,220), Math.floor((Date.now()-t0)/1000)+'s')
      if (ev.event==='result' && d?.uri) uri = d.uri
      if (ev.event==='error' || ev.event==='gateway-error') return console.log(ref, 'FAILED at', Math.floor((Date.now()-t0)/1000)+'s')
      if (ev.event==='done') break
    }
    if (uri) break
  }
  if (!uri) return console.log(ref, 'no uri, last hb', last+'s')
  const r2 = await fetch(`${TRAE.agentHost}${PATHS.getResourceUrl}`, { method:'POST', headers: soloHeaders(acc,{stream:false}), body: JSON.stringify({ uri_list:[uri] }) })
  const j = await r2.json(); const url = j.url_map?.[uri]
  const dl = await fetch(url); const b = Buffer.from(await dl.arrayBuffer())
  const out = `/tmp/trae2-${ref.slice(-8)}-${Date.now()}.mp4`
  fs.writeFileSync(out,b)
  console.log(ref, '✅', out, b.length, Math.floor((Date.now()-t0)/1000)+'s')
}

await Promise.all(refs.map(run))
process.exit(0)
