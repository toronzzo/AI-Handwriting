class PcmCapture extends AudioWorkletProcessor {
  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (ch && ch.length) {
      // Copy — the worklet reuses the input buffer each quantum.
      this.port.postMessage(ch.slice());
    }
    return true;
  }
}
registerProcessor("pcm-capture", PcmCapture);
