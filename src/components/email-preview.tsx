import { sanitizeEmailHtml } from "./email-safe";

/**
 * Preview email memakai iframe srcdoc agar CSS email terisolasi dari app.
 * HTML sudah di-mask secret oleh mailer; di sini tetap disanitasi (FR-DSH-08).
 */
export function EmailPreview({ html }: { html: string }) {
  const safe = sanitizeEmailHtml(html);
  return (
    <div className="px-5 pb-5">
      <iframe
        title="Preview email"
        sandbox=""
        srcDoc={safe}
        className="h-[36rem] w-full rounded-xl border border-slate-700/60 bg-white"
      />
    </div>
  );
}