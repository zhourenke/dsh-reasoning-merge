import type { Context } from '@deepseek-ai/cordis';
import type { StreamChunk } from '@deepseek-ai/dsh-llm';
/**
 * Normalize one complete in-memory chunk sequence with the same state machine
 * used by the streaming wrapper. The helper is useful for focused tests.
 */
export declare function normalizeReasoningChunks(chunks: readonly StreamChunk[]): StreamChunk[];
/**
 * Wrap one provider stream without buffering the complete response. The
 * upstream iterator is explicitly closed when a consumer stops early.
 */
export declare function normalizeReasoningStream(stream: AsyncIterable<StreamChunk>): AsyncIterable<StreamChunk>;
export declare const name = "dsh-reasoning-merge";
export declare function apply(ctx: Context): void;
