import type {
  ChatProvider,
  ChatProviderRequest,
} from "../../apps/desktop/electron/ai/chat_provider";

export class FakeStreamingChatProvider implements ChatProvider {
  readonly metadata = Object.freeze({
    kind: "local" as const,
    name: "Castle fake provider",
    model: "fake-stream-v1",
  });

  constructor(private readonly chunks: readonly string[]) {}

  async *stream(request: ChatProviderRequest): AsyncIterable<string> {
    for (const chunk of this.chunks) {
      if (request.signal.aborted) throw new DOMException("cancelled", "AbortError");
      yield chunk;
    }
  }
}
