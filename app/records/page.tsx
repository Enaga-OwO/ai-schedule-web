// app/api/chat/route.ts - チャットAPIエンドポイント

import { NextRequest, NextResponse } from "next/server";
import { callGemini } from "@/lib/gemini";
import {
  getUserData,
  saveUserData,
  createDefaultUserData,
  addTask,
  completeTask,
  addStudyTime,
  appendMessage,
  getTodayMessages,
} from "@/lib/dataStore";

export async function POST(req: NextRequest) {
  try {
    const { userId, message, source = "web" } = await req.json();

    if (!userId || !message) {
      return NextResponse.json({ error: "userId and message required" }, { status: 400 });
    }

    // ユーザーデータ取得
    let userData = await getUserData(userId);
    if (!userData) {
      userData = createDefaultUserData(userId);
    }

    // ユーザーメッセージを記録
    userData = appendMessage(userData, { role: "user", content: message }, source);

    // 今日の会話履歴を取得
    const history = getTodayMessages(userData);

    // AI呼び出し用コンテキスト
    const today = new Date().toISOString().split("T")[0];
    const userContext = {
      name: userData.profile.name,
      goals: userData.profile.goals,
      todayTasks: userData.schedule.today.map((t) => ({
        id: t.id,
        title: t.title,
        status: t.status,
        duration: t.duration,
        category: t.category,
      })),
      currentTimer: userData.timer.isRunning ? userData.timer : null,
      streaks: userData.stats.streaks,
      todayStudyMinutes: userData.stats.studyMinutes[today] || 0,
    };

    // Gemini API呼び出し
    const { text, action } = await callGemini(history, userContext);

    // AIのアクションを処理
    if (action) {
      switch (action.action) {
        case "add_task": {
          const taskData = action.data as {
            title: string;
            category?: "study" | "exercise" | "hobby" | "other";
            duration?: number;
            startTime?: string;
          };
          userData = addTask(userData, {
            title: taskData.title,
            category: taskData.category || "study",
            duration: taskData.duration || 25,
            startTime: taskData.startTime,
            status: "pending",
          });
          break;
        }
        case "complete_task": {
          const { taskId, minutes, category } = action.data as {
            taskId: string;
            minutes: number;
            category: string;
          };
          userData = completeTask(userData, taskId);
          userData = addStudyTime(userData, minutes || 25, category || "study");
          break;
        }
        case "start_timer": {
          const timerData = action.data as {
            taskId?: string;
            taskTitle?: string;
            duration?: number;
            phase?: "work" | "break";
          };
          userData.timer = {
            taskId: timerData.taskId,
            taskTitle: timerData.taskTitle,
            startedAt: new Date().toISOString(),
            duration: timerData.duration || 25,
            phase: timerData.phase || "work",
            isRunning: true,
          };
          break;
        }
        case "stop_timer": {
          userData.timer = { ...userData.timer, isRunning: false };
          break;
        }
      }
    }

    // AIの返答を記録
    userData = appendMessage(userData, { role: "assistant", content: text }, source);

    // データ保存
    await saveUserData(userData);

    return NextResponse.json({
      message: text,
      action,
      timer: userData.timer,
      todayTasks: userData.schedule.today,
      stats: {
        streaks: userData.stats.streaks,
        todayMinutes: userData.stats.studyMinutes[today] || 0,
      },
    });
  } catch (error) {
    console.error("Chat API error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
