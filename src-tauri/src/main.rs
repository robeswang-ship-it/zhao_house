#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use calamine::{open_workbook_auto, Reader};
use chrono::{DateTime, Datelike, Duration, Local, NaiveDate};
use keyring::Entry;
use reqwest::blocking::Client;
use rusqlite::{params, Connection, Row};
use serde::{Deserialize, Serialize};
use serde_json::json;
use std::{collections::HashSet, env, fs, sync::Mutex, time::Duration as StdDuration};
use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Manager, PhysicalPosition, State, WebviewWindow, WindowEvent,
};
use tauri_plugin_notification::NotificationExt;
use uuid::Uuid;

const KEYRING_SERVICE: &str = "BA仔-小猫管家";
const KEYRING_ACCOUNT: &str = "openai-api-key";

struct AppState {
    database: Mutex<Connection>,
    frontends_ready: Mutex<HashSet<String>>,
}

#[derive(Debug, Deserialize, Serialize)]
struct PetPosition {
    x: i32,
    y: i32,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct ButlerEvent {
    id: String,
    title: String,
    starts_at: String,
    location: Option<String>,
    kind: String,
    reminder_minutes: i64,
    recurrence: Option<String>,
}

#[derive(Debug, Deserialize, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct DraftEvent {
    title: String,
    starts_at: String,
    location: Option<String>,
    kind: String,
    reminder_minutes: i64,
    recurrence: Option<String>,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct Memory {
    id: String,
    content: String,
    category: String,
    created_at: String,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct ChatMessage {
    id: String,
    role: String,
    content: String,
    created_at: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct Dashboard {
    upcoming_events: Vec<ButlerEvent>,
    pomodoro_today_minutes: i64,
    anniversary_days: i64,
    birthday_days: i64,
    api_configured: bool,
}

#[derive(Deserialize)]
struct ResponsesContent {
    #[serde(rename = "type")]
    kind: String,
    text: Option<String>,
}

#[derive(Deserialize)]
struct ResponsesOutput {
    #[serde(rename = "type")]
    kind: String,
    content: Option<Vec<ResponsesContent>>,
}

#[derive(Deserialize)]
struct ResponsesResponse {
    output: Option<Vec<ResponsesOutput>>,
}

fn api_key_entry() -> Result<Entry, String> {
    Entry::new(KEYRING_SERVICE, KEYRING_ACCOUNT).map_err(|error| error.to_string())
}

fn event_from_row(row: &Row<'_>) -> rusqlite::Result<ButlerEvent> {
    Ok(ButlerEvent {
        id: row.get(0)?,
        title: row.get(1)?,
        starts_at: row.get(2)?,
        location: row.get(3)?,
        kind: row.get(4)?,
        reminder_minutes: row.get(5)?,
        recurrence: row.get(6)?,
    })
}

fn memory_from_row(row: &Row<'_>) -> rusqlite::Result<Memory> {
    Ok(Memory {
        id: row.get(0)?,
        content: row.get(1)?,
        category: row.get(2)?,
        created_at: row.get(3)?,
    })
}

fn chat_from_row(row: &Row<'_>) -> rusqlite::Result<ChatMessage> {
    Ok(ChatMessage {
        id: row.get(0)?,
        role: row.get(1)?,
        content: row.get(2)?,
        created_at: row.get(3)?,
    })
}

fn normalise_excel_date(value: &str) -> Option<String> {
    let parts = value
        .split(|character: char| !character.is_ascii_digit())
        .filter(|part| !part.is_empty())
        .collect::<Vec<_>>();
    let year = parts.first()?.parse::<i32>().ok()?;
    let month = parts.get(1)?.parse::<u32>().ok()?;
    let day = parts.get(2)?.parse::<u32>().ok()?;
    NaiveDate::from_ymd_opt(year, month, day).map(|date| date.to_string())
}

fn normalise_excel_time(value: &str) -> String {
    let parts = value
        .split(|character: char| !character.is_ascii_digit())
        .filter(|part| !part.is_empty())
        .collect::<Vec<_>>();
    let hour = parts
        .first()
        .and_then(|part| part.parse::<u32>().ok())
        .filter(|hour| *hour < 24);
    let minute = parts
        .get(1)
        .and_then(|part| part.parse::<u32>().ok())
        .filter(|minute| *minute < 60);
    match (hour, minute) {
        (Some(hour), Some(minute)) => format!("{hour:02}:{minute:02}"),
        _ => "09:00".to_owned(),
    }
}

fn excel_field(headers: &[String], row: &[String], aliases: &[&str]) -> Option<String> {
    headers
        .iter()
        .position(|header| aliases.iter().any(|alias| header.contains(alias)))
        .and_then(|index| row.get(index))
        .map(|value| value.trim().to_owned())
        .filter(|value| !value.is_empty())
}

fn next_annual_date(month: u32, day: u32) -> NaiveDate {
    let today = Local::now().date_naive();
    let mut target = NaiveDate::from_ymd_opt(today.year(), month, day).expect("valid annual date");
    if target < today {
        target = NaiveDate::from_ymd_opt(today.year() + 1, month, day).expect("valid annual date");
    }
    target
}

fn days_until(month: u32, day: u32) -> i64 {
    (next_annual_date(month, day) - Local::now().date_naive()).num_days()
}

fn seed_special_dates(connection: &Connection) -> Result<(), String> {
    let anniversary = format!("{}T00:00:00+08:00", next_annual_date(9, 11));
    let birthday = format!("{}T09:00:00+08:00", next_annual_date(6, 28));
    connection
        .execute(
            "INSERT INTO events (id, title, starts_at, kind, reminder_minutes, recurrence)
             VALUES ('relationship-anniversary', '你们的纪念日 ✦', ?1, 'anniversary', 1440, 'yearly')
             ON CONFLICT(id) DO UPDATE SET starts_at = excluded.starts_at",
            params![anniversary],
        )
        .map_err(|error| error.to_string())?;
    connection
        .execute(
            "INSERT INTO events (id, title, starts_at, kind, reminder_minutes, recurrence)
             VALUES ('birthday', '她的生日 ✦', ?1, 'birthday', 10080, 'yearly')
             ON CONFLICT(id) DO UPDATE SET starts_at = excluded.starts_at",
            params![birthday],
        )
        .map_err(|error| error.to_string())?;
    Ok(())
}

fn initialise_database(app: &AppHandle) -> Result<Connection, String> {
    let data_dir = app
        .path()
        .app_local_data_dir()
        .map_err(|error| error.to_string())?;
    fs::create_dir_all(&data_dir).map_err(|error| error.to_string())?;
    let connection =
        Connection::open(data_dir.join("ba-zai.sqlite3")).map_err(|error| error.to_string())?;
    connection
        .execute_batch(
            "PRAGMA journal_mode = WAL;
             CREATE TABLE IF NOT EXISTS events (
                id TEXT PRIMARY KEY, title TEXT NOT NULL, starts_at TEXT NOT NULL,
                location TEXT, kind TEXT NOT NULL, reminder_minutes INTEGER NOT NULL,
                recurrence TEXT, notified_at TEXT
             );
             CREATE TABLE IF NOT EXISTS memories (
                id TEXT PRIMARY KEY, content TEXT NOT NULL, category TEXT NOT NULL,
                created_at TEXT NOT NULL
             );
             CREATE TABLE IF NOT EXISTS chats (
                id TEXT PRIMARY KEY, role TEXT NOT NULL, content TEXT NOT NULL,
                created_at TEXT NOT NULL
             );
             CREATE TABLE IF NOT EXISTS pomodoro_sessions (
                id TEXT PRIMARY KEY, minutes INTEGER NOT NULL, completed_at TEXT NOT NULL
             );
             CREATE TABLE IF NOT EXISTS settings (
                key TEXT PRIMARY KEY, value TEXT NOT NULL
             );",
        )
        .map_err(|error| error.to_string())?;
    seed_special_dates(&connection)?;
    Ok(connection)
}

fn restore_pet_position(app: &AppHandle) {
    let Some(state) = app.try_state::<AppState>() else {
        return;
    };
    let Ok(connection) = state.database.lock() else {
        return;
    };
    let saved_position = connection
        .query_row(
            "SELECT value FROM settings WHERE key = 'pet-position'",
            [],
            |row| row.get::<_, String>(0),
        )
        .ok();
    drop(connection);
    let Some(saved_position) = saved_position else {
        return;
    };
    let Ok(position) = serde_json::from_str::<PetPosition>(&saved_position) else {
        return;
    };
    if let Some(pet_window) = app.get_webview_window("main") {
        let _ = pet_window.set_position(PhysicalPosition::new(position.x, position.y));
    }
}

fn persist_pet_position(app: &AppHandle, position: PhysicalPosition<i32>) {
    let Some(state) = app.try_state::<AppState>() else {
        return;
    };
    let Ok(connection) = state.database.lock() else {
        return;
    };
    let value = json!(PetPosition {
        x: position.x,
        y: position.y,
    })
    .to_string();
    let _ = connection.execute(
        "INSERT INTO settings (key, value) VALUES ('pet-position', ?1)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        params![value],
    );
}

fn api_configured() -> bool {
    api_key_entry()
        .and_then(|entry| entry.get_password().map_err(|error| error.to_string()))
        .is_ok()
}

#[tauri::command]
fn get_dashboard(state: State<'_, AppState>) -> Result<Dashboard, String> {
    let connection = state
        .database
        .lock()
        .map_err(|_| "本地数据库暂时不可用".to_owned())?;
    seed_special_dates(&connection)?;
    let now = Local::now().to_rfc3339();
    let mut statement = connection
        .prepare("SELECT id, title, starts_at, location, kind, reminder_minutes, recurrence FROM events WHERE starts_at >= ?1 ORDER BY starts_at ASC LIMIT 12")
        .map_err(|error| error.to_string())?;
    let upcoming_events = statement
        .query_map(params![now], event_from_row)
        .map_err(|error| error.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| error.to_string())?;
    let today = Local::now().date_naive().to_string();
    let pomodoro_today_minutes = connection
        .query_row(
            "SELECT COALESCE(SUM(minutes), 0) FROM pomodoro_sessions WHERE substr(completed_at, 1, 10) = ?1",
            params![today],
            |row| row.get(0),
        )
        .map_err(|error| error.to_string())?;
    Ok(Dashboard {
        upcoming_events,
        pomodoro_today_minutes,
        anniversary_days: days_until(9, 11),
        birthday_days: days_until(6, 28),
        api_configured: api_configured(),
    })
}

#[tauri::command]
fn create_event(state: State<'_, AppState>, input: DraftEvent) -> Result<ButlerEvent, String> {
    let event = ButlerEvent {
        id: Uuid::new_v4().to_string(),
        title: input.title.trim().to_owned(),
        starts_at: input.starts_at,
        location: input.location.filter(|value| !value.trim().is_empty()),
        kind: input.kind,
        reminder_minutes: input.reminder_minutes,
        recurrence: input.recurrence,
    };
    if event.title.is_empty() {
        return Err("日程需要一个名称".to_owned());
    }
    let connection = state
        .database
        .lock()
        .map_err(|_| "本地数据库暂时不可用".to_owned())?;
    connection
        .execute(
            "INSERT INTO events (id, title, starts_at, location, kind, reminder_minutes, recurrence) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            params![event.id, event.title, event.starts_at, event.location, event.kind, event.reminder_minutes, event.recurrence],
        )
        .map_err(|error| error.to_string())?;
    Ok(event)
}

#[tauri::command]
fn parse_excel_schedule(path: String) -> Result<Vec<DraftEvent>, String> {
    let metadata = fs::metadata(&path).map_err(|_| "找不到选择的 Excel 文件".to_owned())?;
    if metadata.len() > 10 * 1024 * 1024 {
        return Err("课程表请控制在 10 MB 以内".to_owned());
    }
    let extension = std::path::Path::new(&path)
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or_default()
        .to_ascii_lowercase();
    if !matches!(extension.as_str(), "xls" | "xlsx" | "xlsm" | "xlsb" | "ods") {
        return Err("请选择 Excel 或 ODS 表格文件".to_owned());
    }
    let mut workbook =
        open_workbook_auto(&path).map_err(|error| format!("无法读取表格：{error}"))?;
    let sheet_name = workbook
        .sheet_names()
        .first()
        .cloned()
        .ok_or_else(|| "这个表格没有工作表".to_owned())?;
    let range = workbook
        .worksheet_range(&sheet_name)
        .map_err(|error| format!("无法读取工作表：{error}"))?;
    let mut rows = range.rows();
    let headers = rows
        .next()
        .ok_or_else(|| "这个工作表是空的".to_owned())?
        .iter()
        .map(|cell| cell.to_string().to_lowercase())
        .collect::<Vec<_>>();
    let events = rows
        .take(250)
        .filter_map(|cells| {
            let row = cells.iter().map(ToString::to_string).collect::<Vec<_>>();
            let date = excel_field(&headers, &row, &["日期", "date", "day"])?;
            let title = excel_field(
                &headers,
                &row,
                &["事项", "课程", "标题", "内容", "title", "course", "event"],
            )?;
            let time = excel_field(&headers, &row, &["时间", "time", "开始"]).unwrap_or_default();
            let starts_at = format!(
                "{}T{}:00+08:00",
                normalise_excel_date(&date)?,
                normalise_excel_time(&time)
            );
            Some(DraftEvent {
                title,
                starts_at,
                location: excel_field(&headers, &row, &["地点", "教室", "location", "place"]),
                kind: "schedule".to_owned(),
                reminder_minutes: 20,
                recurrence: None,
            })
        })
        .collect::<Vec<_>>();
    if events.is_empty() {
        return Err(
            "没能识别日期和事项列。请确保第一行包含“日期”和“课程/事项/标题”一类的列名。".to_owned(),
        );
    }
    Ok(events)
}

#[tauri::command]
fn list_memories(state: State<'_, AppState>) -> Result<Vec<Memory>, String> {
    let connection = state
        .database
        .lock()
        .map_err(|_| "本地数据库暂时不可用".to_owned())?;
    let mut statement = connection
        .prepare("SELECT id, content, category, created_at FROM memories ORDER BY created_at DESC LIMIT 80")
        .map_err(|error| error.to_string())?;
    let memories = statement
        .query_map([], memory_from_row)
        .map_err(|error| error.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| error.to_string())?;
    Ok(memories)
}

#[tauri::command]
fn add_memory(
    state: State<'_, AppState>,
    content: String,
    category: String,
) -> Result<Memory, String> {
    let memory = Memory {
        id: Uuid::new_v4().to_string(),
        content: content.trim().to_owned(),
        category,
        created_at: Local::now().to_rfc3339(),
    };
    if memory.content.is_empty() {
        return Err("记忆内容不能为空".to_owned());
    }
    let connection = state
        .database
        .lock()
        .map_err(|_| "本地数据库暂时不可用".to_owned())?;
    connection
        .execute(
            "INSERT INTO memories (id, content, category, created_at) VALUES (?1, ?2, ?3, ?4)",
            params![
                memory.id,
                memory.content,
                memory.category,
                memory.created_at
            ],
        )
        .map_err(|error| error.to_string())?;
    Ok(memory)
}

#[tauri::command]
fn list_chats(state: State<'_, AppState>) -> Result<Vec<ChatMessage>, String> {
    let connection = state
        .database
        .lock()
        .map_err(|_| "本地数据库暂时不可用".to_owned())?;
    let mut statement = connection
        .prepare(
            "SELECT id, role, content, created_at FROM chats ORDER BY created_at DESC LIMIT 40",
        )
        .map_err(|error| error.to_string())?;
    let mut result = statement
        .query_map([], chat_from_row)
        .map_err(|error| error.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| error.to_string())?;
    result.reverse();
    Ok(result)
}

#[tauri::command]
fn complete_pomodoro(state: State<'_, AppState>, minutes: i64) -> Result<(), String> {
    if !(1..=180).contains(&minutes) {
        return Err("专注时长不合理".to_owned());
    }
    let connection = state
        .database
        .lock()
        .map_err(|_| "本地数据库暂时不可用".to_owned())?;
    connection
        .execute(
            "INSERT INTO pomodoro_sessions (id, minutes, completed_at) VALUES (?1, ?2, ?3)",
            params![
                Uuid::new_v4().to_string(),
                minutes,
                Local::now().to_rfc3339()
            ],
        )
        .map_err(|error| error.to_string())?;
    Ok(())
}

#[tauri::command]
fn check_due_reminders(app: AppHandle, state: State<'_, AppState>) -> Result<usize, String> {
    let connection = state
        .database
        .lock()
        .map_err(|_| "本地数据库暂时不可用".to_owned())?;
    let mut statement = connection
        .prepare(
            "SELECT id, title, starts_at, location, kind, reminder_minutes, recurrence
             FROM events WHERE notified_at IS NULL ORDER BY starts_at ASC LIMIT 100",
        )
        .map_err(|error| error.to_string())?;
    let events = statement
        .query_map([], event_from_row)
        .map_err(|error| error.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| error.to_string())?;
    let now = Local::now().fixed_offset();
    let due_events = events
        .into_iter()
        .filter(|event| {
            let Ok(starts_at) = DateTime::parse_from_rfc3339(&event.starts_at) else {
                return false;
            };
            let reminder_at = starts_at - Duration::minutes(event.reminder_minutes);
            reminder_at <= now && starts_at >= now - Duration::hours(2)
        })
        .collect::<Vec<_>>();
    for event in &due_events {
        let body = format!(
            "{}{}",
            event
                .location
                .as_deref()
                .map(|location| format!("地点：{location} · "))
                .unwrap_or_default(),
            "BA仔来提醒你啦。"
        );
        app.notification()
            .builder()
            .title(format!("{} 即将开始", event.title))
            .body(body)
            .show()
            .map_err(|error| error.to_string())?;
        connection
            .execute(
                "UPDATE events SET notified_at = ?1 WHERE id = ?2",
                params![now.to_rfc3339(), event.id],
            )
            .map_err(|error| error.to_string())?;
    }
    Ok(due_events.len())
}

#[tauri::command]
fn save_api_key(api_key: String) -> Result<(), String> {
    let key = api_key.trim();
    if !key.starts_with("sk-") || key.len() < 20 {
        return Err("这看起来不像可用的 API 密钥".to_owned());
    }
    api_key_entry()?
        .set_password(key)
        .map_err(|error| error.to_string())
}

fn setting(connection: &Connection, key: &str, default_value: &str) -> String {
    connection
        .query_row(
            "SELECT value FROM settings WHERE key = ?1",
            params![key],
            |row| row.get(0),
        )
        .unwrap_or_else(|_| default_value.to_owned())
}

fn chat_context(connection: &Connection) -> Result<String, String> {
    let now = Local::now().to_rfc3339();
    let mut event_statement = connection
        .prepare("SELECT title, starts_at, location FROM events WHERE starts_at >= ?1 ORDER BY starts_at ASC LIMIT 4")
        .map_err(|error| error.to_string())?;
    let events = event_statement
        .query_map(params![now], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, Option<String>>(2)?,
            ))
        })
        .map_err(|error| error.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| error.to_string())?;
    let mut memory_statement = connection
        .prepare("SELECT content, category FROM memories ORDER BY created_at DESC LIMIT 6")
        .map_err(|error| error.to_string())?;
    let memories = memory_statement
        .query_map([], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
        })
        .map_err(|error| error.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| error.to_string())?;
    let event_text = events
        .into_iter()
        .map(|(title, starts_at, location)| {
            format!(
                "- {starts_at}: {title}{}",
                location
                    .map(|value| format!("（{value}）"))
                    .unwrap_or_default()
            )
        })
        .collect::<Vec<_>>()
        .join("\n");
    let memory_text = memories
        .into_iter()
        .map(|(content, category)| format!("- [{category}] {content}"))
        .collect::<Vec<_>>()
        .join("\n");
    Ok(format!(
        "当前时间：{}\n近期日程：\n{}\n\n最近本地记忆：\n{}",
        Local::now().format("%Y-%m-%d %H:%M"),
        event_text,
        memory_text
    ))
}

fn extract_response_text(response: ResponsesResponse) -> Option<String> {
    response.output?.into_iter().find_map(|item| {
        if item.kind != "message" {
            return None;
        }
        item.content?.into_iter().find_map(|content| {
            if content.kind == "output_text" {
                content.text
            } else {
                None
            }
        })
    })
}

#[tauri::command]
fn send_chat(state: State<'_, AppState>, message: String) -> Result<ChatMessage, String> {
    let question = message.trim().to_owned();
    if question.is_empty() {
        return Err("想和 BA仔说点什么？".to_owned());
    }
    let key = api_key_entry()?
        .get_password()
        .map_err(|_| "请先在设置中连接 AI".to_owned())?;
    let (context, model) = {
        let connection = state
            .database
            .lock()
            .map_err(|_| "本地数据库暂时不可用".to_owned())?;
        (
            chat_context(&connection)?,
            setting(&connection, "model", "gpt-5.6-terra"),
        )
    };
    let instructions = format!(
        "你是 BA仔，一只会照顾主人的黑白花小猫桌宠。你活泼、温柔、简洁，用自然中文交流。你只能把以下本地上下文当作参考，不能声称看到了电脑上的其他内容。若用户要求创建或更改日程、记录饮食或记忆，先把建议说清楚，并提醒她到对应页面确认。\n\n{context}"
    );
    let response = Client::new()
        .post("https://api.openai.com/v1/responses")
        .bearer_auth(key)
        .json(&json!({
            "model": model,
            "store": false,
            "instructions": instructions,
            "input": [{"role": "user", "content": [{"type": "input_text", "text": question}]}]
        }))
        .send()
        .map_err(|error| format!("连接 AI 失败：{error}"))?;
    if !response.status().is_success() {
        return Err(format!("AI 返回了错误：{}", response.status()));
    }
    let answer = extract_response_text(
        response
            .json::<ResponsesResponse>()
            .map_err(|error| error.to_string())?,
    )
    .unwrap_or_else(|| "我刚才走神啦，可以再说一遍吗？".to_owned());
    let assistant_message = ChatMessage {
        id: Uuid::new_v4().to_string(),
        role: "assistant".to_owned(),
        content: answer,
        created_at: Local::now().to_rfc3339(),
    };
    let connection = state
        .database
        .lock()
        .map_err(|_| "本地数据库暂时不可用".to_owned())?;
    connection
        .execute(
            "INSERT INTO chats (id, role, content, created_at) VALUES (?1, 'user', ?2, ?3)",
            params![
                Uuid::new_v4().to_string(),
                question,
                Local::now().to_rfc3339()
            ],
        )
        .map_err(|error| error.to_string())?;
    connection
        .execute(
            "INSERT INTO chats (id, role, content, created_at) VALUES (?1, ?2, ?3, ?4)",
            params![
                assistant_message.id,
                assistant_message.role,
                assistant_message.content,
                assistant_message.created_at
            ],
        )
        .map_err(|error| error.to_string())?;
    Ok(assistant_message)
}

#[tauri::command]
fn show_reminder(app: AppHandle, title: String, body: String) -> Result<(), String> {
    app.notification()
        .builder()
        .title(title)
        .body(body)
        .show()
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn set_pass_through(window: WebviewWindow, enabled: bool) -> Result<(), String> {
    window
        .set_ignore_cursor_events(enabled)
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn start_window_drag(window: WebviewWindow) -> Result<(), String> {
    window.start_dragging().map_err(|error| error.to_string())
}

#[tauri::command]
fn report_frontend_ready(
    app: AppHandle,
    state: State<'_, AppState>,
    page: String,
) -> Result<(), String> {
    let should_exit = {
        let mut ready = state
            .frontends_ready
            .lock()
            .map_err(|_| "启动自检状态暂时不可用".to_owned())?;
        ready.insert(page);
        env::var("BAZAI_SMOKE_TEST").as_deref() == Ok("1")
            && ready.contains("pet")
            && ready.contains("control")
    };
    if should_exit {
        std::thread::spawn(move || {
            std::thread::sleep(StdDuration::from_millis(150));
            app.exit(0);
        });
    }
    Ok(())
}

#[tauri::command]
fn set_pet_size(app: AppHandle, size: String) -> Result<(), String> {
    let (width, height) = match size.as_str() {
        "small" => (176.0, 220.0),
        "large" => (300.0, 370.0),
        _ => (230.0, 285.0),
    };
    let pet_window = app
        .get_webview_window("main")
        .ok_or_else(|| "暂时找不到 BA仔窗口".to_owned())?;
    pet_window
        .set_size(tauri::LogicalSize::new(width, height))
        .map_err(|error| error.to_string())
}

fn show_control_window(app: &AppHandle) -> Result<(), String> {
    if let Some(pet_window) = app.get_webview_window("main") {
        pet_window.show().map_err(|error| error.to_string())?;
    }
    let control_window = app
        .get_webview_window("control")
        .ok_or_else(|| "小猫管家窗口没有完成初始化，请重新启动 BA仔".to_owned())?;
    control_window.show().map_err(|error| error.to_string())?;
    control_window
        .set_focus()
        .map_err(|error| error.to_string())?;
    Ok(())
}

#[tauri::command]
fn open_control_panel(app: AppHandle) -> Result<(), String> {
    show_control_window(&app)
}

#[tauri::command]
fn hide_control_panel(app: AppHandle) -> Result<(), String> {
    if let Some(control_window) = app.get_webview_window("control") {
        control_window.hide().map_err(|error| error.to_string())?;
    }
    Ok(())
}

fn hide_pet_window(app: &AppHandle) -> Result<(), String> {
    if let Some(pet_window) = app.get_webview_window("main") {
        pet_window.hide().map_err(|error| error.to_string())?;
    }
    Ok(())
}

fn center_pet_window(app: &AppHandle) -> Result<(), String> {
    let pet_window = app
        .get_webview_window("main")
        .ok_or_else(|| "暂时找不到 BA仔窗口".to_owned())?;
    pet_window.center().map_err(|error| error.to_string())?;
    pet_window.show().map_err(|error| error.to_string())
}

fn create_tray(app: &tauri::App) -> tauri::Result<()> {
    let open_control = MenuItem::with_id(app, "open-control", "打开小猫管家", true, None::<&str>)?;
    let hide_pet = MenuItem::with_id(app, "hide-pet", "暂时藏起 BA仔", true, None::<&str>)?;
    let center_pet =
        MenuItem::with_id(app, "center-pet", "将 BA仔放回屏幕中央", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "退出 BA仔", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&open_control, &hide_pet, &center_pet, &quit])?;
    let icon = app
        .default_window_icon()
        .cloned()
        .expect("BA仔需要应用图标");

    TrayIconBuilder::with_id("ba-zai-tray")
        .icon(icon)
        .tooltip("BA仔 · 小猫管家")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id().as_ref() {
            "open-control" => {
                let _ = show_control_window(app);
            }
            "hide-pet" => {
                let _ = hide_pet_window(app);
            }
            "center-pet" => {
                let _ = center_pet_window(app);
            }
            "quit" => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if matches!(
                event,
                TrayIconEvent::Click {
                    button: MouseButton::Left,
                    button_state: MouseButtonState::Up,
                    ..
                }
            ) {
                let _ = show_control_window(tray.app_handle());
            }
        })
        .build(app)?;
    Ok(())
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            let database = initialise_database(&app.handle())?;
            app.manage(AppState {
                database: Mutex::new(database),
                frontends_ready: Mutex::new(HashSet::new()),
            });
            create_tray(app)?;
            restore_pet_position(&app.handle());
            if let Some(pet_window) = app.get_webview_window("main") {
                let pet_for_events = pet_window.clone();
                let app_for_events = app.handle().clone();
                pet_window.on_window_event(move |event| match event {
                    WindowEvent::CloseRequested { api, .. } => {
                        api.prevent_close();
                        let _ = pet_for_events.hide();
                    }
                    WindowEvent::Moved(position) => {
                        persist_pet_position(&app_for_events, *position);
                    }
                    _ => {}
                });
            }
            if env::var("BAZAI_SMOKE_TEST").as_deref() == Ok("1") {
                if let Some(control_window) = app.get_webview_window("control") {
                    control_window.show()?;
                }
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_dashboard,
            create_event,
            parse_excel_schedule,
            list_memories,
            add_memory,
            list_chats,
            complete_pomodoro,
            check_due_reminders,
            save_api_key,
            send_chat,
            show_reminder,
            set_pass_through,
            start_window_drag,
            report_frontend_ready,
            set_pet_size,
            open_control_panel,
            hide_control_panel
        ])
        .run(tauri::generate_context!())
        .expect("BA仔启动失败");
}
