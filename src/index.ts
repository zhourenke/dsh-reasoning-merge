import type { Context } from '@deepseek-ai/cordis'
import type { StreamChunk } from '@deepseek-ai/dsh-llm'

type ReasoningStartChunk = Extract<StreamChunk, { type: 'block-start' }>
type ReasoningDeltaChunk = Extract<StreamChunk, { type: 'reasoning-delta' }>
type ReasoningEndChunk = {
  type: 'block-end'
  index: number
  block: {
    type: 'reasoning'
    text: string
  }
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

function reasoningStart(index: number): StreamChunk {
  return {
    type: 'block-start',
    index,
    blockType: 'reasoning',
  }
}

function reasoningDelta(index: number, text: string): StreamChunk {
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
  const pending = item.pendingText

  if (item.needsSeparator && !item.separatorEmitted) {
    const candidate = pending || fallbackText
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

  if (pending !== '') {
    item.pendingText = ''
    item.emittedText += pending
    output.push(reasoningDelta(group.mergedIndex, pending))
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
    const replay = chunk.replayState
    if (!this.mergeOccurred || replay?.blocks === undefined) return chunk
    return {
      ...chunk,
      replayState: {
        response: replay.response,
      },
    }
  }

  private reasoningStart(chunk: ReasoningStartChunk): StreamChunk[] {
    if (this.closedIndexes.has(chunk.index)) return []

    const output: StreamChunk[] = []
    if (this.group !== undefined && !this.group.current.closed) {
      output.push(...this.flushGroup())
    }

    if (this.group === undefined) {
      this.group = groupFor(chunk.index)
      output.push(chunk)
      return output
    }

    this.addSource(chunk.index)
    return output
  }

  private reasoningDelta(chunk: ReasoningDeltaChunk): StreamChunk[] {
    if (this.closedIndexes.has(chunk.index)) return []

    const output: StreamChunk[] = []
    if (this.group === undefined) {
      this.group = groupFor(chunk.index)
      output.push(reasoningStart(chunk.index))
      output.push(...appendDelta(this.group, this.group.current, chunk))
      return output
    }

    if (this.group.current.index !== chunk.index) {
      if (!this.group.current.closed) {
        output.push(...this.flushGroup())
        this.group = groupFor(chunk.index)
        output.push(reasoningStart(chunk.index))
      } else {
        this.addSource(chunk.index)
      }
    }

    output.push(...appendDelta(this.group, this.group.current, chunk))
    return output
  }

  private reasoningEnd(chunk: ReasoningEndChunk): StreamChunk[] {
    if (this.closedIndexes.has(chunk.index)) return []

    const output: StreamChunk[] = []
    if (this.group === undefined) {
      this.group = groupFor(chunk.index)
      output.push(reasoningStart(chunk.index))
    } else if (this.group.current.index !== chunk.index) {
      if (!this.group.current.closed) {
        output.push(...this.flushGroup())
        this.group = groupFor(chunk.index)
        output.push(reasoningStart(chunk.index))
      } else {
        this.addSource(chunk.index)
      }
    }

    output.push(...this.closeCurrent(chunk.block.text))
    return output
  }

  private addSource(index: number): SourceBlock {
    if (this.group === undefined) throw new Error('reasoning group is not active')
    const item = source(index, this.group.hasMeaningfulText)
    this.group.sources.push(item)
    this.group.current = item
    return item
  }

  private closeCurrent(authoritativeText?: string): StreamChunk[] {
    if (this.group === undefined) return []
    const item = this.group.current
    if (item.closed) return []
    if (authoritativeText !== undefined) item.canonicalText = authoritativeText

    const output = emitUnemittedText(this.group, item, canonicalText(item))
    item.closed = true
    this.closedIndexes.add(item.index)
    if (hasMeaningfulText(canonicalText(item))) this.group.hasMeaningfulText = true
    return output
  }

  private flushGroup(): StreamChunk[] {
    const group = this.group
    if (group === undefined) return []

    const output = this.closeCurrent()
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
}

/**
 * Normalize one complete in-memory chunk sequence with the same state machine
 * used by the streaming wrapper. The helper is useful for focused tests.
 */
export function normalizeReasoningChunks(chunks: readonly StreamChunk[]): StreamChunk[] {
  const normalizer = new ReasoningNormalizer()
  const output: StreamChunk[] = []
  for (const chunk of chunks) output.push(...normalizer.transform(chunk))
  return output
}

/**
 * Wrap one provider stream without buffering the complete response. The
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
