"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

type BootStatus = "idle" | "pending" | "ready" | "failed";

type ChatItem =
  | { kind: "user"; text: string }
  | { kind: "assistant"; text: string }
  | {
      kind: "tool_use";
      name: string;
      input: unknown;
      result?: string;
      isError?: boolean;
    }
  | { kind: "result"; text: string }
  | { kind: "error"; text: string };

type FileNode = {
  name: string;
  path: string;
  type: "file" | "dir";
  children?: FileNode[];
};

type Tab = "preview" | "files";

export default function Page() {
  const [bootStatus, setBootStatus] = useState<BootStatus>("idle");
  const [bootLog, setBootLog] = useState<string[]>([]);
  const [bootError, setBootError] = useState<string | null>(null);
  const [sandboxUrl, setSandboxUrl] = useState<string | null>(null);

  const [items, setItems] = useState<ChatItem[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);

  const [tab, setTab] = useState<Tab>("preview");
  const [tree, setTree] = useState<FileNode[]>([]);
  const [activeFile, setActiveFile] = useState<string | null>(null);
  const [activeContent, setActiveContent] = useState<string>("");
  const [iframeNonce, setIframeNonce] = useState(0);

  const ensureSandbox = useCallback(async () => {
    setBootStatus("pending");
    try {
      const res = await fetch("/api/sandbox", { method: "POST" });
      const data = await res.json();
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
    }
  }, []);

  useEffect(() => {
    void ensureSandbox();
  }, [ensureSandbox]);

  useEffect(() => {
    if (bootStatus !== "pending") return;
    const es = new EventSource("/api/sandbox/stream");
    es.addEventListener("log", (ev) => {
      try {
        const data = JSON.parse((ev as MessageEvent).data);
        setBootLog((prev) => [...prev, data.line]);
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
  }, [bootStatus]);

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

  const send = useCallback(async () => {
    const text = input.trim();
    if (!text || busy) return;
    setItems((prev) => [...prev, { kind: "user", text }]);
    setInput("");
    setBusy(true);

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: text }),
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
          handleSseBlock(event, setItems);
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
      setBusy(false);
      void refetchFiles();
      setIframeNonce((n) => n + 1);
    }
  }, [busy, input, refetchFiles]);

  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "minmax(360px, 40fr) 60fr",
        height: "100vh",
        gap: 1,
        background: "#1a1a24",
      }}
    >
      <ChatPane
        items={items}
        input={input}
        setInput={setInput}
        send={send}
        busy={busy}
        bootStatus={bootStatus}
      />
      <RightPane
        bootStatus={bootStatus}
        bootLog={bootLog}
        bootError={bootError}
        sandboxUrl={sandboxUrl}
        iframeNonce={iframeNonce}
        tab={tab}
        setTab={setTab}
        tree={tree}
        activeFile={activeFile}
        activeContent={activeContent}
        openFile={openFile}
        refetchFiles={refetchFiles}
      />
    </div>
  );
}

function handleSseBlock(
  block: string,
  setItems: React.Dispatch<React.SetStateAction<ChatItem[]>>,
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
      setItems((prev) => mergeSdkMessage(prev, msg as Record<string, unknown>));
    }
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

function mergeSdkMessage(
  prev: ChatItem[],
  msg: Record<string, unknown>,
): ChatItem[] {
  const type = msg.type;
  if (type === "assistant") {
    const inner = (msg.message ?? {}) as { content?: unknown };
    const blocks = Array.isArray(inner.content) ? inner.content : [];
    const next = [...prev];
    for (const block of blocks as Array<Record<string, unknown>>) {
      if (block.type === "text" && typeof block.text === "string") {
        next.push({ kind: "assistant", text: block.text });
      } else if (block.type === "tool_use") {
        next.push({
          kind: "tool_use",
          name: typeof block.name === "string" ? block.name : "tool",
          input: block.input,
        });
      }
    }
    return next;
  }
  if (type === "user") {
    const inner = (msg.message ?? {}) as { content?: unknown };
    const blocks = Array.isArray(inner.content) ? inner.content : [];
    const next = [...prev];
    for (const block of blocks as Array<Record<string, unknown>>) {
      if (block.type === "tool_result") {
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
    return next;
  }
  if (type === "result") {
    const text = typeof msg.result === "string" ? msg.result : "";
    if (!text) return prev;
    return [...prev, { kind: "result", text }];
  }
  return prev;
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

function ChatPane({
  items,
  input,
  setInput,
  send,
  busy,
  bootStatus,
}: {
  items: ChatItem[];
  input: string;
  setInput: (v: string) => void;
  send: () => void;
  busy: boolean;
  bootStatus: BootStatus;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [items.length]);

  const placeholder =
    bootStatus === "ready"
      ? "Build a Monad…"
      : bootStatus === "failed"
        ? "Sandbox failed to boot — refresh"
        : "Spinning up workspace…";

  return (
    <section
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100%",
        background: "#0b0b10",
        minWidth: 0,
      }}
    >
      <header
        style={{
          padding: "12px 16px",
          borderBottom: "1px solid #1a1a24",
          fontWeight: 600,
        }}
      >
        Moncode
      </header>
      <div
        ref={scrollRef}
        style={{
          flex: 1,
          overflowY: "auto",
          padding: "16px",
          display: "flex",
          flexDirection: "column",
          gap: 12,
        }}
      >
        {items.length === 0 && (
          <div style={{ opacity: 0.6, fontSize: 13 }}>
            Describe a Monad dApp and the agent will build it. Files write
            into the sandbox and the preview reloads on the right.
          </div>
        )}
        {items.map((item, i) => (
          <ChatBubble key={i} item={item} />
        ))}
      </div>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          send();
        }}
        style={{
          display: "flex",
          gap: 8,
          padding: 12,
          borderTop: "1px solid #1a1a24",
        }}
      >
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              send();
            }
          }}
          placeholder={placeholder}
          rows={2}
          disabled={bootStatus !== "ready" || busy}
          style={{ flex: 1, resize: "none" }}
        />
        <button
          type="submit"
          disabled={bootStatus !== "ready" || busy || !input.trim()}
        >
          {busy ? "…" : "Send"}
        </button>
      </form>
    </section>
  );
}

function ChatBubble({ item }: { item: ChatItem }) {
  if (item.kind === "user") {
    return (
      <div
        style={{
          alignSelf: "flex-end",
          background: "#1f2533",
          border: "1px solid #2a2f44",
          borderRadius: 8,
          padding: "8px 12px",
          maxWidth: "85%",
        }}
      >
        <pre>{item.text}</pre>
      </div>
    );
  }
  if (item.kind === "assistant" || item.kind === "result") {
    return (
      <div
        style={{
          alignSelf: "flex-start",
          background: "#14141c",
          border: "1px solid #1f1f2c",
          borderRadius: 8,
          padding: "8px 12px",
          maxWidth: "95%",
        }}
      >
        <pre>{item.text}</pre>
      </div>
    );
  }
  if (item.kind === "tool_use") {
    return <ToolUseCard item={item} />;
  }
  return (
    <div
      style={{
        background: "#3a1414",
        border: "1px solid #5a1f1f",
        borderRadius: 8,
        padding: "8px 12px",
      }}
    >
      <pre>{item.text}</pre>
    </div>
  );
}

function ToolUseCard({
  item,
}: {
  item: Extract<ChatItem, { kind: "tool_use" }>;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div
      style={{
        alignSelf: "flex-start",
        background: "#10131a",
        border: "1px solid #1c2030",
        borderRadius: 8,
        padding: "6px 10px",
        fontSize: 12,
        maxWidth: "95%",
      }}
    >
      <div
        onClick={() => setOpen((v) => !v)}
        style={{
          cursor: "pointer",
          opacity: 0.85,
          display: "flex",
          gap: 6,
          alignItems: "center",
        }}
      >
        <span>{open ? "▾" : "▸"}</span>
        <span style={{ fontWeight: 600 }}>{item.name}</span>
        {item.isError && (
          <span style={{ color: "#ff6b6b" }}>error</span>
        )}
      </div>
      {open && (
        <div style={{ marginTop: 6 }}>
          <pre style={{ opacity: 0.8 }}>
            {JSON.stringify(item.input, null, 2)}
          </pre>
          {item.result !== undefined && (
            <pre
              style={{
                marginTop: 6,
                opacity: 0.7,
                borderTop: "1px solid #1c2030",
                paddingTop: 6,
              }}
            >
              {item.result}
            </pre>
          )}
        </div>
      )}
    </div>
  );
}

function RightPane({
  bootStatus,
  bootLog,
  bootError,
  sandboxUrl,
  iframeNonce,
  tab,
  setTab,
  tree,
  activeFile,
  activeContent,
  openFile,
  refetchFiles,
}: {
  bootStatus: BootStatus;
  bootLog: string[];
  bootError: string | null;
  sandboxUrl: string | null;
  iframeNonce: number;
  tab: Tab;
  setTab: (t: Tab) => void;
  tree: FileNode[];
  activeFile: string | null;
  activeContent: string;
  openFile: (p: string) => void;
  refetchFiles: () => void;
}) {
  if (bootStatus !== "ready") {
    return <BootPanel log={bootLog} error={bootError} status={bootStatus} />;
  }
  return (
    <section
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100%",
        background: "#0b0b10",
        minWidth: 0,
      }}
    >
      <header
        style={{
          padding: "8px 12px",
          borderBottom: "1px solid #1a1a24",
          display: "flex",
          gap: 6,
          alignItems: "center",
        }}
      >
        <button
          onClick={() => setTab("preview")}
          style={{
            background: tab === "preview" ? "#1a1a24" : "transparent",
          }}
        >
          Preview
        </button>
        <button
          onClick={() => setTab("files")}
          style={{
            background: tab === "files" ? "#1a1a24" : "transparent",
          }}
        >
          Files
        </button>
        <div style={{ flex: 1 }} />
        {tab === "preview" && sandboxUrl && (
          <>
            <a
              href={sandboxUrl}
              target="_blank"
              rel="noreferrer"
              style={{ color: "inherit", textDecoration: "none" }}
            >
              <button>Open ↗</button>
            </a>
          </>
        )}
        {tab === "files" && (
          <button onClick={refetchFiles}>Refresh</button>
        )}
      </header>
      {tab === "preview" ? (
        <PreviewIframe url={sandboxUrl} nonce={iframeNonce} />
      ) : (
        <FilesView
          tree={tree}
          activeFile={activeFile}
          activeContent={activeContent}
          openFile={openFile}
        />
      )}
    </section>
  );
}

function PreviewIframe({
  url,
  nonce,
}: {
  url: string | null;
  nonce: number;
}) {
  const src = useMemo(() => {
    if (!url) return null;
    return nonce > 0 ? `${url}?_=${nonce}` : url;
  }, [url, nonce]);
  if (!src) {
    return (
      <div style={{ padding: 16, opacity: 0.6 }}>No preview URL yet.</div>
    );
  }
  return (
    <iframe
      key={src}
      src={src}
      style={{ flex: 1, border: "none", background: "#fff" }}
    />
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
  return (
    <div
      style={{
        flex: 1,
        display: "grid",
        gridTemplateColumns: "260px 1fr",
        minHeight: 0,
      }}
    >
      <div
        style={{
          overflow: "auto",
          borderRight: "1px solid #1a1a24",
          padding: 8,
        }}
      >
        <FileTree nodes={tree} active={activeFile} onPick={openFile} />
      </div>
      <div style={{ overflow: "auto", padding: 12 }}>
        {activeFile ? (
          <pre style={{ fontSize: 12, lineHeight: 1.45 }}>
            {activeContent}
          </pre>
        ) : (
          <div style={{ opacity: 0.5 }}>Select a file.</div>
        )}
      </div>
    </div>
  );
}

function FileTree({
  nodes,
  active,
  onPick,
  depth = 0,
}: {
  nodes: FileNode[];
  active: string | null;
  onPick: (p: string) => void;
  depth?: number;
}) {
  return (
    <ul
      style={{
        listStyle: "none",
        margin: 0,
        padding: 0,
        paddingLeft: depth === 0 ? 0 : 12,
      }}
    >
      {nodes.map((node) => (
        <li key={node.path}>
          {node.type === "dir" ? (
            <details open={depth < 1}>
              <summary
                style={{
                  cursor: "pointer",
                  padding: "2px 4px",
                  fontSize: 13,
                }}
              >
                {node.name}
              </summary>
              {node.children && node.children.length > 0 && (
                <FileTree
                  nodes={node.children}
                  active={active}
                  onPick={onPick}
                  depth={depth + 1}
                />
              )}
            </details>
          ) : (
            <div
              onClick={() => onPick(node.path)}
              style={{
                cursor: "pointer",
                padding: "2px 4px",
                fontSize: 13,
                background: active === node.path ? "#1a1a24" : "transparent",
                borderRadius: 4,
              }}
            >
              {node.name}
            </div>
          )}
        </li>
      ))}
    </ul>
  );
}

function BootPanel({
  log,
  error,
  status,
}: {
  log: string[];
  error: string | null;
  status: BootStatus;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.scrollTo({ top: ref.current.scrollHeight });
  }, [log.length]);
  return (
    <section
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100%",
        background: "#0b0b10",
        padding: 16,
        gap: 12,
      }}
    >
      <header style={{ fontWeight: 600 }}>
        {status === "failed" ? "Boot failed" : "Spinning up your workspace…"}
      </header>
      <div
        ref={ref}
        style={{
          flex: 1,
          overflow: "auto",
          fontFamily:
            "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
          fontSize: 12,
          background: "#06060a",
          border: "1px solid #1a1a24",
          borderRadius: 6,
          padding: 12,
        }}
      >
        {log.length === 0 ? (
          <span style={{ opacity: 0.5 }}>connecting…</span>
        ) : (
          log.map((l, i) => <div key={i}>{l}</div>)
        )}
      </div>
      {error && (
        <div style={{ color: "#ff8080", fontSize: 12 }}>Error: {error}</div>
      )}
    </section>
  );
}
