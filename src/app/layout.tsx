import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Verto",
  description: "Verto innovation pipeline MVP",
  icons: [{ rel: "icon", url: "/icon.svg", type: "image/svg+xml" }]
};

export default function RootLayout({
  children
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>
        <a className="skip-link" href="#workspace-main">
          Skip to main content
        </a>
        {children}
      </body>
    </html>
  );
}
