/**
 * dsh-trae-video —— 客户端半（Web Client half）
 *
 * 单页界面，视觉/结构/交互对齐 dsh-plugin-ai-drama 的 --ad-* 规范：
 *   - 主题：--ad-* 变量（复用 dsw-alias token，浅/深自动翻转）
 *   - 结构：ad-shell > ad-head > ad-body；页签分组
 *   - 交互：ad-btn/ad-primary、ad-input/ad-select、ad-empty-state、ad-err-box、ad-skeleton
 *
 * 三页签：
 *   1. 出片：prompt + 参数（model 固定 seedance2-fast）+ t2i/t2v/i2v/v2v + 进度
 *   2. 产物：本地生成目录 mp4 列表 + 打开
 *   3. 账号：Trae 账号池状态
 *
 * 数据源：宿主半 REST 路由 /api/trae-video/*。React 由浏览器模块表提供。
 */
window.__ModuleLoader__.load({
  id: 'dsh-trae-video',
  factory(require) {
    const { createElement: h, Fragment, useState, useEffect, useRef } = require('react')

    const PANEL_ID = 'trae-video'
    const API_BASE = '/api/trae-video/'

    async function api(method, payload) {
      const response = await fetch(API_BASE + method, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload || {}),
      })
      let data
      try { data = await response.json() } catch { throw new Error('出片服务尚未就绪，请刷新后重试') }
      if (!response.ok || data.ok === false) throw new Error(data.error || '出片操作失败')
      return data
    }

    /** 读取本地文件为纯 base64（去掉 dataURL 前缀）。 */
    function readAsBase64(file) {
      return new Promise((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = () => {
          const s = String(reader.result || '')
          const i = s.indexOf(',')
          resolve(i >= 0 ? s.slice(i + 1) : s)
        }
        reader.onerror = () => reject(new Error('读取文件失败'))
        reader.readAsDataURL(file)
      })
    }

    /* ---------------------------------------------------------------- 样式（对齐 ai-drama） */
    const CSS = `
body{
--ad-bg-base:var(--dsw-alias-bg-base);
--ad-label-primary:var(--dsw-alias-label-primary);
--ad-label-secondary:var(--dsw-alias-label-secondary);
--ad-brand:var(--dsw-alias-brand-primary);
--ad-on-brand:var(--dsw-alias-bg-base);
--ad-primary-hover-bg:color-mix(in srgb,var(--dsw-alias-brand-primary) 88%,var(--dsw-alias-bg-base));
--ad-error:color-mix(in srgb,var(--dsw-alias-state-error-primary) 75%,var(--dsw-alias-label-primary));
--ad-warn:color-mix(in srgb,var(--dsw-alias-state-warn-primary) 55%,var(--dsw-alias-label-primary));
--ad-success:color-mix(in srgb,var(--dsw-alias-state-success-primary) 60%,var(--dsw-alias-label-primary));
--ad-error-bg:color-mix(in srgb,var(--dsw-alias-state-error-primary) 8%,transparent);
--ad-warning-bg:color-mix(in srgb,var(--dsw-alias-state-warn-primary) 10%,transparent);
--ad-error-border:color-mix(in srgb,var(--dsw-alias-state-error-primary) 35%,transparent);
--ad-warning-border:color-mix(in srgb,var(--dsw-alias-state-warn-primary) 35%,transparent);
--ad-subtle-bg:color-mix(in srgb,var(--dsw-alias-label-primary) 4%,transparent);
--ad-hover-bg:color-mix(in srgb,var(--dsw-alias-label-primary) 6%,transparent);
--ad-border:var(--dsw-alias-border-l2);
--ad-divider:var(--dsw-alias-border-l1);
}
.ad-shell{display:flex;flex-direction:column;height:100%;min-height:0;color:var(--ad-label-primary);background:var(--ad-bg-base)}
.ad-head{display:flex;align-items:center;gap:10px;padding:12px 18px;border-bottom:1px solid var(--ad-divider);flex:none;background:var(--ad-bg-base)}
.ad-title{font-size:16px;font-weight:600}
.ad-sub{font-size:12px;color:var(--ad-label-secondary)}
.ad-body{flex:1;min-height:0;overflow:auto;padding:16px 18px}
.ad-btn{border:1px solid var(--ad-border);background:transparent;color:inherit;border-radius:8px;padding:6px 12px;font-size:13px;cursor:pointer;white-space:nowrap}
.ad-btn:not(.ad-primary):hover{background:var(--ad-hover-bg)}
.ad-btn[disabled]{opacity:.5;cursor:default}
.ad-primary{border-color:transparent;background:var(--ad-brand);color:var(--ad-on-brand)}
.ad-primary:hover{background:var(--ad-primary-hover-bg)}
.ad-sm{padding:4px 10px;font-size:12px}
.ad-cta{padding:7px 18px;font-weight:600}
.ad-row{display:flex;align-items:center;gap:8px}
.ad-input,.ad-select,.ad-area{padding:6px 10px;font-size:13px;border-radius:8px;border:1px solid var(--ad-border);background:var(--ad-bg-base);color:inherit;font-family:inherit;box-sizing:border-box}
.ad-input{flex:1;min-width:0}
.ad-area{width:100%;resize:vertical;line-height:1.7;min-height:80px}
.ad-select{max-width:220px}
.ad-tabs{display:flex;align-items:flex-start;gap:8px;border-bottom:1px solid var(--ad-divider);margin:2px 0 12px;flex:none}
.ad-tab{border:0;background:transparent;color:inherit;padding:8px 12px;border-radius:8px 8px 0 0;font-size:13px;cursor:pointer;border-bottom:2px solid transparent;opacity:.72;transition:background 160ms ease,opacity 160ms ease}
.ad-tab:hover{background:var(--ad-hover-bg);opacity:1}
.ad-tab[data-on="1"]{opacity:1;font-weight:600;color:var(--ad-label-primary);border-bottom-color:var(--ad-brand)}
.ad-tab-groups{display:flex;align-items:center;flex-wrap:wrap;gap:6px 16px;flex:1;min-width:0}
.ad-tab-group{display:flex;align-items:center;gap:4px;padding-right:12px;border-right:1px solid var(--ad-divider)}
.ad-tab-group:last-child{border-right:0;padding-right:0}
.ad-tab-group-label{font-size:12px;color:var(--ad-label-secondary);padding-right:4px;white-space:nowrap}
.ad-sec{font-size:14px;font-weight:600;margin:14px 0 10px;padding-bottom:6px;border-bottom:1px solid var(--ad-divider)}
.ad-sec:first-child{margin-top:0}
.ad-count{font-size:12px;color:var(--ad-label-secondary)}
.ad-empty-state{padding:14px 16px;border:1px dashed var(--ad-border);border-radius:10px;line-height:1.9;font-size:13px;color:var(--ad-label-secondary)}
.ad-empty-title{font-size:13px;font-weight:600;color:var(--ad-label-primary);margin-bottom:4px}
.ad-err{color:var(--ad-error);font-size:13px;line-height:1.8}
.ad-err-box{margin:0 0 12px;padding:10px 12px;border-radius:10px;border:1px solid var(--ad-error-border);background:var(--ad-error-bg);display:flex;flex-direction:column;gap:4px}
.ad-err-actions{display:flex;gap:8px;margin-top:4px}
.ad-skeleton{display:flex;flex-direction:column;gap:10px;padding:6px 2px}
.ad-skeleton-line{height:14px;border-radius:6px;background:var(--ad-subtle-bg);animation:ad-skeleton-pulse 1.2s ease-in-out infinite}
.ad-skeleton-line.w60{width:60%}.ad-skeleton-line.w90{width:90%}
@keyframes ad-skeleton-pulse{0%,100%{opacity:.55}50%{opacity:1}}
.ad-content{width:100%;max-width:1200px;margin:0 auto}
.ad-shell :focus-visible,.ad-btn:focus-visible,.ad-tab:focus-visible,.ad-input:focus-visible,.ad-select:focus-visible,.ad-area:focus-visible{outline:2px solid var(--ad-brand);outline-offset:2px}
.ad-tab:focus-visible{outline-offset:-2px}
.ad-progress-box{margin-top:10px;padding:12px 14px;border-radius:10px;background:var(--ad-subtle-bg)}
.ad-progress-bar{height:6px;border-radius:3px;background:var(--ad-border);overflow:hidden}
.ad-progress-fill{height:100%;background:var(--ad-brand);border-radius:3px;transition:width 0.4s}
.ad-list{border:1px solid var(--ad-border);border-radius:10px;overflow:hidden;max-height:360px;overflow-y:auto}
.ad-item{display:flex;align-items:center;padding:7px 10px;cursor:pointer;border-bottom:1px solid var(--ad-divider);font-size:12px}
.ad-item:last-child{border-bottom:0}
.ad-item:hover{background:var(--ad-hover-bg)}
`

    function PanelIcon() {
      return h('svg', { width: 18, height: 18, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.6, strokeLinecap: 'round', strokeLinejoin: 'round' },
        h('rect', { x: 2, y: 4, width: 20, height: 16, rx: 2 }),
        h('path', { d: 'M2 8h20M7 4v4M17 4v4M7 12l3 2 3-2 4 3' }),
      )
    }

    /* ---------------------------------------------------------------- 出片页签 */
    function GenerateTab({ busy, startGenerate, jobProgress, mode, setMode, accountsTotal }) {
      const [prompt, setPrompt] = useState('')
      const [imagePrompt, setImagePrompt] = useState('')
      const [imageKey, setImageKey] = useState('')     // i2v 上传后的 TOS key
      const [imageFile, setImageFile] = useState(null)
      const [uploading, setUploading] = useState(false)
      const [ratio, setRatio] = useState('9:16')
      const [resolution, setResolution] = useState('720p')
      const [duration, setDuration] = useState('')
      const [videoKey, setVideoKey] = useState('')     // v2v 源视频 TOS key
      const [videoFile, setVideoFile] = useState(null)
      const [videoUploading, setVideoUploading] = useState(false)

      // 选中文件即上传，拿回 TOS key（biz_type=image 落图像桶）
      useEffect(() => {
        if (!imageFile) return
        let cancelled = false
        setUploading(true)
        ;(async () => {
          try {
            const b64 = await readAsBase64(imageFile)
            const r = await api('upload', { name: imageFile.name, data: b64, biz_type: 'image' })
            if (!cancelled) setImageKey(r.uri)
          } catch (e) {
            if (!cancelled) window.alert('上传失败：' + e.message)
          } finally {
            if (!cancelled) setUploading(false)
          }
        })()
        return () => { cancelled = true }
      }, [imageFile])

      // 选中视频即上传，拿回 TOS key（biz_type=video 落视频桶 av28lk49dz）
      useEffect(() => {
        if (!videoFile) return
        let cancelled = false
        setVideoUploading(true)
        ;(async () => {
          try {
            const b64 = await readAsBase64(videoFile)
            const r = await api('upload', { name: videoFile.name, data: b64, biz_type: 'video' })
            if (!cancelled) setVideoKey(r.uri)
          } catch (e) {
            if (!cancelled) window.alert('视频上传失败：' + e.message)
          } finally {
            if (!cancelled) setVideoUploading(false)
          }
        })()
        return () => { cancelled = true }
      }, [videoFile])

      const progressNode = jobProgress ? h('div', { className: 'ad-progress-box' },
        h('div', { style: { fontWeight: 600, marginBottom: 6 } },
          jobProgress.status === 'done' ? '✅ 生成完成' : jobProgress.status === 'failed' ? '❌ 生成失败' : '⏳ 生成中…'),
        jobProgress.status === 'done' ? null : h('div', { className: 'ad-progress-bar' }, h('div', { className: 'ad-progress-fill', style: { width: '100%' } })),
        jobProgress.error ? h('div', { className: 'ad-err', style: { marginTop: 4 } }, jobProgress.error) : null,
        jobProgress.result?.path ? h('div', { className: 'ad-count', style: { marginTop: 4 } }, `产物：${jobProgress.result.path}`) : null,
      ) : null

      return h(Fragment, null,
        h('div', { className: 'ad-row', style: { marginBottom: 8 } },
          h('span', { className: 'ad-sec', style: { margin: 0, border: 0, padding: 0 } }, '模式'),
          h('select', { className: 'ad-select', value: mode, onChange: e => setMode(e.target.value) },
            [['t2v', '文生视频'], ['i2v', '图生视频'], ['v2v', '视频续写'], ['t2i', '文生图']].map(([k, l]) => h('option', { value: k, key: k }, l)),
          ),
        ),
        h('div', { style: { marginBottom: 8 } },
          h('span', { className: 'ad-sec', style: { margin: 0, border: 0, padding: 0, display: 'block', marginBottom: 6 } }, '提示词'),
          h('textarea', { className: 'ad-area', rows: 5, value: prompt, onChange: e => setPrompt(e.target.value), placeholder: mode === 't2i' ? '描述要生成的图片…' : (mode === 'i2v' ? '描述想让视频动起来的效果（如：镜头缓缓推进）…' : '描述视频画面…') }),
        ),
        mode === 'i2v' ? h('div', { style: { marginBottom: 8 } },
          h('span', { className: 'ad-sec', style: { margin: 0, border: 0, padding: 0, display: 'block', marginBottom: 6 } }, '参考图（选本地图片，上传后作为视频首帧）'),
          h('div', { className: 'ad-row' },
            h('input', {
              type: 'file', accept: 'image/*', style: { fontSize: 12 },
              onChange: e => { const f = e.target.files?.[0]; if (f) setImageFile(f) },
            }),
            uploading ? h('span', { className: 'ad-count' }, '上传中…') : null),
          imageKey
            ? h('div', { className: 'ad-count', style: { marginTop: 4, wordBreak: 'break-all' } }, `已上传：${imageKey}`)
            : h('div', { className: 'ad-count', style: { marginTop: 4 } }, '不选图 = 用提示词走 t2i 生成参考图'),
          h('div', { className: 'ad-count', style: { marginTop: 2 } }, '提示：真实人像照片会被内容审核拒绝，建议用插画/风景/AI 生成图。'),
        ) : null,
        mode === 'v2v' ? h('div', { style: { marginBottom: 8 } },
          h('span', { className: 'ad-sec', style: { margin: 0, border: 0, padding: 0, display: 'block', marginBottom: 6 } }, '源视频（选本地 mp4，上传后做续写/延伸）'),
          h('div', { className: 'ad-row' },
            h('input', {
              type: 'file', accept: 'video/mp4,video/quicktime', style: { fontSize: 12 },
              onChange: e => { const f = e.target.files?.[0]; if (f) setVideoFile(f) },
            }),
            videoUploading ? h('span', { className: 'ad-count' }, '上传中…') : null),
          h('input', { className: 'ad-input', style: { marginTop: 6 }, value: videoKey, onChange: e => setVideoKey(e.target.value), placeholder: '或直接粘贴 TOS key（tos-cn-i-.../video/xxx_mp4）' }),
          videoKey ? h('div', { className: 'ad-count', style: { marginTop: 4, wordBreak: 'break-all' } }, `已就绪：${videoKey}`) : null,
          h('div', { className: 'ad-count', style: { marginTop: 2 } }, '说明：源视频 ≤100MiB，最多 3 个；输出为续写的新片段。'),
        ) : null,
        h('div', { className: 'ad-row', style: { marginBottom: 12, flexWrap: 'wrap' } },
          h('span', { className: 'ad-sec', style: { margin: 0, border: 0, padding: 0 } }, '参数'),
          h('select', { className: 'ad-select', style: { maxWidth: 130 }, value: ratio, onChange: e => setRatio(e.target.value), title: '画幅' },
            ['9:16', '16:9', '1:1', '3:4', '4:3'].map(r => h('option', { value: r, key: r }, r === '9:16' ? '9:16 竖屏' : r))),
          h('select', { className: 'ad-select', style: { maxWidth: 110 }, value: resolution, onChange: e => setResolution(e.target.value), title: '分辨率' },
            ['720p', '1080p', '480p'].map(r => h('option', { value: r, key: r }, r))),
          h('input', { className: 'ad-input', style: { maxWidth: 90 }, value: duration, onChange: e => setDuration(e.target.value), placeholder: '时长秒' }),
        ),
        h('div', { className: 'ad-row' },
          h('button', {
            className: 'ad-btn ad-primary ad-cta',
            onClick: () => startGenerate({
              prompt, image_prompt: imagePrompt, ratio, resolution, duration, mode,
              image_paths: imageKey ? [imageKey] : undefined,
              video_paths: videoKey ? [videoKey] : undefined,
            }),
            disabled: busy || !prompt.trim() || uploading || videoUploading,
          }, busy ? '生成中…' : (mode === 't2i' ? '🖼️ 生成图片' : '🎬 生成视频')),
        ),
        accountsTotal !== null ? h('div', { className: 'ad-count', style: { marginTop: 8 } }, `可用账号池：${accountsTotal} 个`) : null,
        progressNode,
      )
    }

    function ArtifactsTab({ artifacts, onOpen, onRefresh, dir }) {
      return h(Fragment, null,
        h('div', { className: 'ad-row', style: { marginBottom: 8 } },
          h('span', { className: 'ad-sec', style: { margin: 0, border: 0, padding: 0 } }, '产物'),
          h('button', { className: 'ad-btn ad-sm', onClick: onRefresh }, '刷新'),
        ),
        artifacts.length > 0
          ? h('div', { className: 'ad-list' },
              artifacts.map((a, i) => h('div', { key: a, className: 'ad-item' },
                h('span', { style: { flex: 1, fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, a.split('/').pop()),
                h('button', { className: 'ad-btn ad-sm', onClick: () => onOpen(a) }, '打开'))))
          : h('div', { className: 'ad-empty-state' },
              h('div', { className: 'ad-empty-title' }, '暂无产物'),
              h('div', null, '生成视频后，这里会列出成品。'),
              h('div', { className: 'ad-sub', style: { marginTop: 4 } }, dir || '')),
      )
    }

    function AccountsTab({ accounts, onRefresh }) {
      const expired = accounts.filter(a => a.expired).length
      return h(Fragment, null,
        h('div', { className: 'ad-row', style: { marginBottom: 8 } },
          h('span', { className: 'ad-sec', style: { margin: 0, border: 0, padding: 0 } }, `Trae 账号池 · ${accounts.length} 个（${expired} 个过期）`),
          h('button', { className: 'ad-btn ad-sm', onClick: onRefresh }, '刷新'),
        ),
        accounts.length > 0
          ? h('div', { className: 'ad-list' },
              accounts.map(a => h('div', { key: a.ref, className: 'ad-item', style: { cursor: 'default' } },
                h('span', { style: { fontSize: 12, fontWeight: 500, minWidth: 150 } }, a.phone || a.uid),
                h('span', { style: { fontSize: 11, color: 'var(--ad-label-secondary)', marginLeft: 8 } }, `uid ${a.uid}`),
                h('span', { style: { marginLeft: 'auto', fontSize: 12, color: a.expired ? 'var(--ad-error)' : 'var(--ad-success)' } }, a.expired ? '已过期' : '可用'))))
          : h('div', { className: 'ad-empty-state' },
              h('div', { className: 'ad-empty-title' }, '未检测到 Trae 账号'),
              h('div', null, '请在 our-free-model 插件里登录 Trae 账号。')),
      )
    }

    /* ---------------------------------------------------------------- 主面板 */
    function DramaPanel() {
      const [phase, setPhase] = useState('loading')
      const [tab, setTab] = useState('generate')
      const [mode, setMode] = useState('t2v')
      const [busy, setBusy] = useState(false)
      const [jobProgress, setJobProgress] = useState(null)
      const [accounts, setAccounts] = useState([])
      const [artifacts, setArtifacts] = useState([])
      const [dir, setDir] = useState('')
      const pollTimer = useRef(null)

      async function refreshAccounts() {
        try { const r = await api('accounts', {}); setAccounts(r.accounts || []) } catch {}
        setPhase('ready')
      }
      async function refreshArtifacts() {
        try { const r = await api('artifacts', { dir }); setArtifacts(r.artifacts || []) } catch {}
      }
      async function startGenerate(params) {
        setBusy(true)
        setJobProgress({ status: 'running' })
        try {
          const r = await api('generate', { ...params, local_path: null })
          const taskId = r.taskId
          pollTimer.current = setInterval(async () => {
            try {
              const s = await api('status', { taskId })
              const j = s.job
              setJobProgress({ status: j.status, error: j.error, result: j.result })
              if (j.status === 'done' || j.status === 'failed') {
                clearInterval(pollTimer.current)
                setBusy(false)
                if (jobProgress?.status === 'done') setJobProgress(j)
              }
            } catch { /* 忽略轮询错误 */ }
          }, 2500)
        } catch (e) {
          setBusy(false)
          setJobProgress({ status: 'failed', error: e.message })
        }
      }
      async function openFile(fp) {
        try { await api('open', { filePath: fp }) } catch (e) { window.alert(e.message) }
      }

      useEffect(() => { refreshAccounts() }, [])

      const TABS = [
        { id: 'generate', label: '出片' },
        { id: 'artifacts', label: '产物' },
        { id: 'accounts', label: '账号' },
      ]

      let panel
      if (phase === 'loading') {
        panel = h('div', { className: 'ad-skeleton' }, h('div', { className: 'ad-skeleton-line w60' }), h('div', { className: 'ad-skeleton-line w90' }))
      } else {
        const tabButtons = TABS.map(t => h('button', {
          key: t.id, className: 'ad-tab', role: 'tab',
          'data-on': tab === t.id ? '1' : '0',
          'aria-selected': tab === t.id ? 'true' : 'false',
          tabIndex: tab === t.id ? 0 : -1,
          onClick: () => setTab(t.id),
        }, t.label))
        const tabsNode = h('div', { className: 'ad-tabs', role: 'tablist', 'aria-label': '出片页签' },
          h('div', { className: 'ad-tab-groups' },
            h('div', { className: 'ad-tab-group' },
              h('span', { className: 'ad-tab-group-label' }, '创作'),
              ...tabButtons)))
        let tabPanel
        if (tab === 'generate') {
          tabPanel = h(GenerateTab, { busy, startGenerate, jobProgress, mode, setMode, accountsTotal: accounts.length })
        } else if (tab === 'artifacts') {
          tabPanel = h(ArtifactsTab, { artifacts, onOpen: openFile, onRefresh: refreshArtifacts, dir })
        } else {
          tabPanel = h(AccountsTab, { accounts, onRefresh: refreshAccounts })
        }
        const panelBody = h('div', { role: 'tabpanel' }, tabPanel)
        panel = h(Fragment, null, tabsNode, panelBody)
      }

      return h(Fragment, null,
        h('style', { dangerouslySetInnerHTML: { __html: CSS } }),
        h('div', { className: 'ad-shell', role: 'region', 'aria-label': 'AI 视频生成' },
          h('div', { className: 'ad-head' },
            h(PanelIcon),
            h('div', null,
              h('div', { className: 'ad-title' }, 'AI 视频生成'),
              h('div', { className: 'ad-sub' }, '免费 Trae Seedance · 文生视频/图生视频/续写/文生图')),
            h('div', { style: { flex: 1 } }),
          ),
          h('div', { className: 'ad-body' },
            h('div', { className: 'ad-content' }, panel)),
        ),
      )
    }

    return {
      inject: ['slots'],
      apply(ctx) {
        ctx.slots.inject('sidebar.panellist', () =>
          ctx.slots.register(
            { name: 'sidebar.panellist', id: PANEL_ID, order: 60, label: 'AI 视频生成' },
            PanelIcon,
          ),
        )
        ctx.slots.inject('main', () =>
          ctx.slots.register({ name: 'main', key: PANEL_ID }, DramaPanel),
        )
      },
    }
  },
})