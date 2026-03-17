import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { AuthProvider } from "@/context/AuthContext";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata = {
  title: "MARKHINS HUB",
  description: "MARKHINS HUB — Teacher Attendance System",
};

import { LoadingProvider } from "@/context/LoadingContext";

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased bg-gray-50 text-gray-900 min-h-screen`}
      >
        <AuthProvider>
          <LoadingProvider>
            <main className="max-w-md mx-auto min-h-screen">
              {children}
            </main>
          </LoadingProvider>
        </AuthProvider>
      </body>
    </html>
  );
}
