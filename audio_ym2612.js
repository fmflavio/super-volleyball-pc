// ============================================================================
// YM2612 FM + SN76489 PSG + DAC Voice Synthesizer for Super Volley Ball PC
// Baseado no catálogo de patches extraído da ROM (0x18000-0x197FF & 0x1CEF7-0x1D6F7)
// Compositores originais: Kenji Okuda & Naoki Itamura (Video System, 1991)
// ============================================================================

class YM2612Synth {
  constructor() {
    this.ctx = null;
    this.muted = false;
    this.bgmPlaying = null;
    this.bgmTimer = null;
    this.stepIndex = 0;
    this.masterGain = null;
  }

  init() {
    if (!this.ctx) {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (AudioCtx) {
        this.ctx = new AudioCtx();
        this.masterGain = this.ctx.createGain();
        this.masterGain.gain.value = 0.35;
        this.masterGain.connect(this.ctx.destination);
      }
    }
    if (this.ctx && this.ctx.state === "suspended") {
      this.ctx.resume();
    }
  }

  toggleMute() {
    this.muted = !this.muted;
    if (this.masterGain) {
      this.masterGain.gain.value = this.muted ? 0 : 0.35;
    }
    return this.muted;
  }

  // Síntese FM de 2 operadores no estilo Yamaha YM2612
  playFMNote(freq, duration, patch = "brass", vol = 0.25, delay = 0) {
    if (this.muted) return;
    this.init();
    if (!this.ctx) return;

    const t0 = this.ctx.currentTime + delay;
    const carrier = this.ctx.createOscillator();
    const mod = this.ctx.createOscillator();
    const modGain = this.ctx.createGain();
    const env = this.ctx.createGain();

    // Configuração baseada nos instrumentos extraídos da ROM (PowerBrass, AnaBassED, Itamarimba, Leed2)
    if (patch === "brass") {
      carrier.type = "sawtooth";
      mod.type = "sine";
      mod.frequency.setValueAtTime(freq * 2, t0);
      modGain.gain.setValueAtTime(freq * 1.8, t0);
      modGain.gain.exponentialRampToValueAtTime(freq * 0.4, t0 + duration);
    } else if (patch === "bass") {
      carrier.type = "triangle";
      mod.type = "square";
      mod.frequency.setValueAtTime(freq * 1, t0);
      modGain.gain.setValueAtTime(freq * 3.0, t0);
      modGain.gain.exponentialRampToValueAtTime(freq * 0.2, t0 + duration * 0.8);
    } else if (patch === "marimba") {
      carrier.type = "sine";
      mod.type = "sine";
      mod.frequency.setValueAtTime(freq * 4, t0);
      modGain.gain.setValueAtTime(freq * 2.5, t0);
      modGain.gain.exponentialRampToValueAtTime(1, t0 + duration * 0.5);
    } else {
      // Leed2 / Synth
      carrier.type = "square";
      mod.type = "sawtooth";
      mod.frequency.setValueAtTime(freq * 1.5, t0);
      modGain.gain.setValueAtTime(freq * 0.8, t0);
    }

    carrier.frequency.setValueAtTime(freq, t0);
    mod.connect(modGain);
    modGain.connect(carrier.frequency);
    carrier.connect(env);
    env.connect(this.masterGain);

    env.gain.setValueAtTime(0.001, t0);
    env.gain.linearRampToValueAtTime(vol, t0 + 0.012);
    env.gain.exponentialRampToValueAtTime(0.001, t0 + duration);

    carrier.start(t0);
    mod.start(t0);
    carrier.stop(t0 + duration + 0.02);
    mod.stop(t0 + duration + 0.02);
  }

  // Percussão PSG / DAC (NSNARE3, BD F1, HiHat C6)
  playDrum(type = "kick", delay = 0) {
    if (this.muted) return;
    this.init();
    if (!this.ctx) return;
    const t0 = this.ctx.currentTime + delay;

    if (type === "kick") {
      const osc = this.ctx.createOscillator();
      const g = this.ctx.createGain();
      osc.type = "sine";
      osc.frequency.setValueAtTime(150, t0);
      osc.frequency.exponentialRampToValueAtTime(38, t0 + 0.12);
      g.gain.setValueAtTime(0.45, t0);
      g.gain.exponentialRampToValueAtTime(0.001, t0 + 0.14);
      osc.connect(g);
      g.connect(this.masterGain);
      osc.start(t0);
      osc.stop(t0 + 0.15);
    } else if (type === "snare" || type === "hihat") {
      const bufSize = this.ctx.sampleRate * (type === "snare" ? 0.14 : 0.05);
      const buf = this.ctx.createBuffer(1, bufSize, this.ctx.sampleRate);
      const data = buf.getChannelData(0);
      for (let i = 0; i < bufSize; i++) {
        data[i] = (Math.random() * 2 - 1) * Math.exp(-i / (bufSize * 0.35));
      }
      const noise = this.ctx.createBufferSource();
      noise.buffer = buf;

      const filter = this.ctx.createBiquadFilter();
      filter.type = type === "snare" ? "bandpass" : "highpass";
      filter.frequency.setValueAtTime(type === "snare" ? 1800 : 6500, t0);

      const g = this.ctx.createGain();
      g.gain.setValueAtTime(type === "snare" ? 0.3 : 0.12, t0);
      g.gain.exponentialRampToValueAtTime(0.001, t0 + (type === "snare" ? 0.14 : 0.05));

      noise.connect(filter);
      filter.connect(g);
      g.connect(this.masterGain);
      noise.start(t0);
    }
  }

  // Efeitos Sonoros (SFX) mapeados diretamente dos nomes da ROM (0x18000 - 0x197FF)
  playSFX(sfxName) {
    if (this.muted) return;
    this.init();
    if (!this.ctx) return;
    const t0 = this.ctx.currentTime;

    switch (sfxName) {
      case "FuePeeK": // Apito do Juiz (0x18036)
      case "whistle": {
        const osc = this.ctx.createOscillator();
        const lfo = this.ctx.createOscillator();
        const lfoGain = this.ctx.createGain();
        const g = this.ctx.createGain();
        osc.type = "triangle";
        osc.frequency.setValueAtTime(2850, t0);
        lfo.frequency.setValueAtTime(42, t0);
        lfoGain.gain.setValueAtTime(180, t0);
        lfo.connect(lfoGain);
        lfoGain.connect(osc.frequency);
        g.gain.setValueAtTime(0.32, t0);
        g.gain.setValueAtTime(0.32, t0 + 0.32);
        g.gain.exponentialRampToValueAtTime(0.001, t0 + 0.45);
        osc.connect(g);
        g.connect(this.masterGain);
        osc.start(t0);
        lfo.start(t0);
        osc.stop(t0 + 0.46);
        lfo.stop(t0 + 0.46);
        break;
      }

      case "ServeNew1": // Levantamento do Saque (0x18936)
      case "Toss1": // Levantamento (0x18A36)
      case "toss": {
        const osc = this.ctx.createOscillator();
        const g = this.ctx.createGain();
        osc.type = "sine";
        osc.frequency.setValueAtTime(240, t0);
        osc.frequency.exponentialRampToValueAtTime(520, t0 + 0.11);
        g.gain.setValueAtTime(0.25, t0);
        g.gain.exponentialRampToValueAtTime(0.001, t0 + 0.13);
        osc.connect(g);
        g.connect(this.masterGain);
        osc.start(t0);
        osc.stop(t0 + 0.14);
        break;
      }

      case "NewRecv1": // Recepção / Manchete (0x18EF6)
      case "ServeOK": // Batida no saque (0x18976)
      case "receive": {
        this.playDrum("kick", 0);
        const osc = this.ctx.createOscillator();
        const g = this.ctx.createGain();
        osc.type = "triangle";
        osc.frequency.setValueAtTime(190, t0);
        osc.frequency.exponentialRampToValueAtTime(75, t0 + 0.09);
        g.gain.setValueAtTime(0.35, t0);
        g.gain.exponentialRampToValueAtTime(0.001, t0 + 0.1);
        osc.connect(g);
        g.connect(this.masterGain);
        osc.start(t0);
        osc.stop(t0 + 0.11);
        break;
      }

      case "SpikeOku1": // Cortada Forte (0x18836)
      case "SpikeOK4": // Cortada Explosiva (0x188F6)
      case "spike": {
        this.playDrum("snare", 0);
        this.playDrum("kick", 0);
        const osc = this.ctx.createOscillator();
        const g = this.ctx.createGain();
        osc.type = "sawtooth";
        osc.frequency.setValueAtTime(340, t0);
        osc.frequency.exponentialRampToValueAtTime(55, t0 + 0.16);
        g.gain.setValueAtTime(0.45, t0);
        g.gain.exponentialRampToValueAtTime(0.001, t0 + 0.18);
        osc.connect(g);
        g.connect(this.masterGain);
        osc.start(t0);
        osc.stop(t0 + 0.19);
        break;
      }

      case "Makyuu3": // Super Saque "Jornada nas Estrelas" / Super Cortada (0x18BB6)
      case "super": {
        for (let i = 0; i < 6; i++) {
          this.playFMNote(440 + i * 160, 0.09, "brass", 0.3, i * 0.045);
        }
        this.playDrum("snare", 0.05);
        break;
      }

      case "NewBlock2": // Bloqueio na Rede (0x18DB6)
      case "NewOneT": // One-Touch no Bloqueio (0x18FB6)
      case "block": {
        const osc = this.ctx.createOscillator();
        const g = this.ctx.createGain();
        osc.type = "square";
        osc.frequency.setValueAtTime(280, t0);
        osc.frequency.exponentialRampToValueAtTime(95, t0 + 0.11);
        g.gain.setValueAtTime(0.32, t0);
        g.gain.exponentialRampToValueAtTime(0.001, t0 + 0.12);
        osc.connect(g);
        g.connect(this.masterGain);
        osc.start(t0);
        osc.stop(t0 + 0.13);
        break;
      }

      case "Ball1": // Quique da bola na quadra (0x18C36)
      case "bounce": {
        this.playDrum("kick", 0);
        this.playDrum("snare", 0.02);
        break;
      }

      case "crowd": // Torcida comemorando ponto
      case "StormF3": {
        const dur = 0.65;
        const bufSize = Math.floor(this.ctx.sampleRate * dur);
        const buf = this.ctx.createBuffer(1, bufSize, this.ctx.sampleRate);
        const d = buf.getChannelData(0);
        for (let i = 0; i < bufSize; i++) {
          const env = Math.sin((i / bufSize) * Math.PI);
          d[i] = (Math.random() * 2 - 1) * env * 0.5;
        }
        const src = this.ctx.createBufferSource();
        src.buffer = buf;
        const filt = this.ctx.createBiquadFilter();
        filt.type = "bandpass";
        filt.frequency.setValueAtTime(1100, t0);
        filt.Q.setValueAtTime(1.2, t0);
        const g = this.ctx.createGain();
        g.gain.setValueAtTime(0.28, t0);
        src.connect(filt);
        filt.connect(g);
        g.connect(this.masterGain);
        src.start(t0);
        break;
      }

      case "menu_move": {
        this.playFMNote(660, 0.05, "marimba", 0.2);
        break;
      }

      case "menu_select": {
        this.playFMNote(523.25, 0.07, "brass", 0.25, 0);
        this.playFMNote(783.99, 0.14, "brass", 0.28, 0.06);
        break;
      }
    }
  }

  // Voz sintetizada estilo arcade / DAC 8-bit para chamadas do árbitro ("IN!", "OUT!", "SERVICE!", "ACE!")
  speakCall(text) {
    if (this.muted) return;
    if ("speechSynthesis" in window) {
      try {
        window.speechSynthesis.cancel();
        const u = new SpeechSynthesisUtterance(text);
        u.lang = "en-US";
        u.rate = 1.15;
        u.pitch = 0.85;
        u.volume = 0.55;
        window.speechSynthesis.speak(u);
      } catch (e) {}
    }
  }

  // Sequenciador FM BGM (Temas inspirados na trilha YM2612 de Super Volley Ball)
  startBGM(trackName = "match") {
    this.stopBGM();
    this.bgmPlaying = trackName;
    this.stepIndex = 0;

    const N = {
      C3: 130.81, D3: 146.83, E3: 164.81, F3: 174.61, G3: 196.00, A3: 220.00, B3: 246.94,
      C4: 261.63, D4: 293.66, E4: 329.63, F4: 349.23, G4: 392.00, A4: 440.00, B4: 493.88,
      C5: 523.25, D5: 587.33, E5: 659.25, F5: 698.46, G5: 783.99, A5: 880.00
    };

    const tracks = {
      title: {
        tempoMs: 155,
        melody: [
          N.E4, N.G4, N.A4, N.B4, N.A4, N.G4, N.E4, 0,
          N.D4, N.F4, N.G4, N.A4, N.G4, N.F4, N.D4, 0,
          N.E4, N.G4, N.B4, N.D5, N.C5, N.B4, N.A4, N.G4,
          N.A4, N.B4, N.C5, N.D5, N.E5, 0, N.E5, 0
        ],
        bass: [
          N.E3, N.E3, N.E3, N.E3, N.A3, N.A3, N.E3, N.E3,
          N.D3, N.D3, N.D3, N.D3, N.G3, N.G3, N.D3, N.D3,
          N.E3, N.E3, N.G3, N.G3, N.A3, N.A3, N.F3, N.F3,
          N.F3, N.F3, N.G3, N.G3, N.A3, N.E3, N.A3, 0
        ]
      },
      match: {
        tempoMs: 140,
        melody: [
          N.A4, 0, N.C5, N.D5, N.E5, 0, N.D5, N.C5,
          N.D5, 0, N.B4, N.G4, N.A4, 0, N.E4, 0,
          N.F4, N.G4, N.A4, N.C5, N.B4, N.A4, N.G4, N.B4,
          N.A4, 0, N.G4, N.A4, N.B4, N.C5, N.D5, N.E5
        ],
        bass: [
          N.A3, N.A3, N.E3, N.A3, N.A3, N.A3, N.E3, N.A3,
          N.G3, N.G3, N.D3, N.G3, N.A3, N.A3, N.E3, N.A3,
          N.F3, N.F3, N.C3, N.F3, N.G3, N.G3, N.D3, N.G3,
          N.A3, N.E3, N.F3, N.G3, N.A3, N.A3, N.E3, N.G3
        ]
      },
      staff: {
        tempoMs: 175,
        melody: [
          N.C5, N.B4, N.A4, N.G4, N.F4, N.G4, N.A4, 0,
          N.D5, N.C5, N.B4, N.A4, N.G4, N.A4, N.B4, 0,
          N.E5, N.D5, N.C5, N.B4, N.A4, N.C5, N.D5, N.F5,
          N.E5, 0, N.D5, N.C5, N.C5, 0, 0, 0
        ],
        bass: [
          N.C3, N.G3, N.A3, N.E3, N.F3, N.C3, N.F3, N.G3,
          N.D3, N.A3, N.G3, N.D3, N.E3, N.B3, N.E3, N.G3,
          N.A3, N.E3, N.F3, N.C3, N.D3, N.A3, N.G3, N.D3,
          N.C3, N.G3, N.F3, N.G3, N.C3, N.G3, N.C3, 0
        ]
      }
    };

    const trk = tracks[trackName] || tracks.match;
    this.bgmTimer = setInterval(() => {
      if (this.muted) return;
      const i = this.stepIndex % trk.melody.length;
      const m = trk.melody[i];
      const b = trk.bass[i];
      if (m > 0) this.playFMNote(m, trk.tempoMs / 1000 * 0.9, "brass", 0.14);
      if (b > 0) this.playFMNote(b, trk.tempoMs / 1000 * 0.85, "bass", 0.16);
      if (i % 4 === 0) this.playDrum("kick");
      if (i % 4 === 2) this.playDrum("snare");
      if (i % 2 === 1) this.playDrum("hihat");
      this.stepIndex++;
    }, trk.tempoMs);
  }

  stopBGM() {
    if (this.bgmTimer) {
      clearInterval(this.bgmTimer);
      this.bgmTimer = null;
    }
    this.bgmPlaying = null;
  }
}

window.ymSynth = new YM2612Synth();
