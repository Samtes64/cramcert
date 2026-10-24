import fs from "fs";
import path from "path";
import { BrowserContext, Page } from "playwright";
import { SCRAPES_ROOT } from "./config.js";
import { ExamQuestion } from "./types.js";
import { getCandidateUrls } from "./catalog.js";

export function findExistingScreenshot(
  examCode: string,
  topic: number,
  questionNumber: number
): string | null {
  const cleanCode = examCode.toLowerCase().replace(/[^a-z0-9_-]/g, "-");

  const p1 = path.join(
    SCRAPES_ROOT,
    `${cleanCode}-topic-${topic}-question-${questionNumber}`,
    "screenshot.png"
  );
  if (fs.existsSync(p1) && fs.statSync(p1).size > 1000) return p1;

  const p2 = path.join(
    SCRAPES_ROOT,
    `${cleanCode}-question-${questionNumber}`,
    "screenshot.png"
  );
  if (fs.existsSync(p2) && fs.statSync(p2).size > 1000) return p2;

  return null;
}

export function getDestinationFolder(
  examCode: string,
  topic: number,
  questionNumber: number
): string {
  const cleanCode = examCode.toLowerCase().replace(/[^a-z0-9_-]/g, "-");
  return path.join(
    SCRAPES_ROOT,
    `${cleanCode}-topic-${topic}-question-${questionNumber}`
  );
}

export async function renderOfflineQuestion(
  page: Page,
  job: ExamQuestion,
  examTitle: string,
  targetPath: string
): Promise<boolean> {
  const q = job.rawData;
  if (!q || !q.question_text) return false;

  const choicesHtml = Object.entries(q.choices || {})
    .map(([letter, text]) => {
      const isCorrect = (q.answer || q.answer_ET || "").includes(letter);
      return `
        <div class="choice-item ${isCorrect ? "correct" : ""}">
          <span class="choice-letter">${letter}.</span>
          <span>${text}</span>
        </div>
      `;
    })
    .join("");

  const commentsHtml = (q.discussion || [])
    .map((c: any) => {
      const nestedHtml = (c.comments || [])
        .map((sub: any) => `
          <div class="nested-comment">
            <div class="comment-meta">
              <span class="comment-author">${sub.poster || "Member"}</span>
              <span class="comment-upvotes">👍 ${sub.upvote_count || 0}</span>
            </div>
            <div class="comment-body">${sub.content || ""}</div>
          </div>
        `)
        .join("");

      return `
        <div class="comment-card">
          <div class="comment-meta">
            <span class="comment-author">${c.poster || "Community Member"}</span>
            <span class="comment-upvotes">👍 ${c.upvote_count || 0}</span>
          </div>
          <div class="comment-body">${c.content || ""}</div>
          ${nestedHtml}
        </div>
      `;
    })
    .join("");

  const qImagesHtml = (q.question_images || [])
    .map((img: string) => `<div style="text-align:center; margin-bottom:16px;"><img src="${img}" style="max-width:100%; border-radius:4px;" onerror="this.style.display='none'" /></div>`)
    .join("");

  const html = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <style>
        body { margin: 0; padding: 20px; background: #f4f6f9; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif; color: #212529; }
        .sec-spacer { max-width: 1050px; margin: 0 auto; background: #ffffff; border: 1px solid #dcdfe6; border-radius: 8px; box-shadow: 0 4px 12px rgba(0,0,0,0.05); overflow: hidden; }
        .header { background: #007bff; color: #ffffff; padding: 16px 24px; display: flex; justify-content: space-between; align-items: center; }
        .header h2 { margin: 0; font-size: 20px; font-weight: 700; }
        .badge-topic { background: #ffffff; color: #007bff; padding: 4px 12px; border-radius: 12px; font-weight: 600; font-size: 14px; }
        .content { padding: 24px; }
        .question-text { font-size: 16px; font-weight: 600; line-height: 1.6; margin-bottom: 24px; white-space: pre-wrap; }
        .choice-list { margin-bottom: 24px; }
        .choice-item { padding: 12px 16px; margin-bottom: 10px; border: 1px solid #e2e8f0; border-radius: 6px; background: #ffffff; font-size: 15px; line-height: 1.5; display: flex; }
        .choice-item.correct { border-color: #28a745; background: #f0fff4; font-weight: 600; }
        .choice-letter { font-weight: 700; color: #007bff; margin-right: 12px; min-width: 24px; }
        .solution-box { border-left: 4px solid #28a745; background: #e8f5e9; padding: 16px 20px; border-radius: 4px; margin-bottom: 28px; }
        .solution-title { font-size: 16px; font-weight: 700; color: #2e7d32; display: flex; justify-content: space-between; align-items: center; }
        .solution-badge { background: #28a745; color: white; padding: 4px 10px; border-radius: 4px; font-size: 14px; }
        .community-vote { color: #555; font-size: 13px; font-weight: normal; }
        .solution-desc { margin-top: 10px; font-size: 14px; color: #333; white-space: pre-wrap; }
        .discussion-section { border-top: 2px solid #e2e8f0; padding-top: 20px; margin-top: 20px; }
        .discussion-header { font-size: 18px; font-weight: 700; color: #1a202c; margin-bottom: 16px; }
        .comment-card { border: 1px solid #edf2f7; border-radius: 6px; padding: 16px; margin-bottom: 12px; background: #fafbfc; }
        .comment-meta { display: flex; justify-content: space-between; margin-bottom: 8px; font-size: 13px; color: #718096; }
        .comment-author { font-weight: 700; color: #2d3748; }
        .comment-upvotes { background: #edf2f7; padding: 2px 8px; border-radius: 10px; font-weight: 600; }
        .comment-body { font-size: 14px; line-height: 1.5; color: #2d3748; white-space: pre-wrap; }
        .nested-comment { margin-top: 12px; padding-left: 16px; border-left: 2px solid #cbd5e0; }
      </style>
    </head>
    <body>
      <div class="sec-spacer">
        <div class="header">
          <h2>Question #${job.questionNumber}</h2>
          <span class="badge-topic">Topic ${job.topic}</span>
        </div>
        <div class="content">
          <div class="question-text">${q.question_text}</div>
          ${qImagesHtml}
          <div class="choice-list">${choicesHtml}</div>
          
          <div class="solution-box">
            <div class="solution-title">
              <span>✓ Correct Answer: <span class="solution-badge">${q.answer || q.answer_ET || ""}</span></span>
              ${q.answers_community?.length ? `<span class="community-vote">Community Vote: <strong>${q.answers_community.join(", ")}</strong></span>` : ""}
            </div>
            ${q.answer_description ? `<div class="solution-desc">${q.answer_description}</div>` : ""}
          </div>

          <div class="discussion-section">
            <div class="discussion-header">Community Discussion (${(q.discussion || []).length} responses)</div>
            <div class="discussion-list">${commentsHtml}</div>
          </div>
        </div>
      </div>
    </body>
    </html>
  `;

  try {
    await page.setContent(html, { waitUntil: "domcontentloaded", timeout: 10_000 });
    const secSpacer = await page.$(".sec-spacer");
    if (secSpacer) {
      await secSpacer.screenshot({ path: targetPath });
      return true;
    }
  } catch {}
  return false;
}

export async function scrapeSingleQuestion(
  context: BrowserContext,
  job: ExamQuestion,
  examCode: string,
  examTitle: string,
  onRateLimit?: (seconds: number) => void
): Promise<{ status: "saved" | "skipped" | "failed"; screenshotPath: string; error?: string }> {
  const existing = findExistingScreenshot(examCode, job.topic, job.questionNumber);
  if (existing) {
    return { status: "skipped", screenshotPath: existing };
  }

  const targetDir = getDestinationFolder(examCode, job.topic, job.questionNumber);
  const screenshotPath = path.join(targetDir, "screenshot.png");

  if (!fs.existsSync(targetDir)) {
    fs.mkdirSync(targetDir, { recursive: true });
  }

  const candidateUrls = getCandidateUrls(job.url, job.questionNumber);
  let navSuccess = false;
  let lastNavError = "";

  const page = await context.newPage();

  await page.route("**/*", (route) => {
    const url = route.request().url();
    if (
      url.includes("google-analytics") ||
      url.includes("googletagmanager") ||
      url.includes("doubleclick") ||
      url.includes("adsbygoogle") ||
      url.includes("facebook") ||
      url.includes("clarity.ms")
    ) {
      return route.abort();
    }
    return route.continue();
  });

  try {
    for (const url of candidateUrls) {
      try {
        const resp = await page.goto(url, { waitUntil: "domcontentloaded", timeout: 10_000 });
        const status = resp?.status() || 0;

        if (status === 429) {
          lastNavError = "HTTP 429 (Rate Limited)";
          if (onRateLimit) onRateLimit(8);
          break;
        }

        if (status > 0 && status < 400) {
          navSuccess = true;
          break;
        } else {
          lastNavError = `HTTP ${status}`;
        }
      } catch (err: any) {
        lastNavError = err?.message || String(err);
      }
    }

    if (navSuccess) {
      await page.evaluate(() => {
        const btn =
          document.querySelector<HTMLElement>(".reveal-solution-btn") ||
          document.querySelector<HTMLElement>("a[onclick*='doRevealSolution']");
        if (btn) btn.click();

        const toRemove = [
          "header",
          "#rs-header",
          ".full-width-header",
          ".rs-toolbar",
          "footer",
          "#rs-footer",
          ".footer-top",
          ".footer-bottom",
          ".popup-content",
          ".popup-overlay",
          "#notRemoverPopup",
          ".modal-backdrop",
          "iframe",
          ".adsbygoogle",
          ".grecaptcha-badge",
          ".discussion-header-container .pull-right",
        ];
        for (const sel of toRemove) {
          document.querySelectorAll(sel).forEach((el) => el.remove());
        }

        document.documentElement.style.overflow = "auto";
        document.body.style.overflow = "auto";
        document.documentElement.classList.remove("modal-open");
        document.body.classList.remove("modal-open");
      });

      await page.waitForTimeout(300);

      const secSpacer = await page.$(".sec-spacer");
      if (secSpacer) {
        await secSpacer.screenshot({ path: screenshotPath });
      } else {
        await page.screenshot({ path: screenshotPath, fullPage: true });
      }

      await new Promise((r) => setTimeout(r, 600 + Math.random() * 500));
      await page.close().catch(() => {});
      return { status: "saved", screenshotPath };
    }
  } catch (err: any) {
    lastNavError = err?.message || String(err);
  } finally {
    await page.close().catch(() => {});
  }

  // Fallback: render verified card locally from local dataset
  if (job.rawData) {
    const renderPage = await context.newPage();
    try {
      const rendered = await renderOfflineQuestion(renderPage, job, examTitle, screenshotPath);
      await renderPage.close().catch(() => {});
      if (rendered) {
        return { status: "saved", screenshotPath };
      }
    } catch {
      await renderPage.close().catch(() => {});
    }
  }

  return { status: "failed", screenshotPath, error: `Capture failed: ${lastNavError}` };
}
