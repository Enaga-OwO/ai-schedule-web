// app/api/user/route.ts - ユーザーデータ取得API

import { NextRequest, NextResponse } from "next/server";
import { getUserData, createDefaultUserData, getTodayMessages } from "@/lib/dataStore";

export async function GET(req: NextRequest) {
  const userId = req.nextUrl.searchParams.get("userId");
  if (!userId) {
    return NextResponse.json({ error: "userId required" }, { status: 400 });
  }

  let data = await getUserData(userId);
  if (!data) {
    data = createDefaultUserData(userId);
  }

  const today = new Date().toISOString().split("T")[0];

  return NextResponse.json({
    userId: data.userId,
    profile: data.profile,
    todayTasks: data.schedule.today,
    timer: data.timer,
    stats: {
      streaks: data.stats.streaks,
      todayMinutes: data.stats.studyMinutes[today] || 0,
      categories: data.stats.categories,
    },
    todayMessages: getTodayMessages(data),
  });
}
