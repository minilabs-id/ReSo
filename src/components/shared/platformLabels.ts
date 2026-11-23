/** Label platform pendek untuk tab / badge (kunci: 'ig' | 'fb' | 'tiktok'). */
export const PLATFORM_LABEL_SHORT: Record<'ig' | 'fb' | 'tiktok', string> = {
  ig: 'IG',
  fb: 'FB',
  tiktok: 'TikTok',
};

/** Label platform lengkap (kunci: platform internal `Platform`). */
export const PLATFORM_LABEL_FULL: Record<'facebook' | 'tiktok' | 'instagram', string> = {
  facebook: 'Facebook',
  tiktok: 'TikTok',
  instagram: 'Instagram',
};

/** Konversi platform internal (nama lengkap) → kunci pendek. */
export function platformShortFromFull(
  p: 'facebook' | 'tiktok' | 'instagram'
): 'ig' | 'fb' | 'tiktok' {
  if (p === 'facebook') return 'fb';
  if (p === 'instagram') return 'ig';
  return 'tiktok';
}
