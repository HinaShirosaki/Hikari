Make a developer mode, record every information send to llm agent and received from llm agent under that mode. 

Keep agent-intent-parser.js. And the rendering process of chat box for users and agent. And keep python sandbox fucntion. For the rest of which, just delete them.

You may change prompt when adjusting the agent tools. But just to be careful.

I want to keep protocol_to_notebook,inventory_loopup, record_loopup, project_science_question, general_science_question, result_analysis, mixed_request, unclear, paper_analysis, literature_search. 

For output schema, it should be a json like mentioned in INTENT_PARSER_PROMPT.

I want to remove the confidence score of intent phrasing and secondary_intents.

