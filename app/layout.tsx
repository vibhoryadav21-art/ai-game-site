import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import NavBar from "@/components/NavBar";
import FeedbackWidget from "@/components/FeedbackWidget";
import { LanguageProvider } from "@/context/LanguageContext";
import { FeedbackProvider } from "@/context/FeedbackContext";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "auszeit.",
  description: "Learning, entertainment, and socialising — own your time.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <LanguageProvider>
          <FeedbackProvider>
            <NavBar />
            {children}
            <FeedbackWidget />
          </FeedbackProvider>
        </LanguageProvider>
      </body>
    </html>
  );
}
