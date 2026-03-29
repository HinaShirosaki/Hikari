function getMethodStepText(step) {
  if (typeof step === 'string') {
    return String(step || '').trim();
  }
  if (!step || typeof step !== 'object') {
    return '';
  }
  return String(
    step.action
    || step.text
    || step.instruction
    || step.description
    || step.step
    || step.content
    || ''
  ).trim();
}

function normalizeMethodSteps(rawSteps) {
  const source = Array.isArray(rawSteps) ? rawSteps : [];
  if (!source.length) {
    return [];
  }

  const sorted = source
    .map((step, index) => ({ step, index }))
    .sort((a, b) => {
      const numberA = Number(a.step?.step_number ?? a.step?.number ?? a.step?.index);
      const numberB = Number(b.step?.step_number ?? b.step?.number ?? b.step?.index);
      const hasNumberA = Number.isFinite(numberA);
      const hasNumberB = Number.isFinite(numberB);
      if (hasNumberA && hasNumberB && numberA !== numberB) {
        return numberA - numberB;
      }
      if (hasNumberA !== hasNumberB) {
        return hasNumberA ? -1 : 1;
      }
      return a.index - b.index;
    });

  const rows = sorted
    .map(({ step }, index) => {
      const action = getMethodStepText(step);
      if (!action) {
        return null;
      }
      const rawNumber = Number(step?.step_number ?? step?.number ?? step?.index);
      return {
        step_number: Number.isFinite(rawNumber) && rawNumber > 0 ? Math.round(rawNumber) : index + 1,
        action
      };
    })
    .filter(Boolean);

  return rows.map((item, index) => ({
    step_number: index + 1,
    action: item.action
  }));
}

function normalizeMethodTroubleshooting(rawTroubleshooting) {
  if (!rawTroubleshooting) {
    return [];
  }
  if (typeof rawTroubleshooting === 'string') {
    return String(rawTroubleshooting || '')
      .split(/\r?\n+/)
      .map((line) => String(line || '').trim())
      .filter(Boolean)
      .map((problem) => ({
        problem,
        possible_cause: '',
        solution: ''
      }));
  }
  if (!Array.isArray(rawTroubleshooting)) {
    return [];
  }
  return rawTroubleshooting
    .map((item) => {
      if (typeof item === 'string') {
        const problem = String(item || '').trim();
        if (!problem) {
          return null;
        }
        return {
          problem,
          possible_cause: '',
          solution: ''
        };
      }
      if (!item || typeof item !== 'object') {
        return null;
      }
      const problem = String(item.problem || item.issue || '').trim();
      const possibleCause = String(item.possible_cause || item.possibleCause || item.cause || '').trim();
      const solution = String(item.solution || item.fix || '').trim();
      if (!problem && !possibleCause && !solution) {
        return null;
      }
      return {
        problem,
        possible_cause: possibleCause,
        solution
      };
    })
    .filter(Boolean);
}

export function normalizeMethodsExtract(result) {
  let methods = [];
  if (Array.isArray(result?.methods)) {
    methods = result.methods;
  } else if (Array.isArray(result?.protocols)) {
    methods = result.protocols;
  } else if (Array.isArray(result)) {
    methods = result;
  } else if (result && typeof result === 'object') {
    methods = [result];
  }

  const normalizeMaterial = (material) => {
    if (typeof material === 'string') {
      return String(material || '').trim();
    }
    if (!material || typeof material !== 'object') {
      return '';
    }
    const fields = Object.entries(material)
      .map(([key, value]) => {
        if (value === null || value === undefined) {
          return '';
        }
        const rendered = typeof value === 'object' ? JSON.stringify(value) : String(value).trim();
        if (!rendered || rendered === '{}' || rendered === '[]') {
          return '';
        }
        return `${key}: ${rendered}`;
      })
      .filter(Boolean);
    return fields.join('; ').trim();
  };

  return methods.map((item, index) => {
    const title = String(item?.title || item?.name || `Method ${index + 1}`).trim() || `Method ${index + 1}`;
    const rawSteps = Array.isArray(item?.steps)
      ? item.steps
      : (Array.isArray(item?.procedure) ? item.procedure : []);
    const steps = normalizeMethodSteps(rawSteps);
    const citations = Array.isArray(item?.citations)
      ? item.citations.map((cit) => String(cit || '').trim()).filter(Boolean)
      : (Array.isArray(item?.references) ? item.references.map((cit) => String(cit || '').trim()).filter(Boolean) : []);

    return {
      title,
      purpose: String(item?.purpose || item?.objective || '').trim(),
      materials: Array.isArray(item?.materials)
        ? item.materials.map((material) => normalizeMaterial(material)).filter(Boolean)
        : [],
      steps,
      troubleshooting: normalizeMethodTroubleshooting(item?.troubleshooting),
      citations
    };
  }).filter((item) => item.title || item.steps.length);
}

export function parseJsonFromText(raw) {
  const clean = String(raw || '').trim();
  if (!clean) {
    return {};
  }
  try {
    return JSON.parse(clean);
  } catch {
    const candidates = [];
    const fenced = clean.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
    if (fenced?.[1]) {
      candidates.push(fenced[1].trim());
    }

    const arrayStart = clean.indexOf('[');
    const arrayEnd = clean.lastIndexOf(']');
    if (arrayStart >= 0 && arrayEnd > arrayStart) {
      candidates.push(clean.slice(arrayStart, arrayEnd + 1));
    }

    const objectStart = clean.indexOf('{');
    const objectEnd = clean.lastIndexOf('}');
    if (objectStart >= 0 && objectEnd > objectStart) {
      candidates.push(clean.slice(objectStart, objectEnd + 1));
    }

    const seen = new Set();
    for (const candidate of candidates) {
      if (!candidate || seen.has(candidate)) {
        continue;
      }
      seen.add(candidate);
      try {
        return JSON.parse(candidate);
      } catch {
        // Try the next extraction candidate.
      }
    }
    return {};
  }
}

export function normalizePaperSummary(rawSummary) {
  const raw = String(rawSummary || '').trim();
  if (!raw) {
    return {
      summary: 'No summary generated.',
      structured: null
    };
  }

  const parsed = parseJsonFromText(raw);
  const hasStructuredPayload = parsed
    && typeof parsed === 'object'
    && !Array.isArray(parsed)
    && Object.keys(parsed).length > 0;
  if (hasStructuredPayload) {
    const summaryFromFields = [
      parsed.plain_english_summary,
      parsed.plainEnglishSummary,
      parsed.summary,
      parsed.main_conclusion,
      parsed.mainConclusion,
      parsed.technical_summary,
      parsed.technicalSummary,
      parsed.background
    ]
      .map((value) => String(value || '').trim())
      .find(Boolean) || '';
    const keyFindingsSummary = Array.isArray(parsed.key_findings)
      ? parsed.key_findings
        .map((value) => String(value || '').trim())
        .filter(Boolean)
        .slice(0, 3)
        .join(' ')
      : '';
    return {
      summary: summaryFromFields || keyFindingsSummary || 'No plain-English summary generated.',
      structured: parsed
    };
  }

  return {
    summary: raw,
    structured: null
  };
}
