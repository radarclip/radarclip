import '@radarclip/controls'
import { RadarclipPlayer, readClip, type RadarclipPlayerElement } from '@radarclip/player'
import { radars } from '@radarclip/radars'
import type { Response } from './worker.js'

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

function open(file: File) {
  status.innerHTML = `<progress max="${file.size}" value="0"></progress>`
  worker.postMessage({ type: 'open', file })
}

worker.onmessage = ({ data }: MessageEvent<Response>) => {
  if (data.type === 'progress') {
    const bar = status.querySelector('progress')
    if (bar) bar.value = data.loaded
    if (data.loaded >= data.size) status.insertAdjacentText('beforeend', ' Parsing…')
  } else if (data.type === 'info') {
    info = data.info as Info
    status.textContent = `Parsed in ${((data.readMs + data.parseMs) / 1000).toFixed(1)} s`
    show(info)
  } else if (data.type === 'clip') {
    pending.get(data.id)?.(data.json)
    pending.delete(data.id)
  } else if (data.type === 'error') {
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
