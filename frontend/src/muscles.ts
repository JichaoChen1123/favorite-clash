export const MUSCLES = [
  { id: 'chest', name: '胸部', region: '躯干', position: '胸前侧', members: '胸大肌的锁骨部、胸肋部与腹部', pattern: /pectoralis major/i },
  { id: 'shoulders', name: '肩部', region: '上肢', position: '肩部外侧与前后侧', members: '三角肌前束、中束与后束', pattern: /deltoid/i },
  { id: 'biceps', name: '肱二头肌', region: '上肢', position: '上臂前侧', members: '肱二头肌长头与短头', pattern: /biceps brachii/i },
  { id: 'triceps', name: '肱三头肌', region: '上肢', position: '上臂后侧', members: '肱三头肌长头、外侧头与内侧头', pattern: /triceps brachii/i },
  { id: 'forearms', name: '前臂', region: '上肢', position: '肘部至手腕之间', members: '肱桡肌、部分腕屈伸肌与旋前肌', pattern: /brachioradialis|(?:flexor|extensor) carpi|pronator teres|palmaris longus|extensor digitorum$|flexor digitorum superficialis/i },
  { id: 'abs', name: '腹部', region: '躯干', position: '腹前侧与两侧', members: '腹直肌与腹外斜肌', pattern: /rectus abdominis|external oblique/i },
  { id: 'lats', name: '背阔肌', region: '躯干', position: '背部两侧', members: '左右背阔肌', pattern: /latissimus dorsi/i },
  { id: 'upper-back', name: '肩背肌群', region: '躯干', position: '上背部与肩胛周围', members: '斜方肌、冈下肌、大圆肌与小圆肌', pattern: /trapezius|infraspinatus|teres major|teres minor/i },
  { id: 'glutes', name: '臀部', region: '下肢', position: '髋部后侧与外侧', members: '臀大肌与臀中肌', pattern: /gluteus maximus|gluteus medius/i },
  { id: 'quads', name: '股四头肌', region: '下肢', position: '大腿前侧', members: '股直肌、股外侧肌与股内侧肌', pattern: /rectus femoris|vastus lateralis|vastus medialis/i },
  { id: 'hamstrings', name: '腘绳肌', region: '下肢', position: '大腿后侧', members: '股二头肌长头、半腱肌与半膜肌', pattern: /biceps femoris|semitendinosus|semimembranosus/i },
  { id: 'inner-thigh', name: '大腿内侧', region: '下肢', position: '大腿内侧', members: '长收肌、大收肌、股薄肌与耻骨肌', pattern: /adductor longus|adductor magnus|gracilis|pectineus/i },
  { id: 'calves', name: '小腿', region: '下肢', position: '膝下至脚踝之间', members: '腓肠肌、比目鱼肌、胫骨前肌与腓骨肌', pattern: /gastrocnemius|soleus|tibialis anterior|fibularis/i },
] as const;

export type MuscleId = typeof MUSCLES[number]['id'];
export type Muscle = typeof MUSCLES[number];
export function getMuscle(id: string | null): Muscle | undefined { return MUSCLES.find(muscle => muscle.id === id); }
export function muscleForName(name: string): MuscleId | null { return MUSCLES.find(muscle => muscle.pattern.test(name))?.id || null; }
