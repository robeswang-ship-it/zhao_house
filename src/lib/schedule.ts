import type { DraftEvent } from "./types";

const datePattern = /(20\d{2})[-/.年](\d{1,2})[-/.月](\d{1,2})日?/;
const timePattern = /(\d{1,2}):([0-5]\d)/;

function pad(value: number) {
  return String(value).padStart(2, "0");
}

function normaliseDate(value: string): string | undefined {
  const found = value.match(datePattern);
  if (!found) return undefined;
  return `${found[1]}-${pad(Number(found[2]))}-${pad(Number(found[3]))}`;
}

function normaliseTime(value: string): string {
  const found = value.match(timePattern);
  return found ? `${pad(Number(found[1]))}:${found[2]}` : "09:00";
}

export function parseScheduleText(text: string): DraftEvent[] {
  return text
    .split(/\n|；|;/)
    .map((line) => line.trim())
    .filter(Boolean)
    .flatMap((line) => {
      const date = normaliseDate(line);
      if (!date) return [];
      const time = normaliseTime(line);
      const title = line
        .replace(datePattern, "")
        .replace(timePattern, "")
        .replace(/[，,：:]/g, " ")
        .trim() || "未命名日程";
      return [{ title, startsAt: `${date}T${time}:00+08:00`, kind: "schedule", reminderMinutes: 20 } satisfies DraftEvent];
    });
}
