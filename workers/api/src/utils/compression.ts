function asUint8Array(value: ArrayBuffer | Uint8Array): Uint8Array {
  if (value instanceof Uint8Array) {
    return value
  }
  return new Uint8Array(value)
}

function bytesToStream(bytes: Uint8Array): ReadableStream<BufferSource> {
  return new ReadableStream<BufferSource>({
    start(controller) {
      const payload = new Uint8Array(bytes.byteLength)
      payload.set(bytes)
      controller.enqueue(payload)
      controller.close()
    },
  })
}

async function streamToBytes(stream: ReadableStream<BufferSource>): Promise<Uint8Array> {
  const buffer = await new Response(stream).arrayBuffer()
  return new Uint8Array(buffer)
}

export async function gzipCompressText(text: string): Promise<Uint8Array> {
  const input = new TextEncoder().encode(text)
  const compressed = bytesToStream(input).pipeThrough(new CompressionStream('gzip'))
  return streamToBytes(compressed)
}

export async function gzipDecompressToText(value: ArrayBuffer | Uint8Array): Promise<string> {
  const input = asUint8Array(value)
  const decompressed = bytesToStream(input).pipeThrough(new DecompressionStream('gzip'))
  const output = await streamToBytes(decompressed)
  return new TextDecoder().decode(output)
}
