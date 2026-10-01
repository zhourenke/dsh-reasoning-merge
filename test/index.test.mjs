import assert from 'node:assert/strict'
import test from 'node:test'
import { BlockAssembler } from '@deepseek-ai/dsh-llm'
import {
  apply,
  name,
  normalizeReasoningChunks,
  normalizeReasoningStream,
} from '../lib/index.js'

function start(index, blockType = 'reasoning') {
  return { type: 'block-start', index, blockType }
}

function reasoningDelta(index, text) {
  return { type: 'reasoning-delta', index, text }
}

function reasoningEnd(index, text) {
  return { type: 'block-end', index, block: { type: 'reasoning', text } }
}

function textStart(index) {
  return start(index, 'text')
}

function textDelta(index, text) {
  return { type: 'text-delta', index, text }
}

function textEnd(index, text) {
  return { type: 'block-end', index, block: { type: 'text', text } }
}

function toolStart(index) {
  return start(index, 'tool-call')
}

function toolDelta(index, id, name, argumentsDelta) {
  return { type: 'tool-call-delta', index, id, name, argumentsDelta }
}

function toolEnd(index, id, name, args) {
  return { type: 'block-end', index, block: { type: 'tool-call', id, name, arguments: args } }
}

function usage(inputTokens = 3) {
  return { type: 'usage', usage: { inputTokens, outputTokens: 2 } }
}

function finish(kind = 'stop', replayState) {
  return {
    type: 'finish',
    reason: { kind },
    ...(replayState === undefined ? {} : { replayState }),
  }
}

async function collect(iterable) {
  const output = []
  for await (const chunk of iterable) output.push(chunk)
  return output
}

function assemble(chunks) {
  const assembler = new BlockAssembler()
  for (const chunk of chunks) assembler.push(chunk)
  return assembler
}

function reasoningBlocks(chunks) {
  return assemble(chunks).blocks().filter((block) => block.type === 'reasoning')
}

test('exports the Host plugin contract', () => {
  assert.equal(name, 'dsh-reasoning-merge')
  assert.equal(typeof apply, 'function')
  assert.equal(typeof normalizeReasoningStream, 'function')
})

test('registers exactly one llm stream waterfall listener', () => {
  const registrations = []
  const ctx = {
    on(eventName, listener) {
      registrations.push({ eventName, listener })
      return () => true
    },
  }

  apply(ctx)

  assert.equal(registrations.length, 1)
  assert.equal(registrations[0].eventName, 'llm/stream')
  assert.equal(typeof registrations[0].listener, 'function')
})

test('the registered listener merges reasoning across the provider stream', async () => {
  const registrations = []
  apply({
    on(eventName, listener) {
      registrations.push({ eventName, listener })
      return () => true
    },
  })
  const provider = (async function* () {
    yield start(0)
    yield reasoningDelta(0, 'A')
    yield reasoningEnd(0, 'A')
    yield start(1)
    yield reasoningDelta(1, 'B')
    yield reasoningEnd(1, 'B')
    yield finish()
  })()

  const output = await collect(registrations[0].listener({}, () => provider))

  assert.deepEqual(reasoningBlocks(output), [{ type: 'reasoning', text: 'A\n\nB' }])
})

test('merges two complete consecutive reasoning blocks with one separator', () => {
  const input = [
    start(0), reasoningDelta(0, 'A'), reasoningEnd(0, 'A'),
    start(1), reasoningDelta(1, 'B'), reasoningEnd(1, 'B'),
    finish(),
  ]
  const output = normalizeReasoningChunks(input)

  assert.deepEqual(reasoningBlocks(output), [{ type: 'reasoning', text: 'A\n\nB' }])
  assert.equal(output.filter((chunk) => chunk.type === 'block-start' && chunk.blockType === 'reasoning').length, 1)
  assert.equal(output.filter((chunk) => chunk.type === 'block-end' && chunk.block.type === 'reasoning').length, 1)
  assert.equal(output.filter((chunk) => chunk.type === 'reasoning-delta').some((chunk) => chunk.text === '\n\n'), false)
})

test('preserves source order across three or more reasoning blocks', () => {
  const input = [
    start(4), reasoningDelta(4, 'A'), reasoningEnd(4, 'A'),
    start(8), reasoningDelta(8, 'B'), reasoningEnd(8, 'B'),
    start(12), reasoningDelta(12, 'C'), reasoningEnd(12, 'C'),
    finish(),
  ]

  assert.deepEqual(reasoningBlocks(normalizeReasoningChunks(input)), [{
    type: 'reasoning',
    text: 'A\n\nB\n\nC',
  }])
})

test('does not add separators between deltas of one source block', () => {
  const input = [
    start(0), reasoningDelta(0, 'A'), reasoningDelta(0, 'B'), reasoningEnd(0, 'AB'), finish(),
  ]
  const output = normalizeReasoningChunks(input)

  assert.deepEqual(reasoningBlocks(output), [{ type: 'reasoning', text: 'AB' }])
  assert.deepEqual(
    output.filter((chunk) => chunk.type === 'reasoning-delta').map((chunk) => chunk.text),
    ['A', 'B'],
  )
})

test('empty reasoning blocks do not create an extra separator', () => {
  const input = [
    start(0), reasoningDelta(0, 'A'), reasoningEnd(0, 'A'),
    start(1), reasoningEnd(1, ''),
    start(2), reasoningDelta(2, 'B'), reasoningEnd(2, 'B'),
    finish(),
  ]

  assert.deepEqual(reasoningBlocks(normalizeReasoningChunks(input)), [{
    type: 'reasoning',
    text: 'A\n\nB',
  }])
})

test('buffers whitespace until a following source is known to be meaningful', () => {
  const input = [
    start(0), reasoningDelta(0, 'A'), reasoningEnd(0, 'A'),
    start(1), reasoningDelta(1, ' '), reasoningDelta(1, 'B'), reasoningEnd(1, ' B'),
    finish(),
  ]
  const output = normalizeReasoningChunks(input)

  assert.deepEqual(reasoningBlocks(output), [{ type: 'reasoning', text: 'A\n\n B' }])
  assert.deepEqual(
    output.filter((chunk) => chunk.type === 'reasoning-delta').map((chunk) => chunk.text),
    ['A', '\n\n B'],
  )
})

test('a source that never ended is closed instead of merged', () => {
  const viaStart = normalizeReasoningChunks([
    start(0), reasoningDelta(0, 'A'),
    start(7), reasoningDelta(7, 'B'), reasoningEnd(7, 'B'),
    finish(),
  ])
  const viaDelta = normalizeReasoningChunks([
    start(0), reasoningDelta(0, 'A'),
    reasoningDelta(9, 'B'), reasoningEnd(9, 'B'),
    finish(),
  ])

  for (const output of [viaStart, viaDelta]) {
    assert.deepEqual(reasoningBlocks(output), [
      { type: 'reasoning', text: 'A' },
      { type: 'reasoning', text: 'B' },
    ])
  }
})

test('a source that carries its text only on the block-end still merges', () => {
  const output = normalizeReasoningChunks([
    start(0), reasoningDelta(0, 'A'), reasoningEnd(0, 'A'),
    start(1), reasoningEnd(1, 'X'),
    finish(),
  ])

  assert.deepEqual(reasoningBlocks(output), [{ type: 'reasoning', text: 'A\n\nX' }])
  assert.deepEqual(
    output.filter((chunk) => chunk.type === 'reasoning-delta').map((chunk) => chunk.text),
    ['A', '\n\nX'],
  )
})

test('a whitespace-only source is emitted without a separator', () => {
  const output = normalizeReasoningChunks([
    start(0), reasoningDelta(0, 'A'), reasoningEnd(0, 'A'),
    start(1), reasoningDelta(1, ' '), reasoningEnd(1, ' '),
    finish(),
  ])

  assert.deepEqual(reasoningBlocks(output), [{ type: 'reasoning', text: 'A ' }])
  assert.deepEqual(
    output.filter((chunk) => chunk.type === 'reasoning-delta').map((chunk) => chunk.text),
    ['A', ' '],
  )
})

test('an index that arrives without a start joins the group once the source ended', () => {
  const output = normalizeReasoningChunks([
    start(0), reasoningEnd(0, 'A'),
    reasoningDelta(9, 'B'), reasoningEnd(9, 'B'),
    finish(),
  ])

  assert.deepEqual(reasoningBlocks(output), [{ type: 'reasoning', text: 'A\n\nB' }])
})

test('flushes reasoning before text and leaves text chunks unchanged', () => {
  const text = [textStart(5), textDelta(5, 'answer'), textEnd(5, 'answer')]
  const input = [start(0), reasoningDelta(0, 'A'), reasoningEnd(0, 'A'), ...text, finish()]
  const output = normalizeReasoningChunks(input)

  assert.deepEqual(reasoningBlocks(output), [{ type: 'reasoning', text: 'A' }])
  assert.deepEqual(output.slice(-4), [...text, finish()])
  assert.deepEqual(assemble(output).blocks(), [
    { type: 'reasoning', text: 'A' },
    { type: 'text', text: 'answer' },
  ])
})

test('flushes reasoning before a tool call without changing tool payloads', () => {
  const tool = [
    toolStart(7),
    toolDelta(7, 'call-1', 'read_file', '{"path":"a"}'),
    toolEnd(7, 'call-1', 'read_file', '{"path":"a"}'),
  ]
  const output = normalizeReasoningChunks([
    start(0), reasoningDelta(0, 'inspect'), reasoningEnd(0, 'inspect'),
    ...tool,
    usage(), finish('tool-calls'),
  ])

  assert.deepEqual(reasoningBlocks(output), [{ type: 'reasoning', text: 'inspect' }])
  assert.deepEqual(output.filter((chunk) => chunk.type === 'tool-call-delta'), [tool[1]])
  assert.deepEqual(output.filter((chunk) => chunk.type === 'block-end' && chunk.block.type === 'tool-call'), [tool[2]])
  assert.deepEqual(assemble(output).blocks(), [
    { type: 'reasoning', text: 'inspect' },
    { type: 'tool-call', id: 'call-1', name: 'read_file', arguments: '{"path":"a"}' },
  ])
})

test('reasoning after text starts a separate merge group', () => {
  const input = [
    start(0), reasoningDelta(0, 'before'), reasoningEnd(0, 'before'),
    textStart(2), textDelta(2, 'middle'), textEnd(2, 'middle'),
    start(4), reasoningDelta(4, 'after'), reasoningEnd(4, 'after'), finish(),
  ]

  assert.deepEqual(assemble(normalizeReasoningChunks(input)).blocks(), [
    { type: 'reasoning', text: 'before' },
    { type: 'text', text: 'middle' },
    { type: 'reasoning', text: 'after' },
  ])
})

test('supports delta-only and block-end-only reasoning', () => {
  const deltaOnly = normalizeReasoningChunks([
    reasoningDelta(3, 'delta-only'), finish(),
  ])
  const endOnly = normalizeReasoningChunks([
    reasoningEnd(6, 'end-only'), finish(),
  ])

  assert.deepEqual(reasoningBlocks(deltaOnly), [{ type: 'reasoning', text: 'delta-only' }])
  assert.deepEqual(reasoningBlocks(endOnly), [{ type: 'reasoning', text: 'end-only' }])
  assert.equal(deltaOnly[0].type, 'block-start')
  assert.equal(endOnly[0].type, 'block-start')
})

test('preserves usage and all finish reasons', () => {
  for (const kind of ['stop', 'max-tokens', 'error', 'aborted']) {
    const input = [
      start(0), reasoningDelta(0, kind), reasoningEnd(0, kind),
      usage(11), finish(kind),
    ]
    const output = normalizeReasoningChunks(input)
    const usageIndex = output.findIndex((chunk) => chunk.type === 'usage')
    const finishIndex = output.findIndex((chunk) => chunk.type === 'finish')
    assert.equal(output[usageIndex].usage.inputTokens, 11)
    assert.equal(output[finishIndex].reason.kind, kind)
    assert.ok(usageIndex < finishIndex)
  }
})

test('applies the replay policy only after a real merge', () => {
  const unchangedReplay = { response: { id: 'one' }, blocks: ['one'] }
  const noMerge = normalizeReasoningChunks([
    start(0), reasoningDelta(0, 'one'), reasoningEnd(0, 'one'), finish('stop', unchangedReplay),
  ])
  assert.deepEqual(noMerge.at(-1).replayState, unchangedReplay)

  const responseOnly = normalizeReasoningChunks([
    start(0), reasoningDelta(0, 'A'), reasoningEnd(0, 'A'),
    start(1), reasoningDelta(1, 'B'), reasoningEnd(1, 'B'),
    finish('stop', { response: { id: 'two' } }),
  ])
  assert.deepEqual(responseOnly.at(-1).replayState, { response: { id: 'two' } })

  const mergedReplay = normalizeReasoningChunks([
    start(0), reasoningDelta(0, 'A'), reasoningEnd(0, 'A'),
    start(1), reasoningDelta(1, 'B'), reasoningEnd(1, 'B'),
    finish('stop', { response: { id: 'three' }, blocks: ['A', 'B'] }),
  ])
  assert.deepEqual(mergedReplay.at(-1).replayState, { response: { id: 'three' } })

  const assembler = assemble(mergedReplay)
  assert.deepEqual(assembler.replayState, { response: { id: 'three' } })
})

test('late deltas after a closed source do not become merged content', () => {
  const output = normalizeReasoningChunks([
    start(0), reasoningDelta(0, 'kept'), reasoningEnd(0, 'kept'),
    reasoningDelta(0, 'late'), finish(),
  ])

  assert.deepEqual(reasoningBlocks(output), [{ type: 'reasoning', text: 'kept' }])
  assert.equal(output.some((chunk) => chunk.type === 'reasoning-delta' && chunk.text === 'late'), false)
})

test('a repeated start, end, or delta for a closed index is dropped', () => {
  const output = normalizeReasoningChunks([
    start(0), reasoningDelta(0, 'A'), reasoningEnd(0, 'A'),
    start(0), reasoningDelta(0, 'late'), reasoningEnd(0, 'late'),
    start(5), reasoningDelta(5, 'C'), reasoningEnd(5, 'C'), reasoningEnd(5, 'C'),
    finish(),
  ])

  assert.deepEqual(reasoningBlocks(output), [{ type: 'reasoning', text: 'A\n\nC' }])
  assert.equal(output.filter((chunk) => chunk.type === 'reasoning-delta').length, 2)
})

test('propagates upstream stream failures', async () => {
  const source = (async function* () {
    yield start(0)
    throw new Error('upstream failed')
  })()

  await assert.rejects(collect(normalizeReasoningStream(source)), /upstream failed/)
})

test('closes the upstream iterator on early consumer cancellation', async () => {
  let returns = 0
  let nextCalls = 0
  const source = {
    [Symbol.asyncIterator]() {
      return {
        async next() {
          nextCalls++
          return { value: start(0), done: false }
        },
        async return() {
          returns++
          return { value: undefined, done: true }
        },
      }
    },
  }
  const iterator = normalizeReasoningStream(source)[Symbol.asyncIterator]()

  const first = await iterator.next()
  assert.deepEqual(first.value, start(0))
  await iterator.return()
  assert.equal(nextCalls, 1)
  assert.equal(returns, 1)
})

test('does not emit a synthetic end after early cancellation', async () => {
  const source = (async function* () {
    yield start(0)
    yield reasoningDelta(0, 'partial')
    yield finish()
  })()
  const iterator = normalizeReasoningStream(source)[Symbol.asyncIterator]()

  assert.deepEqual((await iterator.next()).value, start(0))
  await iterator.return()
  assert.deepEqual(await iterator.next(), { value: undefined, done: true })
})

test('streams a complete provider response through to its end', async () => {
  const input = [
    start(0), reasoningDelta(0, 'A'), reasoningEnd(0, 'A'),
    textStart(2), textDelta(2, 'answer'), textEnd(2, 'answer'),
    usage(), finish(),
  ]
  const streamed = await collect(normalizeReasoningStream((async function* () {
    for (const chunk of input) yield chunk
  })()))

  assert.deepEqual(streamed, normalizeReasoningChunks(input))
  assert.deepEqual(assemble(streamed).blocks(), [
    { type: 'reasoning', text: 'A' },
    { type: 'text', text: 'answer' },
  ])
})

test('an upstream return() failure never masks a stream failure', async () => {
  const source = {
    [Symbol.asyncIterator]() {
      return {
        async next() {
          throw new Error('stream failed')
        },
        async return() {
          throw new Error('return failed')
        },
      }
    },
  }

  await assert.rejects(collect(normalizeReasoningStream(source)), /stream failed/)
})

test('an upstream return() failure surfaces after early cancellation', async () => {
  const source = {
    [Symbol.asyncIterator]() {
      return {
        async next() {
          return { value: start(0), done: false }
        },
        async return() {
          throw new Error('return failed')
        },
      }
    },
  }
  const iterator = normalizeReasoningStream(source)[Symbol.asyncIterator]()

  assert.deepEqual((await iterator.next()).value, start(0))
  await assert.rejects(iterator.return(), /return failed/)
})
