// Этот скрипт не публикует образ; он разрешает только конкретный проверенный SHA.
import { readFile, appendFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

const denied = () => { throw new Error('Нет подтверждённого CI для публикации mail-relay'); };
const shaPattern = /^[0-9a-f]{40}$/;
const repoPattern = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;

export async function authorizeMailPublish({ eventName, event, repository, checkoutSha, ref, api }) {
  if (!repoPattern.test(repository ?? '') || !shaPattern.test(checkoutSha ?? '') ||
      event?.repository?.full_name !== repository) denied();
  let eventRunId;
  if (eventName === 'workflow_run') {
    const supplied = event.workflow_run;
    if (supplied?.head_branch !== 'main' || supplied.event !== 'push' ||
        supplied.conclusion !== 'success' || supplied.head_sha !== checkoutSha ||
        supplied.head_repository?.full_name !== repository || !Number.isSafeInteger(supplied.id) || supplied.id <= 0) denied();
    eventRunId = supplied.id;
  } else if (eventName === 'workflow_dispatch') {
    if (ref !== 'refs/heads/main') denied();
  } else denied();

  // Оба пути учитывают последний CI; старое событие не разрешает новую публикацию.
  const response = await api(`/repos/${repository}/actions/workflows/ci.yml/runs?branch=main&event=push&head_sha=${checkoutSha}&per_page=1`);
  const latest = response?.workflow_runs?.[0];
  if (!latest || !Number.isSafeInteger(latest.id) || latest.id <= 0 ||
      latest.head_sha !== checkoutSha || latest.status !== 'completed' || latest.conclusion !== 'success' ||
      (eventRunId !== undefined && latest.id !== eventRunId)) denied();
  const run = await api(`/repos/${repository}/actions/runs/${latest.id}`);
  const workflow = await api(`/repos/${repository}/actions/workflows/ci.yml`);
  if (!run || run.id !== latest.id ||
      !Number.isSafeInteger(workflow?.id) || run.workflow_id !== workflow.id ||
      !['.github/workflows/ci.yml', '.github/workflows/ci.yml@main'].includes(run.path) || run.head_branch !== 'main' ||
      run.event !== 'push' || run.status !== 'completed' || run.conclusion !== 'success' ||
      run.head_sha !== checkoutSha || run.repository?.full_name !== repository ||
      run.head_repository?.full_name !== repository) denied();
  const jobs = await api(`/repos/${repository}/actions/runs/${run.id}/jobs?filter=latest&per_page=100`);
  const smoke = jobs?.jobs?.filter((job) => job.name === 'mail-image');
  if (smoke?.length !== 1 || smoke[0].head_sha !== checkoutSha ||
      smoke[0].status !== 'completed' || smoke[0].conclusion !== 'success') denied();
  return checkoutSha;
}

async function main() {
  const event = JSON.parse(await readFile(process.env.GITHUB_EVENT_PATH, 'utf8'));
  const token = process.env.GITHUB_TOKEN;
  if (!token || process.env.GITHUB_API_URL !== 'https://api.github.com') denied();
  const api = async (path) => {
    const response = await fetch('https://api.github.com' + path, {
      headers: { authorization: 'Bearer ' + token, accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' },
      redirect: 'error', signal: AbortSignal.timeout(15000),
    });
    if (!response.ok) denied();
    return response.json();
  };
  const sha = await authorizeMailPublish({ eventName: process.env.GITHUB_EVENT_NAME, event,
    repository: process.env.GITHUB_REPOSITORY, checkoutSha: process.env.MAIL_CHECKOUT_SHA,
    ref: process.env.GITHUB_REF, api });
  await appendFile(process.env.GITHUB_OUTPUT, `sha=${sha}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(() => { console.error('Публикация mail-relay: проверка CI не пройдена'); process.exitCode = 1; });
}
