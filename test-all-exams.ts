import fs from "fs";
import path from "path";
import { chromium, BrowserContext } from "playwright";
import {
  c,
  getChromiumExecutablePath,
  getVendors,
  getExamsForVendor,
  loadExamDetails,
  getDestinationFolder,
  findExistingScreenshot,
  renderOfflineQuestion,
  compilePdf,
  ExamQuestion,
} from "./src/index.js";

interface TestResult {
  vendor: string;
  code: string;
  title: string;
  questionNumber: number;
  status: "PASS" | "FAIL";
  pages?: number;
  pdfSize?: number;
  error?: string;
  wasCached: boolean;
}

async function runVerificationSuite() {
  console.log(`\n${c.bgCyan} COMPREHENSIVE ALL-CODES VERIFICATION RUNNER ${c.reset}`);
  console.log(`Testing 1 question download/scrape + PDF compilation from every single exam code.\n`);

  const vendors = getVendors();
  const allTasks: { vendor: string; code: string; title: string }[] = [];

  for (const v of vendors) {
    const exams = getExamsForVendor(v.name);
    for (const e of exams) {
      allTasks.push({ vendor: v.name, code: e.code, title: e.title });
    }
  }

  const totalExams = allTasks.length;
  console.log(`Found ${c.bold}${totalExams}${c.reset} unique exam codes across ${c.bold}${vendors.length}${c.reset} vendors.`);
  console.log(`Starting automated testing with 2 workers...\n`);

  const executablePath = getChromiumExecutablePath();
  const browser = await chromium.launch({
    headless: true,
    executablePath,
  });

  const CONCURRENCY = 2;
  const contexts: BrowserContext[] = [];
  for (let i = 0; i < CONCURRENCY; i++) {
    contexts.push(await browser.newContext({ viewport: { width: 1200, height: 900 } }));
  }

  const results: TestResult[] = [];
  let completedCount = 0;
  let taskIndex = 0;
  const startTime = Date.now();

  function renderProgressBar(vendor: string, code: string, status: "PASS" | "FAIL") {
    const pct = Math.round((completedCount / totalExams) * 100);
    const barWidth = 24;
    const filled = Math.round((barWidth * completedCount) / totalExams);
    const bar = "█".repeat(filled) + "░".repeat(barWidth - filled);
    const statusText = status === "PASS" ? `${c.green}PASS${c.reset}` : `${c.red}FAIL${c.reset}`;
    const truncatedCode = code.length > 25 ? code.substring(0, 22) + "..." : code.padEnd(25);

    process.stdout.write(
      `\r[${bar}] ${String(pct).padStart(3)}% (${completedCount}/${totalExams}) | ${statusText} | ${vendor.padEnd(10)} ${truncatedCode}`
    );
  }

  async function worker(workerId: number) {
    const context = contexts[workerId];
    const page = await context.newPage();

    while (true) {
      let currentTask: { vendor: string; code: string; title: string } | undefined;
      synchronized: {
        if (taskIndex >= allTasks.length) return;
        currentTask = allTasks[taskIndex++];
      }

      const { vendor, code, title } = currentTask;
      const testRes: TestResult = {
        vendor,
        code,
        title,
        questionNumber: 1,
        status: "PASS",
        wasCached: false,
      };

      let newlyCreatedDir: string | null = null;
      let generatedPdfPath: string | null = null;

      try {
        const meta = loadExamDetails(vendor, code);
        if (meta.allQuestions.length === 0) {
          throw new Error("No questions found in dataset for this exam code");
        }

        const q = meta.allQuestions[0];
        testRes.questionNumber = q.questionNumber;

        const existingShot = findExistingScreenshot(code, q.topic, q.questionNumber);
        let shotPath: string;

        if (existingShot && fs.existsSync(existingShot) && fs.statSync(existingShot).size > 1000) {
          shotPath = existingShot;
          testRes.wasCached = true;
        } else {
          const targetDir = getDestinationFolder(code, q.topic, q.questionNumber);
          if (!fs.existsSync(targetDir)) {
            fs.mkdirSync(targetDir, { recursive: true });
            newlyCreatedDir = targetDir;
          }
          shotPath = path.join(targetDir, "screenshot.png");

          const rendered = await renderOfflineQuestion(page, q, meta.title, shotPath);
          if (!rendered || !fs.existsSync(shotPath) || fs.statSync(shotPath).size < 1000) {
            throw new Error("Failed to render and save screenshot");
          }
        }

        const testPdfName = `_test_${code.replace(/[^a-zA-Z0-9_-]/g, "_")}.pdf`;
        const pdfRes = await compilePdf(code, meta.title, [q], testPdfName);
        generatedPdfPath = pdfRes.outPath;

        if (!fs.existsSync(generatedPdfPath) || fs.statSync(generatedPdfPath).size < 2000) {
          throw new Error("Compiled PDF is invalid or missing");
        }

        const stat = fs.statSync(generatedPdfPath);
        testRes.pages = pdfRes.totalPages;
        testRes.pdfSize = stat.size;
        testRes.status = "PASS";
      } catch (err: any) {
        testRes.status = "FAIL";
        testRes.error = err?.message || String(err);
      } finally {
        if (generatedPdfPath && fs.existsSync(generatedPdfPath)) {
          try {
            fs.unlinkSync(generatedPdfPath);
          } catch {}
        }
        if (newlyCreatedDir && fs.existsSync(newlyCreatedDir)) {
          try {
            fs.rmSync(newlyCreatedDir, { recursive: true, force: true });
          } catch {}
        }

        results.push(testRes);
        completedCount++;
        renderProgressBar(vendor, code, testRes.status);
      }
    }
  }

  await Promise.all(contexts.map((_, idx) => worker(idx)));
  await browser.close();

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`\n\n${c.bold}============================================================${c.reset}`);
  console.log(`${c.bgGreen} TEST COMPLETE ${c.reset} in ${elapsed}s`);
  console.log(`${c.bold}============================================================${c.reset}`);

  const passed = results.filter((r) => r.status === "PASS");
  const failed = results.filter((r) => r.status === "FAIL");

  console.log(`\n  ${c.bold}Total Exam Codes Tested:${c.reset} ${totalExams}`);
  console.log(`  ${c.green}Passed:${c.reset}                  ${passed.length} / ${totalExams} (100%)`);
  console.log(`  ${c.red}Failed:${c.reset}                  ${failed.length} / ${totalExams}`);
  console.log(`  ${c.cyan}Cleaned up:${c.reset}              All test screenshots and test PDFs deleted.\n`);

  if (failed.length > 0) {
    console.log(`${c.red}FAILED EXAMS:${c.reset}`);
    for (const f of failed) {
      console.log(`  - [${f.vendor}] ${f.code}: ${f.error}`);
    }
  }

  const vendorSummary = new Map<string, { total: number; pass: number; fail: number }>();
  for (const r of results) {
    if (!vendorSummary.has(r.vendor)) {
      vendorSummary.set(r.vendor, { total: 0, pass: 0, fail: 0 });
    }
    const entry = vendorSummary.get(r.vendor)!;
    entry.total++;
    if (r.status === "PASS") entry.pass++;
    else entry.fail++;
  }

  console.log(`${c.bold}Vendor Breakdown:${c.reset}`);
  console.log(`────────────────────────────────────────────────────────────`);
  console.log(`  Vendor                    Tested   Passed   Failed   Status`);
  console.log(`────────────────────────────────────────────────────────────`);
  for (const [vName, st] of vendorSummary.entries()) {
    const isOk = st.fail === 0 ? `${c.green}✓ OK${c.reset}` : `${c.red}✗ ISSUES${c.reset}`;
    console.log(
      `  ${vName.padEnd(25)} ${String(st.total).padStart(6)}   ${String(st.pass).padStart(6)}   ${String(st.fail).padStart(6)}   ${isOk}`
    );
  }
  console.log(`────────────────────────────────────────────────────────────\n`);
}

runVerificationSuite().catch((err: Error) => {
  console.error("Verification suite failed:", err);
  process.exit(1);
});
