import '@radarclip/controls'
import { RadarclipPlayer, readClip, type RadarclipPlayerElement } from '@radarclip/player'
import { radars } from '@radarclip/radars'
import type { Response, Stage } from './worker.js'

interface Info {
  map: string
  tickrate: number
  rounds: { number: number; seconds: number; winner: 'CT' | 'T' | null }[]
  players: { key: string; name: string }[]
}

RadarclipPlayer.radarResolver = radars()

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T
const main = $('main'), side = $('side'), view = $('view'), status = $('status'), meta = $('meta')
const rounds = $<HTMLOListElement>('rounds'), follow = $<HTMLSelectElement>('follow')
const player = $<RadarclipPlayerElement>('player')
const worker = new Worker(new URL('worker.js', import.meta.url), { type: 'module' })
let info: Info | null = null
let current = 0
let clipId = 0
const pending = new Map<number, (json: string) => void>()

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!)

const STAGE: Record<Stage, string> = {
  read: 'Reading the demo', unpack: 'Unpacking', events: 'Finding rounds and kills', players: 'Tracking players', grenades: 'Following grenades',
}

/**
 * The bar follows the worker's progress and keeps creeping a little while no update comes (the
 * parser has a quiet second between passes), so it never looks frozen.
 */
let target = 0, shown = 0, lastUpdate = 0, stage: Stage = 'read', raf = 0
function animate() {
  const idle = performance.now() - lastUpdate > 300
  const cap = Math.min(0.99, target + (idle ? 0.08 : 0))
  shown = Math.max(shown, shown + (cap - shown) * (idle ? 0.01 : 0.25))
  const bar = status.querySelector('progress'), label = status.querySelector('.stage')
  if (bar) bar.value = shown
  if (label) label.textContent = `${STAGE[stage]} · ${Math.round(shown * 100)} %`
  raf = requestAnimationFrame(animate)
}

function open(file: File) {
  target = shown = 0
  stage = 'read'
  cancelAnimationFrame(raf)
  raf = requestAnimationFrame(animate)
  status.innerHTML = `<progress max="1" value="0"></progress><span class="stage"></span>`
  worker.postMessage({ type: 'open', file })
}

worker.onmessage = ({ data }: MessageEvent<Response>) => {
  if (data.type === 'progress') {
    target = data.total
    stage = data.stage
    lastUpdate = performance.now()
  } else if (data.type === 'info') {
    info = data.info as Info
    cancelAnimationFrame(raf)
    status.textContent = `Parsed in ${((data.readMs + data.parseMs) / 1000).toFixed(1)} s`
    show(info)
  } else if (data.type === 'clip') {
    pending.get(data.id)?.(data.json)
    pending.delete(data.id)
  } else if (data.type === 'error') {
    if (data.id == null) cancelAnimationFrame(raf)
    status.textContent = `Error: ${data.message}`
    if (data.id != null) pending.delete(data.id)
  }
}

function clip(request: object): Promise<string> {
  const id = ++clipId
  return new Promise((resolve) => {
    pending.set(id, resolve)
    worker.postMessage({ type: 'clip', id, request })
  })
}

function show(i: Info) {
  meta.textContent = `${i.map} · ${i.rounds.length} rounds · ${i.players.length} players`
  main.classList.remove('empty')
  $('start').hidden = true
  side.hidden = false
  view.hidden = false
  follow.innerHTML = '<option value="">Everyone</option>' +
    [...i.players].sort((a, b) => a.name.localeCompare(b.name)).map((p) => `<option value="${esc(p.key)}">${esc(p.name)}</option>`).join('')
  rounds.innerHTML = i.rounds
    .map((r) => `<li><button data-r="${r.number}"><span>R${r.number}</span><span class="len">${Math.round(r.seconds)} s</span>
      <span class="w ${r.winner ?? ''}">${r.winner ?? '?'}</span></button></li>`)
    .join('')
  void play(1)
}

async function play(n: number, keepTime = false) {
  if (!info || n < 1 || n > info.rounds.length) return
  current = n
  for (const b of rounds.querySelectorAll('button')) b.setAttribute('aria-current', String(+b.dataset.r! === n))
  rounds.querySelector(`[data-r="${n}"]`)?.scrollIntoView({ block: 'nearest' })
  const t = keepTime && player.player.replay ? player.player.time : null
  const json = await clip({ round: n, focus: follow.value ? [follow.value] : [] })
  if (n !== current) return
  await player.load(await readClip(json))
  if (t != null) player.player.seek(t)
  player.focus()
}

rounds.onclick = (e) => {
  const b = (e.target as HTMLElement).closest('button')
  if (b) void play(+b.dataset.r!)
}
follow.onchange = () => void play(current, true)
document.addEventListener('keydown', (e) => {
  if (!info || (e.target as HTMLElement).tagName === 'SELECT') return
  if (e.key === '.' || e.key === 'PageDown') void play(current + 1)
  else if (e.key === ',' || e.key === 'PageUp') void play(current - 1)
})

$<HTMLInputElement>('file').onchange = (e) => {
  const f = (e.target as HTMLInputElement).files?.[0]
  if (f) open(f)
}
const drop = $('drop')
document.addEventListener('dragover', (e) => {
  e.preventDefault()
  drop.classList.add('over')
})
document.addEventListener('dragleave', () => drop.classList.remove('over'))
document.addEventListener('drop', (e) => {
  e.preventDefault()
  drop.classList.remove('over')
  const f = e.dataTransfer?.files[0]
  if (f) {
    if (info) {
      $('start').hidden = false
      main.classList.add('empty')
      side.hidden = view.hidden = true
    }
    open(f)
  }
})
