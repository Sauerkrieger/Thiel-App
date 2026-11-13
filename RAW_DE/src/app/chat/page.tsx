import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { ChatPage } from "@/components/chat/chat-page";

export const metadata: Metadata = { title: "Chat" };

export default async function ChatRoute() {
  const user = await getCurrentUser();
  if (!user) redirect("/login?next=/chat");
  return <ChatPage userId={user.id} isAdmin={user.role === "admin"} />;
}
