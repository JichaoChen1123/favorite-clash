import { useEffect, useState } from 'react';
import { parseRestClock, remainingRest, type RestClock } from './training';
import { time } from './api';

export default function RestTimer({ trigger, resetToken }: { trigger: number; resetToken: number }) {
  const [clock, setClock] = useState<RestClock>(() => { try { return parseRestClock(localStorage.getItem('training-rest-clock')); } catch { return parseRestClock(null); } });
  const [duration, setDuration] = useState(() => { try { const value=localStorage.getItem('training-rest-duration')||'90'; return /^\d+$/.test(value)&&Number(value)>=15&&Number(value)<=600?value:'90'; } catch { return '90'; } });
  const [stamp, setStamp] = useState(Date.now());
  const [error, setError] = useState('');
  const remaining = remainingRest(clock, stamp);
  useEffect(() => { const timer = setInterval(() => setStamp(Date.now()), 500); return () => clearInterval(timer); }, []);
  useEffect(() => { try { localStorage.setItem('training-rest-clock', JSON.stringify(clock)); } catch { /* Current timer still works without storage. */ } }, [clock]);
  function start() {
    const seconds = Number(duration);
    if (!/^\d+$/.test(duration) || seconds < 15 || seconds > 600) { setError('休息时间请输入15–600秒。'); return; }
    setError(''); const now = Date.now(); setStamp(now); setClock({mode:'running',endAt:now+seconds*1000,pausedSeconds:0});
  }
  useEffect(() => { if (trigger > 0) start(); }, [trigger]);
  useEffect(() => { if (resetToken > 0) setClock({mode:'idle',endAt:0,pausedSeconds:0}); }, [resetToken]);
  useEffect(() => { if (/^\d+$/.test(duration)&&Number(duration)>=15&&Number(duration)<=600) try { localStorage.setItem('training-rest-duration',duration); } catch { /* Optional preference storage. */ } }, [duration]);
  const running = clock.mode === 'running' && remaining > 0;
  const ended = clock.mode === 'running' && remaining === 0;
  return <section className={`rest-timer ${ended ? 'is-ended' : ''}`} aria-label="组间休息计时"><div className="rest-timer-heading"><h2>组间休息</h2><span role="status">{ended ? '休息结束，可以继续下一组' : running ? '正在休息' : clock.mode === 'paused' ? '已暂停' : '完成一组后自动开始'}</span></div><div className="rest-timer-time" aria-label="休息剩余时间">{time(remaining)}</div>
    <div className="rest-duration"><label>休息秒数<input aria-label="休息秒数" type="text" inputMode="numeric" value={duration} onChange={event => setDuration(event.target.value)} maxLength={3} /></label>{[60,90,120].map(seconds => <button type="button" key={seconds} className={duration === String(seconds) ? 'active' : ''} onClick={() => setDuration(String(seconds))}>{seconds}秒</button>)}</div>
    <div className="rest-controls"><button className="button secondary small" onClick={start}>{running || ended ? '重新计时' : '开始计时'}</button>{running && <button className="button secondary small" onClick={() => setClock({mode:'paused',endAt:0,pausedSeconds:remainingRest(clock, Date.now())})}>暂停</button>}{clock.mode === 'paused' && <button className="button secondary small" onClick={() => { const now=Date.now(); setStamp(now); setClock({mode:'running',endAt:now+clock.pausedSeconds*1000,pausedSeconds:0}); }}>继续</button>}{clock.mode !== 'idle' && <button className="text-button" onClick={() => setClock({mode:'idle',endAt:0,pausedSeconds:0})}>清零</button>}</div>{error && <p className="training-error" role="alert">{error}</p>}<small>计时保存在当前浏览器；切回页面按剩余时间恢复。</small>
  </section>;
}
