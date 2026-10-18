import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { MUSCLES, getMuscle, type MuscleId, type Muscle } from './muscles';
import './muscles.css';
import { ExerciseBrowser } from './ExerciseLibrary';

const BodyScene = lazy(() => import('./BodyScene'));

function ConfirmMuscle({ muscle, onConfirm, onDismiss }: { muscle: Muscle; onConfirm: () => void; onDismiss: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => { const element = dialog.current!; const previous = document.body.style.overflow; element.showModal(); document.body.style.overflow = 'hidden'; return () => { element.close(); document.body.style.overflow = previous; }; }, []);
  return <dialog ref={dialog} className="muscle-confirm" aria-labelledby="muscle-confirm-title" aria-describedby="muscle-confirm-description" onCancel={event => { event.preventDefault(); onDismiss(); }} onClick={event => { if (event.target === event.currentTarget) onDismiss(); }}><span className="confirmation-eyebrow">确认目标肌群</span><div className="confirmation-mark" aria-hidden="true">✓</div><h2 id="muscle-confirm-title">你选中的是<span>{muscle.name}</span></h2><p id="muscle-confirm-description">{muscle.position}。确认后进入该肌群页面，之后也可以重新选择。</p><div className="confirm-structure">模型对应结构<span>{muscle.members}</span></div><div className="muscle-confirm-actions"><button type="button" className="button secondary" autoFocus onClick={onDismiss}>重新选择</button><button type="button" className="button primary" onClick={onConfirm}>确认，进入{muscle.name}</button></div></dialog>;
}

export default function MuscleExplorer({ selected, onConfirm, onReselect }: { selected: MuscleId | null; onConfirm: (id: MuscleId) => void; onReselect: () => void }) {
  const [pending, setPending] = useState<MuscleId | null>(null);
  const [region, setRegion] = useState('全部');
  const muscle = getMuscle(selected);
  const pendingMuscle = getMuscle(pending);
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => { if (selected) heading.current?.focus({ preventScroll: true }); }, [selected]);
  function confirm() { if (!pending) return; onConfirm(pending); setPending(null); window.scrollTo({ top: 0, behavior: 'instant' }); }
  return <section className={`muscle-explorer ${muscle ? 'has-target' : ''}`}>
    <header className="muscle-page-heading"><div><div className="eyebrow"><span className="tiny-dot" />{muscle ? '已确认的训练目标' : '身体地图 · 从一个目标开始'}</div><h1 ref={heading} tabIndex={-1}>{muscle ? muscle.name : '今天，想练哪里？'}</h1><p>{muscle ? '绿色区域是你选中的肌群。旋转模型，看看它的位置。' : '旋转人体，轻点想了解的肌群。确认后，进入它的专属页面。'}</p></div>{muscle && <button type="button" className="button secondary reselect-muscle" onClick={() => { setPending(null); onReselect(); }}>← 重新选择肌群</button>}</header>
    <div className="muscle-workspace"><div className="body-model-column"><Suspense fallback={<div className="body-scene-card model-module-loading" role="status"><span className="spinner" />正在打开肌群模型…</div>}><BodyScene selected={pending || selected} onPick={setPending} /></Suspense><details className="model-credits"><summary>模型来源与许可</summary><p>Écorché · Charleeh，CC BY-SA 4.0。基于 BodyParts3D（DBCLS）与 Z-Anatomy（Gauthier Kervyn）。模型文件保持原样，页面增加中文肌群映射、颜色和交互。本图是成人男性骨骼肌示意，供位置浏览。</p><a href="https://github.com/Charleeh/ecorche" target="_blank" rel="noopener noreferrer">模型项目</a><a href="/models/ecorche/ATTRIBUTION.md" target="_blank" rel="noopener noreferrer">完整署名</a><a href="/models/ecorche/LICENSES/CC-BY-SA-4.0.txt" target="_blank" rel="noopener noreferrer">模型许可</a></details></div>
      {muscle ? <aside className="muscle-target-card" aria-label="已选择的肌群"><span className="target-confirmed">✓ 已确认</span><h2>{muscle.name}</h2><p className="target-position">{muscle.position}</p><dl><div><dt>所属区域</dt><dd>{muscle.region}</dd></div><div><dt>本次查看的结构</dt><dd>{muscle.members}</dd></div></dl><div className="target-note"><b>接下来，看看怎么练</b><p>下方可以按器材找动作、打开教学，也可以收藏想练的动作。</p><a className="text-button" href="#muscle-exercises">查看训练动作 ↓</a></div><button type="button" className="button primary" onClick={onReselect}>重新选择肌群</button></aside> : <aside className="muscle-picker"><div className="muscle-picker-title"><span className="eyebrow">按名称选择</span><h2>找到你的目标</h2><p>模型和列表都可以选，确认后再进入。</p></div><div className="muscle-region-tabs" aria-label="按身体区域筛选">{['全部', '上肢', '躯干', '下肢'].map(item => <button type="button" key={item} aria-pressed={region === item} className={region === item ? 'active' : ''} onClick={() => setRegion(item)}>{item}</button>)}</div><div className="muscle-choice-grid">{MUSCLES.filter(item => region === '全部' || item.region === region).map(item => <button type="button" key={item.id} className={pending === item.id ? 'pending' : ''} onClick={() => setPending(item.id)} aria-label={`选择${item.name}`}><span>{item.name}</span><small>{item.position}</small><i aria-hidden="true">↗</i></button>)}</div><p className="muscle-picker-note">左右两侧按同一肌群选择；可旋转模型查看另一侧。</p></aside>}
    </div>
    {muscle && <section id="muscle-exercises" className="muscle-exercises"><ExerciseBrowser key={muscle.id} muscle={muscle.id} /></section>}
    {pendingMuscle && <ConfirmMuscle muscle={pendingMuscle} onConfirm={confirm} onDismiss={() => setPending(null)} />}
  </section>;
}
