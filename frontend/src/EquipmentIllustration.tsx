/** Original schematic drawings, not photos or recognition output. */
export default function EquipmentIllustration({ kind }: { kind: string }) {
  return <svg viewBox="0 0 240 150" fill="none" stroke="currentColor" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="equipment-illustration">
    <path d="M25 133h190" strokeWidth="1" opacity=".2" />
    {kind === 'dumbbells' ? <g transform="rotate(-18 120 75)"><path d="M82 74h76" strokeWidth="10" /><rect x="57" y="44" width="25" height="60" rx="5" /><rect x="158" y="44" width="25" height="60" rx="5" /><path d="M47 57v34m146-34v34" strokeWidth="8" /><path d="M101 69v10m12-10v10m13-10v10m13-10v10" strokeWidth="1" opacity=".4" /></g> : <>
      <path d="M178 130V25h-24m-8 105h47" />
      <rect x="166" y="69" width="24" height="49" rx="3" strokeWidth="2" />
      <path d="M168 80h20m-20 10h20m-20 10h20" strokeWidth="1" />
      {kind === 'lat-pulldown' ? <><path d="M178 25H78v24m-24 4 24-4 24 4" /><path d="M67 105h53m-42 0v25m31-25v25M67 88h35" strokeWidth="7" /><path d="M117 105v-9m-25-8v17" strokeWidth="3" /><path d="M78 58v16m-5-5 5 5 5-5" strokeWidth="2" opacity=".6" /></> : kind === 'chest-press' ? <><path d="M120 128V72m0 32H68m0-3V52m53 4 22-18m-22 18 7 29-18 8m-42-41 24-11 15 38-15 7" /><path d="M67 60v38m6 8h47" strokeWidth="9" /><path d="M130 104h21m-6-5 6 5-6 5" strokeWidth="2" opacity=".6" /></> : kind === 'seated-row' ? <><path d="M66 107h50m-41 0v23m30-23v23m37-20 10 20m-4-45v25m-18-22 27-13M178 25v79h-36l-31-14m-8-4 8 4-5 8" /><path d="M66 106h50" strokeWidth="9" /><path d="m132 72-19 1m5-5-5 5 5 5" strokeWidth="2" opacity=".6" /></> : kind === 'seated-leg-curl' ? <><path d="M68 60v43h58m-48 4v23m36-23v23m12-27 22 24m-22-39H92" /><path d="M68 61v35m4 8h51m-32-17h27m24 25-13 9" strokeWidth="9" /><path d="M152 98q5 18-8 28m-1-8 1 8 8-2" strokeWidth="2" opacity=".6" /></> : <><path d="M106 54v48m0 5v23m-8-21-39 17m50-17 39 17m-42-22-35-18m35 18 35-18" /><path d="M106 56v34m-18 14h36m-53-20-7 13m77-13 7 13" strokeWidth="8" /><path d="M65 67h20m-5-5 5 5-5 5m67-5h-20m5-5-5 5 5 5" strokeWidth="2" opacity=".6" /></>}
    </>}
  </svg>;
}
