/**
 * Preload khusus WebContentsView scraper.
 *
 * Satu-satunya jalan balik dari halaman pihak ketiga ke main process adalah
 * `window.resoScrap.click(nonce)`. Main memverifikasi nonce yang di-inject
 * saat halaman dimuat, sehingga script iklan tidak bisa memalsukan klik
 * hanya dengan console.log (pendekatan lama yang rentan disalahgunakan).
 */
const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('resoScrap', {
  click(nonce) {
    if (typeof nonce === 'string' && nonce) {
      ipcRenderer.send('reso:scrap:click', nonce)
    }
  },
})
