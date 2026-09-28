# Development-only scripts

This folder contains ad hoc fixture generators and architectural diagnostics. They are not part of the build, test runner, packaging, or supported application maintenance path.

- `dependency-report/` compares a Git baseline with the working tree and emits dependency-split reports.
- `test-fixtures/make-testdata7.py` creates the local, gitignored `TestData7/` fixture.
- `generate-hikari-summary-pdf.py` recreates the historical one-page application summary artifact.
