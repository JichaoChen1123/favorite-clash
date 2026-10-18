export type EquipmentGuide = {
  id: string;
  name: string;
  english: string;
  aliases: string;
  introduction: string;
  recognize: string;
  before: string[];
  exerciseIds: readonly string[];
  example: string;
};

export const EQUIPMENT_GUIDES: readonly EquipmentGuide[] = [
  {
    id: 'dumbbells', name: '哑铃', english: 'Dumbbells', aliases: '自由重量 单只哑铃 双哑铃',
    introduction: '同一副哑铃可以练多个部位，关键在于选什么动作。',
    recognize: '中间是握柄，两端是配重；有固定重量和可调重量款。图示为固定重量哑铃。',
    before: ['选择能平稳控制的重量，先看对应动作的起始姿势。', '握稳握柄，确认身体两侧及头顶有动作需要的空间。', '卧推、划船等动作可能还需要训练凳；以具体动作的器材要求为准。'],
    exerciseIds: ['dumbbell-chest-press', 'dumbbell-bent-row', 'dumbbell-squat', 'dumbbell-calf-raise', 'dumbbell-lateral-raise', 'dumbbell-biceps-curl', 'dumbbell-lying-triceps-extension', 'dumbbell-wrist-curl'],
    example: 'dumbbell-lateral-raise',
  },
  {
    id: 'lat-pulldown', name: '高位下拉器械', english: 'Lat pulldown', aliases: '高拉 背阔肌下拉 高位滑轮',
    introduction: '坐稳后把头顶横杆拉向胸前，主要练背阔肌。',
    recognize: '座椅上方有横杆或握把，腿前有固定大腿的压垫，绳索从上方连接配重。',
    before: ['先调整腿部压垫，让坐姿稳定。', '确认横杆或握把可稳妥握持，再按动作教学准备起始位置。', '不同机器的握把和调节方式可能不同，以现场器械说明为准。'],
    exerciseIds: ['lat-pulldown'], example: 'lat-pulldown',
  },
  {
    id: 'chest-press', name: '坐姿推胸器械', english: 'Seated chest press', aliases: '器械卧推 胸推 推胸机',
    introduction: '背部靠稳，沿器械轨迹把握把向前推，主要练胸部。',
    recognize: '带靠背的座椅，胸前左右各有握把；动作方向是向前推出。',
    before: ['调整座椅，让握把位于肩部高度或略低处。', '背部贴稳靠垫，双脚踩稳，再确认可以控制动作幅度。', '把手轨迹可能随机器型号变化，不直接套用另一台机器的档位。'],
    exerciseIds: ['machine-chest-press'], example: 'machine-chest-press',
  },
  {
    id: 'seated-row', name: '坐姿绳索划船', english: 'Seated cable row', aliases: '低位划船 坐姿划船 低拉',
    introduction: '把前方握把拉向腰部，练习肩背与背阔肌发力。',
    recognize: '坐垫前方有脚踏，握把由前方低位绳索连接配重；与从头顶下拉的器械不同。',
    before: ['双脚放稳脚踏，握稳把手，保持膝部自然弯曲。', '调整坐姿，让身体可保持稳定，不靠前后摆动完成动作。', '握把可能为V形、横杆或分体把手，先查看对应变式。'],
    exerciseIds: ['seated-cable-row'], example: 'seated-cable-row',
  },
  {
    id: 'seated-leg-curl', name: '坐姿腿弯举器械', english: 'Seated leg curl', aliases: '腿后勾 腿弯曲 腘绳肌器械',
    introduction: '坐着屈膝，把小腿向后下方卷回，主要练大腿后侧。',
    recognize: '有靠背座椅、大腿固定垫和小腿滚垫；不是向前踢起小腿的腿屈伸器械。',
    before: ['调整靠背与滚垫，先看清机器的转轴和压垫位置。', '固定大腿并让小腿滚垫贴合，握稳扶手。', '先用可控幅度确认是屈膝卷回，再开始动作。'],
    exerciseIds: ['seated-leg-curl'], example: 'seated-leg-curl',
  },
  {
    id: 'hip-adduction', name: '腿内收器械', english: 'Hip adductor', aliases: '夹腿 内收机 坐姿内收 大腿内侧',
    introduction: '双腿向内合拢，主要练大腿内侧。先分清内收与外展模式。',
    recognize: '坐姿左右各有一块腿垫；内收时软垫位于膝部内侧。部分机器可切换内收和外展。',
    before: ['按现场说明切到内收模式，不把向外推的外展当成内收。', '从舒适的打开位置开始，双脚放稳踏板，握住扶手。', '退出时按器械说明释放调节装置；不同型号的旋钮和垫块结构不同。'],
    exerciseIds: ['machine-hip-adduction'], example: 'machine-hip-adduction',
  },
];

export type EquipmentGuideId = typeof EQUIPMENT_GUIDES[number]['id'];
export function getEquipmentGuide(id: string | null | undefined) { return EQUIPMENT_GUIDES.find(item => item.id === id); }
