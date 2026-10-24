import { chromium, BrowserContext } from "playwright";
import { getChromiumExecutablePath, DEFAULT_CONCURRENCY } from "./config.js";
import { ExamQuestion, ScrapeResult, ScrapeProgressCallback } from "./types.js";
import { scrapeSingleQuestion } from "./renderer.js";

let globalPauseUntil = 0;

async function waitIfPaused() {
  const now = Date.now();
  if (now < globalPauseUntil) {
    const diff = globalPauseUntil - now;
    await new Promise((r) => setTimeout(r, diff));
  }
}

function triggerPause(seconds: number) {
  const target = Date.now() + seconds * 1000;
  if (target > globalPauseUntil) {
    globalPauseUntil = target;
  }
}

export async function scrapeQuestionsConcurrent(
  questions: ExamQuestion[],
  examCode: string,
  examTitle: string,
  concurrency = DEFAULT_CONCURRENCY,
  onProgress?: ScrapeProgressCallback
): Promise<ScrapeResult> {
  const executablePath = getChromiumExecutablePath();
  const browser = await chromium.launch({
    headless: true,
    executablePath,
  });

  let saved = 0;
  let skipped = 0;
  let failed = 0;
  const errors: string[] = [];

  const queue = [...questions];
  const total = questions.length;
  let doneCount = 0;

  const contexts: BrowserContext[] = [];
  for (let i = 0; i < concurrency; i++) {
    contexts.push(await browser.newContext({ viewport: { width: 1200, height: 900 } }));
  }

  async function worker(context: BrowserContext) {
    while (true) {
      await waitIfPaused();
      let job: ExamQuestion | undefined;
      synchronized: {
        if (queue.length === 0) return;
        job = queue.shift();
      }
      if (!job) return;

      const result = await scrapeSingleQuestion(
        context,
        job,
        examCode,
        examTitle,
        (secs) => triggerPause(secs)
      );

      doneCount++;
      if (result.status === "saved") saved++;
      else if (result.status === "skipped") skipped++;
      else {
        failed++;
        if (result.error) errors.push(`Q${job.questionNumber}: ${result.error}`);
      }

      if (onProgress) {
        onProgress(doneCount, total, job, result.status);
      }
    }
  }

  await Promise.all(contexts.map((ctx) => worker(ctx)));
  await browser.close();

  return { saved, skipped, failed, errors };
}
