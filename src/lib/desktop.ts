import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { check, type DownloadEvent, type Update } from "@tauri-apps/plugin-updater";
import type { ButlerEvent, ChatMessage, Dashboard, DraftEvent, Memory } from "./types";

export const isDesktopApp = () => "__TAURI_INTERNALS__" in window;
const demoKey = "ba-zai-demo-state";

export type AvailableUpdate = {
  version: string;
  notes?: string;
  update: Update;
};

const demoDashboard: Dashboard = {
  upcomingEvents: [
    {
      id: "anniversary",
      title: "你们的纪念日 ✦",
      startsAt: "2026-09-11T00:00:00+08:00",
      kind: "anniversary",
      reminderMinutes: 1440,
      recurrence: "yearly",
    },
  ],
  pomodoroTodayMinutes: 0,
  anniversaryDays: 7,
  birthdayDays: 297,
  apiConfigured: false,
};

function readDemo(): Dashboard {
  try {
    const saved = localStorage.getItem(demoKey);
    return saved ? { ...demoDashboard, ...JSON.parse(saved) } : demoDashboard;
  } catch {
    return demoDashboard;
  }
}

function saveDemo(next: Dashboard) {
  localStorage.setItem(demoKey, JSON.stringify(next));
}

export async function dashboard(): Promise<Dashboard> {
  return isDesktopApp() ? invoke<Dashboard>("get_dashboard") : readDemo();
}

export async function createEvent(input: DraftEvent): Promise<ButlerEvent> {
  if (isDesktopApp()) return invoke<ButlerEvent>("create_event", { input });
  const next = readDemo();
  const event: ButlerEvent = { ...input, id: crypto.randomUUID() };
  next.upcomingEvents = [...next.upcomingEvents, event].sort((a, b) => a.startsAt.localeCompare(b.startsAt));
  saveDemo(next);
  return event;
}

export async function chooseExcelSchedule(): Promise<DraftEvent[]> {
  if (!isDesktopApp()) throw new Error("Excel 导入需要在 BA仔桌面版中使用");
  const path = await open({
    multiple: false,
    directory: false,
    filters: [{ name: "课程表", extensions: ["xlsx", "xls", "xlsm", "xlsb", "ods"] }],
  });
  return typeof path === "string" ? invoke<DraftEvent[]>("parse_excel_schedule", { path }) : [];
}

export async function listMemories(): Promise<Memory[]> {
  if (isDesktopApp()) return invoke<Memory[]>("list_memories");
  return JSON.parse(localStorage.getItem("ba-zai-demo-memories") ?? "[]") as Memory[];
}

export async function addMemory(content: string, category: Memory["category"]): Promise<Memory> {
  if (isDesktopApp()) return invoke<Memory>("add_memory", { content, category });
  const memory: Memory = { id: crypto.randomUUID(), content, category, createdAt: new Date().toISOString() };
  const list = await listMemories();
  localStorage.setItem("ba-zai-demo-memories", JSON.stringify([memory, ...list]));
  return memory;
}

export async function listChats(): Promise<ChatMessage[]> {
  if (isDesktopApp()) return invoke<ChatMessage[]>("list_chats");
  return JSON.parse(localStorage.getItem("ba-zai-demo-chats") ?? "[]") as ChatMessage[];
}

export async function saveApiKey(apiKey: string): Promise<void> {
  if (isDesktopApp()) return invoke("save_api_key", { apiKey });
  localStorage.setItem("ba-zai-demo-key", apiKey ? "configured" : "");
}

export async function sendChat(message: string): Promise<ChatMessage> {
  if (isDesktopApp()) return invoke<ChatMessage>("send_chat", { message });
  const fallback: ChatMessage = {
    id: crypto.randomUUID(),
    role: "assistant",
    content: "我现在处于演示模式。安装桌面版后，给我一把 API 密钥，我就可以认真回答啦。",
    createdAt: new Date().toISOString(),
  };
  const chats = await listChats();
  localStorage.setItem("ba-zai-demo-chats", JSON.stringify([...chats, fallback]));
  return fallback;
}

export async function completePomodoro(minutes: number): Promise<void> {
  if (isDesktopApp()) return invoke("complete_pomodoro", { minutes });
  const next = readDemo();
  next.pomodoroTodayMinutes += minutes;
  saveDemo(next);
}

export async function checkDueReminders(): Promise<void> {
  if (isDesktopApp()) await invoke("check_due_reminders");
}

export async function openControlPanel(): Promise<void> {
  if (isDesktopApp()) {
    await invoke("open_control_panel");
    return;
  }
  window.location.assign("/control.html");
}

export async function hideControlPanel(): Promise<void> {
  if (isDesktopApp()) {
    await invoke("hide_control_panel");
    return;
  }
  window.location.assign("/pet.html");
}

export async function startWindowDragging(): Promise<void> {
  if (isDesktopApp()) await invoke("start_window_drag");
}

export async function quitApp(): Promise<void> {
  if (isDesktopApp()) {
    await invoke("quit_app");
    return;
  }
  window.close();
}

export async function reportFrontendReady(page: "pet" | "control"): Promise<void> {
  if (isDesktopApp()) await invoke("report_frontend_ready", { page });
}

export async function checkForUpdate(): Promise<AvailableUpdate | null> {
  if (!isDesktopApp()) return null;
  const update = await check({ timeout: 8_000 });
  return update ? { version: update.version, notes: update.body, update } : null;
}

export async function downloadAndInstallUpdate(update: AvailableUpdate, onProgress: (event: DownloadEvent) => void): Promise<void> {
  await update.update.downloadAndInstall(onProgress);
}
