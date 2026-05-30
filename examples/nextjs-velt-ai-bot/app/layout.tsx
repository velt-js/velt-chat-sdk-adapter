import type { ReactNode } from "react";

export const metadata = {
  title: "Velt Chat SDK AI Bot",
  description: "An AI Chat SDK bot running on Velt comment threads",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
