import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Agent 协作工作区",
  description: "让多个 Agent 围绕同一任务讨论、分工、修改，并由你最终验收。",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
