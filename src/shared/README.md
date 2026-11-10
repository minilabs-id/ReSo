/**
 * Peta port `tmp-shared.js` → `src/shared/*` (M3).
 *
 * `tmp-shared.js` adalah salinan utuh logika ekstensi Chrome lama (2135 baris)
 * yang dipertahankan sampai port selesai. JANGAN hapus sebelum SEMUA penanda
 * di bawah centang.
 *
 * | tmp-shared.js                          | tujuan                      | status |
 * |----------------------------------------|-----------------------------|--------|
 * | isFacebookUrl/isTikTokUrl/isInstagramUrl/detectPlatform | shared/platform.ts | ✅ |
 * | extractFbFeedbackIds/Id/isFacebookPostPage | shared/platform.ts       | ✅ |
 * | extractInstagramShortcode/extractAwemeId | shared/platform.ts         | ✅ |
 * | normalizeCommentName/normalizeNickname/normalizeInstagramUsername/normalizeName | shared/normalize.ts | ✅ |
 * | mergeNames/namesToClipboardText/filterNames/sortNamesAz/mergeAcrossPlatforms | shared/normalize.ts | ✅ |
 * | doneMessage/reasonToMessage/wordFor/fbTargetLabel/igTargetLabel | shared/messages.ts | ✅ |
 * | parseTikTokComments/parseIgComments/extractGraphqlNames | shared/parsers.ts | ✅ |
 * | sanitizeTikTokTemplateUrl/isTikTokTemplateValid | shared/template.ts   | ✅ |
 * | sanitizeInstagramTemplateUrl/isInstagramTemplateValid | shared/template.ts | ✅ |
 * | sanitizeEngineOptions                   | shared/template.ts          | ✅ |
 * | DEFAULT_STATE_*/defaultStateFor/storageKeyFor | shared/state.ts       | ✅ |
 * | applyStatePatch/newRunId/isStaleRun     | shared/state.ts             | ✅ |
 *
 * BELUM di-port (sengaja, bukan bagian inti scraping):
 * - ICON_PATHS/svgIcon/iconSprite/injectIconSprite → UI Electron memakai lucide-react.
 * - resolveTheme → UI Electron memakai prefers-color-scheme di renderer.
 * - downloadTextFile → renderer memakai API download DOM biasa.
 * - normalizeResoUrl/getResoUrl/setResoUrl/applyResoConnect/resoMatchPatterns → diganti
 *   alur auth native (electron/main.ts + src/lib/reso-bridge.ts).
 * - chrome.storage & antrian pengiriman (RESO_PENDING_KEY dst.) → diganti electron-store
 *   (M2) + ResoApiClient (M5).
 * - parsePostAgeText/scanPageForPostDate/localIsoOf dst. → diport bersama engine
 *   per platform saat M3 lanjutan (butuh DOM, bukan pure).
 * - jwtExpSeconds/jwtAud → M5 (klien API ReSo).
 */

export {}
