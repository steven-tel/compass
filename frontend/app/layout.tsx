import type { Metadata, Viewport } from "next";
import { Poppins, Urbanist } from "next/font/google";
import { BottomNav } from "@/components/BottomNav";
import { PwaRegister } from "@/components/PwaRegister";
import { ScrollToTop } from "@/components/ScrollToTop";
import "katex/dist/katex.min.css";
import "./globals.css";

const poppins = Poppins({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800"],
});

const urbanist = Urbanist({
  subsets: ["latin"],
  weight: ["300", "400", "600"],
  variable: "--font-urbanist",
});

export const metadata: Metadata = {
  title: "Compass Tutor",
  description: "Mobile AI math tutor",
  applicationName: "Compass",
  appleWebApp: {
    capable: true,
    title: "Compass",
    statusBarStyle: "black-translucent",
  },
  icons: {
    icon: [
      { url: "/compass-mark.svg", type: "image/svg+xml" },
      { url: "/favicon.png", sizes: "32x32", type: "image/png" },
      { url: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
    apple: [{ url: "/apple-touch-icon.png", sizes: "180x180" }],
  },
  other: {
    "mobile-web-app-capable": "yes",
    "apple-mobile-web-app-capable": "yes",
    "apple-mobile-web-app-title": "Compass",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  viewportFit: "cover",
  themeColor: "#4F39F6",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className={`${poppins.className} ${urbanist.variable}`}>
        <div className="phone">
          <ScrollToTop />
          {children}
          <BottomNav />
        </div>
        <PwaRegister />
      </body>
    </html>
  );
}
