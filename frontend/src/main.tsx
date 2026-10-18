import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { api, errorText, safeVideoUrl, time } from './api';
import type { Classification, Comparison, Evidence, Health, Job, Source, Video } from './types';
import './styles.css';
import { AppShell, type Section } from './AppShell';
import { readAppRoute, writeAppUrl, type AppView } from './navigation';
import './equipment.css';
import type { MuscleId } from './muscles';
import { ExerciseProvider } from './exercises';
const MuscleExplorer = React.lazy(() => import('./MuscleExplorer'));
const MuscleExercisesPage = React.lazy(() => import('./MuscleExercisesPage'));
const EquipmentGuide = React.lazy(() => import('./EquipmentGuide'));
const ExerciseLibrary = React.lazy(() => import('./ExerciseLibrary'));

function Icon({ name, size = 20 }: { name: 'plus' | 'arrow' | 'link' | 'check' | 'clock' | 'external' | 'trash' | 'close' | 'chevron' | 'flag' | 'upload' | 'retry' | 'book'; size?: number }) {
  const paths: Record<typeof name, React.ReactNode> = {
    plus: <path d="M12 5v14M5 12h14" />, arrow: <path d="M4 12h15m-6-6 6 6-6 6" />,
    link: <><path d="m10 13 4-4m-6 6-1 1a4 4 0 0 1-6-6l4-4a4 4 0 0 1 6 0m2 2 1-1a4 4 0 0 1 6 6l-4 4a4 4 0 0 1-6 0" /></>,
    check: <path d="m5 12 4 4L19 6" />, clock: <><circle cx="12" cy="12" r="8" /><path d="M12 7v5l3 2" /></>,
    external: <><path d="M14 3h7v7m0-7L10 14M10 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-5" /></>,
    trash: <><path d="M3 6h18M9 6V3h6v3M6 6l1 15h10l1-15M10 10v7m4-7v7" /></>,
    close: <path d="m6 6 12 12M6 18 18 6" />, chevron: <path d="m6 9 6 6 6-6" />,
    flag: <><path d="M5 21V3m0 1c5-4 9 4 14 0v10c-5 4-9-4-14 0" /></>,
    upload: <><path d="M12 16V3m-5 5 5-5 5 5M4 15v5h16v-5" /></>,
    retry: <><path d="M3 10a9 9 0 1 1 2 8M3 4v6h6" /></>,
    book: <><path d="M12 5c-4-3-8-2-10-1v15c3-2 7-2 10 0 3-2 7-2 10 0V4c-2-1-6-2-10 1Zm0 0v14" /></>,
  };
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>;
}

const CLASSIFICATIONS: Record<Classification, { label: string; description: string; symbol: string }> = {
  agreement: { label: '观点一致', description: '核心结论相近', symbol: '=' },
  different_conditions: { label: '条件不同', description: '适用前提不同', symbol: '≈' },
  conflict: { label: '同条件分歧', description: '明确相同人群、目标与条件下存在分歧', symbol: '↔' },
  insufficient: { label: '证据不足', description: '原文不足以判断', symbol: '?' },
  different_topic: { label: '讨论不同', description: '实际回答了不同问题', symbol: '≠' },
};
const STATUS_LABEL: Record<Job['status'], string> = { queued: '等待处理', running: '正在对照', completed: '已完成', failed: '未完成', interrupted: '已中断' };
const SOURCE_LABEL = { pending: '等待获取', fetching: '获取文字中', ready: '文字已就绪', failed: '获取失败' };
const busyJob = (job: Job | null) => job?.status === 'running' || job?.status === 'queued';
function Alert({ children, tone = 'error' }: { children: React.ReactNode; tone?: 'error' | 'info' | 'success' }) { return <div className={`alert ${tone}`} role={tone === 'error' ? 'alert' : 'status'}>{children}</div>; }
function Spinner() { return <span className="spinner" aria-hidden="true" />; }
function VideoLink({ url, children, className = '' }: { url: string; children: React.ReactNode; className?: string }) {
  const href = safeVideoUrl(url);
  return href ? <a className={className} href={href} target="_blank" rel="noopener noreferrer">{children}<Icon name="external" size={14} /></a> : <span className={className}>{children}</span>;
}
type Draft = { key: number; text: string; video: Video | null; page: number; resolving: boolean; error: string };
const makeDraft = (key: number): Draft => ({ key, text: '', video: null, page: 0, resolving: false, error: '' });

function NewComparison({ onCreated, health }: { onCreated: (job: Job) => void; health: Health | null }) {
  const [drafts, setDrafts] = useState<Draft[]>([makeDraft(1), makeDraft(2)]);
  const [question, setQuestion] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const counter = useRef(2);
  const update = (key: number, change: Partial<Draft>) => setDrafts(items => items.map(item => item.key === key ? { ...item, ...change } : item));
  async function resolve(draft: Draft) {
    update(draft.key, { resolving: true, error: '', video: null, page: 0 });
    try {
      const video = await api<Video>('/videos/resolve', { method: 'POST', body: JSON.stringify({ text: draft.text }) });
      update(draft.key, { video, page: video.pages.length === 1 ? video.pages[0].page : 0, resolving: false });
    } catch (err) { update(draft.key, { error: errorText(err), resolving: false }); }
  }
  const complete = drafts.every(d => d.video && d.page && (d.video.pages.find(p => p.page === d.page)?.duration ?? Infinity) <= 1200);
  const unique = new Set(drafts.map(d => `${d.video?.bvid}:${d.page}`)).size === drafts.length;
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!complete || !unique || !question.trim()) return;
    setSubmitting(true); setError('');
    try {
      const job = await api<Job>('/jobs', { method: 'POST', body: JSON.stringify({ question: question.trim(), sources: drafts.map(d => ({ url: d.video!.url, page: d.page })) }) });
      onCreated(job);
    } catch (err) { setError(errorText(err)); } finally { setSubmitting(false); }
  }
  return <>
    <section className="hero">
      <div className="eyebrow"><span className="tiny-dot" /> 给收藏夹，一点思考的空间</div>
      <h1>收藏了很多观点，<br />它们<span className="green-underline">真的在打架吗？</span></h1>
      <p>放进 2–3 个 B 站视频，围绕一个问题对照。<br className="desktop-break" />分清结论、前提和语境，再回到原文自己判断。</p>
      <div className="hero-note"><span className="overlap-book"><Icon name="book" size={23} /></span><span>不急着站队，先把话听全。</span><span className="hand-arrow">↙</span></div>
      <div className="paper-graphic" aria-hidden="true"><div className="quote-sheet back"><span>一种观点</span><b>“ 是这样吗？ ”</b><i /></div><div className="quote-sheet front"><span>另一种视角</span><b>“ 要看前提。 ”</b><i /><i /></div><span className="graphic-spark">✳</span></div>
    </section>
    <form className="create-panel" onSubmit={submit}>
      <section className="form-section">
        <div className="section-heading"><div className="step">01</div><div><h2>把视频放在一起</h2><p>支持视频链接、b23 短链，或直接粘贴分享文字</p></div><span className="small-label">每段 ≤ 20 分钟</span></div>
        <div className="draft-list">{drafts.map((draft, index) => {
          const selected = draft.video?.pages.find(p => p.page === draft.page);
          const tooLong = !!selected && selected.duration > 1200;
          return <div className={`draft-card ${draft.video ? 'resolved' : ''}`} key={draft.key}>
            <div className="draft-title"><span className={`source-marker marker-${index}`}>{String.fromCharCode(65 + index)}</span><label htmlFor={`video-${draft.key}`}>视频 {index + 1}</label>{drafts.length > 2 && <button className="icon-button remove-source" type="button" onClick={() => setDrafts(items => items.filter(d => d.key !== draft.key))} aria-label={`移除视频 ${index + 1}`} disabled={submitting || draft.resolving}><Icon name="close" size={17} /></button>}</div>
            <div className="resolve-row"><textarea id={`video-${draft.key}`} value={draft.text} placeholder="粘贴 B 站视频链接或分享文字…" rows={2} maxLength={4000} disabled={submitting || draft.resolving} onChange={e => update(draft.key, { text: e.target.value, video: null, page: 0, error: '' })} /><button type="button" className="button secondary resolve-button" disabled={!draft.text.trim() || draft.resolving || submitting} onClick={() => resolve(draft)}>{draft.resolving ? <><Spinner />解析中</> : draft.video ? <><Icon name="check" size={16} />已识别</> : <><Icon name="link" size={16} />识别视频</>}</button></div>
            {draft.error && <Alert>{draft.error}</Alert>}
            {draft.video && <div className="resolved-video"><div><VideoLink url={selected?.url || draft.video.url} className="video-title">{draft.video.title}</VideoLink><p className="meta">UP 主 · {draft.video.author || '未说明'} <span>·</span> {draft.video.bvid}</p></div>{draft.video.pages.length > 1 ? <div className="part-control"><label htmlFor={`part-${draft.key}`}>这是合集，请明确选择一个分 P</label><select id={`part-${draft.key}`} value={draft.page} onChange={e => update(draft.key, { page: Number(e.target.value) })} disabled={submitting}><option value={0}>选择要对照的分 P</option>{draft.video.pages.map(page => <option value={page.page} key={page.page}>P{page.page} · {page.title}（{time(page.duration)}）</option>)}</select></div> : selected && <span className="duration"><Icon name="clock" size={14} />{time(selected.duration)}</span>}{selected && draft.video.pages.length > 1 && <p className="meta">已选 P{selected.page} · {time(selected.duration)}</p>}{tooLong && <Alert>这一段长于 20 分钟，请换一个较短的分 P 或视频。</Alert>}</div>}
          </div>;
        })}</div>
        {drafts.length < 3 && <button className="add-source" type="button" disabled={submitting} onClick={() => setDrafts(items => [...items, makeDraft(++counter.current)])}><Icon name="plus" size={17} />再加一个视频<span>最多 3 个</span></button>}
        {complete && !unique && <Alert>有重复的视频分 P，请选择不同的来源。</Alert>}
      </section>
      <section className="form-section question-section">
        <div className="section-heading"><div className="step">02</div><div><h2><label htmlFor="question">你想弄清楚什么？</label></h2><p>一个具体的问题，能让对照更有方向</p></div></div>
        <textarea className="question-input" id="question" rows={3} maxLength={2000} value={question} onChange={e => setQuestion(e.target.value)} disabled={submitting} placeholder="例如：对于刚开始健身的人，他们对训练频率的建议有什么不同？" required />
        <div className="question-hints"><span>试着比较：<b>适合谁</b> <b>什么条件下</b> <b>为什么</b></span><span>{question.length}/2000</span></div>
      </section>
      <div className="form-footer">{error && <Alert>{error}</Alert>}{health?.provider_ready === false && <Alert tone="info">分析服务尚未配置完成，请先由服务管理员完成模型配置。</Alert>}<div className="submit-row"><p><span className="tiny-dot" />观点解释由 AI 生成，引用可回看原文核对</p><button type="submit" className="button primary" disabled={!complete || !unique || !question.trim() || submitting}>{submitting ? <><Spinner />正在创建…</> : <>开始对照<Icon name="arrow" size={19} /></>}</button></div></div>
    </form>
    <section className="approach"><div><span>01 /</span><h3>回到原话</h3><p>关键判断附上引用和时间点，<br />从原视频核对语境。</p></div><div><span>02 /</span><h3>看清前提</h3><p>区分人群、目标和条件，<br />不把不同场景误认成矛盾。</p></div><div><span>03 /</span><h3>保留疑问</h3><p>没有足够证据时就说不确定，<br />结论留给你判断。</p></div></section>
  </>;
}

function SourceCard({ source, index, job, onJob }: { source: Source; index: number; job: Job; onJob: (job: Job) => void }) {
  const [uploading, setUploading] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  async function upload(file: File | undefined, input: HTMLInputElement) {
    if (!file) return;
    setError(''); setMessage('');
    if (file.size > 2 * 1024 * 1024) { setError('字幕文件需小于 2 MB。'); input.value = ''; return; }
    if (!/\.(srt|vtt|json)$/i.test(file.name)) { setError('请选择 SRT、VTT 或 JSON 字幕文件。'); input.value = ''; return; }
    const body = new FormData(); body.append('file', file);
    setUploading(true);
    try { onJob(await api<Job>(`/jobs/${encodeURIComponent(job.id)}/sources/${encodeURIComponent(source.id)}/subtitle`, { method: 'POST', body })); setMessage('字幕已保存，可点击「重新对照」继续。'); }
    catch (err) { setError(errorText(err)); } finally { setUploading(false); input.value = ''; }
  }
  const canUpload = job.status === 'failed' || job.status === 'interrupted';
  return <div className="job-source"><div className="job-source-top"><span className={`source-marker marker-${index}`}>{String.fromCharCode(65 + index)}</span><div className="source-info"><VideoLink url={source.url} className="video-title">{source.title}</VideoLink><p className="meta">{source.author || 'UP 主未说明'} · P{source.page} · {time(source.duration)}</p></div><span className={`source-status ${source.status}`}>{source.status === 'fetching' && <Spinner />}{source.status === 'ready' && <Icon name="check" size={14} />}{SOURCE_LABEL[source.status]}</span></div>{source.transcript_kind && <p className="transcript-kind">文字来源：{{ subtitle: '视频字幕', asr: '语音转写（可能存在识别误差）', uploaded: '手动上传的字幕' }[source.transcript_kind]}</p>}{source.error && <p className="source-error">{source.error}</p>}{canUpload && <div className="upload-area"><label className={`button small secondary upload-button ${uploading ? 'disabled' : ''}`}>{uploading ? <Spinner /> : <Icon name="upload" size={15} />}{uploading ? '正在上传…' : source.transcript_kind === 'uploaded' ? '替换字幕文件' : '上传字幕'}<input type="file" accept=".srt,.vtt,.json" disabled={uploading} onChange={e => void upload(e.target.files?.[0], e.target)} /></label><span>SRT / VTT / JSON · ≤ 2 MB</span></div>}{error && <Alert>{error}</Alert>}{message && <Alert tone="success">{message}</Alert>}</div>;
}

function Quote({ evidence, source, onReport }: { evidence: Evidence; source: Source | undefined; onReport: (note: string) => void }) {
  return <div className="evidence-block"><div className="evidence-label"><span>{source?.transcript_kind === 'asr' ? '机器转写片段' : '字幕原句'}</span><VideoLink url={evidence.url} className="time-link">{time(evidence.start)}–{time(evidence.end)}</VideoLink></div><blockquote>{evidence.text}</blockquote>{source?.transcript_kind === 'asr' && <p className="asr-caution">可能有识别误差，请回原视频核对</p>}<details className="context"><summary>展开前后文<Icon name="chevron" size={14} /></summary><div className="context-segments">{evidence.context?.length ? evidence.context.map(segment => <div key={segment.id} className={segment.id === evidence.segment_id ? 'active-segment' : ''}><span>{time(segment.start)}</span><p>{segment.text}</p></div>) : <p className="muted">该引用暂无更多上下文。</p>}</div><div className="context-footer"><span>{source?.title || '来源视频'} · {evidence.segment_id}</span><button className="text-button" type="button" onClick={() => onReport(`引用 ${evidence.segment_id}（${source?.title || evidence.source_id}，${time(evidence.start)}）存在问题：`)}><Icon name="flag" size={13} />引用有误</button></div></details></div>;
}

function EvidenceCollection({ evidence, source, onReport }: { evidence: Evidence[]; source: Source | undefined; onReport: (note: string) => void }) {
  const [open, setOpen] = useState(false);
  const [visible, setVisible] = useState(6);
  return <details className="evidence-collection" data-source-id={source?.id} onToggle={e => setOpen(e.currentTarget.open)}>
    <summary><span>查看依据 · {evidence.length} 个片段</span><span className="evidence-kind">{source?.transcript_kind === 'asr' ? '机器转写' : '字幕'}</span><Icon name="chevron" size={15} /></summary>
    {open && <div className="evidence-items">{evidence.slice(0, visible).map((item, index) => <Quote key={`${item.segment_id}-${index}`} evidence={item} source={source} onReport={onReport} />)}
      <div className="evidence-pagination"><span>已显示 {Math.min(visible, evidence.length)} / {evidence.length} 个片段</span>{visible < evidence.length && <button type="button" className="button secondary small" onClick={() => setVisible(count => count + 6)}>继续显示 {Math.min(6, evidence.length - visible)} 个<Icon name="chevron" size={14} /></button>}</div>
    </div>}
  </details>;
}

function ComparisonCard({ comparison, sources, index, expanded, onToggle, onReport }: { comparison: Comparison; sources: Source[]; index: number; expanded: boolean; onToggle: (open: boolean) => void; onReport: (kind: 'comparison' | 'citation', note: string) => void }) {
  const classification = CLASSIFICATIONS[comparison.classification] || CLASSIFICATIONS.insufficient;
  return <article className="comparison-card" id={`comparison-${comparison.id}`}>
    <details className="comparison-disclosure" open={expanded} onToggle={e => onToggle(e.currentTarget.open)}>
      <summary className="comparison-summary">
        <div className="comparison-heading"><span className="comparison-number">{String(index + 1).padStart(2, '0')}</span><h3>{comparison.topic}</h3><span className={`classification ${comparison.classification}`}>{classification.symbol}<span>{classification.label}</span></span></div>
        <span className="comparison-prompt"><span>{expanded ? '收起这条对照' : '查看观点、条件和依据'}</span><Icon name="chevron" size={17} /></span>
      </summary>
      {expanded && <div className="comparison-body"><div className="inference"><span className="ai-label">AI 对照分析</span><p>{comparison.explanation}</p></div><div className="perspectives">{comparison.perspectives.map((perspective, pIndex) => {
        const sourceIndex = sources.findIndex(s => s.id === perspective.source_id);
        const source = sources[sourceIndex];
        return <section className="perspective" key={`${perspective.source_id}-${pIndex}`}><div className="perspective-heading"><span className={`source-marker marker-${Math.max(sourceIndex, 0)}`}>{sourceIndex >= 0 ? String.fromCharCode(65 + sourceIndex) : '?'}</span><span>{source?.title || '来源未找到'}</span></div><p className="statement">{perspective.statement}</p><dl className="conditions"><div><dt>面向人群</dt><dd>{perspective.audience || '未说明'}</dd></div><div><dt>讨论目标</dt><dd>{perspective.goal || '未说明'}</dd></div><div><dt>成立条件</dt><dd>{perspective.conditions || '未说明'}</dd></div><div><dt>局限说明</dt><dd>{perspective.limitations || '未说明'}</dd></div></dl>{perspective.evidence.length > 0 ? <EvidenceCollection evidence={perspective.evidence} source={source} onReport={note => onReport('citation', note)} /> : <div className="missing-evidence">未提供可定位的原文引用，请谨慎判断。</div>}</section>;
      })}</div><footer className="comparison-footer"><span>观点概括与条件归纳由 AI 生成，引用来自保存的字幕或转写。</span><button type="button" className="text-button" onClick={() => onReport('comparison', `对照「${comparison.topic}」存在问题：`)}><Icon name="flag" size={14} />反馈问题</button></footer></div>}
    </details>
  </article>;
}

function Overview({ text, comparisons }: { text: string; comparisons: Comparison[] }) {
  return <section className="overview compact-overview"><span className="eyebrow"><span className="tiny-dot" />先看整体 · AI 归纳</span><h2>这次比较，看清了什么？</h2>
    <div className="overview-counts" aria-label="本次对照分类">{(Object.keys(CLASSIFICATIONS) as Classification[]).map(key => {
      const count = comparisons.filter(c => c.classification === key).length;
      return count > 0 ? <span key={key} className={`overview-count ${key}`}><b>{count}</b> 项{CLASSIFICATIONS[key].label}</span> : null;
    })}</div>
    <details className="overview-disclosure"><summary><span className="overview-preview">{text}</span><span className="disclosure-action"><span className="when-collapsed">结论预览 · 展开全文与条件</span><span className="when-expanded">收起完整结论</span><Icon name="chevron" size={15} /></span></summary><p className="overview-full">{text}</p></details>
    <div className="overview-footnote">归纳依据保存的文字，不代表对训练观点的事实裁决。</div>
  </section>;
}

function ReviewPanel({ comparisons, onOpen }: { comparisons: Comparison[]; onOpen: (id: string) => void }) {
  // Surface only explicit model review markers; do not guess or correct ASR terms.
  const flagged = comparisons.filter(c => /待核对|待复听/.test([c.explanation, ...c.perspectives.flatMap(p => [p.statement, p.conditions, p.limitations])].join('\n')));
  if (!flagged.length) return null;
  return <details className="review-panel"><summary><span><Icon name="clock" size={17} />有 {flagged.length} 项含待核对提示</span><Icon name="chevron" size={16} /></summary><div className="review-panel-body"><p>这些条目的 AI 归纳标注了待核对内容。点开对应条目，再从证据时间回看原片；提示不代表已确认转写有误。</p><ul>{flagged.map(c => <li key={c.id}><button type="button" onClick={() => onOpen(c.id)}>{c.topic}<Icon name="arrow" size={15} /></button></li>)}</ul></div></details>;
}

function FeedbackForm({ jobId, initial, onClose }: { jobId: string; initial: { kind: 'comparison' | 'citation'; note: string }; onClose: () => void }) {
  const [kind, setKind] = useState(initial.kind);
  const [note, setNote] = useState(initial.note);
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState('');
  const ref = useRef<HTMLTextAreaElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => { const previous = document.activeElement as HTMLElement | null; ref.current?.focus(); return () => previous?.focus(); }, []);
  async function submit(e: React.FormEvent) { e.preventDefault(); if (!note.trim()) return; setSending(true); setError(''); try { await api(`/jobs/${encodeURIComponent(jobId)}/feedback`, { method: 'POST', body: JSON.stringify({ kind, note: note.trim() }) }); setSent(true); } catch (err) { setError(errorText(err)); } finally { setSending(false); } }
  return <div className="modal-backdrop" onClick={e => { if (e.target === e.currentTarget && !sending) onClose(); }} onKeyDown={e => { if (e.key === 'Escape' && !sending) onClose(); if (e.key === 'Tab') { const items = Array.from(e.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled), textarea, select')); const first = items[0], last = items[items.length - 1]; if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); } else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); } } }}><section className="modal" role="dialog" aria-modal="true" aria-labelledby="feedback-heading"><button type="button" className="icon-button modal-close" ref={closeRef} disabled={sending} onClick={onClose} aria-label="关闭反馈"><Icon name="close" /></button>{sent ? <div className="feedback-success"><span className="success-circle"><Icon name="check" size={26} /></span><h2 id="feedback-heading">反馈已保存</h2><p>谢谢你帮助发现问题。反馈不会自动改变当前结论。</p><button className="button primary" onClick={onClose} autoFocus>回到对照</button></div> : <form onSubmit={submit}><span className="eyebrow">让对照更可靠</span><h2 id="feedback-heading">哪里需要再看看？</h2><label htmlFor="feedback-kind">问题类型</label><select id="feedback-kind" value={kind} onChange={e => setKind(e.target.value as typeof kind)}><option value="comparison">观点对照有误</option><option value="citation">引用或时间点有误</option></select><label htmlFor="feedback-note">具体说明</label><textarea id="feedback-note" ref={ref} rows={5} value={note} maxLength={2000} onChange={e => setNote(e.target.value)} required placeholder="告诉我们哪处不准确，以及你看到的原文含义。" />{error && <Alert>{error}</Alert>}<button type="submit" className="button primary" disabled={sending || !note.trim()}>{sending ? <><Spinner />正在保存…</> : '提交反馈'}</button></form>}</section></div>;
}

function JobView({ job, onJob, pollError, onRefresh, refreshing }: { job: Job; onJob: (job: Job) => void; pollError: string; onRefresh: () => void; refreshing: boolean }) {
  const [retrying, setRetrying] = useState(false);
  const [error, setError] = useState('');
  const [feedback, setFeedback] = useState<{ kind: 'comparison' | 'citation'; note: string } | null>(null);
  const [filter, setFilter] = useState<Classification | 'all'>('all');
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  function toggleComparison(id: string, open: boolean) {
    setExpanded(current => {
      if (current.has(id) === open) return current;
      const next = new Set(current);
      open ? next.add(id) : next.delete(id);
      return next;
    });
  }
  function openComparison(id: string) {
    setFilter('all'); toggleComparison(id, true);
    requestAnimationFrame(() => document.getElementById(`comparison-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
  }

  const isBusy = busyJob(job);
  const canRetry = job.status === 'failed' || job.status === 'interrupted';
  async function retry() { setRetrying(true); setError(''); try { onJob(await api<Job>(`/jobs/${encodeURIComponent(job.id)}/retry`, { method: 'POST' })); } catch (err) { setError(errorText(err)); } finally { setRetrying(false); } }
  const comparisons = job.result?.comparisons || [];
  const shown = filter === 'all' ? comparisons : comparisons.filter(c => c.classification === filter);
  return <div className="job-view"><div className="page-eyebrow"><span className={`job-status ${job.status}`}>{isBusy && <Spinner />}{STATUS_LABEL[job.status]}</span><span>{new Date(job.created_at).toLocaleString('zh-CN', { month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</span><button className="text-button" onClick={onRefresh} disabled={refreshing}><Icon name="retry" size={14} />{refreshing ? '更新中' : '刷新'}</button></div>{job.result ? <><h1 className="completed-title">对照结果</h1><details className="question-disclosure"><summary><span className="question-label">比较的问题</span><span className="question-preview">{job.question}</span><Icon name="chevron" size={16} /></summary><p>{job.question}</p></details></> : <h1 className="job-question">{job.question}</h1>}<p className="job-intro">{job.sources.length} 个视频，一个问题。把结论放回各自的语境。</p>{pollError && <Alert>{pollError} <button type="button" className="text-button" onClick={onRefresh}>重试连接</button></Alert>}
    {(isBusy || canRetry) && <section className={`progress-panel ${canRetry ? 'has-error' : ''}`}><div className="progress-heading"><h2>{isBusy ? job.stage || '正在准备对照' : job.status === 'interrupted' ? '处理被中断了' : '这次对照还未完成'}</h2>{isBusy && <span>{Math.max(0, Math.min(100, Math.round(job.progress)))}%</span>}</div>{isBusy && <><div className="progress-track" role="progressbar" aria-label="对照处理进度" aria-valuenow={job.progress} aria-valuemin={0} aria-valuemax={100}><div style={{ width: `${Math.max(0, Math.min(100, job.progress))}%` }} /></div><p>正在获取文字并整理观点。耗时取决于视频和服务状态，你可以稍后从历史记录回来。</p></>}{canRetry && <><p>{job.error || '请查看下面的来源状态。可以补充字幕后继续。'}</p><div className="retry-row"><button type="button" className="button primary small" onClick={retry} disabled={retrying}>{retrying ? <Spinner /> : <Icon name="retry" size={16} />}{retrying ? '正在重试…' : '重新对照'}</button><span>已保存的字幕将继续使用</span></div></>}{error && <Alert>{error}</Alert>}</section>}
    <details className="sources-panel" open={isBusy || canRetry || undefined}><summary><span><Icon name="book" size={18} />对照来源<span className="count-pill">{job.sources.length}</span></span><span className="sources-summary">{job.sources.filter(s => s.status === 'ready').length} 个文字已就绪<Icon name="chevron" size={17} /></span></summary><div className="job-sources">{job.sources.map((source, index) => <SourceCard key={source.id} source={source} index={index} job={job} onJob={onJob} />)}</div></details>
    {job.status === 'completed' && !job.result && <Alert>任务标记为完成，但没有返回对照结果。请刷新检查或向管理员反馈。</Alert>}
    {job.result && <>
      <Overview text={job.result.overview} comparisons={comparisons} />
      <ReviewPanel comparisons={comparisons} onOpen={openComparison} />
      {job.result.open_questions.length > 0 && <details className="pending-panel"><summary><span>还有哪些条件需要确认<span className="count-pill">{job.result.open_questions.length}</span></span><Icon name="chevron" size={16} /></summary><ul>{job.result.open_questions.map((question, index) => <li key={index}>{question}</li>)}</ul></details>}
      <section className="results-section"><div className="results-title"><h2>按主题查看<span>{comparisons.length}</span></h2><button type="button" className="text-button collapse-comparisons" disabled={expanded.size === 0} onClick={() => setExpanded(new Set())}>收起已展开条目</button></div>
        <p className="result-reading-hint">先看主题与判断，需要时再展开完整分析、适用条件和原文依据。</p>
        <div className="filter-list" aria-label="按对照分类筛选"><button className={`filter-chip ${filter === 'all' ? 'selected' : ''}`} aria-pressed={filter === 'all'} onClick={() => setFilter('all')}>全部 {comparisons.length}</button>{(Object.keys(CLASSIFICATIONS) as Classification[]).map(key => <button key={key} className={`filter-chip ${key} ${filter === key ? 'selected' : ''}`} aria-pressed={filter === key} title={CLASSIFICATIONS[key].description} onClick={() => setFilter(key)}>{CLASSIFICATIONS[key].label}<span>{comparisons.filter(c => c.classification === key).length}</span></button>)}</div>
        {shown.length ? shown.map((comparison, index) => <ComparisonCard comparison={comparison} sources={job.sources} index={filter === 'all' ? index : comparisons.indexOf(comparison)} key={comparison.id} expanded={expanded.has(comparison.id)} onToggle={open => toggleComparison(comparison.id, open)} onReport={(kind, note) => setFeedback({ kind, note })} />) : <div className="empty-inline">{comparisons.length ? '这一类暂时没有对照项，试试其他分类。' : '没有形成可展示的对照项，请结合原文继续判断。'}</div>}
      </section>
      <div className="result-footer"><p>重要判断，请打开原视频再次核对。</p><button type="button" className="text-button" onClick={() => setFeedback({ kind: 'comparison', note: '' })}><Icon name="flag" size={15} />反馈对照问题</button></div><p className="model-note">{job.model && `分析模型：${job.model}`}{job.prompt_version && ` · 对照版本：${job.prompt_version}`}</p>
    </>}{feedback && <FeedbackForm jobId={job.id} initial={feedback} onClose={() => setFeedback(null)} />}
  </div>;
}

function History({ onOpen, activeId }: { onOpen: (job: Job) => void; activeId: string | null }) {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [opening, setOpening] = useState<string | null>(null);
  const load = useCallback(async () => { setLoading(true); setError(''); try { const response = await api<{ items: Job[] }>('/jobs'); setJobs(response.items); } catch (err) { setError(errorText(err)); } finally { setLoading(false); } }, []);
  useEffect(() => { void load(); }, [load]);
  async function remove(id: string) { setDeleting(true); setError(''); try { await api(`/jobs/${encodeURIComponent(id)}`, { method: 'DELETE' }); setJobs(items => items.filter(j => j.id !== id)); setDeleteId(null); } catch (err) { setError(errorText(err)); } finally { setDeleting(false); } }
  async function open(id: string) { setOpening(id); setError(''); try { onOpen(await api<Job>(`/jobs/${encodeURIComponent(id)}`)); } catch (err) { setError(errorText(err)); } finally { setOpening(null); } }
  return <section className="history-page"><div className="eyebrow">每一次认真想过的问题</div><div className="history-heading"><div><h1>历史记录</h1><p>重新打开对照，接着上一次的思考。</p></div><button className="button secondary small" type="button" disabled={loading} onClick={() => void load()}><Icon name="retry" size={16} />刷新</button></div>{error && <Alert>{error}</Alert>}{loading ? <div className="empty-state"><Spinner /><h2>正在找回你的对照…</h2></div> : jobs.length === 0 ? <div className="empty-state"><span className="empty-icon"><Icon name="book" size={38} /></span><h2>这里还没有对照</h2><p>从「新建对照」开始，把两个观点放在一起看看。</p></div> : <div className="history-list">{jobs.map(job => <article className={`history-card ${activeId === job.id ? 'current' : ''}`} key={job.id}><div className="history-card-meta"><span className={`job-status ${job.status}`}>{STATUS_LABEL[job.status]}</span><time dateTime={job.created_at}>{new Date(job.created_at).toLocaleString('zh-CN')}</time></div><button className="history-open" type="button" onClick={() => void open(job.id)} disabled={opening !== null}><h2>{job.question}</h2><span>{opening === job.id ? <Spinner /> : <Icon name="arrow" />}</span></button><div className="history-source-titles">{job.sources.map(source => source.title).join(' / ')}</div><div className="history-card-bottom"><span>{job.sources.length} 个视频{job.result ? ` · ${job.result.comparisons.length} 条对照` : ''}</span>{deleteId === job.id ? <div className="delete-confirm"><span>{busyJob(job) ? '取消任务并删除？' : '删除这条记录？'}</span><button type="button" className="text-button" disabled={deleting} onClick={() => setDeleteId(null)}>保留</button><button type="button" className="text-button danger" disabled={deleting} onClick={() => void remove(job.id)}>{deleting ? '删除中…' : '确认删除'}</button></div> : <button className="icon-button" type="button" aria-label={`删除对照：${job.question}`} onClick={() => setDeleteId(job.id)}><Icon name="trash" size={16} /></button>}</div></article>)}</div>}</section>;
}

function App() {
  const [view, setView] = useState<AppView>(() => readAppRoute(location.search).view);
  const [selectedMuscle, setSelectedMuscle] = useState<MuscleId | null>(() => readAppRoute(location.search).muscle);
  const [selectedEquipment, setSelectedEquipment] = useState<string | null>(() => readAppRoute(location.search).equipment || null);
  const [job, setJob] = useState<Job | null>(null);
  const [health, setHealth] = useState<Health | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [pollError, setPollError] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const jobRef = useRef(job); jobRef.current = job;
  const requestId = useRef(0);
  const openJob = useCallback((next: Job) => { requestId.current++; setJob(next); setView('job'); setLoadError(''); setPollError(''); setLoading(false); writeAppUrl('job', null, next.id); window.scrollTo({ top: 0, behavior: 'smooth' }); }, []);
  const loadJob = useCallback(async (id: string) => { const current = ++requestId.current; setLoading(true); setLoadError(''); setJob(null); setView('job'); try { const result = await api<Job>(`/jobs/${encodeURIComponent(id)}`); if (current === requestId.current) { setJob(result); setPollError(''); } } catch (err) { if (current === requestId.current) setLoadError(errorText(err)); } finally { if (current === requestId.current) setLoading(false); } }, []);
  useEffect(() => {
    void api<Health>('/health').then(setHealth).catch(() => undefined);
    const route = readAppRoute(location.search);
    if (route.jobId) void loadJob(route.jobId);
    const pop = () => { const next = readAppRoute(location.search); if (next.jobId) void loadJob(next.jobId); else { requestId.current++; setLoading(false); setLoadError(''); setPollError(''); setView(next.view); if (next.view === 'muscles') setSelectedMuscle(next.muscle); if (next.view === 'equipment') setSelectedEquipment(next.equipment || null); } };
    window.addEventListener('popstate', pop); return () => window.removeEventListener('popstate', pop);
  }, [loadJob]);
  useEffect(() => {
    if (!job || !busyJob(job) || view !== 'job') return;
    let disposed = false; let timer: ReturnType<typeof setTimeout>;
    async function poll() { try { const latest = await api<Job>(`/jobs/${encodeURIComponent(job!.id)}`); if (!disposed) { setJob(latest); setPollError(''); } } catch (err) { if (!disposed) setPollError(`暂时无法更新进度：${errorText(err)}`); } if (!disposed) timer = setTimeout(poll, 2500); }
    timer = setTimeout(poll, 2000); return () => { disposed = true; clearTimeout(timer); };
  }, [job?.id, job?.status, view]);
  async function refresh() { if (!jobRef.current) return; const id = jobRef.current.id; setRefreshing(true); try { const latest = await api<Job>(`/jobs/${encodeURIComponent(id)}`); if (jobRef.current?.id === id) { setJob(latest); setPollError(''); } } catch (err) { setPollError(errorText(err)); } finally { setRefreshing(false); } }
  function navigate(next: Section | 'history' | 'equipment') { requestId.current++; setLoading(false); setLoadError(''); setPollError(''); setView(next); writeAppUrl(next, next === 'muscles' ? selectedMuscle : null, null, next === 'equipment' ? selectedEquipment : null); window.scrollTo({ top: 0, behavior: 'instant' }); }
  function selectEquipment(id: string | null) { setSelectedEquipment(id); writeAppUrl('equipment', null, null, id); window.scrollTo({ top: 0, behavior: 'instant' }); }
  function confirmMuscle(id: MuscleId) { setSelectedMuscle(id); writeAppUrl('muscles', id); }
  function reselectMuscle() { setSelectedMuscle(null); writeAppUrl('muscles'); window.scrollTo({ top: 0, behavior: 'instant' }); }
  return <AppShell active={view === 'job' || view === 'history' ? 'new' : view === 'equipment' ? 'muscles' : view} onNavigate={navigate}><a className="skip-link" href="#main">跳到主要内容</a><main id="main" className={`main-container ${view === 'job' ? 'results-container' : ''}`}>{(view === 'muscles' || view === 'equipment') && <nav className="training-mode-tabs" aria-label="查找训练方式"><button type="button" className={view === 'muscles' ? 'active' : ''} aria-current={view === 'muscles' ? 'page' : undefined} onClick={() => navigate('muscles')}>按肌群选</button><button type="button" className={view === 'equipment' ? 'active' : ''} aria-current={view === 'equipment' ? 'page' : undefined} onClick={() => navigate('equipment')}>按器材选</button></nav>}{view === 'equipment' && <React.Suspense fallback={<div className="empty-state"><Spinner /><h2>正在打开器材指南…</h2></div>}><EquipmentGuide selected={selectedEquipment} onSelect={selectEquipment} /></React.Suspense>}{(view === 'new' || view === 'history' || view === 'job') && <nav className="video-workspace-tabs" aria-label="视频对照功能"><button type="button" className={view === 'new' ? 'active' : ''} aria-current={view === 'new' ? 'page' : undefined} onClick={() => navigate('new')}>新建对照</button><button type="button" className={view === 'history' ? 'active' : ''} aria-current={view === 'history' ? 'page' : undefined} onClick={() => navigate('history')}>对照历史</button></nav>}{view === 'favorites' && <React.Suspense fallback={<div className="empty-state"><Spinner /><h2>正在打开动作收藏…</h2></div>}><ExerciseLibrary /></React.Suspense>}{view === 'muscles' && <React.Suspense fallback={<div className="empty-state"><Spinner /><h2>{selectedMuscle ? '正在打开训练动作…' : '正在打开身体地图…'}</h2></div>}>{selectedMuscle ? <MuscleExercisesPage muscleId={selectedMuscle} onBack={reselectMuscle} /> : <MuscleExplorer onConfirm={confirmMuscle} />}</React.Suspense>}{view === 'new' && <NewComparison onCreated={openJob} health={health} />}{view === 'history' && <History onOpen={openJob} activeId={job?.id || null} />}{view === 'job' && (loading ? <div className="empty-state"><Spinner /><h2>正在打开这份对照…</h2></div> : loadError ? <div className="load-error"><Alert>{loadError}</Alert><button className="button secondary" onClick={() => { const id = new URLSearchParams(location.search).get('job'); if (id) void loadJob(id); }}>重新加载</button><button className="text-button" onClick={() => navigate('history')}>查看历史记录</button></div> : job ? <JobView key={job.id} job={job} onJob={setJob} pollError={pollError} onRefresh={() => void refresh()} refreshing={refreshing} /> : <div className="empty-state">请选择一条历史记录，或新建一个对照。</div>)}</main><footer className="site-footer"><span>收藏，不止于收藏。</span><span>原文有出处 · 判断有余地</span></footer></AppShell>;
}

createRoot(document.getElementById('root')!).render(<React.StrictMode><ExerciseProvider><App /></ExerciseProvider></React.StrictMode>);
