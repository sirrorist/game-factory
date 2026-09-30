// Каталог SQL-миграций - общий для прода (postgres) и тестов (PGlite). Отдельным модулем, не
// из index.ts: хаб импортирует index.ts, а Turbopack принимает `new URL(..., import.meta.url)`
// за ресурс сборки и валит `next build` на каталоге (П-045).
export const MIGRATIONS_DIR = new URL('../migrations', import.meta.url).pathname;
