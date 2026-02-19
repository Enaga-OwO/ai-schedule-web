// lib/notificationScheduler.ts - 厳しめ通知スケジューラー

export interface ScheduledNotification {
  id: string;
  title: string;
  body: string;
  scheduledAt: number;
  tag: string;
  type: "task_start" | "task_end" | "reminder" | "nag";
}

const NAG_INTERVAL_MS = 5 * 60 * 1000;   // 5分ごと
const NAG_START_DELAY_MS = 10 * 60 * 1000; // 10分後から開始
const STORAGE_KEY = "scheduled_notifications";

class NotificationScheduler {
  private timers: Map<string, ReturnType<typeof setTimeout>> = new Map();
  private nagTimer: ReturnType<typeof setInterval> | null = null;
  private nagStartTimer: ReturnType<typeof setTimeout> | null = null;

  async requestPermission(): Promise<boolean> {
    if (!("Notification" in window)) return false;
    if (Notification.permission === "granted") return true;
    if (Notification.permission === "denied") return false;
    return (await Notification.requestPermission()) === "granted";
  }

  get hasPermission(): boolean {
    return "Notification" in window && Notification.permission === "granted";
  }

  // タスクの通知をスケジュール
  scheduleTask(task: {
    id: string;
    title: string;
    startTime?: string;
    duration: number;
  }) {
    if (!task.startTime) return;
    const [h, m] = task.startTime.split(":").map(Number);
    const startAt = new Date();
    startAt.setHours(h, m, 0, 0);
    if (startAt.getTime() <= Date.now()) return;

    const endAt = new Date(startAt.getTime() + task.duration * 60 * 1000);
    const reminderAt = startAt.getTime() - 5 * 60 * 1000;

    if (reminderAt > Date.now()) {
      this.schedule({
        id: `reminder_${task.id}`,
        title: "⚡ 5分後にタスク開始",
        body: `「${task.title}」の準備をしよう！`,
        scheduledAt: reminderAt,
        tag: `reminder_${task.id}`,
        type: "reminder",
      });
    }

    this.schedule({
      id: `start_${task.id}`,
      title: "📚 タスク開始！",
      body: `「${task.title}」始めよう！(${task.duration}分)`,
      scheduledAt: startAt.getTime(),
      tag: `task_${task.id}`,
      type: "task_start",
    });

    this.schedule({
      id: `end_${task.id}`,
      title: "⏱ タスク完了！",
      body: `「${task.title}」お疲れ様！次は何する？`,
      scheduledAt: endAt.getTime(),
      tag: `task_end_${task.id}`,
      type: "task_end",
    });
  }

  schedule(notification: ScheduledNotification) {
    const delay = notification.scheduledAt - Date.now();
    if (delay < 0) return;
    const existing = this.timers.get(notification.id);
    if (existing) clearTimeout(existing);
    const timer = setTimeout(() => {
      this.fire(notification);
      this.timers.delete(notification.id);
      this.saveToStorage();
    }, delay);
    this.timers.set(notification.id, timer);
    this.saveToStorage();
  }

  private fire(notification: ScheduledNotification) {
    if (!this.hasPermission) return;
    const payload = {
      title: notification.title,
      body: notification.body,
      tag: notification.tag,
      icon: "/icon-192.png",
      vibrate: [100, 50, 100],
      requireInteraction: notification.type === "task_start" || notification.type === "nag",
      actions: notification.type === "task_start"
        ? [{ action: "start", title: "▶ 開始する" }, { action: "snooze", title: "💤 5分後に" }]
        : notification.type === "nag"
        ? [{ action: "open", title: "📱 今すぐ開く" }]
        : undefined,
      data: { url: "/", type: notification.type },
    };

    if ("serviceWorker" in navigator && navigator.serviceWorker.controller) {
      navigator.serviceWorker.controller.postMessage({ type: "SHOW_NOTIFICATION", payload });
    } else {
      new Notification(notification.title, { body: notification.body, tag: notification.tag, icon: "/icon-192.png", requireInteraction: payload.requireInteraction });
    }
  }

  // しつこい通知（10分後→5分ごと）
  startNagNotifications(customMessage?: string) {
    if (!this.hasPermission) return;
    this.stopNagNotifications();

    console.log("🔔 しつこい通知モード: 10分後スタート、5分ごと");

    this.nagStartTimer = setTimeout(() => {
      this.sendNag(customMessage);
      this.nagTimer = setInterval(() => this.sendNag(customMessage), NAG_INTERVAL_MS);
    }, NAG_START_DELAY_MS);
  }

  private sendNag(customMessage?: string) {
    const hour = new Date().getHours();
    // 夜23時〜朝6時は通知しない
    if (hour >= 23 || hour < 6) return;

    const messages = customMessage ? [customMessage] : [
      "📱 サボってない？アプリに戻ってきて！",
      "🧠 5分だけでいいからやろう。ほら。",
      "⏰ まだ休憩中？そろそろ再開しない？",
      "💪 タスクが待ってるよ！今すぐ開いて！",
      "🔥 ストリーク切れちゃうよ！急いで！",
      "😤 さっさとやること終わらせよう！",
      "📚 勉強サボり続けてる場合じゃないよ！",
    ];

    const msg = messages[Math.floor(Math.random() * messages.length)];
    this.fire({
      id: `nag_${Date.now()}`,
      title: "習慣改善パートナーより",
      body: msg,
      scheduledAt: Date.now(),
      tag: "nag",
      type: "nag",
    });
  }

  stopNagNotifications() {
    if (this.nagTimer) { clearInterval(this.nagTimer); this.nagTimer = null; }
    if (this.nagStartTimer) { clearTimeout(this.nagStartTimer); this.nagStartTimer = null; }
  }

  updateActivity() {
    this.stopNagNotifications();
  }

  // visibilitychange で自動開始・停止
  setupVisibilityTracking() {
    document.addEventListener("visibilitychange", () => {
      if (document.hidden) {
        this.startNagNotifications();
      } else {
        this.stopNagNotifications();
        this.updateActivity();
      }
    });
    // ページを離れる時も
    window.addEventListener("pagehide", () => this.startNagNotifications());
    window.addEventListener("pageshow", () => this.stopNagNotifications());
  }

  scheduleAllTasks(tasks: Array<{ id: string; title: string; startTime?: string; duration: number }>) {
    // タスク関連の既存タイマーだけクリア
    for (const [key, timer] of this.timers.entries()) {
      if (key.startsWith("start_") || key.startsWith("end_") || key.startsWith("reminder_")) {
        clearTimeout(timer);
        this.timers.delete(key);
      }
    }
    tasks.forEach((task) => this.scheduleTask(task));
  }

  clearAll() {
    this.timers.forEach((t) => clearTimeout(t));
    this.timers.clear();
    this.stopNagNotifications();
    localStorage.removeItem(STORAGE_KEY);
  }

  private saveToStorage() {
    // スケジュール済みIDのリストだけ保存（復元用）
    localStorage.setItem(STORAGE_KEY, JSON.stringify([...this.timers.keys()]));
  }

  restoreFromStorage() {
    // ページリロード時はサーバーからタスクを再取得してscheduleAllTasksを呼ぶ想定
    // ここでは何もしない（init()でloadInitialData()が呼ばれる）
  }
}

export const notificationScheduler = new NotificationScheduler();
