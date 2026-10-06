import { cookies } from "next/headers";
import { isLang, type Lang } from "./i18n";

/** Bahasa dari cookie `vf_lang` (default "id"). Bukan routing — cukup. */
export async function getLang(): Promise<Lang> {
  const c = await cookies();
  const v = c.get("vf_lang")?.value;
  return isLang(v) ? v : "id";
}