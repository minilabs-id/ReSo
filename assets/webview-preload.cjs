/**
 * Preload khusus WebContentsView scraper.
 *
 * Satu-satunya jalan balik dari halaman pihak ketiga ke main process adalah
 * `window.resoScrap.click()`. Otorisasi ada di main process: asal WebContents
 * harus host scraper, URL harus domain platform, dan klik dibatasi debounce.
 */
const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('resoScrap', {
  click() {
    ipcRenderer.send('reso:scrap:click')
  },
})
