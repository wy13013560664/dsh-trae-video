import fs from 'node:fs'
import { loadAccounts } from './src/accounts.js'
import { soloHeaders } from './src/credential.js'
import { TRAE, PATHS } from './src/constants.js'
const accounts = await loadAccounts()
const ref = process.argv[2]
const acc = accounts.find(a=>a.ref===ref)
const t0 = Date.now()
const res = await fetch(`${TRAE.agentHost}${PATHS.textToVideoStream}`, { method:'POST', headers: soloHeaders(acc,{stream:true}),
  body: JSON.stringify({ model:'seedance2-fast', prompt:'雨夜霓虹街道，镜头缓缓推进，电影感竖屏', ratio:'9:16', resolution:'720p', duration:5 }) })
console.log('submit', res.status)
const reader = res.body.getReader(); const dec=new TextDecoder(); let buf=''
let uri
while(true){
  const {value,done}=await reader.read(); if(done) break
  buf += dec.decode(value,{stream:true})
  const frames=buf.split(/\r?\n\r?\n/); buf=frames.pop()??''
  for(const f of frames){ const ev={}; for(const l of f.split(/\r?\n/)){ if(l.startsWith('event:')) ev.event=l.slice(6).trim(); else if(l.startsWith('data:')) ev.data=l.slice(5).trim() }
    if(!ev.data) continue; let d; try{d=JSON.parse(ev.data)}catch{d=ev.data}
    if(ev.event==='heartbeat') continue
    console.log('EVT', ev.event, JSON.stringify(d).slice(0,200), Math.floor((Date.now()-t0)/1000)+'s')
    if(ev.event==='result'&&d?.uri) uri=d.uri
    if(ev.event==='error'||ev.event==='gateway-error'){console.log('FAIL');process.exit(1)}
    if(ev.event==='done') break }
  if(uri) break }
if(!uri){console.log('no uri');process.exit(1)}
const r2=await fetch(`${TRAE.agentHost}${PATHS.getResourceUrl}`,{method:'POST',headers:soloHeaders(acc,{stream:false}),body:JSON.stringify({uri_list:[uri]})})
const j=await r2.json(); const url=j.url_map?.[uri]
const dl=await fetch(url); const b=Buffer.from(await dl.arrayBuffer())
const out=`/tmp/trae-720-${Date.now()}.mp4`; fs.writeFileSync(out,b)
console.log('OK', out, b.length, Math.floor((Date.now()-t0)/1000)+'s')
process.exit(0)
