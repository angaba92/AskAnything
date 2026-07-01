import type { Metadata } from "next";
import "./globals.css";
import BatchProvider from "@/components/BatchProvider";
import ThemeToggle from "@/components/ThemeToggle";
import LogoutButton from "@/components/LogoutButton";

export const metadata: Metadata = {
  title: "AskAnything — DY Agents Client",
  description: "Your own client for Dynamic Yield's Experience OS Agents",
};

// Applied before paint to avoid a flash of the wrong theme. Defaults to the
// user's saved choice, else the OS preference.
const themeScript = `(function(){try{var t=localStorage.getItem('theme');if(!t){t=window.matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light';}if(t==='dark'){document.documentElement.classList.add('dark');}}catch(e){}})();`;

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body>
        <BatchProvider>{children}</BatchProvider>
        <LogoutButton />
        <ThemeToggle />
      </body>
    </html>
  );
}
