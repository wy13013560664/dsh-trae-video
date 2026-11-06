import { loadAccounts } from './src/accounts.js'
const accounts = await loadAccounts()
const acc = accounts[0]
// 用 pack 里的 chat 端点测试同一账号是否还能对话（区分「账号被封」vs「视频模型额度用尽」）
const res = await fetch('https://trae-api-cn.mchost.guru/api/ide/v1/chat/completions', {
  method: 'POST',
  headers: { 'content-type':'application/json', Authorization:`Cloud-IDE-JWT ${acc.access_token}`, 'X-Ide-Token':acc.access_token, 'X-Uid':acc.uid, 'X-App-Id':'6eefa01c-1036-4c7e-9ca5-d891f63bfcd8' },
  body: JSON.stringify({ model:'deepseek-v4.1-flash', messages:[{role:'user',content:'hi'}], stream:false }),
})
console.log('chat', res.status, (await res.text()).slice(0,300))
process.exit(0)
