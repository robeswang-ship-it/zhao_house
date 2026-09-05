import { useEffect, useMemo, useState } from "react";
import { addMemory, checkDueReminders, checkForUpdate, chooseExcelSchedule, completePomodoro, createEvent, dashboard, downloadAndInstallUpdate, hideControlPanel, isDesktopApp, listChats, listMemories, saveApiKey, sendChat, type AvailableUpdate } from "./lib/desktop";
import { parseScheduleText } from "./lib/schedule";
import type { ButlerEvent, ChatMessage, Dashboard, DraftEvent, Memory } from "./lib/types";
import { readSkin, saveSkin, skins, type PetAction, type Skin } from "./lib/skins";
import { applyPetSize, petSizes, readPetSize, type PetSize } from "./lib/petSize";
import { PetAvatar } from "./components/PetAvatar";

type View = "home" | "schedule" | "focus" | "memory" | "settings";
const tabLabels: Record<View, string> = {
  home: "陪伴",
  schedule: "日程",
  focus: "专注",
  memory: "记忆",
  settings: "设置",
};

const categoryLabel: Record<Memory["category"], string> = {
  meal: "吃了什么",
  fact: "小事记住",
  focus: "专注记录",
  note: "随手记",
};

function formatDate(value: string) {
  return new Intl.DateTimeFormat("zh-CN", { month: "numeric", day: "numeric", weekday: "short", hour: "2-digit", minute: "2-digit" }).format(new Date(value));
}

function defaultEvent(): DraftEvent {
  const date = new Date(Date.now() + 24 * 60 * 60 * 1000);
  date.setHours(9, 0, 0, 0);
  const localDateTime = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}T${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
  return { title: "", startsAt: `${localDateTime}:00+08:00`, kind: "schedule", reminderMinutes: 20 };
}

function EventRow({ event }: { event: ButlerEvent }) {
  return <li className="event-row"><span className={`event-dot ${event.kind}`} /><div><strong>{event.title}</strong><small>{formatDate(event.startsAt)}{event.location ? ` · ${event.location}` : ""}</small></div></li>;
}

export default function App() {
  const [view, setView] = useState<View>("home");
  const [data, setData] = useState<Dashboard>();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [memories, setMemories] = useState<Memory[]>([]);
  const [message, setMessage] = useState("");
  const [sending, setSending] = useState(false);
  const [pomoRunning, setPomoRunning] = useState(false);
  const [secondsLeft, setSecondsLeft] = useState(25 * 60);
  const [kick, setKick] = useState(false);
  const [draft, setDraft] = useState<DraftEvent>(defaultEvent);
  const [scheduleText, setScheduleText] = useState("");
  const [preview, setPreview] = useState<DraftEvent[]>([]);
  const [memoryText, setMemoryText] = useState("");
  const [memoryCategory, setMemoryCategory] = useState<Memory["category"]>("note");
  const [apiKey, setApiKey] = useState("");
  const [notice, setNotice] = useState("");
  const [skin, setSkin] = useState<Skin>(readSkin);
  const [petSize, setPetSize] = useState<PetSize>(readPetSize);
  const [availableUpdate, setAvailableUpdate] = useState<AvailableUpdate | null>(null);
  const [updateState, setUpdateState] = useState<"idle" | "checking" | "latest" | "available" | "installing" | "error">("idle");
  const [updateMessage, setUpdateMessage] = useState("更新服务将在正式发布后启用。");

  const petAction = useMemo<PetAction>(() => kick ? "kick" : sending ? "talk" : pomoRunning ? "focus" : "idle", [kick, sending, pomoRunning]);

  async function refresh() {
    const [nextData, nextChats, nextMemories] = await Promise.all([dashboard(), listChats(), listMemories()]);
    setData(nextData);
    setMessages(nextChats);
    setMemories(nextMemories);
  }

  useEffect(() => { void refresh(); }, []);

  useEffect(() => {
    if (isDesktopApp()) void lookForUpdate(true);
  }, []);

  useEffect(() => () => { void availableUpdate?.update.close(); }, [availableUpdate]);

  useEffect(() => {
    saveSkin(skin);
  }, [skin]);

  useEffect(() => {
    const check = () => void checkDueReminders().catch(() => undefined);
    check();
    const handle = window.setInterval(check, 45_000);
    return () => window.clearInterval(handle);
  }, []);

  useEffect(() => {
    if (!pomoRunning) return;
    const handle = window.setInterval(() => setSecondsLeft((value) => value - 1), 1000);
    return () => window.clearInterval(handle);
  }, [pomoRunning]);

  useEffect(() => {
    if (secondsLeft > 0 || !pomoRunning) return;
    setPomoRunning(false);
    setSecondsLeft(25 * 60);
    void completePomodoro(25).then(refresh);
    setNotice("专注完成！BA仔已经帮你记下这 25 分钟。 ✦");
  }, [secondsLeft, pomoRunning]);

  async function handleChat() {
    const content = message.trim();
    if (!content || sending) return;
    const userMessage: ChatMessage = { id: crypto.randomUUID(), role: "user", content, createdAt: new Date().toISOString() };
    setMessages((items) => [...items, userMessage]);
    setMessage("");
    setSending(true);
    try {
      const answer = await sendChat(content);
      setMessages((items) => [...items, answer]);
    } catch (error) {
      setMessages((items) => [...items, { id: crypto.randomUUID(), role: "assistant", content: `我暂时没能连上 AI：${String(error)}`, createdAt: new Date().toISOString() }]);
    } finally {
      setSending(false);
      void refresh();
    }
  }

  async function saveDraft(event: DraftEvent) {
    if (!event.title.trim()) return setNotice("先给这件事起个名字吧。"), undefined;
    await createEvent(event);
    setDraft(defaultEvent());
    setPreview([]);
    setNotice("收好啦，BA仔会提前提醒。 ✦");
    await refresh();
  }

  async function savePreview() {
    await Promise.all(preview.map(createEvent));
    setPreview([]);
    setNotice("这些日程都存到 BA仔的本地小本本里了。 ✦");
    await refresh();
  }

  async function addMemoryEntry() {
    if (!memoryText.trim()) return;
    await addMemory(memoryText.trim(), memoryCategory);
    setMemoryText("");
    setNotice("我会悄悄记住这件小事。 ✦");
    await refresh();
  }

  async function persistKey() {
    if (!apiKey.trim()) return;
    await saveApiKey(apiKey.trim());
    setApiKey("");
    setNotice("API 密钥已存入系统凭据库，不会显示在 BA仔的聊天记录里。 ✦");
    await refresh();
  }

  async function lookForUpdate(quiet = false) {
    setUpdateState("checking");
    try {
      const nextUpdate = await checkForUpdate();
      if (nextUpdate) {
        setAvailableUpdate(nextUpdate);
        setUpdateState("available");
        setUpdateMessage(`发现 v${nextUpdate.version}，准备好后由你确认安装。`);
      } else {
        setAvailableUpdate(null);
        setUpdateState("latest");
        setUpdateMessage("已经是最新版本啦。 ✦");
      }
    } catch (error) {
      setAvailableUpdate(null);
      setUpdateState("error");
      setUpdateMessage(quiet ? "更新服务尚未发布；正式版会自动启用。" : `暂时无法检查更新：${String(error)}`);
    }
  }

  async function installAvailableUpdate() {
    if (!availableUpdate || updateState === "installing") return;
    setUpdateState("installing");
    setUpdateMessage(`正在下载 v${availableUpdate.version}…`);
    try {
      await downloadAndInstallUpdate(availableUpdate, (event) => {
        if (event.event === "Started") setUpdateMessage(`正在下载 v${availableUpdate.version}…`);
        if (event.event === "Finished") setUpdateMessage("下载完成，正在交给 Windows 安装并重启 BA仔…");
      });
    } catch (error) {
      setUpdateState("error");
      setUpdateMessage(`更新没有完成：${String(error)}`);
    }
  }

  function playKick() {
    if (kick) return;
    setKick(true);
    window.setTimeout(() => setKick(false), 2100);
  }

  async function changePetSize(size: PetSize) {
    setPetSize(size);
    try {
      await applyPetSize(size);
      setNotice(`BA仔已经变成${petSizes[size].label}尺寸啦。 ✦`);
    } catch (error) {
      setNotice(`暂时没能调整大小：${String(error)}`);
    }
  }

  return (
    <main className="app-shell">
      <header className="topbar" data-tauri-drag-region>
        <div className="brand" data-tauri-drag-region><span>BA仔</span><small>小猫管家</small></div>
        <div className="top-actions"><button className="claw-button" type="button" onClick={playKick} title="豆包踢球彩蛋">✦</button><button className="close-button" type="button" onClick={() => void hideControlPanel()} title="收起到 BA仔身边">×</button></div>
      </header>

      <section className={`pet-stage ${skin === "snow" ? "snow-stage" : "queen-stage"}`}>
        <span className="halo halo-one" /><span className="halo halo-two" />
        {skin === "snow" && <span className="snow-drift" aria-hidden="true"><i /><i /><i /><i /><i /></span>}
        <PetAvatar action={petAction} onClick={playKick} skin={skin} label="点击 BA仔，触发豆包踢球彩蛋" />
        {kick && <><span className="kick-mark">踢！</span><span className="dou-ball">豆</span></>}
        <div className="speech">{kick ? "哼，今天也别想抢我的陪伴位！" : pomoRunning ? "一起专注，我会守着你。" : sending ? "让我想想喵……" : "晚上好，今天想让我帮什么忙？"}</div>
      </section>

      <nav className="tabs" aria-label="BA仔功能">
        {(Object.keys(tabLabels) as View[]).map((item) => <button key={item} className={view === item ? "active" : ""} type="button" onClick={() => setView(item)}>{tabLabels[item]}</button>)}
      </nav>

      {notice && <button className="notice" type="button" onClick={() => setNotice("")}>{notice}<span>×</span></button>}

      <section className="panel">
        {view === "home" && <>
          <div className="countdowns">
            <div><small>离纪念日</small><strong>{data?.anniversaryDays ?? "…"}<em>天</em></strong></div>
            <div><small>离她生日</small><strong>{data?.birthdayDays ?? "…"}<em>天</em></strong></div>
            <div><small>今日专注</small><strong>{data?.pomodoroTodayMinutes ?? "…"}<em>分</em></strong></div>
          </div>
          <div className="section-heading"><h2>接下来</h2><button type="button" onClick={() => setView("schedule")}>查看全部</button></div>
          <ul className="event-list">{data?.upcomingEvents.slice(0, 3).map((event) => <EventRow event={event} key={event.id} />) ?? <li>正在翻小本本……</li>}</ul>
          <div className="chat-box">
            <div className="chat-history">{messages.slice(-3).map((item) => <p className={item.role} key={item.id}>{item.content}</p>)}</div>
            <form onSubmit={(event) => { event.preventDefault(); void handleChat(); }}><input value={message} onChange={(event) => setMessage(event.target.value)} placeholder={data?.apiConfigured ? "和 BA仔说点什么…" : "先到设置里连接 AI"} /><button disabled={sending} type="submit">↗</button></form>
          </div>
        </>}

        {view === "schedule" && <>
          <div className="section-heading"><h2>新建日程</h2><span>全部确认后写入本地</span></div>
          <div className="form-grid">
            <input value={draft.title} onChange={(event) => setDraft({ ...draft, title: event.target.value })} placeholder="要做什么？" />
            <input type="datetime-local" value={draft.startsAt.slice(0, 16)} onChange={(event) => setDraft({ ...draft, startsAt: `${event.target.value}:00+08:00` })} />
            <input value={draft.location ?? ""} onChange={(event) => setDraft({ ...draft, location: event.target.value })} placeholder="地点（可选）" />
            <select value={draft.reminderMinutes} onChange={(event) => setDraft({ ...draft, reminderMinutes: Number(event.target.value) })}><option value="10">提前 10 分钟</option><option value="20">提前 20 分钟</option><option value="60">提前 1 小时</option></select>
          </div>
          <button className="primary wide" type="button" onClick={() => void saveDraft(draft)}>让 BA仔记下</button>
          <details className="importer"><summary>从文字或 Excel 导入日程</summary><textarea value={scheduleText} onChange={(event) => setScheduleText(event.target.value)} placeholder="例如：2026年9月8日 14:30 金融学作业答疑，A302" /><div className="import-actions"><button type="button" onClick={() => setPreview(parseScheduleText(scheduleText))}>解析文字</button><button type="button" onClick={() => void chooseExcelSchedule().then(setPreview).catch((error) => setNotice(String(error)))}>选择 Excel</button></div></details>
          {preview.length > 0 && <div className="preview"><div className="section-heading"><h2>导入预览</h2><button type="button" onClick={() => void savePreview()}>确认 {preview.length} 项</button></div><ul className="event-list">{preview.map((event, index) => <EventRow event={{ ...event, id: String(index) }} key={`${event.title}-${index}`} />)}</ul></div>}
          <div className="section-heading"><h2>已安排</h2></div><ul className="event-list">{data?.upcomingEvents.map((event) => <EventRow event={event} key={event.id} />)}</ul>
        </>}

        {view === "focus" && <>
          <div className="focus-card"><span>番茄钟</span><strong>{String(Math.floor(secondsLeft / 60)).padStart(2, "0")}:{String(secondsLeft % 60).padStart(2, "0")}</strong><p>{pomoRunning ? "BA仔正在认真守护你的专注时间。" : "25 分钟，只做眼前这一件事。"}</p><button className="primary" type="button" onClick={() => setPomoRunning((value) => !value)}>{pomoRunning ? "暂停一下" : "开始专注"}</button><button className="text-button" type="button" onClick={() => { setPomoRunning(false); setSecondsLeft(25 * 60); }}>重新开始</button></div>
          <div className="ritual"><span>✦</span><p>每完成一个番茄钟，BA仔会留下一个小爪印，也会把专注时间写进今天的记忆。</p></div>
        </>}

        {view === "memory" && <>
          <div className="section-heading"><h2>今天的小事</h2><span>只存本机</span></div>
          <div className="memory-entry"><select value={memoryCategory} onChange={(event) => setMemoryCategory(event.target.value as Memory["category"])}>{Object.entries(categoryLabel).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select><input value={memoryText} onChange={(event) => setMemoryText(event.target.value)} placeholder="比如：今天午饭吃了麻辣烫" /><button type="button" onClick={() => void addMemoryEntry()}>记住</button></div>
          <ul className="memory-list">{memories.length ? memories.map((item) => <li key={item.id}><span>{categoryLabel[item.category]}</span><p>{item.content}</p><small>{new Date(item.createdAt).toLocaleDateString("zh-CN")}</small></li>) : <li className="empty">第一件小事，等你告诉我。</li>}</ul>
        </>}

        {view === "settings" && <>
          <div className="section-heading"><h2>AI 连接</h2><span>{data?.apiConfigured ? "已连接" : "尚未连接"}</span></div>
          <p className="settings-copy">输入一次 API 密钥后，BA仔会把它交给系统凭据库保管；它不会被写进聊天、数据库或安装包。</p>
          <div className="key-entry"><input type="password" value={apiKey} onChange={(event) => setApiKey(event.target.value)} placeholder="sk-…" autoComplete="off" /><button className="primary" type="button" onClick={() => void persistKey()}>保存</button></div>
          <div className="setting-card update-card"><strong>程序更新</strong><span>{updateMessage}</span><div><button type="button" disabled={updateState === "checking" || updateState === "installing"} onClick={() => void lookForUpdate()}>{updateState === "checking" ? "检查中…" : "检查更新"}</button>{availableUpdate && <button className="primary" type="button" disabled={updateState === "installing"} onClick={() => void installAvailableUpdate()}>{updateState === "installing" ? "下载中…" : `更新至 v${availableUpdate.version}`}</button>}</div></div>
          <div className="skin-card">
            <div><strong>换皮肤</strong><span>两套皮肤会记住你的选择</span></div>
            <div className="skin-picker">
              {(Object.entries(skins) as [Skin, typeof skins[Skin]][]).map(([id, item]) => <button className={skin === id ? "selected" : ""} type="button" onClick={() => setSkin(id)} key={id} aria-pressed={skin === id}>
                <img src={item.image} alt="" />
                <span><b>{item.label}</b><small>{item.detail}</small></span>
                {skin === id && <em>当前</em>}
              </button>)}
            </div>
          </div>
          <div className="setting-card"><strong>桌宠大小</strong><span>选择后立即生效，并会记住</span><div className="size-picker">
            {(Object.entries(petSizes) as [PetSize, typeof petSizes[PetSize]][]).map(([id, item]) => <button className={petSize === id ? "selected" : ""} type="button" onClick={() => void changePetSize(id)} key={id} aria-pressed={petSize === id}>{item.label}</button>)}
          </div></div>
          <div className="setting-card"><strong>彩蛋</strong><span>豆包踢球模式</span><button type="button" onClick={playKick}>试试看</button></div>
          <p className="settings-copy tiny">纪念日：每年 9 月 11 日 · 生日：每年 6 月 28 日。以后可以在这里补充更多专属事件与台词。</p>
        </>}
      </section>
    </main>
  );
}
