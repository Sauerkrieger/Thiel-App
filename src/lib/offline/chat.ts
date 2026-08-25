"use client";

import { getPendingRecords, getRecordsByIndex, newUuid, putRecord, putRecords, deleteRecord, type StoredRecord } from "./db";

type ChatQueueItem = StoredRecord & { data: { thread_id: string; body: string; kind: string; is_urgent: boolean; file?: File } };

export async function cacheChatMessages(messages: Array<Record<string, unknown>>): Promise<void> {
  const records = messages
    .filter((message): message is Record<string, unknown> & { id: string } => typeof message.id === "string")
    .map((message) => ({
      id: message.id,
      client_updated_at: String(message.created_at ?? new Date().toISOString()),
      sync_status: "synced" as const,
      data: message,
    }));
  await putRecords("chat_messages", records);
}

export async function readCachedChatMessages(threadId: string): Promise<Record<string, unknown>[]> {
  const records = await getRecordsByIndex("chat_messages", "thread_id", threadId);
  return records
    .sort((a, b) => String(a.data.created_at).localeCompare(String(b.data.created_at)))
    .map((record) => ({ ...record.data, id: record.id }));
}

export async function queueChatMessage(data: ChatQueueItem["data"]): Promise<string> {
  const id = newUuid();
  await putRecord("chat_messages", { id, client_updated_at: new Date().toISOString(), sync_status: "pending_upload", data: { ...data, id, created_at: new Date().toISOString() } });
  return id;
}

export async function pendingChatMessages(): Promise<ChatQueueItem[]> {
  return (await getPendingRecords("chat_messages")) as ChatQueueItem[];
}

export async function syncChatMessages(): Promise<void> {
  for (const record of await pendingChatMessages()) {
    const data = record.data;
    const form = new FormData();
    form.set("thread_id", data.thread_id);
    form.set("body", data.body);
    form.set("kind", data.kind);
    form.set("is_urgent", String(data.is_urgent));
    if (data.file instanceof File) form.set("file", data.file);
    const response = await fetch("/api/chat/messages", { method: "POST", body: form });
    if (!response.ok) continue;
    await deleteRecord("chat_messages", record.id);
  }
}
