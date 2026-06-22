type SseHandlers = Record<string, (data: unknown) => void>;

export async function consumeSse(
  url: string,
  handlers: SseHandlers,
  options: { headers?: HeadersInit; signal?: AbortSignal } = {},
): Promise<void> {
  const res = await fetch(url, {
    headers: options.headers,
    signal: options.signal,
  });
  if (!res.ok || !res.body) {
    throw new Error(`SSE request failed (${res.status})`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    let boundary = buffer.indexOf("\n\n");
    while (boundary >= 0) {
      const block = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary + 2);
      dispatchSseBlock(block, handlers);
      boundary = buffer.indexOf("\n\n");
    }
  }

  if (buffer.trim()) {
    dispatchSseBlock(buffer, handlers);
  }
}

function dispatchSseBlock(block: string, handlers: SseHandlers): void {
  let event = "message";
  let dataLine = "";
  for (const raw of block.split("\n")) {
    if (raw.startsWith("event:")) event = raw.slice(6).trim();
    else if (raw.startsWith("data:")) dataLine += raw.slice(5).trim();
  }
  if (!dataLine) return;

  let payload: unknown;
  try {
    payload = JSON.parse(dataLine);
  } catch {
    payload = dataLine;
  }

  handlers[event]?.(payload);
}
