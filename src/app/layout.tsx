import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Templo Místico - CRM",
  description: "CRM Personal y Centro de Operaciones Esotéricas",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="es">
      <body className="bg-background text-gray-100 antialiased">{children}</body>
    </html>
  );
}