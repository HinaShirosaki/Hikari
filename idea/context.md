
# Context Management Refactor Design

## Goal

Refactor the current context management system to improve structure, scalability, and reasoning stability.

The key idea is to **introduce a registry layer before context assembly**, while still preserving the existing layered context output design.

---

## Core Idea

Instead of directly assembling context from raw module outputs, all information should first be collected into a **central registry**, and then selectively assembled into the final context based on defined rules.

This creates a clean separation between:

- **Context production** (modules generating information)
- **Context storage** (registry)
- **Context selection & assembly** (context manager)

---

## Registry Design

The registry serves as a structured storage of all candidate context blocks.

Each module submits its output to the registry instead of writing directly into the prompt.

### Registry Content Types

The registry should include (but is not limited to):

- **User-related**
  - Recent messages
  - Original user message
  - Clarified user message
  - User answers to follow-up questions

- **Execution-related**
  - Tool outputs
  - Paper information (raw or summarized)

- **Memory-related**
  - Project memory
  - Persistent knowledge

- **Reasoning-related**
  - Inference feedback
  - Evaluation / judge feedback

- **System-related**
  - Skills
  - Workflow state
  - Agent internal state

---

## Context Assembly

The context manager is responsible for assembling the final context from the registry.

### Assembly Principles

- Select context **based on relevance to the current task**
- Prioritize **clarified intent and active task state**
- Include only **necessary tool and paper information**
- Inject **feedback only if it affects next-step reasoning**
- Avoid redundancy and stale information

---

## Layer Compatibility

The new registry system should remain compatible with the existing layered context structure.

Typical layers may include:

1. **Core Layer** – system prompt, constraints
2. **Task Layer** – clarified user intent, current objective
3. **Evidence Layer** – tool outputs, paper summaries
4. **Verification Layer** – inference and evaluation feedback
5. **Memory Layer** – project-level knowledge

The registry feeds these layers, rather than replacing them.

---

## Benefits

- Prevents uncontrolled context growth
- Improves reasoning clarity and stability
- Enables better filtering and prioritization
- Simplifies debugging and traceability
- Supports complex multi-step workflows

---

## Summary

Introduce a **registry-first architecture**:

> Modules → Registry → Context Manager → Final Context

This ensures that only the most relevant, high-quality, and necessary information is included in each reasoning step.