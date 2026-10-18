import type { Metadata } from "next";
import { THEME_SCRIPT } from "./theme";
import "./globals.css";

export const metadata: Metadata = {
  title: "Object Mapper",
  description: "Map fields between two JSON objects",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    // data-theme is corrected by the inline script before paint, so React must accept the DOM's value.
    <html lang="en" data-theme="dark" className="h-full antialiased" suppressHydrationWarning>
      <head>
        {/* Runs from the server HTML; marked inert when React renders it on the client. */}
        <script
          type={typeof window === "undefined" ? "text/javascript" : "text/plain"}
          suppressHydrationWarning
          dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }}
        />
      </head>
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
