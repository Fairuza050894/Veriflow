/**
 * Sanitasi HTML untuk preview di iframe sandbox.
 * Email sudah di-mask secret oleh mailer; ini lapisan kedua: buang <script>,
 * <iframe>, on* handler, dan javascript: URL (isu terlaris saat render HTML tak dipercaya).
 */
export function sanitizeEmailHtml(html: string): string {
  return html
    .replace(/<\s*script[\s\S]*?<\s*\/\s*script\s*>/gi, "")
    .replace(/<\s*iframe[\s\S]*?<\s*\/\s*iframe\s*>/gi, "")
    .replace(/<\s*object[\s\S]*?<\s*\/\s*object\s*>/gi, "")
    .replace(/\son\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "")
    .replace(/(href|src)\s*=\s*(["']?)\s*javascript:[^"'\s>]*/gi, '$1=$2#')
    .replace(/<meta[^>]*http-equiv=["']?refresh["']?[^>]*>/gi, "");
}