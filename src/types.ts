export interface ExamQuestion {
  topic: number;
  questionNumber: number;
  url: string;
  id?: string;
  questionId?: string;
  rawData?: any;
}

export interface TopicInfo {
  topic: number;
  count: number;
  minQ: number;
  maxQ: number;
  questions: ExamQuestion[];
}

export interface ExamMetadata {
  vendor: string;
  code: string;
  title: string;
  totalQuestions: number;
  topics: TopicInfo[];
  allQuestions: ExamQuestion[];
}

export interface VendorInfo {
  name: string;
  examCount: number;
}

export interface CachedExam {
  vendor: string;
  code: string;
  title: string;
}

export type MenuResult<T> =
  | { action: "SELECT"; item: T }
  | { action: "BACK" }
  | { action: "EXIT" };

export type VendorOrExamItem =
  | { kind: "vendor"; name: string; examCount: number }
  | { kind: "exam"; vendor: string; code: string; title: string };

export interface ScrapeResult {
  saved: number;
  skipped: number;
  failed: number;
  errors: string[];
}

export interface PdfCompileResult {
  outPath: string;
  totalPages: number;
  questionCount: number;
}

export type ScrapeProgressCallback = (
  completed: number,
  total: number,
  current: ExamQuestion,
  status: "saved" | "skipped" | "failed"
) => void;

export type PdfProgressCallback = (current: number, total: number) => void;
