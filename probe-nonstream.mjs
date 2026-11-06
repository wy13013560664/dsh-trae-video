import { loadAccounts } from './src/accounts.js'
import { soloHeaders } from './src/credential.js'
import { TRAE, PATHS, VIDEO_MODEL } from './src/constants.js'
const accounts = await loadAccounts()
const ok = ['TRAE_ACCOUNT_F2D8406D','TRAE_ACCOUNT_894E2E7C','TRAE_ACCOUNT_1E9B33A5']
for (const ref of ok) {
  const acc = accounts.find(a=>a.ref===ref)
  const res = await fetch(`${TRAE.agentHost}${PATHS.textToVideo}`, {
    method:'POST', headers: soloHeaders(acc,{stream:false}),
    body: JSON.stringify({ model: VIDEO_MODEL, prompt:'a cat', ratio:'9:16', resolution:'720p', duration:5 }),
  })
  console.log(ref, 'nonstream', res.status, (await res.text()).slice(0,250))
}
process.exit(0)
