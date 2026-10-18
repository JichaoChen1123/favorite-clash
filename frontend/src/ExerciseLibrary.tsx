import { useEffect, useRef, useState } from 'react';
import { EQUIPMENT, useExercises, type Exercise, type Equipment } from './exercises';
import { MUSCLES, getMuscle, type MuscleId } from './muscles';
import './exercises.css';
import { safeVideoUrl, time } from './api';

function Bookmark({ filled = false }: { filled?: boolean }) { return <svg width="20" height="20" viewBox="0 0 24 24" fill={filled ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" aria-hidden="true"><path d="M6 4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v17l-6-4-6 4z" /></svg>; }
function SaveButton({ item, compact = false }: { item: Exercise; compact?: boolean }) {
  const library = useExercises(); const saved = library.saved.has(item.id); const pending = library.pending.has(item.id);
  return <button type="button" className={`save-exercise ${saved ? 'is-saved' : ''} ${compact ? 'compact' : ''}`} aria-label={`${saved ? '取消收藏' : '收藏'}${item.name}`} aria-pressed={saved} disabled={!library.favoritesReady || pending} onClick={() => void library.toggle(item)}><Bookmark filled={saved} /><span>{pending ? '保存中…' : saved ? '已收藏' : '收藏动作'}</span></button>;
}
function LibraryMessages() { const { favoritesError, refreshFavorites, notice } = useExercises(); return <>{favoritesError && <div className="alert error" role="alert">{favoritesError}<button className="text-button" onClick={() => void refreshFavorites()}>刷新收藏</button></div>}<div className="exercise-notice" role="status" aria-live="polite">{notice}</div></>; }
function ExerciseDetail({ item, onClose }: { item: Exercise; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => { const node = dialog.current!; const overflow = document.body.style.overflow; node.showModal(); document.body.style.overflow = 'hidden'; return () => { node.close(); document.body.style.overflow = overflow; }; }, []);
  return <dialog ref={dialog} className="exercise-dialog" aria-labelledby="exercise-detail-title" onCancel={event => { event.preventDefault(); onClose(); }} onClick={event => { if (event.target === event.currentTarget) onClose(); }}>
    <div className="exercise-dialog-top"><span className="eyebrow">动作教学 / {item.category}</span><button type="button" className="icon-button" aria-label="关闭动作详情" onClick={onClose} autoFocus>×</button></div>
    <h2 id="exercise-detail-title">{item.name}</h2><p className="exercise-english">{item.english}</p><p className="exercise-description">{item.summary}</p>
    <div className="exercise-detail-tags"><span>{EQUIPMENT[item.equipment]}</span>{item.primary.map(id => <span key={id}>{getMuscle(id)?.name}</span>)}</div>
    <div className="exercise-video-link"><span className="play-mark" aria-hidden="true">▷</span><div><b>B站 · 中文教学</b><small>UP主 {item.teaching.author} · {time(item.teaching.duration)}{item.teaching.page > 1 ? ` · P${item.teaching.page}` : ''}</small></div><a href={safeVideoUrl(item.teaching.url)} target="_blank" rel="noopener noreferrer" className="button primary small">打开教学 ↗</a><p className="teaching-title">{item.teaching.page > 1 ? item.teaching.part_title : item.teaching.title}</p></div><p className="teaching-scope">{item.teaching.scope}</p>
    <section><h3>练哪里、用什么</h3><p>{item.focus}</p><p className="equipment-requirement">需要：{item.requires}</p>{item.secondary.length > 0 && <p className="exercise-secondary">辅助参与：{item.secondary.map(id => getMuscle(id)?.name).join('、')}。辅助参与不等于该动作以它为主要目标。</p>}</section>
    <section><h3>先摆好姿势</h3><p>{item.setup}</p></section><section><h3>跟着这几步</h3><ol className="exercise-steps">{item.steps.map((step, index) => <li key={step}><span>{String(index + 1).padStart(2, '0')}</span><p>{step}</p></li>)}</ol></section>
    <section className="exercise-mistakes"><h3>容易忽略的地方</h3><ul>{item.mistakes.map(text => <li key={text}>{text}</li>)}</ul></section>
    <details className="exercise-source"><summary>查看内容来源</summary><p>本页中文要点参考{item.source.publisher}资料整理，非完整翻译。B站视频为独立作者演示，可能含其他变式，各自保留来源。</p><a href={item.source.url} target="_blank" rel="noopener noreferrer">文字资料：{item.source.publisher} · {item.source.title} ↗</a><br /><a href={safeVideoUrl(item.teaching.url)} target="_blank" rel="noopener noreferrer">中文演示：{item.teaching.author} · {item.teaching.page > 1 ? item.teaching.part_title : item.teaching.title} ↗</a></details>
    <LibraryMessages /><div className="exercise-detail-bottom"><SaveButton item={item} /><button className="button secondary small" onClick={onClose}>返回动作列表</button></div>
  </dialog>;
}
function ExerciseCard({ item, onOpen }: { item: Exercise; onOpen: () => void }) { return <article className="exercise-card"><div className="exercise-card-top"><span className="exercise-category">{item.category} / {EQUIPMENT[item.equipment]}</span><SaveButton item={item} compact /></div><button type="button" className="exercise-open" onClick={onOpen} aria-label={`查看${item.name}教学`}><h3>{item.name}<span aria-hidden="true">↗</span></h3><p>{item.summary}</p><div className="exercise-card-muscles">{item.primary.map(id => <span key={id}>{getMuscle(id)?.name}</span>)}</div><span className="exercise-teaching-label">▷ 查看步骤与教学视频</span></button></article>; }

export function ExerciseBrowser({ muscle, favoritesOnly = false }: { muscle?: MuscleId; favoritesOnly?: boolean }) {
  const library = useExercises();
  const [equipment, setEquipment] = useState<Equipment | 'all'>('all');
  const [filterMuscle, setFilterMuscle] = useState('all');
  const [detail, setDetail] = useState<Exercise | null>(null);
  useEffect(() => { setEquipment('all'); setFilterMuscle('all'); setDetail(null); }, [muscle, favoritesOnly]);
  useEffect(() => { void library.refreshFavorites(); }, [library.refreshFavorites]);
  if (library.loading && !library.catalog) return <div className="exercise-loading" role="status"><span className="spinner" />正在打开动作库…</div>;
  if (!library.catalog) return <div className="exercise-empty"><h3>动作库暂时没有打开</h3><p>{library.error}</p><button className="button secondary small" onClick={library.reload}>重新加载动作</button></div>;
  const available = library.catalog.items.filter(item => !muscle || item.primary.includes(muscle));
  const savedItems = available.filter(item => !favoritesOnly || library.saved.has(item.id));
  const items = savedItems.filter(item => (equipment === 'all' || item.equipment === equipment) && (filterMuscle === 'all' || item.primary.includes(filterMuscle as MuscleId)));
  const supported = MUSCLES.filter(group => library.catalog!.items.some(item => item.primary.includes(group.id)));
  return <div className="exercise-browser">
    <div className="exercise-section-heading"><div><span className="eyebrow">{muscle ? '从目标，找到动作' : favoritesOnly ? '把想练的，留在手边' : '按肌群，找到练法'}</span><h2>{muscle ? `${getMuscle(muscle)?.name}，可以这样练` : favoritesOnly ? '我的收藏' : '浏览动作'}</h2><p>{muscle ? '先选手边的器材，再打开动作看教学。' : favoritesOnly ? '这里收好了你想再看的动作。' : `${library.catalog.items.length} 个代表动作，覆盖 ${supported.length} 个目标肌群。`}</p></div><span className="exercise-count">{items.length} 个动作</span></div>
    <LibraryMessages />
    {!muscle && <label className="exercise-muscle-filter">按目标肌群<select value={filterMuscle} onChange={event => setFilterMuscle(event.target.value)}><option value="all">全部肌群</option>{supported.map(group => <option key={group.id} value={group.id}>{group.name}</option>)}</select></label>}
    <div className="exercise-equipment-tabs" aria-label="按器材筛选">{(['all', 'bodyweight', 'dumbbell', 'machine'] as const).map(key => <button type="button" key={key} className={equipment === key ? 'active' : ''} aria-pressed={equipment === key} onClick={() => setEquipment(key)}>{key === 'all' ? '全部器材' : EQUIPMENT[key]}</button>)}</div>
    {favoritesOnly && !library.favoritesReady ? <div className="exercise-empty"><h3>{library.favoritesError ? '收藏暂时无法读取' : '正在找回收藏…'}</h3><p>读取完成后，再显示你的动作。</p></div> : items.length > 0 ? <div className="exercise-grid">{items.map(item => <ExerciseCard key={item.id} item={item} onOpen={() => setDetail(item)} />)}</div> : <div className="exercise-empty"><span aria-hidden="true">◇</span><h3>{available.length === 0 ? '这个肌群的动作正在整理' : favoritesOnly && savedItems.length === 0 ? '先收藏一个想练的动作' : '这个条件下还没有动作'}</h3><p>{available.length === 0 ? '你仍可旋转模型或重新选择目标，查看已收录的动作。' : favoritesOnly && savedItems.length === 0 ? '切到“浏览动作”，点书签就能收好；以后也可以取消收藏。' : '试试其他器材，或清除筛选查看已有动作。'}</p>{savedItems.length > 0 && <button className="button secondary small" onClick={() => { setEquipment('all'); setFilterMuscle('all'); }}>清除筛选</button>}</div>}
    <p className="exercise-library-note">每个动作附有文字资料来源与B站中文演示，具体变式以详情为准。收藏保存在同一私人项目中，手机与电脑可读取。</p>
    {detail && <ExerciseDetail item={detail} onClose={() => setDetail(null)} />}
  </div>;
}

export default function ExerciseLibrary() {
  const [tab, setTab] = useState<'saved' | 'all'>('saved');
  return <section className="exercise-library-page"><header className="exercise-page-heading"><span className="eyebrow"><span className="tiny-dot" /> 你的动作口袋</span><h1>动作收藏</h1><p>先收好想练的动作，下次打开就能找到。</p></header><div className="exercise-library-tabs" aria-label="动作库视图"><button type="button" aria-pressed={tab === 'saved'} className={tab === 'saved' ? 'active' : ''} onClick={() => setTab('saved')}>我的收藏</button><button type="button" aria-pressed={tab === 'all'} className={tab === 'all' ? 'active' : ''} onClick={() => setTab('all')}>浏览动作</button></div><ExerciseBrowser favoritesOnly={tab === 'saved'} /></section>;
}
