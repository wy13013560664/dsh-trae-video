import { loadAccounts } from './src/accounts.js'
import { soloHeaders } from './src/credential.js'
import { TRAE } from './src/constants.js'
const accounts = await loadAccounts()
const acc = accounts[0]
const variants = [
  ['https://trae-api-cn.mchost.guru/api/v1/commercial/check_estimated_balance', {}],
  ['https://trae-api-cn.mchost.guru/api/v1/commercial/check_estimated_balance', {model:'seedance2-fast'}],
  ['https://trae-api-cn.mchost.guru/api/v1/commercial/check_estimated_balance', {model_list:['seedance2-fast']}],
  ['https://trae-api-cn.mchost.guru/api/ide/v1/commercial/check_estimated_balance', {model:'seedance2-fast'}],
  ['https://trae-api-cn.mchost.guru/api/v1/commercial/check_estimated_balance', {estimated_tokens:1000, model:'seedance2-fast'}],
]
for (const [url, body] of variants) {
  try {
    const res = await fetch(url, { method:'POST', headers: soloHeaders(acc,{stream:false}), body: JSON.stringify(body) })
    const t = await res.text()
    console.log(url.replace('https://trae-api-cn.mchost.guru',''), JSON.stringify(body), '=>', res.status, t.slice(0,240))
  } catch(e){ console.log(url, 'ERR', e.message) }
}
