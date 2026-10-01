import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { AuthProvider } from "@/components/AuthProvider";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Drummer's Beat · 节拍鼓韵",
  description:
    "Create, edit, share and discover 24 Festive Drums (二十四节令鼓) scores in the browser.",
};

export const viewport: Viewport = {
  themeColor: "#f5f2eb",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      data-theme="light"
      suppressHydrationWarning
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: `(function(){try{var t=localStorage.getItem("drummer-theme");if(t==="dark"||t==="light")document.documentElement.dataset.theme=t}catch(e){}})()` }} />
      </head>
      <body className="flex min-h-full flex-col bg-zinc-950 text-zinc-100">
        <AuthProvider>
          <a
            href="#main"
            className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-lg focus:bg-amber-500 focus:px-4 focus:py-2 focus:text-zinc-950"
          >
            Skip to content 跳到主要内容
          </a>
          {children}
        </AuthProvider>
      </body>
    </html>
  );
}
