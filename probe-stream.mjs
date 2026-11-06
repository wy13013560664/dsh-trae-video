import { loadAccounts } from './src/accounts.js'
import { soloHeaders } from './src/credential.js'
import { TRAE, PATHS, VIDEO_MODEL } from './src/constants.js'

const accounts = await loadAccounts()
const hosts = [TRAE.agentHost, TRAE.ugHost]
const n = Number(process.argv[2] || 4)

for (const acc of accounts.slice(0, n)) {
  for (const host of hosts) {
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), 12000)
    try {
      const res = await fetch(`${host}${PATHS.textToVideoStream}`, {
        method: 'POST',
        headers: soloHeaders(acc, { stream: true }),
        body: JSON.stringify({ model: VIDEO_MODEL, prompt: 'test' }),
        signal: ctrl.signal,
      })
      if (!res.ok) {
        const t = await res.text().catch(() => '')
        console.log(acc.ref, host, 'HTTP', res.status, t.slice(0, 200))
        continue
      }
      const reader = res.body.getReader()
      let seen = ''
      const deadline = Date.now() + 6000
      while (Date.now() < deadline) {
        const { value, done } = await reader.read()
        if (done) break
        seen += new TextDecoder().decode(value)
        if (/event:\s*(error|result|done)/.test(seen)) break
      }
      await reader.cancel().catch(() => {})
      console.log(acc.ref, host, 'OK-stream', JSON.stringify(seen.slice(0, 300)))
    } catch (e) {
      console.log(acc.ref, host, 'ERR', e.name, e.message.slice(0, 120))
    } finally { clearTimeout(timer) }
  }
}
process.exit(0)
