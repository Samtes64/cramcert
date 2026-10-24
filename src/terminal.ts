import readline from "readline";
import { c } from "./config.js";
import { MenuResult } from "./types.js";

export class LineReader {
  private queue: string[] = [];
  private waiter: ((val: string) => void) | null = null;
  private rl: readline.Interface;

  constructor() {
    this.rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      terminal: process.stdin.isTTY ?? false,
    });

    this.rl.on("line", (line: string) => {
      const trimmed = line.trim();
      if (this.waiter) {
        const cb = this.waiter;
        this.waiter = null;
        cb(trimmed);
      } else {
        this.queue.push(trimmed);
      }
    });
  }

  ask(prompt: string): Promise<string> {
    if (this.queue.length > 0) {
      return Promise.resolve(this.queue.shift()!);
    }
    return new Promise((resolve) => {
      this.waiter = (val: string) => {
        resolve(val);
      };
      process.stdout.write(prompt + " ");
    });
  }

  close() {
    this.rl.close();
  }
}

export function formatOrdinal(n: number): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return `${n}st`;
  if (mod10 === 2 && mod100 !== 12) return `${n}nd`;
  if (mod10 === 3 && mod100 !== 13) return `${n}rd`;
  return `${n}th`;
}

export async function selectFromList<T>(
  reader: LineReader,
  title: string,
  items: T[],
  labelFn: (item: T, index: number) => string,
  pageSize = 15,
  isTopLevel = false,
  customSearch?: (query: string) => T[]
): Promise<MenuResult<T>> {
  let filterText = "";
  let page = 0;

  while (true) {
    const trimmedFilter = filterText.trim();
    const filtered = trimmedFilter
      ? customSearch
        ? customSearch(trimmedFilter)
        : items.filter((item, idx) =>
            labelFn(item, idx).toLowerCase().includes(trimmedFilter.toLowerCase())
          )
      : items;

    const totalPages = Math.ceil(filtered.length / pageSize) || 1;
    if (page >= totalPages) page = totalPages - 1;
    if (page < 0) page = 0;

    const startIdx = page * pageSize;
    const pageItems = filtered.slice(startIdx, startIdx + pageSize);

    const ordinalText = `${formatOrdinal(page + 1)} page of ${totalPages}`;
    const rangeText =
      filtered.length > 0
        ? `Showing ${startIdx + 1} - ${Math.min(startIdx + pageSize, filtered.length)} of ${filtered.length} total`
        : `0 results`;

    console.log(
      `\n${c.bgCyan} ${title} ${c.reset}  ${c.dim}[ ${ordinalText} • ${rangeText} ]${c.reset}`
    );

    if (trimmedFilter) {
      if (filtered.length > 0) {
        const scopeLabel = isTopLevel ? "across all providers & exams" : "in this list";
        console.log(
          `${c.yellow}🔍 Active Filter: "${trimmedFilter}" (${filtered.length} matches found ${scopeLabel})${c.reset} ${c.dim}• Type 'c' to clear filter${c.reset}`
        );
      } else {
        console.log(
          `${c.red}⚠️  No results found matching "${trimmedFilter}".${c.reset} ${c.dim}Type another search or 'c' to show all.${c.reset}`
        );
      }
    }

    console.log("─".repeat(70));

    if (pageItems.length === 0) {
      console.log(`  ${c.dim}(No matching items)${c.reset}`);
    } else {
      pageItems.forEach((item, i) => {
        const globalIndex = startIdx + i + 1;
        console.log(`  ${c.cyan}[${globalIndex}]${c.reset} ${labelFn(item, globalIndex - 1)}`);
      });
    }

    console.log("─".repeat(70));

    const navHints: string[] = [];
    if (page > 0) navHints.push(`${c.bold}p${c.reset}: Prev page ◀`);
    if (page < totalPages - 1) navHints.push(`${c.bold}n${c.reset}: Next page ▶`);
    if (totalPages > 1) {
      navHints.push(`${c.dim}(Page ${page + 1} of ${totalPages})${c.reset}`);
    }

    const actionHints: string[] = [];
    if (filtered.length > 0) {
      const minNum = startIdx + 1;
      const maxNum = startIdx + pageItems.length;
      actionHints.push(`Type ${c.bold}number${c.reset} [${minNum}-${maxNum}] to select`);
    }
    const searchHint = isTopLevel
      ? `Type ${c.bold}text${c.reset} to search (e.g. 'amazon', 'az-104', 'ccna')`
      : `Type ${c.bold}text${c.reset} to search`;
    actionHints.push(searchHint);

    if (trimmedFilter) {
      actionHints.push(`${c.bold}c${c.reset}: Clear filter`);
    }
    if (!isTopLevel) {
      actionHints.push(`${c.bold}b${c.reset}: ◀ Back`);
    }
    actionHints.push(`${c.bold}q${c.reset}: ✖ Exit`);

    if (navHints.length > 0) {
      console.log(`${c.dim}Navigation: ${navHints.join("  |  ")}${c.reset}`);
    }
    console.log(`${c.dim}Actions:    ${actionHints.join("  |  ")}${c.reset}`);

    const inputVal = (await reader.ask("> ")).trim();
    if (!inputVal) continue;

    const lower = inputVal.toLowerCase();

    if (lower === "q" || lower === "exit" || lower === "quit") {
      return { action: "EXIT" };
    }

    if (lower === "b" || lower === "back") {
      if (isTopLevel) {
        console.log(`\n${c.yellow}ℹ You are already at the top main menu. Type 'q' to exit.${c.reset}`);
        continue;
      }
      return { action: "BACK" };
    }

    if (lower === "n" || lower === "next" || lower === ">") {
      if (page < totalPages - 1) {
        page++;
      } else {
        console.log(`${c.dim}Already on the last page (${page + 1}/${totalPages}).${c.reset}`);
      }
      continue;
    }

    if (lower === "p" || lower === "prev" || lower === "<") {
      if (page > 0) {
        page--;
      } else {
        console.log(`${c.dim}Already on the first page (1/${totalPages}).${c.reset}`);
      }
      continue;
    }

    const pageJumpMatch = lower.match(/^(?:page\s*|p)(\d+)$/);
    if (pageJumpMatch) {
      const targetP = parseInt(pageJumpMatch[1], 10);
      if (targetP >= 1 && targetP <= totalPages) {
        page = targetP - 1;
        continue;
      }
    }

    if (lower === "c" || lower === "clear" || lower === "reset") {
      filterText = "";
      page = 0;
      continue;
    }

    if (inputVal.startsWith("/") || lower.startsWith("s ")) {
      const cleanQuery = inputVal.startsWith("/")
        ? inputVal.slice(1).trim()
        : inputVal.slice(2).trim();
      if (cleanQuery.length > 0) {
        filterText = cleanQuery;
        page = 0;
        continue;
      }
    }

    const num = parseInt(inputVal, 10);
    if (!isNaN(num) && /^\d+$/.test(inputVal)) {
      if (num >= 1 && num <= filtered.length) {
        return { action: "SELECT", item: filtered[num - 1] };
      }

      const numericMatches = customSearch
        ? customSearch(inputVal)
        : items.filter((item, idx) =>
            labelFn(item, idx).toLowerCase().includes(inputVal.toLowerCase())
          );
      if (numericMatches.length > 0) {
        filterText = inputVal;
        page = 0;
        continue;
      }

      console.log(
        `${c.red}Invalid number: ${num}. Choose between 1 and ${filtered.length}, or type text to search.${c.reset}`
      );
      continue;
    }

    filterText = inputVal;
    page = 0;
  }
}
