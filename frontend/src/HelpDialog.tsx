import { useEffect, useRef, useState } from 'react';
import { findHelp, HELP_CATEGORIES, type HelpCategory } from './help';
import './help.css';

const PROJECT = 'https://github.com/JichaoChen1123/favorite-clash';

export default function HelpDialog({ onClose }: { onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<HelpCategory>('全部');
  const entries = findHelp(category, query);
  useEffect(() => {
    const node = dialog.current!;
    const previous = document.activeElement;
    const overflow = document.body.style.overflow;
    node.showModal(); document.body.style.overflow = 'hidden';
    return () => {
      node.close(); document.body.style.overflow = overflow;
      if (previous instanceof HTMLElement && previous.isConnected) previous.focus({ preventScroll: true });
    };
  }, []);
  return <dialog ref={dialog} className="help-dialog" aria-labelledby="help-title" aria-describedby="help-description" onCancel={event => { event.preventDefault(); onClose(); }} onClick={event => { if (event.target === event.currentTarget) onClose(); }}>
    <header className="help-heading"><div><span>练有引力 · 随手查一查</span><h2 id="help-title">帮助与使用说明</h2></div><button type="button" className="help-close" aria-label="关闭帮助" autoFocus onClick={onClose}>×</button></header>
    <div className="help-tools"><p id="help-description">查操作步骤，也查常见问题。关闭帮助后，回到刚才的页面。</p>
      <div className="help-search"><label htmlFor="help-search-input" className="sr-only">搜索帮助</label><input id="help-search-input" type="search" placeholder="搜索：收藏、保存失败、额度、字幕…" value={query} onChange={event => setQuery(event.target.value)} />{query && <button type="button" aria-label="清空搜索" onClick={() => setQuery('')}>清空</button>}</div>
      <nav className="help-categories" aria-label="帮助分类">{HELP_CATEGORIES.map(item => <button type="button" key={item} aria-pressed={item === category} onClick={() => setCategory(item)}>{item}</button>)}</nav>
    </div>
    <div className="help-scroll"><p className="help-count" role="status">{entries.length ? `找到 ${entries.length} 条说明，点开查看` : '没有找到匹配的说明'}</p>
      {entries.length ? <div className="help-entries">{entries.map(entry => <details className="help-entry" key={entry.id}><summary><span><small>{entry.category}</small><b>{entry.title}</b></span><span className="help-chevron" aria-hidden="true">⌄</span></summary><div className="help-answer">{entry.paragraphs.map((text, index) => <p key={index}>{text}</p>)}{entry.steps && <ol>{entry.steps.map((text, index) => <li key={index}>{text}</li>)}</ol>}</div></details>)}</div> : <div className="help-empty"><h3>换个说法试试</h3><p>试试“保存”“模型”“字幕”或“手机”。也可以切换分类，或者查看全部说明。</p><button type="button" className="button secondary" onClick={() => { setQuery(''); setCategory('全部'); }}>查看全部帮助</button></div>}
      <footer className="help-more"><h3>还没找到答案？</h3><p>完整说明包含安装、更新、备份和环境配置。反馈时写清操作步骤与页面提示，有助于定位问题。</p><div><a href={`${PROJECT}#readme`} target="_blank" rel="noopener noreferrer">完整部署与使用说明 ↗</a><a href={`${PROJECT}/issues`} target="_blank" rel="noopener noreferrer">查看与反馈问题 ↗</a></div></footer>
    </div>
  </dialog>;
}
