/**
 * @zhourenke/dsh-reasoning-merge
 *
 * Merges the adjacent reasoning blocks of one model response by wrapping the
 * global `llm/stream` waterfall. There is no browser half.
 *
 * Verified against DSH 0.2.0-rc.2: the `llm/stream` waterfall signature, the
 * `StreamChunk` grammar, the `reasoning` block shape, and the
 * `finish.replayState` envelope are all unchanged across two host upgrades. No
 * shipped DSH package merges adjacent reasoning blocks, so the transform still
 * owns exactly one behavior: `BlockAssembler` keeps one block per stream index,
 * `AssistantStreamAccumulator` packs delta runs per index, the 0.2.0
 * `joinAssistantStreamText` joins text fragments while excluding reasoning, and
 * the chat client keys its live block list by `chunk.index`.
 *
 * @module @zhourenke/dsh-reasoning-merge
 */
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
