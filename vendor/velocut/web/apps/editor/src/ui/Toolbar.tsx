import {canvasTitle, closeEditor, sendOutput} from '../oneYes';
import {TsEngineAdapter} from '@velocut/runtime/engine';
import {evalKeyframes} from '@velocut/core-ts';
import { Icon } from './primitives/Icon';
import { Dialog } from './primitives/Dialog';
import type { CodexConnection } from '../services/codex-connection';
import { useRef, useState, type RefObject } from 'react';
import type { Store, UiState } from '../state/store';
import {
  type MediaLibrary,
  type Playback,
  Exporter,
  type AudioClipPlan,
  type VideoCodecFamily,
} from '@velocut/render-sdk';
import { importMediaFiles } from '../services/import';
import { PreviewRateSelect } from './PreviewRateSelect';
import { useSyncExternalStore } from 'react';
import { splitAtPlayhead } from '../App';

function fmtTime(us: number): string {
  const s = Math.max(0, us) / 1e6;
  const m = Math.floor(s / 60);
  const sec = (s % 60).toFixed(2).padStart(5, '0');
  return `${String(m).padStart(2, '0')}:${sec}`;
}

/** Export quality presets → bits-per-pixel-per-frame. The encoder has no app cap;
 *  these just set a sensible target the user (or 'custom' Mbps) can override. */
type ExportQuality = 'standard' | 'high' | 'ultra' | 'custom';
const QUALITY_BPP: Record<Exclude<ExportQuality, 'custom'>, number> = {
  standard: 0.08,
  high: 0.12,
  ultra: 0.2,
};
const CODEC_LABEL: Record<VideoCodecFamily, string> = {
  avc: 'H.264',
  hevc: 'H.265',
  av1: 'AV1',
};

export function Toolbar({
  store,
  playback,
  media,
  state,
  importInputRef,
  directorActive = false,
  onEdit,
  onDirector,
}: {
  store: Store;
  playback: Playback;
  media: MediaLibrary;
  state: UiState;
  codex?: CodexConnection;
  importInputRef: RefObject<HTMLInputElement>;
  directorActive?: boolean;
  onEdit: () => void;
  onDirector: () => void;
}) {
  const [destination,setDestination]=useState('canvas');
  const [outputSize,setOutputSize]=useState(false);
  const [size,setSize]=useState({width:state.doc.width,height:state.doc.height});
  const [exportOpen, setExportOpen] = useState(false);
  const previewRate = useSyncExternalStore(playback.subscribeRate, () => playback.rate);
  const [exportError, setExportError] = useState<string | null>(null);
  const fileRef = importInputRef;
  const [exportPct, setExportPct] = useState<{
    frac: number;
    label: string;
  } | null>(null);
  const exportAbort = useRef<AbortController | null>(null);
  // Export codec/quality — persisted per browser; plumbed into Exporter.export.
  const [exportCodec, setExportCodec] = useState<VideoCodecFamily>(
    () => (localStorage.getItem('velocut.exportCodec') as VideoCodecFamily) || 'avc',
  );
  const [exportQuality, setExportQuality] = useState<ExportQuality>(
    () => (localStorage.getItem('velocut.exportQuality') as ExportQuality) || 'high',
  );
  const [customMbps, setCustomMbps] = useState<number>(
    () => Number(localStorage.getItem('velocut.exportMbps')) || 20,
  );

  const runExport = async () => {
    const doc = structuredClone(store.getState().doc);
    const snapshot = new TsEngineAdapter(doc.name,doc.width,doc.height,doc.fpsNum,doc.fpsDen);snapshot.load(doc);
    const durationUs = snapshot.durationUs();
    if (durationUs <= 0 || exportPct) return;
    if (state.playing) playback.toggle();

    // Keep audio from speed-adjusted clips as well as normal-speed clips.
    const audioClips: AudioClipPlan[] = [];
    for (const track of doc.tracks) {
      if (track.muted) continue;
      for (const clip of track.clips) {
        const asset = clip.assetId ? doc.assets.find((a) => a.id === clip.assetId) : null;
        if (!asset?.hasAudio) continue;
        audioClips.push({
          assetId: asset.id,
          startUs: clip.startUs,
          durationUs: clip.durationUs,
          sourceInUs: clip.sourceInUs,
          gain: clip.volume,
          speed: clip.speed,
          gainAt: time => Math.max(0,evalKeyframes(clip.keyframes.volume||[],time-clip.startUs)??clip.volume),
        });
      }
    }

    // Target bitrate: 'custom' uses the explicit Mbps; presets scale with the
    // pixel rate (bpp × w × h × fps). No cap — passed straight to the encoder.
    const videoBitrate =
      exportQuality === 'custom'
        ? Math.round(customMbps * 1e6)
        : Math.round(
            doc.width * doc.height * (doc.fpsNum / doc.fpsDen) * QUALITY_BPP[exportQuality],
          );

    setExportError(null);
    if(!Number.isFinite(videoBitrate)||videoBitrate<=0){setExportError('请填写大于 0 的有效码率');return;}
    const abort = new AbortController();
    exportAbort.current = abort;
    setExportPct({ frac: 0, label: '正在准备' });
    try {
      const blob = await new Exporter(media).export({
        width: doc.width,
        height: doc.height,
        fpsNum: doc.fpsNum,
        fpsDen: doc.fpsDen,
        durationUs,
        evaluate: (t) => snapshot.evaluate(t),
        audioClips,
        videoBitrate,
        videoCodec: exportCodec,
        signal: abort.signal,
        onProgress: (frac, label) => setExportPct({ frac, label }),
      });
      if(destination==='canvas') {await sendOutput(blob,doc,durationUs);setExportOpen(false);}
      else {const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download=`${doc.name || 'OneYes'}.mp4`;a.click();URL.revokeObjectURL(url);}
    } catch (e) {
      if ((e as Error)?.name !== 'AbortError')
        setExportError(e instanceof Error ? e.message : String(e));
    } finally {
      setExportPct(null);
      exportAbort.current = null;
    }
  };

  const importFiles = (files: File[]) => void importMediaFiles(store, media, files);

  const selected = state.selectedClipId
    ? state.doc.tracks.flatMap((t) => t.clips).find((c) => c.id === state.selectedClipId)
    : null;

  return (
    <header className="toolbar">
      <Dialog open={outputSize} title="画面尺寸" onClose={()=>setOutputSize(false)}>
        <p>按原始素材尺寸创建项目。修改只作用于成片，不改动原始文件。</p>
        <label>宽度<input aria-label="画面宽度" type="number" value={size.width} onChange={e=>setSize({...size,width:Number(e.target.value)})}/></label>
        <label>高度<input aria-label="画面高度" type="number" value={size.height} onChange={e=>setSize({...size,height:Number(e.target.value)})}/></label>
        <button onClick={()=>{if(Number.isSafeInteger(size.width)&&Number.isSafeInteger(size.height)&&size.width>0&&size.height>0){store.loadDocument({...store.getState().doc,...size});setOutputSize(false);}}}>应用尺寸</button>
      </Dialog>
      <div className="project-bar">
        <div className="brand">
          <Icon name="timeline" size={22}/><span>OneYes 剪辑</span>
        </div>
        <span className="header-divider" />
        <span className="oneyes-project-title">{canvasTitle()}</span>
        <div className="workspace-modes" role="tablist" aria-label="Workspace">
          <button role="tab" aria-selected={!directorActive} onClick={onEdit}>
            <Icon name="timeline" size={16} />
            <span>剪辑</span>
          </button>
          <button role="tab" aria-selected={directorActive} onClick={onDirector}>
            <Icon name="cube" size={16} />
            <span>导演台</span>
          </button>
        </div>
        <span className="spacer" />
        <button aria-label="画面尺寸" onClick={()=>{setSize({width:state.doc.width,height:state.doc.height});setOutputSize(true);}}>{state.doc.width} × {state.doc.height}</button>
        <button onClick={()=>void closeEditor()}>返回画布</button>
        <button
          className="primary export-trigger"
          aria-label="导出"
          onClick={() => setExportOpen(true)}
        >
          <Icon name="download" size={16} />
          <span className="button-label">导出</span>
        </button>
      </div>
      <div className={'edit-bar' + (directorActive ? ' director-active' : '')}>
        <div className="tool-group">
          <button
            className="import-trigger"
            aria-label="导入素材"
            onClick={() => fileRef.current?.click()}
          >
            <Icon name="upload" size={16} />
            <span>导入素材</span>
          </button>
          <button
            className="icon-button"
            disabled={!state.canUndo}
            onClick={() => store.undo()}
            title="撤销 · Ctrl/⌘ Z"
            aria-label="撤销"
          >
            <Icon name="undo" />
          </button>
          <button
            className="icon-button"
            disabled={!state.canRedo}
            onClick={() => store.redo()}
            title="重做 · Ctrl/⌘ Shift Z"
            aria-label="重做"
          >
            <Icon name="redo" />
          </button>
        </div>
        {!directorActive && (
          <>
            <span className="header-divider" />
            <div className="tool-group">
              <button
                className="icon-button play-button"
                aria-label={state.playing ? '暂停' : '播放'}
                onClick={() => playback.toggle()}
                title="播放／暂停 · 空格"
              >
                <Icon name={state.playing ? 'pause' : 'play'} />
              </button>
              <button
                className="icon-button"
                onClick={() => splitAtPlayhead(store)}
                title="在播放头处分割 · S"
                aria-label="分割"
              >
                <Icon name="cut" />
              </button>
            </div>
            <span className="timecode">
              {fmtTime(state.playheadUs)}
              <span> / {fmtTime(state.durationUs)}</span>
            </span>
            <PreviewRateSelect rate={previewRate} onChange={rate => playback.setRate(rate)} label="预览速度" />
            {selected && (
              <label className="speed-label">
                <span>片段速度</span>
                <select
                  aria-label="片段速度"
                  value={String(selected.speed)}
                  onChange={(e) =>
                    store.dispatch({
                      type: 'setClipSpeed',
                      clipId: selected.id,
                      speed: Number(e.target.value),
                    })
                  }
                >
                  {[0.25, 0.5, 1, 1.5, 2, 4].map((v) => (
                    <option key={v} value={v}>
                      {v}×
                    </option>
                  ))}
                </select>
              </label>
            )}
          </>
        )}
        <span className="spacer" />
        <span className="toolbar-hint">
          {directorActive ? '三维场景' : '精修每一帧'}
        </span>
      </div>
      <input
        ref={fileRef}
        type="file"
        accept="video/mp4,video/quicktime,.mp4,.mov,.m4v,image/*,audio/*"
        multiple
        hidden
        onChange={(e) => {
          const files = Array.from(e.target.files ?? []);
          e.target.value = '';
          importFiles(files);
        }}
      />
      <Dialog
        open={exportOpen}
        title="导出成片"
        className="export-dialog"
        onClose={() => {
          if (exportPct) exportAbort.current?.abort();
          setExportOpen(false);
        }}
      >
        <p className="dialog-description">输出原尺寸 MP4，可回填画布继续创作。</p>
        <label className="form-field"><span>输出位置</span><select aria-label="输出位置" value={destination} disabled={!!exportPct} onChange={e=>setDestination(e.target.value)}><option value="canvas">回填到原画布</option><option value="file">保存到文件</option></select></label>
        <div className="export-summary">
          <Icon name="video" size={28} />
          <div>
            <strong>{state.doc.name}</strong>
            <span>
              {state.doc.width} × {state.doc.height} · {state.doc.fpsNum / state.doc.fpsDen} fps ·{' '}
              {fmtTime(state.durationUs)}
            </span>
          </div>
        </div>
        <label className="form-field">
          <span>编码格式</span>
          <select
            className="export-opt"
            aria-label="视频编码"
            value={exportCodec}
            disabled={!!exportPct}
            onChange={(e) => {
              const v = e.target.value as VideoCodecFamily;
              setExportCodec(v);
              localStorage.setItem('velocut.exportCodec', v);
            }}
          >
            {(['avc', 'hevc', 'av1'] as VideoCodecFamily[]).map((c) => (
              <option key={c} value={c}>
                {CODEC_LABEL[c]}
              </option>
            ))}
          </select>
        </label>
        <label className="form-field">
          <span>画质</span>
          <select
            className="export-opt"
            aria-label="输出画质"
            value={exportQuality}
            disabled={!!exportPct}
            onChange={(e) => {
              const v = e.target.value as ExportQuality;
              setExportQuality(v);
              localStorage.setItem('velocut.exportQuality', v);
            }}
          >
            <option value="standard">标准</option>
            <option value="high">高画质</option>
            <option value="ultra">精细画质</option>
            <option value="custom">自定义码率</option>
          </select>
        </label>
        {exportQuality === 'custom' && (
          <label className="form-field">
            <span>码率 · Mbps</span>
            <input
              className="export-mbps"
              type="number"
              aria-label="目标码率"
              value={customMbps}
              disabled={!!exportPct}
              onChange={(e) => {
                const v = Number(e.target.value);
                setCustomMbps(v);
                localStorage.setItem('velocut.exportMbps', String(v));
              }}
            />
          </label>
        )}
        {exportError && (
          <p className="scene-error" role="alert">
            {exportError}
          </p>
        )}
        {exportPct ? (
          <div className="export-progress" role="status">
            <div className="export-title">{exportPct.label}</div>
            <div className="export-bar">
              <div
                className="export-fill"
                style={{ width: `${Math.round(exportPct.frac * 100)}%` }}
              />
            </div>
            <div className="export-pct">{Math.round(exportPct.frac * 100)}%</div>
            <button onClick={() => exportAbort.current?.abort()}>取消导出</button>
          </div>
        ) : (
          <button
            className="primary full-width"
            onClick={runExport}
            disabled={state.durationUs <= 0}
          >
            <Icon name="download" />导出 MP4</button>
        )}
        {state.durationUs <= 0 && (
          <p className="empty-hint">请先把素材加入时间线。</p>
        )}
      </Dialog>
    </header>
  );
}
