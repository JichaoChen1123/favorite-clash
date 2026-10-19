import { useCallback, useEffect, useRef, useState } from 'react';
import { api, errorText } from './api';
import { useExercises, type Exercise } from './exercises';
import { ExerciseDetail } from './ExerciseLibrary';
import { draftExercises, trainingPayload, hasSetData, removeDraftExercise, removeDraftSet, trainingStats, type DraftExercise, type TrainingSession, type TrainingOverview, type LastExercise } from './training';
import RestTimer from './RestTimer';
import './training.css';

const date = (stamp: string) => new Date(stamp).toLocaleString('zh-CN', {month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit',hour12:false});
const blankSet = () => ({id:crypto.randomUUID(),weight:'',reps:'',completed:false});
type Confirmation = {kind:'reload'} | {kind:'cancel'} | {kind:'exercise';exerciseId:string;name:string} | {kind:'set';exerciseId:string;setId:string;name:string;number:number};

function ConfirmTraining({action,pending,onConfirm,onClose}: {action:Confirmation;pending:boolean;onConfirm:()=>void;onClose:()=>void}) {
  const dialog=useRef<HTMLDialogElement>(null);
  useEffect(()=>{const node=dialog.current!;const overflow=document.body.style.overflow;const previousFocus=document.activeElement;node.showModal();document.body.style.overflow='hidden';return()=>{node.close();document.body.style.overflow=overflow;if(previousFocus instanceof HTMLElement&&previousFocus.isConnected)previousFocus.focus({preventScroll:true});};},[]);
  const text=action.kind==='reload'?'重新读取会替换当前未保存的修改，是否继续？':action.kind==='cancel'?'已保存的内容仍会保留在历史中，未保存的修改会舍弃。':action.kind==='exercise'?`「${action.name}」已有填写内容，移除会从当前草稿中删掉这个动作及各组记录。确认后请保存记录。`:`「${action.name}」第${action.number}组已有填写内容，删除会移除这一组的记录。确认后请保存记录。`;
  const label=action.kind==='reload'?'确认重新读取':action.kind==='cancel'?'确认取消训练':action.kind==='exercise'?'确认移除动作':'确认删除这组';
  return <dialog ref={dialog} className="training-picker training-confirm-dialog" aria-labelledby="training-confirm-title" onCancel={event=>{event.preventDefault();if(!pending)onClose();}}><h2 id="training-confirm-title">{action.kind==='reload'?'重新读取记录':action.kind==='cancel'?'取消本次训练':action.kind==='exercise'?'移除训练动作':'删除训练组'}</h2><p>{text}</p><footer><button className="button secondary small" disabled={pending} onClick={onClose} autoFocus>保留当前修改</button><button className="button primary small" disabled={pending} onClick={onConfirm}>{label}</button></footer></dialog>;
}

function ChooseExercises({ excluded, onSubmit, onClose, pending }: { excluded: string[]; onSubmit: (ids: string[]) => void; onClose: () => void; pending: boolean }) {
  const {catalog,saved,favoritesReady,error,reload} = useExercises();
  const [tab,setTab] = useState<'saved'|'all'>('saved'); const [query,setQuery] = useState(''); const [selected,setSelected] = useState<string[]>([]);
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => { const node=dialog.current!; const overflow=document.body.style.overflow; node.showModal(); document.body.style.overflow='hidden'; return () => {node.close();document.body.style.overflow=overflow;}; }, []);
  const items = catalog?.items.filter(item => !excluded.includes(item.id) && (tab === 'all' || saved.has(item.id)) && item.name.includes(query.trim())) || [];
  return <dialog ref={dialog} className="training-picker" aria-labelledby="training-picker-title" onCancel={event => {event.preventDefault();if(!pending)onClose();}}><header><h2 id="training-picker-title">选择本次训练动作</h2><button className="icon-button" aria-label="关闭训练动作选择" disabled={pending} onClick={onClose} autoFocus>×</button></header><div className="training-tabs"><button className={tab==='saved'?'active':''} onClick={()=>setTab('saved')}>我的收藏</button><button className={tab==='all'?'active':''} onClick={()=>setTab('all')}>全部动作</button></div><label className="training-search">查找动作<input aria-label="查找训练动作" value={query} onChange={event=>setQuery(event.target.value)} placeholder="输入动作名称" /></label>
    {!catalog ? <p role="alert">{error || '正在读取动作库…'}<button className="text-button" onClick={reload}>重新加载</button></p> : tab==='saved'&&!favoritesReady ? <p>收藏暂未读完，可切到全部动作选择。</p> : items.length ? <div className="training-pick-list">{items.map(item => <label key={item.id}><input type="checkbox" checked={selected.includes(item.id)} disabled={pending || (!selected.includes(item.id)&&selected.length+excluded.length>=30)} onChange={event=>setSelected(current=>event.target.checked?[...current,item.id]:current.filter(id=>id!==item.id))} /><span><b>{item.name}</b><small>{item.requires}</small></span></label>)}</div> : <p className="training-muted">{tab==='saved'?'暂时没有可选收藏，试试全部动作。':'没有匹配的动作，或已经添加。'}</p>}
    <footer><span>已选 {selected.length} 个</span><button className="button primary small" disabled={pending||!selected.length} onClick={()=>onSubmit(selected)}>{pending?'保存中…':excluded.length?'添加到本次训练':'开始训练'}</button></footer></dialog>;
}

function LastRecord({item}: {item: LastExercise | undefined}) { return <p className="training-last">{item ? <>上次 · {date(item.ended_at)}<span>{item.sets.map(s=>`${s.weight_kg}kg × ${s.reps}次`).join(' · ')}</span></> : '还没有该动作的已完成记录'}</p>; }

function WorkoutSummary({session}: {session:TrainingSession}) {
  const stats=trainingStats(session);const seconds=stats.elapsedSeconds;
  const duration=seconds===null?'未记录':seconds<60?`${seconds}秒`:seconds<3600?`${Math.floor(seconds/60)}分${seconds%60}秒`:`${Math.floor(seconds/3600)}小时${Math.floor(seconds%3600/60)}分`;
  return <section className="training-summary" aria-label="训练小结"><h2>{session.status==='completed'?'训练完成，收好这次进步':'本次训练记录'}</h2><dl><div><dt>已练动作</dt><dd>{stats.exerciseCount}<small>个</small></dd></div><div><dt>完成组数</dt><dd>{stats.completedSets}<small>组</small></dd></div><div><dt>记录时长</dt><dd className="training-duration">{duration}</dd></div></dl><p>按勾选完成的组统计；时长为开始至结束的间隔，包含休息。</p></section>;
}

export default function TrainingPage({visible}: {visible: boolean}) {
  const library=useExercises(); const [overview,setOverview]=useState<TrainingOverview|null>(null); const [active,setActive]=useState<TrainingSession|null>(null); const [draft,setDraft]=useState<DraftExercise[]>([]);
  const [dirty,setDirty]=useState(false); const [pending,setPending]=useState(false); const [loading,setLoading]=useState(true); const [error,setError]=useState(''); const [notice,setNotice]=useState('');
  const [confirmation,setConfirmation]=useState<Confirmation|null>(null);const [teaching,setTeaching]=useState<Exercise|null>(null);
  const [tab,setTab]=useState<'active'|'history'>('active'); const [chooser,setChooser]=useState(false); const [detail,setDetail]=useState<TrainingSession|null>(null); const [historyLoading,setHistoryLoading]=useState(false); const [restTrigger,setRestTrigger]=useState(0); const [resetTimer,setResetTimer]=useState(0);
  const guard=useRef({dirty,pending}); guard.current={dirty,pending}; const sequence=useRef(0); const historySequence=useRef(0); const createId=useRef<string|null>(null);
  const load=useCallback(async(force=false)=>{
    if(!force&&(guard.current.dirty||guard.current.pending))return;
    const request=++sequence.current; setError(''); if(force)setLoading(true);
    try{const result=await api<TrainingOverview>('/training');if(request===sequence.current){setOverview(result);setActive(result.active);setDraft(result.active?draftExercises(result.active):[]);setDirty(false);}}
    catch(err){if(request===sequence.current)setError(errorText(err));}finally{if(request===sequence.current)setLoading(false);}
  },[]);
  useEffect(()=>{if(visible)void load();else{setTeaching(null);setConfirmation(null);setChooser(false);}},[visible,load]);
  useEffect(()=>{const focus=()=>{if(visible&&document.visibilityState==='visible')void load();};window.addEventListener('focus',focus);document.addEventListener('visibilitychange',focus);return()=>{window.removeEventListener('focus',focus);document.removeEventListener('visibilitychange',focus);};},[visible,load]);
  useEffect(()=>{const unload=(event:BeforeUnloadEvent)=>{if(guard.current.dirty){event.preventDefault();event.returnValue='';}};window.addEventListener('beforeunload',unload);return()=>window.removeEventListener('beforeunload',unload);},[]);
  function edit(next:DraftExercise[]){++sequence.current;setDraft(next);setDirty(true);setNotice('');setError('');}
  async function save(next=draft,status:TrainingSession['status']='active',startRest=false){
    if(!active||pending)return;let exercises;try{exercises=trainingPayload(next);if(status==='completed'&&!exercises.some(x=>x.sets.some(s=>s.completed)))throw new Error('请至少勾选一组完成的训练，再结束保存。');}catch(err){setError(errorText(err));return;}
    ++sequence.current;setPending(true);setError('');
    try{
      const result=await api<TrainingSession>(`/training/${active.id}`,{method:'PUT',body:JSON.stringify({version:active.version,status,exercises})});
      setDirty(false);setDraft(draftExercises(result));setActive(result.status==='active'?result:null);setNotice(status==='active'?'记录已保存':status==='completed'?'本次训练已完成并保存到历史':'本次训练已取消，记录保留在历史');
      if(startRest)setRestTrigger(x=>x+1);
      if(status!=='active'){setResetTimer(x=>x+1);setDetail(result);setTab('history');await load(true);window.scrollTo({top:0,behavior:'instant'});}
      return true;
    }catch(err){setError(`保存未确认，当前输入仍保留。${errorText(err)}`);return false;}finally{setPending(false);}
  }
  async function choose(ids:string[]){
    if(active){const existing=new Set(draft.map(item=>item.exercise_id));const added=[...new Set(ids)].filter(id=>!existing.has(id)).map(id=>{const item=library.catalog!.items.find(x=>x.id===id)!;return{exercise_id:id,name:item.name,equipment:item.equipment,sets:[blankSet(),blankSet(),blankSet()]};});setChooser(false);if(!added.length)return;const next=[...draft,...added];edit(next);await save(next);return;}
    ++sequence.current;setPending(true);setError('');createId.current ||= crypto.randomUUID();
    try{const result=await api<TrainingSession>('/training',{method:'POST',body:JSON.stringify({id:createId.current,exercise_ids:ids})});setActive(result.status==='active'?result:null);setDraft(result.status==='active'?draftExercises(result):[]);setDirty(false);setChooser(false);createId.current=null;setNotice(result.status==='active'?'训练已开始。填写后保存，勾选完成会自动保存并开始休息。':'这次训练已结束，请重新开始一次训练。');}
    catch(err){setChooser(false);setError(errorText(err));}finally{setPending(false);}
  }
  function complete(exerciseIndex:number,setIndex:number,value:boolean){const next=draft.map((item,i)=>i!==exerciseIndex?item:{...item,sets:item.sets.map((set,j)=>j!==setIndex?set:{...set,completed:value,weight:value&&item.equipment==='bodyweight'&&!set.weight?'0':set.weight})});try{trainingPayload(next);}catch(err){setError(errorText(err));return;}edit(next);void save(next,'active',value);}
  async function readHistory(id:string){const request=++historySequence.current;setHistoryLoading(true);setError('');try{const record=await api<TrainingSession>(`/training/${id}`);if(request===historySequence.current)setDetail(record);}catch(err){if(request===historySequence.current)setError(errorText(err));}finally{if(request===historySequence.current)setHistoryLoading(false);}}
  function requestRemoval(item:DraftExercise,setId?:string){
    if(setId){const index=item.sets.findIndex(set=>set.id===setId);if(index<0)return;if(hasSetData(item.sets[index])){setConfirmation({kind:'set',exerciseId:item.exercise_id,setId,name:item.name,number:index+1});return;}}
    else if(item.sets.some(hasSetData)){setConfirmation({kind:'exercise',exerciseId:item.exercise_id,name:item.name});return;}
    remove(item.exercise_id,setId);
  }
  function remove(exerciseId:string,setId?:string){try{edit(setId?removeDraftSet(draft,exerciseId,setId):removeDraftExercise(draft,exerciseId));setNotice('已从草稿移除，请保存记录。');}catch(err){setError(errorText(err));}}
  function confirmAction(){const action=confirmation;setConfirmation(null);if(!action)return;if(action.kind==='reload')void load(true);else if(action.kind==='cancel'&&active)void save(draftExercises(active),'cancelled');else if(action.kind==='exercise')remove(action.exerciseId);else if(action.kind==='set')remove(action.exerciseId,action.setId);}
  function openTeaching(id:string){const item=library.catalog?.items.find(x=>x.id===id);if(item)setTeaching(item);else setError('动作教学暂时没有读到，请重新加载动作库后再试。');}
  return <section className="training-page">
    <header className="training-heading"><span className="eyebrow"><span className="tiny-dot" /> 把想练的，变成练过的</span><h1>训练</h1><p>记录每一组，下次从上次的表现继续。</p></header>
    <div className="training-tabs" aria-label="训练功能"><button className={tab==='active'?'active':''} onClick={()=>{++historySequence.current;setHistoryLoading(false);setTab('active');setDetail(null);}}>正在训练</button><button className={tab==='history'?'active':''} onClick={()=>setTab('history')}>训练历史</button></div>
    {error&&<div className="training-error" role="alert">{error}<button className="text-button" disabled={pending} onClick={()=>{if(dirty)setConfirmation({kind:'reload'});else void load(true);}}>重新读取服务器记录</button></div>}
    {!library.catalog&&library.error&&<div className="training-error" role="alert">{library.error}<button className="text-button" onClick={library.reload}>重新加载动作库</button></div>}
    {notice&&<p className="training-notice" role="status">{notice}</p>}
    <div hidden={tab!=='active'}><RestTimer trigger={restTrigger} resetToken={resetTimer} /></div>
    {loading?<p role="status">正在读取训练记录…</p>:!overview?<div className="exercise-empty"><h2>训练记录暂时没有打开</h2><button className="button secondary small" onClick={()=>void load(true)}>重新加载训练记录</button></div>:tab==='active'?<div className="training-workspace"><div className="training-log">{active?<>
      <div className="training-session-bar"><div><h2>本次训练</h2><p>{date(active.created_at)} 开始 · {draft.length} 个动作</p></div><span className={dirty?'training-unsaved':'training-saved'}>{pending?'保存中…':dirty?'有未保存的修改':'已保存'}</span></div><p className="training-help">填写后点保存；勾选完成会自动保存。重量单位为kg，哑铃按单只、器械按标注、徒手填0。</p>
      {draft.map((item,i)=><article className="training-exercise" key={item.exercise_id}>
        <div className="training-exercise-heading"><h3><button className="training-teaching-title" disabled={pending} onClick={()=>openTeaching(item.exercise_id)} aria-label={`查看${item.name}教学`}>{item.name}<small>查看教学 ↗</small></button></h3><button className="text-button training-remove-exercise" disabled={pending||draft.length===1} title={draft.length===1?'至少保留一个动作；不再训练可取消本次训练':'从本次训练移除'} onClick={()=>requestRemoval(item)} aria-label={`移除${item.name}`}>移除动作</button></div>
        <LastRecord item={overview.last_exercises[item.exercise_id]} />
        <fieldset disabled={pending}><legend className="sr-only">{item.name}训练记录</legend><table className="training-set-table"><thead><tr><th>组</th><th>重量 kg</th><th>次数</th><th>完成</th></tr></thead><tbody>{item.sets.map((set,j)=><tr className={set.completed?'is-completed':''} key={set.id}>
          <td><span>{j+1}</span><button className="training-delete-set" aria-label={`删除${item.name}第${j+1}组`} title={item.sets.length===1?'至少保留一组':'删除这一组'} disabled={item.sets.length===1} onClick={()=>requestRemoval(item,set.id)}>×</button></td>
          <td><input aria-label={`${item.name}第${j+1}组重量`} type="text" inputMode="decimal" value={set.weight} placeholder={item.equipment==='bodyweight'?'0':'—'} maxLength={10} onChange={event=>edit(draft.map((x,xi)=>xi!==i?x:{...x,sets:x.sets.map((s,si)=>si!==j?s:{...s,weight:event.target.value})}))} /></td>
          <td><input aria-label={`${item.name}第${j+1}组次数`} type="text" inputMode="numeric" value={set.reps} placeholder="—" maxLength={4} onChange={event=>edit(draft.map((x,xi)=>xi!==i?x:{...x,sets:x.sets.map((s,si)=>si!==j?s:{...s,reps:event.target.value})}))} /></td>
          <td><input aria-label={`完成${item.name}第${j+1}组`} type="checkbox" checked={set.completed} onChange={event=>complete(i,j,event.target.checked)} /></td>
        </tr>)}</tbody></table><button className="text-button training-add-set" disabled={item.sets.length>=20} onClick={()=>edit(draft.map((x,index)=>index!==i?x:{...x,sets:[...x.sets,blankSet()]}))}>＋ 添加一组</button></fieldset>
      </article>)}
      <div className="training-save-bar"><button className="button secondary small" disabled={pending||draft.length>=30} onClick={()=>setChooser(true)}>添加动作</button><button className="button secondary small" disabled={pending||!dirty} onClick={()=>void save()}>保存记录</button><button className="button primary small" disabled={pending} onClick={()=>void save(draft,'completed')}>结束训练</button></div><button className="text-button training-cancel" disabled={pending} onClick={()=>setConfirmation({kind:'cancel'})}>取消本次训练</button>
    </>:<div className="exercise-empty"><h2>今天，开始练吧</h2><p>从收藏或动作库挑选动作，每组记录重量与次数。</p><button className="button primary" onClick={()=>setChooser(true)} disabled={pending||!library.catalog}>开始一次训练</button></div>}</div></div>:<section className="training-history">{historyLoading?<p role="status">正在打开训练详情…</p>:detail?<>
      <button className="button secondary small" onClick={()=>setDetail(null)}>← 返回训练历史</button><h2>{date(detail.created_at)} 的训练</h2><p className="training-muted">{detail.status==='completed'?'已完成':'已取消'} · {detail.ended_at?date(detail.ended_at):''}</p><WorkoutSummary session={detail} />
      {detail.exercises.map(item=><article className="training-exercise" key={item.exercise_id}><h3><button className="training-teaching-title" onClick={()=>openTeaching(item.exercise_id)} aria-label={`查看${item.name}教学`}>{item.name}<small>查看教学 ↗</small></button></h3>{item.sets.some(s=>s.completed)?<ol className="training-history-sets">{item.sets.map((s,index)=>s.completed?<li key={s.id}>第{index+1}组：{s.weight_kg} kg × {s.reps} 次</li>:null)}</ol>:<p className="training-muted">没有勾选完成的组</p>}</article>)}
    </>:overview.history.length?<><p className="training-muted">最近 {overview.history.length} 次训练</p>{overview.history.map(item=><button className="training-history-card" key={item.id} onClick={()=>void readHistory(item.id)}><span><b>{date(item.created_at)}</b><small>{item.exercise_count} 个动作 · {item.completed_sets} 组完成</small></span><span>{item.status==='completed'?'已完成':'已取消'} ↗</span></button>)}</>:<div className="exercise-empty"><h2>还没有训练历史</h2><p>结束一次训练后，这里会保存你的实际记录。</p></div>}</section>}
    {chooser&&visible&&<ChooseExercises excluded={active?draft.map(x=>x.exercise_id):[]} pending={pending} onClose={()=>setChooser(false)} onSubmit={ids=>void choose(ids)} />}
    {confirmation&&visible&&<ConfirmTraining action={confirmation} pending={pending} onClose={()=>setConfirmation(null)} onConfirm={confirmAction} />}
    {teaching&&visible&&<ExerciseDetail item={teaching} onClose={()=>setTeaching(null)} returnLabel="返回本次训练" />}
  </section>;
}
