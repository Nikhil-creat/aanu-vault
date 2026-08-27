import "./globals.css";

export const metadata = {
  title: "AANU — Ultimate Vault",
  description: "Zero-knowledge personal data & file store. Only you can decrypt what's inside.",
  icons: {
    icon: "/aanu-icon.png",
    apple: "/aanu-icon.png",
  },
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body className="bg-[#0a0f1a] text-neutral-200 antialiased">{children}</body>
    </html>
  );
}
