import { useState, type ReactNode } from 'react';
import './shell.css';

export type Section = 'muscles' | 'training' | 'favorites' | 'new';

function NavIcon({ section }: { section: Section }) {
  return <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{section === 'muscles' ? <><circle cx="12" cy="4" r="2" /><path d="m7 8 5 1 5-1M12 9v6m-5 6 5-6 5 6M7 8l-3 5m13-5 3 5" /></> : section === 'training' ? <><path d="M8 12h8M5 7v10m3-12v14m11-12v10M16 5v14M3 10v4m18-4v4" /></> : section === 'favorites' ? <path d="M6 4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v17l-6-4-6 4z" /> : <><rect x="3" y="4" width="18" height="16" rx="3" /><path d="m10 9 5 3-5 3z" /></>}</svg>;
}

const SECTIONS: { id: Section; label: string; hint: string }[] = [
  { id: 'muscles', label: '练哪里', hint: '选肌群，或从器材开始' },
  { id: 'training', label: '训练', hint: '记录每一组，回看进步' },
  { id: 'favorites', label: '动作收藏', hint: '收好想练的动作' },
  { id: 'new', label: '视频对照', hint: '新建对照，找回历史' },
];

export function AppShell({ active, onNavigate, children }: { active: Section; onNavigate: (section: Section) => void; children: ReactNode }) {
  const [collapsed, setCollapsed] = useState(() => { try { return localStorage.getItem('fitness-sidebar-collapsed') === 'true'; } catch { return false; } });
  function toggle() { setCollapsed(value => { try { localStorage.setItem('fitness-sidebar-collapsed', String(!value)); } catch { /* Layout remains usable without storage. */ } return !value; }); }
  const entries = (mobile: boolean) => SECTIONS.map(section => <button key={section.id} type="button" className={active === section.id ? 'active' : ''} aria-label={section.label} aria-current={active === section.id ? 'page' : undefined} title={collapsed && !mobile ? section.label : undefined} onClick={() => onNavigate(section.id)}><NavIcon section={section.id} /><span className="nav-copy"><b>{section.label}</b>{!mobile && <small>{section.hint}</small>}</span></button>);
  return <div className={`workspace-shell ${collapsed ? 'sidebar-collapsed' : ''}`}>
    <aside className="workspace-sidebar"><button type="button" className="workspace-brand" onClick={() => onNavigate('muscles')} aria-label="收藏夹打架了，返回练哪里"><span className="brand-mark"><span /><span /></span><span className="workspace-brand-name">收藏夹打架了<span>.</span></span></button><p className="sidebar-caption">从看懂，到练懂</p><nav aria-label="主要导航">{entries(false)}</nav><div className="sidebar-bottom"><p>每次选择，都更清楚一点。</p><button type="button" className="sidebar-toggle" onClick={toggle} aria-expanded={!collapsed} aria-label={collapsed ? '展开侧栏' : '收起侧栏'} title={collapsed ? '展开侧栏' : '收起侧栏'}><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="3" /><path d="M9 4v16m6-11-3 3 3 3" /></svg><span>收起侧栏</span></button></div></aside>
    <header className="workspace-mobile-header"><button className="workspace-brand" type="button" onClick={() => onNavigate('muscles')} aria-label="收藏夹打架了，返回练哪里"><span className="brand-mark"><span /><span /></span><span>收藏夹打架了<span className="brand-period">.</span></span></button></header>
    <div className="workspace-content">{children}</div>
    <nav className="workspace-bottom-nav" aria-label="底部菜单">{entries(true)}</nav>
  </div>;
}
