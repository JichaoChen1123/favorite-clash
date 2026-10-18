import { useEffect, useRef } from 'react';
import { ExerciseBrowser } from './ExerciseLibrary';
import { getMuscle, type MuscleId } from './muscles';
import './muscle-actions.css';

export default function MuscleExercisesPage({ muscleId, onBack }: { muscleId: MuscleId; onBack: () => void }) {
  const heading = useRef<HTMLHeadingElement>(null);
  const muscle = getMuscle(muscleId)!;
  useEffect(() => { heading.current?.focus({ preventScroll: true }); }, [muscleId]);
  return <section className="muscle-action-page">
    <button type="button" className="button secondary small muscle-action-back" onClick={onBack}>← 返回肌群选择</button>
    <header className="muscle-action-heading"><h1 ref={heading} tabIndex={-1}>{muscle.name}训练动作</h1><p>选择手边的器材，查看教学，也可以收藏想练的动作。</p></header>
    <ExerciseBrowser key={muscleId} muscle={muscleId} hideHeading />
  </section>;
}
