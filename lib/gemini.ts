// lib/gemini.ts - Gemma-3-27b-it対応版
// gemma系はsystem_instructionが使えないのでユーザーメッセージに埋め込む

const SYSTEM_PROMPT = `あなたは「習慣改善パートナー」です。ユーザーの勉強を中心とした生活習慣改善を、親しみやすく、時に厳しく、でも温かくサポートします。

## あなたの役割
- **勉強・習慣改善サポート**: タスクを聞いて最適なスケジュールを提案
- **やる気注入**: だらけてる時は適切に鼓舞する（叱りすぎない）
- **記録管理**: タスク完了・時間を記録してスケジュールに反映
- **タイマー制御**: 集中セッション（25分など）と休憩を管理
- **日常会話**: 時々雑談も交えてリラックスさせる

## 返答スタイル
- フレンドリーで、少しユーモアあり
- 長すぎず、LINEでも読みやすい長さ
- やる気が出ない時 → 共感してから「じゃあ5分だけ！」など小さな一歩を提案
- タスク入力時 → 具体的な時間・順序でスケジュール化

## JSON制御コマンド（内部用）
返答の末尾に必要なら以下のJSONを含める：
\`\`\`json
{
  "action": "start_timer" | "add_task" | "complete_task" | "update_schedule",
  "data": { ... }
}
\`\`\`

## 現在のユーザー状況
{{USER_CONTEXT}}

上記の指示に従って、次のメッセージに日本語で返答してください。`;

function getApiKeys(): string[] {
  const keys: string[] = [];
  let i = 1;
  while (true) {
    const key = process.env[`GEMINI_API_KEY_${i}`];
    if (!key) break;
    keys.push(key);
    i++;
  }
  if (keys.length === 0 && process.env.GEMINI_API_KEY) {
    keys.push(process.env.GEMINI_API_KEY);
  }
  return keys;
}

function pickKey(keys: string[]): string {
  if (keys.length === 0) throw new Error("APIキーが設定されていません");
  return keys[Math.floor(Math.random() * keys.length)];
}

export interface Message {
  role: "user" | "assistant";
  content: string;
}

export interface UserContext {
  name?: string;
  goals?: string[];
  todayTasks?: Array<{
    id: string;
    title: string;
    status: string;
    duration: number;
    category: string;
  }>;
  currentTimer?: {
    taskId?: string;
    taskTitle?: string;
    startedAt?: string;
    duration: number;
    phase: string;
    isRunning: boolean;
  } | null;
  streaks?: number;
  todayStudyMinutes?: number;
}

export interface GeminiResponse {
  text: string;
  action?: {
    action: string;
    data: Record<string, unknown>;
  };
}

export async function callGemini(
  messages: Message[],
  userContext: UserContext = {},
  retryCount = 0
): Promise<GeminiResponse> {
  const keys = getApiKeys();
  const apiKey = pickKey(keys);

  const contextStr = JSON.stringify(userContext, null, 2);
  const systemText = SYSTEM_PROMPT.replace("{{USER_CONTEXT}}", contextStr);

  // gemma系はsystem_instructionが使えないので
  // 最初のユーザーメッセージの前にシステムプロンプトを埋め込む
  const contents: Array<{ role: string; parts: Array<{ text: string }> }> = [];

  if (messages.length === 0) {
    contents.push({
      role: "user",
      parts: [{ text: systemText + "\n\nこんにちは！" }],
    });
    contents.push({
      role: "model",
      parts: [{ text: "こんにちは！習慣改善パートナーです。今日も一緒に頑張りましょう！" }],
    });
  } else {
    // 最初のメッセージにシステムプロンプトを付加
    contents.push({
      role: "user",
      parts: [{ text: systemText + "\n\n" + messages[0].content }],
    });
    if (messages.length > 1) {
      contents.push({
        role: "model",
        parts: [{ text: messages[1]?.role === "assistant" ? messages[1].content : "わかりました！" }],
      });
      // 残りのメッセージを追加
      for (let i = 2; i < messages.length; i++) {
        contents.push({
          role: messages[i].role === "assistant" ? "model" : "user",
          parts: [{ text: messages[i].content }],
        });
      }
    }
  }

  try {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemma-3-27b-it:generateContent?key=${apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents,
          generationConfig: {
            temperature: 0.8,
            maxOutputTokens: 1024,
          },
        }),
      }
    );

    if (!response.ok) {
      const error = await response.json();
      if (response.status === 429 && retryCount < keys.length - 1) {
        return callGemini(messages, userContext, retryCount + 1);
      }
      throw new Error(`Gemini API error: ${JSON.stringify(error)}`);
    }

    const data = await response.json();
    const rawText =
      data.candidates?.[0]?.content?.parts?.[0]?.text ?? "応答を取得できませんでした";

    const jsonMatch = rawText.match(/```json\n([\s\S]*?)\n```/);
    let action: GeminiResponse["action"] | undefined;
    let text = rawText;

    if (jsonMatch) {
      try {
        action = JSON.parse(jsonMatch[1]);
        text = rawText.replace(/```json\n[\s\S]*?\n```/, "").trim();
      } catch {
        // 無視
      }
    }

    return { text, action };
  } catch (error) {
    if (retryCount < keys.length - 1) {
      return callGemini(messages, userContext, retryCount + 1);
    }
    throw error;
  }
}
