/**
 * 视频生成进度推送中心（SSE）—— 前端进度 UI 的后端半边。
 *
 * 模式对齐 our-free-model 的 src/push.js：
 *  - 单一 held-open `text/event-stream` 路由
 *  - 客户端连上先收 hello，之后实时收进度帧
 *  - 事件为 fire-and-forget 快照，非队列（客户端重连后从最近一次 task 状态恢复）
 *
 * 进度帧由 generateVideo 的 onProgress 回调喂入（见 video.js 的 STAGES）。
 * @module src/progress
 */

const HEARTBEAT_MS = 15_000

export function createProgressHub({ logger = console, heartbeatMs = HEARTBEAT_MS } = {}) {
  const clients = new Set()
  let heartbeat = undefined
  let latest = { active: false }

  function startHeartbeat() {
    if (heartbeat !== undefined || clients.size === 0) return
    heartbeat = setInterval(() => {
      for (const res of clients) {
        if (res.writableEnded === true || res.destroyed === true) { clients.delete(res); continue }
        res.write(': ping\n\n')
      }
      if (clients.size === 0) stopHeartbeat()
    }, heartbeatMs)
    heartbeat.unref?.()
  }

  function stopHeartbeat() {
    if (heartbeat === undefined) return
    clearInterval(heartbeat)
    heartbeat = undefined
  }

  function sendTo(res, event, data) {
    try {
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
    } catch { /* 客户端已断，下次心跳清理 */ }
  }

  function broadcast(event, data) {
    for (const res of clients) sendTo(res, event, data)
  }

  return {
    get size() { return clients.size },
    /** 当前最近一次任务状态（新客户端 hello 用）。 */
    get latest() { return latest },

    /** 采纳一个请求为 SSE 流。 */
    attach(req, res, hello) {
      res.writeHead(200, {
        'content-type': 'text/event-stream; charset=utf-8',
        'cache-control': 'no-cache, no-transform',
        connection: 'keep-alive',
        'x-accel-buffering': 'no',
      })
      res.write(': connected\n\n')
      sendTo(res, 'hello', hello ?? latest)
      clients.add(res)
      startHeartbeat()
    },

    /** 更新进度（由 generateVideo 的 onProgress 调用）。 */
    progress(stage, payload = {}) {
      latest = { active: true, stage, payload, ts: Date.now() }
      broadcast('progress', latest)
    },

    /** 任务完成 / 失败。 */
    finish(ok, payload = {}) {
      latest = { active: false, ok, stage: ok ? 'done' : 'failed', payload, ts: Date.now() }
      broadcast(ok ? 'done' : 'error', latest)
    },
  }
}