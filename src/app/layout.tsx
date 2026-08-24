import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Templo Místico - CRM",
  description: "CRM Personal y Centro de Operaciones Esotéricas",
  manifest: "/manifest.json",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "Templo Místico CRM",
  },
  icons: {
    icon: [
      { url: "/icons/icon-72x72.png", sizes: "72x72", type: "image/png" },
      { url: "/icons/icon-192x192.png", sizes: "192x192", type: "image/png" },
      { url: "/icons/icon-512x512.png", sizes: "512x512", type: "image/png" },
    ],
    apple: [{ url: "/icons/icon-192x192.png", sizes: "192x192" }],
  },
};

export const viewport: Viewport = {
  themeColor: "#8b5cf6",
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Aplica el tema guardado ANTES de pintar para evitar parpadeos
  const themeInit = `(function(){try{var m=localStorage.getItem("tm_theme_mode")||"dark";var a=localStorage.getItem("tm_theme_accent")||"purple";var l=m==="light"||(m==="system"&&window.matchMedia("(prefers-color-scheme: light)").matches);var r=document.documentElement;if(l)r.classList.add("light");r.setAttribute("data-accent",a);}catch(e){}})();`;
  return (
    <html lang="es" data-accent="purple" suppressHydrationWarning>
      <body className="bg-background text-gray-100 antialiased">
        <script dangerouslySetInnerHTML={{ __html: themeInit }} />
        {children}
      </body>
    </html>
  );
}