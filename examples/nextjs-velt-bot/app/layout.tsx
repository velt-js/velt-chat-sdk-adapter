import type { ReactNode } from "react";

export const metadata = {
  title: "Velt Chat SDK Bot",
  description: "A Chat SDK bot running on Velt comment threads",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
