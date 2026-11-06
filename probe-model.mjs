import { loadAccounts } from './src/accounts.js'
import { soloHeaders } from './src/credential.js'
import { TRAE, PATHS } from './src/constants.js'
const accounts = await loadAccounts()
const models = ['seedance_2_0', 'seedance2-fast', 'seedance_2_0_pro']
for (const acc of accounts.slice(20, 26)) {
  for (const m of models) {
    const res = await fetch(`${TRAE.agentHost}${PATHS.textToVideoStream}`, {
      method:'POST', headers: soloHeaders(acc,{stream:true}),
      body: JSON.stringify({ model: m, prompt:'a cat running' }),
    })
    if (!res.ok) { console.log(acc.ref, m, 'HTTP'+res.status, (await res.text()).slice(0,120)); continue }
    const reader = res.body.getReader(); let seen=''; const dl=Date.now()+4000
    while(Date.now()<dl){ const {value, done}=await reader.read(); if(done) break; seen+=new TextDecoder().decode(value); if(/event:\s*(error|result|done)/.test(seen)) break }
    await reader.cancel().catch(()=>{})
    console.log(acc.ref, m, JSON.stringify(seen.slice(0,180)))
  }
}
process.exit(0)
