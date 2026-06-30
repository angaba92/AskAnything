import type { Metadata } from "next";
import "./globals.css";
import BatchProvider from "@/components/BatchProvider";

export const metadata: Metadata = {
  title: "AskAnything — DY Agents Client",
  description: "Your own client for Dynamic Yield's Experience OS Agents",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>
        <BatchProvider>{children}</BatchProvider>
      </body>
    </html>
  );
}
