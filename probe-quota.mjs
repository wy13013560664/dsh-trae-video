import { loadAccounts } from './src/accounts.js'
import { soloHeaders } from './src/credential.js'
import { TRAE, PATHS, VIDEO_MODEL } from './src/constants.js'
const accounts = await loadAccounts()
console.log('accounts:', accounts.length)
for (const acc of accounts) {
  try {
    const res = await fetch(`${TRAE.agentHost}${PATHS.checkEstimatedBalance}`, {
      method: 'POST', headers: soloHeaders(acc, { stream: false }), body: JSON.stringify({ model: VIDEO_MODEL }),
    })
    const text = await res.text().catch(() => '')
    console.log(acc.ref, res.status, text.slice(0, 160))
  } catch (e) { console.log(acc.ref, 'ERR', e.message) }
}
