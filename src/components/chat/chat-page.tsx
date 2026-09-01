"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, ArrowDown, ArrowLeft, Camera, Check, CheckCheck, ImagePlus, Languages, Mic, Paperclip, Phone, Play, Send, Square, Users, Volume2 } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useRealtimeRefresh } from "@/lib/realtime";
import { cacheChatMessages, pendingChatMessages, queueChatMessage, readCachedChatMessages, syncChatMessages } from "@/lib/offline/chat";

type Contact = { id: string; name: string; role: string; phone?: string | null };
type Message = {
  id: string;
  thread_id: string;
  sender_id: string;
  kind: "text" | "image" | "audio";
  body: string | null;
  media_path: string | null;
  media_url?: string | null;
  media_mime_type: string | null;
  transcript: string | null;
  is_urgent: boolean;
  status: "sent" | "delivered" | "read";
  understood_at: string | null;
  created_at: string;
  pending?: boolean;
};
type Thread = {
  id: string;
  employee_id: string;
  admin_id: string;
  contact?: Contact | null;
  unreadCount: number;
  lastMessage?: Message | null;
};

const ROLE_LABELS: Record<string, string> = {
  admin: "Admin",
  driver: "Fahrer",
  facility_manager: "Reinigungskraft",
  cleaner: "Reinigungskraft",
  substitute: "Springer",
};

function formatMessageTime(createdAt: string) {
  return new Intl.DateTimeFormat("de-DE", {
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(createdAt));
}

function AudioPlayer({ src }: { src: string }) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState(false);

  async function toggle() {
    if (!audioRef.current) return;
    if (playing) audioRef.current.pause();
    else await audioRef.current.play();
    setPlaying(!playing);
  }

  return (
    <div className="flex items-center gap-2">
      <audio ref={audioRef} src={src} onEnded={() => setPlaying(false)} className="hidden" />
      <Button type="button" size="sm" variant="outline" onClick={() => void toggle()}>
        <Play className="h-3.5 w-3.5" /> {playing ? "Pause" : "Abspielen"}
      </Button>
      <span className="text-xs text-muted-foreground">Sprachnachricht</span>
    </div>
  );
}

export function ChatPage({ userId, isAdmin }: { userId: string; isAdmin: boolean }) {
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [threads, setThreads] = useState<Thread[]>([]);
  const [selectedThread, setSelectedThread] = useState<Thread | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [body, setBody] = useState("");
  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState("all");
  const [selectedContactIds, setSelectedContactIds] = useState<string[]>([]);
  const [broadcast, setBroadcast] = useState(false);
  const [broadcastConfirmOpen, setBroadcastConfirmOpen] = useState(false);
  const [urgent, setUrgent] = useState(false);
  const [attachment, setAttachment] = useState<File | null>(null);
  const [recording, setRecording] = useState(false);
  const [recordingFile, setRecordingFile] = useState<File | null>(null);
  const [offlineNotice, setOfflineNotice] = useState(false);
  const [pendingCount, setPendingCount] = useState(0);
  const [pushPrompt, setPushPrompt] = useState(false);
  const [language, setLanguage] = useState<string | null>(null);
  const [supportPhone, setSupportPhone] = useState<string | null>(null);
  const [languageDialog, setLanguageDialog] = useState(false);
  const [languageInput, setLanguageInput] = useState("English");
  const [translation, setTranslation] = useState<Record<string, string>>({});
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const selectedThreadIdRef = useRef<string | null>(null);
  const messagesContainerRef = useRef<HTMLDivElement | null>(null);
  const [showScrollToBottom, setShowScrollToBottom] = useState(false);
  const sendingRef = useRef(false);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const loadSummary = useCallback(async () => {
    const response = await fetch("/api/chat/summary", { cache: "no-store" });
    if (!response.ok) throw new Error("Chat konnte nicht geladen werden.");
    const data = await response.json();
    if (!response.ok) throw new Error(data.error ?? "Kontakte konnten nicht geladen werden.");
    setContacts(data.contacts ?? []);
    setLanguage(data.preferredLanguage ?? null);
    setSelectedContactIds((current) => current.length ? current : (data.contacts ?? []).slice(0, 1).map((contact: Contact) => contact.id));
    setThreads(data.threads ?? []);
    try { localStorage.setItem(`thiel-chat-summary:${userId}`, JSON.stringify(data)); } catch { /* lokaler Speicher ist optional */ }
    if (selectedThreadIdRef.current) {
      const current = (data.threads ?? []).find((thread: Thread) => thread.id === selectedThreadIdRef.current);
      if (current) setSelectedThread(current);
    }
  }, [userId]);

  const scrollMessagesToBottom = useCallback((behavior: ScrollBehavior = "smooth") => {
    const container = messagesContainerRef.current;
    if (!container) return;
    container.scrollTo({ top: container.scrollHeight, behavior });
  }, []);

  function updateScrollToBottomVisibility() {
    const container = messagesContainerRef.current;
    if (!container) return;
    const distanceFromBottom = container.scrollHeight - container.scrollTop - container.clientHeight;
    setShowScrollToBottom(distanceFromBottom > 80);
  }

  async function loadMessages(threadId: string, refreshSummary = true) {
    try {
      const response = await fetch(`/api/chat/messages?thread_id=${encodeURIComponent(threadId)}`, { cache: "no-store" });
      if (!response.ok) throw new Error("Chat offline");
      const data = await response.json();
      setMessages((current) => {
        const pending = current.filter((message) => message.pending && message.thread_id === threadId);
        const serverMessages = data.messages ?? [];
        return [...serverMessages, ...pending.filter((message) => !serverMessages.some((serverMessage: Message) => serverMessage.body === message.body && serverMessage.sender_id === message.sender_id && Math.abs(new Date(serverMessage.created_at).getTime() - new Date(message.created_at).getTime()) < 30_000))];
      });
      setShowScrollToBottom(false);
      await cacheChatMessages(data.messages ?? []);
      setOfflineNotice(false);
      if (refreshSummary) void loadSummary();
    } catch {
      try {
        const cached = await readCachedChatMessages(threadId);
        setMessages(cached as Message[]);
        setShowScrollToBottom(false);
        setOfflineNotice(true);
      } catch { /* kein lokaler Verlauf vorhanden */ }
    }
  }

  useEffect(() => {
    if (!selectedThread) return;
    const frame = window.requestAnimationFrame(() => scrollMessagesToBottom("auto"));
    return () => window.cancelAnimationFrame(frame);
  }, [selectedThread, scrollMessagesToBottom]);

  useEffect(() => {
    if (!selectedThread || messages.length === 0) return;
    const container = messagesContainerRef.current;
    if (!container) return;
    const frame = window.requestAnimationFrame(() => {
      const wasNearBottom = container.scrollHeight - container.scrollTop - container.clientHeight < 120;
      if (wasNearBottom) scrollMessagesToBottom("auto");
      updateScrollToBottomVisibility();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [messages, selectedThread, scrollMessagesToBottom]);

  useEffect(() => {
    try {
      const cached = JSON.parse(localStorage.getItem(`thiel-chat-summary:${userId}`) ?? "null") as { contacts?: Contact[]; threads?: Thread[]; preferredLanguage?: string | null } | null;
      if (cached) { setContacts(cached.contacts ?? []); setThreads(cached.threads ?? []); setLanguage(cached.preferredLanguage ?? null); }
    } catch { /* lokaler Speicher ist optional */ }
    void loadSummary().catch((error) => {
      toast.error(error instanceof Error ? error.message : "Kontakte konnten nicht geladen werden.");
      setOfflineNotice(true);
    });
    void fetch("/api/chat/config", { cache: "no-store" }).then((response) => response.ok ? response.json() : null).then((data) => setSupportPhone(data?.supportPhoneNumber ?? null)).catch(() => {});
    void pendingChatMessages().then((items) => setPendingCount(items.length)).catch(() => {});
    if ("Notification" in window && Notification.permission === "default" && "serviceWorker" in navigator) void navigator.serviceWorker.ready.then(() => setPushPrompt(true)).catch(() => {});
  }, [loadSummary, userId]);
  async function enablePush() {
    if (!("Notification" in window) || !("serviceWorker" in navigator)) return;
    const permission = await Notification.requestPermission();
    if (permission !== "granted") { setPushPrompt(false); return; }
    const registration = await navigator.serviceWorker.ready;
    const configResponse = await fetch("/api/chat/config", { cache: "no-store" });
    const config = await configResponse.json();
    if (!config.vapidPublicKey) { toast.error("Push-Benachrichtigungen sind noch nicht konfiguriert."); setPushPrompt(false); return; }
    const base64 = config.vapidPublicKey.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(config.vapidPublicKey.length / 4) * 4, "=");
    const applicationServerKey = Uint8Array.from(atob(base64), (character) => character.charCodeAt(0));
    const subscription = await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey });
    const response = await fetch("/api/chat/push", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ subscription }) });
    if (response.ok) toast.success("Benachrichtigungen aktiviert.");
    setPushPrompt(false);
  }
  useEffect(() => {
    const onOnline = () => { setOfflineNotice(false); void syncChatMessages().then(() => pendingChatMessages()).then((items) => { setPendingCount(items.length); return loadSummary(); }).then(() => { if (selectedThreadIdRef.current) return loadMessages(selectedThreadIdRef.current, false); }).catch(() => {}); };
    const onOffline = () => setOfflineNotice(true);
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    return () => { window.removeEventListener("online", onOnline); window.removeEventListener("offline", onOffline); };
  }, [loadSummary]);
  useRealtimeRefresh(true, ["chat_messages", "chat_threads", "chat_translations"], () => {
    void loadSummary().then(() => {
      if (selectedThreadIdRef.current) void loadMessages(selectedThreadIdRef.current, false);
    }).catch(() => {});
  });

  function chooseThread(thread: Thread) {
    selectedThreadIdRef.current = thread.id;
    setSelectedThread(thread);
    setBroadcast(false);
    void loadMessages(thread.id);
  }

  function goBackToContacts() {
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
    selectedThreadIdRef.current = null;
    setSelectedThread(null);
    setMessages([]);
    setBroadcast(false);
  }

  async function chooseContact(contactId: string) {
    const response = await fetch("/api/chat/threads", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ employee_id: isAdmin ? contactId : userId, admin_id: isAdmin ? userId : contactId }),
    });
    const data = await response.json();
    if (!response.ok) {
      toast.error(data.error ?? "Chat konnte nicht geöffnet werden.");
      return;
    }
    const contact = contacts.find((item) => item.id === contactId) ?? null;
    const thread: Thread = { ...data.thread, contact, unreadCount: 0 };
    chooseThread(thread);
  }

  function toggleContact(id: string) {
    setSelectedContactIds((current) => current.includes(id) ? current.filter((value) => value !== id) : [...current, id]);
  }

  function selectVisibleContacts() {
    const visibleIds = filteredContacts.map((contact) => contact.id);
    setSelectedContactIds((current) => [...new Set([...current, ...visibleIds])]);
  }

  async function saveLanguage() {
    const selectedLanguage = languageInput.trim();
    if (!selectedLanguage) return;
    const response = await fetch("/api/chat/preferences", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ language: selectedLanguage }),
    });
    if (!response.ok) {
      toast.error("Sprache konnte nicht gespeichert werden.");
      return;
    }
    setLanguage(selectedLanguage);
    setLanguageDialog(false);
    toast.success("Bevorzugte Sprache gespeichert.");
  }

  async function translate(message: Message) {
    if (!language) {
      setLanguageDialog(true);
      return;
    }
    const response = await fetch("/api/chat/translate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message_id: message.id, language }),
    });
    const data = await response.json();
    if (!response.ok) {
      toast.error(data.error ?? "Übersetzung fehlgeschlagen.");
      return;
    }
    setTranslation((current) => ({ ...current, [message.id]: data.translation }));
  }

  async function sendNow() {
    const recipients = broadcast
      ? selectedContactIds
      : selectedThread
        ? [isAdmin ? selectedThread.employee_id : selectedThread.admin_id]
        : [];
    if (recipients.length === 0) {
      toast.error("Bitte mindestens einen Empfänger wählen.");
      return;
    }
    const file = recordingFile ?? attachment;
    if (!body.trim() && !file) return;

    const kind = recordingFile ? "audio" : attachment ? "image" : "text";
    const draftBody = body.trim();
    const draftUrgent = urgent;
    const draftFile = file;
    const optimisticIds = new Map<string, string>();
    const queuePending = async (thread: Thread) => {
      await queueChatMessage({ thread_id: thread.id, body: draftBody, kind, is_urgent: draftUrgent, ...(draftFile ? { file: draftFile } : {}) });
      setPendingCount((count) => count + 1);
      setOfflineNotice(true);
    };
    const addOptimisticMessage = (thread: Thread) => {
      const optimisticId = `pending-${typeof crypto.randomUUID === "function" ? crypto.randomUUID() : Date.now().toString(36)}`;
      optimisticIds.set(thread.id, optimisticId);
      const optimisticMessage: Message = { id: optimisticId, thread_id: thread.id, sender_id: userId, kind: kind as Message["kind"], body: draftBody || null, media_path: null, media_mime_type: draftFile?.type ?? null, transcript: null, is_urgent: draftUrgent, status: "sent", understood_at: null, created_at: new Date().toISOString(), pending: true };
      if (thread.id === selectedThreadIdRef.current) setMessages((current) => [...current, optimisticMessage]);
    };

    for (const recipient of recipients) {
      let thread = selectedThread;
      if (isAdmin && broadcast) {
        const existingThread = threads.find((item) => item.employee_id === recipient && item.admin_id === userId);
        if (!navigator.onLine) {
          thread = existingThread ?? null;
        } else {
          try {
            const threadResponse = await fetch("/api/chat/threads", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ employee_id: recipient, admin_id: userId }) });
            const threadData = await threadResponse.json();
            if (!threadResponse.ok) continue;
            thread = threadData.thread;
          } catch {
            thread = existingThread ?? null;
          }
        }
      }
      if (!thread) continue;
      addOptimisticMessage(thread);
      const form = new FormData();
      form.set("thread_id", thread.id);
      form.set("body", draftBody);
      form.set("kind", recordingFile ? "audio" : attachment ? "image" : "text");
      form.set("is_urgent", String(draftUrgent));
      if (draftFile) form.set("file", draftFile);
      if (!navigator.onLine) {
        await queuePending(thread);
        continue;
      }
      let response: Response;
      try {
        response = await fetch("/api/chat/messages", { method: "POST", body: form });
      } catch {
        await queuePending(thread);
        continue;
      }
      if (!response.ok) {
        setMessages((current) => current.filter((message) => message.id !== optimisticIds.get(thread.id)));
        const data = await response.json().catch(() => ({}));
        toast.error(data.error ?? "Nachricht konnte nicht gesendet werden.");
      }
    }
    setBody("");
    setAttachment(null);
    setRecordingFile(null);
    setUrgent(false);
    setBroadcastConfirmOpen(false);
    requestAnimationFrame(() => {
      scrollMessagesToBottom();
      if (window.matchMedia("(max-width: 767px)").matches) inputRef.current?.focus({ preventScroll: true });
    });
    void loadSummary().catch(() => {});
  }

  function send() {
    if (sendingRef.current) return;
    const file = recordingFile ?? attachment;
    if (!body.trim() && !file) return;
    if (broadcast) {
      if (selectedContactIds.length === 0) {
        toast.error("Bitte mindestens einen Empfänger wählen.");
        return;
      }
      setBroadcastConfirmOpen(true);
      return;
    }
    sendingRef.current = true;
    void sendNow().finally(() => { sendingRef.current = false; });
  }

  async function startRecording() {
    if (!navigator.mediaDevices?.getUserMedia) {
      toast.error("Audioaufnahme wird nicht unterstützt.");
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      chunksRef.current = [];
      recorder.ondataavailable = (event) => { if (event.data.size) chunksRef.current.push(event.data); };
      recorder.onstop = () => {
        stream.getTracks().forEach((track) => track.stop());
        const type = recorder.mimeType || "audio/webm";
        setRecordingFile(new File([new Blob(chunksRef.current, { type })], "sprachnachricht.webm", { type }));
      };
      mediaRecorderRef.current = recorder;
      recorder.start();
      setRecording(true);
    } catch {
      toast.error("Mikrofonzugriff wurde verweigert.");
    }
  }

  function stopRecording() {
    mediaRecorderRef.current?.stop();
    setRecording(false);
  }

  async function messageAction(messageId: string, action: "understood") {
    await fetch("/api/chat/messages", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message_id: messageId, action }),
    });
    if (selectedThreadIdRef.current) void loadMessages(selectedThreadIdRef.current);
  }

  const filteredContacts = useMemo(
    () => contacts.filter((contact) =>
      (!search || contact.name.toLowerCase().includes(search.toLowerCase())) &&
      (roleFilter === "all" || contact.role === roleFilter),
    ),
    [contacts, roleFilter, search],
  );
  const allVisibleSelected = filteredContacts.length > 0 && filteredContacts.every((contact) => selectedContactIds.includes(contact.id));

  return (
    <div className="container py-6 md:min-h-0 md:py-6 max-md:h-[calc(100dvh-7.5rem)] max-md:overflow-hidden">
      <div className={`mb-6 max-md:mb-3 ${selectedThread ? "max-md:hidden" : ""}`}>
        <p className="text-sm font-medium text-primary">Kommunikation</p>
        <h1 className="text-3xl font-bold">Chat</h1>
        <p className="text-sm text-muted-foreground">Sicherer Austausch zwischen Mitarbeitern und Verwaltung.</p>
      </div>
      <div className="grid min-h-0 gap-6 md:grid-cols-[320px_minmax(0,1fr)] max-md:h-[calc(100%-5rem)] max-md:min-h-0 max-md:pb-24">
        <Card className={selectedThread ? "hidden md:block" : "block"}>
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><Users /> {isAdmin ? "Mitarbeiter" : "Admins"}</CardTitle>
            <CardDescription>{isAdmin ? "Mitarbeiter auswählen" : "Admins auswählen"}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <Input placeholder="Name suchen…" value={search} onChange={(event) => setSearch(event.target.value)} />
            <Select value={roleFilter} onValueChange={setRoleFilter}>
              <SelectTrigger><SelectValue placeholder="Alle Rollen" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Alle Rollen</SelectItem>
                {Object.entries(ROLE_LABELS).filter(([key]) => isAdmin ? key !== "admin" : key === "admin").map(([key, value]) => <SelectItem key={key} value={key}>{value}</SelectItem>)}
              </SelectContent>
            </Select>
            {isAdmin && <>
              <Button variant={broadcast ? "secondary" : "outline"} className="w-full" onClick={() => setBroadcast((value) => !value)}>
                {broadcast ? "Broadcast aktiv" : "Broadcast aktivieren"}{selectedContactIds.length ? ` (${selectedContactIds.length})` : ""}
              </Button>
              {broadcast && <Button size="sm" variant="ghost" className="w-full" onClick={() => allVisibleSelected ? setSelectedContactIds((current) => current.filter((id) => !filteredContacts.some((contact) => contact.id === id))) : selectVisibleContacts()}>
                {allVisibleSelected ? "Sichtbare Auswahl aufheben" : "Alle sichtbaren auswählen"}
              </Button>}
            </>}
            <div className="max-h-[60vh] overflow-y-auto border-y pr-1">
              {filteredContacts.length === 0 && <p className="py-4 text-sm text-muted-foreground">Keine passenden Kontakte.</p>}
              {filteredContacts.map((contact) => {
                const thread = threads.find((item) => item.contact?.id === contact.id || (isAdmin ? item.employee_id === contact.id : item.admin_id === contact.id));
                const isActive = selectedThread?.id === thread?.id;
                return (
                  <div key={contact.id} className={`flex items-center gap-2 border-x border-b p-2 text-sm first:border-t hover:bg-accent ${isActive ? "border-l-4 border-l-primary bg-primary/10" : ""}`}>
                    {isAdmin && broadcast && <input type="checkbox" checked={selectedContactIds.includes(contact.id)} onChange={() => toggleContact(contact.id)} aria-label={`${contact.name} auswählen`} />}
                    <button type="button" className="min-w-0 flex-1 text-left" onClick={() => broadcast ? toggleContact(contact.id) : void chooseContact(contact.id)}>
                      <span className={isActive ? "font-semibold" : "font-medium"}>{contact.name}</span>
                      <span className="ml-2 text-xs text-muted-foreground">{ROLE_LABELS[contact.role] ?? contact.role}</span>
                    </button>
                    {thread && thread.unreadCount > 0 && <Badge variant="destructive">{thread.unreadCount}</Badge>}
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>

        <Card className={`flex h-[calc(100dvh-11rem)] min-h-0 flex-col overflow-hidden md:h-[calc(100dvh-10rem)] md:min-h-[600px] ${selectedThread ? "flex" : "hidden md:flex"}`}>
          <CardHeader className="shrink-0">
            <Button type="button" variant="ghost" className="w-fit px-2 md:hidden" onClick={goBackToContacts}><ArrowLeft /> Zurück</Button>
            {pushPrompt && <div className="mb-2 flex items-center justify-between gap-2 rounded-md border border-primary/30 bg-primary/5 px-3 py-2 text-xs"><span>Benachrichtigungen aktivieren?</span><Button size="sm" onClick={() => void enablePush()}>Aktivieren</Button></div>}{offlineNotice && <div className="mb-2 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-800">Offline – Nachricht wird gesendet, sobald Verbindung steht.{pendingCount > 0 ? ` (${pendingCount} ausstehend)` : ""}</div>}
            <CardTitle className="flex items-center justify-between gap-2"><span>{selectedThread?.contact?.name ?? "Chat auswählen"}</span>{selectedThread && <a href={`tel:${isAdmin ? selectedThread.contact?.phone ?? "" : supportPhone ?? ""}`} aria-label="Direkt anrufen" title={(isAdmin ? selectedThread.contact?.phone : supportPhone) ? "Direkt anrufen" : "Keine Telefonnummer hinterlegt"} className={`rounded-md p-2 ${(isAdmin ? selectedThread.contact?.phone : supportPhone) ? "text-primary hover:bg-accent" : "pointer-events-none text-muted-foreground"}`}><Phone className="h-4 w-4" /></a>}</CardTitle>
            <CardDescription className="flex flex-wrap items-center justify-between gap-2">
              <span>{selectedThread ? "" : "Wähle links einen Kontakt aus."}</span>
              <Button size="sm" variant="ghost" onClick={() => setLanguageDialog(true)}><Languages /> Sprache</Button>
            </CardDescription>
          </CardHeader>
          <CardContent className="flex min-h-0 flex-1 flex-col overflow-hidden p-3 max-md:p-3">
            <div ref={messagesContainerRef} onScroll={updateScrollToBottomVisibility} className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
              <div className="flex min-h-full flex-col justify-end gap-3 p-1 max-md:pb-4">
              {messages.map((message) => {
                const isOwnMessage = message.sender_id === userId;
                return (
                  <div key={message.id} className={`w-fit max-w-[75%] min-w-0 break-words rounded-lg border p-3 max-md:max-w-[90%] ${isOwnMessage ? "ml-auto border-blue-600 bg-blue-600 text-white" : "border-border bg-gray-100 text-foreground"} ${message.is_urgent ? "ring-2 ring-destructive/50" : ""}`}>
                    {message.is_urgent && <p className={`mb-1 flex items-center gap-1 text-xs font-semibold ${isOwnMessage ? "text-blue-100" : "text-destructive"}`}><AlertTriangle className="h-3.5 w-3.5" /> Eilmeldung</p>}
                    {message.body && <p className="whitespace-pre-wrap">{message.body}</p>}
                    {message.kind === "image" && message.media_path && (message.media_url ? <img src={message.media_url} alt="Chat-Anhang" className="max-h-64 max-w-full rounded-md object-contain" /> : <p className="flex items-center gap-2 text-sm"><ImagePlus className="h-4 w-4" /> Bild wird geladen…</p>)}
                  {message.kind === "audio" && <div className="space-y-1"><p className="flex items-center gap-2 text-sm"><Volume2 className="h-4 w-4" /> Sprachnachricht</p>{message.media_url && <AudioPlayer src={message.media_url} />}{message.transcript && <p className="text-sm text-muted-foreground">Transkript: {message.transcript}</p>}</div>}
                    {translation[message.id] && <p className={`mt-2 border-t pt-2 text-sm italic ${isOwnMessage ? "border-white/30" : "border-border"}`}>{translation[message.id]}</p>}
                    {!isOwnMessage && (message.body || message.transcript) && <Button size="sm" variant="ghost" onClick={() => void translate(message)}><Languages /> Übersetzen</Button>}
                    <div className={`mt-2 flex items-center justify-end gap-1 text-xs ${isOwnMessage ? "text-blue-100" : "text-muted-foreground"}`}>
                      {message.pending && <span title="Ausstehend">◷</span>}
                      <span>{formatMessageTime(message.created_at)}</span>
                      {isOwnMessage && <span aria-label={`Status: ${message.status}`} title={`Status: ${message.status}`}>
                        {message.status === "read" ? <CheckCheck className="inline h-3.5 w-3.5 text-blue-100" /> : message.status === "delivered" ? <CheckCheck className="inline h-3.5 w-3.5" /> : <Check className="inline h-3.5 w-3.5" />}
                      </span>}
                    </div>
                  </div>
                );
              })}
              </div>
            </div>
            {showScrollToBottom && <div className="flex justify-center py-2 sm:hidden"><Button type="button" size="icon" variant="secondary" className="h-9 w-9 rounded-full shadow-md" onClick={() => scrollMessagesToBottom()} aria-label="Zum neuesten Beitrag scrollen" title="Zum neuesten Beitrag scrollen"><ArrowDown className="h-4 w-4" /></Button></div>}
            <div className="shrink-0 space-y-2 border-t pt-4 max-md:fixed max-md:inset-x-0 max-md:bottom-14 max-md:z-30 max-md:bg-background/95 max-md:px-4 max-md:pb-2 max-md:pt-2 max-md:backdrop-blur">
              <div className="flex gap-2">
                <Input ref={inputRef} value={body} enterKeyHint="send" onChange={(event) => setBody(event.target.value)} placeholder="Nachricht schreiben…" disabled={!selectedThread && !broadcast} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); send(); } }} />
                <Button onClick={send} disabled={!selectedThread && !broadcast}><Send /></Button>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <label className="cursor-pointer" title="Bild aus Datei anhängen"><Paperclip className="h-4 w-4" /><input type="file" className="hidden" accept="image/*" onChange={(event) => setAttachment(event.target.files?.[0] ?? null)} /></label>
                <label className="cursor-pointer" title="Foto aufnehmen"><Camera className="h-4 w-4" /><input type="file" className="hidden" accept="image/*" capture="environment" onChange={(event) => setAttachment(event.target.files?.[0] ?? null)} /></label>
                <Button size="sm" variant={recording ? "destructive" : "outline"} onClick={() => recording ? stopRecording() : void startRecording()}>{recording ? <Square /> : <Mic />} {recording ? "Stop" : "Audio"}</Button>
                {attachment && <span className="text-xs text-muted-foreground">{attachment.name}</span>}
                {recordingFile && <span className="text-xs text-muted-foreground">Audio bereit</span>}
                {isAdmin && <label className="flex items-center gap-1 text-xs"><input type="checkbox" checked={urgent} onChange={(event) => setUrgent(event.target.checked)} /> Wichtig / Eilmeldung</label>}
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <Dialog open={broadcastConfirmOpen} onOpenChange={setBroadcastConfirmOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader><DialogTitle>Broadcast senden?</DialogTitle><DialogDescription>Diese Nachricht wird an {selectedContactIds.length} ausgewählte Mitarbeiter gesendet.</DialogDescription></DialogHeader>
          <DialogFooter><Button variant="outline" onClick={() => setBroadcastConfirmOpen(false)}>Abbrechen</Button><Button onClick={() => void sendNow()}><Send /> Wirklich senden</Button></DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog open={languageDialog} onOpenChange={setLanguageDialog}>
        <DialogContent>
          <DialogHeader><DialogTitle>Bevorzugte Sprache</DialogTitle><DialogDescription>Wähle oder ändere die Sprache für Nachrichtenübersetzungen.</DialogDescription></DialogHeader>
          <Label htmlFor="chat-language">Sprache</Label>
          <Input id="chat-language" value={languageInput} onChange={(event) => setLanguageInput(event.target.value)} placeholder="z. B. English, Türkçe, Polski" />
          <DialogFooter><Button variant="outline" onClick={() => setLanguageDialog(false)}>Abbrechen</Button><Button onClick={() => void saveLanguage()}>Speichern</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
