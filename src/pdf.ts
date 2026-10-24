import fs from "fs";
import path from "path";
import {
  PDFDocument,
  StandardFonts,
  rgb,
  pushGraphicsState,
  popGraphicsState,
  clip,
  endPath,
  rectangle,
} from "pdf-lib";
import { ExamQuestion, PdfCompileResult, PdfProgressCallback } from "./types.js";
import { findExistingScreenshot } from "./renderer.js";

export async function compilePdf(
  examCode: string,
  examTitle: string,
  questions: ExamQuestion[],
  outputFileName: string,
  onProgress?: PdfProgressCallback
): Promise<PdfCompileResult> {
  const pdf = await PDFDocument.create();
  pdf.setTitle(`${examTitle} (${examCode}) - CramCert Study Guide`);
  pdf.setAuthor("CramCert");
  pdf.setCreator("CramCert Engine");
  pdf.setProducer("CramCert CLI");
  pdf.setSubject("Certification Exam Study Material");

  const font = await pdf.embedFont(StandardFonts.Helvetica);

  const A4_WIDTH = 595.28;
  const A4_HEIGHT = 841.89;
  const MARGIN = 20;
  const HEADER_HEIGHT = 18;
  const FOOTER_HEIGHT = 14;
  const contentW = A4_WIDTH - MARGIN * 2;
  const contentH = A4_HEIGHT - MARGIN * 2 - HEADER_HEIGHT - FOOTER_HEIGHT;
  const contentBottom = MARGIN + FOOTER_HEIGHT;
  const contentLeft = MARGIN;

  let totalPagesCount = 0;
  let includedCount = 0;

  for (let i = 0; i < questions.length; i++) {
    const q = questions[i];
    const shotPath = findExistingScreenshot(examCode, q.topic, q.questionNumber);
    if (!shotPath) continue;

    const raw = fs.readFileSync(shotPath);
    let img;
    try {
      img = await pdf.embedPng(raw);
    } catch {
      try {
        img = await pdf.embedJpg(raw);
      } catch {
        continue;
      }
    }

    includedCount++;
    const scale = contentW / img.width;
    const totalDrawH = img.height * scale;
    const numPages = Math.ceil(totalDrawH / contentH);

    for (let pageIdx = 0; pageIdx < numPages; pageIdx++) {
      totalPagesCount++;
      const page = pdf.addPage([A4_WIDTH, A4_HEIGHT]);

      const baseHeader = `${examCode.toUpperCase()} - Topic ${q.topic} Question ${q.questionNumber}`;
      const headerText =
        numPages > 1 ? `${baseHeader} (Page ${pageIdx + 1}/${numPages})` : baseHeader;

      page.drawText(headerText, {
        x: MARGIN,
        y: A4_HEIGHT - MARGIN - 11,
        size: 10,
        font,
        color: rgb(0.15, 0.15, 0.15),
      });

      const drawY = contentBottom + contentH + pageIdx * contentH - totalDrawH;
      const sliceH = Math.min(contentH, totalDrawH - pageIdx * contentH);
      const clipY = contentBottom + contentH - sliceH;

      page.pushOperators(
        pushGraphicsState(),
        rectangle(contentLeft, clipY, contentW, sliceH),
        clip(),
        endPath()
      );

      page.drawImage(img, {
        x: contentLeft,
        y: drawY,
        width: contentW,
        height: totalDrawH,
      });

      page.pushOperators(popGraphicsState());

      page.drawText(`Page ${totalPagesCount}`, {
        x: A4_WIDTH - MARGIN - 45,
        y: MARGIN,
        size: 8,
        font,
        color: rgb(0.5, 0.5, 0.5),
      });
    }

    if (onProgress) {
      onProgress(i + 1, questions.length);
    }
  }

  if (includedCount === 0) {
    throw new Error(
      "No screenshots were found in scrapes/ to compile into PDF.\n" +
      "Run the scraper first to capture question cards."
    );
  }

  const pdfBytes = await pdf.save();
  const outPath = path.isAbsolute(outputFileName)
    ? outputFileName
    : path.join(process.cwd(), outputFileName);

  fs.writeFileSync(outPath, pdfBytes);
  return { outPath, totalPages: totalPagesCount, questionCount: includedCount };
}
