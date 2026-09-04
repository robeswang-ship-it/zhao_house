export type EventKind = "schedule" | "anniversary" | "birthday" | "personal";

export interface ButlerEvent {
  id: string;
  title: string;
  startsAt: string;
  location?: string;
  kind: EventKind;
  reminderMinutes: number;
  recurrence?: "yearly";
}

export interface Memory {
  id: string;
  content: string;
  category: "meal" | "fact" | "focus" | "note";
  createdAt: string;
}

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  createdAt: string;
}

export interface Dashboard {
  upcomingEvents: ButlerEvent[];
  pomodoroTodayMinutes: number;
  anniversaryDays: number;
  birthdayDays: number;
  apiConfigured: boolean;
}

export interface DraftEvent {
  title: string;
  startsAt: string;
  location?: string;
  kind: EventKind;
  reminderMinutes: number;
  recurrence?: "yearly";
}
