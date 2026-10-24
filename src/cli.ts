import fs from "fs";
import { c } from "./config.js";
import {
  ExamMetadata,
  ExamQuestion,
  VendorOrExamItem,
} from "./types.js";
import {
  getVendors,
  getExamsForVendor,
  getAllExamsCached,
  loadExamDetails,
} from "./catalog.js";
import { LineReader, selectFromList } from "./terminal.js";
import { scrapeQuestionsConcurrent } from "./scraper.js";
import { compilePdf } from "./pdf.js";

export async function executeScrapeAndCompile(
  meta: ExamMetadata,
  chosenQuestions: ExamQuestion[],
  pdfSuffix: string,
  isPdfOnly: boolean
) {
  console.log(`\n${c.green}Scope ready: ${chosenQuestions.length} questions to process.${c.reset}`);

  if (!isPdfOnly) {
    const concurrency = 2;

    console.log(`\n${c.bgCyan} STARTING FAST SCRAPING ${c.reset}`);
    console.log(`Workers: ${concurrency} (Auto-optimized) | Crisp Element Screenshots: ON | Ad Blocker: ON`);
    console.log("─".repeat(65));

    const startTime = Date.now();
    const result = await scrapeQuestionsConcurrent(
      chosenQuestions,
      meta.code,
      meta.title,
      concurrency,
      (done, total, current, status) => {
        const pct = Math.round((done / total) * 100);
        const barWidth = 22;
        const filled = Math.round((barWidth * done) / total);
        const bar = "█".repeat(filled) + "░".repeat(barWidth - filled);

        const statusColor =
          status === "saved" ? c.green : status === "skipped" ? c.yellow : c.red;
        const statusTag = statusColor + status.toUpperCase().padEnd(7) + c.reset;

        process.stdout.write(
          `\r[${bar}] ${String(pct).padStart(3)}% (${done}/${total}) | ${statusTag} | T${current.topic} Q${current.questionNumber}   `
        );
      }
    );

    const elapsedSec = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`\n\n${c.bold}Scraping Completed in ${elapsedSec}s!${c.reset}`);
    console.log(`  ${c.green}Saved:${c.reset}   ${result.saved}`);
    console.log(`  ${c.yellow}Skipped:${c.reset} ${result.skipped} (already saved)`);
    console.log(`  ${c.red}Failed:${c.reset}  ${result.failed}`);

    if (result.errors.length > 0) {
      console.log(`\n${c.red}Failure details:${c.reset}`);
      for (const err of result.errors.slice(0, 5)) {
        console.log(`  - ${err}`);
      }
    }
  }

  console.log(`\n${c.bgCyan} COMPILING STRUCTURED PDF ${c.reset}`);
  const pdfFileName = `${meta.code.toUpperCase()}-${pdfSuffix}.pdf`;
  console.log(`Building ${c.bold}${pdfFileName}${c.reset}...`);

  try {
    const result = await compilePdf(
      meta.code,
      meta.title,
      chosenQuestions,
      pdfFileName,
      (cur, tot) => {
        if (cur % 25 === 0 || cur === tot) {
          process.stdout.write(`\r  Merging pages... [${cur}/${tot}] questions processed`);
        }
      }
    );

    const stat = fs.statSync(result.outPath);
    const sizeMb = (stat.size / (1024 * 1024)).toFixed(2);

    console.log(`\n\n${c.bgGreen} SUCCESS! PDF READY ${c.reset}`);
    console.log(`  ${c.bold}File Path:${c.reset}  ${c.cyan}${result.outPath}${c.reset}`);
    console.log(`  ${c.bold}Questions:${c.reset}  ${result.questionCount}`);
    console.log(`  ${c.bold}Total Pages:${c.reset}${result.totalPages}`);
    console.log(`  ${c.bold}File Size:${c.reset}  ${sizeMb} MB`);
  } catch (pdfErr: any) {
    console.error(`\n${c.red}PDF compilation notice:${c.reset}`, pdfErr?.message || pdfErr);
  }
}

export async function main() {
  const reader = new LineReader();

  console.log(`\n${c.bold}${c.cyan}╔══════════════════════════════════════════════════════════╗${c.reset}`);
  console.log(`${c.bold}${c.cyan}║          CRAMCERT • EXAM STUDY GUIDE COMPILER          ║${c.reset}`);
  console.log(`${c.bold}${c.cyan}╚══════════════════════════════════════════════════════════╝${c.reset}`);

  enum Screen {
    VENDOR,
    EXAM,
    SCOPE,
    TOPIC,
    CHUNK,
    CUSTOM_RANGE,
    AFTER_FINISH,
  }

  let screen: Screen = Screen.VENDOR;
  let previousScreen: Screen = Screen.VENDOR;
  let selectedVendor: { name: string; examCount: number } | null = null;
  let selectedExam: { code: string; title: string; fileCount: number } | null = null;
  let meta: ExamMetadata | null = null;
  let chosenQuestions: ExamQuestion[] = [];
  let pdfSuffix = "";
  let isPdfOnly = false;

  try {
    while (true) {
      if (screen === Screen.VENDOR) {
        const vendors = getVendors();
        const defaultVendorItems: VendorOrExamItem[] = vendors.map((v) => ({
          kind: "vendor",
          name: v.name,
          examCount: v.examCount,
        }));

        const res = await selectFromList<VendorOrExamItem>(
          reader,
          "SELECT EXAM PROVIDER / VENDOR",
          defaultVendorItems,
          (item) => {
            if (item.kind === "vendor") {
              return `${c.bold}${item.name.padEnd(22)}${c.reset} ${c.dim}(${item.examCount} exams available)${c.reset}`;
            } else {
              return `${c.yellow}[${item.vendor}]${c.reset} ${c.bold}${item.code.padEnd(25)}${c.reset} ${c.cyan}${item.title}${c.reset}`;
            }
          },
          15,
          true,
          (query) => {
            const q = query.toLowerCase();
            const matchedVendors: VendorOrExamItem[] = vendors
              .filter((v) => v.name.toLowerCase().includes(q))
              .map((v) => ({
                kind: "vendor",
                name: v.name,
                examCount: v.examCount,
              }));

            const matchedExams: VendorOrExamItem[] = getAllExamsCached()
              .filter((e) => e.code.toLowerCase().includes(q) || e.title.toLowerCase().includes(q))
              .map((e) => ({
                kind: "exam",
                vendor: e.vendor,
                code: e.code,
                title: e.title,
              }));

            return [...matchedVendors, ...matchedExams];
          }
        );

        if (res.action === "EXIT") {
          console.log(`\n${c.cyan}👋 Exiting CramCert. Goodbye!${c.reset}\n`);
          break;
        }

        if (res.action === "SELECT") {
          const selected = res.item;
          if (selected.kind === "vendor") {
            selectedVendor = { name: selected.name, examCount: selected.examCount };
            previousScreen = Screen.VENDOR;
            screen = Screen.EXAM;
          } else {
            selectedVendor = vendors.find((v) => v.name === selected.vendor) || {
              name: selected.vendor,
              examCount: 1,
            };
            selectedExam = { code: selected.code, title: selected.title, fileCount: 1 };
            console.log(`\n${c.dim}Loading exam question index for ${selectedExam.code}...${c.reset}`);
            meta = loadExamDetails(selected.vendor, selected.code);
            previousScreen = Screen.VENDOR;
            screen = Screen.SCOPE;
          }
        }
        continue;
      }

      if (screen === Screen.EXAM) {
        if (!selectedVendor) {
          screen = Screen.VENDOR;
          continue;
        }

        const exams = getExamsForVendor(selectedVendor.name);
        const res = await selectFromList(
          reader,
          `SELECT EXAM FOR ${selectedVendor.name.toUpperCase()}`,
          exams,
          (e) => `${c.bold}${e.code.padEnd(25)}${c.reset} ${c.cyan}${e.title}${c.reset}`,
          15,
          false
        );

        if (res.action === "EXIT") {
          console.log(`\n${c.cyan}👋 Exiting CramCert. Goodbye!${c.reset}\n`);
          break;
        }

        if (res.action === "BACK") {
          screen = Screen.VENDOR;
          continue;
        }

        if (res.action === "SELECT") {
          selectedExam = res.item;
          console.log(`\n${c.dim}Loading exam question index for ${selectedExam.code}...${c.reset}`);
          meta = loadExamDetails(selectedVendor.name, selectedExam.code);
          previousScreen = Screen.EXAM;
          screen = Screen.SCOPE;
        }
        continue;
      }

      if (screen === Screen.SCOPE) {
        if (!selectedExam || !meta || !selectedVendor) {
          screen = Screen.EXAM;
          continue;
        }

        console.log(`\n${c.bgBlue} EXAM SUMMARY ${c.reset}`);
        console.log(`  ${c.bold}Provider:${c.reset}        ${meta.vendor}`);
        console.log(`  ${c.bold}Exam Code:${c.reset}       ${meta.code}`);
        console.log(`  ${c.bold}Title:${c.reset}           ${meta.title}`);
        console.log(`  ${c.bold}Total Questions:${c.reset} ${c.green}${c.bold}${meta.totalQuestions}${c.reset}`);
        console.log(`  ${c.bold}Topics Count:${c.reset}    ${meta.topics.length}`);

        console.log(`\n${c.bold}Topic Breakdown & Question Ranges:${c.reset}`);
        console.log("─".repeat(60));
        for (const t of meta.topics) {
          console.log(
            `  ${c.cyan}Topic ${String(t.topic).padEnd(2)}${c.reset} : ${c.bold}${String(t.count).padStart(3)}${c.reset} questions  ${c.dim}(Q${t.minQ} - Q${t.maxQ})${c.reset}`
          );
        }
        console.log("─".repeat(60));

        console.log(`\n${c.bold}Select what you would like to scrape & compile:${c.reset}`);
        console.log(`  ${c.cyan}[1]${c.reset} ${c.bold}All Questions${c.reset} (${meta.totalQuestions} questions across all topics)`);
        console.log(`  ${c.cyan}[2]${c.reset} ${c.bold}By Specific Topic${c.reset} (choose one topic)`);
        console.log(`  ${c.cyan}[3]${c.reset} ${c.bold}In Logical Chunks of 50${c.reset} (e.g. 1-50, 51-100, 101-150...)`);
        console.log(`  ${c.cyan}[4]${c.reset} ${c.bold}Custom Question Range${c.reset} (specify start and end)`);
        console.log(`  ${c.cyan}[5]${c.reset} ${c.bold}Compile PDF only${c.reset} (from already scraped screenshots)`);
        console.log(`  ${c.yellow}[b]${c.reset} ◀ Back`);
        console.log(`  ${c.red}[q]${c.reset} ✖ Exit`);

        const scopeChoice = (await reader.ask("\nEnter choice (1-5, b, q): > ")).trim().toLowerCase();

        if (scopeChoice === "q" || scopeChoice === "exit") {
          console.log(`\n${c.cyan}👋 Exiting CramCert. Goodbye!${c.reset}\n`);
          break;
        }

        if (scopeChoice === "b" || scopeChoice === "back") {
          screen = previousScreen;
          continue;
        }

        if (scopeChoice === "1" || !scopeChoice) {
          chosenQuestions = meta.allQuestions;
          pdfSuffix = "All";
          isPdfOnly = false;
        } else if (scopeChoice === "2") {
          screen = Screen.TOPIC;
          continue;
        } else if (scopeChoice === "3") {
          screen = Screen.CHUNK;
          continue;
        } else if (scopeChoice === "4") {
          screen = Screen.CUSTOM_RANGE;
          continue;
        } else if (scopeChoice === "5") {
          chosenQuestions = meta.allQuestions;
          pdfSuffix = "All";
          isPdfOnly = true;
        } else {
          console.log(`${c.red}Invalid choice. Enter 1-5, 'b' to go back, or 'q' to exit.${c.reset}`);
          continue;
        }

        await executeScrapeAndCompile(meta, chosenQuestions, pdfSuffix, isPdfOnly);
        screen = Screen.AFTER_FINISH;
        continue;
      }

      if (screen === Screen.TOPIC) {
        if (!meta) { screen = Screen.SCOPE; continue; }

        const res = await selectFromList(
          reader,
          `SELECT TOPIC FOR ${meta.code}`,
          meta.topics,
          (t) => `Topic ${t.topic}: ${t.count} questions (Q${t.minQ} - Q${t.maxQ})`,
          15,
          false
        );

        if (res.action === "EXIT") {
          console.log(`\n${c.cyan}👋 Exiting CramCert. Goodbye!${c.reset}\n`);
          break;
        }

        if (res.action === "BACK") {
          screen = Screen.SCOPE;
          continue;
        }

        if (res.action === "SELECT") {
          chosenQuestions = res.item.questions;
          pdfSuffix = `Topic-${res.item.topic}`;
          isPdfOnly = false;
          await executeScrapeAndCompile(meta, chosenQuestions, pdfSuffix, isPdfOnly);
          screen = Screen.AFTER_FINISH;
        }
        continue;
      }

      if (screen === Screen.CHUNK) {
        if (!meta) { screen = Screen.SCOPE; continue; }

        const chunkSize = 50;
        const chunks: { label: string; questions: ExamQuestion[] }[] = [];
        for (let i = 0; i < meta.allQuestions.length; i += chunkSize) {
          const slice = meta.allQuestions.slice(i, i + chunkSize);
          chunks.push({
            label: `Questions ${i + 1} - ${Math.min(i + chunkSize, meta.allQuestions.length)} (${slice.length} questions)`,
            questions: slice,
          });
        }

        const res = await selectFromList(
          reader,
          `SELECT CHUNK FOR ${meta.code}`,
          chunks,
          (ch) => ch.label,
          15,
          false
        );

        if (res.action === "EXIT") {
          console.log(`\n${c.cyan}👋 Exiting CramCert. Goodbye!${c.reset}\n`);
          break;
        }

        if (res.action === "BACK") {
          screen = Screen.SCOPE;
          continue;
        }

        if (res.action === "SELECT") {
          chosenQuestions = res.item.questions;
          pdfSuffix = res.item.label.replace(/[^a-zA-Z0-9-]/g, "_").slice(0, 30);
          isPdfOnly = false;
          await executeScrapeAndCompile(meta, chosenQuestions, pdfSuffix, isPdfOnly);
          screen = Screen.AFTER_FINISH;
        }
        continue;
      }

      if (screen === Screen.CUSTOM_RANGE) {
        if (!meta) { screen = Screen.SCOPE; continue; }

        const totalQ = meta.allQuestions.length;
        const fromStr = (await reader.ask(`Enter START question index (1 - ${totalQ}) or [b] to cancel: > `)).trim();
        if (fromStr.toLowerCase() === "b" || fromStr.toLowerCase() === "back") {
          screen = Screen.SCOPE;
          continue;
        }
        if (fromStr.toLowerCase() === "q" || fromStr.toLowerCase() === "exit") {
          console.log(`\n${c.cyan}👋 Exiting CramCert. Goodbye!${c.reset}\n`);
          break;
        }

        const toStr = (await reader.ask(`Enter END question index (1 - ${totalQ}) or [b] to cancel: > `)).trim();
        if (toStr.toLowerCase() === "b" || toStr.toLowerCase() === "back") {
          screen = Screen.SCOPE;
          continue;
        }
        if (toStr.toLowerCase() === "q" || toStr.toLowerCase() === "exit") {
          console.log(`\n${c.cyan}👋 Exiting CramCert. Goodbye!${c.reset}\n`);
          break;
        }

        const fromIdx = Math.max(1, parseInt(fromStr, 10) || 1);
        const toIdx = Math.min(totalQ, parseInt(toStr, 10) || totalQ);

        chosenQuestions = meta.allQuestions.slice(fromIdx - 1, toIdx);
        pdfSuffix = `Q${fromIdx}-Q${toIdx}`;
        isPdfOnly = false;

        await executeScrapeAndCompile(meta, chosenQuestions, pdfSuffix, isPdfOnly);
        screen = Screen.AFTER_FINISH;
        continue;
      }

      if (screen === Screen.AFTER_FINISH) {
        console.log(`\n${c.bold}What would you like to do next?${c.reset}`);
        if (selectedExam) {
          console.log(`  ${c.cyan}[1]${c.reset} Scrape another chunk / range from ${c.bold}${selectedExam.code}${c.reset}`);
        }
        if (selectedVendor) {
          console.log(`  ${c.cyan}[2]${c.reset} Choose another exam from ${c.bold}${selectedVendor.name}${c.reset}`);
        }
        console.log(`  ${c.cyan}[3]${c.reset} Return to Main Menu (All Vendors)`);
        console.log(`  ${c.red}[q]${c.reset} ✖ Exit`);

        const nextAction = (await reader.ask("\nEnter choice (1-3, q): > ")).trim().toLowerCase();

        if (nextAction === "q" || nextAction === "exit") {
          console.log(`\n${c.cyan}👋 Exiting CramCert. Goodbye!${c.reset}\n`);
          break;
        }

        if (nextAction === "1" && selectedExam) {
          screen = Screen.SCOPE;
        } else if (nextAction === "2" && selectedVendor) {
          screen = Screen.EXAM;
        } else {
          screen = Screen.VENDOR;
        }
        continue;
      }
    }
  } catch (err: any) {
    console.error(`\n${c.red}Error:${c.reset}`, err?.message || err);
  } finally {
    reader.close();
  }
}
