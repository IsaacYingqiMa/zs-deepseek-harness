#!/usr/bin/env python3
"""Extract paragraphs from both docx files to compare with the md report."""
import sys
from pathlib import Path
from docx import Document

for name in ["autonomous-programming-report.docx", "新建 DOCX 文档.docx"]:
    p = Path("D:/InspurCode/zs-deepseek-harness/non-functional") / name
    print(f"\n========== {name} ==========")
    if not p.exists():
        print(f"NOT FOUND: {p}")
        continue
    doc = Document(p)
    for i, para in enumerate(doc.paragraphs):
        text = para.text.strip()
        if not text:
            continue
        print(f"[{i:04d}] {text}")
