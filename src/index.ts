/**
 * @zhourenke/dsh-reasoning-merge
 *
 * Merges the adjacent reasoning blocks of one model response by wrapping the
 * global `llm/stream` waterfall. There is no browser half.
 *
 * Verified against DSH 0.2.0-rc.2 and 0.2.1-rc.2: the `llm/stream` waterfall signature, the
 * `StreamChunk` grammar, the `reasoning` block shape, and the
 * `finish.replayState` envelope are all unchanged across host upgrades. No
 * shipped DSH package merges adjacent reasoning blocks, so the transform still
 * owns exactly one behavior: `BlockAssembler` keeps one block per stream index,
 * `AssistantStreamAccumulator` packs delta runs per index, the 0.2.0
 * `joinAssistantStreamText` joins text fragments while excluding reasoning, and
 * the chat client keys its live block list by `chunk.index`.
 *
 * @module @zhourenke/dsh-reasoning-merge
 */

import type { Context } from '@deepseek-ai/cordis'
import type { ContentBlock, ReplayEnvelope, StreamChunk } from '@deepseek-ai/dsh-llm'

type ReasoningStartChunk = Extract<StreamChunk, { type: 'block-start' }>
type ReasoningDeltaChunk = Extract<StreamChunk, { type: 'reasoning-delta' }>
/** A reasoning `block-end`, narrowed from the host's own block union. */
type ReasoningEndChunk = Extract<StreamChunk, { type: 'block-end' }> & {
  block: Extract<ContentBlock, { type: 'reasoning' }>
}

function isReasoningStart(chunk: StreamChunk): chunk is ReasoningStartChunk {
  return chunk.type === 'block-start' && chunk.blockType === 'reasoning'
}

function isReasoningDelta(chunk: StreamChunk): chunk is ReasoningDeltaChunk {
  return chunk.type === 'reasoning-delta'
}

function isReasoningEnd(chunk: StreamChunk): chunk is ReasoningEndChunk {
  return chunk.type === 'block-end' && chunk.block.type === 'reasoning'
}

function hasMeaningfulText(text: string): boolean {
  return text.trim() !== ''
}

interface SourceBlock {
  readonly index: number
  readonly needsSeparator: boolean
  liveText: string
  canonicalText?: string
  pendingText: string
  emittedText: string
  separatorEmitted: boolean
  closed: boolean
}

interface ReasoningGroup {
  readonly mergedIndex: number
  readonly sources: SourceBlock[]
  current: SourceBlock
  hasMeaningfulText: boolean
}

function reasoningStart(index: number): ReasoningStartChunk {
  return {
    type: 'block-start',
    index,
    blockType: 'reasoning',
  }
}

function reasoningDelta(index: number, text: string): ReasoningDeltaChunk {
  return {
    type: 'reasoning-delta',
    index,
    text,
  }
}

function canonicalText(source: SourceBlock): string {
  return source.canonicalText ?? source.liveText
}

function source(index: number, needsSeparator: boolean): SourceBlock {
  return {
    index,
    needsSeparator,
    liveText: '',
    pendingText: '',
    emittedText: '',
    separatorEmitted: false,
    closed: false,
  }
}

function groupFor(index: number): ReasoningGroup {
  const first = source(index, false)
  return {
    mergedIndex: index,
    sources: [first],
    current: first,
    hasMeaningfulText: false,
  }
}

function mergedText(sources: readonly SourceBlock[]): string {
  let result = ''
  let sawMeaningful = false
  for (const item of sources) {
    const text = canonicalText(item)
    if (hasMeaningfulText(text) && sawMeaningful) result += '\n\n'
    result += text
    if (hasMeaningfulText(text)) sawMeaningful = true
  }
  return result
}

function emitUnemittedText(
  group: ReasoningGroup,
  item: SourceBlock,
  fallbackText: string,
): StreamChunk[] {
  const output: StreamChunk[] = []

  // An outstanding separator is the only state that holds text back, so
  // `pendingText` is the whole of what the source has not emitted yet, and an
  // empty one means the provider carried the text on the block-end instead of
  // in deltas.
  if (item.needsSeparator && !item.separatorEmitted) {
    const candidate = item.pendingText || fallbackText
    if (hasMeaningfulText(candidate)) {
      item.pendingText = ''
      item.separatorEmitted = true
      item.emittedText += candidate
      output.push(reasoningDelta(group.mergedIndex, `\n\n${candidate}`))
      return output
    }

    if (candidate !== '') {
      item.pendingText = ''
      item.emittedText += candidate
      output.push(reasoningDelta(group.mergedIndex, candidate))
    }
    return output
  }

  if (item.emittedText === '' && fallbackText !== '') {
    item.emittedText += fallbackText
    output.push(reasoningDelta(group.mergedIndex, fallbackText))
  }
  return output
}

function appendDelta(
  group: ReasoningGroup,
  item: SourceBlock,
  chunk: ReasoningDeltaChunk,
): StreamChunk[] {
  item.liveText += chunk.text

  if (item.needsSeparator && !item.separatorEmitted) {
    const candidate = item.pendingText + chunk.text
    if (!hasMeaningfulText(candidate)) {
      item.pendingText = candidate
      return []
    }

    item.pendingText = ''
    item.separatorEmitted = true
    item.emittedText += candidate
    return [reasoningDelta(group.mergedIndex, `\n\n${candidate}`)]
  }

  item.emittedText += chunk.text
  return [{ ...chunk, index: group.mergedIndex }]
}

class ReasoningNormalizer {
  private group: ReasoningGroup | undefined
  private readonly closedIndexes = new Set<number>()
  private mergeOccurred = false

  transform(chunk: StreamChunk): StreamChunk[] {
    if (chunk.type === 'finish') {
      const output = this.flushGroup()
      output.push(this.finishChunk(chunk))
      return output
    }
    if (isReasoningStart(chunk)) return this.reasoningStart(chunk)
    if (isReasoningDelta(chunk)) return this.reasoningDelta(chunk)
    if (isReasoningEnd(chunk)) return this.reasoningEnd(chunk)

    const output = this.flushGroup()
    output.push(chunk)
    return output
  }

  private finishChunk(chunk: Extract<StreamChunk, { type: 'finish' }>): StreamChunk {
    const replay: ReplayEnvelope | undefined = chunk.replayState
    if (!this.mergeOccurred || replay?.blocks === undefined) return chunk
    // `ReplayEnvelope.blocks` carries one entry per emitted block, and assembly
    // discards the whole envelope when that length no longer matches the emitted
    // block count. Merging changed the count, so retain the response-level half
    // and drop the block-aligned one — the one drop the host contract allows.
    return {
      ...chunk,
      replayState: {
        response: replay.response,
      },
    }
  }

  private reasoningStart(chunk: ReasoningStartChunk): StreamChunk[] {
    if (this.closedIndexes.has(chunk.index)) return []

    const group = this.group
    if (group === undefined) {
      this.group = groupFor(chunk.index)
      return [chunk]
    }

    // A start never continues an open source: the provider is opening a block,
    // so an unclosed one is closed first rather than being spliced into.
    if (!group.current.closed) {
      const output = this.flushGroup()
      this.group = groupFor(chunk.index)
      output.push(chunk)
      return output
    }

    this.addSource(group, chunk.index)
    return []
  }

  private reasoningDelta(chunk: ReasoningDeltaChunk): StreamChunk[] {
    if (this.closedIndexes.has(chunk.index)) return []

    const active = this.ensureActiveSource(chunk.index)
    active.output.push(...appendDelta(active.group, active.group.current, chunk))
    return active.output
  }

  private reasoningEnd(chunk: ReasoningEndChunk): StreamChunk[] {
    if (this.closedIndexes.has(chunk.index)) return []

    const active = this.ensureActiveSource(chunk.index)
    active.output.push(
      ...this.closeCurrent(active.group, active.group.current, chunk.block.text),
    )
    return active.output
  }

  /**
   * Point the active source at `index` for a delta or a block-end. The source is
   * continued when it already carries that index; otherwise the group gains a
   * source, except that an active source which never ended is closed and given a
   * group of its own — an unclosed block is never merged.
   */
  private ensureActiveSource(index: number): {
    output: StreamChunk[]
    group: ReasoningGroup
  } {
    const group = this.group
    if (group === undefined) {
      const opened = groupFor(index)
      this.group = opened
      return { output: [reasoningStart(index)], group: opened }
    }

    if (group.current.index === index) return { output: [], group }

    if (!group.current.closed) {
      const output = this.flushGroup()
      const opened = groupFor(index)
      this.group = opened
      output.push(reasoningStart(index))
      return { output, group: opened }
    }

    this.addSource(group, index)
    return { output: [], group }
  }

  private addSource(group: ReasoningGroup, index: number): void {
    const item = source(index, group.hasMeaningfulText)
    group.sources.push(item)
    group.current = item
  }

  private closeCurrent(
    group: ReasoningGroup,
    item: SourceBlock,
    authoritativeText?: string,
  ): StreamChunk[] {
    if (item.closed) return []
    if (authoritativeText !== undefined) item.canonicalText = authoritativeText

    const text = canonicalText(item)
    const output = emitUnemittedText(group, item, text)
    item.closed = true
    this.closedIndexes.add(item.index)
    if (hasMeaningfulText(text)) group.hasMeaningfulText = true
    return output
  }

  private flushGroup(): StreamChunk[] {
    const group = this.group
    if (group === undefined) return []

    const output = this.closeCurrent(group, group.current)
    if (group.sources.length > 1) this.mergeOccurred = true
    output.push({
      type: 'block-end',
      index: group.mergedIndex,
      block: {
        type: 'reasoning',
        text: mergedText(group.sources),
      },
    })
    this.group = undefined
    return output
  }

  /**
   * Emit whatever the stream still holds. Feeding a chunk cannot observe the end
   * of the input, so whoever stops feeding calls this: the wrapper when the
   * provider stream ends, the in-memory helper after its last chunk.
   */
  drain(): StreamChunk[] {
    return this.flushGroup()
  }
}

/**
 * Normalize one complete in-memory chunk sequence with the same state machine
 * used by the streaming wrapper. The sequence counts as complete input, so a
 * group still open at its end is closed — exactly as the wrapper closes it when
 * the provider stream ends. The helper is useful for focused tests.
 */
export function normalizeReasoningChunks(chunks: readonly StreamChunk[]): StreamChunk[] {
  const normalizer = new ReasoningNormalizer()
  const output: StreamChunk[] = []
  for (const chunk of chunks) output.push(...normalizer.transform(chunk))
  output.push(...normalizer.drain())
  return output
}

/**
 * Wrap one provider stream without buffering the complete response. A group the
 * provider left open when its stream ends is closed, so a stream that stops
 * without a terminal `finish` still leaves every block terminated. A `finish`
 * chunk is never synthesized: that terminal event belongs to the provider. The
 * upstream iterator is explicitly closed when a consumer stops early.
 */
export async function* normalizeReasoningStream(
  stream: AsyncIterable<StreamChunk>,
): AsyncIterable<StreamChunk> {
  const iterator = stream[Symbol.asyncIterator]()
  const normalizer = new ReasoningNormalizer()
  let completed = false
  let failed = false

  try {
    while (true) {
      const result = await iterator.next()
      if (result.done) {
        completed = true
        for (const chunk of normalizer.drain()) yield chunk
        return
      }
      for (const chunk of normalizer.transform(result.value)) yield chunk
    }
  } catch (error: unknown) {
    failed = true
    throw error
  } finally {
    if (!completed) {
      try {
        await iterator.return?.()
      } catch (error: unknown) {
        if (!failed) throw error
      }
    }
  }
}

export const name = 'dsh-reasoning-merge'

export function apply(ctx: Context): void {
  ctx.on('llm/stream', (_options, next) => normalizeReasoningStream(next()))
}
