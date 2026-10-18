export type TrainingSet = { id: string; weight_kg: number | null; reps: number | null; completed: boolean };
export type TrainingExercise = { exercise_id: string; name: string; equipment: string; sets: TrainingSet[] };
export type TrainingSession = { id: string; created_at: string; updated_at: string; ended_at: string | null; status: 'active' | 'completed' | 'cancelled'; version: number; exercises: TrainingExercise[] };
export type TrainingSummary = Omit<TrainingSession, 'exercises'> & { exercise_count: number; completed_sets: number };
export type LastExercise = { session_id: string; ended_at: string; name: string; sets: TrainingSet[] };
export type TrainingOverview = { active: TrainingSession | null; history: TrainingSummary[]; last_exercises: Record<string, LastExercise> };
export type DraftSet = { id: string; weight: string; reps: string; completed: boolean };
export type DraftExercise = Omit<TrainingExercise, 'sets'> & { sets: DraftSet[] };
export function draftExercises(session: TrainingSession): DraftExercise[] {
  return session.exercises.map(item => ({ ...item, sets: item.sets.map(set => ({ id:set.id, weight:set.weight_kg === null ? '' : String(set.weight_kg), reps:set.reps === null ? '' : String(set.reps), completed:set.completed })) }));
}
export const hasSetData = (set: DraftSet) => Boolean(set.completed || set.weight.trim() || set.reps.trim());
export function removeDraftExercise(draft: DraftExercise[], exerciseId: string) {
  const next = draft.filter(item => item.exercise_id !== exerciseId);
  if (!next.length) throw new Error('本次训练至少保留一个动作；不再训练时可取消本次训练。');
  return next;
}
export function removeDraftSet(draft: DraftExercise[], exerciseId: string, setId: string) {
  return draft.map(item => {
    if (item.exercise_id !== exerciseId) return item;
    const sets = item.sets.filter(set => set.id !== setId);
    if (!sets.length) throw new Error('每个动作至少保留一组；不练这个动作可移除动作。');
    return { ...item, sets };
  });
}
export function trainingStats(session: TrainingSession) {
  const practiced = session.exercises.filter(item => item.sets.some(set => set.completed));
  const start = Date.parse(session.created_at), end = Date.parse(session.ended_at || '');
  return {
    exerciseCount: practiced.length,
    completedSets: practiced.reduce((total, item) => total + item.sets.filter(set => set.completed).length, 0),
    elapsedSeconds: Number.isFinite(start) && Number.isFinite(end) && end >= start ? Math.floor((end-start)/1000) : null,
  };
}
export function trainingPayload(exercises: DraftExercise[]) {
  return exercises.map(item => ({ exercise_id:item.exercise_id, sets:item.sets.map((set, index) => {
    const weight = set.weight.trim(); const reps = set.reps.trim();
    if (weight && (!/^\d+(\.\d+)?$/.test(weight) || !Number.isFinite(Number(weight)) || Number(weight) > 2000)) throw new Error(`${item.name}第${index+1}组：重量需为0–2000之间的数字。`);
    if (reps && (!/^\d+$/.test(reps) || Number(reps) < 1 || Number(reps) > 1000)) throw new Error(`${item.name}第${index+1}组：次数需为1–1000之间的整数。`);
    if (set.completed && (!weight || !reps)) throw new Error(`${item.name}第${index+1}组：先填写重量和次数，再勾选完成；徒手重量填0。`);
    return {id:set.id, weight_kg:weight ? Number(weight) : null, reps:reps ? Number(reps) : null, completed:set.completed};
  }) }));
}
export type RestClock = { mode:'idle' | 'running' | 'paused'; endAt:number; pausedSeconds:number };
export function remainingRest(clock: RestClock, at: number) { return clock.mode === 'running' ? Math.max(0, Math.ceil((clock.endAt-at)/1000)) : clock.mode === 'paused' ? clock.pausedSeconds : 0; }
export function parseRestClock(value: string | null): RestClock {
  try { const clock = JSON.parse(value || 'null'); if (clock && ['idle','running','paused'].includes(clock.mode) && Number.isFinite(clock.endAt) && clock.endAt >= 0 && Number.isSafeInteger(clock.pausedSeconds) && clock.pausedSeconds >= 0 && clock.pausedSeconds <= 600) return clock; } catch { /* Fall back to an idle timer. */ }
  return {mode:'idle',endAt:0,pausedSeconds:0};
}
