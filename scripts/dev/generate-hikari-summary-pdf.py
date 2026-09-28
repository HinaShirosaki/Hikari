#!/usr/bin/env python3

from pathlib import Path
import textwrap


PAGE_WIDTH = 612
PAGE_HEIGHT = 792
MARGIN_X = 42
TOP_MARGIN = 42
BOTTOM_MARGIN = 40
CONTENT_WIDTH = PAGE_WIDTH - (MARGIN_X * 2)

TITLE_SIZE = 20
SECTION_SIZE = 11
BODY_SIZE = 9
SMALL_SIZE = 8


def pdf_escape(text: str) -> str:
    return text.replace("\\", "\\\\").replace("(", "\\(").replace(")", "\\)")


class PDFTextPage:
    def __init__(self):
        self.lines = []
        self.cursor_y = PAGE_HEIGHT - TOP_MARGIN
        self.page_count = 1

    def _push(self, font: str, size: int, text: str, x: float = MARGIN_X):
        self.lines.append(f"BT /{font} {size} Tf 1 0 0 1 {x:.2f} {self.cursor_y:.2f} Tm ({pdf_escape(text)}) Tj ET")

    def space(self, amount: float):
        self.cursor_y -= amount

    def title(self, text: str):
        self._push("F2", TITLE_SIZE, text)
        self.space(24)

    def section(self, text: str):
        self._push("F2", SECTION_SIZE, text)
        self.space(14)

    def paragraph(self, text: str, size: int = BODY_SIZE, leading: float = 11):
        for line in wrap_text(text, CONTENT_WIDTH, size):
            self._push("F1", size, line)
            self.space(leading)
        self.space(3)

    def bullet_list(self, items, size: int = BODY_SIZE, leading: float = 11):
        bullet_indent = 10
        text_width = CONTENT_WIDTH - bullet_indent
        for item in items:
            wrapped = wrap_text(item, text_width, size)
            for index, line in enumerate(wrapped):
                prefix = "- " if index == 0 else "  "
                self._push("F1", size, f"{prefix}{line}")
                self.space(leading)
            self.space(1)
        self.space(2)

    def footer(self, text: str):
        self.cursor_y = max(self.cursor_y, BOTTOM_MARGIN + 6)
        self._push("F1", SMALL_SIZE, text)

    def assert_single_page(self):
        if self.cursor_y < BOTTOM_MARGIN:
            raise RuntimeError(f"Content overflowed page: cursor_y={self.cursor_y}")

    def build_stream(self) -> bytes:
        self.assert_single_page()
        return "\n".join(self.lines).encode("latin-1", errors="replace")


def estimate_text_width(text: str, font_size: int) -> float:
    units = 0
    for char in text:
        if char in "MW@#%&":
            units += 0.92
        elif char in "ABCDEFGHNOQUVXYZwm":
            units += 0.74
        elif char in "abcdefghknopqrsuvxyz0123456789":
            units += 0.56
        elif char in "IJLTfijt-r":
            units += 0.34
        elif char == " ":
            units += 0.28
        else:
            units += 0.5
    return units * font_size


def wrap_text(text: str, max_width: float, font_size: int):
    words = text.split()
    lines = []
    current = []

    for word in words:
        candidate = " ".join(current + [word])
        if current and estimate_text_width(candidate, font_size) > max_width:
            lines.append(" ".join(current))
            current = [word]
        else:
            current.append(word)

    if current:
        lines.append(" ".join(current))
    return lines


def build_pdf(page_stream: bytes) -> bytes:
    objects = []

    def add_object(body):
      if isinstance(body, str):
          body = body.encode("latin-1")
      objects.append(body)

    add_object("<< /Type /Catalog /Pages 2 0 R >>")
    add_object("<< /Type /Pages /Kids [3 0 R] /Count 1 >>")
    add_object(
        f"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 {PAGE_WIDTH} {PAGE_HEIGHT}] "
        "/Resources << /Font << /F1 4 0 R /F2 5 0 R >> >> /Contents 6 0 R >>"
    )
    add_object("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>")
    add_object("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>")
    add_object(f"<< /Length {len(page_stream)} >>\nstream\n".encode("latin-1") + page_stream + b"\nendstream")

    output = bytearray(b"%PDF-1.4\n%\xe2\xe3\xcf\xd3\n")
    offsets = [0]
    for index, obj in enumerate(objects, start=1):
        offsets.append(len(output))
        output.extend(f"{index} 0 obj\n".encode("latin-1"))
        output.extend(obj)
        output.extend(b"\nendobj\n")

    xref_offset = len(output)
    output.extend(f"xref\n0 {len(objects) + 1}\n".encode("latin-1"))
    output.extend(b"0000000000 65535 f \n")
    for offset in offsets[1:]:
        output.extend(f"{offset:010d} 00000 n \n".encode("latin-1"))
    output.extend(
        (
            f"trailer\n<< /Size {len(objects) + 1} /Root 1 0 R >>\n"
            f"startxref\n{xref_offset}\n%%EOF\n"
        ).encode("latin-1")
    )
    return bytes(output)


def main():
    output_path = Path("output/pdf/hikari-app-summary.pdf")
    output_path.parent.mkdir(parents=True, exist_ok=True)

    page = PDFTextPage()
    page.title("Hikari App Summary")
    page.paragraph(
        "Hikari is an Electron desktop app for lab workflow management that combines records, notebooks, "
        "inventory, assay and gel analysis, papers, and an agent chat surface in one interface."
    )
    page.paragraph(
        "The repo shows a multi-module workstation with local state persistence, JSON file save/load, and "
        "optional LLM and Telegram integrations."
    )

    page.section("Who It Is For")
    page.paragraph(
        "Primary persona: lab members running wet-lab workflows, based on repo modules for members, "
        "instruments, protocols, synthesis and biology notebooks, samples, assays, gels, chemicals, and papers."
    )

    page.section("What It Does")
    page.bullet_list([
        "Manages lab members, projects, workflows, and protocol records.",
        "Schedules instruments and reservations with calendar views.",
        "Maintains synthesis and biology notebook entries linked to project context.",
        "Tracks chemicals, personal inventory, and sample registry records.",
        "Supports assay result handling and gel analysis workflows.",
        "Stores papers and can turn extracted methods into protocol drafts.",
        "Provides an agent chat UI plus optional Telegram bot controls."
    ])

    page.section("How It Works")
    page.bullet_list([
        "Electron main process (`src/main/main.js`) creates the desktop window, handles file dialogs, auto-save/load, "
        "agent requests, and Telegram bot lifecycle.",
        "A preload bridge (`src/main/preload.js`) exposes a narrow IPC API to the renderer for storage, agent chat, and Telegram actions.",
        "The renderer (`src/renderer/renderer.js`) initializes domain modules from `src/renderer/modules/` and coordinates cross-module refreshes.",
        "Client state lives in browser `localStorage` via `src/renderer/modules/shared.js`; the app can also persist/load a JSON data file.",
        "Optional data flow: renderer sends agent prompts to the main process, which calls an LLM endpoint; Telegram commands are forwarded into the renderer."
    ])

    page.section("How To Run")
    page.bullet_list([
        "Install dependencies: `npm install`.",
        "Run the app in development: `npm run start`.",
        "Optional check: `npm test`.",
        "Build installers/packages: `npm run dist` or `npm run package:app`."
    ])

    page.section("Not Found In Repo")
    page.bullet_list([
        "Authentication and multi-user server architecture: Not found in repo.",
        "Production deployment environment or hosted backend details: Not found in repo."
    ], size=SMALL_SIZE, leading=9.5)

    page.footer("Evidence source: repo files only. Generated on 2026-03-05.")

    pdf_bytes = build_pdf(page.build_stream())
    output_path.write_bytes(pdf_bytes)
    print(output_path.resolve())


if __name__ == "__main__":
    main()
