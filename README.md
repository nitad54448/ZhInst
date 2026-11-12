# ZhInst
utilities for LIA from Zurich Instruments 

## Data extractor v1.0.1

Open `zhinst_csv_scrapper.html` in a browser. Review issues 12 and 13 are fixed:

- Scanning and extraction use the same original line array, including blank
  lines. Stored row indices therefore identify the correct source rows.
- Samples are paired by each label's row occurrence and original sample column.
  Empty, malformed or non-finite cells exclude the entire corresponding sample
  across X, Y1 and Y2. The page and log report how many samples were excluded.
- Different row counts or different sample counts within a row group are
  rejected with a visible error. The extractor does not truncate channels to
  make their lengths match. Source rows must represent matching sample positions;
  the tool cannot infer alignment from timestamps or other metadata.
- Failed extraction clears previous charts, previews and downloadable data.
  Semicolon, comma and tab separators are supported, including auto detection
  after leading blank lines. Decimal commas work with semicolon or tab input.

Run `npm test` with Node.js; no dependency installation is needed. The tests
exercise the actual page script with browser/chart stubs, including blank lines,
missing samples in every channel, repeated row groups, incompatible lengths,
numeric parsing, stale results, and the generated TSV/CSV downloads.
