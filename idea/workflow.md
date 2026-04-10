

# Workflow Module Design

## 1. Core Concept
- Workflows are **instantiated exclusively from predefined templates**.
- Templates define:
  - Protocol sequence
  - Branching logic
  - Required inputs (placeholders)
- Each instantiated workflow is a **trackable experimental execution unit**.

---

## 2. Layout Overview

### Left Panel (Navigation Rail)
- Displays a **list of workflow instances** (created from templates).
- Each item includes:
  - Workflow name
  - Status indicator (e.g., % complete or current stage)
- Supports:
  - Search / filter
  - Grouping (by project, date, or type)

---

### Right Panel (Execution Canvas)
A **large, horizontally scrollable progress table**:

#### Structure
- **Rows = Entries (experimental instances / samples)**
  - First column = editable entry name (e.g., Sample A, Clone 12)
- **Columns = Protocol steps**
  - First row = protocol names (from template)

---

## 3. Progress Visualization

Each row (entry) shows a **workflow progression track**:

●────●────◦────◦

- **● (filled dot)** → completed protocol  
- **◦ (empty dot)** → pending protocol  
- **Solid line** → completed transitions  
- **Dashed line** → pending transitions  

This provides a **quick visual overview of progress across entries**.

---

## 4. Interaction Model

### Click Behavior
- Clicking a **dot (step node)**:
  - Expands the workflow vertically
  - Reveals:
    - Protocol details
    - Input placeholders (e.g., [volume], [time])
    - Associated tools (assay, gel, notes)

### Inline Editing
- Users can:
  - Fill placeholders directly
  - Attach results (files, images, structured data)
  - Modify entry names

---

## 5. Branching Logic

- Each workflow has a **clearly defined main branch**

Visualization:

Main:    ●────●────●  
             │  
Branch:      ●────●  

- Branch nodes:
  - Render **below the main track**
  - Display protocol name above the branch segment
- Branch activation:
  - Manual selection (initial version)
  - Conditional logic (future extension)

---

## 6. Notebook Integration

- When a protocol step is completed:
  - Automatically **generate a linked notebook page**

Each notebook page includes:
- Protocol used
- Filled parameters
- Attached results
- Timestamp and entry reference

Result:
- **Fully traceable experimental history without manual duplication**

---

## 7. Workflow Template Editor

- Separate from execution UI
- Keeps existing behavior
- Defines:
  - Protocol sequence
  - Branch structure
  - Placeholder schema
- Outputs a structured template (JSON-compatible)

---

## 8. Design Philosophy

The system should feel like:

- **Git for experiments** (branching + history)
- **Pipeline tracker** (clear progression)
- **ELN auto-writer** (automatic documentation)

---

## 9. Future Extensions

- Conditional branching (based on assay results)
- Parallel execution tracking
- Dependency-aware locking (step gating)
- AI-assisted features:
  - Auto-fill placeholders
  - Suggest next steps
  - Detect anomalies