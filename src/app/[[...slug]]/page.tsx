"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { AppProvider } from "@/components/AppProvider";
import { AppShell } from "@/components/AppShell";
import { LoginView, OnboardingView, OverviewView, TasksView } from "@/components/views/CoreViews";
import { TaskRoomView } from "@/components/views/TaskRoomView";
import { AgentDetailView, AgentWizardView, AgentsView } from "@/components/views/AgentViews";
import { ArtifactDetailView, ArtifactsView, RunDetailView, RunsView } from "@/components/views/DeliveryViews";
import { ApprovalsView, MaterialsView, PlaceholderView, SettingsView } from "@/components/views/OpsViews";

function Router() {
  const pathname = usePathname() ?? "/";
  const router = useRouter();
  const [authState, setAuthState] = useState<"checking" | "ok" | "anonymous">("checking");

  useEffect(() => {
    if (pathname === "/login") { setAuthState("anonymous"); return; }
    let cancelled = false;
    fetch("/api/v1/auth/me", { cache: "no-store", credentials: "same-origin" })
      .then(async (r) => {
        if (cancelled) return;
        if (r.ok) {
          setAuthState("ok");
          if (pathname === "/") {
            const j = await r.json().catch(() => null);
            router.replace(j?.workspaceId ? `/workspaces/${j.workspaceId}` : "/login");
          }
        } else { setAuthState("anonymous"); router.replace("/login"); }
      })
      .catch(() => { if (!cancelled) { setAuthState("anonymous"); router.replace("/login"); } });
    return () => { cancelled = true; };
  }, [pathname, router]);

  if (pathname === "/login") return <LoginView />;
  if (authState === "checking" || pathname === "/") {
    return <div className="flex min-h-screen items-center justify-center bg-ink-50 text-[13px] text-ink-500">正在校验登录状态…</div>;
  }
  if (authState === "anonymous") return null;
  if (pathname === "/onboarding") return <OnboardingView />;

  const parts = pathname.split("/").filter(Boolean);
  // /workspaces/:workspaceId/...
  if (parts[0] !== "workspaces" || !parts[1]) return <PlaceholderView title="页面不存在" />;
  const section = parts[2];
  const id = parts[3];

  let content: React.ReactNode;
  switch (section) {
    case undefined:
      content = <OverviewView />; break;
    case "tasks":
      content = id ? <TaskRoomView taskId={id} /> : <TasksView />; break;
    case "agents":
      content = id === "new" ? <AgentWizardView /> : id ? <AgentDetailView agentId={id} /> : <AgentsView />; break;
    case "artifacts":
      content = id ? <ArtifactDetailView artifactId={id} /> : <ArtifactsView />; break;
    case "runs":
      content = id ? <RunDetailView runId={id} /> : <RunsView />; break;
    case "materials":
      content = <MaterialsView />; break;
    case "approvals":
      content = <ApprovalsView />; break;
    case "settings":
      content = <SettingsView />; break;
    case "members":
      content = <PlaceholderView title="成员管理" />; break;
    case "security":
      content = <PlaceholderView title="安全与审计" />; break;
    default:
      content = <PlaceholderView title="页面不存在" />;
  }

  return <AppShell>{content}</AppShell>;
}

export default function Page() {
  return (
    <AppProvider>
      <Router />
    </AppProvider>
  );
}
