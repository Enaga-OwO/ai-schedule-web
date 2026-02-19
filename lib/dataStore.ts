// lib/dataStore.ts
// オンライン時: Vercel KV（サーバー）を正とする
// オフライン時: localStorage キャッシュにフォールバック
// → 複数端末から同じuserIDでアクセスすれば同じデータが見える

export interface Task {
  id: string;
  title: string;
  category: "study" | "exercise" | "hobby" | "other";
  startTime?: string;
  duration: number;
  status: "pending" | "active" | "done" | "skipped";
  createdAt: string;
}

export interface TimerState {
  taskId?: string;
  taskTitle?: string;
  startedAt?: string;
  duration: number;
  phase: "work" | "break";
  isRunning: boolean;
}

export interface UserData {
  userId: string;
  lineUserId?: string;
  profile: {
    name: string;
    goals: string[];
    createdAt: string;
  };
  schedule: {
    today: Task[];
    weekly: Record<string, Task[]>;
  };
  sessions: Array<{
    id: string;
    timestamp: string;
    source: "web" | "line";
    messages: Array<{ role: "user" | "assistant"; content: string }>;
  }>;
  stats: {
    studyMinutes: Record<string, number>;
    streaks: number;
    lastActiveDate: string;
    categories: Record<string, { totalMinutes: number; sessions: number }>;
  };
  timer: TimerState;
  updatedAt: string; // 複数端末の競合検出用
}

// =========================================================
// ローカルキャッシュ（オフライン + 高速読み取り用）
// =========================================================
const CACHE_PREFIX = "ai_schedule_user_";

function getCacheKey(userId: string) {
  return CACHE_PREFIX + userId;
}

function readCache(userId: string): UserData | null {
  try {
    const raw = localStorage.getItem(getCacheKey(userId));
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

function writeCache(data: UserData) {
  try {
    localStorage.setItem(getCacheKey(data.userId), JSON.stringify(data));
  } catch { /* ストレージ容量不足は無視 */ }
}

// =========================================================
// サーバーAPI（data.yourdomain.com / Vercel KV）
// =========================================================
const DATA_API_URL = process.env.DATA_API_URL || "";
const DATA_API_SECRET = process.env.DATA_API_SECRET || "";

function headers() {
  return { "Content-Type": "application/json", "X-API-Secret": DATA_API_SECRET };
}

// サーバーからユーザーデータ取得
async function fetchFromServer(userId: string): Promise<UserData | null> {
  if (!DATA_API_URL) return null;
  try {
    const res = await fetch(`${DATA_API_URL}/ai-schedule/api.php?userId=${userId}`, {
      headers: headers(),
      cache: "no-store",
      signal: AbortSignal.timeout(5000), // 5秒タイムアウト
    });
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`Server error: ${res.status}`);
    return await res.json();
  } catch (e) {
    console.warn("fetchFromServer failed (offline?):", e);
    return null;
  }
}

// サーバーへ保存
async function saveToServer(data: UserData): Promise<boolean> {
  if (!DATA_API_URL) return false;
  try {
    const res = await fetch(`${DATA_API_URL}/ai-schedule/api.php?userId=${data.userId}`, {
      method: "POST",
      headers: headers(),
      body: JSON.stringify(data),
      signal: AbortSignal.timeout(8000),
    });
    return res.ok;
  } catch (e) {
    console.warn("saveToServer failed (offline?):", e);
    return false;
  }
}

// =========================================================
// 公開API
// =========================================================

/**
 * ユーザーデータ取得
 * 優先順位: サーバー > ローカルキャッシュ
 */
export async function getUserData(userId: string): Promise<UserData | null> {
  // まずサーバーから取得を試みる
  const serverData = await fetchFromServer(userId);
  if (serverData) {
    writeCache(serverData); // キャッシュ更新
    return serverData;
  }
  // オフライン時はキャッシュを使う
  const cached = readCache(userId);
  if (cached) {
    console.info("オフラインモード: キャッシュからデータを読み込みました");
    return cached;
  }
  return null;
}

/**
 * データ保存
 * サーバーとローカルキャッシュの両方に書く
 */
export async function saveUserData(data: UserData): Promise<boolean> {
  data.updatedAt = new Date().toISOString();
  writeCache(data); // キャッシュに即書き（レスポンス速度のため）
  const ok = await saveToServer(data);
  if (!ok) {
    console.warn("サーバー保存失敗: オフラインキャッシュのみに保存");
  }
  return ok;
}

export function createDefaultUserData(userId: string): UserData {
  const today = new Date().toISOString().split("T")[0];
  return {
    userId,
    profile: { name: "ユーザー", goals: ["勉強習慣をつける"], createdAt: new Date().toISOString() },
    schedule: { today: [], weekly: {} },
    sessions: [],
    stats: {
      studyMinutes: {},
      streaks: 0,
      lastActiveDate: today,
      categories: {},
    },
    timer: { duration: 25, phase: "work", isRunning: false },
    updatedAt: new Date().toISOString(),
  };
}

export function addStudyTime(data: UserData, minutes: number, category = "study"): UserData {
  const today = new Date().toISOString().split("T")[0];
  const updated = structuredClone(data);
  updated.stats.studyMinutes[today] = (updated.stats.studyMinutes[today] || 0) + minutes;
  if (!updated.stats.categories[category]) {
    updated.stats.categories[category] = { totalMinutes: 0, sessions: 0 };
  }
  updated.stats.categories[category].totalMinutes += minutes;
  updated.stats.categories[category].sessions += 1;
  const yesterday = new Date(Date.now() - 86400000).toISOString().split("T")[0];
  if (updated.stats.lastActiveDate === yesterday) {
    updated.stats.streaks += 1;
  } else if (updated.stats.lastActiveDate !== today) {
    updated.stats.streaks = 1;
  }
  updated.stats.lastActiveDate = today;
  return updated;
}

export function addTask(data: UserData, task: Omit<Task, "id" | "createdAt">): UserData {
  const newTask: Task = { ...task, id: `task_${Date.now()}`, createdAt: new Date().toISOString() };
  return { ...data, schedule: { ...data.schedule, today: [...data.schedule.today, newTask] } };
}

export function completeTask(data: UserData, taskId: string): UserData {
  return {
    ...data,
    schedule: {
      ...data.schedule,
      today: data.schedule.today.map((t) =>
        t.id === taskId ? { ...t, status: "done" as const } : t
      ),
    },
  };
}

export function appendMessage(
  data: UserData,
  message: { role: "user" | "assistant"; content: string },
  source: "web" | "line"
): UserData {
  const today = new Date().toISOString().split("T")[0];
  const sessions = structuredClone(data.sessions);
  const idx = sessions.findIndex((s) => s.timestamp.startsWith(today) && s.source === source);
  if (idx >= 0) {
    sessions[idx].messages.push(message);
  } else {
    sessions.push({ id: `sess_${Date.now()}`, timestamp: new Date().toISOString(), source, messages: [message] });
  }
  return { ...data, sessions: sessions.slice(-30) };
}

export function getTodayMessages(data: UserData): Array<{ role: "user" | "assistant"; content: string }> {
  const today = new Date().toISOString().split("T")[0];
  return data.sessions
    .filter((s) => s.timestamp.startsWith(today))
    .flatMap((s) => s.messages)
    .slice(-20);
}

/**
 * ユーザーIDから共有URLを生成（複数端末でアクセスするときに使う）
 * 例: https://yourapp.com?userId=web_abc123
 */
export function getShareableUrl(userId: string): string {
  if (typeof window === "undefined") return "";
  return `${window.location.origin}?userId=${userId}`;
}
