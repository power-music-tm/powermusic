import { fetchJson } from './api';

function sleep(ms) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

export async function fetchSubmissionJob(jobId) {
  return fetchJson(`/api/manager/submission-jobs/${jobId}`);
}

export async function waitForSubmissionJob(jobId, { maxAttempts = 90, intervalMs = 1000 } = {}) {
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const job = await fetchSubmissionJob(jobId);
    if (job.status === 'done') return job;
    if (job.status === 'failed') {
      throw new Error(job.error || 'Could not process your batch submission.');
    }
    await sleep(intervalMs);
  }
  throw new Error(
    'Your requests are still processing. Check Your requests in a minute.',
  );
}
