{
    "user_message" : "string"
    "primary_intent": "one allowed intent",
    "reasoning_effort": 0,
    "direct_answer": "string or null",
    "inventory_search_candidate_terms":[],
    "protocol_candidates":[]
}

### protocol_to_notebook
Use when the user describes lab work and wants a protocol-based notebook draft or protocol-guided documentation.
Intent-specific rule: Infer up to three likely protocol names, capture relevant activity and project entities.
Intent-specific output append:
- protocol_candidates: Populate with 1 to 3 likely protocol names inferred from the request.

