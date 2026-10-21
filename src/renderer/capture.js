// Hidden microphone window. Owns the MediaStream + AudioContext (16 kHz) and an
// AudioWorklet that posts fixed-size Int16 PCM chunks, forwarded to the main
// process. The stream can stay warm between takes to avoid the ~300 ms device
// start-up cost on every key press.

const state = {
  context: null,
  stream: null,
  source: null,
  worklet: null,
  recording: false,
  keepWarm: true,
  sampleRate: 16000,
};

async function ensureGraph(opts) {
  state.sampleRate = opts.sampleRate || 16000;
  state.keepWarm = opts.keepMicWarm !== false;
  if (state.context && state.context.state === 'closed') state.context = null;
  if (!state.context) {
    state.context = new AudioContext({ sampleRate: state.sampleRate, latencyHint: 'interactive' });
    await state.context.audioWorklet.addModule('recorder-worklet.js');
  }
  if (state.context.state !== 'running') await state.context.resume();

  if (!state.stream || state.stream.getAudioTracks().every((t) => t.readyState !== 'live')) {
    const t0 = performance.now();
    state.stream = await navigator.mediaDevices.getUserMedia({
      audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      video: false,
    });
    window.flow.log('info', `mic acquired in ${Math.round(performance.now() - t0)} ms (${state.stream.getAudioTracks()[0]?.label || 'unknown device'})`);
    state.source?.disconnect();
    state.source = state.context.createMediaStreamSource(state.stream);
    state.worklet?.disconnect();
    state.worklet = new AudioWorkletNode(state.context, 'recorder-processor', {
      processorOptions: { chunkSamples: Math.round((opts.chunkMs || 100) / 1000 * state.sampleRate) },
    });
    state.worklet.port.onmessage = (ev) => {
      if (state.recording) window.flow.sendChunk(ev.data);
    };
    state.source.connect(state.worklet);
    // Keep the node alive without producing sound.
    const sink = state.context.createGain();
    sink.gain.value = 0;
    state.worklet.connect(sink).connect(state.context.destination);
  }
}

function releaseMic() {
  state.stream?.getTracks().forEach((t) => t.stop());
  state.stream = null;
}

window.flow.onCommand('capture:start', async (opts) => {
  await ensureGraph(opts);
  state.worklet.port.postMessage({ type: 'reset' });
  state.recording = true;
  return { sampleRate: state.context.sampleRate };
});

window.flow.onCommand('capture:stop', async () => {
  state.recording = false;
  state.worklet?.port.postMessage({ type: 'flush' });
  if (!state.keepWarm) releaseMic();
  return null;
});

window.flow.onCommand('capture:close', async () => {
  state.recording = false;
  releaseMic();
  await state.context?.close();
  state.context = null;
  return null;
});

window.flow.ready();
