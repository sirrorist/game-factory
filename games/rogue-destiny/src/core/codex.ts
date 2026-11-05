/** Изученные правила мира сохраняются между забегами отдельно от состояния комнаты. */
export const CODEX = {
  spore_stalker: {title:'Споровый Ловчий',description:'Тонкий быстрый Сильван. Его когти повреждают Ядро даже через обычный блок. Идеальное парирование или уворот спасают от спор.'},
  thorn_guard: {title:'Терновый Панцирник',description:'Медленный тяжёлый Сильван. Не сбивайте его долгий замах: отойдите или парируйте и атакуйте в длинном восстановлении.'},
  sylvan_ciphers: { title: 'Шифры Сильванов', description: 'Знаки святилищ открывают рунические врата в следующих забегах.' },
  elemental_ward: { title: 'Перехваченный эфир', description: 'Идеальное парирование учит перенаправлять эфирные барьеры.' },
  true_sight: { title: 'Взгляд сквозь кошмар', description: 'После победы над Оракулом иллюзорные стены перестают скрывать путь.' },
  water_breathing: { title: 'Дыхание корней', description: 'Знание позволяет преодолевать затопленные сифоны.' },
} as const;
export type CodexEntry = keyof typeof CODEX;
export function parseCodex(value: unknown): CodexEntry[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter((key): key is CodexEntry => typeof key === 'string' && Object.hasOwn(CODEX, key)))];
}
export function learnCodex(progress: { codex: CodexEntry[] }, key: CodexEntry): boolean {
  if (progress.codex.includes(key)) return false;
  progress.codex.push(key); return true;
}
