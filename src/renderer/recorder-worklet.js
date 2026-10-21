// AudioWorklet: accumulate Float32 frames into fixed-size Int16 PCM chunks.
class RecorderProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    this.chunkSamples = options.processorOptions?.chunkSamples || 1600;
    this.buffer = new Int16Array(this.chunkSamples);
    this.index = 0;
    this.port.onmessage = (ev) => {
      if (ev.data?.type === 'reset') this.index = 0;
      if (ev.data?.type === 'flush') this.flush();
    };
  }

  flush() {
    if (this.index === 0) return;
    const out = this.buffer.slice(0, this.index);
    this.port.postMessage(out.buffer, [out.buffer]);
    this.index = 0;
  }

  process(inputs) {
    const channel = inputs[0]?.[0];
    if (!channel) return true;
    for (let i = 0; i < channel.length; i++) {
      const s = Math.max(-1, Math.min(1, channel[i]));
      this.buffer[this.index++] = s < 0 ? s * 0x8000 : s * 0x7fff;
      if (this.index >= this.chunkSamples) {
        const out = this.buffer.slice(0);
        this.port.postMessage(out.buffer, [out.buffer]);
        this.index = 0;
      }
    }
    return true;
  }
}

registerProcessor('recorder-processor', RecorderProcessor);
