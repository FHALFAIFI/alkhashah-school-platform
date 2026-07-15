/**
 * محدد معدل بسيط داخل العملية — كافٍ لنشر أحادي المضيف عبر Tailscale (انظر SECURITY_AND_BACKUP).
 */
const buckets = new Map<string, { tokens: number; last: number }>();

export function rateLimit(key: string, maxPerMinute: number): boolean {
  const now = Date.now();
  const bucket = buckets.get(key) ?? { tokens: maxPerMinute, last: now };
  const refill = ((now - bucket.last) / 60000) * maxPerMinute;
  bucket.tokens = Math.min(maxPerMinute, bucket.tokens + refill);
  bucket.last = now;
  if (bucket.tokens < 1) {
    buckets.set(key, bucket);
    return false;
  }
  bucket.tokens -= 1;
  buckets.set(key, bucket);
  return true;
}
