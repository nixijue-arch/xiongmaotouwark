// Keyboard utilities: platform-aware shortcut display + matching.
// Normalizes Cmd/Ctrl across Mac vs Win/Linux, formats specs like
// 'Mod+Shift+S' into '⌘⇧S' or 'Ctrl+Shift+S', matches KeyboardEvent
// against specs, and detects typing-into-input targets.

import type { KeyboardEvent as ReactKeyboardEvent } from 'react'

export const IS_MAC: boolean = (() => {
  try {
    const uaData = (navigator as Navigator & {
      userAgentData?: { platform?: string }
    }).userAgentData
    if (uaData?.platform) return uaData.platform === 'macOS'
    const src = navigator.platform || navigator.userAgent || ''
    return /Mac|iPhone|iPad/.test(src)
  } catch {
    return false
  }
})()

export const KEY_SYMBOLS = {
  Mod: { mac: '⌘', win: 'Ctrl' },
  Shift: { mac: '⇧', win: 'Shift' },
  Alt: { mac: '⌥', win: 'Alt' },
  Ctrl: { mac: '⌃', win: 'Ctrl' },
  Enter: { mac: '↩', win: 'Enter' },
  Escape: { mac: '⎋', win: 'Esc' },
  ArrowLeft: { mac: '←', win: '←' },
  ArrowRight: { mac: '→', win: '→' },
  ArrowUp: { mac: '↑', win: '↑' },
  ArrowDown: { mac: '↓', win: '↓' },
  Backspace: { mac: '⌫', win: 'Backspace' },
  Delete: { mac: '⌦', win: 'Delete' },
  Space: { mac: 'Space', win: 'Space' },
  Tab: { mac: '⇥', win: 'Tab' },
} as const

type SymbolKey = keyof typeof KEY_SYMBOLS

export function isMetaOrCtrl(e: KeyboardEvent | ReactKeyboardEvent): boolean {
  return IS_MAC ? e.metaKey : e.ctrlKey
}

export function fmtShortcut(spec: string): string {
  const tokens = spec.split('+').map((t) => t.trim()).filter(Boolean)
  const parts = tokens.map((tok) => {
    if (tok in KEY_SYMBOLS) {
      const entry = KEY_SYMBOLS[tok as SymbolKey]
      return IS_MAC ? entry.mac : entry.win
    }
    if (tok.startsWith('Key') && tok.length === 4) return tok.slice(3).toUpperCase()
    if (tok.length === 1) return tok.toUpperCase()
    return tok
  })
  return IS_MAC ? parts.join('') : parts.join('+')
}

export function matchShortcut(e: KeyboardEvent, spec: string): boolean {
  const tokens = spec.split('+').map((t) => t.trim()).filter(Boolean)
  if (tokens.length === 0) return false

  let needMod = false
  let needShift = false
  let needAlt = false
  let needCtrl = false
  let keyToken = ''

  for (const tok of tokens) {
    if (tok === 'Mod') needMod = true
    else if (tok === 'Shift') needShift = true
    else if (tok === 'Alt') needAlt = true
    else if (tok === 'Ctrl') needCtrl = true
    else keyToken = tok
  }

  const modOk = needMod ? (IS_MAC ? e.metaKey : e.ctrlKey) : (IS_MAC ? !e.metaKey : true)
  if (!modOk) return false
  if (needShift !== e.shiftKey) return false
  if (needAlt !== e.altKey) return false
  if (!needMod && needCtrl !== e.ctrlKey) return false
  if (!needMod && IS_MAC && e.metaKey) return false

  if (!keyToken) return true

  if (keyToken === 'Space') return e.code === 'Space'
  if (keyToken.startsWith('Key') && keyToken.length === 4) {
    return e.key.toLowerCase() === keyToken.slice(3).toLowerCase()
  }
  if (keyToken.length === 1) {
    return e.key.toLowerCase() === keyToken.toLowerCase()
  }
  return e.key === keyToken
}

export function isTypingTarget(e: KeyboardEvent | Event): boolean {
  const target = e.target as (HTMLElement | null)
  if (!target) return false
  const tag = target.tagName
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true
  if ((target as HTMLElement).isContentEditable === true) return true
  const role = typeof target.getAttribute === 'function' ? target.getAttribute('role') : null
  if (role === 'textbox') return true
  return false
}
