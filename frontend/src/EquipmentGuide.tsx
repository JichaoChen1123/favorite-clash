import { useEffect, useRef, useState } from 'react';
import { EQUIPMENT_GUIDES, getEquipmentGuide } from './equipment';
import EquipmentIllustration from './EquipmentIllustration';
import { useExercises } from './exercises';
import { ExerciseBrowser } from './ExerciseLibrary';
import { getMuscle } from './muscles';
import './equipment.css';

export default function EquipmentGuide({ selected, onSelect }: { selected: string | null; onSelect: (id: string | null) => void }) {
  const [query, setQuery] = useState('');
  const { catalog, loading, error, reload } = useExercises();
  const guide = getEquipmentGuide(selected);
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => { if (selected) heading.current?.focus({ preventScroll: true }); }, [selected]);
  const matching = EQUIPMENT_GUIDES.filter(item => `${item.name} ${item.english} ${item.aliases}`.toLowerCase().includes(query.trim().toLowerCase()));
  const related = catalog?.items.filter(item => guide?.exerciseIds.includes(item.id)) || [];
  const example = related.find(item => item.id === guide?.example);
  const targets = (ids: readonly string[]) => [...new Set(catalog?.items.filter(item => ids.includes(item.id)).flatMap(item => item.primary) || [])];
  return <section className="equipment-guide-page">
    <header className="equipment-page-heading"><span className="eyebrow"><span className="tiny-dot" /> 器材指南 · 从手边的器材开始</span><h1 ref={heading} tabIndex={-1}>{guide ? guide.name : '这台器材，怎么练？'}</h1><p>{guide ? guide.introduction : '看图找器材，了解它能练哪里，再打开动作教学。'}</p>{guide && <button className="button secondary small" onClick={() => onSelect(null)}>← 重新选择器材</button>}</header>
    {!catalog ? <div className="exercise-empty" role="status"><h2>{loading ? '正在读取关联动作…' : '关联动作暂时没有打开'}</h2><p>{loading ? '读取完成后显示肌群、动作与资料来源。' : error}</p>{!loading && <button className="button secondary small" onClick={reload}>重新加载动作</button>}</div> : guide ? <>
      <div className="equipment-detail-grid"><section className="equipment-profile"><EquipmentIllustration kind={guide.id} /><span className="equipment-drawing-note">结构示意 · 实物外观可能不同</span><h2>怎么认</h2><p>{guide.recognize}</p><p className="equipment-alias">也可以按这些名称找：{guide.aliases}</p></section>
        <section className="equipment-setup"><h2>使用前，先看这几处</h2><ol>{guide.before.map(text => <li key={text}>{text}</li>)}</ol><div className="equipment-targets"><h3>已有动作可以练到</h3><div>{targets(guide.exerciseIds).map(id => <span key={id}>{getMuscle(id)?.name}</span>)}</div><p>按当前收录动作列出主练肌群，具体练哪里取决于所选动作。</p></div>
          {example && <details className="equipment-reference"><summary>查看起始姿势与资料来源</summary><b>{example.name}</b><p>{example.setup}</p><p>以下来源用于对应动作说明；现场器械的档位和调节位置以机身说明为准。</p>{[...new Map(related.map(item => [item.source.url, item.source])).values()].map(source => <a key={source.url} href={source.url} target="_blank" rel="noopener noreferrer">{source.publisher} · {source.title} ↗</a>)}</details>}
        </section></div>
      <section className="equipment-related"><ExerciseBrowser key={guide.id} exerciseIds={guide.exerciseIds} /></section>
    </> : <>
      <label className="equipment-search">查找器材<input type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder="例如：哑铃、推胸、夹腿" maxLength={100} /></label>
      <div className="equipment-list-heading"><h2>常见器材</h2><span role="status">{matching.length} 类</span></div>
      {matching.length ? <div className="equipment-grid">{matching.map(item => <button className="equipment-card" key={item.id} onClick={() => onSelect(item.id)} aria-label={`查看${item.name}指南`}><EquipmentIllustration kind={item.id} /><span className="equipment-drawing-note">结构示意</span><h3>{item.name}<span aria-hidden="true">↗</span></h3><p>{item.introduction}</p><div className="equipment-card-tags">{targets(item.exerciseIds).map(id => <span key={id}>{getMuscle(id)?.name}</span>)}</div><span className="equipment-card-action">查看使用方法与动作</span></button>)}</div> : <div className="exercise-empty"><h3>暂时没有这个器材</h3><p>先试试常见名称，或查看当前收录的6类器材。</p><button className="button secondary small" onClick={() => setQuery('')}>查看全部器材</button></div>}
      <p className="equipment-library-note">图示帮助辨认结构；同类器材的实物和调节方式会有差异。选定后查看使用说明与对应教学。</p>
    </>}
  </section>;
}
