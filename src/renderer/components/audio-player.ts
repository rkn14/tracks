import WaveSurfer from "wavesurfer.js";
import type {
  AudioMetadata,
  EssentiaAnalysis,
  ElectronApi,
  ProfileScores,
  WritableMetadata,
} from "@shared/types";
import { eventBus } from "../lib/event-bus";
import { STORE_KEYS } from "@shared/constants";
import { isProfileScorableFilePath } from "@shared/profile-stars";
import { getProfileTagLabel } from "@shared/profile-tag-labels";
import {
  collectTagIdUniverse,
  orderActiveTagIdsForStorage,
} from "@shared/profile-tag-ids";
import { loadProfileTagsAvailable } from "@shared/profile-tags-settings";
import {
  defaultProfileScores,
  isProfileTagAxis,
  isProfileTagKey,
  normalizeProfileScores,
  profileScoresForPersistence,
  PROFILE_TAG_AXES,
} from "@shared/profile-scores";
import { formatDurationMmSsFromMs } from "@shared/format-duration";
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
  private spectrumCanvas!: HTMLCanvasElement;
  private audioCtx: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private sourceNode: MediaElementAudioSourceNode | null = null;
  private vizRafId = 0;
  private vizMode: "spectrum" | "oscilloscope" = "spectrum";
  private scoresEl!: HTMLElement;
  private btnEssentiaAnalyze!: HTMLButtonElement;
  private essentiaBpmEl!: HTMLElement;
  private essentiaKeyEl!: HTMLElement;
  private bottomRowEl!: HTMLElement;
  private profileSaveTimer: ReturnType<typeof setTimeout> | null = null;
  /** Données Essentia persistées dans le TXXX (hors tags ID3 classiques). */
  private essentiaAnalysis: EssentiaAnalysis = {};
  /** Tags affichés (axes intégrés + personnalisés), ordre = affichage. */
  private availableProfileTagIds: string[] = [...PROFILE_TAG_AXES];
  private profileLayoutInit!: Promise<void>;
  /** Dernier état complet en mémoire (inclut les axes non affichés). */
  private bufferedProfileScores: ProfileScores = defaultProfileScores();
  private bufferedActiveTags: string[] = [];

  constructor(container: HTMLElement) {
    this.api = window.electronApi;
    this.el = container;
    this.render();
    this.profileLayoutInit = this.hydrateProfileTagsLayout();
    this.bindEvents();
    void this.restoreVolume();
  }

  private render(): void {
    this.el.innerHTML = `
      <div class="player">
        <div class="player__waveform-row"></div>
        <div class="player__transport">
          <button class="player__btn-play" title="Lecture / Pause"></button>
          <span class="player__time-current">0:00</span>
          <span class="player__time-sep">/</span>
          <span class="player__time-total">0:00</span>
          <span class="player__volume-icon">\uD83D\uDD0A</span>
          <input class="player__volume-slider" type="range" min="0" max="100" value="80" />
        </div>
        <div class="player__bottom-row">
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
          <div class="player__essentia">
            <div class="player__essentia-head">
              <span class="player__essentia-title">Essentia</span>
            </div>
            <button type="button" class="player__essentia-analyze dialog-btn dialog-btn--primary">Analyze</button>
            <div class="player__essentia-rows">
              <div class="player__essentia-row">
                <span class="player__label">BPM</span>
                <span class="player__essentia-value" data-essentia-bpm>\u2014</span>
              </div>
              <div class="player__essentia-row">
                <span class="player__label">Key</span>
                <span class="player__essentia-value" data-essentia-key>\u2014</span>
              </div>
            </div>
          </div>
          <div class="player__scores">
            <div class="player__scores-note">
              <div class="player__scores-section-label">Note</div>
              <div class="player__score-row player__score-row--general" data-score="general">
                <div class="player__score-stars" data-score-stars data-value="0" role="group" aria-label="Note g\u00e9n\u00e9rale, 0 \u00e0 5 \u00e9toiles">
                  <button type="button" class="player__score-zero" data-zero title="0 \u00e9toile">0</button>
                  <div class="player__score-starline" role="presentation">
                    <button type="button" class="player__star" data-star="1" aria-pressed="false" aria-label="1 \u00e9toile">\u2605</button>
                    <button type="button" class="player__star" data-star="2" aria-pressed="false" aria-label="2 \u00e9toiles">\u2605</button>
                    <button type="button" class="player__star" data-star="3" aria-pressed="false" aria-label="3 \u00e9toiles">\u2605</button>
                    <button type="button" class="player__star" data-star="4" aria-pressed="false" aria-label="4 \u00e9toiles">\u2605</button>
                    <button type="button" class="player__star" data-star="5" aria-pressed="false" aria-label="5 \u00e9toiles">\u2605</button>
                  </div>
                </div>
              </div>
            </div>
            <div class="player__scores-tags">
              <div class="player__scores-section-label">Tags</div>
              <div
                class="player__profile-tag-toggles"
                role="group"
                aria-label="Crit\u00e8res optionnels"
                data-profile-tag-toggles-mount
              ></div>
            </div>
          </div>
          <canvas class="player__spectrum" width="0" height="0"></canvas>
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
    this.spectrumCanvas = this.el.querySelector(".player__spectrum")!;
    this.spectrumCanvas.title = "Cliquer pour changer de mode";
    this.spectrumCanvas.style.cursor = "pointer";
    this.spectrumCanvas.addEventListener("click", () => this.toggleVizMode());

    this.scoresEl = this.el.querySelector(".player__scores")!;
    this.btnEssentiaAnalyze = this.el.querySelector(".player__essentia-analyze")!;
    this.essentiaBpmEl = this.el.querySelector("[data-essentia-bpm]")!;
    this.essentiaKeyEl = this.el.querySelector("[data-essentia-key]")!;
    this.bottomRowEl = this.el.querySelector(".player__bottom-row")!;
    this.initScoreStars();
    this.initProfileTagToggles();
    this.btnEssentiaAnalyze.addEventListener("click", () => void this.runEssentiaAnalyze());

    this.initEditableFields();
  }

  private mergeProfileUiIntoBuffer(): void {
    this.bufferedProfileScores = this.readProfileScoresFromUi();
    this.bufferedActiveTags = this.readActiveProfileTagsFromUi();
  }

  private buildTagTogglesInnerHtml(): string {
    return this.availableProfileTagIds
      .map((id) => {
        const label = this.escapeProfileTagLabelHtml(getProfileTagLabel(id));
        const mod = isProfileTagAxis(id)
          ? ` player__tag-toggle--${id}`
          : " player__tag-toggle--custom";
        const eid = this.escapeProfileTagAttr(id);
        return `<label class="player__tag-toggle${mod}"><input type="checkbox" class="player__tag-toggle-input" data-profile-tag-toggle="${eid}" /><span class="player__tag-toggle-pill">${label}</span></label>`;
      })
      .join("");
  }

  private escapeProfileTagAttr(s: string): string {
    return s
      .replace(/&/g, "&amp;")
      .replace(/"/g, "&quot;")
      .replace(/</g, "&lt;");
  }

  private escapeProfileTagLabelHtml(s: string): string {
    return s
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  }

  private async hydrateProfileTagsLayout(): Promise<void> {
    this.mergeProfileUiIntoBuffer();
    this.availableProfileTagIds = await loadProfileTagsAvailable((key) =>
      this.api.store.get(key),
    );
    const mountT = this.scoresEl.querySelector<HTMLElement>(
      "[data-profile-tag-toggles-mount]",
    );
    if (!mountT) return;
    mountT.innerHTML = this.buildTagTogglesInnerHtml();
    this.applyProfileScoresToUi(this.bufferedProfileScores, this.bufferedActiveTags);
  }

  private async onProfileTagsAvailableChanged(): Promise<void> {
    await this.hydrateProfileTagsLayout();
  }

  private syncProfileStarRow(container: HTMLElement, value0to100: number): void {
    const v = Math.min(100, Math.max(0, Math.round(value0to100 / 20) * 20));
    container.dataset.value = String(v);
    const n = v / 20;
    container
      .querySelector(".player__score-zero")
      ?.classList.toggle("is-active", n === 0);
    for (const btn of container.querySelectorAll<HTMLButtonElement>(".player__star")) {
      const k = parseInt(btn.dataset.star ?? "0", 10);
      const on = n >= k;
      btn.classList.toggle("player__star--on", on);
      btn.setAttribute("aria-pressed", on ? "true" : "false");
    }
  }

  private initScoreStars(): void {
    this.scoresEl.addEventListener("click", (e) => {
      const t = e.target;
      if (!(t instanceof HTMLElement)) return;
      const container = t.closest<HTMLElement>("[data-score-stars]");
      if (!container || !this.scoresEl.contains(container)) return;
      if (t.closest(".player__score-zero")) {
        this.syncProfileStarRow(container, 0);
        this.scheduleProfileSave();
        return;
      }
      const star = t.closest<HTMLButtonElement>(".player__star");
      if (!star) return;
      const n = parseInt(star.dataset.star ?? "0", 10);
      if (n < 1 || n > 5) return;
      this.syncProfileStarRow(container, n * 20);
      this.scheduleProfileSave();
    });
  }

  private initProfileTagToggles(): void {
    this.scoresEl.addEventListener("change", (e) => {
      const t = e.target;
      if (!(t instanceof HTMLInputElement)) return;
      const id = t.getAttribute("data-profile-tag-toggle");
      if (!id || !isProfileTagKey(id)) return;
      this.scheduleProfileSave();
    });
  }

  private readActiveProfileTagsFromUi(): string[] {
    const fromUi: string[] = [];
    for (const id of this.availableProfileTagIds) {
      const cb = this.scoresEl.querySelector<HTMLInputElement>(
        `input[data-profile-tag-toggle="${CSS.escape(id)}"]`,
      );
      if (cb?.checked) fromUi.push(id);
    }
    const universe = collectTagIdUniverse(
      this.availableProfileTagIds,
      Object.keys(this.bufferedProfileScores),
      this.bufferedActiveTags,
    );
    const hidden = new Set(
      [...universe].filter((x) => !this.availableProfileTagIds.includes(x)),
    );
    for (const id of this.bufferedActiveTags) {
      if (hidden.has(id) && !fromUi.includes(id)) {
        fromUi.push(id);
      }
    }
    return orderActiveTagIdsForStorage(fromUi);
  }

  private applyEssentiaToUi(): void {
    this.essentiaBpmEl.textContent =
      this.essentiaAnalysis.bpm !== undefined
        ? String(this.essentiaAnalysis.bpm)
        : "\u2014";
    this.essentiaKeyEl.textContent =
      this.essentiaAnalysis.key !== undefined
        ? this.essentiaAnalysis.key
        : "\u2014";
  }

  /** Données Essentia à réécrire dans le TXXX avec les scores (évite d’effacer l’analyse). */
  private essentiaSnapshotForWrite(): EssentiaAnalysis | undefined {
    const out: EssentiaAnalysis = {};
    if (this.essentiaAnalysis.bpm !== undefined) out.bpm = this.essentiaAnalysis.bpm;
    if (this.essentiaAnalysis.key !== undefined) out.key = this.essentiaAnalysis.key;
    return Object.keys(out).length > 0 ? out : undefined;
  }

  private async runEssentiaAnalyze(): Promise<void> {
    const path = this.currentFilePath;
    if (!path?.toLowerCase().endsWith(".mp3")) return;
    this.btnEssentiaAnalyze.disabled = true;
    const prevLabel = this.btnEssentiaAnalyze.textContent;
    this.btnEssentiaAnalyze.textContent = "...";
    this.essentiaBpmEl.textContent = "\u2026";
    this.essentiaKeyEl.textContent = "\u2026";
    try {
      const { bpm, key } = await this.api.audio.extractEssentia(path);
      this.essentiaAnalysis = { bpm, key };
      this.applyEssentiaToUi();
      await this.api.audio.writeProfileScores(
        path,
        this.readProfileScoresFromUi(),
        this.essentiaSnapshotForWrite(),
        this.readActiveProfileTagsFromUi(),
      );
      this.emitProfileScoresUpdated(path);
    } catch (err) {
      const msg =
        err instanceof Error
          ? err.message
          : typeof err === "string"
            ? err
            : "Erreur d\u2019analyse";
      this.essentiaBpmEl.textContent = "\u2014";
      this.essentiaKeyEl.textContent =
        msg.length > 56 ? `${msg.slice(0, 53)}\u2026` : msg;
      console.error("Analyse Essentia", err);
    } finally {
      this.btnEssentiaAnalyze.disabled = false;
      this.btnEssentiaAnalyze.textContent = prevLabel ?? "Analyze";
    }
  }

  /** MP3 (ID3 TXXX) ou FLAC (Vorbis) : notation profil + sauvegarde. */
  private isCurrentFileProfileable(): boolean {
    const p = this.currentFilePath?.toLowerCase() ?? "";
    return p.endsWith(".mp3") || p.endsWith(".flac");
  }

  private setProfileUiVisible(visible: boolean): void {
    this.bottomRowEl.classList.toggle("player__bottom-row--no-scores", !visible);
  }

  private applyProfileScoresToUi(
    scores: ProfileScores,
    activeProfileTags: string[],
  ): void {
    this.bufferedProfileScores = normalizeProfileScores(scores);
    this.bufferedActiveTags = orderActiveTagIdsForStorage(
      activeProfileTags.filter((id) => id !== "general" && isProfileTagKey(id)),
    );
    const generalRow = this.scoresEl.querySelector<HTMLElement>(
      "[data-score=\"general\"] [data-score-stars]",
    );
    if (generalRow) {
      this.syncProfileStarRow(
        generalRow,
        this.bufferedProfileScores.general ?? 0,
      );
    }
    for (const id of this.availableProfileTagIds) {
      const on = this.bufferedActiveTags.includes(id);
      const cb = this.scoresEl.querySelector<HTMLInputElement>(
        `input[data-profile-tag-toggle="${CSS.escape(id)}"]`,
      );
      if (cb) cb.checked = on;
    }
  }

  private readProfileScoresFromUi(): ProfileScores {
    const gRow = this.scoresEl.querySelector<HTMLElement>(
      "[data-score=\"general\"] [data-score-stars]",
    );
    const g =
      gRow != null
        ? parseInt(gRow.dataset.value ?? "0", 10)
        : (this.bufferedProfileScores.general ?? 0);
    return profileScoresForPersistence(this.bufferedProfileScores, g);
  }

  private scheduleProfileSave(): void {
    if (!this.isCurrentFileProfileable() || !this.currentFilePath) return;
    if (this.profileSaveTimer) clearTimeout(this.profileSaveTimer);
    this.profileSaveTimer = setTimeout(async () => {
      this.profileSaveTimer = null;
      const path = this.currentFilePath;
      if (!this.isCurrentFileProfileable() || !path) return;
      try {
        await this.api.audio.writeProfileScores(
          path,
          this.readProfileScoresFromUi(),
          this.essentiaSnapshotForWrite(),
          this.readActiveProfileTagsFromUi(),
        );
        this.emitProfileScoresUpdated(path);
      } catch (err) {
        console.error("Échec de l’écriture des notes profil", err);
      }
    }, 350);
  }

  private emitProfileScoresUpdated(filePath: string): void {
    if (isProfileScorableFilePath(filePath)) {
      eventBus.emit("profile-scores-updated", { filePath });
    }
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
    eventBus.on("profile-tags-available-changed", () => {
      void this.onProfileTagsAvailableChanged();
    });
  }

  private async restoreVolume(): Promise<void> {
    const saved = await this.api.store.get<number>(STORE_KEYS.PLAYER_VOLUME);
    if (saved !== undefined) {
      this.volumeSlider.value = String(Math.round(saved * 100));
    }
  }

  async load(filePath: string): Promise<void> {
    const previousPath = this.currentFilePath;
    const hadPendingProfileSave = this.profileSaveTimer !== null;
    if (this.profileSaveTimer) {
      clearTimeout(this.profileSaveTimer);
      this.profileSaveTimer = null;
    }
    if (hadPendingProfileSave && previousPath) {
      const pl = previousPath.toLowerCase();
      if (pl.endsWith(".mp3") || pl.endsWith(".flac")) {
        try {
          await this.api.audio.writeProfileScores(
            previousPath,
            this.readProfileScoresFromUi(),
            this.essentiaSnapshotForWrite(),
            this.readActiveProfileTagsFromUi(),
          );
          this.emitProfileScoresUpdated(previousPath);
        } catch (err) {
          console.error("Échec de l’écriture des notes profil (flush)", err);
        }
      }
    }

    this.currentFilePath = filePath;
    this.essentiaAnalysis = {};
    this.applyEssentiaToUi();

    // Clean up previous blob URL
    if (this.blobUrl) {
      URL.revokeObjectURL(this.blobUrl);
      this.blobUrl = null;
    }

    // Read file from main process → Blob URL
    const buffer = await this.api.audio.readFile(filePath);
    const blob = new Blob([buffer], { type: mimeFromPath(filePath) });
    this.blobUrl = URL.createObjectURL(blob);

    // Destroy previous instance
    this.stopSpectrum();
    if (this.sourceNode) { this.sourceNode.disconnect(); this.sourceNode = null; }
    if (this.analyser) { this.analyser.disconnect(); this.analyser = null; }
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
      this.initSpectrum();
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
    await this.profileLayoutInit;
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
        ? formatDurationMmSsFromMs(meta.duration)
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

      const profileable = /\.(mp3|flac)$/i.test(filePath);
      this.setProfileUiVisible(profileable);
      const tagFilter = (t: string): boolean =>
        t !== "general" && isProfileTagKey(t);
      this.applyProfileScoresToUi(
        profileable
          ? normalizeProfileScores(meta.profileScores)
          : defaultProfileScores(),
        profileable
          ? (meta.activeProfileTags?.filter(tagFilter) ?? [])
          : [],
      );
      if (profileable) {
        this.essentiaAnalysis = { ...meta.essentiaAnalysis };
      } else {
        this.essentiaAnalysis = {};
      }
      this.applyEssentiaToUi();
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
      this.setProfileUiVisible(/\.(mp3|flac)$/i.test(filePath));
      this.applyProfileScoresToUi(defaultProfileScores(), []);
      this.essentiaAnalysis = {};
      this.applyEssentiaToUi();
    }
  }

  private togglePlay(): void {
    if (!this.wavesurfer) return;
    this.wavesurfer.playPause();
  }

  private setPlaying(playing: boolean): void {
    this.btnPlay.classList.toggle("is-playing", playing);
  }

  /* ── Real-time visualisation ─────────────────────── */

  private initSpectrum(): void {
    if (!this.wavesurfer) return;

    const media = this.wavesurfer.getMediaElement();
    if (!media) return;

    if (!this.audioCtx) {
      this.audioCtx = new AudioContext();
    }

    if (this.sourceNode) {
      this.sourceNode.disconnect();
      this.sourceNode = null;
    }
    if (this.analyser) {
      this.analyser.disconnect();
      this.analyser = null;
    }

    this.analyser = this.audioCtx.createAnalyser();
    this.analyser.fftSize = 2048;
    this.analyser.smoothingTimeConstant = 0.8;

    this.sourceNode = this.audioCtx.createMediaElementSource(media);
    this.sourceNode.connect(this.analyser);
    this.analyser.connect(this.audioCtx.destination);

    this.startVizLoop();
  }

  private toggleVizMode(): void {
    this.vizMode = this.vizMode === "spectrum" ? "oscilloscope" : "spectrum";
  }

  private startVizLoop(): void {
    cancelAnimationFrame(this.vizRafId);

    const canvas = this.spectrumCanvas;
    const ctx = canvas.getContext("2d")!;
    const analyser = this.analyser!;

    const freqData = new Uint8Array(analyser.frequencyBinCount);
    const timeData = new Uint8Array(analyser.fftSize);

    const draw = () => {
      this.vizRafId = requestAnimationFrame(draw);

      const rect = canvas.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      const w = rect.width * dpr;
      const h = rect.height * dpr;

      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
      }

      ctx.clearRect(0, 0, w, h);

      if (this.vizMode === "spectrum") {
        this.drawSpectrum(ctx, analyser, freqData, w, h, dpr);
      } else {
        this.drawOscilloscope(ctx, analyser, timeData, w, h, dpr);
      }
    };

    draw();
  }

  private drawSpectrum(
    ctx: CanvasRenderingContext2D,
    analyser: AnalyserNode,
    dataArray: Uint8Array,
    w: number, h: number, dpr: number,
  ): void {
    analyser.getByteFrequencyData(dataArray as Uint8Array<ArrayBuffer>);

    const barCount = 128;
    const barWidth = w / barCount;
    const gap = 1 * dpr;

    for (let i = 0; i < barCount; i++) {
      const v = dataArray[i] / 255;
      const barH = v * h;
      const x = i * barWidth;

      const hue = 340 + (i / barCount) * 40;
      ctx.fillStyle = `hsla(${hue}, 75%, ${50 + v * 20}%, ${0.6 + v * 0.4})`;
      ctx.fillRect(x + gap / 2, h - barH, barWidth - gap, barH);
    }
  }

  private drawOscilloscope(
    ctx: CanvasRenderingContext2D,
    analyser: AnalyserNode,
    dataArray: Uint8Array,
    w: number, h: number, dpr: number,
  ): void {
    analyser.getByteTimeDomainData(dataArray as Uint8Array<ArrayBuffer>);

    const cx = w / 2;
    const cy = h / 2;
    const baseRadius = Math.min(cx, cy) * 0.55;
    const maxDeform = baseRadius * 0.6;
    const len = dataArray.length;
    const step = (Math.PI * 2) / len;

    ctx.lineWidth = 0.5 * dpr;
    ctx.strokeStyle = "rgba(255,255,255,0.06)";
    ctx.beginPath();
    ctx.arc(cx, cy, baseRadius, 0, Math.PI * 2);
    ctx.stroke();

    ctx.save();
    ctx.shadowColor = "#e94560";
    ctx.shadowBlur = 12 * dpr;
    ctx.lineWidth = 2 * dpr;
    ctx.strokeStyle = "#e94560";

    ctx.beginPath();
    for (let i = 0; i <= len; i++) {
      const idx = i % len;
      const sample = (dataArray[idx] - 128) / 128;
      const r = baseRadius + sample * maxDeform;
      const angle = idx * step - Math.PI / 2;
      const x = cx + Math.cos(angle) * r;
      const y = cy + Math.sin(angle) * r;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.closePath();
    ctx.stroke();

    const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, baseRadius + maxDeform);
    grad.addColorStop(0, "rgba(233, 69, 96, 0.03)");
    grad.addColorStop(0.7, "rgba(233, 69, 96, 0.06)");
    grad.addColorStop(1, "rgba(233, 69, 96, 0)");
    ctx.fillStyle = grad;
    ctx.fill();
    ctx.restore();
  }

  private stopSpectrum(): void {
    cancelAnimationFrame(this.vizRafId);
    this.vizRafId = 0;

    const ctx = this.spectrumCanvas.getContext("2d");
    if (ctx) ctx.clearRect(0, 0, this.spectrumCanvas.width, this.spectrumCanvas.height);
  }
}
