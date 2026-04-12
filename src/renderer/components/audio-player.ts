import WaveSurfer from "wavesurfer.js";
import type { AudioMetadata, ElectronApi, WritableMetadata } from "@shared/types";
import { eventBus } from "../lib/event-bus";
import { STORE_KEYS } from "@shared/constants";

const MIME_BY_EXT: Record<string, string> = {
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
  ".aiff": "audio/aiff",
  ".aif": "audio/aiff",
  ".flac": "audio/flac",
  ".ogg": "audio/ogg",
};

function mimeFromPath(filePath: string): string {
  const ext = filePath.slice(filePath.lastIndexOf(".")).toLowerCase();
  return MIME_BY_EXT[ext] ?? "audio/mpeg";
}

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export class AudioPlayer {
  private api: ElectronApi;
  private el: HTMLElement;
  private wavesurfer: WaveSurfer | null = null;
  private blobUrl: string | null = null;

  private currentFilePath: string | null = null;

  private coverImg!: HTMLImageElement;
  private titleEl!: HTMLElement;
  private artistEl!: HTMLElement;
  private albumEl!: HTMLElement;
  private genreEl!: HTMLElement;
  private yearEl!: HTMLElement;
  private labelEl!: HTMLElement;
  private durationEl!: HTMLElement;
  private bpmEl!: HTMLElement;
  private qualityEl!: HTMLElement;
  private timeCurrentEl!: HTMLElement;
  private timeTotalEl!: HTMLElement;
  private btnPlay!: HTMLButtonElement;
  private volumeSlider!: HTMLInputElement;
  private waveformEl!: HTMLElement;

  constructor(container: HTMLElement) {
    this.api = window.electronApi;
    this.el = container;
    this.render();
    this.bindEvents();
    this.restoreVolume();
  }

  private render(): void {
    this.el.innerHTML = `
      <div class="player">
        <div class="player__waveform-row"></div>
        <div class="player__bottom">
          <div class="player__meta">
            <img class="player__cover" src="" alt="" />
            <div class="player__info">
              <div class="player__info-row">
                <span class="player__label">Titre</span>
                <span class="player__value player__value--title" data-field="title">Aucun fichier</span>
              </div>
              <div class="player__info-row">
                <span class="player__label">Artiste</span>
                <span class="player__value player__value--artist" data-field="artist"></span>
              </div>
              <div class="player__info-row">
                <span class="player__label">Album</span>
                <span class="player__value player__value--album" data-field="album"></span>
              </div>
              <div class="player__info-row">
                <span class="player__label">Genre</span>
                <span class="player__value player__value--genre" data-field="genre"></span>
              </div>
              <div class="player__info-row">
                <span class="player__label">Ann\u00e9e</span>
                <span class="player__value player__value--year" data-field="year"></span>
              </div>
              <div class="player__info-row">
                <span class="player__label">Label</span>
                <span class="player__value player__value--label" data-field="label"></span>
              </div>
              <div class="player__info-row">
                <span class="player__label">Dur\u00e9e</span>
                <span class="player__value player__value--duration" data-field="duration"></span>
              </div>
              <div class="player__info-row">
                <span class="player__label">BPM</span>
                <span class="player__value player__value--bpm" data-field="bpm"></span>
              </div>
              <div class="player__info-row">
                <span class="player__label">Qualit\u00e9</span>
                <span class="player__value player__value--quality" data-field="quality"></span>
              </div>
            </div>
          </div>
          <div class="player__controls">
            <button class="player__btn-play" title="Lecture / Pause"></button>
            <span class="player__time-current">0:00</span>
            <span class="player__time-sep">/</span>
            <span class="player__time-total">0:00</span>
          </div>
          <div class="player__volume">
            <span class="player__volume-icon">🔊</span>
            <input class="player__volume-slider" type="range" min="0" max="100" value="80" />
          </div>
        </div>
      </div>
    `;

    this.coverImg = this.el.querySelector(".player__cover")!;
    this.titleEl = this.el.querySelector('[data-field="title"]')!;
    this.artistEl = this.el.querySelector('[data-field="artist"]')!;
    this.albumEl = this.el.querySelector('[data-field="album"]')!;
    this.genreEl = this.el.querySelector('[data-field="genre"]')!;
    this.yearEl = this.el.querySelector('[data-field="year"]')!;
    this.labelEl = this.el.querySelector('[data-field="label"]')!;
    this.durationEl = this.el.querySelector('[data-field="duration"]')!;
    this.bpmEl = this.el.querySelector('[data-field="bpm"]')!;
    this.qualityEl = this.el.querySelector('[data-field="quality"]')!;
    this.timeCurrentEl = this.el.querySelector(".player__time-current")!;
    this.timeTotalEl = this.el.querySelector(".player__time-total")!;
    this.btnPlay = this.el.querySelector(".player__btn-play")!;
    this.volumeSlider = this.el.querySelector(".player__volume-slider")!;
    this.waveformEl = this.el.querySelector(".player__waveform-row")!;

    this.initEditableFields();
  }

  private static readonly EDITABLE_FIELDS = new Set([
    "title", "artist", "album", "genre", "year", "label", "bpm",
  ]);

  private initEditableFields(): void {
    const fields = this.el.querySelectorAll<HTMLElement>(".player__value[data-field]");
    for (const field of fields) {
      const key = field.dataset.field!;
      if (!AudioPlayer.EDITABLE_FIELDS.has(key)) continue;

      field.classList.add("player__value--editable");
      field.addEventListener("dblclick", () => this.startEditing(field, key));
    }
  }

  private startEditing(span: HTMLElement, key: string): void {
    if (!this.currentFilePath || span.querySelector("input")) return;

    const currentValue = span.textContent ?? "";
    const input = document.createElement("input");
    input.type = "text";
    input.className = "player__inline-input";
    input.value = currentValue;

    span.textContent = "";
    span.appendChild(input);
    input.focus();
    input.select();

    const commit = async () => {
      const newValue = input.value.trim();
      span.textContent = newValue;
      if (newValue !== currentValue) {
        await this.saveField(key, newValue);
      }
    };

    input.addEventListener("blur", () => commit());
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") { e.preventDefault(); input.blur(); }
      if (e.key === "Escape") { span.textContent = currentValue; }
    });
  }

  private async saveField(key: string, value: string): Promise<void> {
    if (!this.currentFilePath) return;
    const meta: WritableMetadata = {};

    if (key === "year" || key === "bpm") {
      const num = parseInt(value);
      (meta as Record<string, unknown>)[key] = isNaN(num) ? 0 : num;
    } else {
      (meta as Record<string, unknown>)[key] = value;
    }

    try {
      await this.api.audio.writeMetadata(this.currentFilePath, meta);
    } catch {
      /* silent fail — value is already shown in the UI */
    }
  }

  private bindEvents(): void {
    this.btnPlay.addEventListener("click", () => this.togglePlay());

    this.volumeSlider.addEventListener("input", () => {
      const vol = parseInt(this.volumeSlider.value) / 100;
      this.wavesurfer?.setVolume(vol);
      this.api.store.set(STORE_KEYS.PLAYER_VOLUME, vol);
    });

    eventBus.on("play-file", ({ filePath }) => this.load(filePath));
  }

  private async restoreVolume(): Promise<void> {
    const saved = await this.api.store.get<number>(STORE_KEYS.PLAYER_VOLUME);
    if (saved !== undefined) {
      this.volumeSlider.value = String(Math.round(saved * 100));
    }
  }

  async load(filePath: string): Promise<void> {
    this.currentFilePath = filePath;

    // Clean up previous blob URL
    if (this.blobUrl) {
      URL.revokeObjectURL(this.blobUrl);
      this.blobUrl = null;
    }

    // Read file from main process → Blob URL
    const buffer = await this.api.audio.readFile(filePath);
    const blob = new Blob([buffer], { type: mimeFromPath(filePath) });
    this.blobUrl = URL.createObjectURL(blob);

    // Destroy previous WaveSurfer instance
    if (this.wavesurfer) {
      this.wavesurfer.destroy();
      this.wavesurfer = null;
    }

    this.wavesurfer = WaveSurfer.create({
      container: this.waveformEl,
      waveColor: "#4a5568",
      progressColor: "#e94560",
      cursorColor: "#e94560",
      barWidth: 2,
      barGap: 1,
      barRadius: 2,
      height: "auto",
      normalize: true,
      url: this.blobUrl,
    });

    const vol = parseInt(this.volumeSlider.value) / 100;
    this.wavesurfer.setVolume(vol);

    this.wavesurfer.on("ready", () => {
      this.timeTotalEl.textContent = formatTime(
        this.wavesurfer!.getDuration(),
      );
      this.wavesurfer!.play();
      this.setPlaying(true);
    });

    this.wavesurfer.on("timeupdate", (time) => {
      this.timeCurrentEl.textContent = formatTime(time);
    });

    this.wavesurfer.on("finish", () => this.setPlaying(false));
    this.wavesurfer.on("play", () => this.setPlaying(true));
    this.wavesurfer.on("pause", () => this.setPlaying(false));

    this.loadMetadata(filePath);
  }

  private async loadMetadata(filePath: string): Promise<void> {
    const fileName = filePath.split(/[/\\]/).pop() ?? "";
    try {
      const meta: AudioMetadata =
        await this.api.audio.getMetadata(filePath);

      this.titleEl.textContent = meta.title || fileName;
      this.artistEl.textContent = meta.artist || "";
      this.albumEl.textContent = meta.album || "";
      this.genreEl.textContent = meta.genre || "";
      this.yearEl.textContent = meta.year ? String(meta.year) : "";
      this.labelEl.textContent = meta.label || "";
      this.durationEl.textContent = meta.duration
        ? formatTime(meta.duration)
        : "";
      this.bpmEl.textContent = meta.bpm ? String(Math.round(meta.bpm)) : "";

      const qualityParts: string[] = [];
      if (meta.format) qualityParts.push(meta.format);
      if (meta.bitrate) qualityParts.push(`${meta.bitrate} kbps`);
      if (meta.sampleRate)
        qualityParts.push(`${(meta.sampleRate / 1000).toFixed(1)} kHz`);
      if (meta.bitsPerSample) qualityParts.push(`${meta.bitsPerSample} bit`);
      this.qualityEl.textContent = qualityParts.join(" · ");

      if (meta.cover) {
        this.coverImg.src = meta.cover;
        this.coverImg.style.display = "block";
      } else {
        this.coverImg.src = "";
        this.coverImg.style.display = "none";
      }
    } catch {
      this.titleEl.textContent = fileName;
      this.artistEl.textContent = "";
      this.albumEl.textContent = "";
      this.genreEl.textContent = "";
      this.yearEl.textContent = "";
      this.labelEl.textContent = "";
      this.durationEl.textContent = "";
      this.bpmEl.textContent = "";
      this.qualityEl.textContent = "";
      this.coverImg.style.display = "none";
    }
  }

  private togglePlay(): void {
    if (!this.wavesurfer) return;
    this.wavesurfer.playPause();
  }

  private setPlaying(playing: boolean): void {
    this.btnPlay.classList.toggle("is-playing", playing);
  }
}
