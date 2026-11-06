import { loadAccounts } from './src/accounts.js'
import { soloHeaders } from './src/credential.js'
import { TRAE, PATHS, IMAGE_MODEL } from './src/constants.js'
const accounts = await loadAccounts()
const acc = accounts[0]
const res = await fetch(`${TRAE.agentHost}${PATHS.textToImageStream}`, {
  method: 'POST', headers: soloHeaders(acc, { stream: true }),
  body: JSON.stringify({ model: IMAGE_MODEL, prompt: '一只橘猫', ratio: '1:1', resolution: '720p' }),
})
console.log('img status', res.status)
const reader = res.body.getReader()
let seen = ''
const deadline = Date.now() + 15000
while (Date.now() < deadline) {
  const { value, done } = await reader.read()
  if (done) break
  seen += new TextDecoder().decode(value)
  if (/event:\s*(error|result|done)/.test(seen)) break
}
await reader.cancel().catch(()=>{})
console.log(seen.slice(0, 500))
process.exit(0)
