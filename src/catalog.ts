import fs from "fs";
import path from "path";
import { DATA_ROOT } from "./config.js";
import {
  VendorInfo,
  CachedExam,
  ExamMetadata,
  ExamQuestion,
  TopicInfo,
} from "./types.js";

let cachedAllExams: CachedExam[] | null = null;

export function getVendors(): VendorInfo[] {
  if (!fs.existsSync(DATA_ROOT)) {
    throw new Error(
      `Dataset directory not found at: ${DATA_ROOT}\n` +
      `Please download 'examtopics-data' from https://t.me/thesam_ple_resources/3 and place it in the project root.`
    );
  }

  const vendors = fs
    .readdirSync(DATA_ROOT)
    .filter((f) => fs.statSync(path.join(DATA_ROOT, f)).isDirectory() && !f.startsWith("."));

  return vendors
    .map((v) => {
      const dir = path.join(DATA_ROOT, v);
      const files = fs.readdirSync(dir).filter((f) => f.endsWith(".json"));
      const examCodes = new Set<string>();
      for (const f of files) {
        const m = f.match(/^(.*?)(?:_\d+(?:\(\d+\))?)\.json$/);
        if (m) examCodes.add(m[1]);
      }
      return { name: v, examCount: examCodes.size };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function getExamsForVendor(
  vendor: string
): { code: string; title: string; fileCount: number }[] {
  const dir = path.join(DATA_ROOT, vendor);
  if (!fs.existsSync(dir)) return [];

  const files = fs.readdirSync(dir).filter((f) => f.endsWith(".json"));
  const examMap = new Map<string, { code: string; title: string; fileCount: number }>();

  for (const f of files) {
    const m = f.match(/^(.*?)(?:_\d+(?:\(\d+\))?)\.json$/);
    if (!m) continue;
    const code = m[1];
    if (!examMap.has(code)) {
      examMap.set(code, { code, title: code, fileCount: 0 });
    }
    const entry = examMap.get(code)!;
    entry.fileCount++;
  }

  for (const [code, item] of examMap.entries()) {
    const p1 = path.join(dir, `${code}_1.json`);
    if (fs.existsSync(p1)) {
      try {
        const raw = JSON.parse(fs.readFileSync(p1, "utf8"));
        if (raw.pageProps?.exam?.name) {
          item.title = raw.pageProps.exam.name;
        }
      } catch {}
    }
  }

  return Array.from(examMap.values()).sort((a, b) => a.code.localeCompare(b.code));
}

export function getAllExamsCached(): CachedExam[] {
  if (cachedAllExams) return cachedAllExams;

  const vendors = getVendors();
  const all: CachedExam[] = [];

  for (const v of vendors) {
    const exams = getExamsForVendor(v.name);
    for (const e of exams) {
      all.push({
        vendor: v.name,
        code: e.code,
        title: e.title,
      });
    }
  }

  cachedAllExams = all;
  return all;
}

export function normalizeExamTopicsUrl(rawUrl: string): string {
  let url = rawUrl.trim().replace(/\/+$/, "");
  if (!url.endsWith("-discussion")) {
    url = `${url}-discussion`;
  }
  return `${url}/`;
}

export function getCandidateUrls(rawUrl: string, questionNumber?: number): string[] {
  let url = rawUrl.trim().replace(/\/+$/, "");
  const base = url.replace(/-discussion$/, "");
  const candidates: string[] = [];

  if (questionNumber && questionNumber > 0 && !base.includes("question-")) {
    candidates.push(`${base}-question-${questionNumber}-discussion/`);
    candidates.push(`${base}-question-${questionNumber}/`);
  }

  candidates.push(`${base}-discussion/`);
  candidates.push(`${base}/`);

  return Array.from(new Set(candidates));
}

export function loadExamDetails(vendor: string, examCode: string): ExamMetadata {
  const dir = path.join(DATA_ROOT, vendor);
  const files = fs
    .readdirSync(dir)
    .filter((f) => f.startsWith(examCode + "_") && f.endsWith(".json"));

  let title = examCode;
  const questions: ExamQuestion[] = [];
  const seenUrls = new Set<string>();

  for (const f of files) {
    try {
      const content = fs.readFileSync(path.join(dir, f), "utf8");
      const data = JSON.parse(content);
      if (title === examCode && data.pageProps?.exam?.name) {
        title = data.pageProps.exam.name;
      }
      const qs = data.pageProps?.questions || [];
      for (const q of qs) {
        if (!q.url) continue;
        const normalizedUrl = normalizeExamTopicsUrl(q.url);
        if (seenUrls.has(normalizedUrl)) continue;
        seenUrls.add(normalizedUrl);

        let topic = 1;
        let qNum = 0;
        const m = q.url.match(/topic-(\d+)-question-(\d+)/i);
        if (m) {
          topic = parseInt(m[1], 10);
          qNum = parseInt(m[2], 10);
        } else {
          if (q.topic) topic = parseInt(q.topic, 10) || 1;
          const matchNum = q.url.match(/question-(\d+)/i);
          if (matchNum) {
            qNum = parseInt(matchNum[1], 10);
          } else if (q.question_id) {
            qNum = parseInt(String(q.question_id), 10) || 0;
          }
        }

        questions.push({
          topic,
          questionNumber: qNum,
          url: normalizedUrl,
          id: q.id,
          questionId: q.question_id,
          rawData: q,
        });
      }
    } catch {}
  }

  questions.sort((a, b) => a.topic - b.topic || a.questionNumber - b.questionNumber);

  const topicMap = new Map<number, ExamQuestion[]>();
  for (const q of questions) {
    if (!topicMap.has(q.topic)) topicMap.set(q.topic, []);
    topicMap.get(q.topic)!.push(q);
  }

  const topics: TopicInfo[] = Array.from(topicMap.entries())
    .map(([t, qList]) => {
      const nums = qList.map((q) => q.questionNumber).filter((n) => n > 0);
      return {
        topic: t,
        count: qList.length,
        minQ: nums.length > 0 ? Math.min(...nums) : 1,
        maxQ: nums.length > 0 ? Math.max(...nums) : qList.length,
        questions: qList,
      };
    })
    .sort((a, b) => a.topic - b.topic);

  return {
    vendor,
    code: examCode,
    title,
    totalQuestions: questions.length,
    topics,
    allQuestions: questions,
  };
}
