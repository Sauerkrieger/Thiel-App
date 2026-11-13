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
import { normalizeImageForAnalysis } from "@/lib/image-upload";
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

const CHAT_LANGUAGES = [
  { value: "English", label: "English" },
  { value: "Deutsch", label: "Deutsch" },
  { value: "Türkçe", label: "Türkçe" },
  { value: "Polski", label: "Polski" },
  { value: "العربية", label: "العربية" },
  { value: "Русский", label: "Русский" },
  { value: "Français", label: "Français" },
  { value: "Español", label: "Español" },
];

const ROLE_LABELS: Record<string, string> = {
  admin: "Admin",
  driver: "Driver",
  facility_manager: "Cleaner",
  cleaner: "Cleaner",
  substitute: "Substitute",
};

function formatMessageTime(createdAt: string) {
  return new Intl.DateTimeFormat("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(createdAt));
}

function AudioPlayer({ src, own }: { src: string; own: boolean }) {
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
      <Button type="button" size="sm" variant={own ? "secondary" : "outline"} className={own ? "bg-white text-foreground hover:bg-blue-50" : "bg-background text-foreground"} onClick={() => void toggle()}>
        <Play className="h-3.5 w-3.5" /> {playing ? "Break" : "Abspielen"}
      </Button>

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
  const [attachmentPreview, setAttachmentPreview] = useState<string | null>(null);
  const [keyboardHeight, setKeyboardHeight] = useState(0);
  const [keyboardOpen, setKeyboardOpen] = useState(false);
  const [composerHeight, setComposerHeight] = useState(0);
  const [messagesPadding, setMessagesPadding] = useState(0);
  const composerRef = useRef<HTMLDivElement | null>(null);
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
    if (!response.ok) throw new Error("Could not load the chat.");
    const data = await response.json();
    if (!response.ok) throw new Error(data.error ?? "Could not load contacts.");
    setContacts(data.contacts ?? []);
    setLanguage(data.preferredLanguage ?? null);
    setSelectedContactIds((current) => current.length ? current : (data.contacts ?? []).slice(0, 1).map((contact: Contact) => contact.id));
    setThreads(data.threads ?? []);
    try { localStorage.setItem(`app-chat-summary:${userId}`, JSON.stringify(data)); } catch { /* lokaler Speicher ist optional */ }
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
    const composer = composerRef.current;
    if (!composer || typeof ResizeObserver === "undefined") return;
    const updateHeight = () => setComposerHeight(composer.getBoundingClientRect().height);
    updateHeight();
    const observer = new ResizeObserver(updateHeight);
    observer.observe(composer);
    return () => observer.disconnect();
  }, [selectedThread]);

  // Abstand der letzten Nachricht zum Composer live messen: Die letzte
  // Nachricht soll immer knapp über dem Eingabefeld stehen – auch wenn die
  // Tastatur den Composer nach oben schiebt (Android) oder den Viewport
  // verkleinert (iOS). Ein fester Wert (composerHeight + 24) war zu groß und
  // folgte der Tastatur nicht.
  useEffect(() => {
    const updatePadding = () => {
      const container = messagesContainerRef.current;
      const composer = composerRef.current;
      if (!container || !composer) return;
      const overlap = container.getBoundingClientRect().bottom - composer.getBoundingClientRect().top;
      setMessagesPadding((current) => {
        const next = Math.max(0, overlap) + 12;
        return Math.abs(next - current) > 1 ? next : current;
      });
    };
    updatePadding();
    const container = messagesContainerRef.current;
    const wasNearBottom = container ? container.scrollHeight - container.scrollTop - container.clientHeight < 120 : true;
    const frame = wasNearBottom ? window.requestAnimationFrame(() => scrollMessagesToBottom("auto")) : 0;
    if (typeof ResizeObserver === "undefined") {
      return () => { if (frame) window.cancelAnimationFrame(frame); };
    }
    const observer = new ResizeObserver(updatePadding);
    if (composerRef.current) observer.observe(composerRef.current);
    if (container) observer.observe(container);
    const onResize = () => updatePadding();
    window.addEventListener("resize", onResize);
    return () => {
      if (frame) window.cancelAnimationFrame(frame);
      observer.disconnect();
      window.removeEventListener("resize", onResize);
    };
  }, [keyboardHeight, keyboardOpen, selectedThread, scrollMessagesToBottom]);

  useEffect(() => {
    if (typeof window === "undefined" || !window.visualViewport) return;
    const viewport = window.visualViewport;
    // innerHeight bei geschlossener Tastatur – iOS/Android verkleinern den
    // Layout-Viewport, wenn die Tastatur erscheint (dann ist die Differenz
    // zum Visual Viewport 0 und nur der Höhenverlust verrät die Tastatur).
    let baseline = window.innerHeight;
    const measure = () => {
      const offset = Math.max(0, window.innerHeight - viewport.height - viewport.offsetTop);
      setKeyboardHeight(offset);
      setKeyboardOpen(offset > 20 || window.innerHeight < baseline - 140);
    };
    const onWindowResize = () => {
      const offset = Math.max(0, window.innerHeight - viewport.height - viewport.offsetTop);
      const keyboardVisible = offset > 20 || window.innerHeight < baseline - 140;
      if (!keyboardVisible) baseline = window.innerHeight;
      measure();
    };
    const onOrientationChange = () => {
      baseline = window.innerHeight;
      setKeyboardHeight(0);
      setKeyboardOpen(false);
    };
    measure();
    viewport.addEventListener("resize", measure);
    viewport.addEventListener("scroll", measure);
    window.addEventListener("resize", onWindowResize);
    window.addEventListener("orientationchange", onOrientationChange);
    return () => {
      viewport.removeEventListener("resize", measure);
      viewport.removeEventListener("scroll", measure);
      window.removeEventListener("resize", onWindowResize);
      window.removeEventListener("orientationchange", onOrientationChange);
    };
  }, []);

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
      const cached = JSON.parse(localStorage.getItem(`app-chat-summary:${userId}`) ?? "null") as { contacts?: Contact[]; threads?: Thread[]; preferredLanguage?: string | null } | null;
      if (cached) { setContacts(cached.contacts ?? []); setThreads(cached.threads ?? []); setLanguage(cached.preferredLanguage ?? null); }
    } catch { /* lokaler Speicher ist optional */ }
    void loadSummary().catch((error) => {
      toast.error(error instanceof Error ? error.message : "Could not load contacts.");
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
    if (!config.vapidPublicKey) { toast.error("Push notifications are not configured yet."); setPushPrompt(false); return; }
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

  async function handleAttachmentChange(file: File | null) {
    // Kamerafotos (HEIC/HEIF, oft > 15 MB) vor dem Hochladen komprimieren,
    // damit der Versand nicht am Datei- oder Request-Limit scheitert und die
    // Vorschau in allen Browsern anzeigbar ist.
    if (file && file.type.startsWith("image/")) {
      file = await normalizeImageForAnalysis(file);
    }
    setAttachment(file);
    setAttachmentPreview((current) => {
      if (current) URL.revokeObjectURL(current);
      return file?.type.startsWith("image/") ? URL.createObjectURL(file) : null;
    });
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
      toast.error(data.error ?? "Could not open the chat.");
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
      toast.error("Could not save the language.");
      return;
    }
    setLanguage(selectedLanguage);
    setLanguageDialog(false);
    toast.success("Preferred language saved.");
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
      toast.error(data.error ?? "Translation failed.");
      return;
    }
    setTranslation((current) => ({ ...current, [message.id]: data.translation }));
  }

  async function sendNow() {
    const recipients = broadcast
      ? selectedContactIds
      : selectedThread
        ? [selectedThread.employee_id === userId ? selectedThread.admin_id : selectedThread.employee_id]
        : [];
    if (recipients.length === 0) {
      toast.error("Please select at least one recipient.");
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
        toast.error(data.error ?? "Could not send the message.");
      }
    }
    setBody("");
    handleAttachmentChange(null);
    setRecordingFile(null);
    setUrgent(false);
    setBroadcastConfirmOpen(false);
    if (window.matchMedia("(max-width: 767px)").matches) {
      window.setTimeout(() => {
        // Nur nachfokussieren, wenn der Fokus wirklich verloren ging – ein
        // unnötiger focus()-Aufruf lässt die Tastatur auf iOS flackern.
        if (document.activeElement !== inputRef.current) inputRef.current?.focus({ preventScroll: true });
      }, 0);
    }
    requestAnimationFrame(() => scrollMessagesToBottom());
    void loadSummary().catch(() => {});
  }

  function send() {
    if (sendingRef.current) return;
    const file = recordingFile ?? attachment;
    if (!body.trim() && !file) return;
    if (broadcast) {
      if (selectedContactIds.length === 0) {
        toast.error("Please select at least one recipient.");
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
      toast.error("Audio recording is not supported.");
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
      toast.error("Microphone access was denied.");
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
    <div className="container py-6 md:min-h-0 md:py-6 max-md:flex max-md:h-[calc(100dvh-11rem)] max-md:flex-col max-md:overflow-hidden">
      <div className={`mb-6 max-md:mb-3 max-md:shrink-0 ${selectedThread ? "max-md:hidden" : ""}`}>
        <p className="text-sm font-medium text-primary">Communication</p>
        <h1 className="text-3xl font-bold">Chat</h1>
        <p className="text-sm text-muted-foreground">Secure exchange between employees and administration.</p>
      </div>
      <div className="grid min-h-0 gap-6 md:grid-cols-[minmax(240px,min(28vw,320px))_minmax(0,1fr)] max-md:flex max-md:min-h-0 max-md:flex-1 max-md:flex-col">
        <Card className={`flex min-h-0 flex-col max-md:flex-1 md:h-[calc(100dvh-10rem)] ${selectedThread ? "hidden md:flex" : "flex"}`}>
          <CardHeader className="shrink-0">
            <CardTitle className="flex items-center gap-2"><Users /> {isAdmin ? "Employees" : "Contacts"}</CardTitle>
            <CardDescription>{isAdmin ? "Select employees" : "Select contact"}</CardDescription>
          </CardHeader>
          <CardContent className="flex min-h-0 flex-1 flex-col space-y-3">
            <Input placeholder="Search names…" value={search} onChange={(event) => setSearch(event.target.value)} />
            <Select value={roleFilter} onValueChange={setRoleFilter}>
              <SelectTrigger><SelectValue placeholder="All roles" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All roles</SelectItem>
                {Object.entries(ROLE_LABELS).filter(([key]) => isAdmin ? key !== "admin" : true).map(([key, value]) => <SelectItem key={key} value={key}>{value}</SelectItem>)}
              </SelectContent>
            </Select>
            {isAdmin && <>
              <Button variant={broadcast ? "secondary" : "outline"} className="w-full" onClick={() => setBroadcast((value) => !value)}>
                {broadcast ? "Broadcast on" : "Start broadcast"}{selectedContactIds.length ? ` (${selectedContactIds.length})` : ""}
              </Button>
              {broadcast && <Button size="sm" variant="ghost" className="w-full" onClick={() => allVisibleSelected ? setSelectedContactIds((current) => current.filter((id) => !filteredContacts.some((contact) => contact.id === id))) : selectVisibleContacts()}>
                {allVisibleSelected ? "Clear visible selection" : "Select all visible"}
              </Button>}
            </>}
            <div className="min-h-0 flex-1 overflow-y-auto border-y pr-1">
              {filteredContacts.length === 0 && <p className="py-4 text-sm text-muted-foreground">No matching contacts.</p>}
              {filteredContacts.map((contact) => {
                const thread = threads.find((item) => item.contact?.id === contact.id || item.employee_id === contact.id || item.admin_id === contact.id);
                const isActive = selectedThread?.id === thread?.id;
                return (
                  <div key={contact.id} className={`flex items-center gap-2 border-x border-b p-2 text-sm first:border-t hover:bg-accent ${isActive ? "border-l-4 border-l-primary bg-primary/10" : ""}`}>
                    {isAdmin && broadcast && <input type="checkbox" checked={selectedContactIds.includes(contact.id)} onChange={() => toggleContact(contact.id)} aria-label={`${contact.name} to select`} />}
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

        <Card className={`flex min-h-0 flex-col overflow-hidden max-md:flex-1 md:h-[calc(100dvh-10rem)] ${selectedThread ? "flex" : "hidden md:flex"}`}>
          <CardHeader className="shrink-0">
            <div className="flex items-center justify-between gap-2">
              <Button type="button" variant="ghost" className="w-fit px-2 md:hidden" onClick={goBackToContacts}><ArrowLeft /> Back</Button>
              <Button size="sm" variant="ghost" className="md:hidden" onClick={() => setLanguageDialog(true)}><Languages /> Language</Button>
            </div>
            {pushPrompt && <div className="mb-2 flex items-center justify-between gap-2 rounded-md border border-primary/30 bg-primary/5 px-3 py-2 text-xs"><span>Enable notifications?</span><Button size="sm" onClick={() => void enablePush()}>Enable</Button></div>}{offlineNotice && <div className="mb-2 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-800">Offline – the message will be sent as soon as the connection is back.{pendingCount > 0 ? ` (${pendingCount} pending)` : ""}</div>}
            <CardTitle className="flex items-center justify-between gap-2"><span>{selectedThread?.contact?.name ?? "Select chat"}</span>{selectedThread && <a href={`tel:${isAdmin ? selectedThread.contact?.phone ?? "" : supportPhone ?? ""}`} aria-label="Call now" title={(isAdmin ? selectedThread.contact?.phone : supportPhone) ? "Call now" : "No phone number on file"} className={`rounded-md p-2 ${(isAdmin ? selectedThread.contact?.phone : supportPhone) ? "text-primary hover:bg-accent" : "pointer-events-none text-muted-foreground"}`}><Phone className="h-4 w-4" /></a>}</CardTitle>
            <CardDescription className="flex flex-wrap items-center justify-between gap-2">
              <span>{selectedThread ? "" : "Select a contact on the left."}</span>
              <Button size="sm" variant="ghost" className="hidden md:inline-flex" onClick={() => setLanguageDialog(true)}><Languages /> Language</Button>
            </CardDescription>
          </CardHeader>
          <CardContent className="flex min-h-0 flex-1 flex-col overflow-hidden p-3 max-md:p-3">
            <div ref={messagesContainerRef} onScroll={updateScrollToBottomVisibility} className="min-h-0 flex-1 overflow-y-auto overscroll-contain" style={{ paddingBottom: messagesPadding ? `${messagesPadding}px` : undefined }}>
              <div className="flex min-h-full flex-col justify-end gap-3 p-1">
              {messages.map((message) => {
                const isOwnMessage = message.sender_id === userId;
                return (
                  <div key={message.id} className={`w-fit max-w-[75%] min-w-0 break-words rounded-lg border p-3 max-md:max-w-[90%] ${isOwnMessage ? "ml-auto border-blue-600 bg-blue-600 text-white" : "border-border bg-gray-100 text-foreground"} ${message.is_urgent ? "ring-2 ring-destructive/50" : ""}`}>
                    {message.is_urgent && <p className={`mb-1 flex items-center gap-1 text-xs font-semibold ${isOwnMessage ? "text-blue-100" : "text-destructive"}`}><AlertTriangle className="h-3.5 w-3.5" /> Eilmeldung</p>}
                    {message.body && <p className="whitespace-pre-wrap">{message.body}</p>}
                    {message.kind === "image" && message.media_path && (message.media_url ? <img src={message.media_url} alt="Chat-Anhang" className="max-h-64 max-w-full rounded-md object-contain" /> : <p className="flex items-center gap-2 text-sm"><ImagePlus className="h-4 w-4" /> Loading image…</p>)}
                  {message.kind === "audio" && <div className="space-y-1"><p className="flex items-center gap-2 text-sm"><Volume2 className="h-4 w-4" /> Sprachnachricht</p>{message.media_url && <AudioPlayer src={message.media_url} own={isOwnMessage} />}{message.transcript && <p className={`text-sm ${isOwnMessage ? "text-blue-100" : "text-gray-400"}`}>Transkript: {message.transcript}</p>}</div>}
                    {translation[message.id] && <p className={`mt-2 border-t pt-2 text-sm italic ${isOwnMessage ? "border-white/30" : "border-border"}`}>{translation[message.id]}</p>}
                    <div className={`mt-2 flex items-center justify-end gap-1 text-xs ${isOwnMessage ? "text-blue-100" : "text-muted-foreground"}`}>
                      {message.pending && <span title="Pending">◷</span>}
                      <span>{formatMessageTime(message.created_at)}</span>
                      {!isOwnMessage && (message.body || message.transcript) && <Button type="button" size="icon" variant="ghost" className="h-5 w-5 p-0" onClick={() => void translate(message)} aria-label="Translate message" title="Translate message"><Languages className="h-3.5 w-3.5" /></Button>}
                      {isOwnMessage && <span aria-label={`Status: ${message.status}`} title={`Status: ${message.status}`}>
                        {message.status === "read" ? <CheckCheck className="inline h-3.5 w-3.5 text-blue-100" /> : message.status === "delivered" ? <CheckCheck className="inline h-3.5 w-3.5" /> : <Check className="inline h-3.5 w-3.5" />}
                      </span>}
                    </div>
                  </div>
                );
              })}
              </div>
            </div>
            {showScrollToBottom && <Button type="button" size="icon" variant="secondary" className="fixed left-1/2 z-30 h-9 w-9 -translate-x-1/2 rounded-full shadow-md sm:hidden" style={{ bottom: `calc(${keyboardOpen ? `${keyboardHeight}px` : "3.5rem"} + ${composerHeight}px + 0.75rem)` }} onClick={() => scrollMessagesToBottom()} aria-label="Scroll to the newest message" title="Scroll to the newest message"><ArrowDown className="h-4 w-4" /></Button>}
            <div ref={composerRef} className="shrink-0 space-y-2 border-t pt-4 max-md:fixed max-md:inset-x-0 max-md:z-30 max-md:bg-background/95 max-md:px-4 max-md:pb-2 max-md:pt-2 max-md:backdrop-blur" style={{ bottom: keyboardOpen ? `${keyboardHeight}px` : "3.5rem", transition: "none" }}>
              <div className="flex gap-2">
                <Input ref={inputRef} value={body} enterKeyHint="send" onChange={(event) => setBody(event.target.value)} placeholder="Write a message…" disabled={!selectedThread && !broadcast} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); send(); } }} />
                <Button onPointerDown={(event) => event.preventDefault()} onClick={send} disabled={!selectedThread && !broadcast}><Send /></Button>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <label className="flex cursor-pointer items-center gap-1" title="Attach image from file"><Paperclip className="h-4 w-4" /><input type="file" className="hidden" accept="image/*" onChange={(event) => handleAttachmentChange(event.target.files?.[0] ?? null)} /></label>
                <label className="flex cursor-pointer items-center gap-1" title="Take photo"><Camera className="h-4 w-4" /><input type="file" className="hidden" accept="image/*" capture="environment" onChange={(event) => handleAttachmentChange(event.target.files?.[0] ?? null)} /></label>
                <Button size="sm" variant={recording ? "destructive" : "outline"} onClick={() => recording ? stopRecording() : void startRecording()}>{recording ? <Square /> : <Mic />} {recording ? "Stop" : "Audio"}</Button>
                {attachmentPreview && <img src={attachmentPreview} alt="Selected chat attachment" className="h-12 w-12 rounded border object-cover" />}
                {attachment && !attachmentPreview && <span className="text-xs text-muted-foreground">{attachment.name}</span>}
                {recordingFile && <span className="text-xs text-muted-foreground">Audio bereit</span>}
                {isAdmin && <label className="flex items-center gap-1 text-xs"><input type="checkbox" checked={urgent} onChange={(event) => setUrgent(event.target.checked)} /> Important / urgent</label>}
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <Dialog open={broadcastConfirmOpen} onOpenChange={setBroadcastConfirmOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader><DialogTitle>Send broadcast?</DialogTitle><DialogDescription>This message will be sent to {selectedContactIds.length} selected employees.</DialogDescription></DialogHeader>
          <DialogFooter><Button variant="outline" onClick={() => setBroadcastConfirmOpen(false)}>Cancel</Button><Button onClick={() => void sendNow()}><Send /> Send now</Button></DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog open={languageDialog} onOpenChange={setLanguageDialog}>
        <DialogContent>
          <DialogHeader><DialogTitle>Preferred language</DialogTitle><DialogDescription>Choose or change the language used for message translations.</DialogDescription></DialogHeader>
          <Label htmlFor="chat-language">Language</Label>
          <Select value={languageInput} onValueChange={setLanguageInput}>
            <SelectTrigger id="chat-language"><SelectValue placeholder="Select language" /></SelectTrigger>
            <SelectContent>{CHAT_LANGUAGES.map((item) => <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>)}</SelectContent>
          </Select>
          <DialogFooter><Button variant="outline" onClick={() => setLanguageDialog(false)}>Cancel</Button><Button onClick={() => void saveLanguage()}>Save</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
