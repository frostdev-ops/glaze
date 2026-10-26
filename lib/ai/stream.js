// Ported from Rimeward src/lib/agent/stream.ts (MIT). The AI harness's stream primitives (docs/ai-harness.md): server-sent
// event framing for a provider's answer, and a count of a model's thinking. Pure; classic script for the worker,
// module.exports for node.
var GZ_AI_STREAM = globalThis.GZ_AI_STREAM || (() => {
  // Count only plain reasoning deltas, never encrypted payloads or summary text. receive({ tokens, estimated, detailDelta? }).
  const thinkingCounter = (receive) => {
    let bytes = 0;
    return {
      text(delta, expose = false) {
        if (!delta) return;
        // ponytail: four UTF-8 bytes/token; replace with provider counts whenever available.
        bytes += new TextEncoder().encode(delta).length;
        receive?.({ tokens: Math.ceil(bytes / 4), estimated: true, ...(expose ? { detailDelta: delta } : {}) });
      },
      usage(tokens) {
        if (typeof tokens === 'number' && Number.isSafeInteger(tokens) && tokens >= 0) receive?.({ tokens, estimated: false });
      },
    };
  };
  // Incremental SSE framing: data lines joined, an event at each blank line, comments and other fields skipped. A frame
  // over 16 MB throws.
  const FRAME = 16000000;
  const sseParser = (receive) => {
    let buffer = '', data = [], frameBytes = 0;
    const bytes = (text) => new TextEncoder().encode(text).length;
    const bounded = (n) => { if (n > FRAME) throw Object.assign(Error('Stream frame is too large.'), { category: 'invalid-response' }); };
    const line = (value, delimiter) => {
      frameBytes += bytes(value) + delimiter;
      bounded(frameBytes);
      if (!value) {
        frameBytes = 0;
        if (data.length) { const payload = data.join('\n'); data = []; receive(payload); }
      } else if (value === 'data' || value.startsWith('data:')) data.push(value.slice(5).replace(/^ /, ''));
    };
    const push = (text) => {
      buffer += text;
      for (;;) {
        const end = /\r\n|\n|\r(?!$)/.exec(buffer);
        if (!end) break;
        const value = buffer.slice(0, end.index);
        buffer = buffer.slice(end.index + end[0].length);
        line(value, end[0].length);
      }
      bounded(frameBytes + bytes(buffer));
    };
    return { push, finish() { push('\n\n'); } };
  };
  // A response body read to its end through sseParser; progress() on each chunk. A cancel stops the read.
  const readSse = async (body, receive, progress, signal, limit = 10 << 20) => {
    signal?.throwIfAborted();
    const reader = body.getReader(), decoder = new TextDecoder(), parser = sseParser(receive);
    const cancel = () => { reader.cancel().catch(() => {}); };
    let size = 0;
    signal?.addEventListener('abort', cancel, { once: true });
    try {
      for (;;) {
        const { done, value } = await reader.read();
        signal?.throwIfAborted();
        if (done) break;
        size += value.byteLength;
        if (size > limit) throw Object.assign(Error('Stream response is too large.'), { category: 'invalid-response' });
        progress?.();
        parser.push(decoder.decode(value, { stream: true }));
      }
      parser.push(decoder.decode()); parser.finish();
    } catch (error) {
      // A broken transport may never settle cancellation; do not hold the caller's error behind it.
      cancel();
      throw error;
    } finally { signal?.removeEventListener('abort', cancel); reader.releaseLock(); }
  };
  return { thinkingCounter, sseParser, readSse };
})();
if (typeof module !== 'undefined') module.exports = GZ_AI_STREAM; else GZ_AI_STREAM;
