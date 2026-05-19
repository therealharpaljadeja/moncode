"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  ChevronRight,
  ChevronDown,
  Circle,
  CircleCheck,
  ExternalLink,
  FileIcon,
  ListOrdered,
  Loader2,
  RefreshCw,
  X,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  Conversation,
  ConversationContent,
  ConversationScrollButton,
} from "@/components/ai-elements/conversation";
import {
  Message,
  MessageContent,
  MessageResponse,
} from "@/components/ai-elements/message";
import {
  PromptInput,
  PromptInputBody,
  PromptInputFooter,
  PromptInputSubmit,
  PromptInputTextarea,
  type PromptInputMessage,
} from "@/components/ai-elements/prompt-input";
import {
  Task,
  TaskContent,
  TaskItem,
  TaskTrigger,
} from "@/components/ai-elements/task";
import { Tool, type ToolPart } from "@/components/ui/tool";
import {
  Steps,
  StepsContent,
  StepsItem,
  StepsTrigger,
} from "@/components/ui/steps";
import { ThinkingBar } from "@/components/ui/thinking-bar";
import { TextShimmer } from "@/components/ui/text-shimmer";
import {
  FileTree as ElementsFileTree,
  FileTreeFile,
  FileTreeFolder,
} from "@/components/ai-elements/file-tree";
import {
  CodeBlock,
  CodeBlockActions,
  CodeBlockCopyButton,
  CodeBlockFilename,
  CodeBlockHeader,
  CodeBlockTitle,
} from "@/components/ai-elements/code-block";
import {
  WebPreview,
  WebPreviewBody,
  WebPreviewNavigation,
  WebPreviewNavigationButton,
  WebPreviewUrl,
} from "@/components/ai-elements/web-preview";
import { DotmSquare5 } from "@/components/ui/dotm-square-5";
import type { BundledLanguage } from "shiki";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

type BootStatus = "idle" | "pending" | "ready" | "failed";

type ChatItem =
  | { kind: "user"; text: string }
  | {
      kind: "assistant";
      text: string;
      attributionSkill?: string;
      requestId?: string;
    }
  | {
      kind: "tool_use";
      name: string;
      input: unknown;
      result?: string;
      isError?: boolean;
      attributionSkill?: string;
      requestId?: string;
    }
  | { kind: "result"; text: string }
  | { kind: "error"; text: string }
  | { kind: "stderr"; text: string };

type TodoStatus = "pending" | "in_progress" | "completed";

type TodoItem = {
  content: string;
  status: TodoStatus;
  activeForm?: string;
};

type FileNode = {
  name: string;
  path: string;
  type: "file" | "dir";
  children?: FileNode[];
};

type Tab = "preview" | "files";

type BootPhase = { key: string; label: string };

type QueuedPrompt = {
  id: string;
  text: string;
};

export default function Page() {
  const [bootStatus, setBootStatus] = useState<BootStatus>("idle");
  const [bootPhase, setBootPhase] = useState<BootPhase | null>(null);
  const [bootError, setBootError] = useState<string | null>(null);
  const [sandboxUrl, setSandboxUrl] = useState<string | null>(null);
  // True once POST /api/sandbox has responded — at that point the cookie is
  // set and the in-memory session is registered, so SSE can connect.
  const [postReturned, setPostReturned] = useState(false);

  const [items, setItems] = useState<ChatItem[]>([]);
  // UUIDs of SDK messages already merged into `items`. Both the transcript
  // load and the SSE stream can deliver the same message — most notably when
  // `continue: true` makes the SDK replay prior user turns before the new
  // one — so we dedupe by uuid instead of pushing blindly.
  const seenUuidsRef = useRef<Set<string>>(new Set());
  const [todos, setTodos] = useState<TodoItem[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [promptQueue, setPromptQueue] = useState<QueuedPrompt[]>([]);
  const [transcriptLoaded, setTranscriptLoaded] = useState(false);
  const processingQueueRef = useRef(false);
  const sendInFlightRef = useRef(false);

  const [tab, setTab] = useState<Tab>("preview");
  const [tree, setTree] = useState<FileNode[]>([]);
  const [activeFile, setActiveFile] = useState<string | null>(null);
  const [activeContent, setActiveContent] = useState<string>("");
  const [iframeNonce, setIframeNonce] = useState(0);

  // Title is the per-project label shown in the chat header. Null = show
  // "Moncode" fallback. `animatingTitle` is set briefly the moment the
  // backend returns a freshly-generated title, which triggers the
  // typewriter reveal; saved titles loaded on reload skip the animation.
  const [title, setTitle] = useState<string | null>(null);
  const [animatingTitle, setAnimatingTitle] = useState<string | null>(null);

  const ensureSandbox = useCallback(async () => {
    setBootStatus("pending");
    setPostReturned(false);
    try {
      const res = await fetch("/api/sandbox", { method: "POST" });
      const data = await res.json();
      if (typeof data.title === "string" && data.title.length > 0) {
        setTitle(data.title);
      }
      if (data.status === "ready") {
        setBootStatus("ready");
        setSandboxUrl(data.sandboxUrl);
      } else if (data.status === "failed") {
        setBootStatus("failed");
        setBootError(data.error ?? data.bootError ?? "boot failed");
      }
    } catch (err) {
      setBootStatus("failed");
      setBootError(err instanceof Error ? err.message : String(err));
    } finally {
      setPostReturned(true);
    }
  }, []);

  const generateTitle = useCallback(async (prompt: string) => {
    try {
      const res = await fetch("/api/title", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt }),
      });
      if (!res.ok) return;
      const data = (await res.json()) as { title?: string; cached?: boolean };
      if (!data.title) return;
      if (data.cached) {
        setTitle(data.title);
      } else {
        setAnimatingTitle(data.title);
      }
    } catch {
      // silent — header just keeps "Moncode"
    }
  }, []);

  useEffect(() => {
    void ensureSandbox();
  }, [ensureSandbox]);

  useEffect(() => {
    if (!postReturned || bootStatus !== "pending") return;
    const es = new EventSource("/api/sandbox/stream");
    es.addEventListener("phase", (ev) => {
      try {
        const data = JSON.parse((ev as MessageEvent).data);
        if (
          data &&
          typeof data.key === "string" &&
          typeof data.label === "string"
        ) {
          setBootPhase({ key: data.key, label: data.label });
        }
      } catch {
        // ignore
      }
    });
    es.addEventListener("status", (ev) => {
      try {
        const data = JSON.parse((ev as MessageEvent).data);
        if (data.status === "ready") {
          setBootStatus("ready");
          setSandboxUrl(data.sandboxUrl);
        } else if (data.status === "failed") {
          setBootStatus("failed");
          setBootError(data.bootError ?? "boot failed");
        }
      } catch {
        // ignore
      }
      es.close();
    });
    es.onerror = () => {
      es.close();
    };
    return () => es.close();
  }, [postReturned, bootStatus]);

  const refetchFiles = useCallback(async () => {
    try {
      const res = await fetch("/api/files");
      const data = await res.json();
      setTree(data.tree ?? []);
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    if (bootStatus === "ready") void refetchFiles();
  }, [bootStatus, refetchFiles]);

  useEffect(() => {
    if (bootStatus !== "ready" || transcriptLoaded) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/transcript");
        if (!res.ok) return;
        const data = (await res.json()) as { messages?: unknown[] };
        if (cancelled || !Array.isArray(data.messages)) return;
        const messages = data.messages as Array<Record<string, unknown>>;
        const accepted = messages.filter((m) =>
          shouldMergeMessage(m, seenUuidsRef.current),
        );
        setItems((prev) => {
          let next = prev;
          for (const m of accepted) {
            next = mergeSdkMessage(next, m);
          }
          return next;
        });
        let latestTodos: TodoItem[] | null = null;
        for (const m of messages) {
          const t = extractTodosFromMessage(m);
          if (t) latestTodos = t;
        }
        if (latestTodos) setTodos(latestTodos);
      } catch {
        // best-effort; leave chat empty if transcript can't be fetched
      } finally {
        if (!cancelled) setTranscriptLoaded(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [bootStatus, transcriptLoaded]);

  const openFile = useCallback(async (path: string) => {
    setActiveFile(path);
    setActiveContent("");
    try {
      const res = await fetch(
        `/api/files/${path
          .split("/")
          .map(encodeURIComponent)
          .join("/")}`,
      );
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        setActiveContent(`// ${err.error ?? "failed to read"}`);
        return;
      }
      const data = await res.json();
      setActiveContent(data.content ?? "");
    } catch (err) {
      setActiveContent(
        `// ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }, []);

  const sendPrompt = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      if (!trimmed || sendInFlightRef.current) return;
      sendInFlightRef.current = true;

      let firstUserPrompt = false;
      setItems((prev) => {
        if (!prev.some((it) => it.kind === "user")) firstUserPrompt = true;
        return [...prev, { kind: "user", text: trimmed }];
      });
      if (firstUserPrompt && !title) {
        void generateTitle(trimmed);
      }
      setBusy(true);

      try {
        const res = await fetch("/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ message: trimmed }),
        });
        if (!res.ok || !res.body) {
          const err = await res.text().catch(() => "");
          setItems((prev) => [
            ...prev,
            { kind: "error", text: err || `HTTP ${res.status}` },
          ]);
          return;
        }

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buf = "";
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          buf += decoder.decode(value, { stream: true });
          let idx;
          while ((idx = buf.indexOf("\n\n")) >= 0) {
            const event = buf.slice(0, idx);
            buf = buf.slice(idx + 2);
            handleSseBlock(event, setItems, setTodos, seenUuidsRef.current);
          }
        }
      } catch (err) {
        setItems((prev) => [
          ...prev,
          {
            kind: "error",
            text: err instanceof Error ? err.message : String(err),
          },
        ]);
      } finally {
        sendInFlightRef.current = false;
        setBusy(false);
        void refetchFiles();
        setIframeNonce((n) => n + 1);
      }
    },
    [refetchFiles, title, generateTitle],
  );

  const enqueuePrompt = useCallback((text: string) => {
    const trimmed = text.trim();
    if (!trimmed) return;
    setPromptQueue((prev) => [
      ...prev,
      { id: crypto.randomUUID(), text: trimmed },
    ]);
  }, []);

  const removeQueuedPrompt = useCallback((id: string) => {
    setPromptQueue((prev) => prev.filter((p) => p.id !== id));
  }, []);

  const submit = useCallback(() => {
    const text = input.trim();
    if (!text) return;
    setInput("");
    if (busy) {
      enqueuePrompt(text);
    } else {
      void sendPrompt(text);
    }
  }, [busy, input, enqueuePrompt, sendPrompt]);

  useEffect(() => {
    if (busy || promptQueue.length === 0 || processingQueueRef.current) return;

    const [next, ...rest] = promptQueue;
    processingQueueRef.current = true;
    setPromptQueue(rest);
    void sendPrompt(next.text).finally(() => {
      processingQueueRef.current = false;
    });
  }, [busy, promptQueue, sendPrompt]);

  return (
    <ResizablePanelGroup
      direction="horizontal"
      className="h-screen w-screen bg-background"
    >
      <ResizablePanel defaultSize={40} minSize={28} className="min-w-0">
        <ChatPane
          items={items}
          todos={todos}
          input={input}
          setInput={setInput}
          submit={submit}
          busy={busy}
          promptQueue={promptQueue}
          onRemoveQueued={removeQueuedPrompt}
          bootStatus={bootStatus}
          transcriptLoaded={transcriptLoaded}
          title={title}
          animatingTitle={animatingTitle}
          onTitleAnimationDone={() => {
            if (animatingTitle) {
              setTitle(animatingTitle);
              setAnimatingTitle(null);
            }
          }}
        />
      </ResizablePanel>
      <ResizableHandle />
      <ResizablePanel defaultSize={60} minSize={30} className="min-w-0">
        <RightPane
          bootStatus={bootStatus}
          bootPhase={bootPhase}
          bootError={bootError}
          sandboxUrl={sandboxUrl}
          iframeNonce={iframeNonce}
          reloadPreview={() => setIframeNonce((n) => n + 1)}
          tab={tab}
          setTab={setTab}
          tree={tree}
          activeFile={activeFile}
          activeContent={activeContent}
          openFile={openFile}
          refetchFiles={refetchFiles}
        />
      </ResizablePanel>
    </ResizablePanelGroup>
  );
}

function handleSseBlock(
  block: string,
  setItems: React.Dispatch<React.SetStateAction<ChatItem[]>>,
  setTodos: React.Dispatch<React.SetStateAction<TodoItem[]>>,
  seenUuids: Set<string>,
) {
  let event = "message";
  let dataLine = "";
  for (const raw of block.split("\n")) {
    if (raw.startsWith("event:")) event = raw.slice(6).trim();
    else if (raw.startsWith("data:")) dataLine += raw.slice(5).trim();
  }
  if (!dataLine) return;
  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(dataLine) as Record<string, unknown>;
  } catch {
    return;
  }

  if (event === "sdk_message") {
    const msg = payload.message;
    if (msg && typeof msg === "object") {
      const m = msg as Record<string, unknown>;
      if (m.type === "moncode_error") {
        const text =
          typeof m.error === "string" ? m.error : "agent crashed";
        setItems((prev) => [...prev, { kind: "error", text }]);
        return;
      }
      if (!shouldMergeMessage(m, seenUuids)) return;
      setItems((prev) => mergeSdkMessage(prev, m));
      const newTodos = extractTodosFromMessage(m);
      if (newTodos) setTodos(newTodos);
    }
    return;
  }
  if (event === "agent_exit") {
    const code = typeof payload.exitCode === "number" ? payload.exitCode : -1;
    setItems((prev) => [
      ...prev,
      { kind: "error", text: `agent exited with code ${code}` },
    ]);
    return;
  }
  if (event === "agent_stderr") {
    const text = typeof payload.data === "string" ? payload.data : "";
    if (!text.trim()) return;
    setItems((prev) => {
      const next = [...prev];
      const last = next[next.length - 1];
      if (last && last.kind === "stderr") {
        next[next.length - 1] = { kind: "stderr", text: last.text + text };
      } else {
        next.push({ kind: "stderr", text });
      }
      return next;
    });
    return;
  }
  if (event === "error") {
    const text =
      typeof payload.message === "string"
        ? (payload.message as string)
        : "error";
    setItems((prev) => [...prev, { kind: "error", text }]);
  }
}

function shouldMergeMessage(
  msg: Record<string, unknown>,
  seenUuids: Set<string>,
): boolean {
  if (msg.isReplay === true) return false;
  const uuid = typeof msg.uuid === "string" ? msg.uuid : null;
  if (!uuid) return true;
  if (seenUuids.has(uuid)) return false;
  seenUuids.add(uuid);
  return true;
}

function mergeSdkMessage(
  prev: ChatItem[],
  msg: Record<string, unknown>,
): ChatItem[] {
  const type = msg.type;
  if (type === "assistant") {
    const inner = (msg.message ?? {}) as { content?: unknown };
    const blocks = Array.isArray(inner.content) ? inner.content : [];
    const attributionSkill =
      typeof msg.attributionSkill === "string"
        ? msg.attributionSkill
        : undefined;
    const requestId =
      typeof msg.requestId === "string" ? msg.requestId : undefined;
    const next = [...prev];
    for (const block of blocks as Array<Record<string, unknown>>) {
      if (block.type === "text" && typeof block.text === "string") {
        next.push({
          kind: "assistant",
          text: block.text,
          attributionSkill,
          requestId,
        });
      } else if (block.type === "tool_use") {
        next.push({
          kind: "tool_use",
          name: typeof block.name === "string" ? block.name : "tool",
          input: block.input,
          attributionSkill,
          requestId,
        });
      }
    }
    return next;
  }
  if (type === "user") {
    const inner = (msg.message ?? {}) as { content?: unknown };
    // User content can be a plain string (older transcripts), or an array of
    // blocks: text blocks for prompts, tool_result blocks for tool feedback.
    if (typeof inner.content === "string") {
      return [...prev, { kind: "user", text: inner.content }];
    }
    const blocks = Array.isArray(inner.content) ? inner.content : [];
    // Synthetic user messages (Skill body injections, system reminders, etc.)
    // and messages parented to a tool call are SDK-internal — never real
    // user input. The SDK flags them with `isSynthetic: true`; parent_tool_use_id
    // and `tool_use_result` also mark non-user content. Process tool_result
    // blocks but drop their text blocks.
    const isSynthetic =
      msg.isSynthetic === true ||
      Boolean(msg.parent_tool_use_id) ||
      msg.tool_use_result !== undefined;
    const next = [...prev];
    let promptText = "";
    for (const block of blocks as Array<Record<string, unknown>>) {
      if (block.type === "text" && typeof block.text === "string") {
        if (isSynthetic) continue;
        promptText += (promptText ? "\n" : "") + block.text;
      } else if (block.type === "tool_result") {
        const idx = lastIndexWhere(next, (it) => it.kind === "tool_use");
        const text = stringifyToolResult(block.content);
        if (idx >= 0) {
          const target = next[idx] as Extract<ChatItem, { kind: "tool_use" }>;
          next[idx] = {
            ...target,
            result: text,
            isError: Boolean(block.is_error),
          };
        }
      }
    }
    if (promptText) next.push({ kind: "user", text: promptText });
    return next;
  }
  if (type === "result") {
    const text = typeof msg.result === "string" ? msg.result : "";
    if (!text) return prev;
    return [...prev, { kind: "result", text }];
  }
  return prev;
}

function extractTodosFromMessage(
  msg: Record<string, unknown>,
): TodoItem[] | null {
  if (msg.type !== "assistant") return null;
  const inner = (msg.message ?? {}) as { content?: unknown };
  if (!Array.isArray(inner.content)) return null;
  let latest: TodoItem[] | null = null;
  for (const block of inner.content as Array<Record<string, unknown>>) {
    if (block.type !== "tool_use" || block.name !== "TodoWrite") continue;
    const input = block.input as { todos?: unknown } | undefined;
    if (!input || !Array.isArray(input.todos)) continue;
    const todos: TodoItem[] = [];
    for (const raw of input.todos as unknown[]) {
      if (!raw || typeof raw !== "object") continue;
      const o = raw as Record<string, unknown>;
      const status = o.status;
      if (
        typeof o.content !== "string" ||
        (status !== "pending" &&
          status !== "in_progress" &&
          status !== "completed")
      ) {
        continue;
      }
      todos.push({
        content: o.content,
        status,
        activeForm: typeof o.activeForm === "string" ? o.activeForm : undefined,
      });
    }
    latest = todos;
  }
  return latest;
}

function lastIndexWhere<T>(arr: T[], pred: (x: T) => boolean): number {
  for (let i = arr.length - 1; i >= 0; i -= 1) {
    if (pred(arr[i])) return i;
  }
  return -1;
}

function stringifyToolResult(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((c: unknown) => {
        if (c && typeof c === "object" && "text" in (c as object)) {
          const t = (c as { text?: unknown }).text;
          return typeof t === "string" ? t : JSON.stringify(c);
        }
        return JSON.stringify(c);
      })
      .join("\n");
  }
  return JSON.stringify(content);
}

function useTypewriter(target: string | null, speed = 35): string {
  const [partial, setPartial] = useState("");
  useEffect(() => {
    if (!target) {
      setPartial("");
      return;
    }
    setPartial("");
    let i = 0;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const tick = () => {
      i += 1;
      setPartial(target.slice(0, i));
      if (i < target.length) {
        timer = setTimeout(tick, speed);
      }
    };
    timer = setTimeout(tick, speed);
    return () => {
      if (timer) clearTimeout(timer);
    };
  }, [target, speed]);
  return partial;
}

function ChatTitle({
  title,
  animatingTitle,
  onAnimationDone,
}: {
  title: string | null;
  animatingTitle: string | null;
  onAnimationDone: () => void;
}) {
  const typed = useTypewriter(animatingTitle);
  const isAnimating = Boolean(animatingTitle);
  const done = isAnimating && typed === animatingTitle;

  useEffect(() => {
    if (done) onAnimationDone();
  }, [done, onAnimationDone]);

  const text = isAnimating ? typed : (title ?? "Moncode");
  return (
    <span className="truncate">
      {text}
      {isAnimating && !done && (
        <span className="ml-0.5 inline-block w-[1px] animate-pulse bg-foreground align-middle">
          &nbsp;
        </span>
      )}
    </span>
  );
}

function ChatPane({
  items,
  todos,
  input,
  setInput,
  submit,
  busy,
  promptQueue,
  onRemoveQueued,
  bootStatus,
  transcriptLoaded,
  title,
  animatingTitle,
  onTitleAnimationDone,
}: {
  items: ChatItem[];
  todos: TodoItem[];
  input: string;
  setInput: (v: string) => void;
  submit: () => void;
  busy: boolean;
  promptQueue: QueuedPrompt[];
  onRemoveQueued: (id: string) => void;
  bootStatus: BootStatus;
  transcriptLoaded: boolean;
  title: string | null;
  animatingTitle: string | null;
  onTitleAnimationDone: () => void;
}) {
  const ready = bootStatus === "ready" && transcriptLoaded;
  const placeholder =
    bootStatus === "failed"
      ? "Sandbox failed to boot — refresh"
      : bootStatus !== "ready"
        ? "Spinning up workspace…"
        : !transcriptLoaded
          ? "Loading conversation…"
          : busy
            ? "Queue another prompt…"
            : "Build a Monad…";

  const visibleItems = items.filter(
    (item) => !(item.kind === "tool_use" && item.name === "TodoWrite"),
  );

  const handleSubmit = useCallback(
    (_message: PromptInputMessage) => {
      submit();
    },
    [submit],
  );

  return (
    <section className="flex h-full min-h-0 flex-col">
      <header className="flex h-12 shrink-0 items-center gap-2 border-b px-4 font-semibold">
        <ChatTitle
          title={title}
          animatingTitle={animatingTitle}
          onAnimationDone={onTitleAnimationDone}
        />
        <div className="flex-1" />
      </header>
      <Conversation className="flex-1 min-h-0">
        <ConversationContent className="!gap-0">
          {bootStatus === "ready" && !transcriptLoaded && (
            <TextShimmer className="text-xs">
              Loading conversation…
            </TextShimmer>
          )}
          {ready && visibleItems.length === 0 && (
            <div className="text-xs text-muted-foreground">
              Describe a Monad dApp and the agent will build it. Files write
              into the sandbox and the preview reloads on the right.
            </div>
          )}
          {groupTurnsByUser(visibleItems).map((section, gi) => (
            <TurnSection key={gi} section={section} />
          ))}
          {busy && (
            <div className="px-1 pb-4">
              <ThinkingBar />
            </div>
          )}
          <div aria-hidden className="h-8 shrink-0" />
        </ConversationContent>
        <ConversationScrollButton />
      </Conversation>
      <ChatChrome todos={todos}>
        <PromptInput onSubmit={handleSubmit}>
          <PromptInputBody>
            <PromptInputTextarea
              value={input}
              onChange={(e) => setInput(e.currentTarget.value)}
              placeholder={placeholder}
              disabled={!ready}
            />
          </PromptInputBody>
          <PromptInputFooter>
            <div />
            <PromptInputSubmit disabled={!ready || !input.trim()} />
          </PromptInputFooter>
        </PromptInput>
      </ChatChrome>
    </section>
  );
}

function ChatChrome({
  todos,
  children,
}: {
  todos: TodoItem[];
  children: React.ReactNode;
}) {
  const fade =
    "linear-gradient(to top, black 0%, black 12%, rgba(0,0,0,0.55) 48%, transparent 100%)";
  return (
    <div className="relative shrink-0">
      <div
        aria-hidden
        className="pointer-events-none absolute -top-14 left-0 right-0 h-14 bg-background backdrop-blur-sm"
        style={{ maskImage: fade, WebkitMaskImage: fade }}
      />
      {todos.length > 0 && <TodoAccordion todos={todos} />}
      <div className="px-3 pb-3">{children}</div>
    </div>
  );
}

function TodoAccordion({ todos }: { todos: TodoItem[] }) {
  const inProgress = todos.filter((t) => t.status === "in_progress").length;
  const pending = todos.filter((t) => t.status === "pending").length;
  const completed = todos.filter((t) => t.status === "completed").length;

  const summary =
    completed === todos.length
      ? "all done"
      : [
          inProgress > 0 ? `${inProgress} in progress` : null,
          pending > 0 ? `${pending} pending` : null,
          completed > 0 ? `${completed} done` : null,
        ]
          .filter(Boolean)
          .join(" · ");

  return (
    <div className="shrink-0 bg-muted/30 px-4 py-2">
      <Task defaultOpen={false}>
        <TaskTrigger title={`Tasks · ${todos.length} — ${summary}`} />
        <TaskContent>
          {todos.map((t, i) => (
            <TaskItem
              key={i}
              className="flex items-start gap-2 text-xs leading-snug"
            >
              <TodoStatusIcon status={t.status} />
              <span
                className={cn(
                  t.status === "completed" && "line-through",
                )}
              >
                {t.status === "in_progress" && t.activeForm
                  ? t.activeForm
                  : t.content}
              </span>
            </TaskItem>
          ))}
        </TaskContent>
      </Task>
    </div>
  );
}

function TodoStatusIcon({ status }: { status: TodoStatus }) {
  if (status === "completed") {
    return (
      <CircleCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-600 dark:text-emerald-500" />
    );
  }
  if (status === "in_progress") {
    return (
      <Loader2 className="mt-0.5 h-3.5 w-3.5 shrink-0 animate-spin text-primary" />
    );
  }
  return (
    <Circle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
  );
}

type TurnSectionData = {
  user: Extract<ChatItem, { kind: "user" }> | null;
  rest: ChatItem[];
};

function groupTurnsByUser(items: ChatItem[]): TurnSectionData[] {
  const sections: TurnSectionData[] = [];
  let current: TurnSectionData = { user: null, rest: [] };
  for (const item of items) {
    if (item.kind === "user") {
      if (current.user || current.rest.length > 0) sections.push(current);
      current = { user: item, rest: [] };
    } else {
      current.rest.push(item);
    }
  }
  if (current.user || current.rest.length > 0) sections.push(current);
  return sections;
}

type RestGroup =
  | { kind: "single"; item: ChatItem }
  | { kind: "skill_run"; skill: string; items: ChatItem[] };

function groupRestBySkill(items: ChatItem[]): RestGroup[] {
  const out: RestGroup[] = [];
  let i = 0;
  while (i < items.length) {
    const skill = skillOf(items[i]);
    if (skill) {
      const run: ChatItem[] = [];
      while (i < items.length && skillOf(items[i]) === skill) {
        run.push(items[i]);
        i += 1;
      }
      out.push({ kind: "skill_run", skill, items: run });
    } else {
      out.push({ kind: "single", item: items[i] });
      i += 1;
    }
  }
  return out;
}

function skillOf(item: ChatItem): string | undefined {
  if (item.kind === "assistant" || item.kind === "tool_use") {
    return item.attributionSkill;
  }
  return undefined;
}

function TurnSection({ section }: { section: TurnSectionData }) {
  const groups = groupRestBySkill(section.rest);
  return (
    <div className="flex flex-col">
      {section.user && <PinnedPrompt text={section.user.text} />}
      {groups.length > 0 && (
        <div className="flex flex-col gap-4 pb-6 pt-4">
          {groups.map((g, i) =>
            g.kind === "skill_run" ? (
              <SkillRun key={i} skill={g.skill} items={g.items} />
            ) : (
              <ChatItemRow key={i} item={g.item} />
            ),
          )}
        </div>
      )}
    </div>
  );
}

function SkillRun({ skill, items }: { skill: string; items: ChatItem[] }) {
  const title = humanizeSkill(skill);
  return (
    <Steps defaultOpen>
      <StepsTrigger>Agent run: {title}</StepsTrigger>
      <StepsContent>
        <div className="flex flex-col gap-3">
          {items.map((item, i) => (
            <StepsItem key={i} className="text-foreground">
              <ChatItemRow item={item} />
            </StepsItem>
          ))}
        </div>
      </StepsContent>
    </Steps>
  );
}

function humanizeSkill(skill: string): string {
  const parts = skill.split(":");
  const tail = parts[parts.length - 1] ?? skill;
  return tail.replace(/[-_]/g, " ");
}

function PinnedPrompt({ text }: { text: string }) {
  const fade =
    "linear-gradient(to bottom, black 0%, black 72%, rgba(0,0,0,0.6) 88%, transparent 100%)";
  return (
    <div className="sticky top-0 z-20 -mx-4 px-4 pb-8 pt-4">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 bg-background/75 backdrop-blur-lg"
        style={{ maskImage: fade, WebkitMaskImage: fade }}
      />
      <div className="relative rounded-lg border border-border/80 bg-secondary px-4 py-2.5 shadow-sm">
        <div
          className="line-clamp-[7] whitespace-pre-wrap break-words font-sans text-sm text-secondary-foreground"
          title={text}
        >
          {text}
        </div>
      </div>
    </div>
  );
}

function ChatItemRow({ item }: { item: ChatItem }) {
  if (item.kind === "user") {
    return (
      <Message from="user">
        <MessageContent>
          <pre className="whitespace-pre-wrap break-words font-sans text-sm">
            {item.text}
          </pre>
        </MessageContent>
      </Message>
    );
  }
  if (item.kind === "assistant" || item.kind === "result") {
    return (
      <Message from="assistant">
        <MessageContent>
          <MessageResponse>{item.text}</MessageResponse>
        </MessageContent>
      </Message>
    );
  }
  if (item.kind === "tool_use") {
    return <ToolUseCard item={item} />;
  }
  if (item.kind === "stderr") {
    return <StderrCard text={item.text} />;
  }
  return (
    <div className="rounded-lg border border-destructive/50 bg-destructive/10 px-3 py-2 text-destructive-foreground">
      <pre className="whitespace-pre-wrap break-words font-sans text-sm">
        {item.text}
      </pre>
    </div>
  );
}

function StderrCard({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  return (
    <Collapsible
      open={open}
      onOpenChange={setOpen}
      className="self-start max-w-[95%] rounded-lg border bg-muted/40 px-3 py-1.5 text-xs text-muted-foreground"
    >
      <CollapsibleTrigger className="flex w-full items-center gap-1.5 text-left">
        {open ? (
          <ChevronDown className="h-3.5 w-3.5 shrink-0" />
        ) : (
          <ChevronRight className="h-3.5 w-3.5 shrink-0" />
        )}
        <span className="font-semibold">agent stderr</span>
      </CollapsibleTrigger>
      <CollapsibleContent className="mt-1.5">
        <pre className="whitespace-pre-wrap break-words font-mono">{text}</pre>
      </CollapsibleContent>
    </Collapsible>
  );
}

function ToolUseCard({
  item,
}: {
  item: Extract<ChatItem, { kind: "tool_use" }>;
}) {
  const state: ToolPart["state"] =
    item.result === undefined
      ? "input-available"
      : item.isError
        ? "output-error"
        : "output-available";

  const input =
    item.input && typeof item.input === "object"
      ? (item.input as Record<string, unknown>)
      : item.input !== undefined
        ? { value: String(item.input) }
        : undefined;

  const output =
    item.result !== undefined && !item.isError ? item.result : undefined;

  const toolPart: ToolPart = {
    type: item.name,
    state,
    input,
    output,
    errorText: item.isError ? item.result : undefined,
  };

  return <Tool toolPart={toolPart} />;
}

function RightPane({
  bootStatus,
  bootPhase,
  bootError,
  sandboxUrl,
  iframeNonce,
  reloadPreview,
  tab,
  setTab,
  tree,
  activeFile,
  activeContent,
  openFile,
  refetchFiles,
}: {
  bootStatus: BootStatus;
  bootPhase: BootPhase | null;
  bootError: string | null;
  sandboxUrl: string | null;
  iframeNonce: number;
  reloadPreview: () => void;
  tab: Tab;
  setTab: (t: Tab) => void;
  tree: FileNode[];
  activeFile: string | null;
  activeContent: string;
  openFile: (p: string) => void;
  refetchFiles: () => void;
}) {
  if (bootStatus !== "ready") {
    return (
      <SandboxLoader phase={bootPhase} error={bootError} status={bootStatus} />
    );
  }
  return (
    <Tabs
      value={tab}
      onValueChange={(v) => setTab(v as Tab)}
      className="flex h-full min-h-0 flex-col"
    >
      <header className="flex h-12 shrink-0 items-center gap-2 border-b px-3">
        <TabsList>
          <TabsTrigger value="preview">Preview</TabsTrigger>
          <TabsTrigger value="files">Files</TabsTrigger>
        </TabsList>
        <div className="flex-1" />
        {tab === "files" && (
          <Button variant="outline" size="sm" onClick={refetchFiles}>
            <RefreshCw className="mr-1 h-3.5 w-3.5" /> Refresh
          </Button>
        )}
      </header>
      <TabsContent
        value="preview"
        forceMount
        className={cn(
          "mt-0 flex-1 min-h-0 data-[state=inactive]:hidden",
        )}
      >
        <PreviewIframe
          url={sandboxUrl}
          nonce={iframeNonce}
          onReload={reloadPreview}
        />
      </TabsContent>
      <TabsContent
        value="files"
        forceMount
        className={cn(
          "mt-0 flex-1 min-h-0 data-[state=inactive]:hidden",
        )}
      >
        <FilesView
          tree={tree}
          activeFile={activeFile}
          activeContent={activeContent}
          openFile={openFile}
        />
      </TabsContent>
    </Tabs>
  );
}

function PreviewIframe({
  url,
  nonce,
  onReload,
}: {
  url: string | null;
  nonce: number;
  onReload: () => void;
}) {
  const src = useMemo(() => {
    if (!url) return undefined;
    return nonce > 0 ? `${url}?_=${nonce}` : url;
  }, [url, nonce]);

  if (!url) {
    return (
      <div className="p-4 text-sm text-muted-foreground">
        No preview URL yet.
      </div>
    );
  }

  return (
    <WebPreview
      key={url}
      defaultUrl={url}
      className="h-full rounded-none border-0 bg-transparent"
    >
      <WebPreviewNavigation>
        <WebPreviewNavigationButton tooltip="Reload" onClick={onReload}>
          <RefreshCw className="h-4 w-4" />
        </WebPreviewNavigationButton>
        <WebPreviewUrl value={url} readOnly />
        <Button asChild variant="ghost" size="icon-sm">
          <a
            href={url}
            target="_blank"
            rel="noreferrer"
            aria-label="Open in new tab"
          >
            <ExternalLink className="h-4 w-4" />
          </a>
        </Button>
      </WebPreviewNavigation>
      <WebPreviewBody src={src} className="bg-white" />
    </WebPreview>
  );
}

function FilesView({
  tree,
  activeFile,
  activeContent,
  openFile,
}: {
  tree: FileNode[];
  activeFile: string | null;
  activeContent: string;
  openFile: (p: string) => void;
}) {
  const rootPaths = useMemo(
    () =>
      new Set(tree.filter((n) => n.type === "dir").map((n) => n.path)),
    [tree],
  );

  return (
    <ResizablePanelGroup direction="horizontal" className="h-full">
      <ResizablePanel defaultSize={28} minSize={15} className="min-w-0">
        <ScrollArea className="h-full">
          <div className="p-2">
            <ElementsFileTree
              defaultExpanded={rootPaths}
              selectedPath={activeFile ?? undefined}
              onSelect={openFile}
              className="rounded-none border-0 bg-transparent"
            >
              {renderFileNodes(tree)}
            </ElementsFileTree>
          </div>
        </ScrollArea>
      </ResizablePanel>
      <ResizableHandle />
      <ResizablePanel defaultSize={72} minSize={30} className="min-w-0">
        <ScrollArea className="h-full">
          <div className="p-3">
            {activeFile ? (
              <CodeBlock
                code={activeContent}
                language={languageForPath(activeFile)}
              >
                <CodeBlockHeader>
                  <CodeBlockTitle>
                    <FileIcon size={14} />
                    <CodeBlockFilename>{activeFile}</CodeBlockFilename>
                  </CodeBlockTitle>
                  <CodeBlockActions>
                    <CodeBlockCopyButton />
                  </CodeBlockActions>
                </CodeBlockHeader>
              </CodeBlock>
            ) : (
              <div className="text-sm text-muted-foreground">
                Select a file.
              </div>
            )}
          </div>
        </ScrollArea>
      </ResizablePanel>
    </ResizablePanelGroup>
  );
}

function renderFileNodes(nodes: FileNode[]): ReactNode {
  return nodes.map((node) =>
    node.type === "dir" ? (
      <FileTreeFolder key={node.path} path={node.path} name={node.name}>
        {node.children && node.children.length > 0
          ? renderFileNodes(node.children)
          : null}
      </FileTreeFolder>
    ) : (
      <FileTreeFile key={node.path} path={node.path} name={node.name} />
    ),
  );
}

const LANGUAGE_BY_EXT: Record<string, BundledLanguage> = {
  ts: "typescript",
  tsx: "tsx",
  js: "javascript",
  jsx: "jsx",
  mjs: "javascript",
  cjs: "javascript",
  json: "json",
  jsonc: "json",
  md: "markdown",
  mdx: "mdx",
  css: "css",
  scss: "scss",
  html: "html",
  htm: "html",
  sol: "solidity",
  yml: "yaml",
  yaml: "yaml",
  toml: "toml",
  sh: "bash",
  bash: "bash",
  py: "python",
  rs: "rust",
  go: "go",
};

function languageForPath(path: string): BundledLanguage {
  const ext = path.split(".").pop()?.toLowerCase() ?? "";
  return LANGUAGE_BY_EXT[ext] ?? "text";
}

