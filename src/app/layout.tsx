import type { Metadata } from "next";
import { Shell } from "@/components/shell";
import { ensureSeeded } from "@/lib/queries";
import "./globals.css";

// ponytail: seed + skema dibuat saat boot; pada Vercel ini jalan per cold start (idempoten, <10 ms).
ensureSeeded();

export const metadata: Metadata = {
  title: "Veriflow — Otomatis QA Logistik",
  description: "Connect repo → AI generate test → run paralel → laporan & email otomatis.",
};

export const viewport = { themeColor: "#05080f" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="id">
      <body>
        <Shell>{children}</Shell>
      </body>
    </html>
  );
}