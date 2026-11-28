/**
 * Dependency CDP untuk WebContentsView scraper.
 *
 * Dipakai sebagai dependency wajib oleh fallback GraphQL Instagram:
 * `Page.addScriptToEvaluateOnNewDocument` harus dipasang SEBELUM halaman
 * dimuat supaya penangkap template GraphQL aktif di main world.
 *
 * Tidak memakai paket npm tambahan — `webContents.debugger` adalah CDP bawaan
 * Electron. Bedanya dengan kode lama: attach diretry, domain dinyalakan,
 * dan kegagalan menghasilkan status yang bisa dilaporkan ke UI.
 */
import type { WebContents } from 'electron'

export interface CdpSession {
  evaluate<T>(expression: string): Promise<T>
  addDocumentStartScript(source: string): Promise<string>
  isAttached(): boolean
  detach(): Promise<void>
  onDetach(cb: () => void): void
  sendCommand(method: string, params?: object): Promise<unknown>
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

export async function attachCdp(wc: WebContents, attempts = 3): Promise<CdpSession> {
  let lastError: unknown
  for (let i = 0; i < attempts; i++) {
    try {
      const d = wc.debugger
      if (!d) throw new Error('webContents.debugger tidak tersedia')
      if (!d.isAttached()) d.attach('1.3')
      const call = (method: string, params: object = {}): Promise<unknown> =>
        d.sendCommand(method, params)
      await call('Page.enable')
      await call('Runtime.enable')
      return {
        evaluate: async <T>(expression: string): Promise<T> => {
          const r = (await call('Runtime.evaluate', {
            expression,
            returnByValue: true,
            awaitPromise: true,
          })) as {
            result?: { value?: T }
            exceptionDetails?: { text?: string; exception?: { description?: string } }
          }
          if (r.exceptionDetails) {
            throw new Error(
              r.exceptionDetails.exception?.description || r.exceptionDetails.text || 'evaluation error'
            )
          }
          return r.result?.value as T
        },
        addDocumentStartScript: async (source: string): Promise<string> => {
          const r = (await call('Page.addScriptToEvaluateOnNewDocument', { source })) as {
            identifier?: string
          }
          return String(r.identifier || '')
        },
        isAttached: (): boolean => d.isAttached(),
        detach: async (): Promise<void> => {
          try {
            if (d.isAttached()) await d.detach()
          } catch {
            /* sudah terlepas */
          }
        },
        onDetach: (cb: () => void): void => {
          d.on('detach', cb)
        },
        sendCommand: (method: string, params: object = {}): Promise<unknown> => call(method, params),
      }
    } catch (err) {
      lastError = err
      await sleep(250 * (i + 1))
    }
  }
  throw new Error(`CDP attach gagal setelah ${attempts} percobaan: ${String(lastError).slice(0, 140)}`)
}
