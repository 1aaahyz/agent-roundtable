import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "智能体圆桌 · Agent Roundtable",
  description: "多个 AI Agent 围坐同一任务讨论、分工、互相审校，由你主持并最终验收。全部运行在你自己的电脑上。",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
