import { Icon, type IconName } from './primitives/Icon';
import { useEffect, useState } from 'react';
import type { Store, UiState } from '../state/store';
import type { MediaLibrary } from '@velocut/render-sdk';
import type { Asset, Envelope, TrackKind } from '@velocut/protocol';
import { referenceToAgent } from '../services/reference';
import { ASSET_MIME, setDraggedAsset } from '../services/dnd';

const ICON: Record<string, IconName> = {
  video: 'video',
  image: 'image',
  audio: 'audio',
};

const sameSet = (a: Set<string>, b: Set<string>) =>
  a.size === b.size && [...a].every((x) => b.has(x));

/** Tooltip for an asset the document references but whose media isn't loaded. */
function unloadedHint(src: string): string {
  return src.startsWith('motion://')
    ? '动态图形未能恢复，请检查素材'
    : '原始素材缺失，请重新导入原文件并替换对应片段；不会按文件名覆盖其他素材';
}

/**
 * Assets the document references but whose media isn't actually loaded — an OPFS
 * file gone missing, a local:// import lost on reload, or a motion clip whose
 * draw program didn't survive a reload. Their clips render a silent black frame
 * with no other signal, so the panel flags them. Attachment lives in the media
 * worker (not the store), so we poll hasAsset(); a normal restore is async and
 * lands within a second or two, so an asset is flagged only after several
 * consecutive misses — a still-loading asset never flashes a false warning.
 */
function useUnloadedAssets(
  media: MediaLibrary,
  assetKey: string,
  assets: readonly { id: string; src: string }[],
): Set<string> {
  const [unloaded, setUnloaded] = useState<Set<string>>(new Set());
  useEffect(() => {
    const misses = new Map<string, number>();
    let polls = 0;
    let timer = 0;
    const tick = () => {
      const next = new Set<string>();
      let anyPending = false;
      for (const a of assets) {
        if (!a.src || media.hasAsset(a.id)) {
          misses.delete(a.id);
          continue;
        }
        anyPending = true; // unattached — keep polling so a late restore clears it
        const n = (misses.get(a.id) ?? 0) + 1;
        misses.set(a.id, n);
        if (n >= 4) next.add(a.id); // ~5s of misses → not just a slow restore
      }
      setUnloaded((prev) => (sameSet(prev, next) ? prev : next));
      if (anyPending && ++polls < 20) timer = window.setTimeout(tick, 1200);
    };
    timer = window.setTimeout(tick, 1200);
    return () => window.clearTimeout(timer);
  }, [media, assetKey]); // re-evaluate whenever the asset set / srcs change
  return unloaded;
}

export function AssetPanel({
  store,
  media,
  state,
  width,
  onNewScene,
  onImport,
  creating,
}: {
  store: Store;
  media: MediaLibrary;
  state: UiState;
  width?: number;
  onNewScene: () => void;
  onImport: () => void;
  creating?: boolean;
}) {
  const [query, setQuery] = useState('');
  const visibleAssets = state.doc.assets.filter((a) =>
    a.name.toLowerCase().includes(query.toLowerCase()),
  );
  const assetKey = state.doc.assets.map((a) => `${a.id}:${a.src}`).join('|');
  const unloaded = useUnloadedAssets(media, assetKey, state.doc.assets);
  /** Select the first clip an envelope created (so it's immediately editable). */
  const selectNewClip = (resp: Envelope) => {
    if (!resp.ok) return;
    const ev = resp.events.find((e) => e.kind === 'clipAdded');
    if (ev && ev.kind === 'clipAdded') store.select(ev.clipId);
  };

  const addTextLayer = () => {
    const doc = state.doc;
    const textTrack = doc.tracks.find((t) => t.kind === 'text' && !t.locked);
    const text = {
      content: '双击编辑文字',
      fontSize: 72,
      color: '#ffffff',
    };
    if (!textTrack) {
      const trackId = `track_${doc.nextId}`;
      selectNewClip(
        store.dispatch({
          type: 'batch',
          commands: [
            { type: 'addTrack', kind: 'text', name: '文字' },
            {
              type: 'addTextClip',
              trackId,
              startUs: state.playheadUs,
              durationUs: 3_000_000,
              text,
            },
          ],
        }),
      );
    } else {
      selectNewClip(
        store.dispatch({
          type: 'addTextClip',
          trackId: textTrack.id,
          startUs: state.playheadUs,
          durationUs: 3_000_000,
          text,
        }),
      );
    }
  };

  const insertAsset = (asset: Asset) => {
    const doc = store.getState().doc;
    const kind = asset.kind === 'audio' ? 'audio' : 'video';
    const startUs = store.getState().playheadUs;
    const durationUs = asset.kind === 'image' ? 3_000_000 : asset.durationUs;
    const track = doc.tracks.find(
      (t) =>
        t.kind === kind &&
        !t.locked &&
        !t.clips.some(
          (c) => c.startUs < startUs + durationUs && c.startUs + c.durationUs > startUs,
        ),
    );
    const clip = {
      type: 'addClip' as const,
      trackId: track?.id ?? `track_${doc.nextId}`,
      assetId: asset.id,
      startUs,
      durationUs,
    };
    selectNewClip(
      store.dispatch(
        track
          ? clip
          : {
              type: 'batch',
              commands: [
                {
                  type: 'addTrack',
                  kind,
                  name: kind === 'audio' ? '音频' : '视频',
                },
                clip,
              ],
            },
      ),
    );
  };

  const addTrack = (kind: TrackKind, name: string) =>
    store.dispatch({
      type: 'addTrack',
      kind,
      name,
      index: kind === 'video' ? 0 : undefined,
    });

  return (
    <div className="asset-panel" style={width ? { width } : undefined}>
      <div className="panel-title">
        素材库 <span className="count-badge">{state.doc.assets.length}</span>
      </div>
      <label className="search-field">
        <Icon name="search" size={15} />
        <input
          aria-label="搜索素材"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="搜索素材"
        />
      </label>
      {state.doc.assets.length === 0 && (
        <div className="library-empty">
          <Icon name="folder" size={30} />
          <strong>素材库</strong>
          <p>导入视频、图片或音频，点击或拖入时间线。</p>
          <button className="subtle-button" onClick={onImport}>
            选择文件
            <Icon name="upload" size={14} />
          </button>
        </div>
      )}
      <div className="asset-list">
        {visibleAssets.map((a) => (
          <div
            key={a.id}
            className="asset-item"
            draggable
            title="拖到时间线，或点击加号插入"
            onDragStart={(e) => {
              e.dataTransfer.setData(ASSET_MIME, a.id);
              e.dataTransfer.effectAllowed = 'copy';
              // Mirror the payload for the timeline's dragover ghost (dataTransfer
              // data is unreadable until drop).
              setDraggedAsset({
                id: a.id,
                kind: a.kind,
                durationUs: a.durationUs,
                width: a.width,
                height: a.height,
              });
            }}
            onDragEnd={() => setDraggedAsset(null)}
          >
            <button
              className="asset-insert"
              aria-label={`在播放头处插入 ${a.name}`}
              title="在播放头处插入"
              onClick={() => insertAsset(a)}
            >
              <Icon name="plus" size={14} />
            </button>
            <span className={`asset-kind asset-${a.kind}`}>
              <Icon
                name={a.src.startsWith('scene://') ? 'cube' : (ICON[a.kind] ?? 'media')}
                size={18}
              />
            </span>
            <span className="asset-name">
              {a.name}
              <small>{a.src.startsWith('scene://') ? '三维场景' : {video:'视频',audio:'音频',image:'图片'}[a.kind]}</small>
            </span>
            {unloaded.has(a.id) && (
              <span
                className="asset-warn"
                title={unloadedHint(a.src)}
                onClick={(e) => e.stopPropagation()}
              >
                !
              </span>
            )}
            {a.durationUs > 0 && (
              <span className="asset-dur">{(a.durationUs / 1e6).toFixed(1)}s</span>
            )}
          </div>
        ))}
      </div>
      {query && !visibleAssets.length && <p className="empty-hint">没有匹配“{query}”的素材</p>}
      <div className="panel-foot">
        <button className="add-text-btn" disabled={creating} onClick={onNewScene}>
          <Icon name="cube" size={16} />
          新建三维场景
        </button>
        <button className="add-text-btn" onClick={addTextLayer}>
          <Icon name="text" size={16} />
          文字图层
        </button>
        <div className="add-track-row">
          <span className="add-track-label">添加轨道</span>
          <button onClick={() => addTrack('video', '视频')} title="添加视频轨道">视频</button>
          <button onClick={() => addTrack('audio', '音频')} title="添加音频轨道">音频</button>
          <button onClick={() => addTrack('text', '文字')} title="添加文字轨道">文字</button>
        </div>
      </div>
    </div>
  );
}
